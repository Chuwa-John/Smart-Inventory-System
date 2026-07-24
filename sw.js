// DukaSmart service worker
// Scope: installability + a small app-shell cache so the UI shell loads
// instantly on repeat visits. This does NOT cache Firestore/Firebase
// traffic or any cross-origin requests \u2014 those always go to the network.
// Bump this on every deploy so old clients pick up new files.
const CACHE_NAME = "dukasmart-shell-v4";

const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
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
  // latest app.js/index.html when online, falling back to the cached
  // shell when offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put("./index.html", copy));
          return response;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  // Static app-shell assets: network-first, so a fresh deploy is always
  // visible on the very next load while online. The cache is only used
  // as an offline fallback, not as a first-choice source \u2014 the browser's
  // own HTTP cache already keeps repeat loads fast when nothing changed.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});