import { BaseFetcher } from './base.js';
import type { Incident, IncidentType } from '../types/index.js';
import config from '../config.js';
import logger from '../logger.js';

interface OpenMHzCall {
  _id: string;
  talkgroupNum: number;
  talkgroup: number;
  talkgroupAlpha?: string;
  talkgroupDescription?: string;
  talkgroupTag?: string;
  talkgroupGroup?: string;
  time: string;
  len: number;
  freq: number;
  url: string;
  srcList?: Array<{ src: number; time: number; pos: number }>;
  star?: boolean;
}

const DCFD_TALKGROUP_MAP: Record<string, { type: IncidentType; severity: 1 | 2 | 3 | 4 | 5; name: string }> = {
  dispatch: { type: 'fire', severity: 3, name: 'Dispatch' },
  ems: { type: 'fire', severity: 3, name: 'EMS' },
  fireground: { type: 'fire', severity: 4, name: 'Fireground' },
  hazmat: { type: 'hazard', severity: 5, name: 'Hazmat' },
  command: { type: 'fire', severity: 3, name: 'Command' },
};

export class OpenMHzFetcher extends BaseFetcher<Incident> {
  private systemId: string;

  constructor(systemId = 'dcfd') {
    super(`openmhz-${systemId}`, config.cacheTtl.scanner);
    this.systemId = systemId;
  }

  protected async fetchFromApi(): Promise<Incident[]> {
    // NOTE: OpenMHz does not have a public API - the endpoint returns 403 Forbidden
    // This fetcher is kept as a placeholder for future integration if they add one
    // For now, we return empty array silently to avoid log spam
    
    // The website at openmhz.com/system/dcfd works but requires browser-based access
    // There is no documented public REST API for fetching calls programmatically
    
    logger.debug(`OpenMHz: No public API available for ${this.systemId}, returning empty`);
    return [];
    
    // Original code kept for reference if API becomes available:
    // const url = `https://api.openmhz.com/${this.systemId}/calls`;
    // try {
    //   const response = await this.httpGet<OpenMHzResponse>(url, { timeout: 15000, retries: 1 });
    //   const calls = response.calls || (Array.isArray(response) ? response : []);
    //   if (!Array.isArray(calls)) { return []; }
    //   return calls.filter((call) => this.isRecentCall(call)).map((call) => this.normalizeCall(call));
    // } catch (error) {
    //   logger.debug(`OpenMHz API unavailable for ${this.systemId}`);
    //   return [];
    // }
  }

  private isRecentCall(call: OpenMHzCall): boolean {
    if (!call.time) return false;
    const callTime = new Date(call.time).getTime();
    const thirtyMinutesAgo = Date.now() - 30 * 60 * 1000;
    return callTime >= thirtyMinutesAgo;
  }

  private normalizeCall(call: OpenMHzCall): Incident {
    const now = new Date().toISOString();
    const tgInfo = this.getTalkgroupInfo(call);

    return {
      id: `openmhz-${this.systemId}-${call._id}`,
      type: tgInfo.type,
      severity: tgInfo.severity,
      location: {
        lat: config.defaultLat,
        lng: config.defaultLng,
      },
      timestamp: call.time || now,
      updatedAt: now,
      regionId: 'dc',
      source: 'openmhz',
      title: `DCFD: ${call.talkgroupAlpha || tgInfo.name}`,
      description: this.buildDescription(call),
      status: 'active',
      category: call.talkgroupTag || 'scanner',
      metadata: {
        audioUrl: call.url,
        talkgroup: call.talkgroupNum || call.talkgroup,
        talkgroupAlpha: call.talkgroupAlpha,
        talkgroupDescription: call.talkgroupDescription,
        duration: call.len,
        frequency: call.freq,
        systemId: this.systemId,
      },
    };
  }

  private getTalkgroupInfo(call: OpenMHzCall): { type: IncidentType; severity: 1 | 2 | 3 | 4 | 5; name: string } {
    const combined = `${call.talkgroupTag || ''} ${call.talkgroupGroup || ''} ${call.talkgroupDescription || ''}`.toLowerCase();

    if (combined.includes('hazmat')) return DCFD_TALKGROUP_MAP.hazmat;
    if (combined.includes('fireground') || combined.includes('tac')) return DCFD_TALKGROUP_MAP.fireground;
    if (combined.includes('ems') || combined.includes('medic')) return DCFD_TALKGROUP_MAP.ems;
    if (combined.includes('command')) return DCFD_TALKGROUP_MAP.command;

    return DCFD_TALKGROUP_MAP.dispatch;
  }

  private buildDescription(call: OpenMHzCall): string {
    const parts: string[] = [];
    if (call.talkgroupDescription) parts.push(call.talkgroupDescription);
    if (call.len) parts.push(`Duration: ${call.len.toFixed(1)}s`);
    if (call.time) {
      const time = new Date(call.time).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
      parts.push(`Time: ${time}`);
    }
    return parts.join('\n');
  }
}

export const openMHzFetcher = new OpenMHzFetcher('dcfd');
export default openMHzFetcher;

