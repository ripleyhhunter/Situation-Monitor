import type { Response } from 'express';
import type { SSEEvent, SSEEventType } from '../types/index.js';
import logger from '../logger.js';

interface SSEClient {
  id: string;
  res: Response;
  connectedAt: Date;
}

class SSEService {
  private clients: Map<string, SSEClient> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.startHeartbeat();
  }

  private startHeartbeat(): void {
    // Send heartbeat every 30 seconds to keep connections alive
    this.heartbeatInterval = setInterval(() => {
      this.broadcast('heartbeat', { timestamp: new Date().toISOString() });
    }, 30000);
  }

  addClient(res: Response): string {
    const clientId = `client-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    });

    // Send initial connection event
    this.sendToClient(res, 'connected', {
      clientId,
      timestamp: new Date().toISOString(),
    });

    this.clients.set(clientId, {
      id: clientId,
      res,
      connectedAt: new Date(),
    });

    logger.info('SSE client connected', { clientId, totalClients: this.clients.size });

    // Handle client disconnect
    res.on('close', () => {
      this.removeClient(clientId);
    });

    return clientId;
  }

  removeClient(clientId: string): void {
    const client = this.clients.get(clientId);
    if (client) {
      this.clients.delete(clientId);
      logger.info('SSE client disconnected', { clientId, totalClients: this.clients.size });
    }
  }

  private sendToClient(res: Response, type: SSEEventType, data: unknown): void {
    try {
      const event: SSEEvent = {
        type,
        data,
        timestamp: new Date().toISOString(),
      };

      res.write(`event: ${type}\n`);
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch (error) {
      logger.error('Error sending to SSE client', { error });
    }
  }

  broadcast<T>(type: SSEEventType, data: T): void {
    const deadClients: string[] = [];

    this.clients.forEach((client, clientId) => {
      try {
        this.sendToClient(client.res, type, data);
      } catch (error) {
        logger.error('Error broadcasting to client', { clientId, error });
        deadClients.push(clientId);
      }
    });

    // Clean up dead clients
    deadClients.forEach((id) => this.removeClient(id));
  }

  getClientCount(): number {
    return this.clients.size;
  }

  getClientIds(): string[] {
    return Array.from(this.clients.keys());
  }

  shutdown(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    // Close all client connections
    this.clients.forEach((client) => {
      try {
        client.res.end();
      } catch {
        // Ignore errors on shutdown
      }
    });

    this.clients.clear();
    logger.info('SSE service shut down');
  }
}

export const sse = new SSEService();
export default sse;
