/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

/**
 * Minimal, SSE-safe service worker for installability + offline shell.
 *
 * Strategy:
 *  - Built assets and static files: cache-first (immutable per `version`).
 *  - Anything under /api (same- or cross-origin): NEVER intercepted — the
 *    SSE stream and live data must go straight to the network.
 *  - Navigations: network-first, falling back to the cached app shell so a
 *    cold offline open still renders (with the dashboard reconnecting once
 *    the network returns).
 */

import { build, files, prerendered, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE_NAME = `sitmon-${version}`;
const ASSETS = [...build, ...files, ...prerendered];

sw.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => sw.skipWaiting())
  );
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => sw.clients.claim())
  );
});

sw.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Live data (REST + SSE) is never served from or stored in a cache,
  // regardless of which origin the backend lives on.
  if (url.pathname.includes('/api/')) return;

  // Only same-origin beyond this point (map tiles, camera images, radar
  // tiles etc. stay untouched — their own cache headers are correct).
  if (url.origin !== sw.location.origin) return;

  const isAsset = ASSETS.includes(url.pathname);

  if (isAsset) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(request);
        return cached ?? fetch(request);
      })
    );
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(CACHE_NAME);
        // The SPA fallback shell — any prerendered page will do.
        const shell =
          (await cache.match(prerendered[0] ?? '/')) ?? (await cache.match('/'));
        return shell ?? Response.error();
      })
    );
  }
});
