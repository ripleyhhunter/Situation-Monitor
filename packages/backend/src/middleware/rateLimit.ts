import type { Request, Response, NextFunction } from 'express';
import cache from '../services/cache.js';
import logger from '../logger.js';

interface RateLimitConfig {
  windowMs: number;      // Time window in milliseconds
  maxRequests: number;   // Maximum requests per window
  keyPrefix?: string;    // Optional prefix for rate limit keys
}

const defaultConfig: RateLimitConfig = {
  windowMs: 60 * 1000,   // 1 minute
  maxRequests: 100,      // 100 requests per minute
  keyPrefix: 'ratelimit',
};

// Helper to add timeout to async operations
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), timeoutMs)),
  ]);
}

export function createRateLimiter(config: Partial<RateLimitConfig> = {}) {
  const { windowMs, maxRequests, keyPrefix } = { ...defaultConfig, ...config };

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Behind cloudflared every visitor's req.ip is 127.0.0.1 (one shared
    // bucket for the whole world) — prefer the tunnel-provided client IP,
    // but ONLY when the request actually arrived via the local tunnel
    // process. Honoring the header from arbitrary peers would let a direct
    // client mint a fresh bucket per request (bypass) or 429 a victim's key.
    const peer = req.socket?.remoteAddress || '';
    const peerIsLocal = peer === '127.0.0.1' || peer === '::1' || peer === '::ffff:127.0.0.1';
    const cfIp = req.headers['cf-connecting-ip'];
    const clientId =
      (peerIsLocal && typeof cfIp === 'string' && cfIp) || req.ip || 'unknown';
    const key = `${keyPrefix}:${clientId}`;

    try {
      // Atomic fixed-window counter. The old read-then-set undercounted
      // bursts AND re-armed the TTL on every hit, so a steady slow client
      // (1 req/40s) eventually accumulated to the limit and got 429'd.
      const count = await withTimeout<number | null>(
        cache.increment(key, Math.ceil(windowMs / 1000)),
        500, // 500ms budget — fail open if the cache is slow
        null
      );

      if (count === null) {
        next();
        return;
      }

      if (count > maxRequests) {
        logger.warn('Rate limit exceeded', { clientId, count, maxRequests });
        res.status(429).json({
          error: {
            message: 'Too many requests, please try again later',
            code: 'RATE_LIMIT_EXCEEDED',
            retryAfter: Math.ceil(windowMs / 1000),
          },
        });
        return;
      }

      // Add rate limit headers
      res.setHeader('X-RateLimit-Limit', maxRequests);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - count));

      next();
    } catch (error) {
      // If rate limiting fails, allow the request (fail open)
      logger.error('Rate limit check failed', { error });
      next();
    }
  };
}

// Default rate limiter for API routes
export const apiRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 100,
  keyPrefix: 'api',
});

// Stricter rate limiter for SSE connections
export const sseRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 10,
  keyPrefix: 'sse',
});

export default apiRateLimiter;
