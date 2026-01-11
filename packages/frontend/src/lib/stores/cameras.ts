import { writable, derived } from 'svelte/store';
import type { Camera } from '$types';

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

// Selected camera for modal view
export const selectedCamera = writable<Camera | null>(null);

export function selectCamera(camera: Camera | null): void {
  selectedCamera.set(camera);
}
