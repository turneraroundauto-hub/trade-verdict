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
let gateMarqueePos = 0;
function buildGateMarquee(){
  const items = GATE_FIELDS.map(([key, label])=>{
    const d = market && market[key];
    const val = (!d || d.change === '?') ? '?' : d.change;
    const cls = (!d || d.change === '?') ? 'neutral' : dirClass(d.direction);
    return `<span class="gm-item"><span class="sym">${label}</span><span class="val ${cls}">${val}</span></span>`;
  }).join('');
  gateMarquee.innerHTML = items + items; // duplicated for a seamless marquee loop
  // Rebuilding resets the real scrollLeft to 0 -- the tracked position
  // (see stepGateMarquee below) has to reset with it, same reasoning as
  // roloMarqueePos in the pill strip.
  gateMarqueePos = 0;
  requestAnimationFrame(sizeGateMarquee);
}

// Same fix as the pill strip's sizeRoloMarquee(): scrollWidth rounds to
// the nearest integer per spec, so scrollWidth/2 can be off by up to
// ~0.5px from where the content actually repeats even though the two
// passes are truly identical. Measures the real boundary (the last item
// of the first pass) via getBoundingClientRect() instead, which keeps
// full sub-pixel precision.
function sizeGateMarquee(){
  const items = gateMarquee.querySelectorAll('.gm-item');
  if(items.length < 2){ gateMarqueeOneSetW = gateMarquee.scrollWidth / 2; return; }
  const lastOfFirstPass = items[items.length / 2 - 1];
  const containerLeft = gateMarquee.getBoundingClientRect().left;
  const boundaryRight = lastOfFirstPass.getBoundingClientRect().right;
  gateMarqueeOneSetW = (boundaryRight - containerLeft) + gateMarquee.scrollLeft;
}
window.addEventListener('resize', sizeGateMarquee);

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
  // Respect whatever dock state is already showing (e.g. a resize firing
  // while already docked) rather than always re-opening the full gap --
  // updateGateDockState() below is what actually owns transitioning it.
  gateSpacer.style.height = (gateCard.classList.contains('docked') ? 0 : spacerHeight) + 'px';
  updateGateDockState();
}
window.addEventListener('resize', sizeGateSpacer);

// Pure read, no DOM writes -- safe to call any time, including on every
// scroll tick. Still used by sizeGateSpacer() below to reserve enough
// blank scroll room that the un-docked overlay never visually overlaps
// Sector Pulse -- NOT used for the dock decision itself anymore, see
// updateGateDockState().
function currentGateFullHeight(){
  return Math.max(0, gateFullOverlay.getBoundingClientRect().height - GATE_DOCKED_H);
}

// Direct request (Aug 15, 2026): dock exactly when Sector Pulse "begins
// to hide" -- confirmed via AskUserQuestion to mean the Sector Pulse
// drop-down specifically, the first of the three utility cards.
//
// First attempt at this compared Sector Pulse's real top against
// GATE_DOCKED_H (44px) -- reasoning "dock once Pulse has scrolled up to
// where the compact bar's bottom edge will be." That's actually a much
// LATER point than "begins to hide": while un-docked, #gateCard's
// full-detail overlay stays sticky-pinned at the top the entire time
// (position:sticky engages regardless of the docked class -- only the
// crossfade to the compact mini-row is gated on it), opaque, at its own
// FULL real height -- not just GATE_DOCKED_H. So Sector Pulse -- a
// plain, non-sticky element -- starts getting visually painted over
// (hidden) the moment its own top scrolls up to meet the overlay's
// CURRENT full height, not the eventual 44px docked height. Comparing
// against 44px instead meant waiting until Sector Pulse had scrolled
// most of the way to *fully* clear the overlay before docking -- a wide
// "dead zone" of scrolling where Sector Pulse was already invisible
// (painted over) but the Gate still hadn't collapsed.
//
// Second attempt directly measured cardPulse's live position against the
// overlay's live height every tick -- correct in isolation, but broke
// once gateSpacer's own height was made to collapse on dock (below):
// removing gateSpacer's reserved room permanently shifts Sector Pulse's
// document-flow position closer to the top, which is exactly the value
// this comparison reads -- so docking once made "undock" permanently
// unreachable (scrolling back to the top no longer moved pulseTop back
// past the threshold), a real regression caught before shipping.
//
// Fixed with a derivation instead of a live re-measurement: gateSpacer
// is ALWAYS sized to exactly (overlayHeight - GATE_DOCKED_H) by
// currentGateFullHeight(), which algebraically means Sector Pulse's
// un-scrolled position is ALWAYS exactly (overlayHeight +
// contentPaddingTop) -- so the scrollTop needed to bring it down to
// "begins to hide" (pulseTop <= overlayHeight) is ALWAYS just
// contentPaddingTop, a fixed constant, regardless of the overlay's
// actual height. Confirmed by direct measurement against a realistic
// 10-index/long-note mock: docks at scrollTop~15px, matching
// .content's own 14px top padding. Using this fixed constant instead of
// re-measuring cardPulse removes the circular dependency entirely --
// nothing here depends on gateSpacer's current (possibly already
// collapsed) height.
const dockThreshold = parseFloat(getComputedStyle(document.querySelector('.content')).paddingTop) || 0;

// Reported live (Aug 15, 2026): gateSpacer's reserved room was only ever
// sized for the UN-docked overlay's full height (~150-200px+ with real
// data) and never shrank back down once docked -- fine when docking used
// to happen late (near where the spacer's own room ran out anyway), but
// now that it docks after ~14px, the spacer still held open a huge,
// now-pointless blank gap between the compact bar and Sector Pulse.
// Collapses gateSpacer to 0 the moment `docked` flips true (and restores
// it on undock) so the content underneath visually "pulls up" to meet
// the collapsed bar -- only ever written on an actual state transition,
// not every scroll tick, and only on a plain (non-sticky) element, so
// this isn't the fragile "sticky element's own box changes shape
// mid-gesture" pattern the Aug 13 lesson found broken -- #gateSpacer
// itself is never sticky, only #gateCard is.
let gateDockedLast = false;
function updateGateDockState(){
  const docked = scroller.scrollTop >= dockThreshold;
  gateCard.classList.toggle('docked', docked);
  gateCard.setAttribute('aria-expanded', String(!docked));
  if(docked !== gateDockedLast){
    gateSpacer.style.height = (docked ? 0 : spacerHeight) + 'px';
    gateDockedLast = docked;
  }
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

// ── TEMPORARY diagnostic overlay (Aug 15-16, 2026) -- catches the exact
// moment/magnitude/cause of any future visible jump on a real device,
// since this could not be reproduced further from the sandbox this was
// built from beyond what's already fixed.
//
// Round 1 (Aug 15) only tracked the two marquees' own reference elements'
// horizontal position, on the theory that any jump had to be a marquee
// content-reflow issue -- that's what caught the price-placeholder-swap
// bug that shipped the same day. Reported live afterward: the jump kept
// happening, INCLUDING right on page refresh, with this diagnostic
// showing zero detections the whole time. That's real evidence the
// remaining jump isn't going through either marquee's per-frame
// scrollLeft write at all -- possibly a different axis (vertical, not
// horizontal), a different element (Gate dock, sticky pill strip,
// something else), or something that happens before this diagnostic's
// per-frame checks even get a "last known position" baseline to compare
// against (its first-ever sample can't flag anything, since there's
// nothing yet to compare it to -- exactly what a load-time/refresh jump
// would hit).
//
// Round 2 adds the browser's own Layout Instability API
// (PerformanceObserver({type:'layout-shift'})) alongside the marquee-
// specific checks instead of replacing them. This is the web platform's
// purpose-built tool for exactly this class of bug: it reports EVERY
// visible layout shift on the page, on any element, on any axis,
// regardless of what caused it -- not limited to any one hypothesis
// about where the jump comes from -- and names the actual DOM node(s)
// involved plus their real before/after rects. `buffered:true` replays
// shifts that already happened before this observer attaches, which is
// the specific fix for "on refresh" -- it catches load-time shifts this
// script would otherwise have missed by starting to watch too late.
//
// Both diagnostics write into the same shared event log/overlay so nothing
// gets silently overwritten. Read-only: neither ever writes to
// scrollLeft/roloMarqueePos/gateMarqueePos or any layout property itself.
// Safe to remove once the jump is confirmed resolved for good.
// notable=true renders in a brighter/bolder line -- several known-good,
// already-CSS-transitioned changes in this page (.rolo-stage's own
// height:.28s ease, the Gate spacer's .2s pull) legitimately produce a
// RUN of many small layout-shift entries per transition, one per animation
// frame, confirmed live in this sandbox (a forced 118px height change
// produced a smooth climbing series of ~13-25px entries, not one big
// jump). Those are real per-spec CLS entries but aren't what "jump" means
// to a person watching a smooth animation -- so nothing is EVER discarded
// (every entry is still kept, scroll the panel for full history), but a
// single-frame delta this large relative to what a smooth ~60fps
// transition produces is flagged as the more likely actual culprit.
const DIAG_NOTABLE_PX = 30;
// Two separate lists, not one shared cap (Aug 16, 2026 fix) -- a real
// device video confirmed a genuine, permanent, notable jump DOES happen
// (twice, independently, ~26-28px, matching magnitude both times), but
// two live screenshots taken minutes into a session showed no trace of
// it in the overlay. Root cause: routine per-spec layout-shift noise
// (`.content` settling, the diagnostic's own address-bar-driven
// repositioning before that was filtered) accumulates continuously
// during normal use, and the old single 20-item cap let that noise
// evict the one rare, real, notable entry long before anyone thought to
// screenshot it. Notable events are now effectively never evicted
// (they're rare by construction); only the high-frequency routine noise
// gets capped.
const diagNotableEvents = [];
const diagRoutineEvents = [];
// Real bug found and confirmed (Aug 16, 2026): reassigning innerHTML
// does NOT reset scrollTop, so once the panel has enough content to
// scroll (any real multi-minute session) and gets scrolled away from
// the top -- the panel is deliberately touch-scrollable, so any real
// touch on it could do this -- a brand new event still renders but sits
// scrolled OUT OF the visible viewport, invisible on screen even though
// it's genuinely in the DOM. Directly reproduced: padded the panel with
// realistic content, scrolled it away from the top, fired a real
// notable event, and confirmed via getBoundingClientRect() that the new
// entry's rect sat entirely above the panel's own visible rect. This is
// a real, plausible explanation for every "the overlay caught nothing"
// report across every round of this investigation so far -- the events
// may well have been firing the whole time, just scrolled out of view.
// The panel's whole purpose is showing the latest event, so forcing it
// back to the top on every update is the correct fix, not a preference.
function renderDiagOverlay(){
  const el = document.getElementById('marqueeDiag');
  if(!el) return;
  const rows = diagNotableEvents.concat(diagRoutineEvents);
  el.innerHTML = '<div class="diag-title">jump diag (scroll for history)</div>' + rows.map((e)=> `<div>${e}</div>`).join('');
  el.scrollTop = 0;
}
function pushDiagEvent(line, notable){
  if(notable){
    diagNotableEvents.unshift(`<span class="diag-hot">${line}</span>`);
    diagNotableEvents.length = Math.min(diagNotableEvents.length, 40);
  } else {
    diagRoutineEvents.unshift(line);
    diagRoutineEvents.length = Math.min(diagRoutineEvents.length, 10);
  }
  renderDiagOverlay();
}
const MARQUEE_DIAG_THRESHOLD = 3; // px/frame of UNEXPLAINED motion before it's logged
function marqueeDiagLog(label, detail){
  const t = new Date().toISOString().slice(11, 23);
  pushDiagEvent(`${t} ${label} ${detail}`, true);
  console.warn('[marquee-diag]', label, detail);
}
const marqueeDiagState = { lastRoloLeft: null, lastGateLeft: null };
// expectedDelta accounts for a normal wrap (the reference element's
// on-screen position legitimately jumps by ~oneSetW the instant
// scrollLeft resets) so that ONLY genuinely unexplained motion --
// content reflow, not the marquee's own intended behavior -- gets
// logged.
function marqueeDiagCheck(el, key, label, expectedDelta, scrollLeftNow){
  if(!el) return;
  const left = el.getBoundingClientRect().left;
  const last = marqueeDiagState[key];
  if(last != null){
    const rawDelta = left - last;
    const unexplained = Math.abs(rawDelta - (expectedDelta || 0));
    if(unexplained > MARQUEE_DIAG_THRESHOLD){
      marqueeDiagLog(label, `moved ${rawDelta.toFixed(1)}px, ${unexplained.toFixed(1)}px unexplained (scrollLeft=${scrollLeftNow})`);
    }
  }
  marqueeDiagState[key] = left;
}
// entry.sources[].node is the real DOM element that moved -- identify it
// by id/class/tag so the overlay names the actual culprit instead of just
// a magnitude, and report each source's own before/after rect so a
// vertical shift (a sticky element's top changing) is just as visible as
// a horizontal one, unlike the marquee-specific check above which only
// ever looked at .left.
function describeShiftNode(node){
  if(!node || !node.nodeType) return '(detached node)';
  if(node.id) return '#'+node.id;
  if(typeof node.className === 'string' && node.className.trim()) return '.'+node.className.trim().split(/\s+/).join('.');
  return node.tagName ? node.tagName.toLowerCase() : '(node)';
}
if('PerformanceObserver' in window){
  try{
    const layoutShiftObserver = new PerformanceObserver((list)=>{
      list.getEntries().forEach((entry)=>{
        // The overlay itself is position:fixed, and mobile browsers shift
        // fixed elements as their own address-bar chrome hides/shows
        // during a scroll -- reported live (Aug 16, 2026) as a cluster of
        // "#marqueeDiag Δy±132" entries with input=true, i.e. the
        // diagnostic catching its OWN repositioning, not anything in the
        // app. Drop any source that IS the overlay, and skip the entry
        // entirely if nothing real is left once that's removed.
        const realSources = (entry.sources || []).filter((s)=> s.node !== document.getElementById('marqueeDiag'));
        if(entry.sources && entry.sources.length && realSources.length === 0) return;
        const t = new Date(performance.timeOrigin + entry.startTime).toISOString().slice(11, 23);
        let maxPx = 0;
        const sources = realSources.map((s)=>{
          const tag = describeShiftNode(s.node);
          const pr = s.previousRect, cr = s.currentRect;
          const dxNum = (pr && cr) ? (cr.x - pr.x) : null;
          const dyNum = (pr && cr) ? (cr.y - pr.y) : null;
          if(dxNum != null) maxPx = Math.max(maxPx, Math.abs(dxNum), Math.abs(dyNum));
          const dx = dxNum != null ? dxNum.toFixed(1) : '?';
          const dy = dyNum != null ? dyNum.toFixed(1) : '?';
          return `${tag} Δx${dx} Δy${dy}`;
        }).join(' | ') || '(no attributed source)';
        pushDiagEvent(`${t} SHIFT val=${entry.value.toFixed(3)} input=${entry.hadRecentInput} ${sources}`, maxPx >= DIAG_NOTABLE_PX);
        console.warn('[layout-shift]', entry.value, entry.hadRecentInput, entry.sources);
      });
    });
    layoutShiftObserver.observe({ type:'layout-shift', buffered:true });
  }catch(e){ console.warn('[layout-shift] PerformanceObserver unavailable', e); }
}

// Same fix as the pill strip's stepRoloMarquee(): scrollLeft snaps
// writes to the nearest whole pixel, so accumulating by reading it back
// each frame compounds that rounding every frame until the wrap check
// fires against an already-drifted value. Tracks the logical position
// as a plain float instead, only writing the rounded result to the real
// scrollLeft.
const GATE_MARQUEE_SPEED = 0.4;
function stepGateMarquee(){
  let wrapDelta = 0;
  if(gateCard.classList.contains('docked') && gateMarqueeOneSetW > 0){
    gateMarqueePos += GATE_MARQUEE_SPEED;
    if(gateMarqueePos >= gateMarqueeOneSetW){ gateMarqueePos -= gateMarqueeOneSetW; wrapDelta = gateMarqueeOneSetW; }
    gateMarquee.scrollLeft = gateMarqueePos;
  }
  marqueeDiagCheck(gateMarquee.querySelector('.gm-item'), 'lastGateLeft', 'GATE', wrapDelta, gateMarquee.scrollLeft);
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
  // Tapping a ticker that hasn't been analyzed yet runs it automatically
  // rather than leaving it on the idle "Tap ANALYZE" state -- direct
  // request, Aug 15, 2026. Only for a ticker with no result yet; revisiting
  // an already-analyzed one just shows what's there, same as tapping any
  // other already-open card.
  const sym = watchlist[roloCurrent];
  const state = sym && tickerState.get(sym);
  if(state && !state.result && !state.analyzing) analyzeOne(sym);
}

// ── Watchlist auto-scroll pill marquee — always running, pauses for a
// flat 2s on real pointer interaction (tap a pill / drag the strip) only.
// Previously also paused on any #roloIndex 'scroll' event whose
// scrollLeft didn't match the marquee's own last self-write, meant to
// catch manual drags the pointer events might miss -- but that
// comparison mistook the marquee's OWN async-dispatched scroll events for
// a manual scroll often enough on a real device to repeatedly self-pause
// ("stopping a lot", reported live Aug 15, 2026), not just the one
// specific timing-flag bug this comment used to describe (see CLAUDE.md
// for that earlier, narrower fix). Removed entirely rather than
// re-tuned -- pointerdown/up/cancel alone already covers both a pill tap
// and a manual drag of the strip. ────────────────────────────────────
let roloMarqueeOneSetW = 0;
let roloCountDivider = null;
// One full "set" is a pass + its trailing count divider -- measured
// directly off the divider's own position rather than assumed as
// scrollWidth/2, since every pass now carries its own divider (see
// renderRolodexFromWatchlist), so any one of them defines the repeat
// width. Uses getBoundingClientRect() (full sub-pixel precision), not
// offsetLeft/offsetWidth (rounds to the nearest integer per spec) --
// reported live (Aug 15, 2026) as a ~5px jump right at the wrap point
// every cycle. offsetLeft+offsetWidth measured 242 for a divider whose
// real edge (via getBoundingClientRect) was 242.42 -- a small but real,
// constant mismatch between where the code wrapped and where the
// content actually repeats, on top of scrollLeft's own integer rounding
// (see stepRoloMarquee below).
function sizeRoloMarquee(){
  if(roloCountDivider){
    const containerLeft = roloIndex.getBoundingClientRect().left;
    const dividerRight = roloCountDivider.getBoundingClientRect().right;
    roloMarqueeOneSetW = (dividerRight - containerLeft) + roloIndex.scrollLeft;
  } else {
    roloMarqueeOneSetW = roloIndex.scrollWidth / 2;
  }
}
window.addEventListener('resize', sizeRoloMarquee);

// pauseRoloMarquee schedules its own resume immediately (not just on
// pointerup/cancel) -- reported live, Aug 15, 2026: the marquee could get
// stuck stopped indefinitely after a real touch. On a real device a
// touch that starts as a tap but turns into (or gets interpreted as) a
// page scroll doesn't reliably fire pointerup/pointercancel on
// #roloIndex, the ONLY events that used to schedule the resume -- so a
// pause with no matching pointerup could pause forever. Self-scheduling
// on pointerdown makes 2s the hard ceiling on any pause regardless of
// what happens next; pointerup/pointercancel, when they do fire, just
// reset the same timer to 2s from that later point (right for a normal
// tap/drag), rather than being the only way out of the paused state.
// roloMarqueePos is the marquee's own logical position, tracked as a
// plain float independent of scrollLeft's rounding (confirmed live:
// writing 10.7 reads back as 11, 10.3 reads back as 10 -- the browser
// snaps scrollLeft to whole pixels on every write). Accumulating by
// reading scrollLeft back each frame (the previous approach) compounds
// that rounding every single frame, so by the time the wrap check fires
// the position has drifted a few px from where it should truly be --
// reported live (Aug 15, 2026) as a ~5px jump right at the wrap point.
// Tracking the true position separately and only rounding on the
// final write to scrollLeft bounds the error to at most one frame's
// rounding instead of letting it compound.
let roloMarqueePos = 0;
// A chip's price starts as a "—" placeholder and swaps to a real
// "$969.33" once fetchTickerData resolves -- a real, often much wider
// piece of text. Reported live (Aug 15, 2026): if that swap happens for
// a chip sitting UPSTREAM of the currently-visible portion of the strip
// while the marquee is already scrolling, the reflow shifts everything
// after it, so the SAME scrollLeft number suddenly shows different
// content -- a real visual jump that scrollLeft itself never reflects
// (confirmed by tracking the divider's actual on-screen position, not
// scrollLeft: a 76px jump with scrollLeft moving by 1). Held off
// entirely until this render pass's real data has actually loaded, so
// there's no reflow left to happen once it starts moving.
let roloMarqueeDataReady = false;
let roloMarqueePaused = false, roloMarqueeResumeTimer = null;
function scheduleRoloMarqueeResume(){
  clearTimeout(roloMarqueeResumeTimer);
  roloMarqueeResumeTimer = setTimeout(()=>{
    // Pick up wherever the user actually left it (a tap or a manual
    // drag both move the real scrollLeft) rather than resuming from the
    // marquee's own stale pre-pause position.
    roloMarqueePos = roloIndex.scrollLeft;
    roloMarqueePaused = false;
  }, 2000);
}
function pauseRoloMarquee(){ roloMarqueePaused = true; scheduleRoloMarqueeResume(); }
roloIndex.addEventListener('pointerdown', pauseRoloMarquee);
roloIndex.addEventListener('pointerup', scheduleRoloMarqueeResume);
roloIndex.addEventListener('pointercancel', scheduleRoloMarqueeResume);

// Ground-truth scrollLeft watcher (Aug 16, 2026) -- a real device video
// caught a genuine, precise ~26px single-frame jump in the pill row with
// ZERO interaction (no touch, no scroll, page untouched, ~2.6s after
// load), immediately self-correcting on the very next frame back to the
// established smooth rate -- and NEITHER existing diagnostic saw it.
// Root cause still unconfirmed, but the self-correcting-in-one-frame
// shape is consistent with something OTHER than stepRoloMarquee's own
// write briefly setting scrollLeft, which stepRoloMarquee's very next
// frame then silently overwrites back to the correct roloMarqueePos-
// derived value before marqueeDiagCheck (which reads synchronously right
// after stepRoloMarquee's OWN write, same call) ever gets a chance to see
// the interfering value. The browser's native 'scroll' event fires for
// ANY scrollLeft mutation regardless of source or timing, so it's the one
// mechanism that can't share that blind spot. Compares what actually
// landed against what roloMarqueePos (our own intended value) says it
// should be; only logs on a real mismatch, since a matching scroll event
// fires on every single one of our own routine writes too.
function watchRoloScrollGroundTruth(){
  const expected = Math.round(roloMarqueePos);
  const actual = roloIndex.scrollLeft;
  if(Math.abs(actual - expected) > 2){
    const t = new Date().toISOString().slice(11, 23);
    pushDiagEvent(`${t} SCROLL-GT mismatch: scrollLeft=${actual} expected(roloMarqueePos)=${expected} Δ=${actual-expected}`, true);
    console.warn('[scroll-ground-truth]', { actual, expected, roloMarqueePos, roloMarqueePaused, roloMarqueeDataReady });
  }
}
roloIndex.addEventListener('scroll', watchRoloScrollGroundTruth, { passive:true });

// Heartbeat + self-healing loop (Aug 16, 2026) -- a THIRD real device
// video showed the exact same precise, permanent jump, and STILL zero
// new diagnostic entries appeared for the entire clip, even though
// marqueeDiagCheck's own logic (a plain 3px threshold compare, running
// unconditionally every call) has no structural reason to miss a real
// ~7 CSS px (~26 real device px) shift. That leaves one untested
// possibility: this function's own rAF chain silently dying (an
// uncaught exception anywhere in here stops `requestAnimationFrame`
// from ever being called again, with nothing visible on a real phone to
// say so) -- which would explain BOTH symptoms at once, since
// marqueeDiagCheck only ever runs from inside this same function. The
// continuing steady visual motion doesn't rule this out either: with
// `-webkit-overflow-scrolling:touch` + `touch-action:pan-x` on
// #roloIndex, native momentum/anchoring scrolling could plausibly keep
// things moving even if this JS loop itself had already died.
// roloMarqueeHeartbeat is a live, always-current timestamp (not a log
// entry) proving on the next screenshot/video whether this function is
// genuinely still executing at that moment. The try/catch makes the loop
// self-healing regardless of root cause -- any exception gets surfaced
// via pushDiagEvent instead of silently and permanently killing the
// chain, and requestAnimationFrame is guaranteed to be re-scheduled from
// a finally block either way.
let roloMarqueeHeartbeat = 0;
let roloMarqueeHeartbeatErrorLogged = false;
// A FOURTH real video (Aug 16, 2026) reproduced the same ~26-27px jump
// yet again, and this time the heartbeat -- visible in-frame, ticking
// 4905 -> 4935 across the exact moment of the jump -- proved the loop
// was definitely alive and running normally right through it. That
// rules out a dead loop for good, and points at a real, different gap:
// marqueeDiagCheck only ever tracks ONE reference element
// (roloCountDivider, specifically the FIRST pass's divider). If a
// chip's rendered width changes somewhere else in the strip -- a LATER
// pass's copy of a ticker, say, since renderPill() updates every
// duplicate instance of a symbol independently rather than through one
// shared node -- content before that point in DOM order wouldn't shift
// at all, while the divider being tracked could easily sit on the wrong
// side of that boundary and see nothing, even though real content
// on-screen visibly jumped. roloIndex.scrollWidth is immune to this --
// it reflects the strip's TOTAL content width regardless of WHERE in
// the DOM a change happens, so a real per-chip width change shows up
// here no matter which specific element caused it.
let roloLastScrollWidth = null;
function checkRoloScrollWidth(){
  const w = roloIndex.scrollWidth;
  if(roloLastScrollWidth != null && w !== roloLastScrollWidth){
    const t = new Date().toISOString().slice(11, 23);
    pushDiagEvent(`${t} SCROLLWIDTH changed ${roloLastScrollWidth}->${w} (Δ${w-roloLastScrollWidth})`, true);
    console.warn('[rolo-scrollwidth]', { from:roloLastScrollWidth, to:w });
  }
  roloLastScrollWidth = w;
}
const ROLO_MARQUEE_SPEED = 0.5;
function stepRoloMarquee(){
  try{
    roloMarqueeHeartbeat++;
    if(roloMarqueeHeartbeat % 15 === 0){
      const hb = document.getElementById('diagHeartbeat');
      if(hb) hb.textContent = 'loop alive: ' + new Date().toISOString().slice(11, 23) + ' (tick ' + roloMarqueeHeartbeat + ')';
    }
    let wrapDelta = 0;
    if(!roloMarqueePaused && roloMarqueeDataReady && roloMarqueeOneSetW > 0){
      roloMarqueePos += ROLO_MARQUEE_SPEED;
      if(roloMarqueePos >= roloMarqueeOneSetW){ roloMarqueePos -= roloMarqueeOneSetW; wrapDelta = roloMarqueeOneSetW; }
      // Mitigation, not a confirmed fix (Aug 16, 2026) -- a SIXTH real
      // video reproduced the same precise jump yet again, and this time
      // the overlay was checked at the start, middle, and end of the
      // whole clip: byte-identical throughout, despite the heartbeat
      // climbing steadily the entire time (proving the loop never
      // stopped and nothing is wrong with the render/update pipeline
      // itself -- it's just that scrollLeft, scrollWidth, and layout-
      // shift genuinely never fired). Six occurrences, every JS/DOM-
      // level mechanism this investigation could build has come back
      // empty every time. The remaining, unfalsifiable-from-JS
      // possibility: this is happening at the paint/compositor layer,
      // not the layout layer getBoundingClientRect() and friends can
      // see. Writing a FRACTIONAL scrollLeft every frame (roloMarqueePos
      // is a plain float) is exactly the kind of thing that could stress
      // sub-pixel-to-device-pixel rounding at paint time in a way this
      // page's own JS has no visibility into (confirmed earlier this
      // investigation: reading scrollLeft back always reports an
      // integer, but that doesn't guarantee what was internally applied
      // for compositing was equally unambiguous). Rounding to a whole
      // CSS pixel before every write removes that ambiguity outright,
      // regardless of whether it's actually the cause -- a plausible,
      // low-risk, reversible mitigation given diagnosis has hit a real
      // wall, not another guessed "fix."
      roloIndex.scrollLeft = Math.round(roloMarqueePos);
    }
    marqueeDiagCheck(roloCountDivider, 'lastRoloLeft', 'ROLO', wrapDelta, roloIndex.scrollLeft);
    checkRoloScrollWidth();
  }catch(e){
    if(!roloMarqueeHeartbeatErrorLogged){
      roloMarqueeHeartbeatErrorLogged = true;
      pushDiagEvent(new Date().toISOString().slice(11, 23) + ' ROLO-LOOP-ERROR: ' + (e && e.message || e), true);
      console.error('[rolo-marquee-loop]', e);
    }
  }finally{
    requestAnimationFrame(stepRoloMarquee);
  }
}
requestAnimationFrame(stepRoloMarquee);

// ── Build/rebuild the rolodex from the current watchlist ─────────────
async function renderRolodexFromWatchlist(){
  document.getElementById('ticker-count').textContent = 'CRF · ' + watchlist.length + ' TICKERS';
  roloStage.innerHTML = '';
  roloIndex.innerHTML = '';
  // Clearing #roloIndex resets its real scrollLeft to 0 -- the marquee's
  // own logical-position tracker needs to reset with it, or it goes
  // stale and jumps hard to catch up on the very next frame. Also held
  // paused (see stepRoloMarquee) until this pass's real ticker data has
  // loaded and every chip has already reflowed to its final width, so
  // there's nothing left to shift once it actually starts moving.
  roloMarqueePos = 0;
  roloMarqueeDataReady = false;
  roloLastScrollWidth = null;
  watchlist.forEach((sym)=>{
    if(!tickerState.has(sym)) tickerState.set(sym, { td:null, result:null, analyzing:false, error:null });
    const card = document.createElement('div');
    card.className = 'rolo-card'; card.dataset.sym = sym;
    roloStage.appendChild(card);
    renderRoloCard(sym);
  });
  // Each pass gets its OWN "— N —" divider right after it, not just the
  // first -- direct report, Aug 15, 2026: with only one divider in the
  // whole strip, most loops through the watchlist showed no marker at
  // all, then it would suddenly appear once per full wrap cycle,
  // reading as "inserted as an afterthought" instead of naturally
  // recurring at the end of every pass. Every pass+divider chunk is now
  // the same width, which also keeps the marquee's wrap math (below)
  // correct regardless of how many passes get appended.
  function appendChipPass(){
    watchlist.forEach((sym, i)=>{
      const chip = document.createElement('button');
      chip.className = 'rolo-chip'; chip.dataset.sym = sym; chip.dataset.idx = String(i);
      chip.addEventListener('click', ()=> goRolo(i));
      // A real bug found while investigating the marquee jump (Aug 16,
      // 2026): tapping a chip focuses this <button>, and the browser's
      // own default "scroll the newly-focused element into view"
      // behavior yanks #roloIndex's scrollLeft to wherever that chip
      // happens to sit -- fully independent of roloMarqueePos, and
      // since goRolo's tap also pauses the marquee for 2s, nothing
      // corrects it back until the resume timer fires, leaving a real
      // visible jump sitting on screen the whole pause. preventDefault()
      // on pointerdown stops the click from moving focus at all (the
      // click and goRolo() still fire normally), which is the standard
      // fix for "don't let this button's tap auto-scroll its container"
      // -- doesn't affect keyboard/Tab navigation, which still focuses
      // and scrolls normally as accessibility requires.
      chip.addEventListener('pointerdown', (e)=> e.preventDefault());
      roloIndex.appendChild(chip);
      renderPill(sym);
    });
    const divider = document.createElement('span');
    divider.className = 'rolo-divider';
    divider.textContent = `— ${watchlist.length} —`;
    roloIndex.appendChild(divider);
    return divider;
  }
  roloCountDivider = appendChipPass();
  // On a short watchlist (Free's 3-ticker cap) in a wide-ish viewport, one
  // "set" (a pass + its divider) is WIDER than the browser's native
  // scrollable room past a single duplicate pass -- scrollLeft creeps a
  // few px, hits that hard native clamp, and can never reach the distance
  // needed to wrap. Not a pause bug: it's stuck, not paused, but reads
  // identically to "doesn't auto-scroll at all". Keep appending duplicate
  // passes (each with its own divider) until there's actually enough
  // scrollable room to traverse one full set; guarded so an unexpected
  // empty watchlist can't spin forever.
  const oneSetW = roloCountDivider.offsetLeft + roloCountDivider.offsetWidth;
  for(let guard = 0; guard < 20 && (roloIndex.scrollWidth - roloIndex.clientWidth) < oneSetW; guard++){
    appendChipPass();
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
  // Every chip has now reflowed to its final (real-price) width -- safe
  // to let the marquee start moving. One more measurement first: the
  // per-symbol requestAnimationFrame(sizeRoloMarquee) calls above each
  // fire after their own symbol's data lands, but the LAST one to land
  // is what actually leaves the strip in its final layout, so re-measure
  // once more against that settled state rather than trusting whichever
  // of those calls happened to run last.
  requestAnimationFrame(()=>{
    sizeRoloMarquee();
    roloMarqueeDataReady = true;
  });
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
