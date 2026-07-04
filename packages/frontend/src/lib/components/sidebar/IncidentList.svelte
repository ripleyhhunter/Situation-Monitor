<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { Incident } from '$types';
  import { selectIncident } from '$stores/incidents';
  import { formatRelativeTime, getAgeBasedOpacity, isNewIncident, isFreshIncident, getAgeInMinutes } from '$utils/time';
  import { getSeverityColor, getSeverityLabel, getIncidentTypeName } from '$utils/format';
  import { feedRank } from '$utils/feedRank';

  export let incidents: Incident[] = [];

  let listContainer: HTMLDivElement;
  let previousIncidentIds: Set<string> = new Set();
  let newIncidentIds: Set<string> = new Set();
  let userScrolling = false;
  let scrollTimeout: ReturnType<typeof setTimeout> | null = null;

  // Public-safety first (see feedRank), then newest, then severity
  $: sortedIncidents = [...incidents].sort((a, b) => {
    // Live responder events above roadwork/ongoing situations, always
    const rankDiff = feedRank(a) - feedRank(b);
    if (rankDiff !== 0) return rankDiff;
    const timeDiff = new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    // If within 5 minutes of each other, sort by severity
    if (Math.abs(timeDiff) < 5 * 60 * 1000 && a.severity !== b.severity) {
      return b.severity - a.severity;
    }
    return timeDiff;
  });

  // Detect new incidents and auto-scroll
  $: {
    const currentIds = new Set(incidents.map(i => i.id));
    
    // Find truly new incidents (not seen before)
    if (previousIncidentIds.size > 0) {
      const brandNew = incidents.filter(i => 
        !previousIncidentIds.has(i.id) && 
        getAgeInMinutes(i.timestamp) < 5 // Only if less than 5 minutes old
      );
      
      if (brandNew.length > 0) {
        // Add to new incidents set (for NEW badge)
        brandNew.forEach(i => newIncidentIds.add(i.id));
        newIncidentIds = newIncidentIds; // Trigger reactivity
        
        // Auto-scroll to top if user isn't actively scrolling
        if (!userScrolling && listContainer) {
          tick().then(() => {
            listContainer.scrollTo({ top: 0, behavior: 'smooth' });
          });
        }
        
        // Remove NEW badge after 30 seconds
        setTimeout(() => {
          brandNew.forEach(i => newIncidentIds.delete(i.id));
          newIncidentIds = newIncidentIds;
        }, 30000);
      }
    }
    
    previousIncidentIds = currentIds;
  }

  // Track user scroll to avoid interrupting them
  function handleScroll() {
    userScrolling = true;
    if (scrollTimeout) clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
      userScrolling = false;
    }, 3000); // Reset after 3 seconds of no scrolling
  }

  function getListItemOpacity(incident: Incident): number {
    // NEW incidents get full opacity
    if (newIncidentIds.has(incident.id)) return 1;
    return getAgeBasedOpacity(incident.timestamp);
  }

  onMount(() => {
    // Initialize with current incident IDs
    previousIncidentIds = new Set(incidents.map(i => i.id));
  });
</script>

<div 
  bind:this={listContainer}
  class="h-full overflow-y-auto custom-scrollbar"
  on:scroll={handleScroll}
>
  {#if sortedIncidents.length === 0}
    <div class="flex flex-col items-center justify-center h-full text-gray-500 dark:text-gray-400 p-4">
      <svg class="w-12 h-12 mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <p class="text-sm">No incidents match your filters</p>
    </div>
  {:else}
    <ul class="divide-y divide-gray-100 dark:divide-gray-700">
      {#each sortedIncidents as incident (incident.id)}
        <li 
          class="transition-all duration-300"
          class:animate-slide-in={newIncidentIds.has(incident.id)}
          style="opacity: {getListItemOpacity(incident)}"
        >
          <button
            on:click={() => selectIncident(incident)}
            class="w-full text-left p-3 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors relative {newIncidentIds.has(incident.id) ? 'bg-yellow-50 dark:bg-yellow-900' : ''}"
          >
            <!-- NEW badge -->
            {#if newIncidentIds.has(incident.id)}
              <span class="absolute top-1 right-1 px-1.5 py-0.5 text-[10px] font-bold bg-yellow-400 text-yellow-900 rounded animate-pulse">
                NEW
              </span>
            {/if}

            <div class="flex items-start gap-3">
              <!-- Severity indicator -->
              <div
                class="w-3 h-3 rounded-full mt-1.5 flex-shrink-0"
                class:animate-pulse={incident.severity >= 4 || isFreshIncident(incident.timestamp)}
                style="background-color: {getSeverityColor(incident.severity)}"
              ></div>

              <div class="flex-1 min-w-0">
                <!-- Title -->
                <h3 class="text-sm font-medium text-gray-900 dark:text-white truncate pr-8">
                  {incident.title}
                </h3>

                <!-- Meta -->
                <div class="flex items-center gap-2 mt-1 flex-wrap">
                  <span
                    class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium"
                    style="background-color: {getSeverityColor(incident.severity)}20; color: {getSeverityColor(incident.severity)}"
                  >
                    {getIncidentTypeName(incident.type)}
                  </span>
                  <span class="text-xs text-gray-500 dark:text-gray-400" class:font-semibold={isFreshIncident(incident.timestamp)}>
                    {formatRelativeTime(incident.timestamp)}
                  </span>
                  {#if isFreshIncident(incident.timestamp)}
                    <span class="w-2 h-2 rounded-full bg-green-500 animate-pulse" title="Fresh incident"></span>
                  {/if}
                </div>

                <!-- Location -->
                {#if incident.location.address}
                  <p class="text-xs text-gray-500 dark:text-gray-400 mt-1 truncate">
                    {incident.location.address}
                  </p>
                {/if}
              </div>

              <!-- Severity badge -->
              {#if incident.severity >= 4}
                <span
                  class="flex-shrink-0 text-xs font-medium px-2 py-0.5 rounded mt-4"
                  style="background-color: {getSeverityColor(incident.severity)}; color: white"
                >
                  {getSeverityLabel(incident.severity)}
                </span>
              {/if}
            </div>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  @keyframes slide-in {
    from {
      opacity: 0;
      transform: translateX(-20px);
    }
    to {
      opacity: 1;
      transform: translateX(0);
    }
  }

  .animate-slide-in {
    animation: slide-in 0.3s ease-out;
  }
</style>
