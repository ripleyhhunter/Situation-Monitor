/**
 * Format a date as relative time (e.g., "5 minutes ago")
 */
export function formatRelativeTime(date: string | Date): string {
  const now = Date.now();
  const then = new Date(date).getTime();
  const diff = now - then;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) {
    return 'just now';
  }

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  if (hours < 24) {
    return `${hours}h ago`;
  }

  if (days < 7) {
    return `${days}d ago`;
  }

  return formatDate(date);
}

/**
 * Format a date as a short date string
 */
export function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Format a date as a time string
 */
export function formatTime(date: string | Date): string {
  return new Date(date).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Format a date as full date and time
 */
export function formatDateTime(date: string | Date): string {
  return new Date(date).toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Check if a date is within the last N hours
 */
export function isWithinHours(date: string | Date, hours: number): boolean {
  const now = Date.now();
  const then = new Date(date).getTime();
  return now - then <= hours * 60 * 60 * 1000;
}

/**
 * Get time until expiration
 */
export function getTimeUntilExpiration(expiresAt: string | Date): string {
  const now = Date.now();
  const expires = new Date(expiresAt).getTime();
  const diff = expires - now;

  if (diff <= 0) {
    return 'Expired';
  }

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h`;
  }

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }

  return `${minutes}m`;
}

/**
 * Get the age of an incident in minutes
 */
export function getAgeInMinutes(date: string | Date): number {
  const now = Date.now();
  const then = new Date(date).getTime();
  return Math.floor((now - then) / 60000);
}

/**
 * Get opacity value based on incident age
 * Returns a value between 0.2 and 1.0
 */
export function getAgeBasedOpacity(date: string | Date): number {
  const ageMinutes = getAgeInMinutes(date);

  // < 15 minutes: full opacity
  if (ageMinutes < 15) return 1.0;
  // 15-60 minutes: 90%
  if (ageMinutes < 60) return 0.9;
  // 1-6 hours: 70%
  if (ageMinutes < 360) return 0.7;
  // 6-12 hours: 50%
  if (ageMinutes < 720) return 0.5;
  // 12-24 hours: 35%
  if (ageMinutes < 1440) return 0.35;
  // > 24 hours: 20%
  return 0.2;
}

/**
 * Check if an incident is "fresh" (< 15 minutes old)
 */
export function isFreshIncident(date: string | Date): boolean {
  return getAgeInMinutes(date) < 15;
}

/**
 * Check if an incident is "new" (< 2 minutes old) - for NEW badge
 */
export function isNewIncident(date: string | Date): boolean {
  return getAgeInMinutes(date) < 2;
}

/**
 * Get CSS class suffix based on age for styling
 */
export function getAgeFreshnessClass(date: string | Date): 'fresh' | 'recent' | 'stale' | 'old' {
  const ageMinutes = getAgeInMinutes(date);
  if (ageMinutes < 15) return 'fresh';
  if (ageMinutes < 60) return 'recent';
  if (ageMinutes < 360) return 'stale';
  return 'old';
}
