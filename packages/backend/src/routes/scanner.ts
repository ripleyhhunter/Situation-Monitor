import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  DC_SCANNER_FEEDS,
  getFilteredFeeds,
  SCANNER_RESOURCES,
  type ScannerFeed,
} from '../config/scanner-feeds.js';
import { dcfdRealtimeFetcher } from '../fetchers/openmhz-realtime.js';
import { aggregator } from '../services/aggregator.js';
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
 * Returns recent scanner calls from the real-time fetcher
 */
router.get('/calls', (req: Request, res: Response) => {
  const { since, limit, talkgroup } = req.query;

  try {
    let calls = aggregator.getScannerCalls();

    // Filter by since timestamp if specified
    if (since) {
      const sinceDate = new Date(since as string);
      calls = calls.filter((c) => new Date(c.timestamp) >= sinceDate);
    }

    // Filter by talkgroup if specified
    if (talkgroup) {
      const tg = parseInt(talkgroup as string, 10);
      calls = calls.filter((c) => c.talkgroup === tg);
    }

    // Limit results
    const maxResults = Math.min(parseInt(limit as string, 10) || 50, 100);
    calls = calls.slice(0, maxResults);

    const status = aggregator.getScannerStatus();

    res.json({
      calls,
      total: calls.length,
      timestamp: new Date().toISOString(),
      status: {
        systemId: status.systemId,
        lastCallTime: status.lastCallTime,
        totalCalls: status.callCount,
      },
    });
  } catch (error) {
    logger.error('Failed to fetch scanner calls', { error });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/scanner/calls/live
 * Returns only the most recent calls (last 5 minutes)
 */
router.get('/calls/live', (req: Request, res: Response) => {
  try {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const calls = aggregator.getScannerCallsSince(fiveMinutesAgo);
    const status = aggregator.getScannerStatus();

    res.json({
      calls,
      total: calls.length,
      timestamp: new Date().toISOString(),
      isLive: true,
      status: {
        systemId: status.systemId,
        lastCallTime: status.lastCallTime,
      },
    });
  } catch (error) {
    logger.error('Failed to fetch live scanner calls', { error });
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

    let calls = aggregator.getScannerCalls();

    // Filter by talkgroup if specified
    if (talkgroup) {
      const tg = parseInt(talkgroup as string, 10);
      calls = calls.filter((c) => c.talkgroup === tg);
    }

    // Filter by since timestamp if specified
    if (since) {
      const sinceDate = new Date(since as string);
      calls = calls.filter((c) => new Date(c.timestamp) >= sinceDate);
    }

    // Limit results
    const maxResults = Math.min(parseInt(limit as string, 10) || 50, 100);
    calls = calls.slice(0, maxResults);

    const status = aggregator.getScannerStatus();

    res.json({
      systemId,
      calls,
      total: calls.length,
      timestamp: new Date().toISOString(),
      status: {
        lastCallTime: status.lastCallTime,
        totalCalls: status.callCount,
      },
    });
  } catch (error) {
    logger.error('Failed to fetch scanner calls for system', { error, systemId });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/scanner/status
 * Returns the current status of scanner feeds
 */
router.get('/status', (_req: Request, res: Response) => {
  const status = aggregator.getScannerStatus();

  res.json({
    status: {
      dcfd: {
        systemId: status.systemId,
        isActive: status.callCount > 0,
        lastCallTime: status.lastCallTime,
        recentCallCount: status.callCount,
      },
    },
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /api/scanner/talkgroups
 * Returns known talkgroups for DCFD
 */
router.get('/talkgroups', (_req: Request, res: Response) => {
  // Common DCFD talkgroups
  const talkgroups = [
    { id: 1, alpha: 'Dispatch 1', description: 'Main Dispatch Channel', group: 'Dispatch' },
    { id: 2, alpha: 'Dispatch 2', description: 'Secondary Dispatch', group: 'Dispatch' },
    { id: 3, alpha: 'EMS 1', description: 'EMS Operations', group: 'EMS' },
    { id: 4, alpha: 'EMS 2', description: 'EMS Secondary', group: 'EMS' },
    { id: 5, alpha: 'Fireground 1', description: 'Fireground Operations', group: 'Fireground' },
    { id: 6, alpha: 'Fireground 2', description: 'Fireground Tactical', group: 'Fireground' },
    { id: 7, alpha: 'Command', description: 'Command Channel', group: 'Command' },
    { id: 8, alpha: 'Hazmat', description: 'Hazmat Operations', group: 'Special' },
  ];

  res.json({
    systemId: 'dcfd',
    talkgroups,
    notice: 'Talkgroup assignments may vary. These are common channels.',
  });
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
