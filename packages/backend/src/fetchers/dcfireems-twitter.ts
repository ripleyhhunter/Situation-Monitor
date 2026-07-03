/**
 * DC Fire/EMS Twitter Feed Fetcher
 * 
 * Fetches incident data from the @dcfireems Twitter account.
 * 
 * DC Fire/EMS tweets working fires, significant medical calls, and
 * other major incidents with locations. This is currently the ONLY
 * source of real-time Fire/EMS dispatch data for DC.
 * 
 * Configuration options:
 * 1. X/Twitter API v2 (requires paid subscription - $100/month Basic tier)
 * 2. RSS.app or similar service (may require subscription)
 * 3. Self-hosted Nitter instance with RSS (unreliable)
 * 
 * Set TWITTER_BEARER_TOKEN in .env to enable.
 */

import { BaseFetcher } from './base.js';
import type { Incident, IncidentType } from '../types/index.js';
import config from '../config.js';
import logger from '../logger.js';

interface Tweet {
  id: string;
  text: string;
  created_at: string;
  author_id?: string;
  geo?: {
    place_id?: string;
    coordinates?: {
      type: string;
      coordinates: [number, number]; // [lng, lat]
    };
  };
  entities?: {
    annotations?: Array<{
      type: string;
      normalized_text: string;
    }>;
  };
}

interface TwitterResponse {
  data?: Tweet[];
  meta?: {
    result_count: number;
    newest_id?: string;
    oldest_id?: string;
  };
}

// Common fire/EMS incident type patterns
const INCIDENT_PATTERNS: Array<{
  pattern: RegExp;
  type: IncidentType;
  severity: 1 | 2 | 3 | 4 | 5;
  category: string;
}> = [
  // Structure fires - highest priority
  { pattern: /working fire|structure fire|2nd alarm|3rd alarm|all hands/i, type: 'fire', severity: 5, category: 'structure fire' },
  { pattern: /apartment fire|house fire|townhouse fire|building fire/i, type: 'fire', severity: 5, category: 'structure fire' },
  { pattern: /box alarm|1st alarm/i, type: 'fire', severity: 4, category: 'box alarm' },
  
  // Vehicle fires
  { pattern: /vehicle fire|car fire|auto fire/i, type: 'fire', severity: 3, category: 'vehicle fire' },
  
  // Other fires
  { pattern: /trash fire|dumpster fire|rubbish fire/i, type: 'fire', severity: 2, category: 'trash fire' },
  { pattern: /brush fire|grass fire|woods fire/i, type: 'fire', severity: 3, category: 'brush fire' },
  
  // Rescues and technical operations
  { pattern: /rescue|extrication|entrapment|trapped/i, type: 'fire', severity: 4, category: 'rescue' },
  { pattern: /water rescue|swift water/i, type: 'fire', severity: 5, category: 'water rescue' },
  { pattern: /building collapse|collapse/i, type: 'fire', severity: 5, category: 'collapse' },
  
  // Hazmat
  { pattern: /hazmat|gas leak|chemical|fuel spill/i, type: 'hazard', severity: 4, category: 'hazmat' },
  { pattern: /carbon monoxide|co detector/i, type: 'hazard', severity: 3, category: 'co response' },
  
  // Medical (significant ones only)
  { pattern: /mass casualty|mci|multiple patients/i, type: 'fire', severity: 5, category: 'mass casualty' },
  { pattern: /cardiac arrest|cpr in progress/i, type: 'fire', severity: 4, category: 'cardiac arrest' },
  { pattern: /shooting|stabbing|assault/i, type: 'crime', severity: 4, category: 'trauma' },
  
  // Traffic/vehicle
  { pattern: /mvc|mva|motor vehicle|car accident|traffic collision|pedestrian struck/i, type: 'traffic', severity: 3, category: 'vehicle accident' },
  { pattern: /overturned vehicle|rollover/i, type: 'traffic', severity: 4, category: 'vehicle accident' },
  
  // Metro/transit
  { pattern: /metro|train|subway/i, type: 'transit', severity: 4, category: 'transit incident' },
];

// DC address patterns
const ADDRESS_PATTERNS = [
  /(\d+)\s+block\s+(?:of\s+)?([^,.\n]+)/i,                    // "100 block of K Street NW"
  /(\d+)\s+([A-Za-z0-9\s]+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Place|Pl|Lane|Ln|Way|Circle|Ct|Court)[,.\s]+(?:NW|NE|SW|SE))/i,
  /(\d+)\s+([A-Za-z0-9\s]+)[,.\s]+(NW|NE|SW|SE)/i,            // "1400 K Street NW"
  /([A-Za-z0-9\s]+)\s+(?:and|&|at)\s+([A-Za-z0-9\s]+)/i,      // "14th and U Streets"
];

export class DCFireEMSTwitterFetcher extends BaseFetcher<Incident> {
  private bearerToken: string | null;
  private userId = '134034778'; // @dcfireems Twitter user ID
  
  constructor() {
    super('dcfireems-twitter', config.cacheTtl.scanner || 60);
    this.bearerToken = process.env.TWITTER_BEARER_TOKEN || null;
  }

  protected async fetchFromApi(): Promise<Incident[]> {
    if (!this.bearerToken) {
      logger.debug('DC Fire/EMS Twitter: No bearer token configured (set TWITTER_BEARER_TOKEN)');
      return [];
    }

    const url = `https://api.twitter.com/2/users/${this.userId}/tweets?max_results=20&tweet.fields=created_at,geo,entities&expansions=geo.place_id`;

    try {
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${this.bearerToken}`,
          'User-Agent': 'SituationMonitor/1.0',
        },
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        if (response.status === 401) {
          logger.warn('DC Fire/EMS Twitter: Invalid bearer token');
        } else if (response.status === 429) {
          logger.warn('DC Fire/EMS Twitter: Rate limit exceeded');
        } else {
          logger.warn(`DC Fire/EMS Twitter: API error ${response.status}`);
        }
        return [];
      }

      const data = (await response.json()) as TwitterResponse;
      
      if (!data.data || data.data.length === 0) {
        return [];
      }

      const incidents = data.data
        .filter((tweet) => this.isIncidentTweet(tweet))
        .map((tweet) => this.normalizeTweet(tweet))
        .filter((incident): incident is Incident => incident !== null);

      logger.info(`DC Fire/EMS Twitter: Found ${incidents.length} incidents from ${data.data.length} tweets`);
      return incidents;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.debug(`DC Fire/EMS Twitter fetch failed: ${msg}`);
      return [];
    }
  }

  /**
   * Check if a tweet describes an active incident (vs. updates, announcements, etc.)
   */
  private isIncidentTweet(tweet: Tweet): boolean {
    const text = tweet.text.toLowerCase();
    
    // Skip retweets, replies, and promotional content
    if (text.startsWith('rt @') || text.startsWith('@')) return false;
    if (text.includes('apply now') || text.includes('hiring') || text.includes('recruitment')) return false;
    if (text.includes('fire prevention') || text.includes('safety tip')) return false;
    
    // Skip "all clear", "under control" updates (not new incidents)
    if (text.includes('all clear') || text.includes('fire under control') || text.includes('knocked down')) return false;
    
    // Check for incident keywords
    for (const { pattern } of INCIDENT_PATTERNS) {
      if (pattern.test(tweet.text)) return true;
    }
    
    // Check for address patterns (indicates dispatch)
    for (const pattern of ADDRESS_PATTERNS) {
      if (pattern.test(tweet.text)) return true;
    }
    
    return false;
  }

  private normalizeTweet(tweet: Tweet): Incident | null {
    // Determine incident type and severity
    let incidentType: IncidentType = 'fire';
    let severity: 1 | 2 | 3 | 4 | 5 = 3;
    let category = 'fire/ems';
    
    for (const { pattern, type, severity: sev, category: cat } of INCIDENT_PATTERNS) {
      if (pattern.test(tweet.text)) {
        incidentType = type;
        severity = sev;
        category = cat;
        break;
      }
    }

    // Extract location
    const location = this.extractLocation(tweet);
    
    // Skip if we can't get a location
    if (location.lat === config.defaultLat && location.lng === config.defaultLng && !location.address) {
      return null;
    }

    const timestamp = tweet.created_at || new Date().toISOString();

    return {
      id: `dcfireems-twitter-${tweet.id}`,
      type: incidentType,
      severity,
      location,
      timestamp,
      // Tweets are immutable — a stable updatedAt avoids re-broadcasts.
      updatedAt: timestamp,
      regionId: 'dc',
      // Must NOT be 'alertdc': that source is in sourcesWithCompleteListing,
      // so sharing it made the AlertDC and Twitter fetchers cross-clear each
      // other's incidents on every alternating poll.
      source: 'dcfireems-twitter',
      title: this.buildTitle(tweet.text, category),
      description: tweet.text,
      status: 'active',
      category,
      metadata: {
        tweetId: tweet.id,
        regionId: 'dc',
        source: 'twitter',
        username: 'dcfireems',
      },
    };
  }

  private extractLocation(tweet: Tweet): { lat: number; lng: number; address?: string } {
    // Try to get coordinates from geo data
    if (tweet.geo?.coordinates?.coordinates) {
      const [lng, lat] = tweet.geo.coordinates.coordinates;
      return { lat, lng };
    }

    // Extract address from tweet text
    const address = this.extractAddressFromText(tweet.text);
    
    if (address) {
      // Use deterministic offset based on address hash
      const offset = this.deterministicOffset(address);
      return {
        lat: config.defaultLat + offset.latOffset,
        lng: config.defaultLng + offset.lngOffset,
        address,
      };
    }

    return { lat: config.defaultLat, lng: config.defaultLng };
  }

  private extractAddressFromText(text: string): string | null {
    for (const pattern of ADDRESS_PATTERNS) {
      const match = text.match(pattern);
      if (match) {
        return match[0].trim();
      }
    }
    return null;
  }

  private buildTitle(text: string, category: string): string {
    // Clean up tweet text for title
    const maxLength = 80;
    let title = text
      .replace(/https?:\/\/\S+/g, '') // Remove URLs
      .replace(/\s+/g, ' ')           // Normalize whitespace
      .trim();
    
    if (title.length > maxLength) {
      title = title.substring(0, maxLength) + '...';
    }
    
    return title ? `DCFD: ${title}` : `DCFD: ${category}`;
  }

  /**
   * Generate deterministic offset for addresses without geocoding
   */
  private deterministicOffset(text: string): { latOffset: number; lngOffset: number } {
    let hash1 = 0;
    let hash2 = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash1 = ((hash1 << 5) - hash1 + char) & 0xffffffff;
      hash2 = ((hash2 << 7) - hash2 + char) & 0xffffffff;
    }
    
    // Spread within DC bounds (~3 miles)
    const latOffset = ((hash1 % 10000) / 10000 - 0.5) * 0.05;
    const lngOffset = ((hash2 % 10000) / 10000 - 0.5) * 0.05;
    
    return { latOffset, lngOffset };
  }
}

export const dcFireEMSTwitterFetcher = new DCFireEMSTwitterFetcher();
export default dcFireEMSTwitterFetcher;
