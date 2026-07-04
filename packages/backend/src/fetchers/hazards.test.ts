import { describe, it, expect } from 'vitest';
import { normalizeQuakeFeature, quakeSeverity } from './usgs-quakes.js';
import { normalizeFloodingGauge, NwsGaugesFetcher } from './nws-gauges.js';
import type { NwpsGauge } from './nws-gauges.js';

const ORIGIN = Date.parse('2026-07-03T22:10:00Z');
const REVISED = Date.parse('2026-07-04T01:00:00Z');

describe('normalizeQuakeFeature', () => {
  const feature = {
    id: 'us7000test',
    properties: { mag: 2.9, place: '15 km NE of Boise, Idaho', time: ORIGIN, updated: REVISED },
    geometry: { coordinates: [-116.05, 43.72, 9.4] },
  };

  it('maps a quake with origin time and USGS revision time', () => {
    const incident = normalizeQuakeFeature(feature, 'boise');
    expect(incident!.id).toBe('usgs-quake-us7000test');
    expect(incident!.type).toBe('hazard');
    expect(incident!.severity).toBe(2);
    expect(incident!.title).toBe('M2.9 Earthquake — 15 km NE of Boise, Idaho');
    expect(incident!.location).toMatchObject({ lat: 43.72, lng: -116.05 });
    // Invariant: timestamp = origin, updatedAt = USGS's own revision time.
    expect(incident!.timestamp).toBe(new Date(ORIGIN).toISOString());
    expect(incident!.updatedAt).toBe(new Date(REVISED).toISOString());
  });

  it('drops features missing id, coordinates, or feed times', () => {
    expect(normalizeQuakeFeature({ ...feature, id: undefined }, 'boise')).toBeNull();
    expect(normalizeQuakeFeature({ ...feature, geometry: null }, 'boise')).toBeNull();
    expect(
      normalizeQuakeFeature({ ...feature, properties: { ...feature.properties, updated: null } }, 'boise')
    ).toBeNull();
  });
});

describe('quakeSeverity', () => {
  it('scales with magnitude', () => {
    expect(quakeSeverity(1.2)).toBe(1);
    expect(quakeSeverity(2.5)).toBe(2);
    expect(quakeSeverity(3.4)).toBe(3);
    expect(quakeSeverity(4.7)).toBe(4);
    expect(quakeSeverity(5.8)).toBe(5);
  });
});

function mkGauge(overrides: Partial<NwpsGauge> = {}, observed: Partial<NonNullable<NonNullable<NwpsGauge['status']>['observed']>> = {}): NwpsGauge {
  return {
    lid: 'BIGI1',
    name: 'Boise River at Glenwood Bridge',
    latitude: 43.66,
    longitude: -116.28,
    status: {
      observed: {
        primary: 10.4,
        primaryUnit: 'ft',
        floodCategory: 'minor',
        validTime: '2026-07-04T10:45:00Z',
        ...observed,
      },
    },
    ...overrides,
  };
}

describe('normalizeFloodingGauge', () => {
  it('emits an incident for a gauge at/above action stage', () => {
    const incident = normalizeFloodingGauge(mkGauge(), 'boise');
    expect(incident!.id).toBe('nws-gauge-BIGI1');
    expect(incident!.severity).toBe(3); // minor
    expect(incident!.title).toBe('Minor flooding — Boise River at Glenwood Bridge');
    expect(incident!.updatedAt).toBe('2026-07-04T10:45:00Z');
    expect(incident!.metadata.ongoing).toBe(true);
    expect(incident!.description).toContain('10.4 ft');
  });

  it('stays silent below action stage', () => {
    expect(normalizeFloodingGauge(mkGauge({}, { floodCategory: 'no_flooding' }), 'boise')).toBeNull();
    expect(normalizeFloodingGauge(mkGauge({}, { floodCategory: 'not_defined' }), 'boise')).toBeNull();
    expect(normalizeFloodingGauge(mkGauge({}, { floodCategory: undefined }), 'boise')).toBeNull();
  });

  it('grades severity by flood category', () => {
    expect(normalizeFloodingGauge(mkGauge({}, { floodCategory: 'action' }), 'boise')!.severity).toBe(2);
    expect(normalizeFloodingGauge(mkGauge({}, { floodCategory: 'moderate' }), 'boise')!.severity).toBe(4);
    expect(normalizeFloodingGauge(mkGauge({}, { floodCategory: 'major' }), 'boise')!.severity).toBe(5);
  });

  it('handles sentinel stage values without reporting garbage', () => {
    const incident = normalizeFloodingGauge(mkGauge({}, { primary: -9999 }), 'boise');
    expect(incident).not.toBeNull();
    expect(incident!.description).toContain('stage unavailable');
    expect(incident!.metadata.stage).toBeUndefined();
  });

  it('drops gauges without coordinates or observation time', () => {
    expect(normalizeFloodingGauge(mkGauge({ latitude: undefined }), 'boise')).toBeNull();
    expect(normalizeFloodingGauge(mkGauge({}, { validTime: undefined }), 'boise')).toBeNull();
  });
});

describe('NwsGaugesFetcher contract-drift guard', () => {
  it('throws on missing or EMPTY gauge lists (the srid silent-failure trap)', async () => {
    const fetcher = new NwsGaugesFetcher({
      regionId: 'boise',
      bbox: { xmin: -116.8, ymin: 43.4, xmax: -115.85, ymax: 43.95 },
    });
    const call = (body: unknown) => {
      (fetcher as unknown as { httpGet: () => Promise<unknown> }).httpGet = async () => body;
      return (fetcher as unknown as { fetchFromApi: () => Promise<unknown> }).fetchFromApi();
    };

    await expect(call({})).rejects.toThrow('unexpected response shape');
    await expect(call({ gauges: [] })).rejects.toThrow('contract drift');
    // Gauges present but none flooding is the normal quiet state.
    await expect(call({ gauges: [mkGauge({}, { floodCategory: 'no_flooding' })] })).resolves.toEqual([]);
  });
});
