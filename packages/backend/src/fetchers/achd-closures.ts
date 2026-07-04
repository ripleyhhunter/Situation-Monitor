import { BaseFetcher } from './base.js';
import type { Incident } from '../types/index.js';
import logger from '../logger.js';

/**
 * ACHD (Ada County Highway District) RITA "Current Projects" — road
 * closures, lane restrictions, and pedestrian restrictions on the local
 * road network ACHD owns (nearly all Boise-area surface streets).
 *
 *   - Public ArcGIS FeatureServer (gis.achdidaho.org/server/... — note the
 *     /server/ root), no key, GeoJSON polylines.
 *   - Complements the ITD WZDx feed, which only covers state highways.
 *   - The layer is a complete snapshot of current projects — absence from a
 *     successful poll means the project ended (complete-listing source).
 *   - last_edited_date is a batch-sync timestamp shared by many records;
 *     it is still the honest per-record feed field for updatedAt.
 */

const ACHD_URL =
  'https://gis.achdidaho.org/server/rest/services/RITA/RITA_Public/FeatureServer/0/query';

interface AchdProperties {
  OBJECTID?: number;
  GlobalID?: string | null;
  PROJECT_STATUS?: string | null;
  ROADWAY?: string | null;
  LOCATION?: string | null;
  /** Epoch ms. */
  START?: number | null;
  FINISH?: number | null;
  CITY?: string | null;
  PURPOSE?: string | null;
  CONTRACTOR?: string | null;
  TYPE?: string | null;
  /** Epoch ms; batch-shared. */
  last_edited_date?: number | null;
}

export interface AchdFeature {
  type: 'Feature';
  properties: AchdProperties;
  geometry: { type: 'LineString' | 'MultiLineString'; coordinates: number[][] | number[][][] } | null;
}

interface AchdResponse {
  type?: 'FeatureCollection';
  features?: AchdFeature[];
  exceededTransferLimit?: boolean;
  properties?: { exceededTransferLimit?: boolean };
  error?: { code?: number; message?: string };
}

export function achdSeverity(type: string | null | undefined): 1 | 2 | 3 | 4 | 5 {
  const t = (type ?? '').toLowerCase();
  if (t.includes('road closure')) return 4;
  if (t.includes('flagging')) return 3;
  if (t.includes('lane restriction')) return 2;
  return 1; // shoulder work, pedestrian restrictions
}

/** Midpoint vertex of the project polyline. Exported for tests. */
export function achdMidpoint(geometry: AchdFeature['geometry']): [number, number] | null {
  if (!geometry || !Array.isArray(geometry.coordinates) || geometry.coordinates.length === 0) return null;
  let line: number[][];
  if (geometry.type === 'MultiLineString') {
    const first = (geometry.coordinates as number[][][])[0];
    if (!Array.isArray(first) || first.length === 0) return null;
    line = first;
  } else {
    line = geometry.coordinates as number[][];
  }
  const mid = line[Math.floor(line.length / 2)];
  if (!Array.isArray(mid) || typeof mid[0] !== 'number' || typeof mid[1] !== 'number') return null;
  return [mid[0], mid[1]];
}

/** Normalize one RITA feature. Exported for tests. */
export function normalizeAchdFeature(feature: AchdFeature, now = Date.now()): Incident | null {
  const props = feature.properties ?? {};
  const point = achdMidpoint(feature.geometry);
  if (!point) return null;

  const edited = props.last_edited_date;
  const start = props.START;
  // updatedAt must come from the feed; records without it are dropped
  // rather than stamped with wall-clock now.
  if (typeof edited !== 'number') return null;
  // Without any stable id the same feature would mint colliding ids.
  if (!props.GlobalID && typeof props.OBJECTID !== 'number') return null;

  const type = props.TYPE || 'Roadwork';
  const roadway = props.ROADWAY || 'Ada County road';

  // ACHD promotes projects to "Current" a couple of days before work
  // starts. Don't assert an active closure for a road that's still open —
  // label it upcoming and keep severity low until START passes.
  const isUpcoming = typeof start === 'number' && start > now;
  const title = isUpcoming ? `Upcoming ${type}: ${roadway}` : `${type}: ${roadway}`;

  const parts: string[] = [];
  if (props.LOCATION) parts.push(props.LOCATION);
  if (isUpcoming) {
    parts.push(`Starts: ${new Date(start as number).toLocaleDateString('en-US', { timeZone: 'America/Boise' })}`);
  }
  if (props.PURPOSE) parts.push(props.PURPOSE);
  if (props.CITY) parts.push(`City: ${props.CITY}`);
  if (props.CONTRACTOR) parts.push(`Contractor: ${props.CONTRACTOR}`);
  if (typeof props.FINISH === 'number') {
    parts.push(`Scheduled through: ${new Date(props.FINISH).toLocaleDateString('en-US', { timeZone: 'America/Boise' })}`);
  }

  return {
    id: `achd-${props.GlobalID || props.OBJECTID}`,
    regionId: 'boise',
    type: 'traffic',
    severity: isUpcoming ? Math.min(achdSeverity(props.TYPE), 2) as 1 | 2 : achdSeverity(props.TYPE),
    location: {
      lat: point[1],
      lng: point[0],
      address: props.LOCATION ? `${roadway} (${props.LOCATION})` : roadway,
    },
    timestamp: typeof start === 'number' ? new Date(start).toISOString() : new Date(edited).toISOString(),
    updatedAt: new Date(edited).toISOString(),
    source: 'achd',
    title,
    description: parts.join('\n'),
    status: 'active',
    category: type.toLowerCase(),
    metadata: {
      // Ongoing situation: exempt from the frontend's event-time filter —
      // a project started months ago is still restricting traffic now.
      ongoing: true,
      upcoming: isUpcoming || undefined,
      roadway,
      projectType: props.TYPE,
      purpose: props.PURPOSE,
      contractor: props.CONTRACTOR,
      city: props.CITY,
      finish: typeof props.FINISH === 'number' ? new Date(props.FINISH).toISOString() : undefined,
    },
  };
}

export class AchdClosuresFetcher extends BaseFetcher<Incident> {
  readonly incidentSource = 'achd' as const;

  private static readonly URL = (() => {
    const params = new URLSearchParams({
      where: "PROJECT_STATUS='Current Projects'",
      outFields: 'OBJECTID,GlobalID,PROJECT_STATUS,ROADWAY,LOCATION,START,FINISH,CITY,PURPOSE,CONTRACTOR,TYPE,last_edited_date',
      f: 'geojson',
    });
    return `${ACHD_URL}?${params.toString()}`;
  })();

  constructor() {
    // RITA is edited in ~2h batches on business days; the traffic cron is
    // every minute, so a 15-min cache is plenty fresh and polite.
    super('achd-closures', 900);
  }

  protected async fetchFromApi(): Promise<Incident[]> {
    const response = await this.httpGet<AchdResponse>(AchdClosuresFetcher.URL);

    if (response.error) {
      // ArcGIS returns HTTP 200 with an error body.
      throw new Error(`ACHD RITA error ${response.error.code}: ${response.error.message}`);
    }
    if (!response.features || !Array.isArray(response.features)) {
      // Complete-listing source: a false-empty "success" would clear every
      // ACHD project. Contract drift must be a failure.
      throw new Error('ACHD RITA: unexpected response shape (no features array)');
    }
    if (response.exceededTransferLimit || response.properties?.exceededTransferLimit) {
      // A truncated snapshot would silently cross-clear everything past the
      // page boundary.
      throw new Error('ACHD RITA: response truncated (exceededTransferLimit)');
    }

    const incidents: Incident[] = [];
    for (const feature of response.features) {
      const incident = normalizeAchdFeature(feature);
      if (incident) incidents.push(incident);
    }

    logger.debug(`ACHD RITA: ${incidents.length} current projects`);
    return incidents;
  }
}

export const achdClosuresFetcher = new AchdClosuresFetcher();
export default achdClosuresFetcher;
