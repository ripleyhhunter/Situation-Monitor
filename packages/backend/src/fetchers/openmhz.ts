import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { BaseFetcher } from './base.js';
import type { RegionId, ScannerCall } from '../types/index.js';
import logger from '../logger.js';

const execFileAsync = promisify(execFile);

/**
 * OpenMHz radio-scanner call archive (trunk-recorder uploads).
 *
 *   - Keyless JSON API (the React frontend's own backend), near-real-time:
 *     newest calls are typically <60s old; a 50-call page spans ~7-19
 *     minutes on the DC systems, so the 5-minute scanner cron loses nothing.
 *   - Transport note: the API sits behind a WAF that 403s Node's TLS
 *     fingerprint while serving the same public JSON to curl and browsers
 *     (verified: node fetch/https 403, curl with identical headers 200).
 *     Rather than fake a browser handshake, requests shell out to the
 *     system curl — an ordinary, unmodified client that ships with
 *     Windows 10+, macOS, and most Linux. Same posture as the PulsePoint
 *     Playwright integration: access the public data the way a normal
 *     client would, politely and with an identifying User-Agent.
 *   - Calls are audio metadata only (no geometry) — they feed the scanner
 *     panel, not the map. The audio m4a URLs are played by the browser,
 *     which has its own legitimate fingerprint.
 *   - /talkgroups maps talkgroup numbers to names; it's a dict keyed by
 *     number-string, refreshed daily and non-fatal when unavailable.
 *
 * Coverage note: OpenMHz has zero Idaho systems (verified against all 446
 * systems), so Boise keeps the link-out panel.
 */

interface OpenMHzCall {
  _id?: string;
  talkgroupNum?: number;
  url?: string;
  time?: string;
  len?: number;
  freq?: number;
  emergency?: boolean | number;
  srcList?: Array<{ src?: string; tag?: string; pos?: number }>;
}

interface OpenMHzCallsResponse {
  calls?: OpenMHzCall[];
}

interface OpenMHzTalkgroup {
  num?: number;
  alpha?: string;
  description?: string;
}

interface OpenMHzTalkgroupsResponse {
  talkgroups?: Record<string, OpenMHzTalkgroup>;
}

const TALKGROUP_REFRESH_MS = 24 * 60 * 60 * 1000;

export interface OpenMHzFetcherOptions {
  regionId: RegionId;
  /** OpenMHz system shortName, e.g. 'dcfd'. */
  systemId: string;
  /** Human label shown in the panel, e.g. 'DC Fire & EMS'. */
  systemLabel: string;
}

export class OpenMHzFetcher extends BaseFetcher<ScannerCall> {
  private regionId: RegionId;
  private systemId: string;
  private systemLabel: string;

  private talkgroups: Map<number, { name: string; description: string }> = new Map();
  private talkgroupsFetchedAt = 0;

  constructor(options: OpenMHzFetcherOptions) {
    super(`openmhz-${options.systemId}`, 120);
    this.regionId = options.regionId;
    this.systemId = options.systemId;
    this.systemLabel = options.systemLabel;
  }

  /**
   * Fetch JSON via the system curl (see the transport note in the module
   * docs). Overridable in tests.
   */
  protected async fetchJson<R>(url: string): Promise<R> {
    const { stdout } = await execFileAsync(
      'curl',
      [
        '-sS',
        '--fail',
        '--max-time', '20',
        '-H', 'User-Agent: SituationMonitor/1.0 (+https://github.com/ripleyhhunter/Situation-Monitor)',
        '-H', 'Accept: application/json',
        url,
      ],
      { maxBuffer: 10 * 1024 * 1024, windowsHide: true }
    );
    return JSON.parse(stdout) as R;
  }

  protected async fetchFromApi(): Promise<ScannerCall[]> {
    await this.refreshTalkgroupsIfStale();

    const response = await this.fetchJson<OpenMHzCallsResponse>(
      `https://api.openmhz.com/${this.systemId}/calls`
    );

    if (!response.calls || !Array.isArray(response.calls)) {
      // A 403 (UA blocklist change) or shape change must not read as
      // "the radio went quiet".
      throw new Error(`OpenMHz (${this.systemId}): unexpected response shape (no calls array)`);
    }

    const calls: ScannerCall[] = [];
    for (const call of response.calls) {
      const normalized = this.normalizeCall(call);
      if (normalized) calls.push(normalized);
    }

    logger.debug(`OpenMHz (${this.systemId}): ${calls.length} recent calls`);
    return calls;
  }

  private normalizeCall(call: OpenMHzCall): ScannerCall | null {
    if (!call._id || !call.url || !call.time || typeof call.talkgroupNum !== 'number') return null;

    const tg = this.talkgroups.get(call.talkgroupNum);
    const units = Array.from(
      new Set((call.srcList ?? []).map((s) => s.tag).filter((t): t is string => !!t))
    );

    return {
      id: `openmhz-${this.systemId}-${call._id}`,
      regionId: this.regionId,
      systemId: this.systemId,
      systemLabel: this.systemLabel,
      talkgroup: call.talkgroupNum,
      talkgroupName: tg?.name,
      talkgroupDescription: tg?.description,
      // The call's own record time — never wall-clock now.
      time: call.time,
      durationSec: typeof call.len === 'number' ? call.len : 0,
      audioUrl: call.url,
      frequencyMhz: typeof call.freq === 'number' ? call.freq / 1e6 : undefined,
      emergency: call.emergency === true || call.emergency === 1,
      units,
    };
  }

  private async refreshTalkgroupsIfStale(): Promise<void> {
    if (Date.now() - this.talkgroupsFetchedAt < TALKGROUP_REFRESH_MS && this.talkgroups.size > 0) {
      return;
    }
    try {
      const response = await this.fetchJson<OpenMHzTalkgroupsResponse>(
        `https://api.openmhz.com/${this.systemId}/talkgroups`
      );
      const dict = response.talkgroups;
      if (dict && typeof dict === 'object') {
        const next = new Map<number, { name: string; description: string }>();
        for (const value of Object.values(dict)) {
          if (typeof value?.num === 'number') {
            next.set(value.num, {
              name: value.alpha?.trim() || `TG ${value.num}`,
              description: value.description?.trim() || '',
            });
          }
        }
        if (next.size > 0) {
          this.talkgroups = next;
          this.talkgroupsFetchedAt = Date.now();
          logger.debug(`OpenMHz (${this.systemId}): loaded ${next.size} talkgroup names`);
        }
      }
    } catch (error) {
      // Names are cosmetic — calls still work without them. Retry next poll.
      logger.warn(`OpenMHz (${this.systemId}): talkgroup fetch failed`, { error });
    }
  }
}
