import { writable, get } from 'svelte/store';
import type { SSEEvent, Incident, Camera, WeatherAlert, AirQuality, CurrentWeather, Aircraft, NewsItem, RegionId, ScannerCall } from '$types';
import { filters } from '$stores/filters';
import { selectedRegionId } from '$stores/region';
import { upsertIncident, upsertIncidents, clearIncident, clearIncidents, pruneIncidentsExcept } from '$stores/incidents';
import { upsertCamera, upsertCameras } from '$stores/cameras';
import {
  upsertWeatherAlert,
  removeWeatherAlert,
  pruneWeatherAlertsExcept,
  setAirQuality,
  setCurrentWeather,
} from '$stores/weather';
import { updateAircraft } from '$stores/aircraft';
import { updateNews } from '$stores/news';
import { updateScannerCalls } from '$stores/scanner';
import { notifyIncident, notifyWeatherAlert } from './notifications';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

// Connection status store
export const connectionStatus = writable<ConnectionStatus>('disconnected');

// Last event timestamp
export const lastEventTime = writable<string | null>(null);

// Client ID from server (for updating preferences)
export const clientId = writable<string | null>(null);

class SSEService {
  private eventSource: EventSource | null = null;
  private reconnectAttempts = 0;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionallyClosed = false;
  private currentClientId: string | null = null;

  // A dead stream doesn't always fire onerror (observed behind proxies: the
  // upstream dies but the client socket stays open, silently). The server
  // heartbeats every 30s, so >90s without one means the stream is dead.
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private lastEventAt = 0;
  private static readonly STALE_STREAM_MS = 90000;

  // Reconnect reconciliation: the server replays its full active snapshot
  // after 'connected'. Rather than clearing stores up-front (blank map that
  // refills, and an empty dashboard if the connection dies mid-snapshot),
  // we track the ids seen during the burst and prune everything else at the
  // first heartbeat — ghosts still purge, with no intermediate empty state.
  private reconcilePending = false;
  private snapshotIncidentIds = new Set<string>();
  private snapshotAlertIds = new Set<string>();

  constructor() {
    // Auto-reconnect on page visibility change
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && !this.eventSource && !this.intentionallyClosed) {
          this.connect();
        }
      });
    }
  }

  connect(): void {
    if (this.eventSource) {
      return; // Already connected
    }

    this.intentionallyClosed = false;
    this.lastEventAt = Date.now();
    this.startWatchdog();
    connectionStatus.set('connecting');

    // Default to wanting aircraft - filter store will update preference after connection
    const apiUrl = import.meta.env.PUBLIC_API_URL || '';
    // batch=1: the server sends array events (incident:batch etc.) so the
    // connect snapshot is ~15 events instead of ~7,000 — without the flag
    // it falls back to the per-item stream for older deployed frontends.
    this.eventSource = new EventSource(`${apiUrl}/api/events?batch=1`);

    this.eventSource.onopen = () => {
      console.log('SSE connection opened');
      connectionStatus.set('connected');
      this.reconnectAttempts = 0;
      this.reconnectDelay = 1000;
    };

    this.eventSource.onerror = (event) => {
      console.error('SSE connection error', event);
      connectionStatus.set('error');
      this.handleDisconnect();
    };

    // Handle different event types
    this.eventSource.addEventListener('connected', (event) => {
      const data = JSON.parse(event.data) as SSEEvent<{ clientId: string }>;
      console.log('SSE connected:', data);
      // Snapshot reconciliation starts here (see field docs above).
      this.reconcilePending = true;
      this.snapshotIncidentIds.clear();
      this.snapshotAlertIds.clear();
      this.lastEventAt = Date.now();
      this.currentClientId = data.data.clientId;
      clientId.set(data.data.clientId);
      lastEventTime.set(data.timestamp);
      // The server defaults new connections to no-aircraft; push the actual
      // preference so it survives reconnects (a new clientId each time).
      this.syncAircraftPreference();
    });

    this.eventSource.addEventListener('heartbeat', (event) => {
      const data = JSON.parse(event.data) as SSEEvent;
      this.lastEventAt = Date.now();
      lastEventTime.set(data.timestamp);
      // The snapshot burst is written synchronously before any broadcast,
      // so by the first heartbeat everything current has been re-sent —
      // whatever wasn't is a ghost from before the disconnect.
      if (this.reconcilePending) {
        this.reconcilePending = false;
        pruneIncidentsExcept(this.snapshotIncidentIds);
        pruneWeatherAlertsExcept(this.snapshotAlertIds);
      }
    });

    this.eventSource.addEventListener('incident:new', (event) => {
      const data = JSON.parse(event.data) as SSEEvent<Incident>;
      if (this.reconcilePending) this.snapshotIncidentIds.add(data.data.id);
      upsertIncident(data.data);
      // Skip the connect/reconnect snapshot burst — replayed actives are not news.
      if (!this.reconcilePending) notifyIncident(data.data);
      lastEventTime.set(data.timestamp);
    });

    this.eventSource.addEventListener('incident:update', (event) => {
      const data = JSON.parse(event.data) as SSEEvent<Incident>;
      if (this.reconcilePending) this.snapshotIncidentIds.add(data.data.id);
      upsertIncident(data.data);
      // Escalations: an incident that first arrived below the critical
      // threshold only crosses it via update. Dedupe + freshness gates
      // make re-evaluating every update safe.
      if (!this.reconcilePending) notifyIncident(data.data);
      lastEventTime.set(data.timestamp);
    });

    this.eventSource.addEventListener('incident:clear', (event) => {
      const data = JSON.parse(event.data) as SSEEvent<{ id: string }>;
      clearIncident(data.data.id);
      lastEventTime.set(data.timestamp);
    });

    this.eventSource.addEventListener('camera:update', (event) => {
      const data = JSON.parse(event.data) as SSEEvent<Camera>;
      upsertCamera(data.data);
      lastEventTime.set(data.timestamp);
    });

    this.eventSource.addEventListener('weather:alert', (event) => {
      const data = JSON.parse(event.data) as SSEEvent<WeatherAlert>;
      if (this.reconcilePending) this.snapshotAlertIds.add(data.data.id);
      upsertWeatherAlert(data.data);
      if (!this.reconcilePending) notifyWeatherAlert(data.data);
      lastEventTime.set(data.timestamp);
    });

    this.eventSource.addEventListener('weather:clear', (event) => {
      const data = JSON.parse(event.data) as SSEEvent<{ id: string }>;
      removeWeatherAlert(data.data.id);
      lastEventTime.set(data.timestamp);
    });

    this.eventSource.addEventListener('aqi:update', (event) => {
      const data = JSON.parse(event.data) as SSEEvent<AirQuality>;
      setAirQuality(data.data);
      lastEventTime.set(data.timestamp);
    });

    this.eventSource.addEventListener('weather:current', (event) => {
      const data = JSON.parse(event.data) as SSEEvent<CurrentWeather>;
      setCurrentWeather(data.data);
      lastEventTime.set(data.timestamp);
    });

    this.eventSource.addEventListener('aircraft:update', (event) => {
      const data = JSON.parse(event.data) as SSEEvent<{ regionId: RegionId; aircraft: Aircraft[]; timestamp: string }>;
      updateAircraft(data.data.regionId, data.data.aircraft);
      lastEventTime.set(data.timestamp);
    });

    this.eventSource.addEventListener('news:update', (event) => {
      const data = JSON.parse(event.data) as SSEEvent<{ regionId: RegionId; news: NewsItem[]; timestamp: string }>;
      updateNews(data.data.news);
      lastEventTime.set(data.timestamp);
    });

    this.eventSource.addEventListener('incident:batch', (event) => {
      const data = JSON.parse(event.data) as SSEEvent<{ incidents: Incident[] }>;
      const items = data.data.incidents;
      if (this.reconcilePending) {
        for (const incident of items) this.snapshotIncidentIds.add(incident.id);
      }
      upsertIncidents(items);
      // Live batches (a poll's worth of new/changed incidents) still
      // notify per item — dedupe + freshness gates keep it sane.
      if (!this.reconcilePending) {
        for (const incident of items) notifyIncident(incident);
      }
      lastEventTime.set(data.timestamp);
    });

    this.eventSource.addEventListener('incident:clear-batch', (event) => {
      const data = JSON.parse(event.data) as SSEEvent<{ ids: string[] }>;
      clearIncidents(data.data.ids);
      lastEventTime.set(data.timestamp);
    });

    this.eventSource.addEventListener('camera:batch', (event) => {
      const data = JSON.parse(event.data) as SSEEvent<{ cameras: Camera[] }>;
      upsertCameras(data.data.cameras);
      lastEventTime.set(data.timestamp);
    });

    this.eventSource.addEventListener('scanner:update', (event) => {
      const data = JSON.parse(event.data) as SSEEvent<{ regionId: RegionId; calls: ScannerCall[]; timestamp: string }>;
      updateScannerCalls(data.data.regionId, data.data.calls);
      lastEventTime.set(data.timestamp);
    });
  }

  private startWatchdog(): void {
    if (this.watchdogTimer) return;
    this.watchdogTimer = setInterval(() => {
      if (this.eventSource && Date.now() - this.lastEventAt > SSEService.STALE_STREAM_MS) {
        console.warn('SSE stream stale (no heartbeat for 90s), forcing reconnect');
        this.handleDisconnect();
      }
    }, 30000);
  }

  private handleDisconnect(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    connectionStatus.set('disconnected');

    if (this.intentionallyClosed) return;

    // A failing EventSource can emit multiple error events; without this
    // guard each one would schedule its own retry timer and the timers
    // stack geometrically.
    if (this.reconnectTimer) return;

    // Retry forever with capped exponential backoff — the backend (owner's
    // machine) can be down for hours, and a permanently dead dashboard that
    // needs a manual reload is worse than a 30s retry loop.
    this.reconnectAttempts++;
    const delay = Math.min(
      this.reconnectDelay * Math.pow(2, Math.min(this.reconnectAttempts - 1, 10)),
      this.maxReconnectDelay
    );

    console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        this.connect();
      }
      // If the tab is hidden, the visibilitychange handler reconnects on return.
    }, delay);
  }

  disconnect(): void {
    this.intentionallyClosed = true;
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this.currentClientId = null;
    clientId.set(null);
    connectionStatus.set('disconnected');
  }

  isConnected(): boolean {
    return this.eventSource?.readyState === EventSource.OPEN;
  }

  /**
   * Push the current aircraft preference (from the filters store) and the
   * selected region to the server. Called after every connect and whenever
   * the selected region changes.
   */
  syncAircraftPreference(): void {
    this.updateAircraftPreference(get(filters).showAircraft).catch(() => {});
  }

  /**
   * Update server about aircraft preference change
   * This helps the server save API quota when no clients want aircraft data
   */
  async updateAircraftPreference(wantsAircraft: boolean): Promise<void> {
    if (!this.currentClientId) {
      console.debug('Cannot update preference - no clientId yet');
      return;
    }

    try {
      const apiUrl = import.meta.env.PUBLIC_API_URL || '';
      const response = await fetch(`${apiUrl}/api/events/preferences`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: this.currentClientId,
          wantsAircraft,
          regionId: get(selectedRegionId),
        }),
      });

      if (!response.ok) {
        console.warn('Failed to update aircraft preference:', response.statusText);
      } else {
        console.debug('Aircraft preference updated:', wantsAircraft);
      }
    } catch (error) {
      console.warn('Error updating aircraft preference:', error);
    }
  }

  getClientId(): string | null {
    return this.currentClientId;
  }
}

export const sseService = new SSEService();

// Re-sync the aircraft preference when the user switches regions so the
// backend polls OpenSky for the region actually being viewed.
selectedRegionId.subscribe(() => {
  sseService.syncAircraftPreference();
});

export default sseService;
