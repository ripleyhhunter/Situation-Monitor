/**
 * Frontend region configuration.
 *
 * REGION_PRESETS lists every region the UI knows about. The selectedRegion
 * store ($stores/region) drives which preset is active at runtime, so users
 * can switch from the header without rebuilding.
 *
 * PUBLIC_REGION env var (Vite) provides the initial selection.
 */

import type { RegionId } from '$types';

interface PresetSearchBounds {
  west: number;
  east: number;
  south: number;
  north: number;
}

export interface RegionPreset {
  id: RegionId;
  label: string;
  defaultCenter: [number, number];
  defaultZoom: number;
  searchBounds: PresetSearchBounds;
}

export const REGION_PRESETS: Record<RegionId, RegionPreset> = {
  dc: {
    id: 'dc',
    label: 'DC',
    defaultCenter: [38.9072, -77.0369],
    defaultZoom: 12,
    searchBounds: { west: -77.2, east: -76.9, south: 38.8, north: 39.0 },
  },
  boise: {
    id: 'boise',
    label: 'Boise',
    defaultCenter: [43.6150, -116.2023],
    defaultZoom: 12,
    searchBounds: { west: -116.5, east: -115.95, south: 43.45, north: 43.85 },
  },
};

export const ALL_REGIONS: RegionPreset[] = Object.values(REGION_PRESETS);

function readRegionId(): RegionId {
  const raw = String(import.meta.env.PUBLIC_REGION || '').trim().toLowerCase();
  if (raw === 'boise' || raw === 'dc') return raw;
  return 'dc';
}

/** Initial region — driven by PUBLIC_REGION at build time. May be overridden at runtime by the user. */
export const DEFAULT_REGION_ID: RegionId = readRegionId();
export const DEFAULT_REGION: RegionPreset = REGION_PRESETS[DEFAULT_REGION_ID];

/**
 * @deprecated The legacy single-region API. Prefer `selectedRegion` from
 * `$stores/region` so UI updates when the user picks a different region.
 * This snapshot reflects the initial PUBLIC_REGION only.
 */
export const REGION = DEFAULT_REGION;
