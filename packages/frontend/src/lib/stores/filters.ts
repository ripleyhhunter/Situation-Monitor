import { writable, derived } from 'svelte/store';
import type { FilterState, IncidentType, Incident } from '$types';
import { activeIncidents } from './incidents';

// Default filter state
const defaultFilters: FilterState = {
  incidentTypes: new Set(['traffic', 'crime', 'fire', 'weather', 'transit', 'gunshot', 'hazard']),
  minSeverity: 1,
  showCameras: true,
  showLocationOnlyCameras: false, // Hide DC cameras (no image/stream) by default
  showWeather: true,
  timeRange: '24h',
};

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

// Set time range
export function setTimeRange(range: FilterState['timeRange']): void {
  filters.update((f) => ({ ...f, timeRange: range }));
}

// Reset filters to default
export function resetFilters(): void {
  filters.set(defaultFilters);
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
