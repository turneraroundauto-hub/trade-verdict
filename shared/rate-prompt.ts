// Google Play rating prompt (Free, Starter, Pro -- Play app only).
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
// localStorage/sessionStorage; nothing is sent anywhere.
//
// Each tier's index.html carries the #rate-prompt markup; each tier's app.ts
// calls notePlayAppLaunch() at load, initRatePrompt() once, and
// onAnalysisSucceeded() after every successful /analyze.

import { isTutorialActive } from './rolodex';

export const PLAY_PACKAGE = 'app.tradetribunal.twa';
export const PLAY_LISTING_URL = 'https://play.google.com/store/apps/details?id=' + PLAY_PACKAGE;
// An Android intent URL opens the Play Store app directly from inside the
// TWA, and Chrome falls back to the web listing if the store app is missing.
const PLAY_INTENT_URL = 'intent://details?id=' + PLAY_PACKAGE +
  '#Intent;scheme=market;package=com.android.vending;S.browser_fallback_url=' +
  encodeURIComponent(PLAY_LISTING_URL) + ';end';

export const RATE_MIN_ANALYSES = 3;
export const RATE_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;
// Wait this long after the LAST successful analysis before showing, so an
// Analyze All batch (up to 15 at once on Pro) finishes first instead of the
// prompt popping up mid-batch.
const RATE_SHOW_DELAY_MS = 2000;

const COUNT_KEY = 'tv_rate_analyses';
const STATE_KEY = 'tv_rate_state';       // 'rated' | 'never'
const SNOOZE_KEY = 'tv_rate_snooze_until';
const TWA_SESSION_KEY = 'tv_twa_session';
const PLATFORM_KEY = 'tv_device_platform'; // written by shared/device-id.ts

// Overlays the prompt must never stack on top of. Any that's visible makes
// the prompt skip this time and retry after the next analysis.
const BLOCKING_OVERLAY_IDS = ['signin-nudge', 'comeback-screen', 'settings-modal'];

function lsGet(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k: string, v: string): void { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } }

// Chrome sets document.referrer to android-app://<package> only on the
// navigation that launches the TWA -- which is always the Free page at the
// root. A signed-in paid user is then redirected to /starter/ or /pro/ in
// the same tab, losing that referrer. So Free calls this at the very top,
// before its redirect, and the flag rides along in sessionStorage (same
// origin, same tab) for the rest of this app session.
export function notePlayAppLaunch(): void {
  try {
    if (document.referrer.indexOf('android-app://') === 0) sessionStorage.setItem(TWA_SESSION_KEY, '1');
  } catch { /* storage blocked */ }
}

// `?ratepreview` forces it on, so the prompt can be checked in a normal
// browser. The device-level platform flag covers a device whose very first
// visit ever was inside the app.
export function isPlayApp(): boolean {
  notePlayAppLaunch();
  try {
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

function isVisible(el: HTMLElement | null): boolean {
  return !!el && getComputedStyle(el).display !== 'none';
}

export function isRatePromptOpen(): boolean {
  return isVisible(document.getElementById('rate-prompt'));
}

function showRatePromptIfAllowed(): void {
  if (!shouldShowRatePrompt()) return;
  const busy = BLOCKING_OVERLAY_IDS.some(function (id) { return isVisible(document.getElementById(id)); })
    || !!document.querySelector('.spotlight-ring')
    || isTutorialActive();
  if (busy) return;
  const el = document.getElementById('rate-prompt');
  if (el) el.style.display = 'flex';
}

let showTimer: ReturnType<typeof setTimeout> | null = null;

// Call once per successful analysis. Debounced, so a batch shows the prompt
// once, after the last result lands.
export function onAnalysisSucceeded(): void {
  lsSet(COUNT_KEY, String(Number(lsGet(COUNT_KEY) || 0) + 1));
  if (!shouldShowRatePrompt()) return;
  if (showTimer) clearTimeout(showTimer);
  showTimer = setTimeout(function () { showTimer = null; showRatePromptIfAllowed(); }, RATE_SHOW_DELAY_MS);
}

function closeRatePrompt(action: 'rate' | 'later' | 'never'): void {
  const el = document.getElementById('rate-prompt');
  if (el) el.style.display = 'none';
  if (action === 'rate') {
    lsSet(STATE_KEY, 'rated');
    try { window.location.href = PLAY_INTENT_URL; }
    catch { window.open(PLAY_LISTING_URL, '_blank'); }
  } else if (action === 'never') {
    lsSet(STATE_KEY, 'never');
  } else {
    lsSet(SNOOZE_KEY, String(Date.now() + RATE_SNOOZE_MS));
  }
}

// Wire the buttons on the page's #rate-prompt markup. Safe to call once.
export function initRatePrompt(): void {
  const on = function (id: string, action: 'rate' | 'later' | 'never') {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', function () { closeRatePrompt(action); });
  };
  on('rate-prompt-rate', 'rate');
  on('rate-prompt-later', 'later');
  on('rate-prompt-backdrop', 'later');
  on('rate-prompt-never', 'never');
}
