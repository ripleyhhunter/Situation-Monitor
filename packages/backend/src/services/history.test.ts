import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { history } from './history.js';
import type { Incident } from '../types/index.js';

function mkIncident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: 'h-1',
    regionId: 'boise',
    type: 'crime',
    severity: 3,
    location: { lat: 43.6, lng: -116.2 },
    timestamp: '2026-07-04T10:00:00.000Z',
    updatedAt: '2026-07-04T10:00:00.000Z',
    source: 'ada-crime',
    title: 'Burglary',
    description: '',
    status: 'active',
    metadata: {},
    ...overrides,
  };
}

beforeEach(() => {
  history.initialize(':memory:');
});

afterEach(() => {
  history.close();
});

describe('history service', () => {
  it('upserts and counts incidents', () => {
    history.upsertIncident(mkIncident());
    history.upsertIncident(mkIncident({ id: 'h-2', type: 'fire' }));
    // Re-upserting the same id updates, not duplicates.
    history.upsertIncident(mkIncident({ severity: 5, updatedAt: '2026-07-04T11:00:00.000Z' }));
    expect(history.count()).toBe(2);
  });

  it('restores recent actives (the Redis-less restart path)', () => {
    history.upsertIncident(mkIncident());
    history.upsertIncident(mkIncident({ id: 'old', timestamp: '2026-07-01T00:00:00.000Z' }));
    history.upsertIncident(mkIncident({ id: 'dc-one', regionId: 'dc' }));
    history.upsertIncident(mkIncident({ id: 'cleared-one' }));
    history.markCleared('cleared-one', '2026-07-04T10:30:00.000Z');

    const restored = history.getRecentActive('boise', '2026-07-03T00:00:00.000Z');
    expect(restored.map((i) => i.id)).toEqual(['h-1']);
    expect(restored[0].location).toEqual({ lat: 43.6, lng: -116.2 });
    expect(restored[0].status).toBe('active');
    // Timestamps come back exactly as stored (feed-derived), not now.
    expect(restored[0].timestamp).toBe('2026-07-04T10:00:00.000Z');
  });

  it('aggregates daily and hourly summaries by type', () => {
    const now = Date.now();
    const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
    history.upsertIncident(mkIncident({ id: 'a', type: 'crime', timestamp: iso(1 * 60 * 60 * 1000) }));
    history.upsertIncident(mkIncident({ id: 'b', type: 'crime', timestamp: iso(2 * 60 * 60 * 1000) }));
    history.upsertIncident(mkIncident({ id: 'c', type: 'fire', timestamp: iso(3 * 60 * 60 * 1000) }));
    history.upsertIncident(mkIncident({ id: 'dc', regionId: 'dc', timestamp: iso(60 * 1000) }));

    const daily = history.getDailySummary('boise', 7);
    const totals = Object.fromEntries(daily.map((r) => [r.type, (r.count as number)]));
    expect(totals.crime).toBe(2);
    expect(totals.fire).toBe(1);

    const hourly = history.getHourlySummary('boise', 24);
    expect(hourly.reduce((sum, r) => sum + r.count, 0)).toBe(3);
    // DC rows never bleed into the boise summaries.
    expect(daily.every((r) => r.count <= 2)).toBe(true);
  });

  it('markCleared stamps the given time once', () => {
    history.upsertIncident(mkIncident());
    history.markCleared('h-1', '2026-07-04T12:00:00.000Z');
    // A later re-clear must not overwrite the original cleared_at.
    history.markCleared('h-1', '2026-07-04T13:00:00.000Z');
    const restored = history.getRecentActive('boise', '2026-07-01T00:00:00.000Z');
    expect(restored).toHaveLength(0);
  });
});
