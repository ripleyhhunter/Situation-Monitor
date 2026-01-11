/**
 * DC Area Scanner Feeds Configuration
 *
 * IMPORTANT: DC Metro Police radios have been fully encrypted since 2011.
 * Only Fire/EMS and some specialized channels are available.
 */

export interface ScannerFeed {
  id: string;
  name: string;
  description: string;
  region: 'dc' | 'md' | 'va' | 'metro';
  type: 'fire' | 'ems' | 'police' | 'airport' | 'transit' | 'mixed';
  provider: 'broadcastify' | 'openmhz' | 'zeno' | 'icecast';
  streamUrl?: string;
  embedUrl?: string;
  webUrl: string;
  feedId?: string;
  isLive: boolean;
  encrypted: boolean;
  priority: number;
}

/**
 * Curated list of DC metro area scanner feeds
 */
export const DC_SCANNER_FEEDS: ScannerFeed[] = [
  // DC
  {
    id: 'dc-fire-ems',
    name: 'DC Fire & EMS',
    description: 'DCFD Main Dispatch, Firegrounds, EMS Operations',
    region: 'dc',
    type: 'fire',
    provider: 'broadcastify',
    feedId: '2455',
    embedUrl: 'https://www.broadcastify.com/webPlayer/2455',
    webUrl: 'https://www.broadcastify.com/listen/feed/2455',
    isLive: true,
    encrypted: false,
    priority: 1,
  },
  {
    id: 'openmhz-dcfd',
    name: 'DCFD Archives (OpenMHz)',
    description: 'Recorded Fire/EMS talkgroup transmissions',
    region: 'dc',
    type: 'fire',
    provider: 'openmhz',
    webUrl: 'https://openmhz.com/system/dcfd',
    isLive: false,
    encrypted: false,
    priority: 2,
  },
  {
    id: 'dc-metro-police',
    name: 'DC Metropolitan Police',
    description: '⚠️ ENCRYPTED since 2011 - Not available',
    region: 'dc',
    type: 'police',
    provider: 'broadcastify',
    webUrl: '',
    isLive: false,
    encrypted: true,
    priority: 99,
  },
  {
    id: 'dc-airports-mwaa',
    name: 'DC Airports (MWAA)',
    description: 'Reagan & Dulles - Fire, Rescue, Police, Operations',
    region: 'dc',
    type: 'airport',
    provider: 'zeno',
    webUrl: 'https://zeno.fm/radio/washington-dc-airports-fire-rescue-police-operations/',
    isLive: true,
    encrypted: false,
    priority: 3,
  },
  // Maryland
  {
    id: 'pg-fire-ems',
    name: "Prince George's County Fire/EMS",
    description: 'PG County Fire & EMS Dispatch',
    region: 'md',
    type: 'fire',
    provider: 'broadcastify',
    feedId: '7386',
    embedUrl: 'https://www.broadcastify.com/webPlayer/7386',
    webUrl: 'https://www.broadcastify.com/listen/feed/7386',
    isLive: true,
    encrypted: false,
    priority: 1,
  },
  {
    id: 'pg-police',
    name: "Prince George's County Police",
    description: 'PG County Police Dispatch',
    region: 'md',
    type: 'police',
    provider: 'broadcastify',
    feedId: '27089',
    embedUrl: 'https://www.broadcastify.com/webPlayer/27089',
    webUrl: 'https://www.broadcastify.com/listen/feed/27089',
    isLive: true,
    encrypted: false,
    priority: 2,
  },
  {
    id: 'montgomery-fire',
    name: 'Montgomery County Fire/Rescue',
    description: 'MCFRS Dispatch and Operations',
    region: 'md',
    type: 'fire',
    provider: 'broadcastify',
    feedId: '7387',
    embedUrl: 'https://www.broadcastify.com/webPlayer/7387',
    webUrl: 'https://www.broadcastify.com/listen/feed/7387',
    isLive: true,
    encrypted: false,
    priority: 3,
  },
  // Virginia
  {
    id: 'fairfax-fire',
    name: 'Fairfax County Fire & Rescue',
    description: 'FCFRD Dispatch and Operations',
    region: 'va',
    type: 'fire',
    provider: 'broadcastify',
    feedId: '5088',
    embedUrl: 'https://www.broadcastify.com/webPlayer/5088',
    webUrl: 'https://www.broadcastify.com/listen/feed/5088',
    isLive: true,
    encrypted: false,
    priority: 1,
  },
  {
    id: 'fairfax-police',
    name: 'Fairfax County Police',
    description: 'FCPD Dispatch and Patrol',
    region: 'va',
    type: 'police',
    provider: 'broadcastify',
    feedId: '2748',
    embedUrl: 'https://www.broadcastify.com/webPlayer/2748',
    webUrl: 'https://www.broadcastify.com/listen/feed/2748',
    isLive: true,
    encrypted: false,
    priority: 2,
  },
  {
    id: 'arlington-fire',
    name: 'Arlington County Fire',
    description: 'ACFD Dispatch and Operations',
    region: 'va',
    type: 'fire',
    provider: 'broadcastify',
    feedId: '12916',
    embedUrl: 'https://www.broadcastify.com/webPlayer/12916',
    webUrl: 'https://www.broadcastify.com/listen/feed/12916',
    isLive: true,
    encrypted: false,
    priority: 3,
  },
  // Metro
  {
    id: 'wmata-metro',
    name: 'WMATA Metro Transit',
    description: 'Metro Transit Police and Operations',
    region: 'metro',
    type: 'transit',
    provider: 'broadcastify',
    feedId: '22659',
    embedUrl: 'https://www.broadcastify.com/webPlayer/22659',
    webUrl: 'https://www.broadcastify.com/listen/feed/22659',
    isLive: true,
    encrypted: false,
    priority: 1,
  },
];

/**
 * Get feeds filtered by criteria
 */
export function getFilteredFeeds(options: {
  region?: 'dc' | 'md' | 'va' | 'metro' | 'all';
  type?: 'fire' | 'ems' | 'police' | 'airport' | 'transit' | 'mixed';
  liveOnly?: boolean;
  includeEncrypted?: boolean;
}): ScannerFeed[] {
  let feeds = [...DC_SCANNER_FEEDS];

  if (!options.includeEncrypted) {
    feeds = feeds.filter((f) => !f.encrypted);
  }

  if (options.region && options.region !== 'all') {
    feeds = feeds.filter((f) => f.region === options.region);
  }

  if (options.type) {
    feeds = feeds.filter((f) => f.type === options.type);
  }

  if (options.liveOnly) {
    feeds = feeds.filter((f) => f.isLive);
  }

  return feeds.sort((a, b) => a.priority - b.priority);
}

/**
 * External resource links
 */
export const SCANNER_RESOURCES = {
  broadcastifyDC: 'https://www.broadcastify.com/listen/ctid/315',
  broadcastifyMetro: 'https://www.broadcastify.com/listen/mid/18',
  openMHzDCFD: 'https://openmhz.com/system/dcfd',
  dmvRealTime: 'https://dmvrealtime.com',
  radioReference: 'https://www.radioreference.com/db/browse/ctid/315',
};

