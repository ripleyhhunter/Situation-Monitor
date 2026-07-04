/**
 * Persistent Geocode Cache Service
 * 
 * Stores geocoded addresses in Redis for persistence across restarts.
 * Falls back to in-memory cache if Redis is unavailable.
 */

import { cache } from './cache.js';
import logger from '../logger.js';

interface GeocodedLocation {
  lat: number;
  lng: number;
  geocodedAt: string;
}

/** Region context for geocoding — supplied by the caller so the shared
 * service works for any region (addresses are bare street strings). */
export interface GeocodeRegion {
  /** City appended to bare street addresses, e.g. "Washington", "Boise". */
  city: string;
  /** Two-letter state, e.g. "DC", "ID". */
  state: string;
  /** Sanity anchor — results farther than MAX_DISTANCE_KM are rejected as wrong-city matches. */
  center: { lat: number; lng: number };
}

/** Reject geocode hits farther than this from the region center (a street
 * name that exists in another city would otherwise be cached for 30 days). */
const MAX_DISTANCE_KM = 60;

// In-memory cache for fast lookups (populated from Redis on startup).
// Capped: entries are never individually evicted, so without a bound the map
// grows with every unique address for the lifetime of the process.
const memoryCache = new Map<string, GeocodedLocation>();
const MEMORY_CACHE_MAX = 5000;

function boundedSet(key: string, value: GeocodedLocation): void {
  if (memoryCache.size >= MEMORY_CACHE_MAX && !memoryCache.has(key)) {
    // Map iteration order is insertion order — drop the oldest entry.
    const oldest = memoryCache.keys().next().value;
    if (oldest !== undefined) memoryCache.delete(oldest);
  }
  memoryCache.set(key, value);
}

// Rate limiting for Nominatim (1 request per second)
let lastGeocodeTime = 0;
const GEOCODE_RATE_LIMIT_MS = 1100;

// Redis key prefix
const REDIS_PREFIX = 'geocode:';

// Cache TTL: 30 days (addresses don't change often)
const CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;

class GeocacheService {
  private initialized = false;
  private pendingInit: Promise<void> | null = null;

  /**
   * Initialize the geocache by loading existing entries from Redis
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    // Prevent multiple simultaneous initializations
    if (this.pendingInit) {
      return this.pendingInit;
    }

    this.pendingInit = this.doInitialize();
    await this.pendingInit;
    this.pendingInit = null;
  }

  private async doInitialize(): Promise<void> {
    try {
      // Load all geocoded addresses from Redis into memory
      const keys = await cache.keys(`${REDIS_PREFIX}*`);
      
      if (keys.length > 0) {
        logger.info(`Loading ${keys.length} geocoded addresses from cache`);
        
        for (const key of keys) {
          const data = await cache.get<GeocodedLocation>(key);
          if (data) {
            const address = key.replace(REDIS_PREFIX, '');
            boundedSet(address, data);
          }
        }
        
        logger.info(`Loaded ${memoryCache.size} geocoded addresses into memory`);
      }
      
      this.initialized = true;
    } catch (error) {
      logger.warn('Failed to load geocache from Redis, starting fresh', { error });
      this.initialized = true;
    }
  }

  /** Cache keys are region-scoped: the same bare street string in two
   * regions must never share an entry. */
  private scopedKey(region: GeocodeRegion, address: string): string {
    return `${region.state}:${region.city}:${address}`;
  }

  private async getCached(region: GeocodeRegion, address: string): Promise<GeocodedLocation | null> {
    await this.initialize();

    const key = this.scopedKey(region, address);

    // Check memory cache first (fastest)
    const cached = memoryCache.get(key);
    if (cached) {
      return cached;
    }

    // Try Redis if not in memory
    const redisData = await cache.get<GeocodedLocation>(REDIS_PREFIX + key);

    if (redisData) {
      // Populate memory cache
      boundedSet(key, redisData);
      return redisData;
    }

    return null;
  }

  private async setCached(region: GeocodeRegion, address: string, lat: number, lng: number): Promise<void> {
    await this.initialize();

    const key = this.scopedKey(region, address);
    const data: GeocodedLocation = {
      lat,
      lng,
      geocodedAt: new Date().toISOString(),
    };

    boundedSet(key, data);
    await cache.set(REDIS_PREFIX + key, data, CACHE_TTL_SECONDS);
  }

  /**
   * Geocode an address using Nominatim, with caching
   */
  async geocode(
    address: string,
    region: GeocodeRegion,
  ): Promise<{ lat: number; lng: number; cached: boolean } | null> {
    // Check cache first
    const cached = await this.getCached(region, address);
    if (cached) {
      return { lat: cached.lat, lng: cached.lng, cached: true };
    }

    // Clean the address
    const cleanAddress = this.cleanAddress(address, region);
    if (!cleanAddress) {
      return null;
    }

    // Also check cache with cleaned address
    const cachedClean = await this.getCached(region, cleanAddress);
    if (cachedClean) {
      // Store under original address too
      await this.setCached(region, address, cachedClean.lat, cachedClean.lng);
      return { lat: cachedClean.lat, lng: cachedClean.lng, cached: true };
    }
    
    // Rate limit
    const now = Date.now();
    const timeSinceLastGeocode = now - lastGeocodeTime;
    if (timeSinceLastGeocode < GEOCODE_RATE_LIMIT_MS) {
      await new Promise(resolve => setTimeout(resolve, GEOCODE_RATE_LIMIT_MS - timeSinceLastGeocode));
    }
    lastGeocodeTime = Date.now();
    
    // Call Nominatim
    try {
      const query = encodeURIComponent(cleanAddress);
      const url = `https://nominatim.openstreetmap.org/search?q=${query}&format=json&limit=1&countrycodes=us`;
      
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'SituationMonitor/1.0 (https://github.com/situation-monitor)',
        },
        signal: AbortSignal.timeout(10000),
      });
      
      if (!response.ok) {
        logger.warn(`Nominatim returned ${response.status} for "${cleanAddress}"`);
        return null;
      }
      
      const data = await response.json() as Array<{ lat: string; lon: string }>;
      
      if (data && data.length > 0 && data[0].lat && data[0].lon) {
        const lat = parseFloat(data[0].lat);
        const lng = parseFloat(data[0].lon);

        // Validate the hit is actually near this region
        if (this.isNearRegion(lat, lng, region)) {
          // Cache the result
          await this.setCached(region, address, lat, lng);
          await this.setCached(region, cleanAddress, lat, lng);

          logger.debug(`Geocoded "${cleanAddress}" -> ${lat}, ${lng}`);
          return { lat, lng, cached: false };
        } else {
          logger.debug(`Geocoding result too far from ${region.city} center: "${cleanAddress}" -> ${lat}, ${lng}`);
        }
      }
    } catch (error) {
      logger.warn(`Geocoding error for "${cleanAddress}": ${error}`);
    }
    
    return null;
  }

  /**
   * Clean address for geocoding
   */
  private cleanAddress(address: string, region: GeocodeRegion): string | null {
    if (!address) return null;

    let cleaned = address.trim();

    // Remove "block of" and similar
    cleaned = cleaned.replace(/\bblock\s+of\b/gi, '');
    cleaned = cleaned.replace(/\bblk\s+of\b/gi, '');
    cleaned = cleaned.replace(/\bblock\b/gi, '');

    // Ensure a city/state suffix so bare street strings resolve locally
    const lower = cleaned.toLowerCase();
    if (!lower.includes(region.city.toLowerCase()) && !lower.includes(`, ${region.state.toLowerCase()}`)) {
      cleaned = `${cleaned}, ${region.city}, ${region.state}`;
    }

    // Normalize whitespace
    cleaned = cleaned.replace(/\s+/g, ' ').trim();

    return cleaned.length > 5 ? cleaned : null;
  }

  /**
   * Check the hit is within MAX_DISTANCE_KM of the region center
   */
  private isNearRegion(lat: number, lng: number, region: GeocodeRegion): boolean {
    const R = 6371;
    const toRad = (deg: number) => deg * (Math.PI / 180);
    const dLat = toRad(lat - region.center.lat);
    const dLng = toRad(lng - region.center.lng);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(region.center.lat)) * Math.cos(toRad(lat)) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const distanceKm = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return distanceKm <= MAX_DISTANCE_KM;
  }

  /**
   * Get cache statistics
   */
  getStats(): { memorySize: number; initialized: boolean } {
    return {
      memorySize: memoryCache.size,
      initialized: this.initialized,
    };
  }
}

export const geocache = new GeocacheService();
export default geocache;
