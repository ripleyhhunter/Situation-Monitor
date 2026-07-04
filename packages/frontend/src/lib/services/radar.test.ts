import { describe, it, expect } from 'vitest';
import { buildRainViewerTemplate, pickNewestFrame, IEM_TILE_TEMPLATE } from './radar';

describe('pickNewestFrame', () => {
  it('returns the frame with the largest time', () => {
    const index = {
      host: 'https://tilecache.rainviewer.com',
      radar: {
        past: [
          { time: 100, path: '/v2/radar/aaa' },
          { time: 300, path: '/v2/radar/ccc' },
          { time: 200, path: '/v2/radar/bbb' },
        ],
      },
    };
    expect(pickNewestFrame(index)?.path).toBe('/v2/radar/ccc');
  });

  it('returns null on empty or malformed frame lists', () => {
    expect(pickNewestFrame({ host: 'https://x', radar: { past: [] } })).toBeNull();
    expect(pickNewestFrame({ host: 'https://x', radar: {} })).toBeNull();
    expect(pickNewestFrame({ host: 'https://x' })).toBeNull();
    // Shape drift: frames missing fields are skipped, not crashed on.
    expect(
      pickNewestFrame({
        host: 'https://x',
        radar: { past: [{ time: 1 } as never, { path: '/p' } as never] },
      })
    ).toBeNull();
  });
});

describe('buildRainViewerTemplate', () => {
  it('builds the documented tile pattern with color scheme 8', () => {
    expect(buildRainViewerTemplate('https://tilecache.rainviewer.com', '/v2/radar/abc123')).toBe(
      'https://tilecache.rainviewer.com/v2/radar/abc123/256/{z}/{x}/{y}/8/1_1.png'
    );
  });
});

describe('IEM fallback template', () => {
  it('is a plain slippy-map template needing no index', () => {
    expect(IEM_TILE_TEMPLATE).toContain('{z}/{x}/{y}.png');
  });
});
