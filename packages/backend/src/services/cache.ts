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

  constructor() {
    // Every set() writes the memory tier (even with Redis connected), and
    // reads only prune lazily — without a sweep, expired entries accumulate
    // for the lifetime of the process. unref() so the timer never keeps the
    // process alive.
    setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.memoryCache) {
        if (entry.expiry <= now) {
          this.memoryCache.delete(key);
        }
      }
    }, 60000).unref();
  }

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

  /**
   * Atomically increment a counter with a fixed expiry window: the TTL is
   * set when the key is created and NOT refreshed on later increments, so a
   * steady stream of hits can never keep a window alive forever.
   * Returns the post-increment count.
   */
  async increment(key: string, ttlSeconds: number): Promise<number> {
    try {
      if (this.redis && this.connected) {
        const count = await withTimeout<number>(this.redis.incr(key), this.commandTimeout);
        // Set the window TTL when missing (ttl === -1: key exists, no
        // expiry). Self-healing on every hit, and unlike EXPIRE ... NX it
        // works on Redis < 7 — a swallowed NX error there would leave an
        // immortal counter that permanently 429s the client.
        const ttl = await withTimeout<number>(this.redis.ttl(key), this.commandTimeout).catch(() => 0);
        if (ttl === -1) {
          await withTimeout(this.redis.expire(key, ttlSeconds), this.commandTimeout).catch(() => {});
        }
        return count;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.debug('Cache increment falling back to memory', { key, error: errorMessage });
    }

    // Memory fallback: fixed window — keep the original expiry.
    const cached = this.memoryCache.get(key);
    if (cached && cached.expiry > Date.now()) {
      const next = (parseInt(cached.data, 10) || 0) + 1;
      cached.data = String(next);
      return next;
    }
    this.memoryCache.set(key, { data: '1', expiry: Date.now() + ttlSeconds * 1000 });
    return 1;
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
