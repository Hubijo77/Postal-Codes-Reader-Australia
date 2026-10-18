// Service Worker: App offline-fähig machen und Postleitzahl-Geometrien zwischenspeichern.
const VERSION = 'v3';
const SHELL = `plz-shell-${VERSION}`;
const DATA = 'plz-data';
const SHELL_FILES = [
  './', 'index.html', 'style.css', 'app.js', 'states.js', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('plz-shell-') && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // Geometrien ändern sich nur mit neuem Datensatz: zuerst Cache.
  if (sameOrigin && /\/data\/(poa|overview)\//.test(url.pathname)) {
    event.respondWith(
      caches.open(DATA).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  // App-Dateien und Index: zuerst Netz, offline aus dem Cache.
  if (sameOrigin || SHELL_FILES.includes(req.url)) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) caches.open(SHELL).then((c) => c.put(req, res.clone()));
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match('index.html'))),
    );
  }
});
