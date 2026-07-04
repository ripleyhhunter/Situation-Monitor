import type { Incident } from '$types';

/**
 * Sidebar feed ranking: live public-safety events outrank scheduled and
 * long-running situations, so 400 work zones can't bury a structure fire.
 * Lower ranks sort higher.
 *
 *   0 — fire/EMS dispatches and gunshots (responders rolling now); active
 *       wildfires stay here despite their `ongoing` flag
 *   1 — crime, weather alerts, live hazards (debris, flooding gauges)
 *   2 — live traffic events (crashes, stopped vehicles) and transit
 *   3 — roadwork boards and service-request queues: work zones, closures,
 *       311 — still listed, but below anything happening *now*
 *
 * Demotion keys on what the SOURCE is (a roadwork/311 board), NOT the
 * `ongoing` metadata flag: `ongoing` only means "exempt from the
 * event-time filter", and live-event feeds set it too — VDOT incidents
 * (synthetic timestamps) and flooding gauges (persistent live condition).
 * Those must never sink below roadwork.
 */
const ROADWORK_311_SOURCES: ReadonlySet<string> = new Set([
  'itd-wzdx', // ITD work zones (WZDx)
  'md-wzdx',  // MDOT work zones (WZDx)
  'achd',     // Ada County Highway District roadwork/closures
  'dc-311',   // DC 311 service requests
]);

export function feedRank(incident: Incident): number {
  if (incident.type === 'fire' || incident.type === 'gunshot') return 0;
  if (
    ROADWORK_311_SOURCES.has(incident.source) ||
    // VDOT mixes live incidents and construction in one source; only the
    // construction rows are roadwork.
    (incident.source === 'vdot' && incident.category === 'construction')
  ) {
    return 3;
  }
  switch (incident.type) {
    case 'crime':
    case 'weather':
    case 'hazard':
      return 1;
    default:
      return 2;
  }
}
