import { describe, it, expect } from 'vitest';
import {
  extractCameraList,
  normalizeWeatherBugCamera,
} from './weatherbug-cameras.js';
import { normalizeHivisCamera, type HivisCameraRow } from './hivis-cameras.js';

describe('extractCameraList', () => {
  it('extracts the escaped-JSON cameraList from Next.js flight data', () => {
    const html =
      'prefix junk \\"cameraList\\":[{\\"id\\":\\"MOWDC\\",\\"name\\":\\"Salamander Hotel\\",\\"lat\\":38.8893,\\"lng\\":-77.0502},{\\"id\\":\\"WDCNP\\",\\"name\\":\\"Hampton Inn\\",\\"lat\\":38.8749,\\"lng\\":-77.0063}] trailing';
    const rows = extractCameraList(html);
    expect(rows).toHaveLength(2);
    expect(rows[0].id).toBe('MOWDC');
    expect(rows[1].lat).toBeCloseTo(38.8749);
  });

  it('throws on drift (no cameraList in page)', () => {
    expect(() => extractCameraList('<html>redesigned page</html>')).toThrow(/contract drift/);
  });
});

describe('normalizeWeatherBugCamera', () => {
  const row = {
    id: 'WDCNP',
    name: 'Hampton Inn',
    lat: 38.8749,
    lng: -77.0063,
    image: 'https://cameras-cam.cdn.weatherbug.net/WDCNP/2026/07/04/070420261515_s.jpg',
  };

  it('normalizes with the CDN still upgraded to the _l variant', () => {
    const cam = normalizeWeatherBugCamera(row);
    expect(cam).toMatchObject({
      id: 'weatherbug-WDCNP',
      source: 'weatherbug',
      // NEVER wwc.instacam.com — that host serves a mismatched TLS cert
      // that every browser rejects.
      imageUrl: 'https://cameras-cam.cdn.weatherbug.net/WDCNP/2026/07/04/070420261515_l.jpg',
    });
  });

  it('drops rows without a CDN image (the legacy host is not a fallback)', () => {
    expect(normalizeWeatherBugCamera({ ...row, image: undefined })).toBeNull();
  });

  it('drops out-of-DMV-bbox rows', () => {
    expect(normalizeWeatherBugCamera({ ...row, lat: 38.35, lng: -76.95 })).toBeNull();
  });

  it('drops rows without coordinates', () => {
    expect(normalizeWeatherBugCamera({ id: 'X', name: 'no coords', image: row.image })).toBeNull();
  });
});

describe('normalizeHivisCamera', () => {
  const DC = { regionId: 'dc' as const, bounds: { lamin: 38.75, lamax: 39.05, lomin: -77.35, lomax: -76.80 } };
  // Live row shape 2026-07-04: lat/lng are STRINGS.
  const row: HivisCameraRow = {
    camId: 'DC_Rock_Creek_at_Joyce_Rd_Washington',
    nwisId: '01648010',
    camName: 'Rock Creek at Joyce Rd',
    lat: '38.9573',
    lng: '-77.0435',
    hideCam: false,
    newestImageDT: '2026-07-04T19:00:04Z',
    smallDir: 'https://usgs-nims-images.s3.amazonaws.com/small/DC_Rock_Creek_at_Joyce_Rd_Washington/',
  };

  it('normalizes with string coordinates and a real feed timestamp', () => {
    const cam = normalizeHivisCamera(row, DC);
    expect(cam).toMatchObject({
      id: 'hivis-DC_Rock_Creek_at_Joyce_Rd_Washington',
      source: 'hivis',
      lastUpdated: '2026-07-04T19:00:04Z',
      imageUrl:
        'https://usgs-nims-images.s3.amazonaws.com/small/DC_Rock_Creek_at_Joyce_Rd_Washington/DC_Rock_Creek_at_Joyce_Rd_Washington_newest.jpg',
    });
    expect(cam!.location.lat).toBeCloseTo(38.9573);
  });

  it('drops hidden cameras and out-of-bbox cameras', () => {
    expect(normalizeHivisCamera({ ...row, hideCam: true }, DC)).toBeNull();
    expect(normalizeHivisCamera({ ...row, lat: '43.6', lng: '-116.2' }, DC)).toBeNull();
  });

  it('drops rows with unparseable coordinates or no image dir', () => {
    expect(normalizeHivisCamera({ ...row, lat: 'not-a-number' }, DC)).toBeNull();
    expect(normalizeHivisCamera({ ...row, smallDir: undefined, overlayDir: undefined }, DC)).toBeNull();
  });

  it('scopes to the given region', () => {
    const BOISE = { regionId: 'boise' as const, bounds: { lamin: 43.40, lamax: 43.95, lomin: -116.80, lomax: -115.85 } };
    const boiseRow = { ...row, camId: 'ID_Boise_River', lat: '43.61', lng: '-116.20' };
    expect(normalizeHivisCamera(boiseRow, BOISE)?.regionId).toBe('boise');
  });
});
