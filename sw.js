
const CACHE_NAME = "flight-sun-v2";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./data/airports.json",
  "./data/waypoints.json"
];
// Pre-cache tiles (if present) up to z=2
const TILE_URLS = [];
for (let z=0; z<=2; z++) {
  const max = 1<<z;
  for (let x=0; x<max; x++) {
    for (let y=0; y<max; y++) {
      TILE_URLS.push(`./tiles/${z}/${x}/${y}.png`);
    }
  }
}
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll([...CORE_ASSETS, ...TILE_URLS]))
  );
  self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))) 
  );
  self.clients.claim();
});
self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((res)=> res || fetch(event.request))
  );
});
