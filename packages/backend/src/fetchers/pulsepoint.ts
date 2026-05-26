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

    const browser = await this.getBrowser();
    const context = await browser.newContext({
      geolocation: { latitude: this.agency.browserLat, longitude: this.agency.browserLng },
      permissions: ['geolocation'],
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
        await this.persistentPage.close().catch(() => {});
        this.persistentPage = null;
        this.isConfigured = false;
      }

      return [];
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
        time: lines.find((l: string) => /\d+:\d+\s*(AM|PM)/i.test(l))?.trim() || '',
        units: lines.filter((l: string) => /^[A-Z]\d+|^AMR\d+|^T\d+|^M\d+/.test(l)).join(' '),
        status: text.toLowerCase().includes('closed') ? 'closed' : 'active',
      });
    }

    const allIncidents = [...parsedIncidents];

    for (const si of structuredIncidents) {
      if (si.address && !allIncidents.some(pi => pi.address === si.address)) {
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
    const now = new Date().toISOString();
    const typeInfo = this.getTypeInfo(raw.type);

    const stableId = this.generateStableId(raw.address, raw.type);

    const geocoded = await geocache.geocode(raw.address);
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
      updatedAt: now,
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
      },
    };
  }

  private generateStableId(address: string, type: string): string {
    const key = `${address}-${type}`.toLowerCase();
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
      const now = new Date();
      const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
      if (match) {
        let hours = parseInt(match[1], 10);
        const minutes = parseInt(match[2], 10);
        const isPM = match[3].toUpperCase() === 'PM';

        if (isPM && hours !== 12) hours += 12;
        if (!isPM && hours === 12) hours = 0;

        now.setHours(hours, minutes, 0, 0);
        return now.toISOString();
      }
    } catch {
      // fall through
    }

    return new Date().toISOString();
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
