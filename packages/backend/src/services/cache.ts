import Redis from 'ioredis';
import config from '../config.js';
import logger from '../logger.js';

// ioredis ESM default export typing workaround
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const RedisConstructor = Redis as any;

class CacheService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private redis: any = null;
  private connected = false;
  private memoryCache = new Map<string, { data: string; expiry: number }>();
  private redisDisabled = false;

  async connect(): Promise<void> {
    try {
      const client = new RedisConstructor(config.redisUrl, {
        maxRetriesPerRequest: 1,
        retryStrategy(times: number) {
          // Only retry 3 times, then give up
          if (times > 3) {
            return null; // Stop retrying
          }
          return Math.min(times * 100, 1000);
        },
        lazyConnect: true,
        enableOfflineQueue: false,
        connectTimeout: 3000,
      });

      client.on('connect', () => {
        this.connected = true;
        this.redisDisabled = false;
        logger.info('Redis connected');
      });

      client.on('error', (_err: Error) => {
        if (!this.redisDisabled) {
          logger.warn('Redis unavailable, using in-memory cache');
          this.redisDisabled = true;
        }
        this.connected = false;
      });

      client.on('close', () => {
        this.connected = false;
      });

      this.redis = client;
      await client.connect();
    } catch (error) {
      if (!this.redisDisabled) {
        logger.warn('Redis connection failed, using in-memory cache');
        this.redisDisabled = true;
      }
      if (this.redis) {
        this.redis.disconnect();
        this.redis = null;
      }
    }
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      if (this.redis && this.connected) {
        const data = await this.redis.get(key);
        return data ? JSON.parse(data) : null;
      }

      // Fallback to memory cache
      const cached = this.memoryCache.get(key);
      if (cached && cached.expiry > Date.now()) {
        return JSON.parse(cached.data);
      }
      this.memoryCache.delete(key);
      return null;
    } catch (error) {
      logger.error('Cache get error:', { key, error });
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    try {
      const data = JSON.stringify(value);

      if (this.redis && this.connected) {
        await this.redis.setex(key, ttlSeconds, data);
      } else {
        // Fallback to memory cache
        this.memoryCache.set(key, {
          data,
          expiry: Date.now() + ttlSeconds * 1000,
        });
      }
    } catch (error) {
      logger.error('Cache set error:', { key, error });
    }
  }

  async del(key: string): Promise<void> {
    try {
      if (this.redis && this.connected) {
        await this.redis.del(key);
      } else {
        this.memoryCache.delete(key);
      }
    } catch (error) {
      logger.error('Cache delete error:', { key, error });
    }
  }

  async keys(pattern: string): Promise<string[]> {
    try {
      if (this.redis && this.connected) {
        return await this.redis.keys(pattern);
      }

      // Fallback: filter memory cache keys
      const regex = new RegExp(pattern.replace(/\*/g, '.*'));
      return Array.from(this.memoryCache.keys()).filter((k) => regex.test(k));
    } catch (error) {
      logger.error('Cache keys error:', { pattern, error });
      return [];
    }
  }

  async publish(channel: string, message: string): Promise<void> {
    try {
      if (this.redis && this.connected) {
        await this.redis.publish(channel, message);
      }
    } catch (error) {
      logger.error('Cache publish error:', { channel, error });
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  async disconnect(): Promise<void> {
    if (this.redis) {
      await this.redis.quit();
      this.redis = null;
      this.connected = false;
    }
  }
}

export const cache = new CacheService();
export default cache;
