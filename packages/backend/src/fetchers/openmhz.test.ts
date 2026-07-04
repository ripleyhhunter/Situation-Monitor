import { describe, it, expect } from 'vitest';
import { OpenMHzFetcher } from './openmhz.js';

const CALLS_FIXTURE = {
  calls: [
    {
      _id: '6a49043f9b85636c4a1a6a41',
      talkgroupNum: 101,
      url: 'https://media2.openmhz.com/media/dcfd/101/dcfd-101-1783170091.m4a',
      time: '2026-07-04T13:01:31.000Z',
      srcList: [
        { pos: 0, src: '1116746', tag: 'U-FEMS16' },
        { pos: 0.9, src: '1116746', tag: 'U-FEMS16' },
        { pos: 5.7, src: '1116747', tag: 'E-14' },
      ],
      star: 0,
      emergency: false,
      freq: 858587500,
      len: 14,
    },
    // Malformed rows are skipped, not fatal.
    { _id: 'x', talkgroupNum: 102, time: '2026-07-04T13:00:00Z' }, // no url
    { url: 'https://x.m4a', time: '2026-07-04T13:00:00Z' }, // no id
  ],
  direction: 'older',
};

const TALKGROUPS_FIXTURE = {
  talkgroups: {
    '101': { num: 101, alpha: '01 disp', description: 'Fire Dispatch' },
    '102': { num: 102, alpha: '02 main', description: 'Main Operations' },
  },
};

function stubbedFetcher() {
  const fetcher = new OpenMHzFetcher({ regionId: 'dc', systemId: 'dcfd', systemLabel: 'DC Fire & EMS' });
  (fetcher as unknown as { fetchJson: (url: string) => Promise<unknown> }).fetchJson = async (url: string) => {
    if (url.includes('/talkgroups')) return TALKGROUPS_FIXTURE;
    return CALLS_FIXTURE;
  };
  return fetcher as unknown as { fetchFromApi: () => Promise<import('../types/index.js').ScannerCall[]> };
}

describe('OpenMHzFetcher', () => {
  it('normalizes calls with talkgroup names, units, and the call record time', async () => {
    const calls = await stubbedFetcher().fetchFromApi();
    expect(calls).toHaveLength(1); // two malformed rows skipped
    const call = calls[0];
    expect(call.id).toBe('openmhz-dcfd-6a49043f9b85636c4a1a6a41');
    expect(call.regionId).toBe('dc');
    expect(call.systemLabel).toBe('DC Fire & EMS');
    expect(call.talkgroup).toBe(101);
    expect(call.talkgroupName).toBe('01 disp');
    expect(call.talkgroupDescription).toBe('Fire Dispatch');
    expect(call.time).toBe('2026-07-04T13:01:31.000Z');
    expect(call.durationSec).toBe(14);
    expect(call.audioUrl).toContain('.m4a');
    expect(call.frequencyMhz).toBeCloseTo(858.5875);
    expect(call.emergency).toBe(false);
    expect(call.units).toEqual(['U-FEMS16', 'E-14']); // deduped, order kept
  });

  it('throws on shape drift (a 403/UA-block must not read as radio silence)', async () => {
    const fetcher = new OpenMHzFetcher({ regionId: 'dc', systemId: 'dcfd', systemLabel: 'DC Fire & EMS' });
    (fetcher as unknown as { fetchJson: (url: string) => Promise<unknown> }).fetchJson = async (url: string) =>
      url.includes('/talkgroups') ? TALKGROUPS_FIXTURE : {};
    await expect(
      (fetcher as unknown as { fetchFromApi: () => Promise<unknown> }).fetchFromApi()
    ).rejects.toThrow('unexpected response shape');
  });

  it('survives a talkgroups outage — names omitted, calls still flow', async () => {
    const fetcher = new OpenMHzFetcher({ regionId: 'dc', systemId: 'dcfd', systemLabel: 'DC Fire & EMS' });
    (fetcher as unknown as { fetchJson: (url: string) => Promise<unknown> }).fetchJson = async (url: string) => {
      if (url.includes('/talkgroups')) throw new Error('503');
      return CALLS_FIXTURE;
    };
    const calls = await (fetcher as unknown as { fetchFromApi: () => Promise<import('../types/index.js').ScannerCall[]> }).fetchFromApi();
    expect(calls).toHaveLength(1);
    expect(calls[0].talkgroupName).toBeUndefined();
  });
});
