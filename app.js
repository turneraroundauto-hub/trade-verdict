import { initTickerCache, fetchTickerData } from './shared/ticker-cache.js?v=4';
import { initWatchlist, watchlist, addTickers, renderWatchlist, updateCardMeta, onWatchlistSave, refreshNewsHighlights } from './shared/watchlist.js?v=24';
import { cleanLS, cacheVerdict, getCachedVerdict } from './shared/analysis-cache.js?v=2';
import { renderTrackRecord } from './shared/track-record.js?v=12';
import { initWatchlistSync, pullWatchlistFromServer, schedulePushWatchlist } from './shared/watchlist-sync.js?v=17';
import { getTzPref, getTzIana, forceDefaults } from './shared/prefs.js?v=7';
// Free has no Settings UI (see prefs.js) — always ET / Yahoo Finance,
// regardless of a preference set on Starter/Pro in this same browser.
forceDefaults();

// If user has a paid session in localStorage from paid tier, redirect them.
// window.location.href doesn't halt script execution -- the rest of this
// module (including initWatchlist/pullWatchlistFromServer below) would
// otherwise keep running for the fraction of a second before navigation
// actually happens. tv_wl is the SAME localStorage key every tier reads
// from, so Free's maxTickers:3 cap silently truncating it in that window
// -- and a same-account pullWatchlistFromServer() persisting that
// truncated list locally -- can leave a paid tier's real watchlist
// clobbered to 3 tickers on the very next load. Guard everything below
// that touches watchlist state behind this flag instead.
var redirectingToPaidTier=false;
try{
  var stored=JSON.parse(localStorage.getItem('tv_session')||'null');
  if(stored&&stored.tier&&stored.tier!=='free'&&stored.redirectUrl){
    redirectingToPaidTier=true;
    window.location.href=stored.redirectUrl;
  }
}catch(e){}

// Recognize a signed-in session (tv_session is shared across all tiers on
// this origin, so a "free" session bounced back from the Starter login
// still shows up here) and swap the header button to SIGN OUT instead of
// SIGN UP / SIGN IN.
function getStoredSession(){try{return JSON.parse(localStorage.getItem('tv_session')||'null');}catch(e){return null;}}
function isSessionValid(s){if(!s||!s.token)return false;if(s.expiresAt&&Date.now()/1000>s.expiresAt-60)return false;return true;}
var sbSession=isSessionValid(getStoredSession())?getStoredSession():null;
function updateAuthButton(){
  var btn=document.getElementById('auth-action-btn');if(!btn)return;
  if(isSessionValid(getStoredSession())){
    btn.textContent='SIGN OUT';
    btn.href='javascript:void(0)';
    btn.onclick=function(e){e.preventDefault();localStorage.removeItem('tv_session');updateAuthButton();};
    btn.style.color='var(--dim)';btn.style.background='none';btn.style.borderColor='var(--border)';
  }else{
    btn.innerHTML='&#128274; SIGN UP / SIGN IN';
    btn.href='https://tradetribunal.app/starter/';
    btn.onclick=null;
    btn.style.color='#40c4ff';btn.style.background='rgba(64,196,255,.1)';btn.style.borderColor='rgba(64,196,255,.4)';
  }
}
updateAuthButton();

const API_URL='https://tra-zacg.onrender.com';
const TIER={
  name:'Free',maxTickers:3,pulse:false,tracker:false,alpaca:false,
  credits:'3 credits/week',cache:'15 min cache',
  nextTier:'Starter',nextPrice:'$9.99/mo',
  stripeLink:'https://buy.stripe.com/eVq3cw84pczR6lp0oV3VC03',creditsLink:'https://buy.stripe.com/3cI3cwacxarJ8txb3z3VC00',
  badgeColor:'#8da4b0',
};
const APP_SECRET='Holysmoke42!';
let market=null;

// Logged-in visitors (tv_session set by the Starter login flow) are keyed
// per-account server-side via their Supabase token. Anonymous visitors fall
// back to the shared APP_SECRET, which the server keys per-IP (see
// server.js auth middleware) — never per-secret, since every anonymous
// visitor ships the same secret.
function authH(){return sbSession&&sbSession.token?{'Content-Type':'application/json','x-supabase-token':sbSession.token}:{'Content-Type':'application/json','x-app-secret':APP_SECRET};}
function addSecret(url){var sep=url.includes('?')?'&':'?';if(sbSession&&sbSession.token)return url+sep+'supabase_token='+encodeURIComponent(sbSession.token);return url+sep+'secret='+encodeURIComponent(APP_SECRET);}

if(!redirectingToPaidTier){
  initWatchlist({defaultTickers:['MU','IREN','ALAB'], maxTickers:3, upgradeMessage:'Free tier supports up to 3 tickers.\n\nUpgrade to Starter for more.'});
  initTickerCache({API_URL:API_URL, authH:authH, addSecret:addSecret});

  // Signed-in-but-free is the lapsed-subscriber case (or a free signup that
  // created an account) — sync their watchlist so a Starter/Pro/Shark lapse
  // doesn't wipe it, and so it survives a browser cache/cookie clear. Purely
  // anonymous visitors have no account to key cloud storage to, so this
  // stays fully local for them, same as before.
  if(sbSession&&sbSession.token){
    initWatchlistSync({API_URL:API_URL, authH:authH, addSecret:addSecret});
    onWatchlistSave(schedulePushWatchlist);
    pullWatchlistFromServer();
  }
}

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
    var now=new Date(),tz=new Date(now.toLocaleString('en-US',{timeZone:getTzIana()}));
    var h=tz.getHours(),m=tz.getMinutes(),s=tz.getSeconds();
    var p=function(n){return String(n).padStart(2,'0')};
    var h12=h%12||12,ampm=h<12?'AM':'PM';
    var cl=document.getElementById('live-clock');
    if(cl)cl.textContent=h12+':'+p(m)+':'+p(s)+' '+ampm+' '+getTzPref();
  }
  tick();setInterval(tick,1000);
}

function renderMarketTs(){
  if(!market||!market.timestamp)return;
  var t=new Date(market.timestamp).toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',timeZone:getTzIana()});
  document.getElementById('ts').textContent=(market.cached?'⚡ Cached':'🔴 Live')+' · Updated '+t+' '+getTzPref();
}

async function fetchMarket(force){
  force=force||false;
  document.getElementById('gate-label').textContent='LOADING...';
  document.getElementById('gate-label').style.color='var(--dim)';
  document.getElementById('pulse-text').className='pulse-loading';
  document.getElementById('pulse-text').textContent='Generating market pulse...';
  try{
    var url=force?API_URL+'/market?force=true':API_URL+'/market';
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
    renderMarketTs();
    var pulseEl=document.getElementById('pulse-text');
    if(data.pulse){pulseEl.className='pulse-text';pulseEl.textContent=data.pulse}
    else{pulseEl.className='pulse-loading';pulseEl.textContent='Generating pulse...'}
  }catch(e){
    document.getElementById('gate-label').textContent='DATA ERROR';
    document.getElementById('gate-label').style.color='var(--red)';
    document.getElementById('gate-note').textContent='Tap \u21ba REFRESH to retry';
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
    if(!res.ok){var errData=await res.json().catch(function(){return{}});if(res.status===402&&errData.code==='NO_CREDITS'){handleNoCredits(card,ticker);fetchCreditStatus();return;}throw new Error(errData.error||'Server error '+res.status);}
    var _r=await res.json();cacheVerdict(ticker,_r);renderCardResult(ticker,_r);fetchCreditStatus();
  }catch(e){
    card.querySelector('.card-action').innerHTML='<button class="retry-btn" onclick="analyzeTicker(\''+ticker+'\')">RETRY</button>';
    var re=card.querySelector('.reason-txt');re.textContent=e.message;re.style.color='var(--red)';re.style.display='';
  }
}

export function analyzeAll(){watchlist.forEach(function(t){analyzeTicker(t)})}

function renderCardResult(ticker,data){
  var card=document.getElementById('card-'+ticker);
  if(!card)return;

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
    actionEl.innerHTML='<div class="verdict-container" onclick="resetCard(\u0027'+ticker+'\u0027)"><span class="verdict-up">\ud83d\udc4d</span><span class="verdict-lbl-up">UP</span></div>';
  } else if(isDown){
    actionEl.innerHTML='<div class="verdict-container" onclick="resetCard(\u0027'+ticker+'\u0027)"><span class="verdict-down">\ud83d\udc4e</span><span class="verdict-lbl-down">DOWN</span></div>';
  } else{
    actionEl.innerHTML='<div class="verdict-container" onclick="resetCard(\u0027'+ticker+'\u0027)"><span class="verdict-hold">HOLD</span><span class="verdict-lbl-hold">WAIT &amp; WATCH</span></div>';
  }

  // Reason text is intentionally not shown here — it duplicates the
  // Gate Breakdown dropdown. The element stays in the DOM (hidden) so the
  // error path above can still surface fetch failures in the same spot.
  var re=card.querySelector('.reason-txt');
  re.textContent='';re.style.display='none';

  // Badges
  var badgesEl=card.querySelector('.card-badges');badgesEl.innerHTML='';
  if(data.type){var tc={CANARY:'var(--amber)',SENTIMENT:'var(--blue)',FLOW:'var(--green)'}[data.type]||'var(--dim)';badgesEl.innerHTML+='<span class="badge" style="color:'+tc+';border-color:'+tc+'55;background:'+tc+'11">'+data.type+'</span>'}
  if(data.sizing){
    if(data.sizing!=='NONE'){var sl={FULL:'Full',HALF:'Half',QUARTER:'\u00bc size'}[data.sizing]||data.sizing;var sc2={FULL:'var(--green)',HALF:'var(--amber)',QUARTER:'var(--amber)'}[data.sizing]||'var(--dim)';badgesEl.innerHTML+='<span class="badge" style="color:'+sc2+';border-color:'+sc2+'55;background:'+sc2+'11">'+sl+'</span>'}
    else{badgesEl.innerHTML+='<span class="badge" style="color:var(--blue);border-color:rgba(64,196,255,.4);background:rgba(64,196,255,.08)">Defined risk</span>'}
  }

  // Log buttons
  var logEl=card.querySelector('.log-section');
  if(logEl){
    logEl.innerHTML='<div class="log-row"><span class="log-prompt">TRACK RECORD</span><a class="log-upgrade-btn" href="https://buy.stripe.com/6oU4gA98t57p4dh2x33VC02" target="_blank">UPGRADE \u2192 Pro to log results</a></div>';
    logEl.style.display='block';
  }

  // Gate 5 (sector proxy) status dot, front-and-center on the card header.
  // Text next to the dot is the WAIT FOR guidance (same language previously
  // shown as its own boxed banner at the bottom of the dropdown) — Pre-Gate
  // and Gate 5 both have their own rows in the Gate Breakdown dropdown below.
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
    var gHtml='<button class="expand-btn" onclick="toggleGates(\u0027'+ticker+'\u0027)"><span>GATE BREAKDOWN</span><span id="arrow-'+ticker+'">\u25bc</span></button><div class="gate-list" id="gates-'+ticker+'" style="display:none">';
    gates.forEach(function(g){
      var lbl=g[0],gate=g[1]||{};
      gHtml+='<div class="gate-row"><div class="gate-dot-sm" style="background:'+sigColor(gate.status)+'"></div><div class="gate-content"><div class="gate-header"><span class="gate-lbl">'+lbl+'</span><span class="gate-stat" style="color:'+sigColor(gate.status)+'">'+(gate.status||'')+'</span></div>'+(gate.note?'<div class="gate-note-txt">'+gate.note+'</div>':'')+'</div></div>';
    });
    gHtml+='<div class="conf-row"><span class="conf-lbl">CONFIDENCE</span><span class="conf-val" style="color:'+cc+'">'+data.confidence+'</span></div></div>';
    gateEl.innerHTML=gHtml;gateEl.style.display='block';
  }
}

export function toggleGates(ticker){
  var el=document.getElementById('gates-'+ticker),arrow=document.getElementById('arrow-'+ticker);
  var open=el.style.display==='none';el.style.display=open?'block':'none';arrow.textContent=open?'\u25b2':'\u25bc';
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
}

var GLOSSARY=[
  {cat:'CRF FRAMEWORK',term:'CRF (Catalyst Response Framework)',def:'A step-by-step checklist this app runs on a stock before giving you a verdict. If enough of the checklist looks good, that\u2019s a thumbs up; if enough looks bad, that\u2019s a thumbs down.',ex:'Think of it like a pre-flight checklist for a trade \u2014 pilots don\u2019t take off until enough boxes are checked.'},
  {cat:'CRF FRAMEWORK',term:'Pre-Gate \u2014 Thesis Integrity',def:'A quick background check on the company itself, looking for red flags like financial trouble, before the app even looks at the stock\u2019s price. A serious red flag here can override everything else.',ex:'Like checking a used car\u2019s title for a salvage flag before you even look under the hood.'},
  {cat:'CRF FRAMEWORK',term:'Gate 0 \u2014 Sector Gate',def:'Checks how the overall stock market is doing today. If the whole market is having a bad day, that drags down the outlook for pretty much everything.',ex:'A rising tide lifts all boats \u2014 a sinking one drags them down too.'},
  {cat:'CRF FRAMEWORK',term:'Gate 1 \u2014 Bidirectional Trend Structure',def:'Looks at whether the stock has already made a big move recently, up or down. A stock that\u2019s already run up a lot is riskier to chase, and one that\u2019s fallen too far too fast is a red flag too.',ex:'Like being wary of a stock that already \u201cran\u201d \u2014 you don\u2019t want to be the last one to the party.'},
  {cat:'CRF FRAMEWORK',term:'Gate 2 \u2014 Catalyst Congruence',def:'Checks whether recent news about the company actually supports the direction the app is leaning.',ex:'Makes sure the story and the numbers are telling the same story.'},
  {cat:'CRF FRAMEWORK',term:'Gate 3 \u2014 Opening Bar',def:'Watches how the stock trades in the first few minutes after the market opens, since that early action often hints at where the rest of the day is headed.',ex:'Like judging a race by how strong the runners look at the starting gun.'},
  {cat:'CRF FRAMEWORK',term:'Gate 4 \u2014 Phase Identification',def:'Figures out whether a stock\u2019s big move is just getting started, already well underway, or has gone so far it might be due for a pullback.',ex:'Early innings vs. late innings of the same game.'},
  {cat:'CRF FRAMEWORK',term:'Gate 5 \u2014 Dynamic Sector Proxy',def:'Compares the stock to other companies or funds in the same industry, to see if it\u2019s moving with its peers or acting strangely on its own.',ex:'Checking if one kid in class is sick, or if the whole class has the flu.'},
  {cat:'TICKER CLASSIFICATIONS',term:'Canary',def:'European or institutional base that prices macro risk early. When canaries fall while sentiment names rise, reversal is coming.',ex:'ASML fell before MU/ALAB. Warned 10-21 days early.'},
  {cat:'TICKER CLASSIFICATIONS',term:'Sentiment',def:'Moves most directly with AI capex or sector confidence, ignoring macro until it breaks.',ex:'MU, NVDA, AMD. Ran +47% into Broadcom miss then crashed 12.8%.'},
  {cat:'TICKER CLASSIFICATIONS',term:'Flow',def:'Moves on mechanical buying events. Institutions distribute at the opening bar on positive catalyst days.',ex:'ALAB opened $315 on Computex day, flushed to $292 in 30 min on 1.1M shares.'},
  {cat:'TICKER CLASSIFICATIONS',term:'Phase 1 / 2 / 3',def:'Phase 1 = discovery, <30% of 52-week range, full size. Phase 2 = acceleration, 30-70%, half size. Phase 3 = priced for perfection, >70%, post-flush only.',ex:'ALAB at $88 = Phase 1. At $300 = Phase 2. At $450 = Phase 3 (sold off on blowout beat).'},
  {cat:'OPTIONS \u2014 GREEKS',term:'Delta (\u0394)',def:'How much an option moves per $1 move in the stock. ATM options ~0.50. Also approximates probability of expiring in-the-money.',ex:'Delta 0.50 call gains $0.50 when stock rises $1.'},
  {cat:'OPTIONS \u2014 GREEKS',term:'Gamma (\u0393)',def:'Rate of change of delta. High gamma = delta shifts rapidly. Options near expiry and ATM have highest gamma.',ex:'High-gamma option: $1 stock move shifts delta from 0.50 to 0.65.'},
  {cat:'OPTIONS \u2014 GREEKS',term:'Theta (\u0398)',def:'Time decay per day. Sellers\u2019 friend, buyers\u2019 enemy. Accelerates in final 2 weeks before expiry.',ex:'$2.00 option with theta \u22120.05 loses $0.50 over 10 days even if stock flat.'},
  {cat:'OPTIONS \u2014 GREEKS',term:'Vega (\u03bd)',def:'Sensitivity to implied volatility. Buying pre-earnings buys vega, but IV collapses after the event (IV crush).',ex:'Buy $3.00 pre-earnings, stock moves your way, IV drops 45pts \u2192 option now $1.80.'},
  {cat:'OPTIONS \u2014 CONCEPTS',term:'Implied Volatility (IV)',def:'Market\u2019s expectation of future price movement, annualized. High IV = expensive options. Forward-looking, not historical.',ex:'ALAB IV ran 98-115% during parabolic phase. Selling premium more attractive than buying.'},
  {cat:'OPTIONS \u2014 CONCEPTS',term:'IV Rank (IVR)',def:'Where current IV sits vs past 52 weeks as a percentile. IVR >80 = Phase 3 signal in CRF.',ex:'IVR 85 = IV higher than 85% of readings this year \u2192 Gate 4 RED lean.'},
  {cat:'OPTIONS \u2014 CONCEPTS',term:'Put/Call Skew',def:'Difference between put IV and call IV at equal distance from current price. Positive skew = bearish institutional hedging.',ex:'CHAT showed consistent +4pt put skew \u2192 Gate 2 bearish lean.'},
  {cat:'OPTIONS \u2014 CONCEPTS',term:'Expected Move',def:'Market-implied 1-sigma price range by expiration. Stock stays within this range ~68% of the time.',ex:'Stock $50, ATM IV 80%, 30 DTE \u2192 expected move \u00b1$12.30.'},
  {cat:'OPTIONS \u2014 CONCEPTS',term:'IV Crush',def:'Sharp drop in IV immediately after a catalyst. Options lose value even on correct direction.',ex:'Buy put pre-earnings $3.00. Stock drops 5% but IV collapses 55pts \u2192 put now $1.80.'},
  {cat:'OPTIONS \u2014 CONCEPTS',term:'Cash-Secured Put',def:'Selling a put while holding cash to buy shares at strike if assigned. Generates income on names you\u2019d want to own.',ex:'ARCC at $18.50 \u2192 sell $18 put for $0.48. Assigned = effective buy at $17.52.'},
  {cat:'OPTIONS \u2014 CONCEPTS',term:'Gamma Exposure (GEX)',def:'Aggregate dollar impact of dealer hedging. Positive GEX = dealers dampen moves. Negative GEX = dealers amplify moves.',ex:'SPX negative GEX \u2192 Opening Drive gaps extend. Momentum more reliable.'},
  {cat:'MARKET STRUCTURE',term:'Opening Drive',def:'First 90 minutes (9:30-11:00am ET). Highest volume, highest volatility. Most institutional orders execute here. This app is built for this window.',ex:'Stock gaps up 3% with 2\u00d7 average volume in bar 1 = Opening Drive setup.'},
  {cat:'MARKET STRUCTURE',term:'Gap Up / Gap Down',def:'Stock opens significantly different from prior close. CRF entry: gap \u22652% from prior close, enter at ask +1%.',ex:'SMMT closed $45, opens $47.50 = +5.5% gap. Check all 5 gates.'},
  {cat:'MARKET STRUCTURE',term:'Engulfing Candle',def:'Second candle\u2019s body completely contains the first. Bullish engulf = buyers overwhelmed sellers. Gate 3 uses this for Monday signals.',ex:'Monday bar 1 red at $40, bar 2 opens $38 closes $41 = bullish engulf \u2192 Gate 3 GREEN.'},
  {cat:'MARKET STRUCTURE',term:'Circuit Breaker',def:'Automatic trading halt when market falls a specified percentage. US halts at \u22127%, \u221213%, \u221220%. KOSPI at \u22128%.',ex:'KOSPI circuit breaker June 8 2026 at \u22128.37% \u2192 Gate 5 RED for all AI/semi.'},
  {cat:'MARKET STRUCTURE',term:'Short Squeeze',def:'Heavily shorted stock rises sharply, forcing shorts to buy to cover, pushing price higher. Brief but explosive.',ex:'IREN 18.7% short float, <2 days to cover. Any positive catalyst could trigger a squeeze.'},
  {cat:'SECTOR TERMS',term:'KOSPI',def:'Korea Composite Stock Price Index. Leading indicator for US AI/semi names. US names lag KOSPI crashes by 1-3 sessions.',ex:'KOSPI \u22126% Tuesday \u2192 NVDA/MU/ALAB pressure Thursday-Friday.'},
  {cat:'SECTOR TERMS',term:'TSM (Taiwan Semiconductor)',def:'World\u2019s largest contract chip manufacturer. Single best proxy for global semiconductor health. TSM drop >3% = Gate 5 RED for all AI/semi names.',ex:'TSM \u22124% \u2192 Taiwan semi stress \u2192 risk-off on AI/semi entries.'},
  {cat:'SECTOR TERMS',term:'XBI / IBB',def:'Biotech ETFs. XBI equal-weighted (smaller companies more impact). XBI is Gate 5 proxy for biotech/medical names.',ex:'XBI \u22122% \u2192 biotech risk-off \u2192 Gate 5 YELLOW or RED for SMMT/VCYT/IMVT.'},
  {cat:'SECTOR TERMS',term:'SOXX',def:'iShares Semiconductor ETF. Tracks 30 largest US-listed semiconductor companies. Best sector indicator for AI/chip trades.',ex:'SOXX \u22123% while SPY flat = semiconductor-specific stress.'},
  {cat:'SECTOR TERMS',term:'HBM (High Bandwidth Memory)',def:'RAM designed for AI training. Only Micron, Samsung, SK Hynix make it. Core of MU\u2019s AI thesis.',ex:'Hyperscaler capex slowdown = HBM demand slowdown = MU pressure.'},
  {cat:'SECTOR TERMS',term:'Neocloud',def:'Companies renting GPU compute to AI developers. Borrow billions to buy Nvidia GPUs, rent at premium.',ex:'IREN, CoreWeave. Revenue real; profitability theoretical for most.'},
  {cat:'SECTOR TERMS',term:'BDC (Business Development Company)',def:'Fund making loans to mid-sized businesses, required to distribute 90%+ of income as dividends.',ex:'ARCC is the largest publicly traded BDC. Income from loan interest, not appreciation.'},
  {cat:'TRADING TERMINOLOGY',term:'Long',def:'Buying and owning shares expecting price to rise.',ex:'Buy 100 SMMT at $45. Sell at $50. $500 profit.'},
  {cat:'TRADING TERMINOLOGY',term:'Short / Short Selling',def:'Borrowing shares, selling immediately, buying back later. Profit if price falls. Loss if rises \u2014 theoretically unlimited.',ex:'Short 100 IREN at $40. Falls to $32 \u2192 $800 profit.'},
  {cat:'TRADING TERMINOLOGY',term:'Defined Risk',def:'Position where max loss is fixed at entry. Buying options or spreads. Cannot lose more than premium paid.',ex:'Buy 1 put for $200. Stock rallies. Max loss = $200.'},
  {cat:'TRADING TERMINOLOGY',term:'Stop Loss',def:'Pre-set price at which you automatically exit to limit losses. Set before entry. CRF: \u22123% for high-conviction names.',ex:'Enter SMMT at $45. Stop at $43.65 (\u22123%). Hit $43.65 \u2192 exit immediately.'},
  {cat:'TRADING TERMINOLOGY',term:'Sector Rotation',def:'Money moving from one sector to another. Sector pulse blurb tracks this daily.',ex:'AI fears \u2192 money rotates from NVDA into GLD and USO.'},
  {cat:'TRADING TERMINOLOGY',term:'Sell the News',def:'Stock falls after a positive catalyst because good news was already priced in. Phase 3 behavior.',ex:'ALAB beats Q1 by 12%. Stock drops 13% next day. Beat was priced in.'},
  {cat:'TRADING TERMINOLOGY',term:'14-Day Pre-Window',def:'14 trading days before a catalyst. Over +20% move in this window = Gate 1 RED (exhaustion).',ex:'MU ran +35% in 14 days before record earnings. Gate 1 RED. Sold off on the print.'},
  {cat:'TRADING TERMINOLOGY',term:'Pyramiding',def:'Adding to a winning position in smaller increments as it moves in your favor.',ex:'100 shares at $45. Rises to $47 \u2192 add 50. Hits $49 \u2192 add 25.'},
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

// Purchasing credits requires attributing the Stripe payment to an
// account (server.js keys the purchase webhook off email), so the buy
// link only makes sense for logged-in visitors. Anonymous visitors see
// their remaining weekly count as a link to sign in instead — never a
// dead, unclickable button.
async function fetchCreditStatus(){
  try{
    var res=await fetch(addSecret(API_URL+'/status'),{headers:authH()});
    var data=await res.json();
    var el=document.getElementById('credits-btn');
    if(!el||data.totalCredits===undefined)return;
    var loggedIn=!!(sbSession&&sbSession.token);
    var label=(data.totalCredits>0?data.totalCredits:'+')+' CREDITS';
    if(loggedIn){
      el.textContent=label;
      el.href=TIER.creditsLink;
      el.target='_blank';
      el.style.pointerEvents='';el.style.opacity='';
    }else{
      el.textContent=label+' · WK';
      el.href='https://tradetribunal.app/starter/';
      el.removeAttribute('target');
      el.style.pointerEvents='';el.style.opacity='';
    }
  }catch(e){}
}

// Next weekly reset boundary — matches credits.js's fixed 7-day epoch
// buckets (WEEK_MS), so the countdown shown here lines up with when the
// server actually refreshes the balance.
var comebackTimer=null;
function startComebackTimer(){
  if(comebackTimer)clearInterval(comebackTimer);
  comebackTimer=setInterval(function(){
    var WEEK_MS=7*24*60*60*1000;
    var nextReset=(Math.floor(Date.now()/WEEK_MS)+1)*WEEK_MS;
    var diff=nextReset-Date.now();
    var d=Math.floor(diff/86400000),h=Math.floor((diff%86400000)/3600000),m=Math.floor((diff%3600000)/60000),s=Math.floor((diff%60000)/1000);
    var el=document.getElementById('comeback-timer');
    if(el)el.textContent=d+'d '+String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');
  },1000);
}

// ── NO CREDITS ────────────────────────────────────────────────────
function handleNoCredits(card,ticker){
  var cached=getCachedVerdict(ticker);
  if(cached){renderCardResult(ticker,cached);return;}
  // Anonymous visitors can't have a $0.99 purchase attributed to them
  // (server keys purchases by account email) — point them at sign-in
  // instead of a buy link that won't actually credit their balance.
  var buyBtn=document.getElementById('comeback-buy-btn');
  if(buyBtn){
    if(sbSession&&sbSession.token){
      buyBtn.textContent='+ BUY CREDITS $0.99';
      buyBtn.href='https://buy.stripe.com/3cI3cwacxarJ8txb3z3VC00';
    }else{
      buyBtn.textContent='SIGN IN TO ADD CREDITS';
      buyBtn.href='https://tradetribunal.app/starter/';
      buyBtn.removeAttribute('target');
    }
  }
  document.getElementById('comeback-screen').style.display='flex';
  startComebackTimer();
}

if(!redirectingToPaidTier){
  cleanLS();
  document.getElementById('ticker-count').textContent='CRF \u00b7 '+watchlist.length+' TICKERS';
  renderWatchlist();renderTrackRecord();startClock();
  var ctxInputEl=document.getElementById('context-input');
  if(ctxInputEl){
    var ctxDebounce=null;
    ctxInputEl.addEventListener('input',function(){
      clearTimeout(ctxDebounce);
      ctxDebounce=setTimeout(refreshNewsHighlights,250);
    });
  }
  fetchMarket();setTimeout(fetchCreditStatus,2000);
  setInterval(function(){fetchMarket()},4*60*1000);
  enforceMarketState();setInterval(enforceMarketState,60*1000);
}

window.fetchMarket = fetchMarket;
window.analyzeAll = analyzeAll;
window.analyzeTicker = analyzeTicker;
window.resetCard = resetCard;
window.toggleGates = toggleGates;
window.toggleGlossary = toggleGlossary;
window.filterGlossary = filterGlossary;
