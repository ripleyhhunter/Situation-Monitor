import { BaseFetcher } from './base.js';
import type { Incident } from '../types/index.js';
import config from '../config.js';
import logger from '../logger.js';

interface DCCrimeFeature {
  attributes: {
    CCN: string;
    REPORT_DAT: string;
    SHIFT: string;
    METHOD: string;
    OFFENSE: string;
    BLOCK: string;
    XBLOCK: number;
    YBLOCK: number;
    WARD: number;
    ANC: string;
    DISTRICT: string;
    PSA: string;
    NEIGHBORHOOD_CLUSTER: string;
    BLOCK_GROUP: string;
    CENSUS_TRACT: number;
    VOTING_PRECINCT: string;
    LATITUDE: number;
    LONGITUDE: number;
    BID: string;
    START_DATE: number;
    END_DATE: number;
    OBJECTID: number;
  };
}

interface DCCrimeResponse {
  features: DCCrimeFeature[];
}

export class DCCrimeFetcher extends BaseFetcher<Incident> {
  constructor() {
    super('dc-crime', config.cacheTtl.crime);
  }

  protected async fetchFromApi(): Promise<Incident[]> {
    // Fetch crime data from DC Open Data Socrata API
    // This endpoint has the full year of crime data
    // API docs: https://opendata.dc.gov/datasets/crime-incidents-in-2024
    
    // Try the ArcGIS REST API with the current year's crime layer
    // Layer numbers change yearly - try the general query endpoint
    const baseUrl =
      'https://maps2.dcgis.dc.gov/dcgis/rest/services/FEEDS/MPD/MapServer/39/query';

    const params = new URLSearchParams({
      f: 'json',
      where: '1=1',
      outFields: '*',
      orderByFields: 'REPORT_DAT DESC',
      resultRecordCount: '2000', // Get more records (Layer 39 has last 30 days max)
    });

    const url = `${baseUrl}?${params.toString()}`;

    try {
      const response = await this.httpGet<DCCrimeResponse>(url);

      if (!response.features || !Array.isArray(response.features)) {
        logger.warn('DC Crime response has unexpected format');
        return [];
      }

      // Keep records inside the aggregator's 30-day expiry — the rolling
      // layer can include slightly older rows, which would clear/re-add
      // in a loop.
      const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;

      return response.features
        .filter((f) => f.attributes.LATITUDE && f.attributes.LONGITUDE)
        .filter((f) => new Date(f.attributes.REPORT_DAT || 0).getTime() >= cutoff)
        .map((f) => this.normalizeCrime(f));
    } catch (error) {
      logger.error('Failed to fetch DC Crime data', { error });
      throw error;
    }
  }

  private normalizeCrime(feature: DCCrimeFeature): Incident {
    const attrs = feature.attributes;
    const now = new Date().toISOString();

    // Parse report date (format: YYYY/MM/DD HH:MM:SS+00)
    const reportDate = attrs.REPORT_DAT
      ? new Date(attrs.REPORT_DAT).toISOString()
      : now;

    return {
      id: `dc-crime-${attrs.CCN}`,
      type: 'crime',
      severity: this.mapSeverity(attrs.OFFENSE),
      location: {
        lat: attrs.LATITUDE,
        lng: attrs.LONGITUDE,
        address: attrs.BLOCK,
        neighborhood: attrs.NEIGHBORHOOD_CLUSTER,
      },
      timestamp: reportDate,
      // Stable across polls so the aggregator's updatedAt diff doesn't
      // re-broadcast ~2000 unchanged records every cycle.
      updatedAt: reportDate,
      regionId: 'dc',
      source: 'dc-crime',
      title: this.formatOffense(attrs.OFFENSE),
      description: this.buildDescription(attrs),
      status: 'active',
      category: attrs.OFFENSE,
      metadata: {
        ccn: attrs.CCN,
        shift: attrs.SHIFT,
        method: attrs.METHOD,
        ward: attrs.WARD,
        district: attrs.DISTRICT,
        psa: attrs.PSA,
        anc: attrs.ANC,
      },
    };
  }

  private mapSeverity(offense: string): 1 | 2 | 3 | 4 | 5 {
    const offenseLower = offense?.toLowerCase() || '';

    // Critical (5)
    if (
      offenseLower.includes('homicide') ||
      offenseLower.includes('murder') ||
      offenseLower.includes('kidnapping')
    ) {
      return 5;
    }

    // High (4)
    if (
      offenseLower.includes('robbery') ||
      offenseLower.includes('assault w/dangerous weapon') ||
      offenseLower.includes('sexual abuse') ||
      offenseLower.includes('carjacking')
    ) {
      return 4;
    }

    // Medium-High (3)
    if (
      offenseLower.includes('assault') ||
      offenseLower.includes('burglary') ||
      offenseLower.includes('arson')
    ) {
      return 3;
    }

    // Medium (2)
    if (
      offenseLower.includes('theft') ||
      offenseLower.includes('motor vehicle theft') ||
      offenseLower.includes('stolen auto')
    ) {
      return 2;
    }

    // Low (1)
    return 1;
  }

  private formatOffense(offense: string): string {
    if (!offense) return 'Unknown Offense';

    // Convert to title case
    return offense
      .toLowerCase()
      .split(' ')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  private buildDescription(attrs: DCCrimeFeature['attributes']): string {
    const parts: string[] = [];

    parts.push(`Offense: ${this.formatOffense(attrs.OFFENSE)}`);

    if (attrs.METHOD) {
      parts.push(`Method: ${attrs.METHOD}`);
    }

    if (attrs.BLOCK) {
      parts.push(`Location: ${attrs.BLOCK}`);
    }

    if (attrs.SHIFT) {
      parts.push(`Shift: ${attrs.SHIFT}`);
    }

    if (attrs.WARD) {
      parts.push(`Ward: ${attrs.WARD}`);
    }

    if (attrs.DISTRICT) {
      parts.push(`District: ${attrs.DISTRICT}`);
    }

    return parts.join('\n');
  }
}

export const dcCrimeFetcher = new DCCrimeFetcher();
export default dcCrimeFetcher;
