import { BaseFetcher } from './base.js';
import type { Camera } from '../types/index.js';
import logger from '../logger.js';

/**
 * WeatherBug DMV camera network — ~30 hotel/school/landmark cameras with
 * genuinely fresh stills (AXIS cams, ~5-15 min cadence), the only keyless
 * still-imagery network left covering DC proper after DDOT killed its
 * public viewer.
 *
 *   - Roster: any weather-camera page server-renders an escaped-JSON
 *     cameraList of the ~30 regional cameras with ids and coordinates
 *     (same page-scrape posture as the Idaho 511 internal endpoints).
 *   - Stills: the STABLE per-camera URL wwc.instacam.com/instacamimg/
 *     {ID}/{ID}_l.jpg serves the newest frame (verified minutes-old) —
 *     no timestamp scraping needed, loads straight into <img>.
 *   - This replaces the three old hand-curated WeatherBug landmark
 *     entries (MOWDC/WJLAW/NTNLH), which shipped no imageUrl at all.
 */

const ROSTER_PAGE = 'https://www.weatherbug.com/weather-camera/washington-dc-20001/MOWDC';
const STILL_BASE = 'https://wwc.instacam.com/instacamimg';

// DMV envelope — the roster also carries a far-south Charles County MD
// cluster that would just be map clutter.
const BOUNDS = { lamin: 38.55, lamax: 39.20, lomin: -77.60, lomax: -76.60 };

const ROSTER_STAMP = new Date().toISOString();

export interface WeatherBugCamera {
  id?: string;
  name?: string;
  city?: string;
  state?: string;
  lat?: number;
  lng?: number;
}

/**
 * Extract the embedded cameraList array from a weather-camera page.
 * The page is Next.js flight data: JSON escaped inside a string, so
 * unescape first, then bracket-scan the array (camera objects are flat —
 * no nested arrays). Exported for tests. Throws on drift.
 */
export function extractCameraList(html: string): WeatherBugCamera[] {
  const unescaped = html.replace(/\\"/g, '"');
  const key = '"cameraList":';
  const keyIdx = unescaped.indexOf(key);
  if (keyIdx === -1) {
    throw new Error('WeatherBug cameras: page no longer embeds cameraList — contract drift');
  }
  const start = unescaped.indexOf('[', keyIdx);
  if (start === -1) {
    throw new Error('WeatherBug cameras: cameraList is not an array — contract drift');
  }
  let depth = 0;
  let end = -1;
  for (let i = start; i < unescaped.length; i++) {
    const ch = unescaped[i];
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) {
    throw new Error('WeatherBug cameras: unterminated cameraList array — contract drift');
  }
  try {
    return JSON.parse(unescaped.slice(start, end + 1)) as WeatherBugCamera[];
  } catch {
    throw new Error('WeatherBug cameras: cameraList failed to parse — contract drift');
  }
}

/** Normalize one roster row (null = out-of-area/unusable). */
export function normalizeWeatherBugCamera(row: WeatherBugCamera): Camera | null {
  if (!row.id || typeof row.lat !== 'number' || typeof row.lng !== 'number') return null;
  if (row.lat < BOUNDS.lamin || row.lat > BOUNDS.lamax || row.lng < BOUNDS.lomin || row.lng > BOUNDS.lomax) return null;

  return {
    id: `weatherbug-${row.id}`,
    regionId: 'dc',
    name: row.name?.trim() || `WeatherBug ${row.id}`,
    location: { lat: row.lat, lng: row.lng },
    source: 'weatherbug',
    imageUrl: `${STILL_BASE}/${row.id}/${row.id}_l.jpg`,
    streamUrl: `https://www.weatherbug.com/weather-camera/?cam=${row.id}`,
    lastUpdated: ROSTER_STAMP,
  };
}

export class WeatherBugCamerasFetcher extends BaseFetcher<Camera> {
  constructor() {
    // The roster changes rarely; still URLs are stable per camera.
    super('weatherbug-cameras', 6 * 3600);
  }

  protected async fetchFromApi(): Promise<Camera[]> {
    const html = await this.httpGetText(ROSTER_PAGE);
    const rows = extractCameraList(html);

    const cameras: Camera[] = [];
    for (const row of rows) {
      const camera = normalizeWeatherBugCamera(row);
      if (camera) cameras.push(camera);
    }

    if (rows.length > 0 && cameras.length === 0) {
      // ~16 DMV cameras existed when this shipped — zero parsed from a
      // non-empty roster means the row shape drifted.
      throw new Error(`WeatherBug cameras: parsed 0 of ${rows.length} roster rows — schema drift`);
    }

    logger.debug(`WeatherBug cameras: ${cameras.length} DMV cameras (of ${rows.length} in roster)`);
    return cameras;
  }
}

export const weatherbugCamerasFetcher = new WeatherBugCamerasFetcher();
export default weatherbugCamerasFetcher;
