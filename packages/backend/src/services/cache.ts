import Redis from 'ioredis';
import config from '../config.js';
import logger from '../logger.js';

// ioredis ESM default export typing workaround
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const RedisConstructor = Redis as any;

// Helper to add timeout to async operations
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => 
      setTimeout(() => reject(new Error('Redis operation timed out')), timeoutMs)
    ),
  ]);
}

class CacheService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private redis: any = null;
  private connected = false;
  private memoryCache = new Map<string, { data: string; expiry: number }>();
  private redisDisabled = false;
  private commandTimeout = 5000; // 5 second timeout for Redis commands

  async connect(): Promise<void> {
    try {
      // Use 127.0.0.1 instead of localhost for better Windows/Docker compatibility
      let redisUrl = config.redisUrl;
      if (redisUrl.includes('localhost')) {
        redisUrl = redisUrl.replace('localhost', '127.0.0.1');
      }

      const client = new RedisConstructor(redisUrl, {
        maxRetriesPerRequest: 3,
        retryStrategy(times: number) {
          if (times > 3) {
            return null; // Stop retrying
          }
          return Math.min(times * 200, 2000);
        },
        connectTimeout: 5000,
        commandTimeout: 5000,
      });

      // Wait for ready event with timeout
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Redis connection timeout'));
        }, 6000);

        client.once('ready', () => {
          clearTimeout(timeout);
          this.connected = true;
          this.redisDisabled = false;
          logger.info('Redis connected');
          resolve();
        });

        client.once('error', (err: Error) => {
          clearTimeout(timeout);
          reject(err);
        });
      });

      client.on('error', (_err: Error) => {
        if (this.connected && !this.redisDisabled) {
          logger.warn('Redis connection lost, using in-memory cache');
        }
        this.connected = false;
      });

      client.on('close', () => {
        this.connected = false;
      });

      client.on('reconnecting', () => {
        logger.debug('Redis reconnecting...');
      });

      client.on('ready', () => {
        if (!this.connected) {
          logger.info('Redis reconnected');
          this.connected = true;
          this.redisDisabled = false;
        }
      });

      this.redis = client;
    } catch (error) {
      if (!this.redisDisabled) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.warn(`Redis connection failed (${msg}), using in-memory cache`);
        this.redisDisabled = true;
      }
      if (this.redis) {
        try {
          this.redis.disconnect();
        } catch {
          // ignore
        }
        this.redis = null;
      }
      this.connected = false;
    }
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      if (this.redis && this.connected) {
        const data = await withTimeout<string | null>(this.redis.get(key), this.commandTimeout);
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
      // Log timeout errors at debug level to avoid spam
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      if (errorMessage.includes('timed out')) {
        logger.debug('Cache get timeout, falling back to memory cache', { key });
      } else {
        logger.error('Cache get error:', { key, error });
      }
      // Fallback to memory cache on Redis error
      const cached = this.memoryCache.get(key);
      if (cached && cached.expiry > Date.now()) {
        return JSON.parse(cached.data);
      }
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    const data = JSON.stringify(value);
    
    // Always set in memory cache first (fast path)
    this.memoryCache.set(key, {
      data,
      expiry: Date.now() + ttlSeconds * 1000,
    });

    // Then try to set in Redis (with timeout)
    try {
      if (this.redis && this.connected) {
        await withTimeout(this.redis.setex(key, ttlSeconds, data), this.commandTimeout);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      if (errorMessage.includes('timed out')) {
        logger.debug('Cache set timeout, using memory cache only', { key });
      } else {
        logger.error('Cache set error:', { key, error });
      }
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
