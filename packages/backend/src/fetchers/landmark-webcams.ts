import { BaseFetcher } from './base.js';
import type { Camera } from '../types/index.js';
import config from '../config.js';
import logger from '../logger.js';

/**
 * Curated list of landmark webcams in the DC area
 * These are manually maintained since they don't have a unified API
 */
interface LandmarkWebcam {
  id: string;
  name: string;
  lat: number;
  lng: number;
  type: 'weatherbug' | 'earthcam' | 'youtube' | 'other';
  camId?: string; // For WeatherBug cameras
  pageUrl: string; // URL to view the webcam
  description?: string;
}

const LANDMARK_WEBCAMS: LandmarkWebcam[] = [
  // WeatherBug cameras - these have direct image URLs
  {
    id: 'wb-lincoln',
    name: 'Lincoln Memorial View',
    lat: 38.8893,
    lng: -77.0502,
    type: 'weatherbug',
    camId: 'MOWDC',
    pageUrl: 'https://www.weatherbug.com/weather-camera/?cam=MOWDC',
    description: 'View across Potomac toward Arlington from Salamander Hotel',
  },
  {
    id: 'wb-wjla1',
    name: 'Arlington Route 50',
    lat: 38.8816,
    lng: -77.1147,
    type: 'weatherbug',
    camId: 'WJLAW',
    pageUrl: 'https://www.weatherbug.com/weather-camera/?cam=WJLAW',
    description: 'WJLA camera overlooking Route 50 in Arlington',
  },
  {
    id: 'wb-wjla2',
    name: 'National Cathedral Area',
    lat: 38.9304,
    lng: -77.0706,
    type: 'weatherbug',
    camId: 'WJLAB',
    pageUrl: 'https://www.weatherbug.com/weather-camera/?cam=WJLAB',
    description: 'WJLA Tower 2 - Wisconsin Ave/Cathedral area',
  },
  {
    id: 'wb-pentagon',
    name: 'Pentagon City Traffic',
    lat: 38.8633,
    lng: -77.0592,
    type: 'weatherbug',
    camId: 'RCPCA',
    pageUrl: 'https://www.weatherbug.com/weather-camera/?cam=RCPCA',
    description: 'Route 395/Washington Blvd near Pentagon',
  },
  {
    id: 'wb-nationals',
    name: 'Nationals Park',
    lat: 38.8730,
    lng: -77.0074,
    type: 'weatherbug',
    camId: 'WSHNP',
    pageUrl: 'https://www.weatherbug.com/weather-camera/?cam=WSHNP',
    description: 'View of Nationals Park stadium',
  },
  {
    id: 'wb-harbor',
    name: 'National Harbor',
    lat: 38.7824,
    lng: -77.0167,
    type: 'weatherbug',
    camId: 'NTNLH',
    pageUrl: 'https://www.weatherbug.com/weather-camera/?cam=NTNLH',
    description: 'National Harbor waterfront area',
  },
  // EarthCam - link to page (can't embed due to auth tokens)
  {
    id: 'ec-monument',
    name: 'Washington Monument',
    lat: 38.8895,
    lng: -77.0353,
    type: 'earthcam',
    pageUrl: 'https://www.earthcam.com/usa/dc/washingtonmonument/?cam=wamo',
    description: 'Live HD cam from top of Washington Monument',
  },
  {
    id: 'ec-cherry',
    name: 'Tidal Basin Cherry Blossoms',
    lat: 38.8814,
    lng: -77.0365,
    type: 'earthcam',
    pageUrl: 'https://www.earthcam.com/usa/dc/cherryblossoms/?cam=cherryblossoms2',
    description: 'Cherry blossom views at the Tidal Basin',
  },
  {
    id: 'ec-kennedy',
    name: 'Kennedy Center',
    lat: 38.8957,
    lng: -77.0556,
    type: 'earthcam',
    pageUrl: 'https://www.earthcam.com/usa/dc/?cam=dc_kennedycenter',
    description: 'Kennedy Center with Roosevelt Bridge view',
  },
  {
    id: 'ec-mlk',
    name: 'MLK Memorial',
    lat: 38.8862,
    lng: -77.0442,
    type: 'earthcam',
    pageUrl: 'https://www.earthcam.com/usa/dc/mlk/?cam=mlkmemorial',
    description: 'Martin Luther King Jr. Memorial',
  },
  // YouTube Live
  {
    id: 'yt-whitehouse',
    name: 'White House Live',
    lat: 38.8977,
    lng: -77.0365,
    type: 'youtube',
    pageUrl: 'https://www.youtube.com/live/2VfLiHHbIkk',
    description: '24/7 live stream of the White House',
  },
  // Other
  {
    id: 'windy-capitol',
    name: 'US Capitol Building',
    lat: 38.8899,
    lng: -77.0091,
    type: 'other',
    pageUrl: 'https://windy.com/webcams/1263154384',
    description: 'Live view of the US Capitol',
  },
];

export class LandmarkWebcamsFetcher extends BaseFetcher<Camera> {
  constructor() {
    super('landmark-webcams', config.cacheTtl.trafficCameras);
  }

  protected async fetchFromApi(): Promise<Camera[]> {
    // This is a static list, but we format it as cameras
    // and generate current image URLs for WeatherBug cams
    const cameras: Camera[] = LANDMARK_WEBCAMS.map((webcam) => {
      const imageUrl = this.getImageUrl(webcam);

      return {
        id: `landmark-${webcam.id}`,
        name: webcam.name,
        location: {
          lat: webcam.lat,
          lng: webcam.lng,
        },
        source: 'landmark' as any, // Special source type
        streamUrl: webcam.pageUrl,
        imageUrl,
        lastUpdated: new Date().toISOString(),
      };
    });

    logger.info(`landmark-webcams: Loaded ${cameras.length} webcams`);
    return cameras;
  }

  private getImageUrl(_webcam: LandmarkWebcam): string | undefined {
    // Note: WeatherBug CDN requires authentication that we can't replicate
    // All landmark cameras will link to their respective pages instead
    // The user can view live streams directly on the provider's site
    return undefined;
  }
}

export const landmarkWebcamsFetcher = new LandmarkWebcamsFetcher();
export default landmarkWebcamsFetcher;
