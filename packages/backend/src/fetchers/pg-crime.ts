import { BaseFetcher } from './base.js';
import type { Incident } from '../types/index.js';
import config from '../config.js';
import logger from '../logger.js';

/**
 * Prince George's County, MD Crime Data Fetcher
 * 
 * Uses the Socrata Open Data API (SODA) via PG County Open Data
 * API Endpoint: https://data.princegeorgescountymd.gov/resource/xjru-idbe.json
 * 
 * Dataset: Crime Incidents (July 2023 to Present)
 * Data includes: traffic accidents, assaults, burglaries, homicides, robberies,
 * sex offenses, stolen vehicles, thefts, and vandalisms.
 * 
 * Addresses are rounded to hundred block for privacy.
 */

interface PGCrimeRecord {
  incident_case_id?: string;
  date?: string;                    // MM/DD/YYYY format
  clearance_code_inc_type?: string; // Crime type description
  pgpd_reporting_area?: string;
  pgpd_sector?: string;
  pgpd_beat?: string;
  street_number?: string;           // e.g., "200 BLOCK"
  street_address?: string;
  city?: string;
  state?: string;
  zip?: string;
  latitude?: string;
  longitude?: string;
  location?: string;                // "(lat,lng)" format
}

export class PGCrimeFetcher extends BaseFetcher<Incident> {
  constructor() {
    super('pg-crime', config.cacheTtl.crime);
  }

  protected async fetchFromApi(): Promise<Incident[]> {
    // Calculate date for last 30 days of data
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    // Format as MM/DD/YYYY for the Socrata API
    const month = String(thirtyDaysAgo.getMonth() + 1).padStart(2, '0');
    const day = String(thirtyDaysAgo.getDate()).padStart(2, '0');
    const year = thirtyDaysAgo.getFullYear();
    const dateStr = `${month}/${day}/${year}`;

    // Socrata SODA API - current crime data (July 2023 to present)
    const baseUrl = 'https://data.princegeorgescountymd.gov/resource/xjru-idbe.json';
    
    const params = new URLSearchParams({
      '$where': `date >= '${dateStr}'`,
      '$order': 'date DESC',
      '$limit': '2000',
    });

    const url = `${baseUrl}?${params.toString()}`;

    try {
      const response = await this.httpGet<PGCrimeRecord[]>(url);

      if (!Array.isArray(response)) {
        logger.warn('Prince George\'s County Crime response has unexpected format');
        return [];
      }

      logger.info(`PG Crime: fetched ${response.length} incidents from last 30 days`);

      return response
        .filter((record) => record.latitude && record.longitude)
        .map((record) => this.normalizeCrime(record));
    } catch (error) {
      logger.error('Failed to fetch Prince George\'s County Crime data', { error });
      throw error;
    }
  }

  private normalizeCrime(record: PGCrimeRecord): Incident {
    const now = new Date().toISOString();

    // Parse date - PG uses MM/DD/YYYY format
    let incidentDate: string;
    if (record.date) {
      const [month, day, year] = record.date.split('/');
      incidentDate = new Date(`${year}-${month}-${day}`).toISOString();
    } else {
      incidentDate = now;
    }

    // Build offense string
    const offense = record.clearance_code_inc_type || 'Unknown Offense';

    // Build address
    const address = this.buildAddress(record);

    return {
      id: `pg-crime-${record.incident_case_id || this.generateId(record)}`,
      type: 'crime',
      severity: this.mapSeverity(offense),
      location: {
        lat: parseFloat(record.latitude!),
        lng: parseFloat(record.longitude!),
        address,
        neighborhood: record.city || record.pgpd_sector,
      },
      timestamp: incidentDate,
      updatedAt: now,
      regionId: 'dc',
      source: 'pg-crime',
      title: this.formatOffense(offense),
      description: this.buildDescription(record),
      status: 'active',
      category: offense,
      metadata: {
        case_id: record.incident_case_id,
        reporting_area: record.pgpd_reporting_area,
        sector: record.pgpd_sector,
        beat: record.pgpd_beat,
        city: record.city,
        zip: record.zip,
        jurisdiction: 'Prince George\'s County, MD',
      },
    };
  }

  private generateId(record: PGCrimeRecord): string {
    // Generate a unique ID if incident_case_id is not available
    const date = record.date || '';
    const lat = record.latitude || '0';
    const lng = record.longitude || '0';
    const offense = record.clearance_code_inc_type || '';
    return Buffer.from(`${date}-${lat}-${lng}-${offense}`).toString('base64').slice(0, 16);
  }

  private buildAddress(record: PGCrimeRecord): string {
    const parts: string[] = [];

    if (record.street_number) {
      parts.push(record.street_number);
    }

    if (record.street_address) {
      parts.push(record.street_address);
    }

    if (record.city) {
      if (parts.length > 0) {
        return `${parts.join(' ')}, ${record.city}`;
      }
      return record.city;
    }

    return parts.join(' ') || 'Prince George\'s County, MD';
  }

  private mapSeverity(offense: string): 1 | 2 | 3 | 4 | 5 {
    const offenseLower = offense?.toLowerCase() || '';

    // Critical (5) - Violent crimes against persons
    if (
      offenseLower.includes('homicide') ||
      offenseLower.includes('murder') ||
      offenseLower.includes('kidnapping') ||
      offenseLower.includes('manslaughter')
    ) {
      return 5;
    }

    // High (4) - Serious violent crimes
    if (
      offenseLower.includes('robbery') ||
      offenseLower.includes('sex offense') ||
      offenseLower.includes('rape') ||
      offenseLower.includes('carjacking') ||
      (offenseLower.includes('assault') && offenseLower.includes('aggravated'))
    ) {
      return 4;
    }

    // Medium-High (3) - Property crimes with force/assault
    if (
      offenseLower.includes('assault') ||
      offenseLower.includes('burglary') ||
      offenseLower.includes('breaking') ||
      offenseLower.includes('arson')
    ) {
      return 3;
    }

    // Medium (2) - Property crimes
    if (
      offenseLower.includes('theft') ||
      offenseLower.includes('larceny') ||
      offenseLower.includes('stolen vehicle') ||
      offenseLower.includes('vandalism') ||
      offenseLower.includes('accident')
    ) {
      return 2;
    }

    // Low (1) - Minor offenses, traffic accidents
    return 1;
  }

  private formatOffense(offense: string): string {
    if (!offense) return 'Unknown Offense';

    // Convert to title case and clean up
    return offense
      .toLowerCase()
      .split(/[\s_-]+/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  private buildDescription(record: PGCrimeRecord): string {
    const parts: string[] = [];

    if (record.clearance_code_inc_type) {
      parts.push(`Offense: ${this.formatOffense(record.clearance_code_inc_type)}`);
    }

    const address = this.buildAddress(record);
    if (address && address !== 'Prince George\'s County, MD') {
      parts.push(`Location: ${address}`);
    }

    if (record.city) {
      parts.push(`City: ${record.city}`);
    }

    if (record.pgpd_sector) {
      parts.push(`Sector: ${record.pgpd_sector}`);
    }

    if (record.pgpd_beat) {
      parts.push(`Beat: ${record.pgpd_beat}`);
    }

    parts.push('Jurisdiction: Prince George\'s County, MD');

    return parts.join('\n');
  }
}

export const pgCrimeFetcher = new PGCrimeFetcher();
export default pgCrimeFetcher;
