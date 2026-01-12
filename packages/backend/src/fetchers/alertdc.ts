import { BaseFetcher } from './base.js';
import type { Incident, IncidentType } from '../types/index.js';
import config from '../config.js';
import logger from '../logger.js';

interface AlertItem {
  title: string;
  description: string;
  pubDate: string;
}

export class AlertDCFetcher extends BaseFetcher<Incident> {
  constructor() {
    super('alertdc', config.cacheTtl.crime);
  }

  protected async fetchFromApi(): Promise<Incident[]> {
    // The AlertDC feed returns HTML with alerts in a table format
    const url = 'https://trainingtrack.hsema.dc.gov/NRss/RssFeed/AlertDCList';

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Accept: 'text/html,application/xhtml+xml,*/*',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const html = await response.text();

      // Check if we got RSS or HTML
      if (html.trim().startsWith('<?xml') || html.includes('<rss') || html.includes('<feed')) {
        return this.parseRSS(html);
      }

      // Parse HTML table format
      const items = this.parseHTML(html);

      return items
        .map((item) => this.normalizeAlert(item))
        .filter((incident): incident is Incident => incident !== null);
    } catch (error) {
      logger.error('Failed to fetch AlertDC feed', { error });
      throw error;
    }
  }

  private parseRSS(xml: string): Incident[] {
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

    return items
      .map((item) => this.normalizeAlert(item))
      .filter((incident): incident is Incident => incident !== null);
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

  private normalizeAlert(item: AlertItem): Incident | null {
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

    // Extract location from description if possible
    const location = this.extractLocation(item.description);

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
      updatedAt: new Date().toISOString(),
      source: 'alertdc',
      title: item.title,
      description: item.description,
      status: 'active',
      category: this.getCategory(titleLower, descLower),
      metadata: {
        link: item.link,
        rawPubDate: item.pubDate,
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
      // Try parsing various date formats
      // Format: "1/11/2026 6:25:00 AM" or "1/11/2026 6:25 AM"
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

  private extractLocation(description: string): {
    lat: number;
    lng: number;
    address?: string;
  } {
    // Try to extract block/street address from description
    // Common patterns: "1200 block of K Street", "14th and U Streets"
    const blockMatch = description.match(/(\d+)\s*block\s+(?:of\s+)?([^,.\n]+)/i);
    const intersectionMatch = description.match(/(\w+)\s+(?:and|&)\s+(\w+)\s+(?:Street|St|Avenue|Ave|Road|Rd)/i);

    let address: string | undefined;

    if (blockMatch) {
      address = `${blockMatch[1]} block of ${blockMatch[2].trim()}`;
    } else if (intersectionMatch) {
      address = `${intersectionMatch[1]} and ${intersectionMatch[2]}`;
    }

    // Use deterministic offset based on description hash so alerts don't jump around
    // In production, you'd geocode the address via a service like Google Maps or Nominatim
    // For now, we spread alerts within DC bounds based on a hash of the description
    const offset = this.deterministicOffset(description);

    return {
      lat: config.defaultLat + offset.latOffset,
      lng: config.defaultLng + offset.lngOffset,
      address,
    };
  }

  /**
   * Generate a deterministic offset for locations without coordinates.
   * Uses a simple hash to ensure the same description always maps to the same location.
   * This prevents markers from jumping around on each data refresh.
   *
   * TODO: Integrate a geocoding service (Nominatim, Google Maps, etc.) for accurate locations.
   */
  private deterministicOffset(text: string): { latOffset: number; lngOffset: number } {
    // Create a simple hash from the text
    let hash1 = 0;
    let hash2 = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash1 = ((hash1 << 5) - hash1 + char) & 0xffffffff;
      hash2 = ((hash2 << 7) - hash2 + char) & 0xffffffff;
    }

    // Convert to offset in range [-0.025, 0.025] (roughly DC bounds)
    // This spreads alerts across approximately 3 miles in each direction
    const latOffset = ((hash1 % 10000) / 10000 - 0.5) * 0.05;
    const lngOffset = ((hash2 % 10000) / 10000 - 0.5) * 0.05;

    return { latOffset, lngOffset };
  }
}

export const alertDCFetcher = new AlertDCFetcher();
export default alertDCFetcher;
