<script lang="ts">
  import { selectedRegionId } from '$stores/region';
  import { getIncidentTypeColor, getIncidentTypeName } from '$utils/format';
  import type { IncidentType } from '$types';

  interface HourRow { hour: string; type: string; count: number }
  interface DayRow { day: string; type: string; count: number }

  let loading = true;
  let enabled = true;
  let error = false;
  let hourly: HourRow[] = [];
  let daily: DayRow[] = [];

  const apiUrl = import.meta.env.PUBLIC_API_URL || '';

  async function load(regionId: string) {
    loading = true;
    error = false;
    try {
      const [hourlyRes, dailyRes] = await Promise.all([
        fetch(`${apiUrl}/api/history/hourly?region=${regionId}&hours=24`),
        fetch(`${apiUrl}/api/history/summary?region=${regionId}&days=7`),
      ]);
      if (!hourlyRes.ok || !dailyRes.ok) throw new Error('history fetch failed');
      const hourlyJson = await hourlyRes.json();
      const dailyJson = await dailyRes.json();
      enabled = hourlyJson.enabled !== false;
      hourly = hourlyJson.rows ?? [];
      daily = dailyJson.rows ?? [];
    } catch {
      error = true;
    } finally {
      loading = false;
    }
  }

  // Reload when the region changes (and on mount via the initial run).
  $: load($selectedRegionId);

  // ---- 24h sparkline: one bucket per hour, gaps filled with zero ----
  interface HourBucket { label: string; total: number }
  $: hourBuckets = (() => {
    const byHour = new Map<string, number>();
    for (const row of hourly) {
      byHour.set(row.hour, (byHour.get(row.hour) ?? 0) + row.count);
    }
    const buckets: HourBucket[] = [];
    const now = Date.now();
    for (let i = 23; i >= 0; i--) {
      const d = new Date(now - i * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 13);
      buckets.push({
        label: d.toLocaleTimeString('en-US', { hour: 'numeric', hour12: true }),
        total: byHour.get(key) ?? 0,
      });
    }
    return buckets;
  })();
  $: hourMax = Math.max(1, ...hourBuckets.map((b) => b.total));
  $: last24Total = hourBuckets.reduce((sum, b) => sum + b.total, 0);

  // ---- 7-day bars ----
  interface DayBucket { label: string; total: number }
  $: dayBuckets = (() => {
    const byDay = new Map<string, number>();
    for (const row of daily) {
      byDay.set(row.day, (byDay.get(row.day) ?? 0) + row.count);
    }
    const buckets: DayBucket[] = [];
    const now = Date.now();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      buckets.push({
        label: d.toLocaleDateString('en-US', { weekday: 'short' }),
        total: byDay.get(key) ?? 0,
      });
    }
    return buckets;
  })();
  $: dayMax = Math.max(1, ...dayBuckets.map((b) => b.total));

  // ---- by-type totals over 7 days ----
  $: typeTotals = (() => {
    const totals = new Map<string, number>();
    for (const row of daily) {
      totals.set(row.type, (totals.get(row.type) ?? 0) + row.count);
    }
    return [...totals.entries()].sort((a, b) => b[1] - a[1]);
  })();
</script>

<div class="h-full overflow-y-auto custom-scrollbar p-4 space-y-6">
  {#if loading}
    <p class="text-sm text-gray-500 dark:text-gray-400">Loading trends…</p>
  {:else if error}
    <p class="text-sm text-gray-500 dark:text-gray-400">Couldn't load trend data.</p>
  {:else if !enabled}
    <p class="text-sm text-gray-500 dark:text-gray-400">
      History storage isn't available on this backend, so no trends yet.
    </p>
  {:else}
    <!-- 24h sparkline -->
    <div>
      <div class="flex items-baseline justify-between mb-2">
        <h3 class="text-sm font-medium text-gray-900 dark:text-white">Last 24 hours</h3>
        <span class="text-xs text-gray-500 dark:text-gray-400">{last24Total} new incidents</span>
      </div>
      <svg viewBox="0 0 240 60" class="w-full h-16" role="img" aria-label="Incidents per hour, last 24 hours">
        {#each hourBuckets as bucket, i}
          <rect
            x={i * 10 + 1}
            y={56 - (bucket.total / hourMax) * 52}
            width="8"
            height={Math.max(1, (bucket.total / hourMax) * 52)}
            rx="1"
            class="fill-indigo-500/80 dark:fill-indigo-400/80"
          >
            <title>{bucket.label}: {bucket.total}</title>
          </rect>
        {/each}
      </svg>
      <div class="flex justify-between text-[10px] text-gray-400">
        <span>{hourBuckets[0]?.label}</span>
        <span>now</span>
      </div>
    </div>

    <!-- 7-day bars -->
    <div>
      <h3 class="text-sm font-medium text-gray-900 dark:text-white mb-2">Last 7 days</h3>
      <div class="flex items-end gap-2 h-24">
        {#each dayBuckets as bucket}
          <div class="flex-1 flex flex-col items-center gap-1">
            <span class="text-[10px] text-gray-500 dark:text-gray-400 tabular-nums">{bucket.total}</span>
            <div
              class="w-full rounded-t bg-indigo-500/80 dark:bg-indigo-400/80"
              style="height: {Math.max(2, (bucket.total / dayMax) * 64)}px"
              title="{bucket.label}: {bucket.total}"
            ></div>
            <span class="text-[10px] text-gray-400">{bucket.label}</span>
          </div>
        {/each}
      </div>
    </div>

    <!-- By type -->
    {#if typeTotals.length > 0}
      <div>
        <h3 class="text-sm font-medium text-gray-900 dark:text-white mb-2">By type (7 days)</h3>
        <div class="space-y-1.5">
          {#each typeTotals as [type, count]}
            <div class="flex items-center gap-2">
              <span class="w-2.5 h-2.5 rounded-full flex-shrink-0" style="background-color: {getIncidentTypeColor(type as IncidentType)}"></span>
              <span class="text-sm text-gray-700 dark:text-gray-300 flex-1">{getIncidentTypeName(type as IncidentType)}</span>
              <span class="text-xs text-gray-500 dark:text-gray-400 tabular-nums">{count}</span>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <p class="text-xs text-gray-400 dark:text-gray-500">
      Counts are first-seen times of incidents recorded by this backend; history
      accumulates from when the backend started running with storage enabled.
    </p>
  {/if}
</div>
