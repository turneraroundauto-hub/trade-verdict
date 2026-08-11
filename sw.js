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

// This script is served from the site root, so its scope by default covers
// the whole origin — including /starter/, /pro/, /shark/, even though only
// the Free tier registers it. Explicitly ignore those tiers' paths so this
// worker never intercepts (and can't ever fall back to serving Free's
// homepage for) a request that belongs to a different tier.
const OTHER_TIER_PATHS = ['/starter/', '/pro/', '/shark/', '/reset/', '/privacy/'];

// Network-first: always prefer a fresh response. Only fall back to the
// cached shell when there's no network at all (this repo has been bitten
// hard by stale-cache bugs before — see CLAUDE.md's cache-busting rule —
// so this worker must never serve a stale page over a reachable network).
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const path = new URL(event.request.url).pathname;
  if (OTHER_TIER_PATHS.some((p) => path.startsWith(p))) return;

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
