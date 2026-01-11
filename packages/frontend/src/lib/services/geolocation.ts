import { userLocation, setMapCenter } from '$stores/location';

export interface GeolocationResult {
  success: boolean;
  coords?: [number, number];
  error?: string;
}

/**
 * Request user's current location
 */
export async function getCurrentLocation(): Promise<GeolocationResult> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return {
      success: false,
      error: 'Geolocation is not supported by this browser',
    };
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const coords: [number, number] = [
          position.coords.latitude,
          position.coords.longitude,
        ];
        userLocation.set(coords);
        resolve({ success: true, coords });
      },
      (error) => {
        let errorMessage: string;
        switch (error.code) {
          case error.PERMISSION_DENIED:
            errorMessage = 'Location permission denied';
            break;
          case error.POSITION_UNAVAILABLE:
            errorMessage = 'Location information unavailable';
            break;
          case error.TIMEOUT:
            errorMessage = 'Location request timed out';
            break;
          default:
            errorMessage = 'Unknown error occurred';
        }
        resolve({ success: false, error: errorMessage });
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000,
      }
    );
  });
}

/**
 * Watch user's location continuously
 */
export function watchLocation(
  onUpdate: (coords: [number, number]) => void,
  onError?: (error: string) => void
): number | null {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    onError?.('Geolocation is not supported');
    return null;
  }

  return navigator.geolocation.watchPosition(
    (position) => {
      const coords: [number, number] = [
        position.coords.latitude,
        position.coords.longitude,
      ];
      userLocation.set(coords);
      onUpdate(coords);
    },
    (error) => {
      onError?.(error.message);
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 30000,
    }
  );
}

/**
 * Stop watching location
 */
export function clearLocationWatch(watchId: number): void {
  if (typeof navigator !== 'undefined' && navigator.geolocation) {
    navigator.geolocation.clearWatch(watchId);
  }
}

/**
 * Calculate distance between two points (Haversine formula)
 * Returns distance in kilometers
 */
export function calculateDistance(
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

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}

/**
 * Format distance for display
 */
export function formatDistance(km: number): string {
  if (km < 1) {
    return `${Math.round(km * 1000)}m`;
  }
  return `${km.toFixed(1)}km`;
}
