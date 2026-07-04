import { BaseFetcher } from './base.js';
import type { Incident } from '../types/index.js';
import config from '../config.js';
import logger from '../logger.js';

/**
 * Idaho Transportation Department WZDx (Work Zone Data Exchange) feed.
 *
 * Source: https://511.idaho.gov/api/wzdx
 *   - No API key required.
 *   - GeoJSON FeatureCollection per WZDx v4.x spec.
 *   - Includes lane closures, restrictions, construction events statewide.
 *
 * We filter to the configured region's bounding box so callers in non-Idaho
 * regions don't suddenly see Idaho-wide work zones.
 */

interface WzdxGeometry {
  type: 'LineString' | 'MultiPoint' | 'Point';
  coordinates: number[] | number[][] | number[][][];
}

interface WzdxFeature {
  id: string;
  type: 'Feature';
  properties: {
    core_details?: {
      event_type?: string;
      road_names?: string[];
      direction?: string;
      description?: string;
      name?: string;
      update_date?: string;
    };
    start_date?: string;
    end_date?: string;
    is_start_date_verified?: boolean;
    location_method?: string;
    vehicle_impact?: string;
    workers_present?: boolean;
    reduced_speed_limit_kph?: number;
    types_of_work?: Array<{ type_name?: string; is_architectural_change?: boolean }>;
    lanes?: Array<{ status?: string; type?: string; order?: number }>;
  };
  geometry: WzdxGeometry;
}

interface WzdxResponse {
  feed_info?: { update_date?: string; publisher?: string; version?: string };
  type?: 'FeatureCollection';
  features?: WzdxFeature[];
}

export interface ItdWzdxFetcherOptions {
  /** Bounding box to filter events to (region of interest). */
  bounds: { lamin: number; lamax: number; lomin: number; lomax: number };
}

export class ItdWzdxFetcher extends BaseFetcher<Incident> {
  readonly incidentSource = 'itd-wzdx' as const;

  private static readonly URL = 'https://511.idaho.gov/api/wzdx';

  private bounds: ItdWzdxFetcherOptions['bounds'];

  constructor(options: ItdWzdxFetcherOptions) {
    super('itd-wzdx', config.cacheTtl.trafficIncidents);
    this.bounds = options.bounds;
  }

  protected async fetchFromApi(): Promise<Incident[]> {
    try {
      const response = await this.httpGet<WzdxResponse>(ItdWzdxFetcher.URL);

      if (!response.features || !Array.isArray(response.features)) {
        // 'itd-wzdx' is a complete-listing source (and exempt from the age
        // sweep), so a false-empty "success" would wipe every work zone and
        // is its only clear path. Treat contract drift as a failure.
        throw new Error('ITD WZDx: unexpected response shape (no features array)');
      }

      const incidents: Incident[] = [];
      for (const feature of response.features) {
        const incident = this.normalize(feature);
        if (incident && this.isInBounds(incident.location.lat, incident.location.lng)) {
          incidents.push(incident);
        }
      }

      logger.debug(`ITD WZDx: ${incidents.length} work zones in region (of ${response.features.length} statewide)`);
      return incidents;
    } catch (error) {
      logger.error('Failed to fetch ITD WZDx data', { error });
      throw error;
    }
  }

  private isInBounds(lat: number, lng: number): boolean {
    return lat >= this.bounds.lamin && lat <= this.bounds.lamax &&
           lng >= this.bounds.lomin && lng <= this.bounds.lomax;
  }

  private normalize(feature: WzdxFeature): Incident | null {
    const props = feature.properties || {};
    const core = props.core_details || {};
    const point = this.firstPoint(feature.geometry);
    if (!point) return null;

    const now = new Date().toISOString();
    const updated = core.update_date || props.start_date || now;
    const start = props.start_date || now;

    const roadNames = core.road_names?.join(', ') || '';
    const direction = core.direction ? ` ${core.direction.toUpperCase()}` : '';
    const title = roadNames ? `Work Zone: ${roadNames}${direction}` : (core.name || 'Work Zone');

    return {
      id: `itd-wzdx-${feature.id}`,
      type: 'traffic',
      severity: this.deriveSeverity(props.vehicle_impact),
      location: {
        lat: point[1],
        lng: point[0],
        address: roadNames || undefined,
      },
      timestamp: this.safeIso(start),
      updatedAt: this.safeIso(updated),
      regionId: 'boise',
      source: 'itd-wzdx',
      title,
      description: this.buildDescription(props),
      status: 'active',
      category: core.event_type || 'work-zone',
      metadata: {
        // Ongoing situation: exempt from the frontend's event-time filter.
        ongoing: true,
        eventType: core.event_type,
        direction: core.direction,
        vehicleImpact: props.vehicle_impact,
        workersPresent: props.workers_present,
        reducedSpeedKph: props.reduced_speed_limit_kph,
        endDate: props.end_date,
        typesOfWork: props.types_of_work?.map(w => w.type_name).filter(Boolean),
      },
    };
  }

  private firstPoint(geometry: WzdxGeometry): [number, number] | null {
    if (!geometry || !geometry.coordinates) return null;
    const coords = geometry.coordinates;
    if (geometry.type === 'Point') {
      const c = coords as number[];
      return [c[0], c[1]];
    }
    if (geometry.type === 'LineString' || geometry.type === 'MultiPoint') {
      const c = coords as number[][];
      if (c.length === 0) return null;
      return [c[0][0], c[0][1]];
    }
    return null;
  }

  private deriveSeverity(impact?: string): 1 | 2 | 3 | 4 | 5 {
    const i = (impact || '').toLowerCase();
    if (i.includes('all-lanes-closed') || i.includes('road-closed')) return 4;
    if (i.includes('some-lanes-closed')) return 3;
    if (i.includes('shift-')) return 2;
    return 1;
  }

  private buildDescription(props: WzdxFeature['properties']): string {
    const core = props.core_details || {};
    const parts: string[] = [];
    if (core.description) parts.push(core.description);
    if (core.road_names?.length) parts.push(`Roads: ${core.road_names.join(', ')}`);
    if (core.direction) parts.push(`Direction: ${core.direction}`);
    if (props.vehicle_impact) parts.push(`Impact: ${props.vehicle_impact}`);
    if (props.workers_present) parts.push('Workers present');
    if (props.reduced_speed_limit_kph) parts.push(`Reduced speed: ${props.reduced_speed_limit_kph} kph`);
    if (props.end_date) parts.push(`Ends: ${props.end_date}`);
    return parts.join('\n');
  }

  private safeIso(s: string): string {
    try {
      return new Date(s).toISOString();
    } catch {
      return new Date().toISOString();
    }
  }
}
