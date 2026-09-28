// shared/session.ts — signed-in session persistence (Sep 28, 2026).
//
// Supabase access tokens expire after ~1 hour. The app used to store ONLY
// that token and treat its expiry as "signed out," so every user was bounced
// to the login screen once an hour. /auth/login now also returns Supabase's
// refresh token; this module silently trades it for a fresh access token
// before the old one lapses, so one sign-in lasts SESSION_MAX_AGE_MS (24h,
// per direct instruction: "login once per day").
//
// Bundler-only (imported by each tier's app.ts), same as shared/rolodex.ts —
// no raw-browser ?v=N consumer.

export const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const REFRESH_LEAD_SEC = 5 * 60;          // refresh when <5 min left on the access token
const KEEPALIVE_MS = 4 * 60 * 1000;

export function getStoredSession(): any { try { return JSON.parse(localStorage.getItem('tv_session') || 'null'); } catch (e) { return null; } }
export function storeSession(s: any): void { if (s) localStorage.setItem('tv_session', JSON.stringify(s)); else localStorage.removeItem('tv_session'); }

// Call on a fresh /auth/login response before storing it.
export function stampNewSession(s: any): any { if (s) s.loginAt = Date.now(); return s; }

function accessTokenExpired(s: any, leadSec: number): boolean { return !!(s && s.expiresAt && Date.now() / 1000 > s.expiresAt - leadSec); }

// "Is the user signed in?" A session carrying a refresh token stays signed in
// for 24h from sign-in even if its access token has lapsed (refreshSession()
// renews it). A legacy session (stored before this change, no refresh token)
// keeps the old rule: valid only until its access token expires.
export function isSessionValid(s: any): boolean {
  if (!s || !s.token) return false;
  if (s.refreshToken && s.loginAt) return Date.now() - s.loginAt < SESSION_MAX_AGE_MS;
  return !accessTokenExpired(s, 60);
}

var inFlight: Promise<any> | null = null;

// Returns the (possibly refreshed) stored session, or null when the user is
// no longer signed in. A network failure while the access token is still
// usable keeps the current session rather than signing anyone out.
export function ensureFreshSession(apiUrl: string): Promise<any> {
  var s = getStoredSession();
  if (!isSessionValid(s)) return Promise.resolve(null);
  if (!accessTokenExpired(s, REFRESH_LEAD_SEC) || !s.refreshToken) return Promise.resolve(s);
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      var r = await fetch(apiUrl + '/auth/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: s.refreshToken }) });
      if (r.ok) {
        var fresh = await r.json();
        if (fresh && fresh.token) {
          var cur = getStoredSession() || s;
          cur.token = fresh.token;
          cur.refreshToken = fresh.refreshToken || cur.refreshToken;
          cur.expiresAt = fresh.expiresAt;
          storeSession(cur);
          return cur;
        }
      }
      // Refresh token rejected (revoked/rotated) — genuinely signed out.
      if (r.status === 401) { storeSession(null); return null; }
    } catch (e) { }
    // Transient failure: keep the session if its token still works.
    return accessTokenExpired(s, 0) ? null : s;
  })();
  inFlight.finally(() => { inFlight = null; });
  return inFlight;
}

// Keeps a long-open page's token fresh: periodic check plus a check whenever
// the app comes back to the foreground (a phone waking from sleep).
export function startSessionKeepAlive(apiUrl: string, onChange: (s: any) => void): void {
  var tick = function () { ensureFreshSession(apiUrl).then(onChange); };
  setInterval(tick, KEEPALIVE_MS);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') tick(); });
}
