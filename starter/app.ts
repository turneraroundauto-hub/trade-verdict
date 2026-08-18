// Starter tier, rebuilt onto the Rolodex UI (Aug 16, 2026) -- the sticky-
// docking Gate card, ticker pill strip with marquee, and single-active-
// card stage from preview/rolodex/, wired to Starter's real, already-
// correct backend integration: real auth/tier gating, real credit-
// consuming /analyze, real Settings/prefs, real Session Context
// highlighting, real server-synced watchlist. Nothing about the real
// data/auth/credit pipeline changed in this rebuild -- only the
// watchlist's visual representation did.
//
// Converted to .ts and bundled (Aug 16, 2026, Phase 3 of the TypeScript
// adoption plan) -- the Rolodex UI mechanics (Gate dock/marquee, pill
// marquee, stacked-card positioning, swipe-to-delete) moved out to
// shared/rolodex.ts so Free/Pro's own eventual Rolodex builds can import
// the same proven module instead of hand-copying ~500 lines the way this
// file originally did. This file keeps everything that's genuinely
// Starter-specific: real auth/tier gating, the real /analyze request
// body, TIER config, and all card-content rendering (roloCardHTML etc.)
// -- see shared/rolodex.ts's own header comment for the exact scope
// boundary and why it's drawn there.
//
// Real (unversioned) imports throughout -- esbuild resolves and inlines
// these at build time (see esbuild.config.mjs), including transparently
// stripping the ?v=N suffix every existing shared/*.ts file's own
// internal imports still carry (confirmed empirically before this
// conversion, not assumed). The emitted, committed starter/app.js is the
// real bundle -- browsers never load this .ts file directly.
import { initTickerCache, fetchTickerData } from '../shared/ticker-cache';
import { initWatchlist, watchlist, addTickers, removeTicker, onWatchlistSave } from '../shared/watchlist';
import { cleanLS, cacheVerdict, getCachedVerdict } from '../shared/analysis-cache';
import { initWatchlistSync, pullWatchlistFromServer, schedulePushWatchlist } from '../shared/watchlist-sync';
import { getTzPref, getTzIana, onPrefsChange, tickerHref, newsHref, refreshTickerLinks } from '../shared/prefs';
import { highlightContextMatches } from '../shared/context-highlight';
import '../shared/settings-modal';
import * as rolodex from '../shared/rolodex';
import type { AnalyzeResponse, TickerData } from '../shared/types.js';

const API_URL = 'https://tra-zacg.onrender.com';

const TIER = {
  name:         'Starter',
  maxTickers:   7,
  pulse:        true,
  tracker:      false,
  alpaca:       false,
  credits:      '45 credits/mo',
  cache:        '5 min cache',
  nextTier:     "Pro",
  nextPrice:    "$16.99/mo",
  stripeLink:   "https://buy.stripe.com/6oU4gA98t57p4dh2x33VC02",
  creditsLink:  'https://buy.stripe.com/3cI3cwacxarJ8txb3z3VC00',
  badgeColor:   '#40c4ff',
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
export function promptLogResults(): void {
  var m = document.getElementById('profile-menu'); if (m) m.classList.remove('open');
  if (confirm('Log Results tracks your win/loss outcomes over time — available on Pro.\n\nUpgrade now?')) {
    window.open(TIER.stripeLink, '_blank');
  }
}

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

// Every ticker symbol shown anywhere in the app links out via tickerHref()
// (rule: all ticker symbols are hyperlinked, not just ones inside a card).
// BTC is displayed bare but tickerHref()/Yahoo's own convention need the
// real symbol (BTC-USD) — same override Free/Pro's static Gate markup
// already hardcodes for their BTC tile (see shared/prefs.ts's own comment).
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
  const marketLabel = closed ? 'MARKET CLOSED' : 'MARKET OPEN';
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

// ── Utility card accordion (Pulse/Context/Import) ─────────────────────
function wireAccordionHead(head: Element): void {
  function toggle(): void {
    const card = head.closest('.card') as HTMLElement;
    const wasExpanded = card.classList.contains('expanded');
    card.classList.toggle('expanded', !wasExpanded);
    head.setAttribute('aria-expanded', String(!wasExpanded));
    if (!wasExpanded) rolodex.snapCardUnderDock(card);
  }
  head.addEventListener('click', toggle);
  head.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') { e.preventDefault(); toggle(); } });
}
document.querySelectorAll('.card[data-card] > .card-head').forEach(wireAccordionHead);

// ── Rolodex: real ticker data, real /analyze ─────────────────────────
const roloStage = document.getElementById('roloStage') as HTMLElement;
const roloIndex = document.getElementById('roloIndex') as HTMLElement;

interface TickerState { td: TickerData | null; result: AnalyzeResponse | null; analyzing: boolean; error: string | null; }
/** ticker -> { td, result, analyzing, error } */
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
// both the CONFIDENCE row and the "LOOK FOR" strip's dot, so the two
// never drift into disagreeing about what a given confidence level means.
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

function logSectionHTML(): string {
  return '<div class="log-row"><span class="log-prompt">TRACK RECORD</span><a class="log-upgrade-btn" href="https://buy.stripe.com/6oU4gA98t57p4dh2x33VC02" target="_blank">UPGRADE → Pro to log results</a></div>';
}

function gateListHTML(result: AnalyzeResponse | null): string {
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
    return `<div class="gate-row"><div class="gate-row-head"><span class="gate-dot" style="background:${sigColor(gate.status)}"></span><span class="gl">${label}</span></div>`
      + (gate.note ? `<div class="gn">${gate.note}</div>` : '') + '</div>';
  }).join('');
  const conf = `<div class="conf-row"><span class="conf-lbl">CONFIDENCE</span><span class="conf-val" style="color:${confColor(result.confidence)}">${result.confidence || ''}</span></div>`;
  return '<div class="gate-list">' + rows + logSectionHTML() + conf + '</div>';
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
  // Only hyperlink when the proxy resolves to exactly one real symbol --
  // a combined multi-symbol rule (e.g. TSM + KOSPI) has no single linkable
  // ticker behind its display name, and KOSPI itself isn't a US-tradable
  // symbol tickerHref() can route correctly.
  const proxySymbols: string[] = td && td.proxyRule && td.proxyRule.proxy && Array.isArray(td.proxyRule.proxy.symbols) ? td.proxyRule.proxy.symbols : [];
  const proxyHTML = proxySymbols.length === 1
    ? `<a href="${tickerHref(proxySymbols[0])}" target="_blank">${proxyName}</a>`
    : proxyName;
  const analyzing = state.analyzing;
  const result = state.result;
  const dir = priceDirClass(td);
  return `<div class="ticker-row">`
    + `<div class="ticker-left"><span class="ticker-sym ${dir}"><a href="${tickerHref(sym)}" target="_blank">${sym}</a></span><span class="ticker-price ${dir}">${price}</span></div>`
    + '<div class="ticker-action">'
    + (result ? verdictAreaHTML(sym, result)
      : `<button class="btn btn-blue btn-compact" data-analyze="${sym}" ${analyzing ? 'disabled' : ''}>${analyzing ? 'RUNNING…' : 'ANALYZE'}</button>`)
    + '</div>'
    + `</div>`
    + pregateStripHTML(result)
    + `<div class="headline"><a href="${newsHref(sym)}" target="_blank">${headline}</a> <span class="age">${age}</span></div>`
    + `<div class="meta-row"><span>52W <b>${w52}</b></span><span>PHASE <b>${phase}</b></span><span>β <b>${beta}</b></span><span>PROXY <b style="color:var(--blue)">${proxyHTML}</b></span></div>`
    + badgesHTML(result)
    + gateListHTML(result)
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

// ── Build/rebuild the rolodex from the current (real, server-synced)
// watchlist. Called on init and after every watchlist mutation via the
// composed onWatchlistSave hook. ──────────────────────────────────────
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
  }, `— ${watchlist.length} —`);
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

// Re-renders every currently-instantiated card's headline (Session
// Context highlight changed) or link/price display (link-site pref
// changed) from already-cached data -- no new network calls.
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
    state.result = _r; state.analyzing = false;
    renderRoloCard(sym); renderPill(sym);
    fetchCreditStatus();
  } catch (e: any) {
    state.analyzing = false; state.error = e.message;
    renderRoloCard(sym); renderPill(sym);
  }
}

function analyzeAll(): void { watchlist.forEach((sym) => analyzeOne(sym)); }
document.getElementById('analyzeAllBtn')!.addEventListener('click', analyzeAll);
document.getElementById('importBtn')!.addEventListener('click', addTickers);

// ── Export watchlist as CSV (profile-menu, per the original plan flagged
// during the Rolodex prototype work: Export moves out of the Import card
// and into the profile badge dropdown). Starter has no card/list split
// (every ticker in the 7-cap watchlist is already a full card, unlike
// Pro's 15-card window) and no IV entitlement (tierConfig.iv is Pro+Shark
// only) -- so this is a plain Ticker/Price/Change% export of the full
// watchlist, not a copy of Pro's Ticker/List/Price/IV/Change% shape. ──
export async function exportWatchlistCSV(btnEl?: HTMLButtonElement): Promise<void> {
  if (!watchlist.length) return alert('Watchlist is empty — nothing to export.');
  var old: string | null = null;
  if (btnEl) { old = btnEl.textContent; btnEl.textContent = 'EXPORTING…'; btnEl.disabled = true; }
  var rows = await Promise.all(watchlist.map(async function (t) {
    var td = await fetchTickerData(t);
    var price = td && td.metrics && td.metrics.price != null ? td.metrics.price : '';
    var pct = td && td.metrics && typeof td.metrics.pct === 'number' ? td.metrics.pct.toFixed(2) : '';
    return [t, price, pct];
  }));
  var csvEsc = function (v: any): string { var s = String(v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  var csv = ([['Ticker', 'Price', 'Change%']] as any[][]).concat(rows)
    .map(function (r) { return r.map(csvEsc).join(','); }).join('\r\n');
  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = 'trade-tribunal-watchlist-' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  if (btnEl) { btnEl.textContent = old; btnEl.disabled = false; }
}

// ── NO CREDITS ────────────────────────────────────────────────────
function handleNoCredits(sym: string): void {
  const state = tickerState.get(sym)!;
  const cached = getCachedVerdict(sym);
  if (cached) {
    state.result = cached; state.error = null;
    renderRoloCard(sym);
    const card = roloStage.querySelector(`.rolo-card[data-sym="${sym}"]`);
    if (card) {
      const n = document.createElement('div');
      n.style.cssText = 'font-family:var(--mono);font-size:8px;color:var(--amber);text-align:center;margin-top:4px';
      n.textContent = 'Cached — no credits remaining';
      card.appendChild(n);
    }
    return;
  }
  state.error = 'No credits remaining — buy more or upgrade to Pro.';
}

// ── Session Context highlighting ───────────────────────────────────
var ctxDebounce: ReturnType<typeof setTimeout> | null = null;
function wireContextHighlight(): void {
  var ctxInputEl = document.getElementById('context-input');
  if (!ctxInputEl) return;
  ctxInputEl.addEventListener('input', function () {
    if (ctxDebounce) clearTimeout(ctxDebounce);
    ctxDebounce = setTimeout(refreshRoloCards, 250);
  });
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
  {cat:'CRF FRAMEWORK',term:'Pre-Gate — Thesis Integrity',def:'A quick background check on the company itself, looking for red flags like financial trouble, before the app even looks at the stock’s price. A serious red flag here can override everything else.',ex:'Like checking a used car’s title for a salvage flag before you even look under the hood.'},
  {cat:'CRF FRAMEWORK',term:'Gate 0 — Sector Gate',def:'Checks how the overall stock market is doing today. If the whole market is having a bad day, that drags down the outlook for pretty much everything.',ex:'A rising tide lifts all boats — a sinking one drags them down too.'},
  {cat:'CRF FRAMEWORK',term:'Gate 1 — Bidirectional Trend Structure',def:'Looks at whether the stock has already made a big move recently, up or down. A stock that’s already run up a lot is riskier to chase, and one that’s fallen too far too fast is a red flag too.',ex:'Like being wary of a stock that already “ran” — you don’t want to be the last one to the party.'},
  {cat:'CRF FRAMEWORK',term:'Gate 2 — Catalyst Congruence',def:'Checks whether recent news about the company actually supports the direction the app is leaning.',ex:'Makes sure the story and the numbers are telling the same story.'},
  {cat:'CRF FRAMEWORK',term:'Gate 3 — Opening Bar',def:'Watches how the stock trades in the first few minutes after the market opens, since that early action often hints at where the rest of the day is headed.',ex:'Like judging a race by how strong the runners look at the starting gun.'},
  {cat:'CRF FRAMEWORK',term:'Gate 4 — Phase Identification',def:'Figures out whether a stock’s big move is just getting started, already well underway, or has gone so far it might be due for a pullback.',ex:'Early innings vs. late innings of the same game.'},
  {cat:'CRF FRAMEWORK',term:'Gate 5 — Dynamic Sector Proxy',def:'Compares the stock to other companies or funds in the same industry, to see if it’s moving with its peers or acting strangely on its own.',ex:'Checking if one kid in class is sick, or if the whole class has the flu.'},
  {cat:'TICKER CLASSIFICATIONS',term:'Canary',def:'European or institutional base that prices macro risk early. When canaries fall while sentiment names rise, reversal is coming.',ex:'ASML fell before MU/ALAB. Warned 10-21 days early.'},
  {cat:'TICKER CLASSIFICATIONS',term:'Sentiment',def:'Moves most directly with AI capex or sector confidence, ignoring macro until it breaks.',ex:'MU, NVDA, AMD. Ran +47% into Broadcom miss then crashed 12.8%.'},
  {cat:'TICKER CLASSIFICATIONS',term:'Flow',def:'Moves on mechanical buying events. Institutions distribute at the opening bar on positive catalyst days.',ex:'ALAB opened $315 on Computex day, flushed to $292 in 30 min on 1.1M shares.'},
  {cat:'TICKER CLASSIFICATIONS',term:'Phase 1 / 2 / 3',def:'Phase 1 = discovery, <30% of 52-week range, full size. Phase 2 = acceleration, 30-70%, half size. Phase 3 = priced for perfection, >70%, post-flush only.',ex:'ALAB at $88 = Phase 1. At $300 = Phase 2. At $450 = Phase 3 (sold off on blowout beat).'},
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
  {cat:'OPTIONS — CONCEPTS',term:'Gamma Exposure (GEX)',def:'Aggregate dollar impact of dealer hedging. Positive GEX = dealers dampen moves. Negative GEX = dealers amplify moves.',ex:'SPX negative GEX → Opening Drive gaps extend. Momentum more reliable.'},
  {cat:'MARKET STRUCTURE',term:'Opening Drive',def:'First 90 minutes (9:30-11:00am ET). Highest volume, highest volatility. Most institutional orders execute here. This app is built for this window.',ex:'Stock gaps up 3% with 2× average volume in bar 1 = Opening Drive setup.'},
  {cat:'MARKET STRUCTURE',term:'Gap Up / Gap Down',def:'Stock opens significantly different from prior close. CRF entry: gap ≥2% from prior close, enter at ask +1%.',ex:'SMMT closed $45, opens $47.50 = +5.5% gap. Check all 5 gates.'},
  {cat:'MARKET STRUCTURE',term:'Engulfing Candle',def:'Second candle’s body completely contains the first. Bullish engulf = buyers overwhelmed sellers. Gate 3 uses this for Monday signals.',ex:'Monday bar 1 red at $40, bar 2 opens $38 closes $41 = bullish engulf → Gate 3 GREEN.'},
  {cat:'MARKET STRUCTURE',term:'Circuit Breaker',def:'Automatic trading halt when market falls a specified percentage. US halts at −7%, −13%, −20%. KOSPI at −8%.',ex:'KOSPI circuit breaker June 8 2026 at −8.37% → Gate 5 RED for all AI/semi.'},
  {cat:'MARKET STRUCTURE',term:'Short Squeeze',def:'Heavily shorted stock rises sharply, forcing shorts to buy to cover, pushing price higher. Brief but explosive.',ex:'IREN 18.7% short float, <2 days to cover. Any positive catalyst could trigger a squeeze.'},
  {cat:'SECTOR TERMS',term:'KOSPI',def:'Korea Composite Stock Price Index. Leading indicator for US AI/semi names. US names lag KOSPI crashes by 1-3 sessions.',ex:'KOSPI −6% Tuesday → NVDA/MU/ALAB pressure Thursday-Friday.'},
  {cat:'SECTOR TERMS',term:'TSM (Taiwan Semiconductor)',def:'World’s largest contract chip manufacturer. Single best proxy for global semiconductor health. TSM drop >3% = Gate 5 RED for all AI/semi names.',ex:'TSM −4% → Taiwan semi stress → risk-off on AI/semi entries.'},
  {cat:'SECTOR TERMS',term:'XBI / IBB',def:'Biotech ETFs. XBI equal-weighted (smaller companies more impact). XBI is Gate 5 proxy for biotech/medical names.',ex:'XBI −2% → biotech risk-off → Gate 5 YELLOW or RED for SMMT/VCYT/IMVT.'},
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
  {cat:'TRADING TERMINOLOGY',term:'14-Day Pre-Window',def:'14 trading days before a catalyst. Over +20% move in this window = Gate 1 RED (exhaustion).',ex:'MU ran +35% in 14 days before record earnings. Gate 1 RED. Sold off on the print.'},
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
function setGlossaryOpen(open: boolean): void {
  var panel = document.getElementById('glossary-panel')!;
  var arrow = document.getElementById('glossary-arrow')!;
  var header = document.getElementById('glossary-header')!;
  panel.classList.toggle('open', open);
  arrow.classList.toggle('open', open);
  header.classList.toggle('open', open);
  if (open) buildGlossary();
}
function toggleGlossary(): void {
  var panel = document.getElementById('glossary-panel')!;
  setGlossaryOpen(!panel.classList.contains('open'));
}
// Opens the Glossary (if closed), clears any active search filter so the
// term can't be hidden by it, then scrolls the matching entry into view
// and flashes it -- the "screen jump" a help-balloon glossary link
// triggers. Matches by substring against the same lowercase data-term
// text filterGlossary() already searches, so no separate id/slug needs
// keeping in sync with the GLOSSARY array above.
function jumpToGlossaryTerm(key: string): void {
  setGlossaryOpen(true);
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
document.getElementById('glossary-header')!.addEventListener('click', toggleGlossary);
document.getElementById('glossary-search')!.addEventListener('input', (e) => filterGlossary((e.target as HTMLInputElement).value));

// ── Card-header help balloons ──────────────────────────────────────────
// Short, keep-it-to-a-glance copy per "(?)" button (keyed by its
// data-help id in starter/index.html). Heavy terminology inside links
// straight to the matching Glossary entry via roloGlossaryJump() below.
const HELP_CONTENT: Record<string, string> = {
  gate: 'Live status for SPY/QQQ and the sector proxies every ticker is checked against — feeds <a class="help-glossary-link" href="#" data-term="gate 0">Gate 0</a> for each verdict. Every verdict also carries a <a class="help-glossary-link" href="#" data-term="confidence">Confidence</a> read — tap the docked bar to jump back to top.',
  pulse: 'A quick AI-written read on today’s overall market mood and <a class="help-glossary-link" href="#" data-term="sector rotation">sector rotation</a> — informational only, doesn’t change any gate.',
  context: 'Type in real news or catalysts you already know. Matched against headlines as corroboration for Gate 2 — when it lines up with 2 of 3 real signals, it’s marked CONTEXT-CORROBORATED.',
  io: 'Paste or type <a class="help-glossary-link" href="#" data-term="ticker">tickers</a>, one per line or comma-separated, to add them to your watchlist.',
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
  setTimeout(fetchCreditStatus, 2000);
  setInterval(function () { fetchMarket(); }, 4 * 60 * 1000);
  enforceMarketState();
  setInterval(enforceMarketState, 60 * 1000);
  if (sbSession && sbSession.email) {
    var pb = document.getElementById('profile-btn'); if (pb) pb.textContent = sbSession.email.charAt(0).toUpperCase();
    var pme = document.getElementById('profile-menu-email'); if (pme) pme.textContent = sbSession.email;
  }
}

async function checkTierAccess(session: any): Promise<boolean> {
  var expectedTier = 'starter';
  var err = document.getElementById('auth-error');
  if (session.tier !== expectedTier) {
    if (err) {
      (err as HTMLElement).style.color = 'var(--amber)';
      if (session.tier === 'free') {
        err.textContent = session.hasSubscribed
          ? 'Your STARTER subscription is no longer active. Redirecting to free tier...'
          : 'No active STARTER subscription. Redirecting to free tier...';
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

initWatchlist({ defaultTickers: ['SMMT', 'VCYT', 'TWST', 'IMVT', 'IREN', 'ALAB', 'MU'], maxTickers: 7, upgradeMessage: 'Starter tier supports up to 7 tickers.\n\nUpgrade to Pro for more.' });
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
  getWatchlist: () => watchlist,
  onActivate: (sym) => {
    const state = tickerState.get(sym);
    if (state && !state.result && !state.analyzing) analyzeOne(sym);
  },
  onDeleteConfirmed: deleteActiveTicker,
});
rolodex.initHelpBalloons(HELP_CONTENT, jumpToGlossaryTerm);

checkAuth();

declare global {
  interface Window {
    authLogout: typeof authLogout;
    toggleProfileMenu: typeof toggleProfileMenu;
    promptLogResults: typeof promptLogResults;
    exportWatchlistCSV: typeof exportWatchlistCSV;
  }
}
window.authLogout = authLogout;
window.toggleProfileMenu = toggleProfileMenu;
window.promptLogResults = promptLogResults;
window.exportWatchlistCSV = exportWatchlistCSV;
