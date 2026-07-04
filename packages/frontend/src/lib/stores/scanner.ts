import { writable, derived } from 'svelte/store';
import type { RegionId, ScannerCall } from '$types';
import { selectedRegionId } from '$stores/region';

// Latest scanner-call batch per region (the server sends complete batches,
// newest first — each update replaces the region's list wholesale).
export const scannerCallsByRegion = writable<Map<RegionId, ScannerCall[]>>(new Map());

export function updateScannerCalls(regionId: RegionId, calls: ScannerCall[]): void {
  scannerCallsByRegion.update((map) => {
    map.set(regionId, calls);
    return new Map(map);
  });
}

/** Calls for the currently selected region, newest first. */
export const scannerCalls = derived(
  [scannerCallsByRegion, selectedRegionId],
  ([$byRegion, $regionId]) => $byRegion.get($regionId) ?? []
);
