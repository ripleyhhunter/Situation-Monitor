import { describe, it, expect } from 'vitest';
import { parseWktPoint, normalizeIdaho511Site, Idaho511CamerasFetcher } from './idaho511-cameras.js';
import type { Idaho511Site } from './idaho511-cameras.js';

function mkSite(overrides: Partial<Idaho511Site> = {}): Idaho511Site {
  return {
    id: 461,
    visible: true,
    roadway: 'SH-55',
    direction: 'Unknown',
    location: 'SH-55 Eagle Rd & Fairview Ave',
    images: [{ id: 656, imageUrl: '/map/Cctv/656', refreshRateMs: 15000 }],
    latLng: { geography: { wellKnownText: 'POINT (-116.35405 43.61945)' } },
    lastUpdated: '2026-01-15T10:00:00+00:00',
    ...overrides,
  };
}

describe('parseWktPoint', () => {
  it('parses POINT with negative longitude', () => {
    expect(parseWktPoint('POINT (-116.198 43.6011)')).toEqual([-116.198, 43.6011]);
  });
  it('rejects garbage', () => {
    expect(parseWktPoint(undefined)).toBeNull();
    expect(parseWktPoint('LINESTRING (1 2, 3 4)')).toBeNull();
    expect(parseWktPoint('POINT ()')).toBeNull();
  });
});

describe('normalizeIdaho511Site', () => {
  it('maps a Treasure Valley site to a Camera with the image proxy URL', () => {
    const camera = normalizeIdaho511Site(mkSite());
    expect(camera).not.toBeNull();
    expect(camera!.id).toBe('idaho511-461');
    expect(camera!.regionId).toBe('boise');
    expect(camera!.source).toBe('idaho511');
    expect(camera!.name).toBe('SH-55 Eagle Rd & Fairview Ave');
    expect(camera!.imageUrl).toBe('https://511.idaho.gov/map/Cctv/656');
    expect(camera!.location).toMatchObject({ lat: 43.61945, lng: -116.35405 });
    // Invariant: lastUpdated from the roster's own timestamp, never now.
    expect(camera!.lastUpdated).toBe('2026-01-15T10:00:00+00:00');
  });

  it('filters sites outside the Treasure Valley', () => {
    const utahBorder = mkSite({
      latLng: { geography: { wellKnownText: 'POINT (-112.198 42.0011)' } },
    });
    expect(normalizeIdaho511Site(utahBorder)).toBeNull();
  });

  it('skips invisible sites, missing geometry, and dead images', () => {
    expect(normalizeIdaho511Site(mkSite({ visible: false }))).toBeNull();
    expect(normalizeIdaho511Site(mkSite({ latLng: undefined }))).toBeNull();
    expect(normalizeIdaho511Site(mkSite({ images: [] }))).toBeNull();
    expect(normalizeIdaho511Site(mkSite({ images: [{ imageUrl: '/map/Cctv/1', disabled: true }] }))).toBeNull();
    expect(normalizeIdaho511Site(mkSite({ images: [{ imageUrl: '/map/Cctv/1', blocked: true }] }))).toBeNull();
  });

  it('picks the first usable image when some are disabled', () => {
    const camera = normalizeIdaho511Site(
      mkSite({
        images: [
          { id: 1, imageUrl: '/map/Cctv/1', disabled: true },
          { id: 2, imageUrl: '/map/Cctv/2' },
        ],
      })
    );
    expect(camera!.imageUrl).toBe('https://511.idaho.gov/map/Cctv/2');
  });
});

describe('Idaho511CamerasFetcher contract-drift guard', () => {
  it('throws on shape drift instead of returning an empty roster', async () => {
    const fetcher = new Idaho511CamerasFetcher();
    const call = (body: unknown) => {
      (fetcher as unknown as { httpPostForm: () => Promise<unknown> }).httpPostForm = async () => body;
      return (fetcher as unknown as { fetchFromApi: () => Promise<unknown> }).fetchFromApi();
    };

    await expect(call({})).rejects.toThrow('unexpected response shape');
    await expect(call({ recordsTotal: 457, data: [] })).rejects.toThrow('roster came back empty');
    // Rows that all fail to parse (e.g. WKT format change) are drift too.
    await expect(
      call({ recordsTotal: 1, data: [{ id: 1, latLng: { geography: { wellKnownText: 'BLOB' } } }] })
    ).rejects.toThrow('schema drift');
  });
});
