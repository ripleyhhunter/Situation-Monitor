import { writable, derived } from 'svelte/store';
import type { Aircraft, RegionId } from '$types';
import { selectedRegionId } from './region';

// Per-region aircraft maps. Each region's OpenSky bbox produces its own snapshot.
export const aircraftByRegion = writable<Record<RegionId, Map<string, Aircraft>>>({
  dc: new Map(),
  boise: new Map(),
});

/** Replace the aircraft list for one region (called from SSE on each 'aircraft:update' tick). */
export function updateAircraft(regionId: RegionId, newAircraft: Aircraft[]): void {
  aircraftByRegion.update((byRegion) => ({
    ...byRegion,
    [regionId]: new Map(newAircraft.map((a) => [a.id, a])),
  }));
}

export function clearAircraft(): void {
  aircraftByRegion.set({ dc: new Map(), boise: new Map() });
}

/** Map of aircraft for the selected region only. */
export const aircraft = derived(
  [aircraftByRegion, selectedRegionId],
  ([$byRegion, $regionId]) => $byRegion[$regionId] || new Map<string, Aircraft>(),
);

export const aircraftList = derived(aircraft, ($aircraft) =>
  Array.from($aircraft.values()),
);

export const aircraftInFlight = derived(aircraftList, ($list) =>
  $list.filter((a) => !a.onGround),
);

export const emergencyAircraft = derived(aircraftList, ($list) =>
  $list.filter((a) => a.isEmergency),
);

export const aircraftCounts = derived(aircraftList, ($list) => {
  const counts = {
    total: $list.length,
    inFlight: 0,
    onGround: 0,
    commercial: 0,
    military: 0,
    helicopter: 0,
    general: 0,
    emergency: 0,
  };

  for (const a of $list) {
    if (a.onGround) counts.onGround++;
    else counts.inFlight++;

    if (a.category === 'commercial') counts.commercial++;
    else if (a.category === 'military') counts.military++;
    else if (a.category === 'helicopter') counts.helicopter++;
    else if (a.category === 'general') counts.general++;

    if (a.isEmergency) counts.emergency++;
  }

  return counts;
});

export const selectedAircraft = writable<Aircraft | null>(null);

export function selectAircraft(aircraft: Aircraft | null): void {
  selectedAircraft.set(aircraft);
}
