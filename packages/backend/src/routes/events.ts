import { Router } from 'express';
import { sse, BATCH_CHUNK } from '../services/sse.js';
import { aggregator } from '../services/aggregator.js';
import { regionsById, defaultRegionId } from '../regions/index.js';
import logger from '../logger.js';
import type { Aircraft, NewsItem, RegionId, ScannerCall } from '../types/index.js';

/** Coerce an untrusted region value to a known RegionId. */
function toRegionId(value: unknown): RegionId {
  const raw = String(value ?? '').toLowerCase();
  // hasOwn, not `in`: prototype-chain keys ("constructor", "toString")
  // must not validate.
  return Object.hasOwn(regionsById, raw) ? (raw as RegionId) : defaultRegionId;
}

const router = Router();

// SSE connection endpoint
router.get('/', (req, res) => {
  logger.debug('New SSE connection request');

  // Aircraft is opt-in (saves OpenSky quota) — the frontend syncs its real
  // preference right after 'connected'; ?aircraft=true&region=<id> can seed it.
  const wantsAircraft = req.query.aircraft === 'true';
  const aircraftRegion = wantsAircraft ? toRegionId(req.query.region) : null;

  // Batch-capable clients (current frontend) get array events; without the
  // flag an older deployed frontend still gets the per-item stream.
  const supportsBatch = req.query.batch === '1';

  // Add this client to SSE service
  const clientId = sse.addClient(res, { supportsBatch });

  // Update initial preferences based on query params
  sse.updateClientPreferences(clientId, { aircraftRegion });

  // Send initial data dump to catch up the client
  const data = aggregator.getAll();

  // Send all current incidents and cameras. Batched: ~14 array events
  // instead of ~6,800 individual ones — the difference between a connect
  // snapshot the browser absorbs in one paint and a multi-second UI freeze.
  if (supportsBatch) {
    for (let i = 0; i < data.incidents.length; i += BATCH_CHUNK) {
      const chunk = data.incidents.slice(i, i + BATCH_CHUNK);
      res.write(`event: incident:batch\n`);
      res.write(`data: ${JSON.stringify({ type: 'incident:batch', data: { incidents: chunk }, timestamp: new Date().toISOString() })}\n\n`);
    }
    for (let i = 0; i < data.cameras.length; i += BATCH_CHUNK) {
      const chunk = data.cameras.slice(i, i + BATCH_CHUNK);
      res.write(`event: camera:batch\n`);
      res.write(`data: ${JSON.stringify({ type: 'camera:batch', data: { cameras: chunk }, timestamp: new Date().toISOString() })}\n\n`);
    }
  } else {
    for (const incident of data.incidents) {
      res.write(`event: incident:new\n`);
      res.write(`data: ${JSON.stringify({ type: 'incident:new', data: incident, timestamp: new Date().toISOString() })}\n\n`);
    }
    for (const camera of data.cameras) {
      res.write(`event: camera:update\n`);
      res.write(`data: ${JSON.stringify({ type: 'camera:update', data: camera, timestamp: new Date().toISOString() })}\n\n`);
    }
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

  // Send current weather per region (same shape as the periodic broadcast:
  // a single CurrentWeather object carrying its regionId)
  for (const weather of Object.values(data.currentWeather)) {
    if (weather) {
      res.write(`event: weather:current\n`);
      res.write(`data: ${JSON.stringify({ type: 'weather:current', data: weather, timestamp: new Date().toISOString() })}\n\n`);
    }
  }

  // Send news per region (same shape as the periodic broadcast)
  const newsByRegion = new Map<RegionId, NewsItem[]>();
  for (const item of data.news) {
    const list = newsByRegion.get(item.regionId) || [];
    list.push(item);
    newsByRegion.set(item.regionId, list);
  }
  for (const [regionId, news] of newsByRegion) {
    res.write(`event: news:update\n`);
    res.write(`data: ${JSON.stringify({
      type: 'news:update',
      data: { regionId, news, timestamp: new Date().toISOString() },
      timestamp: new Date().toISOString(),
    })}\n\n`);
  }

  // Send aircraft per region (same shape as the periodic broadcast)
  const aircraftByRegion = new Map<RegionId, Aircraft[]>();
  for (const aircraft of data.aircraft) {
    const list = aircraftByRegion.get(aircraft.regionId) || [];
    list.push(aircraft);
    aircraftByRegion.set(aircraft.regionId, list);
  }
  for (const [regionId, aircraft] of aircraftByRegion) {
    res.write(`event: aircraft:update\n`);
    res.write(`data: ${JSON.stringify({
      type: 'aircraft:update',
      data: { regionId, aircraft, timestamp: new Date().toISOString() },
      timestamp: new Date().toISOString(),
    })}\n\n`);
  }

  // Send scanner calls per region (same shape as the periodic broadcast)
  const scannerByRegion = new Map<RegionId, ScannerCall[]>();
  for (const call of aggregator.getScannerCalls()) {
    const list = scannerByRegion.get(call.regionId) || [];
    list.push(call);
    scannerByRegion.set(call.regionId, list);
  }
  for (const [regionId, calls] of scannerByRegion) {
    res.write(`event: scanner:update\n`);
    res.write(`data: ${JSON.stringify({
      type: 'scanner:update',
      data: { regionId, calls, timestamp: new Date().toISOString() },
      timestamp: new Date().toISOString(),
    })}\n\n`);
  }

  // Close the snapshot with an immediate per-client heartbeat. The client
  // treats everything between 'connected' and the first heartbeat as replay
  // (no notifications, ghost-pruning deferred) — without this it would wait
  // up to 30s for the global heartbeat, swallowing genuinely-new events.
  res.write(`event: heartbeat\n`);
  res.write(`data: ${JSON.stringify({ type: 'heartbeat', data: { timestamp: new Date().toISOString() }, timestamp: new Date().toISOString() })}\n\n`);

  logger.info('Initial data sent to SSE client', {
    clientId,
    incidents: data.incidents.length,
    cameras: data.cameras.length,
    weatherAlerts: data.weather.length,
    regionsWithWeather: Object.values(data.currentWeather).filter(Boolean).length,
    news: data.news.length,
    aircraft: data.aircraft.length,
    wantsAircraft
  });
});

// Update client preferences endpoint
router.post('/preferences', (req, res) => {
  const { clientId, wantsAircraft, regionId } = req.body;

  if (!clientId) {
    return res.status(400).json({ error: 'clientId is required' });
  }

  const aircraftRegion = wantsAircraft ? toRegionId(regionId) : null;
  const success = sse.updateClientPreferences(clientId, { aircraftRegion });

  if (!success) {
    return res.status(404).json({ error: 'Client not found' });
  }

  logger.debug('Client preferences updated via API', {
    clientId,
    aircraftRegion,
    aircraftClients: sse.getAircraftClientCount(),
    totalClients: sse.getClientCount()
  });

  return res.json({
    success: true,
    aircraftFetchingActive: aircraftRegion !== null && sse.anyClientWantsAircraftFor(aircraftRegion)
  });
});

export default router;
