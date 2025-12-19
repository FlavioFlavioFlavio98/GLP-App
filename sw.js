const CACHE_NAME = 'glp-v14-8';

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './style.css',
  './style.css?v=14.8',
  './app.js',
  './app.js?v=14.8',
  './manifest.json',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://cdn.jsdelivr.net/npm/canvas-confetti@1.6.0/dist/confetti.browser.min.js',
  'https://fonts.googleapis.com/icon?family=Material+Icons+Round'
];

// INSTALL: caching iniziale + attivazione immediata
self.addEventListener('install', (evt) => {
  evt.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
  );
  self.skipWaiting();
});

// ACTIVATE: pulizia vecchie cache + prende controllo subito
self.addEventListener('activate', (evt) => {
  evt.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : null))))
      .then(() => self.clients.claim())
  );
});

// FETCH:
// - Navigazione (index.html): network-first per prendere versioni nuove
// - Statici: cache-first
// - Firebase/Google APIs: bypass
self.addEventListener('fetch', (evt) => {
  const url = evt.request.url;

  // Bypass Firestore / Google APIs
  if (url.includes('firestore') || url.includes('googleapis')) return;

  // Network-first per navigazione (HTML)
  if (evt.request.mode === 'navigate') {
    evt.respondWith(
      fetch(evt.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Cache-first per gli altri asset
  evt.respondWith(
    caches.match(evt.request).then((cacheRes) => cacheRes || fetch(evt.request))
  );
});
