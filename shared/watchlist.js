import { fetchTickerData, lookupSymbol } from './ticker-cache.js?v=6';
import { tickerHref, newsHref } from './prefs.js?v=11';
import { highlightContextMatches } from './context-highlight.js?v=2';
export let watchlist = [];
let maxTickers = 3;
let upgradeMessage = '';
let gesturesBound = false;
// Pro-only card/watchlist split: when set, renderWatchlist() only renders
// the first N tickers as full `.card-wrap` cards (into #watchlist) instead
// of the whole list — everything past that stays out of the DOM here. Other
// tiers never call setRenderScope(), so renderScope stays null and every
// existing render/gesture/undo code path below is byte-for-byte unchanged
// for them (list = watchlist, same as before this was added).
let renderScope = null;
let postRenderHook = null;
export function setRenderScope(n) { renderScope = n; }
export function getOverflow() { return renderScope != null ? watchlist.slice(renderScope) : []; }
// Fires at the end of every renderWatchlist() call, from any trigger (add,
// remove, undo, setWatchlist, drag-reorder does NOT call this since it
// mutates the DOM directly without a full re-render). Lets a tier that owns
// a second list view (Pro's compact overflow rows) stay in sync without
// needing to know every internal call site that can change `watchlist`.
export function onRenderWatchlist(cb) { postRenderHook = cb; }
// Resolves once the CURRENT renderWatchlist() call's card hydration has
// finished. Was previously not awaited at all: renderWatchlist() fired
// hydrateCards() and called postRenderHook() (Pro's compact overflow list)
// in the same tick, so the overflow list's fetches for tickers 16+ started
// racing the card window's own fetches for the same shared, rate-limited
// backend queues instead of waiting their turn — the top 15 tickers users
// actually look at first were competing with everything past them for the
// same Finnhub/SEC throttle budget. cardsReady() lets anything else that
// wants watchlist data (PRE, Heat Map) wait for the card window to actually
// finish before firing its own fetches, on top of renderWatchlist() itself
// now sequencing hydration before the compact-list hook below.
let cardsReadyPromise = new Promise(function (res) { });
export function cardsReady() { return cardsReadyPromise; }
// Fires from saveWL() itself — every mutation path (add, remove, undo,
// setWatchlist, AND drag-reorder's swapTickers, which calls saveWL()
// directly without a full renderWatchlist()) goes through here, so this is
// the one reliable hook point for "the watchlist changed, go persist it
// somewhere else too" (used for server-side sync — see
// shared/watchlist-sync.js). Tiers that never register one pay nothing.
let saveHook = null;
export function onWatchlistSave(cb) { saveHook = cb; }
// Fires once at the end of a SUCCESSFUL addTickers() call only -- not from
// removeTicker()/setWatchlist(), which already have their own separate UI
// treatment (the undo toast, a silent sync pull). New tickers always land
// at watchlist[0] (see addTickers()'s own unshift), so a tier wiring this
// to its Rolodex mechanics only ever needs to jump to index 0 -- no need
// to pass which ticker was added. Fires after saveWL()/renderWatchlist()
// have already run, so the DOM a Rolodex jump depends on is guaranteed to
// exist by the time this callback runs.
let addedHook = null;
export function onTickersAdded(cb) { addedHook = cb; }
export function initWatchlist(config) {
    maxTickers = config.maxTickers;
    upgradeMessage = config.upgradeMessage;
    var _wl = JSON.parse(localStorage.getItem('tv_wl') || JSON.stringify(config.defaultTickers));
    if (_wl.length > maxTickers)
        _wl = _wl.slice(0, maxTickers);
    watchlist = _wl;
    bindGestures();
}
function saveWL() {
    localStorage.setItem('tv_wl', JSON.stringify(watchlist));
    var countEl = document.getElementById('ticker-count');
    if (countEl)
        countEl.textContent = 'CRF · ' + watchlist.length + ' TICKERS';
    if (saveHook)
        saveHook();
}
// Replaces the whole watchlist at once (import, presets) — same
// validate/dedupe/cap rules as addTickers(), just wholesale instead of
// additive. Returns the tickers that were dropped for being invalid or
// over the tier cap, so the caller can tell the user what didn't make it.
export function setWatchlist(tickers) {
    var clean = [], dropped = [];
    tickers.forEach(function (t) {
        var u = String(t).toUpperCase().trim();
        if (/^[A-Z]{1,6}$/.test(u)) {
            if (!clean.includes(u))
                clean.push(u);
        }
        else if (u)
            dropped.push(u);
    });
    if (clean.length > maxTickers) {
        dropped = dropped.concat(clean.slice(maxTickers));
        clean = clean.slice(0, maxTickers);
    }
    // A non-empty input that filtered down to nothing is a data problem, not
    // an intentional "clear my watchlist" — refuse to wipe the current list
    // to empty over it (the sync feature can call this with untrusted
    // server data; a malformed row shouldn't silently blank a user's whole
    // watchlist). An explicitly empty `tickers` array IS honored — that's
    // the one legitimate way to end up with clean.length===0 here.
    if (tickers.length && !clean.length) {
        console.error('setWatchlist: all ' + tickers.length + ' provided ticker(s) failed validation, keeping existing watchlist unchanged:', tickers);
        return dropped;
    }
    watchlist = clean;
    saveWL();
    renderWatchlist();
    return dropped;
}
// Splits raw Import text into candidate entries on comma/semicolon/pipe/
// newline only -- NOT bare whitespace, unlike the old parseTickers() this
// replaced -- so a multi-word company name ("Apple Inc") survives as one
// entry instead of being torn into separate word-tokens.
function splitEntries(raw) {
    return raw.replace(/[$#]/g, '').split(/[,;|\n]+/).map(function (s) { return s.trim(); }).filter(Boolean);
}
// A segment is treated as one or more LITERAL tickers -- no network lookup
// needed -- only when every whitespace-separated word in it is typed
// exactly the way this app's own placeholders show a real ticker: fully
// UPPERCASE, 1-6 letters, nothing else. That's what makes "AAPL, MSFT" (or
// a legacy space-separated run like "AAPL MSFT NVDA" on one line) resolve
// instantly with zero backend round trip. Anything typed in any other
// case -- "Tesla", "apple", "Nvidia Corp" -- comes back null here, telling
// the caller to send the whole segment to /lookup as one company-name
// candidate instead. This is a deliberate, simple rule, not a guess: type
// the literal ticker in caps (as every example in this app already shows
// them) to skip the lookup; type it any other way and it's resolved as a
// name. A typo'd all-caps non-ticker ("TESLA") is treated as a literal
// ticker attempt and will simply fail to find data downstream -- the same
// degrade path a mistyped ticker already had before this feature existed.
function literalTickersIn(segment) {
    var words = segment.split(/\s+/).filter(Boolean);
    if (!words.length)
        return null;
    return words.every(function (w) { return /^[A-Z]{1,6}$/.test(w); }) ? words : null;
}
// Re-renders every currently-rendered card's news line from already-
// cached ticker data — no new network calls. Used when Session Context
// changes: the news data itself hasn't changed, only which words in it
// should be highlighted. updateCardMeta() is a no-op for any ticker
// without a rendered card (e.g. Pro's compact-list overflow), so it's
// safe to sweep the whole watchlist rather than tracking which subset
// is actually on screen.
export function refreshNewsHighlights() {
    watchlist.forEach(function (t) {
        fetchTickerData(t).then(function (d) { if (d)
            updateCardMeta(t, d); });
    });
}
export function updateCardMeta(ticker, td) {
    var card = document.getElementById('card-' + ticker);
    if (!card)
        return;
    var priceEl = card.querySelector('.ticker-price');
    // td itself being non-null means the fetch succeeded — a symbol with no
    // usable metrics (e.g. VIX: Finnhub's /quote has no price for an index,
    // only regular equities) still gets a response, just with metrics:null.
    // That's a real "no data for this symbol" case, not a pending/failed
    // fetch, and needs to look different from the plain pre-fetch dash or it
    // reads as broken instead of as an answer.
    if (priceEl && td) {
        priceEl.textContent = td.metrics && td.metrics.price ? '$' + td.metrics.price.toFixed(2) : 'N/A';
    }
    var phaseEl = card.querySelector('.phase-strip');
    if (phaseEl && td && td.metrics) {
        var m = td.metrics;
        var rp = m.rangePosition !== null && m.rangePosition !== undefined ? m.rangePosition + '%' : '?';
        var ph = m.phaseProxy || '?';
        var phColor = ph === 'PHASE_3' ? 'var(--red)' : ph === 'PHASE_2' ? 'var(--amber)' : 'var(--green)';
        var betaStr = m.beta ? 'β' + m.beta.toFixed(1) : '?';
        var proxyName = td.proxyRule && td.proxyRule.proxy ? td.proxyRule.proxy.name : '';
        var proxyShort = proxyName.split('(')[0].trim();
        phaseEl.innerHTML = '<div class="phase-item"><span class="phase-lbl">52W</span><span class="phase-val">' + rp + '</span></div>'
            + '<div class="phase-item"><span class="phase-lbl">PHASE</span><span class="phase-val" style="color:' + phColor + '">' + ph.replace('PHASE_', '') + '</span></div>'
            + '<div class="phase-item"><span class="phase-lbl">β</span><span class="phase-val">' + betaStr + '</span></div>'
            + (proxyShort ? '<div class="phase-item"><span class="phase-lbl">PROXY</span><span class="phase-val" style="color:var(--blue);font-size:9px">' + proxyShort + '</span></div>' : '');
    }
    else if (phaseEl && td) {
        phaseEl.innerHTML = '<div class="phase-item"><span class="phase-val" style="color:var(--dim);font-size:9px">No market data for this symbol (index/unsupported ticker)</span></div>';
    }
    var newsEl = card.querySelector('.news-line');
    var news = td && td.news;
    if (newsEl) {
        if (news && news.ageHours <= 300) {
            newsEl.style.display = 'block';
            var ctxEl = document.getElementById('context-input');
            var headlineHtml = highlightContextMatches(news.headline, ctxEl ? ctxEl.value : '');
            newsEl.innerHTML = '<a href="' + newsHref(ticker) + '" target="_blank">' + headlineHtml + '</a><span class="news-age">' + news.ageLabel + '</span>';
        }
        else
            newsEl.style.display = 'none';
    }
}
export async function addTickers() {
    var input = document.getElementById('ticker-input');
    var raw = input.value;
    var entries = splitEntries(raw);
    if (!entries.length)
        return alert('No valid tickers or company names. Try: AAPL or Tesla');
    // Company-name entries need a real backend round trip (Tra's /lookup) to
    // resolve, so this is genuinely async now -- reuse the same
    // btn-running/runPulse "still working" treatment ANALYZE already uses,
    // rather than leaving the button looking inert during a real network
    // wait it never used to have.
    var importBtn = document.getElementById('importBtn');
    var importBtnLabel = importBtn ? importBtn.textContent : null;
    if (importBtn) {
        importBtn.disabled = true;
        importBtn.classList.add('btn-running');
        importBtn.textContent = 'ADDING…';
    }
    var resolved;
    try {
        // Promise.all preserves input order in its result array regardless of
        // which lookup resolves first -- required so newOnes below still lands
        // in the order the user actually typed things, same guarantee this
        // function has always made.
        resolved = await Promise.all(entries.map(async function (entry) {
            var literal = literalTickersIn(entry);
            if (literal)
                return { entry: entry, tickers: literal };
            var symbol = await lookupSymbol(entry);
            return { entry: entry, tickers: symbol ? [symbol] : [] };
        }));
    }
    finally {
        if (importBtn) {
            importBtn.disabled = false;
            importBtn.classList.remove('btn-running');
            importBtn.textContent = importBtnLabel || 'Import Tickers';
        }
    }
    var tickers = [];
    var unresolved = [];
    resolved.forEach(function (r) {
        if (r.tickers.length)
            tickers.push.apply(tickers, r.tickers);
        else
            unresolved.push(r.entry);
    });
    // A ticker and its own company name typed together ("AAPL, Apple") can
    // both resolve to the same symbol -- collapse to first occurrence before
    // treating anything as "new".
    tickers = tickers.filter(function (t, i) { return tickers.indexOf(t) === i; });
    if (!tickers.length)
        return alert(unresolved.length ? ("Couldn't find: " + unresolved.join(', ')) : 'No valid tickers or company names. Try: AAPL or Tesla');
    // New tickers land at the top, in the order typed -- unshift-per-item
    // would reverse that order (last processed ends up first), so collect
    // the actually-new ones first and prepend them as a block.
    var newOnes = tickers.filter(function (t) { return !watchlist.includes(t); });
    // Over a tier's hard cap (Free/Starter -- Pro's maxTickers is 999, so
    // this never fires there; its own overflow already renders in the
    // Watchlist accordion via cardWindow()/getOverflow(), untouched by this
    // block), new tickers still win -- they replace the OLDEST pills
    // (watchlist's own tail) instead of being silently refused the way this
    // used to hard-block on cap alone. The cap warning survives as a real
    // confirm/cancel prompt rather than a dead-end alert, so a user who
    // didn't mean to lose their oldest tickers can back out before anything
    // changes.
    if (newOnes.length && watchlist.length + newOnes.length > maxTickers) {
        var evictCount = watchlist.length + newOnes.length - maxTickers;
        var proceed = confirm(upgradeMessage + '\n\nAdding ' + (newOnes.length === 1 ? 'this ticker' : 'these tickers')
            + ' will remove your oldest ' + evictCount + ' ticker' + (evictCount === 1 ? '' : 's') + ' to make room. Continue?');
        if (!proceed) {
            if (unresolved.length)
                alert("Couldn't find: " + unresolved.join(', '));
            return;
        }
    }
    watchlist.unshift.apply(watchlist, newOnes);
    if (watchlist.length > maxTickers)
        watchlist = watchlist.slice(0, maxTickers);
    input.value = '';
    saveWL();
    renderWatchlist();
    tickers.forEach(function (t) { fetchTickerData(t).then(function (d) { if (d)
        updateCardMeta(t, d); }); });
    if (unresolved.length)
        alert("Couldn't find: " + unresolved.join(', '));
    // Fired after the unresolved-entries alert (if any) so a Rolodex jump's
    // scroll animation doesn't run underneath a blocking native dialog. A
    // newly-typed ticker always survives at watchlist[0] regardless of any
    // cap eviction above (unshift puts it first, slice keeps the front), so
    // this is safe whenever anything new was actually added.
    if (newOnes.length && addedHook)
        addedHook();
}
export function removeTicker(ticker) {
    var idx = watchlist.indexOf(ticker);
    if (idx === -1)
        return;
    watchlist = watchlist.filter(function (t) { return t !== ticker; });
    saveWL();
    renderWatchlist();
    showUndoToast(ticker, idx);
}
var undoTimer = null;
function showUndoToast(ticker, idx) {
    var el = document.getElementById('undo-toast');
    if (!el) {
        el = document.createElement('div');
        el.id = 'undo-toast';
        el.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#101c2e;border:1px solid var(--border);border-radius:8px;padding:10px 14px;display:flex;align-items:center;gap:14px;font-family:monospace;font-size:12px;color:var(--white);box-shadow:0 8px 24px rgba(0,0,0,.5);z-index:999;opacity:0;transition:opacity .2s;pointer-events:none';
        document.body.appendChild(el);
    }
    if (undoTimer)
        clearTimeout(undoTimer);
    el.innerHTML = '<span>Removed ' + ticker + '</span><button id="undo-btn" style="background:none;border:none;color:var(--blue);font-family:monospace;font-size:12px;font-weight:700;cursor:pointer;letter-spacing:.06em;pointer-events:auto">UNDO</button>';
    el.style.pointerEvents = 'auto';
    el.style.opacity = '1';
    document.getElementById('undo-btn').onclick = function () {
        if (!watchlist.includes(ticker)) {
            watchlist.splice(Math.min(idx, watchlist.length), 0, ticker);
            saveWL();
            renderWatchlist();
            fetchTickerData(ticker).then(function (d) { if (d)
                updateCardMeta(ticker, d); });
        }
        hideUndoToast();
    };
    undoTimer = setTimeout(hideUndoToast, 4000);
}
function hideUndoToast() {
    var el = document.getElementById('undo-toast');
    if (el) {
        el.style.opacity = '0';
        el.style.pointerEvents = 'none';
    }
    if (undoTimer)
        clearTimeout(undoTimer);
}
export function renderWatchlist() {
    // A tier with no #watchlist list element at all (e.g. a Rolodex-style
    // single-active-card UI, which does its own separate rendering off the
    // same watchlist array) still needs addTickers()/removeTicker()/
    // setWatchlist() to work for their persistence/validation/sync-push
    // side effects — this used to throw on the unguarded innerHTML write
    // below the moment such a tier called any of them.
    var wl = document.getElementById('watchlist');
    if (!wl)
        return;
    var list = renderScope != null ? watchlist.slice(0, renderScope) : watchlist;
    wl.innerHTML = list.map(function (ticker) {
        return '<div class="card-wrap" data-ticker="' + ticker + '">'
            + '<div class="swipe-bg"><span class="swipe-icon">&#128465;</span><span class="swipe-label">DELETE</span></div>'
            + '<div class="card loading" id="card-' + ticker + '">'
            + '<div class="card-head">'
            + '<div class="card-left">'
            + '<div class="ticker-row"><span class="ticker-name"><a class="ticker-a" href="' + tickerHref(ticker) + '" target="_blank">' + ticker + '</a></span><span class="ticker-price">&mdash;</span></div>'
            + '<div class="pregate-strip" id="pregate-' + ticker + '" style="display:none"></div>'
            + '<div class="news-line" style="display:none"></div>'
            + '<div class="phase-strip"></div>'
            + '<div class="reason-txt" style="display:none"></div>'
            + '<div class="card-badges"></div>'
            + '</div>'
            + '<div class="card-right">'
            + '<div class="drag-handle" title="Drag to reorder">&#10303;</div>'
            + '<div class="card-action"><button class="analyze-btn" onclick="analyzeTicker(\'' + ticker + '\')">ANALYZE</button></div>'
            + '</div></div>'
            + '<div class="log-section" style="display:none"></div>'
            + '<div class="gate-section" style="display:none"></div>'
            + '</div>'
            + '</div>';
    }).join('');
    var resolveThisRender;
    cardsReadyPromise = new Promise(function (res) { resolveThisRender = res; });
    hydrateCards(list).then(function () {
        resolveThisRender();
        if (postRenderHook)
            postRenderHook();
    });
}
// Populates each rendered card's price/52W/news strip via a free (no
// /analyze, no credit) fetchTickerData + updateCardMeta pairing, so a
// ticker shows real data before the user ever taps ANALYZE. Fired for the
// whole card window at once rather than in gated batches — the backend's
// own shared Finnhub throttle (finnhubThrottle(), Tra server.js) already
// queues and spaces out the underlying provider calls regardless of how
// many concurrent /ticker/:symbol requests arrive, so a frontend
// concurrency cap here only adds tail latency (a slow ticker blocking
// ones behind it from even starting) without protecting anything.
// Fire-and-forget relative to the render itself, same as before.
async function hydrateCards(list) {
    await Promise.all(list.map(function (t) {
        return fetchTickerData(t).then(function (d) {
            if (d)
                updateCardMeta(t, d);
            // Fetch attempt settled either way — stop pulsing regardless of
            // outcome, same as updateCardMeta's own success/no-data/silent-
            // failure paths above (this isn't a retry indicator, just "still
            // waiting on the first answer").
            var card = document.getElementById('card-' + t);
            if (card)
                card.classList.remove('loading');
        });
    }));
}
// --- Drag-to-reorder + swipe-to-delete gestures ---
var ACTIVE = null;
// 8px was too tight for real touch input: a natural thumb swipe rarely
// starts perfectly horizontal, and locking direction that early on
// slight vertical drift permanently abandons the gesture to page-scroll
// for the rest of that touch, with no way to recover mid-swipe.
var MOVE_THRESHOLD = 14;
function bindGestures() {
    if (gesturesBound)
        return;
    var wl = document.getElementById('watchlist');
    if (!wl)
        return;
    gesturesBound = true;
    wl.addEventListener('pointerdown', onPointerDown);
}
function onPointerDown(e) {
    if (ACTIVE)
        return;
    if (e.pointerType === 'mouse' && e.button !== 0)
        return;
    // No target-type exclusion here on purpose: onPointerMove only calls
    // preventDefault()/starts intercepting once movement clears MOVE_THRESHOLD
    // and reads as horizontal, so a plain tap on a button/link/expand-btn
    // still fires its native click untouched. Excluding those targets here
    // used to block a swipe from ever registering if it merely *started* over
    // a news link, an ANALYZE/log button, or the verdict thumbs — which on a
    // real card is most of the tile's surface area.
    var wrap = e.target.closest('.card-wrap');
    if (!wrap)
        return;
    var card = wrap.querySelector('.card');
    if (!card)
        return;
    ACTIVE = {
        pointerId: e.pointerId, wrap: wrap, card: card, ticker: wrap.dataset.ticker,
        startX: e.clientX, startY: e.clientY, mode: null, pendingDx: 0,
        swipeBg: wrap.querySelector('.swipe-bg')
    };
    if (e.target.closest('.drag-handle'))
        beginReorder(e);
    document.addEventListener('pointermove', onPointerMove, { passive: false });
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointercancel', onPointerUp);
}
function beginReorder(e) {
    var g = ACTIVE;
    g.mode = 'reorder';
    try {
        g.wrap.setPointerCapture(e.pointerId);
    }
    catch (err) { }
    g.card.style.transition = 'none';
    g.wrap.classList.add('dragging');
    g.card.classList.add('dragging');
}
function deleteThreshold(wrap) {
    return Math.min(120, wrap.getBoundingClientRect().width * 0.35);
}
function onPointerMove(e) {
    var g = ACTIVE;
    if (!g || e.pointerId !== g.pointerId)
        return;
    var dx = e.clientX - g.startX, dy = e.clientY - g.startY;
    if (g.mode === null) {
        if (Math.abs(dx) > MOVE_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
            g.mode = 'swipe';
            try {
                g.wrap.setPointerCapture(e.pointerId);
            }
            catch (err) { }
            g.card.style.transition = 'none';
            g.wrap.classList.add('swiping');
        }
        else if (Math.abs(dy) > MOVE_THRESHOLD) {
            endGesture();
            return;
        }
        else
            return;
    }
    if (g.mode === 'swipe') {
        e.preventDefault();
        var clamped = Math.min(0, Math.max(dx, -g.wrap.getBoundingClientRect().width));
        g.card.style.transform = 'translateX(' + clamped + 'px)';
        var progress = Math.min(Math.abs(clamped) / deleteThreshold(g.wrap), 1);
        g.swipeBg.style.opacity = String(progress);
        g.pendingDx = clamped;
    }
    else if (g.mode === 'reorder') {
        e.preventDefault();
        while (trySwap(g, e)) { }
        g.card.style.transform = 'translateY(' + (e.clientY - g.startY) + 'px)';
    }
}
function trySwap(g, e) {
    var wl = document.getElementById('watchlist');
    var wrapRect = g.wrap.getBoundingClientRect();
    var dy = e.clientY - g.startY;
    var draggedCenter = wrapRect.top + wrapRect.height / 2 + dy;
    var next = g.wrap.nextElementSibling;
    if (next) {
        var nr = next.getBoundingClientRect();
        if (draggedCenter > nr.top + nr.height / 2) {
            wl.insertBefore(next, g.wrap);
            swapTickers(g.ticker, next.dataset.ticker);
            g.startY += nr.height;
            return true;
        }
    }
    var prev = g.wrap.previousElementSibling;
    if (prev) {
        var pr = prev.getBoundingClientRect();
        if (draggedCenter < pr.top + pr.height / 2) {
            wl.insertBefore(g.wrap, prev);
            swapTickers(g.ticker, prev.dataset.ticker);
            g.startY -= pr.height;
            return true;
        }
    }
    return false;
}
function swapTickers(a, b) {
    var ia = watchlist.indexOf(a), ib = watchlist.indexOf(b);
    if (ia === -1 || ib === -1)
        return;
    var tmp = watchlist[ia];
    watchlist[ia] = watchlist[ib];
    watchlist[ib] = tmp;
    saveWL();
}
function onPointerUp(e) {
    var g = ACTIVE;
    if (!g || e.pointerId !== g.pointerId)
        return;
    if (g.mode === 'swipe')
        finishSwipe(g);
    else if (g.mode === 'reorder')
        finishReorder(g);
    endGesture();
}
function finishSwipe(g) {
    var threshold = deleteThreshold(g.wrap);
    if (Math.abs(g.pendingDx) >= threshold) {
        var wrap = g.wrap, ticker = g.ticker, w = wrap.getBoundingClientRect().width;
        g.card.style.transition = 'transform .18s ease-in';
        g.card.style.transform = 'translateX(-' + (w + 40) + 'px)';
        wrap.style.overflow = 'hidden';
        wrap.style.transition = 'max-height .2s ease .12s,opacity .2s ease .12s,margin .2s ease .12s';
        requestAnimationFrame(function () {
            wrap.style.maxHeight = '0px';
            wrap.style.opacity = '0';
            wrap.style.marginTop = '0px';
            wrap.style.marginBottom = '0px';
        });
        setTimeout(function () { removeTicker(ticker); }, 220);
    }
    else {
        g.card.style.transition = 'transform .18s ease';
        g.card.style.transform = 'translateX(0)';
        g.swipeBg.style.opacity = '0';
    }
    g.wrap.classList.remove('swiping');
}
function finishReorder(g) {
    g.card.style.transition = 'transform .15s ease';
    g.card.style.transform = 'translateY(0)';
    g.wrap.classList.remove('dragging');
    g.card.classList.remove('dragging');
    setTimeout(function () { g.card.style.transition = ''; }, 160);
}
function endGesture() {
    var g = ACTIVE;
    if (g) {
        try {
            g.wrap.releasePointerCapture(g.pointerId);
        }
        catch (err) { }
    }
    ACTIVE = null;
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
    document.removeEventListener('pointercancel', onPointerUp);
}
window.addTickers = addTickers;
