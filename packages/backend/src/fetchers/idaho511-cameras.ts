import { BaseFetcher } from './base.js';
import type { Camera } from '../types/index.js';
import logger from '../logger.js';

/**
 * Idaho 511 (ITD + partner agencies) traffic cameras for the Treasure
 * Valley — ITD freeway cams (~60s refresh) plus the dense Boise/ACHD
 * intersection-camera grid (~15s refresh).
 *
 *   - Keyless internal endpoints of the public 511.idaho.gov map (the same
 *     posture as the existing /api/wzdx feed). The documented ITD API needs
 *     a key; these do not. Parse defensively and throw on drift — the
 *     platform can change shape without notice.
 *   - The roster endpoint is DataTables-style: it must be POSTed
 *     form-encoded (GET silently returns empty) and caps pages at 100 rows,
 *     so the 457-site roster takes 5 requests. It changes rarely — the
 *     fetcher caches it for 6 hours.
 *   - Camera images are served through /map/Cctv/{imageId} with open CORS
 *     and short cache headers; the browser loads them on demand from the
 *     camera modal, so the backend never polls image bytes.
 */

const LIST_URL = 'https://511.idaho.gov/List/GetData/Cameras';
const IMAGE_BASE = 'https://511.idaho.gov';

const PAGE_SIZE = 100; // server-enforced cap
const MAX_PAGES = 10;

// Treasure Valley — matches the region's other bbox filters.
const BOUNDS = { lamin: 43.40, lamax: 43.95, lomin: -116.80, lomax: -115.85 };

interface Idaho511Image {
  id?: number;
  imageUrl?: string;
  refreshRateMs?: number;
  disabled?: boolean;
  blocked?: boolean;
  videoDisabled?: boolean;
}

export interface Idaho511Site {
  id?: number;
  visible?: boolean;
  roadway?: string | null;
  direction?: string | null;
  location?: string | null;
  source?: string | null;
  images?: Idaho511Image[];
  latLng?: { geography?: { wellKnownText?: string } };
  lastUpdated?: string | null;
  created?: string | null;
}

interface Idaho511ListResponse {
  recordsTotal?: number;
  data?: Idaho511Site[];
}

/** Parse "POINT (-116.198 43.6011)" → [lng, lat]. Exported for tests. */
export function parseWktPoint(wkt: string | undefined): [number, number] | null {
  if (!wkt) return null;
  const match = /POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)/i.exec(wkt);
  if (!match) return null;
  return [parseFloat(match[1]), parseFloat(match[2])];
}

/** Normalize one roster site to a Camera (null = unusable/out of area). */
export function normalizeIdaho511Site(site: Idaho511Site): Camera | null {
  if (site.visible === false || typeof site.id !== 'number') return null;

  const point = parseWktPoint(site.latLng?.geography?.wellKnownText);
  if (!point) return null;
  const [lng, lat] = point;
  if (lat < BOUNDS.lamin || lat > BOUNDS.lamax || lng < BOUNDS.lomin || lng > BOUNDS.lomax) return null;

  const image = (site.images ?? []).find(
    (img) => img.imageUrl && !img.disabled && !img.blocked
  );
  if (!image?.imageUrl) return null;

  const name = site.location?.trim() || [site.roadway, site.direction].filter(Boolean).join(' ') || `Camera ${site.id}`;

  return {
    id: `idaho511-${site.id}`,
    regionId: 'boise',
    name,
    location: { lat, lng },
    source: 'idaho511',
    imageUrl: `${IMAGE_BASE}${image.imageUrl}`,
    // From the roster's own edit timestamp (near-static), never wall-clock
    // now — the aggregator rebroadcasts cameras whenever lastUpdated moves.
    lastUpdated: site.lastUpdated || site.created || new Date(0).toISOString(),
  };
}

export class Idaho511CamerasFetcher extends BaseFetcher<Camera> {
  constructor() {
    // The roster is near-static; 6h cache keeps the 5-request pagination
    // sweep rare while the 5-min camera cron serves from cache.
    super('idaho511-cameras', 6 * 3600);
  }

  protected async fetchFromApi(): Promise<Camera[]> {
    const sites: Idaho511Site[] = [];
    let total = Infinity;

    for (let page = 0; page < MAX_PAGES && page * PAGE_SIZE < total; page++) {
      const response = await this.httpPostForm<Idaho511ListResponse>(LIST_URL, {
        draw: '1',
        start: String(page * PAGE_SIZE),
        length: String(PAGE_SIZE),
      });

      if (!response.data || !Array.isArray(response.data)) {
        // GET or a platform change silently yields no data[] — that's
        // drift, not an empty camera network.
        throw new Error('Idaho 511 cameras: unexpected response shape (no data array)');
      }
      if (typeof response.recordsTotal === 'number') total = response.recordsTotal;
      sites.push(...response.data);
      if (response.data.length < PAGE_SIZE) break;
    }

    if (sites.length === 0) {
      throw new Error('Idaho 511 cameras: roster came back empty — treating as contract drift');
    }
    if (Number.isFinite(total) && sites.length < total) {
      // Truncation would silently drop cameras depending on server order.
      throw new Error(`Idaho 511 cameras: fetched ${sites.length} of ${total} roster rows — pagination truncated`);
    }

    const cameras: Camera[] = [];
    for (const site of sites) {
      const camera = normalizeIdaho511Site(site);
      if (camera) cameras.push(camera);
    }

    if (cameras.length === 0) {
      // 234 Treasure Valley sites existed when this shipped; zero after a
      // successful roster fetch means the parse (WKT/images) drifted.
      throw new Error(`Idaho 511 cameras: parsed 0 of ${sites.length} sites — schema drift`);
    }

    logger.debug(`Idaho 511: ${cameras.length} Treasure Valley cameras (of ${sites.length} statewide)`);
    return cameras;
  }
}

export const idaho511CamerasFetcher = new Idaho511CamerasFetcher();
export default idaho511CamerasFetcher;
