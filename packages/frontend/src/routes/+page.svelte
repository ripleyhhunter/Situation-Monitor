<script lang="ts">
  import { onMount } from 'svelte';
  import MapContainer from '$components/map/MapContainer.svelte';
  import Sidebar from '$components/sidebar/Sidebar.svelte';
  import Header from '$components/ui/Header.svelte';
  import ScannerPanel from '$components/panels/ScannerPanel.svelte';
  import CameraModal from '$components/modals/CameraModal.svelte';
  import IncidentModal from '$components/modals/IncidentModal.svelte';
  import WeatherBanner from '$components/panels/WeatherBanner.svelte';
  import { sidebarOpen, requestUserLocation, searchLocation } from '$stores/location';
  import { selectedCamera } from '$stores/cameras';
  import { selectedIncident } from '$stores/incidents';
  import { activeWeatherAlerts } from '$stores/weather';

  let showScanner = false;

  onMount(() => {
    // Request user location on load
    requestUserLocation();
  });

  function handleSearch(event: CustomEvent<{ lat: number; lng: number; name: string }>) {
    const { lat, lng, name } = event.detail;
    // Update the search location store - MapContainer reacts to this
    searchLocation.set({ lat, lng, name });
  }
</script>

<svelte:head>
  <title>Situation Monitor - DC</title>
</svelte:head>

<div class="h-screen flex flex-col overflow-hidden">
  <!-- Header -->
  <Header bind:showScanner on:search={handleSearch} />

  <!-- Weather Alert Banner -->
  {#if $activeWeatherAlerts.length > 0}
    <WeatherBanner alerts={$activeWeatherAlerts} />
  {/if}

  <!-- Main Content -->
  <div class="flex-1 flex overflow-hidden">
    <!-- Sidebar -->
    {#if $sidebarOpen}
      <Sidebar />
    {/if}

    <!-- Map -->
    <div class="flex-1 relative">
      <MapContainer />

      <!-- Scanner Panel (overlay) -->
      {#if showScanner}
        <div class="absolute bottom-4 right-4 z-[1000]">
          <ScannerPanel on:close={() => (showScanner = false)} />
        </div>
      {/if}
    </div>
  </div>
</div>

<!-- Modals -->
{#if $selectedCamera}
  <CameraModal camera={$selectedCamera} on:close={() => selectedCamera.set(null)} />
{/if}

{#if $selectedIncident}
  <IncidentModal incident={$selectedIncident} on:close={() => selectedIncident.set(null)} />
{/if}
