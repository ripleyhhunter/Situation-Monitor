import { writable, get } from 'svelte/store';
import type { Incident, WeatherAlert } from '$types';

export type NotificationPermission = 'default' | 'granted' | 'denied';

// Store for notification permission status
export const notificationPermission = writable<NotificationPermission>('default');

// Store for notification settings
export const notificationSettings = writable({
  enabled: false,
  criticalOnly: false,    // Only notify for severity 4-5
  nearbyOnly: false,      // Only notify for incidents within radius
  nearbyRadius: 5,        // km
  sound: true,
});

/**
 * Request notification permission
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof Notification === 'undefined') {
    console.warn('Notifications not supported');
    return false;
  }

  const permission = await Notification.requestPermission();
  notificationPermission.set(permission as NotificationPermission);

  if (permission === 'granted') {
    notificationSettings.update((s) => ({ ...s, enabled: true }));
    return true;
  }

  return false;
}

/**
 * Check current notification permission
 */
export function checkNotificationPermission(): void {
  if (typeof Notification !== 'undefined') {
    notificationPermission.set(Notification.permission as NotificationPermission);
  }
}

/**
 * Send a browser notification for an incident
 */
export function notifyIncident(incident: Incident): void {
  const settings = get(notificationSettings);

  if (!settings.enabled) return;
  if (settings.criticalOnly && incident.severity < 4) return;

  const icon = getIncidentIcon(incident.type);
  const tag = `incident-${incident.id}`;

  const notification = new Notification(incident.title, {
    body: incident.description,
    icon,
    tag, // Prevents duplicate notifications
    requireInteraction: incident.severity >= 4,
  });

  // Play sound for critical incidents
  if (settings.sound && incident.severity >= 4) {
    playAlertSound();
  }

  notification.onclick = () => {
    window.focus();
    // Could dispatch a custom event to focus on this incident
    window.dispatchEvent(new CustomEvent('focus-incident', { detail: incident }));
  };
}

/**
 * Send a browser notification for a weather alert
 */
export function notifyWeatherAlert(alert: WeatherAlert): void {
  const settings = get(notificationSettings);

  if (!settings.enabled) return;

  const isCritical = alert.severity === 'severe' || alert.severity === 'extreme';
  if (settings.criticalOnly && !isCritical) return;

  const notification = new Notification(`Weather Alert: ${alert.event}`, {
    body: alert.headline,
    icon: '/icons/weather.svg',
    tag: `weather-${alert.id}`,
    requireInteraction: isCritical,
  });

  if (settings.sound && isCritical) {
    playAlertSound();
  }

  notification.onclick = () => {
    window.focus();
    window.dispatchEvent(new CustomEvent('focus-weather', { detail: alert }));
  };
}

/**
 * Get icon path for incident type
 */
function getIncidentIcon(type: string): string {
  const icons: Record<string, string> = {
    traffic: '/icons/traffic.svg',
    crime: '/icons/crime.svg',
    fire: '/icons/fire.svg',
    weather: '/icons/weather.svg',
    transit: '/icons/transit.svg',
    gunshot: '/icons/gunshot.svg',
    hazard: '/icons/hazard.svg',
  };
  return icons[type] || '/icons/default.svg';
}

/**
 * Play alert sound
 */
function playAlertSound(): void {
  try {
    const audio = new Audio('/sounds/alert.mp3');
    audio.volume = 0.5;
    audio.play().catch(() => {
      // Ignore errors - user might not have interacted yet
    });
  } catch {
    // Audio not supported
  }
}

// Initialize permission status on load
if (typeof window !== 'undefined') {
  checkNotificationPermission();
}
