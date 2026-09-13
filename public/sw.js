const CACHE_NAME = 'lilai-cache-v9'; // Bumped version
const urlsToCache = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  '/icons/one-time-donation.png',
  '/icons/recurring-donation.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
      .then(() => self.skipWaiting()) // Force activation
  );
});

self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim()) // Take control of open clients
  );
});

/*
 * Our own code is fetched from the network first.
 *
 * Stale-while-revalidate served the PREVIOUS script on the first load after every deploy,
 * so a fresh feature appeared to be missing and a fixed bug appeared to be unfixed — twice
 * now, each time diagnosed as a broken feature rather than a stale file. HTML, JS and CSS
 * we author are cheap to re-fetch and expensive to get wrong, so they go to the network
 * and fall back to the cache only when it is unreachable.
 *
 * Everything else — icons, fonts, images, the manifest — keeps stale-while-revalidate.
 * Those are content-stable: a month-old copy is the same file.
 */
function isOurCode(url) {
    return url.origin === self.location.origin
        && (/\.(?:js|css|html)$/.test(url.pathname) || url.pathname === '/');
}

self.addEventListener('fetch', (event) => {
    // Ignore non-GET requests and requests to non-web-standard schemes
    if (event.request.method !== 'GET' || !event.request.url.startsWith('http')) {
        return;
    }

    if (isOurCode(new URL(event.request.url))) {
        event.respondWith(
            fetch(event.request).then(networkResponse => {
                if (networkResponse && networkResponse.status === 200) {
                    const copy = networkResponse.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
                }
                return networkResponse;
            }).catch(() => caches.match(event.request).then(
                // Offline: a cached page beats no page. It may be a version behind, which
                // is the right trade when the alternative is nothing at all.
                cached => cached || Promise.reject(new Error('offline and not cached'))
            ))
        );
        return;
    }

    // Stale-while-revalidate for everything else
    event.respondWith(
        caches.open(CACHE_NAME).then(cache => {
            return cache.match(event.request).then(response => {
                const fetchPromise = fetch(event.request).then(networkResponse => {
                    // Check if we received a valid response
                    if (networkResponse && networkResponse.status === 200) {
                        cache.put(event.request, networkResponse.clone());
                    }
                    return networkResponse;
                });
                // Return the cached response immediately, and the fetch promise will update the cache in the background.
                return response || fetchPromise;
            });
        })
    );
});
