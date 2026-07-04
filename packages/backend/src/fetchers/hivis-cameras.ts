import { BaseFetcher } from './base.js';
import type { Camera, RegionId } from '../types/index.js';
import logger from '../logger.js';

/**
 * USGS HIVIS river-gauge webcams — live imagery AT the stream gauges the
 * app already monitors for flooding (NWS gauges layer). During high water
 * these show the actual river state, not just a number.
 *
 *   - Roster: the NIMS API behind apps.usgs.gov/hivis. Keyless (the SPA
 *     bundle embeds an x-api-key, but sending it returns 403 while
 *     keyless returns 200 — keyless IS the supported path), CORS *,
 *     ~1,250 cameras nationwide with S3 image directories.
 *   - Newest frame: {smallDir}{camId}_newest.jpg (~100KB 720p), updated
 *     every ~15 min per camera; the record's newestImageDT is a real
 *     feed timestamp, so lastUpdated is honest here (idaho511-style).
 *   - Region-agnostic: instantiated per region with a bbox, like the
 *     other shared fetchers.
 */

const ROSTER_URL = 'https://api.waterdata.usgs.gov/nims/v0/cameras?enabled=true';

export interface HivisCameraRow {
  camId?: string;
  nwisId?: string;
  camName?: string;
  lat?: string | number;
  lng?: string | number;
  hideCam?: boolean;
  newestImageDT?: string;
  smallDir?: string;
  overlayDir?: string;
}

interface HivisOptions {
  regionId: RegionId;
  bounds: { lamin: number; lamax: number; lomin: number; lomax: number };
}

/** Normalize one roster row for a region (null = hidden/out-of-area/unusable). */
export function normalizeHivisCamera(row: HivisCameraRow, options: HivisOptions): Camera | null {
  if (!row.camId || row.hideCam === true) return null;

  const lat = typeof row.lat === 'number' ? row.lat : parseFloat(row.lat ?? '');
  const lng = typeof row.lng === 'number' ? row.lng : parseFloat(row.lng ?? '');
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const { bounds } = options;
  if (lat < bounds.lamin || lat > bounds.lamax || lng < bounds.lomin || lng > bounds.lomax) return null;

  const dir = row.smallDir || row.overlayDir;
  if (!dir) return null;

  return {
    id: `hivis-${row.camId}`,
    regionId: options.regionId,
    name: row.camName?.trim() || `USGS gauge cam ${row.nwisId ?? row.camId}`,
    location: { lat, lng },
    source: 'hivis',
    imageUrl: `${dir}${row.camId}_newest.jpg`,
    // Real feed timestamp — advances as the camera uploads (~15 min).
    lastUpdated: row.newestImageDT || new Date(0).toISOString(),
  };
}

export class HivisCamerasFetcher extends BaseFetcher<Camera> {
  private readonly options: HivisOptions;

  constructor(options: HivisOptions) {
    // Region-scoped cache key: both regions poll the same nationwide
    // roster but must not share a cache entry (different bboxes).
    super(`hivis-cameras-${options.regionId}`, 3600);
    this.options = options;
  }

  protected async fetchFromApi(): Promise<Camera[]> {
    const rows = await this.httpGet<HivisCameraRow[]>(ROSTER_URL);
    if (!Array.isArray(rows)) {
      throw new Error('HIVIS cameras: response is not an array — contract drift');
    }
    if (rows.length === 0) {
      // ~1,250 cameras nationwide — an empty roster is drift, not reality.
      throw new Error('HIVIS cameras: roster came back empty — contract drift');
    }

    const cameras: Camera[] = [];
    for (const row of rows) {
      const camera = normalizeHivisCamera(row, this.options);
      if (camera) cameras.push(camera);
    }

    // Zero in-bbox is legitimate for some regions — don't throw on it.
    logger.debug(`HIVIS cameras (${this.options.regionId}): ${cameras.length} gauge cams (of ${rows.length} nationwide)`);
    return cameras;
  }
}

export default HivisCamerasFetcher;
