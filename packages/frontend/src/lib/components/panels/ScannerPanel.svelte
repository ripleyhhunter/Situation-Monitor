<script lang="ts">
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  import { 
    scannerCalls, 
    liveCalls,
    scannerFeeds,
    playingCallId,
    selectedRegion,
    feedsByRegion,
    fetchScannerCalls,
    fetchScannerFeeds,
    setPlayingCall,
    formatDuration,
    formatCallTime,
    getCallTypeColor,
    getCallTypeName
  } from '$stores/scanner';
  import type { ScannerCall, ScannerFeed } from '$types';

  const dispatch = createEventDispatcher();

  let activeTab: 'live' | 'feeds' | 'archive' = 'live';
  let audioElement: HTMLAudioElement | null = null;
  let isLoading = true;
  let refreshInterval: ReturnType<typeof setInterval>;

  onMount(async () => {
    // Fetch initial data
    await Promise.all([
      fetchScannerCalls(),
      fetchScannerFeeds()
    ]);
    isLoading = false;

    // Refresh calls every 30 seconds
    refreshInterval = setInterval(() => {
      fetchScannerCalls();
    }, 30000);
  });

  onDestroy(() => {
    if (refreshInterval) {
      clearInterval(refreshInterval);
    }
    if (audioElement) {
      audioElement.pause();
      audioElement = null;
    }
  });

  function playCall(call: ScannerCall) {
    if (audioElement) {
      audioElement.pause();
    }
    
    audioElement = new Audio(call.audioUrl);
    audioElement.play().catch((err) => {
      console.error('Failed to play audio:', err);
    });
    
    setPlayingCall(call.id);
    
    audioElement.onended = () => {
      setPlayingCall(null);
    };

    audioElement.onerror = () => {
      console.error('Audio playback error');
      setPlayingCall(null);
    };
  }

  function stopPlayback() {
    if (audioElement) {
      audioElement.pause();
      audioElement = null;
    }
    setPlayingCall(null);
  }

  function openFeed(feed: ScannerFeed) {
    const link = feed.embedUrl || feed.webUrl;
    if (link) {
      window.open(link, '_blank');
    }
  }

  $: regionOptions = [
    { value: 'all', label: 'All Regions' },
    { value: 'dc', label: 'DC' },
    { value: 'md', label: 'Maryland' },
    { value: 'va', label: 'Virginia' },
    { value: 'metro', label: 'Metro' }
  ] as const;
</script>

<div class="bg-gray-900 rounded-lg shadow-xl w-96 max-h-[600px] overflow-hidden border border-gray-700">
  <!-- Header -->
  <div class="flex items-center justify-between p-3 bg-gray-800 border-b border-gray-700">
    <div class="flex items-center gap-2">
      <span class="relative flex h-3 w-3">
        <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
        <span class="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
      </span>
      <h3 class="font-semibold text-white">Emergency Scanner</h3>
    </div>
    <button
      on:click={() => dispatch('close')}
      class="p-1 rounded hover:bg-gray-700 text-gray-400 hover:text-white transition-colors"
    >
      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
  </div>

  <!-- Police Encryption Notice -->
  <div class="px-3 py-2 bg-amber-900/30 border-b border-amber-800/50">
    <p class="text-xs text-amber-200">
      <span class="font-semibold">Note:</span> DC Metro Police radios encrypted since 2011. Fire/EMS only.
    </p>
  </div>

  <!-- Tabs -->
  <div class="flex border-b border-gray-700">
    <button
      class="flex-1 py-2.5 text-sm font-medium transition-colors {activeTab === 'live' ? 'text-red-400 border-b-2 border-red-400 bg-gray-800/50' : 'text-gray-400 hover:text-gray-200'}"
      on:click={() => activeTab = 'live'}
    >
      <span class="flex items-center justify-center gap-1.5">
        {#if $liveCalls.length > 0}
          <span class="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
        {/if}
        Live ({$liveCalls.length})
      </span>
    </button>
    <button
      class="flex-1 py-2.5 text-sm font-medium transition-colors {activeTab === 'feeds' ? 'text-blue-400 border-b-2 border-blue-400 bg-gray-800/50' : 'text-gray-400 hover:text-gray-200'}"
      on:click={() => activeTab = 'feeds'}
    >
      Feeds
    </button>
    <button
      class="flex-1 py-2.5 text-sm font-medium transition-colors {activeTab === 'archive' ? 'text-purple-400 border-b-2 border-purple-400 bg-gray-800/50' : 'text-gray-400 hover:text-gray-200'}"
      on:click={() => activeTab = 'archive'}
    >
      Archive ({$scannerCalls.length})
    </button>
  </div>

  <!-- Content -->
  <div class="overflow-y-auto max-h-80">
    {#if isLoading}
      <div class="flex items-center justify-center py-12">
        <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-red-500"></div>
      </div>
    {:else if activeTab === 'live'}
      <!-- Live Calls -->
      {#if $liveCalls.length === 0}
        <div class="py-8 text-center text-gray-500">
          <svg class="w-12 h-12 mx-auto mb-3 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
          </svg>
          <p class="text-sm">No recent activity</p>
          <p class="text-xs text-gray-600 mt-1">Calls appear within 5 minutes</p>
        </div>
      {:else}
        {#each $liveCalls as call (call.id)}
          <button
            class="w-full p-3 text-left border-b border-gray-800 hover:bg-gray-800/50 transition-colors {$playingCallId === call.id ? 'bg-gray-800' : ''}"
            on:click={() => $playingCallId === call.id ? stopPlayback() : playCall(call)}
          >
            <div class="flex items-start justify-between gap-2">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  <span 
                    class="inline-block w-2 h-2 rounded-full" 
                    style="background-color: {getCallTypeColor(call.callType)}"
                  ></span>
                  <span class="text-sm font-medium text-white truncate">{call.talkgroupAlpha}</span>
                </div>
                {#if call.talkgroupDescription}
                  <p class="text-xs text-gray-500 mt-0.5 truncate">{call.talkgroupDescription}</p>
                {/if}
              </div>
              <div class="flex flex-col items-end text-xs">
                <span class="text-gray-400">{formatCallTime(call.timestamp)}</span>
                <span class="text-gray-500">{formatDuration(call.duration)}</span>
              </div>
            </div>
            {#if $playingCallId === call.id}
              <div class="mt-2 flex items-center gap-2">
                <div class="flex-1 h-1 bg-gray-700 rounded-full overflow-hidden">
                  <div class="h-full bg-red-500 animate-pulse" style="width: 100%"></div>
                </div>
                <span class="text-xs text-red-400">Playing...</span>
              </div>
            {/if}
          </button>
        {/each}
      {/if}

    {:else if activeTab === 'feeds'}
      <!-- Live Feeds -->
      <div class="p-2">
        <select
          bind:value={$selectedRegion}
          class="w-full mb-2 px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          {#each regionOptions as option}
            <option value={option.value}>{option.label}</option>
          {/each}
        </select>
      </div>

      {#if $feedsByRegion.length === 0}
        <div class="py-8 text-center text-gray-500">
          <p class="text-sm">No feeds available for this region</p>
        </div>
      {:else}
        {#each $feedsByRegion as feed (feed.id)}
          <button
            class="w-full p-3 text-left border-b border-gray-800 hover:bg-gray-800/50 transition-colors"
            on:click={() => openFeed(feed)}
          >
            <div class="flex items-start justify-between">
              <div class="flex-1">
                <div class="flex items-center gap-2">
                  {#if feed.isLive}
                    <span class="w-2 h-2 rounded-full bg-green-500"></span>
                  {:else}
                    <span class="w-2 h-2 rounded-full bg-gray-500"></span>
                  {/if}
                  <span class="text-sm font-medium text-white">{feed.name}</span>
                </div>
                <p class="text-xs text-gray-500 mt-0.5">{feed.description}</p>
              </div>
              <div class="flex items-center gap-1">
                <span class="text-xs px-2 py-0.5 rounded bg-gray-700 text-gray-300 uppercase">{feed.region}</span>
                <svg class="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </div>
            </div>
          </button>
        {/each}
      {/if}

    {:else if activeTab === 'archive'}
      <!-- All Recent Calls -->
      {#if $scannerCalls.length === 0}
        <div class="py-8 text-center text-gray-500">
          <p class="text-sm">No archived calls</p>
        </div>
      {:else}
        {#each $scannerCalls as call (call.id)}
          <button
            class="w-full p-3 text-left border-b border-gray-800 hover:bg-gray-800/50 transition-colors {$playingCallId === call.id ? 'bg-gray-800' : ''}"
            on:click={() => $playingCallId === call.id ? stopPlayback() : playCall(call)}
          >
            <div class="flex items-start justify-between gap-2">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  <span 
                    class="inline-block w-2 h-2 rounded-full flex-shrink-0" 
                    style="background-color: {getCallTypeColor(call.callType)}"
                  ></span>
                  <span class="text-sm font-medium text-white truncate">{call.talkgroupAlpha}</span>
                  <span class="text-xs px-1.5 py-0.5 rounded bg-gray-700 text-gray-400">{getCallTypeName(call.callType)}</span>
                </div>
              </div>
              <div class="flex flex-col items-end text-xs flex-shrink-0">
                <span class="text-gray-400">{formatCallTime(call.timestamp)}</span>
                <span class="text-gray-500">{formatDuration(call.duration)}</span>
              </div>
            </div>
            {#if $playingCallId === call.id}
              <div class="mt-2 flex items-center gap-2">
                <div class="flex-1 h-1 bg-gray-700 rounded-full overflow-hidden">
                  <div class="h-full bg-red-500 animate-pulse" style="width: 100%"></div>
                </div>
                <span class="text-xs text-red-400">Playing...</span>
              </div>
            {/if}
          </button>
        {/each}
      {/if}
    {/if}
  </div>

  <!-- Footer without iframe (Broadcastify blocks embedding) -->
  <div class="border-t border-gray-700 bg-gray-800">
    <div class="p-3 space-y-2">
      <div class="flex items-center justify-between">
        <div>
          <p class="text-xs text-gray-400">DC Fire/EMS Live Stream</p>
          <p class="text-[11px] text-gray-500">Opens on Broadcastify (embedding is blocked)</p>
        </div>
        <a
          href="https://www.broadcastify.com/listen/feed/2455"
          target="_blank"
          rel="noopener noreferrer"
          class="text-xs px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-500 transition-colors"
        >
          Open Live Feed
        </a>
      </div>
    </div>

    <!-- Quick Links -->
    <div class="px-3 pb-3">
      <p class="text-xs text-gray-500 mb-2">More Resources:</p>
      <div class="flex flex-wrap gap-2">
        <a
          href="https://www.broadcastify.com/listen/ctid/315"
          target="_blank"
          rel="noopener noreferrer"
          class="text-xs px-2 py-1 rounded bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors"
        >
          DC Feeds
        </a>
        <a
          href="https://openmhz.com/system/dcfd"
          target="_blank"
          rel="noopener noreferrer"
          class="text-xs px-2 py-1 rounded bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors"
        >
          OpenMHz
        </a>
        <a
          href="https://dmvrealtime.com"
          target="_blank"
          rel="noopener noreferrer"
          class="text-xs px-2 py-1 rounded bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors"
        >
          DMV RealTime
        </a>
      </div>
    </div>
  </div>
</div>
