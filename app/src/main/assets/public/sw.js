const CACHE_NAME = 'sgp-tactical-v3';
const ASSETS = [
    '/',
    '/index.html',
    '/style.css',
    '/app.js',
    '/oui-mini.js',
    '/manifest.json',
    '/sgp-logo.png'
];

// Install — cache core assets
self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(ASSETS))
            .then(() => self.skipWaiting())
    );
});

// Activate — delete old caches
self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
            )
        ).then(() => self.clients.claim())
    );
});

// Fetch — Network first for local assets, skip cache for external APIs
self.addEventListener('fetch', (e) => {
    const url = new URL(e.request.url);

    // NEVER cache external API calls — let them go direct to network
    if (url.origin !== self.location.origin) {
        return; // Don't intercept — browser handles it normally
    }

    // For local assets: network first, fallback to cache
    e.respondWith(
        fetch(e.request)
            .then(res => {
                const clone = res.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
                return res;
            })
            .catch(() => caches.match(e.request))
    );
});
