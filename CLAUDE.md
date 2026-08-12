# Trade Tribunal — CLAUDE.md

Trade Tribunal (renamed from "Trade Verdict" on Aug 4, 2026 — see the
domain/naming note below) is a systematic day-trading decision app (the
Catalyst Response Framework — Pre-Gate + Gates 0-5) built by Mr. T, running
as a Node.js backend + a four-tier GitHub Pages frontend, with Supabase
auth/credits and Stripe subscriptions.

**Full history, architecture rationale, and the debug playbook live in
Notion, "Trade Tribunal — Full Build Log" (renamed to match, confirmed
current as of Aug 10, 2026).** This file is a fast-orientation map for
working in this repo; the Notion doc is the source of truth. Update both
when you finish meaningful work here.

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
this pass. **Reconfirmed Aug 10, 2026:** asked directly whether to do
either of these two now; got no go-ahead on either, so both stay exactly
as described above — still open, still deliberate, not forgotten.

**Follow-up brand scrub (Aug 10, 2026, `trade-verdict` PR #83):** a
repo-wide case-insensitive grep for `trade[ -]?verdict` turned up three
spots the cosmetic pass above missed — Pro's watchlist CSV export still
downloaded as `trade-verdict-watchlist-*.csv` (user-visible), the mirrored
`server.js`'s banner comment still read `TRADE VERDICT API`, and
`README.md`'s heading was still the old repo slug. All three fixed; same
deliberately-untouched exceptions as above.

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

## Backend: Alpaca call budget, extended-hours pricing, dual-source news (Aug 4, 2026)

Same shape of problem as the Finnhub throttle above, found the same way
(live 429s in Render logs) and fixed the same way: every `fetchOpeningBar`/
`fetchDailyCloses`/`fetchImpliedVolatility`/`fetchExtendedHoursPrice` call
now goes through `alpacaGet()`, which has its own shared 180-calls/min
rolling-window queue (`alpacaThrottle()`, Alpaca's free-plan limit is
200/min) with retry-with-backoff on 429. Before this, a full watchlist load
(main cards + Proxy Resolution Explorer + Heat Map each independently
triggering `/ticker/:symbol`) fired 2-3 unthrottled Alpaca calls per
ticker, burst well past 200/min, and a chunk of them 429'd — not just
slow, a correctness bug: `fetchDailyCloses` failing to `null` on a 429
silently degrades Gate 1's evaluation instead of visibly erroring. If you
add a new Alpaca-backed feature, route it through `alpacaGet()` — don't
call `fetch()` against `data.alpaca.markets` directly.

**Pre/post-market pricing now comes from Alpaca, not Finnhub, during
`isExtendedHoursWindow()` (8-9:30am / 4-8pm ET).** Finnhub's free `/quote`
`c` field doesn't track pre/post-market trades — it holds the last
regular-session price until 9:30am, confirmed live (CIFR showing $24.16
pre-market against a real $21.80). First attempt narrowed
`isMarketDataWindow()` to 9:30am-8pm to just stop refreshing during that
gap, on the wrong assumption that Alpaca's free IEX feed couldn't cover it
either. It can: IEX Exchange runs its own formal pre-market
(4:00am-9:30am ET) and post-market (4:00pm-8:00pm ET) sessions, and
Alpaca's `feed=iex` bars/latest-trade endpoints include those prints by
default (no extra param needed — confirmed via a GitHub issue on Alpaca's
Python client where users were asking to *exclude* extended-hours bars).
So the window stayed at 8am-8pm, and `fetchExtendedHoursPrice()`
(Alpaca latest-trade) substitutes for Finnhub's frozen price during that
sub-window, recomputing %change against Finnhub's `pc` (previous close,
reliable at any hour). Thinner liquidity than the regular consolidated
tape — a real but imprecise read, not equivalent to a regular-session
quote, but a large improvement over silently re-serving a stale value.

**News is now sourced from Finnhub *and* Alpaca (`/v1beta1/news`,
Benzinga) concurrently, using whichever headline is actually more
recent — not "fall back to Alpaca only when Finnhub is empty."**
Root-caused via BB (Aug 4, 2026): Finnhub's `/company-news` returned a
real, non-empty article that was simply 313.5 hours old against the app's
300-hour cutoff — a materially newer BB story the user had seen elsewhere
wasn't in Finnhub's feed for that ticker at all. An empty-only fallback
wouldn't have caught that, since Finnhub's result wasn't empty, just
stale. **UNVERIFIED AGAINST LIVE ALPACA NEWS ENTITLEMENT** — same posture
as the IV feature below: written from Alpaca's documented response shape,
fails safe to Finnhub-only behavior on any error (including a 403 if the
account lacks the entitlement), never confirmed against a real response.
Check Render logs for `fetchAlpacaNews` errors, or watch for a card whose
news source shows "Benzinga" to confirm it's actually working.

**Market-open cache warm** (`setInterval`, this codebase's first): fires
once per trading day in a 9:30-9:35am ET window, refreshing the fixed
tracked-symbol list (`marketCache`, via `warmTrackedMarketCache()`,
shared with the existing boot-time warm) and every symbol currently in
`symbolMarketCache` (via `refreshMarketEntry()`, shared with
`/ticker/:symbol`'s own staleness check) — so the bell ringing itself
triggers the refresh instead of whoever loads their watchlist first after
open eating the cost alone.

**Known follow-ups, not yet built:**
- `fetchDailyCloses` refetches all 130 days of Alpaca bars on every price
  refresh (as often as every 1 min on Pro), even though only the
  most-recent day's bar can actually change. Fundamentals got decoupled
  into their own 24h cache for exactly this reason (see above) — daily
  closes never did. Real, low-risk win for reducing steady-state Alpaca
  call volume, not just the throttled-burst case.

**Resolved:**
- ~~No in-flight de-duplication~~ — fixed: `shared/ticker-cache.js`'s
  `fetchTickerData()` tracks an in-flight promise per symbol, so
  concurrent callers (cards, PRE, Heat Map) asking for the same symbol
  within milliseconds of each other share one request instead of each
  firing their own.
- ~~Proxy Resolution Explorer and Sector Heat Map iterate the entire
  watchlist~~ — see "Watchlist load-time fixes" below (Aug 5, 2026):
  rebuilt as priority-first + progressive rather than scoped to top-15
  only, so large watchlists stay fully visible in both panels.

## Backend: watchlist load-time fixes (Aug 5, 2026)

Reported live: a Pro watchlist was taking 2+ minutes to populate even
after everything else on the page had loaded, with Render logs showing
repeated `[SUB LOOKUP]` entries all resolving to the same tier. Two
compounding causes, both fixed:

**Auth-lookup stampede.** `resolveAuth()`'s existing time-based cache
(`authCache`, 60s TTL) only helps a request that lands *after* an earlier
one already finished and populated it. A burst of concurrent requests
carrying the identical token — exactly what card hydration, the compact
overflow list, and (when open) PRE/Heat Map all produce simultaneously on
a large watchlist — all check the cache before any of them has had time
to fill it, so every single one independently re-ran both Supabase round
trips (`validateSupabaseToken` + `getSubscriber`). Fixed in `Tra`'s
server.js (mirrored into this repo's `server.js`) with an in-flight-
promise map (`authInFlight`), the same pattern `shared/ticker-cache.js`
already used for per-symbol de-duplication — concurrent callers now share
one real lookup instead of each starting their own.

**Compact-list batching, still there after the cards were fixed.** The
Aug 4 batching removal (see Frontend architecture below) only touched
`hydrateCards()` for the main 15 cards. `renderCompactList()` — the
overflow list covering everything beyond the card window — still ran its
fetches 5-at-a-time through a `mapBatched()` helper, serializing a
33-ticker overflow list (on a 48-ticker watchlist) into 7 sequential
waves. Removed; now a plain `Promise.all`, same reasoning as the cards'
fix (redundant now that Tra's Finnhub/Alpaca throttles and the ticker-
cache in-flight de-dupe exist).

**Proxy Resolution Explorer and Sector Heat Map now load priority-first.**
Both used to block their entire render on `Promise.all` over the *full*
watchlist — on a large watchlist, one slow ticker anywhere in the list
held up every row/tile, including the ones for the top 15 tickers users
actually look at first. Both now resolve and paint the card-window
(top 15) tickers first, then stream in the rest as each one's own fetch
completes — PRE re-sorts and repaints as each additional result arrives,
Heat Map updates each tile in place. Both use a render-generation counter
so a stale in-flight paint from a superseded render (panel closed/
reopened, sort changed) can't clobber a newer one. Nothing scoped away —
tickers 16+ still get full coverage, just not gating on it.

**Follow-up, same day: none of the above actually fixed it.** Reported
back live — top-15 cards were still slow, "loading with everything
else," no perceptible improvement from any of the three fixes above.
Root cause was a fourth, bigger one those three didn't touch:
`evaluatePreGate()` (SEC EDGAR full-text search, runs inside *every*
`/ticker/:symbol` request, not just Analyze) had **no throttle at all**,
unlike Finnhub/Alpaca. Worse, both the per-symbol Pre-Gate result cache
and the ticker→CIK map it depends on are plain in-memory state that goes
cold on every deploy — and the auth-stampede fix just above had, minutes
earlier, forced exactly that deploy. So the very fix meant to help
instead guaranteed a fully-cold Pre-Gate cache for the next test: every
ticker, including the top 15, now needed a fresh unthrottled SEC call
before its `/ticker/:symbol` response could return at all, and a burst of
concurrent different-symbol requests right after a cold start could
plausibly get slowed or rate-limited by SEC itself with nothing local
pacing them. Fixed with `secThrottle()` (8 req/sec rolling window, same
shape as `finnhubThrottle`) wrapping both the CIK map fetch and the
full-text search call, plus an in-flight-promise guard
(`tickerCikInFlight`) on the CIK map's own cold-cache population so a
burst landing while it's null doesn't each independently re-fetch and
re-parse the entire SEC ticker list. **Unverified against a live deploy
as of this writing** — reasoned from code (this is the one path with
zero rate-limiting protection, on the one deploy that would have gone in
completely cold), not confirmed by watching Render logs post-deploy.

## Supabase tables: "RLS disabled" ≠ "access blocked" (Aug 4, 2026)

Every service-role-only table in this project (`subscribers`, `credits`,
`proxy_resolution`, `pre_gate_triggers`, `watchlists`, `accuracy_log`) is
documented as "RLS disabled, server-only access via the service_role key."
**That description is incomplete and was actively dangerous:** disabling
RLS just means Postgres stops filtering rows by policy — it does nothing
about the underlying `anon`/`authenticated` role GRANTs. Supabase's
Security Advisor flagged `public.subscribers` as CRITICAL ("Policy Exists
RLS Disabled"), which led to actually checking every table's real grants
via `information_schema.role_table_grants` — and `credits`,
`accuracy_log`, and `proxy_resolution` all had full `anon` **and**
`authenticated` SELECT/INSERT/UPDATE/DELETE, unrevoked, this whole time.
Anyone with the public anon key (sitting in every tier's page source)
could have rewritten their own credit balance, tampered with any user's
track record, or corrupted the proxy-resolution cache directly via the
REST API — no backend, no auth, no rate limit. `subscribers` and
`watchlists` happened to already have no such grants (likely a Supabase
project-default-privileges quirk at table-creation time, not anything
this repo did intentionally) — that was luck, not design.

**Fixed (Aug 4, 2026):** `revoke all on <table> from anon, authenticated;`
run against `credits`, `accuracy_log`, `proxy_resolution` — confirmed
closed via the same grants query returning zero rows afterward.

**Rule for every future service-role-only table:** `disable row level
security` is not sufficient by itself. Always pair it with an explicit
`revoke all on public.<table> from anon, authenticated;`, and verify with:
```sql
select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name = '<table>'
  and grantee in ('anon','authenticated');
```
Zero rows back is the only thing that actually confirms it — "RLS shows
disabled in the dashboard" does not. All `supabase-ddl-patch*.sql` files
for existing service-role-only tables now include this revoke; any new
patch creating one must too.

Separately, unrelated to the grants issue: on this project, bundling
`alter table ... disable row level security` in the *same* SQL editor
run as the `create table` it follows did not reliably stick (patch8,
`accuracy_log` — the table still showed RLS-enabled after running the
combined script). Running it as its own separate execution, after the
table already exists, is what actually worked. Structure future patches
as explicit separate steps rather than assuming one combined run is
equivalent.

**Root cause confirmed (Aug 4, 2026) — fix up as `Tra` PR #22, not yet
merged/deployed.** `credits` currently still has its `anon`/`authenticated`
grants back as a live stopgap (the vulnerability above is re-opened on
this one table until the fix below deploys and holds). Revoking `credits`'
grants broke real production traffic within minutes — `credits.
get_or_create_user_credits failed: permission denied for table
credits` in Render logs — even though `service_role` provably had full
grants on every one of these tables (`set role service_role; select * from
public.get_or_create_user_credits(...)` succeeded cleanly from the SQL
editor).

Actual cause: none of `credits`' RPC functions
(`get_or_create_user_credits`, `deduct_user_credit`, etc., in
`supabase-ddl-patch5-credits.sql`) are `SECURITY DEFINER` — Postgres
defaults to `SECURITY INVOKER`, so each one runs with whatever role the
*calling* request resolves to, not `service_role` automatically. `Tra`'s
`server.js` used one module-level Supabase client (built with
`SUPABASE_SERVICE_KEY`) for everything, including `/auth/login` and
`/auth/signup`, which call `signInWithPassword`/`signUp` — and in
`@supabase/supabase-js` v2, those calls persist a session onto whatever
client instance they're called on, after which that instance's own
`.from()/.rpc()` calls send the *session's* access token instead of the
key it was constructed with. So the moment any user logged in, the shared
client's session flipped to that user's `authenticated`-role JWT, and
every other concurrent/subsequent request's privileged calls (`credits`
included) silently started executing as `authenticated` instead of
`service_role` — until the next login/signup overwrote it again. This
also explains why it wasn't 100% reproducible: it only manifests once a
login/signup has happened recently in that server process. The same
shared-client pattern affects `upsertSubscriber`/watchlist/track-record
sync too, just not caught yet since those didn't have their grants
tightened to expose it.

**Fix (PR #22, `Tra`):** the admin client now sets `persistSession:
false`, and `/auth/login`/`/auth/signup` call `signInWithPassword`/
`signUp` on a fresh, throwaway anon-key client instead of the shared
admin one — so a login/signup can no longer contaminate the client used
for `service_role` work. Mirrored into this repo's `server.js` too (same
`authClient()` pattern). **Once this deploys and holds under real
traffic for a few days, `credits`' `anon`/`authenticated` grants can
likely be safely re-revoked** — do that as its own follow-up, not in the
same change, so a regression is easy to isolate. `accuracy_log`,
`proxy_resolution`, `pre_gate_triggers`, and `watchlists` are still
properly revoked and were never affected — only `credits` is currently
exposed.

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
- `shared/track-record-sync.js` (added Aug 4, 2026, **Pro only** — only
  `pro/app.js` wires it up) — syncs `tv_accuracy_log` to the account via the
  new `GET`/`POST /track` endpoints in `Tra`, structurally identical to
  `watchlist-sync.js`/`GET`/`POST /watchlist`: same debounced push, same
  seed/`ignoreDuplicates` write on an ambiguous empty pull. Free/Starter/
  Shark are untouched, still localStorage-only. Backing table:
  `public.accuracy_log` (`supabase-ddl-patch8-track-record-sync.sql`).
- `shared/prefs.js` / `shared/settings-modal.js` / `shared/context-highlight.js`
  (added Aug 9-10, 2026, **Starter + Pro only**) — see "Frontend: user
  preferences" below.

`shared/watchlist.js`'s `hydrateCards()` (populates each card's price/52W/
news strip) fires every card's fetch concurrently rather than in gated
batches of 5 (removed Aug 4, 2026) — the batching predated `Tra`'s Finnhub
throttle and is now redundant with it; keeping it only added tail latency
(a slow ticker blocked the *next* batch from even starting).

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

## Frontend: user preferences — time zone, ticker/news links, session-context highlighting (Aug 9-10, 2026)

**Starter + Pro only.** Free must never show the Settings UI and must be
immune to preferences set by another tier sharing the same browser/
localStorage origin — `shared/prefs.js`'s `forceDefaults()` runs on Free's
`app.js` load and always resolves to ET + Yahoo regardless of what's in
localStorage. Free's `app.js` does not import `settings-modal.js` at all.

**Time zone.** The market timestamp used to render in unlabeled
browser-local time next to an already-ET-labeled live clock — confusing
whenever the two disagreed. `prefs.js` exports `TIMEZONES` (ET/CT/MT/PT)
and `getTzPref`/`setTzPref`/`getTzIana`; both the live clock and the
market timestamp on Starter/Pro now render in the user's chosen zone,
always labeled.

**Ticker/news links.** `LINK_SITES` (`yahoo`/`tradingview`/`stocktwits`/
`google`/`robinhood`/`custom`) drives `tickerHref(t)` (what a ticker
symbol links to) and `newsHref(t)` (what a news headline links to —
defaults to the same site, TradingView overrides to its `/news/` path).
The paywalled-news problem was originally attacked with a keyword-search
test bench trying to find a reliably-free source per headline — abandoned
after live testing kept surfacing 404s and Google's `site:` search
banner, nothing usable as a real link target. **Pivoted to a simpler
model:** route both ticker and news links through the user's own site
preference — "paywalled" is relative to the individual user, and someone
with their own TradingView/Robinhood subscription doesn't have a paywall
problem to solve for. Finnhub/Alpaca remain the underlying data source for
headline text and gate logic; only the *link* changed. `robinhood` was
added as a built-in option alongside a `custom` option for a fully
user-defined link template.

**Custom link template** (`buildTemplateFromExample`, `detectTickerInUrl`,
`isValidCustomTemplate`, `getCustomTemplate`/`setCustomTemplate` in
`prefs.js`) went through three rounds of simplification, each a direct
user correction: (1) originally required manually typing `{TICKER}` into
a template — replaced with `detectTickerInUrl()`, a heuristic that scans
a pasted example URL's path segments from the end (with a non-ticker-word
blocklist, a hyphen-split fallback for Webull-style URLs, and a
query-param fallback for chart-style URLs like `?symbol=NASDAQ:AAPL`) so
the user never types the ticker at all; (2) then simplified from two
fields (ticker + URL) to one — the Settings modal's Custom-link UI is now
a single URL input (`#settings-custom-ex-url`) that auto-prepends
`https://` if missing and shows a save/error status line, nothing else;
(3) the placeholder text ("Paste your favorite market news URL") was
shortened after the original wording visually truncated on mobile.
Blank/invalid custom input silently falls back to Yahoo Finance.

**Session Context highlighting.** `shared/context-highlight.js`'s
`highlightContextMatches(headline, contextText)` HTML-escapes the
headline (this also fixed a latent missing-escape bug — headline text was
going straight into `innerHTML` before) and wraps matches in
`<mark class="ctx-match">` only when 2+ distinct stopword-filtered words
overlap between the Session Context textarea and a given headline —
single coincidental word overlaps are intentionally ignored to avoid
false-positive highlighting. Wired to a 250ms-debounced input listener on
`#context-input` (`wireContextHighlight()` in starter/app.js and
pro/app.js) that re-renders already-cached card/compact-list news via
`refreshNewsHighlights()` (new export in `shared/watchlist.js`) — no new
network calls.

**Watchlist ordering.** `addTickers()` used to append new tickers to the
bottom; it now collects the not-already-present tickers and prepends them
as a block (`watchlist.unshift.apply(watchlist, newOnes)`, not a
naive per-item loop, which would reverse the typed order) so newly added
tickers appear at the top in the order they were entered. Mirrored into
`shark/index.html` as a mechanical fix (not the rest of this section's
feature work, which stayed Starter/Pro-only per instruction).

**Gotcha hit again during this work, same class already documented in the
cache-busting rule below:** bumping `settings-modal.js`'s own `prefs.js`
import to a new `?v=` without bumping the other importers
(`watchlist.js`, `track-record.js`, `app.js`, `starter/app.js`,
`pro/app.js`) created two live ES module instances of `prefs.js` in the
same page — `pro/app.js`'s `onPrefsChange` listener was registered on the
stale one and never fired. Fixed by bumping every importer in lockstep;
re-confirm with the unanchored grep from the cache-busting rule whenever
`prefs.js` changes again.

Shipped as `trade-verdict` PRs #76-#80, all merged to `main`.

**Evening follow-up (Aug 10, 2026): news-link correctness sweep, `trade-verdict`
PRs #82, #84-#86.** `newsHref()` only ever special-cased TradingView with a
real per-ticker news route — Yahoo (the default for every user, and the
*only* option Free can use) and Google both silently fell back to `href()`
(a plain quote page / generic web search) instead of landing on actual
news. Fixed: Yahoo now has its own `newsHref` (`/quote/{TICKER}/news/`);
Google's `newsHref` routes through `news.google.com` instead of a plain
web search; StockTwits got its own `newsHref`
(`stocktwits.com/symbol/{TICKER}/news`) — previously assumed (wrong) that
StockTwits had no distinct news route, corrected via a live example the
user supplied. Separately, Google Finance's *ticker* link (`href`, not
`newsHref`) was still routing through a plain `google.com` web search —
per direct instruction, changed to `google.com/finance/beta/?q={TICKER}`
instead. **Unverified against a live response** — this sandbox's network
egress proxy blocks `google.com` outright (confirmed via both `curl` and
`WebFetch`, both returned 403/`EGRESS_BLOCKED`) — spot-check after deploy.
**Custom link split into two independent templates**
(`getCustomMarketTemplate`/`setCustomMarketTemplate`, new key
`tv_link_custom_market_template`) — the Custom option previously had one
saved template serving both ticker and news links; the original
template/key keeps its exact prior behavior and now serves only the news
link, so existing users' saved link keeps working unchanged, no migration
needed. Also found and merged `trade-verdict` PR #75 ("Back to Free tier"
link on the Starter/Pro login screens) — opened by a *different*, earlier
session on Aug 6 and left unmerged ever since, found by fetching every
remote branch and diffing each against `main` for unmerged commits.
Reminder: "pushed" and "merged" are not the same claim, and nothing
surfaces that gap automatically.

**Late-night follow-up (Aug 10, 2026): live bug caught by the user, `trade-verdict`
PRs #88, #89.** Clicking ARCC (Ares Capital Corporation, NASDAQ) landed on
Egypt's EGX-listed Arabian Cement Company instead — the exact failure mode
flagged as an unverified risk when the Google Finance beta-search change
above shipped. **First response was wrong**: assumed the report was about
that just-shipped Google change without confirming which link-site
preference was actually active, and fixed only Google (reverted
`google.com/finance/beta/?q=` back to a plain `google.com/search?q={TICKER}+stock`
web search). The user corrected this directly — the report was actually
about the **TradingView** preference. Re-verified with the same `prefs.js`
node-script test used throughout this session's link work and confirmed
TradingView's bare `tradingview.com/symbols/{TICKER}/` has the identical
missing-exchange-context problem (both need a `TICKER:EXCHANGE` qualifier
this app has no way to supply — there is no per-symbol exchange field
anywhere in the frontend or the mirrored `server.js`). Fixed the same way:
routes through a plain web search with a `tradingview` keyword instead of
the `site:tradingview.com` operator (already known unreliable — see the
news-link section above). **Both fixes are unverified against a live
response** — this sandbox's network egress proxy blocks every finance/social
site tried outright (`google.com`, `tradingview.com`, `finance.yahoo.com`,
`stocktwits.com` all returned `EGRESS_BLOCKED`/403 via both `curl` and
`WebFetch`) — flagged for a human spot-check. **Lesson: don't infer which
of several similar, recently-changed things a bug report is about — confirm
the actual state (which preference was selected) before fixing.**

Prompted a direct instruction to verify *every* link route lands on the
correct company. Clarified first via `AskUserQuestion` whether that meant a
literal NASDAQ-only restriction or "the correct US company, not a foreign
lookalike" — confirmed the latter; a literal NASDAQ-only rule would have
broken routing for the many NYSE-listed tickers a real watchlist contains
(Ares Capital is incidentally NASDAQ-listed, but that's not the actual bug
class). Audited every remaining `LINK_SITES` option by design reasoning
(live verification isn't possible from this sandbox, per above): **Yahoo**
left unchanged — `finance.yahoo.com/quote/{TICKER}` resolves a bare
US-style ticker to the primary US listing by design (non-US listings need
an explicit suffix in Yahoo's own convention), and it's the app's
default/most-used option all session with zero misroute reports even
through the testing that caught the other two. **Robinhood** left
unchanged — structurally safe, since Robinhood's own product only lists
US-tradable securities at all, so there's no foreign listing a bare ticker
could resolve to on that domain. **StockTwits** left unchanged —
materially thinner international coverage than Yahoo/Google/TradingView,
lower collision risk, no reported issues. **Custom** left unchanged —
routes through whichever site the user themselves pastes an example from;
correctness there is inherently the user's own choice.

## Deploying: GitHub Pages deployments can get stuck in `queued` forever (Aug 10, 2026)

Merged `trade-verdict` PR #80 and the live site kept serving the *previous*
build after multiple hard refreshes and several real minutes — longer than
the documented ~22-minute CDN-propagation ceiling elsewhere in this file
would explain as "still propagating." Diagnosed via the GitHub Actions API
(`actions_list`/`actions_get`, workflow name "pages build and deployment"):
the deployment run for that commit was stuck at `status: queued`
indefinitely, never advancing to `in_progress`. Calling `rerun_workflow_run`
on it directly failed with `403 This workflow is already running` — it
can't be kicked back to life that way.

**Fix: push any new commit to `main`.** GitHub Pages spawns a brand-new,
independent deployment run for the new SHA — confirmed the stuck run's
`conclusion` flipped to `cancelled` the moment the new run was created, and
the new run deployed cleanly within about a minute. If a deploy seems
stuck beyond a couple of minutes, check the Actions run status (`pages
build and deployment`, filtered to `main`) before assuming it's just
propagation lag — a genuinely stuck run won't be fixed by waiting or by
hard-refreshing the browser.

Root cause unconfirmed — five PRs were merged in quick succession that
evening (roughly 10-20 minutes apart), which is the leading suspect for
GitHub Pages' deployment queue getting confused, but this wasn't proven.
If it recurs, check whether it correlates with rapid successive merges
again.

## Google Play launch (Aug 11-12, 2026) — Free tier live in Internal testing

Mr. T wanted Trade Tribunal on the Play Store. Scope agreed up front and
still in force: **no in-app purchases** — the Android app is a Trusted Web
Activity (TWA) wrapper around the Free tier only; sign-up/upgrade still
happens on the website via Stripe. Package ID `app.tradetribunal.twa`.
Starter/Pro/Shark as their own Play listings is explicitly a later,
separate decision, not started.

### PWA groundwork (Free tier only, `trade-verdict` PRs #91, #93-#97)

Added `manifest.json`, app icons generated from `shared/assets/logo-mark.png`
(`shared/assets/icons/`), and `sw.js` (network-first service worker —
deliberately not cache-first, given this file's whole cache-busting-rule
history above; a cache-first worker would reintroduce that exact failure
mode at a new layer). `sw.js` is served from the site root so its default
scope covers the *entire* origin even though only Free registers it —
fixed by having the fetch handler explicitly ignore `/starter/`, `/pro/`,
`/shark/`, `/reset/`, `/privacy/` so a network hiccup can never fall back
to serving Free's cached homepage for another tier. Also added
`/privacy/index.html` (plain-language privacy policy, required by Play
Console) and a root `.nojekyll` file (see "Domain verification" below for
why that one mattered).

### The sandbox can't reach `dl.google.com` — plan accordingly

Any sandbox/session working on this needs to know: outbound network
policy in this kind of environment blocks `dl.google.com` (where the
Android SDK itself is distributed from) and, discovered later the same
session, blocks `tradetribunal.app` too. **Both are real org policy
denials (403 from the egress proxy), not bugs — don't retry them, don't
hunt for a workaround/mirror, just route around the *need* for them
instead:**
- Can't download the Android SDK → can't run `bubblewrap build` locally →
  the actual Gradle compile has to happen somewhere with normal internet
  access. Solved with a GitHub Actions workflow (below) — Actions runners
  aren't network-restricted the way this sandbox is.
- Can't fetch `tradetribunal.app` → Bubblewrap's own `init` wizard (which
  fetches the live manifest/icons over HTTP) can't run directly either.
  Worked around by feeding it the repo's own local copies of
  `manifest.json`/icons via a throwaway `localhost` HTTP server (loopback
  traffic doesn't go through the egress proxy at all — not a policy
  workaround, just avoiding an unnecessary fetch of data already on disk).
- Bubblewrap's CLI wizard is also fully interactive (inquirer prompts)
  and doesn't handle piped/non-TTY stdin reliably. Went one layer down
  and scripted directly against `@bubblewrap/core` (the library the CLI
  wraps) — `TwaManifest.fromWebManifestJson()`, `TwaGenerator.
  createTwaProject()`, `KeyTool.createSigningKey()`,
  `DigitalAssetLinks.generateAssetLinks()` — with zero interactive
  prompts. This is a reusable pattern if Bubblewrap needs touching again
  from a sandbox like this: don't fight the CLI, use the library.

### CI build pipeline: `.github/workflows/build-android.yml`

The generated Android project lives in `android/` (gradle files,
`twa-manifest.json`, resources — **the signing keystore is deliberately
never committed**, guarded by a root `.gitignore`). The workflow
(`workflow_dispatch`-triggered, so it can be run with one tap from the
Play Console app or a phone browser, no desktop needed) sets up JDK 21 +
`android-actions/setup-android` + Node, installs the Bubblewrap CLI,
decodes the keystore from a repo secret, and runs `bubblewrap build` with
`BUBBLEWRAP_KEYSTORE_PASSWORD`/`BUBBLEWRAP_KEY_PASSWORD` env vars (the
mechanism Bubblewrap's own `build` command supports natively for
non-interactive password input), then uploads `app-release-bundle.aab` +
the signed `.apk` as run artifacts.

Getting this green took three real, separate bugs, each with a
non-obvious root cause — worth knowing all three if this workflow ever
needs touching again:

1. **`base64: invalid input` decoding the keystore secret.** The
   `ANDROID_KEYSTORE_BASE64` secret is a ~4,700-character blob;
   copy-pasting it into GitHub's secret field from a phone reliably picks
   up stray whitespace/line-wrapping. Fixed by piping through
   `tr -d '[:space:]'` then `base64 -d -i` (ignore-garbage), plus a size
   check on the decoded output that fails fast with a clear
   `::error::` message instead of a cryptic downstream failure if the
   secret is still wrong/empty.
2. **`Wrong password?` / `BadPaddingException` signing the APK, even
   with both passwords freshly re-verified correct.** Root cause,
   confirmed by reproducing locally with plain `keytool`: **PKCS12
   keystores (the default keystore type since JDK 9) do not support a
   separate key password from the store password** — `keytool` silently
   prints `Warning: Different store and key passwords not supported for
   PKCS12 KeyStores. Ignoring user-specified -keypass value.` and
   actually encrypts the private key entry with the *store* password
   regardless of what `-keypass` was given. `BUBBLEWRAP_KEY_PASSWORD`
   must equal `BUBBLEWRAP_KEYSTORE_PASSWORD` for this exact reason — not
   a workaround, the only password that was ever actually in effect.
   Also trimmed whitespace on both password secrets the same way as the
   base64 fix, in case that was compounding it.
3. Both fixes are permanent, in the committed workflow — a future
   keystore rotation just needs both secrets set to the same value.

### Domain verification (`.well-known/assetlinks.json`)

Two separate, sequential bugs, both now fixed:

1. **404 even though the file was correctly committed on `main`.**
   Root cause: no `.nojekyll` file in the repo, so GitHub Pages ran the
   site through Jekyll before publishing, and Jekyll's default behavior
   excludes dotfiles/dot-directories — `.well-known` included —
   regardless of what's actually in the repo. Added an empty `.nojekyll`
   at repo root; fixed it immediately.
2. **Sideloaded APK opened with no browser bar; the real Play
   Store-installed copy still showed one.** Root cause: Google Play
   re-signs every app it distributes with its own certificate (Play App
   Signing) — different from the keystore used to sign the uploaded
   `.aab`. `assetlinks.json` only listed the upload keystore's
   fingerprint. Fixed by extracting the actual Play-installed APK's
   certificate directly (`keytool -printcert -jarfile <apk>` — no
   Android SDK needed, works on any APK since it's a signed JAR/zip
   under the hood) and adding *that* fingerprint to `assetlinks.json`
   alongside the original one. `assetlinks.json` now lists both;
   confirmed working on a real Play-distributed install. **If the
   keystore is ever rotated, or if this ever regresses after a Play
   Console change, re-pull the actual installed APK and re-check its
   cert this same way rather than assuming the fingerprint on file is
   still right** — Play's re-signing cert is Google's to change, not
   ours to assume.

### Adaptive icon showed a white background/border (PR #97)

The installed app's icon didn't fill its home-screen badge shape the way
every other app's does — showed a white ring around it instead. Root
cause: Bubblewrap's generated `android/app/src/main/res/mipmap-anydpi-v26/
ic_launcher.xml` hardcodes the adaptive icon's background layer to
`@android:color/white`, and insets the actual icon art 8.5dp from every
edge (Bubblewrap's own template, meant to mimic WebAPK icon proportions).
Any launcher mask shape (circle, squircle, etc.) wider than that inset
shows white bleeding through. The icon PNGs themselves were already
correct (`#080C12`, confirmed by sampling their corner pixels) — only the
background layer needed fixing. Added `ic_launcher_background` (`#080C12`)
to `colors.xml`, pointed `ic_launcher.xml` at it. **Not yet bench-tested
against a rebuilt APK as of this writing** — merged but no fresh build
triggered/sideloaded yet to visually confirm.

### Keystore handling — read this before ever touching the signing key

The keystore was generated twice this session. The first one's
credentials file reportedly didn't make it into the handoff zip Mr. T
received (root cause never confirmed — this session's own local copy had
already been deleted on the assumption delivery succeeded, so the
passwords couldn't be recovered either way). Rather than debug further,
regenerated a fresh keystore from scratch, since nothing had been
uploaded to Play Console yet — zero cost to switching. **Lesson,
applied on the second handoff and worth keeping permanent: always
`unzip -l`/verify a secrets handoff archive's actual contents before
calling `SendUserFile`, and don't delete the local copy until the
recipient explicitly confirms receipt** — assumed-success was exactly
the failure mode the first time.

The live keystore's credentials are with Mr. T only (never committed,
never logged anywhere retrievable) — if this session needs to touch
signing again and doesn't have them, ask, don't regenerate a third time
now that a real Play Console app/track depends on the current one.

### Play Console submission — decisions made, still in progress

- **Not a paid app.** Confirmed with Mr. T: Free tier stays free on Play
  too — charging for what's identically free on the website would just
  add friction against the real monetization funnel (Starter/Pro/Shark
  subscriptions on the website).
- **Not a prediction markets app.** Flagged explicitly during the
  content-declaration questionnaire — Trade Tribunal doesn't facilitate
  wagers or hold funds; mischecking that box risks unnecessary
  compliance requirements or a rejected declaration.
- **Sign-in details: "No."** Free tier requires no account for any of
  its functionality; the visible Sign Up/Sign In link is an optional
  path to a different (paid, out-of-scope-for-this-app) product tier,
  not gated content within this submission.
- **Financial features declaration**: guided (not yet confirmed against
  the live questionnaire's exact wording) toward "no lending, no
  brokerage/account management, no crypto, no personalized investment
  advice" — the app gives generic pattern-based analysis with an
  explicit not-financial-advice disclaimer, not tailored recommendations.
- Accidentally toggled **"Managed Google Play"** (an enterprise/MDM
  distribution feature, unrelated to normal public Play Store listing)
  under Advanced settings — flagged to turn back off; not confirmed
  done.
- Store listing copy (short + long description), the feature graphic
  (1024×500, generated by padding — not cropping — the existing
  "Catalyst Response Framework" promo graphic to hit the exact ratio
  without losing any content), and 7"/10" tablet screenshots (this app
  has no distinct tablet layout, so these were made by resizing real
  phone screenshots to the required 9:16 dimensions rather than
  capturing on an actual tablet or emulator) have all been produced and
  handed off.
- **First-time-publisher propagation delay is real and expected**, not
  a bug: a brand-new app's first release to internal testers can take
  several hours to become fetchable from Play even after Console shows
  it as fully rolled out ("Item not found" / the native Play Store
  error, not a browser 404). Hit this twice — once for Mr. T's own
  account, once for a separate tester. Standard troubleshooting order:
  confirm the Play Store app's signed-in account matches the invited
  tester email exactly, confirm they've visited the explicit opt-in link
  (`https://play.google.com/apps/testing/<packageId>`) and tapped
  "Become a tester" (being on the list alone isn't enough), then just
  wait if both check out.
- Content rating questionnaire, final Production promotion: not reached
  yet.

### Delivering files to Mr. T when `SendUserFile` doesn't work

Discovered mid-session: whatever client Mr. T is using for this
conversation cannot render `SendUserFile` as an actual downloadable
attachment — tried both `render` and `attach` display modes, PNG and
JPEG, no luck; he only ever sees an inline (re-encoded, lower-quality)
image. **Working fallback: commit the file to a scratch branch in this
repo (a `store-assets/` folder, clearly not app code) and give him the
`raw.githubusercontent.com` URL for that branch/path** — opens as a
plain image in his phone's browser, where long-press-to-save reliably
works. Used repeatedly this session (icon, feature graphic, tablet
screenshots) — reach for this immediately for any future file handoff to
him rather than re-attempting `SendUserFile` first.

## Tier status (as of Aug 4, 2026)

| Tier | Files | Status |
|---|---|---|
| Free | `index.html` + `app.js` | Rebuilt, on shared modules, current. Its top-level "redirect a paid session elsewhere" check now actually halts the rest of module init (`redirectingToPaidTier` flag, added Aug 3, 2026) — see the testing note below for why that mattered. |
| Starter | `starter/index.html` + `starter/app.js` | Rebuilt, on shared modules, current |
| Pro | `pro/index.html` + `pro/app.js` | Rebuilt Aug 2, 2026 (trade-verdict PRs #23, #24, #26, #27, #28 + `Tra` PR #5) — on shared modules, plus Pro-exclusive Analyst View, Proxy Resolution Explorer + live coherence strip, Sector Heat Map, a CSV export (Ticker/List/Price/IV/Change%, real IV via Alpaca options snapshots), trigger/ticker track-record breakdowns, server-synced track record (Aug 4, 2026, see Frontend architecture above — Pro only), and a card/watchlist split: only the first 15 tickers (in list order) render as full analysis cards, the rest render as compact price/%chg/news rows with no ANALYZE button and no credit cost — `analyzeAll()` scopes to the 15-card window only (max 5 credits). **Confirmed working live by Mr. T**, including the IV export. Its two Shark upsell teases (Proxy Explorer, Heat Map) link to `shark/coming-soon.html` (see Shark row), not straight to Stripe checkout. Proxy Resolution Explorer and Heat Map both still iterate the full watchlist, not the 15-card window — see the Alpaca section's "known follow-ups" above. |
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
