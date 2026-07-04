import { writable, get } from 'svelte/store';
import type { Incident, WeatherAlert, RegionId } from '$types';
import { haversineDistance } from '$utils/geo';
import { selectedRegionId } from '$stores/region';
import { userLocation, setMapCenter, setMapZoom } from '$stores/location';
import { selectIncident } from '$stores/incidents';

export type NotificationPermission = 'default' | 'granted' | 'denied';

export interface NotificationSettings {
  enabled: boolean;
  /** Only notify for severity 4-5 incidents. */
  criticalOnly: boolean;
  /** Only notify for incidents within nearbyRadiusKm of the user's location. */
  nearbyOnly: boolean;
  nearbyRadiusKm: number;
  /** Also notify for severe/extreme NWS weather alerts. */
  weatherAlerts: boolean;
  sound: boolean;
}

const DEFAULT_SETTINGS: NotificationSettings = {
  enabled: false,
  criticalOnly: false,
  nearbyOnly: false,
  nearbyRadiusKm: 5,
  weatherAlerts: true,
  sound: true,
};

const STORAGE_KEY = 'situation-monitor.notificationSettings';

// Crime feeds ingest records hours-to-weeks old as incident:new (BPD lags
// ~a month); only OS-notify for incidents that are actually fresh.
const FRESHNESS_MS = 30 * 60 * 1000;

// Cap the session dedupe set so a long-lived tab doesn't grow it forever.
const MAX_NOTIFIED_IDS = 1000;

function readSettings(): NotificationSettings {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_SETTINGS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<NotificationSettings>;
    return {
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : DEFAULT_SETTINGS.enabled,
      criticalOnly: typeof parsed.criticalOnly === 'boolean' ? parsed.criticalOnly : DEFAULT_SETTINGS.criticalOnly,
      nearbyOnly: typeof parsed.nearbyOnly === 'boolean' ? parsed.nearbyOnly : DEFAULT_SETTINGS.nearbyOnly,
      nearbyRadiusKm:
        typeof parsed.nearbyRadiusKm === 'number' && parsed.nearbyRadiusKm >= 1 && parsed.nearbyRadiusKm <= 50
          ? parsed.nearbyRadiusKm
          : DEFAULT_SETTINGS.nearbyRadiusKm,
      weatherAlerts: typeof parsed.weatherAlerts === 'boolean' ? parsed.weatherAlerts : DEFAULT_SETTINGS.weatherAlerts,
      sound: typeof parsed.sound === 'boolean' ? parsed.sound : DEFAULT_SETTINGS.sound,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export const notificationPermission = writable<NotificationPermission>('default');
export const notificationSettings = writable<NotificationSettings>(readSettings());

notificationSettings.subscribe((settings) => {
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Storage full/blocked — settings just won't persist.
    }
  }
});

export function updateNotificationSettings(partial: Partial<NotificationSettings>): void {
  notificationSettings.update((s) => ({ ...s, ...partial }));
}

export function checkNotificationPermission(): void {
  if (typeof Notification !== 'undefined') {
    notificationPermission.set(Notification.permission as NotificationPermission);
  }
}

/**
 * Request browser permission and enable notifications if granted.
 * Returns true when permission is granted.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof Notification === 'undefined') {
    console.warn('Notifications not supported in this browser');
    return false;
  }

  const permission = await Notification.requestPermission();
  notificationPermission.set(permission as NotificationPermission);

  if (permission === 'granted') {
    updateNotificationSettings({ enabled: true });
    return true;
  }
  return false;
}

export interface NotifyContext {
  selectedRegionId: RegionId;
  userLocation: [number, number] | null;
  /** ms epoch "now" — injected for testability. */
  now: number;
}

/**
 * Pure decision: should this incident produce an OS notification?
 * Exported for unit tests; permission and dedupe are checked separately.
 */
export function shouldNotifyIncident(
  incident: Incident,
  settings: NotificationSettings,
  ctx: NotifyContext
): boolean {
  if (!settings.enabled) return false;
  if (incident.status !== 'active') return false;
  // Only the region being watched — a Boise crime ping while watching DC is noise.
  if (incident.regionId !== ctx.selectedRegionId) return false;

  // Freshness gate: crime/CAD feeds replay old records as "new" all the time.
  const age = ctx.now - new Date(incident.timestamp).getTime();
  if (Number.isNaN(age) || age > FRESHNESS_MS || age < -FRESHNESS_MS) return false;

  if (settings.criticalOnly && incident.severity < 4) return false;

  if (settings.nearbyOnly) {
    if (!ctx.userLocation) return false;
    const [lat, lng] = ctx.userLocation;
    const distance = haversineDistance(lat, lng, incident.location.lat, incident.location.lng);
    if (distance > settings.nearbyRadiusKm) return false;
  }

  return true;
}

/**
 * Pure decision for weather alerts: severe/extreme only, selected region only.
 */
export function shouldNotifyWeatherAlert(
  alert: WeatherAlert,
  settings: NotificationSettings,
  ctx: Pick<NotifyContext, 'selectedRegionId'>
): boolean {
  if (!settings.enabled || !settings.weatherAlerts) return false;
  if (alert.regionId !== ctx.selectedRegionId) return false;
  return alert.severity === 'severe' || alert.severity === 'extreme';
}

// Session-scoped dedupe — an incident:update or reconnect replay must not
// re-fire the same notification.
const notifiedIds = new Set<string>();

function markNotified(id: string): void {
  notifiedIds.add(id);
  if (notifiedIds.size > MAX_NOTIFIED_IDS) {
    // Sets iterate in insertion order — drop the oldest entries.
    const excess = notifiedIds.size - MAX_NOTIFIED_IDS;
    let i = 0;
    for (const oldId of notifiedIds) {
      notifiedIds.delete(oldId);
      if (++i >= excess) break;
    }
  }
}

const TYPE_EMOJI: Record<string, string> = {
  traffic: '🚗',
  crime: '🚨',
  fire: '🔥',
  weather: '🌩️',
  transit: '🚇',
  gunshot: '🔫',
  hazard: '⚠️',
};

function canShowNotifications(): boolean {
  return typeof Notification !== 'undefined' && Notification.permission === 'granted';
}

/**
 * Notify for a new incident (call sites gate on the SSE snapshot burst so
 * reconnect replays never spam).
 */
export function notifyIncident(incident: Incident): void {
  if (!canShowNotifications()) return;
  if (notifiedIds.has(incident.id)) return;

  const settings = get(notificationSettings);
  const ctx: NotifyContext = {
    selectedRegionId: get(selectedRegionId),
    userLocation: get(userLocation),
    now: Date.now(),
  };
  if (!shouldNotifyIncident(incident, settings, ctx)) return;

  markNotified(incident.id);

  const emoji = TYPE_EMOJI[incident.type] ?? '📍';
  try {
    const notification = new Notification(`${emoji} ${incident.title}`, {
      body: incident.description || incident.location.address || '',
      tag: `incident-${incident.id}`,
      requireInteraction: incident.severity >= 4,
    });
    notification.onclick = () => {
      window.focus();
      setMapCenter(incident.location.lat, incident.location.lng);
      setMapZoom(15);
      selectIncident(incident);
      notification.close();
    };
  } catch {
    // Some mobile browsers only allow ServiceWorkerRegistration.showNotification.
    return;
  }

  if (settings.sound && incident.severity >= 4) {
    playAlertSound();
  }
}

/**
 * Notify for a severe/extreme weather alert.
 */
export function notifyWeatherAlert(alert: WeatherAlert): void {
  if (!canShowNotifications()) return;
  const dedupeKey = `weather-${alert.id}`;
  if (notifiedIds.has(dedupeKey)) return;

  const settings = get(notificationSettings);
  if (!shouldNotifyWeatherAlert(alert, settings, { selectedRegionId: get(selectedRegionId) })) return;

  markNotified(dedupeKey);

  try {
    const notification = new Notification(`🌩️ ${alert.event}`, {
      body: alert.headline,
      tag: dedupeKey,
      requireInteraction: alert.severity === 'extreme',
    });
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  } catch {
    return;
  }

  if (settings.sound) {
    playAlertSound();
  }
}

/**
 * Short two-tone chirp via WebAudio — no audio asset needed.
 */
function playAlertSound(): void {
  try {
    type AudioContextCtor = typeof AudioContext;
    const Ctor: AudioContextCtor | undefined =
      typeof AudioContext !== 'undefined'
        ? AudioContext
        : (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    const gain = ctx.createGain();
    gain.gain.value = 0.08;
    gain.connect(ctx.destination);

    const tone = (freq: number, start: number, duration: number) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(gain);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + duration);
    };
    tone(880, 0, 0.12);
    tone(660, 0.15, 0.12);
    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 500);
  } catch {
    // Audio blocked before user interaction — fine.
  }
}

// Initialize permission status on load
if (typeof window !== 'undefined') {
  checkNotificationPermission();
}
