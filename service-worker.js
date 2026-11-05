/* ==========================================================================
   MealPlan DSS — service worker
   Strategy:
   - Precache the app shell on install.
   - Cache-first for static assets (icons, logo, css, js).
   - Network-first for page navigations, falling back to the cached shell.
   - Bump CACHE_VERSION to invalidate old caches after a deploy.
   ========================================================================== */

const CACHE_VERSION = "mealplan-dss-v43";
const CACHE_NAME = CACHE_VERSION;

// App shell — landing page + dashboard (data always comes from Neon live).
const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./style.css",
  "./script.js",
  "./app.html",
  "./app.css",
  "./app.js",
  "./db.js",
  "./neon.js",
  "./recommend.js",
  "./csv-parse.js",
  "./clerk-config.js",
  "./manifest.json",
  "./MealPlan_Logo.svg",
  "./icons/icon-32x32.png",
  "./icons/icon-180x180.png",
  "./icons/icon-192x192.png",
  "./icons/icon-512x512.png"
];

/* ---------- Install: populate the precache ---------- */

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  // Take control of open pages without waiting for a reload.
  self.skipWaiting();
});

/* ---------- Activate: drop caches from older versions ---------- */

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

/* ---------- Fetch: serve from cache, fall back to network ---------- */

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Only handle GET requests (skip cross-origin by default too).
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Config files change during setup — always fetch them fresh, never cache.
  if (url.pathname.endsWith("/neon-config.js") || url.pathname.endsWith("/clerk-config.js")) {
    event.respondWith(fetch(request));
    return;
  }

  // Page navigations: try the network first (fresh HTML), then the cache.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() =>
          caches.match("./index.html").then((cached) => cached || caches.match(request))
        )
    );
    return;
  }

  // Everything else (css, js, images, fonts, manifest): cache-first.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request)
        .then((response) => {
          // Don't bother caching failed responses.
          if (!response || response.status !== 200) return response;

          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => cached);
    })
  );
});