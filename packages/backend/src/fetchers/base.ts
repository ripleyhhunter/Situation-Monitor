import type { FetcherResult, DataSource } from '../types/index.js';
import cache from '../services/cache.js';
import logger from '../logger.js';

export abstract class BaseFetcher<T> {
  protected name: string;
  protected cacheTtl: number;

  /**
   * The DataSource this fetcher's incidents are stamped with, declared by
   * fetchers whose feed is a complete snapshot (region packs list these in
   * sourcesWithCompleteListing). Lets the aggregator cross-clear that
   * source's incidents even when a successful poll returns zero items.
   */
  readonly incidentSource?: DataSource;

  constructor(name: string, cacheTtl: number) {
    this.name = name;
    this.cacheTtl = cacheTtl;
  }

  /**
   * Fetch data from the external API
   * Subclasses must implement this method
   */
  protected abstract fetchFromApi(): Promise<T[]>;

  /**
   * Get the cache key for this fetcher
   */
  protected getCacheKey(): string {
    return `fetcher:${this.name}`;
  }

  /**
   * Fetch data, using cache if available
   */
  async fetch(forceRefresh = false): Promise<FetcherResult<T>> {
    const cacheKey = this.getCacheKey();
    const timestamp = new Date().toISOString();

    // Check cache first (unless forced refresh)
    if (!forceRefresh) {
      const cached = await cache.get<T[]>(cacheKey);
      if (cached) {
        logger.debug(`${this.name}: Returning cached data`, { count: cached.length });
        return {
          success: true,
          data: cached,
          timestamp,
        };
      }
    }

    // Fetch from API
    try {
      logger.debug(`${this.name}: Fetching from API`);
      const data = await this.fetchFromApi();

      // Cache the result
      await cache.set(cacheKey, data, this.cacheTtl);

      logger.info(`${this.name}: Fetched ${data.length} items`);
      return {
        success: true,
        data,
        timestamp,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`${this.name}: Fetch failed`, { error: errorMessage });

      // Try to return stale cache data on error
      const staleData = await cache.get<T[]>(cacheKey);
      if (staleData) {
        logger.warn(`${this.name}: Returning stale cached data due to error`);
        return {
          success: false,
          data: staleData,
          error: errorMessage,
          timestamp,
        };
      }

      return {
        success: false,
        error: errorMessage,
        timestamp,
      };
    }
  }

  /**
   * Helper method for making HTTP requests with timeout and retry
   */
  protected async httpGet<R>(
    url: string,
    options: {
      headers?: Record<string, string>;
      timeout?: number;
      retries?: number;
    } = {}
  ): Promise<R> {
    const { headers = {}, timeout = 30000, retries = 2 } = options;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(url, {
          headers: {
            Accept: 'application/json',
            'User-Agent': 'SituationMonitor/1.0',
            ...headers,
          },
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return (await response.json()) as R;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < retries) {
          // Exponential backoff
          const delay = Math.min(1000 * Math.pow(2, attempt), 5000);
          logger.debug(`${this.name}: Retry ${attempt + 1}/${retries} in ${delay}ms`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError || new Error('Unknown fetch error');
  }
}
