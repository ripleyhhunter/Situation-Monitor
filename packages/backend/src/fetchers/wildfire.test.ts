import { describe, it, expect } from 'vitest';
import { normalizeWfigsFeature, wildfireSeverity } from './wildfire.js';
import type { WfigsFeature } from './wildfire.js';

const DISCOVERED = Date.parse('2026-07-01T18:00:00Z');
const MODIFIED = Date.parse('2026-07-04T05:32:00Z');

function mkFeature(overrides: Partial<WfigsFeature['properties']> = {}, geometry?: WfigsFeature['geometry']): WfigsFeature {
  return {
    type: 'Feature',
    id: 42,
    properties: {
      UniqueFireIdentifier: '2026-IDBOF-000123',
      IncidentName: 'LILFREEZE',
      IncidentTypeCategory: 'WF',
      FireDiscoveryDateTime: DISCOVERED,
      ModifiedOnDateTime_dt: MODIFIED,
      IncidentSize: 250,
      PercentContained: 10,
      FireBehaviorGeneral: 'Active',
      POOCounty: 'Gem',
      POOState: 'US-ID',
      TotalIncidentPersonnel: 85,
      ...overrides,
    },
    geometry: geometry === undefined ? { type: 'Point', coordinates: [-116.4, 44.05] } : geometry,
  };
}

describe('normalizeWfigsFeature', () => {
  it('maps a wildfire feature to an Incident with feed-derived timestamps', () => {
    const incident = normalizeWfigsFeature(mkFeature(), 'boise');
    expect(incident).not.toBeNull();
    expect(incident!.id).toBe('wfigs-2026-IDBOF-000123');
    expect(incident!.type).toBe('fire');
    expect(incident!.source).toBe('wfigs');
    expect(incident!.regionId).toBe('boise');
    expect(incident!.title).toBe('Wildfire: LILFREEZE');
    expect(incident!.location).toMatchObject({ lat: 44.05, lng: -116.4 });
    // Invariant: updatedAt from the feed's ModifiedOnDateTime_dt, never now.
    expect(incident!.updatedAt).toBe(new Date(MODIFIED).toISOString());
    expect(incident!.timestamp).toBe(new Date(DISCOVERED).toISOString());
    expect(incident!.severity).toBe(4); // 250 acres
    expect(incident!.description).toContain('250 acres');
    expect(incident!.description).toContain('10% contained');
  });

  it('labels prescribed burns and caps their severity', () => {
    const incident = normalizeWfigsFeature(
      mkFeature({ IncidentTypeCategory: 'RX', IncidentSize: 5000 }),
      'boise'
    );
    expect(incident!.title).toBe('Prescribed Fire: LILFREEZE');
    expect(incident!.category).toBe('prescribed-fire');
    expect(incident!.severity).toBe(2);
  });

  it('drops features without geometry or ModifiedOnDateTime (never defaults updatedAt to now)', () => {
    expect(normalizeWfigsFeature(mkFeature({}, null), 'boise')).toBeNull();
    expect(normalizeWfigsFeature(mkFeature({ ModifiedOnDateTime_dt: null }), 'boise')).toBeNull();
  });

  it('falls back to ModifiedOnDateTime for a missing discovery date instead of dropping a live fire', () => {
    const incident = normalizeWfigsFeature(mkFeature({ FireDiscoveryDateTime: null }), 'boise');
    expect(incident).not.toBeNull();
    expect(incident!.timestamp).toBe(new Date(MODIFIED).toISOString());
    expect(incident!.updatedAt).toBe(new Date(MODIFIED).toISOString());
  });

  it('marks fires as ongoing so the frontend event-time filter exempts them', () => {
    expect(normalizeWfigsFeature(mkFeature(), 'boise')!.metadata.ongoing).toBe(true);
  });

  it('uses a coordinate id when UniqueFireIdentifier is missing (OBJECTIDs are reload-unstable)', () => {
    const incident = normalizeWfigsFeature(mkFeature({ UniqueFireIdentifier: null }), 'boise');
    expect(incident!.id).toBe('wfigs-44.05000,-116.40000');
  });

  it('falls back to DiscoveryAcres then zero for size', () => {
    const discovery = normalizeWfigsFeature(
      mkFeature({ IncidentSize: null, DiscoveryAcres: 15 }),
      'boise'
    );
    expect(discovery!.severity).toBe(3); // 15 acres
    const unknown = normalizeWfigsFeature(
      mkFeature({ IncidentSize: null, DiscoveryAcres: null }),
      'boise'
    );
    expect(unknown!.severity).toBe(2);
  });
});

describe('wildfireSeverity', () => {
  it('scales with acreage', () => {
    expect(wildfireSeverity(0, 'WF')).toBe(2);
    expect(wildfireSeverity(10, 'WF')).toBe(3);
    expect(wildfireSeverity(100, 'WF')).toBe(4);
    expect(wildfireSeverity(1000, 'WF')).toBe(5);
  });
});

describe('WildfireFetcher contract-drift guard', () => {
  it('throws (never returns []) when the response has no features array or is truncated', async () => {
    const { WildfireFetcher } = await import('./wildfire.js');
    const fetcher = new WildfireFetcher({
      regionId: 'boise',
      bounds: { lamin: 42.5, lamax: 45.0, lomin: -117.5, lomax: -114.5 },
    });
    const call = (body: unknown) => {
      (fetcher as unknown as { httpGet: () => Promise<unknown> }).httpGet = async () => body;
      return (fetcher as unknown as { fetchFromApi: () => Promise<unknown> }).fetchFromApi();
    };

    await expect(call({})).rejects.toThrow('unexpected response shape');
    await expect(call({ error: { code: 400 } })).rejects.toThrow('unexpected response shape');
    await expect(
      call({ features: [], properties: { exceededTransferLimit: true } })
    ).rejects.toThrow('truncated');
    // A genuinely empty envelope is a valid snapshot, not an error.
    await expect(call({ features: [] })).resolves.toEqual([]);
  });
});
