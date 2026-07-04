import { describe, it, expect } from 'vitest';
import { matchDc311Category, normalizeDc311Row, Dc311Fetcher } from './dc-311.js';
import type { Dc311Attributes } from './dc-311.js';

const NOW = Date.parse('2026-07-04T12:00:00Z');

function mkRow(overrides: Partial<Dc311Attributes> = {}): Dc311Attributes {
  return {
    SERVICEREQUESTID: '26-00412345',
    SERVICECODEDESCRIPTION: 'Traffic Lights and Pedestrian Walk Signals',
    SERVICEORDERSTATUS: 'Open',
    ADDDATE: NOW - 30 * 60 * 1000,
    LATITUDE: 38.902,
    LONGITUDE: -77.024,
    WARD: '2',
    STREETADDRESS: '1400 K ST NW',
    ...overrides,
  };
}

describe('matchDc311Category', () => {
  it('keeps situational categories with type/severity mapping', () => {
    expect(matchDc311Category('Traffic Lights and Pedestrian Walk Signals')).toEqual({ type: 'traffic', severity: 3 });
    expect(matchDc311Category('Wire Down')).toEqual({ type: 'hazard', severity: 4 });
    expect(matchDc311Category('Flooding, Standing Water')).toEqual({ type: 'hazard', severity: 4 });
    expect(matchDc311Category('Emergency - Tree Down')).toEqual({ type: 'hazard', severity: 3 });
    expect(matchDc311Category('Water Main Break')).toEqual({ type: 'hazard', severity: 3 });
  });

  it('rejects the 311 firehose noise', () => {
    for (const noise of [
      'Scheduled Yard Waste',
      'Bulk Collection',
      'Out of State Parking Violation (ROSA)',
      'Sanitation Enforcement',
      'DC Health Rodent & Vector Control',
      'Streetlight Repair Investigation', // deliberate: too chronic/noisy
      null,
    ]) {
      expect(matchDc311Category(noise)).toBeNull();
    }
  });
});

describe('normalizeDc311Row', () => {
  it('maps an open situational request with feed-derived timestamps', () => {
    const incident = normalizeDc311Row(mkRow(), NOW);
    expect(incident).not.toBeNull();
    expect(incident!.id).toBe('dc-311-26-00412345');
    expect(incident!.type).toBe('traffic');
    expect(incident!.source).toBe('dc-311');
    expect(incident!.updatedAt).toBe(new Date(NOW - 30 * 60 * 1000).toISOString());
    expect(incident!.description).toContain('Ward 2');
  });

  it('applies the 24h client-side window (matches the aggregator expiry)', () => {
    const old = mkRow({ ADDDATE: NOW - 25 * 60 * 60 * 1000 });
    expect(normalizeDc311Row(old, NOW)).toBeNull();
  });

  it('drops closed/resolved requests and rows without coordinates', () => {
    expect(normalizeDc311Row(mkRow({ SERVICEORDERSTATUS: 'Closed' }), NOW)).toBeNull();
    expect(normalizeDc311Row(mkRow({ LATITUDE: null }), NOW)).toBeNull();
    expect(normalizeDc311Row(mkRow({ LATITUDE: 0, LONGITUDE: 0 }), NOW)).toBeNull();
    expect(normalizeDc311Row(mkRow({ ADDDATE: null }), NOW)).toBeNull();
  });
});

describe('Dc311Fetcher contract-drift guard', () => {
  it('throws on error bodies and shape drift', async () => {
    const fetcher = new Dc311Fetcher();
    const call = (body: unknown) => {
      (fetcher as unknown as { httpGet: () => Promise<unknown> }).httpGet = async () => body;
      return (fetcher as unknown as { fetchFromApi: () => Promise<unknown> }).fetchFromApi();
    };
    await expect(call({ error: { code: 400, message: 'bad' } })).rejects.toThrow('DC 311 error 400');
    await expect(call({})).rejects.toThrow('unexpected response shape');
    await expect(call({ features: [] })).resolves.toEqual([]);
  });
});
