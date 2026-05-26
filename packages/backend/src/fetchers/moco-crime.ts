import { BaseFetcher } from './base.js';
import type { Incident } from '../types/index.js';
import config from '../config.js';
import logger from '../logger.js';

/**
 * Montgomery County, MD Crime Data Fetcher
 * 
 * Uses the Socrata Open Data API (SODA) via dataMontgomery
 * API Endpoint: https://data.montgomerycountymd.gov/resource/icn6-v9z3.json
 * 
 * Data is updated daily and includes NIBRS-classified crime reports.
 * Location data is approximate (hundred block) for privacy.
 */

interface MoCoCrimeRecord {
  // Core fields
  incident_id?: string;
  nibrs_code?: string;
  offence_code?: string;
  case_number?: string;
  
  // Crime classification - API uses NO underscores in field names!
  crimename1?: string;
  crimename2?: string;
  crimename3?: string;
  
  // Location
  location?: string;       // e.g. "2300 BLK JONES LA"
  address_number?: string;
  address_street?: string;
  street_type?: string;
  city?: string;
  state?: string;
  zip_code?: string;
  latitude?: string;
  longitude?: string;
  district?: string;       // e.g. "WHEATON"
  sector?: string;
  beat?: string;
  pra?: string;
  police_district_number?: string;
  
  // Time
  date?: string;          // Date of incident (ISO format)
  start_date?: string;    // Start date/time
  
  // Place
  place?: string;
  agency?: string;
  
  // Victim info (no PII)
  victims?: string;
}

export class MoCoCrimeFetcher extends BaseFetcher<Incident> {
  constructor() {
    super('moco-crime', config.cacheTtl.crime);
  }

  protected async fetchFromApi(): Promise<Incident[]> {
    // Calculate date for last 30 days of data
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const dateStr = thirtyDaysAgo.toISOString().split('T')[0];

    // Socrata SODA API with SoQL query
    // Fetch crimes from the last 30 days, ordered by date descending
    const baseUrl = 'https://data.montgomerycountymd.gov/resource/icn6-v9z3.json';
    
    const params = new URLSearchParams({
      '$where': `date >= '${dateStr}'`,
      '$order': 'date DESC',
      '$limit': '2000',
    });

    const url = `${baseUrl}?${params.toString()}`;

    try {
      const response = await this.httpGet<MoCoCrimeRecord[]>(url);

      if (!Array.isArray(response)) {
        logger.warn('Montgomery County Crime response has unexpected format');
        return [];
      }

      logger.info(`MoCo Crime: fetched ${response.length} incidents from last 30 days`);

      // Filter out records without valid coordinates
      // Many MoCo records have lat/lng of "0.0" which is invalid
      const validRecords = response.filter((record) => {
        const lat = parseFloat(record.latitude || '0');
        const lng = parseFloat(record.longitude || '0');
        // Valid DC-area coordinates: lat ~38-40, lng ~-76 to -78
        return lat > 38 && lat < 40 && lng < -76 && lng > -78;
      });

      logger.info(`MoCo Crime: ${validRecords.length} of ${response.length} records have valid coordinates`);

      return validRecords.map((record) => this.normalizeCrime(record));
    } catch (error) {
      logger.error('Failed to fetch Montgomery County Crime data', { error });
      throw error;
    }
  }

  private normalizeCrime(record: MoCoCrimeRecord): Incident {
    const now = new Date().toISOString();

    // Parse date - Socrata returns ISO format strings
    const incidentDate = record.date 
      ? new Date(record.date).toISOString()
      : record.start_date
        ? new Date(record.start_date).toISOString()
        : now;

    // Build the crime name from available fields (API uses crimename1, not crime_name1)
    const crimeName = record.crimename1 || record.crimename2 || 'Unknown Offense';

    // Build address from location field or construct from parts
    const address = record.location || this.buildAddress(record);

    return {
      id: `moco-crime-${record.incident_id || this.generateId(record)}`,
      type: 'crime',
      severity: this.mapSeverity(crimeName),
      location: {
        lat: parseFloat(record.latitude!),
        lng: parseFloat(record.longitude!),
        address,
        neighborhood: record.city || record.district,
      },
      timestamp: incidentDate,
      updatedAt: now,
      regionId: 'dc',
      source: 'moco-crime',
      title: this.formatOffense(crimeName),
      description: this.buildDescription(record),
      status: 'active',
      category: record.crimename1,
      metadata: {
        nibrs_code: record.nibrs_code,
        crimename2: record.crimename2,
        crimename3: record.crimename3,
        police_district: record.district,
        police_district_number: record.police_district_number,
        place: record.place,
        city: record.city,
        zip_code: record.zip_code,
        victims: record.victims,
        jurisdiction: 'Montgomery County, MD',
      },
    };
  }

  private generateId(record: MoCoCrimeRecord): string {
    // Generate a unique ID if incident_id is not available
    const date = record.date || record.start_date || '';
    const lat = record.latitude || '0';
    const lng = record.longitude || '0';
    const crime = record.crimename1 || '';
    return Buffer.from(`${date}-${lat}-${lng}-${crime}`).toString('base64').slice(0, 16);
  }

  private buildAddress(record: MoCoCrimeRecord): string {
    const parts: string[] = [];
    
    // Use location field if available (e.g. "2300 BLK JONES LA")
    if (record.location) {
      parts.push(record.location);
    } else if (record.address_number && record.address_street) {
      parts.push(`${record.address_number} ${record.address_street} ${record.street_type || ''}`.trim());
    }
    
    if (record.city) {
      parts.push(record.city);
    }
    
    if (parts.length === 0 && record.district) {
      parts.push(record.district);
    }
    
    return parts.join(', ') || 'Montgomery County, MD';
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
      offenseLower.includes('assault') && offenseLower.includes('aggravated') ||
      offenseLower.includes('rape') ||
      offenseLower.includes('sexual assault') ||
      offenseLower.includes('carjacking') ||
      offenseLower.includes('weapon')
    ) {
      return 4;
    }

    // Medium-High (3) - Property crimes with force/violence
    if (
      offenseLower.includes('assault') ||
      offenseLower.includes('burglary') ||
      offenseLower.includes('arson') ||
      offenseLower.includes('breaking')
    ) {
      return 3;
    }

    // Medium (2) - Property crimes
    if (
      offenseLower.includes('theft') ||
      offenseLower.includes('larceny') ||
      offenseLower.includes('motor vehicle') ||
      offenseLower.includes('stolen') ||
      offenseLower.includes('fraud') ||
      offenseLower.includes('forgery')
    ) {
      return 2;
    }

    // Low (1) - Minor offenses
    return 1;
  }

  private formatOffense(offense: string): string {
    if (!offense) return 'Unknown Offense';

    // Convert to title case
    return offense
      .toLowerCase()
      .split(/[\s_]+/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  private buildDescription(record: MoCoCrimeRecord): string {
    const parts: string[] = [];

    const crimeName = record.crimename1;
    if (crimeName) {
      parts.push(`Offense: ${this.formatOffense(crimeName)}`);
    }

    if (record.crimename2) {
      parts.push(`Secondary: ${this.formatOffense(record.crimename2)}`);
    }

    if (record.crimename3) {
      parts.push(`Detail: ${this.formatOffense(record.crimename3)}`);
    }

    if (record.location) {
      parts.push(`Location: ${record.location}`);
    }

    if (record.city) {
      parts.push(`City: ${record.city}`);
    }

    if (record.district) {
      parts.push(`District: ${record.district}`);
    }

    if (record.place) {
      parts.push(`Place Type: ${record.place}`);
    }

    parts.push('Jurisdiction: Montgomery County, MD');

    return parts.join('\n');
  }
}

export const mocoCrimeFetcher = new MoCoCrimeFetcher();
export default mocoCrimeFetcher;
