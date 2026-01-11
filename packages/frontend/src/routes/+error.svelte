<script lang="ts">
  import { page } from '$app/stores';
</script>

<div class="min-h-screen bg-gray-100 dark:bg-gray-900 flex items-center justify-center p-4">
  <div class="text-center">
    <h1 class="text-6xl font-bold text-gray-900 dark:text-white mb-4">
      {$page.status}
    </h1>
    <p class="text-xl text-gray-600 dark:text-gray-400 mb-8">
      {$page.error?.message || 'Something went wrong'}
    </p>
    <a
      href="/"
      class="inline-flex items-center px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
    >
      <svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
      Back to Dashboard
    </a>
  </div>
</div>
