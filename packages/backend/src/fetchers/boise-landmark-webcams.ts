import { BaseFetcher } from './base.js';
import type { Camera } from '../types/index.js';
import config from '../config.js';
import logger from '../logger.js';

// Stable per-process roster stamp. Cameras are a quasi-static roster with
// no per-item feed timestamp; stamping `now` on every poll made the
// aggregator rebroadcast the whole roster to every client each cycle
// (hundreds of SSE events and full marker rebuilds every 5 minutes).
const ROSTER_STAMP = new Date().toISOString();

/**
 * Curated webcam list for the Boise / Treasure Valley region.
 *
 * Most entries are direct JPG snapshots served by NWS Boise's eye-n-sky
 * partner (https://www.weather.gov/boi/webcams). A few extras link out to
 * Bogus Basin (ski hill) and the city's official skycam pages.
 */

interface LandmarkWebcam {
  id: string;
  name: string;
  lat: number;
  lng: number;
  type: 'nws' | 'weather' | 'ski' | 'youtube' | 'official' | 'other';
  pageUrl: string;
  imageUrl?: string;
  description?: string;
}

const LANDMARK_WEBCAMS: LandmarkWebcam[] = [
  // --- NWS Boise airport cams (direct JPG snapshots) ---
  {
    id: 'nws-caldwell-nw',
    name: 'Caldwell Industrial Airport (NW view)',
    lat: 43.6418,
    lng: -116.6356,
    type: 'nws',
    pageUrl: 'https://www.weather.gov/boi/webcams',
    imageUrl: 'https://www.eye-n-sky.net/webcam/Caldwell/Caldwell-NW.jpg',
    description: 'NWS Boise partner cam at Caldwell Industrial Airport, looking northwest',
  },
  {
    id: 'nws-caldwell-e',
    name: 'Caldwell Industrial Airport (East view)',
    lat: 43.6418,
    lng: -116.6356,
    type: 'nws',
    pageUrl: 'https://www.weather.gov/boi/webcams',
    imageUrl: 'https://www.eye-n-sky.net/webcam/Caldwell/Caldwell-East.jpg',
    description: 'NWS Boise partner cam at Caldwell Industrial Airport, looking east',
  },
  {
    id: 'nws-weiser-e',
    name: 'Weiser Airport (East view)',
    lat: 44.2046,
    lng: -116.9740,
    type: 'nws',
    pageUrl: 'https://www.weather.gov/boi/webcams',
    imageUrl: 'https://www.eye-n-sky.net/webcam/Weiser/Weiser-East.jpg',
    description: 'NWS Boise partner cam at Weiser Airport, looking east',
  },
  {
    id: 'nws-weiser-sw',
    name: 'Weiser Airport (SW view)',
    lat: 44.2046,
    lng: -116.9740,
    type: 'nws',
    pageUrl: 'https://www.weather.gov/boi/webcams',
    imageUrl: 'https://www.eye-n-sky.net/webcam/Weiser/Weiser-SW.jpg',
    description: 'NWS Boise partner cam at Weiser Airport, looking southwest',
  },
  {
    id: 'nws-payette-e',
    name: 'Payette Airport (East view)',
    lat: 44.0857,
    lng: -116.9282,
    type: 'nws',
    pageUrl: 'https://www.weather.gov/boi/webcams',
    imageUrl: 'https://www.eye-n-sky.net/webcam/Payette-S75/Payette-S75-East.jpg',
    description: 'NWS Boise partner cam at Payette Airport, looking east',
  },
  {
    id: 'nws-mccall',
    name: 'McCall Airport',
    lat: 44.8895,
    lng: -116.1018,
    type: 'nws',
    pageUrl: 'https://www.weather.gov/boi/webcams',
    imageUrl: 'https://evogov.s3.amazonaws.com/media/141/media/136405.jpeg',
    description: 'McCall Airport snapshot (NWS Boise partner cam)',
  },
  {
    id: 'nws-council-n',
    name: 'Council Airport (North view)',
    lat: 44.7466,
    lng: -116.4382,
    type: 'nws',
    pageUrl: 'https://www.weather.gov/boi/webcams',
    imageUrl: 'https://map.eye-n-sky.net/LatestImage/Council-U82-North',
    description: 'NWS Boise partner cam at Council Airport, looking north',
  },
  {
    id: 'nws-council-s',
    name: 'Council Airport (South view)',
    lat: 44.7466,
    lng: -116.4382,
    type: 'nws',
    pageUrl: 'https://www.weather.gov/boi/webcams',
    imageUrl: 'https://map.eye-n-sky.net/LatestImage/Council-U82-South',
    description: 'NWS Boise partner cam at Council Airport, looking south',
  },
  {
    id: 'nws-twinfalls-sw',
    name: 'Twin Falls Airport (SW view)',
    lat: 42.4818,
    lng: -114.4877,
    type: 'nws',
    pageUrl: 'https://www.weather.gov/boi/webcams',
    imageUrl: 'https://www.eye-n-sky.net/webcam/TwinFalls/TwinFalls-SW.jpg',
    description: 'NWS Boise partner cam at Twin Falls Airport, looking southwest',
  },
  {
    id: 'nws-twinfalls-se',
    name: 'Twin Falls Airport (SE view)',
    lat: 42.4818,
    lng: -114.4877,
    type: 'nws',
    pageUrl: 'https://www.weather.gov/boi/webcams',
    imageUrl: 'https://www.eye-n-sky.net/webcam/TwinFalls/TwinFalls-SE.jpg',
    description: 'NWS Boise partner cam at Twin Falls Airport, looking southeast',
  },

  // --- Ski / mountain conditions ---
  {
    id: 'bogus-basin',
    name: 'Bogus Basin Ski Area',
    lat: 43.7665,
    lng: -116.1029,
    type: 'ski',
    pageUrl: 'https://bogusbasin.org/your-mountain/conditions-webcams/',
    description: 'Bogus Basin live conditions cams (Pioneer Lodge, summit, base area)',
  },

  // --- Official / aggregators ---
  {
    id: 'boise-greenbelt',
    name: 'Boise River Greenbelt area',
    lat: 43.6164,
    lng: -116.2025,
    type: 'other',
    pageUrl: 'https://worldcam.eu/webcams/north-america/idaho-usa/24931-boise-boise-river-park',
    description: 'Boise River Park / Greenbelt area webcams (aggregator page)',
  },
  {
    id: 'boi-airport',
    name: 'Boise Airport (BOI) - 511 area',
    lat: 43.5644,
    lng: -116.2228,
    type: 'official',
    pageUrl: 'https://511.idaho.gov/',
    description: 'ITD Idaho 511 traffic cameras around Boise Airport',
  },
];

export class BoiseLandmarkWebcamsFetcher extends BaseFetcher<Camera> {
  constructor() {
    super('boise-landmark-webcams', config.cacheTtl.trafficCameras);
  }

  protected async fetchFromApi(): Promise<Camera[]> {
    const cameras: Camera[] = LANDMARK_WEBCAMS.map((webcam) => ({
      id: `landmark-${webcam.id}`,
      name: webcam.name,
      location: { lat: webcam.lat, lng: webcam.lng },
      regionId: 'boise',
      source: 'landmark' as const,
      streamUrl: webcam.pageUrl,
      imageUrl: webcam.imageUrl,
      lastUpdated: ROSTER_STAMP,
    }));

    const byType = LANDMARK_WEBCAMS.reduce<Record<string, number>>((acc, w) => {
      acc[w.type] = (acc[w.type] || 0) + 1;
      return acc;
    }, {});

    logger.info(`boise-landmark-webcams: Loaded ${cameras.length} webcams`, byType);
    return cameras;
  }
}

export const boiseLandmarkWebcamsFetcher = new BoiseLandmarkWebcamsFetcher();
export default boiseLandmarkWebcamsFetcher;
