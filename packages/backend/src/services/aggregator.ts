import type { Incident, Camera, WeatherAlert, AirQuality } from '../types/index.js';
import { nwsWeatherFetcher } from '../fetchers/nws-weather.js';
import { mdchartCamerasFetcher } from '../fetchers/mdchart-cameras.js';
import { dcCamerasFetcher } from '../fetchers/dc-cameras.js';
import { landmarkWebcamsFetcher } from '../fetchers/landmark-webcams.js';
import { mdchartIncidentsFetcher } from '../fetchers/mdchart-incidents.js';
import { dcCrimeFetcher } from '../fetchers/dc-crime.js';
import { dcShotSpotterFetcher } from '../fetchers/dc-shotspotter.js';
import { dcTrafficFetcher } from '../fetchers/dc-traffic.js';
import { alertDCFetcher } from '../fetchers/alertdc.js';
import { wmataFetcher } from '../fetchers/wmata.js';
import { airnowFetcher } from '../fetchers/airnow.js';
import { scheduler } from './scheduler.js';
import { sse } from './sse.js';
import { database } from './database.js';
import config from '../config.js';
import logger from '../logger.js';

interface AggregatedData {
  incidents: Incident[];
  cameras: Camera[];
  weather: WeatherAlert[];
  airQuality: AirQuality[];
}

class AggregatorService {
  private incidents: Map<string, Incident> = new Map();
  private cameras: Map<string, Camera> = new Map();
  private weatherAlerts: Map<string, WeatherAlert> = new Map();
  private airQuality: AirQuality[] = [];
  private initialized = false;

  /**
   * Initialize the aggregator and start scheduled fetching
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    logger.info('Initializing aggregator service');

    // Schedule all fetchers
    this.scheduleAllFetchers();

    // Do initial fetch
    await this.fetchAll();

    this.initialized = true;
    logger.info('Aggregator service initialized');
  }

  private scheduleAllFetchers(): void {
    // Weather alerts - every 2 minutes
    scheduler.schedule('weather', '*/2 * * * *', async () => {
      await this.fetchWeather();
    });

    // Traffic cameras - every 5 minutes
    scheduler.schedule('cameras', '*/5 * * * *', async () => {
      await this.fetchCameras();
    });

    // Traffic incidents - every minute
    scheduler.schedule('traffic-incidents', '* * * * *', async () => {
      await this.fetchTrafficIncidents();
    });

    // Crime data - every 15 minutes
    scheduler.schedule('crime', '*/15 * * * *', async () => {
      await this.fetchCrime();
    });

    // ShotSpotter - every 5 minutes
    scheduler.schedule('shotspotter', '*/5 * * * *', async () => {
      await this.fetchShotSpotter();
    });

    // AlertDC - every 2 minutes (emergency alerts are time-sensitive)
    scheduler.schedule('alertdc', '*/2 * * * *', async () => {
      await this.fetchAlertDC();
    });

    // WMATA - every minute (if API key configured)
    if (config.wmataApiKey) {
      scheduler.schedule('wmata', '* * * * *', async () => {
        await this.fetchTransit();
      });
    }

    // Air quality - every 30 minutes
    scheduler.schedule('airquality', '*/30 * * * *', async () => {
      await this.fetchAirQuality();
    });
  }

  /**
   * Fetch all data sources
   */
  async fetchAll(): Promise<void> {
    await Promise.all([
      this.fetchWeather(),
      this.fetchCameras(),
      this.fetchTrafficIncidents(),
      this.fetchCrime(),
      this.fetchShotSpotter(),
      this.fetchAlertDC(),
      this.fetchTransit(),
      this.fetchAirQuality(),
    ]);
  }

  private async fetchWeather(): Promise<void> {
    const result = await nwsWeatherFetcher.fetch();

    if (result.success && result.data) {
      const previousIds = new Set(this.weatherAlerts.keys());

      for (const alert of result.data) {
        const existing = this.weatherAlerts.get(alert.id);

        if (!existing) {
          // New alert
          this.weatherAlerts.set(alert.id, alert);
          database.upsertWeatherAlert(alert);
          sse.broadcast('weather:alert', alert);
        } else if (JSON.stringify(existing) !== JSON.stringify(alert)) {
          // Updated alert
          this.weatherAlerts.set(alert.id, alert);
          database.upsertWeatherAlert(alert);
          sse.broadcast('weather:alert', alert);
        }

        previousIds.delete(alert.id);
      }

      // Cleared alerts
      for (const id of previousIds) {
        this.weatherAlerts.delete(id);
        sse.broadcast('weather:clear', { id });
      }
    }
  }

  private async fetchCameras(): Promise<void> {
    // Fetch from Maryland CHART, DC, and landmark webcams
    const [mdResult, dcResult, landmarkResult] = await Promise.all([
      mdchartCamerasFetcher.fetch(),
      dcCamerasFetcher.fetch(),
      landmarkWebcamsFetcher.fetch(),
    ]);

    const allCameras: Camera[] = [];

    if (mdResult.success && mdResult.data) {
      allCameras.push(...mdResult.data);
    }

    if (dcResult.success && dcResult.data) {
      allCameras.push(...dcResult.data);
    }

    if (landmarkResult.success && landmarkResult.data) {
      allCameras.push(...landmarkResult.data);
    }

    for (const camera of allCameras) {
      const existing = this.cameras.get(camera.id);

      if (!existing || existing.lastUpdated !== camera.lastUpdated) {
        this.cameras.set(camera.id, camera);
        database.upsertCamera(camera);
        sse.broadcast('camera:update', camera);
      }
    }
  }

  private async fetchTrafficIncidents(): Promise<void> {
    // Fetch from both Maryland CHART and DC HSEMA
    const [mdResult, dcResult] = await Promise.all([
      mdchartIncidentsFetcher.fetch(),
      dcTrafficFetcher.fetch(),
    ]);

    if (mdResult.success && mdResult.data) {
      await this.processIncidents(mdResult.data);
    }

    if (dcResult.success && dcResult.data) {
      await this.processIncidents(dcResult.data);
    }
  }

  private async fetchCrime(): Promise<void> {
    const result = await dcCrimeFetcher.fetch();

    if (result.success && result.data) {
      await this.processIncidents(result.data);
    }
  }

  private async fetchShotSpotter(): Promise<void> {
    const result = await dcShotSpotterFetcher.fetch();

    if (result.success && result.data) {
      await this.processIncidents(result.data);
    }
  }

  private async fetchAlertDC(): Promise<void> {
    const result = await alertDCFetcher.fetch();

    if (result.success && result.data) {
      await this.processIncidents(result.data);
    }
  }

  private async fetchTransit(): Promise<void> {
    const result = await wmataFetcher.fetch();

    if (result.success && result.data) {
      await this.processIncidents(result.data);
    }
  }

  private async fetchAirQuality(): Promise<void> {
    const result = await airnowFetcher.fetch();

    if (result.success && result.data) {
      this.airQuality = result.data;

      for (const aqi of result.data) {
        sse.broadcast('aqi:update', aqi);
      }
    }
  }

  private async processIncidents(newIncidents: Incident[]): Promise<void> {
    const processedIds = new Set<string>();

    for (const incident of newIncidents) {
      processedIds.add(incident.id);
      const existing = this.incidents.get(incident.id);

      if (!existing) {
        // New incident
        this.incidents.set(incident.id, incident);
        database.upsertIncident(incident);
        sse.broadcast('incident:new', incident);
      } else if (existing.updatedAt !== incident.updatedAt) {
        // Updated incident
        this.incidents.set(incident.id, incident);
        database.upsertIncident(incident);
        sse.broadcast('incident:update', incident);
      }
    }

    // Check for cleared incidents from this source
    const sourcePrefix = newIncidents[0]?.source;
    if (sourcePrefix) {
      for (const [id, incident] of this.incidents) {
        if (incident.source === sourcePrefix && !processedIds.has(id)) {
          // Incident no longer in feed - might be cleared
          if (incident.status === 'active') {
            incident.status = 'cleared';
            incident.updatedAt = new Date().toISOString();
            database.updateIncidentStatus(id, 'cleared');
            sse.broadcast('incident:clear', { id });
          }
        }
      }
    }
  }

  /**
   * Get all current data
   */
  getAll(): AggregatedData {
    return {
      incidents: Array.from(this.incidents.values()).filter(
        (i) => i.status === 'active'
      ),
      cameras: Array.from(this.cameras.values()),
      weather: Array.from(this.weatherAlerts.values()),
      airQuality: this.airQuality,
    };
  }

  /**
   * Get active incidents
   */
  getIncidents(): Incident[] {
    return Array.from(this.incidents.values()).filter((i) => i.status === 'active');
  }

  /**
   * Get incident by ID
   */
  getIncidentById(id: string): Incident | undefined {
    return this.incidents.get(id);
  }

  /**
   * Get all cameras
   */
  getCameras(): Camera[] {
    return Array.from(this.cameras.values());
  }

  /**
   * Get camera by ID
   */
  getCameraById(id: string): Camera | undefined {
    return this.cameras.get(id);
  }

  /**
   * Get weather alerts
   */
  getWeatherAlerts(): WeatherAlert[] {
    return Array.from(this.weatherAlerts.values());
  }

  /**
   * Get air quality data
   */
  getAirQuality(): AirQuality[] {
    return this.airQuality;
  }

  /**
   * Shutdown the aggregator
   */
  shutdown(): void {
    scheduler.shutdown();
    logger.info('Aggregator service shut down');
  }
}

export const aggregator = new AggregatorService();
export default aggregator;
