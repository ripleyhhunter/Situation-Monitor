import { BaseFetcher } from './base.js';
import type { Incident } from '../types/index.js';
import config from '../config.js';

// Both CHART endpoints return { data: [...] } with a shared record shape.
// Road/location info is embedded in the description ("Event @ ROAD ..."),
// timestamps are epoch milliseconds.
interface MDChartRecord {
  id: string;
  name?: string;
  description?: string;
  incidentType?: string;
  county?: string;
  direction?: string;
  lat?: number;
  lon?: number;
  closed?: boolean;
  trafficAlert?: boolean;
  lanesClosed?: string;
  startDateTime?: number;
  createTime?: number;
  lastCachedDataUpdateTime?: number;
}

interface MDChartResponse {
  data?: MDChartRecord[];
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
    const url =
      'https://chartexp1.sha.maryland.gov/CHARTExportClientService/getEventMapDataJSON.do';
    const response = await this.httpGet<MDChartResponse>(url);

    if (!response.data || !Array.isArray(response.data)) {
      // A missing envelope means the API contract changed — surface the
      // failure so BaseFetcher records an error and serves stale data,
      // instead of caching an empty "success".
      throw new Error('MD CHART events: unexpected response shape (no data array)');
    }

    return response.data
      .filter((r) => !r.closed && typeof r.lat === 'number' && typeof r.lon === 'number')
      .map((r) => this.normalizeRecord(r, 'event'));
  }

  private async fetchClosures(): Promise<Incident[]> {
    const url =
      'https://chartexp1.sha.maryland.gov/CHARTExportClientService/getActiveClosureMapDataJSON.do';
    const response = await this.httpGet<MDChartResponse>(url);

    if (!response.data || !Array.isArray(response.data)) {
      throw new Error('MD CHART closures: unexpected response shape (no data array)');
    }

    return response.data
      .filter((r) => !r.closed && typeof r.lat === 'number' && typeof r.lon === 'number')
      .map((r) => this.normalizeRecord(r, 'closure'));
  }

  private normalizeRecord(record: MDChartRecord, kind: 'event' | 'closure'): Incident {
    const fallbackTitle = kind === 'closure' ? 'Road Closure' : 'Traffic Incident';
    const title = record.name || record.description || fallbackTitle;
    // Descriptions look like "Disabled Vehicle Event @ I-70 WEST AT MM 40.0"
    const road = record.description?.split('@')[1]?.trim();
    const now = new Date().toISOString();

    return {
      id: `mdchart-${kind}-${record.id}`,
      type: kind === 'closure' ? 'traffic' : this.mapEventType(record),
      severity: kind === 'closure' ? 4 : record.trafficAlert ? 3 : 2,
      location: {
        lat: record.lat as number,
        lng: record.lon as number,
        address: road || record.county,
      },
      timestamp: this.toIso(record.startDateTime) || this.toIso(record.createTime) || now,
      // Derive from feed fields so unchanged records don't re-broadcast on
      // every poll (the aggregator diffs on updatedAt).
      updatedAt:
        this.toIso(record.lastCachedDataUpdateTime) || this.toIso(record.startDateTime) || now,
      regionId: 'dc',
      source: 'mdchart',
      title,
      description: record.description || title,
      status: 'active',
      category: kind === 'closure' ? 'closure' : record.incidentType || 'incident',
      metadata: {
        county: record.county,
        direction: record.direction,
        lanesClosed: record.lanesClosed,
        originalType: record.incidentType,
      },
    };
  }

  private toIso(epochMs?: number): string | undefined {
    if (!epochMs || epochMs <= 0) return undefined;
    return new Date(epochMs).toISOString();
  }

  private mapEventType(record: MDChartRecord): 'traffic' | 'hazard' {
    const text = `${record.incidentType || ''} ${record.description || ''}`.toLowerCase();
    const hazardTypes = ['debris', 'hazard', 'weather', 'flooding'];
    return hazardTypes.some((h) => text.includes(h)) ? 'hazard' : 'traffic';
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
