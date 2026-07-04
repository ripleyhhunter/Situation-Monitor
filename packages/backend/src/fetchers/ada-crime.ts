import { BaseFetcher } from './base.js';
import type { Incident } from '../types/index.js';
import logger from '../logger.js';

/**
 * Ada County CrimeMapper — county-wide reported offenses for Ada County
 * Sheriff, Meridian PD, and Garden City PD.
 *
 *   - Public ArcGIS MapServer, no key, point geometry, ~1-2 day reporting
 *     lag (for ACSO/Meridian/Garden City) with a daily refresh.
 *   - Boise PD rows are EXCLUDED here: they backfill into CrimeMapper over
 *     1-3 months (verified: 18 rows in the last 30 days vs ~940/month once
 *     settled), and the city's own bpd-crime layer is fresher for them —
 *     including them would double-plot the city on a lagging copy.
 *   - One row per OFFENSE: a single Case_Number appears once per charge, so
 *     rows are aggregated per case before mapping to incidents.
 *   - 30-day fetch window — must match this source's expirationMs in
 *     aggregator.cleanupStaleIncidents or records clear/re-add in a loop.
 */

const ADA_CRIME_URL =
  'https://gisprodapi.adacounty.id.gov/arcgis/rest/services/CrimeMapper/Public_Crime/MapServer/1/query';

const FETCH_WINDOW_DAYS = 30;
const PAGE_SIZE = 2000; // layer maxRecordCount
const MAX_PAGES = 4;

export interface AdaCrimeAttributes {
  Case_Number?: string | null;
  Address?: string | null;
  City?: string | null;
  /** Epoch milliseconds. */
  ReportedDate?: number | null;
  Status?: string | null;
  Description?: string | null;
  CATEGORY?: string | null;
  NIBRDesc?: string | null;
  AGENCY?: string | null;
  Offense?: string | null;
  Crime_Against_Category?: string | null;
}

export interface AdaCrimeFeature {
  attributes: AdaCrimeAttributes;
  geometry?: { x?: number; y?: number } | null;
}

interface AdaCrimeResponse {
  features?: AdaCrimeFeature[];
  exceededTransferLimit?: boolean;
  error?: { code?: number; message?: string };
}

export function adaCrimeSeverity(crimeAgainst: string | null | undefined, category: string | null | undefined): 1 | 2 | 3 | 4 | 5 {
  const cat = (category ?? '').toLowerCase();
  if (/homicide|murder|robbery|kidnap|sexual assault|rape/.test(cat)) return 5;
  const against = (crimeAgainst ?? '').toLowerCase();
  if (against === 'person') return 4;
  if (against === 'property') return 3;
  return 2;
}

/**
 * Aggregate per-offense rows into one Incident per Case_Number.
 * Exported for tests.
 */
export function aggregateAdaCrimeFeatures(features: AdaCrimeFeature[]): Incident[] {
  const byCase = new Map<string, { primary: AdaCrimeFeature; offenses: string[] }>();

  for (const feature of features) {
    const a = feature.attributes ?? {};
    const caseNumber = a.Case_Number;
    const lat = feature.geometry?.y;
    const lng = feature.geometry?.x;
    if (!caseNumber || typeof a.ReportedDate !== 'number') continue;
    if (typeof lat !== 'number' || typeof lng !== 'number' || (lat === 0 && lng === 0)) continue;

    const offense = a.Description || a.Offense || a.CATEGORY || 'Offense';
    const existing = byCase.get(caseNumber);
    if (existing) {
      if (!existing.offenses.includes(offense)) existing.offenses.push(offense);
      // Prefer the most severe row as the case's face.
      const existingSev = adaCrimeSeverity(existing.primary.attributes.Crime_Against_Category, existing.primary.attributes.CATEGORY);
      const rowSev = adaCrimeSeverity(a.Crime_Against_Category, a.CATEGORY);
      if (rowSev > existingSev) existing.primary = feature;
    } else {
      byCase.set(caseNumber, { primary: feature, offenses: [offense] });
    }
  }

  const incidents: Incident[] = [];
  for (const [caseNumber, { primary, offenses }] of byCase) {
    const a = primary.attributes;
    // ReportedDate is the only per-record time the feed exposes; records are
    // effectively immutable once published, so it serves as updatedAt too
    // (never wall-clock now — the aggregator diffs on updatedAt). Known
    // trade-off: charges added to a case on a later refresh won't
    // re-broadcast, since no feed field records that change.
    const reported = new Date(a.ReportedDate as number).toISOString();
    const title = a.CATEGORY || a.Description || 'Crime report';

    const parts: string[] = [];
    if (offenses.length > 1) {
      parts.push(`Charges: ${offenses.join('; ')}`);
    } else if (a.NIBRDesc && a.NIBRDesc !== title) {
      parts.push(a.NIBRDesc);
    }
    if (a.AGENCY) parts.push(`Agency: ${a.AGENCY}`);
    if (a.Status) parts.push(`Status: ${a.Status}`);

    incidents.push({
      id: `ada-crime-${caseNumber}`,
      regionId: 'boise',
      type: 'crime',
      severity: adaCrimeSeverity(a.Crime_Against_Category, a.CATEGORY),
      location: {
        lat: primary.geometry!.y as number,
        lng: primary.geometry!.x as number,
        address: [a.Address, a.City].filter(Boolean).join(', ') || undefined,
      },
      timestamp: reported,
      updatedAt: reported,
      source: 'ada-crime',
      title,
      description: parts.join('\n'),
      status: 'active',
      category: a.CATEGORY || undefined,
      metadata: {
        caseNumber,
        agency: a.AGENCY,
        offenses,
        crimeAgainst: a.Crime_Against_Category,
        caseStatus: a.Status,
      },
    });
  }

  return incidents;
}

export class AdaCrimeFetcher extends BaseFetcher<Incident> {
  constructor() {
    // The upstream refreshes daily; the crime cron fires every 15 min, so a
    // 1h cache keeps polls polite without meaningfully adding staleness.
    super('ada-crime', 3600);
  }

  protected async fetchFromApi(): Promise<Incident[]> {
    const features: AdaCrimeFeature[] = [];

    for (let page = 0; page < MAX_PAGES; page++) {
      const params = new URLSearchParams({
        // Server-relative window: no client date formatting or tz math.
        where: `ReportedDate >= CURRENT_TIMESTAMP - ${FETCH_WINDOW_DAYS} AND AGENCY <> 'Boise PD'`,
        outFields: 'Case_Number,Address,City,ReportedDate,Status,Description,CATEGORY,NIBRDesc,AGENCY,Offense,Crime_Against_Category',
        outSR: '4326',
        // Case_Number tie-breaker: per-case rows share a ReportedDate, and
        // an unstable tie order across page requests could skip rows at
        // page boundaries.
        orderByFields: 'ReportedDate DESC,Case_Number',
        resultOffset: String(page * PAGE_SIZE),
        resultRecordCount: String(PAGE_SIZE),
        f: 'json',
      });

      const response = await this.httpGet<AdaCrimeResponse>(`${ADA_CRIME_URL}?${params.toString()}`);

      if (response.error) {
        throw new Error(`Ada CrimeMapper error ${response.error.code}: ${response.error.message}`);
      }
      if (!response.features || !Array.isArray(response.features)) {
        // Contract drift must fail loudly — a false-empty "success" would
        // hollow out the Boise crime layer while /api/health stays green.
        throw new Error('Ada CrimeMapper: unexpected response shape (no features array)');
      }

      features.push(...response.features);
      if (!response.exceededTransferLimit) break;
      if (page === MAX_PAGES - 1) {
        logger.warn(`Ada CrimeMapper: still paginating after ${MAX_PAGES} pages — truncating at ${features.length} rows`);
      }
    }

    const incidents = aggregateAdaCrimeFeatures(features);
    logger.info(`Ada CrimeMapper: ${incidents.length} cases from ${features.length} offense rows (last ${FETCH_WINDOW_DAYS} days)`);
    return incidents;
  }
}

export const adaCrimeFetcher = new AdaCrimeFetcher();
export default adaCrimeFetcher;
