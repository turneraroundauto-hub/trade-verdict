// Display-only user preferences — timezone shown on timestamps, and which
// external site ticker symbols link out to. Plain localStorage, no server
// sync: unlike watchlist/track-record these aren't account data, just how
// the current browser renders things, so there's nothing to reconcile
// across devices.

export const TIMEZONES = {
  ET: { label: 'ET (Eastern)', iana: 'America/New_York' },
  CT: { label: 'CT (Central)', iana: 'America/Chicago' },
  MT: { label: 'MT (Mountain)', iana: 'America/Denver' },
  PT: { label: 'PT (Pacific)', iana: 'America/Los_Angeles' },
};

// href() takes the symbol as it appears in the watchlist/UI (e.g. 'AAPL',
// or 'BTC-USD' for the header's crypto tile) and returns the outbound link
// for that site. Google Finance quote pages require an exchange suffix
// (AAPL:NASDAQ) that this app has no reliable way to know per-symbol, so
// that option routes through a Google search instead of a direct quote
// page — always resolves, never a broken link.
export const LINK_SITES = {
  yahoo: {
    label: 'Yahoo Finance',
    href: function(t){ return 'https://finance.yahoo.com/quote/' + encodeURIComponent(t); },
  },
  tradingview: {
    label: 'TradingView',
    href: function(t){ return 'https://www.tradingview.com/symbols/' + encodeURIComponent(t.replace('-USD','USD')) + '/'; },
  },
  stocktwits: {
    label: 'StockTwits',
    href: function(t){ return 'https://stocktwits.com/symbol/' + encodeURIComponent(t.replace('-USD','.X')); },
  },
  google: {
    label: 'Google Finance',
    href: function(t){ return 'https://www.google.com/search?q=' + encodeURIComponent(t.replace('-USD',' USD') + ' stock'); },
  },
};

const TZ_KEY = 'tv_tz_pref';
const LINK_KEY = 'tv_link_site_pref';
const listeners = [];

// Free has no Settings UI and always shows ET / Yahoo Finance — but
// localStorage is shared across every tier on the same origin, so without
// this a Free visitor who'd previously set MT/TradingView on Starter or
// Pro (same browser, same domain) would silently inherit it on Free too.
// Free's app.js calls this once at startup to pin both prefs to their
// defaults regardless of what's in storage; Starter/Pro never call it.
let forced = false;
export function forceDefaults(){ forced = true; }

export function getTzPref(){
  if(forced) return 'ET';
  var v = localStorage.getItem(TZ_KEY);
  return TIMEZONES[v] ? v : 'ET';
}
export function setTzPref(tz){
  if(forced || !TIMEZONES[tz])return;
  localStorage.setItem(TZ_KEY, tz);
  listeners.forEach(function(cb){cb();});
}
export function getTzIana(){ return TIMEZONES[getTzPref()].iana; }

export function getLinkSitePref(){
  if(forced) return 'yahoo';
  var v = localStorage.getItem(LINK_KEY);
  return LINK_SITES[v] ? v : 'yahoo';
}
export function setLinkSitePref(site){
  if(forced || !LINK_SITES[site])return;
  localStorage.setItem(LINK_KEY, site);
  listeners.forEach(function(cb){cb();});
}

// Every ticker symbol displayed anywhere links out via this one function —
// it's the single source of truth other modules used to each duplicate
// their own copy of (shared/watchlist.js, shared/track-record.js,
// pro/app.js all had byte-identical hardcoded-to-Yahoo versions).
export function tickerHref(t){
  return LINK_SITES[getLinkSitePref()].href(t);
}

// Fires after either preference changes. Callers re-render whatever they
// own (watchlist cards, track record, the market timestamp, the clock)
// rather than this module trying to know about every consumer.
export function onPrefsChange(cb){ listeners.push(cb); }

// Rewrites every already-rendered ticker-symbol anchor that carries a
// data-ticker attribute — used for the header's static SPY/QQQ/BTC/etc.
// sector-cell links, which are plain HTML (not re-rendered by any JS on a
// pref change the way watchlist cards and the track record log are).
// The literal Yahoo Finance href baked into that HTML stays as a working
// fallback if this never runs (e.g. a caching bug), same fail-safe posture
// as the rest of this app's third-party integrations.
export function refreshTickerLinks(root){
  (root || document).querySelectorAll('a[data-ticker]').forEach(function(a){
    a.href = tickerHref(a.dataset.ticker);
  });
}
