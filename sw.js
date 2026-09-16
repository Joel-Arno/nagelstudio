/* Offline-Betrieb: Die App-Dateien liegen im Cache, damit das Studio auch
   ohne Netz startet. Entwuerfe liegen ohnehin lokal in IndexedDB. */

const CACHE = 'nagelstudio-v1';
const ASSETS = [
  './',
  './index.html',
  './css/app.css',
  './js/app.js',
  './js/draw.js',
  './js/store.js',
  './js/shapes.js',
  './manifest.webmanifest',
  './icon.png',
  './icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(ASSETS.map(a => c.add(a))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if(req.method !== 'GET') return;

  const url = new URL(req.url);
  if(url.origin !== location.origin) return;   // Schriften o. Ae. nicht abfangen

  e.respondWith(
    caches.match(req).then(hit => {
      const net = fetch(req).then(res => {
        if(res && res.ok){
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
