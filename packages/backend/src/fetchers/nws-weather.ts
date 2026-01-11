import { BaseFetcher } from './base.js';
import type { WeatherAlert, WeatherSeverity, WeatherUrgency } from '../types/index.js';
import config from '../config.js';
import logger from '../logger.js';

interface NWSAlert {
  id: string;
  properties: {
    id: string;
    event: string;
    severity: string;
    urgency: string;
    headline: string;
    description: string;
    instruction?: string;
    areaDesc: string;
    onset: string;
    expires: string;
  };
  geometry?: {
    type: string;
    coordinates: number[][][];
  };
}

interface NWSResponse {
  features: NWSAlert[];
}

export class NWSWeatherFetcher extends BaseFetcher<WeatherAlert> {
  private lat: number;
  private lng: number;

  constructor() {
    super('nws-weather', config.cacheTtl.weather);
    this.lat = config.defaultLat;
    this.lng = config.defaultLng;
  }

  protected async fetchFromApi(): Promise<WeatherAlert[]> {
    // NWS API endpoint for alerts by point
    // We use a radius around DC to get relevant alerts
    const url = `https://api.weather.gov/alerts/active?point=${this.lat},${this.lng}&status=actual`;

    try {
      const response = await this.httpGet<NWSResponse>(url, {
        headers: {
          'User-Agent': 'SituationMonitor/1.0 (https://github.com/situation-monitor)',
        },
      });

      return response.features.map((alert) => this.normalizeAlert(alert));
    } catch (error) {
      // Try fallback to zone-based alerts for DC area
      logger.debug('Falling back to zone-based alert fetch');
      return this.fetchByZone();
    }
  }

  private async fetchByZone(): Promise<WeatherAlert[]> {
    // DC area zone codes
    const zones = ['DCZ001', 'MDZ013', 'MDZ014', 'VAZ053', 'VAZ054'];
    const alerts: WeatherAlert[] = [];

    for (const zone of zones) {
      try {
        const url = `https://api.weather.gov/alerts/active?zone=${zone}`;
        const response = await this.httpGet<NWSResponse>(url, {
          headers: {
            'User-Agent': 'SituationMonitor/1.0 (https://github.com/situation-monitor)',
          },
        });

        for (const alert of response.features) {
          // Deduplicate by ID
          if (!alerts.find((a) => a.id === alert.id)) {
            alerts.push(this.normalizeAlert(alert));
          }
        }
      } catch (error) {
        logger.warn(`Failed to fetch alerts for zone ${zone}`, { error });
      }
    }

    return alerts;
  }

  private normalizeAlert(alert: NWSAlert): WeatherAlert {
    const props = alert.properties;

    return {
      id: props.id,
      event: props.event,
      severity: this.mapSeverity(props.severity),
      urgency: this.mapUrgency(props.urgency),
      headline: props.headline,
      description: props.description,
      instruction: props.instruction,
      areas: props.areaDesc.split(';').map((a) => a.trim()),
      onset: props.onset,
      expires: props.expires,
      polygon: this.extractPolygon(alert.geometry),
    };
  }

  private mapSeverity(severity: string): WeatherSeverity {
    const mapping: Record<string, WeatherSeverity> = {
      Extreme: 'extreme',
      Severe: 'severe',
      Moderate: 'moderate',
      Minor: 'minor',
      Unknown: 'minor',
    };
    return mapping[severity] || 'minor';
  }

  private mapUrgency(urgency: string): WeatherUrgency {
    const mapping: Record<string, WeatherUrgency> = {
      Immediate: 'immediate',
      Expected: 'expected',
      Future: 'future',
      Past: 'past',
      Unknown: 'unknown',
    };
    return mapping[urgency] || 'unknown';
  }

  private extractPolygon(
    geometry?: { type: string; coordinates: number[][][] }
  ): [number, number][] | undefined {
    if (!geometry || geometry.type !== 'Polygon' || !geometry.coordinates[0]) {
      return undefined;
    }

    // Convert from [lng, lat] to [lat, lng] for Leaflet
    return geometry.coordinates[0].map(([lng, lat]) => [lat, lng]);
  }
}

export const nwsWeatherFetcher = new NWSWeatherFetcher();
export default nwsWeatherFetcher;
