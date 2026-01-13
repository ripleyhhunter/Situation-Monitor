import Parser from 'rss-parser';
import crypto from 'crypto';
import type { NewsItem, NewsSource } from '../types/index.js';
import cache from '../services/cache.js';
import logger from '../logger.js';

// RSS Parser instance
const parser = new Parser({
  timeout: 15000,
  headers: {
    'User-Agent': 'SituationMonitor/1.0 (DC Area News Aggregator)',
    Accept: 'application/rss+xml, application/xml, text/xml',
  },
});

// RSS Feed configurations
interface FeedConfig {
  url: string;
  source: NewsSource;
  name: string;
}

const RSS_FEEDS: FeedConfig[] = [
  // WTOP - DC's all-news radio
  {
    url: 'https://wtop.com/region/local/feed/',
    source: 'wtop',
    name: 'WTOP Local',
  },
  {
    url: 'https://wtop.com/region/local/dc/feed/',
    source: 'wtop',
    name: 'WTOP DC',
  },
  {
    url: 'https://wtop.com/region/local/maryland/feed/',
    source: 'wtop',
    name: 'WTOP Maryland',
  },
  {
    url: 'https://wtop.com/region/local/virginia/feed/',
    source: 'wtop',
    name: 'WTOP Virginia',
  },
  // DCist - DC local news
  {
    url: 'https://dcist.com/feed/',
    source: 'dcist',
    name: 'DCist',
  },
  // NBC Washington (WRC-TV)
  {
    url: 'https://www.nbcwashington.com/news/local/?rss=y',
    source: 'nbc4',
    name: 'NBC4 Local',
  },
  // WUSA9 (CBS DC)
  {
    url: 'https://www.wusa9.com/feeds/syndication/rss/news/local',
    source: 'wusa9',
    name: 'WUSA9 Local',
  },
  // Fox 5 DC
  {
    url: 'https://www.fox5dc.com/tag/local-news.rss',
    source: 'fox5',
    name: 'Fox 5 DC',
  },
];

// Keywords for incident correlation and relevance scoring
const INCIDENT_KEYWORDS = {
  crime: ['shooting', 'stabbing', 'robbery', 'assault', 'murder', 'homicide', 'carjacking', 'theft', 'burglary', 'arrest', 'suspect', 'police', 'investigation', 'victim'],
  fire: ['fire', 'blaze', 'flames', 'firefighters', 'evacuation', 'smoke', 'burning', 'arson'],
  traffic: ['crash', 'accident', 'collision', 'traffic', 'road closure', 'delays', 'i-95', 'i-66', 'i-495', 'beltway', '295', '395'],
  weather: ['storm', 'weather', 'flooding', 'snow', 'ice', 'tornado', 'warning', 'advisory', 'emergency'],
  transit: ['metro', 'wmata', 'train', 'bus', 'rail', 'delays', 'service'],
};

// High-priority keywords that indicate breaking/urgent news (score boost)
const BREAKING_KEYWORDS = [
  'breaking', 'developing', 'just in', 'happening now', 'active',
  'ongoing', 'live', 'update', 'alert', 'urgent'
];

// High-value situational awareness keywords (high relevance score)
const HIGH_VALUE_KEYWORDS = [
  // Active emergencies
  'shooting', 'shot', 'gunfire', 'gunshot',
  'stabbing', 'stabbed', 'knife',
  'fire', 'blaze', 'flames', 'burning',
  'explosion', 'exploded',
  'crash', 'collision', 'fatal', 'fatality',
  'robbery', 'robbed', 'carjacking', 'armed',
  'assault', 'attacked',
  'missing', 'amber alert', 'endangered',
  'evacuation', 'evacuated',
  'hazmat', 'gas leak', 'chemical',
  'barricade', 'standoff', 'hostage',
  'pursuit', 'chase',
  // Traffic/Road
  'closure', 'closed', 'shut down', 'blocked',
  'delays', 'backed up', 'gridlock',
  'detour', 'alternate route',
  // Emergency response
  'police', 'officers', 'mpd',
  'firefighters', 'fire department', 'dcfems',
  'ambulance', 'medics', 'ems',
  'suspect', 'arrested', 'custody',
  'victim', 'injured', 'hospitalized', 'killed',
  // Weather emergencies
  'warning', 'watch', 'advisory',
  'tornado', 'severe', 'flash flood',
  'power outage', 'outages',
];

// Medium-value keywords (moderate relevance)
const MEDIUM_VALUE_KEYWORDS = [
  'traffic', 'road', 'highway', 'interstate',
  'metro', 'wmata', 'train', 'bus', 'station',
  'weather', 'storm', 'rain', 'snow', 'wind', 'ice',
  'investigation', 'scene', 'incident',
  'construction', 'work zone',
  'service', 'suspended', 'restored',
];

// Negative keywords - filter these out or score down significantly
const NEGATIVE_KEYWORDS = [
  // Politics (not emergency-related)
  'election', 'vote', 'poll', 'campaign', 'candidate', 'ballot',
  'republican', 'democrat', 'congress', 'senate', 'legislation',
  'governor', 'mayor',  // unless emergency context
  // Sports
  'game', 'playoff', 'championship', 'tournament', 'score', 'win', 'loss',
  'nationals', 'commanders', 'wizards', 'capitals', 'mystics', 'united',
  // Entertainment/Lifestyle
  'restaurant', 'dining', 'review', 'recipe',
  'movie', 'film', 'concert', 'festival', 'exhibit',
  'opinion', 'editorial', 'commentary', 'column',
  // Business
  'earnings', 'stock', 'market', 'investor', 'ceo', 'company',
  'real estate', 'housing market', 'mortgage',
  // Other non-urgent
  'anniversary', 'celebration', 'award', 'honors',
  'interview', 'podcast', 'book',
];

// DC area location keywords for relevance filtering
const DC_AREA_KEYWORDS = [
  'washington', 'dc', 'd.c.', 'district', 'capitol', 'capitol hill',
  'northwest', 'northeast', 'southwest', 'southeast', 'nw', 'ne', 'sw', 'se',
  'maryland', 'virginia', 'montgomery', 'prince george', 'fairfax', 'arlington',
  'alexandria', 'bethesda', 'silver spring', 'rockville', 'college park',
  'anacostia', 'georgetown', 'dupont', 'adams morgan', 'u street', 'h street',
  'navy yard', 'wharf', 'nationals', 'downtown',
];

/**
 * Generate a unique ID for a news item
 */
function generateId(item: Parser.Item, source: NewsSource): string {
  const uniqueString = `${source}-${item.guid || item.link || item.title}`;
  return crypto.createHash('md5').update(uniqueString).digest('hex').substring(0, 16);
}

/**
 * Calculate relevance score for a news item
 * Higher score = more relevant to situational awareness
 * Returns: { score: number, isBreaking: boolean, category: string | null }
 */
function calculateRelevanceScore(title: string, description: string): { 
  score: number; 
  isBreaking: boolean; 
  category: string | null;
  shouldFilter: boolean;
} {
  const text = `${title} ${description}`.toLowerCase();
  const titleLower = title.toLowerCase();
  let score = 0;
  let category: string | null = null;
  
  // Check for negative keywords first - these reduce score significantly
  let negativeCount = 0;
  for (const keyword of NEGATIVE_KEYWORDS) {
    if (text.includes(keyword)) {
      negativeCount++;
      score -= 15;
    }
  }
  
  // If article is dominated by negative keywords, filter it out
  if (negativeCount >= 3) {
    return { score: -100, isBreaking: false, category: null, shouldFilter: true };
  }
  
  // Check for breaking/urgent indicators
  const isBreaking = BREAKING_KEYWORDS.some(kw => titleLower.includes(kw));
  if (isBreaking) {
    score += 25; // Significant boost for breaking news
  }
  
  // Score high-value keywords
  for (const keyword of HIGH_VALUE_KEYWORDS) {
    if (text.includes(keyword)) {
      score += 10;
      // Title matches are worth more
      if (titleLower.includes(keyword)) {
        score += 5;
      }
    }
  }
  
  // Score medium-value keywords
  for (const keyword of MEDIUM_VALUE_KEYWORDS) {
    if (text.includes(keyword)) {
      score += 3;
    }
  }
  
  // Determine category based on keyword matches
  for (const [cat, keywords] of Object.entries(INCIDENT_KEYWORDS)) {
    const matchCount = keywords.filter(kw => text.includes(kw)).length;
    if (matchCount >= 2) {
      category = cat;
      score += matchCount * 2; // Bonus for multiple category matches
      break;
    }
  }
  
  // Boost articles that mention specific locations (more actionable)
  const locationPatterns = [
    /\d{3,4}\s+block/i,  // "1400 block of..."
    /\b(nw|ne|sw|se)\b/i, // DC quadrants
    /\bi-\d+/i,           // Interstate numbers
    /\bward\s+\d/i,       // DC wards
  ];
  for (const pattern of locationPatterns) {
    if (pattern.test(text)) {
      score += 8;
      break;
    }
  }
  
  // Filter out if score is too low (not relevant enough)
  const shouldFilter = score < 5;
  
  return { score, isBreaking, category, shouldFilter };
}

/**
 * Extract keywords from title and description
 */
function extractKeywords(title: string, description: string): string[] {
  const text = `${title} ${description}`.toLowerCase();
  const keywords: string[] = [];

  for (const [category, words] of Object.entries(INCIDENT_KEYWORDS)) {
    for (const word of words) {
      if (text.includes(word.toLowerCase())) {
        keywords.push(word);
        if (!keywords.includes(category)) {
          keywords.push(category);
        }
      }
    }
  }

  return [...new Set(keywords)];
}

/**
 * Check if news item is relevant to DC area
 */
function isDCAreaRelevant(title: string, description: string): boolean {
  const text = `${title} ${description}`.toLowerCase();
  return DC_AREA_KEYWORDS.some(keyword => text.includes(keyword.toLowerCase()));
}

/**
 * Extract image URL from RSS item
 */
function extractImageUrl(item: Parser.Item): string | undefined {
  // Check enclosure
  if (item.enclosure?.url && item.enclosure.type?.startsWith('image')) {
    return item.enclosure.url;
  }

  // Check media:content or media:thumbnail (common in RSS)
  const media = (item as any)['media:content'] || (item as any)['media:thumbnail'];
  if (media?.$ ?.url) {
    return media.$.url;
  }

  // Try to extract from content/description
  const content = item.content || item.contentSnippet || item['content:encoded'] || '';
  const imgMatch = content.match(/<img[^>]+src="([^"]+)"/i);
  if (imgMatch) {
    return imgMatch[1];
  }

  return undefined;
}

/**
 * Extended NewsItem with relevance data (internal use)
 */
interface ScoredNewsItem extends NewsItem {
  relevanceScore: number;
  isBreaking: boolean;
  incidentCategory: string | null;
}

/**
 * Parse a single RSS feed
 */
async function parseFeed(config: FeedConfig): Promise<ScoredNewsItem[]> {
  try {
    logger.debug(`Fetching RSS feed: ${config.name}`);
    const feed = await parser.parseURL(config.url);

    if (!feed.items || feed.items.length === 0) {
      logger.warn(`No items in feed: ${config.name}`);
      return [];
    }

    const items: ScoredNewsItem[] = [];

    for (const item of feed.items) {
      if (!item.title) continue;

      const title = item.title.trim();
      const description = (item.contentSnippet || item.content || item.summary || '').trim();

      // Filter for DC area relevance first
      if (!isDCAreaRelevant(title, description)) {
        continue;
      }

      // Calculate relevance score
      const relevance = calculateRelevanceScore(title, description);
      
      // Skip articles that don't meet relevance threshold
      if (relevance.shouldFilter) {
        continue;
      }

      const newsItem: ScoredNewsItem = {
        id: generateId(item, config.source),
        title,
        description: description.substring(0, 500), // Truncate long descriptions
        link: item.link || '',
        source: config.source,
        pubDate: item.pubDate || item.isoDate || new Date().toISOString(),
        imageUrl: extractImageUrl(item),
        categories: item.categories || [],
        keywords: extractKeywords(title, description),
        // Relevance data
        relevanceScore: relevance.score,
        isBreaking: relevance.isBreaking,
        incidentCategory: relevance.category,
      };

      items.push(newsItem);
    }

    logger.debug(`Parsed ${items.length} relevant items from ${config.name} (filtered for situational relevance)`);
    return items;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`Failed to parse feed ${config.name}: ${errorMessage}`);
    return [];
  }
}

/**
 * Fetch all news from configured RSS feeds
 */
export async function fetchNews(): Promise<NewsItem[]> {
  const cacheKey = 'fetcher:news';
  
  try {
    // Fetch all feeds in parallel
    const feedPromises = RSS_FEEDS.map(config => parseFeed(config));
    const results = await Promise.all(feedPromises);

    // Combine and deduplicate by ID, keeping highest-scored version
    const itemMap = new Map<string, ScoredNewsItem>();
    for (const items of results) {
      for (const item of items) {
        const existing = itemMap.get(item.id);
        // Keep the item with higher relevance score, or newer if tied
        if (!existing || 
            item.relevanceScore > existing.relevanceScore ||
            (item.relevanceScore === existing.relevanceScore && 
             new Date(item.pubDate) > new Date(existing.pubDate))) {
          itemMap.set(item.id, item);
        }
      }
    }

    // Sort by: breaking first, then relevance score, then recency
    const allItems = Array.from(itemMap.values())
      .sort((a, b) => {
        // Breaking news always first
        if (a.isBreaking && !b.isBreaking) return -1;
        if (!a.isBreaking && b.isBreaking) return 1;
        
        // Then by relevance score (higher first)
        if (b.relevanceScore !== a.relevanceScore) {
          return b.relevanceScore - a.relevanceScore;
        }
        
        // Finally by recency
        return new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime();
      })
      .slice(0, 50); // Keep only top 50 most relevant items

    // Convert to plain NewsItem with priority field for API response
    const publicItems: NewsItem[] = allItems.map(item => ({
      id: item.id,
      title: item.title,
      description: item.description,
      link: item.link,
      source: item.source,
      pubDate: item.pubDate,
      imageUrl: item.imageUrl,
      categories: item.categories,
      keywords: item.keywords,
      // Set priority based on relevance analysis
      priority: item.isBreaking ? 'breaking' : (item.relevanceScore >= 20 ? 'high' : 'normal'),
      incidentType: item.incidentCategory || undefined,
    }));

    // Cache the results
    await cache.set(cacheKey, publicItems, 300); // 5 minute cache

    const breakingCount = allItems.filter(i => i.isBreaking).length;
    logger.info(`News: Fetched ${publicItems.length} relevant items (${breakingCount} breaking) from ${RSS_FEEDS.length} feeds`);
    return publicItems;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`News fetch failed: ${errorMessage}`);

    // Try to return cached data on error
    const cached = await cache.get<NewsItem[]>(cacheKey);
    if (cached) {
      logger.warn('News: Returning stale cached data due to error');
      return cached;
    }

    return [];
  }
}

/**
 * Find news items that might be related to an incident
 */
export function findRelatedNews(
  newsItems: NewsItem[],
  incidentTitle: string,
  incidentAddress?: string,
  incidentType?: string
): NewsItem[] {
  const searchText = `${incidentTitle} ${incidentAddress || ''}`.toLowerCase();
  const typeKeywords = incidentType ? INCIDENT_KEYWORDS[incidentType as keyof typeof INCIDENT_KEYWORDS] || [] : [];

  return newsItems.filter(item => {
    const itemText = `${item.title} ${item.description}`.toLowerCase();

    // Check if incident keywords match news keywords
    if (item.keywords?.some(kw => typeKeywords.includes(kw))) {
      return true;
    }

    // Check for address/location overlap
    if (incidentAddress) {
      const addressParts = incidentAddress.toLowerCase().split(/[\s,]+/);
      const significantParts = addressParts.filter(part => part.length > 3);
      if (significantParts.some(part => itemText.includes(part))) {
        return true;
      }
    }

    // Check for significant word overlap in title
    const titleWords = incidentTitle.toLowerCase().split(/\s+/).filter(w => w.length > 4);
    if (titleWords.some(word => itemText.includes(word))) {
      return true;
    }

    return false;
  }).slice(0, 5); // Return at most 5 related items
}

export default {
  fetchNews,
  findRelatedNews,
};
