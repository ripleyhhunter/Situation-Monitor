/**
 * Current Weather Fetcher
 * 
 * Uses Open-Meteo API (free, no API key required) to fetch current weather conditions.
 * https://open-meteo.com/
 */

import { BaseFetcher } from './base.js';
import type { CurrentWeather } from '../types/index.js';
import config from '../config.js';
import logger from '../logger.js';

interface OpenMeteoResponse {
  latitude: number;
  longitude: number;
  timezone: string;
  current: {
    time: string;
    temperature_2m: number;
    relative_humidity_2m: number;
    apparent_temperature: number;
    weather_code: number;
    wind_speed_10m: number;
    wind_direction_10m: number;
  };
}

// WMO Weather interpretation codes
// https://open-meteo.com/en/docs#weathervariables
const WMO_CODES: Record<number, { description: string; icon: string }> = {
  0: { description: 'Clear sky', icon: '☀️' },
  1: { description: 'Mainly clear', icon: '🌤️' },
  2: { description: 'Partly cloudy', icon: '⛅' },
  3: { description: 'Overcast', icon: '☁️' },
  45: { description: 'Fog', icon: '🌫️' },
  48: { description: 'Depositing rime fog', icon: '🌫️' },
  51: { description: 'Light drizzle', icon: '🌧️' },
  53: { description: 'Moderate drizzle', icon: '🌧️' },
  55: { description: 'Dense drizzle', icon: '🌧️' },
  56: { description: 'Light freezing drizzle', icon: '🌧️' },
  57: { description: 'Dense freezing drizzle', icon: '🌧️' },
  61: { description: 'Slight rain', icon: '🌧️' },
  63: { description: 'Moderate rain', icon: '🌧️' },
  65: { description: 'Heavy rain', icon: '🌧️' },
  66: { description: 'Light freezing rain', icon: '🌨️' },
  67: { description: 'Heavy freezing rain', icon: '🌨️' },
  71: { description: 'Slight snow', icon: '🌨️' },
  73: { description: 'Moderate snow', icon: '🌨️' },
  75: { description: 'Heavy snow', icon: '❄️' },
  77: { description: 'Snow grains', icon: '🌨️' },
  80: { description: 'Slight rain showers', icon: '🌦️' },
  81: { description: 'Moderate rain showers', icon: '🌦️' },
  82: { description: 'Violent rain showers', icon: '⛈️' },
  85: { description: 'Slight snow showers', icon: '🌨️' },
  86: { description: 'Heavy snow showers', icon: '❄️' },
  95: { description: 'Thunderstorm', icon: '⛈️' },
  96: { description: 'Thunderstorm with slight hail', icon: '⛈️' },
  99: { description: 'Thunderstorm with heavy hail', icon: '⛈️' },
};

// Wind direction to cardinal
function getWindDirection(degrees: number): string {
  const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const index = Math.round(degrees / 22.5) % 16;
  return directions[index];
}

export class CurrentWeatherFetcher extends BaseFetcher<CurrentWeather> {
  private lat: number;
  private lng: number;

  constructor() {
    super('current-weather', config.cacheTtl.weather);
    this.lat = config.defaultLat;
    this.lng = config.defaultLng;
  }

  protected async fetchFromApi(): Promise<CurrentWeather[]> {
    // Open-Meteo API endpoint
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude', this.lat.toString());
    url.searchParams.set('longitude', this.lng.toString());
    url.searchParams.set('current', 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m');
    url.searchParams.set('temperature_unit', 'fahrenheit');
    url.searchParams.set('wind_speed_unit', 'mph');
    url.searchParams.set('timezone', 'America/New_York');

    try {
      const response = await this.httpGet<OpenMeteoResponse>(url.toString());

      if (!response.current) {
        logger.warn('Open-Meteo response missing current data');
        return [];
      }

      const current = response.current;
      const weatherInfo = WMO_CODES[current.weather_code] || { description: 'Unknown', icon: '❓' };

      const weather: CurrentWeather = {
        temperature: current.temperature_2m,
        feelsLike: current.apparent_temperature,
        humidity: current.relative_humidity_2m,
        windSpeed: current.wind_speed_10m,
        windDirection: getWindDirection(current.wind_direction_10m),
        description: weatherInfo.description,
        icon: weatherInfo.icon,
        timestamp: new Date().toISOString(),
      };

      return [weather];
    } catch (error) {
      logger.error('Failed to fetch current weather', { error });
      throw error;
    }
  }
}

export const currentWeatherFetcher = new CurrentWeatherFetcher();
export default currentWeatherFetcher;
