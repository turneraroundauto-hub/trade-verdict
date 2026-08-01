import { initTickerCache, fetchTickerData } from './shared/ticker-cache.js';
import { initWatchlist, watchlist, addTickers, renderWatchlist, updateCardMeta } from './shared/watchlist.js';
import { cleanLS, cacheVerdict, getCachedVerdict } from './shared/analysis-cache.js';
import { renderTrackRecord } from './shared/track-record.js';

// If user has a paid session in localStorage from paid tier, redirect them
try{
  var stored=JSON.parse(localStorage.getItem('tv_session')||'null');
  if(stored&&stored.tier&&stored.tier!=='free'&&stored.redirectUrl){
    window.location.href=stored.redirectUrl;
  }
}catch(e){}

const API_URL='https://tra-zacg.onrender.com';
const TIER={
  name:'Free',maxTickers:3,pulse:false,tracker:false,alpaca:false,
  credits:'3 analyses',cache:'15 min cache',
  nextTier:'Starter',nextPrice:'$9.99/mo',
  stripeLink:'https://buy.stripe.com/eVq3cw84pczR6lp0oV3VC03',creditsLink:'https://buy.stripe.com/3cI3cwacxarJ8txb3z3VC00',
  badgeColor:'#607d8b',
};
const APP_SECRET='Holysmoke42!';
let market=null;

function authH(){return{'Content-Type':'application/json','x-app-secret':APP_SECRET};}
function addSecret(url){var sep=url.includes('?')?'&':'?';return url+sep+'secret='+encodeURIComponent(APP_SECRET);}

initWatchlist({defaultTickers:['MU','IREN','ALAB'], maxTickers:3, upgradeMessage:'Free tier supports up to 3 tickers.\n\nUpgrade to Starter for more.'});
initTickerCache({API_URL:API_URL, authH:authH, addSecret:addSecret});

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
    var cl=document.getElementById('live-clock');
    if(cl)cl.textContent=p(h)+':'+p(m)+':'+p(s)+' ET';
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
      btcEl.style.color=data.btcSignal==='full conviction'?'var(--green)':data.btcSignal==='stand down'?'var(--red)':'var(--amber)';
    }else btcEl.style.display='none';
    var tsmEl=document.getElementById('tsm-warning');
    if(data.tsmWarning){tsmEl.style.display='block';tsmEl.textContent=data.tsmWarning}else tsmEl.style.display='none';
    if(data.timestamp){
      var t=new Date(data.timestamp).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
      document.getElementById('ts').textContent=(data.cached?'\u26a1 Cached':'\ud83d\udd34 Live')+' \u00b7 Updated '+t;
    }
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
  card.classList.remove('up','down','flat','rim-green','rim-yellow','rim-red');
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
  card.classList.remove('up','down','flat','rim-green','rim-yellow','rim-red');
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
  {cat:'CRF FRAMEWORK',term:'CRF (Catalyst Response Framework)',def:'The 5-gate entry checklist this app runs. Built from 90-day analysis of MU, ASML, and ALAB data. All gates GREEN = UP. Any RED = DOWN. 2+ YELLOW = HOLD.',ex:'SMMT: G0 GREEN, G1 GREEN, G2 GREEN (news catalyst), G3 YELLOW (weekend), G4 GREEN, G5 GREEN (XBI +1.5%) = UP MEDIUM'},
  {cat:'CRF FRAMEWORK',term:'Gate 0 \u2014 Sector Gate',def:'Server-calculated from live SPY and QQQ. Never AI-estimated. SPY or QQQ down >1% = RED, overrides everything else.',ex:'SPY \u22121.2% \u2192 Gate 0 RED \u2192 DOWN verdict auto-enforced.'},
  {cat:'CRF FRAMEWORK',term:'Gate 1 \u2014 Pre-Window Exhaustion',def:'52-week range position as proxy for 14-day run. Under 30% = GREEN. 30-70% = YELLOW. Over 70% = RED (priced in).',ex:'SMMT at 7% of 52-week range = GREEN. Minimal pre-window exhaustion.'},
  {cat:'CRF FRAMEWORK',term:'Gate 2 \u2014 Catalyst Congruence',def:'Classifies whether catalyst context is congruent or contrarian. Now reads actual news headlines from past business week as catalyst evidence.',ex:'SMMT signed Phase III asset sale = positive catalyst \u2192 Gate 2 GREEN lean.'},
  {cat:'CRF FRAMEWORK',term:'Gate 3 \u2014 Opening Bar',def:'Analyzes first 30-min candle. Fridays show 67% reversal by bar 3. Weekends = YELLOW (no opening bar).',ex:'Friday opens green \u2192 wait for bar 2 before entry.'},
  {cat:'CRF FRAMEWORK',term:'Gate 4 \u2014 Phase Identification',def:'Phase 1 (<30% range) = full size GREEN. Phase 2 (30-70%) = half size YELLOW. Phase 3 (>70%) = post-flush only RED.',ex:'SMMT 7% of range = Phase 1 = GREEN.'},
  {cat:'CRF FRAMEWORK',term:'Gate 5 \u2014 Smart Sector Proxy',def:'Auto-selects the right barometer per sector. Never N/A. Biotech\u2192XBI. AI/Semi\u2192TSM. Software\u2192MSFT. Fintech\u2192BTC+QQQ. Energy\u2192USO+GLD. BDC/REIT\u2192IWM+SPY.',ex:'SMMT classified Biotech \u2192 Gate 5 uses XBI. XBI +1.5% \u2192 Gate 5 GREEN.'},
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
  {cat:'SECTOR TERMS',term:'TSM (Taiwan Semiconductor)',def:'World\u2019s largest contract chip manufacturer. Single best proxy for global semiconductor health. TSM drop >3% = Gate 5 RED for all AI/semi names.',ex:'TSM \u22124% \u2192 Taiwan semi stress \u2192 stand down AI/semi entries.'},
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

async function fetchCreditStatus(){
  try{
    var res=await fetch(API_URL+'/status?secret='+encodeURIComponent(APP_SECRET));
    var data=await res.json();
    var el=document.getElementById('credit-display');
    if(el&&data.totalCredits!==undefined){
      el.textContent=data.totalCredits+' credits';
      el.style.color=data.totalCredits<5?'var(--red)':data.totalCredits<15?'var(--amber)':'var(--dim)';
    }
  }catch(e){}
}

var comebackTimer=null;
function startComebackTimer(){
  if(comebackTimer)clearInterval(comebackTimer);
  comebackTimer=setInterval(function(){
    var now=new Date(),midnight=new Date();midnight.setHours(24,0,0,0);
    var diff=midnight-now,h=Math.floor(diff/3600000),m=Math.floor((diff%3600000)/60000),s=Math.floor((diff%60000)/1000);
    var el=document.getElementById('comeback-timer');
    if(el)el.textContent=String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');
  },1000);
}

// ── NO CREDITS ────────────────────────────────────────────────────
function handleNoCredits(card,ticker){
  var cached=getCachedVerdict(ticker);
  if(cached){renderCardResult(ticker,cached);return;}
  document.getElementById('comeback-screen').style.display='flex';
  startComebackTimer();
}

cleanLS();
document.getElementById('ticker-count').textContent='CRF \u00b7 '+watchlist.length+' TICKERS';
renderWatchlist();renderTrackRecord();startClock();
fetchMarket();setTimeout(fetchCreditStatus,2000);
setInterval(function(){fetchMarket()},4*60*1000);
enforceMarketState();setInterval(enforceMarketState,60*1000);

window.fetchMarket = fetchMarket;
window.analyzeAll = analyzeAll;
window.analyzeTicker = analyzeTicker;
window.resetCard = resetCard;
window.toggleGates = toggleGates;
window.toggleGlossary = toggleGlossary;
window.filterGlossary = filterGlossary;
