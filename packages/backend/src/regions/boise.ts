import type { RegionPack } from './types.js';

import { PulsePointFetcher } from '../fetchers/pulsepoint.js';
import { bpdCrimeFetcher } from '../fetchers/bpd-crime.js';
import { adaCrimeFetcher } from '../fetchers/ada-crime.js';
import { achdClosuresFetcher } from '../fetchers/achd-closures.js';
import { WzdxFetcher } from '../fetchers/wzdx.js';
import { WildfireFetcher } from '../fetchers/wildfire.js';
import { UsgsQuakesFetcher } from '../fetchers/usgs-quakes.js';
import { NwsGaugesFetcher } from '../fetchers/nws-gauges.js';
import { boiseLandmarkWebcamsFetcher } from '../fetchers/boise-landmark-webcams.js';
import { idaho511CamerasFetcher } from '../fetchers/idaho511-cameras.js';
import { idaho511EventsFetcher } from '../fetchers/idaho511-events.js';
import HivisCamerasFetcher from '../fetchers/hivis-cameras.js';
import { NWSWeatherFetcher } from '../fetchers/nws-weather.js';
import { CurrentWeatherFetcher } from '../fetchers/current-weather.js';
import { AirNowFetcher } from '../fetchers/airnow.js';
import { OpenSkyFetcher } from '../fetchers/opensky.js';
import { NewsFetcher } from '../fetchers/news.js';

// Treasure Valley bounding box: BOI airport south, Lucky Peak east,
// Caldwell/Nampa west, Eagle/foothills north. Matches the OpenSky region
// we want to surface aircraft for.
const TREASURE_VALLEY_BOUNDS = {
  lamin: 43.40,
  lamax: 43.95,
  lomin: -116.80,
  lomax: -115.85,
};

const BOISE_CENTER = { lat: 43.6150, lng: -116.2023, zoom: 12 };
const BOISE_NWS_ZONES = ['IDZ012', 'IDZ013', 'IDZ014', 'IDZ015'];

const BOISE_NEWS_CONFIG = {
  rssFeeds: [
    { url: 'https://www.ktvb.com/feeds/syndication/rss/news/local', source: 'ktvb', name: 'KTVB Local' },
    { url: 'https://boisedev.com/feed/', source: 'boisedev', name: 'BoiseDev' },
    { url: 'https://idahocapitalsun.com/feed/', source: 'idaho-capital-sun', name: 'Idaho Capital Sun' },
  ],
  areaKeywords: [
    'boise', 'meridian', 'nampa', 'caldwell', 'eagle', 'star', 'kuna',
    'garden city', 'treasure valley', 'ada county', 'canyon county',
    'idaho', 'bogus basin', 'bsu', 'boise state',
    'capitol blvd', 'state street', 'fairview', 'chinden',
    'i-84', 'i-184', 'us-20', 'us-95',
  ],
  locationPatterns: [
    /\d{3,4}\s+block/i,
    /\bi-\d+/i,
    /\bus-\d+/i,
    /\b(highway|hwy)\s*\d+/i,
  ],
};

// Ada County-City Emergency Services System (ACCESS) — agency id EMS1169.
// Covers: Boise Fire, Ada County Paramedics, Eagle Fire, Meridian Fire,
// North Ada County Fire & Rescue, Star Fire.
const boisePulsePoint = new PulsePointFetcher({
  regionId: 'boise',
  browserLat: BOISE_CENTER.lat,
  browserLng: BOISE_CENTER.lng,
  zipCode: '83702',
  agencyMatcher: /Ada County|Boise Fire|ACCESS|Meridian Fire/i,
  cityPattern: /(BOISE|MERIDIAN|EAGLE|STAR|KUNA|GARDEN CITY|NAMPA|CALDWELL),\s*ID/i,
  titlePrefix: 'ACCESS',
  timezone: 'America/Boise',
  geocodeCity: 'Boise',
  geocodeState: 'ID',
  fallbackCenter: { lat: 43.6166, lng: -116.2002 },
  useDcQuadrantFallback: false,
});

const itdWzdx = new WzdxFetcher({
  source: 'itd-wzdx',
  url: 'https://511.idaho.gov/api/wzdx',
  regionId: 'boise',
  label: 'ITD WZDx',
  bounds: TREASURE_VALLEY_BOUNDS,
});

// Wildfire awareness envelope: SW Idaho / eastern Oregon border country,
// much wider than the Treasure Valley — a large fire 100 km out still
// matters here (smoke, evacuations, I-84 closures).
const boiseWildfire = new WildfireFetcher({
  regionId: 'boise',
  bounds: { lamin: 42.5, lamax: 45.0, lomin: -117.5, lomax: -114.5 },
});

const boiseQuakes = new UsgsQuakesFetcher({
  regionId: 'boise',
  lat: BOISE_CENTER.lat,
  lng: BOISE_CENTER.lng,
});

// Boise River gauges through town plus the lower valley.
const boiseGauges = new NwsGaugesFetcher({
  regionId: 'boise',
  bbox: { xmin: -116.8, ymin: 43.4, xmax: -115.85, ymax: 43.95 },
});

export const boiseRegion: RegionPack = {
  id: 'boise',
  name: 'Boise, ID',
  city: 'Boise',
  state: 'ID',
  timezone: 'America/Boise',

  defaultCenter: BOISE_CENTER,
  openSkyBounds: TREASURE_VALLEY_BOUNDS,

  // IDZ012 Lower Treasure Valley (Boise itself), IDZ013 Boise Mountains,
  // IDZ014 Upper Treasure Valley, IDZ015 Southwest Highlands.
  nwsZones: BOISE_NWS_ZONES,

  // Complete-snapshot sources — absence from a successful poll implies
  // cleared/ended: ITD WZDx and ACHD RITA are full listings, and WFIGS
  // "Current" removes fires once contained/out.
  // 'nws-gauge' emits only currently-flooding gauges — absence implies
  // the water receded. 'usgs-quake' is a complete snapshot of its rolling
  // 7-day window — absence means the event aged out or USGS deleted it.
  // 'itd-events' is the live Idaho 511 incident board — ITD removes
  // events once cleared, so absence implies the scene is closed.
  sourcesWithCompleteListing: ['itd-wzdx', 'achd', 'wfigs', 'nws-gauge', 'usgs-quake', 'itd-events'],

  cameraFetchers: [
    boiseLandmarkWebcamsFetcher,
    idaho511CamerasFetcher,
    // USGS river-gauge cams — live imagery at Boise River gauges (same
    // nationwide roster as DC's; honestly empty if none in the valley).
    new HivisCamerasFetcher({ regionId: 'boise', bounds: TREASURE_VALLEY_BOUNDS }),
  ],
  // idaho511EventsFetcher rides the 1-min traffic cron: live crashes /
  // Waze hazard reports need freshness the 5-15 min profiles can't give.
  trafficIncidentFetchers: [itdWzdx, achdClosuresFetcher, idaho511EventsFetcher],
  // Two crime sources, partitioned by agency so nothing double-plots:
  // bpd-crime is the city's own layer (freshest available for Boise PD);
  // ada-crime is county CrimeMapper for ACSO/Meridian/Garden City, whose
  // Boise PD rows backfill over 1-3 months and are excluded there.
  crimeFetchers: [bpdCrimeFetcher, adaCrimeFetcher],
  shotspotterFetchers: [],
  emergencyAlertFetchers: [boiseWildfire, boiseQuakes, boiseGauges],

  pulsePointFetcher: boisePulsePoint,
  // Valley Regional Transit publishes only GTFS-realtime protobuf (no JSON
  // alerts feed) — defer.
  transitFetcher: null,
  // Boise/Ada County uses SWIRC P25 Phase II; no public OpenMHz bridge yet.
  scannerFetcher: null,
  twitterFetcher: null,

  weatherAlertFetcher: new NWSWeatherFetcher({
    regionId: 'boise',
    lat: BOISE_CENTER.lat,
    lng: BOISE_CENTER.lng,
    zones: BOISE_NWS_ZONES,
  }),
  currentWeatherFetcher: new CurrentWeatherFetcher({
    regionId: 'boise',
    lat: BOISE_CENTER.lat,
    lng: BOISE_CENTER.lng,
    timezone: 'America/Boise',
  }),
  airQualityFetcher: new AirNowFetcher({
    regionId: 'boise',
    lat: BOISE_CENTER.lat,
    lng: BOISE_CENTER.lng,
  }),
  aircraftFetcher: new OpenSkyFetcher({
    regionId: 'boise',
    regionName: 'Boise, ID',
    bounds: TREASURE_VALLEY_BOUNDS,
  }),
  newsFetcher: new NewsFetcher('boise', BOISE_NEWS_CONFIG, 'Boise, ID'),

  newsConfig: BOISE_NEWS_CONFIG,
};

export default boiseRegion;
