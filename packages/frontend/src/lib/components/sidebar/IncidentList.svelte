<script lang="ts">
  import type { Incident } from '$types';
  import { selectIncident } from '$stores/incidents';
  import { formatRelativeTime } from '$utils/time';
  import { getSeverityColor, getSeverityLabel, getIncidentTypeName } from '$utils/format';

  export let incidents: Incident[] = [];

  // Sort by timestamp (newest first), then by severity
  $: sortedIncidents = [...incidents].sort((a, b) => {
    // Critical incidents first
    if (a.severity !== b.severity) {
      return b.severity - a.severity;
    }
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  });
</script>

<div class="h-full overflow-y-auto custom-scrollbar">
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
        <li>
          <button
            on:click={() => selectIncident(incident)}
            class="w-full text-left p-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
          >
            <div class="flex items-start gap-3">
              <!-- Severity indicator -->
              <div
                class="w-2 h-2 rounded-full mt-2 flex-shrink-0"
                class:animate-pulse={incident.severity >= 4}
                style="background-color: {getSeverityColor(incident.severity)}"
              ></div>

              <div class="flex-1 min-w-0">
                <!-- Title -->
                <h3 class="text-sm font-medium text-gray-900 dark:text-white truncate">
                  {incident.title}
                </h3>

                <!-- Meta -->
                <div class="flex items-center gap-2 mt-1">
                  <span
                    class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium"
                    style="background-color: {getSeverityColor(incident.severity)}20; color: {getSeverityColor(incident.severity)}"
                  >
                    {getIncidentTypeName(incident.type)}
                  </span>
                  <span class="text-xs text-gray-500 dark:text-gray-400">
                    {formatRelativeTime(incident.timestamp)}
                  </span>
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
                  class="flex-shrink-0 text-xs font-medium px-2 py-0.5 rounded"
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
