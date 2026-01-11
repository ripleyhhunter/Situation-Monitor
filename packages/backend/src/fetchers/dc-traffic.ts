import { BaseFetcher } from './base.js';
import type { Incident } from '../types/index.js';
import config from '../config.js';
import logger from '../logger.js';

interface DCTrafficFeature {
  attributes: {
    OBJECTID: number;
    street: string;
    subtype: string;
    description: string;
    direction: string;
    starttime: number;
    endtime: number;
    altroute: string;
    closuretype: string;
    status: string;
    type?: string;
    identifier: string;
    activeincid: string;
  };
  geometry?: {
    x: number;
    y: number;
    paths?: number[][][];
  };
}

interface DCTrafficResponse {
  features: DCTrafficFeature[];
}

export class DCTrafficFetcher extends BaseFetcher<Incident> {
  constructor() {
    super('dc-traffic', config.cacheTtl.trafficIncidents);
  }

  protected async fetchFromApi(): Promise<Incident[]> {
    const incidents: Incident[] = [];

    // Fetch from both Road Closures (layer 1) and Road Blocks (layer 0)
    const layers = [
      { id: 0, name: 'Road Blocks' },
      { id: 1, name: 'Road Closures' },
    ];

    for (const layer of layers) {
      try {
        const layerIncidents = await this.fetchLayer(layer.id, layer.name);
        incidents.push(...layerIncidents);
      } catch (error) {
        logger.warn(`Failed to fetch DC traffic layer ${layer.name}`, { error });
      }
    }

    return incidents;
  }

  private async fetchLayer(layerId: number, layerName: string): Promise<Incident[]> {
    const baseUrl = `https://maps2.dcgis.dc.gov/dcgis/rest/services/DDOT/HSEMA_RoadClosures/MapServer/${layerId}/query`;

    const params = new URLSearchParams({
      f: 'json',
      where: '1=1',
      outFields: '*',
      returnGeometry: 'true',
      outSR: '4326', // WGS84 for lat/lng coordinates
    });

    const url = `${baseUrl}?${params.toString()}`;

    try {
      const response = await this.httpGet<DCTrafficResponse>(url);

      if (!response.features || !Array.isArray(response.features)) {
        logger.warn(`DC Traffic ${layerName} response has unexpected format`);
        return [];
      }

      return response.features
        .filter((f) => this.hasValidLocation(f))
        .map((f) => this.normalizeIncident(f, layerName));
    } catch (error) {
      logger.error(`Failed to fetch DC Traffic ${layerName}`, { error });
      throw error;
    }
  }

  private hasValidLocation(feature: DCTrafficFeature): boolean {
    if (!feature.geometry) return false;

    // Point geometry
    if (feature.geometry.x && feature.geometry.y) {
      return true;
    }

    // Line geometry (paths) - use first point
    if (feature.geometry.paths && feature.geometry.paths[0] && feature.geometry.paths[0][0]) {
      return true;
    }

    return false;
  }

  private getCoordinates(feature: DCTrafficFeature): { lat: number; lng: number } {
    const geom = feature.geometry!;

    // Point geometry
    if (geom.x && geom.y) {
      return { lat: geom.y, lng: geom.x };
    }

    // Line geometry - use midpoint of first path
    if (geom.paths && geom.paths[0]) {
      const path = geom.paths[0];
      const midIndex = Math.floor(path.length / 2);
      const [lng, lat] = path[midIndex];
      return { lat, lng };
    }

    // Fallback to DC center (shouldn't happen due to filter)
    return { lat: config.defaultLat, lng: config.defaultLng };
  }

  private normalizeIncident(feature: DCTrafficFeature, layerName: string): Incident {
    const attrs = feature.attributes;
    const coords = this.getCoordinates(feature);
    const now = new Date().toISOString();

    // Parse dates
    const startTime = attrs.starttime ? new Date(attrs.starttime).toISOString() : now;
    const endTime = attrs.endtime ? new Date(attrs.endtime).toISOString() : undefined;

    // Build title
    const title = this.buildTitle(attrs, layerName);

    return {
      id: `dc-traffic-${attrs.OBJECTID}`,
      type: 'traffic',
      severity: this.mapSeverity(attrs.closuretype, attrs.subtype),
      location: {
        lat: coords.lat,
        lng: coords.lng,
        address: attrs.street || undefined,
      },
      timestamp: startTime,
      updatedAt: now,
      source: 'dc-traffic',
      title,
      description: this.buildDescription(attrs, endTime),
      status: this.mapStatus(attrs.status, endTime),
      category: attrs.closuretype || attrs.subtype || 'road closure',
      metadata: {
        objectId: attrs.OBJECTID,
        direction: attrs.direction,
        altRoute: attrs.altroute,
        closureType: attrs.closuretype,
        subtype: attrs.subtype,
        endTime,
        layerName,
      },
    };
  }

  private buildTitle(attrs: DCTrafficFeature['attributes'], layerName: string): string {
    const parts: string[] = [];

    // Add closure type or layer name
    if (attrs.closuretype) {
      parts.push(this.formatText(attrs.closuretype));
    } else if (attrs.subtype) {
      parts.push(this.formatText(attrs.subtype));
    } else {
      parts.push(layerName);
    }

    // Add street
    if (attrs.street) {
      parts.push(`on ${attrs.street}`);
    }

    // Add direction
    if (attrs.direction) {
      parts.push(`(${attrs.direction})`);
    }

    return parts.join(' ');
  }

  private buildDescription(
    attrs: DCTrafficFeature['attributes'],
    endTime?: string
  ): string {
    const parts: string[] = [];

    if (attrs.description) {
      parts.push(attrs.description);
    }

    if (attrs.street) {
      parts.push(`Street: ${attrs.street}`);
    }

    if (attrs.direction) {
      parts.push(`Direction: ${attrs.direction}`);
    }

    if (attrs.altroute) {
      parts.push(`Alternate Route: ${attrs.altroute}`);
    }

    if (endTime) {
      const endDate = new Date(endTime);
      parts.push(`Expected End: ${endDate.toLocaleString()}`);
    }

    return parts.join('\n');
  }

  private mapSeverity(closureType?: string, subtype?: string): 1 | 2 | 3 | 4 | 5 {
    const type = (closureType || subtype || '').toLowerCase();

    // High severity - full closures, emergencies
    if (
      type.includes('emergency') ||
      type.includes('police') ||
      type.includes('fire') ||
      type.includes('full closure')
    ) {
      return 4;
    }

    // Medium-high severity - major events, construction
    if (
      type.includes('major') ||
      type.includes('event') ||
      type.includes('construction')
    ) {
      return 3;
    }

    // Medium severity - lane closures
    if (type.includes('lane') || type.includes('partial')) {
      return 2;
    }

    // Default
    return 2;
  }

  private mapStatus(
    status?: string,
    endTime?: string
  ): 'active' | 'cleared' | 'unknown' {
    // Check if closure has ended
    if (endTime && new Date(endTime) < new Date()) {
      return 'cleared';
    }

    if (!status) return 'active';

    const statusLower = status.toLowerCase();
    if (statusLower.includes('active') || statusLower.includes('open')) {
      return 'active';
    }
    if (statusLower.includes('clear') || statusLower.includes('closed') || statusLower.includes('complete')) {
      return 'cleared';
    }

    return 'active';
  }

  private formatText(text: string): string {
    if (!text) return '';
    return text
      .toLowerCase()
      .split(/[\s_]+/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }
}

export const dcTrafficFetcher = new DCTrafficFetcher();
export default dcTrafficFetcher;
