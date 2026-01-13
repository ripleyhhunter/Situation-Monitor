import { writable, derived } from 'svelte/store';
import type { NewsItem } from '$types';

// Store for all news items
export const news = writable<NewsItem[]>([]);

// Update news from SSE or API
export function updateNews(items: NewsItem[]): void {
  news.set(items);
}

// Derived store for news count
export const newsCount = derived(news, ($news) => $news.length);

// Derived store for news by source
export const newsBySource = derived(news, ($news) => {
  const bySource: Record<string, NewsItem[]> = {};
  for (const item of $news) {
    if (!bySource[item.source]) {
      bySource[item.source] = [];
    }
    bySource[item.source].push(item);
  }
  return bySource;
});

// Get news items that might be related to an incident
export function getRelatedNews(
  newsItems: NewsItem[],
  incidentTitle: string,
  incidentAddress?: string,
  incidentType?: string
): NewsItem[] {
  const searchText = `${incidentTitle} ${incidentAddress || ''}`.toLowerCase();
  
  const typeKeywords: Record<string, string[]> = {
    crime: ['shooting', 'stabbing', 'robbery', 'assault', 'murder', 'homicide', 'carjacking', 'arrest', 'police'],
    fire: ['fire', 'blaze', 'flames', 'firefighters', 'evacuation', 'smoke'],
    traffic: ['crash', 'accident', 'collision', 'traffic', 'road closure', 'delays'],
    weather: ['storm', 'weather', 'flooding', 'snow', 'tornado', 'warning'],
    transit: ['metro', 'wmata', 'train', 'bus', 'delays'],
  };

  const keywords = incidentType ? typeKeywords[incidentType] || [] : [];

  return newsItems.filter(item => {
    const itemText = `${item.title} ${item.description}`.toLowerCase();

    // Check keyword matches
    if (item.keywords?.some(kw => keywords.includes(kw.toLowerCase()))) {
      return true;
    }

    // Check address overlap
    if (incidentAddress) {
      const addressParts = incidentAddress.toLowerCase().split(/[\s,]+/);
      const significantParts = addressParts.filter(part => part.length > 3);
      if (significantParts.some(part => itemText.includes(part))) {
        return true;
      }
    }

    // Check title word overlap
    const titleWords = incidentTitle.toLowerCase().split(/\s+/).filter(w => w.length > 4);
    if (titleWords.some(word => itemText.includes(word))) {
      return true;
    }

    return false;
  }).slice(0, 5);
}

// Format relative time for news
export function formatNewsTime(pubDate: string): string {
  const now = Date.now();
  const then = new Date(pubDate).getTime();
  const diff = now - then;

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  
  return new Date(pubDate).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

// Get source display name
export function getSourceName(source: string): string {
  const names: Record<string, string> = {
    wtop: 'WTOP',
    dcist: 'DCist',
    nbc4: 'NBC4',
    wusa9: 'WUSA9',
    fox5: 'FOX 5',
    washpost: 'WaPo',
  };
  return names[source] || source.toUpperCase();
}

// Get source color
export function getSourceColor(source: string): string {
  const colors: Record<string, string> = {
    wtop: '#0066cc',      // WTOP blue
    dcist: '#e63946',     // DCist red
    nbc4: '#4b0082',      // NBC purple
    wusa9: '#ff6600',     // WUSA orange
    fox5: '#003087',      // Fox blue
    washpost: '#000000',  // WaPo black
  };
  return colors[source] || '#6b7280';
}
