import { writable, derived } from 'svelte/store';
import type { FilterState, IncidentType, Incident, Jurisdiction, DataSource } from '$types';
import { activeIncidents } from './incidents';

// Default filter state
const defaultFilters: FilterState = {
  incidentTypes: new Set(['traffic', 'crime', 'fire', 'weather', 'transit', 'gunshot', 'hazard']),
  jurisdictions: new Set(['dc', 'montgomery', 'pg']), // All jurisdictions enabled by default
  minSeverity: 1,
  showCameras: true,
  showLocationOnlyCameras: false, // Hide DC cameras (no image/stream) by default
  showWeather: true,
  showCrimeHeatmap: false, // Toggle between markers and heatmap for crime data
  showAircraft: false, // Aircraft OFF by default to save API quota
  hideGroundAircraft: true, // Hide aircraft on the ground by default
  timeRange: '24h',
};

// Map an incident to a jurisdiction. Jurisdictions (DC/MoCo/PG) are a
// DC-region concept — incidents from other regions are never filtered by
// them (a Boise PulsePoint incident is not "Washington, DC").
function getJurisdictionForIncident(incident: Incident): Jurisdiction | null {
  if (incident.regionId !== 'dc') return null;

  switch (incident.source as DataSource) {
    case 'dc-crime':
    case 'dc-shotspotter':
    case 'dc-traffic':
    case 'alertdc':
    case 'pulsepoint':
      return 'dc';
    case 'moco-crime':
      return 'montgomery';
    case 'pg-crime':
      return 'pg';
    default:
      // For sources like mdchart, nws, wmata - don't filter by jurisdiction
      return null;
  }
}

// Filters store
export const filters = writable<FilterState>(defaultFilters);

// Toggle incident type filter
export function toggleIncidentType(type: IncidentType): void {
  filters.update((f) => {
    const newTypes = new Set(f.incidentTypes);
    if (newTypes.has(type)) {
      newTypes.delete(type);
    } else {
      newTypes.add(type);
    }
    return { ...f, incidentTypes: newTypes };
  });
}

// Toggle jurisdiction filter
export function toggleJurisdiction(jurisdiction: Jurisdiction): void {
  filters.update((f) => {
    const newJurisdictions = new Set(f.jurisdictions);
    if (newJurisdictions.has(jurisdiction)) {
      newJurisdictions.delete(jurisdiction);
    } else {
      newJurisdictions.add(jurisdiction);
    }
    return { ...f, jurisdictions: newJurisdictions };
  });
}

// Set minimum severity
export function setMinSeverity(severity: number): void {
  filters.update((f) => ({ ...f, minSeverity: Math.max(1, Math.min(5, severity)) }));
}

// Toggle cameras visibility
export function toggleCameras(): void {
  filters.update((f) => ({ ...f, showCameras: !f.showCameras }));
}

// Toggle location-only cameras visibility
export function toggleLocationOnlyCameras(): void {
  filters.update((f) => ({ ...f, showLocationOnlyCameras: !f.showLocationOnlyCameras }));
}

// Toggle weather visibility
export function toggleWeather(): void {
  filters.update((f) => ({ ...f, showWeather: !f.showWeather }));
}

// Toggle crime heatmap
export function toggleCrimeHeatmap(): void {
  filters.update((f) => ({ ...f, showCrimeHeatmap: !f.showCrimeHeatmap }));
}

// Toggle aircraft visibility
export function toggleAircraft(): void {
  filters.update((f) => {
    const newShowAircraft = !f.showAircraft;
    
    // Notify server about preference change (saves API quota when aircraft disabled)
    // Import dynamically to avoid circular dependency
    import('$services/sse').then(({ sseService }) => {
      sseService.updateAircraftPreference(newShowAircraft);
    });
    
    return { ...f, showAircraft: newShowAircraft };
  });
}

// Toggle ground aircraft visibility
export function toggleGroundAircraft(): void {
  filters.update((f) => ({ ...f, hideGroundAircraft: !f.hideGroundAircraft }));
}

// Set time range
export function setTimeRange(range: FilterState['timeRange']): void {
  filters.update((f) => ({ ...f, timeRange: range }));
}

// Reset filters to default
export function resetFilters(): void {
  filters.set(defaultFilters);

  // Keep the server-side aircraft preference in sync (defaults have it off),
  // otherwise the backend keeps polling OpenSky for a layer nobody shows.
  import('$services/sse').then(({ sseService }) => {
    sseService.updateAircraftPreference(defaultFilters.showAircraft);
  });
}

// Helper function to filter by time
function isWithinTimeRange(timestamp: string, range: FilterState['timeRange']): boolean {
  if (range === 'all') return true;

  const now = Date.now();
  const incidentTime = new Date(timestamp).getTime();

  const ranges: Record<string, number> = {
    '1h': 60 * 60 * 1000,
    '6h': 6 * 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
  };

  return now - incidentTime <= (ranges[range] || Infinity);
}

// Derived store for filtered incidents
export const filteredIncidents = derived(
  [activeIncidents, filters],
  ([$incidents, $filters]) => {
    return $incidents.filter((incident: Incident) => {
      // Check incident type
      if (!$filters.incidentTypes.has(incident.type)) {
        return false;
      }

      // Check jurisdiction (only for sources that have a jurisdiction)
      const jurisdiction = getJurisdictionForIncident(incident);
      if (jurisdiction !== null && !$filters.jurisdictions.has(jurisdiction)) {
        return false;
      }

      // Check severity
      if (incident.severity < $filters.minSeverity) {
        return false;
      }

      // Check time range
      if (!isWithinTimeRange(incident.timestamp, $filters.timeRange)) {
        return false;
      }

      return true;
    });
  }
);

// Derived store for incidents in the last 24 hours (for header display)
// This is always 24h regardless of the current filter setting
export const incidents24h = derived(
  activeIncidents,
  ($incidents) => {
    const twentyFourHoursAgo = Date.now() - (24 * 60 * 60 * 1000);
    return $incidents.filter((incident: Incident) => {
      const incidentTime = new Date(incident.timestamp).getTime();
      return incidentTime >= twentyFourHoursAgo;
    });
  }
);

// Count of incidents in last 24 hours
export const incidents24hCount = derived(
  incidents24h,
  ($incidents) => $incidents.length
);
