<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  const dispatch = createEventDispatcher();

  interface ScannerFeed {
    id: string;
    name: string;
    description: string;
    url: string;
    type: 'broadcastify' | 'openmhz';
    popoutUrl?: string;
    embedUrl?: string;
    feedId?: string;
  }

  // DC Area Scanner Feeds
  const scannerFeeds: ScannerFeed[] = [
    {
      id: 'dc-fire-ems',
      name: 'DC Fire & EMS',
      description: 'DCFD Main Dispatch, Firegrounds',
      url: 'https://www.broadcastify.com/listen/feed/2455',
      popoutUrl: 'https://www.broadcastify.com/listen/feed/2455',
      type: 'broadcastify',
      feedId: '2455',
    },
    {
      id: 'openmhz-dcfd',
      name: 'OpenMHz - DCFD',
      description: 'Archived Fire/EMS calls (with playback)',
      url: 'https://openmhz.com/system/dcfd',
      type: 'openmhz',
    },
    {
      id: 'pg-fire',
      name: "Prince George's County Fire",
      description: 'PG County Fire/EMS Dispatch',
      url: 'https://www.broadcastify.com/listen/feed/30921',
      popoutUrl: 'https://www.broadcastify.com/listen/feed/30921',
      type: 'broadcastify',
      feedId: '30921',
    },
  ];

  let activePlayer: string | null = null;
  let embedLoading = false;
  let embedError = false;

  function togglePlayer(feedId: string) {
    if (activePlayer === feedId) {
      activePlayer = null;
      embedError = false;
    } else {
      activePlayer = feedId;
      embedLoading = true;
      embedError = false;
    }
  }

  function onEmbedLoad() {
    embedLoading = false;
  }

  function onEmbedError() {
    embedLoading = false;
    embedError = true;
  }

  function openInNewWindow(url: string) {
    window.open(url, '_blank', 'width=400,height=500,menubar=no,toolbar=no,location=no,status=no');
  }
</script>

<div class="bg-white dark:bg-gray-800 rounded-lg shadow-lg w-96 max-h-[32rem] overflow-hidden border border-gray-200 dark:border-gray-700 flex flex-col">
  <!-- Header -->
  <div class="flex items-center justify-between p-3 border-b border-gray-200 dark:border-gray-700">
    <div class="flex items-center gap-2">
      <svg class="w-5 h-5 text-red-500" fill="currentColor" viewBox="0 0 24 24">
        <path d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
      </svg>
      <h3 class="font-medium text-gray-900 dark:text-white">Emergency Scanner</h3>
    </div>
    <button
      on:click={() => dispatch('close')}
      class="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
      aria-label="Close scanner panel"
    >
      <svg class="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
  </div>

  <!-- Warning about police encryption -->
  <div class="p-2 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800">
    <p class="text-xs text-amber-800 dark:text-amber-200">
      <strong>Note:</strong> DC Metro Police radios are fully encrypted. Only Fire/EMS is available.
    </p>
  </div>

  <!-- Scanner feeds list -->
  <div class="p-2 space-y-2 overflow-y-auto flex-1">
    {#each scannerFeeds as feed}
      <div class="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
        <button
          on:click={() => togglePlayer(feed.id)}
          class="w-full p-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
        >
          <div class="flex items-center justify-between">
            <div>
              <h4 class="text-sm font-medium text-gray-900 dark:text-white">{feed.name}</h4>
              <p class="text-xs text-gray-500 dark:text-gray-400">{feed.description}</p>
            </div>
            {#if activePlayer === feed.id}
              <div class="flex items-center gap-1">
                <span class="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
                <span class="text-xs text-red-500">LIVE</span>
              </div>
            {:else}
              <svg class="w-5 h-5 text-gray-400" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            {/if}
          </div>
        </button>

        {#if activePlayer === feed.id && feed.type === 'broadcastify'}
          {@const playerUrl = feed.popoutUrl || feed.url}
          <div class="p-3 bg-gray-50 dark:bg-gray-900/50 space-y-3">
            <!-- Instructions -->
            <p class="text-xs text-gray-600 dark:text-gray-400 text-center">
              Click below to open the live audio player
            </p>
            
            <!-- Primary action: Open in popup window -->
            <div class="flex flex-col gap-2">
              <button
                on:click={() => openInNewWindow(playerUrl)}
                class="w-full inline-flex items-center justify-center gap-2 px-4 py-3 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 transition-colors"
              >
                <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
                Listen Live
              </button>
              
              <a
                href={playerUrl}
                target="_blank"
                rel="noopener noreferrer"
                class="w-full inline-flex items-center justify-center gap-2 px-3 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-xs rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
                Open in New Tab
              </a>
            </div>

            <p class="text-xs text-gray-500 dark:text-gray-400 text-center">
              Audio requires interaction to start (browser policy)
            </p>
          </div>
        {/if}

        {#if activePlayer === feed.id && feed.type === 'openmhz'}
          <div class="p-3 bg-gray-50 dark:bg-gray-900/50 space-y-3">
            <p class="text-xs text-gray-600 dark:text-gray-400 text-center">
              Listen to archived Fire/EMS radio calls
            </p>
            
            <a
              href={feed.url}
              target="_blank"
              rel="noopener noreferrer"
              class="w-full inline-flex items-center justify-center gap-2 px-4 py-3 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
            >
              <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
              Open OpenMHz Player
            </a>
            <p class="text-xs text-gray-500 dark:text-gray-400 text-center">
              Browse recent transmissions with playback controls
            </p>
          </div>
        {/if}
      </div>
    {/each}
  </div>

  <!-- External links -->
  <div class="p-3 border-t border-gray-200 dark:border-gray-700 flex-shrink-0">
    <p class="text-xs text-gray-500 dark:text-gray-400 mb-2">More scanner feeds:</p>
    <div class="flex flex-wrap gap-x-3 gap-y-1">
      <a
        href="https://www.broadcastify.com/listen/ctid/315"
        target="_blank"
        rel="noopener noreferrer"
        class="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
      >
        DC Area
      </a>
      <a
        href="https://www.broadcastify.com/listen/ctid/1845"
        target="_blank"
        rel="noopener noreferrer"
        class="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
      >
        Montgomery Co
      </a>
      <a
        href="https://www.broadcastify.com/listen/ctid/1854"
        target="_blank"
        rel="noopener noreferrer"
        class="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
      >
        Fairfax Co
      </a>
      <a
        href="https://www.broadcastify.com/listen/ctid/1844"
        target="_blank"
        rel="noopener noreferrer"
        class="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
      >
        Arlington
      </a>
    </div>
  </div>
</div>
