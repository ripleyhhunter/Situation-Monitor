<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  const dispatch = createEventDispatcher<{
    select: { lat: number; lng: number; name: string };
  }>();

  interface SearchResult {
    place_id: number;
    display_name: string;
    lat: string;
    lon: string;
    type: string;
    importance: number;
  }

  let query = '';
  let results: SearchResult[] = [];
  let isLoading = false;
  let showResults = false;
  let debounceTimer: ReturnType<typeof setTimeout>;
  let inputElement: HTMLInputElement;

  // DC area bounding box for Nominatim
  const DC_BOUNDS = {
    west: -77.2,
    east: -76.9,
    south: 38.8,
    north: 39.0,
  };

  async function search(searchQuery: string) {
    if (searchQuery.length < 3) {
      results = [];
      return;
    }

    isLoading = true;

    try {
      const params = new URLSearchParams({
        q: searchQuery,
        format: 'json',
        addressdetails: '1',
        limit: '8',
        viewbox: `${DC_BOUNDS.west},${DC_BOUNDS.north},${DC_BOUNDS.east},${DC_BOUNDS.south}`,
        bounded: '1',
      });

      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?${params}`,
        {
          headers: {
            'User-Agent': 'SituationMonitor/1.0',
          },
        }
      );

      if (response.ok) {
        const data = await response.json();
        results = data;
        showResults = results.length > 0;
      }
    } catch (error) {
      console.error('Search failed:', error);
      results = [];
    } finally {
      isLoading = false;
    }
  }

  function handleInput() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      search(query);
    }, 300);
  }

  function selectResult(result: SearchResult) {
    query = formatDisplayName(result.display_name);
    showResults = false;
    results = [];
    
    dispatch('select', {
      lat: parseFloat(result.lat),
      lng: parseFloat(result.lon),
      name: result.display_name,
    });
  }

  function formatDisplayName(name: string): string {
    // Shorten long display names
    const parts = name.split(', ');
    if (parts.length > 3) {
      return parts.slice(0, 3).join(', ');
    }
    return name;
  }

  function handleFocus() {
    if (results.length > 0) {
      showResults = true;
    }
  }

  function handleBlur(event: FocusEvent) {
    // Delay hiding to allow click on results
    setTimeout(() => {
      showResults = false;
    }, 200);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      showResults = false;
      inputElement?.blur();
    }
  }

  function clearSearch() {
    query = '';
    results = [];
    showResults = false;
  }
</script>

<div class="relative">
  <div class="relative">
    <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
      {#if isLoading}
        <svg class="animate-spin w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
      {:else}
        <svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      {/if}
    </div>
    <input
      bind:this={inputElement}
      bind:value={query}
      on:input={handleInput}
      on:focus={handleFocus}
      on:blur={handleBlur}
      on:keydown={handleKeydown}
      type="text"
      placeholder="Search address..."
      class="w-full pl-10 pr-8 py-2 text-sm bg-gray-100 dark:bg-gray-700 border-0 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:bg-white dark:focus:bg-gray-600 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
    />
    {#if query}
      <button
        on:click={clearSearch}
        class="absolute inset-y-0 right-0 pr-3 flex items-center"
        aria-label="Clear search"
      >
        <svg class="w-4 h-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    {/if}
  </div>

  <!-- Results dropdown - z-[1000] to appear above Leaflet map (which uses z-index 400+) -->
  {#if showResults && results.length > 0}
    <div class="absolute z-[1000] mt-1 w-full bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 max-h-64 overflow-y-auto">
      {#each results as result}
        <button
          on:click={() => selectResult(result)}
          class="w-full px-4 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors border-b border-gray-100 dark:border-gray-700 last:border-b-0"
        >
          <div class="flex items-start gap-2">
            <svg class="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span class="text-sm text-gray-900 dark:text-white line-clamp-2">
              {formatDisplayName(result.display_name)}
            </span>
          </div>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .line-clamp-2 {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
</style>
