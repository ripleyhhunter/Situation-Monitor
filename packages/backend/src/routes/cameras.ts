import { Router } from 'express';
import { aggregator } from '../services/aggregator.js';

const router = Router();

/**
 * GET /api/cameras
 * Get all traffic cameras with optional filtering
 */
router.get('/', (req, res) => {
  let cameras = aggregator.getCameras();

  // Filter by source
  const source = req.query.source as string | undefined;
  if (source) {
    cameras = cameras.filter((c) => c.source === source);
  }

  // Filter by bounds (for map viewport)
  const north = parseFloat(req.query.north as string);
  const south = parseFloat(req.query.south as string);
  const east = parseFloat(req.query.east as string);
  const west = parseFloat(req.query.west as string);

  if (!isNaN(north) && !isNaN(south) && !isNaN(east) && !isNaN(west)) {
    cameras = cameras.filter((c) => {
      const { lat, lng } = c.location;
      return lat >= south && lat <= north && lng >= west && lng <= east;
    });
  }

  res.json({
    count: cameras.length,
    cameras,
  });
});

/**
 * GET /api/cameras/:id
 * Get a single camera by ID
 */
router.get('/:id', (req, res) => {
  const camera = aggregator.getCameraById(req.params.id);

  if (!camera) {
    return res.status(404).json({ error: 'Camera not found' });
  }

  res.json(camera);
});

export default router;
