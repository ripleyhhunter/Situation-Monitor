import { BaseFetcher } from './base.js';
import type { Incident } from '../types/index.js';
import logger from '../logger.js';

/**
 * VDOT 511 Virginia — Northern Virginia incidents and active construction.
 *
 *   - Undocumented-but-public GeoJSON layer feeds behind the official
 *     511.vdot.virginia.gov map (discovered via its layer catalog). Keyless;
 *     regenerates ~every 60s. Same posture as the PulsePoint/511-Idaho
 *     integrations: parse defensively, throw on drift.
 *   - This is the only keyless NoVA incident source found — Virginia's
 *     registered WZDx feed (SmarterRoads) is token-gated.
 *   - Feeds are STATEWIDE; features are bbox-filtered to Northern Virginia
 *     (Arlington/Alexandria/Fairfax) so DC's map doesn't fill with Bristol.
 *   - Features carry no per-event timestamps. The event date is embedded in
 *     the feature id (e.g. "INNO4646251-07042026" = July 4 2026); presence
 *     in the feed is the lifecycle signal (complete-listing source), and
 *     incidents are marked ongoing so the event-time filter can't hide
 *     active ones.
 *
 * All three layers share one source ('vdot'): if ANY layer fetch fails the
 * whole fetch throws — a partial snapshot on a complete-listing source
 * would cross-clear the missing layer's events (the dc-traffic lesson).
 */

const BASE = 'https://data.511-atis-ttrip-prod.iteriscloud.com/datasets';

const LAYERS = [
  { url: `${BASE}/incidentUnfiltered/major_incidents.geojson`, kind: 'major-incident' },
  { url: `${BASE}/incidentUnfiltered/minor_incidents.geojson`, kind: 'minor-incident' },
  { url: `${BASE}/eventUnfiltered/active_construction.geojson`, kind: 'construction' },
] as const;

// Northern Virginia: Arlington, Alexandria, Fairfax, eastern Loudoun/PW.
const NOVA_BOUNDS = { lamin: 38.55, lamax: 39.15, lomin: -77.65, lomax: -76.9 };

interface VdotFeature {
  id?: string;
  properties?: {
    icon?: string;
    priority?: string;
    route?: string | null;
    type?: string | null;
    location?: string | null;
    location_description?: string | null;
    message_511?: string | null;
  };
  geometry?: { type?: string; coordinates?: number[] } | null;
}

interface VdotResponse {
  type?: string;
  features?: VdotFeature[];
}

/**
 * Feature ids embed the event date as MMDDYYYY (e.g. "INNO...-07042026" or
 * "WZSW...-06302025-1"). Parse it to a feed-derived UTC timestamp.
 * Exported for tests.
 */
export function parseVdotIdDate(id: string | undefined): string | null {
  if (!id) return null;
  const match = /-(\d{2})(\d{2})(\d{4})(?:-\d+)?$/.exec(id);
  if (!match) return null;
  const [, mm, dd, yyyy] = match;
  const month = parseInt(mm, 10);
  const day = parseInt(dd, 10);
  const year = parseInt(yyyy, 10);
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 2000 || year > 2100) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  // Round-trip check rejects impossible dates Date would silently roll
  // over (02/31 -> Mar 3).
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString();
}

/**
 * The feed carries no per-event timestamps, so updatedAt is the id-embedded
 * event date plus a deterministic content fingerprint (a sub-day offset
 * derived from the fields we render). Same content always maps to the same
 * updatedAt — no churn — while an escalation (minor -> major layer),
 * priority change, or message edit shifts it and re-broadcasts. Never
 * wall-clock.
 */
export function vdotContentVersion(eventDateIso: string, kind: string, props: { priority?: string; message_511?: string | null; location?: string | null }): string {
  const content = `${kind}|${props.priority ?? ''}|${props.message_511 ?? ''}|${props.location ?? ''}`;
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    hash = (hash * 31 + content.charCodeAt(i)) >>> 0;
  }
  // Offset within the event's day (0..86_399_000 ms) so age math stays sane.
  return new Date(Date.parse(eventDateIso) + (hash % 86_400_000)).toISOString();
}

export function vdotSeverity(kind: string, priority: string | undefined): 1 | 2 | 3 | 4 | 5 {
  if (kind === 'major-incident') return 4;
  if (kind === 'construction') return 2;
  const p = (priority ?? '').toLowerCase();
  if (p === 'major') return 4;
  if (p === 'moderate') return 3;
  return 2;
}

/** Normalize one VDOT feature. Exported for tests. */
export function normalizeVdotFeature(feature: VdotFeature, kind: string): Incident | null {
  const props = feature.properties ?? {};
  const coords = feature.geometry?.coordinates;
  if (!feature.id || !coords || coords.length < 2) return null;
  const [lng, lat] = coords;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (lat < NOVA_BOUNDS.lamin || lat > NOVA_BOUNDS.lamax || lng < NOVA_BOUNDS.lomin || lng > NOVA_BOUNDS.lomax) {
    return null;
  }

  // The id's embedded date is the only feed-derived time available. Events
  // without one are dropped rather than stamped with wall-clock now.
  const eventDate = parseVdotIdDate(feature.id);
  if (!eventDate) return null;

  const isConstruction = kind === 'construction';
  const what = props.type || (isConstruction ? 'Construction' : 'Incident');
  const where = props.route || props.location || 'NoVA';
  const title = `${what}: ${where}`;

  const parts: string[] = [];
  if (props.message_511) parts.push(props.message_511);
  else if (props.location_description) parts.push(props.location_description);

  return {
    id: `vdot-${feature.id}`,
    regionId: 'dc',
    type: 'traffic',
    severity: vdotSeverity(kind, props.priority),
    location: {
      lat,
      lng,
      address: props.location || props.location_description || props.route || undefined,
    },
    timestamp: eventDate,
    updatedAt: vdotContentVersion(eventDate, kind, props),
    source: 'vdot',
    title,
    description: parts.join('\n'),
    status: 'active',
    category: isConstruction ? 'construction' : (props.type || 'incident').toLowerCase(),
    metadata: {
      // Active traffic situations — exempt from the event-time filter.
      ongoing: true,
      layer: kind,
      route: props.route,
      priority: props.priority,
    },
  };
}

export class VdotFetcher extends BaseFetcher<Incident> {
  readonly incidentSource = 'vdot' as const;

  constructor() {
    // Feeds regenerate every ~60s; the traffic cron is every minute. A
    // 2-min cache halves the load while staying near-real-time.
    super('vdot', 120);
  }

  protected async fetchFromApi(): Promise<Incident[]> {
    const responses = await Promise.all(
      LAYERS.map((layer) => this.httpGet<VdotResponse>(layer.url))
    );

    const incidents: Incident[] = [];
    for (let i = 0; i < LAYERS.length; i++) {
      const response = responses[i];
      if (!response.features || !Array.isArray(response.features)) {
        // One malformed layer must fail the WHOLE snapshot — 'vdot' is
        // complete-listing, and a partial batch cross-clears the rest.
        throw new Error(`VDOT 511 (${LAYERS[i].kind}): unexpected response shape`);
      }
      let dropped = 0;
      for (const feature of response.features) {
        const incident = normalizeVdotFeature(feature, LAYERS[i].kind);
        if (incident) incidents.push(incident);
        else dropped++;
      }
      // Out-of-bbox drops are routine (statewide feed); a high ratio of
      // in-bbox parse failures would mean format drift — surface counts.
      if (dropped === response.features.length && response.features.length > 0) {
        logger.warn(`VDOT 511 (${LAYERS[i].kind}): all ${dropped} features dropped — geometry/id format may have drifted`);
      }
    }

    logger.debug(`VDOT 511: ${incidents.length} NoVA incidents/work zones`);
    return incidents;
  }
}

export const vdotFetcher = new VdotFetcher();
export default vdotFetcher;
