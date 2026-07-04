import { describe, it, expect } from 'vitest';
import { normalizeVdotCamera, vdotSnapshotUrl, type VdotCameraFeature } from './vdot-cameras.js';
import { normalizeArlingtonCamera, type ArlingtonCameraRow } from './arlington-cameras.js';
import { normalizePgcCamera, type PgcCameraFeature } from './pgc-cameras.js';

// Live roster rows as served 2026-07-04 (camera coverage sweep).
const vdotRow: VdotCameraFeature = {
  type: 'Feature',
  properties: {
    id: '3958',
    description: 'University Drive and Sager Avenue',
    active: true,
    image_url: 'https://snapshot.vdotcameras.com/thumbs/FairfaxVideo1010.flv.png',
    https_url: 'https://media-sfs7.vdotcameras.com/rtplive/FairfaxVideo1010/playlist.m3u8',
  },
  geometry: { type: 'Point', coordinates: [-77.3055, 38.84519] },
};

describe('vdotSnapshotUrl', () => {
  it('derives the direct snapshot from the thumbs redirect URL', () => {
    expect(vdotSnapshotUrl('https://snapshot.vdotcameras.com/thumbs/FairfaxVideo1010.flv.png')).toBe(
      'https://snapshot.vdotcameras.com/FairfaxVideo1010.png',
    );
    // City-of-Fairfax hash-named cameras follow the same transform.
    expect(vdotSnapshotUrl('https://snapshot.vdotcameras.com/thumbs/0i6a7bfbs60yq2lbgivq0b8xk3scij3c.flv.png')).toBe(
      'https://snapshot.vdotcameras.com/0i6a7bfbs60yq2lbgivq0b8xk3scij3c.png',
    );
    expect(vdotSnapshotUrl(null)).toBeUndefined();
  });
});

describe('normalizeVdotCamera', () => {
  it('normalizes an active NoVA camera with still and stream', () => {
    const cam = normalizeVdotCamera(vdotRow);
    expect(cam).toMatchObject({
      id: 'vdot-3958',
      regionId: 'dc',
      source: 'vdot',
      name: 'University Drive and Sager Avenue',
      imageUrl: 'https://snapshot.vdotcameras.com/FairfaxVideo1010.png',
      streamUrl: 'https://media-sfs7.vdotcameras.com/rtplive/FairfaxVideo1010/playlist.m3u8',
    });
    expect(cam!.location).toEqual({ lat: 38.84519, lng: -77.3055 });
  });

  it('drops inactive cameras and out-of-bbox (statewide) cameras', () => {
    expect(normalizeVdotCamera({ ...vdotRow, properties: { ...vdotRow.properties, active: false } })).toBeNull();
    // Richmond-area camera: statewide roster, outside the DC metro bbox.
    expect(
      normalizeVdotCamera({ ...vdotRow, geometry: { coordinates: [-77.46, 37.54] } }),
    ).toBeNull();
  });

  it('drops rows without geometry', () => {
    expect(normalizeVdotCamera({ ...vdotRow, geometry: undefined })).toBeNull();
  });
});

const arlingtonRow: ArlingtonCameraRow = {
  attributes: {
    Camera_Sit: 'cam1',
    Camera_Enc: 'Columbia Pike @ Walter Reed',
    Latitude: 38.862563,
    Longitude: -77.08702,
    Status: 'ONLINE',
    URL: 'https://itsvideo.arlingtonva.us:8011/live/cam1.stream/playlist.m3u8',
  },
};

describe('normalizeArlingtonCamera', () => {
  it('normalizes an online camera using the authoritative URL field', () => {
    const cam = normalizeArlingtonCamera(arlingtonRow);
    expect(cam).toMatchObject({
      id: 'arlington-cam1',
      source: 'arlington',
      name: 'Columbia Pike @ Walter Reed',
      streamUrl: 'https://itsvideo.arlingtonva.us:8011/live/cam1.stream/playlist.m3u8',
    });
    expect(cam!.imageUrl).toBeUndefined(); // stream-only source
  });

  it('drops offline cameras', () => {
    expect(
      normalizeArlingtonCamera({ attributes: { ...arlingtonRow.attributes, Status: 'OFFLINE' } }),
    ).toBeNull();
  });

  it('drops the sign-flipped-longitude data wart instead of guessing', () => {
    expect(
      normalizeArlingtonCamera({ attributes: { ...arlingtonRow.attributes, Longitude: 77.109 } }),
    ).toBeNull();
  });
});

const pgcRow: PgcCameraFeature = {
  id: 1716,
  properties: {
    name: 'Marlboro Pike @ Forestville Rd.',
    cameraOwner: 'PG County',
    views: [{ url: 'https://s57.us-east-1.skyvdn.com:443/rtplive/cam007/playlist.m3u8', broken: false }],
  },
  geometry: { coordinates: [-76.874, 38.845] },
};

describe('normalizePgcCamera', () => {
  it('normalizes a county-owned working camera', () => {
    const cam = normalizePgcCamera(pgcRow);
    expect(cam).toMatchObject({
      id: 'pgc-1716',
      source: 'pgc',
      name: 'Marlboro Pike @ Forestville Rd.',
      streamUrl: 'https://s57.us-east-1.skyvdn.com:443/rtplive/cam007/playlist.m3u8',
    });
  });

  it('drops CHARTFeed relays that duplicate the MD CHART source', () => {
    const relay = {
      ...pgcRow,
      properties: { ...pgcRow.properties, views: [{ url: 'https://x.example/rtplive/CHARTFeed42/playlist.m3u8', broken: false }] },
    };
    expect(normalizePgcCamera(relay)).toBeNull();
  });

  it('drops broken feeds', () => {
    const broken = {
      ...pgcRow,
      properties: { ...pgcRow.properties, views: [{ url: pgcRow.properties!.views![0].url, broken: true }] },
    };
    expect(normalizePgcCamera(broken)).toBeNull();
  });
});
