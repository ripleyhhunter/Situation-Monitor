import { BaseFetcher } from './base.js';
import type { Camera } from '../types/index.js';
import config from '../config.js';
import logger from '../logger.js';

interface MDChartCamera {
  id: string;
  name: string;
  description: string;
  lat: number;
  lon: number;
  publicVideoURL?: string;
}

interface MDChartCameraResponse {
  data?: MDChartCamera[];
  error?: string | null;
}

export class MDChartCamerasFetcher extends BaseFetcher<Camera> {
  constructor() {
    super('mdchart-cameras', config.cacheTtl.trafficCameras);
  }

  protected async fetchFromApi(): Promise<Camera[]> {
    const url = 'https://chartexp1.sha.maryland.gov/CHARTExportClientService/getCameraMapDataJSON.do';

    try {
      const response = await this.httpGet<MDChartCameraResponse>(url);

      if (!response.data || !Array.isArray(response.data)) {
        logger.warn('MD CHART cameras response has unexpected format', { response });
        return [];
      }

      // Filter cameras within DC metro area (roughly 50 miles from DC center)
      const dcLat = config.defaultLat;
      const dcLng = config.defaultLng;
      const maxDistance = 80; // km (~50 miles)

      const filtered = response.data.filter((cam) => {
        const distance = this.haversineDistance(dcLat, dcLng, cam.lat, cam.lon);
        return distance <= maxDistance;
      });

      logger.debug(`MD CHART: ${response.data.length} total cameras, ${filtered.length} within range`);

      return filtered.map((cam) => this.normalizeCamera(cam));
    } catch (error) {
      logger.error('Failed to fetch MD CHART cameras', { error });
      throw error;
    }
  }

  private normalizeCamera(cam: MDChartCamera): Camera {
    return {
      id: `mdchart-${cam.id}`,
      name: cam.description || cam.name || `Camera ${cam.id}`,
      location: {
        lat: cam.lat,
        lng: cam.lon,
      },
      regionId: 'dc',
      source: 'mdchart',
      streamUrl: cam.publicVideoURL,
      imageUrl: this.buildImageUrl(cam.id),
      lastUpdated: new Date().toISOString(),
    };
  }

  private buildImageUrl(cameraId: string): string {
    // MD CHART thumbnails use the camera GUID as the filename
    return `https://chart.maryland.gov/thumbnails/${cameraId}.jpg`;
  }

  /**
   * Calculate distance between two points using Haversine formula
   */
  private haversineDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
  ): number {
    const R = 6371; // Earth's radius in km
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) *
        Math.cos(this.toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private toRad(deg: number): number {
    return deg * (Math.PI / 180);
  }
}

export const mdchartCamerasFetcher = new MDChartCamerasFetcher();
export default mdchartCamerasFetcher;
