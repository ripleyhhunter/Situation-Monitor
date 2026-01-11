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

export function createRateLimiter(config: Partial<RateLimitConfig> = {}) {
  const { windowMs, maxRequests, keyPrefix } = { ...defaultConfig, ...config };

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Get client identifier (IP or API key)
    const clientId = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    const key = `${keyPrefix}:${clientId}`;

    try {
      // Get current count
      const current = await cache.get<number>(key) || 0;

      if (current >= maxRequests) {
        logger.warn('Rate limit exceeded', { clientId, current, maxRequests });
        res.status(429).json({
          error: {
            message: 'Too many requests, please try again later',
            code: 'RATE_LIMIT_EXCEEDED',
            retryAfter: Math.ceil(windowMs / 1000),
          },
        });
        return;
      }

      // Increment counter
      await cache.set(key, current + 1, Math.ceil(windowMs / 1000));

      // Add rate limit headers
      res.setHeader('X-RateLimit-Limit', maxRequests);
      res.setHeader('X-RateLimit-Remaining', maxRequests - current - 1);

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
