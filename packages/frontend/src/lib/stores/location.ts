import { writable, derived } from 'svelte/store';
import type { MapState } from '$types';

// DC center coordinates
export const DC_CENTER: [number, number] = [38.9072, -77.0369];
export const DEFAULT_ZOOM = 12;

// User's current location (if available)
export const userLocation = writable<[number, number] | null>(null);

// Map state
export const mapState = writable<MapState>({
  center: DC_CENTER,
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

// Center map on DC
export function centerOnDC(): void {
  setMapCenter(DC_CENTER[0], DC_CENTER[1]);
  setMapZoom(DEFAULT_ZOOM);
}

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
