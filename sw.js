/**
 * Genesis 2 — Service Worker
 * Enables offline usage on iPad. Caches all app assets.
 */

const CACHE_NAME = 'genesis2-v15';

const ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/main.css',
  '/css/themes.css',
  '/js/app.js',
  '/js/storage.js',
  '/js/editor.js',
  '/js/manuscript.js',
  '/js/prose.js',
  '/js/structure.js',
  '/js/export.js',
  '/js/generate.js',
  '/js/firebase-config.js',
  '/js/firestore-storage.js',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg'
];

// Install: cache all core assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Fetch: cache-first strategy for app assets, network-first for others
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Only handle same-origin requests
  if (url.origin !== location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        // Return cached, but update in background
        const fetchPromise = fetch(event.request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, clone);
            });
          }
          return response;
        }).catch(() => cached);

        return cached;
      }

      // Not cached: fetch from network
      return fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, clone);
          });
        }
        return response;
      });
    })
  );
});
