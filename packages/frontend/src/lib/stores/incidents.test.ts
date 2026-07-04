import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import {
  incidents,
  upsertIncident,
  clearIncident,
  clearAllIncidents,
  pruneIncidentsExcept,
  activeIncidents,
  incidentsByType,
} from './incidents';
import { selectedRegionId } from './region';
import type { Incident } from '$types';

function mkIncident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: 'test-1',
    regionId: 'dc',
    type: 'traffic',
    severity: 2,
    location: { lat: 38.9, lng: -77.0 },
    timestamp: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    source: 'dc-traffic',
    title: 'Test incident',
    description: '',
    status: 'active',
    metadata: {},
    ...overrides,
  };
}

beforeEach(() => {
  clearAllIncidents();
  selectedRegionId.set('dc');
});

describe('incident store lifecycle', () => {
  it('upserts and lists active incidents for the selected region', () => {
    upsertIncident(mkIncident({ id: 'a', regionId: 'dc' }));
    upsertIncident(mkIncident({ id: 'b', regionId: 'boise' }));

    expect(get(activeIncidents).map((i) => i.id)).toEqual(['a']);

    selectedRegionId.set('boise');
    expect(get(activeIncidents).map((i) => i.id)).toEqual(['b']);
  });

  it('clearIncident deletes the entry so the map cannot grow forever', () => {
    upsertIncident(mkIncident({ id: 'a' }));
    clearIncident('a');

    expect(get(incidents).size).toBe(0);
    expect(get(activeIncidents)).toEqual([]);
  });

  it('pruneIncidentsExcept drops entries not re-sent in a reconnect snapshot', () => {
    upsertIncident(mkIncident({ id: 'kept' }));
    upsertIncident(mkIncident({ id: 'ghost' }));

    pruneIncidentsExcept(new Set(['kept']));
    expect([...get(incidents).keys()]).toEqual(['kept']);
  });

  it('tolerates an unknown IncidentType from a newer backend', () => {
    upsertIncident(mkIncident({ id: 'weird', type: 'volcano' as Incident['type'] }));

    // Must not throw and must surface the incident under its new type key.
    const byType = get(incidentsByType) as Record<string, Incident[]>;
    expect(byType['volcano'].map((i) => i.id)).toEqual(['weird']);
  });
});
