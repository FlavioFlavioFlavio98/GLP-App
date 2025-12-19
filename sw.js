const CACHE_NAME = 'glp-v13.1-refactor'; // Aggiornato per forzare il refresh della cache
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './style.css',
    './manifest.json',
    // Nuovi moduli JS
    './main.js',
    './logic.js',
    './ui.js',
    './firebase-config.js',
    // Librerie Esterne (CDN)
    'https://cdn.jsdelivr.net/npm/chart.js',
    'https://cdn.jsdelivr.net/npm/canvas-confetti@1.6.0/dist/confetti.browser.min.js',
    'https://fonts.googleapis.com/icon?family=Material+Icons+Round'
];

// INSTALLAZIONE: Caching iniziale delle risorse statiche
self.addEventListener('install', (evt) => {
    evt.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('SW: Caching assets per', CACHE_NAME);
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
    // Forza l'attivazione immediata del nuovo SW
    self.skipWaiting();
});

// ATTIVAZIONE: Pulizia vecchie cache (es. glp-v13.0)
self.addEventListener('activate', (evt) => {
    evt.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter(key => key !== CACHE_NAME).map(key => {
                    console.log('SW: Cancellazione vecchia cache', key);
                    return caches.delete(key);
                })
            );
        })
    );
    // Prende il controllo della pagina immediatamente senza ricaricare
    self.clients.claim();
});

// FETCH: Strategia "Cache First" per i file statici, "Network Only" per Firebase
self.addEventListener('fetch', (evt) => {
    const url = evt.request.url;

    // 1. Ignora chiamate a Firestore/Google APIs (devono essere live o gestite dall'SDK Firebase)
    if (url.includes('firestore.googleapis.com') || 
        url.includes('google.com') || 
        url.includes('googleapis.com')) {
        return; // Lascia che il browser/SDK gestisca la rete
    }

    // 2. Per i file statici dell'app, controlla prima la cache
    evt.respondWith(
        caches.match(evt.request).then((cacheRes) => {
            return cacheRes || fetch(evt.request).catch(() => {
                // Fallback opzionale se offline e risorsa non in cache
                // (Per ora non necessario se hai cachato tutto il core)
            });
        })
    );
});