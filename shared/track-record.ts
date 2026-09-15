import { tickerHref } from './prefs.js?v=11';

interface TrackEntry {
  ticker: string;
  verdict: string;
  correct: boolean;
  ts: string;
  session: string;
  trigger?: string;
}

interface LogMeta {
  trigger?: string;
}

var LOG_KEY='tv_accuracy_log';
function getLog(): TrackEntry[] {try{return JSON.parse(localStorage.getItem(LOG_KEY)||'[]')}catch(e){return[]}}
let saveHook: (() => void) | null = null;
export function onLogSave(cb: () => void): void {saveHook=cb;}
function saveLog(log: TrackEntry[]): void {localStorage.setItem(LOG_KEY,JSON.stringify(log));if(saveHook)saveHook();}

export function logResult(ticker: string, verdict: string, correct: boolean, rowEl: HTMLElement, meta?: LogMeta): void {
  var log=getLog();
  var entry: TrackEntry = {ticker:ticker,verdict:verdict,correct:correct,ts:new Date().toISOString(),
    session:new Date().toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',timeZone:'America/New_York'})};
  if(meta&&meta.trigger)entry.trigger=meta.trigger;
  log.push(entry);
  if(log.length>200)log=log.slice(-200);
  saveLog(log);
  var color=correct?'var(--green)':'var(--red)';
  var label=correct?'✓ LOGGED RIGHT':'✗ LOGGED WRONG';
  rowEl.innerHTML='<span class="log-recorded" style="color:'+color+';background:'+color+'11;border:1px solid '+color+'44">'+label+'</span>';
  renderTrackRecord();
}

export function clearLog(): void {if(!confirm('Clear all logged trades?'))return;saveLog([]);renderTrackRecord()}

// Overwrites the log wholesale — used to hydrate from the server on login
// (shared/track-record-sync.js), same role setWatchlist() plays for the
// watchlist. Not used by any local mutation path.
export function replaceLog(entries: TrackEntry[]): void {saveLog(entries);renderTrackRecord()}

// Raw log entries, newest-last — used by tiers that build extra analytics
// (e.g. Pro's gate-attribution breakdown) on top of the same tv_accuracy_log
// this module already owns, without duplicating the localStorage read/parse.
export function getAccuracyLog(): TrackEntry[] {return getLog();}

// Distilled Aug/Sep-2026 "Unified Stack" merge (CLAUDE.md, "Verdict
// Record — Scorecard + Track Record consolidation"): this card no longer
// stands alone next to a separate Scorecard card, so the hit-rate number,
// UP/DOWN/HOLD tally, and personal Top Tickers list were dropped as
// redundant with the pooled Scorecard stats now sitting right above this
// in the same card body. What's left is the one thing the pooled side
// can't show -- your own streak and your own recent calls -- trimmed to
// the last 3 with the rest tucked behind a "view full log" toggle (same
// expand-btn/arrow pattern already used for Analyst View) rather than a
// second full list competing with the pooled section for space.
export function renderTrackRecord(): void {
  var log=getLog();
  var body=document.getElementById('track-body');if(!body)return;
  if(!log.length){body.innerHTML='<div class="track-empty">No trades logged yet.<br>After each verdict tap ✓ RIGHT or ✗ WRONG.</div>';return}
  var streak=0,streakType: boolean | null=null;
  for(var i=log.length-1;i>=0;i--){if(streakType===null)streakType=log[i].correct;if(log[i].correct===streakType)streak++;else break}
  var streakLabel=streak>1?streak+' '+(streakType?'✓':'✗')+' streak':'&mdash;';
  var streakColor=streakType?'var(--green)':'var(--red)';
  var pips=log.slice(-5).map(function(e){return'<div class="trend-pip" style="background:'+(e.correct?'var(--green)':'var(--red)')+'"></div>'}).join('');
  var tradeRow=function(e: TrackEntry){
    var vColor=e.verdict==='UP'?'var(--green)':e.verdict==='DOWN'?'var(--red)':'var(--amber)';
    var rColor=e.correct?'var(--green)':'var(--red)';
    var t=new Date(e.ts).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',timeZone:'America/New_York'});
    return'<div class="track-log-item"><span class="tli-ticker"><a class="ticker-a" href="'+tickerHref(e.ticker)+'" target="_blank">'+e.ticker+'</a></span><span class="tli-verdict" style="color:'+vColor+'">'+e.verdict+'</span><span class="tli-result" style="color:'+rColor+'">'+(e.correct?'✓ RIGHT':'✗ WRONG')+'</span><span class="tli-time">'+e.session+' '+t+' ET</span></div>';
  };
  var reversed=([] as TrackEntry[]).concat(log).reverse();
  var visibleRows=reversed.slice(0,3).map(tradeRow).join('');
  var extra=reversed.slice(3,8);
  var extraHTML=extra.length
    ?'<button type="button" class="expand-btn" id="trackLogMoreBtn"><span>VIEW FULL LOG ('+log.length+')</span><span class="analyst-arrow" id="trackLogMoreArrow">▼</span></button>'
      +'<div id="trackLogMoreBody" style="display:none">'+extra.map(tradeRow).join('')+'</div>'
    :'';
  body.innerHTML='<div class="record-streak-row"><span class="track-stat-lbl" style="margin:0">STREAK</span><span style="font-family:var(--mono);font-size:13px;font-weight:700;color:'+streakColor+'">'+streakLabel+'</span><span class="trend-bar" style="margin:0 0 0 auto">'+pips+'</span></div>'
    +visibleRows+extraHTML;
  var moreBtn=document.getElementById('trackLogMoreBtn');
  if(moreBtn)moreBtn.addEventListener('click',function(){
    var b=document.getElementById('trackLogMoreBody'),a=document.getElementById('trackLogMoreArrow');
    if(!b)return;
    var open=b.style.display==='none';
    b.style.display=open?'block':'none';
    if(a)a.textContent=open?'▲':'▼';
  });
}

declare global {
  interface Window {
    logResult: typeof logResult;
    clearLog: typeof clearLog;
  }
}
window.logResult = logResult;
window.clearLog = clearLog;
