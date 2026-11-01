// Keski-C offline support. The app itself is fetched from the network first, so updates arrive as soon
// as they are published; the saved copy is used only when there is no connection. Fonts are cached once.
const CACHE = "keski-c-v1";
const CORE = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./icon-180.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const save = r => { if (r.ok || r.type === "opaque"){ const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return r; };
  if (url.origin === location.origin){
    e.respondWith(fetch(req).then(save).catch(() => caches.match(req).then(hit => hit || caches.match("./index.html"))));
  } else if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com"){
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(save)));
  }
});
