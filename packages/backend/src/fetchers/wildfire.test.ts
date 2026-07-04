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

  it('drops features without geometry or feed timestamps', () => {
    expect(normalizeWfigsFeature(mkFeature({}, null), 'boise')).toBeNull();
    expect(normalizeWfigsFeature(mkFeature({ ModifiedOnDateTime_dt: null }), 'boise')).toBeNull();
    expect(normalizeWfigsFeature(mkFeature({ FireDiscoveryDateTime: null }), 'boise')).toBeNull();
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
