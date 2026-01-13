<script lang="ts">
  import FilterPanel from './FilterPanel.svelte';
  import IncidentList from './IncidentList.svelte';
  import AircraftPanel from './AircraftPanel.svelte';
  import NewsPanel from './NewsPanel.svelte';
  import { filteredIncidents, filters } from '$stores/filters';
  import { incidentCounts } from '$stores/incidents';
  import { aircraftCounts } from '$stores/aircraft';
  import { newsCount } from '$stores/news';

  let activeTab: 'incidents' | 'filters' | 'aircraft' | 'news' = 'incidents';

  $: totalFiltered = $filteredIncidents.length;
  $: totalAll = Object.values($incidentCounts).reduce((a, b) => a + b, 0);

  // Auto-switch to aircraft tab when aircraft is enabled, switch back when disabled
  $: if ($filters.showAircraft && activeTab !== 'aircraft' && activeTab !== 'filters') {
    // Only auto-switch if we weren't already on a specific tab
  }
</script>

<aside class="w-80 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col h-full">
  <!-- Tabs -->
  <div class="flex border-b border-gray-200 dark:border-gray-700">
    <button
      type="button"
      onclick={() => (activeTab = 'incidents')}
      class="flex-1 px-3 py-3 text-sm font-medium transition-colors"
      class:text-indigo-600={activeTab === 'incidents'}
      class:dark:text-indigo-400={activeTab === 'incidents'}
      class:border-b-2={activeTab === 'incidents'}
      class:border-indigo-600={activeTab === 'incidents'}
      class:text-gray-500={activeTab !== 'incidents'}
      class:dark:text-gray-400={activeTab !== 'incidents'}
      class:hover:text-gray-700={activeTab !== 'incidents'}
      class:dark:hover:text-gray-300={activeTab !== 'incidents'}
    >
      Incidents
      <span class="ml-1 px-1.5 py-0.5 text-xs rounded-full bg-gray-100 dark:bg-gray-700">
        {totalFiltered}
      </span>
    </button>
    <button
      type="button"
      onclick={() => (activeTab = 'news')}
      class="flex-1 px-2 py-3 text-sm font-medium transition-colors"
      class:text-indigo-600={activeTab === 'news'}
      class:dark:text-indigo-400={activeTab === 'news'}
      class:border-b-2={activeTab === 'news'}
      class:border-indigo-600={activeTab === 'news'}
      class:text-amber-600={activeTab !== 'news'}
      class:dark:text-amber-400={activeTab !== 'news'}
      class:hover:text-amber-700={activeTab !== 'news'}
      class:dark:hover:text-amber-300={activeTab !== 'news'}
    >
      📰
      {#if $newsCount > 0}
        <span class="ml-1 px-1.5 py-0.5 text-xs rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
          {$newsCount}
        </span>
      {/if}
    </button>
    {#if $filters.showAircraft}
      <button
        type="button"
        onclick={() => (activeTab = 'aircraft')}
        class="flex-1 px-2 py-3 text-sm font-medium transition-colors"
        class:text-indigo-600={activeTab === 'aircraft'}
        class:dark:text-indigo-400={activeTab === 'aircraft'}
        class:border-b-2={activeTab === 'aircraft'}
        class:border-indigo-600={activeTab === 'aircraft'}
        class:text-sky-500={activeTab !== 'aircraft'}
        class:dark:text-sky-400={activeTab !== 'aircraft'}
        class:hover:text-sky-600={activeTab !== 'aircraft'}
        class:dark:hover:text-sky-300={activeTab !== 'aircraft'}
      >
        ✈️
        <span class="ml-1 px-1.5 py-0.5 text-xs rounded-full bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300">
          {$aircraftCounts.inFlight}
        </span>
      </button>
    {/if}
    <button
      type="button"
      onclick={() => (activeTab = 'filters')}
      class="flex-1 px-2 py-3 text-sm font-medium transition-colors"
      class:text-indigo-600={activeTab === 'filters'}
      class:dark:text-indigo-400={activeTab === 'filters'}
      class:border-b-2={activeTab === 'filters'}
      class:border-indigo-600={activeTab === 'filters'}
      class:text-gray-500={activeTab !== 'filters'}
      class:dark:text-gray-400={activeTab !== 'filters'}
      class:hover:text-gray-700={activeTab !== 'filters'}
      class:dark:hover:text-gray-300={activeTab !== 'filters'}
    >
      ⚙️
    </button>
  </div>

  <!-- Content -->
  <div class="flex-1 overflow-hidden">
    {#if activeTab === 'incidents'}
      <IncidentList incidents={$filteredIncidents} />
    {:else if activeTab === 'news'}
      <NewsPanel />
    {:else if activeTab === 'aircraft'}
      <AircraftPanel />
    {:else}
      <FilterPanel />
    {/if}
  </div>

  <!-- Footer stats -->
  {#if activeTab === 'incidents'}
    <div class="p-3 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400">
      Showing {totalFiltered} of {totalAll} incidents
    </div>
  {/if}
</aside>
