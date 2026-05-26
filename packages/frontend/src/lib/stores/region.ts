import { writable, derived } from 'svelte/store';
import type { RegionId } from '$types';
import { DEFAULT_REGION_ID, REGION_PRESETS } from '$lib/config';

const STORAGE_KEY = 'situation-monitor.selectedRegion';

function readInitial(): RegionId {
  if (typeof localStorage === 'undefined') return DEFAULT_REGION_ID;
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'dc' || saved === 'boise') return saved;
  return DEFAULT_REGION_ID;
}

/** User-selected region. Persists to localStorage. */
export const selectedRegionId = writable<RegionId>(readInitial());

selectedRegionId.subscribe((id) => {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, id);
  }
});

/** Derived: the full preset (center, zoom, search bounds, label) for the selected region. */
export const selectedRegion = derived(selectedRegionId, ($id) => REGION_PRESETS[$id]);

export function setRegion(id: RegionId): void {
  selectedRegionId.set(id);
}
