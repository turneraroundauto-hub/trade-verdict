# Trade Verdict — CLAUDE.md

Trade Verdict is a systematic day-trading decision app (the Catalyst Response
Framework — Pre-Gate + Gates 0-5) built by Mr. T, running as a Node.js
backend + a four-tier GitHub Pages frontend, with Supabase auth/credits and
Stripe subscriptions.

**Full history, architecture rationale, and the debug playbook live in
Notion — "Trade Verdict — Full Build Log".** This file is a fast-orientation
map for working in this repo; the Notion doc is the source of truth. Update
both when you finish meaningful work here.

## The two-repo trap — read this first

- **This repo (`trade-verdict`)** is the GitHub Pages **frontend only**:
  `index.html` (free), `starter/`, `pro/`, `shark/`, `shared/*.js`. It also
  contains a `server.js` / `credits.js` / `gates-extended.js` — but those are
  a mirrored copy, **not what's deployed**.
- **The real backend** is `turneraroundauto-hub/Tra`, a separate repo that
  Render actually auto-deploys from. A backend fix pushed only to
  `trade-verdict` will look correct in the diff and do nothing in
  production. This has cost real debugging time before (Aug 1, 2026 —
  confirmed by diffing deployed commit SHAs). If you're asked to change
  backend behavior, that work has to land in `Tra`, which is likely outside
  whatever session's repo scope you have here — say so rather than silently
  editing `trade-verdict/server.js` and calling it done.

## Frontend architecture

Four independent tier HTMLs, each pairing with its own `app.js`
(`index.html`+`app.js` at root for free, `starter/index.html`+`starter/app.js`,
`pro/index.html`+`pro/app.js`; `shark/` is still the old pre-split monolithic
single-file version — see Tier status below). All non-free tiers share:

- `shared/watchlist.js` — watchlist state, drag-to-reorder + swipe-to-delete
  gestures, `addTickers`/`removeTicker`/`setWatchlist`/`renderWatchlist`.
- `shared/ticker-cache.js` — per-symbol memoized `fetchTickerData(symbol, force?)`
  wrapping `GET /ticker/:symbol`.
- `shared/analysis-cache.js` — per-ticker, per-day verdict cache (localStorage).
- `shared/track-record.js` — the `tv_accuracy_log` (capped 200 entries):
  `logResult(ticker, verdict, correct, rowEl, meta?)`, `renderTrackRecord()`,
  `getAccuracyLog()`, `clearLog()`.

### The cache-busting rule — this is not optional

Every shared module and every tier `app.js` is imported/loaded with a
`?v=N` query string (e.g. `'../shared/watchlist.js?v=4'`,
`<script src="./app.js?v=3">`). Browsers cache by full URL including the
query string, and GitHub Pages CDN propagation can take up to ~22 minutes.

**If you change a shared file's content, bump its `?v=` in every place that
imports it** — including other shared files that import it internally
(e.g. `shared/watchlist.js` imports `ticker-cache.js` itself) — and bump the
`?v=` of anything whose *own* content changed as a result (an app.js whose
import line changed needs its `<script src="./app.js?v=N">` bumped too).
Skipping this reintroduces a real, previously-shipped production bug: a
browser with an old cached copy under an unchanged URL keeps running stale
code that silently disagrees with a freshly-loaded sibling module (e.g. two
different `ticker-cache.js` instances with independently-initialized state,
one of which never got `initTickerCache()` called on it).

When you touch a shared file, grep for every importer before you're done:
```
grep -rn "shared/<file>.js?v=" --include=*.js --include=*.html .
```

## Tier status (as of Aug 2, 2026)

| Tier | Files | Status |
|---|---|---|
| Free | `index.html` + `app.js` | Rebuilt, on shared modules, current |
| Starter | `starter/index.html` + `starter/app.js` | Rebuilt, on shared modules, current |
| Pro | `pro/index.html` + `pro/app.js` | Rebuilt Aug 2, 2026 (trade-verdict PRs #23, #24) — on shared modules, plus Pro-exclusive Analyst View, Proxy Resolution Explorer + live coherence strip, Sector Heat Map, Watchlist Tools (export/import/presets), and trigger/ticker track-record breakdowns |
| Shark | `shark/index.html` (no separate `app.js` — still monolithic) | **NOT rebuilt.** Still the pre-Aug-1 single-file version — same gap Pro just closed, likely carries the same reorder/log-button bugs Pro had before its rebuild (shared original template) |

Tier config (ticker cap, cache TTL, credits, tracker) is enforced **server-side**
in `Tra`'s `credits.js` `TIERS` object — check there before assuming a
tier limit needs client-side enforcement; usually it just needs reflecting
in the UI.

## Verifying changes before you claim done

There's no test suite. What's actually been useful:
- `node --input-type=module --check < path/to/file.js` — syntax only, catches
  real mistakes fast, no build step needed.
- A grep-based DOM-ID / `onclick`-handler cross-check between the HTML and
  its `app.js` (every `getElementById('x')` has a matching `id="x"`; every
  inline `onclick="fn(...)"` has a matching `window.fn = fn`).
- A headless-Chromium smoke pass (Playwright, pre-installed at
  `/opt/pw-browsers/chromium`) — load the page, bypass auth by forcing
  `#app-root` visible via `page.evaluate`, exercise the new code paths,
  check for console/page errors. There is no reachable backend from most
  sandboxes, so network calls to `tra-zacg.onrender.com` will fail/hang —
  that's expected; the point is confirming the new code degrades gracefully
  instead of throwing.
- None of the above substitutes for a real login against the live backend —
  flag that as unverified rather than implying it was checked.

## Terminology rule

Verdicts are UP / DOWN / FLAT only, with a magnitude and a sizing action.
"Stand down" and "go" are prohibited anywhere in UI copy, verdict labels, or
generated text (a permanent rule from the Jul 28-29, 2026 framework rebuild).
