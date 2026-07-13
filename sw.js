const CACHE_NAME = "signal-chime-lab-v3";
const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./models/coco-ssd/model.json",
  "./models/coco-ssd/group1-shard1of5",
  "./models/coco-ssd/group1-shard2of5",
  "./models/coco-ssd/group1-shard3of5",
  "./models/coco-ssd/group1-shard4of5",
  "./models/coco-ssd/group1-shard5of5",
  "./vendor/tf.es2017.min.js",
  "./vendor/coco-ssd.min.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        return cached;
      }

      return fetch(event.request)
        .then((response) => {
          const responseCopy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseCopy));
          return response;
        })
        .catch(() => cached);
    })
  );
});
