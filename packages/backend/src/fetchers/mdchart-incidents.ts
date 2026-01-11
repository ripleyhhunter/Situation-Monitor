import { BaseFetcher } from './base.js';
import type { Incident } from '../types/index.js';
import config from '../config.js';
import logger from '../logger.js';

interface MDChartEvent {
  id: string;
  description: string;
  type: string;
  lat: number;
  lon: number;
  roadway?: string;
  direction?: string;
  startTime?: string;
  updateTime?: string;
  severity?: string;
}

interface MDChartEventResponse {
  events?: MDChartEvent[];
}

interface MDChartClosure {
  id: string;
  description: string;
  lat: number;
  lon: number;
  roadway?: string;
  direction?: string;
  startTime?: string;
  endTime?: string;
}

interface MDChartClosureResponse {
  closures?: MDChartClosure[];
}

export class MDChartIncidentsFetcher extends BaseFetcher<Incident> {
  constructor() {
    super('mdchart-incidents', config.cacheTtl.trafficIncidents);
  }

  protected async fetchFromApi(): Promise<Incident[]> {
    const incidents: Incident[] = [];

    // Fetch both events and closures in parallel
    const [events, closures] = await Promise.all([
      this.fetchEvents(),
      this.fetchClosures(),
    ]);

    incidents.push(...events, ...closures);

    // Filter to DC metro area
    const dcLat = config.defaultLat;
    const dcLng = config.defaultLng;
    const maxDistance = 80; // km

    return incidents.filter((incident) => {
      const distance = this.haversineDistance(
        dcLat,
        dcLng,
        incident.location.lat,
        incident.location.lng
      );
      return distance <= maxDistance;
    });
  }

  private async fetchEvents(): Promise<Incident[]> {
    try {
      const url =
        'https://chartexp1.sha.maryland.gov/CHARTExportClientService/getEventMapDataJSON.do';
      const response = await this.httpGet<MDChartEventResponse>(url);

      if (!response.events || !Array.isArray(response.events)) {
        return [];
      }

      return response.events.map((event) => this.normalizeEvent(event));
    } catch (error) {
      logger.error('Failed to fetch MD CHART events', { error });
      return [];
    }
  }

  private async fetchClosures(): Promise<Incident[]> {
    try {
      const url =
        'https://chartexp1.sha.maryland.gov/CHARTExportClientService/getActiveClosureMapDataJSON.do';
      const response = await this.httpGet<MDChartClosureResponse>(url);

      if (!response.closures || !Array.isArray(response.closures)) {
        return [];
      }

      return response.closures.map((closure) => this.normalizeClosure(closure));
    } catch (error) {
      logger.error('Failed to fetch MD CHART closures', { error });
      return [];
    }
  }

  private normalizeEvent(event: MDChartEvent): Incident {
    const now = new Date().toISOString();

    return {
      id: `mdchart-event-${event.id}`,
      type: this.mapEventType(event.type),
      severity: this.mapSeverity(event.severity),
      location: {
        lat: event.lat,
        lng: event.lon,
        address: this.buildAddress(event.roadway, event.direction),
      },
      timestamp: event.startTime || now,
      updatedAt: event.updateTime || now,
      source: 'mdchart',
      title: this.buildTitle(event),
      description: event.description,
      status: 'active',
      category: event.type,
      metadata: {
        roadway: event.roadway,
        direction: event.direction,
        originalType: event.type,
      },
    };
  }

  private normalizeClosure(closure: MDChartClosure): Incident {
    const now = new Date().toISOString();

    return {
      id: `mdchart-closure-${closure.id}`,
      type: 'traffic',
      severity: 4, // Closures are typically high severity
      location: {
        lat: closure.lat,
        lng: closure.lon,
        address: this.buildAddress(closure.roadway, closure.direction),
      },
      timestamp: closure.startTime || now,
      updatedAt: now,
      source: 'mdchart',
      title: `Road Closure: ${closure.roadway || 'Unknown Road'}`,
      description: closure.description,
      status: 'active',
      category: 'closure',
      metadata: {
        roadway: closure.roadway,
        direction: closure.direction,
        endTime: closure.endTime,
      },
    };
  }

  private mapEventType(type?: string): 'traffic' | 'hazard' {
    if (!type) return 'traffic';

    const hazardTypes = ['debris', 'hazard', 'weather', 'flooding'];
    const lowerType = type.toLowerCase();

    for (const hazard of hazardTypes) {
      if (lowerType.includes(hazard)) return 'hazard';
    }

    return 'traffic';
  }

  private mapSeverity(severity?: string): 1 | 2 | 3 | 4 | 5 {
    if (!severity) return 2;

    const severityMap: Record<string, 1 | 2 | 3 | 4 | 5> = {
      minor: 1,
      moderate: 2,
      significant: 3,
      major: 4,
      severe: 5,
    };

    return severityMap[severity.toLowerCase()] || 2;
  }

  private buildTitle(event: MDChartEvent): string {
    const parts: string[] = [];

    if (event.type) {
      parts.push(event.type);
    }

    if (event.roadway) {
      parts.push(`on ${event.roadway}`);
    }

    if (event.direction) {
      parts.push(event.direction);
    }

    return parts.length > 0 ? parts.join(' ') : 'Traffic Incident';
  }

  private buildAddress(roadway?: string, direction?: string): string | undefined {
    if (!roadway) return undefined;
    return direction ? `${roadway} ${direction}` : roadway;
  }

  private haversineDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
  ): number {
    const R = 6371;
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

export const mdchartIncidentsFetcher = new MDChartIncidentsFetcher();
export default mdchartIncidentsFetcher;
