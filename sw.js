/* Offline-Betrieb.

   App-Code kommt zuerst aus dem Netz und nur ohne Verbindung aus dem
   Zwischenspeicher -- sonst saehe man nach jedem Update beim ersten Oeffnen
   noch die alte Fassung. Die grossen, unveraenderlichen Dateien der
   Handerkennung (rund 17 MB) kommen dagegen aus dem Speicher; sie werden
   erst beim ersten Oeffnen der Anprobe geladen und nicht vorab. */

const CACHE = 'nagelstudio-v4';
const ASSETS = [
  './',
  './index.html',
  './css/app.css',
  './js/app.js',
  './js/draw.js',
  './js/store.js',
  './js/shapes.js',
  './js/tryon.js',
  './js/entnahme.js',
  './js/handdetect.js',
  './js/compose.js',
  './js/warp.js',
  './js/nailfit.js',
  './js/patterns.js',
  './js/nailrender.js',
  './js/camera.js',
  './manifest.webmanifest',
  './icon.png',
  './icon-512.png'
];
const GROSS = /\/(vendor|models)\//;

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(ASSETS.map(a => c.add(new Request(a, { cache: 'no-cache' })))))
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

async function ablegen(req, res){
  if(res && res.ok){
    const c = await caches.open(CACHE);
    await c.put(req, res.clone()).catch(() => {});
  }
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if(req.method !== 'GET') return;
  const url = new URL(req.url);
  if(url.origin !== location.origin) return;   // Schriften o. Ae. nicht abfangen

  if(GROSS.test(url.pathname)){
    // Erkennung: aus dem Speicher, sonst laden und ablegen
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => ablegen(req, res))));
    return;
  }

  // App-Code: frisch aus dem Netz, ohne Netz aus dem Speicher
  e.respondWith(
    fetch(req, { cache: 'no-cache' })
      .then(res => ablegen(req, res))
      .catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
  );
});
