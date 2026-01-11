import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  DC_SCANNER_FEEDS,
  getFilteredFeeds,
  SCANNER_RESOURCES,
  type ScannerFeed,
} from '../config/scanner-feeds.js';
import { openMHzFetcher } from '../fetchers/openmhz.js';
import logger from '../logger.js';

const router = Router();

/**
 * GET /api/scanner/feeds
 * Returns available scanner feeds with optional filtering
 */
router.get('/feeds', (req: Request, res: Response) => {
  const { region, type, liveOnly, includeEncrypted } = req.query;

  const feeds = getFilteredFeeds({
    region: region as ScannerFeed['region'] | 'all' | undefined,
    type: type as ScannerFeed['type'] | undefined,
    liveOnly: liveOnly === 'true',
    includeEncrypted: includeEncrypted === 'true',
  });

  res.json({
    feeds,
    total: feeds.length,
    resources: SCANNER_RESOURCES,
    notice: 'DC Metro Police radios have been fully encrypted since 2011. Only Fire/EMS feeds are available.',
  });
});

/**
 * GET /api/scanner/feeds/:id
 * Returns a specific scanner feed by ID
 */
router.get('/feeds/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const feed = DC_SCANNER_FEEDS.find((f) => f.id === id);

  if (!feed) {
    return res.status(404).json({ error: 'Feed not found' });
  }

  res.json({ feed });
});

/**
 * GET /api/scanner/calls
 * Returns recent scanner calls from OpenMHz
 */
router.get('/calls', async (req: Request, res: Response) => {
  try {
    const result = await openMHzFetcher.fetch();

    if (!result.success) {
      return res.status(503).json({
        error: 'Scanner call data unavailable',
        message: result.error,
      });
    }

    res.json({
      calls: result.data || [],
      total: result.data?.length || 0,
      timestamp: result.timestamp,
    });
  } catch (error) {
    logger.error('Failed to fetch scanner calls', { error });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/scanner/calls/:systemId
 * Returns scanner calls for a specific system
 */
router.get('/calls/:systemId', async (req: Request, res: Response) => {
  const { systemId } = req.params;
  const { since, talkgroup, limit } = req.query;

  try {
    // For now, we only support dcfd
    if (systemId !== 'dcfd') {
      return res.status(404).json({
        error: 'System not found',
        available: ['dcfd'],
      });
    }

    const result = await openMHzFetcher.fetch();

    if (!result.success) {
      return res.status(503).json({
        error: 'Scanner call data unavailable',
        message: result.error,
      });
    }

    let calls = result.data || [];

    // Filter by talkgroup if specified
    if (talkgroup) {
      const tg = parseInt(talkgroup as string, 10);
      calls = calls.filter((c) => c.metadata?.talkgroup === tg);
    }

    // Filter by since timestamp if specified
    if (since) {
      const sinceDate = new Date(since as string);
      calls = calls.filter((c) => new Date(c.timestamp) >= sinceDate);
    }

    // Limit results
    const maxResults = Math.min(parseInt(limit as string, 10) || 50, 100);
    calls = calls.slice(0, maxResults);

    res.json({
      systemId,
      calls,
      total: calls.length,
      timestamp: result.timestamp,
    });
  } catch (error) {
    logger.error('Failed to fetch scanner calls for system', { error, systemId });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/scanner/resources
 * Returns external scanner resource links
 */
router.get('/resources', (_req: Request, res: Response) => {
  res.json({
    resources: SCANNER_RESOURCES,
    recommended: [
      {
        name: 'Broadcastify DC',
        url: SCANNER_RESOURCES.broadcastifyDC,
        description: 'Live DC area scanner feeds',
      },
      {
        name: 'OpenMHz DCFD',
        url: SCANNER_RESOURCES.openMHzDCFD,
        description: 'Archived DC Fire/EMS recordings',
      },
      {
        name: 'DMV RealTime',
        url: SCANNER_RESOURCES.dmvRealTime,
        description: 'Real-time DC/MD/VA incident reporting',
      },
    ],
  });
});

export default router;

