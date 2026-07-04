import { BaseFetcher } from './base.js';
import type { Incident, IncidentType } from '../types/index.js';
import config from '../config.js';
import logger from '../logger.js';
import { geocache } from '../services/geocache.js';
import { wallClockToUtcMs } from '../utils/timezone.js';

interface AlertItem {
  title: string;
  description: string;
  pubDate: string;
  link?: string;
}

export class AlertDCFetcher extends BaseFetcher<Incident> {
  readonly incidentSource = 'alertdc' as const;

  constructor() {
    super('alertdc', config.cacheTtl.crime);
  }

  protected async fetchFromApi(): Promise<Incident[]> {
    // The AlertDC feed returns HTML with alerts in a table format
    const url = 'https://trainingtrack.hsema.dc.gov/NRss/RssFeed/AlertDCList';

    try {
      // httpGetText gives the shared 30s AbortController timeout + retries —
      // a raw fetch here could hang on a wedged upstream socket indefinitely.
      const html = await this.httpGetText(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Accept: 'text/html,application/xhtml+xml,*/*',
        },
      });

      // Check if we got RSS or HTML
      if (html.trim().startsWith('<?xml') || html.includes('<rss') || html.includes('<feed')) {
        return this.parseRSS(html);
      }

      // Parse HTML table format
      const items = this.parseHTML(html);

      // 'alertdc' is a complete-listing source: zero parsed rows from a
      // substantive page means the markup drifted (the feed has changed
      // format before), and returning [] would cross-clear every live
      // alert. A genuinely empty feed is a small stub page.
      if (items.length === 0 && html.length > 2000) {
        throw new Error('AlertDC: page returned but no alerts parsed (markup drift?)');
      }

      const incidents: Incident[] = [];
      for (const item of items) {
        const incident = await this.normalizeAlert(item);
        if (incident) {
          incidents.push(incident);
        }
      }
      return incidents;
    } catch (error) {
      logger.error('Failed to fetch AlertDC feed', { error });
      throw error;
    }
  }

  private async parseRSS(xml: string): Promise<Incident[]> {
    const items: AlertItem[] = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
    let match;

    while ((match = itemRegex.exec(xml)) !== null) {
      const itemXml = match[1];
      const title = this.extractTag(itemXml, 'title');
      const description = this.extractTag(itemXml, 'description');
      const pubDate = this.extractTag(itemXml, 'pubDate');

      if (title && pubDate) {
        items.push({
          title: this.decodeHtmlEntities(title),
          description: this.decodeHtmlEntities(description || ''),
          pubDate,
        });
      }
    }

    const incidents: Incident[] = [];
    for (const item of items) {
      const incident = await this.normalizeAlert(item);
      if (incident) {
        incidents.push(incident);
      }
    }
    return incidents;
  }

  private parseHTML(html: string): AlertItem[] {
    const items: AlertItem[] = [];

    // Structure: <tr>
    //   <td class="head">DATE</td>
    //   <td class="head"><b><a href="...">TITLE</a></b><br/>DESCRIPTION</td>
    // </tr>
    const rowRegex = /<tr[^>]*>[\s\S]*?<td[^>]*class="head"[^>]*>([\s\S]*?)<\/td>[\s\S]*?<td[^>]*class="head"[^>]*>([\s\S]*?)<\/td>[\s\S]*?<\/tr>/gi;

    let match;
    while ((match = rowRegex.exec(html)) !== null) {
      const dateStr = this.stripHtml(match[1]).trim();
      const contentHtml = match[2];

      // Extract title from <a> tag
      const titleMatch = contentHtml.match(/<a[^>]*>([^<]*)<\/a>/i);
      const title = titleMatch ? this.stripHtml(titleMatch[1]) : '';

      // Get full description (everything after stripping HTML)
      const description = this.stripHtml(contentHtml);

      if (dateStr && (title || description)) {
        items.push({
          title: title || description.substring(0, 100),
          description,
          pubDate: dateStr,
        });
      }
    }

    return items;
  }

  private extractTag(xml: string, tag: string): string | null {
    const cdataRegex = new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i');
    const cdataMatch = xml.match(cdataRegex);
    if (cdataMatch) return cdataMatch[1].trim();

    const regex = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i');
    const match = xml.match(regex);
    return match ? match[1].trim() : null;
  }

  private stripHtml(text: string): string {
    return text
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  private decodeHtmlEntities(text: string): string {
    return this.stripHtml(text);
  }

  private async normalizeAlert(item: AlertItem): Promise<Incident | null> {
    const titleLower = item.title.toLowerCase();
    const descLower = item.description.toLowerCase();

    // Skip resolved/cleared alerts
    if (
      titleLower.includes('resolved') ||
      titleLower.includes('cleared') ||
      titleLower.includes('all clear') ||
      descLower.includes('has been resolved') ||
      descLower.includes('scene is clear')
    ) {
      return null;
    }

    // Determine incident type and severity
    const { type, severity } = this.categorizeAlert(titleLower, descLower);

    // Parse date - format: "1/11/2026 6:25:00 AM" or similar
    const timestamp = this.parseDate(item.pubDate);

    // Generate unique ID from title and date
    const id = this.generateId(item.title, timestamp);

    // Extract and geocode location from description
    const location = await this.extractAndGeocodeLocation(item.description);

    return {
      id: `alertdc-${id}`,
      type,
      severity,
      location: {
        lat: location.lat,
        lng: location.lng,
        address: location.address,
      },
      timestamp,
      // Feed-derived so unchanged alerts don't re-broadcast every poll
      updatedAt: timestamp,
      regionId: 'dc',
      source: 'alertdc',
      title: item.title,
      description: item.description,
      status: 'active',
      category: this.getCategory(titleLower, descLower),
      metadata: {
        link: item.link,
        rawPubDate: item.pubDate,
        geocoded: location.geocoded,
      },
    };
  }

  private categorizeAlert(
    title: string,
    description: string
  ): { type: IncidentType; severity: 1 | 2 | 3 | 4 | 5 } {
    // Crime alerts
    if (
      title.includes('lookout') ||
      title.includes('robbery') ||
      title.includes('assault') ||
      title.includes('shooting') ||
      title.includes('stabbing') ||
      title.includes('homicide') ||
      title.includes('armed') ||
      description.includes('suspect description')
    ) {
      const severity = this.getCrimeSeverity(title, description);
      return { type: 'crime', severity };
    }

    // Weather alerts
    if (
      title.includes('cold alert') ||
      title.includes('heat alert') ||
      title.includes('weather') ||
      title.includes('storm') ||
      title.includes('flood') ||
      title.includes('tornado') ||
      title.includes('snow')
    ) {
      return { type: 'weather', severity: 3 };
    }

    // Traffic/road alerts
    if (
      title.includes('road closure') ||
      title.includes('street closure') ||
      title.includes('traffic') ||
      title.includes('crash') ||
      title.includes('accident') ||
      description.includes('closure') ||
      description.includes('detour')
    ) {
      return { type: 'traffic', severity: 2 };
    }

    // Fire/EMS
    if (
      title.includes('fire') ||
      title.includes('hazmat') ||
      title.includes('gas leak') ||
      title.includes('explosion')
    ) {
      return { type: 'fire', severity: 4 };
    }

    // AMBER alerts and missing persons
    if (title.includes('amber') || title.includes('missing')) {
      return { type: 'crime', severity: 5 };
    }

    // Default to hazard for other alerts
    return { type: 'hazard', severity: 3 };
  }

  private getCrimeSeverity(title: string, description: string): 1 | 2 | 3 | 4 | 5 {
    const text = `${title} ${description}`;

    if (
      text.includes('homicide') ||
      text.includes('murder') ||
      text.includes('fatal')
    ) {
      return 5;
    }

    if (
      text.includes('shooting') ||
      text.includes('stabbing') ||
      text.includes('armed robbery') ||
      text.includes('carjacking')
    ) {
      return 4;
    }

    if (
      text.includes('robbery') ||
      text.includes('assault') ||
      text.includes('weapon')
    ) {
      return 3;
    }

    return 2;
  }

  private getCategory(title: string, description: string): string {
    const text = `${title} ${description}`;

    if (text.includes('cold alert')) return 'cold emergency';
    if (text.includes('heat alert')) return 'heat emergency';
    if (text.includes('robbery')) return 'robbery';
    if (text.includes('shooting')) return 'shooting';
    if (text.includes('stabbing')) return 'stabbing';
    if (text.includes('assault')) return 'assault';
    if (text.includes('amber')) return 'amber alert';
    if (text.includes('missing')) return 'missing person';
    if (text.includes('fire')) return 'fire';
    if (text.includes('crash') || text.includes('accident')) return 'crash';
    if (text.includes('closure')) return 'road closure';

    return 'alert';
  }

  private parseDate(dateStr: string): string {
    try {
      // The feed emits zone-less US/Eastern wall-clock strings like
      // "1/11/2026 6:25:00 AM". new Date() would interpret them in the
      // HOST's zone (e.g. 2h skew on a Mountain-time machine), shifting
      // every alert's displayed time and its 24h-cleanup timing.
      const eastern = this.parseEasternWallClock(dateStr);
      if (eastern) return eastern;

      // Strings that carry their own zone (RSS pubDate etc.) parse directly.
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        return date.toISOString();
      }

      // Fallback to current time
      return new Date().toISOString();
    } catch {
      return new Date().toISOString();
    }
  }

  /** Parse "M/D/YYYY h:mm[:ss] AM/PM" as America/New_York wall-clock time. */
  private parseEasternWallClock(dateStr: string): string | null {
    const m = dateStr.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)$/i);
    if (!m) return null;

    const [, mo, d, y, h, min, sec, ap] = m;
    let hour = parseInt(h, 10) % 12;
    if (ap.toUpperCase() === 'PM') hour += 12;

    return new Date(
      wallClockToUtcMs(+y, +mo, +d, hour, +min, +(sec || 0), 'America/New_York'),
    ).toISOString();
  }

  private generateId(title: string, timestamp: string): string {
    // Create a simple hash from title and date
    const str = `${title}-${timestamp}`;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Extract address from description and geocode it using centralized geocache
   */
  private async extractAndGeocodeLocation(description: string): Promise<{
    lat: number;
    lng: number;
    address?: string;
    geocoded: boolean;
  }> {
    // Try to extract address from description
    const address = this.extractAddress(description);
    
    if (address) {
      // Use centralized geocache service (persisted to Redis).
      // AlertDC is inherently a DC feed, so the region context is fixed.
      const result = await geocache.geocode(address, {
        city: 'Washington',
        state: 'DC',
        center: { lat: 38.9072, lng: -77.0369 },
      });
      if (result) {
        return {
          lat: result.lat,
          lng: result.lng,
          address,
          geocoded: !result.cached,
        };
      }
    }
    
    // Fall back to deterministic offset
    const offset = this.deterministicOffset(description);
    return {
      lat: config.defaultLat + offset.latOffset,
      lng: config.defaultLng + offset.lngOffset,
      address: address || undefined,
      geocoded: false,
    };
  }

  /**
   * Extract address patterns from alert description
   */
  private extractAddress(description: string): string | null {
    // Try various address patterns
    
    // Pattern: "1200 block of K Street NW"
    const blockMatch = description.match(/(\d+)\s*block\s+(?:of\s+)?([^,.\n]+(?:NW|NE|SW|SE)?)/i);
    if (blockMatch) {
      let addr = `${blockMatch[1]} ${blockMatch[2].trim()}`;
      if (!addr.toLowerCase().includes('washington')) {
        addr += ', Washington, DC';
      }
      return addr;
    }
    
    // Pattern: "14th and U Streets NW" or "14th & U Street"
    const intersectionMatch = description.match(/(\d+(?:st|nd|rd|th)?|\w+)\s+(?:and|&)\s+(\w+)\s*(?:Street|St|Avenue|Ave|Road|Rd|Place|Pl|Drive|Dr)s?\s*(NW|NE|SW|SE)?/i);
    if (intersectionMatch) {
      let addr = `${intersectionMatch[1]} and ${intersectionMatch[2]} Street`;
      if (intersectionMatch[3]) {
        addr += ` ${intersectionMatch[3]}`;
      }
      addr += ', Washington, DC';
      return addr;
    }
    
    // Pattern: "at 1234 Main Street NW"
    const atMatch = description.match(/(?:at|near|on)\s+(\d+\s+[A-Za-z]+(?:\s+[A-Za-z]+)?\s*(?:Street|St|Avenue|Ave|Road|Rd|Place|Pl|Drive|Dr|Way|Boulevard|Blvd)\s*(?:NW|NE|SW|SE)?)/i);
    if (atMatch) {
      let addr = atMatch[1].trim();
      if (!addr.toLowerCase().includes('washington')) {
        addr += ', Washington, DC';
      }
      return addr;
    }
    
    // Pattern: Just "NW" or quadrant with street name
    const streetMatch = description.match(/(\d+\s+[A-Za-z]+(?:\s+[A-Za-z]+)?\s*(?:Street|St|Avenue|Ave|Road|Rd|Place|Pl|Drive|Dr|Way|Boulevard|Blvd)\s*(?:NW|NE|SW|SE))/i);
    if (streetMatch) {
      return streetMatch[1].trim() + ', Washington, DC';
    }
    
    return null;
  }

  /**
   * Generate a deterministic offset for locations that couldn't be geocoded.
   * Uses a simple hash to ensure the same description always maps to the same location.
   */
  private deterministicOffset(text: string): { latOffset: number; lngOffset: number } {
    let hash1 = 0;
    let hash2 = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash1 = ((hash1 << 5) - hash1 + char) & 0xffffffff;
      hash2 = ((hash2 << 7) - hash2 + char) & 0xffffffff;
    }

    const latOffset = ((hash1 % 10000) / 10000 - 0.5) * 0.05;
    const lngOffset = ((hash2 % 10000) / 10000 - 0.5) * 0.05;

    return { latOffset, lngOffset };
  }
}

export const alertDCFetcher = new AlertDCFetcher();
export default alertDCFetcher;
