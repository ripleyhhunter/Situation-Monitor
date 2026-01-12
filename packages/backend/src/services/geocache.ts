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

// In-memory cache for fast lookups (populated from Redis on startup)
const memoryCache = new Map<string, GeocodedLocation>();

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
            memoryCache.set(address, data);
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

  /**
   * Get cached coordinates for an address
   */
  async get(address: string): Promise<GeocodedLocation | null> {
    await this.initialize();
    
    // Check memory cache first (fastest)
    const cached = memoryCache.get(address);
    if (cached) {
      return cached;
    }
    
    // Try Redis if not in memory
    const redisKey = REDIS_PREFIX + address;
    const redisData = await cache.get<GeocodedLocation>(redisKey);
    
    if (redisData) {
      // Populate memory cache
      memoryCache.set(address, redisData);
      return redisData;
    }
    
    return null;
  }

  /**
   * Store geocoded coordinates for an address
   */
  async set(address: string, lat: number, lng: number): Promise<void> {
    await this.initialize();
    
    const data: GeocodedLocation = {
      lat,
      lng,
      geocodedAt: new Date().toISOString(),
    };
    
    // Store in memory
    memoryCache.set(address, data);
    
    // Persist to Redis
    const redisKey = REDIS_PREFIX + address;
    await cache.set(redisKey, data, CACHE_TTL_SECONDS);
  }

  /**
   * Geocode an address using Nominatim, with caching
   */
  async geocode(address: string): Promise<{ lat: number; lng: number; cached: boolean } | null> {
    // Check cache first
    const cached = await this.get(address);
    if (cached) {
      return { lat: cached.lat, lng: cached.lng, cached: true };
    }
    
    // Clean the address
    const cleanAddress = this.cleanAddress(address);
    if (!cleanAddress) {
      return null;
    }
    
    // Also check cache with cleaned address
    const cachedClean = await this.get(cleanAddress);
    if (cachedClean) {
      // Store under original address too
      await this.set(address, cachedClean.lat, cachedClean.lng);
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
      });
      
      if (!response.ok) {
        logger.warn(`Nominatim returned ${response.status} for "${cleanAddress}"`);
        return null;
      }
      
      const data = await response.json() as Array<{ lat: string; lon: string }>;
      
      if (data && data.length > 0 && data[0].lat && data[0].lon) {
        const lat = parseFloat(data[0].lat);
        const lng = parseFloat(data[0].lon);
        
        // Validate within DC area
        if (this.isInDCArea(lat, lng)) {
          // Cache the result
          await this.set(address, lat, lng);
          await this.set(cleanAddress, lat, lng);
          
          logger.debug(`Geocoded "${cleanAddress}" -> ${lat}, ${lng}`);
          return { lat, lng, cached: false };
        } else {
          logger.debug(`Geocoding result outside DC area: "${cleanAddress}" -> ${lat}, ${lng}`);
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
  private cleanAddress(address: string): string | null {
    if (!address) return null;
    
    let cleaned = address.trim();
    
    // Remove "block of" and similar
    cleaned = cleaned.replace(/\bblock\s+of\b/gi, '');
    cleaned = cleaned.replace(/\bblk\s+of\b/gi, '');
    cleaned = cleaned.replace(/\bblock\b/gi, '');
    
    // Ensure Washington DC suffix
    if (!cleaned.toLowerCase().includes('washington') && !cleaned.toLowerCase().includes(', dc')) {
      cleaned = cleaned + ', Washington, DC';
    }
    
    // Normalize whitespace
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    
    return cleaned.length > 5 ? cleaned : null;
  }

  /**
   * Check if coordinates are within DC metro area
   */
  private isInDCArea(lat: number, lng: number): boolean {
    const bounds = {
      north: 39.15,
      south: 38.75,
      east: -76.85,
      west: -77.25,
    };
    
    return lat >= bounds.south && lat <= bounds.north &&
           lng >= bounds.west && lng <= bounds.east;
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
