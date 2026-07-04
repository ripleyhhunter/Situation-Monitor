import { describe, it, expect } from 'vitest';
import { aggregateAdaCrimeFeatures, adaCrimeSeverity } from './ada-crime.js';
import type { AdaCrimeFeature } from './ada-crime.js';

const REPORTED = Date.parse('2026-07-02T21:30:00Z');

function mkRow(overrides: Partial<AdaCrimeFeature['attributes']> = {}, geometry: AdaCrimeFeature['geometry'] = { x: -116.27, y: 43.6067 }): AdaCrimeFeature {
  return {
    attributes: {
      Case_Number: '2026-00005891',
      Address: 'W BARRISTER DR',
      City: 'Boise',
      ReportedDate: REPORTED,
      Status: 'Arrest',
      Description: 'Burglary',
      CATEGORY: 'Burglary',
      NIBRDesc: 'Burglary/Breaking and Entering',
      AGENCY: 'Ada County Sheriff',
      Offense: 'Burglary',
      Crime_Against_Category: 'Property',
      ...overrides,
    },
    geometry,
  };
}

describe('aggregateAdaCrimeFeatures', () => {
  it('maps a row to an Incident with feed-derived timestamps', () => {
    const [incident] = aggregateAdaCrimeFeatures([mkRow()]);
    expect(incident.id).toBe('ada-crime-2026-00005891');
    expect(incident.type).toBe('crime');
    expect(incident.source).toBe('ada-crime');
    expect(incident.regionId).toBe('boise');
    expect(incident.severity).toBe(3); // property
    // Invariant: both timestamps from the feed's ReportedDate, never now.
    expect(incident.timestamp).toBe(new Date(REPORTED).toISOString());
    expect(incident.updatedAt).toBe(new Date(REPORTED).toISOString());
    expect(incident.location).toMatchObject({ lat: 43.6067, lng: -116.27 });
    expect(incident.location.address).toBe('W BARRISTER DR, Boise');
  });

  it('aggregates multi-offense cases into one incident (one row per charge upstream)', () => {
    const rows = [
      mkRow({ Description: 'Burglary' }),
      mkRow({ Description: 'Grand Theft' }),
      mkRow({ Description: 'Burglary' }), // duplicate offense collapses
    ];
    const incidents = aggregateAdaCrimeFeatures(rows);
    expect(incidents).toHaveLength(1);
    expect(incidents[0].metadata.offenses).toEqual(['Burglary', 'Grand Theft']);
    expect(incidents[0].description).toContain('Charges: Burglary; Grand Theft');
  });

  it('surfaces the most severe charge as the case face', () => {
    const rows = [
      mkRow({ Description: 'Trespass', Crime_Against_Category: 'Society', CATEGORY: 'Trespass' }),
      mkRow({ Description: 'Aggravated Assault', Crime_Against_Category: 'Person', CATEGORY: 'Assault' }),
    ];
    const [incident] = aggregateAdaCrimeFeatures(rows);
    expect(incident.severity).toBe(4);
    expect(incident.title).toBe('Assault');
  });

  it('drops rows missing case number, time, or valid coordinates', () => {
    expect(aggregateAdaCrimeFeatures([mkRow({ Case_Number: null })])).toHaveLength(0);
    expect(aggregateAdaCrimeFeatures([mkRow({ ReportedDate: null })])).toHaveLength(0);
    expect(aggregateAdaCrimeFeatures([mkRow({}, null)])).toHaveLength(0);
    expect(aggregateAdaCrimeFeatures([mkRow({}, { x: 0, y: 0 })])).toHaveLength(0);
  });
});

describe('adaCrimeSeverity', () => {
  it('ranks crime-against categories', () => {
    expect(adaCrimeSeverity('Person', 'Assault')).toBe(4);
    expect(adaCrimeSeverity('Property', 'Burglary')).toBe(3);
    expect(adaCrimeSeverity('Society', 'Drug offense')).toBe(2);
    expect(adaCrimeSeverity('Miscellaneous', 'All other crimes')).toBe(2);
  });

  it('flags the most serious categories regardless of crime-against', () => {
    expect(adaCrimeSeverity('Person', 'Homicide')).toBe(5);
    expect(adaCrimeSeverity('Property', 'Robbery')).toBe(5);
  });
});
