import { initTickerCache, fetchTickerData } from '../shared/ticker-cache.js?v=4';
import { initWatchlist, watchlist, addTickers, renderWatchlist, updateCardMeta, setWatchlist, removeTicker, setRenderScope, getOverflow, onRenderWatchlist, onWatchlistSave } from '../shared/watchlist.js?v=13';
import { cleanLS, cacheVerdict, getCachedVerdict } from '../shared/analysis-cache.js?v=2';
import { renderTrackRecord, logResult, getAccuracyLog, clearLog, onLogSave } from '../shared/track-record.js?v=4';
import { initTrackRecordSync, pullTrackRecordFromServer, schedulePushTrackRecord } from '../shared/track-record-sync.js?v=1';
import { initWatchlistSync, pullWatchlistFromServer, schedulePushWatchlist } from '../shared/watchlist-sync.js?v=6';

// Concurrency-limited Promise.all: runs `fn` over `items` in batches of
// `size` instead of firing them all simultaneously, but still returns
// results in the original order like Promise.all would. Bursting many
// concurrent /ticker/:symbol requests (one full watchlist render, or a
// panel covering the whole list) is exactly the kind of spike that can
// trip an upstream provider's rate limit and leave results silently blank
// (fetchTickerData swallows its own errors and resolves null on failure).
async function mapBatched(items,size,fn){
  var out=[];
  for(var i=0;i<items.length;i+=size){
    var batch=await Promise.all(items.slice(i,i+size).map(fn));
    out=out.concat(batch);
  }
  return out;
}

const API_URL='https://tra-zacg.onrender.com';
const SUPABASE_URL='https://oinomcikdyisrbfeeirp.supabase.co';
const SUPABASE_ANON='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9pbm9tY2lrZHlpc3JiZmVlaXJwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ2NzM3NzgsImV4cCI6MjEwMDI0OTc3OH0.PiMDYsSZjNd4Iw-0wbQH4niDvUmW8ymycmiyb5Raf1w';

const TIER = {
  name:         'Pro',
  maxTickers:   999,
  pulse:        true,
  tracker:      true,
  alpaca:       false,
  credits:      '100 credits/mo',
  cache:        '1 min cache',
  nextTier:     "Shark",
  nextPrice:    "$39.99/mo",
  stripeLink:   "https://buy.stripe.com/14A8wQdoJ7fx6lpb3z3VC01",
  creditsLink:  'https://buy.stripe.com/3cI3cwacxarJ8txb3z3VC00',
  badgeColor:   '#ce93d8',
};

// Pro's card/watchlist split: watchlist itself stays unlimited (maxTickers
// below), but only the first CARD_CAP tickers, in watchlist order, ever
// render as full analysis cards — the rest render as compact price/%chg
// rows with no ANALYZE button and no credit cost. See setRenderScope() in
// shared/watchlist.js.
const CARD_CAP=15;

let market=null;
// Last /analyze result per ticker — kept so the Analyst View panel and the
// track-record log buttons can read gate/proxy detail without a re-fetch.
var lastAnalysis={};

function isMarketClosed(){
  var now=new Date();
  var et=new Date(now.toLocaleString('en-US',{timeZone:'America/New_York'}));
  var day=et.getDay();
  if(day===0||day===6)return true;
  var mins=et.getHours()*60+et.getMinutes();
  return mins<570||mins>=960;
}

function sigColor(s){return{GREEN:'var(--green)',RED:'var(--red)',YELLOW:'var(--amber)','N/A':'var(--dim)'}[s]||'var(--dim)'}
function dirColor(d){return{green:'var(--green)',red:'var(--red)',flat:'var(--amber)'}[d]||'var(--white)'}

function startClock(){
  function tick(){
    var now=new Date(),et=new Date(now.toLocaleString('en-US',{timeZone:'America/New_York'}));
    var h=et.getHours(),m=et.getMinutes(),s=et.getSeconds();
    var p=function(n){return String(n).padStart(2,'0')};
    var h12=h%12||12,ampm=h<12?'AM':'PM';
    var cl=document.getElementById('live-clock');
    if(cl)cl.textContent=h12+':'+p(m)+':'+p(s)+' '+ampm+' ET';
  }
  tick();setInterval(tick,1000);
}

async function fetchMarket(force){
  force=force||false;
  document.getElementById('gate-label').textContent='LOADING...';
  document.getElementById('gate-label').style.color='var(--dim)';
  document.getElementById('pulse-text').className='pulse-loading';
  document.getElementById('pulse-text').textContent='Generating market pulse...';
  try{
    var url=force?addSecret(API_URL+'/market?force=true'):addSecret(API_URL+'/market');
    var res=await fetch(url,{headers:authH()});
    var data=await res.json();
    market=data;
    var fields=[['spy','spy-val'],['qqq','qqq-val'],['btc','btc-val'],['soxx','soxx-val'],['xbi','xbi-val'],['iwm','iwm-val'],['gld','gld-val'],['uso','uso-val'],['tsm','tsm-val'],['msft','msft-val']];
    fields.forEach(function(f){
      var el=document.getElementById(f[1]);if(!el)return;
      var d=data[f[0]];
      if(!d||d.change==='?'){el.textContent='?';el.style.color='var(--dim)'}
      else{el.textContent=d.change;el.style.color=dirColor(d.direction)}
    });
    var gc=sigColor(data.gateStatus||'GREEN');
    document.getElementById('gate-dot').style.background=gc;
    var gl=document.getElementById('gate-label');
    gl.style.color=gc;gl.textContent=(data.gateStatus||'GREEN')+' GATE';
    document.getElementById('gate-note').textContent=data.gateNote||'';
    var btcEl=document.getElementById('btc-signal');
    if(data.btcSignal&&data.btcSignal!=='neutral'){
      btcEl.style.display='block';
      btcEl.textContent='BTC SIGNAL: '+data.btcSignal.toUpperCase();
      btcEl.style.color=data.btcSignal==='full conviction'?'var(--green)':data.btcSignal==='risk-off'?'var(--red)':'var(--amber)';
    }else btcEl.style.display='none';
    var tsmEl=document.getElementById('tsm-warning');
    if(data.tsmWarning){tsmEl.style.display='block';tsmEl.textContent=data.tsmWarning}else tsmEl.style.display='none';
    if(data.timestamp){
      var t=new Date(data.timestamp).toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'});
      document.getElementById('ts').textContent=(data.cached?'⚡ Cached':'🔴 Live')+' · Updated '+t;
    }
    var pulseEl=document.getElementById('pulse-text');
    if(data.pulse){pulseEl.className='pulse-text';pulseEl.textContent=data.pulse}
    else{pulseEl.className='pulse-loading';pulseEl.textContent='Generating pulse...'}
  }catch(e){
    document.getElementById('gate-label').textContent='DATA ERROR';
    document.getElementById('gate-label').style.color='var(--red)';
    document.getElementById('gate-note').textContent='Tap ↻ REFRESH to retry';
    document.getElementById('pulse-text').textContent='Unavailable';
  }
}

export async function analyzeTicker(ticker){
  var card=document.getElementById('card-'+ticker);if(!card)return;
  var ctx=document.getElementById('context-input').value;
  var sc={
    spy:market&&market.spy?market.spy.change:'?',
    qqq:market&&market.qqq?market.qqq.change:'?',
    btc:market&&market.btc?market.btc.change:'?',
    iwm:market&&market.iwm?market.iwm.change:'?',
    soxx:market&&market.soxx?market.soxx.change:'?',
    xbi:market&&market.xbi?market.xbi.change:'?',
    ibb:market&&market.ibb?market.ibb.change:'?',
    gld:market&&market.gld?market.gld.change:'?',
    uso:market&&market.uso?market.uso.change:'?',
    tsm:market&&market.tsm?market.tsm.change:'?',
    msft:market&&market.msft?market.msft.change:'?',
    gateStatus:market?market.gateStatus||'GREEN':'GREEN',
    gateNote:market?market.gateNote||'':'',
    btcSignal:market?market.btcSignal||'neutral':'neutral'
  };
  card.querySelector('.card-action').innerHTML='<div style="display:flex;flex-direction:column;align-items:center;gap:2px"><div class="spinner"></div><span class="spinner-label">RUNNING</span></div>';
  var reReset=card.querySelector('.reason-txt');reReset.textContent='';reReset.style.display='none';
  card.classList.remove('up','down','flat','rim-green','rim-yellow','rim-red','loading');
  card.querySelector('.ticker-name').classList.remove('up','down','flat');
  var pe=card.querySelector('.ticker-price');if(pe)pe.classList.remove('up','down','flat');
  card.querySelector('.card-badges').innerHTML='';
  var gs=card.querySelector('.gate-section');gs.innerHTML='';gs.style.display='none';
  var pgs=card.querySelector('.pregate-strip');if(pgs){pgs.innerHTML='';pgs.style.display='none';}
  var ls=card.querySelector('.log-section');if(ls){ls.innerHTML='';ls.style.display='none';}
  var as=card.querySelector('.analyst-section');if(as){as.innerHTML='';as.style.display='none';}
  // Await ticker data FIRST so newsData, openingBar, proxyRule are available
  var td=await fetchTickerData(ticker);
  if(td)updateCardMeta(ticker,td);

  try{
    var res=await fetch(addSecret(API_URL+'/analyze'),{method:'POST',headers:authH(),
      body:JSON.stringify({
        ticker:ticker,sectorContext:sc,marketContext:ctx,
        metricsData:td&&td.metrics?td.metrics:null,
        newsData:td&&td.news?td.news:null,
        openingBarData:td&&td.openingBar?td.openingBar:null,
        proxyRule:td&&td.proxyRule?td.proxyRule:null,
        gate1Data:td&&td.gate1?td.gate1:null,
        preGateData:td&&td.preGate?td.preGate:null
      })});
    if(!res.ok){
      var errData=await res.json().catch(function(){return{}});
      if(res.status===402&&errData.code==='NO_CREDITS'){
        handleNoCredits(card,ticker);fetchCreditStatus();return;
      }
      throw new Error(errData.error||'Server error '+res.status);
    }
    var _r=await res.json();cacheVerdict(ticker,_r);renderCardResult(ticker,_r,td);fetchCreditStatus();
  }catch(e){
    card.querySelector('.card-action').innerHTML='<button class="retry-btn" onclick="analyzeTicker(\''+ticker+'\')">RETRY</button>';
    var re=card.querySelector('.reason-txt');re.textContent=e.message;re.style.color='var(--red)';re.style.display='';
  }
}

// Analyze All only ever hits the card window (max CARD_CAP), never the full
// unlimited watchlist — at 3 analyses/credit that caps the cost of one tap
// at CARD_CAP/3 credits (5, at the current 15-card cap), and keeps it
// predictable regardless of how many tickers are tracked in total.
//
// Runs in small batches (4 at a time) instead of firing all CARD_CAP calls
// simultaneously — a full burst means that many concurrent /ticker/:symbol
// cache-miss chains hitting Finnhub/Alpaca/SEC at once, which is exactly
// the kind of spike that trips a provider's rate limiter (SEC's full-text
// search especially) and shows up as slow or timed-out individual tickers.
// Batching trades a little total wall-clock time for reliability.
var ANALYZE_ALL_BATCH = 4;
export async function analyzeAll(){
  var tickers=watchlist.slice(0,CARD_CAP);
  for(var i=0;i<tickers.length;i+=ANALYZE_ALL_BATCH){
    await Promise.all(tickers.slice(i,i+ANALYZE_ALL_BATCH).map(function(t){return analyzeTicker(t)}));
  }
}

// ── PRO — trigger classification ────────────────────────────────────
// Mirrors the exact override-authority reason prefixes server.js writes to
// parsed.reason (see /analyze) so the track-record breakdown attributes each
// logged verdict to the real mechanism that produced it, not a guess.
function classifyTrigger(data){
  var reason=(data&&data.reason)||'';
  if(reason.indexOf('Pre-Gate thesis-integrity override')===0)return'pre-gate';
  if(reason.indexOf('Broad market failure')===0)return'gate0';
  if(reason.indexOf('Gate 1 structural breakdown override')===0)return'gate1';
  if(reason.indexOf('Gate 5 forceDown')===0)return'gate5';
  if(data&&data.verdict==='DOWN')return'corroboration';
  return'standard';
}
var TRIGGER_LABELS={
  'pre-gate':'PRE-GATE OVERRIDE','gate0':'GATE 0 OVERRIDE','gate1':'GATE 1 OVERRIDE',
  'gate5':'GATE 5 OVERRIDE','corroboration':'2+ GATE CORROBORATION','standard':'STANDARD VERDICT'
};

export function logResultUI(ticker,verdict,correct,btnEl){
  var rowEl=btnEl.closest('.log-row');if(!rowEl)return;
  var meta={trigger:classifyTrigger(lastAnalysis[ticker])};
  logResult(ticker,verdict,correct,rowEl,meta);
  renderGateAttribution();
  renderTickerAccuracy();
}

function renderCardResult(ticker,data,td){
  var card=document.getElementById('card-'+ticker);
  if(!card)return;
  lastAnalysis[ticker]=data;

  var v=data.verdict||'FLAT';
  var isUp=v==='UP',isDown=v==='DOWN';

  // Color the card border and ticker name per direction
  card.classList.remove('up','down','flat');
  card.classList.add(isUp?'up':isDown?'down':'flat');
  var nameEl=card.querySelector('.ticker-name');
  nameEl.classList.remove('up','down','flat');
  nameEl.classList.add(isUp?'up':isDown?'down':'flat');
  var priceEl=card.querySelector('.ticker-price');
  if(priceEl){priceEl.classList.remove('up','down','flat');priceEl.classList.add(isUp?'up':isDown?'down':'flat')}

  var actionEl=card.querySelector('.card-action');

  // IF market is closed THEN show HOLD, ELSE show the real verdict
  if(isMarketClosed()){
    var d=document.createElement('div');
    d.className='verdict-container';
    d.onclick=function(){resetCard(ticker)};
    var s1=document.createElement('span');s1.className='verdict-hold';s1.textContent='HOLD';
    var s2=document.createElement('span');s2.className='verdict-lbl-hold';s2.textContent='MKT CLOSED';
    d.appendChild(s1);d.appendChild(s2);
    actionEl.innerHTML='';actionEl.appendChild(d);
  } else if(isUp){
    actionEl.innerHTML='<div class="verdict-container" onclick="resetCard(\''+ticker+'\')"><span class="verdict-up">👍</span><span class="verdict-lbl-up">UP</span></div>';
  } else if(isDown){
    actionEl.innerHTML='<div class="verdict-container" onclick="resetCard(\''+ticker+'\')"><span class="verdict-down">👎</span><span class="verdict-lbl-down">DOWN</span></div>';
  } else{
    actionEl.innerHTML='<div class="verdict-container" onclick="resetCard(\''+ticker+'\')"><span class="verdict-hold">HOLD</span><span class="verdict-lbl-hold">WAIT &amp; WATCH</span></div>';
  }

  // Reason text is intentionally not shown here — it duplicates the
  // Gate Breakdown dropdown, and the override text (when present) surfaces
  // in the Analyst View's VERDICT REASON row instead. Element stays in the
  // DOM (hidden) so the error path above can still surface fetch failures.
  var re=card.querySelector('.reason-txt');
  re.textContent='';re.style.display='none';

  // Badges
  var badgesEl=card.querySelector('.card-badges');badgesEl.innerHTML='';
  if(data.type){var tc={CANARY:'var(--amber)',SENTIMENT:'var(--blue)',FLOW:'var(--green)'}[data.type]||'var(--dim)';badgesEl.innerHTML+='<span class="badge" style="color:'+tc+';border-color:'+tc+'55;background:'+tc+'11">'+data.type+'</span>'}
  if(data.sizing){
    if(data.sizing!=='NONE'){var sl={FULL:'Full',HALF:'Half',QUARTER:'¼ size'}[data.sizing]||data.sizing;var sc2={FULL:'var(--green)',HALF:'var(--amber)',QUARTER:'var(--amber)'}[data.sizing]||'var(--dim)';badgesEl.innerHTML+='<span class="badge" style="color:'+sc2+';border-color:'+sc2+'55;background:'+sc2+'11">'+sl+'</span>'}
    else{badgesEl.innerHTML+='<span class="badge" style="color:var(--blue);border-color:rgba(64,196,255,.4);background:rgba(64,196,255,.08)">Defined risk</span>'}
  }

  // Log buttons — Pro's tracker is unlocked, no upgrade gate. Bug present in
  // the pre-rebuild pro/index.html (missing closing paren on this.closest())
  // is fixed here by passing the button element in instead of chaining
  // closest() inline in the HTML string.
  var logEl=card.querySelector('.log-section');
  if(logEl){
    logEl.innerHTML='<div class="log-row"><span class="log-prompt">WAS IT RIGHT?</span>'
      +'<button class="log-btn log-btn-right" onclick="logResultUI(\''+ticker+'\',\''+v+'\',true,this)">✓ RIGHT</button>'
      +'<button class="log-btn log-btn-wrong" onclick="logResultUI(\''+ticker+'\',\''+v+'\',false,this)">✗ WRONG</button>'
      +'<button class="log-btn log-btn-skip" onclick="this.closest(\'.log-row\').style.display=\'none\'">SKIP</button></div>';
    logEl.style.display='block';
  }

  // Gate 5 (sector proxy) status dot, front-and-center on the card header.
  var pgEl=card.querySelector('.pregate-strip');
  if(pgEl&&data.gates){
    var g5=data.gates.g5_korea||{};
    var waitText=(data.wait_for&&data.wait_for!=='null')?data.wait_for:'';
    pgEl.innerHTML='<div class="pregate-dot" style="background:'+sigColor(g5.status)+'"></div>'+(waitText?'<div class="pregate-note"><span class="wait-lbl">WAIT FOR </span><span class="wait-txt">'+waitText+'</span></div>':'');
    pgEl.style.display='flex';
  }

  // Gate breakdown
  var gateEl=card.querySelector('.gate-section');
  if(data.gates){
    // Gate 1 dictates the tile rim color (independent of the overall verdict)
    card.classList.remove('rim-green','rim-yellow','rim-red');
    var g1s=data.gates.g1_prewindow&&data.gates.g1_prewindow.status;
    if(g1s==='GREEN')card.classList.add('rim-green');
    else if(g1s==='YELLOW')card.classList.add('rim-yellow');
    else if(g1s==='RED')card.classList.add('rim-red');

    var gates=[['PRE-GATE  THESIS',data.gates.pre_gate],['G1  PRE-WINDOW 14D',data.gates.g1_prewindow],['G2  CATALYST',data.gates.g2_catalyst],['G3  OPENING BAR',data.gates.g3_openbar],['G4  PHASE',data.gates.g4_phase],['G5  SECTOR PROXY',data.gates.g5_korea]];
    var cc=data.confidence==='HIGH'?'var(--green)':data.confidence==='MEDIUM'?'var(--amber)':'var(--red)';
    var gHtml='<button class="expand-btn" onclick="toggleGates(\''+ticker+'\')"><span>GATE BREAKDOWN</span><span id="arrow-'+ticker+'">▼</span></button><div class="gate-list" id="gates-'+ticker+'" style="display:none">';
    gates.forEach(function(g){
      var lbl=g[0],gate=g[1]||{};
      gHtml+='<div class="gate-row"><div class="gate-dot-sm" style="background:'+sigColor(gate.status)+'"></div><div class="gate-content"><div class="gate-header"><span class="gate-lbl">'+lbl+'</span><span class="gate-stat" style="color:'+sigColor(gate.status)+'">'+(gate.status||'')+'</span></div>'+(gate.note?'<div class="gate-note-txt">'+gate.note+'</div>':'')+'</div></div>';
    });
    gHtml+='<div class="conf-row"><span class="conf-lbl">CONFIDENCE</span><span class="conf-val" style="color:'+cc+'">'+data.confidence+'</span></div></div>';
    gateEl.innerHTML=gHtml;gateEl.style.display='block';
  }

  renderAnalystView(ticker,data,td);
}

// ── PRO — Analyst View ────────────────────────────────────────────
// Adds the reasoning the standard Gate Breakdown doesn't carry: the exact
// override mechanism (if any), the corroboration-rule tally the server used
// to decide it, the resolved Gate 5 proxy tier/basket, and any risk flags —
// all sourced from data already returned by /ticker + /analyze, no new
// backend fields required.
function renderAnalystView(ticker,data,td){
  var card=document.getElementById('card-'+ticker);
  if(!card)return;
  // shared/watchlist.js's card template (used by every tier) doesn't carry
  // an analyst-section slot — Pro is the only tier that needs one, so it's
  // created here on first use rather than forking the shared template.
  var wrap=card.querySelector('.analyst-section');
  if(!wrap){wrap=document.createElement('div');wrap.className='analyst-section';wrap.style.display='none';card.appendChild(wrap);}
  if(!data.gates)return;

  var trigger=classifyTrigger(data);
  var triggerColor={
    'pre-gate':'var(--red)','gate0':'var(--red)','gate1':'var(--red)','gate5':'var(--red)',
    'corroboration':'var(--amber)','standard':'var(--dim)'
  }[trigger];

  var g=data.gates;
  var redCount=['g1_prewindow','g2_catalyst','g4_phase','g5_korea'].filter(function(k){
    return g[k]&&g[k].status==='RED';
  }).length;

  var rule=td&&td.proxyRule;
  var proxyHtml='';
  if(rule&&rule.proxy){
    var tier=rule.tier||'primary';
    var tierColor={'primary':'var(--green)','secondary':'var(--amber)','fundamentals-confirmed':'var(--blue)','fundamentals-speculative':'var(--red)'}[tier]||'var(--dim)';
    proxyHtml='<div class="analyst-row"><span class="analyst-lbl">PROXY TIER</span>'
      +'<span class="proxy-tier-badge" style="color:'+tierColor+';border-color:'+tierColor+'55;background:'+tierColor+'11">'+tier.toUpperCase().replace(/-/g,' ')+'</span></div>'
      +'<div class="analyst-note">'+rule.proxy.name+(rule.dynamicallyResolved?' — dynamically resolved (Gate 5)':' — fixed sector proxy')+'</div>';
    if(rule.elevatedCapCeiling||rule.autoExecuteStop){
      proxyHtml+='<div class="analyst-row"><span class="analyst-lbl">RISK FLAGS</span>'
        +(rule.elevatedCapCeiling?'<span class="proxy-tier-badge" style="color:var(--amber);border-color:rgba(255,171,0,.4);background:rgba(255,171,0,.1)">ELEVATED CAP CEILING</span>':'')
        +(rule.autoExecuteStop?'<span class="proxy-tier-badge" style="color:var(--red);border-color:rgba(255,23,68,.4);background:rgba(255,23,68,.1)">AUTO-EXECUTE STOP</span>':'')
        +'</div>';
    }
  }

  var html='<button class="expand-btn expand-btn-purple" onclick="toggleAnalyst(\''+ticker+'\')"><span>ANALYST VIEW</span><span id="analyst-arrow-'+ticker+'">▼</span></button>'
    +'<div class="analyst-list" id="analyst-'+ticker+'" style="display:none">'
    +'<div class="analyst-row"><span class="analyst-lbl">TRIGGER</span><span class="analyst-val" style="color:'+triggerColor+'">'+TRIGGER_LABELS[trigger]+'</span></div>'
    +'<div class="analyst-row"><span class="analyst-lbl">CORROBORATION</span><span class="analyst-val">'+redCount+'/4 non-exempt gates RED</span></div>'
    +(data.reason?'<div class="analyst-row"><span class="analyst-lbl">VERDICT REASON</span></div><div class="analyst-note">'+data.reason+'</div>':'')
    +proxyHtml
    +'</div>';
  wrap.innerHTML=html;wrap.style.display='block';
}

export function toggleAnalyst(ticker){
  var el=document.getElementById('analyst-'+ticker),arrow=document.getElementById('analyst-arrow-'+ticker);
  if(!el||!arrow)return;
  var open=el.style.display==='none';el.style.display=open?'block':'none';arrow.textContent=open?'▲':'▼';
}

export function toggleGates(ticker){
  var el=document.getElementById('gates-'+ticker),arrow=document.getElementById('arrow-'+ticker);
  var open=el.style.display==='none';el.style.display=open?'block':'none';arrow.textContent=open?'▲':'▼';
}

export function resetCard(ticker){
  var card=document.getElementById('card-'+ticker);if(!card)return;
  card.classList.remove('up','down','flat','rim-green','rim-yellow','rim-red','loading');
  card.querySelector('.ticker-name').classList.remove('up','down','flat');
  var pe=card.querySelector('.ticker-price');if(pe)pe.classList.remove('up','down','flat');
  card.querySelector('.card-action').innerHTML='<button class="analyze-btn" onclick="analyzeTicker(\''+ticker+'\')">ANALYZE</button>';
  var reReset2=card.querySelector('.reason-txt');reReset2.textContent='';reReset2.style.display='none';
  card.querySelector('.card-badges').innerHTML='';
  var gs=card.querySelector('.gate-section');gs.innerHTML='';gs.style.display='none';
  var pgs=card.querySelector('.pregate-strip');if(pgs){pgs.innerHTML='';pgs.style.display='none';}
  var ls=card.querySelector('.log-section');if(ls){ls.innerHTML='';ls.style.display='none';}
  var as=card.querySelector('.analyst-section');if(as){as.innerHTML='';as.style.display='none';}
}

// ── PRO — Compact watchlist (tickers beyond the CARD_CAP window) ────
// Price + today's %-change + a short news link, no ANALYZE button and no
// credit cost — this is the "unlimited, unanalyzed" half of the watchlist.
// Rendering is driven entirely by shared/watchlist.js's postRenderHook, so
// it stays correct after any add/remove/undo/promote without this file
// needing to know every place `watchlist` can change.
//
// Sortable by %-change (compactSortDir, toggled via the arrow button in the
// section header) — this needs every row's data available before building
// HTML, so unlike the old skeleton-then-fill version this awaits all of
// them first. fetchTickerData() is memoized per symbol, so on any re-render
// after the first (toggling sort, a promote/import elsewhere) this resolves
// instantly from cache rather than re-hitting the network.
var compactSortDir=1; // 1 = ascending (lowest→highest), -1 = descending

export function toggleCompactSort(){
  compactSortDir=-compactSortDir;
  var btn=document.getElementById('compact-sort-btn');
  if(btn)btn.textContent=compactSortDir===1?'▲':'▼';
  renderCompactList();
}

export async function renderCompactList(){
  var el=document.getElementById('watchlist-compact');
  if(!el)return;
  var overflow=getOverflow();
  var cardCountEl=document.getElementById('card-count');
  if(cardCountEl)cardCountEl.textContent=Math.min(watchlist.length,CARD_CAP)+'/'+CARD_CAP;
  var compactCountEl=document.getElementById('compact-count');
  if(compactCountEl)compactCountEl.textContent=overflow.length;
  if(!overflow.length){el.innerHTML='<div class="track-empty">Everything tracked fits in cards above.</div>';return}
  el.innerHTML='<div class="track-empty">Loading watchlist…</div>';
  var rows=await mapBatched(overflow,5,async function(t){
    var td=await fetchTickerData(t);
    return{
      ticker:t,
      price:td&&td.metrics&&td.metrics.price!=null?td.metrics.price:null,
      pct:td&&td.metrics&&typeof td.metrics.pct==='number'?td.metrics.pct:null,
      news:td&&td.news,
    };
  });
  // Rows with no live pct sort to the end regardless of direction — an
  // unknown value isn't meaningfully "low" or "high".
  rows.sort(function(a,b){
    var pa=a.pct==null?(compactSortDir===1?Infinity:-Infinity):a.pct;
    var pb=b.pct==null?(compactSortDir===1?Infinity:-Infinity):b.pct;
    return(pa-pb)*compactSortDir;
  });
  el.innerHTML=rows.map(function(r){
    var t=r.ticker;
    var hasNews=r.news&&r.news.ageHours<=300;
    return '<div class="compact-row-wrap" data-ticker="'+t+'">'
      +'<div class="compact-swipe-bg"><span class="swipe-icon">&#128465;</span><span class="swipe-label">DELETE</span></div>'
      +'<div class="compact-row" id="compact-'+t+'">'
      +'<div class="compact-row-main">'
      +'<div class="compact-row-top"><span class="compact-ticker">'+t+'</span>'
      +'<span class="compact-price">'+(r.price!=null?'$'+parseFloat(r.price).toFixed(2):'&mdash;')+'</span>'
      +'<span class="compact-pct" style="color:'+(r.pct!=null?pctColor(r.pct):'var(--dim)')+'">'+(r.pct!=null?fmtPct(r.pct):'&mdash;')+'</span></div>'
      +'<div class="compact-news"'+(hasNews?'':' style="display:none"')+'>'+(hasNews?'<a href="'+r.news.url+'" target="_blank">'+r.news.headline+'</a>':'')+'</div>'
      +'</div>'
      +'<button type="button" class="compact-plus-btn" title="Add as card" onclick="promoteToCard(\''+t+'\')">+</button>'
      +'</div></div>';
  }).join('');
  bindCompactGestures();
}

// Moves a compact-row ticker into the last card slot (index CARD_CAP-1).
// Whatever was already there shifts to index CARD_CAP — i.e. becomes the
// new top compact row — which is the "swap the bottom card into the
// watchlist" behavior, achieved by reordering the one underlying array
// setWatchlist() already validates/persists/re-renders.
export function promoteToCard(ticker){
  var idx=watchlist.indexOf(ticker);
  if(idx<0||idx<CARD_CAP)return;
  var arr=watchlist.slice();
  arr.splice(idx,1);
  arr.splice(CARD_CAP-1,0,ticker);
  setWatchlist(arr);
}

// Swipe-to-delete only — no drag-reorder, since position among non-card
// rows isn't meaningful. Deletion reuses shared's exported removeTicker()
// directly: same undo-toast, same postRenderHook re-sync, for free.
var COMPACT_MOVE_THRESHOLD=14;
var compactActive=null;
var compactGesturesBound=false;

function bindCompactGestures(){
  if(compactGesturesBound)return;
  var el=document.getElementById('watchlist-compact');
  if(!el)return;
  compactGesturesBound=true;
  el.addEventListener('pointerdown',onCompactPointerDown);
}

function onCompactPointerDown(e){
  if(compactActive)return;
  if(e.pointerType==='mouse'&&e.button!==0)return;
  // Same fix as shared/watchlist.js's card gesture: don't exclude by target
  // type here — onCompactPointerMove only intercepts once movement clears
  // COMPACT_MOVE_THRESHOLD, so a tap on the + button still fires its click
  // untouched, but a swipe can now start from anywhere on the row,
  // including on top of the news link.
  var wrap=e.target.closest('.compact-row-wrap');
  if(!wrap)return;
  var row=wrap.querySelector('.compact-row');
  if(!row)return;
  compactActive={pointerId:e.pointerId,wrap:wrap,row:row,ticker:wrap.dataset.ticker,startX:e.clientX,startY:e.clientY,dragging:false,pendingDx:0,swipeBg:wrap.querySelector('.compact-swipe-bg')};
  document.addEventListener('pointermove',onCompactPointerMove,{passive:false});
  document.addEventListener('pointerup',onCompactPointerUp);
  document.addEventListener('pointercancel',onCompactPointerUp);
}

function compactDeleteThreshold(wrap){return Math.min(120,wrap.getBoundingClientRect().width*0.35)}

function onCompactPointerMove(e){
  var g=compactActive;if(!g||e.pointerId!==g.pointerId)return;
  var dx=e.clientX-g.startX,dy=e.clientY-g.startY;
  if(!g.dragging){
    if(Math.abs(dx)>COMPACT_MOVE_THRESHOLD&&Math.abs(dx)>Math.abs(dy)){
      g.dragging=true;
      try{g.wrap.setPointerCapture(e.pointerId)}catch(err){}
      g.row.style.transition='none';
      g.wrap.classList.add('swiping');
    }else if(Math.abs(dy)>COMPACT_MOVE_THRESHOLD){endCompactGesture();return}
    else return;
  }
  e.preventDefault();
  var clamped=Math.min(0,Math.max(dx,-g.wrap.getBoundingClientRect().width));
  g.row.style.transform='translateX('+clamped+'px)';
  var progress=Math.min(Math.abs(clamped)/compactDeleteThreshold(g.wrap),1);
  g.swipeBg.style.opacity=String(progress);
  g.pendingDx=clamped;
}

function onCompactPointerUp(e){
  var g=compactActive;if(!g||e.pointerId!==g.pointerId)return;
  var threshold=compactDeleteThreshold(g.wrap);
  if(g.dragging&&Math.abs(g.pendingDx)>=threshold){
    var wrap=g.wrap,ticker=g.ticker,w=wrap.getBoundingClientRect().width;
    g.row.style.transition='transform .18s ease-in';
    g.row.style.transform='translateX(-'+(w+40)+'px)';
    wrap.style.overflow='hidden';
    wrap.style.transition='max-height .2s ease .12s,opacity .2s ease .12s,margin .2s ease .12s';
    requestAnimationFrame(function(){wrap.style.maxHeight='0px';wrap.style.opacity='0';wrap.style.marginTop='0px';wrap.style.marginBottom='0px';});
    setTimeout(function(){removeTicker(ticker)},220);
  }else if(g.dragging){
    g.row.style.transition='transform .18s ease';
    g.row.style.transform='translateX(0)';
    g.swipeBg.style.opacity='0';
    g.wrap.classList.remove('swiping');
  }
  endCompactGesture();
}

function endCompactGesture(){
  var g=compactActive;
  if(g){try{g.wrap.releasePointerCapture(g.pointerId)}catch(err){}}
  compactActive=null;
  document.removeEventListener('pointermove',onCompactPointerMove);
  document.removeEventListener('pointerup',onCompactPointerUp);
  document.removeEventListener('pointercancel',onCompactPointerUp);
}

// ── PRO — Proxy Resolution Explorer ─────────────────────────────────
// Lists every watchlisted ticker's resolved Dynamic Proxy Resolution result,
// plus a live coherence strip: the ticker's today %-change next to its
// resolved proxy's today %-change, so a decoupling is visible before Gate 5
// ever flags it. Proxy symbols are always drawn from the same tracked-symbol
// set /market already returns (SPY/QQQ/IWM/XBI/SOXX/TSM/MSFT/GLD/USO/BTC) —
// confirmed against every PROXY_RULES entry and DEFAULT_PROXY in server.js —
// except LMT (Defense), IBB (Biotech's secondary leg), and KOSPI (AI/Semi's
// documented gap, see server.js's forceDown-authority comment), none of
// which /market tracks; those render "no live feed" instead of guessing.

// Mirrors the case thresholds gates-extended.js's proxyCoherenceCheck() uses
// for the fixed Korea/Taiwan check — reused here purely as a display
// heuristic across ALL resolved proxies, not as an enforcement rule. The
// actual verdict-affecting coherence check still only runs server-side.
var COHERENCE_FLAT_BAND_PCT=1.0;
var COHERENCE_DECOUPLE_PCT=2.0;
function classifyCoherence(tickerPct,proxyPct){
  if(Math.abs(tickerPct)<=COHERENCE_FLAT_BAND_PCT)return{label:'LAG RISK',color:'var(--amber)'};
  var proxyDown=proxyPct<0;
  var opposite=(proxyDown&&tickerPct>0)||(!proxyDown&&tickerPct<0);
  if(opposite&&Math.abs(tickerPct)>=COHERENCE_DECOUPLE_PCT)return{label:'DECOUPLING',color:'var(--red)'};
  return{label:'TRACKING',color:'var(--green)'};
}

function pctColor(p){return p>0?'var(--green)':p<0?'var(--red)':'var(--dim)'}
function fmtPct(p){return(p>0?'+':'')+p.toFixed(2)+'%'}

// Every ticker/proxy symbol shown gets a live link out to its own quote
// page — the point isn't Yahoo specifically, it's that every number this
// panel asserts (price, %change, the proxy relationship itself) has a
// one-click way to independently check it rather than just trusting the
// app's own math.
function tickerLink(symbol){return'<a href="https://finance.yahoo.com/quote/'+encodeURIComponent(symbol)+'" target="_blank" class="proxy-verify-link">'+symbol+'</a>'}

var TIER_RANK={'primary':0,'secondary':1,'fundamentals-confirmed':2,'fundamentals-speculative':3};
var COHERENCE_RANK={'TRACKING':0,'LAG RISK':1,'DECOUPLING':2};
// key: null (insertion order) | 'level' | 'coherence'. dir: 1 = ascending, -1 = descending.
var proxySort={key:null,dir:1};

export function setProxySort(key){
  if(proxySort.key===key)proxySort.dir=-proxySort.dir;
  else{proxySort.key=key;proxySort.dir=1;}
  updateProxySortButtons();
  renderProxyExplorer();
}

function updateProxySortButtons(){
  ['level','coherence'].forEach(function(k){
    var btn=document.getElementById('proxy-sort-'+k);if(!btn)return;
    var active=proxySort.key===k;
    var arrow=btn.querySelector('.sort-arrow');
    if(arrow)arrow.textContent=active?(proxySort.dir===1?'▲':'▼'):'⇅';
    btn.classList.toggle('sort-btn-active',active);
  });
}

export async function renderProxyExplorer(force){
  var body=document.getElementById('proxy-explorer-body');if(!body)return;
  if(!watchlist.length){body.innerHTML='<div class="track-empty">Watchlist is empty.</div>';return}
  body.innerHTML='<div class="track-empty">Loading proxy resolutions…</div>';
  var rows=await Promise.all(watchlist.map(async function(t){
    var td=await fetchTickerData(t,force);
    var rule=td&&td.proxyRule;
    var tickerPct=td&&td.metrics?td.metrics.pct:null;
    var liveSymbols=rule&&rule.proxy?(rule.proxy.symbols||[]).filter(function(s){return market&&market[s.toLowerCase()]&&typeof market[s.toLowerCase()].pct==='number'}):[];
    var coherence=null;
    if(rule&&rule.proxy&&typeof tickerPct==='number'&&liveSymbols.length){
      var proxyPcts=liveSymbols.map(function(s){return market[s.toLowerCase()].pct});
      var avgProxyPct=proxyPcts.reduce(function(a,b){return a+b},0)/proxyPcts.length;
      coherence=classifyCoherence(tickerPct,avgProxyPct);
    }
    return{ticker:t,rule:rule,tickerPct:tickerPct,tier:rule?rule.tier||'primary':null,liveSymbols:liveSymbols,coherence:coherence};
  }));

  // Items with no rank (no proxyRule at all, or no live coherence feed) sort
  // last UNCONDITIONALLY — multiplying a sentinel rank by `dir` was the bug
  // here: it pushed them to the FRONT in descending order instead, since a
  // large sentinel times -1 becomes the smallest value. Missing data isn't
  // "highest" or "lowest," so direction shouldn't touch it at all.
  function sortByRank(rows,rankFn,dir){
    rows.sort(function(a,b){
      var ra=rankFn(a),rb=rankFn(b);
      if(ra==null&&rb==null)return 0;
      if(ra==null)return 1;
      if(rb==null)return -1;
      return(ra-rb)*dir;
    });
  }
  if(proxySort.key==='level'){
    sortByRank(rows,function(r){return r.tier!=null?TIER_RANK[r.tier]:null},proxySort.dir);
  }else if(proxySort.key==='coherence'){
    sortByRank(rows,function(r){return r.coherence?COHERENCE_RANK[r.coherence.label]:null},proxySort.dir);
  }

  var tierColor={'primary':'var(--green)','secondary':'var(--amber)','fundamentals-confirmed':'var(--blue)','fundamentals-speculative':'var(--red)'};
  body.innerHTML=rows.map(function(r){
    if(!r.rule||!r.rule.proxy)return'<div class="proxy-item"><div class="proxy-item-head"><span class="proxy-ticker">'+tickerLink(r.ticker)+'</span><span class="analyst-val" style="color:var(--dim)">unavailable</span></div></div>';
    var tier=r.tier||'primary';
    var tc=tierColor[tier]||'var(--dim)';
    var verifyLinks=[tickerLink(r.ticker)].concat((r.rule.proxy.symbols||[]).map(tickerLink)).join(' &middot; ');

    var coherenceHtml;
    if(!r.coherence){
      coherenceHtml='<div class="proxy-coherence"><span class="analyst-lbl">LIVE COHERENCE</span><span class="analyst-val" style="color:var(--dim)">no live feed for this proxy</span></div>';
    }else{
      var chips=r.liveSymbols.map(function(s){var p=market[s.toLowerCase()].pct;return'<span class="proxy-live-chip">'+tickerLink(s)+' <b style="color:'+pctColor(p)+'">'+fmtPct(p)+'</b></span>'}).join('');
      coherenceHtml='<div class="proxy-coherence">'
        +'<div class="analyst-row" style="padding:0"><span class="analyst-lbl">LIVE COHERENCE</span><span class="proxy-tier-badge" style="color:'+r.coherence.color+';border-color:'+r.coherence.color+'55;background:'+r.coherence.color+'11">'+r.coherence.label+'</span></div>'
        +'<div class="proxy-live-row"><span class="proxy-live-chip">'+tickerLink(r.ticker)+' <b style="color:'+pctColor(r.tickerPct)+'">'+fmtPct(r.tickerPct)+'</b></span>'+chips+'</div>'
        +'</div>';
    }

    return'<div class="proxy-item"><div class="proxy-item-head"><span class="proxy-ticker">'+tickerLink(r.ticker)+'</span>'
      +'<span class="proxy-tier-badge" style="color:'+tc+';border-color:'+tc+'55;background:'+tc+'11">'+tier.toUpperCase().replace(/-/g,' ')+'</span></div>'
      +'<div class="proxy-detail">'+r.rule.proxy.name+'</div>'
      +'<div class="proxy-detail" style="color:var(--dim)">'+(r.rule.category||'')+(r.rule.dynamicallyResolved?' · dynamically resolved (quarterly recompute)':' · fixed sector proxy')+'</div>'
      +(r.rule.proxy.rationale?'<div class="proxy-detail">'+r.rule.proxy.rationale+'</div>':'')
      +'<div class="proxy-verify-row"><span class="analyst-lbl">VERIFY</span>'+verifyLinks+'</div>'
      +coherenceHtml
      +'</div>';
  }).join('')
  +'<div class="proxy-shark-tease"><a href="../shark/coming-soon.html">&#9889; SHARK &mdash; real-time Alpaca data &amp; deeper proxy analytics &rarr;</a></div>';
}

export function refreshProxyExplorer(){renderProxyExplorer(true)}

export function toggleProxyExplorer(){
  var panel=document.getElementById('proxy-explorer-panel');
  var arrow=document.getElementById('proxy-explorer-arrow');
  var header=document.getElementById('proxy-explorer-header');
  var open=panel.classList.toggle('open');
  arrow.classList.toggle('open',open);
  header.classList.toggle('open',open);
  if(open)renderProxyExplorer();
}

export function openProxyExplorer(){
  var m=document.getElementById('profile-menu');if(m)m.classList.remove('open');
  var panel=document.getElementById('proxy-explorer-panel');
  if(panel&&!panel.classList.contains('open'))toggleProxyExplorer();
  var section=document.getElementById('proxy-explorer-section');
  if(section)section.scrollIntoView({behavior:'smooth',block:'start'});
}

// ── PRO — track-record gate-attribution breakdown ──────────────────
// Same tv_accuracy_log the shared module already renders as a plain
// right/wrong list — this groups it by which mechanism drove each logged
// verdict (see classifyTrigger above) so Pro can see accuracy by gate/
// override, not just an aggregate hit rate.
function renderGateAttribution(){
  var el=document.getElementById('track-gate-breakdown');if(!el)return;
  var log=getAccuracyLog().filter(function(e){return e.trigger});
  if(!log.length){el.innerHTML='';return}
  var by={};
  log.forEach(function(e){
    var k=e.trigger;
    if(!by[k])by[k]={c:0,t:0};
    by[k].t++;if(e.correct)by[k].c++;
  });
  var order=['pre-gate','gate0','gate1','gate5','corroboration','standard'];
  var rows=order.filter(function(k){return by[k]}).map(function(k){
    var s=by[k];var rate=Math.round((s.c/s.t)*100);
    var color=rate>=65?'var(--green)':rate>=50?'var(--amber)':'var(--red)';
    return'<div class="trigger-row"><span class="trigger-lbl">'+TRIGGER_LABELS[k]+'</span><span class="trigger-val" style="color:'+color+'">'+rate+'%</span><span class="trigger-sub">'+s.c+'/'+s.t+'</span></div>';
  }).join('');
  el.innerHTML='<div class="track-log-title" style="margin-top:12px">ACCURACY BY TRIGGER</div>'+rows;
}

// Same log, grouped by ticker instead of trigger — "TOP TICKERS" in the
// shared summary only shows the top 3 as a single inline line; this is the
// full breakdown, sorted by most-logged first.
function renderTickerAccuracy(){
  var el=document.getElementById('track-ticker-breakdown');if(!el)return;
  var log=getAccuracyLog();
  if(!log.length){el.innerHTML='';return}
  var by={};
  log.forEach(function(e){
    if(!by[e.ticker])by[e.ticker]={c:0,t:0};
    by[e.ticker].t++;if(e.correct)by[e.ticker].c++;
  });
  var rows=Object.entries(by).sort(function(a,b){return b[1].t-a[1].t}).map(function(entry){
    var ticker=entry[0],s=entry[1];var rate=Math.round((s.c/s.t)*100);
    var color=rate>=65?'var(--green)':rate>=50?'var(--amber)':'var(--red)';
    return'<div class="trigger-row"><span class="trigger-lbl">'+ticker+'</span><span class="trigger-val" style="color:'+color+'">'+rate+'%</span><span class="trigger-sub">'+s.c+'/'+s.t+'</span></div>';
  }).join('');
  el.innerHTML='<div class="track-log-title" style="margin-top:12px">ACCURACY BY TICKER</div>'+rows;
}

// ── PRO — Sector Heat Map ───────────────────────────────────────────
// Same /market data the sector bar already displays as plain colored text —
// this renders it (plus each watchlisted ticker's own %-change) as tiles
// whose background intensity scales with the size of the move, so a scan
// of the grid reads the day at a glance instead of reading ten numbers.
var HEATMAP_SECTORS=[['spy','SPY'],['qqq','QQQ'],['iwm','IWM'],['xbi','XBI'],['soxx','SOXX'],['tsm','TSM'],['msft','MSFT'],['btc','BTC'],['gld','GLD'],['uso','USO']];
var HEATMAP_MAX_PCT=3; // %-move that reaches full tile-color intensity

function heatTileHtml(label,pct){
  if(typeof pct!=='number')return'<div class="heat-tile heat-tile-empty"><span class="heat-tile-lbl">'+label+'</span><span class="heat-tile-val">?</span></div>';
  var intensity=Math.min(Math.abs(pct)/HEATMAP_MAX_PCT,1);
  var rgb=pct>=0?'0,230,118':pct<0?'255,23,68':'96,125,139';
  var bg='rgba('+rgb+','+(0.08+intensity*0.32).toFixed(2)+')';
  var border='rgba('+rgb+','+(0.25+intensity*0.5).toFixed(2)+')';
  return'<div class="heat-tile" style="background:'+bg+';border-color:'+border+'"><span class="heat-tile-lbl">'+label+'</span><span class="heat-tile-val">'+fmtPct(pct)+'</span></div>';
}

export async function renderHeatMap(force){
  var sectorEl=document.getElementById('heatmap-sectors');
  var wlEl=document.getElementById('heatmap-watchlist');
  if(!sectorEl||!wlEl)return;
  sectorEl.innerHTML=HEATMAP_SECTORS.map(function(s){
    var d=market&&market[s[0]];
    return heatTileHtml(s[1],d&&typeof d.pct==='number'?d.pct:null);
  }).join('');
  if(!watchlist.length){wlEl.innerHTML='<div class="track-empty">Watchlist is empty.</div>';return}
  wlEl.innerHTML=watchlist.map(function(t){return heatTileHtml(t,null)}).join('');
  var pcts=await Promise.all(watchlist.map(async function(t){var td=await fetchTickerData(t,force);return td&&td.metrics?td.metrics.pct:null}));
  wlEl.innerHTML=watchlist.map(function(t,i){return heatTileHtml(t,typeof pcts[i]==='number'?pcts[i]:null)}).join('');
}

export function refreshHeatMap(){renderHeatMap(true)}

export function toggleHeatMap(){
  var panel=document.getElementById('heatmap-panel');
  var arrow=document.getElementById('heatmap-arrow');
  var header=document.getElementById('heatmap-header');
  var open=panel.classList.toggle('open');
  arrow.classList.toggle('open',open);
  header.classList.toggle('open',open);
  if(open)renderHeatMap();
}

// ── PRO — Export watchlist + cards as one CSV ────────────────────────
// One file across both lists — cards and the compact watchlist are just two
// windows over the same underlying array, so the export doesn't split them
// into separate files, just tags each row so it's still clear which side a
// ticker was on. IV comes from td.iv (server-side /ticker, Pro+Shark only —
// see Tra's tierConfig.iv / fetchImpliedVolatility, sourced from Alpaca
// options snapshots since Finnhub's free tier has no IV data at all). It's
// UNVERIFIED against a live Alpaca options subscription as of this writing —
// td.iv may legitimately be null for tickers with no listed options, or for
// every ticker if the Alpaca account lacks options-data entitlement, in
// which case this still falls back to N/A rather than showing a stale/wrong
// number.
export async function exportWatchlistCSV(btnEl){
  if(!watchlist.length)return alert('Watchlist is empty — nothing to export.');
  if(btnEl){var old=btnEl.textContent;btnEl.textContent='EXPORTING…';btnEl.disabled=true;}
  var rows=await Promise.all(watchlist.map(async function(t,i){
    var td=await fetchTickerData(t);
    var price=td&&td.metrics&&td.metrics.price!=null?td.metrics.price:'';
    var pct=td&&td.metrics&&typeof td.metrics.pct==='number'?td.metrics.pct.toFixed(2):'';
    var iv=td&&typeof td.iv==='number'?(td.iv*100).toFixed(1)+'%':'N/A';
    return[t,i<CARD_CAP?'CARD':'WATCHLIST',price,iv,pct];
  }));
  var csvEsc=function(v){var s=String(v);return/[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s};
  var csv=[['Ticker','List','Price','IV','Change%']].concat(rows)
    .map(function(r){return r.map(csvEsc).join(',')}).join('\r\n');
  var blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});
  var url=URL.createObjectURL(blob);
  var a=document.createElement('a');
  a.href=url;a.download='trade-verdict-watchlist-'+new Date().toISOString().slice(0,10)+'.csv';
  document.body.appendChild(a);a.click();document.body.removeChild(a);
  URL.revokeObjectURL(url);
  if(btnEl){btnEl.textContent=old;btnEl.disabled=false;}
}

var GLOSSARY=[
  {cat:'CRF FRAMEWORK',term:'CRF (Catalyst Response Framework)',def:'The Pre-Gate + Gates 0-5 entry checklist this app runs. All non-exempt gates GREEN = UP. A Pre-Gate hard trigger, Gate 0 RED, Gate 1 forceDown, or Gate 5 forceDown can each force DOWN alone; otherwise DOWN needs 2+ RED gates among 1/2/4/5 (Corroboration Rule).',ex:'SMMT: Pre-Gate GREEN, G0 GREEN, G1 GREEN, G2 GREEN (news catalyst), G3 YELLOW (weekend), G4 GREEN, G5 GREEN (XBI +1.5%) = UP MEDIUM'},
  {cat:'CRF FRAMEWORK',term:'Pre-Gate — Thesis Integrity',def:'Runs before Gate 0. Screens SEC EDGAR filings + news for solvency, dilution, and guidance-cut language. RED (hard trigger, or 2 soft triggers within 30 days) forces DOWN on its own — no corroboration required.',ex:'SMMT flagged for going-concern language + ATM dilution — treat as elevated Pre-Gate risk even if every other gate is green.'},
  {cat:'CRF FRAMEWORK',term:'Gate 0 — Sector Gate',def:'Server-calculated from live SPY and QQQ. Never AI-estimated. BOTH SPY and QQQ down >1% = RED, overrides everything else. Only one down >1% = YELLOW, not RED.',ex:'SPY −1.2%, QQQ −0.4% → Gate 0 YELLOW (not RED — only one index broke the 1% floor).'},
  {cat:'CRF FRAMEWORK',term:'Gate 1 — Bidirectional Trend Structure',def:'Rebuilt Jul 28, 2026 to replace the old one-directional 52-week-range proxy. STEP 1: 60-day price change picks the branch (uptrend/downtrend/flat). Uptrend: <+10% 14-day move = GREEN, +10–20% = YELLOW (half size), >+20% = RED (priced in, wait for flush). Downtrend: <10% 60-day decline = GREEN, 10–25% = YELLOW (half size, needs a confirmed higher low), >25% = RED with forceDown authority equal to Gate 0 RED — forces DOWN regardless of every other gate.',ex:'PLUG: 60-day −50% → Gate 1 RED forceDown → DOWN verdict, no matter how green the other gates read.'},
  {cat:'CRF FRAMEWORK',term:'Gate 2 — Catalyst Congruence',def:'Classifies whether recent news is a congruent or contrarian catalyst, and classifies the ticker as Canary (macro-first), Sentiment (capex-driven), or Flow (mechanical/index).',ex:'SMMT signed a Phase III asset sale = positive catalyst → Gate 2 GREEN lean.'},
  {cat:'CRF FRAMEWORK',term:'Gate 3 — Opening Bar',def:'Touch → response → conviction, 3-bar sequence. BLIND_SEQUENCE mode uses day-of-week + user bar data (Free/Starter/Pro). SWING_LEVEL mode (Shark only) uses Alpaca pre-calculated 14-day highs/lows.',ex:'Friday opens green → wait for bar 2 before entry (67% reversal-by-bar-3 pattern).'},
  {cat:'CRF FRAMEWORK',term:'Gate 4 — Phase Identification',def:'Phase 1 (Discovery) = full size, any confirmed setup. Phase 2 (Acceleration, pre-window +10–20%) = half size, pullbacks only. Phase 3 (Priced for Perfection, pre-window >20%) = quarter size, post-flush only.',ex:'ALAB at $88 = Phase 1. At $300 = Phase 2. At $450 = Phase 3 (sold off on a blowout beat — priced in).'},
  {cat:'CRF FRAMEWORK',term:'Gate 5 — Dynamic Sector Proxy',def:'Smart proxy auto-selected per ticker: fixed rules first (Biotech→XBI, AI/Semi→TSM+KOSPI, Software→MSFT, Fintech→BTC+QQQ, Energy→USO+GLD, BDC/REIT→IWM+SPY), then the Dynamic Proxy Resolution Algorithm (90-day correlation, then fundamentals feedback loop) when no fixed rule fits. See the Proxy Resolution Explorer below for each watchlisted ticker’s resolved tier.',ex:'FCEL resolved as PLUG’s primary proxy at r=0.669 — no fixed rule existed for PLUG, so Gate 5 fell through to the correlation step.'},
  {cat:'TICKER CLASSIFICATIONS',term:'Canary',def:'European or institutional base that prices macro risk early. When canaries fall while sentiment names rise, reversal is coming.',ex:'ASML fell before MU/ALAB. Warned 10-21 days early.'},
  {cat:'TICKER CLASSIFICATIONS',term:'Sentiment',def:'Moves most directly with AI capex or sector confidence, ignoring macro until it breaks.',ex:'MU, NVDA, AMD. Ran +47% into Broadcom miss then crashed 12.8%.'},
  {cat:'TICKER CLASSIFICATIONS',term:'Flow',def:'Moves on mechanical buying events. Institutions distribute at the opening bar on positive catalyst days.',ex:'ALAB opened $315 on Computex day, flushed to $292 in 30 min on 1.1M shares.'},
  {cat:'TICKER CLASSIFICATIONS',term:'Proxy tier (Gate 5)',def:'PRIMARY/SECONDARY = correlation-based proxy adopted, primary can force DOWN alone. FUNDAMENTALS-CONFIRMED = no proxy needed, trades on Gate 0 alone at normal size. FUNDAMENTALS-SPECULATIVE = no proxy and weak fundamentals score — elevated-cap ceiling, auto-execute stop, quarter size.',ex:'A speculative-tier ticker still gets a full CRF run, but sizing is capped at quarter and a stop auto-executes rather than waiting on manual confirmation.'},
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
  {cat:'CRF FRAMEWORK',term:'Proxy Resolution Explorer',def:'Pro-only panel showing the Dynamic Proxy Resolution Algorithm’s live output for every watchlisted ticker: resolved proxy, correlation coefficient, and tier (PRIMARY/SECONDARY/FUNDAMENTALS-CONFIRMED/FUNDAMENTALS-SPECULATIVE). Refreshable on demand; currently scored against the full watchlist rather than just the 15-card window.',ex:'Opening the Explorer shows FCEL resolved as PLUG’s primary proxy at r=0.669 — the same number Gate 5 used to grade PLUG’s verdict.'},
  {cat:'CRF FRAMEWORK',term:'Sector Heat Map',def:'Pro-only panel visualizing sector-level performance across the proxy ETFs/indices Gate 0 and Gate 5 already track (XBI, SOXX, KOSPI, TSM, etc.), refreshable on demand — so a red patch in one sector explains why several unrelated-looking tickers are all reading YELLOW or RED at once.',ex:'SOXX and KOSPI both deep red on the Heat Map explains why every AI/semi ticker in the watchlist is showing a Gate 5 RED lean simultaneously.'},
  {cat:'MARKET STRUCTURE',term:'Beta (β)',def:'A stock’s volatility relative to the overall market (SPY), where 1.0 = moves in line with the market, >1 amplifies market moves, <1 dampens them. Shown on each card as β. A negative beta means the stock tends to move opposite the market — treat it as effectively uncorrelated to its assigned Gate 5 proxy rather than confirming or denying that proxy read.',ex:'IREN at β2.1 is expected to move ~2.1% for every 1% SPY move. A rare β−0.3 name would be expected to drift up on a red SPY day.'},
  {cat:'MARKET STRUCTURE',term:'Intraday',def:'Within a single trading day — opened and evaluated before the next session begins, as opposed to a multi-day swing or long-term hold. This app’s entire CRF framework is built around intraday timing: the Opening Drive window, Gate 3’s same-day bar sequence, and same-day stop-loss discipline.',ex:'An intraday call on SMMT is graded against its move by that day’s close, not next week’s — Gate 3’s opening-bar sequence only exists because the framework is timing a single session.'},
  {cat:'CRF FRAMEWORK',term:'Verdict Icons — 👍 UP / 👎 DOWN / HOLD',def:'👍 = UP verdict, 👎 = DOWN verdict — the direction the Pre-Gate + Gates 0-5 checklist actually resolved to. A FLAT verdict and a market-closed card both render as HOLD / WAIT & WATCH instead of a thumb, since there’s no directional read to size. The badge next to the thumb is the sizing action (Full / Half / ¼ size, or “Defined risk” for options-only setups) — not a confidence score; expand Gate Breakdown for the actual HIGH/MEDIUM/LOW confidence read that produced the verdict.',ex:'A card shows 👍 UP with a Half-size badge and HIGH confidence in Gate Breakdown — the framework leans bullish, but a YELLOW gate (Gate 1 or Gate 4) cut the size even though conviction on direction is high.'},
];

var glossaryBuilt=false;
function buildGlossary(){
  if(glossaryBuilt)return;glossaryBuilt=true;
  var body=document.getElementById('glossary-body');if(!body)return;
  var cats={};
  GLOSSARY.forEach(function(g){if(!cats[g.cat])cats[g.cat]=[];cats[g.cat].push(g)});
  var html='';
  Object.entries(cats).forEach(function(entry){
    var cat=entry[0],terms=entry[1];
    html+='<div class="glossary-cat" data-cat="'+cat+'">'+cat+'</div>';
    terms.forEach(function(t){
      html+='<div class="glossary-term visible" data-term="'+t.term.toLowerCase()+'" data-def="'+t.def.toLowerCase()+'">'
        +'<div class="glossary-term-name">'+t.term+'</div>'
        +'<div class="glossary-term-def">'+t.def+'</div>'
        +(t.ex?'<div class="glossary-term-example">e.g. '+t.ex+'</div>':'')
        +'</div>';
    });
  });
  body.innerHTML=html;
}

export function toggleGlossary(){
  var panel=document.getElementById('glossary-panel');
  var arrow=document.getElementById('glossary-arrow');
  var header=document.getElementById('glossary-header');
  var open=panel.classList.toggle('open');
  arrow.classList.toggle('open',open);
  header.classList.toggle('open',open);
  if(open)buildGlossary();
}

export function filterGlossary(query){
  buildGlossary();
  var q=query.toLowerCase().trim();
  var terms=document.querySelectorAll('.glossary-term');
  var anyVisible=false;
  terms.forEach(function(el){
    var match=!q||el.dataset.term.includes(q)||el.dataset.def.includes(q);
    el.classList.toggle('visible',match);if(match)anyVisible=true;
  });
  document.querySelectorAll('.glossary-cat').forEach(function(catEl){
    var next=catEl.nextElementSibling,hasVisible=false;
    while(next&&!next.classList.contains('glossary-cat')){if(next.classList.contains('visible'))hasVisible=true;next=next.nextElementSibling}
    catEl.style.display=hasVisible||!q?'block':'none';
  });
  var nr=document.getElementById('glossary-no-results');
  if(nr)nr.style.display=(!anyVisible&&q)?'block':'none';
}

function enforceMarketState(){
  if(isMarketClosed()){
    watchlist.forEach(function(t){
      var card=document.getElementById('card-'+t);
      if(!card)return;
      var ae=card.querySelector('.card-action');
      if(!ae)return;
      if(ae.querySelector('.verdict-up')||ae.querySelector('.verdict-down')){
        var d=document.createElement('div');
        d.className='verdict-container';
        d.onclick=function(){resetCard(t)};
        var s1=document.createElement('span');s1.className='verdict-hold';s1.textContent='HOLD';
        var s2=document.createElement('span');s2.className='verdict-lbl-hold';s2.textContent='MKT CLOSED';
        d.appendChild(s1);d.appendChild(s2);
        ae.innerHTML='';ae.appendChild(d);
      }
    });
  }
}

// ── SUPABASE AUTH ─────────────────────────────────────────────────
var sbSession=null;
function getStoredSession(){try{return JSON.parse(localStorage.getItem('tv_session')||'null');}catch(e){return null;}}
function storeSession(s){if(s)localStorage.setItem('tv_session',JSON.stringify(s));else localStorage.removeItem('tv_session');}
function isSessionValid(s){if(!s||!s.token)return false;if(s.expiresAt&&Date.now()/1000>s.expiresAt-60)return false;return true;}
function authH(){return {'Content-Type':'application/json'};}
function addSecret(url){if(sbSession&&sbSession.token){var sep=url.includes('?')?'&':'?';return url+sep+'supabase_token='+encodeURIComponent(sbSession.token);}return url;}
function showScreen(id){['auth-screen','comeback-screen','app-root'].forEach(function(s){var el=document.getElementById(s);if(el)el.style.display=s===id?(s==='app-root'?'block':'flex'):'none';});}
export function authLogout(){storeSession(null);sbSession=null;showScreen('auth-screen');}

// ── PROFILE MENU ──────────────────────────────────────────────────
export function toggleProfileMenu(e){
  if(e)e.stopPropagation();
  var m=document.getElementById('profile-menu');if(!m)return;
  m.classList.toggle('open');
}
document.addEventListener('click',function(e){
  var m=document.getElementById('profile-menu');
  if(!m||!m.classList.contains('open'))return;
  if(!e.target.closest('.profile-wrap'))m.classList.remove('open');
});

// ── CREDIT DISPLAY ────────────────────────────────────────────────
async function fetchCreditStatus(){try{var res=await fetch(addSecret(API_URL+'/status'),{headers:authH()});var data=await res.json();var el=document.getElementById('credits-btn');if(el&&data.totalCredits!==undefined){el.textContent=(data.totalCredits>0?data.totalCredits:'+')+' CREDITS';}}catch(e){}}

// ── NO CREDITS ────────────────────────────────────────────────────
function handleNoCredits(card,ticker){
  var cached=getCachedVerdict(ticker);
  if(cached){renderCardResult(ticker,cached);var ae=card.querySelector('.card-action');if(ae){var n=document.createElement('div');n.style.cssText='font-family:monospace;font-size:8px;color:var(--amber);text-align:center;margin-top:4px';n.textContent='Cached — no credits remaining';ae.appendChild(n);}return;}
  var ae=card.querySelector('.card-action');if(!ae)return;
  ae.innerHTML='<div style="text-align:center;padding:4px"><div style="font-family:monospace;font-size:9px;color:var(--amber);margin-bottom:6px">No credits remaining</div><a href="https://buy.stripe.com/3cI3cwacxarJ8txb3z3VC00" target="_blank" style="font-family:monospace;font-size:9px;font-weight:700;color:var(--amber);background:rgba(255,171,0,.12);border:1px solid rgba(255,171,0,.4);border-radius:4px;padding:5px 10px;text-decoration:none">+ BUY CREDITS $0.99</a><br><a href="https://buy.stripe.com/14A8wQdoJ7fx6lpb3z3VC01" target="_blank" style="font-family:monospace;font-size:9px;color:var(--dim);margin-top:4px;display:block">or upgrade to Shark</a></div>';
}

// ── COUNTDOWN TIMER ───────────────────────────────────────────────
var comebackTimer=null;
function startComebackTimer(){if(comebackTimer)clearInterval(comebackTimer);comebackTimer=setInterval(function(){var now=new Date(),midnight=new Date();midnight.setHours(24,0,0,0);var diff=midnight-now,h=Math.floor(diff/3600000),m=Math.floor((diff%3600000)/60000),s=Math.floor((diff%60000)/1000);var el=document.getElementById('comeback-timer');if(el)el.textContent=String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');},1000);}

// ── AUTH FLOW ─────────────────────────────────────────────────────
var authMode='login';
function bindAuthEvents(){
  var eyeBtn=document.getElementById('eye-btn');
  var resetLink=document.getElementById('reset-link');
  var authBtn=document.getElementById('auth-btn');
  var authToggle=document.getElementById('auth-toggle');
  var pwInput=document.getElementById('auth-password');
  var emailInput=document.getElementById('auth-email');
  if(eyeBtn)eyeBtn.addEventListener('click',function(){var inp=document.getElementById('auth-password');inp.type=inp.type==='password'?'text':'password';eyeBtn.innerHTML=inp.type==='password'?'&#128065;':'&#128584;';});
  if(resetLink)resetLink.addEventListener('click',function(){var email=document.getElementById('auth-email').value.trim();var err=document.getElementById('auth-error');if(!email){err.style.color='var(--red)';err.textContent='Enter your email first';return;}err.style.color='var(--dim)';err.textContent='Sending reset link...';fetch(API_URL+'/auth/reset',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:email})}).then(function(r){return r.json();}).then(function(){err.style.color='var(--green)';err.textContent='Reset link sent! Check your email.';}).catch(function(e){err.style.color='var(--red)';err.textContent=e.message;});});
  if(authBtn)authBtn.addEventListener('click',function(){if(authMode==='login')handleLogin();else handleSignup();});
  if(authToggle)authToggle.addEventListener('click',toggleAuthMode);
  if(pwInput)pwInput.addEventListener('keydown',function(e){if(e.key==='Enter')authBtn&&authBtn.click();});
  if(emailInput)emailInput.addEventListener('keydown',function(e){if(e.key==='Enter')pwInput&&pwInput.focus();});
}
function toggleAuthMode(mode){authMode=mode||(authMode==='login'?'signup':'login');var isL=authMode==='login';document.getElementById('auth-title').textContent=isL?'SIGN IN':'CREATE ACCOUNT';document.getElementById('auth-btn').textContent=isL?'SIGN IN':'CREATE ACCOUNT';document.getElementById('auth-toggle').textContent=isL?'New user? Create account':'Already have an account? Sign in';document.getElementById('auth-error').textContent='';document.getElementById('auth-error').style.color='var(--red)';var rl=document.getElementById('reset-link');if(rl)rl.style.display=isL?'inline':'none';}
async function handleLogin(){var email=document.getElementById('auth-email').value.trim(),password=document.getElementById('auth-password').value,btn=document.getElementById('auth-btn'),err=document.getElementById('auth-error');err.textContent='';btn.disabled=true;btn.textContent='SIGNING IN...';try{var r=await fetch(API_URL+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});if(!r.ok){var e=await r.json();throw new Error(e.error||'Login failed');}var session=await r.json();storeSession(session);sbSession=session;btn.textContent='SIGN IN';btn.disabled=false;checkTierAccess(session);}catch(e){err.textContent=e.message;btn.textContent='SIGN IN';btn.disabled=false;}}
async function handleSignup(){var email=document.getElementById('auth-email').value.trim(),password=document.getElementById('auth-password').value,btn=document.getElementById('auth-btn'),err=document.getElementById('auth-error');err.textContent='';err.style.color='var(--red)';if(!email||!password){err.textContent='Email and password required';return;}if(password.length<6){err.textContent='Password must be at least 6 characters';return;}btn.disabled=true;btn.textContent='CREATING...';try{var r=await fetch(API_URL+'/auth/signup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});if(!r.ok){var e=await r.json();throw new Error(e.error||'Signup failed');}err.style.color='var(--green)';err.textContent='Account created! Check your email to confirm, then sign in.';btn.textContent='SIGN IN';btn.disabled=false;toggleAuthMode('login');}catch(e){err.textContent=e.message;btn.textContent='CREATE ACCOUNT';btn.disabled=false;}}

function initApp(){cleanLS();document.getElementById('ticker-count').textContent='CRF · '+watchlist.length+' TICKERS';renderWatchlist();renderTrackRecord();renderGateAttribution();renderTickerAccuracy();startClock();fetchMarket();setTimeout(fetchCreditStatus,2000);setInterval(function(){fetchMarket();var pep=document.getElementById('proxy-explorer-panel');if(pep&&pep.classList.contains('open'))renderProxyExplorer();var hep=document.getElementById('heatmap-panel');if(hep&&hep.classList.contains('open'))renderHeatMap();},4*60*1000);enforceMarketState();setInterval(enforceMarketState,60*1000);if(sbSession&&sbSession.email){var pb=document.getElementById('profile-btn');if(pb)pb.textContent=sbSession.email.charAt(0).toUpperCase();var pme=document.getElementById('profile-menu-email');if(pme)pme.textContent=sbSession.email;}}
async function checkTierAccess(session){
  var expectedTier='pro';
  var err=document.getElementById('auth-error');
  if(session.tier!==expectedTier){
    if(err){
      err.style.color='var(--amber)';
      if(session.tier==='free'){
        err.textContent=session.hasSubscribed
          ?'Your PRO subscription is no longer active. Redirecting to free tier...'
          :'No active PRO subscription. Redirecting to free tier...';
      }else{
        err.textContent='Redirecting to your '+session.tier.toUpperCase()+' tier...';
      }
    }
    setTimeout(function(){
      if(session.redirectUrl){window.location.href=session.redirectUrl;}
      else{window.location.href='https://tradetribunal.app/';}
    },1500);
    return false;
  }
  initWatchlistSync({API_URL:API_URL, authH:authH, addSecret:addSecret});
  onWatchlistSave(schedulePushWatchlist);
  await pullWatchlistFromServer();
  initTrackRecordSync({API_URL:API_URL, authH:authH, addSecret:addSecret});
  onLogSave(schedulePushTrackRecord);
  await pullTrackRecordFromServer();
  showScreen('app-root');initApp();
  return true;
}

async function checkAuth(){
  var stored=getStoredSession();
  if(!stored||!isSessionValid(stored)){showScreen('auth-screen');bindAuthEvents();return;}
  sbSession=stored;
  // Refresh tier from server (subscriber row may have changed since login)
  try{
    var r=await fetch(API_URL+'/auth/me?supabase_token='+encodeURIComponent(stored.token));
    if(r.ok){
      var fresh=await r.json();
      if(fresh.tier){
        stored.tier=fresh.tier;
        stored.hasSubscribed=!!fresh.hasSubscribed;
        var URLS={free:'https://tradetribunal.app/',starter:'https://tradetribunal.app/starter/',pro:'https://tradetribunal.app/pro/',shark:'https://tradetribunal.app/shark/'};
        stored.redirectUrl=URLS[fresh.tier]||URLS.free;
        storeSession(stored);
        sbSession=stored;
      }
    }
  }catch(e){}
  checkTierAccess(stored);
  bindAuthEvents();
}

initWatchlist({defaultTickers:['SMMT','VCYT','TWST','IMVT','IREN','ALAB','MU'], maxTickers:999, upgradeMessage:'Pro supports unlimited tickers already — this cap should never be hit.'});
initTickerCache({API_URL:API_URL, authH:authH, addSecret:addSecret});
setRenderScope(CARD_CAP);
onRenderWatchlist(renderCompactList);

checkAuth();

window.fetchMarket = fetchMarket;
window.analyzeAll = analyzeAll;
window.analyzeTicker = analyzeTicker;
window.resetCard = resetCard;
window.toggleGates = toggleGates;
window.toggleAnalyst = toggleAnalyst;
window.toggleGlossary = toggleGlossary;
window.filterGlossary = filterGlossary;
window.authLogout = authLogout;
window.toggleProfileMenu = toggleProfileMenu;
window.toggleProxyExplorer = toggleProxyExplorer;
window.openProxyExplorer = openProxyExplorer;
window.refreshProxyExplorer = refreshProxyExplorer;
window.logResultUI = logResultUI;
window.toggleHeatMap = toggleHeatMap;
window.refreshHeatMap = refreshHeatMap;
window.exportWatchlistCSV = exportWatchlistCSV;
window.promoteToCard = promoteToCard;
window.setProxySort = setProxySort;
window.toggleCompactSort = toggleCompactSort;
// track-record.js sets window.clearLog itself on import — override here so
// clearing the log also refreshes Pro's gate-attribution breakdown, which
// the shared module has no knowledge of.
window.clearLog = function(){clearLog();renderGateAttribution();renderTickerAccuracy();};
