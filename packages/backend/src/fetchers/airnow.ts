import { BaseFetcher } from './base.js';
import type { AirQuality, RegionId } from '../types/index.js';
import config from '../config.js';
import logger from '../logger.js';

export interface AirNowFetcherOptions {
  regionId: RegionId;
  lat: number;
  lng: number;
  /** AirNow API key (shared across regions). */
  apiKey?: string;
}

interface AirNowObservation {
  DateObserved: string;
  HourObserved: number;
  LocalTimeZone: string;
  ReportingArea: string;
  StateCode: string;
  Latitude: number;
  Longitude: number;
  ParameterName: string;
  AQI: number;
  Category: {
    Number: number;
    Name: string;
  };
}

export class AirNowFetcher extends BaseFetcher<AirQuality> {
  private regionId: RegionId;
  private lat: number;
  private lng: number;
  private apiKey: string;

  constructor(opts: AirNowFetcherOptions) {
    super(`airnow-${opts.regionId}`, config.cacheTtl.airQuality);
    this.regionId = opts.regionId;
    this.lat = opts.lat;
    this.lng = opts.lng;
    this.apiKey = opts.apiKey || config.airnowApiKey || '';
  }

  protected async fetchFromApi(): Promise<AirQuality[]> {
    if (this.apiKey) {
      return this.fetchFromAirNowApi();
    }
    return this.fetchFromPublicEndpoint();
  }

  private async fetchFromAirNowApi(): Promise<AirQuality[]> {
    const url = new URL('https://www.airnowapi.org/aq/observation/latLong/current/');
    url.searchParams.set('format', 'application/json');
    url.searchParams.set('latitude', this.lat.toString());
    url.searchParams.set('longitude', this.lng.toString());
    url.searchParams.set('distance', '50'); // 50 mile radius
    url.searchParams.set('API_KEY', this.apiKey);

    try {
      const response = await this.httpGet<AirNowObservation[]>(url.toString());

      if (!Array.isArray(response)) {
        logger.warn('AirNow API response has unexpected format');
        return [];
      }

      return this.normalizeObservations(response);
    } catch (error) {
      logger.error('Failed to fetch AirNow data', { error });
      throw error;
    }
  }

  private async fetchFromPublicEndpoint(): Promise<AirQuality[]> {
    logger.info(
      `AirNow (${this.regionId}): no API key configured. Register at https://docs.airnowapi.org/ for real AQI data`
    );
    return [];
  }

  private normalizeObservations(observations: AirNowObservation[]): AirQuality[] {
    // Group by reporting area and take the highest AQI (worst air quality)
    const byArea = new Map<string, AirNowObservation[]>();

    for (const obs of observations) {
      const key = `${obs.Latitude}-${obs.Longitude}`;
      if (!byArea.has(key)) {
        byArea.set(key, []);
      }
      byArea.get(key)!.push(obs);
    }

    const results: AirQuality[] = [];

    byArea.forEach((areaObs) => {
      const maxObs = areaObs.reduce((max, obs) =>
        obs.AQI > max.AQI ? obs : max
      );

      results.push({
        regionId: this.regionId,
        aqi: maxObs.AQI,
        category: maxObs.Category.Name,
        primaryPollutant: maxObs.ParameterName,
        timestamp: this.buildTimestamp(maxObs),
        location: {
          lat: maxObs.Latitude,
          lng: maxObs.Longitude,
        },
      });
    });

    return results;
  }

  private buildTimestamp(obs: AirNowObservation): string {
    // DateObserved is a bare date ("2026-07-03", sometimes with a trailing
    // space) and HourObserved is in the observation site's LOCAL zone,
    // reported via LocalTimeZone as a fixed abbreviation. The old
    // host-local setHours() skewed the timestamp by the server-vs-site
    // offset and could land on the wrong calendar day.
    const TZ_OFFSET_HOURS: Record<string, number> = {
      EST: -5, EDT: -4, CST: -6, CDT: -5, MST: -7, MDT: -6,
      PST: -8, PDT: -7, AKST: -9, AKDT: -8, HST: -10,
    };

    const m = (obs.DateObserved || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return new Date().toISOString();

    const offset = TZ_OFFSET_HOURS[(obs.LocalTimeZone || '').trim().toUpperCase()];
    // Unknown zone: treat as UTC — stable, unlike host-local interpretation.
    const hourUtc = offset !== undefined ? obs.HourObserved - offset : obs.HourObserved || 0;
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], hourUtc)).toISOString();
  }

  /**
   * Get AQI category color for UI
   */
  static getAqiColor(aqi: number): string {
    if (aqi <= 50) return '#00e400'; // Good - Green
    if (aqi <= 100) return '#ffff00'; // Moderate - Yellow
    if (aqi <= 150) return '#ff7e00'; // USG - Orange
    if (aqi <= 200) return '#ff0000'; // Unhealthy - Red
    if (aqi <= 300) return '#8f3f97'; // Very Unhealthy - Purple
    return '#7e0023'; // Hazardous - Maroon
  }

  /**
   * Get AQI category description
   */
  static getAqiDescription(aqi: number): string {
    if (aqi <= 50) return 'Good';
    if (aqi <= 100) return 'Moderate';
    if (aqi <= 150) return 'Unhealthy for Sensitive Groups';
    if (aqi <= 200) return 'Unhealthy';
    if (aqi <= 300) return 'Very Unhealthy';
    return 'Hazardous';
  }
}

