<script lang="ts">
  import { page } from '$app/stores';
  import { invalidateAll } from '$app/navigation';

  let retrying = false;

  async function retry() {
    retrying = true;
    try {
      await invalidateAll();
      window.location.reload();
    } catch {
      retrying = false;
    }
  }

  $: isNetworkError = $page.status === 0 || $page.error?.message?.includes('fetch');
  $: isServerError = $page.status >= 500;
  $: isNotFound = $page.status === 404;

  $: errorTitle = isNotFound
    ? 'Page Not Found'
    : isServerError
    ? 'Server Error'
    : isNetworkError
    ? 'Connection Error'
    : 'Something Went Wrong';

  $: errorDescription = isNotFound
    ? "The page you're looking for doesn't exist or has been moved."
    : isServerError
    ? 'The server encountered an error. Please try again later.'
    : isNetworkError
    ? 'Unable to connect to the server. Check your internet connection.'
    : $page.error?.message || 'An unexpected error occurred.';
</script>

<div class="min-h-screen bg-gray-100 dark:bg-gray-900 flex items-center justify-center p-4">
  <div class="text-center max-w-md">
    <!-- Error Icon -->
    <div class="mb-6">
      {#if isNetworkError}
        <svg class="w-20 h-20 mx-auto text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" />
        </svg>
      {:else if isNotFound}
        <svg class="w-20 h-20 mx-auto text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      {:else}
        <svg class="w-20 h-20 mx-auto text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      {/if}
    </div>

    <!-- Status Code -->
    {#if $page.status > 0}
      <p class="text-sm font-mono text-gray-500 dark:text-gray-400 mb-2">
        Error {$page.status}
      </p>
    {/if}

    <!-- Title -->
    <h1 class="text-3xl font-bold text-gray-900 dark:text-white mb-4">
      {errorTitle}
    </h1>

    <!-- Description -->
    <p class="text-gray-600 dark:text-gray-400 mb-8">
      {errorDescription}
    </p>

    <!-- Actions -->
    <div class="flex flex-col sm:flex-row gap-3 justify-center">
      {#if isNetworkError || isServerError}
        <button
          on:click={retry}
          disabled={retrying}
          class="inline-flex items-center justify-center px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {#if retrying}
            <svg class="w-5 h-5 mr-2 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            Retrying...
          {:else}
            <svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Try Again
          {/if}
        </button>
      {/if}

      <a
        href="/"
        class="inline-flex items-center justify-center px-6 py-3 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
      >
        <svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
        </svg>
        Back to Dashboard
      </a>
    </div>
  </div>
</div>
