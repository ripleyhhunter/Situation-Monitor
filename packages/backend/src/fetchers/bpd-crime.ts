import { BaseFetcher } from './base.js';
import type { Incident } from '../types/index.js';
import config from '../config.js';
import logger from '../logger.js';

/**
 * Boise Police Department crime incidents.
 *
 * Source: City of Boise open data ArcGIS FeatureServer
 * https://services1.arcgis.com/WHM6qC35aMtyAAlN/arcgis/rest/services/BPD_Crimes_Public/FeatureServer/0
 *
 * Rolling 5-6 year history. Preliminary records held back ~9 days, so this is
 * a *historical* feed, not real-time. Useful for crime-heatmap visualization.
 * (Boise PD's near-real-time data is the BPD_CallsForService FeatureServer.)
 */

interface BPDFeature {
  attributes: {
    OBJECTID: number;
    ChargeID: number;
    DRNumber: string;
    IncidentType: string;
    CrimeCode: string;
    CrimeCodeDescription: string;
    CrimeCodeGroup: string;
    CrimeType: string;
    IncidentAddress: string;
    City: string;
    District: string;
    PatrolArea: string;
    LocationScene: string;
    ChargeGroup: string;
    ChargeDescription: string;
    Severity: string;
    ReportedDate: number;        // epoch ms
    OccurredDateTime: number;    // epoch ms
  };
  geometry?: {
    x: number;
    y: number;
  };
}

interface BPDResponse {
  features?: BPDFeature[];
  error?: { code: number; message: string };
}

export class BPDCrimeFetcher extends BaseFetcher<Incident> {
  private static readonly BASE_URL =
    'https://services1.arcgis.com/WHM6qC35aMtyAAlN/arcgis/rest/services/BPD_Crimes_Public/FeatureServer/0/query';

  constructor() {
    super('bpd-crime', config.cacheTtl.crime);
  }

  protected async fetchFromApi(): Promise<Incident[]> {
    // Pull the most recent records by occurrence date. The dataset holds back
    // the most recent ~9 days, so we'll see anything from ~9 days ago onward.
    const params = new URLSearchParams({
      f: 'json',
      where: '1=1',
      outFields: 'OBJECTID,DRNumber,IncidentType,CrimeCode,CrimeCodeDescription,CrimeCodeGroup,CrimeType,IncidentAddress,City,District,PatrolArea,LocationScene,Severity,ReportedDate,OccurredDateTime',
      orderByFields: 'OccurredDateTime DESC',
      resultRecordCount: '2000',
      returnGeometry: 'true',
      outSR: '4326',
    });

    const url = `${BPDCrimeFetcher.BASE_URL}?${params.toString()}`;

    try {
      const response = await this.httpGet<BPDResponse>(url);

      if (response.error) {
        logger.warn(`BPD Crime API error: ${response.error.message}`);
        return [];
      }

      if (!response.features || !Array.isArray(response.features)) {
        logger.warn('BPD Crime response missing features array');
        return [];
      }

      return response.features
        .filter(f => f.geometry && typeof f.geometry.x === 'number' && typeof f.geometry.y === 'number')
        .map(f => this.normalize(f));
    } catch (error) {
      logger.error('Failed to fetch BPD Crime data', { error });
      throw error;
    }
  }

  private normalize(feature: BPDFeature): Incident {
    const a = feature.attributes;
    const now = new Date().toISOString();
    const ts = a.OccurredDateTime || a.ReportedDate || Date.now();

    return {
      id: `bpd-crime-${a.DRNumber || a.OBJECTID}`,
      type: 'crime',
      severity: this.mapSeverity(a.CrimeCodeGroup, a.Severity),
      location: {
        lat: feature.geometry!.y,
        lng: feature.geometry!.x,
        address: a.IncidentAddress,
        neighborhood: a.PatrolArea || a.District,
      },
      timestamp: new Date(ts).toISOString(),
      updatedAt: now,
      regionId: 'boise',
      source: 'bpd-crime',
      title: this.titleCase(a.CrimeCodeDescription || a.IncidentType || 'Crime'),
      description: this.buildDescription(a),
      status: 'active',
      category: a.CrimeCodeGroup || a.IncidentType,
      metadata: {
        drNumber: a.DRNumber,
        crimeCode: a.CrimeCode,
        crimeType: a.CrimeType,
        severity: a.Severity,
        city: a.City,
        district: a.District,
        patrolArea: a.PatrolArea,
        location: a.LocationScene,
      },
    };
  }

  private mapSeverity(group: string, severity: string): 1 | 2 | 3 | 4 | 5 {
    const g = (group || '').toLowerCase();
    const s = (severity || '').toLowerCase();

    if (g.includes('homicide') || g.includes('murder') || g.includes('kidnap')) return 5;
    if (g.includes('robbery') || g.includes('aggravated assault') || g.includes('sex offense') || g.includes('rape')) return 4;
    if (g.includes('burglary') || g.includes('arson') || g.includes('assault') || g.includes('weapon')) return 3;
    if (s === 'felony') return 3;
    if (g.includes('theft') || g.includes('larceny') || g.includes('motor vehicle theft')) return 2;
    return 1;
  }

  private titleCase(s: string): string {
    if (!s) return 'Unknown Offense';
    return s.toLowerCase().split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }

  private buildDescription(a: BPDFeature['attributes']): string {
    const parts: string[] = [];
    if (a.CrimeCodeDescription) parts.push(`Offense: ${this.titleCase(a.CrimeCodeDescription)}`);
    if (a.IncidentAddress) parts.push(`Location: ${a.IncidentAddress}`);
    if (a.City) parts.push(`City: ${a.City}`);
    if (a.LocationScene) parts.push(`Scene: ${a.LocationScene}`);
    if (a.Severity) parts.push(`Severity: ${a.Severity}`);
    if (a.PatrolArea) parts.push(`Patrol Area: ${a.PatrolArea}`);
    return parts.join('\n');
  }
}

export const bpdCrimeFetcher = new BPDCrimeFetcher();
export default bpdCrimeFetcher;
