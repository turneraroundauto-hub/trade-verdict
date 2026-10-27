// Proposal 7 -- Gate-Override Audit Trail (Starter + Pro), Oct 27, 2026.
//
// Tells Tra when the Aggression Dial settles on a new position, so dial
// changes can later be lined up with how calls did before and after. It is
// observational only: logging never blocks or delays the dial, and a failed
// call is silently dropped (Tra's nightly job rebuilds any missed change
// from the verdict history anyway).
//
// Only the position the dial lands on is sent; Tra works out what it moved
// from. A drag passes through every tick, so the log waits until the dial
// has been still for DIAL_LOG_SETTLE_MS and the finger is up.
//
// Bundler-only (like session.ts / rate-prompt.ts): no raw-browser consumer,
// so no ?v= cache-bust string.

export interface DialAuditConfig {
  API_URL: string;
  authH: () => Record<string, string>;
  addSecret: (url: string) => string;
  isSignedIn: () => boolean;
  isDragging: () => boolean;
}

export interface DialAuditStats { n: number; pct: number | null; stopPct: number | null }
export interface DialAudit {
  changes: Array<{ from: string | null; to: string; direction: string | null; at: string; source: string }>;
  latest: null | { from: string | null; to: string; direction: string | null; at: string; after: DialAuditStats; before: DialAuditStats };
  minGraded: number;
}

export const DIAL_LOG_SETTLE_MS = 1500;
// Last position successfully logged from this device, so a page load (or a
// tap on the position the dial is already on) never sends anything.
const LOGGED_KEY = 'tv_dial_logged';

let cfg: DialAuditConfig | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let onLogged: (() => void) | null = null;

export function initDialAudit(config: DialAuditConfig, afterLog?: () => void): void {
  cfg = config;
  onLogged = afterLog || null;
}

function readLogged(): string | null { try { return localStorage.getItem(LOGGED_KEY); } catch (e) { return null; } }

// Call on every dial position change; sends once the dial has settled.
export function noteDialPosition(pos: string): void {
  if (!cfg) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(function fire() {
    if (!cfg) return;
    if (cfg.isDragging()) { timer = setTimeout(fire, DIAL_LOG_SETTLE_MS); return; }
    timer = null;
    if (!cfg.isSignedIn() || readLogged() === pos) return;
    fetch(cfg.addSecret(cfg.API_URL + '/dial-change'), { method: 'POST', headers: cfg.authH(), body: JSON.stringify({ to: pos }) })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d) return;
        try { localStorage.setItem(LOGGED_KEY, pos); } catch (e) { }
        if (d.logged && onLogged) onLogged();
      })
      .catch(function () { });
  }, DIAL_LOG_SETTLE_MS);
}

export async function fetchDialAudit(): Promise<DialAudit | null> {
  if (!cfg || !cfg.isSignedIn()) return null;
  try {
    const r = await fetch(cfg.addSecret(cfg.API_URL + '/dial-audit'), { headers: cfg.authH() });
    return r.ok ? await r.json() : null;
  } catch (e) { return null; }
}
