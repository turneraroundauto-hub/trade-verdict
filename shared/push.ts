// Anonymous, account-free re-engagement push notifications.
//
// Deliberately NOT gated behind a login -- Free tier's whole product story
// (and its Play Store submission, CLAUDE.md "Sign-in details: No") is "no
// account required for any functionality." A subscription is keyed to the
// same anonymous device_id shared/device-id.ts already generates -- not to
// a person. The only thing this ever asks the visitor for is the browser's
// own native "Allow notifications?" permission prompt.
//
// Only Free tier registers a Service Worker at all today (shared/device-id.ts's
// own header comment, sw.js's OTHER_TIER_PATHS) -- this module is written
// to be tier-agnostic (Starter/Pro can adopt it later by registering their
// own SW and calling these same exports), but its only real consumer as of
// this writing is app.ts.

const DISMISSED_KEY = 'tv_push_dismissed';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const out = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) out[i] = rawData.charCodeAt(i);
  return out;
}

export function pushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator &&
    'PushManager' in window && typeof Notification !== 'undefined';
}

// Whether to show the "enable notifications" offer at all -- false once the
// visitor has already granted/denied the browser prompt, or already
// dismissed this app's own offer once. Never re-nag after either.
export function shouldOfferPush(): boolean {
  if (!pushSupported()) return false;
  if (Notification.permission !== 'default') return false;
  try {
    if (localStorage.getItem(DISMISSED_KEY) === '1') return false;
  } catch {
    // Storage blocked -- fail toward not nagging rather than always nagging.
    return false;
  }
  return true;
}

export function dismissPushOffer(): void {
  try { localStorage.setItem(DISMISSED_KEY, '1'); } catch {}
}

export interface PushConfig {
  API_URL: string;
  authH: () => Record<string, string>;
  addSecret: (url: string) => string;
}

async function postSubscription(deviceId: string, sub: PushSubscription, config: PushConfig): Promise<void> {
  await fetch(config.addSecret(config.API_URL + '/push/subscribe'), {
    method: 'POST',
    headers: config.authH(),
    body: JSON.stringify({ deviceId, subscription: sub.toJSON() }),
    keepalive: true,
  }).catch(() => {});
}

// Requires a real user gesture to have triggered this call -- the browser
// permission prompt is blocked/auto-dismissed otherwise on many platforms.
// Returns true only once permission is granted AND the subscription has
// been handed to the backend.
export async function enablePush(deviceId: string, config: PushConfig): Promise<boolean> {
  if (!pushSupported()) return false;
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return false;
    const keyRes = await fetch(config.addSecret(config.API_URL + '/push/vapid-public-key'), { headers: config.authH() });
    if (!keyRes.ok) return false;
    const { publicKey } = await keyRes.json();
    if (!publicKey) return false;
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        // Cast needed -- lib.dom.d.ts's PushSubscriptionOptionsInit wants a
        // BufferSource whose backing buffer is exactly ArrayBuffer, while
        // Uint8Array's own generic type is ArrayBufferLike (which also
        // covers SharedArrayBuffer) -- a real TS strictness mismatch, not a
        // runtime concern (this array is always freshly allocated here).
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });
    }
    await postSubscription(deviceId, sub, config);
    return true;
  } catch {
    return false;
  }
}

// Fire-and-forget, called on every boot. Permission can already be
// 'granted' from a prior visit while the backend's own copy of the
// subscription has gone missing or stale (a fresh push_subscriptions row
// was dropped, a redeploy, etc.) -- silently re-post the browser's current
// subscription so it stays live without asking the visitor for anything
// again. A no-op whenever permission isn't already granted.
export function resyncPushIfGranted(deviceId: string, config: PushConfig): void {
  if (!pushSupported() || Notification.permission !== 'granted') return;
  (async () => {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (!sub) return;
      await postSubscription(deviceId, sub, config);
    } catch {
      // Offline, SW not controlling yet, etc. -- next boot tries again.
    }
  })();
}
