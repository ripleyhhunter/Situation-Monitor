import type { Incident, Camera, WeatherAlert } from '../types/index.js';
import logger from '../logger.js';

/**
 * In-memory database service (no native dependencies)
 * Data is primarily stored in Redis cache; this provides a fallback
 */
class DatabaseService {
  private incidents: Map<string, Incident> = new Map();
  private cameras: Map<string, Camera> = new Map();
  private weatherAlerts: Map<string, WeatherAlert> = new Map();

  initialize(): void {
    logger.info('Database service initialized (in-memory mode)');
  }

  // Incident methods
  upsertIncident(incident: Incident): void {
    this.incidents.set(incident.id, incident);
  }

  getActiveIncidents(): Incident[] {
    return Array.from(this.incidents.values()).filter((i) => i.status === 'active');
  }

  getIncidentById(id: string): Incident | null {
    return this.incidents.get(id) || null;
  }

  updateIncidentStatus(id: string, status: string): void {
    const incident = this.incidents.get(id);
    if (incident) {
      incident.status = status as Incident['status'];
      incident.updatedAt = new Date().toISOString();
    }
  }

  deleteIncident(id: string): void {
    this.incidents.delete(id);
  }

  // Camera methods
  upsertCamera(camera: Camera): void {
    this.cameras.set(camera.id, camera);
  }

  getAllCameras(): Camera[] {
    return Array.from(this.cameras.values());
  }

  // Weather methods
  upsertWeatherAlert(alert: WeatherAlert): void {
    this.weatherAlerts.set(alert.id, alert);
  }

  getActiveWeatherAlerts(): WeatherAlert[] {
    const now = new Date();
    return Array.from(this.weatherAlerts.values()).filter(
      (a) => new Date(a.expires) > now
    );
  }

  close(): void {
    this.incidents.clear();
    this.cameras.clear();
    this.weatherAlerts.clear();
    logger.info('Database service closed');
  }
}

export const database = new DatabaseService();
export default database;
