import { BaseFetcher } from './base.js';
import type { Incident, RegionId } from '../types/index.js';
import logger from '../logger.js';

/**
 * WFIGS (Wildland Fire Interagency Geospatial Services) current wildfire
 * incident locations, from NIFC's public ArcGIS org.
 *
 *   - No API key required; CORS-open; GeoJSON output.
 *   - The "Current" layer's semantics are exactly presence-implies-active:
 *     records are removed when a fire is declared contained/controlled/out
 *     (or goes stale per NIFC's fall-off rules), so this is registered as a
 *     complete-listing source and absence from a successful poll clears it.
 *   - Server-side envelope filter keeps the query regional. The envelope is
 *     deliberately wider than the map viewport — a 5,000-acre fire 100 km
 *     out matters to situational awareness (smoke, evacuation traffic).
 */

const WFIGS_URL =
  'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Incident_Locations_Current/FeatureServer/0/query';

const OUT_FIELDS = [
  'UniqueFireIdentifier',
  'IncidentName',
  'IncidentTypeCategory',
  'FireDiscoveryDateTime',
  'ModifiedOnDateTime_dt',
  'IncidentSize',
  'DiscoveryAcres',
  'PercentContained',
  'FireBehaviorGeneral',
  'IncidentShortDescription',
  'POOCounty',
  'POOState',
  'TotalIncidentPersonnel',
].join(',');

interface WfigsProperties {
  UniqueFireIdentifier?: string | null;
  IncidentName?: string | null;
  /** 'WF' wildfire, 'RX' prescribed burn, 'CX' complex. */
  IncidentTypeCategory?: string | null;
  FireDiscoveryDateTime?: number | null;
  ModifiedOnDateTime_dt?: number | null;
  IncidentSize?: number | null;
  DiscoveryAcres?: number | null;
  PercentContained?: number | null;
  FireBehaviorGeneral?: string | null;
  IncidentShortDescription?: string | null;
  POOCounty?: string | null;
  POOState?: string | null;
  TotalIncidentPersonnel?: number | null;
}

export interface WfigsFeature {
  type: 'Feature';
  id?: string | number;
  properties: WfigsProperties;
  geometry: { type: 'Point'; coordinates: number[] } | null;
}

interface WfigsResponse {
  type?: 'FeatureCollection';
  features?: WfigsFeature[];
}

export interface WildfireFetcherOptions {
  regionId: RegionId;
  /** Envelope for the server-side spatial filter (wider than the map view). */
  bounds: { lamin: number; lamax: number; lomin: number; lomax: number };
}

/** Severity from fire size; prescribed burns are capped at 2. */
export function wildfireSeverity(acres: number, category: string): 1 | 2 | 3 | 4 | 5 {
  if (category === 'RX') return acres >= 100 ? 2 : 1;
  if (acres >= 1000) return 5;
  if (acres >= 100) return 4;
  if (acres >= 10) return 3;
  return 2;
}

/**
 * Normalize one WFIGS GeoJSON feature to an Incident. Exported for tests.
 * Returns null for features without a usable point.
 */
export function normalizeWfigsFeature(feature: WfigsFeature, regionId: RegionId): Incident | null {
  const props = feature.properties ?? {};
  const coords = feature.geometry?.coordinates;
  if (!coords || coords.length < 2 || typeof coords[0] !== 'number' || typeof coords[1] !== 'number') {
    return null;
  }

  const category = (props.IncidentTypeCategory ?? 'WF').toUpperCase();
  const acres = props.IncidentSize ?? props.DiscoveryAcres ?? 0;
  const name = props.IncidentName?.trim() || 'Unnamed fire';
  const discovered = props.FireDiscoveryDateTime;
  const modified = props.ModifiedOnDateTime_dt;

  // updatedAt must come from the feed (ModifiedOnDateTime_dt), never
  // wall-clock now — the aggregator diffs on it to decide re-broadcast.
  if (typeof modified !== 'number' || typeof discovered !== 'number') return null;

  const isRx = category === 'RX';
  const title = isRx ? `Prescribed Fire: ${name}` : `Wildfire: ${name}`;

  const parts: string[] = [];
  if (acres > 0) parts.push(`${Math.round(acres).toLocaleString()} acres`);
  if (typeof props.PercentContained === 'number') parts.push(`${props.PercentContained}% contained`);
  if (props.FireBehaviorGeneral) parts.push(`Behavior: ${props.FireBehaviorGeneral}`);
  if (typeof props.TotalIncidentPersonnel === 'number' && props.TotalIncidentPersonnel > 0) {
    parts.push(`${props.TotalIncidentPersonnel} personnel`);
  }
  if (props.POOCounty) parts.push(`${props.POOCounty} County${props.POOState ? `, ${String(props.POOState).replace('US-', '')}` : ''}`);
  if (props.IncidentShortDescription) parts.push(props.IncidentShortDescription);

  const fireId = props.UniqueFireIdentifier || `${feature.id ?? `${coords[1]},${coords[0]}`}`;

  return {
    id: `wfigs-${fireId}`,
    regionId,
    type: 'fire',
    severity: wildfireSeverity(acres, category),
    location: {
      lat: coords[1],
      lng: coords[0],
      address: props.POOCounty ? `${props.POOCounty} County` : undefined,
    },
    timestamp: new Date(discovered).toISOString(),
    updatedAt: new Date(modified).toISOString(),
    source: 'wfigs',
    title,
    description: parts.join('\n'),
    status: 'active',
    category: isRx ? 'prescribed-fire' : 'wildfire',
    metadata: {
      acres,
      percentContained: props.PercentContained,
      incidentTypeCategory: category,
      fireBehavior: props.FireBehaviorGeneral,
      personnel: props.TotalIncidentPersonnel,
      county: props.POOCounty,
      state: props.POOState,
    },
  };
}

export class WildfireFetcher extends BaseFetcher<Incident> {
  readonly incidentSource = 'wfigs' as const;

  private regionId: RegionId;
  private url: string;

  constructor(options: WildfireFetcherOptions) {
    // 10-minute cache: fires develop on hour scales; the layer itself is
    // updated as agencies report, typically well under this cadence.
    super(`wildfire-${options.regionId}`, 600);
    this.regionId = options.regionId;

    const { lomin, lamin, lomax, lamax } = options.bounds;
    const params = new URLSearchParams({
      where: '1=1',
      geometry: `${lomin},${lamin},${lomax},${lamax}`,
      geometryType: 'esriGeometryEnvelope',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: OUT_FIELDS,
      returnGeometry: 'true',
      f: 'geojson',
    });
    this.url = `${WFIGS_URL}?${params.toString()}`;
  }

  protected async fetchFromApi(): Promise<Incident[]> {
    const response = await this.httpGet<WfigsResponse>(this.url);

    if (!response.features || !Array.isArray(response.features)) {
      // 'wfigs' is a complete-listing source — a false-empty "success"
      // would clear every active fire. Contract drift must be a failure.
      throw new Error('WFIGS: unexpected response shape (no features array)');
    }

    const incidents: Incident[] = [];
    for (const feature of response.features) {
      const incident = normalizeWfigsFeature(feature, this.regionId);
      if (incident) incidents.push(incident);
    }

    logger.debug(`Wildfire (${this.regionId}): ${incidents.length} current incidents in envelope`);
    return incidents;
  }
}
