import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import type { Incident, RegionId } from '../types/index.js';
import logger from '../logger.js';

/**
 * Durable incident history on SQLite (better-sqlite3, WAL mode).
 *
 * Two jobs:
 *  1. History & trends — every incident the aggregator ever sees is
 *     upserted here, keyed by id, with first-seen / last-updated /
 *     cleared-at times taken from the incident's own (feed-derived)
 *     fields. The /api/history endpoints aggregate it.
 *  2. Restart persistence without Redis — on startup the aggregator can
 *     restore recent active incidents from here when the Redis snapshot
 *     is unavailable (Redis stays optional, as designed).
 *
 * Retention: rows older than RETENTION_DAYS are pruned on startup — enough
 * for meaningful trends without unbounded disk growth on a 24/7 process.
 */

const RETENTION_DAYS = 180;

export interface HistorySummaryRow {
  day: string;
  type: string;
  count: number;
}

export interface HistoryHourlyRow {
  hour: string;
  type: string;
  count: number;
}

class HistoryService {
  private db: Database.Database | null = null;
  private upsertStmt: Database.Statement | null = null;
  private clearStmt: Database.Statement | null = null;

  /** Open (or create) the database. Pass ':memory:' in tests. */
  initialize(dbPath?: string): void {
    if (this.db) return;
    try {
      const file = dbPath ?? this.defaultPath();
      if (file !== ':memory:') {
        fs.mkdirSync(path.dirname(file), { recursive: true });
      }
      this.db = new Database(file);
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('synchronous = NORMAL');
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS incident_history (
          id TEXT PRIMARY KEY,
          region_id TEXT NOT NULL,
          type TEXT NOT NULL,
          severity INTEGER NOT NULL,
          lat REAL NOT NULL,
          lng REAL NOT NULL,
          source TEXT NOT NULL,
          title TEXT NOT NULL,
          category TEXT,
          status TEXT NOT NULL,
          first_seen TEXT NOT NULL,
          last_updated TEXT NOT NULL,
          cleared_at TEXT,
          description TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX IF NOT EXISTS idx_history_region_time
          ON incident_history (region_id, first_seen);
        CREATE INDEX IF NOT EXISTS idx_history_region_type_time
          ON incident_history (region_id, type, first_seen);
      `);
      try {
        this.db.exec("ALTER TABLE incident_history ADD COLUMN description TEXT NOT NULL DEFAULT ''");
      } catch {
        // Column already exists — the common case.
      }
      this.prepareStatements();
      this.prune();
      logger.info(`History: SQLite ready at ${file} (${this.count()} rows)`);
    } catch (error) {
      // History is an enhancement — the live dashboard must not die if the
      // native module or disk is unavailable.
      logger.error('History: failed to initialize SQLite — history disabled', { error });
      this.db = null;
    }
  }

  private defaultPath(): string {
    return path.join(process.cwd(), 'data', 'history.db');
  }

  isEnabled(): boolean {
    return this.db !== null;
  }

  private prepareStatements(): void {
    if (!this.db) return;
    // Prepared once: measured ~22x faster than prepare-per-call inside an
    // implicit transaction per row (0.4-0.6s stall on a 2000-row first
    // crime fetch vs ~18ms batched).
    this.upsertStmt = this.db.prepare(`
      INSERT INTO incident_history
        (id, region_id, type, severity, lat, lng, source, title, category, status, first_seen, last_updated, cleared_at, description)
      VALUES
        (@id, @regionId, @type, @severity, @lat, @lng, @source, @title, @category, @status, @timestamp, @updatedAt, NULL, @description)
      ON CONFLICT(id) DO UPDATE SET
        severity = excluded.severity,
        status = excluded.status,
        title = excluded.title,
        last_updated = excluded.last_updated,
        description = excluded.description,
        -- An incident reappearing in a feed is a REACTIVATION: without this
        -- reset, the next markCleared (guarded on cleared_at IS NULL) would
        -- silently no-op and the row would restore as falsely active.
        cleared_at = CASE WHEN excluded.status = 'active' THEN NULL ELSE cleared_at END
    `);
    this.clearStmt = this.db.prepare(
      `UPDATE incident_history SET status = 'cleared', cleared_at = ? WHERE id = ? AND cleared_at IS NULL`
    );
  }

  private toRow(incident: Incident): Record<string, unknown> {
    return {
      id: incident.id,
      regionId: incident.regionId,
      type: incident.type,
      severity: incident.severity,
      lat: incident.location.lat,
      lng: incident.location.lng,
      source: incident.source,
      title: incident.title,
      category: incident.category ?? null,
      status: incident.status,
      timestamp: incident.timestamp,
      updatedAt: incident.updatedAt,
      description: incident.description ?? '',
    };
  }

  upsertIncident(incident: Incident): void {
    if (!this.db || !this.upsertStmt) return;
    try {
      this.upsertStmt.run(this.toRow(incident));
    } catch (error) {
      logger.warn('History: upsert failed', { error, id: incident.id });
    }
  }

  /** Batch upsert in one transaction — use for whole poll batches. */
  upsertMany(incidents: Incident[]): void {
    if (!this.db || !this.upsertStmt || incidents.length === 0) return;
    try {
      const stmt = this.upsertStmt;
      this.db.transaction((rows: Incident[]) => {
        for (const incident of rows) stmt.run(this.toRow(incident));
      })(incidents);
    } catch (error) {
      logger.warn('History: batch upsert failed', { error, count: incidents.length });
    }
  }

  markCleared(id: string, clearedAt: string): void {
    if (!this.db || !this.clearStmt) return;
    try {
      this.clearStmt.run(clearedAt, id);
    } catch (error) {
      logger.warn('History: markCleared failed', { error, id });
    }
  }

  /**
   * Recent active incidents for startup restore (Redis-less persistence).
   * Mirrors the Redis restore window: actives first seen in the last 24h.
   */
  getRecentActive(regionId: RegionId, sinceIso: string): Incident[] {
    if (!this.db) return [];
    try {
      const rows = this.db
        .prepare(`
          SELECT * FROM incident_history
          WHERE region_id = ? AND status = 'active' AND first_seen >= ?
        `)
        .all(regionId, sinceIso) as Array<Record<string, unknown>>;
      return rows.map((row) => ({
        id: row.id as string,
        regionId: row.region_id as RegionId,
        type: row.type as Incident['type'],
        severity: row.severity as Incident['severity'],
        location: { lat: row.lat as number, lng: row.lng as number },
        timestamp: row.first_seen as string,
        updatedAt: row.last_updated as string,
        source: row.source as Incident['source'],
        title: row.title as string,
        description: (row.description as string) ?? '',
        status: 'active' as const,
        category: (row.category as string) ?? undefined,
        metadata: { restoredFromHistory: true },
      }));
    } catch (error) {
      logger.warn('History: restore query failed', { error });
      return [];
    }
  }

  /** Daily counts by type for the trends panel. */
  getDailySummary(regionId: RegionId, days: number): HistorySummaryRow[] {
    if (!this.db) return [];
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    try {
      return this.db
        .prepare(`
          SELECT substr(first_seen, 1, 10) AS day, type, COUNT(*) AS count
          FROM incident_history
          WHERE region_id = ? AND first_seen >= ?
          GROUP BY day, type
          ORDER BY day
        `)
        .all(regionId, since) as HistorySummaryRow[];
    } catch (error) {
      logger.warn('History: daily summary query failed', { error });
      return [];
    }
  }

  /** Hourly counts by type (UTC hours) for the last-N-hours sparkline. */
  getHourlySummary(regionId: RegionId, hours: number): HistoryHourlyRow[] {
    if (!this.db) return [];
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    try {
      return this.db
        .prepare(`
          SELECT substr(first_seen, 1, 13) AS hour, type, COUNT(*) AS count
          FROM incident_history
          WHERE region_id = ? AND first_seen >= ?
          GROUP BY hour, type
          ORDER BY hour
        `)
        .all(regionId, since) as HistoryHourlyRow[];
    } catch (error) {
      logger.warn('History: hourly summary query failed', { error });
      return [];
    }
  }

  count(): number {
    if (!this.db) return 0;
    return (this.db.prepare('SELECT COUNT(*) AS c FROM incident_history').get() as { c: number }).c;
  }

  private prune(): void {
    if (!this.db) return;
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const result = this.db.prepare('DELETE FROM incident_history WHERE first_seen < ?').run(cutoff);
    if (result.changes > 0) {
      logger.info(`History: pruned ${result.changes} rows older than ${RETENTION_DAYS} days`);
    }
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.upsertStmt = null;
      this.clearStmt = null;
    }
  }
}

export const history = new HistoryService();
export default history;
