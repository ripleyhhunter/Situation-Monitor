import type { BaseFetcher } from '../fetchers/base.js';
import type { Aircraft, AirQuality, Camera, CurrentWeather, Incident, RegionId, ScannerCall, WeatherAlert } from '../types/index.js';
import type { NewsFetcher } from '../fetchers/news.js';

export type { RegionId };
// To add a region: extend RegionId in `types/index.ts`, add a pack file
// `regions/<id>.ts`, then register it in `regions/index.ts`.

export interface BoundingBox {
  lamin: number;
  lamax: number;
  lomin: number;
  lomax: number;
}

export interface RssFeedConfig {
  url: string;
  source: string;
  name: string;
}

export interface RegionNewsConfig {
  rssFeeds: RssFeedConfig[];
  /** Lowercase keywords that mark an article as locally relevant. */
  areaKeywords: string[];
  /** Region-specific patterns (block numbers, quadrants, freeways) that boost relevance. */
  locationPatterns: RegExp[];
}

/**
 * A region pack bundles every region-specific fetcher and parameter so the
 * generic aggregator can be region-agnostic. Fields left empty (`[]`) or
 * `null` mean the region simply doesn't provide that data type.
 */
export interface RegionPack {
  id: RegionId;
  name: string;        // Human-readable display name, e.g. "Washington, DC"
  city: string;        // City portion, e.g. "Washington"
  state: string;       // Two-letter, e.g. "DC", "ID"
  timezone: string;    // IANA tz, e.g. "America/New_York"

  defaultCenter: { lat: number; lng: number; zoom: number };
  openSkyBounds: BoundingBox;

  /** NWS public zone IDs to use as a fallback when the point-based alert query fails. */
  nwsZones: string[];

  /** Incident.source values that represent a *complete* feed snapshot — absence implies cleared. */
  sourcesWithCompleteListing: string[];

  // Region-specific fetcher groups, each on their own scheduling profile.
  cameraFetchers: BaseFetcher<Camera>[];
  trafficIncidentFetchers: BaseFetcher<Incident>[];
  crimeFetchers: BaseFetcher<Incident>[];
  shotspotterFetchers: BaseFetcher<Incident>[];
  emergencyAlertFetchers: BaseFetcher<Incident>[];

  pulsePointFetcher: BaseFetcher<Incident> | null;
  transitFetcher: BaseFetcher<Incident> | null;
  scannerFetcher: BaseFetcher<ScannerCall> | null;
  twitterFetcher: BaseFetcher<Incident> | null;

  // Shared fetchers — region-instantiated so each region tags its data.
  weatherAlertFetcher: BaseFetcher<WeatherAlert>;
  currentWeatherFetcher: BaseFetcher<CurrentWeather>;
  airQualityFetcher: BaseFetcher<AirQuality>;
  aircraftFetcher: BaseFetcher<Aircraft>;
  newsFetcher: NewsFetcher;

  newsConfig: RegionNewsConfig;
}
