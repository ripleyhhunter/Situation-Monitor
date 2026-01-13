<script lang="ts">
  import { aircraftList, aircraftCounts, selectAircraft, selectedAircraft } from '$stores/aircraft';
  import { filters } from '$stores/filters';
  import type { Aircraft, AircraftCategory } from '$types';

  // Sort options
  type SortField = 'callsign' | 'altitude' | 'speed' | 'category';
  let sortField: SortField = 'altitude';
  let sortAscending = false;

  // Filter options
  let showOnGround = false;
  let categoryFilter: AircraftCategory | 'all' = 'all';

  // Sorted and filtered aircraft list
  $: visibleAircraft = $aircraftList
    .filter(a => {
      if (!showOnGround && a.onGround) return false;
      if (categoryFilter !== 'all' && a.category !== categoryFilter) return false;
      return true;
    })
    .sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case 'callsign':
          comparison = a.callsign.localeCompare(b.callsign);
          break;
        case 'altitude':
          comparison = b.location.altitude - a.location.altitude;
          break;
        case 'speed':
          comparison = b.speed - a.speed;
          break;
        case 'category':
          comparison = a.category.localeCompare(b.category);
          break;
      }
      return sortAscending ? -comparison : comparison;
    });

  function getCategoryIcon(category: AircraftCategory): string {
    switch (category) {
      case 'helicopter': return '🚁';
      case 'military': return '🎖️';
      case 'commercial': return '✈️';
      case 'general': return '🛩️';
      default: return '✈️';
    }
  }

  function getCategoryColor(category: AircraftCategory): string {
    switch (category) {
      case 'commercial': return '#3b82f6';
      case 'military': return '#8b5cf6';
      case 'helicopter': return '#dc2626';
      case 'general': return '#22c55e';
      default: return '#f59e0b';
    }
  }

  function getCategoryBgColor(category: AircraftCategory): string {
    switch (category) {
      case 'commercial': return 'rgba(59, 130, 246, 0.2)';
      case 'military': return 'rgba(139, 92, 246, 0.2)';
      case 'helicopter': return 'rgba(220, 38, 38, 0.2)';
      case 'general': return 'rgba(34, 197, 94, 0.2)';
      default: return 'rgba(245, 158, 11, 0.2)';
    }
  }

  function formatAltitude(alt: number): string {
    if (alt >= 10000) {
      return `${(alt / 1000).toFixed(1)}k`;
    }
    return alt.toLocaleString();
  }

  function getVerticalIndicator(rate: number): string {
    if (rate > 100) return '↗️';
    if (rate < -100) return '↘️';
    return '→';
  }

  function handleAircraftClick(aircraft: Aircraft) {
    // Toggle tracking: if already selected, deselect (stop tracking)
    if ($selectedAircraft?.id === aircraft.id) {
      selectAircraft(null);
    } else {
      selectAircraft(aircraft);
    }
  }
</script>

<div class="h-full flex flex-col bg-white dark:bg-gray-800">
  <!-- Header with counts -->
  <div class="flex-shrink-0 p-3 border-b border-gray-200 dark:border-gray-700">
    <div class="flex items-center justify-between mb-2">
      <h3 class="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
        ✈️ Aircraft Tracker
      </h3>
      <span class="text-xs text-gray-500 dark:text-gray-400">
        {visibleAircraft.length} shown
      </span>
    </div>
    
    <!-- Quick stats -->
    <div class="flex flex-wrap gap-2 text-xs">
      <span class="px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded">
        ✈️ {$aircraftCounts.inFlight} in flight
      </span>
      {#if $aircraftCounts.helicopter > 0}
        <span class="px-2 py-1 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded">
          🚁 {$aircraftCounts.helicopter}
        </span>
      {/if}
      {#if $aircraftCounts.military > 0}
        <span class="px-2 py-1 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded">
          🎖️ {$aircraftCounts.military}
        </span>
      {/if}
      {#if $aircraftCounts.emergency > 0}
        <span class="px-2 py-1 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded animate-pulse">
          ⚠️ {$aircraftCounts.emergency} emergency
        </span>
      {/if}
    </div>
  </div>

  <!-- Filters -->
  <div class="flex-shrink-0 p-2 border-b border-gray-200 dark:border-gray-700 space-y-2">
    <div class="flex items-center gap-2">
      <select
        bind:value={categoryFilter}
        class="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300"
      >
        <option value="all">All Types</option>
        <option value="commercial">✈️ Commercial</option>
        <option value="helicopter">🚁 Helicopter</option>
        <option value="military">🎖️ Military</option>
        <option value="general">🛩️ General</option>
      </select>
      
      <select
        bind:value={sortField}
        class="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300"
      >
        <option value="altitude">Sort: Altitude</option>
        <option value="speed">Sort: Speed</option>
        <option value="callsign">Sort: Callsign</option>
        <option value="category">Sort: Type</option>
      </select>

      <label class="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-400">
        <input
          type="checkbox"
          bind:checked={showOnGround}
          class="rounded border-gray-300 dark:border-gray-600 text-indigo-600 focus:ring-indigo-500"
        />
        Ground
      </label>
    </div>
  </div>

  <!-- Tracking indicator -->
  {#if $selectedAircraft}
    <div class="flex-shrink-0 px-3 py-2 bg-sky-50 dark:bg-sky-900/30 border-b border-sky-200 dark:border-sky-800">
      <div class="flex items-center justify-between">
        <span class="text-xs text-sky-700 dark:text-sky-300 flex items-center gap-1">
          <svg class="w-3 h-3 animate-pulse" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clip-rule="evenodd"/>
          </svg>
          Following <strong class="font-mono">{$selectedAircraft.callsign}</strong>
        </span>
        <button
          type="button"
          class="text-xs text-sky-600 dark:text-sky-400 hover:text-sky-800 dark:hover:text-sky-200 underline"
          onclick={() => selectAircraft(null)}
        >
          Stop
        </button>
      </div>
    </div>
  {/if}

  <!-- Aircraft List -->
  <div class="flex-1 overflow-y-auto custom-scrollbar">
    {#if visibleAircraft.length === 0}
      <div class="p-4 text-center text-sm text-gray-500 dark:text-gray-400">
        {#if $aircraftList.length === 0}
          <p>No aircraft data available</p>
          <p class="text-xs mt-1">Aircraft tracking is active when this panel is visible</p>
        {:else}
          <p>No aircraft match current filters</p>
          <button
            class="text-indigo-600 dark:text-indigo-400 hover:underline mt-1"
            onclick={() => { categoryFilter = 'all'; showOnGround = true; }}
          >
            Show all aircraft
          </button>
        {/if}
      </div>
    {:else}
      <div class="divide-y divide-gray-100 dark:divide-gray-700">
        {#each visibleAircraft as aircraft (aircraft.id)}
          <button
            type="button"
            class="w-full p-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors cursor-pointer {$selectedAircraft?.id === aircraft.id ? 'bg-indigo-50 dark:bg-indigo-900' : ''}"
            onclick={() => handleAircraftClick(aircraft)}
          >
            <div class="flex items-start gap-3">
              <!-- Icon -->
              <div
                class="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-lg"
                style="background-color: {getCategoryBgColor(aircraft.category)}; border: 2px solid {getCategoryColor(aircraft.category)}"
                class:animate-pulse={aircraft.isEmergency}
              >
                {getCategoryIcon(aircraft.category)}
              </div>

              <!-- Main info -->
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  <span class="font-mono font-semibold text-sm text-gray-900 dark:text-white truncate">
                    {aircraft.callsign}
                  </span>
                  {#if $selectedAircraft?.id === aircraft.id}
                    <span class="px-1.5 py-0.5 bg-sky-500 text-white text-xs font-bold rounded animate-pulse flex items-center gap-1">
                      <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                        <path fill-rule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clip-rule="evenodd"/>
                      </svg>
                      TRACKING
                    </span>
                  {/if}
                  {#if aircraft.isEmergency}
                    <span class="px-1.5 py-0.5 bg-red-500 text-white text-xs font-bold rounded animate-pulse">
                      EMERGENCY
                    </span>
                  {/if}
                  {#if aircraft.onGround}
                    <span class="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300 text-xs rounded">
                      Ground
                    </span>
                  {/if}
                </div>

                <!-- Operator/Model info -->
                {#if aircraft.metadata?.operator || aircraft.metadata?.model}
                  <div class="text-xs text-gray-500 dark:text-gray-400 truncate">
                    {aircraft.metadata?.operator || ''} 
                    {aircraft.metadata?.model || ''}
                  </div>
                {:else}
                  <div class="text-xs text-gray-500 dark:text-gray-400">
                    {aircraft.origin}
                  </div>
                {/if}

                <!-- Flight data -->
                <div class="flex items-center gap-3 mt-1 text-xs text-gray-600 dark:text-gray-300">
                  <span title="Altitude">
                    📍 {formatAltitude(aircraft.location.altitude)} ft
                    <span class="ml-0.5">{getVerticalIndicator(aircraft.verticalRate)}</span>
                  </span>
                  <span title="Speed">
                    💨 {aircraft.speed} kts
                  </span>
                  <span title="Heading">
                    🧭 {Math.round(aircraft.heading)}°
                  </span>
                </div>

                <!-- Squawk if notable -->
                {#if aircraft.squawk && (aircraft.isEmergency || aircraft.squawk !== '0000')}
                  <div class="mt-1 text-xs">
                    <span class="text-gray-500 dark:text-gray-400">Squawk:</span>
                    <span 
                      class="font-mono ml-1"
                      class:text-red-600={aircraft.isEmergency}
                      class:dark:text-red-400={aircraft.isEmergency}
                      class:font-bold={aircraft.isEmergency}
                    >
                      {aircraft.squawk}
                    </span>
                  </div>
                {/if}
              </div>
            </div>
          </button>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Footer -->
  <div class="flex-shrink-0 p-2 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400 text-center">
    Data from OpenSky Network • Updates every 5s
  </div>
</div>
