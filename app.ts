// Free tier, rebuilt onto the Rolodex UI (Aug 16, 2026) -- the sticky-
// docking Gate card, ticker pill strip with marquee, and single-active-
// card stage from preview/rolodex/ and starter/app.ts, wired to Free's
// real, already-correct backend integration: anonymous APP_SECRET auth
// (with an optional signed-in-but-free sync path), the real credit-
// consuming /analyze call, the real weekly-reset "out of credits" splash,
// and the redirectingToPaidTier guard that stops a paid session's real
// watchlist from getting silently clobbered to Free's 3-ticker cap.
// Nothing about the real data/auth/credit pipeline changed in this
// rebuild -- only the watchlist's visual representation did.
//
// Written as real TypeScript from the start (Phase 3 of the TypeScript
// adoption plan) and bundled via esbuild -- see esbuild.config.mjs's
// { in: 'app.ts', out: 'app' } entry. Imports shared/rolodex.ts (the
// Gate dock/marquee/stacked-card/swipe mechanics extracted during the
// Starter build) rather than re-copying it -- see that file's own header
// comment for the scope boundary between "how the UI moves" (rolodex.ts)
// and "what it shows" (this file).
//
// Free-specific differences from starter/app.ts, all deliberate:
// - No auth SCREEN -- Free works fully signed-out. A signed-in tv_session
//   (bounced back from a lapsed Starter/Pro/Shark subscription, or a real
//   free account) only changes the header button (SIGN OUT vs SIGN UP /
//   SIGN IN) and turns on watchlist server-sync -- it never gates access.
// - redirectingToPaidTier: a *paid* tv_session redirects away before any
//   watchlist state initializes, so Free's 3-ticker cap can never
//   silently truncate a paid account's real watchlist (shared tv_wl key).
// - forceDefaults() (shared/prefs.ts) -- Free always renders ET
//   timestamps regardless of a timezone preference set on Starter/Pro in
//   the same browser. No Settings UI, no link-site preference -- ticker/
//   news links are hardcoded to Yahoo Finance directly (Free's one and
//   only option, same as the original build), so this file doesn't
//   import tickerHref/newsHref from prefs.ts at all, and never needs to
//   re-render links on a pref change since there's nothing to change.
// - Sector Pulse is a static blurred teaser (TIER.pulse:false), ported
//   from preview/rolodex/'s own Free-scoped teaser markup -- not real
//   content, so it needs no JS rendering at all.
// - The real weekly-credit-reset "out of credits" splash
//   (#comeback-screen/startComebackTimer) is genuine, live Free-tier
//   functionality (unlike Starter, where the same markup was dead code
//   and dropped) -- carried over as a full-screen overlay, independent
//   of the Rolodex card stack underneath it.
// - Track Record has no presence on Free at all (TIER.tracker:false) --
//   no ticker-card upgrade prompt, no bottom-of-page teaser card. Pro is
//   still the only tier with a real tracker.
import { initTickerCache, fetchTickerData } from './shared/ticker-cache';
import { initWatchlist, watchlist, addTickers, addKnownTicker, removeTicker, onWatchlistSave, onTickersAdded } from './shared/watchlist';
import { cleanLS, cacheVerdict, getCachedVerdict } from './shared/analysis-cache';
import { initWatchlistSync, pullWatchlistFromServer, schedulePushWatchlist } from './shared/watchlist-sync';
import { getTzPref, getTzIana, forceDefaults } from './shared/prefs';
import { highlightContextMatches } from './shared/context-highlight';
import * as rolodex from './shared/rolodex';
import type { AnalyzeResponse, TickerData } from './shared/types.js';

// Free has no Settings UI -- always ET, regardless of a preference set on
// Starter/Pro in this same browser (shared/prefs.ts's own localStorage key).
forceDefaults();

const API_URL = 'https://tra-zacg.onrender.com';
const APP_SECRET = 'Holysmoke42!';

const TIER = {
  name: 'Free',
  maxTickers: 3,
  pulse: false,
  tracker: false,
  alpaca: false,
  credits: '3 credits/week',
  cache: '15 min cache',
  nextTier: 'Starter',
  nextPrice: '$9.99/mo',
  stripeLink: 'https://buy.stripe.com/eVq3cw84pczR6lp0oV3VC03',
  creditsLink: 'https://buy.stripe.com/3cI3cwacxarJ8txb3z3VC00',
  badgeColor: '#8da4b0',
};

let market: any = null;

function isMarketClosed(): boolean {
  var now = new Date();
  var et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  var day = et.getDay();
  if (day === 0 || day === 6) return true;
  var mins = et.getHours() * 60 + et.getMinutes();
  return mins < 570 || mins >= 960;
}

function sigColor(s: string): string { return ({ GREEN: 'var(--green)', RED: 'var(--red)', YELLOW: 'var(--amber)', 'N/A': 'var(--ink-dim)' } as Record<string, string>)[s] || 'var(--ink-dim)'; }
function dirClass(d: string): string { return d === 'green' ? 'up' : d === 'red' ? 'down' : d === 'flat' ? 'flat' : 'neutral'; }

// Free hardcodes Yahoo Finance for every ticker/news link -- no Settings
// UI, no link-site preference, matching this tier's original build and
// preview/rolodex/'s own Free-scoped design. Still satisfies the
// mandatory "every ticker symbol is a hyperlink" rule (Aug 16, 2026) --
// see the same rule's BTC-USD override, applied below via GATE_LINK_OVERRIDE.
function tickerHref(sym: string): string { return 'https://finance.yahoo.com/quote/' + encodeURIComponent(sym); }
function newsHref(sym: string): string { return 'https://finance.yahoo.com/quote/' + encodeURIComponent(sym) + '/news/'; }

// ── Anonymous / optional-signed-in session ─────────────────────────────
function getStoredSession(): any { try { return JSON.parse(localStorage.getItem('tv_session') || 'null'); } catch (e) { return null; } }
function isSessionValid(s: any): boolean { if (!s || !s.token) return false; if (s.expiresAt && Date.now() / 1000 > s.expiresAt - 60) return false; return true; }
var sbSession: any = isSessionValid(getStoredSession()) ? getStoredSession() : null;

// Logged-in visitors are keyed per-account server-side via their Supabase
// token. Anonymous visitors fall back to the shared APP_SECRET, which the
// server keys per-IP (see server.js auth middleware) -- never per-secret,
// since every anonymous visitor ships the same secret.
function authH(): Record<string, string> { return sbSession && sbSession.token ? { 'Content-Type': 'application/json', 'x-supabase-token': sbSession.token } : { 'Content-Type': 'application/json', 'x-app-secret': APP_SECRET }; }
function addSecret(url: string): string { var sep = url.includes('?') ? '&' : '?'; if (sbSession && sbSession.token) return url + sep + 'supabase_token=' + encodeURIComponent(sbSession.token); return url + sep + 'secret=' + encodeURIComponent(APP_SECRET); }

function updateAuthButton(): void {
  var btn = document.getElementById('auth-action-btn') as HTMLAnchorElement | null;
  if (!btn) return;
  if (isSessionValid(getStoredSession())) {
    btn.textContent = 'SIGN OUT';
    btn.href = 'javascript:void(0)';
    btn.classList.add('signed-in');
    btn.onclick = function (e) { e.preventDefault(); localStorage.removeItem('tv_session'); updateAuthButton(); };
  } else {
    btn.innerHTML = '&#128274; SIGN UP / SIGN IN';
    btn.href = 'https://tradetribunal.app/starter/';
    btn.classList.remove('signed-in');
    btn.onclick = null;
  }
}
updateAuthButton();

// A *paid* tv_session redirects away before any watchlist state
// initializes -- tv_wl is the SAME localStorage key every tier reads
// from, so Free's maxTickers:3 cap silently truncating it in the window
// before navigation completes (window.location.href doesn't halt script
// execution) could otherwise leave a paid tier's real watchlist clobbered
// to 3 tickers on the very next load. Guard everything below that touches
// watchlist state behind this flag.
var redirectingToPaidTier = false;
try {
  var storedForRedirect = getStoredSession();
  if (storedForRedirect && storedForRedirect.tier && storedForRedirect.tier !== 'free' && storedForRedirect.redirectUrl) {
    if (isSessionValid(storedForRedirect)) {
      redirectingToPaidTier = true;
      window.location.href = storedForRedirect.redirectUrl;
    } else {
      // A LAPSED paid session's own tier/redirectUrl fields are stale --
      // don't bounce Free away on data that's no longer true. This is
      // also what makes a lapsed tier's own "Back to Free tier" login
      // link actually work: without this check, an expired Starter/Pro
      // session sent the user right back to the very tier that just
      // rejected them (its own checkAuth() finds the same expired token
      // invalid and shows the login screen again) -- a redirect loop
      // that looked like "clicking Back to Free tier keeps kicking me
      // back to login." Clearing the stale session here also means Free
      // insists on being Free going forward, not just this one load.
      localStorage.removeItem('tv_session');
    }
  }
} catch (e) { }

// ── CREDIT DISPLAY ────────────────────────────────────────────────────
// Purchasing credits requires attributing the Stripe payment to an
// account (server.js keys the purchase webhook off email), so the buy
// link only makes sense for logged-in visitors. Anonymous visitors see
// their remaining weekly count as a link to sign in instead.
async function fetchCreditStatus(): Promise<void> {
  try {
    var res = await fetch(addSecret(API_URL + '/status'), { headers: authH() });
    var data = await res.json();
    var el = document.getElementById('credits-btn') as HTMLAnchorElement | null;
    if (!el || data.totalCredits === undefined) return;
    var loggedIn = !!(sbSession && sbSession.token);
    var label = (data.totalCredits > 0 ? data.totalCredits : '+') + ' CREDITS';
    if (loggedIn) {
      el.textContent = label;
      el.href = TIER.creditsLink;
      el.target = '_blank';
    } else {
      el.textContent = label + ' · WK';
      el.href = 'https://tradetribunal.app/starter/';
      el.removeAttribute('target');
    }
  } catch (e) { }
}

// ── GATE 0 (market) — real fetch, Rolodex sticky-dock/marquee rendering ──
const GATE_FIELDS: [string, string][] = [
  ['spy', 'SPY'], ['qqq', 'QQQ'], ['btc', 'BTC'], ['soxx', 'SOXX'], ['xbi', 'XBI'],
  ['iwm', 'IWM'], ['gld', 'GLD'], ['uso', 'USO'], ['tsm', 'TSM'], ['msft', 'MSFT'],
];
const GATE_LINK_OVERRIDE: Record<string, string> = { BTC: 'BTC-USD' };
function gateLinkSymbol(label: string): string { return GATE_LINK_OVERRIDE[label] || label; }

const gateMarquee = document.getElementById('gateMarquee') as HTMLElement;

async function fetchMarket(): Promise<void> {
  try {
    var res = await fetch(addSecret(API_URL + '/market'), { headers: authH() });
    market = await res.json();
  } catch (e) { market = null; }
  renderGate();
  refreshGateMarquee();
  requestAnimationFrame(rolodex.sizeGateSpacer);
}

function renderGate(): void {
  const status = (market && market.gateStatus) || 'GREEN';
  const color = sigColor(status);
  document.getElementById('gateMiniDot')!.style.background = color;
  document.getElementById('gateFullDot')!.style.background = color;
  // The dot alone carries Gate 0's GREEN/YELLOW/RED market-direction read
  // (set above, unchanged) -- the text label next to it is a literal
  // market open/closed indicator instead, independent of that direction,
  // so a RED-dot session during regular hours still correctly reads
  // "MARKET OPEN" rather than implying the market itself is closed.
  const closed = isMarketClosed();
  const marketLabel = closed ? 'CLOSED' : 'OPEN';
  const marketColor = closed ? 'var(--red)' : 'var(--green)';
  document.getElementById('gateMiniLabel')!.textContent = marketLabel;
  (document.getElementById('gateMiniLabel') as HTMLElement).style.color = marketColor;
  document.getElementById('gateFullLabel')!.textContent = marketLabel;
  (document.getElementById('gateFullLabel') as HTMLElement).style.color = marketColor;
  document.getElementById('gateNote')!.innerHTML = autoLinkGlossaryTerms((market && market.gateNote) || (market ? '' : 'Tap to retry — data unavailable.'));

  const grid = document.getElementById('gateGrid') as HTMLElement;
  grid.innerHTML = GATE_FIELDS.map(([key, label]) => {
    const d = market && market[key];
    const val = (!d || d.change === '?') ? '?' : d.change;
    const cls = (!d || d.change === '?') ? 'neutral' : dirClass(d.direction);
    const sym = gateLinkSymbol(label);
    return `<div class="gate-stat"><div class="k"><a href="${tickerHref(sym)}" target="_blank">${label}</a></div><div class="v ${cls}">${val}</div></div>`;
  }).join('');
  renderMarketTs();
}

function renderMarketTs(): void {
  var tsEl = document.getElementById('marketTs');
  if (!tsEl) return;
  if (!market || !market.timestamp) { tsEl.textContent = ''; return; }
  var t = new Date(market.timestamp).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: getTzIana() });
  tsEl.textContent = (market.cached ? '⚡ Cached' : '🔴 Live') + ' · Updated ' + t + ' ' + getTzPref();
}

function refreshGateMarquee(): void {
  const itemsHTML = GATE_FIELDS.map(([key, label]) => {
    const d = market && market[key];
    const val = (!d || d.change === '?') ? '?' : d.change;
    const cls = (!d || d.change === '?') ? 'neutral' : dirClass(d.direction);
    const sym = gateLinkSymbol(label);
    return `<span class="gm-item"><a class="sym" href="${tickerHref(sym)}" target="_blank" onclick="event.stopPropagation()">${label}</a><span class="val ${cls}">${val}</span></span>`;
  }).join('');
  rolodex.buildGateMarquee(itemsHTML);
}

// ── Utility card accordion (Pulse/Context/Import/Glossary) ────────────
// expandCard() is also the entry point jumpToGlossaryTerm()/jumpToAbout()
// (below, near the Glossary functions) call to ensure the Glossary card
// is open+snapped -- buildGlossary() is a plain function declaration
// (hoisted), so referencing it here ahead of its own definition further
// down the file is safe.
function expandCard(card: HTMLElement): void {
  card.classList.add('expanded');
  const head = card.querySelector('.card-head'); if (head) head.setAttribute('aria-expanded', 'true');
  // Synchronous, not fetched -- build BEFORE snapping so the forced-
  // height scroll-target computation (inside snapCardUnderDock) measures
  // the real, capped content height instead of the still-empty panel.
  if (card.dataset.card === 'glossary') buildGlossary();
  rolodex.snapCardUnderDock(card);
}
function wireAccordionHead(head: Element): void {
  function toggle(): void {
    const card = head.closest('.card') as HTMLElement;
    const wasExpanded = card.classList.contains('expanded');
    if (wasExpanded) {
      card.classList.remove('expanded');
      head.setAttribute('aria-expanded', 'false');
    } else {
      expandCard(card);
    }
  }
  head.addEventListener('click', toggle);
  head.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') { e.preventDefault(); toggle(); } });
}
document.querySelectorAll('.card[data-card] > .card-head').forEach(wireAccordionHead);

// ── Rolodex: real ticker data, real /analyze ─────────────────────────
const roloStage = document.getElementById('roloStage') as HTMLElement;
const roloIndex = document.getElementById('roloIndex') as HTMLElement;

interface TickerState { td: TickerData | null; result: AnalyzeResponse | null; analyzing: boolean; error: string | null; }
const tickerState = new Map<string, TickerState>();

const TYPE_COLOR: Record<string, string> = { CANARY: 'var(--amber)', SENTIMENT: 'var(--blue)', FLOW: 'var(--green)' };
const SIZING_LABEL: Record<string, string> = { FULL: 'Full', HALF: 'Half', QUARTER: '¼ size' };
const SIZING_COLOR: Record<string, string> = { FULL: 'var(--green)', HALF: 'var(--amber)', QUARTER: 'var(--amber)' };

function badgesHTML(result: AnalyzeResponse | null): string {
  if (!result) return '';
  let html = '';
  if (result.type) {
    const c = TYPE_COLOR[result.type] || 'var(--ink-dim)';
    html += `<span class="badge" style="color:${c};border-color:${c}55;background:${c}11">${result.type}</span>`;
  }
  if (result.sizing) {
    if (result.sizing !== 'NONE') {
      const label = SIZING_LABEL[result.sizing] || result.sizing;
      const c = SIZING_COLOR[result.sizing] || 'var(--ink-dim)';
      html += `<span class="badge" style="color:${c};border-color:${c}55;background:${c}11">${label}</span>`;
    } else {
      html += '<span class="badge" style="color:var(--blue);border-color:rgba(74,168,255,.4);background:rgba(74,168,255,.08)">Defined risk</span>';
    }
  }
  return html ? `<div class="card-badges">${html}</div>` : '';
}

// Shared HIGH/MEDIUM/LOW -> color mapping — single source of truth for
// both the CONFIDENCE row and the "LOOK FOR" strip's dot.
function confColor(conf?: string): string {
  return conf === 'HIGH' ? 'var(--green)' : conf === 'MEDIUM' ? 'var(--amber)' : 'var(--red)';
}

function pregateStripHTML(result: AnalyzeResponse | null): string {
  if (!result || !result.gates) return '';
  const waitText = (result.wait_for && result.wait_for !== 'null') ? result.wait_for : '';
  if (!waitText) return '';
  return `<div class="pregate-strip"><div class="pregate-dot" style="background:${confColor(result.confidence)}"></div>`
    + `<div class="pregate-note"><span class="wait-lbl">LOOK FOR: </span>${autoLinkGlossaryTerms(waitText)}</div>`
    + '</div>';
}

// historicalReaction (Sep 2, 2026) -- mirror of pro/app.ts's own comment.
// Pooled, cross-user directional accuracy for this ticker, replacing the
// removed /scorecard "BY TICKER" breakdown -- Free never had a Scorecard
// card at all, so this is the first time any ticker-level track-record
// signal reaches this tier.
function gateListHTML(result: AnalyzeResponse | null, historicalReaction?: { directionalPct: number; gradedCount: number } | null): string {
  if (!result || !result.gates) {
    return '<div class="gate-list"><div class="gate-clear"><span class="gate-dot" style="background:var(--ink-faint)"></span><span>Tap ANALYZE to run the gates</span></div></div>';
  }
  const g: any = result.gates;
  const rows = ([
    ['PRE-GATE', g.pre_gate], ['G1  14D', g.g1_prewindow], ['G2  CATALYST', g.g2_catalyst],
    ['G3  OPEN BAR', g.g3_openbar], ['G4  PHASE', g.g4_phase], ['G5  PROXY', g.g5_korea],
  ] as [string, any][]).map(([label, gate]) => {
    gate = gate || {};
    if (gate === g.pre_gate && gate.status === 'GREEN') {
      return '<div class="gate-clear"><span class="gate-dot" style="background:var(--green)"></span><span>PRE-GATE clear</span></div>';
    }
    return `<div class="gate-row"><span class="gate-dot" style="background:${sigColor(gate.status)}"></span>`
      + `<div class="gn"><span class="gl">${label}</span>${gate.note ? ' - ' + autoLinkGlossaryTerms(gate.note) : ''}</div></div>`;
  }).join('');
  const conf = `<div class="conf-row"><span class="conf-lbl">CONFIDENCE</span><span class="conf-val" style="color:${confColor(result.confidence)}">${result.confidence || ''}</span></div>`;
  const track = historicalReaction
    ? `<div class="conf-row"><span class="conf-lbl">TRACK RECORD</span><span class="conf-val">${historicalReaction.directionalPct}% <span style="color:var(--ink-dim);font-weight:normal">(${historicalReaction.gradedCount} graded)</span></span></div>`
    : '';
  return '<div class="gate-list">' + rows + conf + track + '</div>';
}

function verdictAreaHTML(sym: string, result: AnalyzeResponse): string {
  const closed = isMarketClosed();
  const v = (result.verdict || 'FLAT').toUpperCase();
  if (closed) {
    return `<div class="verdict-container" data-reset="${sym}"><span class="verdict-hold">HOLD</span><span class="verdict-lbl-hold">MKT CLOSED</span></div>`;
  }
  if (v === 'UP') return `<div class="verdict-container" data-reset="${sym}"><span class="verdict-up">👍</span><span class="verdict-lbl-up">UP</span></div>`;
  if (v === 'DOWN') return `<div class="verdict-container" data-reset="${sym}"><span class="verdict-down">👎</span><span class="verdict-lbl-down">DOWN</span></div>`;
  return `<div class="verdict-container" data-reset="${sym}"><span class="verdict-hold">HOLD</span><span class="verdict-lbl-hold">WAIT &amp; WATCH</span></div>`;
}

function priceDirClass(td: TickerData | null): string {
  const pct = td && td.metrics && typeof td.metrics.pct === 'number' ? td.metrics.pct : 0;
  return pct > 0.05 ? 'up' : pct < -0.05 ? 'down' : 'flat';
}

function roloCardHTML(sym: string, state: TickerState): string {
  const td = state.td;
  const price = td && td.metrics && td.metrics.price != null ? '$' + td.metrics.price.toFixed(2) : '—';
  const news: any = td && td.news;
  const rawHeadline = news ? news.headline : 'No news within the last business week';
  const ctxEl = document.getElementById('context-input') as HTMLTextAreaElement | null;
  const headline = autoLinkGlossaryTerms(news ? highlightContextMatches(rawHeadline, ctxEl ? ctxEl.value : '') : rawHeadline);
  const age = news ? news.ageLabel : '—';
  const m: any = td && td.metrics;
  const w52 = m && m.rangePosition != null ? m.rangePosition + '%' : '?';
  const phase = m && m.phaseProxy ? m.phaseProxy.replace('PHASE_', '') : '?';
  const beta = m && m.beta ? m.beta.toFixed(1) : '?';
  const proxyName = td && td.proxyRule && td.proxyRule.proxy ? td.proxyRule.proxy.name.split('(')[0].trim() : '?';
  const proxySymbols: string[] = td && td.proxyRule && td.proxyRule.proxy && Array.isArray(td.proxyRule.proxy.symbols) ? td.proxyRule.proxy.symbols : [];
  const proxyHTML = proxySymbols.length === 1
    ? `<a href="${tickerHref(proxySymbols[0])}" target="_blank">${proxyName}</a>`
    : proxyName;
  const analyzing = state.analyzing;
  const result = state.result;
  const dir = priceDirClass(td);
  return `<div class="ticker-row">`
    + `<div class="ticker-left"><span class="ticker-sym ${dir}"><a href="${tickerHref(sym)}" target="_blank">${sym}</a></span><span class="ticker-price ${dir}">${price}</span>`
    + '<div class="ticker-swipe-hint">← Swipe to delete</div></div>'
    + '<div class="ticker-action">'
    + (result ? verdictAreaHTML(sym, result)
      : `<button class="btn btn-blue btn-compact${analyzing ? ' btn-running' : ''}" data-analyze="${sym}" ${analyzing ? 'disabled' : ''}>${analyzing ? 'RUNNING…' : 'ANALYZE'}</button>`)
    + '</div>'
    + `</div>`
    + pregateStripHTML(result)
    + `<div class="headline">${wrapHeadlineLinks(sym, headline)} <span class="age">${age}</span></div>`
    + `<div class="meta-row"><span>52W <b>${w52}</b></span><span>PHASE <b>${phase}</b></span><span>β <b>${beta}</b></span><span>PROXY <b style="color:var(--blue)">${proxyHTML}</b></span></div>`
    + badgesHTML(result)
    + gateListHTML(result, td && td.historicalReaction)
    + (state.error ? `<div class="gate-note" style="color:var(--red);margin-top:6px">${state.error}</div>` : '');
}

function renderRoloCard(sym: string): void {
  const card = roloStage.querySelector(`.rolo-card[data-sym="${sym}"]`) as HTMLElement | null;
  if (!card) return;
  const state = tickerState.get(sym);
  if (!state) return;
  card.innerHTML = roloCardHTML(sym, state);
  card.classList.remove('verdict-up', 'verdict-down');
  const btn = card.querySelector('[data-analyze]');
  if (btn) btn.addEventListener('click', () => analyzeOne(sym));
  const resetEl = card.querySelector('[data-reset]');
  if (resetEl) resetEl.addEventListener('click', () => resetTicker(sym));
  if (state.result && !isMarketClosed()) {
    const v = (state.result.verdict || '').toUpperCase();
    if (v === 'UP') card.classList.add('verdict-up');
    else if (v === 'DOWN') card.classList.add('verdict-down');
  }
  rolodex.syncRoloStageHeight();
}

function resetTicker(sym: string): void {
  const state = tickerState.get(sym);
  if (!state) return;
  state.result = null; state.error = null;
  renderRoloCard(sym);
  renderPill(sym);
}

function renderPill(sym: string): void {
  document.querySelectorAll<HTMLElement>(`.rolo-chip[data-sym="${sym}"]`).forEach((chip) => {
    const state = tickerState.get(sym);
    const td = state && state.td;
    const price = td && td.metrics && td.metrics.price != null ? '$' + td.metrics.price.toFixed(2) : '—';
    const perf = 'perf-' + priceDirClass(td || null);
    chip.className = 'rolo-chip ' + perf + (chip.dataset.idx === String(rolodex.getRoloCurrent()) ? ' active' : '');
    chip.innerHTML = `<span class="rc-sym">${sym}</span><span class="rc-price">${price}</span>`;
  });
}

function deleteActiveTicker(sym: string): void {
  tickerState.delete(sym);
  removeTicker(sym); // shared/watchlist.ts: persists, syncs, shows its own undo toast
}

// A permanent, non-ticker "Starter?" upsell pill that repeats alongside
// the real ticker pills in the marquee -- never part of `watchlist`, never
// routed through goRolo()/analyzeOne(), doesn't count toward the 3-ticker
// cap or the "— N —" divider count (that count is still watchlist.length,
// computed independently). Just a plain link to the Starter upgrade page.
function buildUpsellChip(): HTMLElement {
  const a = document.createElement('a');
  a.className = 'rolo-chip-upsell';
  a.href = TIER.stripeLink;
  a.target = '_blank';
  a.textContent = 'Starter?';
  return a;
}

async function renderRolodexFromWatchlist(): Promise<void> {
  document.getElementById('ticker-count')!.textContent = 'CRF · ' + watchlist.length + ' TICKERS';
  roloStage.innerHTML = '';
  watchlist.forEach((sym) => {
    if (!tickerState.has(sym)) tickerState.set(sym, { td: null, result: null, analyzing: false, error: null });
    const card = document.createElement('div');
    card.className = 'rolo-card'; card.dataset.sym = sym;
    roloStage.appendChild(card);
    renderRoloCard(sym);
  });

  rolodex.rebuildRoloIndex(watchlist, (sym, i) => {
    const chip = document.createElement('button');
    chip.className = 'rolo-chip'; chip.dataset.sym = sym; chip.dataset.idx = String(i);
    return chip;
  }, `— ${watchlist.length} —`, buildUpsellChip);
  watchlist.forEach((sym) => renderPill(sym));

  rolodex.clampRoloCurrent();
  rolodex.positionRoloStack();
  requestAnimationFrame(() => { rolodex.sizeGateSpacer(); rolodex.sizeRoloMarquee(); });

  await Promise.all(watchlist.map(async (sym) => {
    const td = await fetchTickerData(sym);
    const state = tickerState.get(sym);
    if (state) { state.td = td; }
    renderRoloCard(sym);
    renderPill(sym);
    requestAnimationFrame(() => rolodex.sizeRoloMarquee());
  }));
  requestAnimationFrame(() => {
    rolodex.sizeRoloMarquee();
    rolodex.markRoloMarqueeDataReady();
  });
}

function refreshRoloCards(): void {
  watchlist.forEach((sym) => { if (tickerState.has(sym)) renderRoloCard(sym); });
}

// ── ANALYZE — real, credit-consuming /analyze call ────────────────────
async function analyzeOne(sym: string): Promise<void> {
  const state = tickerState.get(sym);
  if (!state || state.analyzing) return;
  state.analyzing = true; state.error = null;
  renderRoloCard(sym);

  const td = state.td || await fetchTickerData(sym);
  state.td = td;
  if (td) renderRoloCard(sym);

  // Session Context card retired (replaced by the Agitator Gauge) --
  // marketContext is now always empty, the same server-side state as any
  // user who simply never typed into it (Proposal 4's own corroboration
  // check already treats a blank context as informational-only, a
  // fully-supported normal case, not an error).
  var ctx = '';
  var sc: any = {
    spy: market && market.spy ? market.spy.change : '?',
    qqq: market && market.qqq ? market.qqq.change : '?',
    btc: market && market.btc ? market.btc.change : '?',
    iwm: market && market.iwm ? market.iwm.change : '?',
    soxx: market && market.soxx ? market.soxx.change : '?',
    xbi: market && market.xbi ? market.xbi.change : '?',
    ibb: market && market.ibb ? market.ibb.change : '?',
    gld: market && market.gld ? market.gld.change : '?',
    uso: market && market.uso ? market.uso.change : '?',
    tsm: market && market.tsm ? market.tsm.change : '?',
    msft: market && market.msft ? market.msft.change : '?',
    gateStatus: market ? market.gateStatus || 'GREEN' : 'GREEN',
    gateNote: market ? market.gateNote || '' : '',
    btcSignal: market ? market.btcSignal || 'neutral' : 'neutral',
  };

  try {
    var res = await fetch(addSecret(API_URL + '/analyze'), {
      method: 'POST', headers: authH(),
      body: JSON.stringify({
        ticker: sym, sectorContext: sc, marketContext: ctx,
        metricsData: td && td.metrics ? td.metrics : null,
        newsData: td && td.news ? td.news : null,
        openingBarData: td && td.openingBar ? td.openingBar : null,
        proxyRule: td && td.proxyRule ? td.proxyRule : null,
        gate1Data: td && td.gate1 ? td.gate1 : null,
        preGateData: td && td.preGate ? td.preGate : null,
        weeklyCarryoverData: td && td.weeklyCarryover ? td.weeklyCarryover : null,
        regimeData: td && td.regime ? td.regime : null,
      }),
    });
    if (!res.ok) {
      var errData = await res.json().catch(function () { return {}; });
      if (res.status === 402 && errData.code === 'NO_CREDITS') {
        handleNoCredits(sym); fetchCreditStatus();
        state.analyzing = false; renderRoloCard(sym); renderPill(sym);
        return;
      }
      throw new Error(errData.error || 'Server error ' + res.status);
    }
    var _r = await res.json();
    cacheVerdict(sym, _r);
    state.result = _r; state.analyzing = false;
    renderRoloCard(sym); renderPill(sym);
    fetchCreditStatus();
  } catch (e: any) {
    state.analyzing = false; state.error = e.message;
    renderRoloCard(sym); renderPill(sym);
  }
}

function analyzeAll(): void {
  if (watchlist.length) rolodex.goRolo(0);
  watchlist.forEach((sym) => analyzeOne(sym));
}

// ── NO CREDITS — real weekly-reset splash, live Free-tier functionality ──
function handleNoCredits(sym: string): void {
  const state = tickerState.get(sym)!;
  const cached = getCachedVerdict(sym);
  if (cached) {
    state.result = cached; state.error = null;
    renderRoloCard(sym);
    return;
  }
  showComebackScreen();
}

// Next weekly reset boundary — matches credits.js's fixed 7-day epoch
// buckets (WEEK_MS), so the countdown shown here lines up with when the
// server actually refreshes the balance.
var comebackTimer: ReturnType<typeof setInterval> | null = null;
function startComebackTimer(): void {
  if (comebackTimer) clearInterval(comebackTimer);
  comebackTimer = setInterval(function () {
    var WEEK_MS = 7 * 24 * 60 * 60 * 1000;
    var nextReset = (Math.floor(Date.now() / WEEK_MS) + 1) * WEEK_MS;
    var diff = nextReset - Date.now();
    var d = Math.floor(diff / 86400000), h = Math.floor((diff % 86400000) / 3600000), m = Math.floor((diff % 3600000) / 60000), s = Math.floor((diff % 60000) / 1000);
    var el = document.getElementById('comeback-timer');
    if (el) el.textContent = d + 'd ' + String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }, 1000);
}

// Anonymous visitors can't have a $0.99 purchase attributed to them
// (server keys purchases by account email) — point them at sign-in
// instead of a buy link that won't actually credit their balance.
function showComebackScreen(): void {
  var buyBtn = document.getElementById('comeback-buy-btn') as HTMLAnchorElement | null;
  if (buyBtn) {
    if (sbSession && sbSession.token) {
      buyBtn.textContent = '+ BUY CREDITS $0.99';
      buyBtn.href = 'https://buy.stripe.com/3cI3cwacxarJ8txb3z3VC00';
    } else {
      buyBtn.textContent = 'SIGN IN TO ADD CREDITS';
      buyBtn.href = 'https://tradetribunal.app/starter/';
      buyBtn.removeAttribute('target');
    }
  }
  var screen = document.getElementById('comeback-screen');
  if (screen) (screen as HTMLElement).style.display = 'flex';
  startComebackTimer();
}
function closeComebackScreen(): void {
  var screen = document.getElementById('comeback-screen');
  if (screen) (screen as HTMLElement).style.display = 'none';
}

// ── Agitator Gauge (Proposal 5) ─────────────────────────────────────
// Free tier's own "simple gauge" variant (server-side isFull gate is
// tracker-tied, and Free has no tracker, same as Starter) -- replaces
// the Session Context card, which this session's own direct feedback
// called out as obsolete. Ported from starter/app.ts; kept byte-
// identical where the two tiers' surrounding code allows.
function factorGaugeHTML(val: number): string {
  var pct = Math.max(0, Math.min(100, val));
  var label = val >= 66 ? 'High' : val >= 34 ? 'Medium' : 'Low';
  return '<div class="factor-gauge" role="img" aria-label="' + label + '">'
    + '<div class="factor-gauge-bar"><span class="fg-seg fg-green"></span><span class="fg-seg fg-amber"></span><span class="fg-seg fg-red"></span></div>'
    + '<div class="factor-gauge-arrow" style="left:' + pct + '%"></div>'
    + '</div>';
}
function agitatorFactorRow(label: string, helpKey: string, val: number | null): string {
  var helpBtn = '<button type="button" class="help-btn" data-help="' + helpKey + '" aria-label="What is this?">?</button>';
  var lblHTML = '<span class="trigger-lbl-wrap"><span class="trigger-lbl">' + label + '</span>' + helpBtn + '</span>';
  if (val == null) return '<div class="trigger-row">' + lblHTML + '<span class="trigger-sub">n/a</span></div>';
  return '<div class="trigger-row">' + lblHTML + factorGaugeHTML(val) + '</div>';
}
// A "+" that adds an already-resolved, real ticker (the Agitator's own
// primary result or one of its related companies -- both always carry a
// live quote by the time they're rendered) straight to the watchlist,
// skipping addTickers()'s text-parsing/lookup path entirely. Already-
// present tickers render as a disabled checkmark rather than a dead
// "+" so it's clear at a glance which ones are already on the list.
function addTickerBtnHTML(symbol: string): string {
  var already = watchlist.includes(symbol);
  return '<button type="button" class="compact-plus-btn" data-add-ticker="' + symbol + '"'
    + (already ? ' disabled title="Already on your watchlist">✓' : ' title="Add ' + symbol + ' to watchlist">+')
    + '</button>';
}
function wireAgitatorAddButtons(scope: HTMLElement): void {
  scope.querySelectorAll<HTMLButtonElement>('[data-add-ticker]').forEach(function (b) {
    b.addEventListener('click', function () {
      var sym = b.dataset.addTicker as string;
      addKnownTicker(sym);
      if (watchlist.includes(sym)) {
        b.disabled = true; b.textContent = '✓'; b.setAttribute('aria-label', 'Already on your watchlist');
      }
    });
  });
}
// A related company now renders as the exact same row Pro's own
// Watchlist-overflow list already uses (ticker/price/%chg + a real news
// headline, linked the same way, via the same wrapHeadlineLinks/
// autoLinkGlossaryTerms/highlightContextMatches chain) -- direct
// instruction: "do the recommendations exactly like they are in the
// overflow watchlist in Pro, with news links all the same," after an
// earlier from-scratch chip redesign read as confusing. No swipe-to-
// delete here (nothing to delete, only to add) -- the "+" instead calls
// addKnownTicker() via wireAgitatorAddButtons() below.
function relatedRowHTML(c: { symbol: string; price: string | null; change: string | null; direction: string; news?: { headline: string; url: string | null; ageHours: number } | null }): string {
  var t = c.symbol;
  var color = c.direction === 'green' ? 'var(--green)' : c.direction === 'red' ? 'var(--red)' : 'var(--amber)';
  var hasNews = !!(c.news && c.news.ageHours <= 300);
  var ctxEl = document.getElementById('context-input') as HTMLTextAreaElement | null;
  var ctxVal = ctxEl ? ctxEl.value : '';
  return '<div class="compact-row-wrap" data-ticker="' + t + '">'
    + '<div class="compact-row">'
    + '<div class="compact-row-main">'
    + '<div class="compact-row-top"><span class="compact-ticker" style="color:' + color + '"><a class="ticker-a" href="' + tickerHref(t) + '" target="_blank">' + t + '</a></span>'
    + '<span class="compact-price" style="color:' + color + '">' + (c.price ? '$' + c.price : '&mdash;') + '</span>'
    + '<span class="compact-pct" style="color:' + color + '">' + (c.change || '&mdash;') + '</span></div>'
    + '<div class="compact-news"' + (hasNews ? '' : ' style="display:none"') + '>' + (hasNews ? wrapHeadlineLinks(t, autoLinkGlossaryTerms(highlightContextMatches(c.news!.headline, ctxVal))) : '') + '</div>'
    + '</div>'
    + addTickerBtnHTML(t)
    + '</div></div>';
}
// Fix 5 (Notion "Proposal 5 — Amendment," Sep 1 2026): a validated Path B
// company -- real symbol/name from AI extraction re-checked through the
// same exact-match gate a typed query goes through, with a real measured
// price reaction since the article's own publish time (Alpaca), not a
// live quote/news pairing the way relatedRowHTML's Path A comps are.
function topicalCompanyRowHTML(c: { symbol: string; name: string; reactionPct: number | null }): string {
  var color = c.reactionPct == null ? 'var(--ink-dim)' : c.reactionPct > 0 ? 'var(--green)' : c.reactionPct < 0 ? 'var(--red)' : 'var(--amber)';
  var pctLabel = c.reactionPct == null ? 'no data' : (c.reactionPct > 0 ? '+' : '') + c.reactionPct.toFixed(2) + '% since publish';
  return '<div class="compact-row-wrap" data-ticker="' + c.symbol + '">'
    + '<div class="compact-row"><div class="compact-row-main">'
    + '<div class="compact-row-top"><span class="compact-ticker" style="color:' + color + '"><a class="ticker-a" href="' + tickerHref(c.symbol) + '" target="_blank">' + c.symbol + '</a></span>'
    + '<span class="compact-pct" style="color:' + color + '">' + pctLabel + '</span></div>'
    + '</div>'
    + addTickerBtnHTML(c.symbol)
    + '</div></div>';
}
async function runAgitatorCheck(): Promise<void> {
  var qEl = document.getElementById('agitator-query') as HTMLInputElement;
  var btn = document.getElementById('agitatorCheckBtn') as HTMLButtonElement;
  var out = document.getElementById('agitator-body'); if (!out) return;
  var q = qEl.value.trim();
  if (!q) { out.innerHTML = '<div class="track-empty">Type a ticker, company name, or paste a headline first.</div>'; return; }

  btn.disabled = true; btn.classList.add('btn-running'); btn.textContent = 'CHECKING…';
  out.innerHTML = '<div class="track-empty">Loading...</div>';
  try {
    // Fix 1 (Notion "Proposal 5 — Amendment," Sep 1 2026): the known-ticker
    // shortcut is a backend optimization for every tier, including
    // anonymous Free -- send the local watchlist along so the server can
    // check it without a Finnhub round trip.
    var url = API_URL + '/agitator?q=' + encodeURIComponent(q) + '&watchlist=' + encodeURIComponent(watchlist.join(','));
    var res = await fetch(addSecret(url), { headers: authH() });
    if (res.status === 403) { out.innerHTML = '<div class="track-empty">Agitator Gauge not available on this tier yet.</div>'; return; }
    if (res.status === 429) { out.innerHTML = '<div class="track-empty">Too many checks this hour — try again later.</div>'; return; }
    var data = await res.json();
    if (!data.resolved) {
      // Fix 1: a 'partial' match (e.g. "Summit" vs "Summit Therapeutics")
      // is never auto-accepted -- surfaced as a one-tap "Did you mean"
      // confirm instead. Fix 5: Path B (below) always computes and ships
      // alongside it, so there's something real to look at either way,
      // whether or not the suggestion gets tapped.
      var suggestionHTML = '';
      if (data.suggestion) {
        suggestionHTML = '<div class="track-empty" id="agitatorSuggestBanner" style="margin-bottom:8px">Did you mean <strong>' + data.suggestion.company + '</strong> (' + data.suggestion.ticker + ')? '
          + '<button type="button" class="btn-compact" id="agitatorSuggestYes" data-ticker="' + data.suggestion.ticker + '">Yes</button> '
          + '<button type="button" class="btn-compact" id="agitatorSuggestNo">Cancel</button></div>';
      }
      // Fix 5 (Sep 1 2026): every check shows a real score either way --
      // Path B computes the same-style gauge off event-level signals that
      // don't depend on a single company, not just dashes+text. "---"
      // stands in for the ticker slot; the sentiment word/dot reuse the
      // same BULLISH/BEARISH/NEUTRAL-as-color language as everywhere else
      // in this app, and the one-sentence summary links straight to the
      // real article it was distilled from -- never a bare claim.
      var topical = data.topical;
      var topicalHTML = '';
      if (topical) {
        var sentColor = topical.sentiment === 'BULLISH' ? 'var(--green)' : topical.sentiment === 'BEARISH' ? 'var(--red)' : 'var(--amber)';
        var tComp = topical.composite;
        var tGaugeColor = !tComp ? 'var(--ink-dim)' : tComp.level === 'HIGH' ? 'var(--red)' : tComp.level === 'MEDIUM' ? 'var(--amber)' : 'var(--green)';
        var tGaugeHTML = '<div class="trigger-row"><span class="trigger-lbl-wrap"><span style="width:8px;height:8px;border-radius:50%;flex:none;display:inline-block;background:' + sentColor + '"></span><span class="trigger-lbl">---</span></span>'
          + '<span class="trigger-val-wrap"><span class="trigger-val" style="color:' + tGaugeColor + '">' + (tComp ? tComp.level : 'N/A') + '</span>'
          + '<button type="button" class="help-btn" data-help="agitator-score" aria-label="What is this?">?</button></span>'
          + '<span class="trigger-sub">' + topical.sentiment + (tComp ? ' · ' + Math.round(tComp.score / 10) + '/10' : '') + '</span></div>';
        var tHeadlineHTML = '<div class="headline" style="margin-top:8px"><a href="' + topical.url + '" target="_blank">' + topical.summary + '</a></div>';
        var tf = topical.factors;
        var tFactorsHTML = tf
          ? '<div class="track-log-title" style="margin-top:10px">SIGNALS</div>'
            + agitatorFactorRow('Surprise', 'agitator-surprise', tf.surprise ?? null)
            + agitatorFactorRow('Uncertainty', 'agitator-uncertainty', tf.uncertainty ?? null)
            + agitatorFactorRow('Freshness', 'agitator-freshness', tf.freshness ?? null)
            + agitatorFactorRow('Ripple Effect', 'agitator-ripple', tf.rippleEffect ?? null)
            + agitatorFactorRow('Swing Risk', 'agitator-swing', tf.swingRisk ?? null)
            + agitatorFactorRow('Expected Move', 'agitator-expected-move', tf.expectedMove ?? null)
          : '';
        // Same consistency fix as Path A's compsHTML below -- always show
        // the RELATED row, real content or an explicit "none found" line.
        var tCompaniesHTML = '<div class="track-log-title" style="margin-top:10px">RELATED</div>'
          + ((topical.companies && topical.companies.length)
              ? '<div class="compact-list">' + topical.companies.map(topicalCompanyRowHTML).join('') + '</div>'
              : '<div class="track-empty">No related companies found.</div>');
        topicalHTML = tGaugeHTML + tHeadlineHTML + tFactorsHTML + tCompaniesHTML;
      } else {
        topicalHTML = '<div class="track-empty">Couldn’t find a company for "' + q + '".</div>';
      }
      out.innerHTML = suggestionHTML + topicalHTML;
      var yesBtn = document.getElementById('agitatorSuggestYes');
      if (yesBtn) yesBtn.addEventListener('click', function () {
        qEl.value = (yesBtn as HTMLElement).dataset.ticker || '';
        runAgitatorCheck();
      });
      var noBtn = document.getElementById('agitatorSuggestNo');
      if (noBtn) noBtn.addEventListener('click', function () {
        var banner = document.getElementById('agitatorSuggestBanner');
        if (banner) banner.remove();
      });
      wireAgitatorAddButtons(out);
      return;
    }

    var comp = data.composite;
    var gaugeColor = !comp ? 'var(--ink-dim)' : comp.level === 'HIGH' ? 'var(--red)' : comp.level === 'MEDIUM' ? 'var(--amber)' : 'var(--green)';
    var tq = data.tickerQuote;
    var tqColor = !tq ? '' : tq.direction === 'green' ? 'var(--green)' : tq.direction === 'red' ? 'var(--red)' : 'var(--amber)';
    var tqHTML = tq ? '<span class="tq-price">$' + tq.price + '</span><span class="tq-chg" style="color:' + tqColor + '">' + tq.change + '</span>' : '';
    var gaugeHTML = '<div class="trigger-row"><span class="trigger-lbl-wrap"><span class="trigger-lbl"><a href="' + tickerHref(data.symbol) + '" target="_blank">' + data.symbol + '</a></span>' + tqHTML + addTickerBtnHTML(data.symbol) + '</span>'
      + '<span class="trigger-val-wrap"><span class="trigger-val" style="color:' + gaugeColor + '">' + (comp ? comp.level : 'N/A') + '</span>'
      + '<button type="button" class="help-btn" data-help="agitator-score" aria-label="What is this?">?</button></span>'
      + '<span class="trigger-sub">' + (comp ? Math.round(comp.score / 10) + '/10 avg. of 6 signals' : 'no data') + '</span></div>';

    // data.factors is only present for "full" tiers (server-side isFull
    // gate) -- Free's simple-gauge variant gets the composite level/score
    // above with no breakdown at all, by design. Past Reactions (Fix 4,
    // Sep 1 2026) reads the real value now instead of a permanently
    // hardcoded "not tracked yet" -- a real oversight in the same pass
    // that activated it server-side; agitatorFactorRow's own null-check
    // already renders "n/a" when a ticker has too little graded history.
    var f = data.factors;
    var factorsHTML = f
      ? '<div class="track-log-title" style="margin-top:10px">SIGNALS</div>'
        + agitatorFactorRow('Surprise', 'agitator-surprise', f.surprise)
        + agitatorFactorRow('Uncertainty', 'agitator-uncertainty', f.uncertainty)
        + agitatorFactorRow('Freshness', 'agitator-freshness', f.positioning)
        + agitatorFactorRow('Ripple Effect', 'agitator-ripple', f.crossAsset)
        + agitatorFactorRow('Swing Risk', 'agitator-swing', f.liquidity)
        + agitatorFactorRow('Expected Move', 'agitator-expected-move', f.ivEnvironment)
        + agitatorFactorRow('Past Reactions', 'agitator-past', f.historicalReaction)
      : '';

    // Direct feedback (Sep 1 2026): a section that sometimes appears and
    // sometimes silently vanishes reads as broken, not as "no data this
    // time." Both the headline and RELATED now always render a row --
    // real content when there is any, an explicit "none found" line when
    // there isn't -- so the card's shape never changes between checks.
    var headlineHTML = '<div class="headline" style="margin-top:8px">' + (data.headlineUsed
      ? (data.headlineUsedUrl
          ? '<a href="' + data.headlineUsedUrl + '" target="_blank">' + data.headlineUsed + '</a>'
          : data.headlineUsed)
      : '<span style="opacity:.6">No recent related news found.</span>') + '</div>';

    var compsHTML = '<div class="track-log-title" style="margin-top:10px">RELATED</div>'
      + ((data.comps && data.comps.length)
          ? '<div class="compact-list">' + data.comps.map(relatedRowHTML).join('') + '</div>'
          : '<div class="track-empty">No related companies found.</div>');

    out.innerHTML = gaugeHTML + headlineHTML + factorsHTML + compsHTML;
    wireAgitatorAddButtons(out);
    rolodex.snapCardUnderDock(document.getElementById('card-agitator') as HTMLElement);
  } catch (e) {
    out.innerHTML = '<div class="track-empty">Agitator Gauge unavailable right now.</div>';
  } finally {
    btn.disabled = false; btn.classList.remove('btn-running'); btn.textContent = 'Check Aggression';
  }
}

// ── Market-closed enforcement ──────────────────────────────────────
function enforceMarketState(): void {
  if (isMarketClosed()) {
    const sym = watchlist[rolodex.getRoloCurrent()];
    if (sym && tickerState.has(sym)) renderRoloCard(sym);
  }
}

// ── Glossary ────────────────────────────────────────────────────────
interface GlossaryTerm { cat: string; term: string; def: string; ex?: string; }
var GLOSSARY: GlossaryTerm[] = [
  {cat:'CRF FRAMEWORK',term:'CRF (Catalyst Response Framework)',def:'A step-by-step checklist this app runs on a stock before giving you a verdict. If enough of the checklist looks good, that’s a thumbs up; if enough looks bad, that’s a thumbs down.',ex:'Think of it like a pre-flight checklist for a trade — pilots don’t take off until enough boxes are checked.'},
  {cat:'CRF FRAMEWORK',term:'Confidence',def:'How strongly the verdict’s own price action agrees with the trigger driving it. HIGH means both the ticker’s own move and its sector proxy’s move confirm the call. MEDIUM means the trigger is clean but there’s no independent price data to confirm or deny it yet. LOW means real price action is actually moving against the call — and every LOW-confidence verdict always ships a real “LOOK FOR” note explaining what to watch for before acting.',ex:'A DOWN verdict where the stock itself is also selling off hard is HIGH confidence. The same DOWN verdict on a stock that’s actually holding flat or ticking up is LOW — check the LOOK FOR note before acting.'},
  {cat:'CRF FRAMEWORK',term:'Gate 0 — Sector Gate',def:'Checks how the overall stock market is doing today. If the whole market is having a bad day, that drags down the outlook for pretty much everything.',ex:'A rising tide lifts all boats — a sinking one drags them down too.'},
  {cat:'CRF FRAMEWORK',term:'Gate 1 — Bidirectional Trend Structure',def:'Looks at whether the stock has already made a big move recently, up or down. A stock that’s already run up a lot is riskier to chase, and one that’s fallen too far too fast is a red flag too.',ex:'Like being wary of a stock that already “ran” — you don’t want to be the last one to the party.'},
  {cat:'CRF FRAMEWORK',term:'Gate 2 — Catalyst Congruence',def:'Checks whether recent news about the company actually supports the direction the app is leaning.',ex:'Makes sure the story and the numbers are telling the same story.'},
  {cat:'CRF FRAMEWORK',term:'Gate 3 — Opening Bar',def:'Watches how the stock trades in the first few minutes after the market opens, since that early action often hints at where the rest of the day is headed.',ex:'Like judging a race by how strong the runners look at the starting gun.'},
  {cat:'CRF FRAMEWORK',term:'Gate 4 — Phase Identification',def:'Figures out whether a stock’s big move is just getting started, already well underway, or has gone so far it might be due for a pullback.',ex:'Early innings vs. late innings of the same game.'},
  {cat:'CRF FRAMEWORK',term:'Gate 5 — Dynamic Sector Proxy',def:'Compares the stock to other companies or funds in the same industry, to see if it’s moving with its peers or acting strangely on its own.',ex:'Checking if one kid in class is sick, or if the whole class has the flu.'},
  {cat:'CRF FRAMEWORK',term:'Pre-Gate — Thesis Integrity',def:'A quick background check on the company itself, looking for red flags like financial trouble, before the app even looks at the stock’s price. A serious red flag here can override everything else.',ex:'Like checking a used car’s title for a salvage flag before you even look under the hood.'},
  {cat:'CRF FRAMEWORK',term:'Proxy',def:'The specific peer stock, ETF, or index a ticker is measured against for Gate 5 — shown on each card as PROXY. If the ticker and its proxy are moving together, that confirms the read; if they diverge, Gate 5 treats it as a warning sign.',ex:'IREN and CIFR are both checked against TSM, since Taiwan chip-supply stress hits the whole AI/semi trade the same way.'},
  {cat:'CRF FRAMEWORK',term:'Verdict Icons — 👍 UP / 👎 DOWN / HOLD',def:'👍 means the app leans bullish (expects the stock to rise), 👎 means it leans bearish (expects it to fall), and HOLD means it’s not confident enough either way, or the market’s closed.',ex:'Simple as a thumbs up or thumbs down on a movie — just for a stock’s next move instead.'},
  {cat:'MARKET STRUCTURE',term:'Beta (β)',def:'A stock’s volatility relative to the overall market (SPY), where 1.0 = moves in line with the market, >1 amplifies market moves, <1 dampens them. Shown on each card as β. A negative beta means the stock tends to move opposite the market — treat it as effectively uncorrelated to its assigned Gate 5 proxy rather than confirming or denying that proxy read.',ex:'IREN at β2.1 is expected to move ~2.1% for every 1% SPY move. A rare β−0.3 name would be expected to drift up on a red SPY day.'},
  {cat:'MARKET STRUCTURE',term:'Circuit Breaker',def:'Automatic trading halt when market falls a specified percentage. US halts at −7%, −13%, −20%. KOSPI at −8%.',ex:'KOSPI circuit breaker June 8 2026 at −8.37% → Gate 5 RED for all AI/semi.'},
  {cat:'MARKET STRUCTURE',term:'Engulfing Candle',def:'Second candle’s body completely contains the first. Bullish engulf = buyers overwhelmed sellers. Gate 3 uses this for Monday signals.',ex:'Monday bar 1 red at $40, bar 2 opens $38 closes $41 = bullish engulf → Gate 3 GREEN.'},
  {cat:'MARKET STRUCTURE',term:'Extended Hours (Pre-Market / Post-Market)',def:'Trading outside the 9:30am-4:00pm ET regular session: pre-market (4:00-9:30am ET) and post-market (4:00-8:00pm ET) on IEX Exchange’s formal extended sessions. Real prints, but on a much thinner book than the regular consolidated tape — moves here can reverse hard once the full tape opens.',ex:'CIFR prints $24.16 pre-market on light volume, opens the regular session at $22.10 once the full tape weighs in.'},
  {cat:'MARKET STRUCTURE',term:'Gap Up / Gap Down',def:'Stock opens significantly different from prior close. CRF entry: gap ≥2% from prior close, enter at ask +1%.',ex:'SMMT closed $45, opens $47.50 = +5.5% gap. Check all 5 gates.'},
  {cat:'MARKET STRUCTURE',term:'Intraday',def:'Within a single trading day — opened and evaluated before the next session begins, as opposed to a multi-day swing or long-term hold. This app’s entire CRF framework is built around intraday timing: the Opening Drive window, Gate 3’s same-day bar sequence, and same-day stop-loss discipline.',ex:'An intraday call on SMMT is graded against its move by that day’s close, not next week’s — Gate 3’s opening-bar sequence only exists because the framework is timing a single session.'},
  {cat:'MARKET STRUCTURE',term:'Opening Drive',def:'First 90 minutes (9:30-11:00am ET). Highest volume, highest volatility. Most institutional orders execute here. This app is built for this window.',ex:'Stock gaps up 3% with 2× average volume in bar 1 = Opening Drive setup.'},
  {cat:'MARKET STRUCTURE',term:'Relative Volume (RVOL)',def:'Current volume compared to the average volume for this point in the session. RVOL >2x on an Opening Drive gap is what separates a real institutional move from noise.',ex:'ALAB gaps up 4% on 1.1M shares in the first 5 minutes vs a normal 5-minute average of 280K → RVOL ~4x, high-conviction signal.'},
  {cat:'MARKET STRUCTURE',term:'Short Squeeze',def:'Heavily shorted stock rises sharply, forcing shorts to buy to cover, pushing price higher. Brief but explosive.',ex:'IREN 18.7% short float, <2 days to cover. Any positive catalyst could trigger a squeeze.'},
  {cat:'MARKET STRUCTURE',term:'Support / Resistance',def:'Price levels where a stock has historically reversed. Support = a floor buyers defended before. Resistance = a ceiling sellers defended before. Neither is guaranteed to hold twice.',ex:'PLUG bounced at $2.10 three times this quarter — that’s support until it isn’t; a close below it on volume is the tell it broke.'},
  {cat:'MARKET STRUCTURE',term:'VWAP (Volume-Weighted Average Price)',def:'The running average price of a stock for the session, weighted by volume at each price. Resets daily. Widely used intraday as a fair-value line — price above VWAP favors longs, below favors shorts.',ex:'Stock pops to $52 but VWAP sits at $49.80 — a lot of the day’s volume already changed hands well below the current price.'},
  {cat:'OPTIONS — CONCEPTS',term:'Call Option',def:'Right (not obligation) to buy 100 shares at the strike price before expiration. Buyers profit if the stock rises above strike + premium paid.',ex:'Buy 1 SMMT $50 call for $2.00. Stock closes $55 at expiry → intrinsic value $5.00, profit $3.00/share.'},
  {cat:'OPTIONS — CONCEPTS',term:'Cash-Secured Put',def:'Selling a put while holding cash to buy shares at strike if assigned. Generates income on names you’d want to own.',ex:'ARCC at $18.50 → sell $18 put for $0.48. Assigned = effective buy at $17.52.'},
  {cat:'OPTIONS — CONCEPTS',term:'DTE (Days to Expiration)',def:'Calendar days remaining until an option contract expires. Theta decay accelerates as DTE shrinks, especially inside the final 2 weeks.',ex:'A 30 DTE option loses value slowly. The same strike at 3 DTE bleeds premium daily even on a flat stock.'},
  {cat:'OPTIONS — CONCEPTS',term:'Expected Move',def:'Market-implied 1-sigma price range by expiration. Stock stays within this range ~68% of the time.',ex:'Stock $50, ATM IV 80%, 30 DTE → expected move ±$12.30.'},
  {cat:'OPTIONS — CONCEPTS',term:'Gamma Exposure (GEX)',def:'Aggregate dollar impact of dealer hedging. Positive GEX = dealers dampen moves. Negative GEX = dealers amplify moves.',ex:'SPX negative GEX → Opening Drive gaps extend. Momentum more reliable.'},
  {cat:'OPTIONS — CONCEPTS',term:'Implied Volatility (IV)',def:'Market’s expectation of future price movement, annualized. High IV = expensive options. Forward-looking, not historical.',ex:'ALAB IV ran 98-115% during parabolic phase. Selling premium more attractive than buying.'},
  {cat:'OPTIONS — CONCEPTS',term:'ITM / ATM / OTM',def:'In-the-money (has intrinsic value — call strike below spot, put strike above), at-the-money (strike ≈ spot), out-of-the-money (no intrinsic value yet, pure premium). Delta approximates the odds of finishing ITM.',ex:'Stock at $50: the $45 call is ITM, the $50 call is ATM, the $55 call is OTM.'},
  {cat:'OPTIONS — CONCEPTS',term:'IV Crush',def:'Sharp drop in IV immediately after a catalyst. Options lose value even on correct direction.',ex:'Buy put pre-earnings $3.00. Stock drops 5% but IV collapses 55pts → put now $1.80.'},
  {cat:'OPTIONS — CONCEPTS',term:'IV Rank (IVR)',def:'Where current IV sits vs past 52 weeks as a percentile. IVR >80 = Phase 3 signal in CRF.',ex:'IVR 85 = IV higher than 85% of readings this year → Gate 4 RED lean.'},
  {cat:'OPTIONS — CONCEPTS',term:'Put Option',def:'Right (not obligation) to sell 100 shares at the strike price before expiration. Buyers profit if the stock falls below strike − premium paid.',ex:'Buy 1 IREN $35 put for $1.50. Stock drops to $30 at expiry → intrinsic value $5.00, profit $3.50/share.'},
  {cat:'OPTIONS — CONCEPTS',term:'Put/Call Skew',def:'Difference between put IV and call IV at equal distance from current price. Positive skew = bearish institutional hedging.',ex:'CHAT showed consistent +4pt put skew → Gate 2 bearish lean.'},
  {cat:'OPTIONS — CONCEPTS',term:'Strike Price',def:'The fixed price at which an option’s owner can buy (call) or sell (put) the underlying. Set when the contract is created and never changes.',ex:'A $45 call and a $50 call on the same expiry are different contracts — the $45 strike is already in-the-money at a $47 stock price, the $50 strike is not.'},
  {cat:'OPTIONS — GREEKS',term:'Delta (Δ)',def:'How much an option moves per $1 move in the stock. ATM options ~0.50. Also approximates probability of expiring in-the-money.',ex:'Delta 0.50 call gains $0.50 when stock rises $1.'},
  {cat:'OPTIONS — GREEKS',term:'Gamma (Γ)',def:'Rate of change of delta. High gamma = delta shifts rapidly. Options near expiry and ATM have highest gamma.',ex:'High-gamma option: $1 stock move shifts delta from 0.50 to 0.65.'},
  {cat:'OPTIONS — GREEKS',term:'Rho (ρ)',def:'Sensitivity to a 1% change in interest rates. Smallest of the four Greeks for short-dated options — matters on LEAPS-length duration, negligible for the Opening Drive holds this app is built around.',ex:'A 6-month call with Rho 0.15 gains ~$0.15 per 1% rate hike — a rounding error next to a same-day 3% move driven by Delta/Gamma.'},
  {cat:'OPTIONS — GREEKS',term:'Theta (Θ)',def:'Time decay per day. Sellers’ friend, buyers’ enemy. Accelerates in final 2 weeks before expiry.',ex:'$2.00 option with theta −0.05 loses $0.50 over 10 days even if stock flat.'},
  {cat:'OPTIONS — GREEKS',term:'Vega (ν)',def:'Sensitivity to implied volatility. Buying pre-earnings buys vega, but IV collapses after the event (IV crush).',ex:'Buy $3.00 pre-earnings, stock moves your way, IV drops 45pts → option now $1.80.'},
  {cat:'PRICE & VALUATION LANGUAGE',term:'52-Week High',def:'The highest price a stock has traded at over the trailing 52 weeks — shown on each card as 52W.',ex:'A stock making a new 52-week high is trading at its best price in a full year.'},
  {cat:'PRICE & VALUATION LANGUAGE',term:'52-Week Low',def:'The lowest price a stock has traded at over the trailing 52 weeks.',ex:'A stock making a new 52-week low is trading at its worst price in a full year — worth investigating, not automatically a bargain.'},
  {cat:'PRICE & VALUATION LANGUAGE',term:'All-Time High (ATH)',def:'The highest price a stock has ever traded at since it started trading — not just the trailing year.',ex:'A stock can sit well below its 52-week high while still trading near its all-time high, if that high was set more than a year ago.'},
  {cat:'PRICE & VALUATION LANGUAGE',term:'All-Time Low (ATL)',def:'The lowest price a stock has ever traded at, since it started trading.',ex:'A stock hitting a fresh all-time low has never been cheaper in its public trading history.'},
  {cat:'PRICE & VALUATION LANGUAGE',term:'Bearish',def:'Expecting the price to fall. This app’s 👎 DOWN verdict is a bearish call.',ex:'“Bearish on the sector” means expecting it to fall broadly, not just one name.'},
  {cat:'PRICE & VALUATION LANGUAGE',term:'Breakdown',def:'Price moves decisively below a support level it had been holding, often on above-average volume — the bearish mirror of a breakout.',ex:'A stock that held $40 for weeks finally closes at $37 on heavy volume — a breakdown.'},
  {cat:'PRICE & VALUATION LANGUAGE',term:'Breakout',def:'Price moves decisively above a resistance level it had been struggling to clear, often on above-average volume.',ex:'A stock that failed at $50 three times finally closes at $52 on 3× average volume — a breakout.'},
  {cat:'PRICE & VALUATION LANGUAGE',term:'Bullish',def:'Expecting the price to rise. This app’s 👍 UP verdict is a bullish call.',ex:'“Bullish on IREN” means expecting it to rise.'},
  {cat:'PRICE & VALUATION LANGUAGE',term:'Discount',def:'Trading below par, fair value, or intrinsic worth — the opposite of Premium.',ex:'A closed-end fund trading at a 10% discount to net asset value is priced below what its holdings are actually worth.'},
  {cat:'PRICE & VALUATION LANGUAGE',term:'Fairly Priced',def:'Trading roughly in line with what a company’s fundamentals justify — neither a bargain nor stretched.',ex:'A stock at 18× earnings growing 18% a year, in line with its sector, is fairly priced.'},
  {cat:'PRICE & VALUATION LANGUAGE',term:'Floating',def:'Drifting with little conviction in either direction — not trending, not volatile, just idling near its current price.',ex:'A stock ticking between $29.80 and $30.20 all session on thin volume is floating, not making a real move.'},
  {cat:'PRICE & VALUATION LANGUAGE',term:'Frozen',def:'Essentially motionless — flat price, thin or no volume, nothing fresh to read from it.',ex:'A halted or extremely illiquid stock showing the same last-trade price for hours is frozen.'},
  {cat:'PRICE & VALUATION LANGUAGE',term:'Gapping Down',def:'Opens the session noticeably below where it closed the prior day, leaving a visible gap on the chart — the bearish mirror of gapping up.',ex:'Closes Monday at $45, opens Tuesday at $41 — gapping down 8.9% overnight.'},
  {cat:'PRICE & VALUATION LANGUAGE',term:'Gapping Up',def:'Opens the session noticeably above where it closed the prior day, leaving a visible gap on the chart.',ex:'Closes Monday at $45, opens Tuesday at $48 — gapping up 6.7% overnight.'},
  {cat:'PRICE & VALUATION LANGUAGE',term:'Overbought',def:'Pushed up too far, too fast — often flagged by momentum indicators like RSI above 70 — and considered due for a pullback.',ex:'A stock up 40% in two weeks with RSI at 85 is overbought, even if the underlying story is still good.'},
  {cat:'PRICE & VALUATION LANGUAGE',term:'Oversold',def:'Pushed down too far, too fast — RSI below 30 is the common threshold — and considered due for a bounce.',ex:'A stock down 30% in a broad market flush with RSI at 18 is oversold, even though nothing changed about the company itself.'},
  {cat:'PRICE & VALUATION LANGUAGE',term:'Overvalued',def:'Trading above what a company’s fundamentals justify — often used to flag Phase 3-style names priced for perfection.',ex:'A stock at 80× forward earnings with slowing growth gets called overvalued even if the chart still looks strong.'},
  {cat:'PRICE & VALUATION LANGUAGE',term:'Overweight',def:'An analyst or portfolio call to hold more of a stock than its normal weighting in a benchmark, because it’s expected to outperform. Opposite of Underweight.',ex:'A fund rating MU “Overweight” means holding more of it than its ~0.3% weight in the index it tracks.'},
  {cat:'PRICE & VALUATION LANGUAGE',term:'Par',def:'A security’s original face value — 100% of what it was issued at. Mostly a bond term; “at par” means trading exactly at that value.',ex:'A $1,000 bond trading at par sells for $1,000, no more, no less.'},
  {cat:'PRICE & VALUATION LANGUAGE',term:'Premium',def:'Trading above par, fair value, or intrinsic worth. On options, the premium is simply the price paid for the contract.',ex:'A closed-end fund trading at a 5% premium to net asset value costs more than the assets it actually holds.'},
  {cat:'PRICE & VALUATION LANGUAGE',term:'Rallying',def:'In the middle of a sustained upward move, usually over several sessions.',ex:'A stock up 15% over five straight green days is rallying.'},
  {cat:'PRICE & VALUATION LANGUAGE',term:'Range-bound',def:'Trading between a fairly consistent floor and ceiling with no clear trend, bouncing between support and resistance.',ex:'A stock stuck between $18 and $22 for a month, testing each edge without breaking through, is range-bound.'},
  {cat:'PRICE & VALUATION LANGUAGE',term:'Sideways',def:'Moving with no clear up or down trend over a stretch of time — the everyday term for range-bound, consolidating price action.',ex:'A stock unchanged on net over three weeks, chopping in both directions, is trading sideways.'},
  {cat:'PRICE & VALUATION LANGUAGE',term:'Undervalued',def:'Trading below what a company’s fundamentals (earnings, growth, assets) suggest it’s actually worth — a value case, not a momentum one.',ex:'A stock at 8× earnings when peers trade at 15×, with no clear reason for the gap, gets called undervalued.'},
  {cat:'PRICE & VALUATION LANGUAGE',term:'Volatile',def:'Moving in large, rapid swings in either direction — high uncertainty about where price settles next, regardless of the underlying trend.',ex:'A stock swinging ±8% in a single session on light news is volatile, whichever direction it ends up.'},
  {cat:'SECTOR TERMS',term:'BDC (Business Development Company)',def:'Fund making loans to mid-sized businesses, required to distribute 90%+ of income as dividends.',ex:'ARCC is the largest publicly traded BDC. Income from loan interest, not appreciation.'},
  {cat:'SECTOR TERMS',term:'HBM (High Bandwidth Memory)',def:'RAM designed for AI training. Only Micron, Samsung, SK Hynix make it. Core of MU’s AI thesis.',ex:'Hyperscaler capex slowdown = HBM demand slowdown = MU pressure.'},
  {cat:'SECTOR TERMS',term:'KOSPI',def:'Korea Composite Stock Price Index. Leading indicator for US AI/semi names. US names lag KOSPI crashes by 1-3 sessions.',ex:'KOSPI −6% Tuesday → NVDA/MU/ALAB pressure Thursday-Friday.'},
  {cat:'SECTOR TERMS',term:'Neocloud',def:'Companies renting GPU compute to AI developers. Borrow billions to buy Nvidia GPUs, rent at premium.',ex:'IREN, CoreWeave. Revenue real; profitability theoretical for most.'},
  {cat:'SECTOR TERMS',term:'SOXX',def:'iShares Semiconductor ETF. Tracks 30 largest US-listed semiconductor companies. Best sector indicator for AI/chip trades.',ex:'SOXX −3% while SPY flat = semiconductor-specific stress.'},
  {cat:'SECTOR TERMS',term:'TSM (Taiwan Semiconductor)',def:'World’s largest contract chip manufacturer. Single best proxy for global semiconductor health. TSM drop >3% = Gate 5 RED for all AI/semi names.',ex:'TSM −4% → Taiwan semi stress → risk-off on AI/semi entries.'},
  {cat:'SECTOR TERMS',term:'XBI / IBB',def:'Biotech ETFs. XBI equal-weighted (smaller companies more impact). XBI is Gate 5 proxy for biotech/medical names.',ex:'XBI −2% → biotech risk-off → Gate 5 YELLOW or RED for SMMT/VCYT/IMVT.'},
  {cat:'TICKER CLASSIFICATIONS',term:'Canary',def:'European or institutional base that prices macro risk early. When canaries fall while sentiment names rise, reversal is coming.',ex:'ASML fell before MU/ALAB. Warned 10-21 days early.'},
  {cat:'TICKER CLASSIFICATIONS',term:'Flow',def:'Moves on mechanical buying events. Institutions distribute at the opening bar on positive catalyst days.',ex:'ALAB opened $315 on Computex day, flushed to $292 in 30 min on 1.1M shares.'},
  {cat:'TICKER CLASSIFICATIONS',term:'Phase 1 / 2 / 3',def:'Phase 1 = discovery, <30% of 52-week range, full size. Phase 2 = acceleration, 30-70%, half size. Phase 3 = priced for perfection, >70%, post-flush only.',ex:'ALAB at $88 = Phase 1. At $300 = Phase 2. At $450 = Phase 3 (sold off on blowout beat).'},
  {cat:'TICKER CLASSIFICATIONS',term:'Sentiment',def:'Moves most directly with AI capex or sector confidence, ignoring macro until it breaks.',ex:'MU, NVDA, AMD. Ran +47% into Broadcom miss then crashed 12.8%.'},
  {cat:'TRADING TERMINOLOGY',term:'14-Day Pre-Window',def:'14 trading days before a catalyst. Over +20% move in this window = Gate 1 RED (exhaustion).',ex:'MU ran +35% in 14 days before record earnings. Gate 1 RED. Sold off on the print.'},
  {cat:'TRADING TERMINOLOGY',term:'Bid / Ask (Bid-Ask Spread)',def:'Bid = highest price a buyer will pay right now. Ask = lowest price a seller will accept. The spread between them is a real, invisible cost — wider on illiquid names and thin extended-hours books.',ex:'IREN bid $39.98 / ask $40.05 — a market order to buy fills near $40.05, not the $40.00 last-trade price shown on the card.'},
  {cat:'TRADING TERMINOLOGY',term:'Defined Risk',def:'Position where max loss is fixed at entry. Buying options or spreads. Cannot lose more than premium paid.',ex:'Buy 1 put for $200. Stock rallies. Max loss = $200.'},
  {cat:'TRADING TERMINOLOGY',term:'GTC (Good Till Cancelled)',def:'Order that stays active until manually cancelled. Use for stop losses on multi-day holds.',ex:'GTC stop at $43.65 on SMMT triggers automatically even if it gaps down overnight.'},
  {cat:'TRADING TERMINOLOGY',term:'Ladder / Laddering',def:'Splitting one order into several smaller limit orders staggered across a price range instead of one order at one price. Improves average fill price on size that would otherwise move a thin book.',ex:'Instead of one 500-share market buy, ladder 100 shares each at $45.00/$45.10/$45.20/$45.30/$45.40.'},
  {cat:'TRADING TERMINOLOGY',term:'Limit Order',def:'An order that only fills at your specified price or better. Guarantees price, not execution — can go unfilled if the stock never trades there.',ex:'Limit buy SMMT at $45.00 while it’s trading $45.20 — sits unfilled until the price comes down to you (or never).'},
  {cat:'TRADING TERMINOLOGY',term:'Long',def:'Buying and owning shares expecting price to rise.',ex:'Buy 100 SMMT at $45. Sell at $50. $500 profit.'},
  {cat:'TRADING TERMINOLOGY',term:'Market Order',def:'An order that fills immediately at the best available price. Guarantees execution, not price — on a fast-moving or thin name you can pay meaningfully more than the last quote.',ex:'A market buy during a gap-up Opening Drive can fill 1-2% above the price you saw when you clicked.'},
  {cat:'TRADING TERMINOLOGY',term:'Pyramiding',def:'Adding to a winning position in smaller increments as it moves in your favor.',ex:'100 shares at $45. Rises to $47 → add 50. Hits $49 → add 25.'},
  {cat:'TRADING TERMINOLOGY',term:'Sector Rotation',def:'Money moving from one sector to another. Sector pulse blurb tracks this daily.',ex:'AI fears → money rotates from NVDA into GLD and USO.'},
  {cat:'TRADING TERMINOLOGY',term:'Sell the News',def:'Stock falls after a positive catalyst because good news was already priced in. Phase 3 behavior.',ex:'ALAB beats Q1 by 12%. Stock drops 13% next day. Beat was priced in.'},
  {cat:'TRADING TERMINOLOGY',term:'Short / Short Selling',def:'Borrowing shares, selling immediately, buying back later. Profit if price falls. Loss if rises — theoretically unlimited.',ex:'Short 100 IREN at $40. Falls to $32 → $800 profit.'},
  {cat:'TRADING TERMINOLOGY',term:'Stop Loss',def:'Pre-set price at which you automatically exit to limit losses. Set before entry. CRF: −3% for high-conviction names.',ex:'Enter SMMT at $45. Stop at $43.65 (−3%). Hit $43.65 → exit immediately.'},
  {cat:'TRADING TERMINOLOGY',term:'Ticker',def:'The short letter code (usually 1-5 letters) that identifies one specific stock or fund on an exchange, like IREN or SPY. What you type into Import to add a name to your watchlist.',ex:'MU, ALAB, and TSM are all tickers — three different companies, three different symbols.'},
];

// Auto-links a curated set of market-language glossary terms wherever they
// appear in generated text (news headlines, gate notes) -- reuses the
// existing .help-glossary-link mechanism (shared/rolodex.ts's
// initHelpBalloons already wires a delegated click listener for it to
// jumpToGlossaryTerm) rather than inventing a second click path. Scoped to
// the terms most likely to actually appear in AI-written market
// commentary, not the full GLOSSARY -- linking every occurrence of a
// common word like "Long" would be noisy and low-value.
interface GlossaryLinkTerm { re: RegExp; key: string; }
var GLOSSARY_LINK_TERMS: GlossaryLinkTerm[] = [
  { re: /\b52-Week High\b/gi, key: '52-week high' },
  { re: /\b52-Week Low\b/gi, key: '52-week low' },
  { re: /\bAll-Time High\b/gi, key: 'all-time high' },
  { re: /\bATH\b/g, key: 'all-time high' },
  { re: /\bAll-Time Low\b/gi, key: 'all-time low' },
  { re: /\bATL\b/g, key: 'all-time low' },
  { re: /\bFairly Priced\b/gi, key: 'fairly priced' },
  { re: /\bRange-bound\b/gi, key: 'range-bound' },
  { re: /\bGapping Up\b/gi, key: 'gapping up' },
  { re: /\bGapping Down\b/gi, key: 'gapping down' },
  { re: /\bOverweight\b/gi, key: 'overweight' },
  { re: /\bUndervalued\b/gi, key: 'undervalued' },
  { re: /\bOvervalued\b/gi, key: 'overvalued' },
  { re: /\bat par\b/gi, key: 'par' },
  { re: /\bPremium\b/gi, key: 'premium' },
  { re: /\bDiscount\b/gi, key: 'discount' },
  { re: /\bBullish\b/gi, key: 'bullish' },
  { re: /\bBearish\b/gi, key: 'bearish' },
  { re: /\bOverbought\b/gi, key: 'overbought' },
  { re: /\bOversold\b/gi, key: 'oversold' },
  { re: /\bBreakout\b/gi, key: 'breakout' },
  { re: /\bBreakdown\b/gi, key: 'breakdown' },
  { re: /\bSideways\b/gi, key: 'sideways' },
  { re: /\bVolatile\b/gi, key: 'volatile' },
  { re: /\bRallying\b/gi, key: 'rallying' },
  { re: /\bFloating\b/gi, key: 'floating' },
  { re: /\bFrozen\b/gi, key: 'frozen' },
];
// Wraps every non-overlapping glossary-term match in one plain-text run
// with a clickable link -- matches are found against the ORIGINAL text
// (not built up via sequential per-term replaces) so an inserted <a> tag
// from one term can never be re-scanned and corrupted by the next term's
// regex. Overlaps resolve to the earliest-starting, then longest, match.
function linkTextSegment(text: string): string {
  if (!text) return text;
  interface Hit { start: number; end: number; text: string; key: string; }
  var hits: Hit[] = [];
  GLOSSARY_LINK_TERMS.forEach(function (lt) {
    lt.re.lastIndex = 0;
    var mm: RegExpExecArray | null;
    while ((mm = lt.re.exec(text))) {
      hits.push({ start: mm.index, end: mm.index + mm[0].length, text: mm[0], key: lt.key });
      if (mm[0].length === 0) lt.re.lastIndex++;
    }
  });
  if (!hits.length) return text;
  hits.sort(function (a, b) { return a.start - b.start || (b.end - b.start) - (a.end - a.start); });
  var kept: Hit[] = [];
  var lastEnd = -1;
  hits.forEach(function (h) { if (h.start >= lastEnd) { kept.push(h); lastEnd = h.end; } });
  var out = '', pos = 0;
  kept.forEach(function (h) {
    out += text.slice(pos, h.start);
    out += '<a href="#" class="help-glossary-link term-link" data-term="' + h.key + '">' + h.text + '</a>';
    pos = h.end;
  });
  out += text.slice(pos);
  return out;
}
// Applies linkTextSegment only to plain-text runs, never inside an
// existing HTML tag (e.g. a <mark class="ctx-match"> from Session Context
// highlighting) -- splits the string on tag boundaries first so a term
// match can never land inside an attribute value.
function autoLinkGlossaryTerms(html: string): string {
  if (!html) return html;
  var TAG_RE = /<[^>]*>/g;
  var out = '', lastIndex = 0, m: RegExpExecArray | null;
  while ((m = TAG_RE.exec(html))) {
    out += linkTextSegment(html.slice(lastIndex, m.index));
    out += m[0];
    lastIndex = m.index + m[0].length;
  }
  out += linkTextSegment(html.slice(lastIndex));
  return out;
}
// The headline's own outer <a> already links the whole line to the news
// article -- nesting a second <a> (the glossary term link) inside it would
// be invalid HTML (browsers silently break/reparent nested anchors). This
// keeps the news-article link and any glossary term link as SIBLING <a>
// tags instead: everything that isn't one of our own inline glossary
// anchors gets wrapped in its own news-link <a>, so the whole line still
// reads as fully clickable, just via multiple adjacent anchors rather than
// one that wraps everything.
function wrapHeadlineLinks(sym: string, html: string): string {
  var href = newsHref(sym);
  var parts = html.split(/(<a\b[^>]*\bclass="[^"]*\bterm-link\b[^"]*"[^>]*>.*?<\/a>)/g);
  return parts.map(function (p) {
    if (!p) return p;
    if (p.indexOf('help-glossary-link') !== -1) return p;
    return '<a href="' + href + '" target="_blank">' + p + '</a>';
  }).join('');
}

var glossaryBuilt = false;
function buildGlossary(): void {
  if (glossaryBuilt) return; glossaryBuilt = true;
  var body = document.getElementById('glossary-body'); if (!body) return;
  var cats: Record<string, GlossaryTerm[]> = {};
  GLOSSARY.forEach(function (g) { if (!cats[g.cat]) cats[g.cat] = []; cats[g.cat].push(g); });
  var html = '';
  Object.entries(cats).forEach(function (entry) {
    var cat = entry[0], terms = entry[1];
    html += '<div class="glossary-cat" data-cat="' + cat + '">' + cat + '</div>';
    terms.forEach(function (t) {
      html += '<div class="glossary-term visible" data-term="' + t.term.toLowerCase() + '" data-def="' + t.def.toLowerCase() + '">'
        + '<div class="glossary-term-name">' + t.term + '</div>'
        + '<div class="glossary-term-def">' + t.def + '</div>'
        + (t.ex ? '<div class="glossary-term-example">e.g. ' + t.ex + '</div>' : '')
        + '</div>';
    });
  });
  body.innerHTML = html;
}
// Ensures the Glossary card is expanded and snapped into view -- idempotent,
// safe to call even when it's already open (still re-snaps, since the
// caller is explicitly asking to jump there). The Glossary card is now a
// plain .card[data-card="glossary"], wired through the same
// expandCard()/wireAccordionHead() mechanism as every other accordion card
// (see above) -- this is just the "ensure open" entry point for callers
// that don't have a click event to work from (help balloons, the About
// profile-menu link).
function ensureGlossaryOpen(): void {
  var card = document.getElementById('card-glossary') as HTMLElement | null;
  if (!card) return;
  if (!card.classList.contains('expanded')) expandCard(card);
  else rolodex.snapCardUnderDock(card);
}
// Opens the Glossary (if closed), clears any active search filter so the
// term can't be hidden by it, then scrolls the matching entry into view
// and flashes it -- the "screen jump" a help-balloon glossary link
// triggers. Matches by substring against the same lowercase data-term
// text filterGlossary() already searches, so no separate id/slug needs
// keeping in sync with the GLOSSARY array above.
function jumpToGlossaryTerm(key: string): void {
  ensureGlossaryOpen();
  var search = document.getElementById('glossary-search') as HTMLInputElement | null;
  if (search) search.value = '';
  filterGlossary('');
  var k = key.toLowerCase();
  var target: HTMLElement | null = null;
  document.querySelectorAll<HTMLElement>('.glossary-term').forEach(function (el) {
    if (!target && el.dataset.term && el.dataset.term.indexOf(k) !== -1) target = el;
  });
  if (target) {
    var hit = target as HTMLElement;
    hit.scrollIntoView({ behavior: 'smooth', block: 'center' });
    hit.classList.add('glossary-flash');
    setTimeout(function () { hit.classList.remove('glossary-flash'); }, 1600);
  }
}
function filterGlossary(query: string): void {
  buildGlossary();
  var q = query.toLowerCase().trim();
  var terms = document.querySelectorAll<HTMLElement>('.glossary-term');
  var anyVisible = false;
  terms.forEach(function (el) {
    var match = !q || el.dataset.term!.includes(q) || el.dataset.def!.includes(q);
    el.classList.toggle('visible', match); if (match) anyVisible = true;
  });
  document.querySelectorAll<HTMLElement>('.glossary-cat').forEach(function (catEl) {
    var next = catEl.nextElementSibling as HTMLElement | null, hasVisible = false;
    while (next && !next.classList.contains('glossary-cat')) { if (next.classList.contains('visible')) hasVisible = true; next = next.nextElementSibling as HTMLElement | null; }
    catEl.style.display = hasVisible || !q ? 'block' : 'none';
  });
  var nr = document.getElementById('glossary-no-results');
  if (nr) (nr as HTMLElement).style.display = (!anyVisible && q) ? 'block' : 'none';
}
document.getElementById('glossary-search')!.addEventListener('input', (e) => filterGlossary((e.target as HTMLInputElement).value));

// ── Card-header help balloons ──────────────────────────────────────────
// Short, keep-it-to-a-glance copy per "(?)" button (keyed by its
// data-help id in index.html). Heavy terminology inside links straight
// to the matching Glossary entry via jumpToGlossaryTerm() above.
const HELP_CONTENT: Record<string, string> = {
  gate: 'Live status for SPY/QQQ and the sector proxies every ticker is checked against — feeds <a class="help-glossary-link" href="#" data-term="gate 0">Gate 0</a> for each verdict. Every verdict also carries a <a class="help-glossary-link" href="#" data-term="confidence">Confidence</a> read — tap the docked bar to jump back to top. Pre/post-market prices are IEX-only and may vary from the full consolidated tape; built for regular-session (9:30am–4pm ET) analysis.',
  pulse: 'A live AI-written read on today’s market mood and <a class="help-glossary-link" href="#" data-term="sector rotation">sector rotation</a> — Starter and up unlocks the real, per-session version.',
  io: 'Paste or type <a class="help-glossary-link" href="#" data-term="ticker">tickers</a> or company names, one per line or comma-separated, to add them to your watchlist. Type a ticker in caps (AAPL) or a name any other way (Tesla) — either resolves to the right symbol.',
  agitator: 'A standalone discovery tool for proofing a new stock interest or a media rumor BEFORE it enters your watchlist — free, no credit cost. Type a ticker, a company name, or paste a full headline/rumor — one box handles all three — and get a LOW/MEDIUM/HIGH read across 6 real signals, plus a few real related companies to also check. Past Reactions isn’t tracked yet, so it’s shown but never scored.',
  'agitator-score': 'One overall number, 0-10, averaging the 6 signals below it — a quick read on how big a deal this news might be for the stock, not a precise measurement.',
  'agitator-surprise': 'How unexpected this is for this company. A routine, expected update scores low; something out of the blue scores high.',
  'agitator-uncertainty': 'How unclear it still is to everyone how big a deal this actually is. High means the market hasn’t figured out how to react yet.',
  'agitator-freshness': 'Is this brand-new information nobody has reacted to yet (high), or something already known and priced in days ago (low)?',
  'agitator-ripple': 'How likely this is to also move other related stocks, the sector, or the broader market — not just this one company.',
  'agitator-swing': 'How easily this stock’s price can be pushed around. Smaller, thinly-traded stocks swing more on the same amount of buying or selling.',
  'agitator-expected-move': 'How much price movement the options market is already betting on for this stock, right now.',
  'agitator-past': 'How reliably this app’s past verdicts on this ticker have graded out. Shows n/a until enough real graded history exists.',
};

// ── init ────────────────────────────────────────────────────────────
function initApp(): void {
  cleanLS();
  document.getElementById('ticker-count')!.textContent = 'CRF · ' + watchlist.length + ' TICKERS';
  fetchMarket();
  rolodex.sizeGateSpacer();
  renderRolodexFromWatchlist();
  setTimeout(fetchCreditStatus, 2000);
  setInterval(function () { fetchMarket(); }, 4 * 60 * 1000);
  enforceMarketState();
  setInterval(enforceMarketState, 60 * 1000);
}

async function boot(): Promise<void> {
  if (redirectingToPaidTier) return;
  initWatchlist({ defaultTickers: ['MU', 'IREN', 'ALAB'], maxTickers: 3, upgradeMessage: 'Free tier supports up to 3 tickers.\n\nUpgrade to Starter for more.' });
  initTickerCache({ API_URL, authH, addSecret });
  onWatchlistSave(function () { schedulePushWatchlist(); renderRolodexFromWatchlist(); });
  onTickersAdded(function () { rolodex.goRolo(0); });

  rolodex.initRolodex({
    scroller: document.getElementById('scroller') as HTMLElement,
    gateCard: document.getElementById('gateCard') as HTMLElement,
    gateFullOverlay: document.getElementById('gateFullOverlay') as HTMLElement,
    gateSpacer: document.getElementById('gateSpacer') as HTMLElement,
    gateMarquee: gateMarquee,
    roloIndex: roloIndex,
    roloStage: roloStage,
    roloHint: document.getElementById('roloHint'),
  }, {
    getWatchlist: () => watchlist,
    onActivate: (sym) => {
      const state = tickerState.get(sym);
      if (state && !state.result && !state.analyzing) analyzeOne(sym);
    },
    onDeleteConfirmed: deleteActiveTicker,
  });
  rolodex.initHelpBalloons(HELP_CONTENT, jumpToGlossaryTerm);

  // Signed-in-but-free is the lapsed-subscriber case (or a free signup
  // that created an account) — sync their watchlist so a Starter/Pro/
  // Shark lapse doesn't wipe it, and so it survives a browser cache/
  // cookie clear. Purely anonymous visitors have no account to key cloud
  // storage to, so this stays fully local for them.
  if (sbSession && sbSession.token) {
    initWatchlistSync({ API_URL, authH, addSecret });
    await pullWatchlistFromServer();
  }

  document.getElementById('analyzeAllBtn')!.addEventListener('click', analyzeAll);
  document.getElementById('importBtn')!.addEventListener('click', addTickers);
  document.getElementById('agitatorCheckBtn')!.addEventListener('click', runAgitatorCheck);
  document.getElementById('agitator-clear')!.addEventListener('click', () => {
    var qEl = document.getElementById('agitator-query') as HTMLInputElement;
    qEl.value = '';
    qEl.focus();
  });
  document.getElementById('agitator-query')!.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); runAgitatorCheck(); }
  });
  const comebackClose = document.getElementById('comeback-close-btn');
  if (comebackClose) comebackClose.addEventListener('click', closeComebackScreen);

  initApp();
}

boot();
