import { writable, derived } from 'svelte/store';
import type { Camera } from '$types';
import { filters } from './filters';
import { selectedRegionId } from './region';

// Store for all cameras across every region.
export const cameras = writable<Map<string, Camera>>(new Map());

// Add or update a camera
export function upsertCamera(camera: Camera): void {
  cameras.update((map) => {
    map.set(camera.id, camera);
    return new Map(map);
  });
}

// Bulk upsert: one store update for a whole batch (see incidents store).
export function upsertCameras(list: Camera[]): void {
  if (list.length === 0) return;
  cameras.update((map) => {
    for (const camera of list) {
      map.set(camera.id, camera);
    }
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

// Camera array for the selected region.
export const cameraList = derived(
  [cameras, selectedRegionId],
  ([$cameras, $regionId]) =>
    Array.from($cameras.values()).filter((c) => c.regionId === $regionId),
);

// Filtered cameras for the selected region (respects showLocationOnlyCameras filter).
export const filteredCameraList = derived(
  [cameras, filters, selectedRegionId],
  ([$cameras, $filters, $regionId]) => {
    const regional = Array.from($cameras.values()).filter((c) => c.regionId === $regionId);

    if ($filters.showLocationOnlyCameras) {
      return regional;
    }

    // Hide DC cameras which are location-only markers (no public feeds available).
    // Keep landmark webcams which have working external links via streamUrl.
    return regional.filter((camera) => camera.source !== 'dc');
  },
);

// Selected camera for modal view
export const selectedCamera = writable<Camera | null>(null);

export function selectCamera(camera: Camera | null): void {
  selectedCamera.set(camera);
}
