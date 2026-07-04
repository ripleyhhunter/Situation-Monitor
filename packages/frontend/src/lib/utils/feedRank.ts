import type { Incident } from '$types';

/**
 * Sidebar feed ranking: live public-safety events outrank long-running
 * situations, so 400 work zones can't bury a structure fire. Lower ranks
 * sort higher.
 *
 *   0 — fire/EMS dispatches and gunshots (responders rolling now). Active
 *       wildfires keep this rank even though they're flagged `ongoing` —
 *       an uncontained fire is never lower priority than roadwork.
 *   1 — crime, weather alerts, live hazards (debris, flooding gauges)
 *   2 — live traffic events (crashes, stopped vehicles) and transit
 *   3 — ongoing situations: work zones, closures, open 311 requests —
 *       still listed, but below anything happening *now*.
 */
export function feedRank(incident: Incident): number {
  if (incident.type === 'fire' || incident.type === 'gunshot') return 0;
  if (incident.metadata?.ongoing === true) return 3;
  switch (incident.type) {
    case 'crime':
    case 'weather':
    case 'hazard':
      return 1;
    default:
      return 2;
  }
}
