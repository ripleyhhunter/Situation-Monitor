/**
 * PulsePoint Fetcher
 *
 * Fetches real-time Fire/EMS incident data from PulsePoint by rendering
 * their web app with a headless browser and extracting the data.
 *
 * Constructor takes an agency config so the same scraper drives any
 * participating agency (DC FEMS = EMS1205, Ada County ACCESS = EMS1169, ...).
 */

import { chromium, Browser, Page } from 'playwright';
import { BaseFetcher } from './base.js';
import type { Incident, IncidentType, RegionId } from '../types/index.js';
import config from '../config.js';
import logger from '../logger.js';
import { geocache } from '../services/geocache.js';
import { todayInZone, wallClockToUtcMs } from '../utils/timezone.js';

interface ParsedIncident {
  type: string;
  address: string;
  time: string;
  units: string[];
  status: 'active' | 'closed';
  duration?: string;
}

/**
 * Per-agency configuration. Each region creates its own PulsePointFetcher
 * with the right ZIP / agency name / address pattern for its participating
 * fire/EMS organization.
 */
export interface PulsePointAgencyConfig {
  /** Region this agency belongs to — stamped on every Incident produced. */
  regionId: RegionId;
  /** Geolocation injected into the browser context (helps PulsePoint scope nearby agencies). */
  browserLat: number;
  browserLng: number;
  /** ZIP typed into the agency search box. */
  zipCode: string;
  /** Regex matched against the dropdown row text (case-insensitive). */
  agencyMatcher: RegExp;
  /** Regex used to detect the city/state portion of a scraped address line. */
  cityPattern: RegExp;
  /** Title prefix on each normalized incident, e.g. "DCFD" or "ACCESS". */
  titlePrefix: string;
  /** IANA timezone of the agency, e.g. "America/New_York". Pinned on the
   * browser context so scraped times are agency-local, and used to convert
   * them to UTC. */
  timezone: string;
  /** City appended to bare street addresses when geocoding, e.g. "Washington". */
  geocodeCity: string;
  /** Two-letter state for geocoding, e.g. "DC". */
  geocodeState: string;
  /** Center used as a deterministic fallback when geocoding fails. */
  fallbackCenter: { lat: number; lng: number };
  /**
   * Whether to apply DC-style NW/NE/SW/SE quadrant offsets in the geocode
   * fallback. Boise's grid doesn't use quadrant suffixes, so leave false there.
   */
  useDcQuadrantFallback?: boolean;
}

// Map PulsePoint call types to our incident types
const CALL_TYPE_MAP: Record<string, { type: IncidentType; severity: 1 | 2 | 3 | 4 | 5 }> = {
  'structure fire': { type: 'fire', severity: 5 },
  'building fire': { type: 'fire', severity: 5 },
  'residential fire': { type: 'fire', severity: 5 },
  'commercial fire': { type: 'fire', severity: 5 },
  'working fire': { type: 'fire', severity: 5 },
  'fire': { type: 'fire', severity: 4 },
  'fire alarm': { type: 'fire', severity: 2 },
  'smoke detector': { type: 'fire', severity: 2 },
  'smoke investigation': { type: 'fire', severity: 3 },
  'vehicle fire': { type: 'fire', severity: 3 },
  'outside fire': { type: 'fire', severity: 3 },
  'brush fire': { type: 'fire', severity: 3 },
  'vegetation fire': { type: 'fire', severity: 3 },
  'wildland fire': { type: 'fire', severity: 4 },

  'medical emergency': { type: 'fire', severity: 3 },
  'cardiac arrest': { type: 'fire', severity: 5 },
  'breathing problems': { type: 'fire', severity: 4 },
  'chest pain': { type: 'fire', severity: 4 },
  'stroke': { type: 'fire', severity: 4 },
  'unconscious': { type: 'fire', severity: 4 },
  'fall': { type: 'fire', severity: 3 },
  'sick person': { type: 'fire', severity: 2 },
  'lift assist': { type: 'fire', severity: 1 },

  'traffic collision': { type: 'traffic', severity: 3 },
  'collision': { type: 'traffic', severity: 3 },
  'mva': { type: 'traffic', severity: 3 },
  'mvc': { type: 'traffic', severity: 3 },

  'hazmat': { type: 'hazard', severity: 5 },
  'gas leak': { type: 'hazard', severity: 4 },
  'carbon monoxide': { type: 'hazard', severity: 4 },
  'electrical emergency': { type: 'hazard', severity: 3 },
  'wires down': { type: 'hazard', severity: 3 },

  'rescue': { type: 'fire', severity: 4 },
  'water rescue': { type: 'fire', severity: 5 },
  'technical rescue': { type: 'fire', severity: 4 },
  'elevator rescue': { type: 'fire', severity: 3 },

  'public service': { type: 'fire', severity: 1 },
  'investigation': { type: 'fire', severity: 2 },
};

export class PulsePointFetcher extends BaseFetcher<Incident> {
  private browser: Browser | null = null;
  private persistentPage: Page | null = null;
  private lastFetchTime = 0;
  private minFetchInterval = 60000; // Minimum 1 minute between fetches
  private isConfigured = false;
  private configAttempts = 0;
  private maxConfigAttempts = 3;
  private agency: PulsePointAgencyConfig;

  constructor(agency: PulsePointAgencyConfig) {
    super(`pulsepoint-${agency.regionId}`, config.cacheTtl.scanner || 60);
    this.agency = agency;
  }

  private async getBrowser(): Promise<Browser> {
    // A crashed/killed Chromium leaves a disconnected handle — relaunch,
    // otherwise the feed is dead until the backend restarts.
    if (this.browser && !this.browser.isConnected()) {
      logger.warn(`PulsePoint (${this.agency.regionId}): Browser disconnected, relaunching`);
      this.browser = null;
      this.persistentPage = null;
      this.isConfigured = false;
    }

    if (!this.browser) {
      logger.debug('PulsePoint: Launching headless browser...');
      this.browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
    }
    return this.browser;
  }

  private async getPersistentPage(): Promise<Page> {
    if (this.persistentPage && !this.persistentPage.isClosed()) {
      return this.persistentPage;
    }

    // A closed page can leave its context alive inside the long-lived
    // browser process — close it before creating a replacement so contexts
    // don't accumulate across failures.
    if (this.persistentPage) {
      await this.persistentPage.context().close().catch(() => {});
      this.persistentPage = null;
    }

    const browser = await this.getBrowser();
    const context = await browser.newContext({
      geolocation: { latitude: this.agency.browserLat, longitude: this.agency.browserLng },
      permissions: ['geolocation'],
      // Pin the agency's zone so scraped wall-clock times are agency-local
      // regardless of the host machine's timezone.
      timezoneId: this.agency.timezone,
      storageState: undefined,
    });

    this.persistentPage = await context.newPage();
    this.isConfigured = false;

    return this.persistentPage;
  }

  protected async fetchFromApi(): Promise<Incident[]> {
    const now = Date.now();
    if (now - this.lastFetchTime < this.minFetchInterval) {
      logger.debug('PulsePoint: Skipping fetch (rate limited)');
      return [];
    }
    this.lastFetchTime = now;

    try {
      const page = await this.getPersistentPage();

      const currentUrl = page.url();
      if (!currentUrl.includes('pulsepoint.org') || !this.isConfigured) {
        logger.debug('PulsePoint: Loading web app...');
        await page.goto('https://web.pulsepoint.org/', { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForTimeout(2000);

        if (!this.isConfigured && this.configAttempts < this.maxConfigAttempts) {
          this.configAttempts++;
          await this.selectAgency(page);
        }
      } else {
        logger.debug('PulsePoint: Refreshing page for latest incidents...');
        await page.reload({ waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForTimeout(3000);
      }

      const incidents = await this.extractIncidentsFromPage(page);

      if (incidents.length > 0) {
        this.isConfigured = true;
        this.configAttempts = 0;
      }

      logger.info(`PulsePoint: Extracted ${incidents.length} incidents (${this.agency.titlePrefix})`);
      return incidents;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn(`PulsePoint fetch failed: ${msg}`);

      if (this.persistentPage) {
        // Close the whole context (not just the page) — page.close() leaves
        // the context alive and they accumulate across a failure loop.
        await this.persistentPage.context().close().catch(() => {});
        this.persistentPage = null;
        this.isConfigured = false;
      }

      // Propagate so BaseFetcher records the failure and serves stale data,
      // instead of caching an empty "success" that hides the outage.
      throw error;
    }
  }

  private async selectAgency(page: Page): Promise<void> {
    try {
      // If we're already on an incident view that matches our region's city, skip selection.
      const activeText = await page.$('text=Active');
      if (activeText) {
        const pageText = await page.innerText('body');
        if (this.agency.cityPattern.test(pageText)) {
          logger.debug('PulsePoint: Already on incident view');
          this.isConfigured = true;
          return;
        }
      }

      const createFeedBtn = page.locator('button:has-text("Create New Feed")');
      if (await createFeedBtn.isVisible().catch(() => false)) {
        await createFeedBtn.click({ force: true });
        logger.debug('PulsePoint: Clicked Create New Feed');
        await page.waitForTimeout(2000);
      }

      const findAgencies = page.locator('text=Find Agencies').first();
      if (await findAgencies.isVisible().catch(() => false)) {
        await findAgencies.click({ force: true });
        logger.debug('PulsePoint: Clicked Find Agencies');
        await page.waitForTimeout(2000);
      }

      const searchInput = page.locator('input[placeholder*="Search agency"]');
      if (await searchInput.isVisible().catch(() => false)) {
        await searchInput.click({ force: true });
        await searchInput.fill(this.agency.zipCode);
        logger.debug(`PulsePoint: Searching for ZIP ${this.agency.zipCode}`);
        await page.waitForTimeout(3000);
      }

      const agencyRow = page.locator(`text=${this.agency.agencyMatcher}`).first();
      if (await agencyRow.isVisible().catch(() => false)) {
        await agencyRow.click({ force: true });
        logger.debug(`PulsePoint: Selected agency matching ${this.agency.agencyMatcher}`);
        await page.waitForTimeout(1000);
      } else {
        logger.warn(`PulsePoint: No agency matching ${this.agency.agencyMatcher} in search results`);
        return;
      }

      const modalSaveBtn = page.locator('[role="dialog"] button:has-text("Save")').first();
      if (await modalSaveBtn.isVisible().catch(() => false)) {
        await modalSaveBtn.click({ force: true });
        logger.debug('PulsePoint: Clicked Save in modal');
        await page.waitForTimeout(1500);
      }

      const saveViewBtn = page.locator('button:has-text("Save and View")');
      try {
        await saveViewBtn.waitFor({ state: 'visible', timeout: 5000 });
        const isDisabled = await saveViewBtn.evaluate((el) => (el as { disabled?: boolean }).disabled ?? false);
        if (!isDisabled) {
          await saveViewBtn.click({ force: true });
          logger.debug('PulsePoint: Clicked Save and View');
          await page.waitForTimeout(5000);
          this.isConfigured = true;
        } else {
          logger.warn('PulsePoint: Save and View button is disabled');
        }
      } catch {
        logger.warn('PulsePoint: Could not click Save and View');
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn(`PulsePoint agency selection failed: ${msg}`);
    }
  }

  private async extractIncidentsFromPage(page: Page): Promise<Incident[]> {
    const bodyText = await page.innerText('body');

    const parsedIncidents = this.parseIncidentText(bodyText);

    const cardTexts = await page.$$eval(
      '[class*="incident"], [class*="card"]',
      (cards) => cards.map((card) => card.textContent || '')
    );

    const cityPatternSource = this.agency.cityPattern.source;

    const structuredIncidents: Array<{
      type: string;
      address: string;
      time: string;
      units: string;
      status: string;
    }> = [];

    const cityRe = new RegExp(cityPatternSource, this.agency.cityPattern.flags || 'i');

    for (const text of cardTexts) {
      if (!text.includes('PM') && !text.includes('AM')) continue;

      const lines = text.split('\n').filter((l: string) => l.trim());
      if (lines.length < 2) continue;

      structuredIncidents.push({
        type: lines[0]?.trim() || '',
        address: lines.find((l: string) => cityRe.test(l))?.trim() || '',
        // Extract the bare time token (not the whole line): the id hashes
        // this value, and surrounding dynamic text would churn identities —
        // and disagree with the text-parse path's clean token.
        time: lines.map((l: string) => l.match(/(\d{1,2}:\d{2}\s*(?:AM|PM))/i)).find(Boolean)?.[1] || '',
        units: lines.filter((l: string) => /^[A-Z]\d+|^AMR\d+|^T\d+|^M\d+/.test(l)).join(' '),
        status: text.toLowerCase().includes('closed') ? 'closed' : 'active',
      });
    }

    const allIncidents = [...parsedIncidents];

    for (const si of structuredIncidents) {
      // Dedup on address AND type: two simultaneous calls at one address
      // (e.g. a fire plus a medical) are distinct incidents.
      if (si.address && !allIncidents.some(pi => pi.address === si.address && pi.type === si.type)) {
        allIncidents.push({
          type: si.type,
          address: si.address,
          time: si.time,
          units: si.units.split(/\s+/).filter(Boolean),
          status: si.status === 'closed' ? 'closed' : 'active',
        });
      }
    }

    const incidents: Incident[] = [];
    for (let idx = 0; idx < allIncidents.length; idx++) {
      const inc = allIncidents[idx];
      const incident = await this.normalizeIncident(inc, idx);
      incidents.push(incident);
    }

    return incidents;
  }

  private parseIncidentText(text: string): ParsedIncident[] {
    const incidents: ParsedIncident[] = [];
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const cityRe = this.agency.cityPattern;

    let currentIncident: Partial<ParsedIncident> | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      const typeMatch = Object.keys(CALL_TYPE_MAP).find(
        t => line.toLowerCase().includes(t) || t.includes(line.toLowerCase())
      );

      if (typeMatch || /^(Medical|Fire|Smoke|Traffic|Rescue|Hazmat|Gas|Alarm)/i.test(line)) {
        if (currentIncident?.type && currentIncident?.address) {
          incidents.push(currentIncident as ParsedIncident);
        }

        currentIncident = {
          type: line,
          address: '',
          time: '',
          units: [],
          status: 'active',
        };
        continue;
      }

      if (!currentIncident) continue;

      const timeMatch = line.match(/(\d{1,2}:\d{2}\s*(?:AM|PM))/i);
      if (timeMatch) {
        currentIncident.time = timeMatch[1];
        continue;
      }

      if (cityRe.test(line) || /^\d+\s+[A-Z]/.test(line) || /\b(?:ST|AVE|RD|BLVD|PL|DR|WAY|CT|LN)\b/i.test(line)) {
        if (!currentIncident.address) {
          currentIncident.address = line;
        }
        continue;
      }

      if (line.includes('CLOSED')) {
        currentIncident.status = 'closed';
        const durationMatch = line.match(/DURATION\s+(\d+[HM]\s*\d*[HM]?)/i);
        if (durationMatch) {
          currentIncident.duration = durationMatch[1];
        }
        continue;
      }

      const unitMatch = line.match(/^([A-Z]+\d+)$/);
      if (unitMatch) {
        currentIncident.units = currentIncident.units || [];
        currentIncident.units.push(unitMatch[1]);
        continue;
      }
    }

    if (currentIncident?.type && currentIncident?.address) {
      incidents.push(currentIncident as ParsedIncident);
    }

    return incidents;
  }

  private async normalizeIncident(raw: ParsedIncident, _index: number): Promise<Incident> {
    const typeInfo = this.getTypeInfo(raw.type);

    const stableId = this.generateStableId(raw.address, raw.type, raw.time);

    const geocoded = await geocache.geocode(raw.address, {
      city: this.agency.geocodeCity,
      state: this.agency.geocodeState,
      center: this.agency.fallbackCenter,
    });
    const coords = geocoded || this.estimateFallback(raw.address);

    return {
      id: `pulsepoint-${stableId}`,
      type: typeInfo.type,
      severity: typeInfo.severity,
      location: {
        lat: coords.lat,
        lng: coords.lng,
        address: raw.address || undefined,
      },
      timestamp: this.parseTime(raw.time),
      // Feed-derived and STABLE across scrapes: dispatch time plus a
      // deterministic fingerprint of the fields that actually change
      // (status, responding units). Stamping wall-clock `now` here re-sent
      // every PulsePoint incident to every client on each 2-minute scrape.
      updatedAt: this.contentVersion(raw),
      regionId: this.agency.regionId,
      source: 'pulsepoint',
      title: `${this.agency.titlePrefix}: ${raw.type}`,
      description: this.buildDescription(raw),
      status: raw.status === 'closed' ? 'cleared' : 'active',
      category: raw.type.toLowerCase(),
      metadata: {
        pulsePointType: raw.type,
        units: raw.units,
        duration: raw.duration,
        geocoded: geocoded ? !geocoded.cached : false,
        // True when the pin is NOT the exact address: street centroid
        // (geocoder degraded) or the synthetic region/quadrant fallback.
        // The frontend renders these differently — a confident-looking
        // pin blocks from the real scene misleads worse than no pin.
        approximate: geocoded ? geocoded.approximate : true,
      },
    };
  }

  // The dispatch time is part of the identity: without it, two simultaneous
  // same-type calls at one address collapse to one id, and a new call weeks
  // later at the same address+type resurrects the old cleared incident.
  private generateStableId(address: string, type: string, time: string): string {
    const key = `${address}-${type}-${time}`.toLowerCase();
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      const char = key.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }

  private getTypeInfo(callType: string): { type: IncidentType; severity: 1 | 2 | 3 | 4 | 5 } {
    const lower = callType.toLowerCase();

    for (const [key, value] of Object.entries(CALL_TYPE_MAP)) {
      if (lower.includes(key)) {
        return value;
      }
    }

    return { type: 'fire', severity: 3 };
  }

  /**
   * Deterministic fallback: place the incident near the configured center with a
   * small hash-derived offset. If the agency uses DC quadrants, apply the legacy
   * NW/NE/SW/SE offset on top.
   */
  private estimateFallback(address: string): { lat: number; lng: number } {
    let lat = this.agency.fallbackCenter.lat;
    let lng = this.agency.fallbackCenter.lng;

    if (this.agency.useDcQuadrantFallback) {
      const streetNumMatch = address.match(/^(\d+)\s/);
      const streetNum = streetNumMatch ? parseInt(streetNumMatch[1], 10) : 0;

      let quadLat = 0;
      let quadLng = 0;

      if (address.includes(' NW')) {
        quadLat = 0.025; quadLng = -0.025;
      } else if (address.includes(' NE')) {
        quadLat = 0.025; quadLng = 0.015;
      } else if (address.includes(' SW')) {
        quadLat = -0.015; quadLng = -0.025;
      } else if (address.includes(' SE')) {
        quadLat = -0.015; quadLng = 0.015;
      }

      if (streetNum > 0) {
        const distFactor = Math.min(streetNum / 5000, 0.03);
        quadLat *= (1 + distFactor);
        quadLng *= (1 + distFactor);
      }

      lat += quadLat;
      lng += quadLng;
    }

    const hash = this.simpleHash(address);
    lat += ((hash % 100) - 50) * 0.0001;
    lng += (((hash >> 8) % 100) - 50) * 0.0001;

    return { lat, lng };
  }

  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  private parseTime(timeStr: string): string {
    if (!timeStr) return new Date().toISOString();

    try {
      const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
      if (match) {
        let hours = parseInt(match[1], 10);
        const minutes = parseInt(match[2], 10);
        const isPM = match[3].toUpperCase() === 'PM';

        if (isPM && hours !== 12) hours += 12;
        if (!isPM && hours === 12) hours = 0;

        // The context is pinned to the agency timezone, so the scraped
        // wall-clock is agency-local — convert from that zone, not the host's.
        const today = todayInZone(this.agency.timezone);
        let ts = wallClockToUtcMs(today.year, today.month, today.day, hours, minutes, 0, this.agency.timezone);

        // Midnight rollover: "11:55 PM" scraped at 12:10 AM belongs to
        // yesterday — a future timestamp would evade the 24h age sweep for
        // nearly two days.
        if (ts > Date.now() + 5 * 60 * 1000) {
          ts -= 24 * 60 * 60 * 1000;
        }

        return new Date(ts).toISOString();
      }
    } catch {
      // fall through
    }

    return new Date().toISOString();
  }

  /**
   * Deterministic sub-minute offset on the dispatch time, derived from the
   * mutable fields: same content -> same updatedAt (no rebroadcast), a
   * status flip or unit change -> new updatedAt (one rebroadcast).
   */
  private contentVersion(raw: { time?: string; status?: string; units?: unknown }): string {
    // No parseable time -> anchor at epoch, NOT wall-clock: parseTime('')
    // falls back to `now`, which would re-version (and rebroadcast) the
    // incident on every scrape — the exact churn this fingerprint removes.
    const base = raw.time ? Date.parse(this.parseTime(raw.time)) : 0;
    const content = `${raw.status ?? ''}|${raw.units ?? ''}`;
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      hash = (hash * 31 + content.charCodeAt(i)) >>> 0;
    }
    return new Date((Number.isNaN(base) ? 0 : base) + (hash % 60000)).toISOString();
  }

  private buildDescription(raw: ParsedIncident): string {
    const parts: string[] = [];

    parts.push(raw.type);

    if (raw.address) {
      parts.push(`Location: ${raw.address}`);
    }

    if (raw.units && raw.units.length > 0) {
      parts.push(`Units: ${raw.units.join(', ')}`);
    }

    if (raw.status === 'closed' && raw.duration) {
      parts.push(`Closed - Duration: ${raw.duration}`);
    }

    return parts.join('\n');
  }

  async shutdown(): Promise<void> {
    if (this.persistentPage) {
      await this.persistentPage.close().catch(() => {});
      this.persistentPage = null;
    }
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
    this.isConfigured = false;
  }
}
