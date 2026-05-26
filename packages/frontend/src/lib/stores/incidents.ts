import { writable, derived } from 'svelte/store';
import type { Incident, IncidentType } from '$types';
import { selectedRegionId } from '$stores/region';

// Store for all incidents across every region.
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

// Derived store for active incidents in the currently selected region.
export const activeIncidents = derived(
  [incidents, selectedRegionId],
  ([$incidents, $regionId]) =>
    Array.from($incidents.values()).filter(
      (i) => i.status === 'active' && i.regionId === $regionId,
    ),
);

// Derived store for incidents by type (selected region only).
export const incidentsByType = derived(
  [incidents, selectedRegionId],
  ([$incidents, $regionId]) => {
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
      if (incident.status === 'active' && incident.regionId === $regionId) {
        byType[incident.type].push(incident);
      }
    }

    return byType;
  },
);

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

// Metro line colors for display
export const METRO_LINE_COLORS: Record<string, string> = {
  'Red Line': '#BF0D3E',
  'Blue Line': '#009CDE',
  'Orange Line': '#ED8B00',
  'Silver Line': '#919D9D',
  'Green Line': '#00B140',
  'Yellow Line': '#FFD100',
};

// Derived store for Metro delays summary
export interface MetroDelay {
  line: string;
  color: string;
  severity: string;
  count: number;
}

export const metroDelays = derived(incidentsByType, ($byType) => {
  const transitIncidents = $byType.transit;
  const delaysByLine: Map<string, MetroDelay> = new Map();

  for (const incident of transitIncidents) {
    // Extract lines from metadata
    const lines = (incident.metadata?.lines as string[]) || [];
    const severity = incident.metadata?.delaySeverity as string || 'Minor';

    for (const line of lines) {
      const existing = delaysByLine.get(line);
      if (existing) {
        existing.count++;
        // Keep the highest severity
        if (getSeverityRank(severity) > getSeverityRank(existing.severity)) {
          existing.severity = severity;
        }
      } else {
        delaysByLine.set(line, {
          line,
          color: METRO_LINE_COLORS[line] || '#6b7280',
          severity,
          count: 1,
        });
      }
    }
  }

  return Array.from(delaysByLine.values());
});

function getSeverityRank(severity: string): number {
  const ranks: Record<string, number> = {
    Minor: 1,
    Moderate: 2,
    Major: 3,
    Severe: 4,
  };
  return ranks[severity] || 0;
}
