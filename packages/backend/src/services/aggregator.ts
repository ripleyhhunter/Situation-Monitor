import type { Incident, Camera, WeatherAlert, AirQuality, CurrentWeather, Aircraft, NewsItem } from '../types/index.js';
import { nwsWeatherFetcher } from '../fetchers/nws-weather.js';
import { currentWeatherFetcher } from '../fetchers/current-weather.js';
import { mdchartCamerasFetcher } from '../fetchers/mdchart-cameras.js';
import { dcCamerasFetcher } from '../fetchers/dc-cameras.js';
import { landmarkWebcamsFetcher } from '../fetchers/landmark-webcams.js';
import { mdchartIncidentsFetcher } from '../fetchers/mdchart-incidents.js';
import { dcCrimeFetcher } from '../fetchers/dc-crime.js';
import { mocoCrimeFetcher } from '../fetchers/moco-crime.js';
import { pgCrimeFetcher } from '../fetchers/pg-crime.js';
import { dcShotSpotterFetcher } from '../fetchers/dc-shotspotter.js';
import { dcTrafficFetcher } from '../fetchers/dc-traffic.js';
import { alertDCFetcher } from '../fetchers/alertdc.js';
import { wmataFetcher } from '../fetchers/wmata.js';
import { airnowFetcher } from '../fetchers/airnow.js';
import { openMHzFetcher } from '../fetchers/openmhz.js';
import { dcFireEMSTwitterFetcher } from '../fetchers/dcfireems-twitter.js';
import { pulsePointFetcher } from '../fetchers/pulsepoint.js';
import { openskyFetcher } from '../fetchers/opensky.js';
import newsFetcher from '../fetchers/news.js';
import { scheduler } from './scheduler.js';
import { sse } from './sse.js';
import { database } from './database.js';
import { cache } from './cache.js';
import { geocache } from './geocache.js';
import config from '../config.js';
import logger from '../logger.js';

// Redis key for persisted incidents
const INCIDENTS_CACHE_KEY = 'incidents:active';
const INCIDENTS_CACHE_TTL = 24 * 60 * 60; // 24 hours

interface AggregatedData {
  incidents: Incident[];
  cameras: Camera[];
  weather: WeatherAlert[];
  airQuality: AirQuality[];
  currentWeather: CurrentWeather | null;
  aircraft: Aircraft[];
  news: NewsItem[];
}

class AggregatorService {
  private incidents: Map<string, Incident> = new Map();
  private cameras: Map<string, Camera> = new Map();
  private weatherAlerts: Map<string, WeatherAlert> = new Map();
  private airQuality: AirQuality[] = [];
  private currentWeather: CurrentWeather | null = null;
  private aircraft: Map<string, Aircraft> = new Map();
  private news: NewsItem[] = [];
  private initialized = false;
  /**
   * Convert a millisecond interval into a cron expression.
   * Supports second-level scheduling when interval < 60s using 6-field cron.
   * Falls back to provided defaultExpression if intervalMs is invalid.
   */
  private buildCronExpression(intervalMs: number, defaultExpression: string): string {
    if (!intervalMs || intervalMs <= 0 || Number.isNaN(intervalMs)) {
      return defaultExpression;
    }

    // Sub-minute: use seconds field (node-cron supports 6-field format)
    if (intervalMs < 60000) {
      const seconds = Math.max(1, Math.round(intervalMs / 1000));
      return `*/${seconds} * * * * *`;
    }

    // Minutes
    const minutes = intervalMs / 60000;
    if (minutes < 60) {
      const mins = Math.max(1, Math.round(minutes));
      return `*/${mins} * * * *`;
    }

    // Hours or more
    const hours = Math.max(1, Math.round(minutes / 60));
    return `0 */${hours} * * *`;
  }

  /**
   * Initialize the aggregator and start scheduled fetching
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    logger.info('Initializing aggregator service');

    // Step 1: Initialize geocache (loads cached geocoded addresses from Redis)
    await geocache.initialize();
    const geoStats = geocache.getStats();
    logger.info(`Geocache initialized with ${geoStats.memorySize} cached addresses`);

    // Step 2: Load cached incidents from Redis (instant data for clients)
    await this.loadCachedIncidents();

    // Step 3: Schedule all fetchers
    this.scheduleAllFetchers();

    // Step 4: Start fetching fresh data (non-blocking for faster startup)
    this.initialized = true;
    logger.info('Aggregator service initialized - fetching fresh data in background');
    
    // Fetch fresh data without blocking
    this.fetchAll().catch(err => {
      logger.warn('Background fetch error:', { error: err });
    });
  }

  /**
   * Load cached incidents from Redis for instant startup
   */
  private async loadCachedIncidents(): Promise<void> {
    try {
      const cached = await cache.get<Incident[]>(INCIDENTS_CACHE_KEY);
      
      if (cached && Array.isArray(cached) && cached.length > 0) {
        const now = Date.now();
        const twentyFourHoursAgo = now - (24 * 60 * 60 * 1000);
        
        let loadedCount = 0;
        for (const incident of cached) {
          // Only load incidents from the last 24 hours
          const incidentTime = new Date(incident.timestamp).getTime();
          if (incidentTime >= twentyFourHoursAgo && incident.status === 'active') {
            this.incidents.set(incident.id, incident);
            database.upsertIncident(incident);
            loadedCount++;
          }
        }
        
        logger.info(`Loaded ${loadedCount} cached incidents from Redis (${cached.length} total in cache)`);
      } else {
        logger.debug('No cached incidents found in Redis');
      }
    } catch (error) {
      logger.warn('Failed to load cached incidents:', { error });
    }
  }

  /**
   * Persist current incidents to Redis
   */
  private async persistIncidents(): Promise<void> {
    try {
      const incidents = Array.from(this.incidents.values());
      await cache.set(INCIDENTS_CACHE_KEY, incidents, INCIDENTS_CACHE_TTL);
    } catch (error) {
      logger.warn('Failed to persist incidents to Redis:', { error });
    }
  }

  private scheduleAllFetchers(): void {
    // Periodic cleanup of stale incidents (every 10 minutes)
    scheduler.schedule('incident-cleanup', '*/10 * * * *', async () => {
      this.cleanupStaleIncidents();
    }, false);

    // Weather alerts (NWS)
    const cronWeather = this.buildCronExpression(config.pollIntervals.weather, '*/2 * * * *');
    scheduler.schedule('weather', cronWeather, async () => {
      await this.fetchWeather();
    }, false);

    // Current weather conditions (Open-Meteo) - every 5 minutes
    scheduler.schedule('current-weather', '*/5 * * * *', async () => {
      await this.fetchCurrentWeather();
    }, false);

    const cronCameras = this.buildCronExpression(config.pollIntervals.trafficCameras, '*/5 * * * *');
    scheduler.schedule('cameras', cronCameras, async () => {
      await this.fetchCameras();
    }, false);

    const cronTraffic = this.buildCronExpression(config.pollIntervals.trafficIncidents, '* * * * *');
    scheduler.schedule('traffic-incidents', cronTraffic, async () => {
      await this.fetchTrafficIncidents();
    }, false);

    const cronCrime = this.buildCronExpression(config.pollIntervals.crime, '*/15 * * * *');
    scheduler.schedule('crime', cronCrime, async () => {
      await this.fetchCrime();
    }, false);

    // Montgomery County, MD crime data - every 15 minutes
    scheduler.schedule('moco-crime', cronCrime, async () => {
      await this.fetchMoCoCrime();
    }, false);

    // Prince George's County, MD crime data - every 15 minutes
    scheduler.schedule('pg-crime', cronCrime, async () => {
      await this.fetchPGCrime();
    }, false);

    const cronShotspotter = this.buildCronExpression(config.pollIntervals.shotspotter, '*/5 * * * *');
    scheduler.schedule('shotspotter', cronShotspotter, async () => {
      await this.fetchShotSpotter();
    }, false);

    const cronAlertdc = this.buildCronExpression(config.pollIntervals.alertdc, '*/2 * * * *');
    scheduler.schedule('alertdc', cronAlertdc, async () => {
      await this.fetchAlertDC();
    }, false);

    if (config.wmataApiKey) {
      const cronWmata = this.buildCronExpression(config.pollIntervals.wmata, '* * * * *');
      scheduler.schedule('wmata', cronWmata, async () => {
        await this.fetchTransit();
      }, false);
    }

    const cronAqi = this.buildCronExpression(config.pollIntervals.airQuality, '*/30 * * * *');
    scheduler.schedule('airquality', cronAqi, async () => {
      await this.fetchAirQuality();
    }, false);

    // Scanner feeds (OpenMHz) - every 5 minutes
    const cronScanner = this.buildCronExpression(config.pollIntervals.scanner, '*/5 * * * *');
    scheduler.schedule('scanner', cronScanner, async () => {
      await this.fetchScanner();
    }, false);

    // DC Fire/EMS Twitter feed - every 2 minutes (if configured)
    if (process.env.TWITTER_BEARER_TOKEN) {
      scheduler.schedule('dcfireems-twitter', '*/2 * * * *', async () => {
        await this.fetchDCFireEMSTwitter();
      }, false);
    }

    // PulsePoint Fire/EMS incidents - every 2 minutes (only when clients connected)
    scheduler.schedule('pulsepoint', '*/2 * * * *', async () => {
      // Only run Puppeteer-based fetcher when frontend clients are actually connected
      if (sse.getClientCount() > 0) {
        await this.fetchPulsePoint();
      } else {
        logger.debug('Skipping PulsePoint fetch - no clients connected');
      }
    }, false);

    // Aircraft tracking (OpenSky) - every 5 seconds for near real-time updates
    // Only fetches when at least one client has aircraft enabled (saves API quota)
    // At 5s interval + ~4h daily use = ~2,880 credits/day (under 4,000 limit)
    const cronAircraft = this.buildCronExpression(config.pollIntervals.aircraft, '*/5 * * * * *');
    scheduler.schedule('aircraft', cronAircraft, async () => {
      if (sse.anyClientWantsAircraft()) {
        await this.fetchAircraft();
      } else {
        logger.debug('Skipping aircraft fetch - no clients want aircraft data');
      }
    }, false);

    // News from RSS feeds - every 5 minutes
    scheduler.schedule('news', '*/5 * * * *', async () => {
      await this.fetchNews();
    }, false);
  }

  /**
   * Fetch all data sources
   */
  async fetchAll(): Promise<void> {
    const fetchers = [
      this.fetchWeather(),
      this.fetchCurrentWeather(),
      this.fetchCameras(),
      this.fetchTrafficIncidents(),
      this.fetchCrime(),
      this.fetchMoCoCrime(),
      this.fetchPGCrime(),
      this.fetchShotSpotter(),
      this.fetchAlertDC(),
      this.fetchTransit(),
      this.fetchAirQuality(),
      this.fetchScanner(),
      this.fetchAircraft(),
      this.fetchNews(),
    ];

    // Add Twitter fetcher if configured
    if (process.env.TWITTER_BEARER_TOKEN) {
      fetchers.push(this.fetchDCFireEMSTwitter());
    }

    // Only fetch PulsePoint if clients are connected (avoids running Puppeteer at startup)
    if (sse.getClientCount() > 0) {
      fetchers.push(this.fetchPulsePoint());
    }

    await Promise.all(fetchers);
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

  private async fetchMoCoCrime(): Promise<void> {
    const result = await mocoCrimeFetcher.fetch();

    if (result.success && result.data) {
      await this.processIncidents(result.data);
    }
  }

  private async fetchPGCrime(): Promise<void> {
    const result = await pgCrimeFetcher.fetch();

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

  private async fetchCurrentWeather(): Promise<void> {
    const result = await currentWeatherFetcher.fetch();

    if (result.success && result.data && result.data.length > 0) {
      const weather = result.data[0];
      
      // Only broadcast if data changed
      if (!this.currentWeather || 
          this.currentWeather.temperature !== weather.temperature ||
          this.currentWeather.description !== weather.description) {
        this.currentWeather = weather;
        sse.broadcast('weather:current', weather);
      }
    }
  }

  private async fetchScanner(): Promise<void> {
    const result = await openMHzFetcher.fetch();

    if (result.success && result.data) {
      await this.processIncidents(result.data);
    }
  }

  private async fetchDCFireEMSTwitter(): Promise<void> {
    const result = await dcFireEMSTwitterFetcher.fetch();

    if (result.success && result.data) {
      await this.processIncidents(result.data);
    }
  }

  private async fetchPulsePoint(): Promise<void> {
    const result = await pulsePointFetcher.fetch();

    if (result.success && result.data) {
      await this.processIncidents(result.data);
    }
  }

  private async fetchAircraft(): Promise<void> {
    const result = await openskyFetcher.fetch();

    if (result.success && result.data) {
      // Replace all aircraft with new data (aircraft positions are ephemeral)
      this.aircraft.clear();
      for (const aircraft of result.data) {
        this.aircraft.set(aircraft.id, aircraft);
      }

      // Broadcast full aircraft list to all clients
      sse.broadcast('aircraft:update', {
        aircraft: result.data,
        timestamp: new Date().toISOString(),
      });
    }
  }

  private async fetchNews(): Promise<void> {
    try {
      const newsItems = await newsFetcher.fetchNews();
      
      // Update news list
      this.news = newsItems;

      // Broadcast to clients
      sse.broadcast('news:update', {
        news: newsItems,
        timestamp: new Date().toISOString(),
      });

      logger.info(`News: Updated with ${newsItems.length} items`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`News fetch failed: ${errorMessage}`);
    }
  }

  private async processIncidents(newIncidents: Incident[]): Promise<void> {
    const processedIds = new Set<string>();
    let hasChanges = false;

    for (const incident of newIncidents) {
      processedIds.add(incident.id);
      const existing = this.incidents.get(incident.id);

      if (!existing) {
        // New incident
        this.incidents.set(incident.id, incident);
        database.upsertIncident(incident);
        sse.broadcast('incident:new', incident);
        hasChanges = true;
      } else if (existing.updatedAt !== incident.updatedAt) {
        // Updated incident
        this.incidents.set(incident.id, incident);
        database.upsertIncident(incident);
        sse.broadcast('incident:update', incident);
        hasChanges = true;
      }
    }

    // Check for cleared incidents from this source
    // IMPORTANT: Don't auto-clear PulsePoint incidents - they only show a limited
    // number of active incidents, so absence doesn't mean cleared.
    // Same for crime data which shows last 24h, not necessarily all active.
    const sourcePrefix = newIncidents[0]?.source;
    const sourcesWithCompleteListing = ['mdchart', 'dc-traffic', 'wmata', 'alertdc'];
    
    if (sourcePrefix && sourcesWithCompleteListing.includes(sourcePrefix)) {
      for (const [id, incident] of this.incidents) {
        if (incident.source === sourcePrefix && !processedIds.has(id)) {
          // Incident no longer in feed - mark as cleared
          if (incident.status === 'active') {
            incident.status = 'cleared';
            incident.updatedAt = new Date().toISOString();
            database.updateIncidentStatus(id, 'cleared');
            sse.broadcast('incident:clear', { id });
            hasChanges = true;
          }
        }
      }
    }

    // Persist to Redis if there were changes (debounced)
    if (hasChanges) {
      this.persistIncidents().catch(() => {});
    }
  }

  /**
   * Clean up stale incidents that haven't been updated
   * This handles sources like PulsePoint that don't provide complete listings.
   * Default expiration is 24 hours for all incident types.
   */
  private cleanupStaleIncidents(): void {
    const now = Date.now();
    let clearedCount = 0;

    // Default 24 hours for all sources
    // Crime data gets longer retention since it's historical records
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
    
    const expirationMs: Record<string, number> = {
      // Crime data - keep for 30 days to match API fetch window
      'dc-crime': THIRTY_DAYS,
      'moco-crime': THIRTY_DAYS,
      'pg-crime': THIRTY_DAYS,
      // Everything else - 24 hours (including pulsepoint, shotspotter, scanner, etc.)
      'default': TWENTY_FOUR_HOURS,
    };

    for (const [id, incident] of this.incidents) {
      if (incident.status !== 'active') continue;

      const incidentAge = now - new Date(incident.timestamp).getTime();
      const maxAge = expirationMs[incident.source] || expirationMs['default'];

      if (incidentAge > maxAge) {
        incident.status = 'cleared';
        incident.updatedAt = new Date().toISOString();
        database.updateIncidentStatus(id, 'cleared');
        sse.broadcast('incident:clear', { id });
        clearedCount++;
      }
    }

    if (clearedCount > 0) {
      logger.info(`Cleaned up ${clearedCount} stale incidents`);
      this.persistIncidents().catch(() => {});
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
      currentWeather: this.currentWeather,
      aircraft: Array.from(this.aircraft.values()),
    };
  }

  /**
   * Get current weather conditions
   */
  getCurrentWeather(): CurrentWeather | null {
    return this.currentWeather;
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
   * Get aircraft data
   */
  getAircraft(): Aircraft[] {
    return Array.from(this.aircraft.values());
  }

  /**
   * Get news items
   */
  getNews(): NewsItem[] {
    return this.news;
  }

  /**
   * Find news items related to an incident
   */
  findRelatedNews(incidentTitle: string, incidentAddress?: string, incidentType?: string): NewsItem[] {
    return newsFetcher.findRelatedNews(this.news, incidentTitle, incidentAddress, incidentType);
  }

  /**
   * Shutdown the aggregator
   */
  async shutdown(): Promise<void> {
    scheduler.shutdown();
    await pulsePointFetcher.shutdown();
    logger.info('Aggregator service shut down');
  }
}

export const aggregator = new AggregatorService();
export default aggregator;
