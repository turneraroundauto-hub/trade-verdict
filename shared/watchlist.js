import { fetchTickerData } from './ticker-cache.js?v=2';

export let watchlist = [];
let maxTickers = 3;
let upgradeMessage = '';
let gesturesBound = false;

export function initWatchlist(config){
  maxTickers = config.maxTickers;
  upgradeMessage = config.upgradeMessage;
  var _wl = JSON.parse(localStorage.getItem('tv_wl') || JSON.stringify(config.defaultTickers));
  if(_wl.length > maxTickers) _wl = _wl.slice(0, maxTickers);
  watchlist = _wl;
  bindGestures();
}

function saveWL(){localStorage.setItem('tv_wl',JSON.stringify(watchlist));document.getElementById('ticker-count').textContent='CRF · '+watchlist.length+' TICKERS'}


function parseTickers(raw){return raw.toUpperCase().replace(/[$#]/g,'').split(/[\s,;|\n]+/).map(t=>t.trim()).filter(t=>/^[A-Z]{1,6}$/.test(t))}


export function updateCardMeta(ticker,td){
  var card=document.getElementById('card-'+ticker);if(!card)return;
  var priceEl=card.querySelector('.ticker-price');
  if(priceEl&&td&&td.metrics&&td.metrics.price)priceEl.textContent='$'+parseFloat(td.metrics.price).toFixed(2);
  var phaseEl=card.querySelector('.phase-strip');
  if(phaseEl&&td&&td.metrics){
    var m=td.metrics;
    var rp=m.rangePosition!==null&&m.rangePosition!==undefined?m.rangePosition+'%':'?';
    var ph=m.phaseProxy||'?';
    var phColor=ph==='PHASE_3'?'var(--red)':ph==='PHASE_2'?'var(--amber)':'var(--green)';
    var betaStr=m.beta?'β'+m.beta.toFixed(1):'?';
    var proxyName=td.proxyRule&&td.proxyRule.proxy?td.proxyRule.proxy.name:'';
    var proxyShort=proxyName.split('(')[0].trim();
    phaseEl.innerHTML='<div class="phase-item"><span class="phase-lbl">52W</span><span class="phase-val">'+rp+'</span></div>'
      +'<div class="phase-item"><span class="phase-lbl">PHASE</span><span class="phase-val" style="color:'+phColor+'">'+ph.replace('PHASE_','')+'</span></div>'
      +'<div class="phase-item"><span class="phase-lbl">β</span><span class="phase-val">'+betaStr+'</span></div>'
      +(proxyShort?'<div class="phase-item"><span class="phase-lbl">PROXY</span><span class="phase-val" style="color:var(--blue);font-size:9px">'+proxyShort+'</span></div>':'');
  }
  var newsEl=card.querySelector('.news-line');
  var news=td&&td.news;
  if(newsEl){
    if(news&&news.ageHours<=300){
      newsEl.style.display='block';
      newsEl.innerHTML='<a href="'+news.url+'" target="_blank">'+news.headline+'</a><span class="news-age">'+news.ageLabel+'</span>';
    }else newsEl.style.display='none';
  }
}

export function addTickers(){
  if(watchlist.length>=maxTickers){
    alert(upgradeMessage);
    return;
  }
  var raw=document.getElementById('ticker-input').value;
  var tickers=parseTickers(raw);
  if(!tickers.length)return alert('No valid tickers. Try: AAPL or MU');
  tickers.forEach(function(t){if(!watchlist.includes(t))watchlist.push(t)});
  document.getElementById('ticker-input').value='';
  saveWL();renderWatchlist();
  tickers.forEach(function(t){fetchTickerData(t).then(function(d){if(d)updateCardMeta(t,d)})});
}

export function removeTicker(ticker){
  var idx=watchlist.indexOf(ticker);if(idx===-1)return;
  watchlist=watchlist.filter(function(t){return t!==ticker});
  saveWL();renderWatchlist();
  showUndoToast(ticker,idx);
}

var undoTimer=null;
function showUndoToast(ticker,idx){
  var el=document.getElementById('undo-toast');
  if(!el){
    el=document.createElement('div');
    el.id='undo-toast';
    el.style.cssText='position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#101c2e;border:1px solid var(--border);border-radius:8px;padding:10px 14px;display:flex;align-items:center;gap:14px;font-family:monospace;font-size:12px;color:var(--white);box-shadow:0 8px 24px rgba(0,0,0,.5);z-index:999;opacity:0;transition:opacity .2s;pointer-events:none';
    document.body.appendChild(el);
  }
  clearTimeout(undoTimer);
  el.innerHTML='<span>Removed '+ticker+'</span><button id="undo-btn" style="background:none;border:none;color:var(--blue);font-family:monospace;font-size:12px;font-weight:700;cursor:pointer;letter-spacing:.06em;pointer-events:auto">UNDO</button>';
  el.style.pointerEvents='auto';
  el.style.opacity='1';
  document.getElementById('undo-btn').onclick=function(){
    if(!watchlist.includes(ticker)){
      watchlist.splice(Math.min(idx,watchlist.length),0,ticker);
      saveWL();renderWatchlist();
      fetchTickerData(ticker).then(function(d){if(d)updateCardMeta(ticker,d)});
    }
    hideUndoToast();
  };
  undoTimer=setTimeout(hideUndoToast,4000);
}
function hideUndoToast(){
  var el=document.getElementById('undo-toast');
  if(el){el.style.opacity='0';el.style.pointerEvents='none';}
  clearTimeout(undoTimer);
}

export function renderWatchlist(){
  var wl=document.getElementById('watchlist');
  wl.innerHTML=watchlist.map(function(ticker){
    return '<div class="card-wrap" data-ticker="'+ticker+'">'
      +'<div class="swipe-bg"><span class="swipe-icon">&#128465;</span><span class="swipe-label">DELETE</span></div>'
      +'<div class="card" id="card-'+ticker+'">'
      +'<div class="card-head">'
      +'<div class="card-left">'
      +'<div class="ticker-row"><span class="ticker-name">'+ticker+'</span><span class="ticker-price">&mdash;</span></div>'
      +'<div class="pregate-strip" id="pregate-'+ticker+'" style="display:none"></div>'
      +'<div class="news-line" style="display:none"></div>'
      +'<div class="phase-strip"></div>'
      +'<div class="reason-txt" style="display:none"></div>'
      +'<div class="card-badges"></div>'
      +'</div>'
      +'<div class="card-right">'
      +'<div class="drag-handle" title="Drag to reorder">&#10303;</div>'
      +'<div class="card-action"><button class="analyze-btn" onclick="analyzeTicker(\''+ticker+'\')">ANALYZE</button></div>'
      +'</div></div>'
      +'<div class="log-section" style="display:none"></div>'
      +'<div class="gate-section" style="display:none"></div>'
      +'</div>'
      +'</div>';
  }).join('');
  watchlist.forEach(function(t){fetchTickerData(t).then(function(d){if(d)updateCardMeta(t,d)})});
}

// --- Drag-to-reorder + swipe-to-delete gestures ---

var ACTIVE=null;
var MOVE_THRESHOLD=8;

function bindGestures(){
  if(gesturesBound)return;
  var wl=document.getElementById('watchlist');
  if(!wl)return;
  gesturesBound=true;
  wl.addEventListener('pointerdown',onPointerDown);
}

function onPointerDown(e){
  if(ACTIVE)return;
  if(e.pointerType==='mouse'&&e.button!==0)return;
  if(e.target.closest('button,a,input,.expand-btn,.verdict-container'))return;
  var wrap=e.target.closest('.card-wrap');
  if(!wrap)return;
  var card=wrap.querySelector('.card');
  if(!card)return;
  ACTIVE={
    pointerId:e.pointerId,wrap:wrap,card:card,ticker:wrap.dataset.ticker,
    startX:e.clientX,startY:e.clientY,mode:null,pendingDx:0,
    swipeBg:wrap.querySelector('.swipe-bg')
  };
  if(e.target.closest('.drag-handle'))beginReorder(e);
  document.addEventListener('pointermove',onPointerMove,{passive:false});
  document.addEventListener('pointerup',onPointerUp);
  document.addEventListener('pointercancel',onPointerUp);
}

function beginReorder(e){
  var g=ACTIVE;
  g.mode='reorder';
  try{g.wrap.setPointerCapture(e.pointerId)}catch(err){}
  g.card.style.transition='none';
  g.wrap.classList.add('dragging');
  g.card.classList.add('dragging');
}

function deleteThreshold(wrap){
  return Math.min(120,wrap.getBoundingClientRect().width*0.35);
}

function onPointerMove(e){
  var g=ACTIVE;if(!g||e.pointerId!==g.pointerId)return;
  var dx=e.clientX-g.startX,dy=e.clientY-g.startY;
  if(g.mode===null){
    if(Math.abs(dx)>MOVE_THRESHOLD&&Math.abs(dx)>Math.abs(dy)){
      g.mode='swipe';
      try{g.wrap.setPointerCapture(e.pointerId)}catch(err){}
      g.card.style.transition='none';
      g.wrap.classList.add('swiping');
    }else if(Math.abs(dy)>MOVE_THRESHOLD){
      endGesture();
      return;
    }else return;
  }
  if(g.mode==='swipe'){
    e.preventDefault();
    var clamped=Math.min(0,Math.max(dx,-g.wrap.getBoundingClientRect().width));
    g.card.style.transform='translateX('+clamped+'px)';
    var progress=Math.min(Math.abs(clamped)/deleteThreshold(g.wrap),1);
    g.swipeBg.style.opacity=String(progress);
    g.pendingDx=clamped;
  }else if(g.mode==='reorder'){
    e.preventDefault();
    while(trySwap(g,e)){}
    g.card.style.transform='translateY('+(e.clientY-g.startY)+'px)';
  }
}

function trySwap(g,e){
  var wl=document.getElementById('watchlist');
  var wrapRect=g.wrap.getBoundingClientRect();
  var dy=e.clientY-g.startY;
  var draggedCenter=wrapRect.top+wrapRect.height/2+dy;
  var next=g.wrap.nextElementSibling;
  if(next){
    var nr=next.getBoundingClientRect();
    if(draggedCenter>nr.top+nr.height/2){
      wl.insertBefore(next,g.wrap);
      swapTickers(g.ticker,next.dataset.ticker);
      g.startY+=nr.height;
      return true;
    }
  }
  var prev=g.wrap.previousElementSibling;
  if(prev){
    var pr=prev.getBoundingClientRect();
    if(draggedCenter<pr.top+pr.height/2){
      wl.insertBefore(g.wrap,prev);
      swapTickers(g.ticker,prev.dataset.ticker);
      g.startY-=pr.height;
      return true;
    }
  }
  return false;
}

function swapTickers(a,b){
  var ia=watchlist.indexOf(a),ib=watchlist.indexOf(b);
  if(ia===-1||ib===-1)return;
  var tmp=watchlist[ia];watchlist[ia]=watchlist[ib];watchlist[ib]=tmp;
  saveWL();
}

function onPointerUp(e){
  var g=ACTIVE;if(!g||e.pointerId!==g.pointerId)return;
  if(g.mode==='swipe')finishSwipe(g);
  else if(g.mode==='reorder')finishReorder(g);
  endGesture();
}

function finishSwipe(g){
  var threshold=deleteThreshold(g.wrap);
  if(Math.abs(g.pendingDx)>=threshold){
    var wrap=g.wrap,ticker=g.ticker,w=wrap.getBoundingClientRect().width;
    g.card.style.transition='transform .18s ease-in';
    g.card.style.transform='translateX(-'+(w+40)+'px)';
    wrap.style.overflow='hidden';
    wrap.style.transition='max-height .2s ease .12s,opacity .2s ease .12s,margin .2s ease .12s';
    requestAnimationFrame(function(){
      wrap.style.maxHeight='0px';wrap.style.opacity='0';
      wrap.style.marginTop='0px';wrap.style.marginBottom='0px';
    });
    setTimeout(function(){removeTicker(ticker)},220);
  }else{
    g.card.style.transition='transform .18s ease';
    g.card.style.transform='translateX(0)';
    g.swipeBg.style.opacity='0';
  }
  g.wrap.classList.remove('swiping');
}

function finishReorder(g){
  g.card.style.transition='transform .15s ease';
  g.card.style.transform='translateY(0)';
  g.wrap.classList.remove('dragging');
  g.card.classList.remove('dragging');
  setTimeout(function(){g.card.style.transition='';},160);
}

function endGesture(){
  var g=ACTIVE;
  if(g){try{g.wrap.releasePointerCapture(g.pointerId)}catch(err){}}
  ACTIVE=null;
  document.removeEventListener('pointermove',onPointerMove);
  document.removeEventListener('pointerup',onPointerUp);
  document.removeEventListener('pointercancel',onPointerUp);
}
