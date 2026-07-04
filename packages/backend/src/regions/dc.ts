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
import { WzdxFetcher } from '../fetchers/wzdx.js';
import { vdotFetcher } from '../fetchers/vdot.js';
import { dc311Fetcher } from '../fetchers/dc-311.js';
import { wmataFetcher } from '../fetchers/wmata.js';
import { OpenMHzFetcher } from '../fetchers/openmhz.js';
import { dcFireEMSTwitterFetcher } from '../fetchers/dcfireems-twitter.js';
import { PulsePointFetcher } from '../fetchers/pulsepoint.js';
import { WildfireFetcher } from '../fetchers/wildfire.js';
import { UsgsQuakesFetcher } from '../fetchers/usgs-quakes.js';
import { NwsGaugesFetcher } from '../fetchers/nws-gauges.js';
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

// MDOT's WZDx feed (via RITIS) regenerates every 60s — lane-level work
// zone detail that complements the MD CHART incident feed.
const mdWzdx = new WzdxFetcher({
  source: 'md-wzdx',
  url: 'https://filter.ritis.org/wzdx_v4.1/mdot.geojson',
  regionId: 'dc',
  label: 'MDOT WZDx',
  bounds: { lamin: 38.3, lamax: 39.5, lomin: -77.7, lomax: -76.3 },
});

const dcPulsePoint = new PulsePointFetcher({
  regionId: 'dc',
  browserLat: DC_CENTER.lat,
  browserLng: DC_CENTER.lng,
  zipCode: '20001',
  agencyMatcher: /DC Fire and EMS|District of Columbia Fire/i,
  cityPattern: /WASHINGTON,\s*DC/i,
  titlePrefix: 'DCFD',
  timezone: 'America/New_York',
  geocodeCity: 'Washington',
  geocodeState: 'DC',
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

  sourcesWithCompleteListing: [
    'mdchart', 'dc-traffic', 'wmata', 'alertdc', 'wfigs',
    'md-wzdx', 'vdot', 'nws-gauge', 'usgs-quake',
  ],

  cameraFetchers: [
    mdchartCamerasFetcher,
    dcCamerasFetcher,
    landmarkWebcamsFetcher,
  ],

  trafficIncidentFetchers: [
    mdchartIncidentsFetcher,
    dcTrafficFetcher,
    mdWzdx,
    // The only keyless NoVA incident source — Virginia's registered WZDx
    // feed is token-gated.
    vdotFetcher,
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
    // Near-real-time 311 intake filtered to situational categories
    // (signals out, wires down, flooding, downed trees...).
    dc311Fetcher,
    // Rarely non-empty for DC (brush fires do happen) — presence-implies-
    // active semantics keep the layer honestly empty otherwise.
    new WildfireFetcher({
      regionId: 'dc',
      bounds: { lamin: 38.3, lamax: 39.5, lomin: -77.7, lomax: -76.3 },
    }),
    // Rarely non-empty here (~1 event/30d in 200 km) — honestly quiet.
    new UsgsQuakesFetcher({ regionId: 'dc', lat: DC_CENTER.lat, lng: DC_CENTER.lng }),
    // Potomac (Little Falls, Georgetown, Alexandria), Anacostia, Rock Creek.
    new NwsGaugesFetcher({
      regionId: 'dc',
      bbox: { xmin: -77.4, ymin: 38.7, xmax: -76.8, ymax: 39.1 },
    }),
  ],

  pulsePointFetcher: dcPulsePoint,
  transitFetcher: wmataFetcher,
  // DC Fire & EMS on OpenMHz — near-real-time call audio (newest calls
  // typically <60s old). Feeds the scanner panel, not the map.
  scannerFetcher: new OpenMHzFetcher({ regionId: 'dc', systemId: 'dcfd', systemLabel: 'DC Fire & EMS' }),
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
