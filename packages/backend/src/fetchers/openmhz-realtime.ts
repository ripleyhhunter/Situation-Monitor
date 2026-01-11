import { EventEmitter } from 'events';
import type { ScannerCall, ScannerCallType, IncidentType } from '../types/index.js';
import config from '../config.js';
import logger from '../logger.js';

interface OpenMHzLiveCall {
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

// Mapping for DCFD talkgroup categories
const TALKGROUP_MAP: Record<string, { type: IncidentType; callType: ScannerCallType; severity: 1 | 2 | 3 | 4 | 5 }> = {
  dispatch: { type: 'fire', callType: 'dispatch', severity: 3 },
  ems: { type: 'fire', callType: 'ems', severity: 3 },
  fireground: { type: 'fire', callType: 'fireground', severity: 4 },
  tactical: { type: 'fire', callType: 'tactical', severity: 4 },
  command: { type: 'fire', callType: 'command', severity: 3 },
  hazmat: { type: 'hazard', callType: 'hazmat', severity: 5 },
};

export class OpenMHzRealtimeFetcher extends EventEmitter {
  private ws: WebSocket | null = null;
  private systemId: string;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private isConnecting = false;
  private pollInterval: NodeJS.Timeout | null = null;
  private lastCallTime: string | null = null;
  private recentCalls: ScannerCall[] = [];
  private maxRecentCalls = 100;

  constructor(systemId = 'dcfd') {
    super();
    this.systemId = systemId;
  }

  /**
   * Start fetching scanner calls via polling
   * (WebSocket endpoint may not be publicly available, so we use polling as primary method)
   */
  start(): void {
    logger.info(`Starting OpenMHz real-time fetcher for ${this.systemId}`);
    
    // Initial fetch
    this.fetchRecentCalls();
    
    // Poll every 15 seconds for new calls
    this.pollInterval = setInterval(() => {
      this.fetchRecentCalls();
    }, 15000);
  }

  /**
   * Attempt WebSocket connection (experimental - may not be available)
   */
  connectWebSocket(): void {
    if (this.ws || this.isConnecting) {
      return;
    }

    this.isConnecting = true;
    
    try {
      // Note: OpenMHz WebSocket endpoint may require authentication or may not be public
      const wsUrl = `wss://api.openmhz.com/${this.systemId}/calls/live`;
      
      this.ws = new WebSocket(wsUrl);
      
      this.ws.onopen = () => {
        logger.info(`OpenMHz WebSocket connected for ${this.systemId}`);
        this.isConnecting = false;
        this.reconnectAttempts = 0;
        this.emit('connected');
      };

      this.ws.onmessage = (event) => {
        try {
          const call = JSON.parse(event.data.toString()) as OpenMHzLiveCall;
          const scannerCall = this.normalizeCall(call);
          this.addCall(scannerCall);
          this.emit('call', scannerCall);
        } catch (error) {
          logger.error('Failed to parse OpenMHz WebSocket message', { error });
        }
      };

      this.ws.onclose = () => {
        logger.warn(`OpenMHz WebSocket closed for ${this.systemId}`);
        this.ws = null;
        this.isConnecting = false;
        this.scheduleReconnect();
        this.emit('disconnected');
      };

      this.ws.onerror = (error) => {
        logger.debug(`OpenMHz WebSocket error for ${this.systemId}`, { error });
        this.isConnecting = false;
      };
    } catch (error) {
      logger.debug(`Failed to create OpenMHz WebSocket for ${this.systemId}`, { error });
      this.isConnecting = false;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimeout || this.reconnectAttempts >= this.maxReconnectAttempts) {
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 60000);
    
    logger.debug(`Scheduling OpenMHz WebSocket reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`);
    
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.connectWebSocket();
    }, delay);
  }

  /**
   * Fetch recent calls via REST API
   */
  async fetchRecentCalls(): Promise<ScannerCall[]> {
    const url = `https://api.openmhz.com/${this.systemId}/calls`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'SituationMonitor/1.0',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      const calls = data.calls || (Array.isArray(data) ? data : []);

      if (!Array.isArray(calls)) {
        logger.warn('OpenMHz response has unexpected format');
        return [];
      }

      // Process calls and emit new ones
      const newCalls: ScannerCall[] = [];
      
      for (const call of calls) {
        const scannerCall = this.normalizeCall(call);
        
        // Check if this is a new call we haven't seen
        if (!this.recentCalls.some((c) => c.id === scannerCall.id)) {
          // Only emit if within last 5 minutes
          const callTime = new Date(scannerCall.timestamp).getTime();
          const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
          
          if (callTime >= fiveMinutesAgo) {
            newCalls.push(scannerCall);
            this.addCall(scannerCall);
            this.emit('call', scannerCall);
          }
        }
      }

      if (newCalls.length > 0) {
        logger.debug(`OpenMHz: ${newCalls.length} new calls for ${this.systemId}`);
      }

      return this.recentCalls;
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        logger.debug(`OpenMHz API fetch failed for ${this.systemId}`);
      }
      return this.recentCalls;
    }
  }

  private addCall(call: ScannerCall): void {
    // Add to front of array
    this.recentCalls.unshift(call);
    
    // Trim to max size
    if (this.recentCalls.length > this.maxRecentCalls) {
      this.recentCalls = this.recentCalls.slice(0, this.maxRecentCalls);
    }

    this.lastCallTime = call.timestamp;
  }

  private normalizeCall(call: OpenMHzLiveCall): ScannerCall {
    const info = this.getTalkgroupInfo(call);

    return {
      id: `openmhz-${this.systemId}-${call._id}`,
      systemId: this.systemId,
      talkgroup: call.talkgroupNum || call.talkgroup,
      talkgroupAlpha: call.talkgroupAlpha || `TG ${call.talkgroupNum || call.talkgroup}`,
      talkgroupDescription: call.talkgroupDescription,
      talkgroupTag: call.talkgroupTag,
      talkgroupGroup: call.talkgroupGroup,
      timestamp: call.time || new Date().toISOString(),
      duration: call.len || 0,
      frequency: call.freq,
      audioUrl: call.url,
      type: info.type,
      callType: info.callType,
      severity: info.severity,
      sources: call.srcList?.map((s) => ({ src: s.src, time: s.time })),
    };
  }

  private getTalkgroupInfo(call: OpenMHzLiveCall): { type: IncidentType; callType: ScannerCallType; severity: 1 | 2 | 3 | 4 | 5 } {
    const combined = `${call.talkgroupTag || ''} ${call.talkgroupGroup || ''} ${call.talkgroupDescription || ''}`.toLowerCase();

    if (combined.includes('hazmat') || combined.includes('haz mat')) {
      return TALKGROUP_MAP.hazmat;
    }
    if (combined.includes('fireground') || combined.includes('fire ground') || combined.includes('fg')) {
      return TALKGROUP_MAP.fireground;
    }
    if (combined.includes('tactical') || combined.includes('tac')) {
      return TALKGROUP_MAP.tactical;
    }
    if (combined.includes('ems') || combined.includes('medic') || combined.includes('ambulance')) {
      return TALKGROUP_MAP.ems;
    }
    if (combined.includes('command') || combined.includes('cmd')) {
      return TALKGROUP_MAP.command;
    }

    return TALKGROUP_MAP.dispatch;
  }

  /**
   * Get recent calls from memory
   */
  getRecentCalls(): ScannerCall[] {
    return [...this.recentCalls];
  }

  /**
   * Get calls filtered by time range
   */
  getCallsSince(since: Date): ScannerCall[] {
    const sinceTime = since.getTime();
    return this.recentCalls.filter((c) => new Date(c.timestamp).getTime() >= sinceTime);
  }

  /**
   * Get status information
   */
  getStatus(): { systemId: string; isConnected: boolean; lastCallTime: string | null; callCount: number } {
    return {
      systemId: this.systemId,
      isConnected: this.ws?.readyState === WebSocket.OPEN,
      lastCallTime: this.lastCallTime,
      callCount: this.recentCalls.length,
    };
  }

  /**
   * Stop the fetcher
   */
  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.recentCalls = [];
    logger.info(`OpenMHz real-time fetcher stopped for ${this.systemId}`);
  }
}

// Create singleton instances for key systems
export const dcfdRealtimeFetcher = new OpenMHzRealtimeFetcher('dcfd');

export default dcfdRealtimeFetcher;

