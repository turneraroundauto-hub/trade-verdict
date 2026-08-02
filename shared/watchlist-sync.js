import { watchlist, setWatchlist } from './watchlist.js?v=8';

// Syncs the watchlist to the account via GET/POST /watchlist (server.js —
// gated on being signed in, any tier, so it also covers a lapsed paid
// subscriber whose tier fell back to free but who still has an account).
// Every tier decides for itself whether to call initWatchlistSync() at all
// — anonymous free visitors never do, so this stays fully inert for them.
let cfg=null;
let pulling=false; // suppresses the push a pull's own setWatchlist() would otherwise trigger

export function initWatchlistSync(config){cfg=config;}

// Called once, right after a session is confirmed valid, before the tier's
// own initApp()/renderWatchlist() runs — so the synced list is in place
// before the first paint instead of flashing the local/default one first.
export async function pullWatchlistFromServer(){
  if(!cfg)return;
  try{
    var res=await fetch(cfg.addSecret(cfg.API_URL+'/watchlist'),{headers:cfg.authH()});
    if(!res.ok)return;
    var data=await res.json();
    if(data.tickers&&data.tickers.length){
      pulling=true;
      setWatchlist(data.tickers);
      pulling=false;
    }else if(watchlist.length){
      // Nothing saved for this account yet — seed the server with whatever
      // is already local (tier defaults, or anything built before this
      // login) instead of starting from an empty cloud copy.
      pushWatchlistToServer();
    }
  }catch(e){}
}

var pushTimer=null;
// Debounced — swipe-deleting several tickers in a row, or a drag-reorder
// that fires saveWL() on every swap, shouldn't mean one POST per keystroke.
export function schedulePushWatchlist(){
  if(!cfg||pulling)return;
  clearTimeout(pushTimer);
  pushTimer=setTimeout(pushWatchlistToServer,1200);
}

async function pushWatchlistToServer(){
  if(!cfg)return;
  try{
    await fetch(cfg.addSecret(cfg.API_URL+'/watchlist'),{method:'POST',headers:cfg.authH(),body:JSON.stringify({tickers:watchlist})});
  }catch(e){}
}
