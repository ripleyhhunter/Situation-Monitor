import { writable, derived } from 'svelte/store';
import type { ScannerCall, ScannerFeed, ScannerStatus, ScannerCallType } from '$types';

// Store for recent scanner calls
export const scannerCalls = writable<ScannerCall[]>([]);

// Store for available scanner feeds
export const scannerFeeds = writable<ScannerFeed[]>([]);

// Store for scanner system status
export const scannerStatus = writable<ScannerStatus | null>(null);

// Store for currently playing audio
export const playingCallId = writable<string | null>(null);

// Store for selected region filter
export const selectedRegion = writable<'dc' | 'md' | 'va' | 'metro' | 'all'>('all');

// Maximum number of calls to keep in memory
const MAX_CALLS = 100;

/**
 * Add a new scanner call to the store
 */
export function addScannerCall(call: ScannerCall): void {
  scannerCalls.update((calls) => {
    // Check if call already exists
    if (calls.some((c) => c.id === call.id)) {
      return calls;
    }
    
    // Add to front and trim to max size
    const newCalls = [call, ...calls];
    if (newCalls.length > MAX_CALLS) {
      return newCalls.slice(0, MAX_CALLS);
    }
    return newCalls;
  });
}

/**
 * Set all scanner calls (used for initial load)
 */
export function setScannerCalls(calls: ScannerCall[]): void {
  scannerCalls.set(calls.slice(0, MAX_CALLS));
}

/**
 * Clear all scanner calls
 */
export function clearScannerCalls(): void {
  scannerCalls.set([]);
}

/**
 * Set scanner feeds
 */
export function setScannerFeeds(feeds: ScannerFeed[]): void {
  scannerFeeds.set(feeds);
}

/**
 * Update scanner status
 */
export function updateScannerStatus(status: ScannerStatus): void {
  scannerStatus.set(status);
}

/**
 * Set currently playing call
 */
export function setPlayingCall(callId: string | null): void {
  playingCallId.set(callId);
}

// Derived store for calls within the last 5 minutes (live calls)
export const liveCalls = derived(scannerCalls, ($calls) => {
  const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
  return $calls.filter((call) => new Date(call.timestamp).getTime() >= fiveMinutesAgo);
});

// Derived store for calls grouped by call type
export const callsByType = derived(scannerCalls, ($calls) => {
  const byType: Record<ScannerCallType, ScannerCall[]> = {
    dispatch: [],
    tactical: [],
    ems: [],
    fireground: [],
    command: [],
    hazmat: [],
    other: [],
  };

  for (const call of $calls) {
    const type = call.callType || 'other';
    if (byType[type]) {
      byType[type].push(call);
    } else {
      byType.other.push(call);
    }
  }

  return byType;
});

// Derived store for call counts by type
export const callCounts = derived(callsByType, ($byType) => {
  const counts: Record<ScannerCallType, number> = {
    dispatch: 0,
    tactical: 0,
    ems: 0,
    fireground: 0,
    command: 0,
    hazmat: 0,
    other: 0,
  };

  for (const type of Object.keys(counts) as ScannerCallType[]) {
    counts[type] = $byType[type]?.length || 0;
  }

  return counts;
});

// Derived store for live feeds only (not encrypted)
export const liveFeeds = derived(scannerFeeds, ($feeds) => {
  return $feeds.filter((feed) => feed.isLive && !feed.encrypted);
});

// Derived store for feeds by region
export const feedsByRegion = derived([scannerFeeds, selectedRegion], ([$feeds, $region]) => {
  if ($region === 'all') {
    return $feeds.filter((feed) => !feed.encrypted);
  }
  return $feeds.filter((feed) => feed.region === $region && !feed.encrypted);
});

/**
 * Fetch scanner calls from API
 */
export async function fetchScannerCalls(): Promise<void> {
  try {
    const apiUrl = import.meta.env.PUBLIC_API_URL || '';
    const response = await fetch(`${apiUrl}/api/scanner/calls`);
    
    if (response.ok) {
      const data = await response.json();
      setScannerCalls(data.calls || []);
      
      if (data.status) {
        updateScannerStatus({
          systemId: data.status.systemId || 'dcfd',
          isActive: data.status.totalCalls > 0,
          lastCallTime: data.status.lastCallTime,
          recentCallCount: data.status.totalCalls || 0,
        });
      }
    }
  } catch (error) {
    console.error('Failed to fetch scanner calls:', error);
  }
}

/**
 * Fetch scanner feeds from API
 */
export async function fetchScannerFeeds(): Promise<void> {
  try {
    const apiUrl = import.meta.env.PUBLIC_API_URL || '';
    const response = await fetch(`${apiUrl}/api/scanner/feeds`);
    
    if (response.ok) {
      const data = await response.json();
      setScannerFeeds(data.feeds || []);
    }
  } catch (error) {
    console.error('Failed to fetch scanner feeds:', error);
  }
}

/**
 * Format call duration for display
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Format call timestamp for display
 */
export function formatCallTime(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  
  if (diffMins < 1) {
    return 'Just now';
  } else if (diffMins < 60) {
    return `${diffMins}m ago`;
  } else {
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }
}

/**
 * Get color for call type
 */
export function getCallTypeColor(callType: ScannerCallType): string {
  const colors: Record<ScannerCallType, string> = {
    dispatch: '#3b82f6',   // blue
    ems: '#22c55e',        // green
    fireground: '#ef4444', // red
    tactical: '#f97316',   // orange
    command: '#8b5cf6',    // purple
    hazmat: '#eab308',     // yellow
    other: '#6b7280',      // gray
  };
  return colors[callType] || colors.other;
}

/**
 * Get display name for call type
 */
export function getCallTypeName(callType: ScannerCallType): string {
  const names: Record<ScannerCallType, string> = {
    dispatch: 'Dispatch',
    ems: 'EMS',
    fireground: 'Fireground',
    tactical: 'Tactical',
    command: 'Command',
    hazmat: 'Hazmat',
    other: 'Other',
  };
  return names[callType] || 'Other';
}

