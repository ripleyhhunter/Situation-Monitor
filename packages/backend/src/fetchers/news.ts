import Parser from 'rss-parser';
import crypto from 'crypto';
import type { NewsItem, NewsSource, RegionId } from '../types/index.js';
import type { RegionNewsConfig } from '../regions/types.js';
import cache from '../services/cache.js';
import logger from '../logger.js';

// Universal scoring keywords (apply regardless of region)
const INCIDENT_KEYWORDS = {
  crime: ['shooting', 'stabbing', 'robbery', 'assault', 'murder', 'homicide', 'carjacking', 'theft', 'burglary', 'arrest', 'suspect', 'police', 'investigation', 'victim'],
  fire: ['fire', 'blaze', 'flames', 'firefighters', 'evacuation', 'smoke', 'burning', 'arson', 'wildfire'],
  traffic: ['crash', 'accident', 'collision', 'traffic', 'road closure', 'delays', 'detour'],
  weather: ['storm', 'weather', 'flooding', 'snow', 'ice', 'tornado', 'warning', 'advisory', 'emergency'],
  transit: ['metro', 'train', 'bus', 'rail', 'delays', 'service'],
};

const BREAKING_KEYWORDS = [
  'breaking', 'developing', 'just in', 'happening now', 'active',
  'ongoing', 'live', 'update', 'alert', 'urgent',
];

const HIGH_VALUE_KEYWORDS = [
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
  'closure', 'closed', 'shut down', 'blocked',
  'delays', 'backed up', 'gridlock',
  'detour', 'alternate route',
  'police', 'officers',
  'firefighters', 'fire department',
  'ambulance', 'medics', 'ems',
  'suspect', 'arrested', 'custody',
  'victim', 'injured', 'hospitalized', 'killed',
  'warning', 'watch', 'advisory',
  'tornado', 'severe', 'flash flood',
  'power outage', 'outages',
];

const MEDIUM_VALUE_KEYWORDS = [
  'traffic', 'road', 'highway', 'interstate',
  'metro', 'train', 'bus', 'station',
  'weather', 'storm', 'rain', 'snow', 'wind', 'ice',
  'investigation', 'scene', 'incident',
  'construction', 'work zone',
  'service', 'suspended', 'restored',
];

const NEGATIVE_KEYWORDS = [
  'election', 'vote', 'poll', 'campaign', 'candidate', 'ballot',
  'republican', 'democrat', 'congress', 'senate', 'legislation',
  'governor', 'mayor',
  'game', 'playoff', 'championship', 'tournament', 'score',
  'restaurant', 'dining', 'review', 'recipe',
  'movie', 'film', 'concert', 'festival', 'exhibit',
  'opinion', 'editorial', 'commentary', 'column',
  'earnings', 'stock', 'market', 'investor', 'ceo',
  'real estate', 'housing market', 'mortgage',
  'anniversary', 'celebration', 'award', 'honors',
  'interview', 'podcast', 'book',
];

interface ScoredNewsItem extends NewsItem {
  relevanceScore: number;
  isBreaking: boolean;
  incidentCategory: string | null;
}

export class NewsFetcher {
  private parser: Parser;
  private regionId: RegionId;
  private feeds: RegionNewsConfig['rssFeeds'];
  private areaKeywords: string[];
  private locationPatterns: RegExp[];

  constructor(regionId: RegionId, news: RegionNewsConfig, regionName: string) {
    this.regionId = regionId;
    this.feeds = news.rssFeeds;
    this.areaKeywords = news.areaKeywords.map(k => k.toLowerCase());
    this.locationPatterns = news.locationPatterns;
    this.parser = new Parser({
      timeout: 15000,
      headers: {
        'User-Agent': `SituationMonitor/1.0 (${regionName} News Aggregator)`,
        Accept: 'application/rss+xml, application/xml, text/xml',
      },
    });
  }

  async fetchNews(): Promise<NewsItem[]> {
    const cacheKey = `fetcher:news:${this.regionId}`;

    try {
      const feedPromises = this.feeds.map(feed => this.parseFeed(feed));
      const results = await Promise.all(feedPromises);

      const itemMap = new Map<string, ScoredNewsItem>();
      for (const items of results) {
        for (const item of items) {
          const existing = itemMap.get(item.id);
          if (!existing ||
              item.relevanceScore > existing.relevanceScore ||
              (item.relevanceScore === existing.relevanceScore &&
               new Date(item.pubDate) > new Date(existing.pubDate))) {
            itemMap.set(item.id, item);
          }
        }
      }

      const allItems = Array.from(itemMap.values())
        .sort((a, b) => {
          if (a.isBreaking && !b.isBreaking) return -1;
          if (!a.isBreaking && b.isBreaking) return 1;
          if (b.relevanceScore !== a.relevanceScore) {
            return b.relevanceScore - a.relevanceScore;
          }
          return new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime();
        })
        .slice(0, 50);

      const publicItems: NewsItem[] = allItems.map(item => ({
        id: item.id,
        regionId: this.regionId,
        title: item.title,
        description: item.description,
        link: item.link,
        source: item.source,
        pubDate: item.pubDate,
        imageUrl: item.imageUrl,
        categories: item.categories,
        keywords: item.keywords,
        priority: item.isBreaking ? 'breaking' : (item.relevanceScore >= 20 ? 'high' : 'normal'),
        incidentType: item.incidentCategory || undefined,
      }));

      await cache.set(cacheKey, publicItems, 300);

      const breakingCount = allItems.filter(i => i.isBreaking).length;
      logger.info(`News (${this.regionId}): Fetched ${publicItems.length} relevant items (${breakingCount} breaking) from ${this.feeds.length} feeds`);
      return publicItems;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`News fetch failed: ${errorMessage}`);

      const cached = await cache.get<NewsItem[]>(cacheKey);
      if (cached) {
        logger.warn('News: Returning stale cached data due to error');
        return cached;
      }

      return [];
    }
  }

  findRelatedNews(
    newsItems: NewsItem[],
    incidentTitle: string,
    incidentAddress?: string,
    incidentType?: string,
  ): NewsItem[] {
    const typeKeywords = incidentType
      ? INCIDENT_KEYWORDS[incidentType as keyof typeof INCIDENT_KEYWORDS] || []
      : [];

    return newsItems.filter(item => {
      const itemText = `${item.title} ${item.description}`.toLowerCase();

      if (item.keywords?.some(kw => typeKeywords.includes(kw))) {
        return true;
      }

      if (incidentAddress) {
        const addressParts = incidentAddress.toLowerCase().split(/[\s,]+/);
        const significantParts = addressParts.filter(part => part.length > 3);
        if (significantParts.some(part => itemText.includes(part))) {
          return true;
        }
      }

      const titleWords = incidentTitle.toLowerCase().split(/\s+/).filter(w => w.length > 4);
      if (titleWords.some(word => itemText.includes(word))) {
        return true;
      }

      return false;
    }).slice(0, 5);
  }

  private async parseFeed(feed: RegionNewsConfig['rssFeeds'][number]): Promise<ScoredNewsItem[]> {
    try {
      logger.debug(`Fetching RSS feed: ${feed.name}`);
      const parsed = await this.parser.parseURL(feed.url);

      if (!parsed.items || parsed.items.length === 0) {
        logger.warn(`No items in feed: ${feed.name}`);
        return [];
      }

      const items: ScoredNewsItem[] = [];

      for (const item of parsed.items) {
        if (!item.title) continue;

        const title = item.title.trim();
        const description = (item.contentSnippet || item.content || item.summary || '').trim();

        if (!this.isAreaRelevant(title, description)) {
          continue;
        }

        const relevance = this.calculateRelevanceScore(title, description);

        if (relevance.shouldFilter) {
          continue;
        }

        items.push({
          id: this.generateId(item, feed.source as NewsSource),
          regionId: this.regionId,
          title,
          description: description.substring(0, 500),
          link: item.link || '',
          source: feed.source as NewsSource,
          pubDate: item.pubDate || item.isoDate || new Date().toISOString(),
          imageUrl: this.extractImageUrl(item),
          categories: item.categories || [],
          keywords: this.extractKeywords(title, description),
          relevanceScore: relevance.score,
          isBreaking: relevance.isBreaking,
          incidentCategory: relevance.category,
        });
      }

      logger.debug(`Parsed ${items.length} relevant items from ${feed.name}`);
      return items;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Failed to parse feed ${feed.name}: ${errorMessage}`);
      return [];
    }
  }

  private isAreaRelevant(title: string, description: string): boolean {
    const text = `${title} ${description}`.toLowerCase();
    return this.areaKeywords.some(keyword => text.includes(keyword));
  }

  private calculateRelevanceScore(title: string, description: string): {
    score: number;
    isBreaking: boolean;
    category: string | null;
    shouldFilter: boolean;
  } {
    const text = `${title} ${description}`.toLowerCase();
    const titleLower = title.toLowerCase();
    let score = 0;
    let category: string | null = null;

    let negativeCount = 0;
    for (const keyword of NEGATIVE_KEYWORDS) {
      if (text.includes(keyword)) {
        negativeCount++;
        score -= 15;
      }
    }

    if (negativeCount >= 3) {
      return { score: -100, isBreaking: false, category: null, shouldFilter: true };
    }

    const isBreaking = BREAKING_KEYWORDS.some(kw => titleLower.includes(kw));
    if (isBreaking) {
      score += 25;
    }

    for (const keyword of HIGH_VALUE_KEYWORDS) {
      if (text.includes(keyword)) {
        score += 10;
        if (titleLower.includes(keyword)) {
          score += 5;
        }
      }
    }

    for (const keyword of MEDIUM_VALUE_KEYWORDS) {
      if (text.includes(keyword)) {
        score += 3;
      }
    }

    for (const [cat, keywords] of Object.entries(INCIDENT_KEYWORDS)) {
      const matchCount = keywords.filter(kw => text.includes(kw)).length;
      if (matchCount >= 2) {
        category = cat;
        score += matchCount * 2;
        break;
      }
    }

    for (const pattern of this.locationPatterns) {
      if (pattern.test(text)) {
        score += 8;
        break;
      }
    }

    const shouldFilter = score < 5;
    return { score, isBreaking, category, shouldFilter };
  }

  private extractKeywords(title: string, description: string): string[] {
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

  private generateId(item: Parser.Item, source: NewsSource): string {
    const uniqueString = `${source}-${item.guid || item.link || item.title}`;
    return crypto.createHash('md5').update(uniqueString).digest('hex').substring(0, 16);
  }

  private extractImageUrl(item: Parser.Item): string | undefined {
    if (item.enclosure?.url && item.enclosure.type?.startsWith('image')) {
      return item.enclosure.url;
    }

    const media = (item as unknown as Record<string, { $?: { url?: string } } | undefined>)['media:content']
      || (item as unknown as Record<string, { $?: { url?: string } } | undefined>)['media:thumbnail'];
    if (media?.$?.url) {
      return media.$.url;
    }

    const content = item.content || item.contentSnippet || (item as Parser.Item & { 'content:encoded'?: string })['content:encoded'] || '';
    const imgMatch = content.match(/<img[^>]+src="([^"]+)"/i);
    if (imgMatch) {
      return imgMatch[1];
    }

    return undefined;
  }
}
