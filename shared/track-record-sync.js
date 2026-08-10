import { getAccuracyLog, replaceLog } from './track-record.js?v=10';

// Syncs the track record to the account via GET/POST /track (server.js —
// gated on being signed in, Pro only for now: only pro/app.js calls
// initTrackRecordSync(). Free/Starter/Shark never do, so this stays fully
// inert for them, same as watchlist sync stays inert for anonymous free
// visitors.
let cfg=null;
let pulling=false; // suppresses the push a pull's own replaceLog() would otherwise trigger

export function initTrackRecordSync(config){cfg=config;}

// Called once, right after a session is confirmed valid, before the tier's
// own initApp()/renderTrackRecord() runs — same ordering as
// pullWatchlistFromServer(), and for the same reason: the synced log
// should be in place before the first paint instead of flashing the local
// one first.
var PULL_RETRY_DELAYS_MS=[0,1500,4000];
export async function pullTrackRecordFromServer(){
  if(!cfg)return;
  var data=null;
  for(var i=0;i<PULL_RETRY_DELAYS_MS.length&&!data;i++){
    if(PULL_RETRY_DELAYS_MS[i])await new Promise(function(r){setTimeout(r,PULL_RETRY_DELAYS_MS[i]);});
    try{
      var res=await fetch(cfg.addSecret(cfg.API_URL+'/track'),{headers:cfg.authH(),cache:'no-store'});
      if(res.ok)data=await res.json();
    }catch(e){}
  }
  if(data){
    if(data.entries&&data.entries.length){
      pulling=true;
      replaceLog(data.entries);
      pulling=false;
    }else if(getAccuracyLog().length){
      // Same seed logic as pullWatchlistFromServer(): a GET miss here is
      // ambiguous (new account vs. transient failure vs. race), so push
      // what's already local as a seed rather than a normal save — the
      // server only inserts if no row exists yet (see the `seed` handling
      // in server.js's POST /track), so this can never stomp real saved
      // data that GET simply failed to find.
      pushTrackRecordToServer(true);
    }
  }
}

var pushTimer=null;
// Debounced — logging several results in a row shouldn't mean one POST
// per tap.
export function schedulePushTrackRecord(){
  if(!cfg||pulling)return;
  clearTimeout(pushTimer);
  pushTimer=setTimeout(function(){pushTrackRecordToServer(false);},1200);
}

async function pushTrackRecordToServer(seed){
  if(!cfg)return;
  try{
    await fetch(cfg.addSecret(cfg.API_URL+'/track'),{method:'POST',headers:cfg.authH(),body:JSON.stringify({entries:getAccuracyLog(),seed:!!seed})});
  }catch(e){}
}
