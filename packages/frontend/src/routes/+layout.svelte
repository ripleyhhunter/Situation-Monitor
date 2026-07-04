<script lang="ts">
  import '../app.css';
  import 'leaflet/dist/leaflet.css';
  import 'leaflet.markercluster/dist/MarkerCluster.css';
  import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
  import { onMount } from 'svelte';
  import { darkMode } from '$stores/location';
  import { sseService } from '$services/sse';

  onMount(() => {
    // Connect to SSE on mount
    sseService.connect();

    // Apply dark mode class to document
    const unsubscribe = darkMode.subscribe((dark) => {
      if (typeof document !== 'undefined') {
        document.documentElement.classList.toggle('dark', dark);
      }
    });

    return () => {
      unsubscribe();
      sseService.disconnect();
    };
  });
</script>

<div class="h-full bg-gray-100 dark:bg-gray-900 transition-colors">
  <slot />
</div>
