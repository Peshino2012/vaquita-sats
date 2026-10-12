// Service worker: guarda la app para que abra rápido y sin conexión. Los datos
// (relays, billeteras, cotización) siempre van a la red.
const VERSION = 'vaquita-v2';
const APP = [
  './', 'index.html', 'styles.css', 'app.js', 'logic.js', 'cripto.js', 'lightning.js', 'nostr.js', 'precio.js', 'qr.js', 'config.js',
  'vendor/nostr.js', 'vendor/qrcode.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(APP)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Primero la red (para tomar versiones nuevas), y si no hay conexión, la copia guardada.
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        if (r.ok) {
          const copia = r.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copia));
        }
        return r;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))),
  );
});
