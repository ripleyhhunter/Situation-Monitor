import { writable, derived } from 'svelte/store';
import type { Camera } from '$types';
import { filters } from './filters';

// Store for all cameras
export const cameras = writable<Map<string, Camera>>(new Map());

// Add or update a camera
export function upsertCamera(camera: Camera): void {
  cameras.update((map) => {
    map.set(camera.id, camera);
    return new Map(map);
  });
}

// Remove a camera
export function removeCamera(id: string): void {
  cameras.update((map) => {
    map.delete(id);
    return new Map(map);
  });
}

// Clear all cameras
export function clearAllCameras(): void {
  cameras.set(new Map());
}

// Derived store for camera array
export const cameraList = derived(cameras, ($cameras) =>
  Array.from($cameras.values())
);

// Derived store for filtered cameras (respects showLocationOnlyCameras filter)
export const filteredCameraList = derived(
  [cameras, filters],
  ([$cameras, $filters]) => {
    const allCameras = Array.from($cameras.values());
    
    if ($filters.showLocationOnlyCameras) {
      // Show all cameras
      return allCameras;
    }
    
    // Hide DC cameras which are location-only markers (no public feeds available)
    // Keep landmark webcams which have working external links via streamUrl
    return allCameras.filter(camera => camera.source !== 'dc');
  }
);

// Selected camera for modal view
export const selectedCamera = writable<Camera | null>(null);

export function selectCamera(camera: Camera | null): void {
  selectedCamera.set(camera);
}
