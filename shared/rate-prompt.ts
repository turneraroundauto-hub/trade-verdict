// Google Play rating prompt (Free tier, Play app only).
//
// Deliberately NOT a star picker and NOT gated: Play's ratings policy bans
// sending only happy users to the store ("review gating"), and its in-app
// review guidelines say not to ask "do you like the app?" first. So this
// asks every eligible user the same neutral question, and "Rate" always
// opens the Play listing, whatever the user thinks of the app.
//
// Shown only inside the installed Android app (TWA) -- a web visitor can't
// leave a Play review for an app they never installed -- and only after the
// user's 3rd successful analysis. "Later" snoozes it 7 days; "Rate" and
// "Don't ask again" stop it for good. Every bit of state is per-device
// localStorage; nothing is sent anywhere.

export const PLAY_PACKAGE = 'app.tradetribunal.twa';
export const PLAY_LISTING_URL = 'https://play.google.com/store/apps/details?id=' + PLAY_PACKAGE;
// An Android intent URL opens the Play Store app directly from inside the
// TWA, and Chrome falls back to the web listing if the store app is missing.
const PLAY_INTENT_URL = 'intent://details?id=' + PLAY_PACKAGE +
  '#Intent;scheme=market;package=com.android.vending;S.browser_fallback_url=' +
  encodeURIComponent(PLAY_LISTING_URL) + ';end';

export const RATE_MIN_ANALYSES = 3;
export const RATE_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

const COUNT_KEY = 'tv_rate_analyses';
const STATE_KEY = 'tv_rate_state';       // 'rated' | 'never'
const SNOOZE_KEY = 'tv_rate_snooze_until';
const TWA_SESSION_KEY = 'tv_twa_session';
const PLATFORM_KEY = 'tv_device_platform'; // written by shared/device-id.ts

function lsGet(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k: string, v: string): void { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } }

// Chrome sets document.referrer to android-app://<package> only on the
// navigation that launches the TWA, so remember it for the rest of this
// app session (reloads included). The device-level platform flag covers a
// device whose very first visit ever was inside the app. `?ratepreview`
// forces it on, so the prompt can be checked in a normal browser.
export function isPlayApp(): boolean {
  try {
    if (document.referrer.indexOf('android-app://') === 0) sessionStorage.setItem(TWA_SESSION_KEY, '1');
    if (sessionStorage.getItem(TWA_SESSION_KEY) === '1') return true;
    if (/[?&]ratepreview\b/.test(location.search)) return true;
  } catch { /* storage blocked */ }
  return lsGet(PLATFORM_KEY) === 'twa';
}

export function shouldShowRatePrompt(now = Date.now()): boolean {
  if (!isPlayApp()) return false;
  const state = lsGet(STATE_KEY);
  if (state === 'rated' || state === 'never') return false;
  if (Number(lsGet(COUNT_KEY) || 0) < RATE_MIN_ANALYSES) return false;
  const snooze = Number(lsGet(SNOOZE_KEY) || 0);
  return !(snooze && now < snooze);
}

// Call once per successful analysis. Returns true when the prompt should
// show now.
export function recordAnalysisForRating(): boolean {
  lsSet(COUNT_KEY, String(Number(lsGet(COUNT_KEY) || 0) + 1));
  return shouldShowRatePrompt();
}

export function openPlayListing(): void {
  lsSet(STATE_KEY, 'rated');
  try { window.location.href = PLAY_INTENT_URL; }
  catch { window.open(PLAY_LISTING_URL, '_blank'); }
}

export function snoozeRatePrompt(now = Date.now()): void { lsSet(SNOOZE_KEY, String(now + RATE_SNOOZE_MS)); }
export function neverAskRatePrompt(): void { lsSet(STATE_KEY, 'never'); }
