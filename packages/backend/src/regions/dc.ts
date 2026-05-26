import type { RegionPack } from './types.js';

import { mdchartCamerasFetcher } from '../fetchers/mdchart-cameras.js';
import { dcCamerasFetcher } from '../fetchers/dc-cameras.js';
import { landmarkWebcamsFetcher } from '../fetchers/landmark-webcams.js';
import { mdchartIncidentsFetcher } from '../fetchers/mdchart-incidents.js';
import { dcCrimeFetcher } from '../fetchers/dc-crime.js';
import { mocoCrimeFetcher } from '../fetchers/moco-crime.js';
import { pgCrimeFetcher } from '../fetchers/pg-crime.js';
import { dcShotSpotterFetcher } from '../fetchers/dc-shotspotter.js';
import { dcTrafficFetcher } from '../fetchers/dc-traffic.js';
import { alertDCFetcher } from '../fetchers/alertdc.js';
import { wmataFetcher } from '../fetchers/wmata.js';
import { openMHzFetcher } from '../fetchers/openmhz.js';
import { dcFireEMSTwitterFetcher } from '../fetchers/dcfireems-twitter.js';
import { PulsePointFetcher } from '../fetchers/pulsepoint.js';
import { NWSWeatherFetcher } from '../fetchers/nws-weather.js';
import { CurrentWeatherFetcher } from '../fetchers/current-weather.js';
import { AirNowFetcher } from '../fetchers/airnow.js';
import { OpenSkyFetcher } from '../fetchers/opensky.js';
import { NewsFetcher } from '../fetchers/news.js';

const DC_CENTER = { lat: 38.9072, lng: -77.0369, zoom: 12 };
const DC_OPENSKY_BOUNDS = { lamin: 38.6, lamax: 39.3, lomin: -77.6, lomax: -76.6 };
const DC_NWS_ZONES = ['DCZ001', 'MDZ013', 'MDZ014', 'VAZ053', 'VAZ054'];

const DC_NEWS_CONFIG = {
  rssFeeds: [
    { url: 'https://wtop.com/region/local/feed/', source: 'wtop', name: 'WTOP Local' },
    { url: 'https://wtop.com/region/local/dc/feed/', source: 'wtop', name: 'WTOP DC' },
    { url: 'https://wtop.com/region/local/maryland/feed/', source: 'wtop', name: 'WTOP Maryland' },
    { url: 'https://wtop.com/region/local/virginia/feed/', source: 'wtop', name: 'WTOP Virginia' },
    { url: 'https://dcist.com/feed/', source: 'dcist', name: 'DCist' },
    { url: 'https://www.nbcwashington.com/news/local/?rss=y', source: 'nbc4', name: 'NBC4 Local' },
    { url: 'https://www.wusa9.com/feeds/syndication/rss/news/local', source: 'wusa9', name: 'WUSA9 Local' },
    { url: 'https://www.fox5dc.com/tag/local-news.rss', source: 'fox5', name: 'Fox 5 DC' },
  ],
  areaKeywords: [
    'washington', 'dc', 'd.c.', 'district', 'capitol', 'capitol hill',
    'northwest', 'northeast', 'southwest', 'southeast', 'nw', 'ne', 'sw', 'se',
    'maryland', 'virginia', 'montgomery', 'prince george', 'fairfax', 'arlington',
    'alexandria', 'bethesda', 'silver spring', 'rockville', 'college park',
    'anacostia', 'georgetown', 'dupont', 'adams morgan', 'u street', 'h street',
    'navy yard', 'wharf', 'nationals', 'downtown',
  ],
  locationPatterns: [
    /\d{3,4}\s+block/i,
    /\b(nw|ne|sw|se)\b/i,
    /\bi-\d+/i,
    /\bward\s+\d/i,
  ],
};

const dcPulsePoint = new PulsePointFetcher({
  regionId: 'dc',
  browserLat: DC_CENTER.lat,
  browserLng: DC_CENTER.lng,
  zipCode: '20001',
  agencyMatcher: /DC Fire and EMS|District of Columbia Fire/i,
  cityPattern: /WASHINGTON,\s*DC/i,
  titlePrefix: 'DCFD',
  fallbackCenter: { lat: 38.8899, lng: -77.0091 },
  useDcQuadrantFallback: true,
});

export const dcRegion: RegionPack = {
  id: 'dc',
  name: 'Washington, DC',
  city: 'Washington',
  state: 'DC',
  timezone: 'America/New_York',

  defaultCenter: DC_CENTER,
  openSkyBounds: DC_OPENSKY_BOUNDS,

  nwsZones: DC_NWS_ZONES,

  sourcesWithCompleteListing: ['mdchart', 'dc-traffic', 'wmata', 'alertdc'],

  cameraFetchers: [
    mdchartCamerasFetcher,
    dcCamerasFetcher,
    landmarkWebcamsFetcher,
  ],

  trafficIncidentFetchers: [
    mdchartIncidentsFetcher,
    dcTrafficFetcher,
  ],

  crimeFetchers: [
    dcCrimeFetcher,
    mocoCrimeFetcher,
    pgCrimeFetcher,
  ],

  shotspotterFetchers: [
    dcShotSpotterFetcher,
  ],

  emergencyAlertFetchers: [
    alertDCFetcher,
  ],

  pulsePointFetcher: dcPulsePoint,
  transitFetcher: wmataFetcher,
  scannerFetcher: openMHzFetcher,
  twitterFetcher: dcFireEMSTwitterFetcher,

  weatherAlertFetcher: new NWSWeatherFetcher({
    regionId: 'dc',
    lat: DC_CENTER.lat,
    lng: DC_CENTER.lng,
    zones: DC_NWS_ZONES,
  }),
  currentWeatherFetcher: new CurrentWeatherFetcher({
    regionId: 'dc',
    lat: DC_CENTER.lat,
    lng: DC_CENTER.lng,
    timezone: 'America/New_York',
  }),
  airQualityFetcher: new AirNowFetcher({
    regionId: 'dc',
    lat: DC_CENTER.lat,
    lng: DC_CENTER.lng,
  }),
  aircraftFetcher: new OpenSkyFetcher({
    regionId: 'dc',
    regionName: 'Washington, DC',
    bounds: DC_OPENSKY_BOUNDS,
  }),
  newsFetcher: new NewsFetcher('dc', DC_NEWS_CONFIG, 'Washington, DC'),

  newsConfig: DC_NEWS_CONFIG,
};

export default dcRegion;
