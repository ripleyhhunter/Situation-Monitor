import { describe, it, expect } from 'vitest';
import { parseVdotIdDate, normalizeVdotFeature, vdotSeverity, VdotFetcher } from './vdot.js';

const FAIRFAX_CRASH = {
  id: 'INNO11386038687-07042026',
  properties: {
    icon: 'incident',
    priority: 'Minor',
    route: 'I-95N',
    type: 'Vehicle Accident',
    location: 'Ramp Intersection: RAMP TO RTS 789 & 644',
    message_511: 'On I-95 at mile marker 169 in the County of Fairfax, expect delays.',
  },
  geometry: { type: 'Point', coordinates: [-77.182656, 38.767592] },
};

describe('parseVdotIdDate', () => {
  it('extracts the embedded MMDDYYYY event date', () => {
    expect(parseVdotIdDate('INNO11386038687-07042026')).toBe('2026-07-04T00:00:00.000Z');
    // Construction ids carry a trailing sequence number.
    expect(parseVdotIdDate('WZSW4519445-06302025-1')).toBe('2025-06-30T00:00:00.000Z');
  });
  it('rejects ids without a plausible date', () => {
    expect(parseVdotIdDate(undefined)).toBeNull();
    expect(parseVdotIdDate('INNO12345')).toBeNull();
    expect(parseVdotIdDate('X-99999999')).toBeNull(); // month 99
  });
});

describe('normalizeVdotFeature', () => {
  it('maps a NoVA incident with the id-derived event date', () => {
    const incident = normalizeVdotFeature(FAIRFAX_CRASH, 'minor-incident');
    expect(incident).not.toBeNull();
    expect(incident!.id).toBe('vdot-INNO11386038687-07042026');
    expect(incident!.regionId).toBe('dc');
    expect(incident!.source).toBe('vdot');
    expect(incident!.title).toBe('Vehicle Accident: I-95N');
    // Invariant: feed-derived timestamp (from the id), never wall-clock.
    expect(incident!.timestamp).toBe('2026-07-04T00:00:00.000Z');
    expect(incident!.metadata.ongoing).toBe(true);
  });

  it('versions updatedAt by content so escalations re-broadcast without churn', () => {
    const a = normalizeVdotFeature(FAIRFAX_CRASH, 'minor-incident')!;
    const b = normalizeVdotFeature(FAIRFAX_CRASH, 'minor-incident')!;
    // Deterministic: identical content -> identical updatedAt (no churn).
    expect(a.updatedAt).toBe(b.updatedAt);
    // Same-day anchored: within the event's day.
    expect(a.updatedAt.slice(0, 10)).toBe('2026-07-04');
    // Escalation to the major layer shifts it -> re-broadcast.
    const major = normalizeVdotFeature(FAIRFAX_CRASH, 'major-incident')!;
    expect(major.updatedAt).not.toBe(a.updatedAt);
    // A message edit shifts it too.
    const edited = normalizeVdotFeature(
      { ...FAIRFAX_CRASH, properties: { ...FAIRFAX_CRASH.properties, message_511: 'All lanes reopened shortly.' } },
      'minor-incident'
    )!;
    expect(edited.updatedAt).not.toBe(a.updatedAt);
  });

  it('filters events outside Northern Virginia (feeds are statewide)', () => {
    const richmond = {
      ...FAIRFAX_CRASH,
      id: 'INCE11385144381-07042026',
      geometry: { type: 'Point', coordinates: [-77.270952, 37.517008] },
    };
    expect(normalizeVdotFeature(richmond, 'minor-incident')).toBeNull();
  });

  it('drops features without an id-embedded date instead of stamping now', () => {
    expect(normalizeVdotFeature({ ...FAIRFAX_CRASH, id: 'INNO-nodadate' }, 'minor-incident')).toBeNull();
  });
});

describe('vdotSeverity', () => {
  it('ranks by layer and priority', () => {
    expect(vdotSeverity('major-incident', 'Major')).toBe(4);
    expect(vdotSeverity('minor-incident', 'Major')).toBe(4);
    expect(vdotSeverity('minor-incident', 'Minor')).toBe(2);
    expect(vdotSeverity('construction', 'none')).toBe(2);
  });
});

describe('VdotFetcher partial-snapshot guard', () => {
  it('fails the whole fetch when any layer is malformed', async () => {
    const fetcher = new VdotFetcher();
    let call = 0;
    (fetcher as unknown as { httpGet: () => Promise<unknown> }).httpGet = async () => {
      // Layers 1-2 fine, layer 3 malformed — must throw, not partial-clear.
      call++;
      return call === 3 ? {} : { features: [] };
    };
    await expect(
      (fetcher as unknown as { fetchFromApi: () => Promise<unknown> }).fetchFromApi()
    ).rejects.toThrow('unexpected response shape');
  });
});
