import { writable } from 'svelte/store';
import type { SSEEvent, Incident, Camera, WeatherAlert, AirQuality, ScannerCall, ScannerStatus } from '$types';
import { upsertIncident, clearIncident } from '$stores/incidents';
import { upsertCamera } from '$stores/cameras';
import { upsertWeatherAlert, removeWeatherAlert, setAirQuality } from '$stores/weather';
import { addScannerCall, updateScannerStatus } from '$stores/scanner';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

// Connection status store
export const connectionStatus = writable<ConnectionStatus>('disconnected');

// Last event timestamp
export const lastEventTime = writable<string | null>(null);

class SSEService {
  private eventSource: EventSource | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;

  constructor() {
    // Auto-reconnect on page visibility change
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && !this.eventSource) {
          this.connect();
        }
      });
    }
  }

  connect(): void {
    if (this.eventSource) {
      return; // Already connected
    }

    connectionStatus.set('connecting');

    const apiUrl = import.meta.env.PUBLIC_API_URL || '';
    this.eventSource = new EventSource(`${apiUrl}/api/events`);

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
      const data = JSON.parse(event.data) as SSEEvent;
      console.log('SSE connected:', data);
      lastEventTime.set(data.timestamp);
    });

    this.eventSource.addEventListener('heartbeat', (event) => {
      const data = JSON.parse(event.data) as SSEEvent;
      lastEventTime.set(data.timestamp);
    });

    this.eventSource.addEventListener('incident:new', (event) => {
      const data = JSON.parse(event.data) as SSEEvent<Incident>;
      upsertIncident(data.data);
      lastEventTime.set(data.timestamp);
    });

    this.eventSource.addEventListener('incident:update', (event) => {
      const data = JSON.parse(event.data) as SSEEvent<Incident>;
      upsertIncident(data.data);
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
      upsertWeatherAlert(data.data);
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

    this.eventSource.addEventListener('scanner:call', (event) => {
      const data = JSON.parse(event.data) as SSEEvent<ScannerCall>;
      addScannerCall(data.data);
      lastEventTime.set(data.timestamp);
    });

    this.eventSource.addEventListener('scanner:status', (event) => {
      const data = JSON.parse(event.data) as SSEEvent<ScannerStatus>;
      updateScannerStatus(data.data);
      lastEventTime.set(data.timestamp);
    });
  }

  private handleDisconnect(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    connectionStatus.set('disconnected');

    // Attempt reconnection with exponential backoff
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = Math.min(
        this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
        this.maxReconnectDelay
      );

      console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

      setTimeout(() => {
        if (typeof document === 'undefined' || document.visibilityState === 'visible') {
          this.connect();
        }
      }, delay);
    } else {
      console.error('Max reconnection attempts reached');
      connectionStatus.set('error');
    }
  }

  disconnect(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    connectionStatus.set('disconnected');
    this.reconnectAttempts = this.maxReconnectAttempts; // Prevent auto-reconnect
  }

  isConnected(): boolean {
    return this.eventSource?.readyState === EventSource.OPEN;
  }
}

export const sseService = new SSEService();
export default sseService;
