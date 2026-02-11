/**
 * Genesis 2 — Service Worker
 * Enables offline usage on iPad. Caches all app assets.
 *
 * Strategy:
 *  - HTML / JS files → network-first (ensures fresh code, falls back to cache offline)
 *  - Everything else  → cache-first with background refresh (icons, CSS, manifest)
 */

const CACHE_NAME = 'genesis2-v41';

// Use relative paths so caching works whether hosted at root or a subdirectory
// (e.g. GitHub Pages at /Genesis/)
const ASSET_PATHS = [
  './',
  './index.html',
  './manifest.json',
  './css/main.css',
  './css/themes.css',
  './js/app.js',
  './js/storage.js',
  './js/editor.js',
  './js/manuscript.js',
  './js/prose.js',
  './js/structure.js',
  './js/export.js',
  './js/generate.js',
  './js/cover-editor.js',
  './js/firebase-config.js',
  './js/firestore-storage.js',
  './js/genres.js',
  './icons/icon-192.svg',
  './icons/icon-512.svg'
];

// File extensions that must always be served fresh (network-first)
function isCodeAsset(url) {
  const path = url.pathname;
  return path.endsWith('.html') || path.endsWith('.js') || path.endsWith('/');
}

// Install: cache all core assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSET_PATHS);
    })
  );
  self.skipWaiting();
});

// Activate: clean old caches, then tell all open pages to reload
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
    }).then(() => {
      // Notify all controlled pages that a new version is active
      return self.clients.matchAll({ type: 'window' }).then((clients) => {
        for (const client of clients) {
          client.postMessage({ type: 'SW_UPDATED' });
        }
      });
    })
  );
  self.clients.claim();
});

// Fetch handler
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Only handle same-origin requests
  if (url.origin !== location.origin) return;

  if (isCodeAsset(url)) {
    // Network-first for HTML/JS — always serve fresh code when online
    event.respondWith(
      fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, clone);
          });
        }
        return response;
      }).catch(() => {
        // Offline: fall back to cache
        return caches.match(event.request);
      })
    );
  } else {
    // Cache-first for static assets (CSS, icons, manifest)
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) {
          // Return cached, update in background
          fetch(event.request).then((response) => {
            if (response.ok) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(event.request, clone);
              });
            }
          }).catch(() => {});
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
  }
});
