const CACHE_NAME = 'glp-v1';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './manifest.json',
    'https://cdn.jsdelivr.net/npm/chart.js',
    'https://cdn.jsdelivr.net/npm/canvas-confetti@1.6.0/dist/confetti.browser.min.js',
    'https://fonts.googleapis.com/icon?family=Material+Icons+Round'
];

// INSTALLAZIONE: Caching iniziale
self.addEventListener('install', (evt) => {
    evt.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('SW: Caching assets');
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
});

// ATTIVAZIONE: Pulizia vecchie cache
self.addEventListener('activate', (evt) => {
    evt.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
            );
        })
    );
});

// FETCH: Strategia "Cache First" per i file statici, ma lascia passare le chiamate a Firebase
self.addEventListener('fetch', (evt) => {
    // Ignora chiamate a Firestore/Google APIs (gestite da SDK Firebase)
    if (evt.request.url.includes('firestore') || evt.request.url.includes('googleapis')) {
        return;
    }

    evt.respondWith(
        caches.match(evt.request).then((cacheRes) => {
            return cacheRes || fetch(evt.request);
        })
    );
});