let API_URL = '';
let authH = function(){ return {}; };
let addSecret = function(url){ return url; };
const tickerCache = {};
// Only the RESOLVED result was ever memoized here — two callers asking for
// the same symbol microseconds apart (e.g. the visible cards hydrating
// while the Proxy Explorer or compact overflow list sweep the same
// watchlist) each fired their own /ticker/:symbol request instead of
// sharing one. Harmless before the Finnhub rate limiter existed; now it's
// real wasted call volume competing for the same 55/min budget, directly
// slowing down whichever of those views loads second. Track in-flight
// promises per symbol so concurrent callers await the same request.
const inFlight = {};

export function initTickerCache(config){
  API_URL = config.API_URL;
  authH = config.authH;
  addSecret = config.addSecret;
}

export async function fetchTickerData(symbol,force){
  if(tickerCache[symbol]&&!force)return tickerCache[symbol];
  if(inFlight[symbol]&&!force)return inFlight[symbol];
  var p=(async function(){
    try{
      var res=await fetch(addSecret(API_URL+'/ticker/'+symbol),{headers:authH()});
      var data=await res.json();
      tickerCache[symbol]=data;
      return data;
    }catch(e){return null}
    finally{delete inFlight[symbol];}
  })();
  inFlight[symbol]=p;
  return p;
}
