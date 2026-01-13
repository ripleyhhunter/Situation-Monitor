import { Router } from 'express';
import { aggregator } from '../services/aggregator.js';
import type { IncidentType } from '../types/index.js';

const router = Router();

/**
 * GET /api/incidents
 * Get all active incidents with optional filtering
 */
router.get('/', (req, res) => {
  try {
    let incidents = aggregator.getIncidents();

    // Filter by type
    const type = req.query.type as IncidentType | undefined;
    if (type) {
      incidents = incidents.filter((i) => i.type === type);
    }

    // Filter by severity (minimum)
    const minSeverity = parseInt(req.query.minSeverity as string);
    if (!isNaN(minSeverity)) {
      incidents = incidents.filter((i) => i.severity >= minSeverity);
    }

    // Filter by bounds (for map viewport)
    const north = parseFloat(req.query.north as string);
    const south = parseFloat(req.query.south as string);
    const east = parseFloat(req.query.east as string);
    const west = parseFloat(req.query.west as string);

    if (!isNaN(north) && !isNaN(south) && !isNaN(east) && !isNaN(west)) {
      incidents = incidents.filter((i) => {
        const { lat, lng } = i.location;
        return lat >= south && lat <= north && lng >= west && lng <= east;
      });
    }

    // Limit first, then sort (more efficient for large datasets)
    const limit = parseInt(req.query.limit as string) || 1000;
    
    // Sort by timestamp (newest first)
    incidents.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    
    incidents = incidents.slice(0, limit);

    res.json({
      count: incidents.length,
      incidents,
    });
  } catch (error) {
    console.error('Error in incidents endpoint:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/incidents/:id
 * Get a single incident by ID
 */
router.get('/:id', (req, res) => {
  const incident = aggregator.getIncidentById(req.params.id);

  if (!incident) {
    return res.status(404).json({ error: 'Incident not found' });
  }

  res.json(incident);
});

export default router;
