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
 * Roster refreshed 2026-07-04 (camera coverage sweep — every entry
 * live-verified): dead cams pruned (old White House YouTube id, three
 * WeatherBug cams WeatherBug itself removed, the retired FOX5 Fairfax
 * skycam), the WeatherBug survivors moved to the dedicated `weatherbug`
 * source (which has real stills), and verified persistent streams added
 * (earthTV White House, Union Station railcam, National Zoo HLS cams,
 * FOX5 Prince William Marina, NPS air-quality Mall cam).
 *
 * Sources:
 * - EarthCam: High-quality landmark cameras (page links / YouTube lives)
 * - YouTube: 24/7 live streams (embeddable in-modal)
 * - Zoo: Smithsonian National Zoo Wowza HLS (CORS *, plays in-modal)
 * - FOX 5 DC: Local news station skycams
 * - Official: Government-operated cameras (Senate, NPS)
 * - BloomCam: Seasonal cherry blossom camera
 */
interface LandmarkWebcam {
  id: string;
  name: string;
  lat: number;
  lng: number;
  type: 'earthcam' | 'youtube' | 'zoo' | 'fox5' | 'official' | 'other';
  youtubeId?: string; // For YouTube embeds
  hlsUrl?: string; // Direct HLS playlist (plays in-modal via hls.js)
  imageUrl?: string; // Direct still image, when one exists
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
  {
    id: 'nps-mall-ard',
    name: 'National Mall Air Cam (NPS)',
    lat: 38.8926,
    lng: -77.0687,
    type: 'official',
    imageUrl: 'https://www.nps.gov/featurecontent/ard/webcams/images/wash.jpg',
    pageUrl: 'https://www.nps.gov/subjects/air/webcams.htm?site=wash',
    description: 'NPS Air Resources cam at the Netherlands Carillon looking east over the Mall — updates ~15 min, includes live AQI',
  },

  // ==========================================
  // YOUTUBE 24/7 LIVE STREAMS (Embeddable in-modal)
  // ==========================================
  {
    id: 'yt-whitehouse',
    name: 'White House Live (earthTV)',
    lat: 38.8977,
    lng: -77.0365,
    type: 'youtube',
    youtubeId: 'r1K7DyQn3jg',
    pageUrl: 'https://www.youtube.com/watch?v=r1K7DyQn3jg',
    description: 'earthTV 24/7 live stream of the White House',
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
  {
    id: 'yt-unionstation',
    name: 'Union Station Railcam 24/7',
    lat: 38.8973,
    lng: -77.0063,
    type: 'youtube',
    youtubeId: '0Q1pN-KpNZc',
    pageUrl: 'https://www.youtube.com/watch?v=0Q1pN-KpNZc',
    description: 'Capitol Rail Watch 24/7 railcam - Amtrak, Acela, MARC, WMATA at Union Station',
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
    pageUrl: 'https://www.fox5dc.com/fox-5-skycam-loudoun-station-va',
    description: 'Ashburn/Dulles corridor (sponsored by Bryce Resort)',
  },
  {
    id: 'fox5-pwmarina',
    name: 'Prince William Marina - Woodbridge',
    lat: 38.634,
    lng: -77.261,
    type: 'fox5',
    pageUrl: 'https://www.fox5dc.com/fox-5-skycam-prince-william-marina',
    description: 'Occoquan River marina, southern DMV coverage',
  },

  // ==========================================
  // EARTHCAM LANDMARK CAMERAS (High Quality)
  // ==========================================
  {
    id: 'ec-monument',
    name: 'Washington Monument View (EarthCam)',
    lat: 38.8895,
    lng: -77.0353,
    type: 'youtube',
    // EarthCam runs this as a persistent YouTube live — plays in-modal,
    // strictly better than the page link-out it replaced.
    youtubeId: 'oDCAAfOSqvA',
    pageUrl: 'https://www.youtube.com/watch?v=oDCAAfOSqvA',
    description: 'EarthCam live HD view of the Washington Monument',
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
  // SMITHSONIAN NATIONAL ZOO (Wowza HLS, CORS * — plays in-modal)
  // ==========================================
  {
    id: 'zoo-panda',
    name: 'National Zoo - Panda Cam',
    lat: 38.9286,
    lng: -77.0524,
    type: 'zoo',
    hlsUrl: 'https://nzp-wowza01.si.edu/live_edge_panda25/smil:panda125_01.smil/playlist.m3u8',
    pageUrl: 'https://nationalzoo.si.edu/webcams/panda-cam',
    description: 'Smithsonian National Zoo giant panda habitat',
  },
  {
    id: 'zoo-elephant',
    name: 'National Zoo - Elephant Cam',
    lat: 38.9301,
    lng: -77.0509,
    type: 'zoo',
    hlsUrl: 'https://nzp-wowza01.si.edu/live_edge_elephant_zixi/elephant_zixi.smil/playlist.m3u8',
    pageUrl: 'https://nationalzoo.si.edu/webcams/elephant-cam',
    description: 'Smithsonian National Zoo Elephant Trails',
  },
  {
    id: 'zoo-lion',
    name: 'National Zoo - Lion Cam',
    lat: 38.9294,
    lng: -77.0489,
    type: 'zoo',
    hlsUrl: 'https://nzp-wowza01.si.edu/live_edge_lion/smil:lion01_all.smil/playlist.m3u8',
    pageUrl: 'https://nationalzoo.si.edu/webcams/lion-cam',
    description: 'Smithsonian National Zoo lion habitat',
  },
  {
    id: 'zoo-molerat',
    name: 'National Zoo - Naked Mole-Rat Cam',
    lat: 38.929,
    lng: -77.05,
    type: 'zoo',
    hlsUrl: 'https://nzp-wowza01.si.edu/live_edge_nmr_02/nmr_02_1080_all.smil/playlist.m3u8',
    pageUrl: 'https://nationalzoo.si.edu/webcams/naked-mole-rat-cam',
    description: 'Smithsonian National Zoo naked mole-rat colony',
  },
  {
    id: 'zoo-ferret',
    name: 'National Zoo - Ferret Cam',
    lat: 38.9298,
    lng: -77.0517,
    type: 'zoo',
    hlsUrl: 'https://nzp-wowza01.si.edu/live_edge_bff_01/bff_01_1080_all.smil/playlist.m3u8',
    pageUrl: 'https://nationalzoo.si.edu/webcams/black-footed-ferret-cam',
    description: 'Smithsonian National Zoo black-footed ferret den',
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
        imageUrl: webcam.imageUrl,
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
    }, zoo: ${
      LANDMARK_WEBCAMS.filter(w => w.type === 'zoo').length
    })`);

    return cameras;
  }

  /**
   * Get the best stream URL for a webcam:
   * YouTube watch URL (embeds in-modal) > direct HLS playlist (plays
   * in-modal via hls.js) > page link-out.
   */
  private getStreamUrl(webcam: LandmarkWebcam): string {
    if (webcam.type === 'youtube' && webcam.youtubeId) {
      return `https://www.youtube.com/watch?v=${webcam.youtubeId}`;
    }
    if (webcam.hlsUrl) {
      return webcam.hlsUrl;
    }
    return webcam.pageUrl;
  }
}

export const landmarkWebcamsFetcher = new LandmarkWebcamsFetcher();
export default landmarkWebcamsFetcher;
