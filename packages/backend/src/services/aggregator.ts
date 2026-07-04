import type {
  Incident,
  Camera,
  WeatherAlert,
  AirQuality,
  CurrentWeather,
  Aircraft,
  NewsItem,
  RegionId,
  DataSource,
  ScannerCall,
} from '../types/index.js';
import type { RegionPack } from '../regions/types.js';
import { allRegions } from '../regions/index.js';
import { scheduler } from './scheduler.js';
import { sse } from './sse.js';
import { database } from './database.js';
import { history } from './history.js';
import { cache } from './cache.js';
import { geocache } from './geocache.js';
import config from '../config.js';
import logger from '../logger.js';

const INCIDENTS_CACHE_TTL = 24 * 60 * 60; // 24 hours

function cacheKeyForRegion(regionId: RegionId): string {
  return `incidents:active:${regionId}`;
}

interface RegionState {
  incidents: Map<string, Incident>;
  cameras: Map<string, Camera>;
  weatherAlerts: Map<string, WeatherAlert>;
  airQuality: AirQuality[];
  currentWeather: CurrentWeather | null;
  aircraft: Map<string, Aircraft>;
  news: NewsItem[];
  scannerCalls: ScannerCall[];
}

interface AggregatedData {
  incidents: Incident[];
  cameras: Camera[];
  weather: WeatherAlert[];
  airQuality: AirQuality[];
  /** Map of regionId → current weather. Frontend picks the entry for its selected region. */
  currentWeather: Record<RegionId, CurrentWeather | null>;
  aircraft: Aircraft[];
  news: NewsItem[];
}

class AggregatorService {
  private state = new Map<RegionId, RegionState>();
  private initialized = false;

  // When the aggregator FIRST saw an incident as non-active. Cleared
  // retention must be measured from this moment: feeds like PulsePoint and
  // DC 311 deliver already-cleared items whose feed-derived updatedAt is
  // hours old — measuring retention against updatedAt deleted them
  // instantly, and the next poll re-added them (a delete/re-add loop).
  private clearedObservedAt = new Map<string, number>();

  constructor() {
    for (const region of allRegions) {
      this.state.set(region.id, this.emptyState());
    }
  }

  private emptyState(): RegionState {
    return {
      incidents: new Map(),
      cameras: new Map(),
      weatherAlerts: new Map(),
      airQuality: [],
      currentWeather: null,
      aircraft: new Map(),
      news: [],
      scannerCalls: [],
    };
  }

  private getState(regionId: RegionId): RegionState {
    let s = this.state.get(regionId);
    if (!s) {
      s = this.emptyState();
      this.state.set(regionId, s);
    }
    return s;
  }

  private buildCronExpression(intervalMs: number, defaultExpression: string): string {
    if (!intervalMs || intervalMs <= 0 || Number.isNaN(intervalMs)) return defaultExpression;
    if (intervalMs < 60000) {
      const seconds = Math.max(1, Math.round(intervalMs / 1000));
      return `*/${seconds} * * * * *`;
    }
    const minutes = intervalMs / 60000;
    if (minutes < 60) {
      const mins = Math.max(1, Math.round(minutes));
      return `*/${mins} * * * *`;
    }
    const hours = Math.max(1, Math.round(minutes / 60));
    return `0 */${hours} * * *`;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    logger.info('Initializing aggregator service');

    history.initialize();

    await geocache.initialize();
    const geoStats = geocache.getStats();
    logger.info(`Geocache initialized with ${geoStats.memorySize} cached addresses`);

    for (const region of allRegions) {
      await this.loadCachedIncidents(region.id);
    }

    this.scheduleAllFetchers();

    this.initialized = true;
    logger.info('Aggregator service initialized - fetching fresh data in background');

    this.fetchAll().catch(err => {
      logger.warn('Background fetch error:', { error: err });
    });
  }

  private async loadCachedIncidents(regionId: RegionId): Promise<void> {
    try {
      const cached = await cache.get<Incident[]>(cacheKeyForRegion(regionId));

      if (cached && Array.isArray(cached) && cached.length > 0) {
        const now = Date.now();
        const twentyFourHoursAgo = now - (24 * 60 * 60 * 1000);
        const state = this.getState(regionId);

        let loadedCount = 0;
        for (const incident of cached) {
          const incidentTime = new Date(incident.timestamp).getTime();
          if (incidentTime >= twentyFourHoursAgo && incident.status === 'active') {
            // Defensive: ensure regionId is set on legacy cache entries
            if (!incident.regionId) incident.regionId = regionId;
            state.incidents.set(incident.id, incident);
            database.upsertIncident(incident);
            loadedCount++;
          }
        }

        logger.info(`Loaded ${loadedCount} cached incidents from Redis for ${regionId} (${cached.length} total in cache)`);
        return;
      }
      logger.debug(`No cached incidents in Redis for ${regionId}`);
    } catch (error) {
      logger.warn(`Failed to load cached incidents for ${regionId}:`, { error });
    }

    // Redis snapshot unavailable (it's optional) — restore from the durable
    // SQLite history instead so a restart doesn't blank the dashboard.
    const state = this.getState(regionId);
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const restored = history.getRecentActive(regionId, since);
    for (const incident of restored) {
      state.incidents.set(incident.id, incident);
      database.upsertIncident(incident);
    }
    if (restored.length > 0) {
      logger.info(`Restored ${restored.length} active incidents from SQLite history for ${regionId}`);
    }
  }

  private async persistIncidents(regionId: RegionId): Promise<void> {
    try {
      // Only actives are ever restored on startup, so persisting cleared
      // incidents would just grow the payload re-serialized on every change.
      const incidents = Array.from(this.getState(regionId).incidents.values())
        .filter(i => i.status === 'active');
      await cache.set(cacheKeyForRegion(regionId), incidents, INCIDENTS_CACHE_TTL);
    } catch (error) {
      logger.warn(`Failed to persist incidents to Redis for ${regionId}:`, { error });
    }
  }

  private scheduleAllFetchers(): void {
    // One global cleanup task — sweeps all regions.
    scheduler.schedule('incident-cleanup', '*/10 * * * *', async () => {
      this.cleanupStaleIncidents();
    }, false);

    for (const region of allRegions) {
      this.scheduleRegionFetchers(region);
    }
  }

  private scheduleRegionFetchers(region: RegionPack): void {
    const tag = region.id;

    const cronWeather = this.buildCronExpression(config.pollIntervals.weather, '*/2 * * * *');
    scheduler.schedule(`weather-${tag}`, cronWeather, () => this.fetchWeather(region), false);

    scheduler.schedule(`current-weather-${tag}`, '*/5 * * * *', () => this.fetchCurrentWeather(region), false);

    if (region.cameraFetchers.length > 0) {
      const cronCameras = this.buildCronExpression(config.pollIntervals.trafficCameras, '*/5 * * * *');
      scheduler.schedule(`cameras-${tag}`, cronCameras, () => this.fetchCameras(region), false);
    }

    if (region.trafficIncidentFetchers.length > 0) {
      const cronTraffic = this.buildCronExpression(config.pollIntervals.trafficIncidents, '* * * * *');
      scheduler.schedule(`traffic-incidents-${tag}`, cronTraffic, () => this.fetchTrafficIncidents(region), false);
    }

    if (region.crimeFetchers.length > 0) {
      const cronCrime = this.buildCronExpression(config.pollIntervals.crime, '*/15 * * * *');
      scheduler.schedule(`crime-${tag}`, cronCrime, () => this.fetchCrime(region), false);
    }

    if (region.shotspotterFetchers.length > 0) {
      const cronShotspotter = this.buildCronExpression(config.pollIntervals.shotspotter, '*/5 * * * *');
      scheduler.schedule(`shotspotter-${tag}`, cronShotspotter, () => this.fetchShotSpotter(region), false);
    }

    if (region.emergencyAlertFetchers.length > 0) {
      const cronAlerts = this.buildCronExpression(config.pollIntervals.alertdc, '*/2 * * * *');
      scheduler.schedule(`emergency-alerts-${tag}`, cronAlerts, () => this.fetchEmergencyAlerts(region), false);
    }

    if (region.transitFetcher && config.wmataApiKey) {
      const cronTransit = this.buildCronExpression(config.pollIntervals.wmata, '* * * * *');
      scheduler.schedule(`transit-${tag}`, cronTransit, () => this.fetchTransit(region), false);
    }

    const cronAqi = this.buildCronExpression(config.pollIntervals.airQuality, '*/30 * * * *');
    scheduler.schedule(`airquality-${tag}`, cronAqi, () => this.fetchAirQuality(region), false);

    if (region.scannerFetcher) {
      const cronScanner = this.buildCronExpression(config.pollIntervals.scanner, '*/5 * * * *');
      scheduler.schedule(`scanner-${tag}`, cronScanner, () => this.fetchScanner(region), false);
    }

    if (region.twitterFetcher && process.env.TWITTER_BEARER_TOKEN) {
      scheduler.schedule(`twitter-${tag}`, '*/2 * * * *', () => this.fetchTwitter(region), false);
    }

    if (region.pulsePointFetcher) {
      scheduler.schedule(`pulsepoint-${tag}`, '*/2 * * * *', async () => {
        if (sse.getClientCount() > 0) {
          await this.fetchPulsePoint(region);
        } else {
          logger.debug(`Skipping PulsePoint (${tag}) - no clients connected`);
        }
      }, false);
    }

    const cronAircraft = this.buildCronExpression(config.pollIntervals.aircraft, '*/5 * * * * *');
    scheduler.schedule(`aircraft-${tag}`, cronAircraft, async () => {
      if (sse.anyClientWantsAircraftFor(region.id)) {
        await this.fetchAircraft(region);
      } else {
        // Drop frozen positions once polling stops — otherwise the connect
        // snapshot serves aircraft where they were hours ago.
        const state = this.getState(region.id);
        if (state.aircraft.size > 0) {
          state.aircraft.clear();
          sse.broadcast('aircraft:update', {
            regionId: region.id,
            aircraft: [],
            timestamp: new Date().toISOString(),
          });
        }
        logger.debug(`Skipping aircraft (${tag}) - no clients want aircraft data for this region`);
      }
    }, false);

    scheduler.schedule(`news-${tag}`, '*/5 * * * *', () => this.fetchNews(region), false);
  }

  async fetchAll(): Promise<void> {
    const tasks: Promise<void>[] = [];
    for (const region of allRegions) {
      tasks.push(this.fetchWeather(region));
      tasks.push(this.fetchCurrentWeather(region));
      tasks.push(this.fetchAirQuality(region));
      tasks.push(this.fetchNews(region));
      if (region.cameraFetchers.length > 0) tasks.push(this.fetchCameras(region));
      if (region.trafficIncidentFetchers.length > 0) tasks.push(this.fetchTrafficIncidents(region));
      if (region.crimeFetchers.length > 0) tasks.push(this.fetchCrime(region));
      if (region.shotspotterFetchers.length > 0) tasks.push(this.fetchShotSpotter(region));
      if (region.emergencyAlertFetchers.length > 0) tasks.push(this.fetchEmergencyAlerts(region));
      if (region.transitFetcher && config.wmataApiKey) tasks.push(this.fetchTransit(region));
      if (region.scannerFetcher) tasks.push(this.fetchScanner(region));
      if (region.twitterFetcher && process.env.TWITTER_BEARER_TOKEN) tasks.push(this.fetchTwitter(region));
      if (region.pulsePointFetcher && sse.getClientCount() > 0) tasks.push(this.fetchPulsePoint(region));
      // Skip aircraft on startup — it's gated on client preference at cron time.
    }
    await Promise.all(tasks);
  }

  // ---------- per-region fetch methods ----------

  private async fetchWeather(region: RegionPack): Promise<void> {
    const result = await region.weatherAlertFetcher.fetch();
    if (!(result.success && result.data)) return;

    const state = this.getState(region.id);
    const previousIds = new Set(state.weatherAlerts.keys());

    for (const alert of result.data) {
      const existing = state.weatherAlerts.get(alert.id);
      if (!existing) {
        state.weatherAlerts.set(alert.id, alert);
        database.upsertWeatherAlert(alert);
        sse.broadcast('weather:alert', alert);
      } else if (JSON.stringify(existing) !== JSON.stringify(alert)) {
        state.weatherAlerts.set(alert.id, alert);
        database.upsertWeatherAlert(alert);
        sse.broadcast('weather:alert', alert);
      }
      previousIds.delete(alert.id);
    }

    for (const id of previousIds) {
      state.weatherAlerts.delete(id);
      sse.broadcast('weather:clear', { id, regionId: region.id });
    }
  }

  private async fetchCameras(region: RegionPack): Promise<void> {
    const results = await Promise.all(region.cameraFetchers.map(f => f.fetch()));
    const allCameras: Camera[] = [];
    for (const result of results) {
      if (result.success && result.data) allCameras.push(...result.data);
    }

    const state = this.getState(region.id);
    const changed: Camera[] = [];
    for (const camera of allCameras) {
      const existing = state.cameras.get(camera.id);
      // Content comparison, not just lastUpdated: roster stamps are stable
      // per process, but mdchart names/positions/stream URLs do drift and
      // must still propagate.
      if (
        !existing ||
        existing.lastUpdated !== camera.lastUpdated ||
        existing.name !== camera.name ||
        existing.streamUrl !== camera.streamUrl ||
        existing.imageUrl !== camera.imageUrl ||
        existing.location.lat !== camera.location.lat ||
        existing.location.lng !== camera.location.lng
      ) {
        state.cameras.set(camera.id, camera);
        database.upsertCamera(camera);
        changed.push(camera);
      }
    }
    sse.broadcastCameraChanges(changed);
  }

  private async fetchTrafficIncidents(region: RegionPack): Promise<void> {
    const results = await Promise.all(region.trafficIncidentFetchers.map(f => f.fetch()));
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.success && result.data) {
        await this.processIncidents(region, result.data, region.trafficIncidentFetchers[i].incidentSource);
      }
    }
  }

  private async fetchCrime(region: RegionPack): Promise<void> {
    const results = await Promise.all(region.crimeFetchers.map(f => f.fetch()));
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.success && result.data) {
        await this.processIncidents(region, result.data, region.crimeFetchers[i].incidentSource);
      }
    }
  }

  private async fetchShotSpotter(region: RegionPack): Promise<void> {
    const results = await Promise.all(region.shotspotterFetchers.map(f => f.fetch()));
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.success && result.data) {
        await this.processIncidents(region, result.data, region.shotspotterFetchers[i].incidentSource);
      }
    }
  }

  private async fetchEmergencyAlerts(region: RegionPack): Promise<void> {
    const results = await Promise.all(region.emergencyAlertFetchers.map(f => f.fetch()));
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.success && result.data) {
        await this.processIncidents(region, result.data, region.emergencyAlertFetchers[i].incidentSource);
      }
    }
  }

  private async fetchTransit(region: RegionPack): Promise<void> {
    if (!region.transitFetcher) return;
    const result = await region.transitFetcher.fetch();
    if (result.success && result.data) {
      await this.processIncidents(region, result.data, region.transitFetcher.incidentSource);
    }
  }

  private async fetchAirQuality(region: RegionPack): Promise<void> {
    const result = await region.airQualityFetcher.fetch();
    if (result.success && result.data) {
      const state = this.getState(region.id);
      state.airQuality = result.data;
      for (const aqi of result.data) {
        sse.broadcast('aqi:update', aqi);
      }
    }
  }

  private async fetchCurrentWeather(region: RegionPack): Promise<void> {
    const result = await region.currentWeatherFetcher.fetch();
    if (result.success && result.data && result.data.length > 0) {
      const weather = result.data[0];
      const state = this.getState(region.id);
      if (!state.currentWeather ||
          state.currentWeather.temperature !== weather.temperature ||
          state.currentWeather.description !== weather.description) {
        state.currentWeather = weather;
        sse.broadcast('weather:current', weather);
      }
    }
  }

  private async fetchScanner(region: RegionPack): Promise<void> {
    if (!region.scannerFetcher) return;
    const result = await region.scannerFetcher.fetch();
    if (result.success && result.data) {
      const state = this.getState(region.id);
      // Rebroadcast only when the newest call actually changed — the
      // 5-min cron mostly re-serves the fetcher cache.
      const newestId = result.data[0]?.id;
      const prevNewestId = state.scannerCalls[0]?.id;
      if (newestId !== prevNewestId || result.data.length !== state.scannerCalls.length) {
        state.scannerCalls = result.data;
        sse.broadcast('scanner:update', {
          regionId: region.id,
          calls: result.data,
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  private async fetchTwitter(region: RegionPack): Promise<void> {
    if (!region.twitterFetcher) return;
    const result = await region.twitterFetcher.fetch();
    if (result.success && result.data) {
      await this.processIncidents(region, result.data);
    }
  }

  private async fetchPulsePoint(region: RegionPack): Promise<void> {
    if (!region.pulsePointFetcher) return;
    const result = await region.pulsePointFetcher.fetch();
    if (result.success && result.data) {
      await this.processIncidents(region, result.data);
    }
  }

  private async fetchAircraft(region: RegionPack): Promise<void> {
    const result = await region.aircraftFetcher.fetch();
    if (result.success && result.data) {
      const state = this.getState(region.id);
      state.aircraft.clear();
      for (const aircraft of result.data) {
        state.aircraft.set(aircraft.id, aircraft);
      }
      sse.broadcast('aircraft:update', {
        regionId: region.id,
        aircraft: result.data,
        timestamp: new Date().toISOString(),
      });
    }
  }

  private async fetchNews(region: RegionPack): Promise<void> {
    try {
      const newsItems = await region.newsFetcher.fetchNews();
      const state = this.getState(region.id);
      state.news = newsItems;
      sse.broadcast('news:update', {
        regionId: region.id,
        news: newsItems,
        timestamp: new Date().toISOString(),
      });
      logger.info(`News (${region.id}): Updated with ${newsItems.length} items`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`News (${region.id}) fetch failed: ${errorMessage}`);
    }
  }

  // ---------- shared processing ----------

  private async processIncidents(
    region: RegionPack,
    newIncidents: Incident[],
    source?: DataSource,
  ): Promise<void> {
    // Without an explicit source, an empty batch carries no information —
    // with one, it may still cross-clear below (feed went from N to 0).
    if (newIncidents.length === 0 && !source) return;

    const state = this.getState(region.id);
    const processedIds = new Set<string>();
    const historyBatch: Incident[] = [];
    const added: Incident[] = [];
    const updated: Incident[] = [];
    const clearedIds: string[] = [];
    let hasChanges = false;

    for (const incident of newIncidents) {
      // Belt-and-suspenders: ensure regionId is set
      if (!incident.regionId) incident.regionId = region.id;
      processedIds.add(incident.id);
      const existing = state.incidents.get(incident.id);

      if (!existing) {
        state.incidents.set(incident.id, incident);
        database.upsertIncident(incident);
        historyBatch.push(incident);
        added.push(incident);
        hasChanges = true;
      } else if (
        existing.updatedAt !== incident.updatedAt ||
        // Corrected geocodes must propagate: pulsepoint re-resolves
        // coordinates every scrape, and a pin that moves (fallback ->
        // real geocode once the resolver recovers) leaves updatedAt
        // unchanged. Same precedent as the camera content diff.
        existing.location.lat !== incident.location.lat ||
        existing.location.lng !== incident.location.lng
      ) {
        state.incidents.set(incident.id, incident);
        database.upsertIncident(incident);
        historyBatch.push(incident);
        updated.push(incident);
        hasChanges = true;
      }
    }

    // One transaction per poll batch — per-row autocommit stalls the event
    // loop ~0.5s on a 2000-row first crime fetch.
    history.upsertMany(historyBatch);

    // Cross-clear: only for sources whose feed is a complete snapshot.
    const sourcePrefix = source ?? newIncidents[0]?.source;
    if (sourcePrefix && region.sourcesWithCompleteListing.includes(sourcePrefix)) {
      for (const [id, incident] of state.incidents) {
        if (incident.source === sourcePrefix && !processedIds.has(id)) {
          if (incident.status === 'active') {
            incident.status = 'cleared';
            incident.updatedAt = new Date().toISOString();
            database.updateIncidentStatus(id, 'cleared');
            history.markCleared(id, incident.updatedAt);
            clearedIds.push(id);
            hasChanges = true;
          }
        }
      }
    }

    // One SSE pass per poll batch (arrays for current clients, per-item for
    // older deployed frontends) instead of one broadcast per incident.
    sse.broadcastIncidentChanges(region.id, added, updated, clearedIds);

    if (hasChanges) {
      this.persistIncidents(region.id).catch(() => {});
    }
  }

  private cleanupStaleIncidents(): void {
    const now = Date.now();
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
    const SIXTY_DAYS = 60 * 24 * 60 * 60 * 1000;

    // Windows must match the fetchers' own fetch-side filters — a source
    // whose feed returns records older than its window here would clear and
    // re-add them every cycle.
    const expirationMs: Record<string, number> = {
      'dc-crime': THIRTY_DAYS,
      'moco-crime': THIRTY_DAYS,
      'pg-crime': THIRTY_DAYS,
      'bpd-crime': SIXTY_DAYS, // BPD feed lags ~1 month behind real time
      'ada-crime': THIRTY_DAYS, // matches the fetcher's 30-day window
      'dc-shotspotter': THIRTY_DAYS,
      'default': TWENTY_FOUR_HOURS,
    };

    // Cleared incidents were already broadcast as removed and nothing serves
    // them — drop them after a grace period so the Maps don't grow forever.
    const CLEARED_RETENTION_MS = 60 * 60 * 1000;

    const changedRegions = new Set<RegionId>();
    let clearedCount = 0;
    let deletedCount = 0;

    for (const [regionId, state] of this.state) {
      // Complete-snapshot sources are governed by feed presence (absence
      // implies cleared, handled in processIncidents) — age-sweeping them
      // just makes legitimately long-running items (work zones) blink.
      const completeListing = new Set(
        allRegions.find(r => r.id === regionId)?.sourcesWithCompleteListing ?? [],
      );
      const sweptIds: string[] = [];

      for (const [id, incident] of state.incidents) {
        if (incident.status !== 'active') {
          const observedAt = this.clearedObservedAt.get(id);
          if (observedAt === undefined) {
            this.clearedObservedAt.set(id, now);
            continue;
          }
          if (now - observedAt > CLEARED_RETENTION_MS) {
            state.incidents.delete(id);
            database.deleteIncident(id);
            this.clearedObservedAt.delete(id);
            deletedCount++;
            changedRegions.add(regionId);
          }
          continue;
        }
        // Reactivated after being observed cleared — reset the clock.
        this.clearedObservedAt.delete(id);

        if (completeListing.has(incident.source)) continue;

        const incidentAge = now - new Date(incident.timestamp).getTime();
        const maxAge = expirationMs[incident.source] || expirationMs['default'];

        if (incidentAge > maxAge) {
          incident.status = 'cleared';
          incident.updatedAt = new Date().toISOString();
          database.updateIncidentStatus(id, 'cleared');
          history.markCleared(id, incident.updatedAt);
          sweptIds.push(id);
          clearedCount++;
          changedRegions.add(regionId);
        }
      }

      sse.broadcastIncidentChanges(regionId, [], [], sweptIds);
    }

    if (changedRegions.size > 0) {
      logger.info(`Cleanup: cleared ${clearedCount}, deleted ${deletedCount} incidents across ${changedRegions.size} region(s)`);
      for (const regionId of changedRegions) {
        this.persistIncidents(regionId).catch(() => {});
      }
    }
  }

  // ---------- public getters ----------

  private flatten<T>(picker: (s: RegionState) => Iterable<T>, regionId?: RegionId): T[] {
    if (regionId) {
      const s = this.state.get(regionId);
      return s ? Array.from(picker(s)) : [];
    }
    const out: T[] = [];
    for (const s of this.state.values()) {
      for (const item of picker(s)) out.push(item);
    }
    return out;
  }

  getAll(regionId?: RegionId): AggregatedData {
    const currentByRegion: Record<RegionId, CurrentWeather | null> = { dc: null, boise: null };
    for (const [rid, s] of this.state) currentByRegion[rid] = s.currentWeather;

    return {
      incidents: this.flatten(s => Array.from(s.incidents.values()).filter(i => i.status === 'active'), regionId),
      cameras: this.flatten(s => s.cameras.values(), regionId),
      weather: this.flatten(s => s.weatherAlerts.values(), regionId),
      airQuality: this.flatten(s => s.airQuality, regionId),
      currentWeather: currentByRegion,
      aircraft: this.flatten(s => s.aircraft.values(), regionId),
      news: this.flatten(s => s.news, regionId),
    };
  }

  getCurrentWeather(regionId?: RegionId): CurrentWeather | null {
    if (regionId) return this.getState(regionId).currentWeather;
    // Without a region, return the first available (frontend should pass regionId).
    for (const s of this.state.values()) {
      if (s.currentWeather) return s.currentWeather;
    }
    return null;
  }

  getIncidents(regionId?: RegionId): Incident[] {
    return this.flatten(s => Array.from(s.incidents.values()).filter(i => i.status === 'active'), regionId);
  }

  getIncidentById(id: string): Incident | undefined {
    for (const s of this.state.values()) {
      const i = s.incidents.get(id);
      if (i) return i;
    }
    return undefined;
  }

  getCameras(regionId?: RegionId): Camera[] {
    return this.flatten(s => s.cameras.values(), regionId);
  }

  getCameraById(id: string): Camera | undefined {
    for (const s of this.state.values()) {
      const c = s.cameras.get(id);
      if (c) return c;
    }
    return undefined;
  }

  getWeatherAlerts(regionId?: RegionId): WeatherAlert[] {
    return this.flatten(s => s.weatherAlerts.values(), regionId);
  }

  getAirQuality(regionId?: RegionId): AirQuality[] {
    return this.flatten(s => s.airQuality, regionId);
  }

  getAircraft(regionId?: RegionId): Aircraft[] {
    return this.flatten(s => s.aircraft.values(), regionId);
  }

  getNews(regionId?: RegionId): NewsItem[] {
    return this.flatten(s => s.news, regionId);
  }

  getScannerCalls(regionId?: RegionId): ScannerCall[] {
    return this.flatten(s => s.scannerCalls, regionId);
  }

  findRelatedNews(incidentTitle: string, incidentAddress?: string, incidentType?: string, regionId?: RegionId): NewsItem[] {
    // Search within the incident's region (or default region if not specified).
    const targetRegionId = regionId || allRegions[0]?.id;
    const region = allRegions.find(r => r.id === targetRegionId);
    if (!region) return [];
    return region.newsFetcher.findRelatedNews(
      this.getState(region.id).news,
      incidentTitle,
      incidentAddress,
      incidentType,
    );
  }

  async shutdown(): Promise<void> {
    scheduler.shutdown();
    // Shut down each region's PulsePoint browser (if any).
    for (const region of allRegions) {
      const pp = region.pulsePointFetcher;
      if (pp && 'shutdown' in pp && typeof (pp as { shutdown?: unknown }).shutdown === 'function') {
        await (pp as { shutdown: () => Promise<void> }).shutdown().catch(() => {});
      }
    }
    history.close();
    logger.info('Aggregator service shut down');
  }
}

export const aggregator = new AggregatorService();
export default aggregator;
