<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Incident, Camera } from '$types';
  import { formatDateTime, formatRelativeTime } from '$utils/time';
  import { getSeverityColor, getSeverityLabel, getIncidentTypeName, getIncidentTypeColor } from '$utils/format';
  import { formatCoordinates, findNearbyItems, formatDistanceMiles, type NearbyItem } from '$utils/geo';
  import { cameraList, selectCamera } from '$stores/cameras';
  import { news, getRelatedNews, formatNewsTime, getSourceName, getSourceColor } from '$stores/news';

  export let incident: Incident;

  const dispatch = createEventDispatcher();

  // Configuration for nearby cameras
  const NEARBY_CAMERA_CONFIG = {
    maxDistance: 0.8,  // km (~0.5 miles)
    maxResults: 5,
  };

  // State for collapsible sections
  let camerasExpanded = true;
  let newsExpanded = true;

  // Find related news reactively
  $: relatedNews = getRelatedNews($news, incident.title, incident.location.address, incident.type);

  // Find nearby cameras reactively
  $: nearbyCameras = findNearbyItems<Camera>(
    incident.location.lat,
    incident.location.lng,
    $cameraList,
    (camera) => camera.location,
    {
      maxDistance: NEARBY_CAMERA_CONFIG.maxDistance,
      maxResults: NEARBY_CAMERA_CONFIG.maxResults,
      // Exclude DC cameras which have no public feed
      // Include cameras that have either imageUrl or streamUrl
      filter: (camera) => camera.source !== 'dc' || Boolean(camera.imageUrl || camera.streamUrl),
    }
  );

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

  function viewCamera(nearbyCamera: NearbyItem<Camera>) {
    // Close this modal and open the camera modal
    selectCamera(nearbyCamera.item);
    close();
  }

  function getCameraSourceLabel(source: string): string {
    const labels: Record<string, string> = {
      mdchart: 'MD Traffic',
      dc: 'DC DOT',
      vdot: 'VA Traffic',
      landmark: 'Webcam',
    };
    return labels[source] || source.toUpperCase();
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

      <!-- Nearby Cameras -->
      {#if nearbyCameras.length > 0}
        <div class="pt-3 border-t border-gray-200 dark:border-gray-700">
          <button
            type="button"
            on:click={() => (camerasExpanded = !camerasExpanded)}
            class="flex items-center justify-between w-full text-left"
          >
            <h3 class="text-sm font-medium text-gray-500 dark:text-gray-400 flex items-center gap-2">
              <svg class="w-4 h-4 text-indigo-500" fill="currentColor" viewBox="0 0 24 24">
                <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14v-4zM3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z"/>
              </svg>
              Nearby Cameras ({nearbyCameras.length})
            </h3>
            <svg
              class="w-4 h-4 text-gray-400 transition-transform duration-200"
              class:rotate-180={camerasExpanded}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {#if camerasExpanded}
            <div class="mt-3 space-y-2">
              {#each nearbyCameras as nearbyCamera (nearbyCamera.item.id)}
                <button
                  type="button"
                  on:click={() => viewCamera(nearbyCamera)}
                  class="w-full flex items-center gap-3 p-2 rounded-lg bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-left group"
                >
                  <!-- Camera icon or thumbnail preview -->
                  <div class="w-10 h-10 rounded-lg bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center flex-shrink-0 overflow-hidden">
                    {#if nearbyCamera.item.imageUrl}
                      <img
                        src={nearbyCamera.item.imageUrl}
                        alt=""
                        class="w-full h-full object-cover"
                        on:error={(e) => {
                          const target = e.currentTarget as HTMLImageElement;
                          target.style.display = 'none';
                          const fallback = target.nextElementSibling as HTMLElement | null;
                          fallback?.classList.remove('hidden');
                        }}
                      />
                      <svg class="w-5 h-5 text-indigo-500 hidden" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14v-4zM3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z"/>
                      </svg>
                    {:else}
                      <svg class="w-5 h-5 text-indigo-500" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14v-4zM3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z"/>
                      </svg>
                    {/if}
                  </div>

                  <!-- Camera info -->
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium text-gray-900 dark:text-white truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400">
                      {nearbyCamera.item.name}
                    </p>
                    <p class="text-xs text-gray-500 dark:text-gray-400">
                      {formatDistanceMiles(nearbyCamera.distance)} {nearbyCamera.direction} • {getCameraSourceLabel(nearbyCamera.item.source)}
                    </p>
                  </div>

                  <!-- View arrow -->
                  <svg class="w-4 h-4 text-gray-400 group-hover:text-indigo-500 transition-colors flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {/if}

      <!-- Related News -->
      {#if relatedNews.length > 0}
        <div class="pt-3 border-t border-gray-200 dark:border-gray-700">
          <button
            type="button"
            on:click={() => (newsExpanded = !newsExpanded)}
            class="flex items-center justify-between w-full text-left"
          >
            <h3 class="text-sm font-medium text-gray-500 dark:text-gray-400 flex items-center gap-2">
              <span class="text-amber-500">📰</span>
              Related News ({relatedNews.length})
            </h3>
            <svg
              class="w-4 h-4 text-gray-400 transition-transform duration-200"
              class:rotate-180={newsExpanded}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {#if newsExpanded}
            <div class="mt-3 space-y-2">
              {#each relatedNews as newsItem (newsItem.id)}
                <a
                  href={newsItem.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="block p-2 rounded-lg bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors group"
                >
                  <div class="flex items-start gap-2">
                    <div class="flex-1 min-w-0">
                      <p class="text-sm font-medium text-gray-900 dark:text-white line-clamp-2 group-hover:text-amber-600 dark:group-hover:text-amber-400">
                        {newsItem.title}
                      </p>
                      <div class="flex items-center gap-2 mt-1">
                        <span 
                          class="px-1.5 py-0.5 text-[10px] font-medium rounded text-white"
                          style="background-color: {getSourceColor(newsItem.source)}"
                        >
                          {getSourceName(newsItem.source)}
                        </span>
                        <span class="text-xs text-gray-500 dark:text-gray-400">
                          {formatNewsTime(newsItem.pubDate)}
                        </span>
                      </div>
                    </div>
                    <svg class="w-4 h-4 text-gray-400 group-hover:text-amber-500 transition-colors flex-shrink-0 mt-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </div>
                </a>
              {/each}
            </div>
          {/if}
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

<style>
  .line-clamp-2 {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
</style>
