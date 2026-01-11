import { Router } from 'express';
import { sse } from '../services/sse.js';
import { aggregator } from '../services/aggregator.js';
import logger from '../logger.js';

const router = Router();

router.get('/', (req, res) => {
  logger.debug('New SSE connection request');

  // Add this client to SSE service
  const clientId = sse.addClient(res);

  // Send initial data dump to catch up the client
  const data = aggregator.getAll();

  // Send all current incidents
  for (const incident of data.incidents) {
    res.write(`event: incident:new\n`);
    res.write(`data: ${JSON.stringify({ type: 'incident:new', data: incident, timestamp: new Date().toISOString() })}\n\n`);
  }

  // Send all cameras
  for (const camera of data.cameras) {
    res.write(`event: camera:update\n`);
    res.write(`data: ${JSON.stringify({ type: 'camera:update', data: camera, timestamp: new Date().toISOString() })}\n\n`);
  }

  // Send weather alerts
  for (const alert of data.weather) {
    res.write(`event: weather:alert\n`);
    res.write(`data: ${JSON.stringify({ type: 'weather:alert', data: alert, timestamp: new Date().toISOString() })}\n\n`);
  }

  // Send air quality
  for (const aqi of data.airQuality) {
    res.write(`event: aqi:update\n`);
    res.write(`data: ${JSON.stringify({ type: 'aqi:update', data: aqi, timestamp: new Date().toISOString() })}\n\n`);
  }

  logger.info('Initial data sent to SSE client', { clientId, incidents: data.incidents.length, cameras: data.cameras.length });
});

export default router;
