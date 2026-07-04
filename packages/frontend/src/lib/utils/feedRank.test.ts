import { describe, it, expect } from 'vitest';
import { feedRank } from './feedRank';
import type { Incident } from '$types';

const incident = (partial: Partial<Incident>): Incident =>
  ({
    id: 'x', regionId: 'boise', type: 'traffic', severity: 3,
    location: { lat: 0, lng: 0 }, timestamp: '', updatedAt: '',
    source: 'itd-events', title: '', description: '', status: 'active',
    metadata: {},
    ...partial,
  }) as Incident;

describe('feedRank', () => {
  it('puts fire/EMS dispatches and gunshots first', () => {
    expect(feedRank(incident({ type: 'fire' }))).toBe(0);
    expect(feedRank(incident({ type: 'gunshot' }))).toBe(0);
  });

  it('keeps ongoing wildfires in the top bucket despite the ongoing flag', () => {
    expect(feedRank(incident({ type: 'fire', metadata: { ongoing: true } }))).toBe(0);
  });

  it('ranks crime, weather, and live hazards second', () => {
    expect(feedRank(incident({ type: 'crime' }))).toBe(1);
    expect(feedRank(incident({ type: 'weather' }))).toBe(1);
    expect(feedRank(incident({ type: 'hazard' }))).toBe(1);
  });

  it('ranks live traffic events (crashes) above ongoing roadwork', () => {
    const crash = incident({ type: 'traffic' });
    const workZone = incident({ type: 'traffic', metadata: { ongoing: true } });
    expect(feedRank(crash)).toBe(2);
    expect(feedRank(workZone)).toBe(3);
    expect(feedRank(crash)).toBeLessThan(feedRank(workZone));
  });

  it('demotes all non-fire ongoing situations (311, closures) below live events', () => {
    expect(feedRank(incident({ type: 'hazard', metadata: { ongoing: true } }))).toBe(3);
    expect(feedRank(incident({ type: 'transit' }))).toBe(2);
  });
});
