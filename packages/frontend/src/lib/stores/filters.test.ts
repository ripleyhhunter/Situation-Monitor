import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { filters, filteredIncidents, toggleJurisdiction } from './filters';
import { upsertIncident, clearAllIncidents } from './incidents';
import { selectedRegionId } from './region';
import type { Incident, FilterState } from '$types';

function mkIncident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: 'test-1',
    regionId: 'dc',
    type: 'fire',
    severity: 3,
    location: { lat: 38.9, lng: -77.0 },
    timestamp: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    source: 'pulsepoint',
    title: 'Test incident',
    description: '',
    status: 'active',
    metadata: {},
    ...overrides,
  };
}

function freshFilters(): FilterState {
  return {
    incidentTypes: new Set(['traffic', 'crime', 'fire', 'weather', 'transit', 'gunshot', 'hazard']),
    jurisdictions: new Set(['dc', 'montgomery', 'pg']),
    minSeverity: 1,
    showCameras: true,
    showWeather: true,
    showCrimeHeatmap: false,
    showRadar: false,
    showAircraft: false,
    hideGroundAircraft: true,
    timeRange: '24h',
  };
}

beforeEach(() => {
  clearAllIncidents();
  filters.set(freshFilters());
  selectedRegionId.set('dc');
});

describe('jurisdiction filtering', () => {
  it('hides DC pulsepoint incidents when the DC jurisdiction is unchecked', () => {
    upsertIncident(mkIncident({ id: 'dc-fire', regionId: 'dc', source: 'pulsepoint' }));
    expect(get(filteredIncidents).map((i) => i.id)).toEqual(['dc-fire']);

    toggleJurisdiction('dc');
    expect(get(filteredIncidents)).toEqual([]);
  });

  it('never jurisdiction-filters non-DC regions (Boise fire/EMS stays visible)', () => {
    selectedRegionId.set('boise');
    upsertIncident(mkIncident({ id: 'boise-fire', regionId: 'boise', source: 'pulsepoint' }));

    // Unchecking the DC jurisdiction previously hid Boise PulsePoint incidents.
    toggleJurisdiction('dc');
    expect(get(filteredIncidents).map((i) => i.id)).toEqual(['boise-fire']);
  });
});

describe('severity and time filtering', () => {
  it('applies minimum severity', () => {
    upsertIncident(mkIncident({ id: 'minor', severity: 1 }));
    upsertIncident(mkIncident({ id: 'major', severity: 4 }));

    filters.update((f) => ({ ...f, minSeverity: 3 }));
    expect(get(filteredIncidents).map((i) => i.id)).toEqual(['major']);
  });

  it('applies the time range window', () => {
    upsertIncident(mkIncident({ id: 'recent' }));
    upsertIncident(mkIncident({
      id: 'old',
      timestamp: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    }));

    filters.update((f) => ({ ...f, timeRange: '1h' }));
    expect(get(filteredIncidents).map((i) => i.id)).toEqual(['recent']);
  });

  it('exempts ongoing situations (active fires, work zones) from the time window', () => {
    upsertIncident(mkIncident({
      id: 'three-week-fire',
      type: 'fire',
      timestamp: new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString(),
      metadata: { ongoing: true },
    }));

    filters.update((f) => ({ ...f, timeRange: '24h' }));
    expect(get(filteredIncidents).map((i) => i.id)).toEqual(['three-week-fire']);
  });
});
