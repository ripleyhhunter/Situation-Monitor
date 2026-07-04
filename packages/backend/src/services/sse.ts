import type { Response } from 'express';
import type { Camera, Incident, SSEEvent, SSEEventType, RegionId } from '../types/index.js';
import logger from '../logger.js';

/** Items per batched SSE event — keeps individual frames a modest size. */
const BATCH_CHUNK = 500;

function* chunks<T>(items: T[], size: number): Generator<T[]> {
  for (let i = 0; i < items.length; i += size) {
    yield items.slice(i, i + size);
  }
}

// Client preferences for conditional fetching
interface ClientPreferences {
  /** Region the client wants aircraft data for; null = no aircraft (saves OpenSky quota). */
  aircraftRegion: RegionId | null;
}

interface SSEClient {
  id: string;
  res: Response;
  connectedAt: Date;
  preferences: ClientPreferences;
  /** Client understands the batched event variants (connected with ?batch=1). */
  supportsBatch: boolean;
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

  addClient(res: Response, options: { supportsBatch?: boolean } = {}): string {
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
      preferences: {
        aircraftRegion: null, // Default to none to save API quota
      },
      supportsBatch: options.supportsBatch ?? false,
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

  /**
   * Broadcast a poll's worth of incident changes in one pass.
   * Batch-capable clients get a few array events; legacy clients (older
   * deployed frontends) get the exact per-item events they understand.
   */
  broadcastIncidentChanges(
    regionId: RegionId,
    added: Incident[],
    updated: Incident[],
    clearedIds: string[],
  ): void {
    if (added.length === 0 && updated.length === 0 && clearedIds.length === 0) return;

    const changed = added.concat(updated);
    const deadClients: string[] = [];

    this.clients.forEach((client, clientId) => {
      try {
        if (client.supportsBatch) {
          for (const chunk of chunks(changed, BATCH_CHUNK)) {
            this.sendToClient(client.res, 'incident:batch', { incidents: chunk });
          }
          for (const chunk of chunks(clearedIds, BATCH_CHUNK)) {
            this.sendToClient(client.res, 'incident:clear-batch', { ids: chunk });
          }
        } else {
          for (const incident of added) this.sendToClient(client.res, 'incident:new', incident);
          for (const incident of updated) this.sendToClient(client.res, 'incident:update', incident);
          for (const id of clearedIds) this.sendToClient(client.res, 'incident:clear', { id, regionId });
        }
      } catch (error) {
        logger.error('Error broadcasting incident changes', { clientId, error });
        deadClients.push(clientId);
      }
    });

    deadClients.forEach((id) => this.removeClient(id));
  }

  /** Same pattern for camera changes. */
  broadcastCameraChanges(cameras: Camera[]): void {
    if (cameras.length === 0) return;

    const deadClients: string[] = [];

    this.clients.forEach((client, clientId) => {
      try {
        if (client.supportsBatch) {
          for (const chunk of chunks(cameras, BATCH_CHUNK)) {
            this.sendToClient(client.res, 'camera:batch', { cameras: chunk });
          }
        } else {
          for (const camera of cameras) this.sendToClient(client.res, 'camera:update', camera);
        }
      } catch (error) {
        logger.error('Error broadcasting camera changes', { clientId, error });
        deadClients.push(clientId);
      }
    });

    deadClients.forEach((id) => this.removeClient(id));
  }

  getClientCount(): number {
    return this.clients.size;
  }

  getClientIds(): string[] {
    return Array.from(this.clients.keys());
  }

  /**
   * Update a client's preferences
   */
  updateClientPreferences(clientId: string, preferences: Partial<ClientPreferences>): boolean {
    const client = this.clients.get(clientId);
    if (!client) {
      return false;
    }

    client.preferences = { ...client.preferences, ...preferences };
    logger.debug('Client preferences updated', { clientId, preferences: client.preferences });
    return true;
  }

  /**
   * Check if any connected client wants aircraft data for a specific region
   */
  anyClientWantsAircraftFor(regionId: RegionId): boolean {
    for (const client of this.clients.values()) {
      if (client.preferences.aircraftRegion === regionId) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get count of clients wanting aircraft data (any region)
   */
  getAircraftClientCount(): number {
    let count = 0;
    for (const client of this.clients.values()) {
      if (client.preferences.aircraftRegion !== null) {
        count++;
      }
    }
    return count;
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
