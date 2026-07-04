import { describe, it, expect } from 'vitest';
import { shouldNotifyIncident, shouldNotifyWeatherAlert } from './notifications';
import type { NotificationSettings, NotifyContext } from './notifications';
import type { Incident, WeatherAlert } from '$types';

const NOW = Date.parse('2026-07-04T12:00:00Z');

function mkIncident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: 'n-1',
    regionId: 'dc',
    type: 'fire',
    severity: 3,
    location: { lat: 38.9, lng: -77.0 },
    timestamp: new Date(NOW - 60 * 1000).toISOString(),
    updatedAt: new Date(NOW - 60 * 1000).toISOString(),
    source: 'pulsepoint',
    title: 'Structure fire',
    description: '',
    status: 'active',
    metadata: {},
    ...overrides,
  };
}

function mkSettings(overrides: Partial<NotificationSettings> = {}): NotificationSettings {
  return {
    enabled: true,
    criticalOnly: false,
    nearbyOnly: false,
    nearbyRadiusKm: 5,
    weatherAlerts: true,
    sound: false,
    ...overrides,
  };
}

function mkCtx(overrides: Partial<NotifyContext> = {}): NotifyContext {
  return {
    selectedRegionId: 'dc',
    userLocation: null,
    now: NOW,
    ...overrides,
  };
}

describe('shouldNotifyIncident', () => {
  it('notifies for a fresh active incident in the selected region', () => {
    expect(shouldNotifyIncident(mkIncident(), mkSettings(), mkCtx())).toBe(true);
  });

  it('never notifies when disabled', () => {
    expect(shouldNotifyIncident(mkIncident(), mkSettings({ enabled: false }), mkCtx())).toBe(false);
  });

  it('ignores incidents from other regions', () => {
    const boise = mkIncident({ regionId: 'boise' });
    expect(shouldNotifyIncident(boise, mkSettings(), mkCtx({ selectedRegionId: 'dc' }))).toBe(false);
    expect(shouldNotifyIncident(boise, mkSettings(), mkCtx({ selectedRegionId: 'boise' }))).toBe(true);
  });

  it('ignores stale incidents (lagging crime feeds replay old records as new)', () => {
    const stale = mkIncident({ timestamp: new Date(NOW - 2 * 60 * 60 * 1000).toISOString() });
    expect(shouldNotifyIncident(stale, mkSettings(), mkCtx())).toBe(false);
  });

  it('ignores incidents with unparseable or far-future timestamps', () => {
    expect(shouldNotifyIncident(mkIncident({ timestamp: 'garbage' }), mkSettings(), mkCtx())).toBe(false);
    const future = mkIncident({ timestamp: new Date(NOW + 2 * 60 * 60 * 1000).toISOString() });
    expect(shouldNotifyIncident(future, mkSettings(), mkCtx())).toBe(false);
  });

  it('ignores non-active incidents', () => {
    expect(shouldNotifyIncident(mkIncident({ status: 'cleared' }), mkSettings(), mkCtx())).toBe(false);
  });

  it('criticalOnly keeps severity >= 4 only', () => {
    const settings = mkSettings({ criticalOnly: true });
    expect(shouldNotifyIncident(mkIncident({ severity: 3 }), settings, mkCtx())).toBe(false);
    expect(shouldNotifyIncident(mkIncident({ severity: 4 }), settings, mkCtx())).toBe(true);
  });

  it('nearbyOnly requires a known user location', () => {
    const settings = mkSettings({ nearbyOnly: true });
    expect(shouldNotifyIncident(mkIncident(), settings, mkCtx({ userLocation: null }))).toBe(false);
  });

  it('nearbyOnly filters by distance from the user', () => {
    const settings = mkSettings({ nearbyOnly: true, nearbyRadiusKm: 5 });
    // User at the DC center; incident ~1km away.
    const near = mkIncident({ location: { lat: 38.909, lng: -77.037 } });
    // Incident in Baltimore, ~50km away.
    const far = mkIncident({ location: { lat: 39.29, lng: -76.61 } });
    const ctx = mkCtx({ userLocation: [38.9072, -77.0369] });

    expect(shouldNotifyIncident(near, settings, ctx)).toBe(true);
    expect(shouldNotifyIncident(far, settings, ctx)).toBe(false);
  });
});

function mkAlert(overrides: Partial<WeatherAlert> = {}): WeatherAlert {
  return {
    id: 'w-1',
    regionId: 'dc',
    event: 'Tornado Warning',
    severity: 'extreme',
    urgency: 'immediate',
    headline: 'Tornado Warning for DC',
    description: '',
    areas: [],
    onset: new Date(NOW).toISOString(),
    expires: new Date(NOW + 60 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

describe('shouldNotifyWeatherAlert', () => {
  it('notifies for severe/extreme alerts in the selected region', () => {
    expect(shouldNotifyWeatherAlert(mkAlert(), mkSettings(), { selectedRegionId: 'dc' })).toBe(true);
    expect(shouldNotifyWeatherAlert(mkAlert({ severity: 'severe' }), mkSettings(), { selectedRegionId: 'dc' })).toBe(true);
  });

  it('skips minor/moderate alerts', () => {
    expect(shouldNotifyWeatherAlert(mkAlert({ severity: 'moderate' }), mkSettings(), { selectedRegionId: 'dc' })).toBe(false);
  });

  it('skips other regions and disabled settings', () => {
    expect(shouldNotifyWeatherAlert(mkAlert({ regionId: 'boise' }), mkSettings(), { selectedRegionId: 'dc' })).toBe(false);
    expect(shouldNotifyWeatherAlert(mkAlert(), mkSettings({ weatherAlerts: false }), { selectedRegionId: 'dc' })).toBe(false);
    expect(shouldNotifyWeatherAlert(mkAlert(), mkSettings({ enabled: false }), { selectedRegionId: 'dc' })).toBe(false);
  });
});
