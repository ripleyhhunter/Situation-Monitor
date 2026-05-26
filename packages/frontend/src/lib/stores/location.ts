import { writable, derived } from 'svelte/store';
import type { MapState } from '$types';
import { REGION } from '$lib/config';

// Default region center. Renamed from DC_CENTER (kept as alias) — value
// comes from PUBLIC_REGION + PUBLIC_DEFAULT_LAT/LNG env vars at build time.
export const DEFAULT_CENTER: [number, number] = REGION.defaultCenter;
export const DEFAULT_ZOOM = REGION.defaultZoom;

/** @deprecated Use DEFAULT_CENTER. */
export const DC_CENTER = DEFAULT_CENTER;

// User's current location (if available)
export const userLocation = writable<[number, number] | null>(null);

// Map state
export const mapState = writable<MapState>({
  center: DEFAULT_CENTER,
  zoom: DEFAULT_ZOOM,
});

// Update map center
export function setMapCenter(lat: number, lng: number): void {
  mapState.update((state) => ({
    ...state,
    center: [lat, lng],
  }));
}

// Update map zoom
export function setMapZoom(zoom: number): void {
  mapState.update((state) => ({
    ...state,
    zoom,
  }));
}

// Update map bounds
export function setMapBounds(bounds: MapState['bounds']): void {
  mapState.update((state) => ({
    ...state,
    bounds,
  }));
}

// Request user's location
export async function requestUserLocation(): Promise<boolean> {
  if (!navigator.geolocation) {
    console.warn('Geolocation is not supported');
    return false;
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const coords: [number, number] = [
          position.coords.latitude,
          position.coords.longitude,
        ];
        userLocation.set(coords);
        setMapCenter(coords[0], coords[1]);
        resolve(true);
      },
      (error) => {
        console.warn('Geolocation error:', error.message);
        resolve(false);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000,
      }
    );
  });
}

// Center map on user's location
export function centerOnUser(): void {
  const location = userLocation;
  location.subscribe((loc) => {
    if (loc) {
      setMapCenter(loc[0], loc[1]);
    }
  })();
}

// Center map on the configured region default.
export function centerOnRegion(): void {
  setMapCenter(DEFAULT_CENTER[0], DEFAULT_CENTER[1]);
  setMapZoom(DEFAULT_ZOOM);
}

/** @deprecated Use centerOnRegion. */
export const centerOnDC = centerOnRegion;

// Dark mode preference
const prefersDark = typeof window !== 'undefined'
  ? window.matchMedia('(prefers-color-scheme: dark)').matches
  : false;

export const darkMode = writable<boolean>(
  typeof localStorage !== 'undefined'
    ? localStorage.getItem('darkMode') === 'true' || (localStorage.getItem('darkMode') === null && prefersDark)
    : prefersDark
);

// Toggle dark mode
export function toggleDarkMode(): void {
  darkMode.update((dark) => {
    const newValue = !dark;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('darkMode', String(newValue));
    }
    return newValue;
  });
}

// Sidebar state
export const sidebarOpen = writable<boolean>(true);

export function toggleSidebar(): void {
  sidebarOpen.update((open) => !open);
}

// Search location - set when user searches for an address
export interface SearchResult {
  lat: number;
  lng: number;
  name: string;
}

export const searchLocation = writable<SearchResult | null>(null);
