import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import healthRouter from './health.js';

// Mock dependencies
vi.mock('../services/cache.js', () => ({
  cache: {
    isConnected: vi.fn(() => true),
  },
}));

vi.mock('../services/sse.js', () => ({
  sse: {
    getClientCount: vi.fn(() => 5),
  },
}));

vi.mock('../services/scheduler.js', () => ({
  scheduler: {
    getStatus: vi.fn(() => [
      { name: 'weather', lastRun: new Date() },
      { name: 'cameras', lastRun: new Date() },
    ]),
  },
}));

describe('Health Route', () => {
  let app: express.Express;

  beforeEach(() => {
    app = express();
    app.use('/api/health', healthRouter);
    vi.clearAllMocks();
  });

  describe('GET /api/health', () => {
    it('should return 200 with status ok', async () => {
      const response = await request(app).get('/api/health');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ok');
    });

    it('should include timestamp', async () => {
      const before = new Date().toISOString();
      const response = await request(app).get('/api/health');
      const after = new Date().toISOString();

      expect(response.body.timestamp).toBeDefined();
      expect(response.body.timestamp >= before).toBe(true);
      expect(response.body.timestamp <= after).toBe(true);
    });

    it('should include uptime', async () => {
      const response = await request(app).get('/api/health');

      expect(response.body.uptime).toBeDefined();
      expect(typeof response.body.uptime).toBe('number');
      expect(response.body.uptime).toBeGreaterThan(0);
    });

    it('should include redis connection status', async () => {
      const response = await request(app).get('/api/health');

      expect(response.body.redis).toBe('connected');
    });

    it('should include SSE client count', async () => {
      const response = await request(app).get('/api/health');

      expect(response.body.sseClients).toBe(5);
    });

    it('should include scheduled tasks status', async () => {
      const response = await request(app).get('/api/health');

      expect(response.body.scheduledTasks).toBeDefined();
      expect(Array.isArray(response.body.scheduledTasks)).toBe(true);
      expect(response.body.scheduledTasks.length).toBe(2);
    });

    it('should include memory usage', async () => {
      const response = await request(app).get('/api/health');

      expect(response.body.memory).toBeDefined();
      expect(response.body.memory.heapUsed).toMatch(/^\d+MB$/);
      expect(response.body.memory.heapTotal).toMatch(/^\d+MB$/);
    });
  });
});
