import { writable, derived } from 'svelte/store';
import type { Aircraft } from '$types';

// Store for all aircraft
export const aircraft = writable<Map<string, Aircraft>>(new Map());

// Update all aircraft (replaces current data)
export function updateAircraft(newAircraft: Aircraft[]): void {
  aircraft.set(new Map(newAircraft.map(a => [a.id, a])));
}

// Clear all aircraft
export function clearAircraft(): void {
  aircraft.set(new Map());
}

// Derived store for aircraft list
export const aircraftList = derived(aircraft, ($aircraft) => 
  Array.from($aircraft.values())
);

// Derived store for aircraft in flight only (not on ground)
export const aircraftInFlight = derived(aircraftList, ($list) => 
  $list.filter(a => !a.onGround)
);

// Derived store for emergency aircraft
export const emergencyAircraft = derived(aircraftList, ($list) =>
  $list.filter(a => a.isEmergency)
);

// Derived store for aircraft counts by category
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
    if (a.onGround) {
      counts.onGround++;
    } else {
      counts.inFlight++;
    }

    if (a.category === 'commercial') counts.commercial++;
    else if (a.category === 'military') counts.military++;
    else if (a.category === 'helicopter') counts.helicopter++;
    else if (a.category === 'general') counts.general++;

    if (a.isEmergency) counts.emergency++;
  }

  return counts;
});

// Selected aircraft for detail view
export const selectedAircraft = writable<Aircraft | null>(null);

export function selectAircraft(aircraft: Aircraft | null): void {
  selectedAircraft.set(aircraft);
}
