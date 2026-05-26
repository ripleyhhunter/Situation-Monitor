import { writable, derived } from 'svelte/store';
import type { WeatherAlert, AirQuality, CurrentWeather, RegionId } from '$types';
import { selectedRegionId } from './region';

// Per-region current weather. SSE 'weather:current' events carry regionId.
export const currentWeatherByRegion = writable<Record<RegionId, CurrentWeather | null>>({
  dc: null,
  boise: null,
});

export function setCurrentWeather(weather: CurrentWeather | null): void {
  if (!weather) return;
  currentWeatherByRegion.update((map) => ({ ...map, [weather.regionId]: weather }));
}

/** Active region's current weather. */
export const currentWeather = derived(
  [currentWeatherByRegion, selectedRegionId],
  ([$map, $regionId]) => $map[$regionId],
);

// Store for weather alerts across all regions.
export const weatherAlerts = writable<Map<string, WeatherAlert>>(new Map());

// Add or update a weather alert
export function upsertWeatherAlert(alert: WeatherAlert): void {
  weatherAlerts.update((map) => {
    map.set(alert.id, alert);
    return new Map(map);
  });
}

// Remove a weather alert
export function removeWeatherAlert(id: string): void {
  weatherAlerts.update((map) => {
    map.delete(id);
    return new Map(map);
  });
}

// Clear all weather alerts
export function clearAllWeatherAlerts(): void {
  weatherAlerts.set(new Map());
}

// Derived: active alerts for the selected region, sorted by severity.
export const activeWeatherAlerts = derived(
  [weatherAlerts, selectedRegionId],
  ([$alerts, $regionId]) => {
    const severityOrder: Record<string, number> = {
      extreme: 4,
      severe: 3,
      moderate: 2,
      minor: 1,
    };

    return Array.from($alerts.values())
      .filter((a) => a.regionId === $regionId && new Date(a.expires) > new Date())
      .sort((a, b) => (severityOrder[b.severity] || 0) - (severityOrder[a.severity] || 0));
  },
);

// Per-region AQI. SSE 'aqi:update' events carry regionId.
export const airQualityByRegion = writable<Record<RegionId, AirQuality | null>>({
  dc: null,
  boise: null,
});

export function setAirQuality(aqi: AirQuality | null): void {
  if (!aqi) return;
  airQualityByRegion.update((map) => ({ ...map, [aqi.regionId]: aqi }));
}

/** Active region's AQI reading. */
export const airQuality = derived(
  [airQualityByRegion, selectedRegionId],
  ([$map, $regionId]) => $map[$regionId],
);

// Derived store for AQI color
export const aqiColor = derived(airQuality, ($aqi) => {
  if (!$aqi) return '#9ca3af'; // Gray for unknown

  const value = $aqi.aqi;
  if (value <= 50) return '#00e400';   // Good - Green
  if (value <= 100) return '#ffff00';  // Moderate - Yellow
  if (value <= 150) return '#ff7e00';  // USG - Orange
  if (value <= 200) return '#ff0000';  // Unhealthy - Red
  if (value <= 300) return '#8f3f97';  // Very Unhealthy - Purple
  return '#7e0023';                    // Hazardous - Maroon
});

// Derived store for AQI description
export const aqiDescription = derived(airQuality, ($aqi) => {
  if (!$aqi) return 'Unknown';

  const value = $aqi.aqi;
  if (value <= 50) return 'Good';
  if (value <= 100) return 'Moderate';
  if (value <= 150) return 'Unhealthy for Sensitive Groups';
  if (value <= 200) return 'Unhealthy';
  if (value <= 300) return 'Very Unhealthy';
  return 'Hazardous';
});
