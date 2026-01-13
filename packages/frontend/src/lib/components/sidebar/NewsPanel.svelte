<script lang="ts">
  import { news, newsCount, formatNewsTime, getSourceName, getSourceColor } from '$stores/news';
  import type { NewsItem, NewsPriority } from '$types';

  // Filter by source
  let sourceFilter: string = 'all';

  // Filtered news
  $: filteredNews = sourceFilter === 'all' 
    ? $news 
    : $news.filter(item => item.source === sourceFilter);

  // Get unique sources
  $: availableSources = [...new Set($news.map(item => item.source))];

  // Count by priority
  $: breakingCount = $news.filter(n => n.priority === 'breaking').length;
  $: highPriorityCount = $news.filter(n => n.priority === 'high').length;

  function openArticle(item: NewsItem) {
    window.open(item.link, '_blank', 'noopener,noreferrer');
  }

  function getKeywordBadgeColor(keyword: string): string {
    const colors: Record<string, string> = {
      crime: '#dc2626',
      fire: '#ea580c',
      traffic: '#ca8a04',
      weather: '#2563eb',
      transit: '#7c3aed',
    };
    return colors[keyword] || '#6b7280';
  }

  function getIncidentTypeIcon(type: string | undefined): string {
    const icons: Record<string, string> = {
      crime: '🚨',
      fire: '🔥',
      traffic: '🚗',
      weather: '⛈️',
      transit: '🚇',
    };
    return type ? icons[type] || '📰' : '📰';
  }

  function getPriorityStyles(priority: NewsPriority | undefined): { bg: string; border: string; badge: string } {
    switch (priority) {
      case 'breaking':
        return { 
          bg: 'bg-red-50 dark:bg-red-900/20', 
          border: 'border-l-4 border-red-500',
          badge: 'bg-red-600 text-white animate-pulse'
        };
      case 'high':
        return { 
          bg: 'bg-amber-50 dark:bg-amber-900/20', 
          border: 'border-l-4 border-amber-500',
          badge: 'bg-amber-500 text-white'
        };
      default:
        return { 
          bg: '', 
          border: '',
          badge: ''
        };
    }
  }
</script>

<div class="h-full flex flex-col bg-white dark:bg-gray-800">
  <!-- Header -->
  <div class="flex-shrink-0 p-3 border-b border-gray-200 dark:border-gray-700">
    <div class="flex items-center justify-between mb-2">
      <h3 class="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
        📰 Local News
      </h3>
      <div class="flex items-center gap-2">
        {#if breakingCount > 0}
          <span class="px-1.5 py-0.5 text-[10px] font-bold bg-red-600 text-white rounded animate-pulse">
            {breakingCount} BREAKING
          </span>
        {/if}
        <span class="text-xs text-gray-500 dark:text-gray-400">
          {filteredNews.length} articles
        </span>
      </div>
    </div>

    <!-- Source filter -->
    {#if availableSources.length > 1}
      <div class="flex flex-wrap gap-1">
        <button
          class="px-2 py-1 text-xs rounded transition-colors"
          class:bg-gray-200={sourceFilter === 'all'}
          class:dark:bg-gray-600={sourceFilter === 'all'}
          class:text-gray-900={sourceFilter === 'all'}
          class:dark:text-white={sourceFilter === 'all'}
          class:bg-gray-100={sourceFilter !== 'all'}
          class:dark:bg-gray-700={sourceFilter !== 'all'}
          class:text-gray-600={sourceFilter !== 'all'}
          class:dark:text-gray-400={sourceFilter !== 'all'}
          on:click={() => sourceFilter = 'all'}
        >
          All
        </button>
        {#each availableSources as source}
          <button
            class="px-2 py-1 text-xs rounded transition-colors"
            class:text-white={sourceFilter === source}
            style={sourceFilter === source ? `background-color: ${getSourceColor(source)}` : ''}
            class:bg-gray-100={sourceFilter !== source}
            class:dark:bg-gray-700={sourceFilter !== source}
            class:text-gray-600={sourceFilter !== source}
            class:dark:text-gray-400={sourceFilter !== source}
            on:click={() => sourceFilter = source}
          >
            {getSourceName(source)}
          </button>
        {/each}
      </div>
    {/if}
  </div>

  <!-- News List -->
  <div class="flex-1 overflow-y-auto custom-scrollbar">
    {#if filteredNews.length === 0}
      <div class="p-4 text-center text-sm text-gray-500 dark:text-gray-400">
        {#if $newsCount === 0}
          <p>Loading news...</p>
          <p class="text-xs mt-1">Situational news updates every 5 minutes</p>
        {:else}
          <p>No articles from this source</p>
        {/if}
      </div>
    {:else}
      <div class="divide-y divide-gray-100 dark:divide-gray-700">
        {#each filteredNews as item (item.id)}
          {@const priorityStyles = getPriorityStyles(item.priority)}
          <button
            type="button"
            class="w-full p-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors cursor-pointer {priorityStyles.bg} {priorityStyles.border}"
            on:click={() => openArticle(item)}
          >
            <div class="flex gap-3">
              <!-- Incident type icon for high-priority items -->
              {#if item.priority === 'breaking' || item.priority === 'high'}
                <div class="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-lg bg-gray-100 dark:bg-gray-700">
                  {getIncidentTypeIcon(item.incidentType)}
                </div>
              {:else if item.imageUrl}
                <!-- Image thumbnail for normal items -->
                <div class="flex-shrink-0 w-12 h-12 rounded overflow-hidden bg-gray-100 dark:bg-gray-700">
                  <img 
                    src={item.imageUrl} 
                    alt="" 
                    class="w-full h-full object-cover"
                    on:error={(e) => {
                      const target = e.currentTarget as HTMLImageElement;
                      target.style.display = 'none';
                    }}
                  />
                </div>
              {/if}

              <div class="flex-1 min-w-0">
                <!-- Priority badge + Title -->
                <div class="flex items-start gap-2">
                  {#if item.priority === 'breaking'}
                    <span class="flex-shrink-0 px-1.5 py-0.5 text-[10px] font-bold rounded {priorityStyles.badge}">
                      BREAKING
                    </span>
                  {:else if item.priority === 'high'}
                    <span class="flex-shrink-0 px-1.5 py-0.5 text-[10px] font-bold rounded {priorityStyles.badge}">
                      ALERT
                    </span>
                  {/if}
                  <h4 class="text-sm font-medium text-gray-900 dark:text-white line-clamp-2" class:font-bold={item.priority === 'breaking'}>
                    {item.title}
                  </h4>
                </div>

                <!-- Meta row -->
                <div class="flex items-center gap-2 mt-1 flex-wrap">
                  <span 
                    class="px-1.5 py-0.5 text-[10px] font-medium rounded text-white"
                    style="background-color: {getSourceColor(item.source)}"
                  >
                    {getSourceName(item.source)}
                  </span>
                  {#if item.incidentType}
                    <span class="px-1.5 py-0.5 text-[10px] font-medium rounded text-white" style="background-color: {getKeywordBadgeColor(item.incidentType)}">
                      {item.incidentType}
                    </span>
                  {/if}
                  <span class="text-xs text-gray-500 dark:text-gray-400">
                    {formatNewsTime(item.pubDate)}
                  </span>
                </div>

                <!-- Description preview (shorter for high-priority) -->
                {#if item.description}
                  <p class="text-xs text-gray-500 dark:text-gray-400 mt-1 {item.priority === 'breaking' ? 'line-clamp-1' : 'line-clamp-2'}">
                    {item.description}
                  </p>
                {/if}
              </div>

              <!-- External link icon -->
              <div class="flex-shrink-0 self-center">
                <svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </div>
            </div>
          </button>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Footer -->
  <div class="flex-shrink-0 p-2 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400 text-center">
    Safety & traffic news from WTOP • Updates every 5 min
  </div>
</div>

<style>
  .line-clamp-1 {
    display: -webkit-box;
    -webkit-line-clamp: 1;
    line-clamp: 1;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .line-clamp-2 {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
</style>
