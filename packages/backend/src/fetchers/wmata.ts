import { BaseFetcher } from './base.js';
import type { Incident, TrainPosition } from '../types/index.js';
import config from '../config.js';
import logger from '../logger.js';

interface WMATAIncident {
  DateUpdated: string;
  DelaySeverity: string;
  Description: string;
  EmergencyText: string;
  EndLocationFullName: string;
  IncidentID: string;
  IncidentType: string;
  LinesAffected: string;
  PassengerDelay: number;
  StartLocationFullName: string;
}

interface WMATAIncidentResponse {
  Incidents: WMATAIncident[];
}

interface WMATATrainPosition {
  TrainId: string;
  TrainNumber: string;
  CarCount: number;
  DirectionNum: number;
  CircuitId: number;
  DestinationStationCode: string;
  LineCode: string;
  SecondsAtLocation: number;
  ServiceType: string;
  Lat: number;
  Lon: number;
}

interface WMATATrainPositionResponse {
  TrainPositions: WMATATrainPosition[];
}

export class WMATAFetcher extends BaseFetcher<Incident> {
  readonly incidentSource = 'wmata' as const;

  private apiKey: string;

  constructor() {
    super('wmata', config.cacheTtl.wmata);
    this.apiKey = config.wmataApiKey || '';
  }

  protected async fetchFromApi(): Promise<Incident[]> {
    // If no API key, return empty (WMATA requires registration)
    if (!this.apiKey) {
      logger.warn('WMATA API key not configured, skipping fetch');
      return [];
    }

    const incidents = await this.fetchIncidents();
    return incidents;
  }

  private async fetchIncidents(): Promise<Incident[]> {
    const url = 'https://api.wmata.com/Incidents.svc/json/Incidents';

    try {
      const response = await this.httpGet<WMATAIncidentResponse>(url, {
        headers: {
          api_key: this.apiKey,
        },
      });

      if (!response.Incidents || !Array.isArray(response.Incidents)) {
        // 'wmata' is a complete-listing source: a false-empty "success" here
        // would cross-clear every live metro alert. Surface contract drift as
        // a failure so BaseFetcher serves the last good snapshot instead.
        throw new Error('WMATA: unexpected response shape (no Incidents array)');
      }

      return response.Incidents.map((incident) => this.normalizeIncident(incident));
    } catch (error) {
      logger.error('Failed to fetch WMATA incidents', { error });
      throw error;
    }
  }

  async fetchTrainPositions(): Promise<TrainPosition[]> {
    if (!this.apiKey) {
      return [];
    }

    const url = 'https://api.wmata.com/TrainPositions/TrainPositions?contentType=json';

    try {
      const response = await this.httpGet<WMATATrainPositionResponse>(url, {
        headers: {
          api_key: this.apiKey,
        },
      });

      if (!response.TrainPositions || !Array.isArray(response.TrainPositions)) {
        return [];
      }

      return response.TrainPositions
        .filter((train) => train.Lat !== 0 && train.Lon !== 0)
        .map((train) => ({
          trainId: train.TrainId,
          line: this.mapLineCode(train.LineCode),
          destination: train.DestinationStationCode,
          lat: train.Lat,
          lng: train.Lon,
          direction: train.DirectionNum,
        }));
    } catch (error) {
      logger.error('Failed to fetch WMATA train positions', { error });
      return [];
    }
  }

  private normalizeIncident(incident: WMATAIncident): Incident {
    const now = new Date().toISOString();

    // Parse lines affected (format: "RD; BL; OR;")
    const lines = incident.LinesAffected
      ? incident.LinesAffected.split(';')
          .map((l) => l.trim())
          .filter(Boolean)
          .map((code) => this.mapLineCode(code))
      : [];

    return {
      id: `wmata-${incident.IncidentID}`,
      type: 'transit',
      severity: this.mapSeverity(incident.DelaySeverity, incident.PassengerDelay),
      location: {
        lat: config.defaultLat, // Metro incidents don't have specific coords
        lng: config.defaultLng,
        address: this.buildLocationString(incident),
      },
      timestamp: incident.DateUpdated || now,
      updatedAt: now,
      regionId: 'dc',
      source: 'wmata',
      title: this.buildTitle(incident, lines),
      description: incident.Description,
      status: 'active',
      category: incident.IncidentType,
      metadata: {
        lines,
        linesAffected: incident.LinesAffected,
        delaySeverity: incident.DelaySeverity,
        passengerDelay: incident.PassengerDelay,
        emergencyText: incident.EmergencyText,
        incidentType: incident.IncidentType,
      },
    };
  }

  private mapSeverity(
    delaySeverity: string | null,
    passengerDelay: number
  ): 1 | 2 | 3 | 4 | 5 {
    // Map WMATA delay severity
    if (delaySeverity) {
      const severityMap: Record<string, 1 | 2 | 3 | 4 | 5> = {
        Minor: 2,
        Moderate: 3,
        Major: 4,
        Severe: 5,
      };
      if (severityMap[delaySeverity]) {
        return severityMap[delaySeverity];
      }
    }

    // Fallback to passenger delay minutes
    if (passengerDelay >= 30) return 5;
    if (passengerDelay >= 20) return 4;
    if (passengerDelay >= 10) return 3;
    if (passengerDelay >= 5) return 2;
    return 1;
  }

  private mapLineCode(code: string): string {
    const lineNames: Record<string, string> = {
      RD: 'Red Line',
      BL: 'Blue Line',
      OR: 'Orange Line',
      SV: 'Silver Line',
      GR: 'Green Line',
      YL: 'Yellow Line',
    };
    return lineNames[code] || code;
  }

  private buildTitle(incident: WMATAIncident, lines: string[]): string {
    const lineStr = lines.length > 0 ? lines.join(', ') : 'Metro';
    return `${lineStr}: ${incident.IncidentType || 'Service Alert'}`;
  }

  private buildLocationString(incident: WMATAIncident): string {
    const parts: string[] = [];

    if (incident.StartLocationFullName) {
      parts.push(incident.StartLocationFullName);
    }

    if (
      incident.EndLocationFullName &&
      incident.EndLocationFullName !== incident.StartLocationFullName
    ) {
      parts.push(incident.EndLocationFullName);
    }

    return parts.join(' to ') || 'Metro System';
  }
}

export const wmataFetcher = new WMATAFetcher();
export default wmataFetcher;
