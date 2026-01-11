import { writable, derived } from 'svelte/store';
import type { Incident, IncidentType } from '$types';

// Store for all incidents
export const incidents = writable<Map<string, Incident>>(new Map());

// Add or update an incident
export function upsertIncident(incident: Incident): void {
  incidents.update((map) => {
    map.set(incident.id, incident);
    return new Map(map);
  });
}

// Remove an incident
export function removeIncident(id: string): void {
  incidents.update((map) => {
    map.delete(id);
    return new Map(map);
  });
}

// Clear an incident (mark as cleared)
export function clearIncident(id: string): void {
  incidents.update((map) => {
    const incident = map.get(id);
    if (incident) {
      map.set(id, { ...incident, status: 'cleared' });
    }
    return new Map(map);
  });
}

// Clear all incidents
export function clearAllIncidents(): void {
  incidents.set(new Map());
}

// Derived store for active incidents only
export const activeIncidents = derived(incidents, ($incidents) =>
  Array.from($incidents.values()).filter((i) => i.status === 'active')
);

// Derived store for incidents by type
export const incidentsByType = derived(incidents, ($incidents) => {
  const byType: Record<IncidentType, Incident[]> = {
    traffic: [],
    crime: [],
    fire: [],
    weather: [],
    transit: [],
    gunshot: [],
    hazard: [],
  };

  for (const incident of $incidents.values()) {
    if (incident.status === 'active') {
      byType[incident.type].push(incident);
    }
  }

  return byType;
});

// Derived store for incident counts by type
export const incidentCounts = derived(incidentsByType, ($byType) => {
  const counts: Record<IncidentType, number> = {
    traffic: 0,
    crime: 0,
    fire: 0,
    weather: 0,
    transit: 0,
    gunshot: 0,
    hazard: 0,
  };

  for (const type of Object.keys(counts) as IncidentType[]) {
    counts[type] = $byType[type].length;
  }

  return counts;
});

// Selected incident for detail view
export const selectedIncident = writable<Incident | null>(null);

export function selectIncident(incident: Incident | null): void {
  selectedIncident.set(incident);
}
