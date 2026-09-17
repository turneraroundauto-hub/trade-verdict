// Anonymous per-device visit counting -- deliberately NOT a fingerprint and
// NOT anything requested from the user. The whole point (per direct
// instruction) was "how many different phones access the app" without
// phishing or asking for information, so this stores nothing personal:
//
//   - deviceId: a random crypto.randomUUID() generated once client-side and
//     kept in localStorage. It identifies a browser storage slot, not a
//     person -- clearing site data or reinstalling the app produces a new
//     one, same as any first-party analytics cookie.
//   - platform: 'web' | 'twa', decided from `document.referrer` -- Chrome
//     itself sets this to `android-app://<package>` on the one navigation
//     that launches a page inside an installed Trusted Web Activity. That's
//     a passive signal the browser already exposes for any page to read;
//     nothing here fingerprints, polls permissions, or prompts for anything.
//
// No IP, no user-agent, no email is sent to /device-ping -- see Tra's
// server.js for the endpoint and CLAUDE.md for why this table stays that
// narrow on purpose.

const DEVICE_ID_KEY = 'tv_device_id';
const DEVICE_PLATFORM_KEY = 'tv_device_platform';

function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // Fallback for a browser old enough to lack crypto.randomUUID -- still
  // random, still non-identifying, just not RFC4122-shaped.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function getOrCreateDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = randomId();
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    // Private-browsing/storage-blocked -- a per-load id still lets this one
    // ping count, it just won't be recognized as a returning device later.
    // Silent undercount, not a crash.
    return randomId();
  }
}

export function getDevicePlatform(): 'web' | 'twa' {
  try {
    const cached = localStorage.getItem(DEVICE_PLATFORM_KEY);
    if (cached === 'web' || cached === 'twa') return cached;
    // Only the very first navigation into a TWA session carries this
    // referrer -- a reload or a later visit inside the same installed app
    // won't repeat it, so capture once and persist the device's own origin
    // story rather than re-deciding it every load.
    const platform: 'web' | 'twa' = document.referrer.indexOf('android-app://') === 0 ? 'twa' : 'web';
    localStorage.setItem(DEVICE_PLATFORM_KEY, platform);
    return platform;
  } catch {
    return 'web';
  }
}

export interface DevicePingConfig {
  API_URL: string;
  authH: () => Record<string, string>;
  addSecret: (url: string) => string;
}

// Fire-and-forget -- a failed ping (offline, ad blocker, backend hiccup)
// should never affect anything else on the page, so this never throws and
// never awaits a caller.
export function pingDeviceVisit(config: DevicePingConfig): void {
  try {
    const deviceId = getOrCreateDeviceId();
    const platform = getDevicePlatform();
    fetch(config.addSecret(config.API_URL + '/device-ping'), {
      method: 'POST',
      headers: config.authH(),
      body: JSON.stringify({ deviceId, platform }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Swallow -- see function comment.
  }
}
