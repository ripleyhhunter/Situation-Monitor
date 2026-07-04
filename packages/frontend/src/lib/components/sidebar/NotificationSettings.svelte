<script lang="ts">
  import {
    notificationSettings,
    notificationPermission,
    requestNotificationPermission,
    updateNotificationSettings,
  } from '$services/notifications';
  import { userLocation, requestUserLocation } from '$stores/location';

  async function handleEnableToggle() {
    if ($notificationSettings.enabled) {
      updateNotificationSettings({ enabled: false });
      return;
    }
    // Turning on: make sure the browser permission exists first.
    if ($notificationPermission === 'granted') {
      updateNotificationSettings({ enabled: true });
    } else {
      await requestNotificationPermission();
    }
  }

  async function handleNearbyToggle() {
    const turningOn = !$notificationSettings.nearbyOnly;
    updateNotificationSettings({ nearbyOnly: turningOn });
    if (turningOn && !$userLocation) {
      await requestUserLocation();
    }
  }
</script>

<div>
  <h3 class="text-sm font-medium text-gray-900 dark:text-white mb-3">Notifications</h3>

  {#if $notificationPermission === 'denied'}
    <p class="text-xs text-amber-600 dark:text-amber-400 mb-2">
      Notifications are blocked — allow them for this site in your browser settings.
    </p>
  {/if}

  <div class="space-y-2">
    <label class="flex items-center gap-3 cursor-pointer">
      <input
        type="checkbox"
        checked={$notificationSettings.enabled && $notificationPermission === 'granted'}
        onchange={handleEnableToggle}
        disabled={$notificationPermission === 'denied'}
        class="rounded border-gray-300 dark:border-gray-600 text-indigo-600 focus:ring-indigo-500"
      />
      <svg class="w-5 h-5 text-indigo-500" fill="currentColor" viewBox="0 0 24 24">
        <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.89 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/>
      </svg>
      <span class="text-sm text-gray-700 dark:text-gray-300">Desktop notifications</span>
    </label>

    {#if $notificationSettings.enabled && $notificationPermission === 'granted'}
      <label class="flex items-center gap-3 cursor-pointer ml-6">
        <input
          type="checkbox"
          checked={$notificationSettings.criticalOnly}
          onchange={() => updateNotificationSettings({ criticalOnly: !$notificationSettings.criticalOnly })}
          class="rounded border-gray-300 dark:border-gray-600 text-indigo-600 focus:ring-indigo-500"
        />
        <span class="text-xs text-gray-500 dark:text-gray-400">Critical incidents only (severity 4-5)</span>
      </label>

      <label class="flex items-center gap-3 cursor-pointer ml-6">
        <input
          type="checkbox"
          checked={$notificationSettings.weatherAlerts}
          onchange={() => updateNotificationSettings({ weatherAlerts: !$notificationSettings.weatherAlerts })}
          class="rounded border-gray-300 dark:border-gray-600 text-indigo-600 focus:ring-indigo-500"
        />
        <span class="text-xs text-gray-500 dark:text-gray-400">Severe weather alerts</span>
      </label>

      <label class="flex items-center gap-3 cursor-pointer ml-6">
        <input
          type="checkbox"
          checked={$notificationSettings.sound}
          onchange={() => updateNotificationSettings({ sound: !$notificationSettings.sound })}
          class="rounded border-gray-300 dark:border-gray-600 text-indigo-600 focus:ring-indigo-500"
        />
        <span class="text-xs text-gray-500 dark:text-gray-400">Sound for critical alerts</span>
      </label>

      <label class="flex items-center gap-3 cursor-pointer ml-6">
        <input
          type="checkbox"
          checked={$notificationSettings.nearbyOnly}
          onchange={handleNearbyToggle}
          class="rounded border-gray-300 dark:border-gray-600 text-indigo-600 focus:ring-indigo-500"
        />
        <span class="text-xs text-gray-500 dark:text-gray-400">Only near my location</span>
      </label>

      {#if $notificationSettings.nearbyOnly}
        <div class="ml-6 pl-6">
          <div class="flex items-center justify-between mb-1">
            <span class="text-xs text-gray-500 dark:text-gray-400">Radius</span>
            <span class="text-xs font-medium text-gray-700 dark:text-gray-300 tabular-nums">
              {$notificationSettings.nearbyRadiusKm} km
            </span>
          </div>
          <input
            type="range"
            min="1"
            max="25"
            value={$notificationSettings.nearbyRadiusKm}
            oninput={(e) => updateNotificationSettings({ nearbyRadiusKm: parseInt(e.currentTarget.value) })}
            class="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer"
          />
          {#if !$userLocation}
            <p class="mt-1 text-xs text-amber-600 dark:text-amber-400">
              Location unknown — allow location access or nothing will match.
            </p>
          {/if}
        </div>
      {/if}
    {/if}
  </div>
</div>
