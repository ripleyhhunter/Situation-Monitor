import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./cache.js', () => ({
  cache: {
    keys: async () => [],
    get: async () => null,
    set: async () => undefined,
  },
}));

import {
  GeocacheService,
  hasHouseNumber,
  isIntersection,
  streetCore,
  matchesQueriedStreet,
} from './geocache.js';

const DC = { city: 'Washington', state: 'DC', center: { lat: 38.9072, lng: -77.0369 } };

const censusHit = (lat: number, lng: number) => ({
  ok: true,
  status: 200,
  json: async () => ({ result: { addressMatches: [{ coordinates: { x: lng, y: lat }, matchedAddress: 'MATCH' }] } }),
});
const censusMiss = () => ({
  ok: true,
  status: 200,
  json: async () => ({ result: { addressMatches: [] } }),
});
const nominatimHit = (lat: number, lng: number, road: string) => ({
  ok: true,
  status: 200,
  json: async () => [{ lat: String(lat), lon: String(lng), display_name: `${road}, Washington, DC`, address: { road } }],
});
const http429 = () => ({ ok: false, status: 429, json: async () => ({}) });

let fetchMock: ReturnType<typeof vi.fn>;
let svc: GeocacheService;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  svc = new GeocacheService({ nominatimIntervalMs: 0, censusIntervalMs: 0, nominatimBackoffMs: 60_000 });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const calledUrls = () => fetchMock.mock.calls.map((c) => String(c[0]));

describe('address helpers', () => {
  it('detects house numbers but not ordinal street names', () => {
    expect(hasHouseNumber('5410 CONNECTICUT AVE NW')).toBe(true);
    expect(hasHouseNumber('14TH ST NW')).toBe(false);
    expect(hasHouseNumber('P ST NW')).toBe(false);
  });

  it('detects intersections', () => {
    expect(isIntersection('14TH ST NW / U ST NW')).toBe(true);
    expect(isIntersection('14TH ST NW & U ST NW')).toBe(true);
    expect(isIntersection('H ST AND 8TH ST NE')).toBe(true);
    expect(isIntersection('5410 CONNECTICUT AVE NW')).toBe(false);
    // Venue-style addresses with a house number are NOT intersections —
    // classifying them as such would skip Census and street validation.
    expect(isIntersection('1200 SHOPS AT GEORGETOWN PKWY')).toBe(false);
  });

  it('extracts the distinguishing street token', () => {
    expect(streetCore('5410 CONNECTICUT AVE NW, WASHINGTON, DC')).toBe('connecticut');
    expect(streetCore('48TH ST NE')).toBe('48th');
  });

  it('rejects answers on a different street (the Belmont case)', () => {
    expect(matchesQueriedStreet('5410 CONNECTICUT AVE NW, WASHINGTON, DC', 'Belmont Street Northwest')).toBe(false);
    expect(matchesQueriedStreet('5410 CONNECTICUT AVE NW, WASHINGTON, DC', 'Connecticut Avenue Northwest')).toBe(true);
  });
});

describe('resolution chain', () => {
  it('resolves house-numbered addresses via Census first, exactly, and caches', async () => {
    fetchMock.mockResolvedValueOnce(censusHit(38.9617, -77.0738));

    const result = await svc.geocode('5410 CONNECTICUT AVE NW, WASHINGTON, DC', DC);
    expect(result).toEqual({ lat: 38.9617, lng: -77.0738, cached: false, approximate: false });
    expect(calledUrls()).toHaveLength(1);
    expect(calledUrls()[0]).toContain('census.gov');

    // Second lookup: served from cache, no new fetch.
    const again = await svc.geocode('5410 CONNECTICUT AVE NW, WASHINGTON, DC', DC);
    expect(again).toEqual({ lat: 38.9617, lng: -77.0738, cached: true, approximate: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls to validated Nominatim when Census misses', async () => {
    fetchMock
      .mockResolvedValueOnce(censusMiss())
      .mockResolvedValueOnce(nominatimHit(38.95, -77.07, 'Connecticut Avenue Northwest'));

    const result = await svc.geocode('5411 CONNECTICUT AVE NW, WASHINGTON, DC', DC);
    expect(result?.approximate).toBe(false);
    expect(result?.lat).toBeCloseTo(38.95);
    expect(calledUrls()[1]).toContain('nominatim');
  });

  it('rejects a wrong-street Nominatim answer and degrades to the street centroid, marked approximate', async () => {
    fetchMock
      .mockResolvedValueOnce(censusMiss())
      // Full-address query fuzzy-matches a different street — must be rejected.
      .mockResolvedValueOnce(nominatimHit(38.9205, -77.0329, 'Belmont Street Northwest'))
      // Street-only retry lands on the right corridor.
      .mockResolvedValueOnce(nominatimHit(38.958, -77.075, 'Connecticut Avenue Northwest'));

    const result = await svc.geocode('5412 CONNECTICUT AVE NW, WASHINGTON, DC', DC);
    expect(result).not.toBeNull();
    expect(result?.approximate).toBe(true);
    expect(result?.lat).toBeCloseTo(38.958);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('backs off hard on a Nominatim 429 instead of hammering', async () => {
    fetchMock.mockResolvedValueOnce(http429());

    // Bare street: census is skipped, nominatim 429s.
    const first = await svc.geocode('P ST NW, WASHINGTON, DC', DC);
    expect(first).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Different address inside the backoff window: NO fetch at all.
    const second = await svc.geocode('Q ST NW, WASHINGTON, DC', DC);
    expect(second).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('skips street validation for intersections', async () => {
    fetchMock.mockResolvedValueOnce(nominatimHit(38.917, -77.032, 'U Street Northwest'));

    const result = await svc.geocode('14TH ST NW / U ST NW, WASHINGTON, DC', DC);
    expect(result?.approximate).toBe(false);
    expect(result?.lat).toBeCloseTo(38.917);
    // Intersections never touch Census.
    expect(calledUrls()).toHaveLength(1);
    expect(calledUrls()[0]).toContain('nominatim');
  });

  it('expires approximate memory-cache entries so pins can upgrade later', async () => {
    vi.useFakeTimers({ now: new Date('2026-07-04T18:00:00Z') });
    try {
      // First resolution degrades to a street centroid (approximate).
      fetchMock
        .mockResolvedValueOnce(censusMiss())
        .mockResolvedValueOnce(nominatimHit(38.9205, -77.0329, 'Belmont Street Northwest'))
        .mockResolvedValueOnce(nominatimHit(38.958, -77.075, 'Connecticut Avenue Northwest'));
      const degraded = await svc.geocode('5414 CONNECTICUT AVE NW, WASHINGTON, DC', DC);
      expect(degraded?.approximate).toBe(true);

      // Within the 6h TTL: served from cache.
      vi.setSystemTime(new Date('2026-07-04T20:00:00Z'));
      const within = await svc.geocode('5414 CONNECTICUT AVE NW, WASHINGTON, DC', DC);
      expect(within).toMatchObject({ cached: true, approximate: true });

      // Past the 6h TTL: the memory entry must expire and the address
      // re-resolve — this time Census answers exactly.
      vi.setSystemTime(new Date('2026-07-05T01:00:00Z'));
      fetchMock.mockResolvedValueOnce(censusHit(38.9617, -77.0738));
      const upgraded = await svc.geocode('5414 CONNECTICUT AVE NW, WASHINGTON, DC', DC);
      expect(upgraded).toEqual({ lat: 38.9617, lng: -77.0738, cached: false, approximate: false });
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects hits far from the region center', async () => {
    fetchMock
      .mockResolvedValueOnce(censusHit(34.05, -118.24)) // LA — wrong-city match
      .mockResolvedValueOnce(nominatimHit(34.05, -118.24, 'Connecticut Street'))
      .mockResolvedValueOnce(nominatimHit(34.05, -118.24, 'Connecticut Street'));

    const result = await svc.geocode('5413 CONNECTICUT AVE NW, WASHINGTON, DC', DC);
    expect(result).toBeNull();
  });
});
