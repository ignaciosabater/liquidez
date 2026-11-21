// Service worker: la app (HTML/JS/CSS) abre sin conexión; los datos siempre van a la red.
const VERSION = 'liquidez-v1';
const SHELL = ['./', './index.html', './styles.css', './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
  './js/main.js', './js/util.js', './js/aggregate.js', './js/booksync.js', './js/feeds.js', './js/compass.js', './js/recorder.js', './js/charts.js', './js/global.js', './js/ui-global.js', './js/ui-liq.js', './js/demo.js'];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return; // datos en vivo: siempre red
  // primero red (para recibir versiones nuevas) y, sin conexión, la copia guardada
  e.respondWith(fetch(e.request).then((r) => { const cp = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request).then((m) => m || caches.match('./index.html'))));
});
