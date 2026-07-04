<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { selectedRegion } from '$stores/region';
  import { scannerCalls } from '$stores/scanner';
  import { formatRelativeTime } from '$utils/time';
  import { REGION_PRESETS } from '$lib/config';

  const dispatch = createEventDispatcher();

  // How many archived calls to list — a full batch is 50, which would
  // dominate the panel.
  const MAX_CALLS_SHOWN = 20;
  $: liveCalls = $scannerCalls.slice(0, MAX_CALLS_SHOWN);

  interface ScannerFeed {
    id: string;
    name: string;
    description: string;
    url: string;
    type: 'broadcastify' | 'openmhz' | 'broadcastify-calls' | 'pulsepoint';
    popoutUrl?: string;
    recommended?: boolean;
  }

  // Per-region scanner feed lists. Boise/Ada County uses SWIRC P25 Phase II
  // (encrypted dispatch on some talkgroups), so we mostly point users at
  // PulsePoint + RadioReference / OpenMHz search rather than direct streams.
  const FEEDS_BY_REGION: Record<string, ScannerFeed[]> = {
    dc: [
      { id: 'pulsepoint', name: '🔥 PulsePoint App', description: 'Also view on the official PulsePoint app/website', url: 'https://web.pulsepoint.org/', type: 'pulsepoint' },
      { id: 'dc-fire-ems-calls', name: 'DC Fire/EMS Audio', description: 'DCFD via Broadcastify Calls platform', url: 'https://www.broadcastify.com/calls/playlists/?uuid=1c951e2a-efd3-11ef-9e04-0e98d5b32039', type: 'broadcastify-calls' },
      { id: 'openmhz-dcfd', name: 'OpenMHz - DCFD', description: 'Archived Fire/EMS calls with playback', url: 'https://openmhz.com/system/dcfd', type: 'openmhz' },
      { id: 'mwaa-public-safety', name: 'DC Airports Public Safety', description: 'DCA & IAD Fire/Rescue/Police', url: 'https://www.broadcastify.com/listen/feed/1605', popoutUrl: 'https://www.broadcastify.com/listen/feed/1605', type: 'broadcastify' },
      { id: 'mutual-aid-md-dc', name: 'MD-DC Mutual Aid', description: 'Interoperability channels', url: 'https://www.broadcastify.com/listen/feed/41616', popoutUrl: 'https://www.broadcastify.com/listen/feed/41616', type: 'broadcastify' },
      { id: 'wmata-rail', name: 'WMATA MetroRail', description: 'Metro Rail communications', url: 'https://www.broadcastify.com/listen/feed/41617', popoutUrl: 'https://www.broadcastify.com/listen/feed/41617', type: 'broadcastify' },
      { id: 'pg-fire', name: "Prince George's Co Fire/EMS", description: 'PG County Dispatch & Fireground', url: 'https://www.broadcastify.com/listen/feed/24385', popoutUrl: 'https://www.broadcastify.com/listen/feed/24385', type: 'broadcastify' },
      { id: 'montgomery-fire', name: 'Montgomery Co Fire Dispatch', description: 'MoCo Fire/Rescue Dispatch', url: 'https://www.broadcastify.com/listen/feed/45306', popoutUrl: 'https://www.broadcastify.com/listen/feed/45306', type: 'broadcastify' },
    ],
    boise: [
      { id: 'pulsepoint', name: '🔥 PulsePoint App', description: 'Ada County ACCESS - Boise Fire, Meridian Fire, Eagle/Star/N Ada Fire, Ada County Paramedics', url: 'https://web.pulsepoint.org/?agencyid=EMS1169', type: 'pulsepoint' },
      { id: 'radioreference-ada', name: 'RadioReference - Ada County', description: 'SWIRC P25 Phase II talkgroup directory', url: 'https://www.radioreference.com/db/browse/ctid/547', popoutUrl: 'https://www.radioreference.com/db/browse/ctid/547', type: 'broadcastify' },
      { id: 'broadcastify-boi-airport', name: 'Boise Airport (BOI) Public Safety', description: 'Airport fire/police/security', url: 'https://www.broadcastify.com/db/aid/1809', popoutUrl: 'https://www.broadcastify.com/db/aid/1809', type: 'broadcastify' },
    ],
  };

  // Reactive: re-derive when user switches region.
  $: scannerFeeds = (FEEDS_BY_REGION[$selectedRegion.id] ?? FEEDS_BY_REGION.dc) as ScannerFeed[];
  $: void REGION_PRESETS; // keep import for clarity / future use


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

  <!-- Info about available feeds -->
  <div class="p-2 bg-green-50 dark:bg-green-900/20 border-b border-green-200 dark:border-green-800">
    <p class="text-xs text-green-800 dark:text-green-200">
      {#if $selectedRegion.id === 'boise'}
        <strong>🔥 Fire/EMS incidents are live on the map!</strong> Data from Ada County ACCESS via PulsePoint, updated every 2 minutes. Boise PD uses SWIRC P25 Phase II — some channels encrypted.
      {:else}
        <strong>🔥 Fire/EMS incidents are live on the map!</strong> Data from DC Fire & EMS via PulsePoint, updated every 2 minutes. DC Police radios are encrypted since 2011.
      {/if}
    </p>
  </div>

  <!-- Live call audio (OpenMHz) — present when the region has a wired system -->
  {#if liveCalls.length > 0}
    <div class="border-b border-gray-200 dark:border-gray-700 flex-shrink-0 max-h-56 overflow-y-auto">
      <div class="px-3 pt-2 pb-1 flex items-center justify-between sticky top-0 bg-white dark:bg-gray-800">
        <h4 class="text-xs font-semibold text-gray-900 dark:text-white uppercase tracking-wide">
          Recent Calls — {liveCalls[0].systemLabel}
        </h4>
        <span class="text-[10px] text-gray-400">{formatRelativeTime(liveCalls[0].time)}</span>
      </div>
      <ul class="px-2 pb-2 space-y-1">
        {#each liveCalls as call (call.id)}
          <li class="rounded-lg border border-gray-100 dark:border-gray-700/60 px-2 py-1.5">
            <div class="flex items-center justify-between gap-2">
              <div class="min-w-0">
                <p class="text-xs font-medium text-gray-800 dark:text-gray-200 truncate">
                  {#if call.emergency}<span class="text-red-500 font-bold">⚠ </span>{/if}
                  {call.talkgroupDescription || call.talkgroupName || `Talkgroup ${call.talkgroup}`}
                </p>
                <p class="text-[10px] text-gray-500 dark:text-gray-400">
                  {formatRelativeTime(call.time)} • {call.durationSec}s{call.units && call.units.length ? ` • ${call.units.slice(0, 3).join(', ')}` : ''}
                </p>
              </div>
            </div>
            <!-- svelte-ignore a11y_media_has_caption -->
            <audio controls preload="none" src={call.audioUrl} class="w-full h-8 mt-1"></audio>
          </li>
        {/each}
      </ul>
    </div>
  {/if}

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
            <p class="text-xs text-gray-600 dark:text-gray-400 text-center">
              Click below to open the live audio player
            </p>
            
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
          </div>
        {/if}

        {#if activePlayer === feed.id && feed.type === 'pulsepoint'}
          <div class="p-3 bg-gradient-to-b from-red-50 to-orange-50 dark:from-red-900/20 dark:to-orange-900/20 space-y-3">
            <p class="text-xs text-gray-600 dark:text-gray-400 text-center">
              <strong>Best for Fire/EMS incidents!</strong> See live calls with locations on a map.
            </p>
            
            <div class="flex flex-col gap-2">
              <a
                href="https://apps.apple.com/app/pulsepoint-respond/id509990498"
                target="_blank"
                rel="noopener noreferrer"
                class="w-full inline-flex items-center justify-center gap-2 px-4 py-3 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors"
              >
                <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M18.71 19.5C17.88 20.74 17 21.95 15.66 21.97C14.32 22 13.89 21.18 12.37 21.18C10.84 21.18 10.37 21.95 9.09997 22C7.78997 22.05 6.79997 20.68 5.95997 19.47C4.24997 17 2.93997 12.45 4.69997 9.39C5.56997 7.87 7.12997 6.91 8.81997 6.88C10.1 6.86 11.32 7.75 12.11 7.75C12.89 7.75 14.37 6.68 15.92 6.84C16.57 6.87 18.39 7.1 19.56 8.82C19.47 8.88 17.39 10.1 17.41 12.63C17.44 15.65 20.06 16.66 20.09 16.67C20.06 16.74 19.67 18.11 18.71 19.5ZM13 3.5C13.73 2.67 14.94 2.04 15.94 2C16.07 3.17 15.6 4.35 14.9 5.19C14.21 6.04 13.07 6.7 11.95 6.61C11.8 5.46 12.36 4.26 13 3.5Z"/>
                </svg>
                Download iOS App
              </a>
              
              <a
                href="https://play.google.com/store/apps/details?id=org.pulsepoint.respond.android"
                target="_blank"
                rel="noopener noreferrer"
                class="w-full inline-flex items-center justify-center gap-2 px-4 py-3 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors"
              >
                <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M3.609 1.814L13.792 12 3.609 22.186a2.008 2.008 0 0 1-.609-1.442V3.256c0-.56.229-1.066.609-1.442z"/>
                  <path d="M14.863 13.071l2.809 1.621-2.809 1.621-2.071-2.121 2.071-2.121z" opacity=".5"/>
                  <path d="M14.863 10.929L12.792 8.808l2.071-2.121 2.809 1.621-2.809 2.621z" opacity=".75"/>
                  <path d="M17.672 6.687l2.984 1.721a1.334 1.334 0 0 1 0 2.308l-2.984 1.721-3.109-3.542 3.109-2.208z"/>
                </svg>
                Download Android App
              </a>
              
              <a
                href={feed.url}
                target="_blank"
                rel="noopener noreferrer"
                class="w-full inline-flex items-center justify-center gap-2 px-3 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-xs rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
                Open Web Version
              </a>
            </div>
            
            <p class="text-xs text-gray-500 dark:text-gray-400 text-center">
              DC Fire/EMS uses PulsePoint • Free app • Select "Washington DC FEMS"
            </p>
          </div>
        {/if}

        {#if activePlayer === feed.id && feed.type === 'broadcastify-calls'}
          <div class="p-3 bg-gray-50 dark:bg-gray-900/50 space-y-3">
            <p class="text-xs text-gray-600 dark:text-gray-400 text-center">
              Opens Broadcastify Calls platform (requires free account)
            </p>
            
            <a
              href={feed.url}
              target="_blank"
              rel="noopener noreferrer"
              class="w-full inline-flex items-center justify-center gap-2 px-4 py-3 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 transition-colors"
            >
              <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
              Open DC Fire/EMS Calls
            </a>
            
            <p class="text-xs text-gray-500 dark:text-gray-400 text-center">
              Free account required • Listen to recent radio calls
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
