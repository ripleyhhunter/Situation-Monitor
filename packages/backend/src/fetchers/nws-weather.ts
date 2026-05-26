import { BaseFetcher } from './base.js';
import type { RegionId, WeatherAlert, WeatherSeverity, WeatherUrgency } from '../types/index.js';
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

export interface NWSWeatherFetcherOptions {
  regionId: RegionId;
  lat: number;
  lng: number;
  /** Public NWS zone IDs to use as fallback if the point query fails. */
  zones: string[];
}

export class NWSWeatherFetcher extends BaseFetcher<WeatherAlert> {
  private regionId: RegionId;
  private lat: number;
  private lng: number;
  private zones: string[];

  constructor(opts: NWSWeatherFetcherOptions) {
    super(`nws-weather-${opts.regionId}`, config.cacheTtl.weather);
    this.regionId = opts.regionId;
    this.lat = opts.lat;
    this.lng = opts.lng;
    this.zones = opts.zones;
  }

  protected async fetchFromApi(): Promise<WeatherAlert[]> {
    const url = `https://api.weather.gov/alerts/active?point=${this.lat},${this.lng}&status=actual`;

    try {
      const response = await this.httpGet<NWSResponse>(url, {
        headers: {
          'User-Agent': 'SituationMonitor/1.0 (https://github.com/situation-monitor)',
        },
      });

      return response.features.map((alert) => this.normalizeAlert(alert));
    } catch {
      logger.debug(`NWS (${this.regionId}): point query failed, falling back to zones`);
      return this.fetchByZone();
    }
  }

  private async fetchByZone(): Promise<WeatherAlert[]> {
    const alerts: WeatherAlert[] = [];

    for (const zone of this.zones) {
      try {
        const url = `https://api.weather.gov/alerts/active?zone=${zone}`;
        const response = await this.httpGet<NWSResponse>(url, {
          headers: {
            'User-Agent': 'SituationMonitor/1.0 (https://github.com/situation-monitor)',
          },
        });

        for (const alert of response.features) {
          if (!alerts.find((a) => a.id === alert.id)) {
            alerts.push(this.normalizeAlert(alert));
          }
        }
      } catch (error) {
        logger.warn(`NWS (${this.regionId}): failed to fetch alerts for zone ${zone}`, { error });
      }
    }

    return alerts;
  }

  private normalizeAlert(alert: NWSAlert): WeatherAlert {
    const props = alert.properties;

    return {
      id: props.id,
      regionId: this.regionId,
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
    return geometry.coordinates[0].map(([lng, lat]) => [lat, lng]);
  }
}
