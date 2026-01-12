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

      // Debug: log first feature's attributes to understand available fields
      if (response.features.length > 0) {
        const sampleAttrs = response.features[0].attributes;
        logger.debug(`DC Traffic ${layerName} sample fields:`, { 
          keys: Object.keys(sampleAttrs),
          starttime: sampleAttrs.starttime,
          endtime: sampleAttrs.endtime,
          starttimeType: typeof sampleAttrs.starttime,
          endtimeType: typeof sampleAttrs.endtime
        });
      }

      return response.features
        .filter((f) => this.hasValidLocation(f))
        .map((f) => this.normalizeIncident(f, layerName))
        .filter((incident): incident is Incident => incident !== null);
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

  private normalizeIncident(feature: DCTrafficFeature, layerName: string): Incident | null {
    const attrs = feature.attributes;
    const coords = this.getCoordinates(feature);
    const now = new Date().toISOString();

    // Debug log raw time values
    logger.debug(`DC Traffic time fields for ${attrs.OBJECTID}:`, {
      starttime: attrs.starttime,
      endtime: attrs.endtime,
      starttimeType: typeof attrs.starttime,
      endtimeType: typeof attrs.endtime,
    });

    // Parse dates with defensive, case-insensitive lookup of ArcGIS time fields
    const { iso: startTime, raw: rawStartTime } = this.parseTimestamp(attrs, [
      'starttime',
      'start_time',
      'startTime',
      'STARTTIME',
      'START_TIME',
      'startdate',
      'start_date',
      'startDate',
      'STARTDATE',
      'START_DATE',
    ]);

    const { iso: endTime, raw: rawEndTime } = this.parseTimestamp(attrs, [
      'endtime',
      'end_time',
      'endTime',
      'ENDTIME',
      'END_TIME',
      'enddate',
      'end_date',
      'endDate',
      'ENDDATE',
      'END_DATE',
    ]);

    const { iso: createdTime, raw: rawCreatedTime } = this.parseTimestamp(attrs, [
      'creationdate',
      'creation_date',
      'create_date',
      'createDate',
      'createdate',
      'CREATIONDATE',
      'CreateDate',
      'created_date',
      'CREATED_DATE',
      'CREATEDATE',
      'CreationDate',
    ]);

    const { iso: editedTime, raw: rawEditedTime } = this.parseTimestamp(attrs, [
      'editdate',
      'EditDate',
      'edit_date',
      'EDITDATE',
      'last_edited_date',
      'lastediteddate',
      'LASTEDITEDDATE',
    ]);

    const timestamp = startTime ?? endTime ?? createdTime ?? editedTime;
    const timeSource = startTime
      ? 'start'
      : endTime
      ? 'end'
      : createdTime
      ? 'created'
      : editedTime
      ? 'edited'
      : null;

    // Skip records with no valid timestamp - they're stale/legacy data
    if (!timestamp || !timeSource) {
      logger.debug(`DC Traffic ${attrs.OBJECTID} skipped - no valid time fields found`, {
        street: attrs.street,
        subtype: attrs.subtype,
      });
      return null;
    }

    logger.debug(`DC Traffic ${attrs.OBJECTID} using ${timeSource} timestamp:`, { timestamp, timeSource });

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
      timestamp,
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
        startTime,
        rawStartTime,
        rawEndTime,
        rawCreatedTime,
        rawEditedTime,
        timeSource,
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

  /**
   * Parse an ArcGIS date field (epoch milliseconds, sometimes strings) with multiple possible key casings.
   * Validates that timestamps are reasonable (not 0, not in far past/future).
   * @param maxAgeYears - How many years back to accept (default 10 for start times, road closures can be long-term)
   */
  private parseTimestamp(
    attrs: DCTrafficFeature['attributes'],
    candidates: string[],
    maxAgeYears: number = 10
  ): { iso: string | null; raw: number | string | undefined } {
    const now = Date.now();
    const minTime = now - (maxAgeYears * 365 * 24 * 60 * 60 * 1000);
    const maxTime = now + (5 * 365 * 24 * 60 * 60 * 1000); // 5 years ahead for end times

    for (const key of candidates) {
      const value = (attrs as Record<string, unknown>)[key];
      
      // Try numeric (epoch milliseconds)
      if (typeof value === 'number' && value > 0) {
        // Validate timestamp is reasonable
        if (value >= minTime && value <= maxTime) {
          const date = new Date(value);
          if (!isNaN(date.getTime())) {
            return { iso: date.toISOString(), raw: value };
          }
        }
        // If value seems like seconds instead of milliseconds, try converting
        if (value > 1000000000 && value < 10000000000) {
          const msValue = value * 1000;
          if (msValue >= minTime && msValue <= maxTime) {
            const date = new Date(msValue);
            if (!isNaN(date.getTime())) {
              return { iso: date.toISOString(), raw: value };
            }
          }
        }
      }
      
      // Try string
      if (typeof value === 'string' && value.trim().length > 0) {
        const trimmed = value.trim();
        
        // Try parsing as number string (epoch)
        const asNumber = Number(trimmed);
        if (!Number.isNaN(asNumber) && asNumber > 0) {
          if (asNumber >= minTime && asNumber <= maxTime) {
            return { iso: new Date(asNumber).toISOString(), raw: value };
          }
          // Try as seconds
          if (asNumber > 1000000000 && asNumber < 10000000000) {
            const msValue = asNumber * 1000;
            if (msValue >= minTime && msValue <= maxTime) {
              return { iso: new Date(msValue).toISOString(), raw: value };
            }
          }
        }
        
        // Try parsing as ISO date string
        const parsed = Date.parse(trimmed);
        if (!Number.isNaN(parsed) && parsed > 0 && parsed >= minTime && parsed <= maxTime) {
          return { iso: new Date(parsed).toISOString(), raw: value };
        }
      }
    }
    return { iso: null, raw: undefined };
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
