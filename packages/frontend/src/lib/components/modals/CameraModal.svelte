<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Camera } from '$types';
  import { formatRelativeTime } from '$utils/time';

  export let camera: Camera;

  // Flag-based image failure state: mutating img.src to '' in the error
  // handler can re-fire the error event in a loop.
  let imageFailed = false;
  $: if (camera) imageFailed = false;

  const dispatch = createEventDispatcher();

  function close() {
    dispatch('close');
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') close();
  }

  // Check if URL is a YouTube video and extract video ID
  function getYouTubeEmbedUrl(url: string | undefined): string | null {
    if (!url) return null;

    // Match youtube.com/watch?v=ID, youtube.com/live/ID, youtu.be/ID
    const patterns = [
      /youtube\.com\/watch\?v=([a-zA-Z0-9_-]+)/,
      /youtube\.com\/live\/([a-zA-Z0-9_-]+)/,
      /youtu\.be\/([a-zA-Z0-9_-]+)/,
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) {
        return `https://www.youtube.com/embed/${match[1]}?autoplay=1&mute=1`;
      }
    }
    return null;
  }

  $: youtubeEmbedUrl = getYouTubeEmbedUrl(camera.streamUrl);
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
  <div class="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden pointer-events-auto">
    <!-- Header -->
    <div class="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
      <div>
        <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{camera.name}</h2>
        <p class="text-sm text-gray-500 dark:text-gray-400">
          Source: {camera.source.toUpperCase()} &bull; Updated {formatRelativeTime(camera.lastUpdated)}
        </p>
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

    <!-- Camera Feed -->
    <div class="aspect-video bg-gray-900 relative">
      {#if youtubeEmbedUrl}
        <!-- YouTube embed -->
        <iframe
          src={youtubeEmbedUrl}
          title={camera.name}
          class="w-full h-full"
          frameborder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowfullscreen
        ></iframe>
      {:else if camera.imageUrl && !imageFailed}
        <img
          src={camera.imageUrl}
          alt={camera.name}
          class="w-full h-full object-contain"
          on:error={() => (imageFailed = true)}
        />
        <!-- Refresh hint -->
        <div class="absolute bottom-2 right-2 text-xs text-white/70 bg-black/50 px-2 py-1 rounded">
          Image may be cached. Click refresh to update.
        </div>
      {:else if imageFailed}
        <div class="w-full h-full flex items-center justify-center text-gray-400">
          <div class="text-center p-4">
            <svg class="w-16 h-16 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14v-4zM3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
            </svg>
            <p class="text-sm">Camera feed unavailable</p>
          </div>
        </div>
      {:else if camera.source === 'dc'}
        <!-- DC cameras don't have direct feeds -->
        <div class="w-full h-full flex items-center justify-center text-gray-400">
          <div class="text-center p-4">
            <svg class="w-16 h-16 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14v-4zM3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
            </svg>
            <p class="text-sm mb-2">DC camera feeds are not publicly available</p>
            <p class="text-xs text-gray-500">The DDOT traffic viewer is currently offline.</p>
            <p class="text-xs text-gray-500 mt-1">Try WeatherBug for nearby camera views.</p>
          </div>
        </div>
      {:else if camera.source === 'landmark' && !camera.imageUrl}
        <!-- Landmark cameras without direct images (EarthCam, YouTube, etc) -->
        <div class="w-full h-full flex items-center justify-center text-gray-300">
          <div class="text-center p-4">
            <svg class="w-16 h-16 mx-auto mb-3 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14v-4zM3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
            </svg>
            <p class="text-sm mb-3">Live webcam available</p>
            <a
              href={camera.streamUrl}
              target="_blank"
              rel="noopener noreferrer"
              class="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors inline-flex items-center gap-2"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              Open Live Stream
            </a>
          </div>
        </div>
      {:else if camera.streamUrl}
        <div class="w-full h-full flex items-center justify-center">
          <a
            href={camera.streamUrl}
            target="_blank"
            rel="noopener noreferrer"
            class="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
          >
            Open Video Stream
          </a>
        </div>
      {:else}
        <div class="w-full h-full flex items-center justify-center text-gray-500">
          <div class="text-center">
            <svg class="w-12 h-12 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14v-4zM3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
            </svg>
            <p>Camera feed unavailable</p>
          </div>
        </div>
      {/if}
    </div>

    <!-- Footer -->
    <div class="p-4 border-t border-gray-200 dark:border-gray-700">
      <div class="flex items-center justify-between">
        <div class="text-sm text-gray-600 dark:text-gray-400">
          <p>Location: {camera.location.lat.toFixed(4)}, {camera.location.lng.toFixed(4)}</p>
          <p class="text-xs mt-1">Source: {camera.source === 'dc' ? 'DC DDOT' : camera.source === 'mdchart' ? 'MD CHART' : camera.source === 'landmark' ? 'Landmark Webcam' : camera.source === 'idaho511' ? 'Idaho 511 / ITD' : camera.source.toUpperCase()}</p>
        </div>
        <div class="flex gap-2">
          {#if camera.imageUrl}
            <a
              href={camera.imageUrl}
              target="_blank"
              rel="noopener noreferrer"
              class="px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
            >
              Open Image
            </a>
          {/if}
          {#if camera.source === 'dc'}
            <a
              href="https://www.weatherbug.com/traffic-cam/washington-dc-20001"
              target="_blank"
              rel="noopener noreferrer"
              class="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
            >
              WeatherBug Cams
            </a>
          {:else if camera.source === 'landmark' && camera.streamUrl}
            <a
              href={camera.streamUrl}
              target="_blank"
              rel="noopener noreferrer"
              class="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
            >
              View Live
            </a>
          {:else if camera.streamUrl}
            <a
              href={camera.streamUrl}
              target="_blank"
              rel="noopener noreferrer"
              class="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
            >
              Video Stream
            </a>
          {:else}
            <button
              on:click={() => window.location.reload()}
              class="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
            >
              Refresh
            </button>
          {/if}
        </div>
      </div>
    </div>
  </div>
</div>
