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
 * Curated list of landmark webcams in the DC area
 * These are manually maintained since they don't have a unified API
 * 
 * Sources:
 * - WeatherBug: Traffic/weather cameras with CDN image URLs
 * - EarthCam: High-quality landmark cameras (page links)
 * - YouTube: 24/7 live streams (embeddable)
 * - FOX 5 DC: Local news station skycams (https://www.fox5dc.com/live-weather-cameras-across-dc-maryland-and-virginia)
 * - Official: Government-operated cameras (Senate, NPS)
 * - BloomCam: Seasonal cherry blossom camera
 */
interface LandmarkWebcam {
  id: string;
  name: string;
  lat: number;
  lng: number;
  type: 'weatherbug' | 'earthcam' | 'youtube' | 'fox5' | 'official' | 'other';
  camId?: string; // For WeatherBug cameras
  youtubeId?: string; // For YouTube embeds
  pageUrl: string; // URL to view the webcam
  description?: string;
}

const LANDMARK_WEBCAMS: LandmarkWebcam[] = [
  // ==========================================
  // OFFICIAL GOVERNMENT CAMERAS (Highest Priority)
  // ==========================================
  {
    id: 'senate-capitol',
    name: 'US Capitol Building (Official)',
    lat: 38.8899,
    lng: -77.0091,
    type: 'official',
    pageUrl: 'https://www.senate.gov/general/capcam.htm',
    description: 'Official US Senate Capitol Camera - live view of the Capitol dome',
  },
  {
    id: 'nps-monument',
    name: 'Washington Monument (NPS)',
    lat: 38.8895,
    lng: -77.0353,
    type: 'official',
    pageUrl: 'https://www.nps.gov/nama/learn/photosmultimedia/webcams.htm',
    description: 'National Park Service webcam from top of Washington Monument',
  },

  // ==========================================
  // YOUTUBE 24/7 LIVE STREAMS (Embeddable)
  // ==========================================
  {
    id: 'yt-whitehouse',
    name: 'White House Live',
    lat: 38.8977,
    lng: -77.0365,
    type: 'youtube',
    youtubeId: '2VfLiHHbIkk',
    pageUrl: 'https://www.youtube.com/live/2VfLiHHbIkk',
    description: '24/7 live stream of the White House',
  },
  {
    id: 'yt-fox5-dc',
    name: 'FOX 5 DC Skyline 24/7',
    lat: 38.8950,
    lng: -77.0300,
    type: 'youtube',
    youtubeId: 'lHkebfwmC4U',
    pageUrl: 'https://www.youtube.com/watch?v=lHkebfwmC4U',
    description: 'FOX 5 DC 24/7 live cam - Capitol, monuments, and DC skyline',
  },

  // ==========================================
  // FOX 5 DC SKYCAMS (Regional Coverage)
  // Source: https://www.fox5dc.com/live-weather-cameras-across-dc-maryland-and-virginia
  // ==========================================
  {
    id: 'fox5-wharf',
    name: 'The Wharf - SW DC',
    lat: 38.8783,
    lng: -77.0228,
    type: 'fox5',
    pageUrl: 'https://www.fox5dc.com/skycam-washington-dc-at-the-wharf',
    description: '360° views: Waterfront, Tidal Basin, Lincoln Memorial, Monument, Capitol, Pentagon, DCA',
  },
  {
    id: 'fox5-stacks',
    name: 'The Stacks - SW DC',
    lat: 38.8720,
    lng: -77.0125,
    type: 'fox5',
    pageUrl: 'https://www.fox5dc.com/fox-5-skycam-southwest-dc',
    description: 'Near Audi Field - views of DCA, Pentagon, Rosslyn, Capitol, Monument, Wharf',
  },
  {
    id: 'fox5-gaithersburg',
    name: 'Gaithersburg - RIO Lakefront',
    lat: 39.1399,
    lng: -77.2041,
    type: 'fox5',
    pageUrl: 'https://www.fox5dc.com/live-weather-cameras-across-dc-maryland-and-virginia',
    description: 'RIO Lakefront, I-270 traffic, Sugarloaf Mountain views',
  },
  {
    id: 'fox5-rockville',
    name: 'Rockville, MD',
    lat: 39.0840,
    lng: -77.1528,
    type: 'fox5',
    pageUrl: 'https://www.fox5dc.com/fox-5-skycam-rockville-md',
    description: 'Montgomery County - Rockville area',
  },
  {
    id: 'fox5-nationalharbor',
    name: 'National Harbor - Capital Wheel',
    lat: 38.7872,
    lng: -77.0147,
    type: 'fox5',
    pageUrl: 'https://www.fox5dc.com/skycam-national-harbor-oxon-hill-md',
    description: 'Capital Wheel, Wilson Bridge, Alexandria views',
  },
  {
    id: 'fox5-fairfax',
    name: 'Downtown Fairfax, VA',
    lat: 38.8462,
    lng: -77.3064,
    type: 'fox5',
    pageUrl: 'https://www.fox5dc.com/live-weather-cameras-across-dc-maryland-and-virginia',
    description: 'Main St/University Dr area in Fairfax City',
  },
  {
    id: 'fox5-reston',
    name: 'Reston, VA',
    lat: 38.9586,
    lng: -77.3570,
    type: 'fox5',
    pageUrl: 'https://www.fox5dc.com/fox-5-skycam-reston',
    description: 'Reston Town Center area',
  },
  {
    id: 'fox5-loudoun',
    name: 'Loudoun Station - Ashburn',
    lat: 39.0066,
    lng: -77.4622,
    type: 'fox5',
    pageUrl: 'https://www.fox5dc.com/live-weather-cameras-across-dc-maryland-and-virginia',
    description: 'Ashburn/Dulles corridor (sponsored by Bryce Resort)',
  },

  // ==========================================
  // EARTHCAM LANDMARK CAMERAS (High Quality)
  // ==========================================
  {
    id: 'ec-monument',
    name: 'Washington Monument View',
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

  // ==========================================
  // WEATHERBUG CAMERAS (Traffic/Weather)
  // ==========================================
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
    name: 'National Harbor (WeatherBug)',
    lat: 38.7824,
    lng: -77.0167,
    type: 'weatherbug',
    camId: 'NTNLH',
    pageUrl: 'https://www.weatherbug.com/weather-camera/?cam=NTNLH',
    description: 'National Harbor waterfront area',
  },

  // ==========================================
  // SEASONAL / SPECIAL CAMERAS
  // ==========================================
  {
    id: 'bloomcam-cherry',
    name: 'BloomCam - Cherry Blossoms',
    lat: 38.8853,
    lng: -77.0386,
    type: 'other',
    pageUrl: 'https://www.bloomcam.org/',
    description: 'Live cherry blossom cam on National Mall (seasonal)',
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
      const streamUrl = this.getStreamUrl(webcam);

      return {
        id: `landmark-${webcam.id}`,
        name: webcam.name,
        location: {
          lat: webcam.lat,
          lng: webcam.lng,
        },
        regionId: 'dc',
        source: 'landmark' as const,
        streamUrl,
        imageUrl: undefined, // Most require page visit
        lastUpdated: ROSTER_STAMP,
      };
    });

    logger.info(`landmark-webcams: Loaded ${cameras.length} webcams (official: ${
      LANDMARK_WEBCAMS.filter(w => w.type === 'official').length
    }, youtube: ${
      LANDMARK_WEBCAMS.filter(w => w.type === 'youtube').length
    }, fox5: ${
      LANDMARK_WEBCAMS.filter(w => w.type === 'fox5').length
    }, earthcam: ${
      LANDMARK_WEBCAMS.filter(w => w.type === 'earthcam').length
    }, weatherbug: ${
      LANDMARK_WEBCAMS.filter(w => w.type === 'weatherbug').length
    })`);
    
    return cameras;
  }

  /**
   * Get the best stream URL for a webcam
   * For YouTube cameras, returns embeddable YouTube URL
   * For others, returns the page URL
   */
  private getStreamUrl(webcam: LandmarkWebcam): string {
    if (webcam.type === 'youtube' && webcam.youtubeId) {
      // Return YouTube watch URL (can be embedded)
      return `https://www.youtube.com/watch?v=${webcam.youtubeId}`;
    }
    return webcam.pageUrl;
  }
}

export const landmarkWebcamsFetcher = new LandmarkWebcamsFetcher();
export default landmarkWebcamsFetcher;
