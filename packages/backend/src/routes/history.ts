import { Router } from 'express';
import { history } from '../services/history.js';
import { regionsById, defaultRegionId } from '../regions/index.js';
import type { RegionId } from '../types/index.js';

const router = Router();

function toRegionId(value: unknown): RegionId {
  const raw = String(value ?? '').toLowerCase();
  return Object.hasOwn(regionsById, raw) ? (raw as RegionId) : defaultRegionId;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = parseInt(String(value), 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

// Daily counts by type, e.g. /api/history/summary?region=dc&days=7
router.get('/summary', (req, res) => {
  const regionId = toRegionId(req.query.region);
  const days = clampInt(req.query.days, 7, 1, 90);
  res.json({
    regionId,
    days,
    enabled: history.isEnabled(),
    rows: history.getDailySummary(regionId, days),
  });
});

// Hourly counts by type, e.g. /api/history/hourly?region=dc&hours=24
router.get('/hourly', (req, res) => {
  const regionId = toRegionId(req.query.region);
  const hours = clampInt(req.query.hours, 24, 1, 168);
  res.json({
    regionId,
    hours,
    enabled: history.isEnabled(),
    rows: history.getHourlySummary(regionId, hours),
  });
});

export default router;
