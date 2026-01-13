/**
 * Calculate distance between two points using Haversine formula
 * Returns distance in kilometers
 */
export function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Earth's radius in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Convert degrees to radians
 */
export function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}

/**
 * Convert radians to degrees
 */
export function toDeg(rad: number): number {
  return rad * (180 / Math.PI);
}

/**
 * Format distance for display
 */
export function formatDistance(km: number): string {
  if (km < 0.1) {
    return `${Math.round(km * 1000)}m`;
  }
  if (km < 1) {
    return `${(km * 1000).toFixed(0)}m`;
  }
  if (km < 10) {
    return `${km.toFixed(1)}km`;
  }
  return `${Math.round(km)}km`;
}

/**
 * Format coordinates for display
 */
export function formatCoordinates(lat: number, lng: number): string {
  const latDir = lat >= 0 ? 'N' : 'S';
  const lngDir = lng >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(4)}°${latDir}, ${Math.abs(lng).toFixed(4)}°${lngDir}`;
}

/**
 * Check if a point is within bounds
 */
export function isInBounds(
  lat: number,
  lng: number,
  bounds: { north: number; south: number; east: number; west: number }
): boolean {
  return (
    lat >= bounds.south &&
    lat <= bounds.north &&
    lng >= bounds.west &&
    lng <= bounds.east
  );
}

/**
 * Calculate the center of multiple points
 */
export function calculateCenter(points: Array<{ lat: number; lng: number }>): {
  lat: number;
  lng: number;
} {
  if (points.length === 0) {
    return { lat: 0, lng: 0 };
  }

  const sumLat = points.reduce((sum, p) => sum + p.lat, 0);
  const sumLng = points.reduce((sum, p) => sum + p.lng, 0);

  return {
    lat: sumLat / points.length,
    lng: sumLng / points.length,
  };
}

/**
 * Calculate bounds that contain all points
 */
export function calculateBounds(points: Array<{ lat: number; lng: number }>): {
  north: number;
  south: number;
  east: number;
  west: number;
} | null {
  if (points.length === 0) {
    return null;
  }

  let north = -Infinity;
  let south = Infinity;
  let east = -Infinity;
  let west = Infinity;

  for (const point of points) {
    north = Math.max(north, point.lat);
    south = Math.min(south, point.lat);
    east = Math.max(east, point.lng);
    west = Math.min(west, point.lng);
  }

  return { north, south, east, west };
}

/**
 * Get bearing from one point to another
 */
export function getBearing(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  let bearing = toDeg(Math.atan2(y, x));
  bearing = (bearing + 360) % 360;
  return bearing;
}

/**
 * Get cardinal direction from bearing
 */
export function getCardinalDirection(bearing: number): string {
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const index = Math.round(bearing / 45) % 8;
  return directions[index];
}

/**
 * Result of a nearby item search with distance and direction info
 */
export interface NearbyItem<T> {
  item: T;
  distance: number; // km
  bearing: number;  // degrees
  direction: string; // cardinal direction (N, NE, etc.)
}

/**
 * Find nearby items from a list based on distance from a reference point.
 * Returns items sorted by distance with distance/bearing info attached.
 * 
 * @param refLat - Reference latitude
 * @param refLng - Reference longitude
 * @param items - Array of items to search
 * @param getLocation - Function to extract lat/lng from an item
 * @param options - Configuration options
 * @returns Array of nearby items with distance info, sorted by distance
 */
export function findNearbyItems<T>(
  refLat: number,
  refLng: number,
  items: T[],
  getLocation: (item: T) => { lat: number; lng: number },
  options: {
    maxDistance?: number;  // km, default 0.8 (about 0.5 miles)
    maxResults?: number;   // default 5
    filter?: (item: T) => boolean; // additional filter
  } = {}
): NearbyItem<T>[] {
  const { maxDistance = 0.8, maxResults = 5, filter } = options;

  const results: NearbyItem<T>[] = [];

  for (const item of items) {
    // Apply additional filter if provided
    if (filter && !filter(item)) {
      continue;
    }

    const loc = getLocation(item);
    const distance = haversineDistance(refLat, refLng, loc.lat, loc.lng);

    if (distance <= maxDistance) {
      const bearing = getBearing(refLat, refLng, loc.lat, loc.lng);
      results.push({
        item,
        distance,
        bearing,
        direction: getCardinalDirection(bearing),
      });
    }
  }

  // Sort by distance
  results.sort((a, b) => a.distance - b.distance);

  // Limit results
  return results.slice(0, maxResults);
}

/**
 * Format distance for display in miles (US convention)
 * Converts from km to miles and formats appropriately
 */
export function formatDistanceMiles(km: number): string {
  const miles = km * 0.621371;
  if (miles < 0.1) {
    // Less than 0.1 miles, show in feet
    const feet = Math.round(miles * 5280);
    return `${feet} ft`;
  }
  if (miles < 1) {
    return `${miles.toFixed(2)} mi`;
  }
  return `${miles.toFixed(1)} mi`;
}
