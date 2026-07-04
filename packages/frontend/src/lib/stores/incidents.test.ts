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

describe('bulk store operations (batched SSE events)', () => {
  it('upsertIncidents applies a whole batch in one update', async () => {
    const { upsertIncidents, clearIncidents, incidents } = await import('./incidents');
    const { get } = await import('svelte/store');
    let updates = 0;
    const unsub = incidents.subscribe(() => updates++);
    const baseline = updates;

    upsertIncidents([
      { id: 'bulk-1', regionId: 'dc', type: 'fire', severity: 3, location: { lat: 38.9, lng: -77 }, timestamp: new Date().toISOString(), updatedAt: new Date().toISOString(), source: 'pulsepoint', title: 'A', description: '', status: 'active', metadata: {} },
      { id: 'bulk-2', regionId: 'dc', type: 'crime', severity: 2, location: { lat: 38.9, lng: -77 }, timestamp: new Date().toISOString(), updatedAt: new Date().toISOString(), source: 'dc-crime', title: 'B', description: '', status: 'active', metadata: {} },
    ]);
    expect(updates - baseline).toBe(1); // ONE store update for the batch
    expect(get(incidents).size).toBeGreaterThanOrEqual(2);

    clearIncidents(['bulk-1', 'bulk-2']);
    expect(updates - baseline).toBe(2);
    expect(get(incidents).has('bulk-1')).toBe(false);
    unsub();
  });

  it('empty batches are no-ops', async () => {
    const { upsertIncidents, clearIncidents, incidents } = await import('./incidents');
    let updates = 0;
    const unsub = incidents.subscribe(() => updates++);
    const baseline = updates;
    upsertIncidents([]);
    clearIncidents([]);
    expect(updates - baseline).toBe(0);
    unsub();
  });
});
