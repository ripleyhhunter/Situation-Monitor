import { BaseFetcher } from './base.js';
import type { Camera } from '../types/index.js';
import logger from '../logger.js';

/**
 * VDOT 511 Virginia traffic cameras for the DC metro — fills the app's
 * Northern Virginia blind spot (Arlington highways, I-395/I-495/I-66,
 * GW Parkway approaches, Fairfax).
 *
 *   - Keyless internal endpoint of the public 511.vdot.virginia.gov map
 *     (Iteris SPA; same posture as the existing VDOT incident feeds).
 *     One GET returns all ~1,674 statewide cameras as GeoJSON-style
 *     features; ~460 are active inside this bbox.
 *   - Stills: each roster row's image_url points at a /thumbs/…​.flv.png
 *     path that 301s — stripping "/thumbs/" and ".flv" yields the direct
 *     snapshot (https://snapshot.vdotcameras.com/<id>.png), refreshed
 *     every ~40-60s. Browsers load it in <img>, so CORS is irrelevant.
 *   - Live video: https_url is a keyless Wowza HLS playlist with
 *     Access-Control-Allow-Origin: * — playable in-app via hls.js.
 */

const ROSTER_URL = 'https://511.vdot.virginia.gov/services/map/array/cameras';

// DC metro envelope: Quantico up to Great Falls, Loudoun edge to the
// Maryland line. Matches the sweep's verified 460-camera bbox.
const BOUNDS = { lamin: 38.60, lamax: 39.10, lomin: -77.60, lomax: -76.90 };

// Stable per process — the roster carries no per-camera timestamps, and
// re-stamping every poll would rebroadcast the whole fleet (PR #15).
const ROSTER_STAMP = new Date().toISOString();

export interface VdotCameraFeature {
  type?: string;
  properties?: {
    id?: string | number;
    description?: string | null;
    active?: boolean;
    image_url?: string | null;
    https_url?: string | null;
  };
  geometry?: { type?: string; coordinates?: number[] };
}

interface VdotCamerasResponse {
  data?: VdotCameraFeature[];
}

/** "/thumbs/FairfaxVideo1010.flv.png" → direct snapshot URL. Exported for tests. */
export function vdotSnapshotUrl(imageUrl: string | null | undefined): string | undefined {
  if (!imageUrl) return undefined;
  return imageUrl.replace('/thumbs/', '/').replace(/\.flv(?=\.png$)/i, '');
}

/** Normalize one roster feature (null = inactive/out-of-area/unusable). */
export function normalizeVdotCamera(feature: VdotCameraFeature): Camera | null {
  const props = feature.properties;
  if (!props || props.active !== true || props.id == null) return null;

  const coords = feature.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const [lng, lat] = coords;
  if (lat < BOUNDS.lamin || lat > BOUNDS.lamax || lng < BOUNDS.lomin || lng > BOUNDS.lomax) return null;

  return {
    id: `vdot-${props.id}`,
    regionId: 'dc',
    name: props.description?.trim() || `VDOT Camera ${props.id}`,
    location: { lat, lng },
    source: 'vdot',
    imageUrl: vdotSnapshotUrl(props.image_url),
    streamUrl: props.https_url || undefined,
    lastUpdated: ROSTER_STAMP,
  };
}

export class VdotCamerasFetcher extends BaseFetcher<Camera> {
  constructor() {
    // Roster membership changes rarely; images are fetched browser-side.
    super('vdot-cameras', 3600);
  }

  protected async fetchFromApi(): Promise<Camera[]> {
    const response = await this.httpGet<VdotCamerasResponse>(ROSTER_URL);
    if (!response || !Array.isArray(response.data)) {
      throw new Error('VDOT cameras: response has no data array — contract drift');
    }

    const cameras: Camera[] = [];
    for (const feature of response.data) {
      const camera = normalizeVdotCamera(feature);
      if (camera) cameras.push(camera);
    }

    if (response.data.length > 0 && cameras.length === 0) {
      // 460 active metro cameras existed when this shipped; zero parsed
      // from a non-empty statewide roster means the shape drifted.
      throw new Error(`VDOT cameras: parsed 0 of ${response.data.length} roster rows — schema drift`);
    }

    logger.debug(`VDOT cameras: ${cameras.length} DC-metro cameras (of ${response.data.length} statewide)`);
    return cameras;
  }
}

export const vdotCamerasFetcher = new VdotCamerasFetcher();
export default vdotCamerasFetcher;
