const SHELL_CACHE = 'tt-shell-v1';
const SHELL_URLS = ['/', '/manifest.json'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_URLS))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Network-first: always prefer a fresh response. Only fall back to the
// cached shell when there's no network at all (this repo has been bitten
// hard by stale-cache bugs before — see CLAUDE.md's cache-busting rule —
// so this worker must never serve a stale page over a reachable network).
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (event.request.mode === 'navigate' && response.ok) {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put('/', copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request.mode === 'navigate' ? '/' : event.request))
  );
});
