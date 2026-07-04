import { BaseFetcher } from './base.js';
import type { Incident, RegionId } from '../types/index.js';
import logger from '../logger.js';

/**
 * NWS river gauges via the NWPS API — surfaces an incident only when a
 * gauge is at or above ACTION stage, so the layer is quiet until water
 * actually matters (Boise River spring runoff, Potomac flooding).
 *
 *   - Keyless JSON. Observations are 15-minute interval with ~45-75 min
 *     publication lag — near-real-time for river dynamics.
 *   - The bbox query REQUIRES srid=EPSG_4326: without it the API returns
 *     HTTP 200 with an empty gauge list (verified) — a silent-failure trap.
 *     An empty gauges array therefore throws as contract drift; both
 *     region bboxes contain known gauges (7 around Boise, ~82 around DC).
 *   - Complete-listing semantics: the emitted set is "gauges currently
 *     flooding"; a gauge that drops below action stage disappears from the
 *     batch and is cross-cleared on the next successful poll.
 *   - Sentinel values -9999/-999 mean "missing" and are filtered.
 */

const NWPS_URL = 'https://api.water.noaa.gov/nwps/v1/gauges';

const FLOOD_SEVERITY: Record<string, 1 | 2 | 3 | 4 | 5> = {
  action: 2,
  minor: 3,
  moderate: 4,
  major: 5,
};

export interface NwpsGauge {
  lid?: string;
  name?: string;
  latitude?: number;
  longitude?: number;
  status?: {
    observed?: {
      primary?: number;
      primaryUnit?: string;
      secondary?: number;
      secondaryUnit?: string;
      floodCategory?: string;
      validTime?: string;
    };
  };
}

interface NwpsResponse {
  gauges?: NwpsGauge[];
}

/** Normalize one flooding gauge. Exported for tests. Returns null unless the gauge is at/above action stage. */
export function normalizeFloodingGauge(gauge: NwpsGauge, regionId: RegionId): Incident | null {
  const observed = gauge.status?.observed;
  if (!gauge.lid || !observed) return null;
  const category = (observed.floodCategory ?? '').toLowerCase();
  const severity = FLOOD_SEVERITY[category];
  if (!severity) return null; // no_flooding / not_defined / obs_not_current
  if (typeof gauge.latitude !== 'number' || typeof gauge.longitude !== 'number') return null;
  // NWPS emits Go's zero-time sentinel (0001-01-01...) on missing
  // observations — reject anything implausibly old along with it.
  if (!observed.validTime || observed.validTime < '2000-01-01') return null;

  // Sentinels mean the reading is missing — don't report a stage value.
  const primaryValid = typeof observed.primary === 'number' && observed.primary > -999;
  const stageText = primaryValid ? `${observed.primary} ${observed.primaryUnit ?? ''}`.trim() : 'stage unavailable';

  const label = category === 'action' ? 'Near flood stage' : `${category[0].toUpperCase()}${category.slice(1)} flooding`;

  return {
    id: `nws-gauge-${gauge.lid}`,
    regionId,
    type: 'hazard',
    severity,
    location: {
      lat: gauge.latitude,
      lng: gauge.longitude,
      address: gauge.name || gauge.lid,
    },
    timestamp: observed.validTime,
    // The observation's own valid time — never wall-clock now. It advances
    // with each 15-min reading, which correctly re-broadcasts the incident
    // as the stage changes.
    updatedAt: observed.validTime,
    source: 'nws-gauge',
    title: `${label} — ${gauge.name || gauge.lid}`,
    description: `Current stage: ${stageText}\nFlood category: ${category}`,
    status: 'active',
    category: 'flooding',
    metadata: {
      // Active water situation — exempt from the event-time filter.
      ongoing: true,
      lid: gauge.lid,
      floodCategory: category,
      stage: primaryValid ? observed.primary : undefined,
      stageUnit: primaryValid ? observed.primaryUnit : undefined,
    },
  };
}

export interface NwsGaugesFetcherOptions {
  regionId: RegionId;
  bbox: { xmin: number; ymin: number; xmax: number; ymax: number };
}

export class NwsGaugesFetcher extends BaseFetcher<Incident> {
  readonly incidentSource = 'nws-gauge' as const;

  private regionId: RegionId;
  private url: string;

  constructor(options: NwsGaugesFetcherOptions) {
    // Observations lag ~an hour anyway; 10-min cache on the 2-min cron.
    super(`nws-gauges-${options.regionId}`, 600);
    this.regionId = options.regionId;
    const { xmin, ymin, xmax, ymax } = options.bbox;
    this.url =
      `${NWPS_URL}?bbox.xmin=${xmin}&bbox.ymin=${ymin}&bbox.xmax=${xmax}&bbox.ymax=${ymax}` +
      // Without srid the API 200s with an empty list — see module docs.
      `&srid=EPSG_4326`;
  }

  protected async fetchFromApi(): Promise<Incident[]> {
    const response = await this.httpGet<NwpsResponse>(this.url);

    if (!response.gauges || !Array.isArray(response.gauges)) {
      throw new Error('NWPS gauges: unexpected response shape (no gauges array)');
    }
    if (response.gauges.length === 0) {
      // Both region bboxes contain known gauges; empty means the
      // srid/bbox contract drifted (the API's documented silent-failure
      // mode), not that the rivers vanished.
      throw new Error('NWPS gauges: empty gauge list — bbox/srid contract drift');
    }

    const incidents: Incident[] = [];
    for (const gauge of response.gauges) {
      const incident = normalizeFloodingGauge(gauge, this.regionId);
      if (incident) incidents.push(incident);
    }

    logger.debug(`NWS gauges (${this.regionId}): ${response.gauges.length} gauges, ${incidents.length} at/above action stage`);
    return incidents;
  }
}
