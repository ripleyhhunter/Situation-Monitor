import { BaseFetcher } from './base.js';
import type { Camera } from '../types/index.js';
import logger from '../logger.js';

/**
 * Arlington County ITS traffic cameras — the county's own dense
 * surface-street network (289 sites), distinct from VDOT's highway CCTV.
 *
 *   - Roster: Arlington's public ArcGIS Open_Data folder. Attributes carry
 *     Latitude/Longitude plus the authoritative per-camera HLS URL —
 *     Wowza ports vary per camera (:8011/:8012/…), so the URL field must
 *     be used verbatim, never reconstructed.
 *   - Streams are keyless Wowza HLS with Access-Control-Allow-Origin: *,
 *     playable in-app via hls.js. No stills exist — stream-only source.
 *   - Known data wart: one roster row has a sign-flipped longitude
 *     (+77.1…); positive longitudes are dropped rather than guessed.
 */

const ROSTER_URL =
  'https://arlgis.arlingtonva.us/arcgis/rest/services/Open_Data/od_Traffic_Camera_Points/FeatureServer/0/query' +
  '?where=1%3D1&outFields=*&returnGeometry=false&f=json';

const ROSTER_STAMP = new Date().toISOString();

export interface ArlingtonCameraRow {
  attributes?: {
    Camera_Sit?: string | null;
    Camera_Enc?: string | null;
    Latitude?: number | null;
    Longitude?: number | null;
    Status?: string | null;
    URL?: string | null;
  };
}

interface ArlingtonResponse {
  features?: ArlingtonCameraRow[];
  exceededTransferLimit?: boolean;
}

/** Normalize one roster row (null = offline/missing fields/bad coords). */
export function normalizeArlingtonCamera(row: ArlingtonCameraRow): Camera | null {
  const a = row.attributes;
  if (!a || a.Status !== 'ONLINE' || !a.Camera_Sit || !a.URL) return null;

  const lat = a.Latitude;
  const lng = a.Longitude;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  // Sign-flipped-longitude data wart: DC-area longitudes are negative.
  if (lng >= 0) return null;

  return {
    id: `arlington-${a.Camera_Sit}`,
    regionId: 'dc',
    name: a.Camera_Enc?.trim() || a.Camera_Sit,
    location: { lat, lng },
    source: 'arlington',
    streamUrl: a.URL,
    lastUpdated: ROSTER_STAMP,
  };
}

export class ArlingtonCamerasFetcher extends BaseFetcher<Camera> {
  constructor() {
    super('arlington-cameras', 3600);
  }

  protected async fetchFromApi(): Promise<Camera[]> {
    const response = await this.httpGet<ArlingtonResponse>(ROSTER_URL);
    if (!response || !Array.isArray(response.features)) {
      throw new Error('Arlington cameras: response has no features array — contract drift');
    }
    if (response.exceededTransferLimit) {
      // 289 rows fit one page today; silent truncation must be loud.
      throw new Error('Arlington cameras: roster exceeded transfer limit — pagination now required');
    }

    const cameras: Camera[] = [];
    for (const row of response.features) {
      const camera = normalizeArlingtonCamera(row);
      if (camera) cameras.push(camera);
    }

    if (response.features.length > 0 && cameras.length === 0) {
      throw new Error(`Arlington cameras: parsed 0 of ${response.features.length} rows — schema drift`);
    }

    logger.debug(`Arlington cameras: ${cameras.length} online county cameras`);
    return cameras;
  }
}

export const arlingtonCamerasFetcher = new ArlingtonCamerasFetcher();
export default arlingtonCamerasFetcher;
