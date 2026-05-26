import logger from '../logger.js';
import { dcRegion } from './dc.js';
import { boiseRegion } from './boise.js';
import type { RegionId, RegionPack } from './types.js';

export type { RegionId, RegionPack, BoundingBox, RegionNewsConfig, RssFeedConfig } from './types.js';

/**
 * Every region this build runs. The aggregator schedules and fetches all of
 * them in parallel; the frontend picks which region's data to surface.
 *
 * To add a region: extend `RegionId` in `types/index.ts`, add a `regions/<id>.ts`
 * exporting a RegionPack, then append it here.
 */
export const allRegions: RegionPack[] = [dcRegion, boiseRegion];

export const regionsById: Record<RegionId, RegionPack> = {
  dc: dcRegion,
  boise: boiseRegion,
};

function resolveDefaultRegionId(): RegionId {
  const raw = (process.env.REGION || '').trim().toLowerCase();
  if (raw === 'dc' || raw === 'boise') return raw;
  if (raw) {
    logger.warn(`Unknown REGION="${raw}", falling back to "dc"`);
  }
  return 'dc';
}

/**
 * Hint for the frontend's initial region selection. The backend serves every
 * region in `allRegions` regardless of this value.
 */
export const defaultRegionId: RegionId = resolveDefaultRegionId();
export const defaultRegion: RegionPack = regionsById[defaultRegionId];

logger.info(`Regions loaded: ${allRegions.map(r => r.id).join(', ')} (default: ${defaultRegionId})`);

// Backwards-compat alias for code that hasn't migrated yet.
export const activeRegion: RegionPack = defaultRegion;
export default activeRegion;
