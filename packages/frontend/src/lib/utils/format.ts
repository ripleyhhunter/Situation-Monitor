import type { IncidentType, WeatherSeverity } from '$types';

/**
 * Get display name for incident type
 */
export function getIncidentTypeName(type: IncidentType): string {
  const names: Record<IncidentType, string> = {
    traffic: 'Traffic',
    crime: 'Crime',
    fire: 'Fire/EMS',
    weather: 'Weather',
    transit: 'Transit',
    gunshot: 'Gunshot',
    hazard: 'Hazard',
  };
  return names[type] || type;
}

/**
 * Get icon name for incident type
 */
export function getIncidentTypeIcon(type: IncidentType): string {
  const icons: Record<IncidentType, string> = {
    traffic: 'car-crash',
    crime: 'shield-exclamation',
    fire: 'fire',
    weather: 'cloud-lightning',
    transit: 'train',
    gunshot: 'crosshairs',
    hazard: 'alert-triangle',
  };
  return icons[type] || 'alert-circle';
}

/**
 * Get color for incident type
 */
export function getIncidentTypeColor(type: IncidentType): string {
  const colors: Record<IncidentType, string> = {
    traffic: '#f97316',   // Orange
    crime: '#ef4444',     // Red
    fire: '#dc2626',      // Dark Red
    weather: '#6366f1',   // Indigo
    transit: '#3b82f6',   // Blue
    gunshot: '#9333ea',   // Purple
    hazard: '#eab308',    // Yellow
  };
  return colors[type] || '#6b7280';
}

/**
 * Get color for severity level
 */
export function getSeverityColor(severity: number): string {
  const colors: Record<number, string> = {
    1: '#22c55e', // Green - Info
    2: '#3b82f6', // Blue - Low
    3: '#eab308', // Yellow - Medium
    4: '#f97316', // Orange - High
    5: '#ef4444', // Red - Critical
  };
  return colors[severity] || '#6b7280';
}

/**
 * Get label for severity level
 */
export function getSeverityLabel(severity: number): string {
  const labels: Record<number, string> = {
    1: 'Info',
    2: 'Low',
    3: 'Medium',
    4: 'High',
    5: 'Critical',
  };
  return labels[severity] || 'Unknown';
}

/**
 * Get color for weather severity
 */
export function getWeatherSeverityColor(severity: WeatherSeverity): string {
  const colors: Record<WeatherSeverity, string> = {
    minor: '#22c55e',     // Green
    moderate: '#eab308',  // Yellow
    severe: '#f97316',    // Orange
    extreme: '#ef4444',   // Red
  };
  return colors[severity] || '#6b7280';
}

/**
 * Format a number with commas
 */
export function formatNumber(num: number): string {
  return num.toLocaleString('en-US');
}

/**
 * Truncate text with ellipsis
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

/**
 * Capitalize first letter
 */
export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}
