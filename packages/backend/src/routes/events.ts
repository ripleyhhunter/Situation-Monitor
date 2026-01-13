import { Router } from 'express';
import { sse } from '../services/sse.js';
import { aggregator } from '../services/aggregator.js';
import logger from '../logger.js';

const router = Router();

// SSE connection endpoint
router.get('/', (req, res) => {
  logger.debug('New SSE connection request');

  // Check if client is requesting aircraft data (default true for backwards compatibility)
  const wantsAircraft = req.query.aircraft !== 'false';

  // Add this client to SSE service
  const clientId = sse.addClient(res);

  // Update initial preferences based on query params
  sse.updateClientPreferences(clientId, { wantsAircraft });

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

  // Send current weather conditions
  if (data.currentWeather) {
    res.write(`event: weather:current\n`);
    res.write(`data: ${JSON.stringify({ type: 'weather:current', data: data.currentWeather, timestamp: new Date().toISOString() })}\n\n`);
  }

  // Send aircraft data
  if (data.aircraft && data.aircraft.length > 0) {
    res.write(`event: aircraft:update\n`);
    res.write(`data: ${JSON.stringify({ 
      type: 'aircraft:update', 
      data: { aircraft: data.aircraft, timestamp: new Date().toISOString() }, 
      timestamp: new Date().toISOString() 
    })}\n\n`);
  }

  logger.info('Initial data sent to SSE client', { 
    clientId, 
    incidents: data.incidents.length, 
    cameras: data.cameras.length,
    weatherAlerts: data.weather.length,
    hasCurrentWeather: !!data.currentWeather,
    aircraft: data.aircraft?.length || 0,
    wantsAircraft
  });
});

// Update client preferences endpoint
router.post('/preferences', (req, res) => {
  const { clientId, wantsAircraft } = req.body;

  if (!clientId) {
    return res.status(400).json({ error: 'clientId is required' });
  }

  const success = sse.updateClientPreferences(clientId, {
    wantsAircraft: wantsAircraft ?? true,
  });

  if (!success) {
    return res.status(404).json({ error: 'Client not found' });
  }

  logger.debug('Client preferences updated via API', { 
    clientId, 
    wantsAircraft,
    aircraftClients: sse.getAircraftClientCount(),
    totalClients: sse.getClientCount()
  });

  return res.json({ 
    success: true, 
    aircraftFetchingActive: sse.anyClientWantsAircraft() 
  });
});

export default router;
