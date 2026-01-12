import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import incidentsRouter from './incidents.js';
import type { Incident } from '../types/index.js';

// Sample incident data for testing
const mockIncidents: Incident[] = [
  {
    id: 'test-1',
    type: 'traffic',
    severity: 3,
    location: { lat: 38.9, lng: -77.0, address: '100 Main St' },
    timestamp: '2024-01-01T12:00:00Z',
    updatedAt: '2024-01-01T12:00:00Z',
    source: 'dc-traffic',
    title: 'Road Closure',
    description: 'Test road closure',
    status: 'active',
    metadata: {},
  },
  {
    id: 'test-2',
    type: 'crime',
    severity: 4,
    location: { lat: 38.92, lng: -77.02, address: '200 Oak Ave' },
    timestamp: '2024-01-01T11:00:00Z',
    updatedAt: '2024-01-01T11:00:00Z',
    source: 'dc-crime',
    title: 'Robbery',
    description: 'Test robbery',
    status: 'active',
    metadata: {},
  },
  {
    id: 'test-3',
    type: 'traffic',
    severity: 2,
    location: { lat: 38.88, lng: -76.98, address: '300 Elm St' },
    timestamp: '2024-01-01T10:00:00Z',
    updatedAt: '2024-01-01T10:00:00Z',
    source: 'mdchart',
    title: 'Minor Delay',
    description: 'Test delay',
    status: 'active',
    metadata: {},
  },
];

// Mock aggregator
vi.mock('../services/aggregator.js', () => ({
  aggregator: {
    getIncidents: vi.fn(() => mockIncidents),
    getIncidentById: vi.fn((id: string) => mockIncidents.find((i) => i.id === id)),
  },
}));

describe('Incidents Route', () => {
  let app: express.Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/incidents', incidentsRouter);
    vi.clearAllMocks();
  });

  describe('GET /api/incidents', () => {
    it('should return all incidents', async () => {
      const response = await request(app).get('/api/incidents');

      expect(response.status).toBe(200);
      expect(response.body.count).toBe(3);
      expect(response.body.incidents).toHaveLength(3);
    });

    it('should filter by type', async () => {
      const response = await request(app).get('/api/incidents?type=traffic');

      expect(response.status).toBe(200);
      expect(response.body.incidents.every((i: Incident) => i.type === 'traffic')).toBe(true);
    });

    it('should filter by minimum severity', async () => {
      const response = await request(app).get('/api/incidents?minSeverity=3');

      expect(response.status).toBe(200);
      expect(response.body.incidents.every((i: Incident) => i.severity >= 3)).toBe(true);
    });

    it('should filter by geographic bounds', async () => {
      const response = await request(app).get(
        '/api/incidents?north=38.95&south=38.85&east=-76.95&west=-77.05'
      );

      expect(response.status).toBe(200);
      // All our test incidents should be within these bounds
      response.body.incidents.forEach((incident: Incident) => {
        expect(incident.location.lat).toBeLessThanOrEqual(38.95);
        expect(incident.location.lat).toBeGreaterThanOrEqual(38.85);
        expect(incident.location.lng).toBeLessThanOrEqual(-76.95);
        expect(incident.location.lng).toBeGreaterThanOrEqual(-77.05);
      });
    });

    it('should sort by timestamp descending (newest first)', async () => {
      const response = await request(app).get('/api/incidents');

      const timestamps = response.body.incidents.map((i: Incident) => new Date(i.timestamp).getTime());
      for (let i = 1; i < timestamps.length; i++) {
        expect(timestamps[i - 1]).toBeGreaterThanOrEqual(timestamps[i]);
      }
    });

    it('should respect limit parameter', async () => {
      const response = await request(app).get('/api/incidents?limit=2');

      expect(response.status).toBe(200);
      expect(response.body.incidents).toHaveLength(2);
    });
  });

  describe('GET /api/incidents/:id', () => {
    it('should return incident by ID', async () => {
      const response = await request(app).get('/api/incidents/test-1');

      expect(response.status).toBe(200);
      expect(response.body.id).toBe('test-1');
      expect(response.body.title).toBe('Road Closure');
    });

    it('should return 404 for non-existent incident', async () => {
      const response = await request(app).get('/api/incidents/non-existent');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Incident not found');
    });
  });
});
