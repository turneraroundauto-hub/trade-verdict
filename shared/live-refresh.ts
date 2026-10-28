// shared/live-refresh.ts — market-hours auto-refresh, no AI (Oct 28, 2026).
//
// Mr. T: refresh data as often as new data is available while the market is
// open. Two speeds, chosen with him:
//   1. Every LIVE_PRICE_MS: price / % change / pill color for the whole
//      watchlist from Tra's GET /prices (one batched Alpaca call server-side,
//      shared by every user), patched into the page without re-rendering a
//      card, so an open Analyst View or a swipe in progress is untouched.
//   2. Every tier window (Free 15 / Starter 5 / Pro 1 min, the server's own
//      per-tier cache): the tier's full card refresh -- the same path
//      pull-to-refresh uses -- for news, opening bars and gates.
// Only while the market is open and the page is visible. Nothing here ever
// calls /analyze.
//
// Bundler-only (like session.ts / dial-audit.ts): no raw-browser consumer,
// so no ?v= cache-bust string.

export interface LivePrice { price: number; pct: number | null }

export interface LiveRefreshConfig {
  API_URL: string;
  authH: () => Record<string, string>;
  addSecret: (url: string) => string;
  isMarketClosed: () => boolean;
  getSymbols: () => string[];
  applyPrices: (prices: Record<string, LivePrice>) => void;
  fullRefresh: () => Promise<void>;
  fullRefreshMs: number;
}

export const LIVE_PRICE_MS = 60 * 1000;

let cfg: LiveRefreshConfig | null = null;
let lastFull = Date.now();
let busy = false;

async function pollPrices(): Promise<Record<string, LivePrice> | null> {
  if (!cfg) return null;
  const syms = cfg.getSymbols().filter((s) => /^[A-Z]{1,5}(\.[A-Z])?$/.test(s)).slice(0, 60);
  if (!syms.length) return null;
  try {
    const r = await fetch(cfg.addSecret(cfg.API_URL + '/prices?symbols=' + syms.join(',')), { headers: cfg.authH() });
    if (!r.ok) return null;
    const d = await r.json();
    if (d && d.marketOpen && d.prices && Object.keys(d.prices).length) { cfg.applyPrices(d.prices); return d.prices; }
  } catch (e) { }
  return null;
}

async function tick(): Promise<void> {
  if (!cfg || busy) return;
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  if (cfg.isMarketClosed()) return;
  busy = true;
  try {
    const prices = await pollPrices();
    if (Date.now() - lastFull >= cfg.fullRefreshMs) {
      lastFull = Date.now();
      await cfg.fullRefresh();
      // The full card data can be up to a cache window old; put the newer
      // live price back on top so the shown price never steps backwards.
      if (prices) cfg.applyPrices(prices);
    }
  } finally { busy = false; }
}

export function startLiveRefresh(config: LiveRefreshConfig): void {
  cfg = config;
  lastFull = Date.now();
  setInterval(tick, LIVE_PRICE_MS);
  // Coming back to the app (phone unlocked, tab re-focused): catch up now
  // rather than waiting out the rest of the minute.
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') tick(); });
}

// Updates a card's price text and up/down color in place -- no re-render,
// so open sections and in-flight analysis on the card are left alone.
export function patchCardPriceDom(card: Element | null, price: number, dir: string): void {
  if (!card) return;
  const p = card.querySelector('.ticker-price') as HTMLElement | null;
  if (p) { p.textContent = '$' + price.toFixed(2); p.className = 'ticker-price ' + dir; }
  const s = card.querySelector('.ticker-sym') as HTMLElement | null;
  if (s) s.className = 'ticker-sym ' + dir;
}

// Applies one live price to a ticker's cached data in place. Returns true
// when the shown value actually changed, so the tier only repaints those.
export function patchTickerPrice(td: any, lp: LivePrice): boolean {
  if (!td || !td.metrics || !lp || !(lp.price > 0)) return false;
  const changed = td.metrics.price !== lp.price || (lp.pct != null && td.metrics.pct !== lp.pct);
  td.metrics.price = lp.price;
  if (lp.pct != null) td.metrics.pct = lp.pct;
  return changed;
}
