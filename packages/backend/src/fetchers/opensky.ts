import { BaseFetcher } from './base.js';
import type { Aircraft, AircraftCategory, AircraftMetadata } from '../types/index.js';
import { cache } from '../services/cache.js';
import config from '../config.js';
import logger from '../logger.js';

// DC metro area bounding box
// Covers DCA (Reagan), IAD (Dulles), BWI, and surrounding area
const DC_BOUNDS = {
  lamin: 38.6,   // South of Alexandria
  lamax: 39.3,   // North to cover BWI
  lomin: -77.6,  // West of Dulles
  lomax: -76.6,  // East past Annapolis
};

// OAuth2 token cache
let cachedToken: string | null = null;
let tokenExpiry: number = 0;

// In-memory metadata cache (also persisted to Redis)
const metadataCache = new Map<string, AircraftMetadata>();
const METADATA_CACHE_KEY = 'aircraft:metadata';
const METADATA_CACHE_TTL = 30 * 24 * 60 * 60; // 30 days

// Track pending metadata fetches to avoid duplicates
const pendingFetches = new Set<string>();

// Rate limit metadata fetches (max 2 per second to be safe)
let lastMetadataFetch = 0;
const METADATA_FETCH_INTERVAL = 500; // ms

// OpenSky API returns arrays, not objects
// Index mapping for the state array
const IDX = {
  ICAO24: 0,
  CALLSIGN: 1,
  ORIGIN_COUNTRY: 2,
  TIME_POSITION: 3,
  LAST_CONTACT: 4,
  LONGITUDE: 5,
  LATITUDE: 6,
  BARO_ALTITUDE: 7,
  ON_GROUND: 8,
  VELOCITY: 9,
  TRUE_TRACK: 10,
  VERTICAL_RATE: 11,
  SENSORS: 12,
  GEO_ALTITUDE: 13,
  SQUAWK: 14,
  SPI: 15,
  POSITION_SOURCE: 16,
} as const;

type OpenSkyState = [
  string,         // 0: icao24
  string | null,  // 1: callsign
  string,         // 2: origin_country
  number | null,  // 3: time_position
  number,         // 4: last_contact
  number | null,  // 5: longitude
  number | null,  // 6: latitude
  number | null,  // 7: baro_altitude (meters)
  boolean,        // 8: on_ground
  number | null,  // 9: velocity (m/s)
  number | null,  // 10: true_track (degrees)
  number | null,  // 11: vertical_rate (m/s)
  number[],       // 12: sensors
  number | null,  // 13: geo_altitude (meters)
  string | null,  // 14: squawk
  boolean,        // 15: spi
  number,         // 16: position_source
];

interface OpenSkyResponse {
  time: number;
  states: OpenSkyState[] | null;
}

export class OpenSkyFetcher extends BaseFetcher<Aircraft> {
  private metadataInitialized = false;

  constructor() {
    super('opensky', config.cacheTtl.aircraft);
  }

  /**
   * Load cached metadata from Redis on startup
   */
  private async initializeMetadataCache(): Promise<void> {
    if (this.metadataInitialized) return;
    
    try {
      const cached = await cache.get<Record<string, AircraftMetadata>>(METADATA_CACHE_KEY);
      if (cached) {
        for (const [icao24, metadata] of Object.entries(cached)) {
          metadataCache.set(icao24, metadata);
        }
        logger.info(`Loaded ${metadataCache.size} aircraft metadata entries from cache`);
      }
    } catch (error) {
      logger.warn('Failed to load aircraft metadata cache', { error });
    }
    this.metadataInitialized = true;
  }

  /**
   * Save metadata cache to Redis
   */
  private async persistMetadataCache(): Promise<void> {
    try {
      const data: Record<string, AircraftMetadata> = {};
      for (const [icao24, metadata] of metadataCache) {
        data[icao24] = metadata;
      }
      await cache.set(METADATA_CACHE_KEY, data, METADATA_CACHE_TTL);
    } catch (error) {
      logger.warn('Failed to persist aircraft metadata cache', { error });
    }
  }

  /**
   * Fetch metadata for a single aircraft from OpenSky
   */
  private async fetchMetadata(icao24: string): Promise<AircraftMetadata | null> {
    // Check cache first
    if (metadataCache.has(icao24)) {
      return metadataCache.get(icao24)!;
    }

    // Skip if already fetching
    if (pendingFetches.has(icao24)) {
      return null;
    }

    // Rate limit
    const now = Date.now();
    if (now - lastMetadataFetch < METADATA_FETCH_INTERVAL) {
      return null;
    }

    pendingFetches.add(icao24);
    lastMetadataFetch = now;

    try {
      const url = `https://opensky-network.org/api/metadata/aircraft/icao/${icao24}`;
      const headers: Record<string, string> = {
        'User-Agent': 'SituationMonitor/1.0',
      };

      // Use OAuth2 token if available
      const token = await this.getAccessToken();
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(url, { headers });
      
      if (!response.ok) {
        if (response.status === 404) {
          // Aircraft not in database - cache empty metadata to avoid re-fetching
          const emptyMetadata: AircraftMetadata = {};
          metadataCache.set(icao24, emptyMetadata);
          return emptyMetadata;
        }
        return null;
      }

      const data = await response.json() as {
        registration?: string;
        manufacturerName?: string;
        model?: string;
        typecode?: string;
        operator?: string;
        owner?: string;
        built?: string;
        categoryDescription?: string;
      };

      const metadata: AircraftMetadata = {
        registration: data.registration || undefined,
        manufacturer: data.manufacturerName || undefined,
        model: data.model || undefined,
        typecode: data.typecode || undefined,
        operator: data.operator || undefined,
        owner: data.owner || undefined,
        built: data.built || undefined,
        categoryDescription: data.categoryDescription || undefined,
      };

      metadataCache.set(icao24, metadata);
      
      // Persist periodically (every 10 new entries)
      if (metadataCache.size % 10 === 0) {
        this.persistMetadataCache().catch(() => {});
      }

      logger.debug(`Fetched metadata for ${icao24}`, { 
        registration: metadata.registration,
        model: metadata.model,
        operator: metadata.operator 
      });

      return metadata;
    } catch (error) {
      logger.debug(`Failed to fetch metadata for ${icao24}`, { error });
      return null;
    } finally {
      pendingFetches.delete(icao24);
    }
  }

  /**
   * Get OAuth2 access token using client credentials flow
   */
  private async getAccessToken(): Promise<string | null> {
    if (!config.openskyClientId || !config.openskyClientSecret) {
      return null;
    }

    // Return cached token if still valid (with 60s buffer)
    if (cachedToken && Date.now() < tokenExpiry - 60000) {
      return cachedToken;
    }

    try {
      const tokenUrl = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';
      
      const body = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: config.openskyClientId,
        client_secret: config.openskyClientSecret,
      });

      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });

      if (!response.ok) {
        logger.warn('OpenSky OAuth2 token request failed', { 
          status: response.status,
          statusText: response.statusText 
        });
        return null;
      }

      const data = await response.json() as { access_token: string; expires_in: number };
      
      cachedToken = data.access_token;
      // Token typically expires in 300 seconds (5 minutes)
      tokenExpiry = Date.now() + (data.expires_in * 1000);
      
      logger.debug('OpenSky OAuth2 token obtained', { expiresIn: data.expires_in });
      return cachedToken;
    } catch (error) {
      logger.warn('Failed to get OpenSky OAuth2 token', { error });
      return null;
    }
  }

  protected async fetchFromApi(): Promise<Aircraft[]> {
    // Initialize metadata cache on first run
    await this.initializeMetadataCache();

    const params = new URLSearchParams({
      lamin: DC_BOUNDS.lamin.toString(),
      lamax: DC_BOUNDS.lamax.toString(),
      lomin: DC_BOUNDS.lomin.toString(),
      lomax: DC_BOUNDS.lomax.toString(),
    });

    const url = `https://opensky-network.org/api/states/all?${params}`;

    const headers: Record<string, string> = {
      'User-Agent': 'SituationMonitor/1.0 (DC Area Monitoring Dashboard)',
    };

    // Try OAuth2 authentication
    const token = await this.getAccessToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
      logger.debug('OpenSky using OAuth2 authenticated request');
    }

    try {
      const response = await this.httpGet<OpenSkyResponse>(url, { headers });

      if (!response.states || !Array.isArray(response.states)) {
        logger.debug('OpenSky returned no aircraft in DC area');
        return [];
      }

      // Normalize all aircraft
      const aircraft = response.states
        .filter((state) => {
          const lon = state[IDX.LONGITUDE];
          const lat = state[IDX.LATITUDE];
          return lon !== null && lat !== null;
        })
        .map((state) => this.normalizeAircraft(state));

      // Fetch metadata for aircraft we haven't seen before (limited rate)
      const unknownAircraft = aircraft.filter(a => !metadataCache.has(a.icao24));
      if (unknownAircraft.length > 0) {
        // Fetch metadata for up to 2 new aircraft per cycle
        const toFetch = unknownAircraft.slice(0, 2);
        for (const plane of toFetch) {
          const metadata = await this.fetchMetadata(plane.icao24);
          if (metadata) {
            plane.metadata = metadata;
            // Update category based on metadata
            plane.category = this.detectCategoryFromMetadata(metadata, plane.callsign, plane.speed, plane.location.altitude);
          }
        }
      }

      // Apply cached metadata to all aircraft
      for (const plane of aircraft) {
        const cached = metadataCache.get(plane.icao24);
        if (cached && Object.keys(cached).length > 0) {
          plane.metadata = cached;
          plane.category = this.detectCategoryFromMetadata(cached, plane.callsign, plane.speed, plane.location.altitude);
        }
      }

      const helicopters = aircraft.filter(a => a.category === 'helicopter');
      logger.info(`OpenSky: ${aircraft.length} aircraft in DC area`, {
        inAir: aircraft.filter((a) => !a.onGround).length,
        onGround: aircraft.filter((a) => a.onGround).length,
        helicopters: helicopters.length,
        emergencies: aircraft.filter((a) => a.isEmergency).length,
      });

      return aircraft;
    } catch (error) {
      if (error instanceof Error && error.message.includes('429')) {
        logger.warn('OpenSky rate limit hit, will retry next interval');
        return [];
      }
      logger.error('Failed to fetch OpenSky data', { error });
      throw error;
    }
  }

  private normalizeAircraft(state: OpenSkyState): Aircraft {
    const icao24 = state[IDX.ICAO24];
    const callsign = (state[IDX.CALLSIGN] || '').trim();
    const squawk = state[IDX.SQUAWK];

    // Get altitude - prefer barometric, fall back to geometric
    const altitudeMeters = state[IDX.BARO_ALTITUDE] ?? state[IDX.GEO_ALTITUDE] ?? 0;
    const altitudeFeet = Math.round(altitudeMeters * 3.28084);

    // Convert velocity from m/s to knots
    const speedMs = state[IDX.VELOCITY] ?? 0;
    const speedKnots = Math.round(speedMs * 1.94384);

    // Convert vertical rate from m/s to ft/min
    const verticalRateMs = state[IDX.VERTICAL_RATE] ?? 0;
    const verticalRateFpm = Math.round(verticalRateMs * 196.85);

    // Get timestamp
    const timestamp = state[IDX.TIME_POSITION] ?? state[IDX.LAST_CONTACT];

    return {
      id: `aircraft-${icao24}`,
      icao24,
      callsign: callsign || icao24.toUpperCase(),
      location: {
        lat: state[IDX.LATITUDE]!,
        lng: state[IDX.LONGITUDE]!,
        altitude: altitudeFeet,
        altitudeMeters,
      },
      heading: state[IDX.TRUE_TRACK] ?? 0,
      speed: speedKnots,
      verticalRate: verticalRateFpm,
      onGround: state[IDX.ON_GROUND],
      squawk,
      origin: state[IDX.ORIGIN_COUNTRY],
      category: this.detectCategory(callsign, speedKnots, altitudeFeet),
      isEmergency: this.isEmergencySquawk(squawk),
      timestamp: new Date(timestamp * 1000).toISOString(),
    };
  }

  /**
   * Detect aircraft category from metadata (most accurate)
   */
  private detectCategoryFromMetadata(
    metadata: AircraftMetadata,
    callsign: string,
    speed: number,
    altitude: number
  ): AircraftCategory {
    // Check categoryDescription first (most reliable)
    const catDesc = (metadata.categoryDescription || '').toLowerCase();
    if (catDesc.includes('rotorcraft') || catDesc.includes('helicopter')) {
      return 'helicopter';
    }

    // Check typecode for helicopter patterns
    const typecode = (metadata.typecode || '').toUpperCase();
    const helicopterTypecodes = [
      'R22', 'R44', 'R66',           // Robinson
      'EC20', 'EC25', 'EC30', 'EC35', 'EC45', 'EC55', 'EC75', // Eurocopter/Airbus Helicopters
      'H125', 'H130', 'H135', 'H145', 'H155', 'H160', 'H175', 'H215', 'H225', // Airbus H-series
      'AS50', 'AS55', 'AS65', 'AS32', 'AS33', 'AS35', 'AS55', // Eurocopter AS series
      'B06', 'B105', 'B117', 'B212', 'B222', 'B230', 'B412', 'B429', 'B430', 'B505', 'B525', // Bell
      'S76', 'S92', 'S70', 'S61', 'S64', 'S58', // Sikorsky
      'MD52', 'MD50', 'MD60', 'MD90', 'EXPL', // MD Helicopters
      'A109', 'A119', 'A139', 'A169', 'A189', 'AW09', 'AW39', 'AW69', 'AW89', // Leonardo/AgustaWestland
      'UH1', 'UH60', 'AH64', 'CH47', 'CH53', 'MH60', 'HH60', // Military helicopters
      'B407', 'B206', 'B204', // Bell continued
    ];
    if (helicopterTypecodes.some(t => typecode.startsWith(t) || typecode === t)) {
      return 'helicopter';
    }

    // Check manufacturer for helicopter makers
    const manufacturer = (metadata.manufacturer || '').toLowerCase();
    const helicopterManufacturers = [
      'robinson', 'bell', 'sikorsky', 'eurocopter', 'airbus helicopters',
      'md helicopters', 'leonardo', 'agusta', 'westland', 'boeing rotorcraft',
      'enstrom', 'schweizer', 'kaman',
    ];
    if (helicopterManufacturers.some(m => manufacturer.includes(m))) {
      return 'helicopter';
    }

    // Check model name for helicopter keywords
    const model = (metadata.model || '').toLowerCase();
    if (model.includes('helicopter') || model.includes('heli') || 
        model.includes('rotorcraft') || model.includes('copter')) {
      return 'helicopter';
    }

    // Check operator for known helicopter operators
    const operator = (metadata.operator || '').toLowerCase();
    const helicopterOperators = [
      'police', 'medevac', 'air ambulance', 'life flight', 'medstar',
      'news', 'traffic', 'park police', 'customs', 'border patrol',
      'coast guard', 'sheriff', 'fire department', 'ems',
    ];
    if (helicopterOperators.some(op => operator.includes(op))) {
      // These operators often use helicopters, but verify with other signals
      if (speed < 180 || altitude < 5000) {
        return 'helicopter';
      }
    }

    // Fall back to original detection logic
    return this.detectCategory(callsign, speed, altitude);
  }

  /**
   * Fallback category detection based on callsign and behavior
   */
  private detectCategory(
    callsign: string,
    speed: number,
    altitude: number
  ): AircraftCategory {
    // Commercial airline patterns (3-letter ICAO code + flight number)
    const commercialPattern = /^[A-Z]{3}\d{1,4}[A-Z]?$/;
    if (commercialPattern.test(callsign)) {
      return 'commercial';
    }

    // US military callsigns and patterns
    const militaryPatterns = [
      /^RCH/i,     // Reach (military cargo)
      /^DUKE/i,   // Duke
      /^EVAC/i,   // Medevac
      /^SAM/i,    // Special Air Mission
      /^EXEC/i,   // Executive flight
      /^AF[12]/i, // Air Force One/Two
      /^NAVY/i,   // Navy
      /^ARMY/i,   // Army
      /^COAST/i,  // Coast Guard
      /^CG\d/i,   // Coast Guard
      /^PAT\d/i,  // Patrol
      /^TOPCAT/i, // Various military
      /^REACH/i,  // Military airlift
      /^VOLT/i,   // Military
    ];
    if (militaryPatterns.some((p) => p.test(callsign))) {
      return 'military';
    }

    // N-numbers (US general aviation registration)
    if (/^N\d/.test(callsign)) {
      return 'general';
    }

    // Behavioral helicopter detection (fallback)
    // Low speed + low altitude, not on approach to airports
    if (speed < 100 && altitude > 0 && altitude < 2500) {
      return 'helicopter';
    }

    return 'unknown';
  }

  private isEmergencySquawk(squawk: string | null): boolean {
    if (!squawk) return false;
    // 7500 = Hijacking
    // 7600 = Radio failure
    // 7700 = General emergency
    return squawk === '7500' || squawk === '7600' || squawk === '7700';
  }
}

export const openskyFetcher = new OpenSkyFetcher();
export default openskyFetcher;
