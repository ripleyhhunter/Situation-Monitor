import express from 'express';
import type { Server } from 'http';
import config from './config.js';
import logger from './logger.js';
import { cache } from './services/cache.js';
import { database } from './services/database.js';
import { sse } from './services/sse.js';
import { aggregator } from './services/aggregator.js';
import corsMiddleware from './middleware/cors.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { apiRateLimiter, sseRateLimiter } from './middleware/rateLimit.js';

// Routes
import healthRouter from './routes/health.js';
import eventsRouter from './routes/events.js';
import incidentsRouter from './routes/incidents.js';
import camerasRouter from './routes/cameras.js';
import weatherRouter from './routes/weather.js';
import aqiRouter from './routes/aqi.js';
import newsRouter from './routes/news.js';
import historyRouter from './routes/history.js';

const app = express();

// Declare server at module level for shutdown access
let server: Server;

// Middleware
app.use(corsMiddleware);
app.use(express.json());

// Health check (no rate limiting)
app.use('/api/health', healthRouter);

// SSE endpoint (lighter rate limiting)
app.use('/api/events', sseRateLimiter, eventsRouter);

// API routes (rate limiting with timeout fallback)
app.use('/api/incidents', apiRateLimiter, incidentsRouter);
app.use('/api/cameras', apiRateLimiter, camerasRouter);
app.use('/api/weather', apiRateLimiter, weatherRouter);
app.use('/api/aqi', apiRateLimiter, aqiRouter);
app.use('/api/news', apiRateLimiter, newsRouter);
app.use('/api/history', apiRateLimiter, historyRouter);

// 404 handler
app.use(notFoundHandler);

// Error handler
app.use(errorHandler);

// Graceful shutdown
async function shutdown(signal: string): Promise<void> {
  logger.info(`Received ${signal}, shutting down gracefully`);

  // Stop accepting new connections (server may not be assigned yet if the
  // signal arrives during startup)
  if (server) {
    server.close(() => {
      logger.info('HTTP server closed');
    });
  }

  // Cleanup services — await the aggregator so Playwright browsers actually
  // close before process.exit
  await aggregator.shutdown();
  sse.shutdown();
  database.close();
  await cache.disconnect();

  logger.info('Cleanup complete, exiting');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Start server
async function start(): Promise<void> {
  try {
    // Initialize services
    logger.info('Starting Situation Monitor backend...');

    // Connect to Redis
    await cache.connect();

    // Initialize database
    database.initialize();

    // Initialize aggregator (starts fetching data)
    await aggregator.initialize();

    // Start HTTP server
    server = app.listen(config.port, () => {
      logger.info(`Server running on port ${config.port}`, {
        env: config.nodeEnv,
        redis: cache.isConnected() ? 'connected' : 'disconnected',
      });
    });
  } catch (error) {
    logger.error('Failed to start server', { error });
    process.exit(1);
  }
}

// Export for testing
export { app };

// Start if this is the main module
start().catch((error) => {
  logger.error('Unhandled startup error', { error });
  process.exit(1);
});
