import { BaseFetcher } from './base.js';
import type { Incident, RegionId } from '../types/index.js';
import logger from '../logger.js';

/**
 * USGS earthquakes near a region, via the FDSN event query API.
 *
 *   - Keyless GeoJSON; the feed regenerates every 60s and events appear
 *     ~10 minutes after origin time.
 *   - Point-radius query per region with a rolling 7-day window. The
 *     window MUST match this source's expirationMs in
 *     aggregator.cleanupStaleIncidents ('usgs-quake': 7 days) or events
 *     clear/re-add in a loop.
 *   - Frequency reality (verified): Boise's 200 km radius sees ~9 events
 *     per 30 days; DC's ~1 — an empty layer in DC is correct, not broken.
 */

const FDSN_URL = 'https://earthquake.usgs.gov/fdsnws/event/1/query';
const RADIUS_KM = 200;
export const QUAKE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

interface QuakeFeature {
  id?: string;
  properties?: {
    mag?: number | null;
    place?: string | null;
    /** Origin time, epoch ms. */
    time?: number | null;
    /** Last revision time, epoch ms. */
    updated?: number | null;
    type?: string | null;
  };
  geometry?: { coordinates?: number[] } | null;
}

interface QuakeResponse {
  type?: string;
  features?: QuakeFeature[];
}

export function quakeSeverity(mag: number): 1 | 2 | 3 | 4 | 5 {
  if (mag >= 5) return 5;
  if (mag >= 4) return 4;
  if (mag >= 3) return 3;
  if (mag >= 2) return 2;
  return 1;
}

/** Normalize one FDSN feature. Exported for tests. */
export function normalizeQuakeFeature(feature: QuakeFeature, regionId: RegionId): Incident | null {
  const props = feature.properties ?? {};
  const coords = feature.geometry?.coordinates;
  if (!feature.id || !coords || coords.length < 2) return null;
  if (typeof props.time !== 'number' || typeof props.updated !== 'number') return null;
  const mag = typeof props.mag === 'number' ? props.mag : 0;

  return {
    id: `usgs-quake-${feature.id}`,
    regionId,
    type: 'hazard',
    severity: quakeSeverity(mag),
    location: {
      lat: coords[1],
      lng: coords[0],
      address: props.place || undefined,
    },
    timestamp: new Date(props.time).toISOString(),
    // USGS revises magnitude/location after review — 'updated' is the
    // feed's own revision time (never wall-clock now).
    updatedAt: new Date(props.updated).toISOString(),
    source: 'usgs-quake',
    title: `M${mag.toFixed(1)} Earthquake${props.place ? ` — ${props.place}` : ''}`,
    description: [
      `Magnitude ${mag.toFixed(1)}`,
      coords.length > 2 && typeof coords[2] === 'number' ? `Depth: ${coords[2].toFixed(1)} km` : null,
    ]
      .filter(Boolean)
      .join('\n'),
    status: 'active',
    category: 'earthquake',
    metadata: {
      magnitude: mag,
      depthKm: coords[2],
    },
  };
}

export interface UsgsQuakesFetcherOptions {
  regionId: RegionId;
  lat: number;
  lng: number;
}

export class UsgsQuakesFetcher extends BaseFetcher<Incident> {
  private regionId: RegionId;
  private lat: number;
  private lng: number;

  constructor(options: UsgsQuakesFetcherOptions) {
    // Events surface ~10 min after origin; a 10-min cache on the 2-min
    // cron keeps polls polite without missing anything meaningful.
    super(`usgs-quakes-${options.regionId}`, 600);
    this.regionId = options.regionId;
    this.lat = options.lat;
    this.lng = options.lng;
  }

  protected async fetchFromApi(): Promise<Incident[]> {
    const starttime = new Date(Date.now() - QUAKE_WINDOW_MS).toISOString();
    const params = new URLSearchParams({
      format: 'geojson',
      latitude: String(this.lat),
      longitude: String(this.lng),
      maxradiuskm: String(RADIUS_KM),
      starttime,
      eventtype: 'earthquake',
      orderby: 'time',
    });

    const response = await this.httpGet<QuakeResponse>(`${FDSN_URL}?${params.toString()}`);

    if (!response.features || !Array.isArray(response.features)) {
      throw new Error('USGS FDSN: unexpected response shape (no features array)');
    }

    const incidents: Incident[] = [];
    for (const feature of response.features) {
      const incident = normalizeQuakeFeature(feature, this.regionId);
      if (incident) incidents.push(incident);
    }

    logger.debug(`USGS quakes (${this.regionId}): ${incidents.length} events in ${RADIUS_KM}km/7d`);
    return incidents;
  }
}
