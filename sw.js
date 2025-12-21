const CACHE_NAME = 'glp-v15-0'; // Aggiornato per forzare pulizia

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './style.css',
  './style.css?v=15.0',
  './app.js',
  './app.js?v=15.0',
  './manifest.json',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://cdn.jsdelivr.net/npm/canvas-confetti@1.6.0/dist/confetti.browser.min.js',
  'https://fonts.googleapis.com/icon?family=Material+Icons+Round'
];

self.addEventListener('install', (evt) => {
  evt.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (evt) => {
  evt.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : null))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (evt) => {
  const url = evt.request.url;
  if (url.includes('firestore') || url.includes('googleapis')) return;
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
  } else {
    evt.respondWith(
      caches.match(evt.request).then((res) => res || fetch(evt.request))
    );
  }
});