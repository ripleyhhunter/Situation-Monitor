<script lang="ts">
  import FilterPanel from './FilterPanel.svelte';
  import IncidentList from './IncidentList.svelte';
  import { filteredIncidents } from '$stores/filters';
  import { incidentCounts } from '$stores/incidents';

  let activeTab: 'incidents' | 'filters' = 'incidents';

  $: totalFiltered = $filteredIncidents.length;
  $: totalAll = Object.values($incidentCounts).reduce((a, b) => a + b, 0);
</script>

<aside class="w-80 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col h-full">
  <!-- Tabs -->
  <div class="flex border-b border-gray-200 dark:border-gray-700">
    <button
      type="button"
      onclick={() => (activeTab = 'incidents')}
      class="flex-1 px-4 py-3 text-sm font-medium transition-colors"
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
      <span class="ml-2 px-2 py-0.5 text-xs rounded-full bg-gray-100 dark:bg-gray-700">
        {totalFiltered}
      </span>
    </button>
    <button
      type="button"
      onclick={() => (activeTab = 'filters')}
      class="flex-1 px-4 py-3 text-sm font-medium transition-colors"
      class:text-indigo-600={activeTab === 'filters'}
      class:dark:text-indigo-400={activeTab === 'filters'}
      class:border-b-2={activeTab === 'filters'}
      class:border-indigo-600={activeTab === 'filters'}
      class:text-gray-500={activeTab !== 'filters'}
      class:dark:text-gray-400={activeTab !== 'filters'}
      class:hover:text-gray-700={activeTab !== 'filters'}
      class:dark:hover:text-gray-300={activeTab !== 'filters'}
    >
      Filters
    </button>
  </div>

  <!-- Content -->
  <div class="flex-1 overflow-hidden">
    {#if activeTab === 'incidents'}
      <IncidentList incidents={$filteredIncidents} />
    {:else}
      <FilterPanel />
    {/if}
  </div>

  <!-- Footer stats -->
  <div class="p-3 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400">
    Showing {totalFiltered} of {totalAll} incidents
  </div>
</aside>
