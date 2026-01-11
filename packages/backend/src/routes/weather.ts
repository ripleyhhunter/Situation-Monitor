import { Router } from 'express';
import { aggregator } from '../services/aggregator.js';

const router = Router();

/**
 * GET /api/weather
 * Get all active weather alerts
 */
router.get('/', (req, res) => {
  const alerts = aggregator.getWeatherAlerts();

  res.json({
    count: alerts.length,
    alerts,
  });
});

/**
 * GET /api/weather/:id
 * Get a specific weather alert
 */
router.get('/:id', (req, res) => {
  const alerts = aggregator.getWeatherAlerts();
  const alert = alerts.find((a) => a.id === req.params.id);

  if (!alert) {
    return res.status(404).json({ error: 'Weather alert not found' });
  }

  res.json(alert);
});

export default router;
