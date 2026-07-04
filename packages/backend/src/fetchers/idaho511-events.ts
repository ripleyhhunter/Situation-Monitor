import { BaseFetcher } from './base.js';
import type { Incident, IncidentType } from '../types/index.js';
import { wallClockToUtcMs } from '../utils/timezone.js';
import { config } from '../config.js';
import logger from '../logger.js';

/**
 * Idaho 511 live traffic *events* for the Treasure Valley — the real-time
 * public-safety layer the WZDx roadwork feed doesn't carry:
 *
 *   - `Incidents`      — ITD-entered live incidents (crashes, vehicle fires,
 *                        debris). Usually sparse; statewide.
 *   - `WazeIncidents`  — Waze crowd reports ITD republishes (accidents,
 *                        stopped vehicles, hazards). Near-real-time; each
 *                        record carries the platform's own lastUpdated.
 *
 * Same keyless internal endpoints as idaho511-cameras (see the posture note
 * there): positions come from GET /map/mapIcons/{layer}, details from the
 * DataTables-style POST /List/GetData/{layer}, joined on the event id.
 * Congestion jams and Waze road-closure reports are deliberately dropped —
 * closures/roadwork are already covered by ITD WZDx + ACHD, and the whole
 * point of this feed is responder-relevant events, not more traffic noise.
 *
 * Complete listing: presence in the layer is the lifecycle — ITD removes
 * events when cleared, so an empty poll is a quiet road network, not an
 * error. Shape drift (missing item2 / data arrays, unparseable dates) still
 * throws loudly per the fetcher contract.
 */

const MAP_ICONS_BASE = 'https://511.idaho.gov/map/mapIcons';
const LIST_BASE = 'https://511.idaho.gov/List/GetData';

const LAYERS = ['Incidents', 'WazeIncidents'] as const;
type LayerName = (typeof LAYERS)[number];

const PAGE_SIZE = 100; // server-enforced cap (same platform as cameras)
const MAX_PAGES = 5;

// Treasure Valley — matches the region's other bbox filters.
const BOUNDS = { lamin: 43.40, lamax: 43.95, lomin: -116.80, lomax: -115.85 };

interface IconItem {
  itemId?: string | number;
  location?: number[]; // [lat, lng]
}

interface IconsResponse {
  item2?: IconItem[];
}

export interface Idaho511EventRow {
  id?: number;
  type?: string | null;
  roadwayName?: string | null;
  description?: string | null;
  source?: string | null;
  comment?: string | null;
  eventSubType?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  lastUpdated?: string | null;
  isFullClosure?: boolean;
  severity?: string | null;
  direction?: string | null;
  locationDescription?: string | null;
  laneDescription?: string | null;
}

interface ListResponse {
  recordsTotal?: number;
  data?: Idaho511EventRow[];
}

/**
 * Parse the platform's "M/D/YY, h:mm AM" (also "M/D/YYYY h:mm:ss PM")
 * wall-clock strings as America/Boise. Returns null for empty input;
 * THROWS on a non-empty string that doesn't match — a date-format change
 * must surface as contract drift, not silently decay every timestamp.
 * Exported for tests.
 */
export function parseIdaho511Timestamp(dateStr: string | null | undefined): string | null {
  const trimmed = dateStr?.trim();
  if (!trimmed) return null;

  const m = trimmed.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)$/i,
  );
  if (!m) {
    throw new Error(`Idaho 511 events: unparseable timestamp "${dateStr}" — date format drift`);
  }

  const [, mo, d, y, h, min, sec, ap] = m;
  const year = +y < 100 ? 2000 + +y : +y;
  let hour = parseInt(h, 10) % 12;
  if (ap.toUpperCase() === 'PM') hour += 12;

  return new Date(
    wallClockToUtcMs(year, +mo, +d, hour, +min, +(sec || 0), 'America/Boise'),
  ).toISOString();
}

interface Classification {
  type: IncidentType;
  severity: 1 | 2 | 3 | 4 | 5;
  label: string;
}

/** Map a row to an incident class, or null to drop it. Exported for tests. */
export function classifyIdaho511Event(row: Idaho511EventRow): Classification | null {
  const sub = (row.eventSubType ?? '').toUpperCase();
  const text = `${row.type ?? ''} ${row.description ?? ''}`.toLowerCase();
  const major = sub.includes('MAJOR') || /major/i.test(row.severity ?? '') || row.isFullClosure === true;

  // Congestion noise; closures are already covered by ITD WZDx + ACHD.
  if (sub.startsWith('JAM') || sub.startsWith('ROAD_CLOSED')) return null;

  if (sub.startsWith('ACCIDENT') || /crash|collision|accident|rollover|overturn|jack-?knif/.test(text)) {
    return { type: 'traffic', severity: major ? 4 : 3, label: 'Crash' };
  }
  if (/\bfire\b/.test(text)) {
    return { type: 'fire', severity: 3, label: 'Fire' };
  }
  if (sub.startsWith('HAZARD_ON_ROAD')) {
    return { type: 'hazard', severity: 3, label: 'Road Hazard' };
  }
  if (sub.startsWith('HAZARD')) {
    return { type: 'hazard', severity: 2, label: 'Roadside Hazard' };
  }
  // Official ITD incident with no recognizable keywords — still a live event.
  return { type: 'hazard', severity: major ? 3 : 2, label: 'Incident' };
}

/**
 * Normalize one joined row to an Incident (null = dropped: no position,
 * out of the valley, or a filtered class). Exported for tests.
 */
export function normalizeIdaho511Event(
  row: Idaho511EventRow,
  layer: LayerName,
  latLng: [number, number] | undefined,
): Incident | null {
  if (typeof row.id !== 'number' || !latLng) return null;
  const [lat, lng] = latLng;
  if (lat < BOUNDS.lamin || lat > BOUNDS.lamax || lng < BOUNDS.lomin || lng > BOUNDS.lomax) return null;

  const classification = classifyIdaho511Event(row);
  if (!classification) return null;

  // Feed fields only, never wall-clock now — the aggregator diffs on
  // updatedAt, and these rows carry the platform's own lastUpdated.
  const startIso = parseIdaho511Timestamp(row.startDate);
  const updatedIso = parseIdaho511Timestamp(row.lastUpdated) ?? startIso;
  if (!startIso && !updatedIso) return null; // no dates at all — can't place it in time honestly

  const roadway = row.roadwayName?.trim();
  const detail = row.description?.trim();
  const title = roadway
    ? `${classification.label}: ${roadway}${detail ? ` — ${detail}` : ''}`
    : `${classification.label}${detail ? `: ${detail}` : ''}`;

  const isWaze = /waze/i.test(row.source ?? '');
  const description = [
    row.locationDescription?.trim(),
    row.laneDescription?.trim(),
    row.comment?.trim(),
    isWaze ? 'Crowd-reported via Waze (unverified until responders confirm).' : null,
  ]
    .filter(Boolean)
    .join(' ');

  return {
    id: `itd-events-${layer === 'WazeIncidents' ? 'waze' : 'itd'}-${row.id}`,
    regionId: 'boise',
    type: classification.type,
    severity: classification.severity,
    location: { lat, lng, address: roadway || undefined },
    timestamp: (startIso ?? updatedIso) as string,
    updatedAt: (updatedIso ?? startIso) as string,
    source: 'itd-events',
    title,
    description: description || detail || classification.label,
    status: 'active',
    category: row.eventSubType?.toLowerCase() || 'incident',
    metadata: {
      // Point-in-time events (no `ongoing` flag): the 24h event-time
      // filter SHOULD age these out of the default view.
      layer,
      eventSubType: row.eventSubType,
      feedSource: row.source,
      direction: row.direction,
      isFullClosure: row.isFullClosure,
      endDate: row.endDate,
    },
  };
}

export class Idaho511EventsFetcher extends BaseFetcher<Incident> {
  readonly incidentSource = 'itd-events' as const;

  constructor() {
    super('itd-events', config.cacheTtl.trafficIncidents);
  }

  protected async fetchFromApi(): Promise<Incident[]> {
    const incidents: Incident[] = [];

    for (const layer of LAYERS) {
      const icons = await this.httpGet<IconsResponse>(`${MAP_ICONS_BASE}/${layer}`);
      if (!icons || !Array.isArray(icons.item2)) {
        // An empty item2 array is a quiet day; a MISSING one is drift.
        throw new Error(`Idaho 511 events: ${layer} mapIcons response missing item2 — contract drift`);
      }
      const positions = new Map<string, [number, number]>();
      for (const item of icons.item2) {
        if (item?.itemId != null && Array.isArray(item.location) && item.location.length >= 2) {
          positions.set(String(item.itemId), [item.location[0], item.location[1]]);
        }
      }

      const rows: Idaho511EventRow[] = [];
      let total = Infinity;
      for (let page = 0; page < MAX_PAGES && page * PAGE_SIZE < total; page++) {
        const response = await this.httpPostForm<ListResponse>(`${LIST_BASE}/${layer}`, {
          draw: '1',
          start: String(page * PAGE_SIZE),
          length: String(PAGE_SIZE),
        });
        if (!response.data || !Array.isArray(response.data)) {
          throw new Error(`Idaho 511 events: ${layer} list response has no data array — contract drift`);
        }
        if (typeof response.recordsTotal === 'number') total = response.recordsTotal;
        rows.push(...response.data);
        if (response.data.length < PAGE_SIZE) break;
      }
      if (Number.isFinite(total) && rows.length < total) {
        throw new Error(`Idaho 511 events: fetched ${rows.length} of ${total} ${layer} rows — pagination truncated`);
      }

      for (const row of rows) {
        const incident = normalizeIdaho511Event(
          row,
          layer,
          row.id != null ? positions.get(String(row.id)) : undefined,
        );
        if (incident) incidents.push(incident);
      }
    }

    logger.debug(`Idaho 511 events: ${incidents.length} live Treasure Valley events`);
    return incidents;
  }
}

export const idaho511EventsFetcher = new Idaho511EventsFetcher();
export default idaho511EventsFetcher;
