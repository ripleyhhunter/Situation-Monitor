import { describe, it, expect } from 'vitest';
import {
  parseIdaho511Timestamp,
  classifyIdaho511Event,
  normalizeIdaho511Event,
  type Idaho511EventRow,
} from './idaho511-events.js';

// A live WazeIncidents row as served 2026-07-04 (I-84 through Nampa).
const wazeRow: Idaho511EventRow = {
  id: 40641,
  type: 'Waze Incident',
  roadwayName: 'I-84 E',
  description: 'Car stopped on shoulder',
  source: 'Waze',
  comment: null,
  eventSubType: 'HAZARD_ON_SHOULDER_CAR_STOPPED',
  startDate: '7/4/26, 8:42 AM',
  endDate: null,
  lastUpdated: '7/4/26, 9:26 AM',
  isFullClosure: false,
  severity: null,
  direction: null,
  locationDescription: null,
  laneDescription: null,
};

const IN_VALLEY: [number, number] = [43.596695, -116.471407];

describe('parseIdaho511Timestamp', () => {
  it('parses 2-digit-year Mountain wall clock as MDT in July', () => {
    // 8:42 AM MDT (UTC-6) → 14:42Z
    expect(parseIdaho511Timestamp('7/4/26, 8:42 AM')).toBe('2026-07-04T14:42:00.000Z');
  });

  it('parses winter dates as MST (UTC-7) — DST-aware', () => {
    expect(parseIdaho511Timestamp('1/15/26, 8:42 AM')).toBe('2026-01-15T15:42:00.000Z');
  });

  it('handles 4-digit years, seconds, and PM', () => {
    expect(parseIdaho511Timestamp('7/4/2026 1:05:30 PM')).toBe('2026-07-04T19:05:30.000Z');
  });

  it('returns null for empty input', () => {
    expect(parseIdaho511Timestamp(null)).toBeNull();
    expect(parseIdaho511Timestamp('')).toBeNull();
  });

  it('THROWS on a non-empty unparseable string (format drift must be loud)', () => {
    expect(() => parseIdaho511Timestamp('2026-07-04T08:42:00')).toThrow(/date format drift/);
  });
});

describe('classifyIdaho511Event', () => {
  it('drops congestion jams and Waze road-closure reports', () => {
    expect(classifyIdaho511Event({ eventSubType: 'JAM_HEAVY_TRAFFIC' })).toBeNull();
    expect(classifyIdaho511Event({ eventSubType: 'ROAD_CLOSED_EVENT' })).toBeNull();
  });

  it('maps accidents to traffic, major/full-closure to severity 4', () => {
    expect(classifyIdaho511Event({ eventSubType: 'ACCIDENT_MINOR' })).toEqual({
      type: 'traffic', severity: 3, label: 'Crash',
    });
    expect(classifyIdaho511Event({ eventSubType: 'ACCIDENT_MAJOR' })?.severity).toBe(4);
    expect(
      classifyIdaho511Event({ eventSubType: 'ACCIDENT_MINOR', isFullClosure: true })?.severity,
    ).toBe(4);
  });

  it('detects crashes in official ITD rows by keywords', () => {
    expect(
      classifyIdaho511Event({ type: 'Incident', description: 'Two-vehicle collision, left lane blocked' })?.type,
    ).toBe('traffic');
  });

  it('types vehicle fires as fire', () => {
    expect(classifyIdaho511Event({ description: 'Vehicle fire on shoulder' })?.type).toBe('fire');
  });

  it('does not type a sheared fire hydrant as fire', () => {
    expect(
      classifyIdaho511Event({ description: 'Fire hydrant sheared, water on roadway' })?.type,
    ).toBe('hazard');
  });

  it('grades hazards: on-road above shoulder', () => {
    expect(classifyIdaho511Event({ eventSubType: 'HAZARD_ON_ROAD_OBJECT' })?.severity).toBe(3);
    expect(classifyIdaho511Event(wazeRow)?.severity).toBe(2);
  });
});

describe('normalizeIdaho511Event', () => {
  it('normalizes a live Waze row with feed-derived timestamps', () => {
    const incident = normalizeIdaho511Event(wazeRow, 'WazeIncidents', IN_VALLEY);
    expect(incident).not.toBeNull();
    expect(incident!.id).toBe('itd-events-waze-40641');
    expect(incident!.source).toBe('itd-events');
    expect(incident!.type).toBe('hazard');
    expect(incident!.title).toBe('Roadside Hazard: I-84 E — Car stopped on shoulder');
    // timestamp from startDate, updatedAt from the feed's OWN lastUpdated —
    // never wall-clock now.
    expect(incident!.timestamp).toBe('2026-07-04T14:42:00.000Z');
    expect(incident!.updatedAt).toBe('2026-07-04T15:26:00.000Z');
    expect(incident!.description).toContain('Waze');
    // Point-in-time event: must NOT be exempted from the event-time filter.
    expect(incident!.metadata.ongoing).toBeUndefined();
  });

  it('drops rows without a joined map position', () => {
    expect(normalizeIdaho511Event(wazeRow, 'WazeIncidents', undefined)).toBeNull();
  });

  it('drops events outside the Treasure Valley bbox', () => {
    expect(normalizeIdaho511Event(wazeRow, 'WazeIncidents', [46.42, -117.02])).toBeNull();
  });

  it('falls back to lastUpdated for timestamp when startDate is missing', () => {
    const row = { ...wazeRow, startDate: null };
    const incident = normalizeIdaho511Event(row, 'WazeIncidents', IN_VALLEY);
    expect(incident!.timestamp).toBe('2026-07-04T15:26:00.000Z');
  });

  it('drops rows with no dates at all', () => {
    const row = { ...wazeRow, startDate: null, lastUpdated: null };
    expect(normalizeIdaho511Event(row, 'WazeIncidents', IN_VALLEY)).toBeNull();
  });

  it('uses the itd id namespace for the official layer', () => {
    const row: Idaho511EventRow = {
      ...wazeRow, id: 512, type: 'Incident', source: 'ITD', eventSubType: null,
      description: 'Crash blocking right lane',
    };
    const incident = normalizeIdaho511Event(row, 'Incidents', IN_VALLEY);
    expect(incident!.id).toBe('itd-events-itd-512');
    expect(incident!.type).toBe('traffic');
    expect(incident!.description).not.toContain('Waze');
  });
});
