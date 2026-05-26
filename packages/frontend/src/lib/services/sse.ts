import { writable } from 'svelte/store';
import type { SSEEvent, Incident, Camera, WeatherAlert, AirQuality, CurrentWeather, Aircraft, NewsItem, RegionId } from '$types';
import { upsertIncident, clearIncident } from '$stores/incidents';
import { upsertCamera } from '$stores/cameras';
import { upsertWeatherAlert, removeWeatherAlert, setAirQuality, setCurrentWeather } from '$stores/weather';
import { updateAircraft } from '$stores/aircraft';
import { updateNews } from '$stores/news';

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
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private currentClientId: string | null = null;

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

    // Default to wanting aircraft - filter store will update preference after connection
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
      const data = JSON.parse(event.data) as SSEEvent<{ clientId: string }>;
      console.log('SSE connected:', data);
      this.currentClientId = data.data.clientId;
      clientId.set(data.data.clientId);
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
    this.currentClientId = null;
    clientId.set(null);
    connectionStatus.set('disconnected');
    this.reconnectAttempts = this.maxReconnectAttempts; // Prevent auto-reconnect
  }

  isConnected(): boolean {
    return this.eventSource?.readyState === EventSource.OPEN;
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
export default sseService;
