import { BaseFetcher } from './base.js';
import type { Incident } from '../types/index.js';
import config from '../config.js';
import logger from '../logger.js';

interface ShotSpotterFeature {
  attributes: {
    OBJECTID: number;
    ID: string;
    DATETIME: number; // epoch milliseconds
    TYPE: string;
    LATITUDE: number;
    LONGITUDE: number;
  };
}

interface ShotSpotterResponse {
  features: ShotSpotterFeature[];
}

export class DCShotSpotterFetcher extends BaseFetcher<Incident> {
  constructor() {
    super('dc-shotspotter', config.cacheTtl.shotspotter);
  }

  protected async fetchFromApi(): Promise<Incident[]> {
    // Query DC Open Data API for ShotSpotter gunshot data
    // Note: ShotSpotter data feed may be discontinued - fetching most recent available data
    const baseUrl =
      'https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Public_Safety_WebMercator/MapServer/29/query';

    const params = new URLSearchParams({
      f: 'json',
      where: 'DATETIME IS NOT NULL',
      outFields: '*',
      orderByFields: 'DATETIME DESC',
      resultRecordCount: '100',
    });

    const url = `${baseUrl}?${params.toString()}`;

    try {
      const response = await this.httpGet<ShotSpotterResponse>(url);

      if (!response.features || !Array.isArray(response.features)) {
        logger.warn('ShotSpotter response has unexpected format');
        return [];
      }

      return response.features
        .filter((f) => f.attributes.LATITUDE && f.attributes.LONGITUDE)
        .map((f) => this.normalizeGunshot(f));
    } catch (error) {
      logger.error('Failed to fetch ShotSpotter data', { error });
      throw error;
    }
  }

  private normalizeGunshot(feature: ShotSpotterFeature): Incident {
    const attrs = feature.attributes;
    const now = new Date().toISOString();

    // Parse datetime (epoch milliseconds)
    const timestamp = attrs.DATETIME
      ? new Date(attrs.DATETIME).toISOString()
      : now;

    // Extract round count from type string (e.g., "Multiple_Gunshots")
    const rounds = attrs.TYPE?.toLowerCase().includes('multiple') ? 3 : 1;
    const type = attrs.TYPE || 'Gunshot';

    return {
      id: `dc-shotspotter-${attrs.ID || attrs.OBJECTID}`,
      type: 'gunshot',
      severity: this.mapSeverity(rounds),
      location: {
        lat: attrs.LATITUDE,
        lng: attrs.LONGITUDE,
      },
      timestamp,
      updatedAt: now,
      source: 'dc-shotspotter',
      title: this.buildTitle(type, rounds),
      description: this.buildDescription(type, rounds, timestamp),
      status: this.determineStatus(timestamp),
      category: type,
      metadata: {
        rounds,
        type,
        objectId: attrs.OBJECTID,
      },
    };
  }

  private mapSeverity(rounds: number): 1 | 2 | 3 | 4 | 5 {
    if (rounds >= 10) return 5; // Multiple gunshots, very concerning
    if (rounds >= 5) return 4;
    if (rounds >= 3) return 3;
    if (rounds >= 2) return 2;
    return 1; // Single gunshot
  }

  private buildTitle(type: string, rounds: number): string {
    if (type.toLowerCase().includes('multiple') || rounds > 1) {
      return `Multiple Gunshots Detected (${rounds} rounds)`;
    }
    return 'Gunshot Detected';
  }

  private buildDescription(type: string, rounds: number, timestamp: string): string {
    const date = new Date(timestamp);
    const formattedDate = date.toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });

    return `ShotSpotter detected ${rounds} round${rounds > 1 ? 's' : ''} on ${formattedDate}. Type: ${type}`;
  }

  private determineStatus(_timestamp: string): 'active' | 'cleared' {
    // Always show ShotSpotter data as "active" since it's historical data
    // that provides valuable context for understanding gun violence patterns
    // The actual DATETIME field contains the original detection date (often months ago)
    // while the CREATED/EDITED fields show when the database was updated
    return 'active';
  }
}

export const dcShotSpotterFetcher = new DCShotSpotterFetcher();
export default dcShotSpotterFetcher;
