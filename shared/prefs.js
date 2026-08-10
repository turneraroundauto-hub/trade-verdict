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
//
// newsHref() is optional, used only for the news-headline link (see
// newsHref() below) — sites with a dedicated per-ticker news page (Yahoo,
// TradingView) or a real news search (Google, via news.google.com rather
// than a plain web search) get one; sites with no distinct news route
// (StockTwits' symbol page is already a live stream, Robinhood has no
// public news URL) fall back to href().
//
// robinhood.com/stocks/X is a real, public page (no login needed to view
// it) that also happens to register as a universal link — tapping it on
// a phone with the Robinhood app installed opens the app directly,
// browser otherwise. That's standard iOS/Android behavior tied to the
// domain, not anything this app has to implement.
export const LINK_SITES = {
  yahoo: {
    label: 'Yahoo Finance',
    href: function(t){ return 'https://finance.yahoo.com/quote/' + encodeURIComponent(t); },
    newsHref: function(t){ return 'https://finance.yahoo.com/quote/' + encodeURIComponent(t) + '/news/'; },
  },
  tradingview: {
    label: 'TradingView',
    href: function(t){ return 'https://www.tradingview.com/symbols/' + encodeURIComponent(t.replace('-USD','USD')) + '/'; },
    newsHref: function(t){ return 'https://www.tradingview.com/symbols/' + encodeURIComponent(t.replace('-USD','USD')) + '/news/'; },
  },
  stocktwits: {
    label: 'StockTwits',
    href: function(t){ return 'https://stocktwits.com/symbol/' + encodeURIComponent(t.replace('-USD','.X')); },
  },
  google: {
    label: 'Google Finance',
    href: function(t){ return 'https://www.google.com/search?q=' + encodeURIComponent(t.replace('-USD',' USD') + ' stock'); },
    newsHref: function(t){ return 'https://news.google.com/search?q=' + encodeURIComponent(t.replace('-USD',' USD') + ' stock'); },
  },
  robinhood: {
    label: 'Robinhood',
    href: function(t){ return 'https://robinhood.com/stocks/' + encodeURIComponent(t.replace('-USD','')); },
  },
  custom: {
    label: 'Custom link…',
    href: function(t){ return customTemplateHref(t); },
  },
};

const CUSTOM_TEMPLATE_KEY = 'tv_link_custom_template';

// Only http(s) with a ticker placeholder is accepted — this is user-typed
// text rendered straight into an href, so a stray javascript: paste can't
// turn into a self-XSS, and a template with nowhere to put the ticker
// would just link every symbol to the same dead page.
export function isValidCustomTemplate(template){
  var t = (template || '').trim();
  if(!/^https?:\/\//i.test(t)) return false;
  if(!/\{ticker\}/i.test(t)) return false;
  return true;
}

// Turns a real example (a ticker + the URL you land on viewing that one
// stock) into a template automatically, so a user never has to know
// {TICKER} syntax exists. Finds the ticker as a whole token (not a
// substring of something else — matters for short tickers like "GE")
// and swaps it for {TICKER} or {ticker} matching whichever case it
// actually appeared in, since sites are inconsistent (Yahoo: AAPL,
// Webull: aapl). Every occurrence is swapped, not just the first, in
// case a site repeats the ticker in the URL. Returns null if the ticker
// isn't found anywhere in the URL, so the caller can show a clear error
// instead of silently saving a template with nowhere to substitute.
export function buildTemplateFromExample(exampleUrl, exampleTicker){
  var url = (exampleUrl || '').trim();
  var ticker = (exampleTicker || '').trim();
  if(!ticker || !/^https?:\/\//i.test(url)) return null;
  var escaped = ticker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  var re = new RegExp('(^|[^A-Za-z0-9])(' + escaped + ')(?=[^A-Za-z0-9]|$)', 'gi');
  var found = false;
  var result = url.replace(re, function(_match, boundary, matched){
    found = true;
    var placeholder = matched === matched.toUpperCase() ? '{TICKER}' : '{ticker}';
    return boundary + placeholder;
  });
  return found ? result : null;
}

// Words that show up in stock-site URLs but are never themselves the
// ticker — path segments like "quote"/"stocks"/"symbol" and exchange
// names, which would otherwise pass the plain shape check below (short,
// letters-only) and get picked as a false-positive ticker.
const URL_NON_TICKER_WORDS = new Set(['quote','quotes','stock','stocks','symbol','symbols','news','chart','charts','charting',
  'market','markets','markt','investing','finance','financials','company','overview','summary','profile','research',
  'www','com','us','en','html','htm','index',
  'nasdaq','nyse','amex','otc','otcmkts','arca','bats','cboe']);

function looksLikeTicker(s){
  return /^[A-Za-z]{1,5}(\.[A-Za-z]{1,2})?$/.test(s);
}

// Guesses the ticker straight out of a real example URL, so the user
// only has to paste one thing. Scans path segments from the end first
// (site URLs almost always put the ticker last: /quote/AAPL,
// /stocks/AAPL, /symbols/AAPL/news/), falling back to splitting on
// hyphens for patterns like Webull's /quote/nasdaq-aapl, then to a
// handful of common query-string params (?symbol=NASDAQ:AAPL and
// similar) for chart-style URLs. Returns null, not a bad guess, when
// nothing plausible turns up — the caller falls back to asking the user
// to type the ticker rather than silently building a broken template.
export function detectTickerInUrl(rawUrl){
  var url;
  try { url = new URL((rawUrl || '').trim()); } catch(e){ return null; }
  var segments = url.pathname.split('/').filter(Boolean);
  for (var i = segments.length - 1; i >= 0; i--) {
    var seg;
    try { seg = decodeURIComponent(segments[i]); } catch(e){ seg = segments[i]; }
    if (looksLikeTicker(seg) && !URL_NON_TICKER_WORDS.has(seg.toLowerCase())) return seg;
    if (seg.indexOf('-') !== -1) {
      var parts = seg.split('-');
      for (var j = parts.length - 1; j >= 0; j--) {
        if (looksLikeTicker(parts[j]) && !URL_NON_TICKER_WORDS.has(parts[j].toLowerCase())) return parts[j];
      }
    }
  }
  var queryKeys = ['symbol', 'ticker', 'q', 's'];
  for (var k = 0; k < queryKeys.length; k++) {
    var v = url.searchParams.get(queryKeys[k]);
    if (!v) continue;
    var last = v.indexOf(':') !== -1 ? v.split(':').pop() : v;
    if (looksLikeTicker(last)) return last;
  }
  return null;
}

export function getCustomTemplate(){
  return localStorage.getItem(CUSTOM_TEMPLATE_KEY) || '';
}

export function setCustomTemplate(template){
  if(forced) return false;
  var t = (template || '').trim();
  if(!isValidCustomTemplate(t)) return false;
  localStorage.setItem(CUSTOM_TEMPLATE_KEY, t);
  listeners.forEach(function(cb){cb();});
  return true;
}

// Falls back to Yahoo (never a dead link) if no valid template is saved —
// same fail-safe posture as every other outbound link in this app.
function customTemplateHref(t){
  var template = getCustomTemplate();
  if(!isValidCustomTemplate(template)) return LINK_SITES.yahoo.href(t);
  return template.replace(/\{TICKER\}/g, encodeURIComponent(t.toUpperCase()))
                  .replace(/\{ticker\}/g, encodeURIComponent(t.toLowerCase()));
}

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

// The news-headline link uses this instead of the specific article URL
// Finnhub/Alpaca returned — it always goes to the user's preferred site's
// coverage of that ticker (its dedicated news page where the site has
// one), not an attempt to reconstruct the exact same story elsewhere.
// Finnhub/Alpaca still drive the headline text/age/source shown on the
// card itself; this only changes where tapping it goes. A user whose
// preferred site happens to be the same outlet the headline came from
// (e.g. a Seeking Alpha subscriber picking "Custom" -> seekingalpha.com)
// gets exactly that article's site, which is the point.
export function newsHref(t){
  var site = LINK_SITES[getLinkSitePref()];
  return (site.newsHref || site.href)(t);
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
