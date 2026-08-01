import { fetchTickerData } from './ticker-cache.js';

export let watchlist = [];
let maxTickers = 3;
let upgradeMessage = '';

export function initWatchlist(config){
  maxTickers = config.maxTickers;
  upgradeMessage = config.upgradeMessage;
  var _wl = JSON.parse(localStorage.getItem('tv_wl') || JSON.stringify(config.defaultTickers));
  if(_wl.length > maxTickers) _wl = _wl.slice(0, maxTickers);
  watchlist = _wl;
}

function saveWL(){localStorage.setItem('tv_wl',JSON.stringify(watchlist));document.getElementById('ticker-count').textContent='CRF \u00b7 '+watchlist.length+' TICKERS'}


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
    var betaStr=m.beta?'\u03b2'+m.beta.toFixed(1):'?';
    var proxyName=td.proxyRule&&td.proxyRule.proxy?td.proxyRule.proxy.name:'';
    var proxyShort=proxyName.split('(')[0].trim();
    phaseEl.innerHTML='<div class="phase-item"><span class="phase-lbl">52W</span><span class="phase-val">'+rp+'</span></div>'
      +'<div class="phase-item"><span class="phase-lbl">PHASE</span><span class="phase-val" style="color:'+phColor+'">'+ph.replace('PHASE_','')+'</span></div>'
      +'<div class="phase-item"><span class="phase-lbl">\u03b2</span><span class="phase-val">'+betaStr+'</span></div>'
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
  if(!confirm('Remove '+ticker+'?'))return;
  watchlist=watchlist.filter(function(t){return t!==ticker});
  saveWL();renderWatchlist();
}

export function renderWatchlist(){
  var wl=document.getElementById('watchlist');
  wl.innerHTML=watchlist.map(function(ticker){
    return '<div class="card" id="card-'+ticker+'">'
      +'<div class="card-head">'
      +'<div class="card-left">'
      +'<div class="ticker-row"><span class="ticker-name">'+ticker+'</span><span class="ticker-price">&mdash;</span></div>'
      +'<div class="news-line" style="display:none"></div>'
      +'<div class="phase-strip"></div>'
      +'<div class="reason-txt"></div>'
      +'<div class="card-badges"></div>'
      +'</div>'
      +'<div class="card-right">'
      +'<div class="reorder-btns"><button class="reorder-btn" onclick="moveCard(\''+ticker+'\',-1)">&#9650;</button><button class="reorder-btn" onclick="moveCard(\''+ticker+'\',1)">&#9660;</button></div>'
      +'<div class="card-action"><button class="analyze-btn" onclick="analyzeTicker(\''+ticker+'\')">ANALYZE</button></div>'
      +'<button class="remove-btn" onclick="removeTicker(\''+ticker+'\')">&#215;</button>'
      +'</div></div>'
      +'<div class="log-section" style="display:none"></div>'
      +'<div class="gate-section" style="display:none"></div>'
      +'</div>';
  }).join('');
  watchlist.forEach(function(t){fetchTickerData(t).then(function(d){if(d)updateCardMeta(t,d)})});
}

export function moveCard(ticker,dir){
  var idx=watchlist.indexOf(ticker);if(idx===-1)return;
  var ni=idx+dir;if(ni<0||ni>=watchlist.length)return;
  var tmp=watchlist[idx];watchlist[idx]=watchlist[ni];watchlist[ni]=tmp;
  saveWL();
  var wl=document.getElementById('watchlist');
  var card=document.getElementById('card-'+ticker);
  var sib=document.getElementById('card-'+watchlist[idx]);
  if(!card||!sib)return;
  if(dir===-1)wl.insertBefore(card,sib);else wl.insertBefore(card,sib.nextSibling);
}

window.addTickers = addTickers;
window.removeTicker = removeTicker;
window.moveCard = moveCard;
