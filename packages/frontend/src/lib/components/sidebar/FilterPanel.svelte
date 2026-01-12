<script lang="ts">
  import {
    filters,
    toggleIncidentType,
    setMinSeverity,
    toggleCameras,
    toggleLocationOnlyCameras,
    toggleWeather,
    toggleCrimeHeatmap,
    setTimeRange,
    resetFilters,
  } from '$stores/filters';
  import { incidentCounts } from '$stores/incidents';
  import { getIncidentTypeName, getIncidentTypeColor, getSeverityColor, getSeverityLabel } from '$utils/format';
  import type { IncidentType, FilterState } from '$types';

  const incidentTypes: IncidentType[] = ['traffic', 'crime', 'fire', 'transit', 'gunshot', 'hazard'];
  const timeRanges: { value: FilterState['timeRange']; label: string }[] = [
    { value: 'all', label: 'All Time' },
    { value: '1h', label: 'Last Hour' },
    { value: '6h', label: 'Last 6 Hours' },
    { value: '24h', label: 'Last 24 Hours' },
  ];
</script>

<div class="h-full overflow-y-auto custom-scrollbar p-4 space-y-6">
  <!-- Incident Types -->
  <div>
    <h3 class="text-sm font-medium text-gray-900 dark:text-white mb-3">Incident Types</h3>
    <div class="space-y-2">
      {#each incidentTypes as type}
        <label class="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={$filters.incidentTypes.has(type)}
            on:change={() => toggleIncidentType(type)}
            class="rounded border-gray-300 dark:border-gray-600 text-indigo-600 focus:ring-indigo-500"
          />
          <span
            class="w-3 h-3 rounded-full"
            style="background-color: {getIncidentTypeColor(type)}"
          ></span>
          <span class="text-sm text-gray-700 dark:text-gray-300 flex-1">
            {getIncidentTypeName(type)}
          </span>
          <span class="text-xs text-gray-500 dark:text-gray-400 tabular-nums">
            {$incidentCounts[type]}
          </span>
        </label>
      {/each}
    </div>
  </div>

  <!-- Severity Filter -->
  <div>
    <h3 class="text-sm font-medium text-gray-900 dark:text-white mb-3">
      Minimum Severity: {getSeverityLabel($filters.minSeverity)}
    </h3>
    <input
      type="range"
      min="1"
      max="5"
      value={$filters.minSeverity}
      on:input={(e) => setMinSeverity(parseInt(e.currentTarget.value))}
      class="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer"
    />
    <div class="flex justify-between mt-1">
      {#each [1, 2, 3, 4, 5] as level}
        <span
          class="w-4 h-4 rounded-full text-xs flex items-center justify-center"
          style="background-color: {getSeverityColor(level)}; color: white"
        >
          {level}
        </span>
      {/each}
    </div>
  </div>

  <!-- Time Range -->
  <div>
    <h3 class="text-sm font-medium text-gray-900 dark:text-white mb-3">Time Range</h3>
    <div class="grid grid-cols-2 gap-2">
      {#each timeRanges as range}
        <button
          on:click={() => setTimeRange(range.value)}
          class="px-3 py-2 text-sm rounded-lg transition-colors"
          class:bg-indigo-100={$filters.timeRange === range.value}
          class:dark:bg-indigo-900={$filters.timeRange === range.value}
          class:text-indigo-700={$filters.timeRange === range.value}
          class:dark:text-indigo-300={$filters.timeRange === range.value}
          class:bg-gray-100={$filters.timeRange !== range.value}
          class:dark:bg-gray-700={$filters.timeRange !== range.value}
          class:text-gray-700={$filters.timeRange !== range.value}
          class:dark:text-gray-300={$filters.timeRange !== range.value}
          class:hover:bg-gray-200={$filters.timeRange !== range.value}
          class:dark:hover:bg-gray-600={$filters.timeRange !== range.value}
        >
          {range.label}
        </button>
      {/each}
    </div>
  </div>

  <!-- Map Layers -->
  <div>
    <h3 class="text-sm font-medium text-gray-900 dark:text-white mb-3">Map Layers</h3>
    <div class="space-y-2">
      <label class="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={$filters.showCameras}
          on:change={toggleCameras}
          class="rounded border-gray-300 dark:border-gray-600 text-indigo-600 focus:ring-indigo-500"
        />
        <svg class="w-5 h-5 text-indigo-500" fill="currentColor" viewBox="0 0 24 24">
          <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14v-4zM3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z"/>
        </svg>
        <span class="text-sm text-gray-700 dark:text-gray-300">Traffic Cameras</span>
      </label>
      {#if $filters.showCameras}
        <label class="flex items-center gap-3 cursor-pointer ml-6">
          <input
            type="checkbox"
            checked={$filters.showLocationOnlyCameras}
            on:change={toggleLocationOnlyCameras}
            class="rounded border-gray-300 dark:border-gray-600 text-indigo-600 focus:ring-indigo-500"
          />
          <svg class="w-4 h-4 text-gray-400" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
          </svg>
          <span class="text-xs text-gray-500 dark:text-gray-400">Include location-only markers</span>
        </label>
      {/if}
      <label class="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={$filters.showWeather}
          on:change={toggleWeather}
          class="rounded border-gray-300 dark:border-gray-600 text-indigo-600 focus:ring-indigo-500"
        />
        <svg class="w-5 h-5 text-indigo-500" fill="currentColor" viewBox="0 0 24 24">
          <path d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z"/>
        </svg>
        <span class="text-sm text-gray-700 dark:text-gray-300">Weather Alerts</span>
      </label>
      <label class="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={$filters.showCrimeHeatmap}
          on:change={toggleCrimeHeatmap}
          class="rounded border-gray-300 dark:border-gray-600 text-indigo-600 focus:ring-indigo-500"
        />
        <svg class="w-5 h-5 text-red-500" fill="currentColor" viewBox="0 0 24 24">
          <path d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z"/>
        </svg>
        <span class="text-sm text-gray-700 dark:text-gray-300">Crime Heatmap</span>
      </label>
    </div>
  </div>

  <!-- Reset Button -->
  <button
    on:click={resetFilters}
    class="w-full px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
  >
    Reset Filters
  </button>

  <!-- Data Sources Info -->
  <div class="pt-4 border-t border-gray-200 dark:border-gray-700">
    <details class="group">
      <summary class="flex items-center justify-between cursor-pointer text-sm font-medium text-gray-700 dark:text-gray-300">
        <span>ℹ️ About Data Sources</span>
        <svg class="w-4 h-4 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
        </svg>
      </summary>
      <div class="mt-3 text-xs text-gray-600 dark:text-gray-400 space-y-3">
        <div>
          <p class="font-semibold text-gray-700 dark:text-gray-300 mb-1">🔥 Fire/EMS</p>
          <p>Live incidents from DC Fire & EMS via PulsePoint. Updated every 2 minutes.</p>
        </div>
        
        <div>
          <p class="font-semibold text-gray-700 dark:text-gray-300 mb-1">🚗 Traffic</p>
          <p>MD CHART + DC HSEMA: crashes, road closures, construction. Updated every minute.</p>
        </div>
        
        <div>
          <p class="font-semibold text-gray-700 dark:text-gray-300 mb-1">🔫 Crime & Gunshots</p>
          <p>DC Open Data: last 30 days of crime reports + ShotSpotter gunshot detection.</p>
        </div>
        
        <div>
          <p class="font-semibold text-gray-700 dark:text-gray-300 mb-1">🚇 Metro</p>
          <p>WMATA service alerts and delays. Header shows affected lines with color badges.</p>
        </div>
        
        <div>
          <p class="font-semibold text-gray-700 dark:text-gray-300 mb-1">🌤️ Weather</p>
          <p>Current conditions (Open-Meteo) + NWS severe weather alerts with map polygons.</p>
        </div>
        
        <div>
          <p class="font-semibold text-gray-700 dark:text-gray-300 mb-1">📹 Cameras</p>
          <p>100+ feeds: MD CHART highways, DC DOT streets, plus curated landmark webcams (Capitol, Monument, FOX 5 DC, etc.)</p>
        </div>

        <div class="pt-2 border-t border-gray-200 dark:border-gray-600">
          <p class="text-gray-500 dark:text-gray-400">
            <strong>Note:</strong> DC Metro Police radios are encrypted. No police scanner data available.
          </p>
        </div>

        <div class="flex flex-wrap gap-2 pt-1">
          <a
            href="https://www.pulsepoint.org/"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-1 px-2 py-1 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded text-xs hover:bg-red-200 dark:hover:bg-red-900/50"
          >
            📱 PulsePoint App
          </a>
          <a
            href="https://www.broadcastify.com/calls/playlists/?uuid=1c951e2a-efd3-11ef-9e04-0e98d5b32039"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded text-xs hover:bg-blue-200 dark:hover:bg-blue-900/50"
          >
            🎧 DC Fire/EMS Audio
          </a>
          <a
            href="https://www.fox5dc.com/live-weather-cameras-across-dc-maryland-and-virginia"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-1 px-2 py-1 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded text-xs hover:bg-purple-200 dark:hover:bg-purple-900/50"
          >
            📺 FOX 5 Skycams
          </a>
        </div>
      </div>
    </details>
  </div>
</div>
