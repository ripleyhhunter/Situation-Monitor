/**
 * PulsePoint Fetcher
 * 
 * Fetches real-time Fire/EMS incident data from PulsePoint by rendering
 * their web app with a headless browser and extracting the data.
 * 
 * DC Fire/EMS Agency ID: EMS1205
 */

import { chromium, Browser, Page } from 'playwright';
import { BaseFetcher } from './base.js';
import type { Incident, IncidentType } from '../types/index.js';
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
  
  constructor() {
    super('pulsepoint', config.cacheTtl.scanner || 60);
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
      geolocation: { latitude: 38.9072, longitude: -77.0369 },
      permissions: ['geolocation'],
      // Store data in a persistent location
      storageState: undefined,
    });
    
    this.persistentPage = await context.newPage();
    this.isConfigured = false;
    
    return this.persistentPage;
  }

  private async dismissOverlays(page: Page): Promise<void> {
    // Common overlay/modal dismissal patterns
    const dismissSelectors = [
      // Cookie consent
      'button:has-text("Accept")',
      'button:has-text("Accept All")',
      'button:has-text("I Accept")',
      'button:has-text("OK")',
      'button:has-text("Got it")',
      'button:has-text("Continue")',
      '[aria-label="Close"]',
      '[aria-label="Dismiss"]',
      'button:has-text("Close")',
      '.modal-close',
      '.close-button',
      // PulsePoint specific
      'button:has-text("Skip")',
      'button:has-text("Maybe Later")',
    ];

    for (const selector of dismissSelectors) {
      try {
        const btn = await page.$(selector);
        if (btn) {
          const isVisible = await btn.isVisible();
          if (isVisible) {
            await btn.click({ timeout: 2000 }).catch(() => {});
            logger.debug(`PulsePoint: Dismissed overlay with ${selector}`);
            await page.waitForTimeout(500);
          }
        }
      } catch {
        // Continue trying other selectors
      }
    }

    // Also try pressing Escape to close any modals
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(300);
  }

  protected async fetchFromApi(): Promise<Incident[]> {
    // Rate limit to avoid hammering PulsePoint
    const now = Date.now();
    if (now - this.lastFetchTime < this.minFetchInterval) {
      logger.debug('PulsePoint: Skipping fetch (rate limited)');
      return [];
    }
    this.lastFetchTime = now;
    
    try {
      // Use persistent page to maintain session
      const page = await this.getPersistentPage();
      
      // Check if we need to navigate or reconfigure
      const currentUrl = page.url();
      if (!currentUrl.includes('pulsepoint.org') || !this.isConfigured) {
        logger.debug('PulsePoint: Loading web app...');
        await page.goto('https://web.pulsepoint.org/', { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForTimeout(2000);
        
        // Complete the agency selection flow
        if (!this.isConfigured && this.configAttempts < this.maxConfigAttempts) {
          this.configAttempts++;
          await this.selectDCAgency(page);
        }
      } else {
        // Just refresh to get latest data
        logger.debug('PulsePoint: Refreshing page for latest incidents...');
        await page.reload({ waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForTimeout(3000);
      }
      
      // Extract incidents from the rendered page
      const incidents = await this.extractIncidentsFromPage(page);
      
      if (incidents.length > 0) {
        this.isConfigured = true;
        this.configAttempts = 0; // Reset on success
      }
      
      logger.info(`PulsePoint: Extracted ${incidents.length} incidents`);
      return incidents;
      
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn(`PulsePoint fetch failed: ${msg}`);
      
      // Close the persistent page so it gets recreated next time
      if (this.persistentPage) {
        await this.persistentPage.close().catch(() => {});
        this.persistentPage = null;
        this.isConfigured = false;
      }
      
      return [];
    }
  }

  private async selectDCAgency(page: Page): Promise<void> {
    try {
      // Check if we're already on the incident view (Active incidents visible)
      const activeText = await page.$('text=Active');
      if (activeText) {
        const pageText = await page.innerText('body');
        if (pageText.includes('WASHINGTON, DC')) {
          logger.debug('PulsePoint: Already on incident view');
          this.isConfigured = true;
          return;
        }
      }

      // Step 1: Click "Create New Feed" if visible
      const createFeedBtn = page.locator('button:has-text("Create New Feed")');
      if (await createFeedBtn.isVisible().catch(() => false)) {
        await createFeedBtn.click({ force: true });
        logger.debug('PulsePoint: Clicked Create New Feed');
        await page.waitForTimeout(2000);
      }
      
      // Step 2: Click "Find Agencies" to open the search modal
      const findAgencies = page.locator('text=Find Agencies').first();
      if (await findAgencies.isVisible().catch(() => false)) {
        await findAgencies.click({ force: true });
        logger.debug('PulsePoint: Clicked Find Agencies');
        await page.waitForTimeout(2000);
      }
      
      // Step 3: Find the search input by placeholder and search by ZIP code
      const searchInput = page.locator('input[placeholder*="Search agency"]');
      if (await searchInput.isVisible().catch(() => false)) {
        await searchInput.click({ force: true });
        await searchInput.fill('20001'); // DC ZIP code
        logger.debug('PulsePoint: Searching for ZIP 20001');
        await page.waitForTimeout(3000); // Wait for search results
      }
      
      // Step 4: Click on DC Fire and EMS in the results
      const dcAgency = page.locator('text=/DC Fire and EMS/i').first();
      if (await dcAgency.isVisible().catch(() => false)) {
        await dcAgency.click({ force: true });
        logger.debug('PulsePoint: Selected DC Fire and EMS');
        await page.waitForTimeout(1000);
      } else {
        logger.warn('PulsePoint: DC Fire and EMS not found in search results');
        return;
      }
      
      // Step 5: Click Save in the modal
      const modalSaveBtn = page.locator('[role="dialog"] button:has-text("Save")').first();
      if (await modalSaveBtn.isVisible().catch(() => false)) {
        await modalSaveBtn.click({ force: true });
        logger.debug('PulsePoint: Clicked Save in modal');
        await page.waitForTimeout(1500);
      }
      
      // Step 6: Click "Save and View" to load incidents
      const saveViewBtn = page.locator('button:has-text("Save and View")');
      try {
        await saveViewBtn.waitFor({ state: 'visible', timeout: 5000 });
        
        // Check if button is enabled
        const isDisabled = await saveViewBtn.evaluate((el) => (el as { disabled?: boolean }).disabled ?? false);
        if (!isDisabled) {
          await saveViewBtn.click({ force: true });
          logger.debug('PulsePoint: Clicked Save and View');
          await page.waitForTimeout(5000); // Wait for incidents to load
          this.isConfigured = true;
        } else {
          logger.warn('PulsePoint: Save and View button is disabled');
        }
      } catch (e) {
        logger.warn('PulsePoint: Could not click Save and View');
      }
      
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn(`PulsePoint agency selection failed: ${msg}`);
    }
  }

  private async extractIncidentsFromPage(page: Page): Promise<Incident[]> {
    // Get the incident text from the page using innerText()
    const bodyText = await page.innerText('body');
    
    // Parse incident data from the text
    const parsedIncidents = this.parseIncidentText(bodyText);
    
    // Extract incident card text content for additional parsing
    const cardTexts = await page.$$eval(
      '[class*="incident"], [class*="card"]',
      (cards) => cards.map((card) => card.textContent || '')
    );
    
    // Parse structured incidents from card texts on Node.js side
    const structuredIncidents: Array<{
      type: string;
      address: string;
      time: string;
      units: string;
      status: string;
    }> = [];
    
    for (const text of cardTexts) {
      if (!text.includes('PM') && !text.includes('AM')) continue;
      
      const lines = text.split('\n').filter((l: string) => l.trim());
      if (lines.length < 2) continue;
      
      structuredIncidents.push({
        type: lines[0]?.trim() || '',
        address: lines.find((l: string) => l.includes('WASHINGTON, DC'))?.trim() || '',
        time: lines.find((l: string) => /\d+:\d+\s*(AM|PM)/i.test(l))?.trim() || '',
        units: lines.filter((l: string) => /^[A-Z]\d+|^AMR\d+|^T\d+|^M\d+/.test(l)).join(' '),
        status: text.toLowerCase().includes('closed') ? 'closed' : 'active',
      });
    }
    
    // Combine parsed incidents
    const allIncidents = [...parsedIncidents];
    
    // Add structured incidents if we found any unique ones
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
    
    // Convert to our Incident format with geocoding
    // Process sequentially to respect rate limits
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
    
    let currentIncident: Partial<ParsedIncident> | null = null;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Check if this is an incident type
      const typeMatch = Object.keys(CALL_TYPE_MAP).find(
        t => line.toLowerCase().includes(t) || t.includes(line.toLowerCase())
      );
      
      if (typeMatch || /^(Medical|Fire|Smoke|Traffic|Rescue|Hazmat|Gas|Alarm)/i.test(line)) {
        // Save previous incident
        if (currentIncident?.type && currentIncident?.address) {
          incidents.push(currentIncident as ParsedIncident);
        }
        
        // Start new incident
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
      
      // Check for time
      const timeMatch = line.match(/(\d{1,2}:\d{2}\s*(?:AM|PM))/i);
      if (timeMatch) {
        currentIncident.time = timeMatch[1];
        continue;
      }
      
      // Check for address (contains WASHINGTON, DC or street indicators)
      if (line.includes('WASHINGTON, DC') || /^\d+\s+[A-Z]/.test(line) || /\b(?:ST|AVE|RD|BLVD|PL|DR|WAY|CT|LN)\b/i.test(line)) {
        if (!currentIncident.address) {
          currentIncident.address = line;
        }
        continue;
      }
      
      // Check for CLOSED status
      if (line.includes('CLOSED')) {
        currentIncident.status = 'closed';
        const durationMatch = line.match(/DURATION\s+(\d+[HM]\s*\d*[HM]?)/i);
        if (durationMatch) {
          currentIncident.duration = durationMatch[1];
        }
        continue;
      }
      
      // Check for unit IDs (E1, M5, A12, T33, AMR85, etc.)
      const unitMatch = line.match(/^([A-Z]+\d+)$/);
      if (unitMatch) {
        currentIncident.units = currentIncident.units || [];
        currentIncident.units.push(unitMatch[1]);
        continue;
      }
    }
    
    // Add last incident
    if (currentIncident?.type && currentIncident?.address) {
      incidents.push(currentIncident as ParsedIncident);
    }
    
    return incidents;
  }

  private async normalizeIncident(raw: ParsedIncident, _index: number): Promise<Incident> {
    const now = new Date().toISOString();
    const typeInfo = this.getTypeInfo(raw.type);
    
    // Generate stable ID based on address and type (so same incident doesn't get new ID each fetch)
    const stableId = this.generateStableId(raw.address, raw.type);
    
    // Use centralized geocache service (persisted to Redis)
    const geocoded = await geocache.geocode(raw.address);
    const coords = geocoded || this.estimateFromQuadrant(raw.address);
    
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
      source: 'pulsepoint', // Use dedicated source to prevent cross-clearing with alertdc
      title: `DCFD: ${raw.type}`,
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
  
  /**
   * Generate a stable ID based on address and type
   * This prevents the same incident from getting a new ID each time we fetch
   */
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
    
    // Default to fire/EMS with medium severity
    return { type: 'fire', severity: 3 };
  }

  /**
   * Fallback: estimate coordinates based on quadrant
   * More granular than before - uses street numbers when available
   */
  private estimateFromQuadrant(address: string): { lat: number; lng: number } {
    // DC center (Capitol building)
    let lat = 38.8899;
    let lng = -77.0091;
    
    // Extract street number if present
    const streetNumMatch = address.match(/^(\d+)\s/);
    const streetNum = streetNumMatch ? parseInt(streetNumMatch[1], 10) : 0;
    
    // Determine quadrant offset
    let quadLat = 0;
    let quadLng = 0;
    
    if (address.includes(' NW')) {
      quadLat = 0.025;
      quadLng = -0.025;
    } else if (address.includes(' NE')) {
      quadLat = 0.025;
      quadLng = 0.015;
    } else if (address.includes(' SW')) {
      quadLat = -0.015;
      quadLng = -0.025;
    } else if (address.includes(' SE')) {
      quadLat = -0.015;
      quadLng = 0.015;
    }
    
    // Use street number to estimate distance from center
    // Higher numbers = further from center (roughly)
    if (streetNum > 0) {
      const distFactor = Math.min(streetNum / 5000, 0.03);
      quadLat *= (1 + distFactor);
      quadLng *= (1 + distFactor);
    }
    
    lat += quadLat;
    lng += quadLng;
    
    // Add small deterministic offset based on address hash (not random!)
    // This ensures same address always gets same location
    const hash = this.simpleHash(address);
    lat += ((hash % 100) - 50) * 0.0001;
    lng += (((hash >> 8) % 100) - 50) * 0.0001;
    
    return { lat, lng };
  }
  
  /**
   * Simple string hash for deterministic offsets
   */
  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
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
      // Fall through to default
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

  /**
   * Clean up browser on shutdown
   */
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

export const pulsePointFetcher = new PulsePointFetcher();
export default pulsePointFetcher;
