import { watchlist, setWatchlist } from './watchlist.js?v=33';

// Syncs the watchlist to the account via GET/POST /watchlist (server.js —
// gated on being signed in, any tier, so it also covers a lapsed paid
// subscriber whose tier fell back to free but who still has an account).
// Every tier decides for itself whether to call initWatchlistSync() at all
// — anonymous free visitors never do, so this stays fully inert for them.
interface WatchlistSyncConfig {
  API_URL: string;
  authH: () => Record<string, string>;
  addSecret: (url: string) => string;
}

let cfg: WatchlistSyncConfig | null = null;
let pulling = false; // suppresses the push a pull's own setWatchlist() would otherwise trigger

export function initWatchlistSync(config: WatchlistSyncConfig): void { cfg = config; }

// Called once, right after a session is confirmed valid, before the tier's
// own initApp()/renderWatchlist() runs — so the synced list is in place
// before the first paint instead of flashing the local/default one first.
//
// Retries on a network error or non-2xx response (Render's free tier can
// take the first request after inactivity to fail outright while the
// service cold-starts) — a single silent failure here used to just leave
// whatever local state initWatchlist() already set (tier defaults, or a
// stale earlier list) on screen with no indication anything was wrong and
// no second chance to get the real data. `cache:'no-store'` rules out a
// stale cached response being served for what should always be a fresh
// read. A genuinely successful response (even an empty one) is NOT
// retried — that's real data, not a failure.
var PULL_RETRY_DELAYS_MS = [0, 1500, 4000];
export async function pullWatchlistFromServer(): Promise<void> {
  if(!cfg)return;
  var data: { tickers?: string[] } | null = null;
  for(var i=0;i<PULL_RETRY_DELAYS_MS.length&&!data;i++){
    if(PULL_RETRY_DELAYS_MS[i])await new Promise(function(r){setTimeout(r,PULL_RETRY_DELAYS_MS[i]);});
    try{
      var res=await fetch(cfg.addSecret(cfg.API_URL+'/watchlist'),{headers:cfg.authH(),cache:'no-store'});
      if(res.ok)data=await res.json();
    }catch(e){}
  }
  if(data){
    if(data.tickers&&data.tickers.length){
      pulling=true;
      setWatchlist(data.tickers);
      pulling=false;
    }else if(watchlist.length){
      // GET came back with nothing for this account. That's ambiguous — it
      // can mean a genuinely new account, but it can just as easily mean a
      // transient read failure, a race, or (formerly) an email-casing miss,
      // and the client can't tell those apart from here. Push what's
      // already local (tier defaults, or anything built before this login)
      // as a *seed* rather than a normal save: the server only inserts if
      // no row exists yet (see the `seed` handling in server.js's POST
      // /watchlist) so this can never stomp real saved data that GET simply
      // failed to find.
      pushWatchlistToServer(true);
    }
  }
}

var pushTimer: ReturnType<typeof setTimeout> | null = null;
// Debounced — swipe-deleting several tickers in a row, or a drag-reorder
// that fires saveWL() on every swap, shouldn't mean one POST per keystroke.
export function schedulePushWatchlist(): void {
  if(!cfg||pulling)return;
  if(pushTimer)clearTimeout(pushTimer);
  pushTimer=setTimeout(function(){pushWatchlistToServer(false);},1200);
}

async function pushWatchlistToServer(seed: boolean): Promise<void> {
  if(!cfg)return;
  try{
    await fetch(cfg.addSecret(cfg.API_URL+'/watchlist'),{method:'POST',headers:cfg.authH(),body:JSON.stringify({tickers:watchlist,seed:!!seed})});
  }catch(e){}
}
