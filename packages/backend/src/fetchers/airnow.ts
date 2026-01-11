import { BaseFetcher } from './base.js';
import type { AirQuality } from '../types/index.js';
import config from '../config.js';
import logger from '../logger.js';

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
  private apiKey: string;

  constructor() {
    super('airnow', config.cacheTtl.airQuality);
    this.apiKey = config.airnowApiKey || '';
  }

  protected async fetchFromApi(): Promise<AirQuality[]> {
    // Try API first, fallback to alternative source if no key
    if (this.apiKey) {
      return this.fetchFromAirNowApi();
    }

    // Fallback: Use AirNow's public observation endpoint
    return this.fetchFromPublicEndpoint();
  }

  private async fetchFromAirNowApi(): Promise<AirQuality[]> {
    const url = new URL('https://www.airnowapi.org/aq/observation/latLong/current/');
    url.searchParams.set('format', 'application/json');
    url.searchParams.set('latitude', config.defaultLat.toString());
    url.searchParams.set('longitude', config.defaultLng.toString());
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
    // Use airnow.gov's public data for DC area
    // This is a workaround if no API key is available
    try {
      const zipCode = '20001'; // DC zip code
      const url = `https://www.airnow.gov/aqi/reporting-area/dc/washington/${zipCode}`;

      // Since we can't scrape HTML easily, we'll return a default structure
      // and log that API key is needed for real data
      logger.info(
        'AirNow API key not configured. Register at https://docs.airnowapi.org/ for real AQI data'
      );

      // Return empty - frontend will show "unavailable"
      return [];
    } catch (error) {
      logger.debug('Failed to fetch public AirNow data', { error });
      return [];
    }
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

    byArea.forEach((areaObs, key) => {
      // Find the observation with the highest AQI
      const maxObs = areaObs.reduce((max, obs) =>
        obs.AQI > max.AQI ? obs : max
      );

      results.push({
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
    const date = new Date(obs.DateObserved);
    date.setHours(obs.HourObserved);
    return date.toISOString();
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

export const airnowFetcher = new AirNowFetcher();
export default airnowFetcher;
