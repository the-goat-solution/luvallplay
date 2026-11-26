// The players' app service worker (built into dist/sw.js by vite.config.ts,
// which fills in ASSETS and VERSION). It keeps the app itself on the device
// so it opens without a connection; the data comes from the saved screens
// (src/lib/offline.ts). It never touches API calls, other hosts, or the
// tracker's runtime and models.
/* global self, caches, ASSETS, VERSION */
const CACHE = `app-${VERSION}`;
const SHELL = "/index.html";
// How long the network gets before this device's copy is used instead: a
// connection that is there but answers nothing (a lift, a crowded hall)
// would otherwise leave a blank page for minutes.
const PAGE_TIMEOUT_MS = 4000;
const FILE_TIMEOUT_MS = 20000;

/** fetch() that gives up after `ms`. */
function fetchWithin(request, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(request, { signal: controller.signal }).finally(() => clearTimeout(timer));
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll([SHELL, ...ASSETS]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("app-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/") || url.pathname.startsWith("/mediapipe/")) return;

  // Pages: the network first (a new version shows at once), this device's copy without one.
  if (request.mode === "navigate") {
    event.respondWith(
      fetchWithin(request, PAGE_TIMEOUT_MS)
        .then((response) => {
          // Only the app's own page is kept: not an error page, and not a
          // Wi-Fi sign-in page answering in its place.
          if (response.ok && !response.redirected && (response.headers.get("content-type") ?? "").includes("text/html")) {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put(SHELL, copy));
          }
          return response;
        })
        // No answer (or none in time): this device's copy; without one, the network for as long as it takes.
        .catch(() => caches.match(SHELL).then((hit) => hit ?? fetch(request))),
    );
    return;
  }

  // The built files never change under a name: this device's copy first.
  if (url.pathname.startsWith("/assets/") || ASSETS.includes(url.pathname)) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ??
          fetchWithin(request, FILE_TIMEOUT_MS).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              void caches.open(CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
  }
});
