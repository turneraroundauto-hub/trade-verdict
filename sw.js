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
// /preview/ is the same reasoning applied to the hidden-subpath UI staging
// convention (see CLAUDE.md) — real work-in-progress pages under review,
// deliberately not linked from any tier's nav and never opened by the Play
// TWA (which only ever navigates to the root URL). This worker must never
// intercept or cache anything under it.
const OTHER_TIER_PATHS = ['/starter/', '/pro/', '/shark/', '/reset/', '/privacy/', '/preview/'];

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

// Anonymous re-engagement push -- see shared/push.ts and Tra's
// push-notifications.js. The payload is plain JSON built server-side
// ({title, body, url}); this worker never has to reach back out to the
// network to render a notification, so it still works offline.
self.addEventListener('push', (event) => {
  let data = { title: 'Trade Tribunal', body: 'Check today’s Gate.', url: '/' };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    // Malformed/empty payload -- fall back to the generic message above
    // rather than showing nothing, or throwing and dropping the push.
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/shared/assets/icons/icon-192.png',
      badge: '/shared/assets/icons/icon-192.png',
      data: { url: data.url || '/' },
    })
  );
});

// Focus an already-open tab if one exists rather than always opening a new
// one -- most real re-opens during a testing window are from a tester who
// already has the app pinned/backgrounded, not a fresh launch.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
