import { describe, it, expect } from 'vitest';
import { normalizeAchdFeature, achdMidpoint, achdSeverity } from './achd-closures.js';
import type { AchdFeature } from './achd-closures.js';

const START = Date.parse('2026-06-01T06:00:00Z');
const EDITED = Date.parse('2026-07-03T22:00:00Z');

function mkFeature(props: Partial<AchdFeature['properties']> = {}, geometry?: AchdFeature['geometry']): AchdFeature {
  return {
    type: 'Feature',
    properties: {
      OBJECTID: 7,
      GlobalID: '{ABC-123}',
      PROJECT_STATUS: 'Current Projects',
      ROADWAY: 'Jefferson St',
      LOCATION: '1st St to Ave B',
      START,
      FINISH: Date.parse('2026-12-31T07:00:00Z'),
      CITY: 'Boise',
      PURPOSE: 'Underground & Overhead Work',
      CONTRACTOR: 'Idaho Site Works',
      TYPE: 'Road Closure',
      last_edited_date: EDITED,
      ...props,
    },
    geometry:
      geometry === undefined
        ? { type: 'LineString', coordinates: [[-116.193, 43.6137], [-116.192, 43.6138], [-116.191, 43.6139]] }
        : geometry,
  };
}

describe('normalizeAchdFeature', () => {
  it('maps a road closure with feed-derived updatedAt and polyline midpoint', () => {
    const incident = normalizeAchdFeature(mkFeature());
    expect(incident).not.toBeNull();
    expect(incident!.id).toBe('achd-{ABC-123}');
    expect(incident!.type).toBe('traffic');
    expect(incident!.source).toBe('achd');
    expect(incident!.severity).toBe(4);
    expect(incident!.title).toBe('Road Closure: Jefferson St');
    // Midpoint vertex of the 3-point line.
    expect(incident!.location).toMatchObject({ lat: 43.6138, lng: -116.192 });
    // Invariant: updatedAt from last_edited_date, timestamp from START.
    expect(incident!.updatedAt).toBe(new Date(EDITED).toISOString());
    expect(incident!.timestamp).toBe(new Date(START).toISOString());
  });

  it('drops features without last_edited_date or geometry', () => {
    expect(normalizeAchdFeature(mkFeature({ last_edited_date: null }))).toBeNull();
    expect(normalizeAchdFeature(mkFeature({}, null))).toBeNull();
    expect(normalizeAchdFeature(mkFeature({}, { type: 'LineString', coordinates: [] }))).toBeNull();
    expect(normalizeAchdFeature(mkFeature({ GlobalID: null, OBJECTID: undefined }))).toBeNull();
  });

  it('labels future-start projects as upcoming with capped severity', () => {
    const now = Date.parse('2026-07-04T12:00:00Z');
    const futureStart = Date.parse('2026-07-06T06:00:00Z');
    const incident = normalizeAchdFeature(mkFeature({ START: futureStart, TYPE: 'Road Closure' }), now);
    expect(incident!.title).toBe('Upcoming Road Closure: Jefferson St');
    expect(incident!.severity).toBe(2); // capped: the road is still open
    expect(incident!.metadata.upcoming).toBe(true);
    expect(incident!.description).toContain('Starts:');

    // A project already underway keeps full severity.
    const active = normalizeAchdFeature(mkFeature({ TYPE: 'Road Closure' }), now);
    expect(active!.severity).toBe(4);
    expect(active!.metadata.upcoming).toBeUndefined();
  });

  it('handles MultiLineString geometry', () => {
    const incident = normalizeAchdFeature(
      mkFeature({}, { type: 'MultiLineString', coordinates: [[[-116.2, 43.6], [-116.21, 43.61]]] })
    );
    expect(incident).not.toBeNull();
    expect(incident!.location.lng).toBe(-116.21);
  });
});

describe('achdSeverity', () => {
  it('ranks project types', () => {
    expect(achdSeverity('Road Closure')).toBe(4);
    expect(achdSeverity('Lane Restrictions w/ Flagging')).toBe(3);
    expect(achdSeverity('Lane Restrictions w/ Flagging, NIGHT WORK')).toBe(3);
    expect(achdSeverity('Lane Restrictions')).toBe(2);
    expect(achdSeverity('Mobile Lane Restrictions')).toBe(2);
    expect(achdSeverity('Shoulder Work')).toBe(1);
    expect(achdSeverity('Pedestrian Restrictions')).toBe(1);
  });
});

describe('achdMidpoint', () => {
  it('returns null for degenerate geometry', () => {
    expect(achdMidpoint(null)).toBeNull();
    expect(achdMidpoint({ type: 'LineString', coordinates: [] })).toBeNull();
    expect(achdMidpoint({ type: 'MultiLineString', coordinates: [[]] })).toBeNull();
  });
});

describe('AchdClosuresFetcher contract-drift guard', () => {
  it('throws on error bodies, shape drift, and truncated snapshots', async () => {
    const { AchdClosuresFetcher } = await import('./achd-closures.js');
    const fetcher = new AchdClosuresFetcher();
    const call = (body: unknown) => {
      (fetcher as unknown as { httpGet: () => Promise<unknown> }).httpGet = async () => body;
      return (fetcher as unknown as { fetchFromApi: () => Promise<unknown> }).fetchFromApi();
    };

    await expect(call({ error: { code: 400, message: 'bad' } })).rejects.toThrow('ACHD RITA error 400');
    await expect(call({})).rejects.toThrow('unexpected response shape');
    await expect(call({ features: [], exceededTransferLimit: true })).rejects.toThrow('truncated');
    await expect(call({ features: [], properties: { exceededTransferLimit: true } })).rejects.toThrow('truncated');
    await expect(call({ features: [] })).resolves.toEqual([]);
  });
});
