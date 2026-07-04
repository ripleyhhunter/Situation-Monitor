import { describe, it, expect } from 'vitest';
import { getAgeBasedOpacity, isFreshIncident, getAgeFreshnessClass } from './time';

const minutesAgo = (m: number) => new Date(Date.now() - m * 60 * 1000).toISOString();

describe('getAgeBasedOpacity', () => {
  it('returns discrete buckets by age', () => {
    expect(getAgeBasedOpacity(minutesAgo(5))).toBe(1.0);
    expect(getAgeBasedOpacity(minutesAgo(30))).toBe(0.9);
    expect(getAgeBasedOpacity(minutesAgo(120))).toBe(0.7);
    expect(getAgeBasedOpacity(minutesAgo(600))).toBe(0.5);
    expect(getAgeBasedOpacity(minutesAgo(1000))).toBe(0.35);
    expect(getAgeBasedOpacity(minutesAgo(2000))).toBe(0.2);
  });

  it('is stable within a bucket (marker icons diff on this)', () => {
    expect(getAgeBasedOpacity(minutesAgo(20))).toBe(getAgeBasedOpacity(minutesAgo(50)));
  });
});

describe('isFreshIncident', () => {
  it('is true under 15 minutes and false after', () => {
    expect(isFreshIncident(minutesAgo(5))).toBe(true);
    expect(isFreshIncident(minutesAgo(20))).toBe(false);
  });
});

describe('getAgeFreshnessClass', () => {
  it('maps ages to classes', () => {
    expect(getAgeFreshnessClass(minutesAgo(5))).toBe('fresh');
    expect(getAgeFreshnessClass(minutesAgo(30))).toBe('recent');
    expect(getAgeFreshnessClass(minutesAgo(120))).toBe('stale');
    expect(getAgeFreshnessClass(minutesAgo(600))).toBe('old');
  });
});
