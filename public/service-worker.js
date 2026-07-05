const CACHE_NAME = "anki-note-v2";
const scopeUrl = new URL(self.registration.scope);
const indexUrl = new URL("index.html", scopeUrl).toString();
const APP_SHELL = ["", "index.html", "manifest.webmanifest", "icons/icon.svg"].map((path) =>
  new URL(path, scopeUrl).toString(),
);

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") {
    self.skipWaiting();
  }
});

function canHandle(request) {
  const url = new URL(request.url);
  return request.method === "GET" && url.origin === self.location.origin && (url.protocol === "http:" || url.protocol === "https:");
}

function cacheResponse(request, response) {
  if (!response.ok || response.type !== "basic") {
    return response;
  }
  const clone = response.clone();
  caches
    .open(CACHE_NAME)
    .then((cache) => cache.put(request, clone))
    .catch(() => undefined);
  return response;
}

self.addEventListener("fetch", (event) => {
  if (!canHandle(event.request)) {
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => cacheResponse(event.request, response))
        .catch(() => caches.match(indexUrl)),
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        return cached;
      }
      return fetch(event.request).then((response) => cacheResponse(event.request, response));
    }),
  );
});
