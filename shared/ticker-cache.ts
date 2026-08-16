import type { TickerData } from './types.js';

let API_URL = '';
let authH: () => Record<string, string> = () => ({});
let addSecret: (url: string) => string = (url) => url;
const tickerCache: Record<string, TickerData> = {};
// Only the RESOLVED result was ever memoized here — two callers asking for
// the same symbol microseconds apart (e.g. the visible cards hydrating
// while the Proxy Explorer or compact overflow list sweep the same
// watchlist) each fired their own /ticker/:symbol request instead of
// sharing one. Harmless before the Finnhub rate limiter existed; now it's
// real wasted call volume competing for the same 55/min budget, directly
// slowing down whichever of those views loads second. Track in-flight
// promises per symbol so concurrent callers await the same request.
const inFlight: Record<string, Promise<TickerData | null>> = {};

export interface TickerCacheConfig {
  API_URL: string;
  authH: () => Record<string, string>;
  addSecret: (url: string) => string;
}

export function initTickerCache(config: TickerCacheConfig): void {
  API_URL = config.API_URL;
  authH = config.authH;
  addSecret = config.addSecret;
}

export async function fetchTickerData(symbol: string, force?: boolean): Promise<TickerData | null> {
  if(tickerCache[symbol] && !force) return tickerCache[symbol];
  if(inFlight[symbol] && !force) return inFlight[symbol];
  const p: Promise<TickerData | null> = (async () => {
    try{
      const res = await fetch(addSecret(API_URL + '/ticker/' + symbol), { headers: authH() });
      const data = await res.json();
      tickerCache[symbol] = data;
      return data;
    }catch(e){ return null; }
    finally{ delete inFlight[symbol]; }
  })();
  inFlight[symbol] = p;
  return p;
}
