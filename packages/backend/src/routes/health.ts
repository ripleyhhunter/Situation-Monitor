import { Router } from 'express';
import { cache } from '../services/cache.js';
import { sse } from '../services/sse.js';
import { scheduler } from '../services/scheduler.js';

const router = Router();

router.get('/', (req, res) => {
  const status = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    redis: cache.isConnected() ? 'connected' : 'disconnected',
    sseClients: sse.getClientCount(),
    scheduledTasks: scheduler.getStatus(),
    memory: {
      heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
      heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + 'MB',
    },
  };

  res.json(status);
});

export default router;
