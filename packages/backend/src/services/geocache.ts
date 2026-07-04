/**
 * Persistent Geocode Cache Service
 *
 * Resolution chain (each hit is sanity-checked against the region center):
 *
 *   1. US Census Bureau geocoder — PRIMARY for house-numbered street
 *      addresses. Authoritative TIGER data, keyless, no practical rate
 *      limit at our volume, and it doesn't fuzzy-jump to a different
 *      street the way Nominatim's free-form search does.
 *   2. Nominatim — intersections, bare streets, landmarks, and Census
 *      misses. Street-address results are VALIDATED: the returned road
 *      must contain the queried street's core name, otherwise the hit is
 *      rejected (a "5410 Connecticut Ave NW" query once matched a Belmont
 *      St building and was cached for 30 days). 429 responses trigger a
 *      hard backoff window — Nominatim rate-blocks this IP under load,
 *      and hammering it converts every address into a fallback pin.
 *   3. Street-centroid degrade — a house-numbered address whose exact
 *      lookups failed retries with the house number stripped. The result
 *      is marked `approximate: true` (callers surface this in the UI)
 *      and cached with a short TTL so it can upgrade later.
 *
 * Results persist in Redis (in-memory fallback) — exact hits for 30 days,
 * approximate hits for 6 hours.
 */

import { cache } from './cache.js';
import logger from '../logger.js';

interface GeocodedLocation {
  lat: number;
  lng: number;
  geocodedAt: string;
  approximate?: boolean;
}

export interface GeocodeResult {
  lat: number;
  lng: number;
  cached: boolean;
  /** True when the pin is a street centroid, not the exact address. */
  approximate: boolean;
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

// Redis key prefix
const REDIS_PREFIX = 'geocode:';

// Cache TTLs: exact hits are stable; approximate (street-centroid) hits
// stay short so they can upgrade once the exact resolvers recover.
const CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;
const APPROX_CACHE_TTL_SECONDS = 6 * 60 * 60;

// Identify per Nominatim's usage policy — must point somewhere real.
const USER_AGENT = 'SituationMonitor/1.0 (+https://github.com/ripleyhhunter/Situation-Monitor)';

const CENSUS_URL = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

interface CensusResponse {
  result?: {
    addressMatches?: Array<{
      coordinates?: { x?: number; y?: number };
      matchedAddress?: string;
    }>;
  };
}

interface NominatimHit {
  lat?: string;
  lon?: string;
  display_name?: string;
  address?: Record<string, string>;
}

/** "5410 CONNECTICUT AVE NW" → true; "14TH ST NW" → false (ordinal, not a
 * house number); "P ST NW" → false. Exported for tests. */
export function hasHouseNumber(address: string): boolean {
  return /^\d+\s/.test(address.trim());
}

/** Intersection-style queries get no street validation — Nominatim's
 * answers for them name only one of the two roads. */
export function isIntersection(address: string): boolean {
  return /\/|&|\bAND\b|\bAT\b/i.test(address);
}

const STREET_SUFFIXES = new Set([
  'st', 'street', 'ave', 'avenue', 'rd', 'road', 'blvd', 'boulevard',
  'dr', 'drive', 'ct', 'court', 'pl', 'place', 'pkwy', 'parkway',
  'hwy', 'highway', 'ln', 'lane', 'ter', 'terrace', 'way', 'cir', 'circle',
  'nw', 'ne', 'sw', 'se', 'n', 's', 'e', 'w',
]);

/**
 * The distinguishing part of a street name: "5410 CONNECTICUT AVE NW,
 * WASHINGTON, DC" → "connecticut"; "48TH ST NE" → "48th". Exported for tests.
 */
export function streetCore(address: string): string | null {
  const street = address.split(',')[0] ?? '';
  const tokens = street
    .toLowerCase()
    .replace(/[.#]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    // Drop a leading house number but keep ordinals ("48th").
    .filter((t, i) => !(i === 0 && /^\d+$/.test(t)))
    .filter((t) => !STREET_SUFFIXES.has(t));
  if (tokens.length === 0) return null;
  // The longest remaining token is the most distinguishing one.
  return tokens.reduce((a, b) => (b.length > a.length ? b : a));
}

/** Does a resolver's answer actually name the street we asked about? */
export function matchesQueriedStreet(address: string, resultText: string): boolean {
  const core = streetCore(address);
  if (!core) return true; // nothing to validate against
  return resultText.toLowerCase().includes(core);
}

export interface GeocacheOptions {
  /** Min ms between Nominatim requests (their policy: 1/sec absolute max). */
  nominatimIntervalMs?: number;
  /** Min ms between Census requests (politeness only). */
  censusIntervalMs?: number;
  /** How long to stop calling Nominatim after a 429. */
  nominatimBackoffMs?: number;
}

export class GeocacheService {
  private initialized = false;
  private pendingInit: Promise<void> | null = null;

  private readonly nominatimIntervalMs: number;
  private readonly censusIntervalMs: number;
  private readonly nominatimBackoffMs: number;

  private lastNominatimTime = 0;
  private lastCensusTime = 0;
  private nominatimBlockedUntil = 0;
  private blockLogged = false;

  constructor(options: GeocacheOptions = {}) {
    this.nominatimIntervalMs = options.nominatimIntervalMs ?? 1100;
    this.censusIntervalMs = options.censusIntervalMs ?? 250;
    this.nominatimBackoffMs = options.nominatimBackoffMs ?? 5 * 60 * 1000;
  }

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

  private async setCached(
    region: GeocodeRegion,
    address: string,
    lat: number,
    lng: number,
    approximate: boolean,
  ): Promise<void> {
    await this.initialize();

    const key = this.scopedKey(region, address);
    const data: GeocodedLocation = {
      lat,
      lng,
      geocodedAt: new Date().toISOString(),
      ...(approximate ? { approximate: true } : {}),
    };

    boundedSet(key, data);
    await cache.set(
      REDIS_PREFIX + key,
      data,
      approximate ? APPROX_CACHE_TTL_SECONDS : CACHE_TTL_SECONDS,
    );
  }

  private async throttle(kind: 'census' | 'nominatim'): Promise<void> {
    const interval = kind === 'census' ? this.censusIntervalMs : this.nominatimIntervalMs;
    const last = kind === 'census' ? this.lastCensusTime : this.lastNominatimTime;
    const wait = interval - (Date.now() - last);
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    if (kind === 'census') this.lastCensusTime = Date.now();
    else this.lastNominatimTime = Date.now();
  }

  /** Exact house-number lookup against the Census Bureau geocoder. */
  private async censusGeocode(cleanAddress: string): Promise<{ lat: number; lng: number } | null> {
    await this.throttle('census');
    try {
      const url = `${CENSUS_URL}?address=${encodeURIComponent(cleanAddress)}&benchmark=Public_AR_Current&format=json`;
      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) {
        logger.debug(`Census geocoder returned ${response.status} for "${cleanAddress}"`);
        return null;
      }
      const data = (await response.json()) as CensusResponse;
      const match = data.result?.addressMatches?.[0];
      const x = match?.coordinates?.x;
      const y = match?.coordinates?.y;
      if (typeof x === 'number' && typeof y === 'number') {
        return { lat: y, lng: x };
      }
    } catch (error) {
      logger.debug(`Census geocoder error for "${cleanAddress}": ${error}`);
    }
    return null;
  }

  /**
   * Nominatim lookup. `validateStreet` rejects answers on a different road
   * than the one queried (free-form search fuzzy-matches aggressively).
   */
  private async nominatimGeocode(
    cleanAddress: string,
    validateStreet: boolean,
  ): Promise<{ lat: number; lng: number } | null> {
    if (Date.now() < this.nominatimBlockedUntil) {
      if (!this.blockLogged) {
        logger.warn('Nominatim in 429 backoff window — skipping lookups');
        this.blockLogged = true;
      }
      return null;
    }
    this.blockLogged = false;

    await this.throttle('nominatim');
    try {
      const query = encodeURIComponent(cleanAddress);
      const url = `${NOMINATIM_URL}?q=${query}&format=json&limit=1&countrycodes=us&addressdetails=1`;

      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(10000),
      });

      if (response.status === 429) {
        // Nominatim rate-blocks this IP under load. Back off hard — every
        // request during a block just extends it, and each null here used
        // to become a silent fabricated fallback pin downstream.
        this.nominatimBlockedUntil = Date.now() + this.nominatimBackoffMs;
        logger.warn(`Nominatim 429 — backing off ${Math.round(this.nominatimBackoffMs / 1000)}s`);
        return null;
      }
      if (!response.ok) {
        logger.warn(`Nominatim returned ${response.status} for "${cleanAddress}"`);
        return null;
      }

      const data = (await response.json()) as NominatimHit[];
      const hit = data?.[0];
      if (!hit?.lat || !hit?.lon) return null;

      if (validateStreet) {
        const road = hit.address?.road ?? hit.display_name ?? '';
        if (!matchesQueriedStreet(cleanAddress, road)) {
          logger.debug(`Nominatim answered a different street for "${cleanAddress}": "${road}" — rejected`);
          return null;
        }
      }

      return { lat: parseFloat(hit.lat), lng: parseFloat(hit.lon) };
    } catch (error) {
      logger.warn(`Geocoding error for "${cleanAddress}": ${error}`);
      return null;
    }
  }

  /**
   * Geocode an address, with caching. Null means every resolver failed —
   * callers using their own last-resort placement MUST mark it approximate.
   */
  async geocode(address: string, region: GeocodeRegion): Promise<GeocodeResult | null> {
    // Check cache first
    const cached = await this.getCached(region, address);
    if (cached) {
      return { lat: cached.lat, lng: cached.lng, cached: true, approximate: cached.approximate === true };
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
      await this.setCached(region, address, cachedClean.lat, cachedClean.lng, cachedClean.approximate === true);
      return { lat: cachedClean.lat, lng: cachedClean.lng, cached: true, approximate: cachedClean.approximate === true };
    }

    const numbered = hasHouseNumber(cleanAddress);
    const intersection = isIntersection(cleanAddress);

    // 1. Census: exact house-number resolution.
    if (numbered && !intersection) {
      const hit = await this.censusGeocode(cleanAddress);
      if (hit && this.isNearRegion(hit.lat, hit.lng, region)) {
        await this.setCached(region, address, hit.lat, hit.lng, false);
        await this.setCached(region, cleanAddress, hit.lat, hit.lng, false);
        logger.debug(`Census geocoded "${cleanAddress}" -> ${hit.lat}, ${hit.lng}`);
        return { lat: hit.lat, lng: hit.lng, cached: false, approximate: false };
      }
    }

    // 2. Nominatim: intersections, bare streets, landmarks, Census misses.
    //    Street validation is skipped for intersections only.
    const hit = await this.nominatimGeocode(cleanAddress, !intersection);
    if (hit && this.isNearRegion(hit.lat, hit.lng, region)) {
      await this.setCached(region, address, hit.lat, hit.lng, false);
      await this.setCached(region, cleanAddress, hit.lat, hit.lng, false);
      logger.debug(`Geocoded "${cleanAddress}" -> ${hit.lat}, ${hit.lng}`);
      return { lat: hit.lat, lng: hit.lng, cached: false, approximate: false };
    }

    // 3. Street-centroid degrade: strip the house number. A pin on the
    //    right street beats a fabricated one blocks away.
    if (numbered && !intersection) {
      const streetOnly = cleanAddress.replace(/^\d+\s+/, '');
      const centroid = await this.nominatimGeocode(streetOnly, true);
      if (centroid && this.isNearRegion(centroid.lat, centroid.lng, region)) {
        await this.setCached(region, address, centroid.lat, centroid.lng, true);
        logger.debug(`Street-centroid geocoded "${cleanAddress}" -> ${centroid.lat}, ${centroid.lng} (approximate)`);
        return { lat: centroid.lat, lng: centroid.lng, cached: false, approximate: true };
      }
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
