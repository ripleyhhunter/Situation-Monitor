import { BaseFetcher } from './base.js';
import type { Camera } from '../types/index.js';
import logger from '../logger.js';

/**
 * Prince George's County DPW&T TRIP traffic cameras — the county's own
 * cameras (camNNN feeds on skyvdn Wowza, keyless HLS with CORS *).
 *
 *   - Roster: the pgctrip.com 511x/CARS backend, keyless GeoJSON.
 *   - The roster mixes county-owned cameras with CHARTFeed relays that
 *     duplicate the existing MD CHART source — relays are dropped here
 *     so nothing double-plots.
 *   - views[0].broken marks dead feeds; videoPreviewUrl is a static
 *     placeholder, not a still — this is a stream-only source.
 */

const ROSTER_URL = 'https://api-511x-pgc.carsprogram.org/cameras/map-features';

// Prince George's County sits EAST of the district — its own envelope,
// not the NoVA one (Marlboro Pike is at -76.87).
const BOUNDS = { lamin: 38.50, lamax: 39.15, lomin: -77.10, lomax: -76.60 };

const ROSTER_STAMP = new Date().toISOString();

export interface PgcCameraFeature {
  id?: string | number;
  properties?: {
    id?: string | number;
    name?: string | null;
    cameraOwner?: string | null;
    views?: Array<{ url?: string | null; broken?: boolean }>;
  };
  geometry?: { coordinates?: number[] };
}

interface PgcResponse {
  features?: PgcCameraFeature[];
}

/** Normalize one feature (null = relay/broken/out-of-area/unusable). */
export function normalizePgcCamera(feature: PgcCameraFeature): Camera | null {
  const props = feature.properties;
  const id = feature.id ?? props?.id;
  if (!props || id == null) return null;

  const view = props.views?.[0];
  if (!view?.url || view.broken === true) return null;
  // CHARTFeed relays duplicate the existing MD CHART camera source.
  if (/CHARTFeed/i.test(view.url)) return null;

  const coords = feature.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const [lng, lat] = coords;
  if (lat < BOUNDS.lamin || lat > BOUNDS.lamax || lng < BOUNDS.lomin || lng > BOUNDS.lomax) return null;

  return {
    id: `pgc-${id}`,
    regionId: 'dc',
    name: props.name?.trim() || `PG County Camera ${id}`,
    location: { lat, lng },
    source: 'pgc',
    streamUrl: view.url,
    lastUpdated: ROSTER_STAMP,
  };
}

export class PgcCamerasFetcher extends BaseFetcher<Camera> {
  constructor() {
    super('pgc-cameras', 3600);
  }

  protected async fetchFromApi(): Promise<Camera[]> {
    const response = await this.httpGet<PgcResponse>(ROSTER_URL);
    if (!response || !Array.isArray(response.features)) {
      throw new Error('PG County cameras: response has no features array — contract drift');
    }

    const cameras: Camera[] = [];
    for (const feature of response.features) {
      const camera = normalizePgcCamera(feature);
      if (camera) cameras.push(camera);
    }

    // Zero normalized is possible legitimately (the county fleet is small
    // and broken flags fluctuate; CHART relays are always dropped), so no
    // parsed-zero throw here — shape drift is caught by the guards above,
    // and cameras have no cross-clear semantics that [] could corrupt.
    logger.debug(`PG County cameras: ${cameras.length} county cameras (of ${response.features.length} roster rows)`);
    return cameras;
  }
}

export const pgcCamerasFetcher = new PgcCamerasFetcher();
export default pgcCamerasFetcher;
