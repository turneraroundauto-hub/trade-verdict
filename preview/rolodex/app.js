// Rolodex UI preview — real backend, real data, but 100% isolated from
// shared/watchlist.js's rendering (see CLAUDE.md's "/preview/ subpath
// convention"). Deliberately NOT imported by any tier's real app.js and
// not linked from any tier's nav — this file is only ever reached by
// someone opening /preview/rolodex/ directly.
//
// Reuses shared/ticker-cache.js (pure data-fetching, no DOM coupling) --
// safe, same as every tier does. Everything else (watchlist state,
// rendering, the rolodex/dock/marquee mechanics) is self-contained here
// so this preview can never drift shared/watchlist.js's behavior for a
// real tier, and a real tier's changes can never silently break this
// preview either.
import { initTickerCache, fetchTickerData } from '../../shared/ticker-cache.js?v=4';

const API_URL = 'https://tra-zacg.onrender.com';
const APP_SECRET = 'Holysmoke42!';
const MAX_TICKERS = 3; // matches Free tier's real cap
const DEFAULT_TICKERS = ['MU', 'IREN', 'ALAB'];

function getStoredSession(){ try{ return JSON.parse(localStorage.getItem('tv_session')||'null'); }catch(e){ return null; } }
function isSessionValid(s){ if(!s||!s.token) return false; if(s.expiresAt && Date.now()/1000 > s.expiresAt-60) return false; return true; }
let sbSession = isSessionValid(getStoredSession()) ? getStoredSession() : null;

function authH(){ return sbSession && sbSession.token ? {'Content-Type':'application/json','x-supabase-token':sbSession.token} : {'Content-Type':'application/json','x-app-secret':APP_SECRET}; }
function addSecret(url){ const sep = url.includes('?') ? '&' : '?'; if(sbSession && sbSession.token) return url+sep+'supabase_token='+encodeURIComponent(sbSession.token); return url+sep+'secret='+encodeURIComponent(APP_SECRET); }

initTickerCache({ API_URL, authH, addSecret });

// A signed-in paid-tier session sharing this browser owns the real tv_wl
// watchlist key — Free's 3-ticker cap silently truncating it (the exact
// corruption class documented in CLAUDE.md's "redirectingToPaidTier"
// note) is a real risk. This preview never redirects away (the whole
// point is to actually show the UI), but when a paid session is present
// it uses the Free defaults in-memory only and never touches
// localStorage — real /analyze calls still use the real signed-in
// account, only the watchlist itself is sandboxed.
const storedSession = getStoredSession();
const paidSessionPresent = !!(storedSession && storedSession.tier && storedSession.tier !== 'free');

let watchlist = [];
function loadWatchlist(){
  if(paidSessionPresent){ watchlist = DEFAULT_TICKERS.slice(); return; }
  try{
    let wl = JSON.parse(localStorage.getItem('tv_wl') || JSON.stringify(DEFAULT_TICKERS));
    if(wl.length > MAX_TICKERS) wl = wl.slice(0, MAX_TICKERS);
    watchlist = wl;
  }catch(e){ watchlist = DEFAULT_TICKERS.slice(); }
}
function saveWatchlist(){
  if(paidSessionPresent) return;
  localStorage.setItem('tv_wl', JSON.stringify(watchlist));
}

function updateAuthButton(){
  const btn = document.getElementById('auth-action-btn');
  if(isSessionValid(getStoredSession())){
    btn.textContent = 'SIGN OUT';
    btn.href = 'javascript:void(0)';
    btn.onclick = (e)=>{ e.preventDefault(); localStorage.removeItem('tv_session'); updateAuthButton(); };
  } else {
    btn.innerHTML = '🔒 SIGN UP / SIGN IN';
    btn.href = 'https://tradetribunal.app/starter/';
    btn.onclick = null;
  }
}

async function fetchCreditStatus(){
  try{
    const res = await fetch(addSecret(API_URL+'/status'), { headers: authH() });
    const data = await res.json();
    const el = document.getElementById('credits-btn');
    if(data.totalCredits === undefined) return;
    const loggedIn = !!(sbSession && sbSession.token);
    el.textContent = (data.totalCredits > 0 ? data.totalCredits : '+') + (loggedIn ? ' CREDITS' : ' CREDITS · WK');
    el.href = loggedIn ? 'https://buy.stripe.com/3cI3cwacxarJ8txb3z3VC00' : 'https://tradetribunal.app/starter/';
  }catch(e){}
}

// ── GATE 0 (market) ─────────────────────────────────────────────────
const GATE_FIELDS = [
  ['spy','SPY'], ['qqq','QQQ'], ['btc','BTC'], ['soxx','SOXX'], ['xbi','XBI'],
  ['iwm','IWM'], ['gld','GLD'], ['uso','USO'], ['tsm','TSM'], ['msft','MSFT'],
];
function sigColor(s){ return { GREEN:'var(--green)', RED:'var(--red)', YELLOW:'var(--amber)' }[s] || 'var(--ink-dim)'; }
function dirClass(d){ return d === 'green' ? 'up' : d === 'red' ? 'down' : d === 'flat' ? 'flat' : 'neutral'; }

let market = null;
async function fetchMarket(){
  try{
    const res = await fetch(API_URL+'/market', { headers: authH() });
    market = await res.json();
  }catch(e){ market = null; }
  renderGate();
  buildGateMarquee();
  // The overlay starts small (empty grid, placeholder text) and grows once
  // real market data populates the 3x4 grid -- sizeGateSpacer() must
  // re-run against the real content height, or the spacer under-reserves
  // scroll room and the now-taller overlay visually (and interactively)
  // covers whatever sits below it, same class of bug CLAUDE.md's
  // collapsing-card notes warn about (measure real rendered height, not
  // an assumed one). requestAnimationFrame so layout has settled first.
  requestAnimationFrame(sizeGateSpacer);
}

function renderGate(){
  const status = (market && market.gateStatus) || 'GREEN';
  const color = sigColor(status);
  document.getElementById('gateMiniDot').style.background = color;
  document.getElementById('gateMiniLabel').textContent = status + ' GATE';
  document.getElementById('gateMiniLabel').style.color = color;
  document.getElementById('gateFullDot').style.background = color;
  document.getElementById('gateFullLabel').textContent = status + ' Gate';
  document.getElementById('gateFullLabel').style.color = color;
  document.getElementById('gateNote').textContent = (market && market.gateNote) || (market ? '' : 'Tap to retry — data unavailable.');

  const grid = document.getElementById('gateGrid');
  grid.innerHTML = GATE_FIELDS.map(([key, label])=>{
    const d = market && market[key];
    const val = (!d || d.change === '?') ? '?' : d.change;
    const cls = (!d || d.change === '?') ? 'neutral' : dirClass(d.direction);
    return `<div class="gate-stat"><div class="k">${label}</div><div class="v ${cls}">${val}</div></div>`;
  }).join('');
}

const gateMarquee = document.getElementById('gateMarquee');
let gateMarqueeOneSetW = 0;
function buildGateMarquee(){
  const items = GATE_FIELDS.map(([key, label])=>{
    const d = market && market[key];
    const val = (!d || d.change === '?') ? '?' : d.change;
    const cls = (!d || d.change === '?') ? 'neutral' : dirClass(d.direction);
    return `<span class="gm-item"><span class="sym">${label}</span><span class="val ${cls}">${val}</span></span>`;
  }).join('');
  gateMarquee.innerHTML = items + items; // duplicated for a seamless marquee loop
  requestAnimationFrame(()=>{ gateMarqueeOneSetW = gateMarquee.scrollWidth / 2; });
}

// ── Gate dock/scroll mechanics — ported from the approved prototype;
// purely UI mechanics, no data dependency. See CLAUDE.md's collapsing-
// card section for why the sticky element's own box height must never
// change reactively during scroll (this doesn't — see the CSS). ────────
const scroller = document.getElementById('scroller');
const gateCard = document.getElementById('gateCard');
const gateFullOverlay = document.getElementById('gateFullOverlay');
const gateSpacer = document.getElementById('gateSpacer');
const GATE_DOCKED_H = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--gate-docked-h')) || 44;
let spacerHeight = 0;

// Sets the ACTUAL reserved scroll room (gateSpacer's real DOM height) --
// deliberately only called at controlled moments (init, after real
// market data renders, on resize), never during an active scroll tick.
// Rewriting a layout-affecting height while a scroll gesture is in
// flight is exactly the fragile pattern the Aug 13 collapsing-card
// lesson (CLAUDE.md) found broken three separate ways on a real device.
function sizeGateSpacer(){
  spacerHeight = currentGateFullHeight();
  gateSpacer.style.height = spacerHeight + 'px';
  updateGateDockState();
}
window.addEventListener('resize', sizeGateSpacer);

// Pure read, no DOM writes -- safe to call any time, including on every
// scroll tick.
function currentGateFullHeight(){
  return Math.max(0, gateFullOverlay.getBoundingClientRect().height - GATE_DOCKED_H);
}

// The actual fix for "collapses at the wrong moment": always re-derived
// from a fresh measurement, never from a cached value that could be
// stale relative to content that changed size for a reason other than
// scrolling (the real /market fetch resolving asynchronously, on a real
// phone with real network latency, is exactly that reason). Called both
// on every scroll tick AND right after any render that can change the
// overlay's real height -- a scroll event is not the only thing that
// can make the correct dock state change; content arriving while the
// user is scroll-stationary must too, or the Gate stays stuck showing
// whatever was correct for the OLD content size until the next scroll.
// This two-part gap (compare-against-stale-value, then no re-check
// without a new scroll event) is exactly the kind of thing this
// sandbox's headless tests couldn't catch on their own: routed fake
// responses resolve instantly and scrolling was programmatic (scrollTo),
// neither of which reproduces the real network-latency + real-touch-
// scroll-then-pause sequence that exposed it live.
function updateGateDockState(){
  const docked = scroller.scrollTop >= currentGateFullHeight();
  gateCard.classList.toggle('docked', docked);
  gateCard.setAttribute('aria-expanded', String(!docked));
}

let gateTicking = false;
scroller.addEventListener('scroll', ()=>{
  if(gateTicking) return;
  gateTicking = true;
  requestAnimationFrame(()=>{
    updateGateDockState();
    gateTicking = false;
  });
}, { passive:true });

function jumpToTop(){ scroller.scrollTo({ top:0, behavior:'smooth' }); }
gateCard.addEventListener('click', ()=>{ if(gateCard.classList.contains('docked')) jumpToTop(); });
gateCard.addEventListener('keydown', (e)=>{
  if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); if(gateCard.classList.contains('docked')) jumpToTop(); }
});

const GATE_MARQUEE_SPEED = 0.4;
function stepGateMarquee(){
  if(gateCard.classList.contains('docked') && gateMarqueeOneSetW > 0){
    gateMarquee.scrollLeft += GATE_MARQUEE_SPEED;
    if(gateMarquee.scrollLeft >= gateMarqueeOneSetW) gateMarquee.scrollLeft -= gateMarqueeOneSetW;
  }
  requestAnimationFrame(stepGateMarquee);
}
requestAnimationFrame(stepGateMarquee);

// ── Utility card accordion (Pulse/Context/Import) — plain tap toggle,
// NOT sticky (direct correction, Aug 15, 2026: pinning all three in a
// stack under the Gate took up too much room; they scroll away like
// normal content now, same as everything else below the Gate except the
// ticker pill strip -- see #roloIndex). ──────────────────────────────
function wireAccordionHead(head){
  function toggle(){
    const card = head.closest('.card');
    const wasExpanded = card.classList.contains('expanded');
    card.classList.toggle('expanded', !wasExpanded);
    head.setAttribute('aria-expanded', String(!wasExpanded));
  }
  head.addEventListener('click', toggle);
  head.addEventListener('keydown', (e)=>{ if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); toggle(); } });
}
document.querySelectorAll('.card[data-card] > .card-head').forEach(wireAccordionHead);

// ── Rolodex: real ticker data, real /analyze ─────────────────────────
const roloStage = document.getElementById('roloStage');
const roloIndex = document.getElementById('roloIndex');
let roloCurrent = 0;
/** ticker -> { td, result, analyzing, error } */
const tickerState = new Map();

// Free tier forces Yahoo Finance links regardless of any saved
// preference (see shared/prefs.js's forceDefaults(), which app.js calls
// unconditionally) -- hardcoded here rather than importing prefs.js, to
// keep this page's isolation from shared/ complete (see the file header).
function tickerHref(sym){ return 'https://finance.yahoo.com/quote/'+sym; }
function newsHref(sym){ return 'https://finance.yahoo.com/quote/'+sym+'/news/'; }

// Same weekday/ET-hours check as production's isMarketClosed() -- a
// verdict computed off-hours still renders as HOLD, not a live UP/DOWN
// call, regardless of what the model actually returned.
function isMarketClosed(){
  const et = new Date(new Date().toLocaleString('en-US', { timeZone:'America/New_York' }));
  const day = et.getDay();
  if(day === 0 || day === 6) return true;
  const mins = et.getHours()*60 + et.getMinutes();
  return mins < 570 || mins >= 960;
}

const TYPE_COLOR = { CANARY:'var(--amber)', SENTIMENT:'var(--blue)', FLOW:'var(--green)' };
const SIZING_LABEL = { FULL:'Full', HALF:'Half', QUARTER:'¼ size' };
const SIZING_COLOR = { FULL:'var(--green)', HALF:'var(--amber)', QUARTER:'var(--amber)' };

function badgesHTML(result){
  if(!result) return '';
  let html = '';
  if(result.type){
    const c = TYPE_COLOR[result.type] || 'var(--ink-dim)';
    html += `<span class="badge" style="color:${c};border-color:${c}55;background:${c}11">${result.type}</span>`;
  }
  if(result.sizing){
    if(result.sizing !== 'NONE'){
      const label = SIZING_LABEL[result.sizing] || result.sizing;
      const c = SIZING_COLOR[result.sizing] || 'var(--ink-dim)';
      html += `<span class="badge" style="color:${c};border-color:${c}55;background:${c}11">${label}</span>`;
    } else {
      html += '<span class="badge" style="color:var(--blue);border-color:rgba(74,168,255,.4);background:rgba(74,168,255,.08)">Defined risk</span>';
    }
  }
  return html ? `<div class="card-badges">${html}</div>` : '';
}

// Only renders when there's real guidance to show -- production's own
// version always renders the dot-only box even when wait_for is empty,
// which reads as a broken/empty element (reported live, Aug 14, 2026:
// a real, pre-existing UX gap this preview doesn't need to repeat).
function pregateStripHTML(result){
  if(!result || !result.gates) return '';
  const waitText = (result.wait_for && result.wait_for !== 'null') ? result.wait_for : '';
  if(!waitText) return '';
  const g5 = result.gates.g5_korea || {};
  return `<div class="pregate-strip"><div class="pregate-dot" style="background:${sigColor(g5.status)}"></div>`
    + `<div class="pregate-note"><span class="wait-lbl">LOOK FOR: </span>${waitText}</div>`
    + '</div>';
}

function gateListHTML(result){
  if(!result || !result.gates){
    return '<div class="gate-list"><div class="gate-clear"><span class="gate-dot" style="background:var(--ink-faint)"></span><span>Tap ANALYZE to run the gates</span></div></div>';
  }
  const g = result.gates;
  const rows = [
    ['PRE-GATE', g.pre_gate], ['G1  14D', g.g1_prewindow], ['G2  CATALYST', g.g2_catalyst],
    ['G3  OPEN BAR', g.g3_openbar], ['G4  PHASE', g.g4_phase], ['G5  PROXY', g.g5_korea],
  ].map(([label, gate])=>{
    gate = gate || {};
    if(gate === g.pre_gate && gate.status === 'GREEN'){
      return '<div class="gate-clear"><span class="gate-dot" style="background:var(--green)"></span><span>PRE-GATE clear</span></div>';
    }
    return `<div class="gate-row"><span class="gate-dot" style="background:${sigColor(gate.status)}"></span>`
      + `<div><span class="gl">${label}</span><span class="gs" style="color:${sigColor(gate.status)}">${gate.status||''}</span>`
      + (gate.note ? `<div class="gn">${gate.note}</div>` : '') + '</div></div>';
  }).join('');
  const confColor = result.confidence === 'HIGH' ? 'var(--green)' : result.confidence === 'MEDIUM' ? 'var(--amber)' : 'var(--red)';
  const conf = `<div class="conf-row"><span class="conf-lbl">CONFIDENCE</span><span class="conf-val" style="color:${confColor}">${result.confidence||''}</span></div>`;
  return '<div class="gate-list">' + rows + conf + '</div>';
}

// Big thumb-up/thumb-down/HOLD, matching production's renderCardResult().
// Market-closed always forces HOLD regardless of the real verdict, same
// as production. Tapping it resets back to the ANALYZE button.
function verdictAreaHTML(sym, result){
  const closed = isMarketClosed();
  const v = (result.verdict || 'FLAT').toUpperCase();
  if(closed){
    return `<div class="verdict-container" data-reset="${sym}"><span class="verdict-hold">HOLD</span><span class="verdict-lbl-hold">MKT CLOSED</span></div>`;
  }
  if(v === 'UP') return `<div class="verdict-container" data-reset="${sym}"><span class="verdict-up">👍</span><span class="verdict-lbl-up">UP</span></div>`;
  if(v === 'DOWN') return `<div class="verdict-container" data-reset="${sym}"><span class="verdict-down">👎</span><span class="verdict-lbl-down">DOWN</span></div>`;
  return `<div class="verdict-container" data-reset="${sym}"><span class="verdict-hold">HOLD</span><span class="verdict-lbl-hold">WAIT &amp; WATCH</span></div>`;
}

function roloCardHTML(sym, state){
  const td = state.td;
  const price = td && td.metrics && td.metrics.price != null ? '$' + td.metrics.price.toFixed(2) : '—';
  const news = td && td.news;
  const headline = news ? news.headline : 'No news within the last business week';
  const age = news ? news.ageLabel : '—';
  const m = td && td.metrics;
  const w52 = m && m.rangePosition != null ? m.rangePosition + '%' : '?';
  const phase = m && m.phaseProxy ? m.phaseProxy.replace('PHASE_','') : '?';
  const beta = m && m.beta ? m.beta.toFixed(1) : '?';
  const proxyName = td && td.proxyRule && td.proxyRule.proxy ? td.proxyRule.proxy.name.split('(')[0].trim() : '?';
  const analyzing = state.analyzing;
  const result = state.result;
  const dir = priceDirClass(td);
  return `<div class="ticker-row">`
    + `<div class="ticker-left"><span class="ticker-sym ${dir}"><a href="${tickerHref(sym)}" target="_blank">${sym}</a></span><span class="ticker-price ${dir}">${price}</span></div>`
    + '<div class="ticker-action">'
    + (result ? verdictAreaHTML(sym, result)
        : `<button class="btn btn-blue btn-compact" data-analyze="${sym}" ${analyzing?'disabled':''}>${analyzing?'RUNNING…':'ANALYZE'}</button>`)
    + '</div>'
    + `</div>`
    + pregateStripHTML(result)
    + `<div class="headline"><a href="${newsHref(sym)}" target="_blank">${headline}</a> <span class="age">${age}</span></div>`
    + `<div class="meta-row"><span>52W <b>${w52}</b></span><span>PHASE <b>${phase}</b></span><span>β <b>${beta}</b></span><span>PROXY <b style="color:var(--blue)">${proxyName}</b></span></div>`
    + badgesHTML(result)
    + gateListHTML(result)
    + (state.error ? `<div class="gate-note" style="color:var(--red);margin-top:6px">${state.error}</div>` : '');
}

function renderRoloCard(sym){
  const card = roloStage.querySelector(`.rolo-card[data-sym="${sym}"]`);
  if(!card) return;
  const state = tickerState.get(sym);
  card.innerHTML = roloCardHTML(sym, state);
  card.classList.remove('verdict-up','verdict-down');
  const btn = card.querySelector('[data-analyze]');
  if(btn) btn.addEventListener('click', ()=> analyzeOne(sym));
  const resetEl = card.querySelector('[data-reset]');
  if(resetEl) resetEl.addEventListener('click', ()=> resetTicker(sym));
  if(state && state.result && !isMarketClosed()){
    const v = (state.result.verdict||'').toUpperCase();
    if(v === 'UP') card.classList.add('verdict-up');
    else if(v === 'DOWN') card.classList.add('verdict-down');
  }
  syncRoloStageHeight();
}

function resetTicker(sym){
  const state = tickerState.get(sym);
  if(!state) return;
  state.result = null; state.error = null;
  renderRoloCard(sym);
  renderPill(sym);
}

// Real day % change direction -- same source (td.metrics.pct) and
// threshold used for both the pill strip's perf-up/down/flat framing and
// the open card's ticker symbol/price color, so the two never disagree
// about which way a ticker is actually moving.
function priceDirClass(td){
  const pct = td && td.metrics && typeof td.metrics.pct === 'number' ? td.metrics.pct : 0;
  return pct > 0.05 ? 'up' : pct < -0.05 ? 'down' : 'flat';
}

function renderPill(sym){
  document.querySelectorAll(`.rolo-chip[data-sym="${sym}"]`).forEach((chip)=>{
    const state = tickerState.get(sym);
    const td = state && state.td;
    const price = td && td.metrics && td.metrics.price != null ? '$' + td.metrics.price.toFixed(2) : '—';
    const perf = 'perf-' + priceDirClass(td);
    chip.className = 'rolo-chip ' + perf + (chip.dataset.idx === String(roloCurrent) ? ' active' : '');
    chip.innerHTML = `<span class="rc-sym">${sym}</span><span class="rc-price">${price}</span>`;
  });
}

// Real gate note text runs longer/more variably than the prototype's
// curated demo copy, and which card is even active changes at runtime --
// a fixed stage height silently clipped Gate 4/5 and the confidence row
// off the bottom of real analyzed cards (see the CSS comment on
// .rolo-stage). Syncs the stage's own height to the ACTIVE card's real
// content height on every render/switch; non-active cards behind it can
// still be taller or shorter, which is fine since they're already
// faded/scaled back as part of the stacked-deck illusion.
function syncRoloStageHeight(){
  const cards = Array.from(roloStage.querySelectorAll('.rolo-card'));
  const activeCard = cards[roloCurrent];
  if(!activeCard) return;
  roloStage.style.height = activeCard.offsetHeight + 'px';
}

function positionRoloStack(){
  const cards = Array.from(roloStage.querySelectorAll('.rolo-card'));
  cards.forEach((card, i)=>{
    const d = i - roloCurrent, abs = Math.abs(d);
    // Only the active card should ever be interactive -- the rest stay in
    // the DOM (for the stacked-deck visual) but are faded/offset behind
    // it. Without this, their ANALYZE buttons/verdict-containers/links
    // remain genuinely clickable/focusable even while visually stacked
    // behind the active card -- a real interaction/accessibility gap, not
    // just a headless-testing selector-ambiguity issue (found via
    // document.querySelector('[data-analyze]') grabbing the first
    // matching button in DOM order rather than the visually active one).
    card.style.pointerEvents = abs === 0 ? 'auto' : 'none';
    if(abs === 0){
      card.style.transform = 'translateY(0) scale(1)'; card.style.opacity = '1'; card.style.zIndex = '10'; card.style.filter = 'none';
    } else if(abs <= 2){
      card.style.transform = `translateY(${d < 0 ? -14*abs : 14*abs}px) scale(${1 - 0.05*abs})`;
      card.style.opacity = String(0.55 - 0.2*(abs-1)); card.style.zIndex = String(10-abs); card.style.filter = 'brightness(.7)';
    } else {
      card.style.transform = `translateY(${d < 0 ? -60 : 60}px) scale(0.85)`; card.style.opacity = '0'; card.style.zIndex = '1';
    }
  });
  const chips = Array.from(roloIndex.querySelectorAll('.rolo-chip'));
  chips.forEach((chip)=> chip.classList.toggle('active', +chip.dataset.idx === roloCurrent));
  document.getElementById('roloHint').textContent = (roloCurrent+1) + ' / ' + cards.length;
  syncRoloStageHeight();
}

function goRolo(i){
  const count = roloStage.querySelectorAll('.rolo-card').length;
  roloCurrent = Math.max(0, Math.min(count-1, i));
  positionRoloStack();
}

// ── Watchlist auto-scroll pill marquee — always running, manual drag
// always wins (state-comparison against the marquee's own last write,
// not a timing-dependent flag — see CLAUDE.md for why the flag approach
// broke on a real device). ──────────────────────────────────────────
let roloMarqueeOneSetW = 0;
let roloCountDivider = null;
// One full "set" is the real pass + its trailing count divider -- measured
// directly off the divider's own position rather than assumed as
// scrollWidth/2, since the divider only appears once (after the real
// pass, not after the duplicate pass), so the two passes are no longer
// equal-width halves.
function sizeRoloMarquee(){
  roloMarqueeOneSetW = roloCountDivider ? (roloCountDivider.offsetLeft + roloCountDivider.offsetWidth) : (roloIndex.scrollWidth / 2);
}
window.addEventListener('resize', sizeRoloMarquee);

let roloMarqueePaused = false, roloMarqueeResumeTimer = null, roloMarqueeLastSelfScrollLeft = null;
function pauseRoloMarquee(){ roloMarqueePaused = true; clearTimeout(roloMarqueeResumeTimer); }
function scheduleRoloMarqueeResume(){ clearTimeout(roloMarqueeResumeTimer); roloMarqueeResumeTimer = setTimeout(()=>{ roloMarqueePaused = false; }, 1800); }
roloIndex.addEventListener('pointerdown', pauseRoloMarquee);
roloIndex.addEventListener('pointerup', scheduleRoloMarqueeResume);
roloIndex.addEventListener('pointercancel', scheduleRoloMarqueeResume);
roloIndex.addEventListener('scroll', ()=>{
  if(roloMarqueeLastSelfScrollLeft !== null && Math.abs(roloIndex.scrollLeft - roloMarqueeLastSelfScrollLeft) < 0.75) return;
  pauseRoloMarquee(); scheduleRoloMarqueeResume();
}, { passive:true });

const ROLO_MARQUEE_SPEED = 0.5;
function stepRoloMarquee(){
  if(!roloMarqueePaused && roloMarqueeOneSetW > 0){
    roloIndex.scrollLeft += ROLO_MARQUEE_SPEED;
    if(roloIndex.scrollLeft >= roloMarqueeOneSetW) roloIndex.scrollLeft -= roloMarqueeOneSetW;
    roloMarqueeLastSelfScrollLeft = roloIndex.scrollLeft;
  }
  requestAnimationFrame(stepRoloMarquee);
}
requestAnimationFrame(stepRoloMarquee);

// ── Build/rebuild the rolodex from the current watchlist ─────────────
async function renderRolodexFromWatchlist(){
  document.getElementById('ticker-count').textContent = 'CRF · ' + watchlist.length + ' TICKERS';
  roloStage.innerHTML = '';
  roloIndex.innerHTML = '';
  watchlist.forEach((sym)=>{
    if(!tickerState.has(sym)) tickerState.set(sym, { td:null, result:null, analyzing:false, error:null });
    const card = document.createElement('div');
    card.className = 'rolo-card'; card.dataset.sym = sym;
    roloStage.appendChild(card);
    renderRoloCard(sym);
  });
  // Two identical chip sets back to back so the marquee wraps seamlessly,
  // with a single "— N —" count divider between them marking where the
  // real list ends and the duplicate pass (used only for the seamless
  // wrap) begins -- a landmark for a long Starter/Pro watchlist scrolling
  // past in the strip (direct request, Aug 15, 2026).
  roloCountDivider = null;
  for(let pass = 0; pass < 2; pass++){
    watchlist.forEach((sym, i)=>{
      const chip = document.createElement('button');
      chip.className = 'rolo-chip'; chip.dataset.sym = sym; chip.dataset.idx = String(i);
      chip.addEventListener('click', ()=> goRolo(i));
      roloIndex.appendChild(chip);
      renderPill(sym);
    });
    if(pass === 0){
      roloCountDivider = document.createElement('span');
      roloCountDivider.className = 'rolo-divider';
      roloCountDivider.textContent = `— ${watchlist.length} —`;
      roloIndex.appendChild(roloCountDivider);
    }
  }
  roloCurrent = Math.min(roloCurrent, Math.max(0, watchlist.length-1));
  positionRoloStack();
  requestAnimationFrame(()=>{ sizeGateSpacer(); sizeRoloMarquee(); });

  await Promise.all(watchlist.map(async (sym)=>{
    const td = await fetchTickerData(sym);
    const state = tickerState.get(sym);
    if(state){ state.td = td; }
    renderRoloCard(sym);
    renderPill(sym);
    requestAnimationFrame(sizeRoloMarquee);
  }));
}

// ── ANALYZE — mocked, not a real /analyze call ────────────────────────
// Direct request (Aug 14, 2026): real /analyze is credit-gated server-side
// (see credits.js in Tra), and there's no way to top up credits just for
// reviewing this UI -- a page reload can't reset a real, server-enforced
// balance no matter what the frontend does. So ANALYZE on this preview
// page no longer calls the real endpoint at all: it simulates a response
// from a small pool of realistic, hand-written profiles covering the
// verdict/badge/gate states worth reviewing (clean UP, forceDown NONE,
// mixed FLAT, clean full-size UP, Gate 5 forceDown DOWN). Cycles through
// them per ticker on repeated taps so re-analyzing the same ticker shows
// different states instead of the identical result every time.
//
// Ticker price/news/52W/phase/beta/proxy (fetchTickerData(), above) are
// UNCHANGED and still real -- /ticker/:symbol has no credit cost in
// production either, so there's no reason to fake that half.
const MOCK_ANALYZE_PROFILES = [
  {
    type:'SENTIMENT', verdict:'UP', confidence:'HIGH', sizing:'HALF', wait_for:null,
    gates:{
      pre_gate:{ status:'GREEN', note:'No solvency, dilution, or guidance-cut language found.' },
      sector:{ status:'GREEN', note:'SPY +0.3% QQQ +0.6% — flat to mild positive, proceed normally.' },
      g1_prewindow:{ status:'GREEN', note:'14-session +6.2% under +10% — clean.' },
      g2_catalyst:{ status:'GREEN', note:'Company-specific positive: catalyst confirmed, sector confirming.' },
      g3_openbar:{ status:'GREEN', note:'Bar 1 green, building with sector strength.' },
      g4_phase:{ status:'YELLOW', note:'Phase 2 — acceleration, half size on pullbacks.' },
      g5_korea:{ status:'GREEN', note:'Sector proxy confirms — tailwind.' },
    },
  },
  {
    type:'CANARY', verdict:'DOWN', confidence:'MEDIUM', sizing:'NONE',
    wait_for:'Structural reversal (higher high + reclaim of 50-day MA) required before re-evaluating.',
    gates:{
      pre_gate:{ status:'GREEN', note:'No solvency, dilution, or guidance-cut language found.' },
      sector:{ status:'YELLOW', note:'SPY -0.6% QQQ -0.9% — mild headwind.' },
      g1_prewindow:{ status:'RED', note:'60-session -28.4% structural breakdown exceeds 25% — forceDown.' },
      g2_catalyst:{ status:'RED', note:'Company-specific negative headline pressuring the name.' },
      g3_openbar:{ status:'YELLOW', note:'Bar 1 red, Bar 2 rejecting — reversal risk in play.' },
      g4_phase:{ status:'RED', note:'Phase 3 — priced for perfection, post-flush entry only.' },
      g5_korea:{ status:'YELLOW', note:'Sector proxy mixed, not confirming direction.' },
    },
  },
  {
    type:'FLOW', verdict:'FLAT', confidence:'LOW', sizing:'HALF', wait_for:'Additional confirmation needed before directional entry.',
    gates:{
      pre_gate:{ status:'GREEN', note:'No solvency, dilution, or guidance-cut language found.' },
      sector:{ status:'GREEN', note:'SPY +0.1% QQQ +0.2% — flat.' },
      g1_prewindow:{ status:'YELLOW', note:'14-session +11.4% in the +10-20% band — reduce size 50%.' },
      g2_catalyst:{ status:'YELLOW', note:'No fresh catalyst — neutral by default.' },
      g3_openbar:{ status:'YELLOW', note:'No bar data — blind sequence, midweek default.' },
      g4_phase:{ status:'YELLOW', note:'Phase 2 — half size on pullbacks only.' },
      g5_korea:{ status:'GREEN', note:'Sector proxy flat — no headwind.' },
    },
  },
  {
    type:'FLOW', verdict:'UP', confidence:'HIGH', sizing:'FULL', wait_for:null,
    gates:{
      pre_gate:{ status:'GREEN', note:'No solvency, dilution, or guidance-cut language found.' },
      sector:{ status:'GREEN', note:'SPY +0.5% QQQ +0.8% — genuinely strong tape.' },
      g1_prewindow:{ status:'GREEN', note:'14-session +3.0% — clean.' },
      g2_catalyst:{ status:'GREEN', note:'Company-specific positive, sector confirming, congruent.' },
      g3_openbar:{ status:'GREEN', note:'Monday + bullish 3-bar sequence — highest conviction.' },
      g4_phase:{ status:'GREEN', note:'Phase 1 — discovery, full size entry appropriate.' },
      g5_korea:{ status:'GREEN', note:'Sector proxy confirms.' },
    },
  },
  {
    type:'SENTIMENT', verdict:'DOWN', confidence:'MEDIUM', sizing:'NONE',
    wait_for:'Proxy must stabilize before re-evaluating.',
    gates:{
      pre_gate:{ status:'GREEN', note:'No solvency, dilution, or guidance-cut language found.' },
      sector:{ status:'YELLOW', note:'SPY -0.4% QQQ -0.5% — soft.' },
      g1_prewindow:{ status:'YELLOW', note:'14-session +14.1% in the +10-20% band — reduce size 50%.' },
      g2_catalyst:{ status:'YELLOW', note:'Sector macro negative, no company-specific catalyst yet.' },
      g3_openbar:{ status:'RED', note:'Bar 1 red, Bar 2 red — no reversal signal.' },
      g4_phase:{ status:'YELLOW', note:'Phase 2 — half size on pullbacks only.' },
      g5_korea:{ status:'RED', note:'Sector proxy down sharply — forceDown, gated exemption applies.' },
    },
  },
];

async function analyzeOne(sym){
  const state = tickerState.get(sym);
  if(!state || state.analyzing) return;
  state.analyzing = true; state.error = null;
  renderRoloCard(sym);
  const td = state.td || await fetchTickerData(sym);
  state.td = td;

  await new Promise((resolve)=> setTimeout(resolve, 400 + Math.random()*300));

  state.mockIndex = (state.mockIndex == null ? 0 : state.mockIndex + 1) % MOCK_ANALYZE_PROFILES.length;
  const profile = MOCK_ANALYZE_PROFILES[state.mockIndex];
  state.result = { ticker: sym, marketOpen: true, ...profile };
  state.analyzing = false;
  renderRoloCard(sym); renderPill(sym);
}

function analyzeAll(){ watchlist.forEach((sym)=> analyzeOne(sym)); }
document.getElementById('analyzeAllBtn').addEventListener('click', analyzeAll);

// ── Import (Add Ticker) — same validate/dedupe/prepend rules as
// shared/watchlist.js's addTickers(), reimplemented standalone here on
// purpose (see the file header comment). ─────────────────────────────
function parseTickers(raw){
  return raw.toUpperCase().replace(/[$#]/g,'').split(/[\s,;|\n]+/).map((t)=>t.trim()).filter((t)=>/^[A-Z]{1,6}$/.test(t));
}
document.getElementById('importBtn').addEventListener('click', ()=>{
  if(watchlist.length >= MAX_TICKERS){
    alert('Free tier supports up to 3 tickers.\n\nUpgrade to Starter for more.');
    return;
  }
  const raw = document.getElementById('ticker-input').value;
  const tickers = parseTickers(raw);
  if(!tickers.length){ alert('No valid tickers. Try: AAPL or MU'); return; }
  const newOnes = tickers.filter((t)=> !watchlist.includes(t));
  watchlist = newOnes.concat(watchlist).slice(0, MAX_TICKERS);
  document.getElementById('ticker-input').value = '';
  saveWatchlist();
  renderRolodexFromWatchlist();
});

// ── Glossary — same content and behavior as production's Free tier,
// reimplemented standalone here (see the file header comment on why
// this page doesn't import shared code beyond ticker-cache.js). ────────
const GLOSSARY = [
  {cat:'CRF FRAMEWORK',term:'CRF (Catalyst Response Framework)',def:'A step-by-step checklist this app runs on a stock before giving you a verdict. If enough of the checklist looks good, that’s a thumbs up; if enough looks bad, that’s a thumbs down.',ex:'Think of it like a pre-flight checklist for a trade — pilots don’t take off until enough boxes are checked.'},
  {cat:'CRF FRAMEWORK',term:'Pre-Gate — Thesis Integrity',def:'A quick background check on the company itself, looking for red flags like financial trouble, before the app even looks at the stock’s price. A serious red flag here can override everything else.',ex:'Like checking a used car’s title for a salvage flag before you even look under the hood.'},
  {cat:'CRF FRAMEWORK',term:'Gate 0 — Sector Gate',def:'Checks how the overall stock market is doing today. If the whole market is having a bad day, that drags down the outlook for pretty much everything.',ex:'A rising tide lifts all boats — a sinking one drags them down too.'},
  {cat:'CRF FRAMEWORK',term:'Gate 1 — Bidirectional Trend Structure',def:'Looks at whether the stock has already made a big move recently, up or down. A stock that’s already run up a lot is riskier to chase, and one that’s fallen too far too fast is a red flag too.',ex:'Like being wary of a stock that already “ran” — you don’t want to be the last one to the party.'},
  {cat:'CRF FRAMEWORK',term:'Gate 2 — Catalyst Congruence',def:'Checks whether recent news about the company actually supports the direction the app is leaning.',ex:'Makes sure the story and the numbers are telling the same story.'},
  {cat:'CRF FRAMEWORK',term:'Gate 3 — Opening Bar',def:'Watches how the stock trades in the first few minutes after the market opens, since that early action often hints at where the rest of the day is headed.',ex:'Like judging a race by how strong the runners look at the starting gun.'},
  {cat:'CRF FRAMEWORK',term:'Gate 4 — Phase Identification',def:'Figures out whether a stock’s big move is just getting started, already well underway, or has gone so far it might be due for a pullback.',ex:'Early innings vs. late innings of the same game.'},
  {cat:'CRF FRAMEWORK',term:'Gate 5 — Dynamic Sector Proxy',def:'Compares the stock to other companies or funds in the same industry, to see if it’s moving with its peers or acting strangely on its own.',ex:'Checking if one kid in class is sick, or if the whole class has the flu.'},
  {cat:'CRF FRAMEWORK',term:'Verdict Icons — 👍 UP / 👎 DOWN / HOLD',def:'👍 means the app leans bullish (expects the stock to rise), 👎 means it leans bearish (expects it to fall), and HOLD means it’s not confident enough either way, or the market’s closed.',ex:'Simple as a thumbs up or thumbs down on a movie — just for a stock’s next move instead.'},
  {cat:'TICKER CLASSIFICATIONS',term:'Canary',def:'European or institutional base that prices macro risk early. When canaries fall while sentiment names rise, reversal is coming.',ex:'ASML fell before MU/ALAB. Warned 10-21 days early.'},
  {cat:'TICKER CLASSIFICATIONS',term:'Sentiment',def:'Moves most directly with AI capex or sector confidence, ignoring macro until it breaks.',ex:'MU, NVDA, AMD. Ran +47% into Broadcom miss then crashed 12.8%.'},
  {cat:'TICKER CLASSIFICATIONS',term:'Flow',def:'Moves on mechanical buying events. Institutions distribute at the opening bar on positive catalyst days.',ex:'ALAB opened $315 on Computex day, flushed to $292 in 30 min on 1.1M shares.'},
  {cat:'TICKER CLASSIFICATIONS',term:'Phase 1 / 2 / 3',def:'Phase 1 = discovery, <30% of 52-week range, full size. Phase 2 = acceleration, 30-70%, half size. Phase 3 = priced for perfection, >70%, post-flush only.',ex:'ALAB at $88 = Phase 1. At $300 = Phase 2. At $450 = Phase 3 (sold off on blowout beat).'},
  {cat:'OPTIONS — GREEKS',term:'Delta (Δ)',def:'How much an option moves per $1 move in the stock. ATM options ~0.50. Also approximates probability of expiring in-the-money.',ex:'Delta 0.50 call gains $0.50 when stock rises $1.'},
  {cat:'OPTIONS — GREEKS',term:'Gamma (Γ)',def:'Rate of change of delta. High gamma = delta shifts rapidly. Options near expiry and ATM have highest gamma.',ex:'High-gamma option: $1 stock move shifts delta from 0.50 to 0.65.'},
  {cat:'OPTIONS — GREEKS',term:'Theta (Θ)',def:'Time decay per day. Sellers’ friend, buyers’ enemy. Accelerates in final 2 weeks before expiry.',ex:'$2.00 option with theta −0.05 loses $0.50 over 10 days even if stock flat.'},
  {cat:'OPTIONS — GREEKS',term:'Vega (ν)',def:'Sensitivity to implied volatility. Buying pre-earnings buys vega, but IV collapses after the event (IV crush).',ex:'Buy $3.00 pre-earnings, stock moves your way, IV drops 45pts → option now $1.80.'},
  {cat:'OPTIONS — GREEKS',term:'Rho (ρ)',def:'Sensitivity to a 1% change in interest rates. Smallest of the four Greeks for short-dated options — matters on LEAPS-length duration, negligible for the Opening Drive holds this app is built around.',ex:'A 6-month call with Rho 0.15 gains ~$0.15 per 1% rate hike — a rounding error next to a same-day 3% move driven by Delta/Gamma.'},
  {cat:'OPTIONS — CONCEPTS',term:'Implied Volatility (IV)',def:'Market’s expectation of future price movement, annualized. High IV = expensive options. Forward-looking, not historical.',ex:'ALAB IV ran 98-115% during parabolic phase. Selling premium more attractive than buying.'},
  {cat:'OPTIONS — CONCEPTS',term:'IV Rank (IVR)',def:'Where current IV sits vs past 52 weeks as a percentile. IVR >80 = Phase 3 signal in CRF.',ex:'IVR 85 = IV higher than 85% of readings this year → Gate 4 RED lean.'},
  {cat:'OPTIONS — CONCEPTS',term:'Put/Call Skew',def:'Difference between put IV and call IV at equal distance from current price. Positive skew = bearish institutional hedging.',ex:'CHAT showed consistent +4pt put skew → Gate 2 bearish lean.'},
  {cat:'OPTIONS — CONCEPTS',term:'Expected Move',def:'Market-implied 1-sigma price range by expiration. Stock stays within this range ~68% of the time.',ex:'Stock $50, ATM IV 80%, 30 DTE → expected move ±$12.30.'},
  {cat:'OPTIONS — CONCEPTS',term:'IV Crush',def:'Sharp drop in IV immediately after a catalyst. Options lose value even on correct direction.',ex:'Buy put pre-earnings $3.00. Stock drops 5% but IV collapses 55pts → put now $1.80.'},
  {cat:'OPTIONS — CONCEPTS',term:'Cash-Secured Put',def:'Selling a put while holding cash to buy shares at strike if assigned. Generates income on names you’d want to own.',ex:'ARCC at $18.50 → sell $18 put for $0.48. Assigned = effective buy at $17.52.'},
  {cat:'OPTIONS — CONCEPTS',term:'Gamma Exposure (GEX)',def:'Aggregate dollar impact of dealer hedging. Positive GEX = dealers dampen moves. Negative GEX = dealers amplify moves.',ex:'SPX negative GEX → Opening Drive gaps extend. Momentum more reliable.'},
  {cat:'OPTIONS — CONCEPTS',term:'Call Option',def:'Right (not obligation) to buy 100 shares at the strike price before expiration. Buyers profit if the stock rises above strike + premium paid.',ex:'Buy 1 SMMT $50 call for $2.00. Stock closes $55 at expiry → intrinsic value $5.00, profit $3.00/share.'},
  {cat:'OPTIONS — CONCEPTS',term:'Put Option',def:'Right (not obligation) to sell 100 shares at the strike price before expiration. Buyers profit if the stock falls below strike − premium paid.',ex:'Buy 1 IREN $35 put for $1.50. Stock drops to $30 at expiry → intrinsic value $5.00, profit $3.50/share.'},
  {cat:'OPTIONS — CONCEPTS',term:'Strike Price',def:'The fixed price at which an option’s owner can buy (call) or sell (put) the underlying. Set when the contract is created and never changes.',ex:'A $45 call and a $50 call on the same expiry are different contracts — the $45 strike is already in-the-money at a $47 stock price, the $50 strike is not.'},
  {cat:'OPTIONS — CONCEPTS',term:'DTE (Days to Expiration)',def:'Calendar days remaining until an option contract expires. Theta decay accelerates as DTE shrinks, especially inside the final 2 weeks.',ex:'A 30 DTE option loses value slowly. The same strike at 3 DTE bleeds premium daily even on a flat stock.'},
  {cat:'OPTIONS — CONCEPTS',term:'ITM / ATM / OTM',def:'In-the-money (has intrinsic value — call strike below spot, put strike above), at-the-money (strike ≈ spot), out-of-the-money (no intrinsic value yet, pure premium). Delta approximates the odds of finishing ITM.',ex:'Stock at $50: the $45 call is ITM, the $50 call is ATM, the $55 call is OTM.'},
  {cat:'MARKET STRUCTURE',term:'Opening Drive',def:'First 90 minutes (9:30-11:00am ET). Highest volume, highest volatility. Most institutional orders execute here. This app is built for this window.',ex:'Stock gaps up 3% with 2× average volume in bar 1 = Opening Drive setup.'},
  {cat:'MARKET STRUCTURE',term:'Gap Up / Gap Down',def:'Stock opens significantly different from prior close. CRF entry: gap ≥2% from prior close, enter at ask +1%.',ex:'SMMT closed $45, opens $47.50 = +5.5% gap. Check all 5 gates.'},
  {cat:'MARKET STRUCTURE',term:'Engulfing Candle',def:'Second candle’s body completely contains the first. Bullish engulf = buyers overwhelmed sellers. Gate 3 uses this for Monday signals.',ex:'Monday bar 1 red at $40, bar 2 opens $38 closes $41 = bullish engulf → Gate 3 GREEN.'},
  {cat:'MARKET STRUCTURE',term:'Circuit Breaker',def:'Automatic trading halt when market falls a specified percentage. US halts at −7%, −13%, −20%. KOSPI at −8%.',ex:'KOSPI circuit breaker June 8 2026 at −8.37% → Gate 5 RED for all AI/semi.'},
  {cat:'MARKET STRUCTURE',term:'Short Squeeze',def:'Heavily shorted stock rises sharply, forcing shorts to buy to cover, pushing price higher. Brief but explosive.',ex:'IREN 18.7% short float, <2 days to cover. Any positive catalyst could trigger a squeeze.'},
  {cat:'MARKET STRUCTURE',term:'VWAP (Volume-Weighted Average Price)',def:'The running average price of a stock for the session, weighted by volume at each price. Resets daily. Widely used intraday as a fair-value line — price above VWAP favors longs, below favors shorts.',ex:'Stock pops to $52 but VWAP sits at $49.80 — a lot of the day’s volume already changed hands well below the current price.'},
  {cat:'MARKET STRUCTURE',term:'Relative Volume (RVOL)',def:'Current volume compared to the average volume for this point in the session. RVOL >2x on an Opening Drive gap is what separates a real institutional move from noise.',ex:'ALAB gaps up 4% on 1.1M shares in the first 5 minutes vs a normal 5-minute average of 280K → RVOL ~4x, high-conviction signal.'},
  {cat:'MARKET STRUCTURE',term:'Support / Resistance',def:'Price levels where a stock has historically reversed. Support = a floor buyers defended before. Resistance = a ceiling sellers defended before. Neither is guaranteed to hold twice.',ex:'PLUG bounced at $2.10 three times this quarter — that’s support until it isn’t; a close below it on volume is the tell it broke.'},
  {cat:'MARKET STRUCTURE',term:'Extended Hours (Pre-Market / Post-Market)',def:'Trading outside the 9:30am-4:00pm ET regular session: pre-market (4:00-9:30am ET) and post-market (4:00-8:00pm ET) on IEX Exchange’s formal extended sessions. Real prints, but on a much thinner book than the regular consolidated tape — moves here can reverse hard once the full tape opens.',ex:'CIFR prints $24.16 pre-market on light volume, opens the regular session at $22.10 once the full tape weighs in.'},
  {cat:'MARKET STRUCTURE',term:'Beta (β)',def:'A stock’s volatility relative to the overall market (SPY), where 1.0 = moves in line with the market, >1 amplifies market moves, <1 dampens them. Shown on each card as β. A negative beta means the stock tends to move opposite the market — treat it as effectively uncorrelated to its assigned Gate 5 proxy rather than confirming or denying that proxy read.',ex:'IREN at β2.1 is expected to move ~2.1% for every 1% SPY move. A rare β−0.3 name would be expected to drift up on a red SPY day.'},
  {cat:'MARKET STRUCTURE',term:'Intraday',def:'Within a single trading day — opened and evaluated before the next session begins, as opposed to a multi-day swing or long-term hold. This app’s entire CRF framework is built around intraday timing: the Opening Drive window, Gate 3’s same-day bar sequence, and same-day stop-loss discipline.',ex:'An intraday call on SMMT is graded against its move by that day’s close, not next week’s — Gate 3’s opening-bar sequence only exists because the framework is timing a single session.'},
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
  {cat:'TRADING TERMINOLOGY',term:'Bid / Ask (Bid-Ask Spread)',def:'Bid = highest price a buyer will pay right now. Ask = lowest price a seller will accept. The spread between them is a real, invisible cost — wider on illiquid names and thin extended-hours books.',ex:'IREN bid $39.98 / ask $40.05 — a market order to buy fills near $40.05, not the $40.00 last-trade price shown on the card.'},
  {cat:'TRADING TERMINOLOGY',term:'Limit Order',def:'An order that only fills at your specified price or better. Guarantees price, not execution — can go unfilled if the stock never trades there.',ex:'Limit buy SMMT at $45.00 while it’s trading $45.20 — sits unfilled until the price comes down to you (or never).'},
  {cat:'TRADING TERMINOLOGY',term:'Market Order',def:'An order that fills immediately at the best available price. Guarantees execution, not price — on a fast-moving or thin name you can pay meaningfully more than the last quote.',ex:'A market buy during a gap-up Opening Drive can fill 1-2% above the price you saw when you clicked.'},
  {cat:'TRADING TERMINOLOGY',term:'Ladder / Laddering',def:'Splitting one order into several smaller limit orders staggered across a price range instead of one order at one price. Improves average fill price on size that would otherwise move a thin book.',ex:'Instead of one 500-share market buy, ladder 100 shares each at $45.00/$45.10/$45.20/$45.30/$45.40.'},
];

let glossaryBuilt = false;
function buildGlossary(){
  if(glossaryBuilt) return; glossaryBuilt = true;
  const body = document.getElementById('glossary-body');
  const cats = {};
  GLOSSARY.forEach((g)=>{ (cats[g.cat] = cats[g.cat] || []).push(g); });
  let html = '';
  Object.entries(cats).forEach(([cat, terms])=>{
    html += `<div class="glossary-cat" data-cat="${cat}">${cat}</div>`;
    terms.forEach((t)=>{
      html += `<div class="glossary-term visible" data-term="${t.term.toLowerCase()}" data-def="${t.def.toLowerCase()}">`
        + `<div class="glossary-term-name">${t.term}</div>`
        + `<div class="glossary-term-def">${t.def}</div>`
        + (t.ex ? `<div class="glossary-term-example">e.g. ${t.ex}</div>` : '') + '</div>';
    });
  });
  body.innerHTML = html;
}

function toggleGlossary(){
  const panel = document.getElementById('glossary-panel');
  const arrow = document.getElementById('glossary-arrow');
  const header = document.getElementById('glossary-header');
  const open = panel.classList.toggle('open');
  arrow.classList.toggle('open', open);
  header.classList.toggle('open', open);
  if(open) buildGlossary();
}

function filterGlossary(query){
  buildGlossary();
  const q = query.toLowerCase().trim();
  let anyVisible = false;
  document.querySelectorAll('.glossary-term').forEach((el)=>{
    const match = !q || el.dataset.term.includes(q) || el.dataset.def.includes(q);
    el.classList.toggle('visible', match);
    if(match) anyVisible = true;
  });
  document.querySelectorAll('.glossary-cat').forEach((catEl)=>{
    let next = catEl.nextElementSibling, hasVisible = false;
    while(next && !next.classList.contains('glossary-cat')){ if(next.classList.contains('visible')) hasVisible = true; next = next.nextElementSibling; }
    catEl.style.display = (hasVisible || !q) ? 'block' : 'none';
  });
  const nr = document.getElementById('glossary-no-results');
  nr.style.display = (!anyVisible && q) ? 'block' : 'none';
}

document.getElementById('glossary-header').addEventListener('click', toggleGlossary);
document.getElementById('glossary-search').addEventListener('input', (e)=> filterGlossary(e.target.value));

// ── preview banner — dismissible, persisted so it doesn't reappear on
// every reload while actively iterating. Preview-only key, unrelated to
// any real tv_* production localStorage key. ─────────────────────────
const PREVIEW_BANNER_DISMISSED_KEY = 'rolodex_preview_banner_dismissed';
const previewBanner = document.getElementById('previewBanner');
if(localStorage.getItem(PREVIEW_BANNER_DISMISSED_KEY) === '1'){
  previewBanner.style.display = 'none';
}
document.getElementById('previewBannerClose').addEventListener('click', ()=>{
  previewBanner.style.display = 'none';
  localStorage.setItem(PREVIEW_BANNER_DISMISSED_KEY, '1');
});

// ── init ───────────────────────────────────────────────────────────
updateAuthButton();
loadWatchlist();
sizeGateSpacer();
fetchMarket();
fetchCreditStatus();
renderRolodexFromWatchlist();
