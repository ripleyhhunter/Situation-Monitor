import type { RegionPack } from './types.js';

import { PulsePointFetcher } from '../fetchers/pulsepoint.js';
import { bpdCrimeFetcher } from '../fetchers/bpd-crime.js';
import { ItdWzdxFetcher } from '../fetchers/itd-wzdx.js';
import { boiseLandmarkWebcamsFetcher } from '../fetchers/boise-landmark-webcams.js';
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
  geocodeCity: 'Boise',
  geocodeState: 'ID',
  fallbackCenter: { lat: 43.6166, lng: -116.2002 },
  useDcQuadrantFallback: false,
});

const itdWzdx = new ItdWzdxFetcher({ bounds: TREASURE_VALLEY_BOUNDS });

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

  // ITD WZDx publishes complete state snapshots — absence implies cleared.
  sourcesWithCompleteListing: ['itd-wzdx'],

  cameraFetchers: [boiseLandmarkWebcamsFetcher],
  trafficIncidentFetchers: [itdWzdx],
  crimeFetchers: [bpdCrimeFetcher],
  shotspotterFetchers: [],
  emergencyAlertFetchers: [],

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
