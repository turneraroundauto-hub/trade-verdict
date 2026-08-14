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
    btn.textContent = 'SIGN UP / SIGN IN';
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

function sizeGateSpacer(){
  const fullH = gateFullOverlay.getBoundingClientRect().height;
  spacerHeight = Math.max(0, fullH - GATE_DOCKED_H);
  gateSpacer.style.height = spacerHeight + 'px';
}
window.addEventListener('resize', sizeGateSpacer);

let gateTicking = false;
scroller.addEventListener('scroll', ()=>{
  if(gateTicking) return;
  gateTicking = true;
  requestAnimationFrame(()=>{
    const docked = scroller.scrollTop >= spacerHeight;
    gateCard.classList.toggle('docked', docked);
    gateCard.setAttribute('aria-expanded', String(!docked));
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

// ── Utility card accordion (Pulse/Context/Import) + sticky docking ──
const utilityCards = Array.from(document.querySelectorAll('.card[data-card]'));
function utilityCardHeight(card){
  const cs = getComputedStyle(card);
  const borderH = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
  const headH = card.querySelector('.card-head').getBoundingClientRect().height;
  if(!card.classList.contains('expanded')) return borderH + headH;
  return borderH + headH + card.querySelector('.card-body-inner').scrollHeight;
}
function updateStickyOffsets(){
  let top = GATE_DOCKED_H;
  utilityCards.forEach((card)=>{
    card.style.top = top + 'px';
    top += utilityCardHeight(card);
  });
}
window.addEventListener('resize', updateStickyOffsets);

function wireAccordionHead(head){
  function toggle(){
    const card = head.closest('.card');
    const wasExpanded = card.classList.contains('expanded');
    card.classList.toggle('expanded', !wasExpanded);
    head.setAttribute('aria-expanded', String(!wasExpanded));
    updateStickyOffsets();
  }
  head.addEventListener('click', toggle);
  head.addEventListener('keydown', (e)=>{ if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); toggle(); } });
}
document.querySelectorAll('.card[data-card] > .card-head').forEach(wireAccordionHead);

// ── Rolodex: real ticker data, real /analyze ─────────────────────────
const VERDICT_CLASS = { up:'vc-up', down:'vc-down', flat:'vc-flat', pending:'vc-pending' };
const VERDICT_LABEL = { up:'UP', down:'DOWN', flat:'FLAT', pending:'NOT RUN' };
const roloStage = document.getElementById('roloStage');
const roloIndex = document.getElementById('roloIndex');
let roloCurrent = 0;
/** ticker -> { td, verdict, analyzeResult } */
const tickerState = new Map();

function verdictKind(result){
  if(!result) return 'pending';
  const v = (result.verdict || 'FLAT').toLowerCase();
  return v === 'up' ? 'up' : v === 'down' ? 'down' : 'flat';
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
  return '<div class="gate-list">' + rows + '</div>';
}

function roloCardHTML(sym, state){
  const td = state.td;
  const price = td && td.metrics && td.metrics.price != null ? '$' + td.metrics.price.toFixed(2) : '—';
  const news = td && td.news;
  const headline = news ? news.headline : 'No news within the last business week';
  const age = news ? news.ageLabel : '—';
  const kind = verdictKind(state.result);
  const m = td && td.metrics;
  const w52 = m && m.rangePosition != null ? m.rangePosition + '%' : '?';
  const phase = m && m.phaseProxy ? m.phaseProxy.replace('PHASE_','') : '?';
  const beta = m && m.beta ? m.beta.toFixed(1) : '?';
  const proxyName = td && td.proxyRule && td.proxyRule.proxy ? td.proxyRule.proxy.name.split('(')[0].trim() : '?';
  const analyzing = state.analyzing;
  return `<div class="ticker-row">`
    + `<span class="ticker-sym">${sym}</span><span class="ticker-price">${price}</span>`
    + `<span class="verdict-chip ${VERDICT_CLASS[kind]}">${state.result ? VERDICT_LABEL[kind] : (analyzing ? 'RUNNING…' : 'NOT RUN')}</span>`
    + `</div>`
    + `<div class="headline">${headline} <span class="age">${age}</span></div>`
    + `<div class="meta-row"><span>52W <b>${w52}</b></span><span>PHASE <b>${phase}</b></span><span>β <b>${beta}</b></span><span>PROXY <b style="color:var(--blue)">${proxyName}</b></span></div>`
    + gateListHTML(state.result)
    + `<div class="rolo-analyze-row"><button class="btn btn-blue" data-analyze="${sym}" ${analyzing?'disabled':''}>${analyzing?'RUNNING…':(state.result?'RE-ANALYZE':'ANALYZE')}</button></div>`
    + (state.error ? `<div class="gate-note" style="color:var(--red);margin-top:6px">${state.error}</div>` : '');
}

function renderRoloCard(sym){
  const card = roloStage.querySelector(`.rolo-card[data-sym="${sym}"]`);
  if(!card) return;
  card.innerHTML = roloCardHTML(sym, tickerState.get(sym));
  const btn = card.querySelector('[data-analyze]');
  if(btn) btn.addEventListener('click', ()=> analyzeOne(sym));
}

function renderPill(sym){
  document.querySelectorAll(`.rolo-chip[data-sym="${sym}"]`).forEach((chip)=>{
    const state = tickerState.get(sym);
    const td = state && state.td;
    const price = td && td.metrics && td.metrics.price != null ? '$' + td.metrics.price.toFixed(2) : '—';
    const pct = td && td.metrics && typeof td.metrics.pct === 'number' ? td.metrics.pct : 0;
    const perf = pct > 0.05 ? 'perf-up' : pct < -0.05 ? 'perf-down' : 'perf-flat';
    chip.className = 'rolo-chip ' + perf + (chip.dataset.idx === String(roloCurrent) ? ' active' : '');
    chip.innerHTML = `<span class="rc-sym">${sym}</span><span class="rc-price">${price}</span>`;
  });
}

function positionRoloStack(){
  const cards = Array.from(roloStage.querySelectorAll('.rolo-card'));
  cards.forEach((card, i)=>{
    const d = i - roloCurrent, abs = Math.abs(d);
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
function sizeRoloMarquee(){ roloMarqueeOneSetW = roloIndex.scrollWidth / 2; }
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
  document.getElementById('roloCount').textContent = String(watchlist.length);
  roloStage.innerHTML = '';
  roloIndex.innerHTML = '';
  watchlist.forEach((sym)=>{
    if(!tickerState.has(sym)) tickerState.set(sym, { td:null, result:null, analyzing:false, error:null });
    const card = document.createElement('div');
    card.className = 'rolo-card'; card.dataset.sym = sym;
    roloStage.appendChild(card);
    renderRoloCard(sym);
  });
  // Two identical chip sets back to back so the marquee wraps seamlessly.
  for(let pass = 0; pass < 2; pass++){
    watchlist.forEach((sym, i)=>{
      const chip = document.createElement('button');
      chip.className = 'rolo-chip'; chip.dataset.sym = sym; chip.dataset.idx = String(i);
      chip.addEventListener('click', ()=> goRolo(i));
      roloIndex.appendChild(chip);
      renderPill(sym);
    });
  }
  roloCurrent = Math.min(roloCurrent, Math.max(0, watchlist.length-1));
  positionRoloStack();
  requestAnimationFrame(()=>{ sizeGateSpacer(); updateStickyOffsets(); sizeRoloMarquee(); });

  await Promise.all(watchlist.map(async (sym)=>{
    const td = await fetchTickerData(sym);
    const state = tickerState.get(sym);
    if(state){ state.td = td; }
    renderRoloCard(sym);
    renderPill(sym);
    requestAnimationFrame(()=>{ updateStickyOffsets(); sizeRoloMarquee(); });
  }));
}

// ── /analyze — real credit-consuming call, same payload shape as every
// tier's client (see server.js's /analyze handler). ──────────────────
function buildSectorContext(){
  const f = (k)=> market && market[k] ? market[k].change : '?';
  return {
    spy:f('spy'), qqq:f('qqq'), btc:f('btc'), iwm:f('iwm'), soxx:f('soxx'), xbi:f('xbi'),
    ibb:f('ibb'), gld:f('gld'), uso:f('uso'), tsm:f('tsm'), msft:f('msft'),
    gateStatus: market ? (market.gateStatus||'GREEN') : 'GREEN',
    gateNote: market ? (market.gateNote||'') : '',
    btcSignal: market ? (market.btcSignal||'neutral') : 'neutral',
  };
}

async function analyzeOne(sym){
  const state = tickerState.get(sym);
  if(!state || state.analyzing) return;
  state.analyzing = true; state.error = null;
  renderRoloCard(sym);
  const ctx = document.getElementById('context-input').value;
  const td = state.td || await fetchTickerData(sym);
  state.td = td;
  try{
    const res = await fetch(addSecret(API_URL+'/analyze'), {
      method:'POST', headers:authH(),
      body: JSON.stringify({
        ticker: sym, sectorContext: buildSectorContext(), marketContext: ctx,
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
    if(!res.ok){
      const errData = await res.json().catch(()=>({}));
      if(res.status === 402 && errData.code === 'NO_CREDITS'){
        state.error = 'Out of credits — ' + (sbSession && sbSession.token ? 'buy more or upgrade.' : 'sign in to add credits.');
      } else {
        state.error = errData.error || ('Server error ' + res.status);
      }
      state.analyzing = false;
      renderRoloCard(sym);
      fetchCreditStatus();
      return;
    }
    const data = await res.json();
    state.result = data; state.analyzing = false;
    renderRoloCard(sym); renderPill(sym);
    fetchCreditStatus();
  }catch(e){
    state.error = e.message; state.analyzing = false;
    renderRoloCard(sym);
  }
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

// ── init ───────────────────────────────────────────────────────────
updateAuthButton();
loadWatchlist();
sizeGateSpacer();
updateStickyOffsets();
fetchMarket();
fetchCreditStatus();
renderRolodexFromWatchlist();
