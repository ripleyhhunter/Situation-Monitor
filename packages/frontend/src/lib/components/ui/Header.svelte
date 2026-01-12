<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { connectionStatus, lastEventTime } from '$services/sse';
  import { darkMode, toggleDarkMode, sidebarOpen, toggleSidebar } from '$stores/location';
  import { airQuality, aqiColor, aqiDescription, currentWeather } from '$stores/weather';
  import { incidentCounts, metroDelays } from '$stores/incidents';
  import { formatRelativeTime } from '$utils/time';
  import SearchBar from './SearchBar.svelte';

  export let showScanner = false;

  const dispatch = createEventDispatcher<{
    search: { lat: number; lng: number; name: string };
  }>();

  $: totalIncidents = Object.values($incidentCounts).reduce((a, b) => a + b, 0);

  // Get short line code for display
  function getLineCode(line: string): string {
    const codes: Record<string, string> = {
      'Red Line': 'RD',
      'Blue Line': 'BL',
      'Orange Line': 'OR',
      'Silver Line': 'SV',
      'Green Line': 'GR',
      'Yellow Line': 'YL',
    };
    return codes[line] || line.substring(0, 2).toUpperCase();
  }

  function handleSearch(event: CustomEvent<{ lat: number; lng: number; name: string }>) {
    dispatch('search', event.detail);
  }
</script>

<header class="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700 z-50">
  <div class="flex items-center justify-between px-4 h-14">
    <!-- Left section -->
    <div class="flex items-center gap-4">
      <!-- Sidebar toggle -->
      <button
        on:click={toggleSidebar}
        class="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        aria-label="Toggle sidebar"
      >
        <svg class="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          {#if $sidebarOpen}
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
          {:else}
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
          {/if}
        </svg>
      </button>

      <!-- Logo/Title -->
      <div class="flex items-center gap-2">
        <div class="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
          <svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
          </svg>
        </div>
        <h1 class="text-lg font-semibold text-gray-900 dark:text-white hidden sm:block">
          Situation Monitor
        </h1>
        <span class="text-xs text-gray-500 dark:text-gray-400 hidden md:block">DC</span>
      </div>

      <!-- Search Bar -->
      <div class="hidden sm:block w-48 lg:w-64">
        <SearchBar on:select={handleSearch} />
      </div>
    </div>

    <!-- Center section - Stats -->
    <div class="hidden md:flex items-center gap-4 lg:gap-6 overflow-x-auto">
      <!-- Current Weather -->
      {#if $currentWeather}
        <div class="flex items-center gap-1.5 flex-shrink-0">
          <span class="text-lg" title={$currentWeather.description}>
            {$currentWeather.icon}
          </span>
          <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
            {Math.round($currentWeather.temperature)}°F
          </span>
          <span class="text-xs text-gray-500 dark:text-gray-400 hidden lg:inline">
            {$currentWeather.description}
          </span>
        </div>
      {/if}

      <!-- Active Incidents -->
      <div class="flex items-center gap-2 flex-shrink-0">
        <div class="w-2 h-2 rounded-full bg-red-500 animate-pulse"></div>
        <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
          {totalIncidents} Active
        </span>
      </div>

      <!-- AQI -->
      {#if $airQuality}
        <div class="flex items-center gap-2 flex-shrink-0">
          <div
            class="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
            style="background-color: {$aqiColor}; color: {$airQuality.aqi > 100 ? 'white' : 'black'}"
          >
            {$airQuality.aqi}
          </div>
          <span class="text-sm text-gray-600 dark:text-gray-400">AQI: {$aqiDescription}</span>
        </div>
      {/if}

      <!-- Metro Delays -->
      {#if $metroDelays.length > 0}
        <div class="flex items-center gap-2 flex-shrink-0">
          <svg class="w-4 h-4 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 4h8a2 2 0 012 2v10a2 2 0 01-2 2H8a2 2 0 01-2-2V6a2 2 0 012-2z"/>
            <circle cx="9" cy="14" r="1"/>
            <circle cx="15" cy="14" r="1"/>
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 18v2m6-2v2"/>
          </svg>
          <div class="flex items-center gap-1">
            {#each $metroDelays as delay}
              <span
                class="px-1.5 py-0.5 text-xs font-bold rounded"
                style="background-color: {delay.color}; color: {delay.line === 'Yellow Line' ? '#000' : '#fff'}"
                title="{delay.line}: {delay.severity} ({delay.count} alert{delay.count > 1 ? 's' : ''})"
              >
                {getLineCode(delay.line)}
              </span>
            {/each}
          </div>
          <span class="text-xs text-gray-500 dark:text-gray-400">delays</span>
        </div>
      {/if}

      <!-- Connection Status -->
      <div class="flex items-center gap-2 flex-shrink-0">
        <div
          class="w-2 h-2 rounded-full"
          class:bg-green-500={$connectionStatus === 'connected'}
          class:bg-yellow-500={$connectionStatus === 'connecting'}
          class:bg-red-500={$connectionStatus === 'error' || $connectionStatus === 'disconnected'}
        ></div>
        <span class="text-xs text-gray-500 dark:text-gray-400">
          {#if $connectionStatus === 'connected' && $lastEventTime}
            Updated {formatRelativeTime($lastEventTime)}
          {:else}
            {$connectionStatus}
          {/if}
        </span>
      </div>
    </div>

    <!-- Right section -->
    <div class="flex items-center gap-2">
      <!-- Mobile connection indicator -->
      <div class="md:hidden flex items-center">
        <div
          class="w-2 h-2 rounded-full"
          class:bg-green-500={$connectionStatus === 'connected'}
          class:bg-yellow-500={$connectionStatus === 'connecting'}
          class:bg-red-500={$connectionStatus === 'error' || $connectionStatus === 'disconnected'}
          class:animate-pulse={$connectionStatus === 'connecting'}
          title={$connectionStatus === 'connected' ? 'Connected' : $connectionStatus}
        ></div>
      </div>

      <!-- Scanner toggle -->
      <button
        on:click={() => (showScanner = !showScanner)}
        class="p-2 rounded-lg transition-colors"
        class:bg-indigo-100={showScanner}
        class:dark:bg-indigo-900={showScanner}
        class:hover:bg-gray-100={!showScanner}
        class:dark:hover:bg-gray-700={!showScanner}
        aria-label="Toggle scanner"
        title="Emergency Scanner"
      >
        <svg class="w-5 h-5" class:text-indigo-600={showScanner} class:dark:text-indigo-400={showScanner} class:text-gray-600={!showScanner} class:dark:text-gray-300={!showScanner} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
        </svg>
      </button>

      <!-- Dark mode toggle -->
      <button
        on:click={toggleDarkMode}
        class="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        aria-label="Toggle dark mode"
      >
        {#if $darkMode}
          <svg class="w-5 h-5 text-yellow-500" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
          </svg>
        {:else}
          <svg class="w-5 h-5 text-gray-600" fill="currentColor" viewBox="0 0 24 24">
            <path d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
          </svg>
        {/if}
      </button>
    </div>
  </div>
</header>
