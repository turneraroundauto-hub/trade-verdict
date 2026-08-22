// Pro tier, rebuilt onto the Rolodex UI (Aug 16, 2026) -- the sticky-
// docking Gate, ticker pill strip with marquee, and single-active-card
// stage from Starter/Free's own Rolodex builds, wired to Pro's real,
// already-correct backend integration: real auth/tier gating, real
// credit-consuming /analyze, real Settings/prefs, real Session Context
// highlighting, real server-synced watchlist AND server-synced track
// record. Nothing about the real data/auth/credit pipeline changed in
// this rebuild -- only the watchlist's visual representation did, same
// "invert build direction" approach as Starter/Free.
//
// Written as real TypeScript from the start (Phase 3 of the TypeScript
// adoption plan) and bundled via esbuild -- see esbuild.config.mjs's
// { in: 'pro/app.ts', out: 'pro/app' } entry (third bundle entry point,
// after Starter and Free). Imports shared/rolodex.ts for the Gate dock/
// marquee/stacked-card/swipe mechanics, same module Starter/Free consume.
//
// Pro-specific differences from Starter/Free, all deliberate, per direct
// scoping (AskUserQuestion, Aug 16, 2026 -- "the pills are capped at 15.
// the watchlist stays as built in pro. it can be in a drop down like
// everything else"):
// - The underlying watchlist stays genuinely unlimited (maxTickers:999,
//   unchanged from Pro's pre-Rolodex build) -- but the ticker-pill strip
//   (#roloIndex) only ever shows the first CARD_CAP (15) tickers, in
//   watchlist order, matching the credit-cost guardrail Analyze All
//   already enforced before this rebuild (5 credits max at 3 analyses/
//   credit, regardless of how large the watchlist grows). Tickers beyond
//   that live in a new accordion utility card ("Watchlist", same
//   tap-to-expand pattern as Sector Pulse/Session Context/Import) rather
//   than a plain always-visible list section -- ported wholesale from the
//   pre-Rolodex compact-row rendering (price/%chg/news, swipe-to-delete,
//   sort toggle, "+" promote-to-card button), not rebuilt from scratch.
// - Three more Pro-exclusive accordion utility cards, using the exact
//   same tap-to-expand pattern: Proxy Resolution Explorer (with its live
//   coherence strip), Sector Heat Map, and a REAL Track Record card (not
//   the upgrade teaser Starter/Free show -- Pro's tracker is genuinely
//   unlocked) carrying the gate-attribution and ticker-accuracy
//   breakdowns alongside the shared module's own rate/stats/log-item
//   rendering.
// - Each active Rolodex card gets a Pro-exclusive Analyst View
//   expandable subsection (trigger classification, corroboration tally,
//   verdict reason, resolved proxy tier/risk flags) and real ✓ RIGHT /
//   ✗ WRONG / SKIP log buttons in place of Starter/Free's "UPGRADE to
//   log results" teaser.
// - CSV export (Ticker/List/Price/IV/Change%, List reflecting pill-strip-
//   vs-overflow membership) moved into the profile-menu dropdown, matching
//   where Starter's own CSV export already lives (Aug 16, 2026) rather
//   than keeping Pro's older in-Import-card button.
// - Gate labels/rim-color/"WAIT FOR" wording unified to Starter/Free's
//   Rolodex conventions (shorter labels, no card-rim mechanic, "LOOK
//   FOR:"), same reasoning as Free's own build: keep the shared Rolodex
//   card language consistent across every tier that uses it.
import { initTickerCache, fetchTickerData } from '../shared/ticker-cache';
import { initWatchlist, watchlist, addTickers, removeTicker, setWatchlist, onWatchlistSave } from '../shared/watchlist';
import { cleanLS, cacheVerdict, getCachedVerdict } from '../shared/analysis-cache';
import { renderTrackRecord, logResult, getAccuracyLog, clearLog } from '../shared/track-record';
import { initTrackRecordSync, pullTrackRecordFromServer, schedulePushTrackRecord } from '../shared/track-record-sync';
import { initWatchlistSync, pullWatchlistFromServer, schedulePushWatchlist } from '../shared/watchlist-sync';
import { getTzPref, getTzIana, onPrefsChange, tickerHref, newsHref, refreshTickerLinks } from '../shared/prefs';
import { highlightContextMatches } from '../shared/context-highlight';
import '../shared/settings-modal';
import * as rolodex from '../shared/rolodex';
import type { AnalyzeResponse, TickerData } from '../shared/types.js';

const API_URL = 'https://tra-zacg.onrender.com';

const TIER = {
  name:         'Pro',
  maxTickers:   999,
  pulse:        true,
  tracker:      true,
  alpaca:       false,
  credits:      '100 credits/mo',
  cache:        '1 min cache',
  nextTier:     'Shark',
  nextPrice:    '$39.99/mo',
  stripeLink:   'https://buy.stripe.com/14A8wQdoJ7fx6lpb3z3VC01',
  creditsLink:  'https://buy.stripe.com/3cI3cwacxarJ8txb3z3VC00',
  badgeColor:   '#ce93d8',
};

// Pro's card/watchlist split: watchlist itself stays unlimited, but only
// the first CARD_CAP tickers (in watchlist order) ever get a real pill/
// card -- the rest render in the Watchlist overflow accordion, no
// ANALYZE button, no credit cost. Analyze All only ever hits this same
// window, capping its cost at CARD_CAP/3 credits (5) regardless of how
// large the watchlist grows.
const CARD_CAP = 15;

let market: any = null;
// Last /analyze result per ticker -- kept so Analyst View and the
// track-record log buttons can read gate/proxy detail without a re-fetch.
var lastAnalysis: Record<string, AnalyzeResponse> = {};

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
function pctColor(p: number): string { return p > 0 ? 'var(--green)' : p < 0 ? 'var(--red)' : 'var(--ink-dim)'; }
function fmtPct(p: number): string { return (p > 0 ? '+' : '') + p.toFixed(2) + '%'; }

// ── SUPABASE AUTH ─────────────────────────────────────────────────
var sbSession: any = null;
function getStoredSession(): any { try { return JSON.parse(localStorage.getItem('tv_session') || 'null'); } catch (e) { return null; } }
function storeSession(s: any): void { if (s) localStorage.setItem('tv_session', JSON.stringify(s)); else localStorage.removeItem('tv_session'); }
function isSessionValid(s: any): boolean { if (!s || !s.token) return false; if (s.expiresAt && Date.now() / 1000 > s.expiresAt - 60) return false; return true; }
function authH(): Record<string, string> { return { 'Content-Type': 'application/json' }; }
function addSecret(url: string): string { if (sbSession && sbSession.token) { var sep = url.includes('?') ? '&' : '?'; return url + sep + 'supabase_token=' + encodeURIComponent(sbSession.token); } return url; }
function showScreen(id: string): void { ['auth-screen', 'app-root'].forEach(function (s) { var el = document.getElementById(s); if (el) (el as HTMLElement).style.display = s === id ? (s === 'app-root' ? 'block' : 'flex') : 'none'; }); }
export function authLogout(): void { storeSession(null); sbSession = null; showScreen('auth-screen'); }

// ── PROFILE MENU ──────────────────────────────────────────────────
export function toggleProfileMenu(e?: Event): void {
  if (e) e.stopPropagation();
  var m = document.getElementById('profile-menu'); if (!m) return;
  m.classList.toggle('open');
}
document.addEventListener('click', function (e) {
  var m = document.getElementById('profile-menu');
  if (!m || !m.classList.contains('open')) return;
  if (!(e.target as HTMLElement).closest('.profile-wrap')) m.classList.remove('open');
});

// ── CREDIT DISPLAY ────────────────────────────────────────────────
async function fetchCreditStatus(): Promise<void> { try { var res = await fetch(addSecret(API_URL + '/status'), { headers: authH() }); var data = await res.json(); var el = document.getElementById('credits-btn'); if (el && data.totalCredits !== undefined) { el.textContent = (data.totalCredits > 0 ? data.totalCredits : '+') + ' CREDITS'; } } catch (e) { } }

// ── AUTH FLOW ─────────────────────────────────────────────────────
var authMode = 'login';
function bindAuthEvents(): void {
  var eyeBtn = document.getElementById('eye-btn');
  var resetLink = document.getElementById('reset-link');
  var authBtn = document.getElementById('auth-btn');
  var authToggle = document.getElementById('auth-toggle');
  var pwInput = document.getElementById('auth-password') as HTMLInputElement;
  var emailInput = document.getElementById('auth-email') as HTMLInputElement;
  if (eyeBtn) eyeBtn.addEventListener('click', function () { var inp = document.getElementById('auth-password') as HTMLInputElement; inp.type = inp.type === 'password' ? 'text' : 'password'; eyeBtn!.innerHTML = inp.type === 'password' ? '&#128065;' : '&#128584;'; });
  if (resetLink) resetLink.addEventListener('click', function () { var email = (document.getElementById('auth-email') as HTMLInputElement).value.trim(); var err = document.getElementById('auth-error') as HTMLElement; if (!email) { err.style.color = 'var(--red)'; err.textContent = 'Enter your email first'; return; } err.style.color = 'var(--dim)'; err.textContent = 'Sending reset link...'; fetch(API_URL + '/auth/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email }) }).then(function (r) { return r.json(); }).then(function () { err.style.color = 'var(--green)'; err.textContent = 'Reset link sent! Check your email.'; }).catch(function (e) { err.style.color = 'var(--red)'; err.textContent = e.message; }); });
  if (authBtn) authBtn.addEventListener('click', function () { if (authMode === 'login') handleLogin(); else handleSignup(); });
  if (authToggle) authToggle.addEventListener('click', () => toggleAuthMode());
  if (pwInput) pwInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') authBtn && (authBtn as HTMLElement).click(); });
  if (emailInput) emailInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') pwInput && pwInput.focus(); });
}
function toggleAuthMode(mode?: string): void { authMode = mode || (authMode === 'login' ? 'signup' : 'login'); var isL = authMode === 'login'; document.getElementById('auth-title')!.textContent = isL ? 'SIGN IN' : 'CREATE ACCOUNT'; document.getElementById('auth-btn')!.textContent = isL ? 'SIGN IN' : 'CREATE ACCOUNT'; document.getElementById('auth-toggle')!.textContent = isL ? 'New user? Create account' : 'Already have an account? Sign in'; document.getElementById('auth-error')!.textContent = ''; (document.getElementById('auth-error') as HTMLElement).style.color = 'var(--red)'; var rl = document.getElementById('reset-link'); if (rl) (rl as HTMLElement).style.display = isL ? 'inline' : 'none'; }
async function handleLogin(): Promise<void> { var email = (document.getElementById('auth-email') as HTMLInputElement).value.trim(), password = (document.getElementById('auth-password') as HTMLInputElement).value, btn = document.getElementById('auth-btn') as HTMLButtonElement, err = document.getElementById('auth-error') as HTMLElement; err.textContent = ''; btn.disabled = true; btn.textContent = 'SIGNING IN...'; try { var r = await fetch(API_URL + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) }); if (!r.ok) { var e = await r.json(); throw new Error(e.error || 'Login failed'); } var session = await r.json(); storeSession(session); sbSession = session; btn.textContent = 'SIGN IN'; btn.disabled = false; checkTierAccess(session); } catch (e: any) { err.textContent = e.message; btn.textContent = 'SIGN IN'; btn.disabled = false; } }
async function handleSignup(): Promise<void> { var email = (document.getElementById('auth-email') as HTMLInputElement).value.trim(), password = (document.getElementById('auth-password') as HTMLInputElement).value, btn = document.getElementById('auth-btn') as HTMLButtonElement, err = document.getElementById('auth-error') as HTMLElement; err.textContent = ''; err.style.color = 'var(--red)'; if (!email || !password) { err.textContent = 'Email and password required'; return; } if (password.length < 6) { err.textContent = 'Password must be at least 6 characters'; return; } btn.disabled = true; btn.textContent = 'CREATING...'; try { var r = await fetch(API_URL + '/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) }); if (!r.ok) { var e = await r.json(); throw new Error(e.error || 'Signup failed'); } err.style.color = 'var(--green)'; err.textContent = 'Account created! Check your email to confirm, then sign in.'; btn.textContent = 'SIGN IN'; btn.disabled = false; toggleAuthMode('login'); } catch (e: any) { err.textContent = e.message; btn.textContent = 'CREATE ACCOUNT'; btn.disabled = false; } }

// ── GATE 0 (market) — real fetch, Rolodex sticky-dock/marquee rendering ──
const GATE_FIELDS: [string, string][] = [
  ['spy', 'SPY'], ['qqq', 'QQQ'], ['btc', 'BTC'], ['soxx', 'SOXX'], ['xbi', 'XBI'],
  ['iwm', 'IWM'], ['gld', 'GLD'], ['uso', 'USO'], ['tsm', 'TSM'], ['msft', 'MSFT'],
];
const GATE_LINK_OVERRIDE: Record<string, string> = { BTC: 'BTC-USD' };
function gateLinkSymbol(label: string): string { return GATE_LINK_OVERRIDE[label] || label; }

const gateMarquee = document.getElementById('gateMarquee') as HTMLElement;

async function fetchMarket(force?: boolean): Promise<void> {
  try {
    var url = force ? addSecret(API_URL + '/market?force=true') : addSecret(API_URL + '/market');
    var res = await fetch(url, { headers: authH() });
    market = await res.json();
  } catch (e) { market = null; }
  renderGate();
  renderPulse();
  refreshGateMarquee();
  requestAnimationFrame(rolodex.sizeGateSpacer);
}

function renderPulse(): void {
  var pulseEl = document.getElementById('pulse-text');
  if (!pulseEl) return;
  if (market && market.pulse) { pulseEl.className = 'pulse-text'; pulseEl.textContent = market.pulse; }
  else if (market) { pulseEl.className = 'pulse-loading'; pulseEl.textContent = 'Generating pulse...'; }
  else { pulseEl.className = 'pulse-loading'; pulseEl.textContent = 'Unavailable'; }
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
  document.getElementById('gateNote')!.textContent = (market && market.gateNote) || (market ? '' : 'Tap to retry — data unavailable.');

  const grid = document.getElementById('gateGrid') as HTMLElement;
  grid.innerHTML = GATE_FIELDS.map(([key, label]) => {
    const d = market && market[key];
    const val = (!d || d.change === '?') ? '?' : d.change;
    const cls = (!d || d.change === '?') ? 'neutral' : dirClass(d.direction);
    const sym = gateLinkSymbol(label);
    return `<div class="gate-stat"><div class="k"><a href="${tickerHref(sym)}" target="_blank" data-ticker="${sym}">${label}</a></div><div class="v ${cls}">${val}</div></div>`;
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
    return `<span class="gm-item"><a class="sym" href="${tickerHref(sym)}" target="_blank" data-ticker="${sym}" onclick="event.stopPropagation()">${label}</a><span class="val ${cls}">${val}</span></span>`;
  }).join('');
  rolodex.buildGateMarquee(itemsHTML);
}

// ── Utility card accordion (Pulse/Context/Import/Watchlist/Proxy/Heat/Track/Glossary) ──
// expandCard() is also the entry point jumpToGlossaryTerm()/jumpToAbout()
// (below, near the Glossary functions / profile menu) call to ensure the
// Glossary card is open+snapped -- buildGlossary() is a plain function
// declaration (hoisted), so referencing it here ahead of its own
// definition further down the file is safe.
function expandCard(card: HTMLElement): void {
  card.classList.add('expanded');
  const head = card.querySelector('.card-head'); if (head) head.setAttribute('aria-expanded', 'true');
  const kind = card.dataset.card;
  // Glossary's build is synchronous, not fetched -- build BEFORE snapping
  // so the forced-height scroll-target computation (inside
  // snapCardUnderDock) measures the real, capped content height instead
  // of the still-empty panel. Watchlist/Proxy/Heat Map's own renders are
  // fetch-based and populate well after this function returns either way,
  // so their relative order to the snap call doesn't matter the same way.
  if (kind === 'glossary') buildGlossary();
  rolodex.snapCardUnderDock(card);
  if (kind === 'watchlist') renderOverflowList();
  else if (kind === 'proxy') renderProxyExplorer();
  else if (kind === 'heatmap') renderHeatMap();
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

// ── Rolodex: real ticker data, real /analyze — pill strip scoped to the
// top CARD_CAP window; the full (unlimited) watchlist is what's synced/
// persisted, only the pill strip's own source array is sliced. ────────
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

function confColor(conf?: string): string {
  return conf === 'HIGH' ? 'var(--green)' : conf === 'MEDIUM' ? 'var(--amber)' : 'var(--red)';
}

function pregateStripHTML(result: AnalyzeResponse | null): string {
  if (!result || !result.gates) return '';
  const waitText = (result.wait_for && result.wait_for !== 'null') ? result.wait_for : '';
  if (!waitText) return '';
  return `<div class="pregate-strip"><div class="pregate-dot" style="background:${confColor(result.confidence)}"></div>`
    + `<div class="pregate-note"><span class="wait-lbl">LOOK FOR: </span>${waitText}</div>`
    + '</div>';
}

// ── PRO — trigger classification. Mirrors the exact override-authority
// reason prefixes server.js writes to parsed.reason (see /analyze), so
// the track-record breakdown attributes each logged verdict to the real
// mechanism that produced it, not a guess.
function classifyTrigger(data: AnalyzeResponse | undefined): string {
  var reason = (data && (data as any).reason) || '';
  if (reason.indexOf('Pre-Gate thesis-integrity override') === 0) return 'pre-gate';
  if (reason.indexOf('Broad market failure') === 0) return 'gate0';
  if (reason.indexOf('Gate 1 structural breakdown override') === 0) return 'gate1';
  if (reason.indexOf('Gate 5 forceDown') === 0) return 'gate5';
  if (data && data.verdict === 'DOWN') return 'corroboration';
  return 'standard';
}
var TRIGGER_LABELS: Record<string, string> = {
  'pre-gate': 'PRE-GATE OVERRIDE', 'gate0': 'GATE 0 OVERRIDE', 'gate1': 'GATE 1 OVERRIDE',
  'gate5': 'GATE 5 OVERRIDE', 'corroboration': '2+ GATE CORROBORATION', 'standard': 'STANDARD VERDICT',
};

export function logResultUI(ticker: string, verdict: string, correct: boolean, btnEl: HTMLElement): void {
  var rowEl = btnEl.closest('.log-row') as HTMLElement | null; if (!rowEl) return;
  var meta = { trigger: classifyTrigger(lastAnalysis[ticker]) };
  logResult(ticker, verdict, correct, rowEl, meta);
  renderGateAttribution();
  renderTickerAccuracy();
  schedulePushTrackRecord();
}

function logSectionHTML(sym: string, verdict: string): string {
  return `<div class="log-row"><span class="log-prompt">WAS IT RIGHT?</span>`
    + `<button class="log-btn log-btn-right" data-log="${sym}" data-verdict="${verdict}" data-correct="true">✓ RIGHT</button>`
    + `<button class="log-btn log-btn-wrong" data-log="${sym}" data-verdict="${verdict}" data-correct="false">✗ WRONG</button>`
    + `<button class="log-btn log-btn-skip" data-log-skip="1">SKIP</button></div>`;
}

// ── PRO — Analyst View: the reasoning the standard Gate Breakdown
// doesn't carry -- the exact override mechanism (if any), the
// corroboration-rule tally the server used to decide it, the resolved
// Gate 5 proxy tier/basket, and any risk flags -- all sourced from data
// already on the request/response, no new backend fields required.
function analystViewHTML(sym: string, result: AnalyzeResponse | null, td: TickerData | null): string {
  if (!result || !result.gates) return '';
  var trigger = classifyTrigger(result);
  var triggerColor: Record<string, string> = {
    'pre-gate': 'var(--red)', 'gate0': 'var(--red)', 'gate1': 'var(--red)', 'gate5': 'var(--red)',
    'corroboration': 'var(--amber)', 'standard': 'var(--ink-dim)',
  };
  var g: any = result.gates;
  var redCount = ['g1_prewindow', 'g2_catalyst', 'g4_phase', 'g5_korea'].filter(function (k) { return g[k] && g[k].status === 'RED'; }).length;

  var rule: any = td && (td as any).proxyRule;
  var proxyHtml = '';
  if (rule && rule.proxy) {
    var tier = rule.tier || 'primary';
    var tierColor: Record<string, string> = { primary: 'var(--green)', secondary: 'var(--amber)', 'fundamentals-confirmed': 'var(--blue)', 'fundamentals-speculative': 'var(--red)' };
    var tc = tierColor[tier] || 'var(--ink-dim)';
    proxyHtml = `<div class="analyst-row"><span class="analyst-lbl">PROXY TIER</span><span class="proxy-tier-badge" style="color:${tc};border-color:${tc}55;background:${tc}11">${tier.toUpperCase().replace(/-/g, ' ')}</span></div>`
      + `<div class="analyst-note">${rule.proxy.name}${rule.dynamicallyResolved ? ' — dynamically resolved (Gate 5)' : ' — fixed sector proxy'}</div>`;
    if (rule.elevatedCapCeiling || rule.autoExecuteStop) {
      proxyHtml += `<div class="analyst-row"><span class="analyst-lbl">RISK FLAGS</span>`
        + (rule.elevatedCapCeiling ? '<span class="proxy-tier-badge" style="color:var(--amber);border-color:rgba(255,182,45,.4);background:rgba(255,182,45,.1)">ELEVATED CAP CEILING</span>' : '')
        + (rule.autoExecuteStop ? '<span class="proxy-tier-badge" style="color:var(--red);border-color:rgba(255,59,92,.4);background:rgba(255,59,92,.1)">AUTO-EXECUTE STOP</span>' : '')
        + '</div>';
    }
  }

  return `<button class="expand-btn expand-btn-purple" data-toggle-analyst="${sym}"><span>ANALYST VIEW</span><span class="analyst-arrow">▼</span></button>`
    + `<div class="analyst-list" data-analyst-body="${sym}" style="display:none">`
    + `<div class="analyst-row"><span class="analyst-lbl">TRIGGER</span><span class="analyst-val" style="color:${triggerColor[trigger]}">${TRIGGER_LABELS[trigger]}</span></div>`
    + `<div class="analyst-row"><span class="analyst-lbl">CORROBORATION</span><span class="analyst-val">${redCount}/4 non-exempt gates RED</span></div>`
    + ((result as any).reason ? `<div class="analyst-row"><span class="analyst-lbl">VERDICT REASON</span></div><div class="analyst-note">${(result as any).reason}</div>` : '')
    + proxyHtml
    + '</div>';
}

function gateListHTML(sym: string, result: AnalyzeResponse | null): string {
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
      + `<div class="gn"><span class="gl">${label}</span>${gate.note ? ' - ' + gate.note : ''}</div></div>`;
  }).join('');
  const conf = `<div class="conf-row"><span class="conf-lbl">CONFIDENCE</span><span class="conf-val" style="color:${confColor(result.confidence)}">${result.confidence || ''}</span></div>`;
  const v = (result.verdict || 'FLAT').toUpperCase();
  return '<div class="gate-list">' + rows + logSectionHTML(sym, v) + conf + '</div>';
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
  const headline = news ? highlightContextMatches(rawHeadline, ctxEl ? ctxEl.value : '') : rawHeadline;
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
      : `<button class="btn btn-blue btn-compact" data-analyze="${sym}" ${analyzing ? 'disabled' : ''}>${analyzing ? 'RUNNING…' : 'ANALYZE'}</button>`)
    + '</div>'
    + `</div>`
    + pregateStripHTML(result)
    + `<div class="headline"><a href="${newsHref(sym)}" target="_blank">${headline}</a> <span class="age">${age}</span></div>`
    + `<div class="meta-row"><span>52W <b>${w52}</b></span><span>PHASE <b>${phase}</b></span><span>β <b>${beta}</b></span><span>PROXY <b style="color:var(--blue)">${proxyHTML}</b></span></div>`
    + badgesHTML(result)
    + gateListHTML(sym, result)
    + analystViewHTML(sym, result, td)
    + (state.error ? `<div class="gate-note" style="color:var(--red);margin-top:6px">${state.error}</div>` : '');
}

function wireCardButtons(card: HTMLElement, sym: string): void {
  const btn = card.querySelector('[data-analyze]');
  if (btn) btn.addEventListener('click', () => analyzeOne(sym));
  const resetEl = card.querySelector('[data-reset]');
  if (resetEl) resetEl.addEventListener('click', () => resetTicker(sym));
  const analystToggle = card.querySelector('[data-toggle-analyst]');
  if (analystToggle) analystToggle.addEventListener('click', () => {
    const body = card.querySelector(`[data-analyst-body="${sym}"]`) as HTMLElement | null;
    const arrow = analystToggle.querySelector('.analyst-arrow');
    if (!body) return;
    const open = body.style.display === 'none';
    body.style.display = open ? 'block' : 'none';
    if (arrow) arrow.textContent = open ? '▲' : '▼';
    rolodex.syncRoloStageHeight();
  });
  const rightBtn = card.querySelector('[data-log][data-correct="true"]') as HTMLElement | null;
  const wrongBtn = card.querySelector('[data-log][data-correct="false"]') as HTMLElement | null;
  const skipBtn = card.querySelector('[data-log-skip]') as HTMLElement | null;
  if (rightBtn) rightBtn.addEventListener('click', () => logResultUI(sym, rightBtn.dataset.verdict!, true, rightBtn));
  if (wrongBtn) wrongBtn.addEventListener('click', () => logResultUI(sym, wrongBtn.dataset.verdict!, false, wrongBtn));
  if (skipBtn) skipBtn.addEventListener('click', () => { (skipBtn.closest('.log-row') as HTMLElement).style.display = 'none'; });
}

function renderRoloCard(sym: string): void {
  const card = roloStage.querySelector(`.rolo-card[data-sym="${sym}"]`) as HTMLElement | null;
  if (!card) return;
  const state = tickerState.get(sym);
  if (!state) return;
  card.innerHTML = roloCardHTML(sym, state);
  card.classList.remove('verdict-up', 'verdict-down');
  wireCardButtons(card, sym);
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

// ── Card window (pill strip) is scoped to watchlist.slice(0, CARD_CAP) —
// the underlying watchlist itself is never truncated. ─────────────────
function cardWindow(): string[] { return watchlist.slice(0, CARD_CAP); }

let pillHydrationDone: Promise<void> = Promise.resolve();

async function renderRolodexFromWatchlist(): Promise<void> {
  document.getElementById('ticker-count')!.textContent = 'CRF · ' + watchlist.length + ' TICKERS';
  const cardCountEl = document.getElementById('card-count');
  if (cardCountEl) cardCountEl.textContent = Math.min(watchlist.length, CARD_CAP) + '/' + CARD_CAP;
  const window = cardWindow();
  roloStage.innerHTML = '';
  window.forEach((sym) => {
    if (!tickerState.has(sym)) tickerState.set(sym, { td: null, result: null, analyzing: false, error: null });
    const card = document.createElement('div');
    card.className = 'rolo-card'; card.dataset.sym = sym;
    roloStage.appendChild(card);
    renderRoloCard(sym);
  });

  rolodex.rebuildRoloIndex(window, (sym, i) => {
    const chip = document.createElement('button');
    chip.className = 'rolo-chip'; chip.dataset.sym = sym; chip.dataset.idx = String(i);
    return chip;
  }, `— ${window.length} —`);
  window.forEach((sym) => renderPill(sym));

  rolodex.clampRoloCurrent();
  rolodex.positionRoloStack();
  requestAnimationFrame(() => { rolodex.sizeGateSpacer(); rolodex.sizeRoloMarquee(); });

  let resolveHydration: () => void;
  pillHydrationDone = new Promise((res) => { resolveHydration = res; });

  await Promise.all(window.map(async (sym) => {
    const td = await fetchTickerData(sym);
    const state = tickerState.get(sym);
    if (state) { state.td = td; }
    renderRoloCard(sym);
    renderPill(sym);
    requestAnimationFrame(() => rolodex.sizeRoloMarquee());
  }));
  resolveHydration!();
  requestAnimationFrame(() => {
    rolodex.sizeRoloMarquee();
    rolodex.markRoloMarqueeDataReady();
  });

  renderOverflowListIfOpen();
}

function refreshRoloCards(): void {
  cardWindow().forEach((sym) => { if (tickerState.has(sym)) renderRoloCard(sym); });
  renderOverflowListIfOpen();
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

  var ctx = (document.getElementById('context-input') as HTMLTextAreaElement).value;
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
    lastAnalysis[sym] = _r;
    state.result = _r; state.analyzing = false;
    renderRoloCard(sym); renderPill(sym);
    fetchCreditStatus();
  } catch (e: any) {
    state.analyzing = false; state.error = e.message;
    renderRoloCard(sym); renderPill(sym);
  }
}

function analyzeAll(): void { cardWindow().forEach((sym) => analyzeOne(sym)); }

function handleNoCredits(sym: string): void {
  const state = tickerState.get(sym)!;
  const cached = getCachedVerdict(sym);
  if (cached) {
    state.result = cached; state.error = null;
    renderRoloCard(sym);
    return;
  }
  state.error = 'No credits remaining — buy more or upgrade to Shark.';
}

// ── PRO — Watchlist overflow accordion (tickers beyond CARD_CAP) ──────
// Price + today's %-change + a short news link, no ANALYZE button and no
// credit cost. Sortable by %-change. Swipe-to-delete only (position among
// non-card rows isn't meaningful, so no drag-reorder). Ported from the
// pre-Rolodex compact-row rendering, same gesture code shape.
var compactSortDir = 1;
export function toggleCompactSort(): void {
  compactSortDir = -compactSortDir;
  var btn = document.getElementById('compact-sort-btn');
  if (btn) btn.textContent = compactSortDir === 1 ? '▲' : '▼';
  renderOverflowList();
}

function overflowTickers(): string[] { return watchlist.slice(CARD_CAP); }

function renderOverflowListIfOpen(): void {
  var card = document.querySelector('.card[data-card="watchlist"]');
  if (card && card.classList.contains('expanded')) renderOverflowList();
  var countEl = document.getElementById('compact-count');
  if (countEl) countEl.textContent = String(overflowTickers().length);
}

var compactGesturesBound = false;
async function renderOverflowList(): Promise<void> {
  var el = document.getElementById('watchlist-compact');
  if (!el) return;
  var overflow = overflowTickers();
  var countEl = document.getElementById('compact-count');
  if (countEl) countEl.textContent = String(overflow.length);
  if (!overflow.length) { el.innerHTML = '<div class="track-empty">Everything tracked fits in the top ' + CARD_CAP + ' cards.</div>'; return; }
  el.innerHTML = '<div class="track-empty">Loading watchlist…</div>';
  var rows = await Promise.all(overflow.map(async function (t) {
    var td = await fetchTickerData(t);
    return { ticker: t, price: td && td.metrics && td.metrics.price != null ? td.metrics.price : null, pct: td && td.metrics && typeof td.metrics.pct === 'number' ? td.metrics.pct : null, news: td && td.news };
  }));
  rows.sort(function (a, b) {
    var pa = a.pct == null ? (compactSortDir === 1 ? Infinity : -Infinity) : a.pct;
    var pb = b.pct == null ? (compactSortDir === 1 ? Infinity : -Infinity) : b.pct;
    return (pa - pb) * compactSortDir;
  });
  var ctxEl = document.getElementById('context-input') as HTMLTextAreaElement | null;
  var ctxVal = ctxEl ? ctxEl.value : '';
  el.innerHTML = rows.map(function (r) {
    var t = r.ticker;
    var hasNews = r.news && (r.news as any).ageHours <= 300;
    return '<div class="compact-row-wrap" data-ticker="' + t + '">'
      + '<div class="compact-swipe-bg"><span class="swipe-icon">&#128465;</span><span class="swipe-label">DELETE</span></div>'
      + '<div class="compact-row">'
      + '<div class="compact-row-main">'
      + '<div class="compact-row-top"><span class="compact-ticker" style="color:' + (r.pct != null ? pctColor(r.pct) : 'var(--ink)') + '"><a class="ticker-a" href="' + tickerHref(t) + '" target="_blank">' + t + '</a></span>'
      + '<span class="compact-price" style="color:' + (r.pct != null ? pctColor(r.pct) : 'var(--ink)') + '">' + (r.price != null ? '$' + r.price.toFixed(2) : '&mdash;') + '</span>'
      + '<span class="compact-pct" style="color:' + (r.pct != null ? pctColor(r.pct) : 'var(--ink-dim)') + '">' + (r.pct != null ? fmtPct(r.pct) : '&mdash;') + '</span></div>'
      + '<div class="compact-news"' + (hasNews ? '' : ' style="display:none"') + '>' + (hasNews ? '<a href="' + newsHref(t) + '" target="_blank">' + highlightContextMatches((r.news as any).headline, ctxVal) + '</a>' : '') + '</div>'
      + '</div>'
      + '<button type="button" class="compact-plus-btn" title="Add as card" data-promote="' + t + '">+</button>'
      + '</div></div>';
  }).join('');
  el.querySelectorAll<HTMLElement>('[data-promote]').forEach((btn) => btn.addEventListener('click', () => promoteToCard(btn.dataset.promote!)));
  bindCompactGestures();
}

// Moves an overflow ticker into the last card-window slot (index CARD_CAP-1).
// Whatever was already there shifts down to become the new top overflow row.
function promoteToCard(ticker: string): void {
  var idx = watchlist.indexOf(ticker);
  if (idx < 0 || idx < CARD_CAP) return;
  var arr = watchlist.slice();
  arr.splice(idx, 1);
  arr.splice(CARD_CAP - 1, 0, ticker);
  setWatchlist(arr);
}

var COMPACT_MOVE_THRESHOLD = 14;
var compactActive: any = null;
function bindCompactGestures(): void {
  if (compactGesturesBound) return;
  var el = document.getElementById('watchlist-compact');
  if (!el) return;
  compactGesturesBound = true;
  el.addEventListener('pointerdown', onCompactPointerDown);
}
function onCompactPointerDown(e: PointerEvent): void {
  if (compactActive) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  var wrap = (e.target as HTMLElement).closest('.compact-row-wrap') as HTMLElement | null;
  if (!wrap) return;
  var row = wrap.querySelector('.compact-row') as HTMLElement | null;
  if (!row) return;
  compactActive = { pointerId: e.pointerId, wrap: wrap, row: row, ticker: wrap.dataset.ticker, startX: e.clientX, startY: e.clientY, dragging: false, pendingDx: 0, swipeBg: wrap.querySelector('.compact-swipe-bg') as HTMLElement };
  document.addEventListener('pointermove', onCompactPointerMove, { passive: false });
  document.addEventListener('pointerup', onCompactPointerUp);
  document.addEventListener('pointercancel', onCompactPointerUp);
}
function compactDeleteThreshold(wrap: HTMLElement): number { return Math.min(120, wrap.getBoundingClientRect().width * 0.35); }
function onCompactPointerMove(e: PointerEvent): void {
  var g = compactActive; if (!g || e.pointerId !== g.pointerId) return;
  var dx = e.clientX - g.startX, dy = e.clientY - g.startY;
  if (!g.dragging) {
    if (Math.abs(dx) > COMPACT_MOVE_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
      g.dragging = true;
      try { g.wrap.setPointerCapture(e.pointerId); } catch (err) { }
      g.row.style.transition = 'none';
      g.wrap.classList.add('swiping');
    } else if (Math.abs(dy) > COMPACT_MOVE_THRESHOLD) { endCompactGesture(); return; }
    else return;
  }
  e.preventDefault();
  var clamped = Math.min(0, Math.max(dx, -g.wrap.getBoundingClientRect().width));
  g.row.style.transform = 'translateX(' + clamped + 'px)';
  var progress = Math.min(Math.abs(clamped) / compactDeleteThreshold(g.wrap), 1);
  g.swipeBg.style.opacity = String(progress);
  g.pendingDx = clamped;
}
function onCompactPointerUp(e: PointerEvent): void {
  var g = compactActive; if (!g || e.pointerId !== g.pointerId) return;
  var threshold = compactDeleteThreshold(g.wrap);
  if (g.dragging && Math.abs(g.pendingDx) >= threshold) {
    var wrap = g.wrap, ticker = g.ticker, w = wrap.getBoundingClientRect().width;
    g.row.style.transition = 'transform .18s ease-in';
    g.row.style.transform = 'translateX(-' + (w + 40) + 'px)';
    wrap.style.overflow = 'hidden';
    wrap.style.transition = 'max-height .2s ease .12s,opacity .2s ease .12s,margin .2s ease .12s';
    requestAnimationFrame(function () { wrap.style.maxHeight = '0px'; wrap.style.opacity = '0'; wrap.style.marginTop = '0px'; wrap.style.marginBottom = '0px'; });
    setTimeout(function () { removeTicker(ticker); }, 220);
  } else if (g.dragging) {
    g.row.style.transition = 'transform .18s ease';
    g.row.style.transform = 'translateX(0)';
    g.swipeBg.style.opacity = '0';
    g.wrap.classList.remove('swiping');
  }
  endCompactGesture();
}
function endCompactGesture(): void {
  var g = compactActive;
  if (g) { try { g.wrap.releasePointerCapture(g.pointerId); } catch (err) { } }
  compactActive = null;
  document.removeEventListener('pointermove', onCompactPointerMove);
  document.removeEventListener('pointerup', onCompactPointerUp);
  document.removeEventListener('pointercancel', onCompactPointerUp);
}

// ── PRO — Proxy Resolution Explorer ─────────────────────────────────
var COHERENCE_FLAT_BAND_PCT = 1.0;
var COHERENCE_DECOUPLE_PCT = 2.0;
function classifyCoherence(tickerPct: number, proxyPct: number): { label: string; color: string } {
  if (Math.abs(tickerPct) <= COHERENCE_FLAT_BAND_PCT) return { label: 'LAG RISK', color: 'var(--amber)' };
  var proxyDown = proxyPct < 0;
  var opposite = (proxyDown && tickerPct > 0) || (!proxyDown && tickerPct < 0);
  if (opposite && Math.abs(tickerPct) >= COHERENCE_DECOUPLE_PCT) return { label: 'DECOUPLING', color: 'var(--red)' };
  return { label: 'TRACKING', color: 'var(--green)' };
}
function tickerLink(symbol: string): string { return `<a href="${tickerHref(symbol)}" target="_blank" class="proxy-verify-link">${symbol}</a>`; }

var TIER_RANK: Record<string, number> = { primary: 0, secondary: 1, 'fundamentals-confirmed': 2, 'fundamentals-speculative': 3 };
var COHERENCE_RANK: Record<string, number> = { TRACKING: 0, 'LAG RISK': 1, DECOUPLING: 2 };
var proxySort: { key: string | null; dir: number } = { key: null, dir: 1 };

export function setProxySort(key: string): void {
  if (proxySort.key === key) proxySort.dir = -proxySort.dir;
  else { proxySort.key = key; proxySort.dir = 1; }
  updateProxySortButtons();
  renderProxyExplorer();
}
function updateProxySortButtons(): void {
  ['level', 'coherence'].forEach(function (k) {
    var btn = document.getElementById('proxy-sort-' + k); if (!btn) return;
    var active = proxySort.key === k;
    var arrow = btn.querySelector('.sort-arrow');
    if (arrow) arrow.textContent = active ? (proxySort.dir === 1 ? '▲' : '▼') : '⇅';
    btn.classList.toggle('sort-btn-active', active);
  });
}
function sortByRank<T>(rows: T[], rankFn: (r: T) => number | null, dir: number): void {
  rows.sort(function (a, b) {
    var ra = rankFn(a), rb = rankFn(b);
    if (ra == null && rb == null) return 0;
    if (ra == null) return 1;
    if (rb == null) return -1;
    return (ra - rb) * dir;
  });
}

var proxyExplorerGen = 0;
export async function renderProxyExplorer(force?: boolean): Promise<void> {
  var body = document.getElementById('proxy-explorer-body'); if (!body) return;
  if (!watchlist.length) { body.innerHTML = '<div class="track-empty">Watchlist is empty.</div>'; return; }
  body.innerHTML = '<div class="track-empty">Loading proxy resolutions…</div>';

  await pillHydrationDone;
  if (!watchlist.length) return;

  var myGen = ++proxyExplorerGen;
  var priority = cardWindow();
  var rest = overflowTickers();
  var resultsByTicker: Record<string, any> = {};

  async function buildRow(t: string): Promise<any> {
    var td = await fetchTickerData(t, force);
    var rule: any = td && td.proxyRule;
    var tickerPct = td && td.metrics ? td.metrics.pct : null;
    var liveSymbols = rule && rule.proxy ? (rule.proxy.symbols || []).filter((s: string) => market && market[s.toLowerCase()] && typeof market[s.toLowerCase()].pct === 'number') : [];
    var coherence = null;
    if (rule && rule.proxy && typeof tickerPct === 'number' && liveSymbols.length) {
      var proxyPcts = liveSymbols.map((s: string) => market[s.toLowerCase()].pct);
      var avgProxyPct = proxyPcts.reduce((a: number, b: number) => a + b, 0) / proxyPcts.length;
      coherence = classifyCoherence(tickerPct, avgProxyPct);
    }
    return { ticker: t, rule: rule, tickerPct: tickerPct, tier: rule ? rule.tier || 'primary' : null, liveSymbols: liveSymbols, coherence: coherence };
  }

  function paint(): void {
    if (myGen !== proxyExplorerGen) return;
    var rows = watchlist.filter((t) => resultsByTicker[t]).map((t) => resultsByTicker[t]);
    if (proxySort.key === 'level') sortByRank(rows, (r) => r.tier != null ? TIER_RANK[r.tier] : null, proxySort.dir);
    else if (proxySort.key === 'coherence') sortByRank(rows, (r) => r.coherence ? COHERENCE_RANK[r.coherence.label] : null, proxySort.dir);

    var tierColor: Record<string, string> = { primary: 'var(--green)', secondary: 'var(--amber)', 'fundamentals-confirmed': 'var(--blue)', 'fundamentals-speculative': 'var(--red)' };
    body!.innerHTML = rows.map((r) => {
      if (!r.rule || !r.rule.proxy) return `<div class="proxy-item"><div class="proxy-item-head"><span class="proxy-ticker">${tickerLink(r.ticker)}</span><span class="analyst-val" style="color:var(--ink-dim)">unavailable</span></div></div>`;
      var tier = r.tier || 'primary';
      var tc = tierColor[tier] || 'var(--ink-dim)';
      var verifyLinks = [tickerLink(r.ticker)].concat((r.rule.proxy.symbols || []).map(tickerLink)).join(' &middot; ');

      var coherenceHtml;
      if (!r.coherence) {
        coherenceHtml = '<div class="proxy-coherence"><span class="analyst-lbl">LIVE COHERENCE</span><span class="analyst-val" style="color:var(--ink-dim)">no live feed for this proxy</span></div>';
      } else {
        var chips = r.liveSymbols.map((s: string) => { var p = market[s.toLowerCase()].pct; return `<span class="proxy-live-chip">${tickerLink(s)} <b style="color:${pctColor(p)}">${fmtPct(p)}</b></span>`; }).join('');
        coherenceHtml = '<div class="proxy-coherence">'
          + `<div class="analyst-row" style="padding:0"><span class="analyst-lbl">LIVE COHERENCE</span><span class="proxy-tier-badge" style="color:${r.coherence.color};border-color:${r.coherence.color}55;background:${r.coherence.color}11">${r.coherence.label}</span></div>`
          + `<div class="proxy-live-row"><span class="proxy-live-chip">${tickerLink(r.ticker)} <b style="color:${pctColor(r.tickerPct)}">${fmtPct(r.tickerPct)}</b></span>${chips}</div>`
          + '</div>';
      }

      return `<div class="proxy-item"><div class="proxy-item-head"><span class="proxy-ticker">${tickerLink(r.ticker)}</span>`
        + `<span class="proxy-tier-badge" style="color:${tc};border-color:${tc}55;background:${tc}11">${tier.toUpperCase().replace(/-/g, ' ')}</span></div>`
        + `<div class="proxy-detail">${r.rule.proxy.name}</div>`
        + `<div class="proxy-detail" style="color:var(--ink-dim)">${r.rule.category || ''}${r.rule.dynamicallyResolved ? ' · dynamically resolved (quarterly recompute)' : ' · fixed sector proxy'}</div>`
        + (r.rule.proxy.rationale ? `<div class="proxy-detail">${r.rule.proxy.rationale}</div>` : '')
        + `<div class="proxy-verify-row"><span class="analyst-lbl">VERIFY</span>${verifyLinks}</div>`
        + coherenceHtml
        + '</div>';
    }).join('')
      + (rest.length && rows.length < watchlist.length ? `<div class="track-empty">Loading ${watchlist.length - rows.length} more…</div>` : '')
      + '<div class="proxy-shark-tease"><a href="../shark/coming-soon.html">&#9889; SHARK &mdash; real-time Alpaca data &amp; deeper proxy analytics &rarr;</a></div>';
  }

  await Promise.all(priority.map(async (t) => { resultsByTicker[t] = await buildRow(t); }));
  paint();
  rest.forEach((t) => { buildRow(t).then((row) => { resultsByTicker[t] = row; paint(); }); });
}
export function refreshProxyExplorer(): void { renderProxyExplorer(true); }

// ── PRO — track-record gate-attribution + ticker-accuracy breakdowns ──
function renderGateAttribution(): void {
  var el = document.getElementById('track-gate-breakdown'); if (!el) return;
  var log = getAccuracyLog().filter((e: any) => e.trigger);
  if (!log.length) { el.innerHTML = ''; return; }
  var by: Record<string, { c: number; t: number }> = {};
  log.forEach((e: any) => { var k = e.trigger; if (!by[k]) by[k] = { c: 0, t: 0 }; by[k].t++; if (e.correct) by[k].c++; });
  var order = ['pre-gate', 'gate0', 'gate1', 'gate5', 'corroboration', 'standard'];
  var rows = order.filter((k) => by[k]).map((k) => {
    var s = by[k]; var rate = Math.round((s.c / s.t) * 100);
    var color = rate >= 65 ? 'var(--green)' : rate >= 50 ? 'var(--amber)' : 'var(--red)';
    return `<div class="trigger-row"><span class="trigger-lbl">${TRIGGER_LABELS[k]}</span><span class="trigger-val" style="color:${color}">${rate}%</span><span class="trigger-sub">${s.c}/${s.t}</span></div>`;
  }).join('');
  el.innerHTML = '<div class="track-log-title" style="margin-top:12px">ACCURACY BY TRIGGER</div>' + rows;
}
function renderTickerAccuracy(): void {
  var el = document.getElementById('track-ticker-breakdown'); if (!el) return;
  var log = getAccuracyLog();
  if (!log.length) { el.innerHTML = ''; return; }
  var by: Record<string, { c: number; t: number }> = {};
  log.forEach((e: any) => { if (!by[e.ticker]) by[e.ticker] = { c: 0, t: 0 }; by[e.ticker].t++; if (e.correct) by[e.ticker].c++; });
  var rows = Object.entries(by).sort((a, b) => b[1].t - a[1].t).map(([ticker, s]) => {
    var rate = Math.round((s.c / s.t) * 100);
    var color = rate >= 65 ? 'var(--green)' : rate >= 50 ? 'var(--amber)' : 'var(--red)';
    return `<div class="trigger-row"><span class="trigger-lbl"><a class="ticker-a" href="${tickerHref(ticker)}" target="_blank">${ticker}</a></span><span class="trigger-val" style="color:${color}">${rate}%</span><span class="trigger-sub">${s.c}/${s.t}</span></div>`;
  }).join('');
  el.innerHTML = '<div class="track-log-title" style="margin-top:12px">ACCURACY BY TICKER</div>' + rows;
}
function refreshTrackRecordCard(): void { renderTrackRecord(); renderGateAttribution(); renderTickerAccuracy(); }

// ── PRO — Sector Heat Map ───────────────────────────────────────────
var HEATMAP_SECTORS: [string, string][] = [['spy', 'SPY'], ['qqq', 'QQQ'], ['iwm', 'IWM'], ['xbi', 'XBI'], ['soxx', 'SOXX'], ['tsm', 'TSM'], ['msft', 'MSFT'], ['btc', 'BTC'], ['gld', 'GLD'], ['uso', 'USO']];
var HEATMAP_MAX_PCT = 3;
function heatTileHtml(label: string, pct: number | null, ticker?: string): string {
  var tagAttr = ticker ? ` data-ticker="${ticker}"` : '';
  if (typeof pct !== 'number') return `<div class="heat-tile heat-tile-empty"${tagAttr}><span class="heat-tile-lbl"><a class="ticker-a" href="${tickerHref(label)}" target="_blank">${label}</a></span><span class="heat-tile-val">?</span></div>`;
  var intensity = Math.min(Math.abs(pct) / HEATMAP_MAX_PCT, 1);
  var rgb = pct >= 0 ? '0,230,118' : pct < 0 ? '255,59,92' : '96,125,139';
  var bg = `rgba(${rgb},${(0.08 + intensity * 0.32).toFixed(2)})`;
  var border = `rgba(${rgb},${(0.25 + intensity * 0.5).toFixed(2)})`;
  return `<div class="heat-tile" style="background:${bg};border-color:${border}"${tagAttr}><span class="heat-tile-lbl"><a class="ticker-a" href="${tickerHref(label)}" target="_blank">${label}</a></span><span class="heat-tile-val">${fmtPct(pct)}</span></div>`;
}
var heatMapGen = 0;
export async function renderHeatMap(force?: boolean): Promise<void> {
  var sectorEl = document.getElementById('heatmap-sectors');
  var wlEl = document.getElementById('heatmap-watchlist');
  if (!sectorEl || !wlEl) return;
  sectorEl.innerHTML = HEATMAP_SECTORS.map(([key, label]) => { var d = market && market[key]; return heatTileHtml(label, d && typeof d.pct === 'number' ? d.pct : null); }).join('');
  if (!watchlist.length) { wlEl.innerHTML = '<div class="track-empty">Watchlist is empty.</div>'; return; }

  var myGen = ++heatMapGen;
  wlEl.innerHTML = watchlist.map((t) => heatTileHtml(t, null, t)).join('');

  function paintTile(t: string, pct: number | null): void {
    if (myGen !== heatMapGen) return;
    var el = wlEl!.querySelector(`[data-ticker="${t}"]`);
    if (!el) return;
    el.outerHTML = heatTileHtml(t, pct, t);
  }

  await pillHydrationDone;
  if (myGen !== heatMapGen) return;

  var priority = cardWindow();
  var rest = overflowTickers();
  await Promise.all(priority.map(async (t) => { var td = await fetchTickerData(t, force); paintTile(t, td && td.metrics ? td.metrics.pct : null); }));
  rest.forEach((t) => { fetchTickerData(t, force).then((td) => paintTile(t, td && td.metrics ? td.metrics.pct : null)); });
}
export function refreshHeatMap(): void { renderHeatMap(true); }

// ── PRO — Export watchlist + cards as one CSV ────────────────────────
export async function exportWatchlistCSV(btnEl?: HTMLButtonElement): Promise<void> {
  if (!watchlist.length) return alert('Watchlist is empty — nothing to export.');
  var old: string | null = null;
  if (btnEl) { old = btnEl.textContent; btnEl.textContent = 'EXPORTING…'; btnEl.disabled = true; }
  var rows = await Promise.all(watchlist.map(async function (t, i) {
    var td = await fetchTickerData(t);
    var price = td && td.metrics && td.metrics.price != null ? td.metrics.price : '';
    var pct = td && td.metrics && typeof td.metrics.pct === 'number' ? td.metrics.pct.toFixed(2) : '';
    var iv = td && typeof (td as any).iv === 'number' ? ((td as any).iv * 100).toFixed(1) + '%' : 'N/A';
    return [t, i < CARD_CAP ? 'CARD' : 'WATCHLIST', price, iv, pct];
  }));
  var csvEsc = function (v: any): string { var s = String(v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  var csv = ([['Ticker', 'List', 'Price', 'IV', 'Change%']] as any[][]).concat(rows)
    .map(function (r) { return r.map(csvEsc).join(','); }).join('\r\n');
  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = 'trade-tribunal-watchlist-' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  if (btnEl) { btnEl.textContent = old; btnEl.disabled = false; }
}

// ── Session Context highlighting ───────────────────────────────────
var ctxDebounce: ReturnType<typeof setTimeout> | null = null;
function wireContextHighlight(): void {
  var ctxInputEl = document.getElementById('context-input');
  if (!ctxInputEl) return;
  ctxInputEl.addEventListener('input', function () {
    if (ctxDebounce) clearTimeout(ctxDebounce);
    ctxDebounce = setTimeout(() => { refreshRoloCards(); }, 250);
  });
}

// ── Market-closed enforcement ──────────────────────────────────────
function enforceMarketState(): void {
  if (isMarketClosed()) {
    const sym = cardWindow()[rolodex.getRoloCurrent()];
    if (sym && tickerState.has(sym)) renderRoloCard(sym);
  }
}

// ── Glossary ────────────────────────────────────────────────────────
interface GlossaryTerm { cat: string; term: string; def: string; ex?: string; }
var GLOSSARY: GlossaryTerm[] = [
  {cat:'CRF FRAMEWORK',term:'CRF (Catalyst Response Framework)',def:'A step-by-step checklist this app runs on a stock before giving you a verdict. If enough of the checklist looks good, that’s a thumbs up; if enough looks bad, that’s a thumbs down.',ex:'Think of it like a pre-flight checklist for a trade — pilots don’t take off until enough boxes are checked.'},
  {cat:'CRF FRAMEWORK',term:'Pre-Gate — Thesis Integrity',def:'A quick background check on the company itself, looking for red flags like financial trouble, before the app even looks at the stock’s price. A serious red flag here can override everything else.',ex:'Like checking a used car’s title for a salvage flag before you even look under the hood.'},
  {cat:'CRF FRAMEWORK',term:'Gate 0 — Sector Gate',def:'Checks how the overall stock market is doing today. If the whole market is having a bad day, that drags down the outlook for pretty much everything.',ex:'A rising tide lifts all boats — a sinking one drags them down too.'},
  {cat:'CRF FRAMEWORK',term:'Gate 1 — Bidirectional Trend Structure',def:'Looks at whether the stock has already made a big move recently, up or down. A stock that’s already run up a lot is riskier to chase, and one that’s fallen too far too fast is a red flag too.',ex:'Like being wary of a stock that already “ran” — you don’t want to be the last one to the party.'},
  {cat:'CRF FRAMEWORK',term:'Gate 2 — Catalyst Congruence',def:'Checks whether recent news about the company actually supports the direction the app is leaning.',ex:'Makes sure the story and the numbers are telling the same story.'},
  {cat:'CRF FRAMEWORK',term:'Gate 3 — Opening Bar',def:'Watches how the stock trades in the first few minutes after the market opens, since that early action often hints at where the rest of the day is headed.',ex:'Like judging a race by how strong the runners look at the starting gun.'},
  {cat:'CRF FRAMEWORK',term:'Gate 4 — Phase Identification',def:'Figures out whether a stock’s big move is just getting started, already well underway, or has gone so far it might be due for a pullback.',ex:'Early innings vs. late innings of the same game.'},
  {cat:'CRF FRAMEWORK',term:'Gate 5 — Dynamic Sector Proxy',def:'Compares the stock to other companies or funds in the same industry, to see if it’s moving with its peers or acting strangely on its own.',ex:'Checking if one kid in class is sick, or if the whole class has the flu.'},
  {cat:'CRF FRAMEWORK',term:'Proxy',def:'The specific peer stock, ETF, or index a ticker is measured against for Gate 5 — shown on each card as PROXY. If the ticker and its proxy are moving together, that confirms the read; if they diverge, Gate 5 treats it as a warning sign. See Proxy tier (Gate 5) for how confident the app is in this specific comparison.',ex:'IREN and CIFR are both checked against TSM, since Taiwan chip-supply stress hits the whole AI/semi trade the same way.'},
  {cat:'TICKER CLASSIFICATIONS',term:'Canary',def:'European or institutional base that prices macro risk early. When canaries fall while sentiment names rise, reversal is coming.',ex:'ASML fell before MU/ALAB. Warned 10-21 days early.'},
  {cat:'TICKER CLASSIFICATIONS',term:'Sentiment',def:'Moves most directly with AI capex or sector confidence, ignoring macro until it breaks.',ex:'MU, NVDA, AMD. Ran +47% into Broadcom miss then crashed 12.8%.'},
  {cat:'TICKER CLASSIFICATIONS',term:'Flow',def:'Moves on mechanical buying events. Institutions distribute at the opening bar on positive catalyst days.',ex:'ALAB opened $315 on Computex day, flushed to $292 in 30 min on 1.1M shares.'},
  {cat:'TICKER CLASSIFICATIONS',term:'Proxy tier (Gate 5)',def:'A label showing how confident the app is in the industry comparison it picked for this stock — some comparisons are well-tested, others are more of an educated guess.',ex:'Like the difference between a doctor’s confirmed diagnosis and an educated guess based on symptoms.'},
  {cat:'OPTIONS — GREEKS',term:'Delta (Δ)',def:'How much an option moves per $1 move in the stock. ATM options ~0.50. Also approximates probability of expiring in-the-money.',ex:'Delta 0.50 call gains $0.50 when stock rises $1.'},
  {cat:'OPTIONS — GREEKS',term:'Gamma (Γ)',def:'Rate of change of delta. High gamma = delta shifts rapidly. Options near expiry and ATM have highest gamma.',ex:'High-gamma option: $1 stock move shifts delta from 0.50 to 0.65.'},
  {cat:'OPTIONS — GREEKS',term:'Theta (Θ)',def:'Time decay per day. Sellers’ friend, buyers’ enemy. Accelerates in final 2 weeks before expiry.',ex:'$2.00 option with theta −0.05 loses $0.50 over 10 days even if stock flat.'},
  {cat:'OPTIONS — GREEKS',term:'Vega (ν)',def:'Sensitivity to implied volatility. Buying pre-earnings buys vega, but IV collapses after the event (IV crush).',ex:'Buy $3.00 pre-earnings, stock moves your way, IV drops 45pts → option now $1.80.'},
  {cat:'OPTIONS — CONCEPTS',term:'Implied Volatility (IV)',def:'Market’s expectation of future price movement, annualized. High IV = expensive options. Forward-looking, not historical.',ex:'ALAB IV ran 98-115% during parabolic phase. Selling premium more attractive than buying.'},
  {cat:'OPTIONS — CONCEPTS',term:'IV Rank (IVR)',def:'Where current IV sits vs past 52 weeks as a percentile. IVR >80 = Phase 3 signal in CRF.',ex:'IVR 85 = IV higher than 85% of readings this year → Gate 4 RED lean.'},
  {cat:'OPTIONS — CONCEPTS',term:'Put/Call Skew',def:'Difference between put IV and call IV at equal distance from current price. Positive skew = bearish institutional hedging.',ex:'CHAT showed consistent +4pt put skew → Gate 2 bearish lean.'},
  {cat:'OPTIONS — CONCEPTS',term:'Expected Move',def:'Market-implied 1-sigma price range by expiration. Stock stays within this range ~68% of the time.',ex:'Stock $50, ATM IV 80%, 30 DTE → expected move ±$12.30.'},
  {cat:'OPTIONS — CONCEPTS',term:'IV Crush',def:'Sharp drop in IV immediately after a catalyst. Options lose value even on correct direction.',ex:'Buy put pre-earnings $3.00. Stock drops 5% but IV collapses 55pts → put now $1.80.'},
  {cat:'OPTIONS — CONCEPTS',term:'Cash-Secured Put',def:'Selling a put while holding cash to buy shares at strike if assigned. Generates income on names you’d want to own.',ex:'ARCC at $18.50 → sell $18 put for $0.48. Assigned = effective buy at $17.52.'},
  {cat:'OPTIONS — CONCEPTS',term:'Gamma Exposure (GEX)',def:'Aggregate dollar impact of dealer hedging. Positive GEX = dealers dampen moves. Negative GEX = dealers amplify moves. Acts as a weighting overlay on Gate 0, not a pass/fail rule.',ex:'SPX negative GEX → Opening Drive gaps extend. Momentum more reliable.'},
  {cat:'MARKET STRUCTURE',term:'Opening Drive',def:'First 90 minutes (9:30-11:00am ET). Highest volume, highest volatility. Most institutional orders execute here. This app is built for this window.',ex:'Stock gaps up 3% with 2× average volume in bar 1 = Opening Drive setup.'},
  {cat:'MARKET STRUCTURE',term:'Gap Up / Gap Down',def:'Stock opens significantly different from prior close. CRF entry: gap ≥2% from prior close, enter at ask +1%.',ex:'SMMT closed $45, opens $47.50 = +5.5% gap. Check all gates.'},
  {cat:'MARKET STRUCTURE',term:'Engulfing Candle',def:'Second candle’s body completely contains the first. Bullish engulf = buyers overwhelmed sellers. Gate 3 uses this for Monday signals.',ex:'Monday bar 1 red at $40, bar 2 opens $38 closes $41 = bullish engulf → Gate 3 GREEN.'},
  {cat:'MARKET STRUCTURE',term:'Circuit Breaker',def:'Automatic trading halt when market falls a specified percentage. US halts at −7%, −13%, −20%. KOSPI at −8%.',ex:'KOSPI circuit breaker → Gate 5 RED for all AI/semi names via the Korea/Taiwan proxy exception.'},
  {cat:'MARKET STRUCTURE',term:'Short Squeeze',def:'Heavily shorted stock rises sharply, forcing shorts to buy to cover, pushing price higher. Brief but explosive.',ex:'IREN 18.7% short float, <2 days to cover. Any positive catalyst could trigger a squeeze.'},
  {cat:'SECTOR TERMS',term:'KOSPI',def:'Korea Composite Stock Price Index. Leading indicator for US AI/semi names. US names lag KOSPI crashes by 1-3 sessions.',ex:'KOSPI −6% Tuesday → NVDA/MU/ALAB pressure Thursday-Friday.'},
  {cat:'SECTOR TERMS',term:'TSM (Taiwan Semiconductor)',def:'World’s largest contract chip manufacturer. Single best proxy for global semiconductor health. TSM drop >3% = Gate 5 RED for all AI/semi names (Korea/Taiwan proxy exception — takes priority over the dynamic algorithm for this group).',ex:'TSM −4% → Taiwan semi stress → risk-off on AI/semi entries.'},
  {cat:'SECTOR TERMS',term:'XBI / IBB',def:'Biotech ETFs. XBI equal-weighted (smaller companies more impact). XBI is Gate 5’s fixed proxy for biotech/medical names.',ex:'XBI −2% → biotech risk-off → Gate 5 YELLOW or RED for SMMT/VCYT/IMVT.'},
  {cat:'SECTOR TERMS',term:'SOXX',def:'iShares Semiconductor ETF. Tracks 30 largest US-listed semiconductor companies. Best sector indicator for AI/chip trades.',ex:'SOXX −3% while SPY flat = semiconductor-specific stress.'},
  {cat:'SECTOR TERMS',term:'HBM (High Bandwidth Memory)',def:'RAM designed for AI training. Only Micron, Samsung, SK Hynix make it. Core of MU’s AI thesis.',ex:'Hyperscaler capex slowdown = HBM demand slowdown = MU pressure.'},
  {cat:'SECTOR TERMS',term:'Neocloud',def:'Companies renting GPU compute to AI developers. Borrow billions to buy Nvidia GPUs, rent at premium.',ex:'IREN, CoreWeave. Revenue real; profitability theoretical for most.'},
  {cat:'SECTOR TERMS',term:'BDC (Business Development Company)',def:'Fund making loans to mid-sized businesses, required to distribute 90%+ of income as dividends.',ex:'ARCC is the largest publicly traded BDC. Income from loan interest, not appreciation.'},
  {cat:'TRADING TERMINOLOGY',term:'Long',def:'Buying and owning shares expecting price to rise.',ex:'Buy 100 SMMT at $45. Sell at $50. $500 profit.'},
  {cat:'TRADING TERMINOLOGY',term:'Short / Short Selling',def:'Borrowing shares, selling immediately, buying back later. Profit if price falls. Loss if rises — theoretically unlimited.',ex:'Short 100 IREN at $40. Falls to $32 → $800 profit.'},
  {cat:'TRADING TERMINOLOGY',term:'Defined Risk',def:'Position where max loss is fixed at entry. Buying options or spreads. Cannot lose more than premium paid.',ex:'Buy 1 put for $200. Stock rallies. Max loss = $200.'},
  {cat:'TRADING TERMINOLOGY',term:'Stop Loss',def:'Pre-set price at which you automatically exit to limit losses. Set before entry. CRF: −3% for high-conviction names.',ex:'Enter SMMT at $45. Stop at $43.65 (−3%). Hit $43.65 → exit immediately.'},
  {cat:'TRADING TERMINOLOGY',term:'Sector Rotation',def:'Money moving from one sector to another. Sector pulse blurb tracks this daily.',ex:'AI fears → money rotates from NVDA into GLD and USO.'},
  {cat:'TRADING TERMINOLOGY',term:'Sell the News',def:'Stock falls after a positive catalyst because good news was already priced in. Phase 3 behavior.',ex:'ALAB beats Q1 by 12%. Stock drops 13% next day. Beat was priced in.'},
  {cat:'TRADING TERMINOLOGY',term:'14-Day Pre-Window',def:'14 trading days before a catalyst. Over +20% move in this window = Gate 1 RED (uptrend exhaustion branch).',ex:'MU ran +35% in 14 days before record earnings. Gate 1 RED. Sold off on the print.'},
  {cat:'TRADING TERMINOLOGY',term:'Pyramiding',def:'Adding to a winning position in smaller increments as it moves in your favor.',ex:'100 shares at $45. Rises to $47 → add 50. Hits $49 → add 25.'},
  {cat:'TRADING TERMINOLOGY',term:'GTC (Good Till Cancelled)',def:'Order that stays active until manually cancelled. Use for stop losses on multi-day holds.',ex:'GTC stop at $43.65 on SMMT triggers automatically even if it gaps down overnight.'},
  {cat:'OPTIONS — GREEKS',term:'Rho (ρ)',def:'Sensitivity to a 1% change in interest rates. Smallest of the four Greeks for short-dated options — matters on LEAPS-length duration, negligible for the Opening Drive holds this app is built around.',ex:'A 6-month call with Rho 0.15 gains ~$0.15 per 1% rate hike — a rounding error next to a same-day 3% move driven by Delta/Gamma.'},
  {cat:'OPTIONS — CONCEPTS',term:'Call Option',def:'Right (not obligation) to buy 100 shares at the strike price before expiration. Buyers profit if the stock rises above strike + premium paid.',ex:'Buy 1 SMMT $50 call for $2.00. Stock closes $55 at expiry → intrinsic value $5.00, profit $3.00/share.'},
  {cat:'OPTIONS — CONCEPTS',term:'Put Option',def:'Right (not obligation) to sell 100 shares at the strike price before expiration. Buyers profit if the stock falls below strike − premium paid.',ex:'Buy 1 IREN $35 put for $1.50. Stock drops to $30 at expiry → intrinsic value $5.00, profit $3.50/share.'},
  {cat:'OPTIONS — CONCEPTS',term:'Strike Price',def:'The fixed price at which an option’s owner can buy (call) or sell (put) the underlying. Set when the contract is created and never changes.',ex:'A $45 call and a $50 call on the same expiry are different contracts — the $45 strike is already in-the-money at a $47 stock price, the $50 strike is not.'},
  {cat:'OPTIONS — CONCEPTS',term:'DTE (Days to Expiration)',def:'Calendar days remaining until an option contract expires. Theta decay accelerates as DTE shrinks, especially inside the final 2 weeks.',ex:'A 30 DTE option loses value slowly. The same strike at 3 DTE bleeds premium daily even on a flat stock.'},
  {cat:'OPTIONS — CONCEPTS',term:'ITM / ATM / OTM',def:'In-the-money (has intrinsic value — call strike below spot, put strike above), at-the-money (strike ≈ spot), out-of-the-money (no intrinsic value yet, pure premium). Delta approximates the odds of finishing ITM.',ex:'Stock at $50: the $45 call is ITM, the $50 call is ATM, the $55 call is OTM.'},
  {cat:'TRADING TERMINOLOGY',term:'Bid / Ask (Bid-Ask Spread)',def:'Bid = highest price a buyer will pay right now. Ask = lowest price a seller will accept. The spread between them is a real, invisible cost — wider on illiquid names and thin extended-hours books.',ex:'IREN bid $39.98 / ask $40.05 — a market order to buy fills near $40.05, not the $40.00 last-trade price shown on the card.'},
  {cat:'TRADING TERMINOLOGY',term:'Limit Order',def:'An order that only fills at your specified price or better. Guarantees price, not execution — can go unfilled if the stock never trades there.',ex:'Limit buy SMMT at $45.00 while it’s trading $45.20 — sits unfilled until the price comes down to you (or never).'},
  {cat:'TRADING TERMINOLOGY',term:'Market Order',def:'An order that fills immediately at the best available price. Guarantees execution, not price — on a fast-moving or thin name you can pay meaningfully more than the last quote.',ex:'A market buy during a gap-up Opening Drive can fill 1-2% above the price you saw when you clicked.'},
  {cat:'TRADING TERMINOLOGY',term:'Ladder / Laddering',def:'Splitting one order into several smaller limit orders staggered across a price range instead of one order at one price. Improves average fill price on size that would otherwise move a thin book.',ex:'Instead of one 500-share market buy, ladder 100 shares each at $45.00/$45.10/$45.20/$45.30/$45.40.'},
  {cat:'MARKET STRUCTURE',term:'VWAP (Volume-Weighted Average Price)',def:'The running average price of a stock for the session, weighted by volume at each price. Resets daily. Widely used intraday as a fair-value line — price above VWAP favors longs, below favors shorts.',ex:'Stock pops to $52 but VWAP sits at $49.80 — a lot of the day’s volume already changed hands well below the current price.'},
  {cat:'MARKET STRUCTURE',term:'Relative Volume (RVOL)',def:'Current volume compared to the average volume for this point in the session. RVOL >2x on an Opening Drive gap is what separates a real institutional move from noise.',ex:'ALAB gaps up 4% on 1.1M shares in the first 5 minutes vs a normal 5-minute average of 280K → RVOL ~4x, high-conviction signal.'},
  {cat:'MARKET STRUCTURE',term:'Support / Resistance',def:'Price levels where a stock has historically reversed. Support = a floor buyers defended before. Resistance = a ceiling sellers defended before. Neither is guaranteed to hold twice.',ex:'PLUG bounced at $2.10 three times this quarter — that’s support until it isn’t; a close below it on volume is the tell it broke.'},
  {cat:'MARKET STRUCTURE',term:'Extended Hours (Pre-Market / Post-Market)',def:'Trading outside the 9:30am-4:00pm ET regular session: pre-market (4:00-9:30am ET) and post-market (4:00-8:00pm ET) on IEX Exchange’s formal extended sessions. Real prints, but on a much thinner book than the regular consolidated tape — moves here can reverse hard once the full tape opens.',ex:'CIFR prints $24.16 pre-market on light volume, opens the regular session at $22.10 once the full tape weighs in.'},
  {cat:'CRF FRAMEWORK',term:'Proxy Resolution Explorer',def:'A Pro-only panel where you can see which industry comparison the app picked for each stock on your watchlist, and how strong that comparison is.',ex:'A behind-the-scenes look at the “who’s this stock compared to” decision for every ticker you’re tracking.'},
  {cat:'CRF FRAMEWORK',term:'Sector Heat Map',def:'A Pro-only panel showing how different industries are doing today at a glance, so you can quickly spot which sectors are green and which are red.',ex:'Like a weather map, but for which parts of the stock market are stormy right now.'},
  {cat:'MARKET STRUCTURE',term:'Beta (β)',def:'A stock’s volatility relative to the overall market (SPY), where 1.0 = moves in line with the market, >1 amplifies market moves, <1 dampens them. Shown on each card as β. A negative beta means the stock tends to move opposite the market — treat it as effectively uncorrelated to its assigned Gate 5 proxy rather than confirming or denying that proxy read.',ex:'IREN at β2.1 is expected to move ~2.1% for every 1% SPY move. A rare β−0.3 name would be expected to drift up on a red SPY day.'},
  {cat:'MARKET STRUCTURE',term:'Intraday',def:'Within a single trading day — opened and evaluated before the next session begins, as opposed to a multi-day swing or long-term hold. This app’s entire CRF framework is built around intraday timing: the Opening Drive window, Gate 3’s same-day bar sequence, and same-day stop-loss discipline.',ex:'An intraday call on SMMT is graded against its move by that day’s close, not next week’s — Gate 3’s opening-bar sequence only exists because the framework is timing a single session.'},
  {cat:'CRF FRAMEWORK',term:'Verdict Icons — 👍 UP / 👎 DOWN / HOLD',def:'👍 means the app leans bullish (expects the stock to rise), 👎 means it leans bearish (expects it to fall), and HOLD means it’s not confident enough either way, or the market’s closed.',ex:'Simple as a thumbs up or thumbs down on a movie — just for a stock’s next move instead.'},
  {cat:'CRF FRAMEWORK',term:'Confidence',def:'How strongly the verdict’s own price action agrees with the trigger driving it. HIGH means both the ticker’s own move and its sector proxy’s move confirm the call. MEDIUM means the trigger is clean but there’s no independent price data to confirm or deny it yet. LOW means real price action is actually moving against the call — and every LOW-confidence verdict always ships a real “LOOK FOR” note explaining what to watch for before acting.',ex:'A DOWN verdict where the stock itself is also selling off hard is HIGH confidence. The same DOWN verdict on a stock that’s actually holding flat or ticking up is LOW — check the LOOK FOR note before acting.'},
  {cat:'TRADING TERMINOLOGY',term:'Ticker',def:'The short letter code (usually 1-5 letters) that identifies one specific stock or fund on an exchange, like IREN or SPY. What you type into Import to add a name to your watchlist.',ex:'MU, ALAB, and TSM are all tickers — three different companies, three different symbols.'},
];

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
// profile-menu link, below).
function ensureGlossaryOpen(): void {
  var card = document.getElementById('card-glossary') as HTMLElement | null;
  if (!card) return;
  if (!card.classList.contains('expanded')) expandCard(card);
  else rolodex.snapCardUnderDock(card);
}
// Profile-menu "ABOUT" link -- the Glossary's first category (CRF
// FRAMEWORK) is a plain-English walkthrough of the whole app (CRF,
// Pre-Gate, Gate 0-5), so jumping there IS the About page; no separate
// content to maintain. Clears any active search filter (so CRF FRAMEWORK
// isn't hidden behind a leftover query) before snapping the card into view.
function jumpToAbout(): void {
  var m = document.getElementById('profile-menu'); if (m) m.classList.remove('open');
  var search = document.getElementById('glossary-search') as HTMLInputElement | null;
  if (search) search.value = '';
  filterGlossary('');
  ensureGlossaryOpen();
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
// data-help id in pro/index.html). Heavy terminology inside links
// straight to the matching Glossary entry via jumpToGlossaryTerm() above.
const HELP_CONTENT: Record<string, string> = {
  gate: 'Live status for SPY/QQQ and the sector proxies every ticker is checked against — feeds <a class="help-glossary-link" href="#" data-term="gate 0">Gate 0</a> for each verdict. Every verdict also carries a <a class="help-glossary-link" href="#" data-term="confidence">Confidence</a> read — tap the docked bar to jump back to top. Pre/post-market prices are IEX-only and may vary from the full consolidated tape; built for regular-session (9:30am–4pm ET) analysis.',
  pulse: 'A quick AI-written read on today’s overall market mood and <a class="help-glossary-link" href="#" data-term="sector rotation">sector rotation</a> — informational only, doesn’t change any gate.',
  context: 'Type in real news or catalysts you already know. Matched against headlines as corroboration for Gate 2 — when it lines up with 2 of 3 real signals, it’s marked CONTEXT-CORROBORATED.',
  io: 'Paste or type <a class="help-glossary-link" href="#" data-term="ticker">tickers</a>, one per line or comma-separated, to add them to your watchlist — unlimited on Pro.',
  watchlist: 'Every <a class="help-glossary-link" href="#" data-term="ticker">ticker</a> beyond your top 15 pill cards. Tap + on any row to promote it into the main card window.',
  proxy: 'Which sector proxy each ticker is being checked against for <a class="help-glossary-link" href="#" data-term="gate 5">Gate 5</a>, and whether the two are still moving together right now.',
  heatmap: 'A color-coded snapshot of fixed sectors plus every ticker in your watchlist, sorted by % change.',
  track: 'Your logged verdict history — hit rate by gate trigger and by ticker. Log ✓ RIGHT / ✗ WRONG after the session closes to build a real accuracy record.',
};

// ── init ────────────────────────────────────────────────────────────
function initApp(): void {
  cleanLS();
  document.getElementById('ticker-count')!.textContent = 'CRF · ' + watchlist.length + ' TICKERS';
  wireContextHighlight();
  onPrefsChange(function () {
    refreshRoloCards(); renderMarketTs();
    refreshTickerLinks(document.getElementById('gateGrid'));
    refreshTickerLinks(gateMarquee);
  });
  fetchMarket();
  rolodex.sizeGateSpacer();
  renderRolodexFromWatchlist();
  refreshTrackRecordCard();
  setTimeout(fetchCreditStatus, 2000);
  setInterval(function () {
    fetchMarket();
    var proxyCard = document.querySelector('.card[data-card="proxy"]');
    if (proxyCard && proxyCard.classList.contains('expanded')) renderProxyExplorer();
    var heatCard = document.querySelector('.card[data-card="heatmap"]');
    if (heatCard && heatCard.classList.contains('expanded')) renderHeatMap();
  }, 4 * 60 * 1000);
  enforceMarketState();
  setInterval(enforceMarketState, 60 * 1000);
  if (sbSession && sbSession.email) {
    var pb = document.getElementById('profile-btn'); if (pb) pb.textContent = sbSession.email.charAt(0).toUpperCase();
    var pme = document.getElementById('profile-menu-email-text'); if (pme) pme.textContent = sbSession.email;
  }
}

async function checkTierAccess(session: any): Promise<boolean> {
  var expectedTier = 'pro';
  var err = document.getElementById('auth-error');
  if (session.tier !== expectedTier) {
    if (err) {
      (err as HTMLElement).style.color = 'var(--amber)';
      if (session.tier === 'free') {
        err.textContent = session.hasSubscribed
          ? 'Your PRO subscription is no longer active. Redirecting to free tier...'
          : 'No active PRO subscription. Redirecting to free tier...';
      } else {
        err.textContent = 'Redirecting to your ' + session.tier.toUpperCase() + ' tier...';
      }
    }
    setTimeout(function () {
      if (session.redirectUrl) { window.location.href = session.redirectUrl; }
      else { window.location.href = 'https://tradetribunal.app/'; }
    }, 1500);
    return false;
  }
  initWatchlistSync({ API_URL: API_URL, authH: authH, addSecret: addSecret });
  onWatchlistSave(function () { schedulePushWatchlist(); renderRolodexFromWatchlist(); });
  await pullWatchlistFromServer();
  initTrackRecordSync({ API_URL: API_URL, authH: authH, addSecret: addSecret });
  await pullTrackRecordFromServer();
  showScreen('app-root'); initApp();
  return true;
}

async function checkAuth(): Promise<void> {
  var stored = getStoredSession();
  if (!stored || !isSessionValid(stored)) { showScreen('auth-screen'); bindAuthEvents(); return; }
  sbSession = stored;
  try {
    var r = await fetch(API_URL + '/auth/me?supabase_token=' + encodeURIComponent(stored.token));
    if (r.ok) {
      var fresh = await r.json();
      if (fresh.tier) {
        stored.tier = fresh.tier;
        stored.hasSubscribed = !!fresh.hasSubscribed;
        var URLS: Record<string, string> = { free: 'https://tradetribunal.app/', starter: 'https://tradetribunal.app/starter/', pro: 'https://tradetribunal.app/pro/', shark: 'https://tradetribunal.app/shark/' };
        stored.redirectUrl = URLS[fresh.tier] || URLS.free;
        storeSession(stored);
        sbSession = stored;
      }
    }
  } catch (e) { }
  checkTierAccess(stored);
  bindAuthEvents();
}

initWatchlist({ defaultTickers: ['SMMT', 'VCYT', 'TWST', 'IMVT', 'IREN', 'ALAB', 'MU'], maxTickers: 999, upgradeMessage: 'Pro supports unlimited tickers already — this cap should never be hit.' });
initTickerCache({ API_URL: API_URL, authH: authH, addSecret: addSecret });

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
  getWatchlist: cardWindow,
  onActivate: (sym) => {
    const state = tickerState.get(sym);
    if (state && !state.result && !state.analyzing) analyzeOne(sym);
  },
  onDeleteConfirmed: deleteActiveTicker,
});
rolodex.initHelpBalloons(HELP_CONTENT, jumpToGlossaryTerm);

checkAuth();

document.getElementById('analyzeAllBtn')!.addEventListener('click', analyzeAll);
document.getElementById('importBtn')!.addEventListener('click', addTickers);
document.getElementById('exportCsvBtn')!.addEventListener('click', () => exportWatchlistCSV(document.getElementById('exportCsvBtn') as HTMLButtonElement));
document.getElementById('clearTrackBtn')!.addEventListener('click', () => { clearLog(); refreshTrackRecordCard(); });
document.getElementById('compact-sort-btn')!.addEventListener('click', toggleCompactSort);
document.getElementById('proxy-sort-level')!.addEventListener('click', () => setProxySort('level'));
document.getElementById('proxy-sort-coherence')!.addEventListener('click', () => setProxySort('coherence'));
document.getElementById('proxy-refresh-btn')!.addEventListener('click', (e) => { e.stopPropagation(); refreshProxyExplorer(); });
document.getElementById('heatmap-refresh-btn')!.addEventListener('click', (e) => { e.stopPropagation(); refreshHeatMap(); });

declare global {
  interface Window {
    authLogout: typeof authLogout;
    toggleProfileMenu: typeof toggleProfileMenu;
    jumpToAbout: typeof jumpToAbout;
  }
}
window.authLogout = authLogout;
window.toggleProfileMenu = toggleProfileMenu;
window.jumpToAbout = jumpToAbout;
