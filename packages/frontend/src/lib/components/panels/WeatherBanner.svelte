<script lang="ts">
  import type { WeatherAlert } from '$types';
  import { getWeatherSeverityColor } from '$utils/format';
  import { getTimeUntilExpiration } from '$utils/time';

  export let alerts: WeatherAlert[] = [];

  let currentIndex = 0;
  let expanded = false;

  $: currentAlert = alerts[currentIndex];
  $: if (alerts.length > 0 && currentIndex >= alerts.length) {
    currentIndex = 0;
  }

  function nextAlert() {
    currentIndex = (currentIndex + 1) % alerts.length;
  }

  function prevAlert() {
    currentIndex = (currentIndex - 1 + alerts.length) % alerts.length;
  }
</script>

{#if currentAlert}
  <div
    class="border-b"
    style="background-color: {getWeatherSeverityColor(currentAlert.severity)}15; border-color: {getWeatherSeverityColor(currentAlert.severity)}"
  >
    <div class="px-4 py-2">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3 flex-1 min-w-0">
          <!-- Icon -->
          <div
            class="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
            style="background-color: {getWeatherSeverityColor(currentAlert.severity)}"
          >
            <svg class="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>

          <!-- Content -->
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span
                class="text-xs font-medium px-2 py-0.5 rounded"
                style="background-color: {getWeatherSeverityColor(currentAlert.severity)}; color: white"
              >
                {currentAlert.severity.toUpperCase()}
              </span>
              <h4 class="text-sm font-medium text-gray-900 dark:text-white truncate">
                {currentAlert.event}
              </h4>
            </div>
            <p class="text-xs text-gray-600 dark:text-gray-400 truncate">
              {currentAlert.headline}
            </p>
          </div>

          <!-- Expiration -->
          <div class="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">
            Expires in {getTimeUntilExpiration(currentAlert.expires)}
          </div>
        </div>

        <!-- Navigation -->
        <div class="flex items-center gap-2 ml-4">
          {#if alerts.length > 1}
            <button
              on:click={prevAlert}
              aria-label="Previous alert"
              class="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
            >
              <svg class="w-4 h-4 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <span class="text-xs text-gray-500 dark:text-gray-400">
              {currentIndex + 1}/{alerts.length}
            </span>
            <button
              on:click={nextAlert}
              aria-label="Next alert"
              class="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
            >
              <svg class="w-4 h-4 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          {/if}
          <button
            on:click={() => (expanded = !expanded)}
            aria-label={expanded ? 'Collapse alert details' : 'Expand alert details'}
            class="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
          >
            <svg
              class="w-4 h-4 text-gray-600 dark:text-gray-400 transition-transform"
              class:rotate-180={expanded}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
      </div>

      <!-- Expanded details -->
      {#if expanded}
        <div class="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
          <p class="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
            {currentAlert.description}
          </p>
          {#if currentAlert.instruction}
            <div class="mt-2 p-2 bg-gray-100 dark:bg-gray-800 rounded">
              <p class="text-xs font-medium text-gray-900 dark:text-white mb-1">Instructions:</p>
              <p class="text-xs text-gray-600 dark:text-gray-400">
                {currentAlert.instruction}
              </p>
            </div>
          {/if}
          <p class="text-xs text-gray-500 dark:text-gray-400 mt-2">
            Areas: {currentAlert.areas.join(', ')}
          </p>
        </div>
      {/if}
    </div>
  </div>
{/if}
