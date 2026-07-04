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
    expect(feedRank(incident({ type: 'fire', source: 'pulsepoint' }))).toBe(0);
    expect(feedRank(incident({ type: 'gunshot', source: 'dc-shotspotter' }))).toBe(0);
  });

  it('keeps ongoing wildfires in the top bucket despite the ongoing flag', () => {
    expect(feedRank(incident({ type: 'fire', source: 'wfigs', metadata: { ongoing: true } }))).toBe(0);
  });

  it('ranks crime, weather, and live hazards second', () => {
    expect(feedRank(incident({ type: 'crime', source: 'bpd-crime' }))).toBe(1);
    expect(feedRank(incident({ type: 'weather', source: 'nws' }))).toBe(1);
    expect(feedRank(incident({ type: 'hazard' }))).toBe(1);
  });

  it('keeps flooding gauges at rank 1 despite their ongoing flag', () => {
    const gauge = incident({
      type: 'hazard', source: 'nws-gauge', severity: 5,
      category: 'flooding', metadata: { ongoing: true },
    });
    expect(feedRank(gauge)).toBe(1);
  });

  it('ranks live crashes above work-zone boards', () => {
    const crash = incident({ type: 'traffic', source: 'itd-events' });
    const workZone = incident({ type: 'traffic', source: 'itd-wzdx', metadata: { ongoing: true } });
    expect(feedRank(crash)).toBe(2);
    expect(feedRank(workZone)).toBe(3);
  });

  it('demotes all roadwork/311 boards regardless of type or flags', () => {
    expect(feedRank(incident({ source: 'md-wzdx' }))).toBe(3);
    expect(feedRank(incident({ source: 'achd' }))).toBe(3);
    expect(feedRank(incident({ type: 'hazard', source: 'dc-311', metadata: { ongoing: true } }))).toBe(3);
  });

  it('splits VDOT by category: live incidents rank 2, construction 3', () => {
    const vdotCrash = incident({
      type: 'traffic', source: 'vdot', category: 'accident', metadata: { ongoing: true },
    });
    const vdotWork = incident({
      type: 'traffic', source: 'vdot', category: 'construction', metadata: { ongoing: true },
    });
    expect(feedRank(vdotCrash)).toBe(2);
    expect(feedRank(vdotWork)).toBe(3);
  });

  it('ranks transit as a live event', () => {
    expect(feedRank(incident({ type: 'transit', source: 'wmata' }))).toBe(2);
  });
});
