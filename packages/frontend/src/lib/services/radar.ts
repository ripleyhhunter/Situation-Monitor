/**
 * Precipitation radar tiles for the Leaflet map.
 *
 * Primary: RainViewer's public weather-maps API (free, keyless; attribution
 * required). Frame paths are opaque hashes that expire as they age out of the
 * trailing 2-hour window, so the tile URL must always be rebuilt from a fresh
 * index — a stale template 404s. New frames land every 10 minutes.
 *
 * Fallback: Iowa Environmental Mesonet's NEXRAD composite tile cache (CONUS
 * only, ~5-min refresh, no index needed) when the RainViewer index is
 * unreachable.
 */

const RAINVIEWER_INDEX_URL = 'https://api.rainviewer.com/public/weather-maps.json';

export const IEM_TILE_TEMPLATE =
  'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png';

export const RAINVIEWER_ATTRIBUTION =
  '<a href="https://www.rainviewer.com/" target="_blank" rel="noopener noreferrer">Weather data by RainViewer</a>';
export const IEM_ATTRIBUTION = 'Radar &copy; Iowa Environmental Mesonet';

interface RainViewerFrame {
  time: number;
  path: string;
}

interface RainViewerIndex {
  host: string;
  radar?: {
    past?: RainViewerFrame[];
    nowcast?: RainViewerFrame[];
  };
}

export interface RadarFrameInfo {
  /** Leaflet tile URL template. */
  tileTemplate: string;
  /** Unix seconds of the frame (0 for the IEM fallback's rolling latest). */
  frameTime: number;
  attribution: string;
  source: 'rainviewer' | 'iem';
}

/**
 * Build the tile template for a RainViewer frame.
 * Color scheme 8 reads well on both the light and dark basemaps;
 * smooth=1, snow=1 per the public API docs.
 */
export function buildRainViewerTemplate(host: string, path: string): string {
  return `${host}${path}/256/{z}/{x}/{y}/8/1_1.png`;
}

/**
 * Pick the newest past frame from a RainViewer index. Returns null when the
 * index has no usable frames (shape drift, empty arrays).
 */
export function pickNewestFrame(index: RainViewerIndex): RainViewerFrame | null {
  const past = index.radar?.past;
  if (!Array.isArray(past) || past.length === 0) return null;
  let newest: RainViewerFrame | null = null;
  for (const frame of past) {
    if (!frame || typeof frame.time !== 'number' || typeof frame.path !== 'string') continue;
    if (!newest || frame.time > newest.time) newest = frame;
  }
  return newest;
}

/**
 * Fetch the current radar frame info: RainViewer's newest past frame, or the
 * IEM composite when the index is unreachable/unusable.
 */
export async function fetchRadarFrame(): Promise<RadarFrameInfo> {
  try {
    // Timeout matters: a hung (never-settling) fetch would otherwise wedge
    // the caller's in-flight guard and silently kill the toggle.
    const response = await fetch(RAINVIEWER_INDEX_URL, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`RainViewer index HTTP ${response.status}`);
    const index = (await response.json()) as RainViewerIndex;
    const frame = pickNewestFrame(index);
    if (frame && typeof index.host === 'string' && index.host.startsWith('https://')) {
      return {
        tileTemplate: buildRainViewerTemplate(index.host, frame.path),
        frameTime: frame.time,
        attribution: RAINVIEWER_ATTRIBUTION,
        source: 'rainviewer',
      };
    }
    throw new Error('RainViewer index had no usable frames');
  } catch (error) {
    console.warn('Radar: falling back to IEM NEXRAD tiles:', error);
    return {
      tileTemplate: IEM_TILE_TEMPLATE,
      frameTime: 0,
      attribution: IEM_ATTRIBUTION,
      source: 'iem',
    };
  }
}
