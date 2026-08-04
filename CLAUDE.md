# Trade Tribunal — CLAUDE.md

Trade Tribunal (renamed from "Trade Verdict" on Aug 4, 2026 — see the
domain/naming note below) is a systematic day-trading decision app (the
Catalyst Response Framework — Pre-Gate + Gates 0-5) built by Mr. T, running
as a Node.js backend + a four-tier GitHub Pages frontend, with Supabase
auth/credits and Stripe subscriptions.

**Full history, architecture rationale, and the debug playbook live in
Notion — still titled "Trade Verdict — Full Build Log" as of the rename;
still needs updating there, not yet done (last checked Aug 4, 2026).**
This file is a fast-orientation map for working in this repo; the Notion
doc is the source of truth. Update both when you finish meaningful work
here.

## Naming: Trade Verdict → Trade Tribunal (Aug 4, 2026) — DONE

Renamed after discovering a live, unrelated competitor already using
"TradeVerdict"/"theverdict.app" for a near-identical AI trade-evaluation
pitch, plus `tradeverdict.com`/`.io` were already taken by them — kept
looking bad for SEO/brand-confusion reasons even though legal risk was low
(no registered trademark found, no Play Store presence). Custom domain
`tradetribunal.app` (`CNAME` file in repo root) replaces the org's default
`turneraroundauto-hub.github.io` Pages URL going forward — GitHub
auto-redirects the old URL so existing links/bookmarks keep working.

Landed in two passes, both merged in `trade-verdict` and `Tra`:
1. **Cosmetic** (`trade-verdict` PR #47, `Tra` PR #15): page titles, in-app
   headers/footers, comments, user-agent strings.
2. **Functional redirect URLs** (`trade-verdict` PR #48, `Tra` PR #16):
   the hardcoded `turneraroundauto-hub.github.io/trade-verdict` links used
   for cross-tier sign-up/sign-in redirects, the backend `TIER_URLS` map,
   and the Supabase auth `redirectTo` — all repointed at `tradetribunal.app`.
   This required adding `https://tradetribunal.app/reset` to Supabase's
   Auth → URL Configuration → Redirect URLs allowlist first (done, confirmed
   by Mr. T Aug 4, 2026) — skipping that step would have broken password
   reset for existing users the moment it deployed.

Stripe product names (Starter/Pro/Shark/Credits) also updated to "Trade
Tribunal ..." directly in the Stripe dashboard by Mr. T (Aug 4, 2026) —
`Tra`'s `STRIPE_SETUP.md` doc text was already updated to match in the
cosmetic pass.

Explicitly NOT touched, still open: the `tv_*` identifiers (`tv_session`,
`tv_wl`, `tv_accuracy_log`, Supabase table/column names) — renaming those
is a real breaking data migration for existing users and needs its own
deliberate pass, not a side effect of a branding change. The GitHub repo
itself is also still named `trade-verdict` — renaming that is a separate,
bigger decision (breaks existing clone URLs/CI references) not covered by
this pass. The Notion "Full Build Log" doc title is also still unchanged
(see note above) — low priority per Mr. T as of Aug 4, 2026.

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
  backend behavior, that work has to land in `Tra`. If `Tra` isn't already
  in your session's repo scope, **ask to have it added** (e.g. via
  `add_repo`) rather than assuming it's unreachable — this has worked before
  (Aug 2, 2026, the Pro IV export: `Tra` was added mid-session, cloned, and
  a real PR opened and merged there). Only fall back to "say so and stop" if
  adding it is actually refused or unavailable in your environment. Either
  way, never silently edit `trade-verdict/server.js` as a substitute for the
  real change and call it done — that file is a mirror, not the deploy
  target, and editing it alone ships nothing.
- When you do land a change in `Tra`, mirror it into this repo's
  `server.js`/`credits.js`/`gates-extended.js` too (same pattern, same
  function names) so the mirror doesn't silently drift further out of sync
  — it's already happened once before (Aug 1, 2026) and cost real time to
  untangle. The mirror update is cosmetic/historical only; `Tra` is what
  actually needs to merge and deploy for anything to go live.

## Backend: Finnhub call budget (Aug 3, 2026)

Every `finnhubGet()` call in `Tra`'s server.js now goes through a shared
55-calls/min rolling-window queue (`finnhubThrottle()`) with retry-with-
backoff on 429 — a cold `symbolMarketCache` (fresh deploy, or any ticker's
first request of the day) used to fire enough unthrottled Finnhub calls at
once to blow past the free-tier 60/min limit and fail nearly everything
with "No quote." If you add a new Finnhub-backed feature, it rides this
same queue automatically as long as it goes through `finnhubGet()` —
don't call `fetch()` against Finnhub directly.

Slow-changing fundamentals (52W high/low, beta, market cap, IPO date, avg
volume) live in their own 24h cache (`symbolFundamentalsCache`,
`fetchTickerFundamentals()`), fully decoupled from the price-refresh
clock — they used to re-fetch on every price refresh (as tight as every
minute on Pro) for numbers that hadn't changed since yesterday, which was
most of the call volume tripping the limiter above. **Known trade-off,
confirmed with Mr. T:** 52-week high/low can lag up to 24h on a fresh
intraday high/low — accepted because Gate 1's forceDown (fresh Alpaca
60-day data, untouched by this cache) independently catches most of the
cases where that would actually matter.

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

**This isn't hypothetical — it shipped and cost real hours (Aug 2-3, 2026).**
`shared/watchlist.js` got bumped in `app.js`/`pro/app.js`/`starter/app.js`
but NOT in `shared/watchlist-sync.js`'s own internal import, because that
one uses a relative path (`./watchlist.js?v=N`) instead of the
`shared/watchlist.js?v=N` pattern every external importer uses — so a
path-anchored grep for the latter silently skipped it. Two separate module
instances resulted; the server-sync code was writing to one, the UI
rendered from the other, and a real 47-ticker watchlist appeared to
shrink to 3-7 tickers on reload. **When you bump any shared file's
version, grep unanchored** (`<file>.js?v=`, no `shared/` prefix, no
leading path) so it also catches sibling files' own relative internal
imports — not just `grep -rn "shared/<file>.js?v=" ...`:
```
grep -rn "<file>\.js?v=" --include=*.js --include=*.html .
```
Then trace the cascade: if a shared file's version bump changes another
shared file's content (its import line), that file's OWN version needs
bumping too, and so on up through every `app.js` to each tier's
`<script>` tag — check every hop, not just the first one.

## Tier status (as of Aug 3, 2026)

| Tier | Files | Status |
|---|---|---|
| Free | `index.html` + `app.js` | Rebuilt, on shared modules, current. Its top-level "redirect a paid session elsewhere" check now actually halts the rest of module init (`redirectingToPaidTier` flag, added Aug 3, 2026) — see the testing note below for why that mattered. |
| Starter | `starter/index.html` + `starter/app.js` | Rebuilt, on shared modules, current |
| Pro | `pro/index.html` + `pro/app.js` | Rebuilt Aug 2, 2026 (trade-verdict PRs #23, #24, #26, #27, #28 + `Tra` PR #5) — on shared modules, plus Pro-exclusive Analyst View, Proxy Resolution Explorer + live coherence strip, Sector Heat Map, a CSV export (Ticker/List/Price/IV/Change%, real IV via Alpaca options snapshots), trigger/ticker track-record breakdowns, and a card/watchlist split: only the first 15 tickers (in list order) render as full analysis cards, the rest render as compact price/%chg/news rows with no ANALYZE button and no credit cost — `analyzeAll()` scopes to the 15-card window only (max 5 credits). **Confirmed working live by Mr. T**, including the IV export. Its two Shark upsell teases (Proxy Explorer, Heat Map) link to `shark/coming-soon.html` (see Shark row), not straight to Stripe checkout. |
| Shark | `shark/index.html` (no separate `app.js` — still monolithic) | **NOT rebuilt — deliberately deferred as of Aug 2, 2026, not a backlog gap.** Mr. T wants Shark's eventual rebuild to lean on more Alpaca-driven visuals, likely after upgrading to Alpaca's "Plus" data plan first. Don't pick this up proactively without checking that's still the plan — it still carries the same reorder/log-button bugs Pro had before its rebuild (shared original template) whenever it does happen. A separate, standalone `shark/coming-soon.html` splash (added Aug 2, 2026, licensed mascot art at `shared/assets/shark-mascot.png`) exists alongside it — email waitlist writes directly to Supabase's `shark_waitlist` table (anon insert-only via RLS) from the browser, no backend involvement. |

Tier config (ticker cap, cache TTL, credits, tracker, `alpaca`, `iv`) is
enforced **server-side** in `Tra`'s `credits.js` `TIERS` object — check
there before assuming a tier limit needs client-side enforcement; usually
it just needs reflecting in the UI.

### `tierConfig.alpaca` vs `tierConfig.iv` — don't conflate these

Both gate access to the same Alpaca credentials (`ALPACA_KEY`/`ALPACA_SECRET`
in `Tra`), but they're deliberately separate flags for separate surfaces:
- `alpaca` (`true` only for Shark) gates Shark's Gate 3 SWING_LEVEL mode and
  is explicitly earmarked in `Tra`'s server.js (see the comment on
  `alpacaKeys()`) for future Shark-exclusive "deep analytics" (extended/
  granular bars, more options/greeks surface).
- `iv` (`true` for Pro + Shark, added Aug 2, 2026) gates ONLY the single
  representative implied-volatility figure computed in
  `fetchImpliedVolatility()`, used by Pro's CSV export.

**If you add a new Alpaca-backed feature, give it its own tier flag like
`iv` did — don't just check `tierConfig.alpaca`.** That flag was deliberately
scoped to Shark; reusing it for something new is how a feature meant to stay
Shark-exclusive quietly leaks into Pro (or vice versa). This was a real
decision point, not an oversight — flagged to and confirmed by Mr. T before
`iv` shipped, precisely because it crosses a pricing/differentiation
boundary, not just a technical one.

## Verifying changes before you claim done

There's no test suite. What's actually been useful:
- `node --input-type=module --check < path/to/file.js` — syntax only, catches
  real mistakes fast, no build step needed.
- A grep-based DOM-ID / `onclick`-handler cross-check between the HTML and
  its `app.js` (every `getElementById('x')` has a matching `id="x"`; every
  inline `onclick="fn(...)"` has a matching `window.fn = fn`).
- A headless-Chromium smoke pass (Playwright, pre-installed at
  `/opt/pw-browsers/chromium`) — load the page, bypass auth, exercise the
  new code paths, check for console/page errors. There is no reachable
  backend from most sandboxes, so network calls to `tra-zacg.onrender.com`
  will fail/hang — that's expected; the point is confirming the new code
  degrades gracefully instead of throwing.
  - **CSS-toggling `#app-root` visible is not a real auth bypass on
    Starter/Pro/Shark.** `initApp()` (which calls `renderWatchlist()`) only
    runs from `checkTierAccess()`, which only runs if `checkAuth()` finds a
    valid `tv_session` in localStorage — forcing `#app-root` display without
    that leaves the watchlist genuinely empty (no errors, just nothing
    rendered), which reads like a bug but isn't one. Prime a fake-but-valid
    session first: `localStorage.setItem('tv_session', JSON.stringify({token:'x',
    tier:'pro', expiresAt: Math.floor(Date.now()/1000)+3600}))`, then reload.
    Free tier doesn't need this for a genuinely free/anonymous test session
    — its `app.js` still calls `renderWatchlist()` unconditionally at module
    load, no session gate. But if you're priming a **paid** `tv_session`
    (tier !== 'free') to test something else and happen to load the Free
    tier page too, its redirect-away check now correctly skips
    `initWatchlist`/`pullWatchlistFromServer` entirely
    (`redirectingToPaidTier`, Aug 3, 2026) — don't "fix" that guard away
    thinking it's dead code blocking a test; it's why a paid account's real
    watchlist doesn't get silently truncated to Free's 3-ticker cap and
    written back to the shared `tv_wl` localStorage key.
  - **`page.route('**/analyze')`-style exact-suffix patterns silently match
    zero requests here.** Every API call goes through `addSecret()`, which
    appends `?supabase_token=...` (or nothing, pre-login) to the URL — route
    against a substring (`url.includes('/analyze')`) instead of an exact
    suffix, or the intercept quietly no-ops and looks like "no requests
    fired" (a false-positive bug report, not a real one).
- None of the above substitutes for a real login against the live backend —
  flag that as unverified rather than implying it was checked.
- The same applies, harder, to any new third-party API integration in `Tra`
  (e.g. Alpaca's options-snapshot endpoint for IV, added Aug 2, 2026) — there
  is no way to test against real, entitlement-gated credentials from a
  sandbox at all. Write it to fail safe (catch everything, return null/a
  clear placeholder, never throw into the response), say explicitly in the
  PR that it's unverified against live credentials, and say what a human
  should check after deploy (e.g. "confirm the Alpaca plan actually has
  options-data entitlement, spot-check one known-liquid ticker's value").

## Terminology rule

Verdicts are UP / DOWN / FLAT only, with a magnitude and a sizing action.
"Stand down" and "go" are prohibited anywhere in UI copy, verdict labels, or
generated text (a permanent rule from the Jul 28-29, 2026 framework rebuild).
