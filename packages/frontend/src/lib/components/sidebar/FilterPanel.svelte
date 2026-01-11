<script lang="ts">
  import {
    filters,
    toggleIncidentType,
    setMinSeverity,
    toggleCameras,
    toggleWeather,
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
    </div>
  </div>

  <!-- Reset Button -->
  <button
    on:click={resetFilters}
    class="w-full px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
  >
    Reset Filters
  </button>
</div>
