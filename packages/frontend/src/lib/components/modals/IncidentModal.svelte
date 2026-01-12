<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Incident } from '$types';
  import { formatDateTime, formatRelativeTime } from '$utils/time';
  import { getSeverityColor, getSeverityLabel, getIncidentTypeName, getIncidentTypeColor } from '$utils/format';
  import { formatCoordinates } from '$utils/geo';

  export let incident: Incident;

  const dispatch = createEventDispatcher();

  function close() {
    dispatch('close');
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') close();
  }

  function openInMaps() {
    const { lat, lng } = incident.location;
    window.open(`https://www.google.com/maps?q=${lat},${lng}`, '_blank');
  }
</script>

<svelte:window on:keydown={handleKeydown} />

<!-- Backdrop -->
<div
  class="fixed inset-0 bg-black/50 z-[9998]"
  on:click={close}
  on:keydown={(e) => e.key === 'Enter' && close()}
  role="button"
  tabindex="0"
></div>

<!-- Modal -->
<div class="fixed inset-0 z-[9999] flex items-center justify-center p-4 pointer-events-none">
  <div class="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-hidden pointer-events-auto">
    <!-- Header -->
    <div
      class="p-4 border-b"
      style="background-color: {getSeverityColor(incident.severity)}15; border-color: {getSeverityColor(incident.severity)}"
    >
      <div class="flex items-start justify-between">
        <div class="flex items-start gap-3">
          <div
            class="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
            style="background-color: {getIncidentTypeColor(incident.type)}"
          >
            <svg class="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
              {#if incident.type === 'crime'}
                <path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/>
              {:else if incident.type === 'traffic'}
                <path d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z"/><path d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10h10zm2 0V7.97A1 1 0 0116 7h3l2 4v5h-6z"/>
              {:else if incident.type === 'fire'}
                <path d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z"/>
              {:else if incident.type === 'gunshot'}
                <circle cx="12" cy="12" r="3"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/>
              {:else}
                <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
              {/if}
            </svg>
          </div>
          <div>
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{incident.title}</h2>
            <div class="flex items-center gap-2 mt-1">
              <span
                class="px-2 py-0.5 text-xs font-medium rounded"
                style="background-color: {getIncidentTypeColor(incident.type)}; color: white"
              >
                {getIncidentTypeName(incident.type)}
              </span>
              <span
                class="px-2 py-0.5 text-xs font-medium rounded"
                style="background-color: {getSeverityColor(incident.severity)}; color: white"
              >
                {getSeverityLabel(incident.severity)}
              </span>
            </div>
          </div>
        </div>
        <button
          on:click={close}
          aria-label="Close modal"
          class="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
          <svg class="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>

    <!-- Content -->
    <div class="p-4 max-h-96 overflow-y-auto custom-scrollbar">
      <!-- Description -->
      <div class="mb-4">
        <h3 class="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">Description</h3>
        <p class="text-sm text-gray-900 dark:text-white whitespace-pre-wrap">
          {incident.description || 'No description available'}
        </p>
      </div>

      <!-- Location -->
      <div class="mb-4">
        <h3 class="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">Location</h3>
        {#if incident.location.address}
          <p class="text-sm text-gray-900 dark:text-white">{incident.location.address}</p>
        {/if}
        {#if incident.location.neighborhood}
          <p class="text-xs text-gray-600 dark:text-gray-400">{incident.location.neighborhood}</p>
        {/if}
        <p class="text-xs text-gray-500 dark:text-gray-500 mt-1">
          {formatCoordinates(incident.location.lat, incident.location.lng)}
        </p>
      </div>

      <!-- Time -->
      <div class="mb-4">
        <h3 class="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">Time</h3>
        <p class="text-sm text-gray-900 dark:text-white">
          {formatDateTime(incident.timestamp)}
          <span class="text-gray-500 dark:text-gray-400">({formatRelativeTime(incident.timestamp)})</span>
        </p>
      </div>

      <!-- Source -->
      <div class="mb-4">
        <h3 class="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">Source</h3>
        <p class="text-sm text-gray-900 dark:text-white">{incident.source}</p>
      </div>

      <!-- Metadata -->
      {#if Object.keys(incident.metadata).length > 0}
        <div>
          <h3 class="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">Additional Details</h3>
          <dl class="grid grid-cols-2 gap-2 text-xs">
            {#each Object.entries(incident.metadata) as [key, value]}
              {#if value}
                <dt class="text-gray-500 dark:text-gray-400 capitalize">{key.replace(/_/g, ' ')}</dt>
                <dd class="text-gray-900 dark:text-white">{value}</dd>
              {/if}
            {/each}
          </dl>
        </div>
      {/if}
    </div>

    <!-- Footer -->
    <div class="p-4 border-t border-gray-200 dark:border-gray-700 flex justify-between">
      <span class="text-xs text-gray-500 dark:text-gray-400">
        ID: {incident.id}
      </span>
      <button
        on:click={openInMaps}
        class="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors flex items-center gap-2"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        Open in Maps
      </button>
    </div>
  </div>
</div>
