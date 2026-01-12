import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should load default configuration', async () => {
    // Clear environment to test defaults
    delete process.env.NODE_ENV;
    delete process.env.PORT;
    delete process.env.REDIS_URL;

    const { config } = await import('./config.js');

    expect(config.nodeEnv).toBe('development');
    expect(config.port).toBe(3000);
    expect(config.redisUrl).toBe('redis://localhost:6379');
    expect(config.defaultLat).toBe(38.9072);
    expect(config.defaultLng).toBe(-77.0369);
  });

  it('should have correct polling interval defaults', async () => {
    const { config } = await import('./config.js');

    expect(config.pollIntervals.trafficCameras).toBe(5 * 60 * 1000);
    expect(config.pollIntervals.trafficIncidents).toBe(60 * 1000);
    expect(config.pollIntervals.crime).toBe(15 * 60 * 1000);
    expect(config.pollIntervals.weather).toBe(2 * 60 * 1000);
    expect(config.pollIntervals.wmata).toBe(30 * 1000);
    expect(config.pollIntervals.scanner).toBe(5 * 60 * 1000);
  });

  it('should have correct cache TTL defaults', async () => {
    const { config } = await import('./config.js');

    expect(config.cacheTtl.trafficCameras).toBe(300);
    expect(config.cacheTtl.trafficIncidents).toBe(30);
    expect(config.cacheTtl.weather).toBe(60);
    expect(config.cacheTtl.scanner).toBe(60);
  });

  it('should parse environment variables correctly', async () => {
    process.env.NODE_ENV = 'production';
    process.env.PORT = '8080';
    process.env.WMATA_API_KEY = 'test-wmata-key';
    process.env.AIRNOW_API_KEY = 'test-airnow-key';
    process.env.CORS_ORIGINS = 'https://example.com';

    const { config } = await import('./config.js');

    expect(config.nodeEnv).toBe('production');
    expect(config.port).toBe(8080);
    expect(config.wmataApiKey).toBe('test-wmata-key');
    expect(config.airnowApiKey).toBe('test-airnow-key');
    expect(config.corsOrigins).toBe('https://example.com');
  });

  it('should parse coordinate environment variables', async () => {
    process.env.PUBLIC_DEFAULT_LAT = '39.0';
    process.env.PUBLIC_DEFAULT_LNG = '-76.0';

    const { config } = await import('./config.js');

    expect(config.defaultLat).toBe(39.0);
    expect(config.defaultLng).toBe(-76.0);
  });
});
