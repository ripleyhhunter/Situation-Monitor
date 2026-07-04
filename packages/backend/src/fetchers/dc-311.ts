import { BaseFetcher } from './base.js';
import type { Incident, IncidentType } from '../types/index.js';
import logger from '../logger.js';

/**
 * DC 311 service requests, filtered to situationally relevant categories.
 *
 *   - The "All Service Requests - Last 90 Days" rolling ArcGIS layer is
 *     genuinely near-real-time (records appear within minutes of intake),
 *     not the daily dump it's often assumed to be — verified live.
 *   - The full firehose is mostly noise (yard waste, parking); an allowlist
 *     keeps only categories that matter on a situational map: signals out,
 *     wires down, flooding, downed trees, sinkholes, gas leaks, water
 *     mains, snow/ice emergencies.
 *   - The layer 400s on where-clauses against ADDDATE epoch values, so the
 *     query orders by ADDDATE DESC with a fixed row count and the 24-hour
 *     window is applied client-side — matching this source's default
 *     24-hour expiry in the aggregator (window == expiry invariant).
 */

const DC_311_URL =
  'https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/ServiceRequests/FeatureServer/13/query';

// Layer maxRecordCount; measured intake is ~600 rows/day (holiday) so the
// full cap keeps the 24h window covered even on storm days.
const FETCH_ROWS = 2000;
const WINDOW_MS = 24 * 60 * 60 * 1000; // must match aggregator default expiry

/** Substring rules mapping situational categories to type + severity. */
const CATEGORY_RULES: Array<{ pattern: RegExp; type: IncidentType; severity: 1 | 2 | 3 | 4 | 5 }> = [
  { pattern: /wire.*down|down.*wire|power outage/i, type: 'hazard', severity: 4 },
  { pattern: /flood/i, type: 'hazard', severity: 4 },
  { pattern: /gas (leak|odor)/i, type: 'hazard', severity: 4 },
  { pattern: /sinkhole|cave[- ]?in|road collapse/i, type: 'hazard', severity: 4 },
  { pattern: /traffic (light|signal)|pedestrian walk signal/i, type: 'traffic', severity: 3 },
  { pattern: /tree.*(down|fallen|emergency)|(down|fallen|emergency).*tree/i, type: 'hazard', severity: 3 },
  { pattern: /water main/i, type: 'hazard', severity: 3 },
  { pattern: /snow|ice removal/i, type: 'hazard', severity: 3 },
];

export interface Dc311Attributes {
  SERVICEREQUESTID?: string | null;
  SERVICECODEDESCRIPTION?: string | null;
  SERVICEORDERSTATUS?: string | null;
  /** Epoch ms. */
  ADDDATE?: number | null;
  /** Epoch ms; set when the request is closed. */
  RESOLUTIONDATE?: number | null;
  LATITUDE?: number | null;
  LONGITUDE?: number | null;
  WARD?: string | number | null;
  STREETADDRESS?: string | null;
}

interface Dc311Response {
  features?: Array<{ attributes: Dc311Attributes }>;
  error?: { code?: number; message?: string };
}

/** Match a category against the allowlist. Exported for tests. */
export function matchDc311Category(description: string | null | undefined): { type: IncidentType; severity: 1 | 2 | 3 | 4 | 5 } | null {
  if (!description) return null;
  for (const rule of CATEGORY_RULES) {
    if (rule.pattern.test(description)) return { type: rule.type, severity: rule.severity };
  }
  return null;
}

/** Normalize one 311 row. Exported for tests. */
export function normalizeDc311Row(a: Dc311Attributes, now = Date.now()): Incident | null {
  const match = matchDc311Category(a.SERVICECODEDESCRIPTION);
  if (!match) return null;
  if (!a.SERVICEREQUESTID || typeof a.ADDDATE !== 'number') return null;
  if (typeof a.LATITUDE !== 'number' || typeof a.LONGITUDE !== 'number') return null;
  if (a.LATITUDE === 0 && a.LONGITUDE === 0) return null;
  // Client-side window — must stay inside this source's aggregator expiry.
  if (now - a.ADDDATE > WINDOW_MS) return null;
  const status = (a.SERVICEORDERSTATUS ?? '').toLowerCase();
  // Duplicate requests double-plot the same underlying event.
  if (status.includes('duplicate')) return null;
  // Resolved requests inside the window are emitted as CLEARED (with the
  // resolution time as updatedAt) so a fixed signal leaves the map on the
  // next poll instead of lingering active until the 24h sweep.
  const resolved =
    status.startsWith('clos') || status.startsWith('resolv')
      ? (typeof a.RESOLUTIONDATE === 'number' ? a.RESOLUTIONDATE : a.ADDDATE)
      : null;

  const added = new Date(a.ADDDATE).toISOString();

  return {
    id: `dc-311-${a.SERVICEREQUESTID}`,
    regionId: 'dc',
    type: match.type,
    severity: match.severity,
    location: {
      lat: a.LATITUDE,
      lng: a.LONGITUDE,
      address: a.STREETADDRESS || undefined,
    },
    timestamp: added,
    updatedAt: resolved !== null ? new Date(resolved).toISOString() : added,
    source: 'dc-311',
    status: resolved !== null ? 'cleared' : 'active',
    title: a.SERVICECODEDESCRIPTION as string,
    description: [
      a.STREETADDRESS,
      a.WARD != null ? `Ward ${a.WARD}` : null,
      a.SERVICEORDERSTATUS ? `Status: ${a.SERVICEORDERSTATUS}` : null,
    ]
      .filter(Boolean)
      .join('\n'),
    category: '311',
    metadata: {
      // Open situational requests are happening now; honor shorter time
      // windows for cleared ones.
      ongoing: resolved === null ? true : undefined,
      requestId: a.SERVICEREQUESTID,
      ward: a.WARD,
      requestStatus: a.SERVICEORDERSTATUS,
    },
  };
}

export class Dc311Fetcher extends BaseFetcher<Incident> {
  constructor() {
    // Intake is continuous; the emergency-alert cron runs every 2 min and
    // a 5-min cache keeps polls polite.
    super('dc-311', 300);
  }

  protected async fetchFromApi(): Promise<Incident[]> {
    const params = new URLSearchParams({
      where: '1=1',
      outFields: 'SERVICEREQUESTID,SERVICECODEDESCRIPTION,SERVICEORDERSTATUS,ADDDATE,RESOLUTIONDATE,LATITUDE,LONGITUDE,WARD,STREETADDRESS',
      orderByFields: 'ADDDATE DESC',
      resultRecordCount: String(FETCH_ROWS),
      f: 'json',
    });

    const response = await this.httpGet<Dc311Response>(`${DC_311_URL}?${params.toString()}`);

    if (response.error) {
      throw new Error(`DC 311 error ${response.error.code}: ${response.error.message}`);
    }
    if (!response.features || !Array.isArray(response.features)) {
      throw new Error('DC 311: unexpected response shape (no features array)');
    }

    const incidents: Incident[] = [];
    for (const feature of response.features) {
      const incident = normalizeDc311Row(feature.attributes ?? {});
      if (incident) incidents.push(incident);
    }

    logger.debug(`DC 311: ${incidents.length} situational requests (of ${response.features.length} recent rows)`);
    return incidents;
  }
}

export const dc311Fetcher = new Dc311Fetcher();
export default dc311Fetcher;
