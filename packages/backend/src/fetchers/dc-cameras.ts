import { BaseFetcher } from './base.js';
import type { Camera } from '../types/index.js';
import config from '../config.js';
import logger from '../logger.js';

interface DCCameraFeature {
  type: 'Feature';
  properties: {
    CAMERAID: number;
    FACILITYID: string;
    CAMERATYPE: string;
    POLEID: number;
    GIS_ID: string;
    OBJECTID: number;
  };
  geometry: {
    type: 'Point';
    coordinates: [number, number]; // [lng, lat]
  };
}

interface DCCameraResponse {
  type: 'FeatureCollection';
  features: DCCameraFeature[];
}

export class DCCamerasFetcher extends BaseFetcher<Camera> {
  constructor() {
    super('dc-cameras', config.cacheTtl.trafficCameras);
  }

  protected async fetchFromApi(): Promise<Camera[]> {
    // DC Open Data traffic camera GeoJSON endpoint
    const url = 'https://hub.arcgis.com/api/download/v1/items/f57306222def419994d2eb12d31040ad/geojson?redirect=true&layers=93';

    try {
      const response = await this.httpGet<DCCameraResponse>(url, {
        timeout: 60000, // Larger file, needs more time
      });

      if (!response.features || !Array.isArray(response.features)) {
        logger.warn('DC cameras response has unexpected format');
        return [];
      }

      // Filter to CCTV cameras only (exclude enforcement cameras)
      const cctvCameras = response.features.filter(
        (f) => f.properties.CAMERATYPE === 'CCTV' && f.geometry?.coordinates
      );

      logger.debug(`DC cameras: ${response.features.length} total, ${cctvCameras.length} CCTV`);

      return cctvCameras.map((f) => this.normalizeCamera(f));
    } catch (error) {
      logger.error('Failed to fetch DC cameras', { error });
      throw error;
    }
  }

  private normalizeCamera(feature: DCCameraFeature): Camera {
    const props = feature.properties;
    const [lng, lat] = feature.geometry.coordinates;

    return {
      id: `dc-${props.CAMERAID}`,
      name: `DC Traffic Camera #${props.CAMERAID}`,
      location: {
        lat,
        lng,
      },
      source: 'dc',
      // DC doesn't provide public live feeds - link to WeatherBug as fallback
      streamUrl: 'https://www.weatherbug.com/traffic-cam/washington-dc-20001',
      // No direct image URL available for DC cameras
      imageUrl: undefined,
      lastUpdated: new Date().toISOString(),
    };
  }
}

export const dcCamerasFetcher = new DCCamerasFetcher();
export default dcCamerasFetcher;
