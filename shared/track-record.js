import { tickerHref } from './prefs.js?v=10';

var LOG_KEY='tv_accuracy_log';
function getLog(){try{return JSON.parse(localStorage.getItem(LOG_KEY)||'[]')}catch(e){return[]}}
let saveHook=null;
export function onLogSave(cb){saveHook=cb;}
function saveLog(log){localStorage.setItem(LOG_KEY,JSON.stringify(log));if(saveHook)saveHook();}

export function logResult(ticker,verdict,correct,rowEl,meta){
  var log=getLog();
  var entry={ticker:ticker,verdict:verdict,correct:correct,ts:new Date().toISOString(),
    session:new Date().toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',timeZone:'America/New_York'})};
  if(meta&&meta.trigger)entry.trigger=meta.trigger;
  log.push(entry);
  if(log.length>200)log=log.slice(-200);
  saveLog(log);
  var color=correct?'var(--green)':'var(--red)';
  var label=correct?'\u2713 LOGGED RIGHT':'\u2717 LOGGED WRONG';
  rowEl.innerHTML='<span class="log-recorded" style="color:'+color+';background:'+color+'11;border:1px solid '+color+'44">'+label+'</span>';
  renderTrackRecord();
}

export function clearLog(){if(!confirm('Clear all logged trades?'))return;saveLog([]);renderTrackRecord()}

// Overwrites the log wholesale — used to hydrate from the server on login
// (shared/track-record-sync.js), same role setWatchlist() plays for the
// watchlist. Not used by any local mutation path.
export function replaceLog(entries){saveLog(entries);renderTrackRecord()}

// Raw log entries, newest-last \u2014 used by tiers that build extra analytics
// (e.g. Pro's gate-attribution breakdown) on top of the same tv_accuracy_log
// this module already owns, without duplicating the localStorage read/parse.
export function getAccuracyLog(){return getLog();}

export function renderTrackRecord(){
  var log=getLog();
  var body=document.getElementById('track-body');if(!body)return;
  if(!log.length){body.innerHTML='<div class="track-empty">No trades logged yet.<br>After each verdict tap \u2713 RIGHT or \u2717 WRONG.</div>';return}
  var total=log.length,correct=log.filter(function(e){return e.correct}).length;
  var rate=Math.round((correct/total)*100);
  var rateColor=rate>=65?'var(--green)':rate>=50?'var(--amber)':'var(--red)';
  var byType={UP:{c:0,t:0},DOWN:{c:0,t:0},FLAT:{c:0,t:0}};
  log.forEach(function(e){var v=e.verdict||'UP';if(!byType[v])byType[v]={c:0,t:0};byType[v].t++;if(e.correct)byType[v].c++});
  var typeRate=function(v){return byType[v].t?Math.round((byType[v].c/byType[v].t)*100)+'%':'&mdash;'};
  var byTicker={};
  log.forEach(function(e){if(!byTicker[e.ticker])byTicker[e.ticker]={c:0,t:0};byTicker[e.ticker].t++;if(e.correct)byTicker[e.ticker].c++});
  var topTickers=Object.entries(byTicker).sort(function(a,b){return b[1].t-a[1].t}).slice(0,3).map(function(x){return'<a class="ticker-a" href="'+tickerHref(x[0])+'" target="_blank">'+x[0]+'</a> '+Math.round((x[1].c/x[1].t)*100)+'%'}).join(' \u00b7 ')||'&mdash;';
  var streak=0,streakType=null;
  for(var i=log.length-1;i>=0;i--){if(streakType===null)streakType=log[i].correct;if(log[i].correct===streakType)streak++;else break}
  var streakLabel=streak>1?streak+' '+(streakType?'\u2713':'\u2717')+' streak':'&mdash;';
  var streakColor=streakType?'var(--green)':'var(--red)';
  var recent20=log.slice(-20);
  var pips=recent20.map(function(e){return'<div class="trend-pip" style="background:'+(e.correct?'var(--green)':'var(--red)')+'"></div>'}).join('');
  var recent8=[].concat(log).reverse().slice(0,8).map(function(e){
    var vColor=e.verdict==='UP'?'var(--green)':e.verdict==='DOWN'?'var(--red)':'var(--amber)';
    var rColor=e.correct?'var(--green)':'var(--red)';
    var t=new Date(e.ts).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',timeZone:'America/New_York'});
    return'<div class="track-log-item"><span class="tli-ticker"><a class="ticker-a" href="'+tickerHref(e.ticker)+'" target="_blank">'+e.ticker+'</a></span><span class="tli-verdict" style="color:'+vColor+'">'+e.verdict+'</span><span class="tli-result" style="color:'+rColor+'">'+(e.correct?'\u2713 RIGHT':'\u2717 WRONG')+'</span><span class="tli-time">'+e.session+' '+t+' ET</span></div>';
  }).join('');
  body.innerHTML='<div class="track-rate"><span class="track-rate-num" style="color:'+rateColor+'">'+rate+'%</span><div><div class="track-rate-label">HIT RATE</div><div class="track-rate-count">'+correct+' right of '+total+' logged</div></div></div>'
    +'<div class="track-grid"><div class="track-stat"><span class="track-stat-lbl">\ud83d\udc4d UP</span><span class="track-stat-val">'+typeRate('UP')+'</span><span class="track-stat-sub">'+byType.UP.c+'/'+byType.UP.t+'</span></div><div class="track-stat"><span class="track-stat-lbl">\ud83d\udc4e DOWN</span><span class="track-stat-val">'+typeRate('DOWN')+'</span><span class="track-stat-sub">'+byType.DOWN.c+'/'+byType.DOWN.t+'</span></div><div class="track-stat"><span class="track-stat-lbl">HOLD</span><span class="track-stat-val">'+typeRate('FLAT')+'</span><span class="track-stat-sub">'+byType.FLAT.c+'/'+byType.FLAT.t+'</span></div></div>'
    +'<div style="display:flex;gap:16px;margin-bottom:10px;flex-wrap:wrap"><div><div class="track-stat-lbl">STREAK</div><div style="font-family:monospace;font-size:var(--fs-sm);font-weight:700;color:'+streakColor+'">'+streakLabel+'</div></div><div><div class="track-stat-lbl">TOP TICKERS</div><div style="font-family:monospace;font-size:var(--fs-sm)">'+topTickers+'</div></div></div>'
    +(recent20.length?'<div class="trend-bar"><span class="trend-bar-lbl">LAST '+recent20.length+'</span>'+pips+'</div>':'')
    +'<div class="track-log-title" style="margin-top:12px">RECENT TRADES</div>'+recent8;
}

window.logResult = logResult;
window.clearLog = clearLog;
