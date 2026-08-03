// SaviaSmart service worker
// Scope: installability + a small app-shell cache so the UI shell loads
// instantly on repeat visits. This does NOT cache Firestore/Firebase
// traffic or any cross-origin requests \u2014 those always go to the network.
// Bump this on every deploy so old clients pick up new files.
const CACHE_NAME = "savia-shell-v79";

const APP_SHELL = [
  "./",
  "./index.html",
  "./app.html",
  "./styles.css?v=20260802s",
  // Must carry the same ?v= as app.html requests: a cache key includes the
  // query string, so a bare "./app.js" here is a second, unread entry and the
  // 406 KB file gets fetched twice per install. tests/asset-versions.test.mjs
  // fails if this drifts from app.html again.
  "./app.js?v=20260802s",
  "./boot.js?v=20260802s",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/favicon-64.png",
  "./images/hero-warehouse-800.jpg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Only handle same-origin GET requests. Everything else (Firestore,
  // Firebase Auth, App Check, the AI proxy, CDN scripts, etc.) is left
  // completely alone and goes straight to the network.
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) {
    return;
  }

  // Navigation requests: try the network first so users always get the
  // latest app.js/app.html when online, falling back to the cached shell
  // when offline. The last-resort fallback is app.html, not index.html:
  // index.html is the marketing page now, and someone offline in a shop
  // wants the till, not the pitch.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Key the copy by the request's OWN url. This used to write every
          // navigation over the "./index.html" entry, so visiting
          // accept-invite.html replaced the cached app shell with the invite
          // page -- and the offline fallback below then served the invite page
          // to anyone opening the app root. Only successful responses are
          // stored, so a 404 or an error page cannot become the offline shell.
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match("./app.html")))
    );
    return;
  }

  // App-shell assets are cache-first for fast repeat visits. A deploy changes
  // CACHE_NAME, so the updated service worker pre-caches the new shell and
  // removes the previous version during activation.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});
