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

**Root cause confirmed (Aug 4, 2026) — fix shipped as `Tra` PR #22
(merged/deployed same day).** `credits` had its `anon`/`authenticated`
grants put back as a live stopgap (the vulnerability above re-opened on
this one table until the fix below deployed and held — see the Aug 13
resolution below for how this closed out). Revoking `credits`'
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
same change, so a regression is easy to isolate.

**`credits` stopgap closed, Aug 13, 2026 (first pass).** A follow-up
Supabase Security Advisor email (dated Aug 9, 2026 — "Table publicly
accessible" / "Sensitive data publicly accessible", CRITICAL) turned out
to just be Supabase correctly still flagging this exact open item, nine
days after PR #22 merged and with nobody having circled back to actually
run the re-revoke it unblocked. Ran `revoke all on public.credits from
anon, authenticated;` and confirmed zero rows on the standard grants-check
query. Verified this didn't repeat the Aug 4 outage two ways: (1) a real
login against production (`turneraroundauto@gmail.com`, tier pro) came
back clean in Render logs, no `permission denied for table credits`; (2) a
real `/analyze` call immediately after deducted a credit successfully with
no error — the actual path that broke in the original incident.

**Bigger regression found the same day, same session.** Prompted by the
`credits` scare, re-ran the grants-check query scoped to all five
service-role tables instead of just `credits` — and found `accuracy_log`,
`proxy_resolution`, `pre_gate_triggers`, and `watchlists` had **all**
regained full `anon`/`authenticated` grants (`INSERT`/`SELECT`/`UPDATE`/
`DELETE`, plus `TRUNCATE` on `pre_gate_triggers` and `watchlists`) —
directly contradicting this file's own Aug 4 note that those four were
"properly revoked and never affected." `credits` alone was clean
(confirming the revoke above held), meaning something re-opened the
*other four* independently of anything done today. **Root cause
unconfirmed** — nobody had re-run this check since Aug 4, so there's no
way to tell from here whether this was a single event (e.g. a dashboard
action or a script re-granting broadly) or whether the Aug 4 "confirmed
via zero rows" fix on these tables never actually held long-term. Flagged
to Mr. T as an open question, not guessed at.

Fixed the same way as `credits`: `revoke all on public.<table> from anon,
authenticated;` run against all four, re-verified zero rows across all
five tables (`credits`, `accuracy_log`, `proxy_resolution`,
`pre_gate_triggers`, `watchlists`) in one query this time, not scoped to a
single table like the first pass was. **Given the surprise here, don't
assume this stays fixed either — re-run the full five-table grants query
periodically instead of trusting this note, the same lesson the first
regression itself just taught.**

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

## UI staging: the `/preview/` subpath convention (Aug 14, 2026)

Prompted by a direct question: since the Play Store app is a TWA (see
above) that just opens the live `tradetribunal.app` root URL rather than
bundling its own content, pushing a UI change to `main` — which GitHub
Pages deploys immediately — goes live for web visitors **and** existing
Play Store installs at the same instant. There's no built-in "preview on
web, promote to Play later" step, because Play isn't loading a separate
bundled copy to promote in the first place.

**Fix: a hidden subpath, not a separate deploy pipeline.** Real
in-progress UI work can be staged at `tradetribunal.app/preview/<name>/`
— a real deploy through the existing Pages pipeline (so relative
paths/fetches to the real `Tra` backend all behave exactly like
production), but invisible to everyone who isn't given the direct URL:
- Never linked from any tier's nav or from `/preview/`'s own placeholder
  index (`preview/index.html`).
- Excluded from `sw.js`'s fetch handler (`OTHER_TIER_PATHS`, same
  mechanism/list as `/starter/`, `/pro/`, `/shark/`) — the service worker
  never intercepts or caches anything under it.
- Disallowed in `robots.txt` — never crawled/indexed.
- **Never reached by the Play app** — the TWA's `twa-manifest.json` only
  ever opens the root URL; nothing links from there to `/preview/`.

**Deliberately not a full PR-preview-deploys pipeline.** That would mean
switching GitHub Pages' source from "deploy from branch" to "deploy via
Actions" — a real change to the currently-working live-site deploy
config, on a pipeline this file has already documented as occasionally
getting stuck (see "GitHub Pages deployments can get stuck in `queued`
forever" below) — not something to take on casually just for staging.
The subpath approach gets a real, working preview with zero changes to
how the live site actually deploys.

**How to use it for a real change:** copy the tier files being previewed
into `preview/<name>/` on a feature branch (adjust relative asset paths
as needed for the extra path depth), PR it, merge to `main` like normal
— the preview only becomes reachable at that point, but stays invisible
to everyone else per the exclusions above. Visit the URL directly to
review. Once approved, a **separate** follow-up change actually wires the
real tier's `index.html`/nav to point at the new code — that's the actual
"go live" step, not the merge that populated `/preview/`.

**Status as of this writing:** the convention and its plumbing
(`sw.js` exclusion, `robots.txt`, a placeholder `preview/index.html`
explaining the convention) are shipped. No real UI work is staged under
it yet — the Rolodex UI exploration (below) is still 100% prototype in an
Artifact, not real repo files, so there's nothing to move into
`/preview/` until that work actually gets picked up for real.

## Backend: Gate 3 Mon/Fri overlay — timezone bug fix + weekly carryover (Aug 12, 2026)

Reported live: Gate 3 kept saying "no Monday/Friday overlay." Two separate
issues surfaced back to back, one a real bug, one a framework-intent gap —
worth keeping both straight since they look similar from the symptom.

**Bug 1 — timezone, `Tra` PR #29 / `trade-verdict` PR #99 (both merged).**
The `/analyze` prompt's `Today:` weekday was built with
`new Date().toLocaleDateString(...)` and no explicit `timeZone`, so it
formatted in the server process's own timezone (UTC on Render) instead of
the Eastern trading day — same class of bug as the Gate 5 Proxy Resolution
"Last checked" date fixed earlier (`Tra` PR #28). Once it's roughly 8pm ET
or later — inside this app's own 4-8pm ET extended-hours window — UTC has
already rolled to the next calendar day, so a real **Friday-evening**
session got stamped `Today: Saturday`, and Gate 3's own rules treat
weekends as no-overlay. Fixed by anchoring to `America/New_York`, matching
every other day-of-week check in this file. **Unverified against a live
Friday-evening run** — the fix is confirmed correct by code inspection
(matches the established pattern everywhere else in this file) but not
watched end-to-end against a real deploy yet.

**False alarm along the way, same session:** a screenshot showed Gate
3/4/5 rendering horizontally in Pro's Gate Breakdown instead of stacked
like every other gate. Investigated before touching anything — the CSS
(`.gate-row{display:flex}` etc.) and the JS that builds the gate list are
from the *same* commit (Aug 2, 2026 Pro rebuild) and haven't been touched
since by anyone, including this session, which only touched `server.js`
and docs at that point. Diagnosed as stale client-side cache, not a code
regression — confirmed by the user after a hard refresh fixed it. No code
change made. Worth remembering as a live example of the cache-busting
rule's failure mode actually happening, not just a hypothetical.

**Bug 2 (really a framework-intent gap) — weekly carryover, `Tra` PR #30 /
`trade-verdict` PR #100 (both merged).** After the timezone fix, Gate 3
still said "no Monday/Friday overlay" — correctly, since it was a
Wednesday and the overlay was coded as a same-day-only flag (today must
literally equal Monday or Friday). **Corrected directly by Mr. T:** that's
not what the gate is supposed to mean. The Friday close → weekend → Monday
reaction is part of the broader week's narrative, not an isolated
same-day event, and should keep informing Gate 3 through the rest of that
week on a decay schedule — not replace the existing same-day Mon/Fri
rules, sit alongside them. Scoped via `AskUserQuestion` before touching
code: carryover persists through the week (not just a label), as an
explicit codified decay rule (not left to the model's judgment), added
alongside the same-day rules rather than replacing them.

Shipped:
- `fetchWeeklyCarryover(symbol)` — a small, **separate** dated-bars fetch
  (~10 days via Alpaca), deliberately NOT derived from `fetchDailyCloses`'s
  existing 130-day array. That array is bare closes with no dates attached
  and is explicitly commented "Do NOT date-anchor into this array; index
  positionally (sessions)" — reusing it would have reintroduced exactly
  the calendar-vs-position-counting bug class documented in the Gate 1
  Patch 4 story above. This fetch instead locates the most recent
  Friday/Monday close pair by each bar's own timestamp, robust to
  holidays. Only invoked on Tue/Wed/Thu (`carryoverDecayLabel()` returns
  null on Mon/Fri/weekend), so it adds zero extra Alpaca calls the other
  4 days of the week.
- `carryoverDecayLabel()` — Tuesday (1 session removed) = MODERATE,
  Wednesday (2 sessions) = REDUCED, Thursday (3 sessions) = MINIMAL/faded.
  Computed server-side from the real ET weekday, same "never trust the
  client for what day it is" reasoning as the `Today:` line above.
- A new Gate 3 prompt section spelling out how to weight each tier, and a
  `Gate 3 weekly carryover` context block in the `/analyze` prompt.
- `weeklyCarryover` threaded through `/ticker/:symbol`'s response and
  `refreshMarketEntry`'s cache entry, and `weeklyCarryoverData` forwarded
  by every tier's `analyzeTicker()` (including Shark's monolithic file) in
  the `/analyze` POST body — same relay pattern as `gate1Data`/`proxyRule`.
- Mirror (`trade-verdict`) needed its own version of `fetchWeeklyCarryover`
  adapted to its `alpacaGet()`'s different contract (full URL + `Response`
  object, vs `Tra`'s path-only URL + pre-parsed JSON) — not a straight
  copy-paste; flagged in the code comment so it doesn't read as accidental
  drift. Client `app.js` content changed in Free/Starter/Pro, so each
  tier's own `?v=` got bumped (`index.html` 39→40, `pro`/`starter` 40→41)
  per the cache-busting rule — these are each tier's own top-level file,
  not a shared module, so no cascade into other importers was needed.

**Explicitly flagged as needing a revisit once real data exists — this is
the reason to keep this entry around, not just a changelog note.** The
reaction-classification threshold (±0.3% Friday→Monday move = CONFIRMED_UP/
DOWN vs FLAT) and the three decay-weight labels (MODERATE/REDUCED/MINIMAL)
are this session's own reasonable-but-arbitrary calibration — Mr. T did
not specify either numerically. **Unverified against any live Tue/Wed/Thu
run** — there's no way to test this from a sandbox without real Alpaca
entitlements and an actual mid-week analysis. Once enough real Tue/Wed/Thu
verdicts have accumulated (ideally cross-referenced against
`tv_accuracy_log`/the synced track record), revisit whether: (1) the
±0.3% threshold is picking up real signal vs noise for the tickers this
app actually tracks, (2) the three-tier MODERATE/REDUCED/MINIMAL decay
curve is the right shape (vs., say, a smoother numeric decay), and (3)
Thursday's "MINIMAL — mention only to break a tie" framing is actually
how the model is using it in practice, not just how it was instructed to.

## Backend: Pre-Gate fund-ticker CIK fallback (Aug 12, 2026)

Reported live, same session as the Gate 3 work above: Pre-Gate kept
showing "No SEC CIK found for DRAM" — user pushed back directly, having
independently confirmed DRAM does have a real SEC CIK.

**Root-caused via web research, not a live SEC fetch** — this sandbox's
egress proxy blocks `sec.gov` outright (confirmed via both `curl`, 403,
and `WebFetch`, `EGRESS_BLOCKED`). Found: **DRAM = Roundhill Memory
ETF**, launched Apr 2, 2026, registered under **Roundhill ETF Trust, CIK
1976517** — confirmed via SEC's own EDGAR filing URLs directly
referencing DRAM (an 8-A Cert PDF under
`/Archives/edgar/data/1976517/.../8A_Cert_DRAM.pdf`, found via
`WebSearch`). `getCik()` only ever checked `company_tickers.json` (SEC's
primary, operating-company-oriented ticker file) — a fund this recently
launched, sharing a trust CIK with many other Roundhill funds, plausibly
isn't (yet, or ever reliably) indexed by ticker in that specific file.

**Fix (`Tra` PR #31 / `trade-verdict` PR #102, both merged):** `getCik()`
now falls back to `company_tickers_mf.json` (SEC's fund/series/class
ticker file — "mf" = mutual fund, but shares the series/class
registration structure most ETFs use) whenever the primary map misses.
Fetched **lazily** — only on an actual primary-map miss, not eagerly
alongside it — so it adds zero extra SEC call volume for the overwhelming
majority of tickers that already resolve fine. Parsed defensively (field
lookup by name against the documented `{fields:[...], data:[[...]]}`
shape, not hardcoded position) and fails safe to `null` on any shape
mismatch, same fail-safe posture as every other unverified-from-sandbox
integration in this file.

**Still unverified against SEC's actual live file** — same limitation as
above, this was researched, not fetched and inspected directly. If
`company_tickers_mf.json` genuinely doesn't cover DRAM either (plausible
for a security this recently listed), a small hardcoded ticker→CIK
override map would be a reasonable stopgap — not added preemptively,
since it's unconfirmed whether it's even needed yet.

**Expectation-setting, worth knowing before assuming this "didn't work":**
`PRE_GATE_FORMS` is `8-K,10-Q,10-K` — operating-company forms a fund like
DRAM will never file. So this fix changes DRAM's Pre-Gate note from "No
SEC CIK found" to a clean GREEN pass-through ("No solvency, dilution, or
guidance-cut language found"), **not** to an active RED/YELLOW trigger.
Pre-Gate's trigger categories are operating-company risk concepts
(insolvency language, dilutive raises, guidance cuts) that don't really
map onto a passively-tracked ETF — a quiet pass-through is the correct,
expected outcome, not a sign the fix silently failed.

**To actually confirm this landed:** analyze DRAM after `Tra` redeploys
and check the Pre-Gate note changed as described above, or check Render
logs for `getCikFromFundMap` errors.

**Follow-up, same day — the fund-file fallback did NOT work.** Confirmed
live: no change to DRAM's Pre-Gate note. User asked for further research
specifically because this could affect more tickers than just DRAM, not
just a one-off patch. Further research: `company_tickers_mf.json`'s "mf"
naming most likely means it's genuinely scoped to traditional NAV-priced
open-end mutual funds, not exchange-traded funds — DRAM was probably
never going to resolve through that file regardless of any
staleness/coverage-lag theory. Rather than ship a third unverified guess
alone, **two tiers landed together (`Tra` PR #32 / `trade-verdict` PR
#104, both merged):**
- `KNOWN_CIK_OVERRIDES` — a small, explicit, hand-confirmed map, starting
  with `DRAM → 1976517`. Guaranteed to work regardless of the tier below
  — zero risk, not dependent on any unverified parsing, immediately
  fixes the actually-reported ticker.
- `getCikFromEdgarSearch()` — SEC's own **live** company/ticker search
  (the same mechanism that powers EDGAR's search box itself), queried
  only when every static file above misses. Hits SEC's current database
  directly instead of a periodically-cached snapshot, so it should catch
  future new listings without needing a hardcoded entry added for each
  one. SEC's classic `browse-edgar` endpoint accepts a ticker directly in
  its `CIK` parameter (well-documented, long-standing SEC behavior), atom
  output wraps a match in a `<company-info><cik>` element. **Still
  unverified against a live response** — `sec.gov` remains unreachable
  from this sandbox — parsed defensively (primary `<cik>` tag match, a
  `"CIK#:"` label fallback deliberately narrow enough not to false-positive
  on an echoed `CIK=` query string) and fails safe to `null`.

**Lesson for next time this pattern comes up:** when a fix depends on
unverifiable assumptions about an external data source's exact coverage/
format and there's no way to test it live, pair the speculative general
mechanism with a small, guaranteed, hand-confirmed override for the
specific case actually reported — don't stake the whole fix on one
untested guess a second time. Check Render logs for
`getCikFromEdgarSearch` errors to see whether the general tier is
actually working for tickers beyond DRAM.

## Backend/Frontend: Pre-Gate robustness — wider SEC form coverage + de-emphasized GREEN UI (Aug 12, 2026)

Follow-up to the DRAM CIK saga above, prompted by a direct design
question: is Pre-Gate actually a robust pre-check, and — since a GREEN
result is the overwhelming common case and mostly redundant info — should
it sit in the background unless it actually finds something. Two
separate, independent fixes landed together.

**Coverage gap, `Tra` PR #33 / `trade-verdict` PR #106 (both merged).**
`PRE_GATE_FORMS` was `8-K,10-Q,10-K` only — an operating-company-
disclosure view. Real gap for the "dilution" trigger category: an ATM
program, shelf registration, or registered-direct offering is disclosed
via a registration statement (S-1/S-3) or its prospectus supplement
(424B2/3/4/5), and doesn't always also get a fresh 8-K — especially a
periodic draw under an ATM program already set up under an existing
shelf. Widened to
`8-K,10-Q,10-K,S-1,S-3,424B2,424B3,424B4,424B5`; benefits the
solvency/guidance-cut categories too, since a going-concern risk factor
can show up in a new S-1's risk factors section, not just 10-K/10-Q.
**Still open, not touched by this pass:** the trigger keyword table
itself (`PRE_GATE_TRIGGERS`) is still explicitly flagged in its own code
comment as "first draft, needs review, tune against real false-
positive/negative rates" — this pass only widened which forms get
searched, not the keywords being searched for.

**UI de-emphasis, `trade-verdict` PR #106 only (Tra has no frontend).** A
GREEN Pre-Gate was rendering with the exact same visual weight — full
row, label, status, note text — as every substantive gate below it, even
though it's almost always just "nothing to see here." Now collapses to a
single compact, muted row ("PRE-GATE clear") when GREEN; YELLOW/RED still
render at full prominence with their note text, unchanged. Implemented
with a reference-equality check against `data.gates.pre_gate` (not
label-string matching or an array index), so the special-casing can't
silently apply to the wrong gate if the array order ever changes. Applied
identically to Free/Starter/Pro — Shark's old monolithic template doesn't
render Pre-Gate at all, so nothing to touch there. Bumped each tier's own
`app.js` `?v=` since its content changed (`index.html` 40→41,
`pro`/`starter` 41→42) per the cache-busting rule.

**Actually verified this time, not just simulated:** ran a real headless-
Chromium smoke test (Playwright) rendering both a GREEN-Pre-Gate card and
a RED-Pre-Gate card side by side against the real extracted CSS —
screenshot confirmed the GREEN row visibly collapses/dims while RED stays
full-weight and every other gate renders unaffected regardless of its own
status. A first-pass Node-only logic simulation (no browser) also passed
before that. The SEC form-widening half is still unverified against live
data, same limitation as the rest of Pre-Gate's SEC integration — watch
Render logs / real analyses for any change in trigger rate on tickers
known to have run ATM programs.

## Backend: Proposal 4 — Context-Weighted Gate 2 Corroboration (Aug 13, 2026)

Landed from the Notion Build Log's "Formal Rule Proposals" section (`Tra`
PR pending / `trade-verdict` PR pending, mirrored per the two-repo rule).
Session Context (the free-text textarea every tier's client already sends
as `marketContext`) previously had zero backend awareness at all — purely
a client-side keyword-highlight cosmetic (`shared/context-highlight.js`),
with zero influence on the actual verdict. It's now checked against three
independent corroboration sources; **≥2 of 3 agreeing** promotes it to a
`CONTEXT-CORROBORATED` modifier that both the prompt (Gate 2 Step 5) and
the response carry — the LLM is told to weight it as real Gate 2 evidence
only when corroborated, and to treat it as informational-only otherwise.

**No separate credit cost** — folds into the existing per-analysis charge,
per the proposal's own scoping. All four tiers were already sending
`marketContext`, so no frontend change was needed to enable it on Free —
the proposal's "first Free-tier use" framing turned out to already be true
in the current code by the time this was picked up.

**The three sources (`gates-extended.js`, section 6 — `contextTextMatches`,
`buildupPatternCheck`, `corroborateSessionContext`; fetches live in
`server.js`):**
1. **News-content match** — full-body article text (Alpaca `content`/
   `summary`, Finnhub `summary`), matched against the typed context using
   the *exact same* 2-distinct-word-overlap heuristic as
   `shared/context-highlight.js`'s `highlightContextMatches()`, kept in
   lockstep on purpose so "corroborated" and "highlighted" never silently
   disagree. `newsData` (already on the request) is headline-only and too
   short for this, so a new `fetchNewsBodiesForCorroboration()` re-queries
   both sources — only when Session Context is non-blank, so it adds zero
   extra Alpaca/Finnhub call volume on every other analysis.
2. **Gate 3 buildup pattern** — per the proposal's own definition
   (sustained volume 1.5x+, sector-proxy outperformance, no fresh material
   news yet priced, clean earnings-reaction history). The last of those has
   no data source anywhere in this app — no per-ticker earnings-reaction
   history is tracked — so it's deliberately omitted rather than faked;
   `buildupPatternCheck()` requires every one of the *other three* signals
   that's actually computable to agree, and at least 2 of 3 to be
   computable at all, so one lone signal can't carry the pattern alone.
   "Outperformance" is read as magnitude (`|tickerPct| > |proxyPct|`), not
   direction — the intent is "something ticker-specific is happening,"
   not a bull/bear call.
3. **Real dated calendar event** — new `fetchEarningsCalendarFlag()`,
   silent/boolean only against Finnhub's existing `/calendar/earnings`,
   routed through the shared `finnhubThrottle()`. Same lazy/only-on-real-
   context-input posture as source 1.

**A real pre-existing bug found and flagged, not fixed, while building
this.** The buildup pattern's outperformance signal needs the ticker's own
same-session % move and its Gate 5 proxy's % move as numbers. The existing
Proxy Coherence Check (Proposal 2, already shipped) reads exactly those
same two values via `metricsData?.pct` and `sectorContext?.tsm?.pct` — but
every tier's client-side `analyzeTicker()` only ever sends
`sectorContext[symbol]` as the formatted `.change` **string** (e.g.
`"+1.23%"`), never a raw `.pct` number, and `metricsData` (built server-side
in `/ticker/:symbol`) never carries a `.pct` field either. Both conditions
are therefore always false in production, meaning **the Proxy Coherence
Check's coherence-comparison branch has never actually executed** —
`/analyze` always falls through to the plain forceDown `else` branch
instead. This predates this session's work and wasn't introduced or
touched by it; flagged here rather than silently fixed, since Proposal 2
wasn't in this pass's scope and changing live forceDown behavior deserves
its own deliberate pass. This new feature avoids the same trap by parsing
the ticker's move from `openingBarData`'s own bar-1 open→close and the
proxy's move from `sectorContext`'s change strings directly (via a new
`parsePctString()` helper), both of which are actually populated.

**Explicitly out of scope for this pass, per the proposal itself:** Gate 4
phase-sizing influence (stays Gate 2-only); a Shark-tier visible earnings-
calendar feature (the proposal's own earnings-calendar fetch is reusable
for that later, but it's a separate future feature). Also not done this
pass, as a deliberate scope call rather than an oversight: the proposal's
"recommend logging every corroborated-vs-uncorroborated event to
`accuracy_log`" suggestion — that table is currently Pro-only
(`shared/track-record-sync.js`) and wiring a new event type into it is a
real follow-up, not a one-line addition.

**Unverified against live data** — same posture as every other
sandbox-built integration in this file: Alpaca's `content` field on
`/v1beta1/news` and Finnhub's `/calendar/earnings` response shape are both
implemented from documented shapes, fail safe (empty array / `null`) on
any mismatch, and haven't been confirmed against a real response. Node-only
logic simulation of `contextTextMatches`/`buildupPatternCheck`/
`corroborateSessionContext` passed before shipping (see git history), but
that only proves the pure logic, not the live fetches. To confirm after
deploy: type real Session Context on a ticker with known matching news and
check the Gate 2 card's note for the `[Session Context: CONTEXT-
CORROBORATED, N/3]` tag; check Render logs for `fetchNewsBodiesForCorroboration`/
`fetchEarningsCalendarFlag` errors.

## Backend: Gate 5 forceDown was silently unreachable — evaluateProxyStatus data-shape bug (Aug 13, 2026)

Follow-up to the "dead code" note flagged while building Proposal 4 above.
Went to fix what was described there as "the Proxy Coherence Check
(Proposal 2) never runs" and found the actual root cause is bigger than
that framing suggested — **worth reading even if you only care about
Gate 5, not Session Context.**

**The real bug.** `evaluateProxyStatus()` (the function `/analyze` calls to
compute `gate5Result.status` — literally what the Gate 5 card badge shows,
and the gate behind Proposal 1/2/3's whole forceDown-authority mechanism)
reads `marketData[symbol].pct` and `.change` off each proxy symbol,
expecting an object. But every tier's client (`app.js`'s `sc` object in
`analyzeTicker()`) only ever sends `sectorContext[symbol]` as the
**formatted `.change` string** (e.g. `"+1.23%"`) — never an object, never a
raw `.pct` number. `.pct` on a string is always `undefined`, so `avgPct`
was always `0` and `anyRedFlag` was always `false`. Confirmed directly: fed
the real function a real `-6.20%` TSM string (the actual Jul 29, 2026
KOSPI-crash-scale move referenced in Proposal 2's own writeup) and it
returned GREEN.

**What this actually means:** Gate 5's RED (and YELLOW) status has never
been reachable through `/analyze`, for any ticker, regardless of how far
the resolved proxy has actually moved. Not "the coherence check's extra
confirmation step doesn't run" (a narrower, safer-sounding framing) —
**the whole Gate 5 hard-trigger path (Proposal 1's forceDown authority,
Proposal 2's coherence check) has been unreachable dead code since it
shipped.** `/analyze` always fell through to whatever Gate 2/Gate 0 alone
implied. Gate 0 (SPY/QQQ) is unaffected — it reads a pre-computed
`gateStatus` string the server already resolved correctly server-side
before the client ever sees it, a different code path entirely.

**Fix (`Tra` PR pending / `trade-verdict` PR pending, same PRs as
Proposal 4 above, one merge for both):**
- New `normalizeMarketReading()` parses the real string wire format via the
  `parsePctString()` helper Proposal 4 already added, while still accepting
  a real `{pct, change}` object (lenient superset, not a breaking change —
  nothing that already passed objects here stops working).
- `evaluateProxyStatus()` now uses it, so Gate 5 RED/YELLOW actually fires.
  Verified: the same `-6.20%` TSM string now correctly returns RED.
- Fixed a second, smaller latent bug in the same function while it was
  already open: `changeStr`'s label re-indexed the post-filter `readings`
  array against the pre-filter `symbols` array, which mislabels a reading
  whenever an earlier symbol in a multi-symbol rule (the TSM+KOSPI combined
  rule) fails to resolve. Symbol and reading are now kept paired together.
  Verified with a KOSPI-missing/TSM-present case — correctly labels "TSM",
  not "KOSPI".
- The Proxy Coherence Check (Proposal 2) call site had the identical shape
  bug one level up (`metricsData?.pct`/`sectorContext?.tsm?.pct`, both
  always null) — fixed to use `tickerPct`/`proxyPct`, the same two values
  Proposal 4's buildup-pattern check needed, now computed once and shared
  by both rather than duplicated. `tickerPct` comes from `openingBarData`'s
  bar-1 open→close (not `metricsData.pct`, which never existed); `proxyPct`
  comes from parsing `sectorContext`'s change strings (not
  `sectorContext.tsm.pct`, which never existed either).

**Verified by simulation, not yet by a live deploy** — same posture as
everything else unverifiable from this sandbox. Ran the real
`evaluateProxyStatus`/`proxyCoherenceCheck` code (extracted, not
reimplemented) against: a real crash-scale string (`-6.20%` → RED,
previously GREEN), a mild move (`-1.50%` → YELLOW), a flat move (`+0.20%`
→ GREEN), a multi-symbol rule with one missing symbol (label pairing
correct), and the still-supported object shape (backward compatible). The
downstream coherence check was also run with the fixed `tickerPct`/
`proxyPct` and produced a real Case 1 "DOWN — proxy confirmed" result. To
confirm live: watch for a real Gate 5 RED card during an actual TSM/KOSPI
move of 3%+ (previously impossible to see at all), and check that its note
reads `TSM -X.XX%` with a correctly-labeled multi-symbol proxy if one ever
applies.

## Backend: Proposal 3 — Fixed-Proxy Regime Validation, weekly persistence (Aug 13, 2026)

Bridges the gap flagged in the Proposal 4/Gate 5-bug sessions above:
`gates-extended.js`'s `regimeValidation()`/`resolveFixedProxyBreak()` have
existed since Patch 4 (Jul 29, 2026) but were never wired into `/analyze` —
the code literally said so (`const regime = null; // Proposal 3
(regimeValidation) is NOT wired yet — it needs its own weekly-cadence
persistence layer`). This lands that persistence layer and wires it up.

**Why it needed its own persistence, not just a function call.**
`regimeValidation(tickerCloses, proxyCloses)` needs ~41 days of daily
closes for both the ticker and its fixed proxy (TSM) to compute a
rolling-20-day vs. full-history correlation. Recomputing that on every
single `/analyze` call would be wasteful — same reasoning that already
gave the *quarterly* Dynamic Proxy Resolution (Patch 2) its own
`proxy_resolution` table. This is the same shape, at a weekly cadence.

**What shipped (`supabase-ddl-patch9-proxy-regime.sql`, new
`proxy_regime_state` table — same two-step RLS-disable + explicit
`revoke` pattern every service-role table here uses; `Tra` +
`trade-verdict` mirror, same PRs as Proposal 4/the Gate 5 bug fix above):**

- `getCachedRegimeState()`/`saveRegimeState()` — mirror
  `getCachedProxyResolution()`/`saveProxyResolution()` almost line for
  line, `REGIME_RECOMPUTE_MAX_AGE_MS` = 7 days instead of 90.
- `resolveProxyRegime(symbol, tickerCloses)` — on a cache miss, fetches
  TSM's own closes (`fetchDailyCloses("TSM", 130)`, the one extra Alpaca
  call this adds, at most once a week per gated ticker) and calls
  `gx.regimeValidation()`; reuses the ticker's own `dailyCloses`
  (`refreshMarketEntry` already fetches it for Gate 1 — no extra fetch for
  that half).
- **Wired into `resolveGate5()` itself, not just consumed downstream.**
  `resolveGate5` now takes a 5th `regime` param: when the ticker's static
  classification is the fixed Taiwan/Korea rule AND its regime state is
  `BROKEN`, it skips the static early-return and falls through to the
  Dynamic Proxy Resolution Algorithm below — exactly like a `DEFAULT_PROXY`
  (ambiguous) ticker would. This is the "graduates into the dynamic system,
  triggered by breakdown instead of onboarding" fallback the proposal
  describes, not just a passive flag. `refreshMarketEntry()` computes
  `regime` *before* calling `resolveGate5` (via a cheap, pure
  `classifyTicker()` check) so both share one value instead of resolving it
  twice. Every other static category (Biotech/XBI, Defense/LMT, etc.) has
  no regime tracking — `regime` is always `null` for them, so this is a
  no-op outside Taiwan/Korea-gated tickers, and defensively checked on
  `staticRule.category === "AI/Semiconductor"` inside `resolveGate5`
  itself, not just relied on via how it happens to be called today.
- `regime` threaded through `/ticker/:symbol`'s response and
  `symbolMarketCache`, and `regimeData` forwarded by every tier's client
  `analyzeTicker()` in the `/analyze` POST body — same relay pattern as
  `gate1Data`/`weeklyCarryoverData`. The hardcoded `const regime = null;`
  in `/analyze` is now `const regime = regimeData || null;`.
- **DEGRADING's "coherence check becomes mandatory" requirement needed no
  new code.** The Proxy Coherence Check already runs unconditionally for
  every Taiwan/Korea-gated ticker whenever Gate 5 reads RED (guarded only
  by `tickerGating.length`, not by regime state) — so once the Gate 5
  data-shape bug fix above made `tickerPct`/`proxyPct` actually populate,
  the coherence check was already "mandatory" in practice for every
  DEGRADING (and INTACT) case. `hasForceDownAuthority()`'s
  `requiresCoherenceCheck` flag is returned but not separately consumed —
  nothing left for it to gate that isn't already happening.
- **BROKEN correctly suspends blind forceDown.**
  `hasForceDownAuthority()` returns `authorized: false` on a BROKEN regime,
  so `/analyze`'s existing "not independently exempt" fallback path
  applies — the ticker needs 2+ RED gates for DOWN, same safe degrade
  already used for a decoupled/lagging Coherence Check result. No new
  `/analyze`-level branching was needed for this either — routing through
  `resolveGate5` already handles the actual re-resolution.
- Free/Starter/Pro's client `app.js` and Shark's monolithic file all had
  `regimeData:td&&td.regime?td.regime:null` added to their `/analyze` POST
  body, mirroring `weeklyCarryoverData`'s pattern exactly. Each tier's own
  `app.js` `?v=` bumped per the cache-busting rule (`index.html` 41→42,
  `pro`/`starter` 42→43) — these are each tier's own top-level file, no
  cascade needed. Shark's `index.html` has no separate versioned `app.js`
  (still monolithic), so no `?v=` bump applies there.

**Verified by simulation, not a live deploy** — same posture as
everything else unverifiable from this sandbox. Ran the real
`resolveGate5` branching logic (extracted) across every regime state
(null/INTACT/DEGRADING/BROKEN) for a Taiwan-gated ticker, confirmed
`BROKEN` is the only one that falls through to dynamic resolution, and
confirmed a `BROKEN` regime on a *non*-Taiwan/Korea ticker (shouldn't ever
happen given how it's called, but checked defensively) is correctly
ignored. Also ran `gx.regimeValidation()` against a synthetic perfectly-
correlated series (→ INTACT) and one with the last 20 days deliberately
decorrelated (→ DEGRADING, `REQUIRE_COHERENCE_CHECK`), and confirmed
`hasForceDownAuthority()` responds correctly to all three states plus
`null`. To confirm live: watch Render logs for `resolveProxyRegime`/
`getCachedRegimeState`/`saveRegimeState` errors, and check
`proxy_regime_state` actually accumulates rows for AI/Semiconductor-gated
tickers (IREN, CIFR, etc.) after a week of real traffic. **BROKEN is
expected to be rare** — `gates-extended.js`'s own `regimeValidation()`
docstring already flags that correlations tend to *converge* under market
stress, so this is a calm-market detector, not something likely to fire
during an actual crisis; don't read an absence of BROKEN states as proof
this isn't working.

## Frontend: collapsing-card UI exploration — not built, but a reusable lesson (Aug 13, 2026)

Separate from the backend work above (Proposal 3/4, Gate 5 bug fix — all
shipped, merged, live). This is a design exploration only — **nothing
below is in the deployed app** — kept here because the lesson it produced
is worth not re-learning the hard way on future UI work.

**The ask:** Mr. T wants the watchlist to stop being a plain scroll —
too easy to lose the Gate status once you've scrolled down into a big
watchlist, especially in the first 60 minutes when he's re-checking it
often. Explored via a live interactive prototype (Artifact, not real
app code), iterated through several rounds directly against his phone,
not just described.

**Round 1:** built a 3-way comparison — Accordion (tap one ticker open,
opening a new one closes the last), Scroll-collapse (cards auto-expand/
collapse as they cross the top of the viewport), and Rolodex (one ticker
fully open at a time, swipeable stack, horizontal chip index). **He
picked Rolodex.**

**Rounds 2-6, the actual lesson:** refining Rolodex into a real design
(Gate docks into a pinned strip as you scroll, watchlist chips pin under
it, tap a chip to load that ticker's full analysis) hit the same failure
mode three separate times, confirmed live on his device each time, each
attempt making it worse, not better:
- Round 3: Gate collapsed via an animated `grid-template-rows` transition,
  triggered by an IntersectionObserver watching scroll position. Result:
  "very jumpy."
- Round 4: removed the animation, made the collapse instant, on the
  theory that the animation was fighting the scroll gesture. Result:
  worse — "not scrolling at all, just jumps."
- Round 5: kept the sticky element's own layout height perfectly
  constant (never animated OR instantly changed) and faked the visual
  collapse with an absolutely-positioned overlay + opacity crossfade,
  reasoning that literally zero layout change during scroll should be
  bulletproof. Result: still worse — "gate doesn't scroll up, it's just
  pinned full open."

**The actual conclusion, confirmed by three different techniques all
failing the same way:** on his real device, changing a `position:sticky`
element's rendered height reactively while the user is actively
touch-scrolling breaks scroll tracking — animated, instant, or disguised
behind an opacity fade, it doesn't matter, all three are still "the
sticky element's box changes shape while a scroll gesture is in
flight," and that's what's fragile, not any one implementation detail
of how the change was expressed. This wasn't diagnosable by reasoning
about the CSS alone — it only showed up against live touch scrolling on
an actual phone, not in any static review of the code.

**Round 6, what actually worked:** stopped trying to auto-collapse the
Gate from scroll position at all. Made it sticky (always pinned, height
never changes, ever) with a plain **tap** to expand/collapse — the exact
same accordion mechanic already used by the Pulse/Session Context/
Import cards elsewhere on the page, which had zero issues through every
round of this because nothing about a tap-driven accordion depends on
scroll position in the first place.

**Rule for next time this class of feature comes up:** if a UI element
needs to visually "dock" or "collapse" as part of scrolling, don't
reach for scroll-position-driven height/layout changes on a sticky
element — that's the fragile pattern, confirmed three independent ways
on real hardware in this session, not a one-off bug in any single
attempt. Prefer either (a) a plain tap/click toggle, which is what
actually shipped here, or (b) if a true scroll-linked motion is a hard
requirement, drive it through `transform`/`opacity` exclusively (never a
property that changes layout — height, padding, grid-template-rows) and
test on a real device before considering it done, not just in a desktop
browser resize.

**Status as of this writing (superseded by the Aug 14 follow-up directly
below — kept for the history):** Mr. T asked to go back to the Round 1
3-way comparison and restart the decision from there with this lesson
in hand — Round 6's tap-based Rolodex refinement is not the final
direction, just the point where the scroll-jank chase stopped. Nothing
from any round has been built into the real app (`index.html`/`app.js`/
etc.) — this is 100% prototype, parked in an Artifact, not a repo file.

## Frontend: collapsing-card UI exploration — Rolodex finalized, still 100% prototype (Aug 14, 2026)

Direct continuation of the session above, same Artifact
(`https://claude.ai/code/artifact/a4c3fd53-111b-4c05-8e71-ddaf59f8b878`),
same rule applies — **nothing in this section is in the deployed app.**
Restarted from the Round 1 3-way comparison as planned, then Mr. T
picked Rolodex again and this time confirmed it as final: **"this
roladex is the only option we're sticking with, you can remove the
others."** Accordion and Scroll-collapse (including their dead code —
`setPlainMode`, the `IntersectionObserver` scroll-collapse branch,
`#plainList`, the mode-switcher UI, `cardHeadHTML`/`cardBodyHTML`/
`chevronSVG`) were fully removed from the prototype, not just hidden —
Rolodex is what the page loads into now, no picker.

**Misinterpretation caught and corrected: "gate tickers" meant the
Gate's own market indices, not the watchlist.** Asked to make "the gate
tickers auto scroll horizontal — only when it's collapsed," first pass
wired the auto-scroll marquee onto the wrong element (the watchlist chip
strip, `#roloIndex`) instead of the Gate's own SPY/QQQ/BTC/etc. row.
Corrected directly: *"you scrolled the wrong tickers, the top gate
tickers are supposed to scroll not the watchlist pills, but I kinda like
that too if it had price with them also."* Fixed by adding a second,
separate marquee (`#gateMarquee` / `GATE_INDICES`, docked-only) for the
Gate's own indices, and keeping the watchlist marquee as a distinct,
intentional feature — enhanced with each pill now showing price next to
its symbol (`.rc-price`), per the second half of that same correction.

**Watchlist pills, several rounds of direct correction, in order:**
1. **Card switching restricted to pill-tap only.** *"I don't want the
   tiles to cycle up with the scroll... only analyze when you tap the
   pill."* Removed swipe (touchstart/touchend) and mouse-wheel paging on
   the Rolodex stage, and removed the prev/next buttons entirely — a
   tap on a pill in `#roloIndex` is now the only thing that changes
   which ticker's card is open, full stop.
2. **Manual drag re-enabled, then a real bug in doing so.** Asked to
   let the pill strip "also manually scroll" even while its own marquee
   is auto-scrolling. First attempt paused the marquee via a boolean
   flag set `true` then immediately `false` around the marquee's own
   `scrollLeft` write — broke on his phone: *"it move extremely slow .5
   mm jump."* Root cause: browsers dispatch `scroll` asynchronously, so
   the flag was already back to `false` before the marquee's own scroll
   event arrived, and every single frame's own 0.5px nudge was
   misread as a manual scroll and instantly re-paused itself for 1.8s —
   moves a hair, stalls, moves a hair, stalls. Fixed by comparing the
   scroll event's actual `scrollLeft` against the value the marquee
   itself last wrote (state comparison), not a timing-dependent flag —
   immune to the async-dispatch race by construction.
3. **Pills recolored by real performance, not the AI verdict.** *"all
   pills need the performance red/green color frame and font with dark
   grey background color, make the one pill that is selected background
   red or green depending on performance and font the background
   color."* Added a `chg` (day % change) field per ticker, independent
   of the existing `verdict` field (up/down/flat/pending) — a flat or
   pending-analysis ticker still has a real day move, so it still gets a
   real green/red read instead of falling back to neutral. Selected pill
   inverts: solid green/red fill, text set to the same dark grey every
   other pill uses as its own background.
4. **Marquee changed to run continuously, not gated on the Gate.**
   *"I don't remember the pills not scrolling horizontal until the gate
   starts... make the pills scroll horizontal all the time."* The
   `gateCard.classList.contains("docked")` condition gating
   `stepRoloMarquee` was dropped — it now runs from page load. Also
   removed a now-conflicting bit of logic that scrolled a newly-tapped
   pill into view, but only while the Gate was *not* docked (to avoid
   fighting the marquee mid-animation) — now that the marquee always
   runs, that scrollIntoView would fight it constantly, so it was
   dropped in favor of just the `.active` color highlight.

**Pulse/Session Context/Import now dock under the Gate too, in order,
as you scroll.** Previously these three scrolled off normally. Now each
is its own `position:sticky` element (`#card-pulse`/`#card-context`/
`#card-io`, descending z-index 19/18/17, below the Gate's 20) with a
`top` offset computed in JS (`updateStickyOffsets()`) as
`GATE_DOCKED_H` plus the real height of every card ahead of it — so the
stack grows underneath the Gate's 44px docked bar like a second, third,
fourth pinned bar, in Pulse → Context → Import order. Each card's own
height is computed from its head's real rendered height plus (if
expanded) its body's `scrollHeight` — readable immediately on tap
without waiting for the `.22s` accordion transition to settle, since
`grid-template-rows:0fr` only clips the grid track, not the child's own
layout box. This is deliberately **not** the same failure pattern as
the Aug 13 Gate scroll-jank lesson above: nothing here changes a sticky
element's height reactively *during* a scroll gesture — the accordion
expand/collapse is tap-triggered same as it always was, sticky
positioning just responds to that afterward, which is the safe
"(a) plain tap toggle" option that lesson already called out.

**A real bug caught by headless-Chromium pixel measurement, not just
eyeballing.** First version of `updateStickyOffsets()` summed each
card's head height + body `scrollHeight` only, which undercounts the
outer `.card`'s own 1px top + 1px bottom border — caught as a 2-3px
overlap between Pulse and Context once Pulse was expanded, via a real
Playwright script that measured `getBoundingClientRect()` on each
card and printed the actual gaps, not just a screenshot glance. Fixed
by adding `getComputedStyle(card).borderTopWidth +
borderBottomWidth` into the height sum. Re-verified the same way with
all three cards expanded simultaneously (the worst case) — sub-pixel
gaps only, invisible in practice. Worth repeating as a technique: for
any future layout-math change like this (cumulative offsets, stacked
sticky elements), measure real rendered rects in a headless browser
before calling it done — this bug was real and would not have been
caught by reading the code or a single screenshot.

**Collapsed row height, tightened twice on direct feedback.** First
pass shaved a flat 3px off the existing padding. Mr. T: *"I still think
the collapsed cards can get a lot shorter still, like the same height
as the collapsed gate."* Rebuilt `.card-head` to share the literal
`--gate-docked-h` CSS variable (fixed height, no vertical padding, flex
`align-items:center`) instead of guessing another padding number — so
Pulse/Context/Import's collapsed rows are now pixel-identical to the
Gate's own docked height and will track it automatically if that value
is ever changed.

**Import/Export split: Export is leaving, Import was missing its own
input.** Mr. T: *"the import is missing the input window. remove the
export button and write a print to add it to the profile badge
drop-down."* Renamed the card to plain "Import," added the ticker-entry
textarea it was missing (matching the existing `.ctx-box` style used by
Session Context), and removed the Export CSV button outright. Left a
code comment flagging that Export should move into a profile/account
badge's dropdown instead — **not built here**, since this prototype has
no profile badge component at all yet (the "72 CREDITS" chip is the
closest thing to one); that placement is a real-app decision for
whenever this actually gets built, not something to mock up inside an
exploration prototype.

**Superseded by the real build below — kept for the history.** At the
time this was written, every item above lived only in the Artifact;
nothing in `index.html`/`starter/`/`pro/`/`shark/`/`shared/` had changed.

## Frontend: Rolodex UI built for real, staged at `/preview/rolodex/` (Aug 14, 2026)

Asked directly to build the finalized Rolodex prototype for real and
merge it to the live site's hidden `/preview/` staging subpath (see "UI
staging: the `/preview/` subpath convention" above) — not into any real
tier's actual nav yet, per that convention's own intended use.

**Scope: Free tier's feature set, as its own fully standalone page —
`preview/rolodex/index.html` + `preview/rolodex/app.js`.** Free was
picked as the pilot (simplest surface: no card/watchlist split, no
Analyst View/Proxy Explorer/Heat Map) without asking first, since the
whole point of `/preview/` is that a wrong guess costs nothing — it's
reviewed before it ever touches a real tier's nav either way.

**Real backend, real data, zero coupling to `shared/watchlist.js`.**
The page calls the real `/market`, `/ticker/:symbol`, `/analyze`, and
`/status` endpoints with the exact same request shapes and auth pattern
(`authH()`/`addSecret()`, `tv_session`) as Free's real `app.js` — so
credits, sign-in state, and the Gate all behave exactly like production.
It reuses `shared/ticker-cache.js` (pure data-fetching, no DOM coupling,
safe the same way every tier already shares it) but deliberately
**reimplements** watchlist state and all rendering standalone rather
than touching `shared/watchlist.js` — that file is what every real tier
imports, and its rendering functions are tightly coupled to the old
`.card-wrap` DOM shape the Rolodex replaces. Keeping this page 100%
self-contained means it can be merged straight to `main` with zero risk
to Free/Starter/Pro, matching the whole reason `/preview/` exists.

**A real, visible cost, disclosed on the page itself:** tapping ANALYZE
here spends a real credit, from the real account if signed in or the
shared anonymous weekly pool if not — same backend, same credit system,
not a sandboxed copy. A banner says so at the top of the page.

**One safety measure beyond what production itself does:** if a paid
(`tier !== 'free'`) `tv_session` is present, this page never reads or
writes the shared `tv_wl` localStorage key — it falls back to Free's
hardcoded default tickers (`MU`/`IREN`/`ALAB`) in-memory only. Real
`/analyze` calls still use the real signed-in account (auth doesn't
depend on which tickers are shown), but the watchlist itself can't be
corrupted by Free's 3-ticker cap the way `app.js`'s own
`redirectingToPaidTier` guard exists to prevent elsewhere — a redirect
would defeat the entire point of a preview page, so this does the
narrower thing that actually matters instead: never touch the shared key.

**Two real bugs found and fixed by actually testing it, not just
porting the prototype's code:**
1. **Overlay height measured before it had real content.**
   `sizeGateSpacer()` (reserves scroll room for the Gate's full-detail
   overlay) ran once at page load, while the overlay still held
   placeholder text and an empty grid — before the async `/market` fetch
   populated the real 3×4 stat grid. Once real data landed, the overlay
   grew taller than the spacer had reserved, so it visually (and
   interactively — Playwright's own click failed with "element intercepts
   pointer events") covered the Sector Pulse and Session Context cards
   sitting right below it. Fixed by re-running `sizeGateSpacer()` after
   `renderGate()` populates the grid, not just once at init — same root
   cause as the border-height measurement bug from the Aug 13 prototype
   work: measure the real rendered content, and re-measure whenever that
   content can change size.
2. **The whole page scrolled instead of `#scroller`.** The prototype's
   sticky/dock/marquee mechanism only worked because it lived inside a
   fixed-`height` `.device` phone-mockup frame; this build correctly
   dropped that frame (it's not meant to look like it's inside a phone
   mockup) but kept `.app-shell{min-height:100vh}` — `min-height` doesn't
   constrain, so once content exceeded the viewport the *page* scrolled
   natively and `#scroller`'s own `overflow-y:auto` never activated,
   silently breaking gate-docking entirely (`scroller.scrollTop` stayed
   `0` no matter how far down the page you were). Fixed by changing
   `.app-shell` to a real `height:100vh`/`100dvh`.

**Verified, not assumed — same headless-Chromium discipline as the Aug
13 prototype work:** a real local static server + Playwright, confirmed
via `getBoundingClientRect()` (not just a screenshot glance) that Pulse/
Context/Import all render at sane, non-overlapping positions; confirmed
the Gate actually docks on scroll after the height fix; confirmed
tapping a pill switches the open card and highlights the right pill;
confirmed the utility-card accordion expand/collapse correctly reflows
the sticky stack beneath it; confirmed ANALYZE degrades to a visible
inline error with zero thrown JS exceptions when the backend is
unreachable (expected in this sandbox, same limitation documented
throughout this file); confirmed Import correctly blocks at the
3-ticker cap with the same upgrade alert Free's real `app.js` shows.
**Not verified:** a real end-to-end `/analyze` call against live
credentials (this sandbox can't reach `tra-zacg.onrender.com` — same
standing limitation as everywhere else in this file) — check Render
logs or just try it live to confirm the real request/response round
trip once this deploys.

**Explicitly not done in this pass (superseded in part below):**
Starter/Pro's own versions of this build. Actually wiring any of this
into a real tier's `index.html`/nav — that's a deliberate next step
requiring an explicit go-ahead, not a side effect of merging to
`/preview/`.

## Frontend: Rolodex preview fidelity pass — real analyzed cards, matching production (Aug 14, 2026)

Direct correction from Mr. T after reviewing `/preview/rolodex/` live:
the analyzed card "doesn't look anything like the original" — missing
the thumb/hold verdict badge, only showing 3 of 6 gates (G4/G5 and the
confidence row missing), missing the type/sizing badges ("sentiment with
risk level"), missing hyperlinks, missing the Glossary and Track Record
teaser after the ticker list, and the header "disorganized" — needed to
match the real deployed Free tier, not the prototype's own alt styling.

**"Only 3 gates" was a real, confirmed layout bug, not a missing
feature.** `gateListHTML()` always built all 6 gate rows — the code was
never actually dropping G4/G5. The real cause: `.rolo-stage`/`.rolo-card`
had a fixed `min-height:280px` with `overflow:hidden`, sized for the
prototype's own curated, short demo gate notes. Real gate note text runs
longer and more variably, so a real analyzed card (6 gates + verdict +
meta + headline + confidence) easily exceeds 280px and the fixed-height
overflow:hidden container silently clipped everything past it — visually
indistinguishable from the gates just not being there. Confirmed via a
mocked `/analyze` response in headless Chromium (this sandbox can't reach
the real backend) showing `stageHeight ≈ cardScrollHeight` and all 6
`.gate-row`/`.gate-clear` elements present after the fix. Fixed by
dropping the fixed height/`overflow:hidden` entirely — `.rolo-card` now
sizes to its own real content (`top/left/right`, no `bottom`/`inset`),
and a new `syncRoloStageHeight()` sets `.rolo-stage`'s height to match
the *active* card's real `offsetHeight` on every render/switch, the same
"measure the real thing, don't assume" lesson as the sizeGateSpacer bug
from the initial build.

**Everything else ported from production, not reinvented:** the big
👍/👎/HOLD verdict treatment (`thumbUp`/`thumbDown`/`holdPulse` keyframes,
market-closed always forces HOLD regardless of the real verdict — ported
`isMarketClosed()` verbatim) now replaces the ANALYZE button on a result,
tapping it resets back to ANALYZE exactly like production's
`resetCard()`; TYPE badge (CANARY/SENTIMENT/FLOW) and SIZING badge
(Full/Half/¼ size, or "Defined risk" for `NONE`) now render, matching
production's exact badge-color mapping; the CONFIDENCE row now appends
to the gate list; a Pre-Gate strip (Gate 5 dot + `wait_for` guidance)
now renders above the meta row, independent of the Gate Breakdown list,
matching production; ticker symbol and headline are now real hyperlinks
to Yahoo Finance's quote/news pages (Free forces Yahoo regardless of any
saved preference — hardcoded here rather than importing `shared/prefs.js`,
keeping this page's isolation from `shared/` complete); the full
Glossary (all real terms, search/filter) and the Track Record upsell
teaser now render after the ticker list, matching production's real
order and copy exactly.

**Header rebuilt to match production, not approximated.** Was using the
prototype's own alt monospace brand treatment; now uses the real
`logo-mark.png` + Playfair Display serif title + plain "FREE" badge
(shortened from "FREE · ROLODEX PREVIEW" — redundant with the
preview-banner already at the top of the page, and also the direct fix
for the bug below).

**A second real bug, caught by the same discipline (measure, don't
eyeball):** the rebuilt header overflowed horizontally
(`scrollWidth 453px` vs `barWidth 390px`, confirmed via
`getBoundingClientRect`) — the credits chip and half the sign-in text
were being cut off outside the viewport, invisible in a static
screenshot glance until actually measured. Root cause: `.app-topbar` had
no `flex-wrap`, and the tier badge's longer text
("FREE · ROLODEX PREVIEW") pushed total content past 390px. Fixed both
(added `flex-wrap:wrap` to `.app-topbar` as a safety net, shortened the
badge text) and re-confirmed `scrollWidth === barWidth` after.

**Verified the same way as the initial build — headless Chromium,
measured not eyeballed:** mocked a full realistic `/analyze` response
(clock-pinned to real market hours via Playwright's clock API, since
`isMarketClosed()` is time-of-day dependent and the sandbox's real clock
falls outside market hours) to confirm the 👍/👎 thumb, all badges, and
gate rows actually render end-to-end; confirmed the Glossary's search
correctly filters by both term name and definition text; re-ran the
original pill-tap/accordion/dock regression checks to confirm nothing
broke. **Still not verified:** a real end-to-end `/analyze` round trip
against live credentials — same standing sandbox limitation as the
initial build.

## Frontend: Rolodex preview — ANALYZE mocked, no longer a real credit spend (Aug 14, 2026)

Direct follow-up: no practical way to add credits just to keep reviewing
this page, and a page reload can't reset a real, server-enforced
balance no matter what the frontend does — credits.js checks and
deducts server-side in `Tra`, not something a client reload touches.
Scoped via `AskUserQuestion` (mock vs. "keep it real, clearer messaging
when blocked") — mock was the clear pick, since this page exists to
review the UI, not to re-validate the real backend round trip (real
production Free tier already does that).

**ANALYZE on `/preview/rolodex/` no longer calls the real `/analyze`
endpoint at all.** `analyzeOne()` now picks from `MOCK_ANALYZE_PROFILES`
— five hand-written, realistic full responses (clean full-size UP,
Gate 1 forceDown DOWN/NONE sizing, mixed FLAT/LOW confidence, clean
HIGH-confidence UP, Gate 5 forceDown DOWN with a proxy `wait_for`) —
covering the verdict/badge/gate-color states actually worth reviewing.
Cycles through them per ticker (`state.mockIndex`) so repeatedly tapping
ANALYZE on the same ticker shows different states instead of the
identical result every time. A ~400-700ms randomized delay keeps the
RUNNING… loading state meaningful rather than resolving instantly.

**Ticker price/news/52W/phase/beta/proxy stayed real, unchanged** —
`fetchTickerData()`/`/ticker/:symbol` has no credit cost in production
either (only `/analyze` does), so there was no reason to fake that half
along with it.

**The preview banner's own claim was fixed to match** — it previously
said ANALYZE spends a real credit, which would now be false. Rewritten
to say ticker/news/Gate 0 are real (and free) while ANALYZE is
simulated and costs nothing, so it's safe to tap repeatedly.

**Verified via headless Chromium:** confirmed zero real `/analyze`
network requests fire across repeated ANALYZE taps (network-request
listener, not just reading the code); confirmed the mock profiles
actually cycle (four successive taps showed three distinct `wait_for`
states); confirmed `isMarketClosed()` still correctly overrides a mocked
UP/DOWN to HOLD outside market hours, same as it does for a real
result — the mock only replaces where the verdict data comes from, not
any of the rendering/override logic downstream of it.

**Follow-up, same day: the fixes above didn't actually reach the user's
browser at first.** Reported live: the dismiss button didn't close the
banner, and ANALYZE still showed a no-credits error — both symptoms of
running an *old* cached `app.js`, not of either fix being wrong. Root
cause: `preview/rolodex/index.html` was built without the two things
every real tier page has for exactly this reason — a
`Cache-Control: no-cache,no-store,must-revalidate` meta tag, and a
`?v=N` query string on its own `<script src="./app.js">` tag (see the
cache-busting rule earlier in this file). This page had gone through
four rounds of content changes to `app.js` in one session with zero
cache-busting the whole time, so a browser that loaded it early was
never guaranteed to see any of the later fixes. Fixed by adding both to
`index.html` (`?v=1` as the starting baseline — the *un*versioned URL a
browser may have already cached is a different cache key regardless of
what number this starts at, so correctness didn't depend on picking a
"right" starting value, only on bumping it from here on).

**Going forward: `preview/rolodex/app.js` needs its `?v=` bumped on
every future content change**, exactly like every other real
`app.js`/shared module in this repo — this page was the one exception
that had fallen through, not a deliberate opt-out.

**Follow-up, same day: verdict badge moved to the top, empty Pre-Gate
strip hidden (`?v=2`).** Direct comparison against a real production
screenshot: the thumb/HOLD badge was buried below the full gate list in
this build's single-column layout, while production puts it right next
to the ticker row at the top (production's real 2-column `card-left`/
`card-right` split). Restructured `.ticker-row` into two columns —
ticker symbol/price on the left, the verdict (or the ANALYZE button,
pre-analysis) on the right in a new `.ticker-action` slot — matching
where production puts that element without adopting its full 2-column
body layout (Rolodex's single-column card content below the top row is
unchanged, still the approved design from the earlier prototype rounds).
Added `.btn-compact` (width auto, not the card-wide default) so ANALYZE
fits that slot before a result exists.

**Also fixed in the same pass, prompted by the same screenshot:** the
Pre-Gate strip now renders **only** when there's real `wait_for` text —
matching the earlier "hide it, don't show an empty box" plan — and the
label changed from production's "WAIT FOR " to "LOOK FOR:" (direct
request, same pass) — this preview's own copy, not a claim about what
production says.

**Verified via headless Chromium:** confirmed no horizontal overflow in
the restructured ticker row across both the pre-analysis (ANALYZE
button) and post-analysis (verdict badge) states; confirmed the
Pre-Gate strip is absent for a mocked profile with `wait_for:null` and
present with the colon for one that has real guidance text; visually
confirmed via screenshot that the layout now matches the production
reference (ticker/price top-left, thumb badge top-right).

## Frontend: Rolodex preview — Gate docking race + inactive-card interactivity (Aug 14, 2026, `?v=3`)

Reported live: "the top Gate card should start collapsing when the
sector pulse drop-down hits the bottom of the Gate card" — it wasn't.
Confirmed via `AskUserQuestion` that this was a timing bug (the dock
snap happening at the wrong moment), not a request to redesign the
snap into a continuous scroll-linked animation — important to pin down
given the Aug 13 collapsing-card lesson elsewhere in this file found
exactly that pattern broken three separate ways on a real device.

**Root cause, found by deliberately simulating real network latency
(this sandbox's own tests had never done that before) — a two-part
race:** `sizeGateSpacer()` (measures the Gate overlay's real height,
sets the scroll-room spacer, and previously also set the module-level
`spacerHeight` variable the scroll handler compared against) only runs
once at page load — against placeholder content ("LOADING…", empty
grid) — and again after the real `/market` fetch resolves. On a real
phone with real network latency, a user can start scrolling in that gap
and reach the dock threshold while it's still sized against placeholder
content, docking early. Confirmed by delaying a mocked `/market`
response by 900ms in a headless test and scrolling immediately —
reproduced cleanly, something the earlier build's instant-fake-response
tests structurally could not have caught.

**Two-part fix, both parts necessary:**
1. The dock/undock comparison (`updateGateDockState()`) now always
   re-measures the overlay's real height fresh (`currentGateFullHeight()`,
   a pure read, no DOM writes) instead of comparing against a value that
   could be stale — this alone fixed docking-while-still-on-placeholder-
   content.
2. That comparison only ever ran in response to a `scroll` event. If
   real data landed while the user had already stopped scrolling, the
   dock class never re-evaluated against the new (correct) content
   size — visibly stuck in the wrong state until the *next* scroll.
   Fixed by also calling `updateGateDockState()` from inside
   `sizeGateSpacer()` itself, so content changing size alone (without a
   new scroll event) also triggers a re-check. Confirmed both parts
   together via a headless test: scrolled past the placeholder-sized
   threshold, waited for a delayed `/market` response with zero further
   scroll input, and confirmed the Gate correctly un-docks the moment
   real (taller) content lands, then correctly re-docks at the real
   threshold.

**A second, unrelated real bug found by chasing a flaky headless test
of the fix above, not by user report — worth fixing regardless:**
inactive Rolodex cards (stacked behind the active one via
transform/opacity, per the approved design) never got
`pointer-events:none`. `positionRoloStack()` now sets it explicitly
(`auto` only on the active card). Their buttons/links were genuinely
clickable/focusable the whole time despite being visually stacked
behind the active card — a real interaction/accessibility gap that
predates this session's testing, not something the dock-race fix
introduced. Caught because `document.querySelector('[data-analyze]')`
(both in a test script and in Playwright's own element-resolution)
grabbed the *first* matching button in DOM order rather than the
visually active one, intercepted by whatever was actually on top —
confirmed by scoping the query to the active card's `data-sym` and
re-testing; also confirmed via `getComputedStyle` that only the active
card now reports `pointer-events: auto`.

## Frontend: Rolodex preview — Gate compaction, verified via real incremental scroll (Aug 15, 2026)

Follow-up report, same live-scroll feedback loop: "the gate is not
collapsing until those drop-downs are completely under the gate" and
the utility cards "don't stack... taking too much real estate." Before
touching anything, verified the previous dock-race fix (`?v=3`) with a
**real incremental scroll gesture** for the first time this session —
`page.mouse.wheel()` dispatched in small repeated steps rather than a
single programmatic `scrollTo()` jump, which is what every earlier
verification in this file used. That confirmed the mechanism itself
was actually working correctly: cards do stick, in the right order, at
the right relative spacing, and the Gate docks at a real, defensible
scroll point (not never, not at the very end) — ruling out a second
"sticky is silently broken" bug like the ones found earlier.

**The real issue was proportions, not a bug.** The Gate's full-detail
view (a 10-item stat grid + note) is inherently tall, and the dock
threshold is correctly tied to scrolling past that entire height (see
`currentGateFullHeight()`) — so on a short, not-yet-analyzed watchlist
(cards are just a one-line "Tap ANALYZE" placeholder before that),
there's little scrollable content below the Gate+3-utility-card zone,
compressing the whole "Gate shrinks → cards stack → tickers appear"
sequence into a narrow scroll range near the bottom of the page. That
reads exactly like "nothing happens, then everything happens at once."

**Why the dock threshold couldn't just be lowered on its own.** The
threshold and the reserved scroll room (`gateSpacer`'s height) have to
stay in lockstep — the overlay is always rendered at its full natural
height while undocked, absolutely positioned with nothing clipping it.
Shrinking only the trigger point without also shrinking the reserved
room would reopen the exact overlay-bleeds-into-Sector-Pulse bug fixed
in the initial build (CLAUDE.md, "Overlay height measured before it had
real content"). The actual fix has to reduce the overlay's own real
height, since everything downstream (threshold, spacer, dock timing) is
already correctly derived from that one measurement.

**Fix: tightened the full-detail overlay's own CSS** — padding
(`14px 16px 16px` → `10px 16px 12px`), the stat grid's row gap
(`8px`→`5px`) and bottom margins (`10px`→`7px` on both the label and the
grid), and the note's line-height (`1.6`→`1.45`). Purely a density
change, no content removed. Measured overlay height dropped from
~208px to ~185px in the same test scenario, moving the dock threshold
from ~166px to ~141px scrollTop — a real, measured reduction in how far
you have to scroll before the Gate gets out of the way, not a guessed
one.

**Verified, not assumed:** re-ran the real-incremental-scroll test
against the tightened CSS and confirmed sticky stacking, spacing, and
dock/undock all still behave correctly; re-ran the full pill/accordion/
analyze regression suite — all pass; directly measured the overlay's
`getBoundingClientRect().height` before and after to confirm the actual
pixel reduction rather than eyeballing it.

## Frontend: Rolodex preview — utility cards un-stuck, ticker pills dock instead (Aug 15, 2026, `?v=4`)

Direct follow-up, same day: an `AskUserQuestion` diagnostic re-ask (the
first attempt's answer came back malformed — a UI glitch on the
asking side, not a real answer) got a clean, decisive answer this time:
Sector Pulse/Session Context/Import sticking in a stack was never
wanted — "they are taking too much room... they should just scroll
away." Instead: dock the ticker pill strip (`#roloIndex`) under the
collapsed Gate, and let everything else — the three utility cards, the
open ticker card, Glossary, Track Record, disclaimer, footer — scroll
normally.

**This is a real simplification, not just a different look.** The old
mechanism needed `updateStickyOffsets()`/`utilityCardHeight()` — JS-
computed cumulative `top` offsets recalculated on every accordion
toggle, resize, and data load, so each of 3 stacked sticky cards knew
where to pin relative to the one ahead of it. All of that is gone.
`#roloIndex` is the *only* other sticky element besides the Gate now,
sitting directly under it — a single static CSS `top:var(--gate-docked-h)`
is enough, no JS offset math needed at all, and scroll-up undocking is
native `position:sticky` behavior, free.

**Utility cards (`.card[data-card]`) dropped `position:sticky`/`z-index`
entirely** — same plain tap-to-expand accordion as before, just no
longer pinned; they scroll off normally like the rest of the page.
`#roloIndex` picked up `position:sticky; top:var(--gate-docked-h)` plus
an opaque background (`var(--bg)`) so content scrolling underneath
doesn't show through once it's pinned, with a small negative-margin/
padding trick to bleed it edge-to-edge while docked.

**Verified via the same real-incremental-scroll technique as the Gate
compaction fix:** confirmed Sector Pulse now scrolls fully off-screen
(`pulseTop` goes negative) instead of sticking; confirmed `#roloIndex`
freezes in place once scrolled far enough and stays frozen across
repeated samples; confirmed scrolling back to the top undocks both the
Gate and the pill strip back to their normal positions. Re-ran the full
pill-tap/accordion/analyze/glossary-search regression suite — all pass.

## Frontend: Rolodex preview — ticker pill count moved into the strip (Aug 15, 2026, `?v=5`)

Direct follow-up, same day: "move the ticker pill count to between the
first and last in the row with a dash on each side, to show the
beginning and end of the list. this will help for starter and pro as the
list gets longer." The count previously lived above the pill strip
(`.list-head`'s `#roloCount` badge, "Analysis Cards · N") — removed
entirely (both the HTML element and its CSS), replaced with a single
`— N —` divider chip (`.rolo-divider`) built directly into `#roloIndex`
itself.

**Where exactly "between the first and last" landed, given the strip's
existing marquee mechanism.** `#roloIndex` already renders the watchlist
*twice* back to back (`renderRolodexFromWatchlist`'s two-pass loop) so
the auto-scroll marquee can wrap seamlessly — the visible strip is never
just one pass through the list. The `— N —` divider is appended once,
right after the real (first) pass and before the duplicate (second)
pass — i.e., literally between the first pass's last ticker and the
second pass's first ticker, which reads to the user as a single
landmark marking where the list wraps back to its own beginning as it
scrolls by. Free's own watchlist is capped at 3 tickers so this is
subtle here, but the whole point (per the request) is Starter/Pro-scale
lists, where a long unbroken stream of pills has no landmark at all
without it — confirmed by direct math below, not just reasoned about.

**The marquee's wrap-distance calculation had to change, not just cosmetic
placement.** It previously assumed the strip's total width split into two
exactly-equal halves (`roloMarqueeOneSetW = roloIndex.scrollWidth / 2`) —
true only because both passes were identical chip sets with nothing else
between them. Adding a divider after the *first* pass only (not the
second) breaks that symmetry on purpose, matching "between the first and
last," so the assumed-half-width math would now be wrong by roughly one
divider-width. Replaced with a direct measurement:
`roloCountDivider.offsetLeft + roloCountDivider.offsetWidth` — the real,
live boundary of "first pass + its divider," regardless of list length.
This is more correct than the old assumption ever was, not just adjusted
to compensate for the new element.

**Verified the math actually holds at Starter/Pro scale, not just for
Free's real 3-ticker cap.** This page's own `MAX_TICKERS = 3` (mirroring
Free's real limit) means it can't structurally demonstrate a long list
by itself, so the wrap math was checked two ways: (1) the real page with
its real 3-ticker watchlist — divider renders correctly (`"— 3 —"`), old
`#roloCount` element and its CSS confirmed gone, pill tap-to-switch and
the real-incremental-scroll dock/undock regression both still pass; (2)
a synthetic 15-ticker (Starter/Pro-scale) rebuild of the exact same
`#roloIndex` markup/CSS shape, confirming the measured `oneSetW` (1538px)
stays well under the container's actual max scroll distance (2626px) —
so the wraparound branch actually triggers at that scale — and that the
chip immediately after the divider is pixel-identical (same symbol) to
the strip's very first chip, confirming the loop is seamless at the
point the divider sits. Free's own 3-ticker case was independently
confirmed to have too little overflow to ever visibly wrap, both before
and after this change — not a regression this change introduced, just
the pre-existing ceiling of a 3-ticker cap on a ~390px-wide strip.

`preview/rolodex/app.js` bumped to `?v=5` per the cache-busting rule.

## Frontend: Rolodex preview — marquee stalling, card bleed-through, auto-analyze on tap (Aug 15, 2026, `?v=6`)

Three live-reported issues from the same round of feedback, all in
`preview/rolodex/`, landed together.

**1. Marquee "stopping a lot."** The pause-on-manual-scroll mechanism had
*two* independent triggers: pointerdown/pointerup (correct, tied to a real
tap/drag) and a `#roloIndex` `scroll` listener that paused whenever the
observed `scrollLeft` didn't match the marquee's own last self-write —
added earlier specifically to catch manual drags the pointer events might
miss. That comparison was supposed to ignore the marquee's own writes
(state-comparison, not a timing flag — see the earlier "moves a hair,
stalls" fix elsewhere in this file), but in practice was still
mis-detecting the marquee's own async-dispatched scroll events as manual
scrolls often enough on a real device to repeatedly self-pause — a
broader recurrence of the same bug *class* that earlier fix addressed,
not the identical bug. **Fix: removed the scroll-listener pause path
entirely**, rather than re-tuning its threshold again — pointerdown/up/
cancel alone already covers both a pill tap and a manual drag of the
strip, with no self-detection ambiguity to get wrong. Resume delay
tightened from 1800ms to a flat 2000ms per the direct request ("should
only pause for 2 seconds").

Verified on the real page: tapped a pill immediately after load (before
the strip's ~42px native scroll room on this 3-ticker Free-tier page gets
used up, which would otherwise mask any pause/resume signal) and sampled
`scrollLeft` through the window — flat for the full ~2s pause, then
visibly incrementing again right after, with no in-between stalls.

**2. Analyzed-card bleed-through on ticker switch.** Reported live,
screenshot showed faded gate rows and a stray "3 / 3" overlapping the
Glossary/Track Record area below the pill strip. Root cause:
`.rolo-stage` lost its `overflow:hidden` in the Aug 14 fidelity pass (so
a real analyzed card's full content wouldn't get clipped — see "Only 3
gates" earlier in this file) and never got it back once the stage height
was made fully dynamic. Once a ticker's card is genuinely taller than
whatever's currently active (e.g. a previously-analyzed full result,
sitting inactive/faded behind a freshly-selected still-idle card), that
taller inactive card's bottom edge extends straight past the (shorter)
stage box into whatever comes after it in the page — confirmed via
`getBoundingClientRect`: MU's analyzed card (373px tall) sitting behind a
120px-tall active IREN card, its bottom ~250px past both the stage's own
bottom and the Glossary tile's top. Re-adding `overflow:hidden` is safe
now in a way it wasn't during the original "Only 3 gates" bug, because
the stage's height is unconditionally synced to the *active* card's real
`offsetHeight` on every render (`syncRoloStageHeight()`) — it can never
end up shorter than the one card that's actually supposed to be fully
visible, only shorter than the inactive ones, which are supposed to stay
mostly hidden behind it anyway (that's the whole stacked-deck illusion).

**Caught a testing pitfall worth remembering for any future check of this
kind: `getBoundingClientRect()` reports a child's own layout geometry
regardless of an ancestor's `overflow:hidden` — it doesn't reflect what's
actually painted.** A first verification pass reused the same
rect-overlap check that reproduced the bug pre-fix, and got flaky
true/false results post-fix, because the geometry itself is unchanged by
`overflow:hidden` — only the paint is clipped. Re-verified two ways that
actually reflect what a user sees: confirmed `getComputedStyle(stage).
overflow === 'hidden'` structurally, and took a real screenshot after
switching tickers with one already analyzed — clean, no ghosted text
anywhere on or below the card.

**3. Tapping a ticker pill now runs its analysis automatically.** Direct
request: "when tapping a new ticker should invoke a[n] analysis" — the
idle "Tap ANALYZE to run the gates" state was an unnecessary extra tap
for a ticker being viewed for the first time. `goRolo(i)` now calls the
existing (mocked) `analyzeOne(sym)` immediately after switching, but only
when that ticker has no result yet and isn't already mid-analysis —
revisiting an already-analyzed ticker just shows what's already there
(same as tapping into any other open card), rather than needlessly
re-cycling its mock profile on every visit. Verified: switching to a
fresh ticker shows RUNNING… then a real verdict within the mock's normal
~400-700ms delay with no extra tap; switching back to an already-analyzed
one shows its existing result immediately, no RUNNING… flash.

`preview/rolodex/app.js` bumped to `?v=6` per the cache-busting rule.

## Frontend: Rolodex preview — Gate dock retargeted to Sector Pulse's real position, marquee self-healing pause (Aug 15, 2026, `?v=7`)

Two more live-reported issues, same page.

**1. Gate collapsing far too late against real data.** Live screenshot:
scrolled well past Sector Pulse *and* Session Context, with Import's tail
end barely visible — and the Gate still hadn't docked. Root cause:
the dock trigger (`scrollTop >= currentGateFullHeight()`) was only ever a
*proxy* for "has Sector Pulse scrolled under the docked bar," correct
only as long as it stayed exactly coupled to Sector Pulse's real
position. It was — by construction, `gateSpacer`'s reserved height came
from the same `currentGateFullHeight()` measurement, which set Sector
Pulse's real top offset to exactly equal the overlay's own height. That
held up fine against the earlier synthetic mocks this session's tests
used (2 indices, a short note), but real live data — 10 real indices
plus a real, often multi-clause note — makes the overlay considerably
taller, and the derived threshold grew right along with it, without
anything to point out it had drifted away from where Sector Pulse
actually was on screen.

Confirmed via `AskUserQuestion` which drop-down was meant (this Free
preview has no card literally called "Proxy" — that's Pro-only; the
report meant Sector Pulse, the first of the three utility cards).
**Fixed by measuring Sector Pulse's own position directly** instead of
deriving a threshold from the Gate's own height: `updateGateDockState()`
now reads `#card-pulse`'s live `getBoundingClientRect()` every tick and
docks once its top has scrolled up to the docked bar's own height
(`GATE_DOCKED_H`). Nothing left to fall out of sync — the measurement is
never cached, so it can't drift from reality the way a derived value
could. `currentGateFullHeight()` is still used for what it was always
also doing — sizing `gateSpacer` so the un-docked overlay doesn't visually
overlap Sector Pulse — just no longer for the dock decision itself.

Verified with a real incremental scroll against a realistic 10-index/
long-note mocked `/market` response (matching what was actually live,
not the earlier lighter mocks): found the exact transition sample —
docks the instant Sector Pulse's measured top crosses `GATE_DOCKED_H`
(44px), confirmed both just-before (58px, still fully clear) and
at-transition (33px, already under the bar) samples bracket it correctly.

**2. Marquee could get stuck stopped indefinitely.** The pause/resume
mechanism only ever scheduled a resume from `pointerup`/`pointercancel`.
On a real device, a touch that starts on `#roloIndex` but resolves as
(or gets interpreted as) a page scroll doesn't reliably fire either of
those on that element — so a pause with no matching release event had no
way out, matching the live report ("the marquee is stopping here… should
be continuous"). Fixed by having `pauseRoloMarquee()` (on `pointerdown`)
schedule its own 2s resume immediately, making that the hard ceiling on
any pause regardless of what happens next; `pointerup`/`pointercancel`,
when they do fire, just reset the same timer to 2s from that later point
(the right behavior for a normal tap or drag), rather than being the
only way out of the paused state.

Verified by dispatching a synthetic `pointerdown` with **no** matching
`pointerup`/`pointercancel` ever fired (the exact real-device gap this
targets) and sampling `scrollLeft`: stayed flat for the full pause
window, then resumed moving on its own at the 2s mark regardless.

Full pill-tap/auto-analyze/accordion/glossary-search/dock-undock
regression suite re-run against both fixes together — all pass.
`preview/rolodex/app.js` bumped to `?v=7` per the cache-busting rule.

## Frontend: Rolodex preview — corrected dock reference height, marquee wrap on short lists (Aug 15, 2026, `?v=8`)

Reported live, immediately after the `?v=7` fixes above deployed: "both
problems are still there." Deploy was independently confirmed correct
(raw file fetched straight from `main` at the deployed SHA, byte-matched
the intended fix) — so this wasn't a repeat of the caching class of bug.
Both turned out to be real, distinct bugs the `?v=7` fixes didn't
actually address, found by direct measurement rather than another guess.

**1. Gate still collapsing late — the `?v=7` fix targeted the wrong
reference height.** That fix compared Sector Pulse's live top against
`GATE_DOCKED_H` (44px), reasoning "dock once Pulse has scrolled up to
where the compact bar's bottom edge will be." Measured directly against
a realistic mock (10 real indices, a real multi-clause note, matching
`server.js`'s actual `/market` response shape — `market.gateStatus`/
`.gateNote`/`.spy` etc. at the top level, not nested, a shape an earlier
verification pass had gotten wrong without noticing): that threshold
needed **~187px** of scroll. But `#gateCard`'s full-detail overlay stays
sticky-pinned at the top the *entire time* it's un-docked (regardless of
the docked class — only the crossfade to the compact row is gated on
that; the sticky positioning itself is unconditional), opaque, at its
own full real height. Sector Pulse — a plain, non-sticky element — starts
being visually painted over the moment its own top scrolls up to meet
the overlay's *current* full height, not the eventual 44px docked
height. Measured: that's only **~14px** of scroll (gateSpacer already
reserves just enough room to sit Sector Pulse right at the overlay's
edge at rest, so almost any scrolling starts covering it). The `?v=7`
fix was comparing against a point ~170px past where Sector Pulse
actually starts disappearing — a wide "dead zone" where it's already
invisible (painted over) but the Gate hasn't collapsed yet, exactly
matching the repeated "still collapses late" reports. **Fixed by
comparing against the overlay's own live height instead of
`GATE_DOCKED_H`** — same fresh-every-tick measurement discipline as
`?v=7`, just the correct reference point for "when hiding begins" rather
than "when it's safe to have fully shrunk." Verified via real
incremental scroll against the accurate mock: docks at scrollTop≈15px,
matching the computed ~14px threshold. This is a large, deliberate
behavior change (docks almost immediately on any scroll, not after a
few hundred px) — flagged clearly in case it now reads as too early
rather than too late; that's a much easier correction to make than the
ambiguous "still late" this replaces.

**2. Marquee "does not auto-scroll anymore" — a real design gap for
short lists, not a pause bug.** The `?v=7` fix (self-healing pause)
was independently re-verified still correct and unaffected — the actual
cause was that on Free's 3-ticker watchlist, one full "set" (real pass +
divider) is **wider** than the browser's native scrollable room past a
single duplicate pass (~242px needed vs. ~42px available in a 390px
viewport). `scrollLeft` creeps those ~42px and hits a hard native clamp
it can never get past to reach the wrap-around point — not paused, just
physically stuck, but visually indistinguishable from "doesn't scroll."
This was always true (flagged as a known, deliberately-deferred
limitation when the count-divider landed), but only became a live
complaint once someone was actually watching it not move at all. Fixed
in `renderRolodexFromWatchlist()`: after the real pass + divider + one
duplicate pass, keep appending plain duplicate passes (no divider — the
"— N —" marker stays singular) until `roloIndex.scrollWidth -
roloIndex.clientWidth >= roloMarqueeOneSetW`, i.e. until there's
actually enough native scroll room to traverse one full set, guarded at
20 iterations so an unexpected empty watchlist can't spin forever.
Verified: the real 3-ticker page now renders 4 total passes (was 2) and
`scrollLeft` climbs smoothly past the old ~42px ceiling and genuinely
wraps (231→1→13→25…) instead of sticking; pause-on-tap and resume still
work correctly with the extra passes in place.

**Methodology note, worth keeping:** the mocked `/market` response used
to verify the Aug 15 `?v=7` Gate fix had the wrong shape (nested
`{gate:{...}, indices:{...}}` instead of the real flat
`market.gateStatus`/`market.spy` etc.) — silently causing the Gate's
note text to render empty and every index value to show `?`, understating
the real overlay's height and masking the actual scale of the dock-timing
bug in that round's testing. Re-checked the real shape directly against
the code (`GATE_FIELDS`, `renderGate()`) before writing this round's
mocks. When a live report contradicts a "verified" fix, re-verify the
mock's shape against the real code path first, not just the assertion
logic — a structurally wrong mock can pass tests while proving nothing
about the real behavior.

Full pill-tap/auto-analyze/accordion/glossary-search/dock-undock
regression suite re-run against both fixes together — all pass.
`preview/rolodex/app.js` bumped to `?v=8` per the cache-busting rule.

## Frontend: Rolodex preview — smooth Gate-collapse pull, pill dock persisting past the Glossary (Aug 15, 2026, `?v=9`)

Two more live-reported issues from the same page, once `?v=8`'s much
earlier dock trigger made both newly visible.

**1. Large blank gap when the Gate collapses.** Direct request: "can the
screen get pulled with the collapse smoothly?" Root cause: `gateSpacer`
(the plain block reserving scroll room so the un-docked overlay doesn't
visually overlap Sector Pulse) was sized once to the overlay's full
un-docked height and never shrank back down once docked — harmless
when docking used to happen late (near where the spacer's own room ran
out anyway, per `?v=7`), but `?v=8` moved the dock trigger to ~14px, so
the spacer was now holding open a ~150-200px gap that served no purpose
once the overlay had already crossfaded away. Fixed: `gateSpacer`
collapses to `0` the instant `docked` flips true (restored on undock),
written only on an actual state transition (not every scroll tick), with
a `.2s` CSS transition on `#gateSpacer` itself so the content underneath
visually "pulls up" into place. `#gateSpacer` is a plain, non-sticky
block — this is a normal, one-time reflow on a discrete state change, not
the fragile "sticky element's own box changes shape mid-gesture" pattern
the Aug 13 collapsing-card lesson found broken three separate ways; only
`#gateCard` is sticky here.

**A real bug caught before shipping: collapsing the spacer broke
undocking.** The dock decision at the time measured Sector Pulse's own
live position (`#card-pulse`'s `getBoundingClientRect()`) against the
overlay's height. Once `gateSpacer` started collapsing to `0` on dock,
removing that reserved room permanently shifted Sector Pulse's
document-flow position closer to the top — the exact value the dock
condition read — so once docked, "undock" became permanently
unreachable (scrolling back to the top no longer moved the measurement
back past the threshold). Root-caused by testing the undock path
explicitly, not just the dock path. Fixed with a derivation instead of a
live re-measurement: since `gateSpacer` is always sized to exactly
`overlayHeight − GATE_DOCKED_H`, the scrollTop needed to reach "begins to
hide" is algebraically always just `.content`'s own top padding (14px),
a fixed constant independent of the overlay's height or the spacer's
current (possibly already-collapsed) state — removing the circular
dependency entirely. Confirmed docks/undocks repeatedly and correctly
across multiple toggles, not just once each direction.

**2. Ticker pills not persisting past the Glossary.** Direct report: "the
ticker pills docked needs to persist with everything scrolling under.
the glossary is pushing it off the dock." Root cause: `#roloIndex` (the
sticky pill strip) was nested inside `.rolo-wrap`, a short flex block
containing only the open ticker card and the nav hint — a sticky
element's "stuck" range is bounded by its own immediate parent's box, so
once `.rolo-wrap`'s own box had scrolled past, `#roloIndex` had nowhere
left to stick and un-stuck well before the Glossary/Track Record/
disclaimer/footer that follow, reading exactly like those elements
"pushing it off." Fixed by moving `#roloIndex` up to be a direct child of
`.content` instead (which spans everything through the footer), not
nested inside `.rolo-wrap` at all.

**A genuinely embarrassing testing-methodology bug, confirmed and
corrected before writing this up.** An intermediate attempt at
diagnosing this (measuring `#roloIndex`'s `getBoundingClientRect().top`
directly, comparing it to the intended `44px` offset) kept showing a
"stuck at 231px" result no matter what was changed — including several
increasingly drastic (and, it turned out, unnecessary) restructuring
attempts, one of which split `.content` into two separate blocks around
`#roloIndex` to make it a direct child of `#scroller` itself. The real
explanation: `getBoundingClientRect().top` is viewport-relative, and
`#scroller` itself sits 187px down the viewport behind the fixed header
— `#roloIndex` had been correctly stuck at `44px` *relative to
`#scroller`* the entire time (`187 + 44 = 231`, exactly the "stuck"
value), and every one of those diagnostic tests was misreading correct
behavior as broken by never subtracting `#scroller`'s own offset. Undone
the unnecessary split-`.content` restructure once this was caught,
back to the simpler single-`.content`, direct-child-of-`.content`
version above — that alone was already sufficient. Kept as a written
lesson because it cost real, avoidable effort: **when measuring a sticky
or fixed element's position inside a scroll container that itself isn't
flush with the viewport's own top, always compute position relative to
the scroll container's own `getBoundingClientRect()`, never raw viewport
coordinates** — this file already carries several sticky/scroll
measurement lessons; this is the same discipline (measure the real
thing) applied to a mistake in the measurement itself, not the code
under test.

Verified (correctly, this time): scrolled to the page's true max
(`scrollTop === scrollHeight − clientHeight`, past the Glossary and
footer) and confirmed `#roloIndex`'s position *relative to `#scroller`*
is exactly `44px`; confirmed dock/undock and the spacer collapse/restore
both work correctly across repeated toggles; full pill-tap/auto-analyze/
accordion/glossary-search regression suite re-run, all pass.
`preview/rolodex/app.js` bumped to `?v=9` per the cache-busting rule.

## Frontend: Rolodex preview — pill-strip count divider on every pass, not just one (Aug 15, 2026, `?v=10`)

Direct report: "the divider — n — is not naturally put at the last
ticker pill. it's inserted as an afterthought. as the first pill fully
appears, the divider jumps into place instead of naturally reoccurring
at the last ticker." Real, correctly-diagnosed UX bug in the marquee's
loop structure.

**Root cause.** The pill-count-divider work earlier this session (see
above) deliberately kept only ONE `— N —` divider in the whole strip —
appended once, right after the first (real) pass, with every duplicate
pass after it left bare. That was fine as long as there were only two
passes total, but the same day's marquee-wrap fix (also above) started
appending as many duplicate passes as needed to get enough native
scroll room on a short watchlist — which for Free's 3-ticker case meant
3 total passes, only one of which had a divider. The result: scrolling
through the strip showed two full, clean MU/IREN/ALAB repeats with no
marker at all, then the divider would suddenly appear once per full
wrap cycle — reading exactly as reported, an afterthought rather than a
consistent "end of the list" landmark.

**Fix.** Every pass now gets its own `— N —` divider immediately after
it, not just the first — `appendChipPass()` builds and returns a
divider each time it's called, for both the initial pass and every
guard-loop-added duplicate. The visible pattern is now a clean,
uniform `chip, chip, chip, divider` repeat for as many passes as exist,
so the marker naturally recurs at the end of every single pass through
the watchlist instead of appearing arbitrarily. Since every pass+divider
chunk is now the same width, the marquee's wrap math (measuring the
first divider's `offsetLeft + offsetWidth` as "one set") stays exactly
as correct as before, regardless of how many passes get appended.

**Verified:** dumped the actual chip/divider sequence in the live DOM —
confirmed a clean `chip,chip,chip,DIV` repeat for all 3 passes on the
real 3-ticker page; confirmed the marquee still wraps seamlessly
(scrollLeft climbing smoothly and correctly resetting at the loop
point); re-ran the full pill-tap/auto-analyze/accordion/glossary-search/
dock regression suite — all pass.

`preview/rolodex/app.js` bumped to `?v=10` per the cache-busting rule.

## Frontend: Rolodex preview — pixel-precise marquee wrap, no more jump at the loop point (Aug 15, 2026, `?v=11`)

Direct report: "the ticker pills back-step jumps like 5 pxls at the end
of the loop." Two real, stacked sub-pixel precision bugs, confirmed by
direct measurement before touching any code — not guessed at.

**Bug 1 — `scrollLeft` writes get silently rounded to whole pixels.**
Confirmed live: writing `10.7` reads back as `11`, writing `10.3` reads
back as `10`. `stepRoloMarquee()` was accumulating by reading
`roloIndex.scrollLeft` back each frame and adding `0.5` to it — since
every read is already rounded, that rounding compounds every single
frame, so by the time the wrap check fired the position had drifted a
few px from its true value.

**Bug 2 — `oneSetW` was measured with integer-rounded properties.**
`offsetLeft`/`offsetWidth` round to the nearest integer per spec;
`getBoundingClientRect()` doesn't. Measured directly: a divider's
`offsetLeft + offsetWidth` gave `242`, but its real edge via
`getBoundingClientRect()` was `242.42` — a small, constant mismatch
between where the code wrapped and where the content actually repeats,
compounding with Bug 1's drift instead of correcting it.

**Fix.** `sizeRoloMarquee()` now measures `oneSetW` off
`getBoundingClientRect()` instead of `offsetLeft`/`offsetWidth`. The
step loop now tracks its own logical position (`roloMarqueePos`, a plain
float) independent of `scrollLeft`'s rounding, only writing to the real
`scrollLeft` at the end of each frame — this bounds the rounding error
to at most one frame's write instead of letting it compound over
however many frames occur between wraps.

**Two follow-on correctness details, both needed for the fix to be safe
rather than just quieter:**
- `roloMarqueePos` resyncs from the real `scrollLeft` when the marquee
  resumes from a pause — otherwise a manual drag during the pause
  window would get silently discarded, resuming from the marquee's own
  stale pre-pause position instead of wherever the user actually left
  it.
- `roloMarqueePos` resets to `0` in lockstep with `renderRolodexFromWatchlist()`'s
  `roloIndex.innerHTML = ''` (which itself resets the real `scrollLeft`
  to `0`) — without this, importing a new ticker would leave the tracker
  holding a stale, large value that the very next frame would snap
  `scrollLeft` to, a much bigger and more visible jump than the one
  being fixed.

**Verified:** sampled `scrollLeft` at a fine grain across several full
loop cycles and confirmed the wrap lands exactly at `0` (not a residual
few-px offset) with a consistent 0-1px-per-frame step cadence on both
sides of the transition, no anomalous jump; confirmed a manual drag
during a pause is correctly picked up on resume (not discarded);
confirmed a real watchlist rebuild (importing a ticker on an
under-the-cap list) resets `scrollLeft` to ~0 rather than jumping;
full pill-tap/auto-analyze/accordion/glossary-search/dock regression
suite re-run, all pass.

`preview/rolodex/app.js` bumped to `?v=11` per the cache-busting rule.

## Frontend: Rolodex preview — full scroll-animation sweep, Gate's own index marquee had the identical bug (Aug 15, 2026, `?v=12`)

Direct follow-up: "it's still back stepping at the end of the list...
rerun a full sweep of the code for scrolling bugs. make ever[y] scrolling
motion smooth." Grepped the whole file for `scrollLeft`/`scrollTop`/
`requestAnimationFrame` rather than re-guessing at the pill strip again.

**Found a second, independent instance of the exact same bug class the
`?v=11` fix addressed: the docked Gate's own SPY/QQQ/BTC/etc. index
marquee (`stepGateMarquee`/`buildGateMarquee`), never touched by that
pass.** Same two problems: `stepGateMarquee` accumulated by reading
`gateMarquee.scrollLeft` back each frame (subject to the same
whole-pixel rounding confirmed for the pill strip), and
`gateMarqueeOneSetW` was measured as `gateMarquee.scrollWidth / 2` —
`scrollWidth` rounds to the nearest integer per spec, so even though
the gate marquee's two passes are truly identical (no divider breaking
the symmetry, unlike the pill strip), halving an already-rounded number
can still land up to ~0.5px off the real repeat boundary. Once the
Gate's own dock-timing fix (`?v=7`, earlier this file) made this
marquee visible almost immediately on any scroll, its jump became at
least as noticeable as the pill strip's.

**Fixed identically:** `sizeGateMarquee()` (renamed from an inline
`requestAnimationFrame` callback) measures the real boundary — the last
`.gm-item` of the first pass — via `getBoundingClientRect()` instead of
`scrollWidth/2`. `stepGateMarquee()` now tracks `gateMarqueePos`, a
plain float independent of `scrollLeft`'s rounding, same as the pill
strip's `roloMarqueePos`. `gateMarqueePos` resets to `0` in
`buildGateMarquee()` alongside the real `scrollLeft` reset, for the same
reason `roloMarqueePos` needed the same reset in `renderRolodexFromWatchlist()`.

**Confirmed the rest of the file has no other instance of this pattern.**
Grepped for every `requestAnimationFrame` call: only two are continuous
per-frame animation loops (`stepRoloMarquee`, `stepGateMarquee`, both now
fixed) — everything else is a one-shot measurement/sizing call after a
render, not a repeated scrollLeft-accumulation loop, so not subject to
this bug class at all. Every other "scrolling motion" in the page (the
main page scroll, the Gate-collapse spacer pull, the Rolodex card-stack
transitions, the Glossary accordion) is either native browser scrolling
or a CSS `transition` on `transform`/`opacity`/`height` — none of those
read back a rounded DOM property into a frame-by-frame accumulator, so
none of them share this failure mode.

**Verified with a much longer, denser sampling pass than `?v=11` used,
specifically to catch a residual bug the shorter test might have missed
given the live report that the shorter fix "still" wasn't enough:**
sampled the pill strip at 10ms resolution for 9 real seconds (900
samples, several full loops) — exactly one wrap, landing at `0`, max
single-frame step 1px, no anomaly. The Gate's own marquee has a much
longer ~32s cycle (773px at 0.4px/frame) — waited through most of one
real cycle, then sampled densely through the expected wrap window and
confirmed the same clean `766 → 0` transition. Full pill-tap/
auto-analyze/accordion/glossary-search/dock regression suite re-run
against both fixes together, all pass.

`preview/rolodex/app.js` bumped to `?v=12` per the cache-busting rule.

## Frontend: Rolodex preview — the real jump was content reflow, not marquee math (Aug 15, 2026, `?v=13`)

Direct follow-up, same day, live screenshot at the divider transition:
"it is still jumping at this point." The `?v=12` sweep had verified the
marquee's own wrap math was pixel-clean on both strips — correctly, that
part held up — but the actual jump the user kept seeing had a completely
different, third cause neither `?v=11` nor `?v=12` had looked at.

**Root cause: `scrollLeft` sampling is blind to content reflow.** A
pill's price starts as a `"—"` placeholder and swaps to a real
`"$969.33"` once `fetchTickerData()` resolves — a real, often much wider
piece of text (confirmed: 44px → 82px for one chip). The marquee runs
from page load, independent of when that data actually arrives. If the
swap happens for a chip sitting upstream of whatever's currently visible
while the marquee is already scrolling, the reflow shifts every sibling
after it — so the exact same `scrollLeft` number suddenly shows
different content. Sampling `scrollLeft` itself (everything this file's
`?v=11`/`?v=12` verification relied on) is completely blind to this,
since the number never actually "jumps" — only what it's pointing at
does. Caught by switching the measurement to the divider's own real
`getBoundingClientRect()` position instead: a 76px visual jump with
`scrollLeft` moving by all of 1.

**Fix: hold the marquee still until there's nothing left to reflow.**
`roloMarqueeDataReady` gates `stepRoloMarquee()` (in addition to the
existing pause check) and only flips true once every ticker's real data
has loaded and one final `sizeRoloMarquee()` has measured the settled
layout — reset to `false` in lockstep with the same
`renderRolodexFromWatchlist()` rebuild that already resets
`roloMarqueePos`. Simpler than trying to compensate `scrollLeft` for
every possible mid-scroll reflow after the fact; this repo's own
`fetchTickerData()` only changes a chip's rendered width during this one
initial-load window (memoized afterward, and the other two `renderPill()`
call sites — `resetTicker()`, `analyzeOne()` — both reuse already-loaded
`state.td`, so neither introduces a new width change), so removing that
window's overlap with active scrolling removes the entire failure mode.

**Verified two ways, since the earlier `scrollLeft`-only method was
exactly what missed this the first two times:** (1) confirmed
`scrollLeft` stays flat at `0` for the full ~2.25s a mocked 3s-delayed
`/ticker/:symbol` response takes to resolve — the marquee genuinely
doesn't move at all during the window where reflow could happen; (2)
tracked the divider's actual on-screen position (not `scrollLeft`)
through and past that data-settle point — confirmed the pre-fix 76px
jump is gone, with the max single-sample delta anywhere in the
post-settle active-scrolling phase down to 1px, matching the clean
motion `?v=12` already established for the wrap point itself. Confirmed
the marquee does start moving once data settles (not stuck paused
forever) and that it still moves promptly under a normal, fast (not
artificially delayed) response. Full pill-tap/auto-analyze/accordion/
glossary-search/dock regression suite re-run, all pass.

`preview/rolodex/app.js` bumped to `?v=13` per the cache-busting rule.

## Frontend: Rolodex preview — reserve pill price width at the source, add a live diagnostic overlay (Aug 15, 2026, `?v=14`)

Direct follow-up, same day: "it is still happening. do research into
this issue and run tests for options that I can review." Given three
straight rounds of "still broken" despite each fix verifying clean in
isolation, this pass was a genuine investigation before touching code
again, not another guess.

**Ruled out first, with evidence:** the deployed `main` source was
pulled straight from GitHub and byte-matched the intended `?v=13` fix
— no drift. The `?v=13` "hold until data loads" gate itself re-tested
clean under an artificially-delayed backend response. `resetTicker()`
and `analyzeOne()`, the other two `renderPill()` call sites, both only
re-render already-loaded `state.td` and can't introduce a new width
change. `fetchTickerData()` (`shared/ticker-cache.js`) never throws —
it catches everything and resolves to `null` — so the gate's
`Promise.all` can't get stuck on a rejection either.

**The actual gap: `?v=13` only closed the reflow window during the
*initial* page load.** That was real and worth fixing, but incomplete
— it's a timing fix around *when* the reflow happens, not a fix for
the reflow itself. Tested a structural alternative instead: reserving
the price text's display width up front (`min-width:7ch` on
`.rc-price`, plus `text-align:right`), so the `"—"` placeholder and a
real `"$969.33"` render at the *same* width — no size change, nothing
to jump, regardless of when or why data lands. Verified directly: MU/
IREN/ALAB's real prices now render with a width delta of ~0.02px
(pure rounding noise) against their placeholder — down from a 38px
real difference before. The one known gap: a 4-digit price (over
$999.99) still doesn't fit `7ch` and would cause a smaller residual
shift — the `?v=13` timing-gate stays in place specifically for that
edge case, as a second layer.

**Also shipped, at the user's explicit request for a review option:**
a small, always-on diagnostic overlay (`#marqueeDiag`, bottom-left,
read-only, `pointer-events:none`) that piggybacks on both marquees'
existing per-frame step functions to track their reference elements'
*real* on-screen position — not `scrollLeft`, which is exactly what
missed this bug for two straight rounds. Correctly distinguishes a
normal wrap (the reference element legitimately jumps by ~`oneSetW`
the instant `scrollLeft` resets) from genuinely unexplained motion, by
passing the expected wrap delta into the comparison rather than
flagging every large delta. Logs to both the on-page overlay (visible
in a screenshot without needing devtools) and `console.warn` with a
timestamp, the raw delta, and the unexplained portion. Marked clearly
in both files as temporary and safe to remove once the jump is
confirmed resolved for good.

**Verified the diagnostic tool itself, not just the width fix:** ran 8
real seconds of normal operation (several genuine wraps) with zero
false-positive log entries; then deliberately forced an unexplained
40px shift via direct DOM manipulation and confirmed it was correctly
caught and logged (`"moved 39.0px, 39.0px unexplained"`) within one
frame. Re-confirmed the width fix eliminates the original repro
(delayed real ticker response) end to end. Full pill-tap/auto-analyze/
accordion/glossary-search/dock regression suite re-run, all pass.

`preview/rolodex/app.js` bumped to `?v=14` per the cache-busting rule.

## Frontend: Rolodex preview — jump still unreproduced, diagnostic broadened to the Layout Instability API (Aug 16, 2026, `?v=15`)

Direct follow-up, reported live: the `?v=14` overlay caught nothing —
"no detection on refresh" — even though the jump itself was still
happening. That's real, useful evidence, not just another "still
broken": it means the jump isn't going through either marquee's own
`scrollLeft` write at all, so the `?v=14` diagnostic (which only ever
tracked the two marquees' reference elements' horizontal position) was
structurally incapable of seeing it, regardless of cause. Re-guessing at
marquee math a fourth time risked missing it the same way a third time.

**Switched the diagnostic to the browser's own Layout Instability API**
(`PerformanceObserver({type:'layout-shift'})`) instead of another
hand-rolled, hypothesis-specific check. This is the web platform's
purpose-built tool for exactly this class of bug: it reports every
visible layout shift on the page, on any element, on any axis, regardless
of cause — not limited to any one theory about where the jump comes from
— and names the actual DOM node(s) involved (`entry.sources[].node`) plus
each one's real before/after rect. `buffered:true` replays shifts that
happened before the observer attaches, which is the specific fix for "on
refresh" — a load-time shift the page's own script would otherwise have
missed by starting to watch too late. The old marquee-specific check
(`marqueeDiagCheck`) was kept alongside it, not replaced — both now feed
one shared event log/overlay so nothing gets silently overwritten.

**Verified the new mechanism actually works, via real Playwright testing,
before shipping it — not just that it compiles:** confirmed a
PerformanceObserver registers without throwing; confirmed a synthetic
forced layout change (a test element grown 2px→120px with no transition)
is correctly caught, correctly names every real sibling element that
shifted as a result (`#card-pulse`, `#card-context`, `#card-io`,
`.list-head`, `.rolo-wrap`), and correctly reports the real 118px `Δy`;
confirmed normal page operation (idle load, a pill tap triggering
auto-analyze) produces a stream of real, legitimate small shifts as
`.rolo-stage`'s own already-CSS-transitioned (`height:.28s ease`) content
grows smoothly — i.e., the tool is picking up genuine per-spec CLS
entries, not staying silent. **This also surfaced a real, previously
unknown gap in the `?v=14` overlay's own CSS: `pointer-events:none` meant
its `overflow-y:auto` scroll region could never actually be scrolled by
touch** — harmless at 6-8 entries but would have silently hidden most of
a longer history. Fixed (`pointer-events:auto` plus `touch-action:pan-y`)
in the same pass, caught by testing the overlay itself, not assumed.

**A real design tension found while shipping this, addressed by flagging
rather than filtering.** Normal, already-smooth CSS transitions (`.rolo-
stage`'s height, the Gate spacer's pull) legitimately generate a RUN of
several small layout-shift entries per transition — one per animation
frame — which is correct per the CLS spec but isn't what a person watching
smooth motion would call a "jump." Rather than filter those out (risking
silently discarding the actual bug a second time, the same mistake the
`?v=14` narrower diagnostic already made once), every entry is still kept
(cap raised 8→20, panel now genuinely scrollable per the fix above) and
entries whose single-frame delta exceeds 30px (`DIAG_NOTABLE_PX`, well
above what the ~13-25px/frame smooth-transition baseline measured in
testing) render in bold red instead of amber, so a real outlier is easy
to spot by eye without anything being thrown away.

**Still not reproduced from this sandbox** — same standing limitation as
the rest of this file's unverified-against-live-conditions entries. This
round shipped strictly better forensic tooling, not a guessed fix, since
nothing in this pass's own testing turned up a reproducible discontinuity
distinct from already-fixed, already-smooth behavior. Next occurrence:
check the overlay (now scrollable, now watching every element/axis, not
just the two marquees) at or shortly after the moment of the jump — a
red-highlighted entry naming the actual element and its real pixel delta
is the concrete lead this file has been missing through every prior round
of this bug.

`preview/rolodex/app.js` and `preview/rolodex/index.html` bumped to
`?v=15` per the cache-busting rule.

## Frontend: Rolodex preview — jump confirmed via real video, root cause still open (Aug 16, 2026, `?v=16`)

Reported live that the `?v=15` overlay still showed "nothing detected"
while the jump kept happening. Rather than guess a fifth time, asked for
and got a real screen recording (91fps slow-motion capture, 4.68s,
`Record_20260815145530...mp4`) and analyzed it directly frame-by-frame —
the first time this investigation has had ground-truth video evidence
instead of live reports + sandbox reasoning.

**Analysis method, worth keeping for any future case like this.**
Extracted every frame (`ffmpeg -vsync 0`, critical — without it, `ffmpeg`
defaulted to the container's 90kHz timebase and tried to emit ~100k
duplicate-padded frames instead of the real ~427). First pass used
JPEG-compressed, downscaled (480px) frames and found an apparent ~27px
jump — but a full-resolution, **lossless PNG** re-check of the same frame
pair showed only ~1px difference, revealing the first measurement was a
compression/downscaling artifact, not a real page event. Redid the
entire analysis losslessly at full resolution (crop just the pill-row
band per frame to keep it fast) before trusting any number again.

**The confirmed finding.** At full resolution, cross-correlating every
consecutive frame pair for the pill row band found exactly ONE anomaly
in all 426 transitions: frame 238→239, a clean **-26px** shift (residual
0.027 — a near-perfect alignment at that shift, i.e. a real, precise
displacement, not noise), against an otherwise rock-steady +1/+2px-per-
frame baseline confirmed both immediately before and after (and at an
independent checkpoint ~3s later) and confirmed visually (`anomaly_
before.png`/`anomaly_after.png` in that session's scratchpad). The
strip snapped backward ~26px for exactly one frame (~11ms, confirmed via
`ffmpeg -vf showinfo`'s pts_time — no dropped/irregular frame timing
around it, ruling out the recording itself skipping a frame), then the
very next frame resumed the normal forward cadence with zero lasting
drift. **This happened with zero interaction** — no touch visible, page
untouched, ~2.6s after load.

**Why neither existing diagnostic saw it.** The shape (self-corrects in
exactly one frame) is consistent with something OTHER than
`stepRoloMarquee`'s own write briefly setting `#roloIndex.scrollLeft` to
a different value, which `stepRoloMarquee`'s very next call then
silently overwrites back to the correct `roloMarqueePos`-derived value
before `marqueeDiagCheck` -- which reads synchronously right after
`stepRoloMarquee`'s OWN write, in the same call -- ever gets a chance to
see the interfering value. The Layout Instability API doesn't apply
either: `scrollLeft` changes are explicitly excluded from the CLS spec
(scrolling isn't a "layout shift"), so it was never going to catch this
regardless of timing.

**Fix: a ground-truth `scroll` event listener** (`watchRoloScrollGroundTruth`)
on `#roloIndex`. The native `scroll` event fires for ANY `scrollLeft`
mutation regardless of source or timing -- the one mechanism that can't
share either diagnostic's blind spot. Compares the real observed
`scrollLeft` against what `roloMarqueePos` (our own intended value) says
it should be; only logs on a real mismatch (a matching event fires on
every one of our own routine per-frame writes too, so logging those
would be pure noise).

**Verified the new mechanism catches exactly this shape of bug**, not
just that it registers: simulated the video's own finding directly
(`el.scrollLeft = el.scrollLeft - 26` on a running marquee) and confirmed
it's caught and logged with the precise delta. Confirmed zero false
positives across 7s of pure idle operation.

**A real, understood, separate bug found and fixed along the way while
building the realistic test for the above** (not a guess -- reproduced,
root-caused, and fix confirmed via a native `element.click()`, since
Playwright's `locator.click()` has its own auto-scroll-before-interacting
behavior that turned out to produce a misleading false positive during
testing -- caught and ruled out before shipping anything based on it).
Tapping a chip focuses that `<button>`, and if the browser's default
"scroll the newly-focused element into view" ever fires for it, that
would yank `#roloIndex.scrollLeft` to wherever the chip sits, fully
independent of `roloMarqueePos` -- and since a tap also pauses the
marquee for 2s, nothing would correct it back until the resume timer
fires. Fixed with `chip.addEventListener('pointerdown', e =>
e.preventDefault())`, the standard technique for "don't let this
button's tap move focus" -- doesn't affect keyboard/Tab navigation,
which still focuses and scrolls normally as accessibility requires, and
doesn't affect the click/`goRolo()` firing normally either.

**Root cause of the video's own -26px anomaly is still open.** The new
diagnostic is built specifically to catch it with hard data on the next
real occurrence (source, exact delta, whether `roloMarqueePaused`/
`roloMarqueeDataReady` were true at the moment) rather than adding a
sixth guessed fix. Leading candidates, unconfirmed: a browser-native
scroll-anchoring adjustment, or some other native compensation
mechanism entirely outside this page's own JS -- deliberately not
guessed at further without evidence, per this investigation's own
repeated lesson about shipping fixes ahead of a confirmed cause.

`preview/rolodex/app.js` and `preview/rolodex/index.html` bumped to
`?v=16` per the cache-busting rule.

## Frontend: Rolodex preview — diagnostic was catching itself (Aug 16, 2026, `?v=17`)

Direct follow-up, same day: the `?v=16` scroll ground-truth watcher
caught nothing on the next live occurrence, and the overlay filled up
with a confusing cluster instead — repeated `#marqueeDiag Δy±132.0,
input=true` entries. Root cause: `#marqueeDiag` is `position:fixed`, and
mobile browsers shift fixed-position elements as their OWN address-bar
chrome hides/shows during a scroll gesture (`input=true` matches --
these landed within 500ms of the user's own scroll touch). The Layout
Instability observer was watching the entire page, including its own
diagnostic overlay, and dutifully reported the overlay's own
address-bar-driven repositioning as if it were an app bug. Pure
self-noise, not signal -- and it was actively unhelpful, crowding out
whatever real entries might have been there.

**Fix:** filter `entry.sources` to drop any source node that IS
`#marqueeDiag` itself before rendering/logging, and skip the entry
entirely if nothing real is left once that's removed. Verified two ways:
(1) directly mutated `#marqueeDiag`'s own height/padding (reproducing
the same class of self-shift) and confirmed zero `#marqueeDiag`-sourced
lines reach the rendered overlay; (2) re-confirmed a real, unrelated
forced shift elsewhere on the page is still caught and correctly
attributed (`#card-pulse` etc. still show up) -- the filter only removes
the overlay's own self-reports, nothing else.

**Still no confirmed root cause for the actual jump.** Both live
attempts to catch it via the in-page overlay (the `?v=15` Layout
Instability pass and the `?v=16` scroll ground-truth watcher) have come
back empty or noisy on real occurrences, in contrast to the one clean,
conclusive result this investigation has actually gotten: the Aug 15
screen recording, analyzed frame-by-frame in the sandbox. That method
found a real, precise, reproducible anomaly (-26px, one frame,
self-correcting) that the live-overlay approach has not managed to
reproduce evidence for since. If this recurs, another slow-motion screen
recording — not another live-overlay screenshot — is the more reliable
next diagnostic step; the overlay stays in place as a secondary check
now that its self-noise is fixed, but it's proven less trustworthy than
direct video analysis so far.

`preview/rolodex/app.js` and `preview/rolodex/index.html` bumped to
`?v=17` per the cache-busting rule.

## Frontend: Rolodex preview — second video, corrected finding, overlay retention bug fixed (Aug 16, 2026, `?v=18`)

A second real screen recording (91fps, 4.56s, same method as the Aug 15
one) came back with an almost identical result: a clean, precise,
low-residual **-26px single-frame shift** at ~2.2s after load, against
the same rock-steady baseline motion. Same magnitude, same early timing,
independently reproduced — this is a real, deterministic bug, not device
jank.

**A correction to the earlier writeup, found while re-checking the first
video against this one.** The Aug 15 entry describes the jump as
"self-correcting on the very next frame." That was wrong -- it only
checked that the marquee's per-frame *rate* resumed normally afterward,
not whether the *absolute position* recovered. Re-analyzed both videos by
comparing many frames after the event against a reference frame from well
before it: the deviation locks in at -26 to -28px and **stays there
permanently** (checked out to 50-80 frames / ~0.6-0.9s past the event in
both videos, no recovery). It's a one-time, permanent reflow, not a
transient glitch that corrects itself.

**The wrap-distance theory (leading candidate as of the last entry) is
ruled out by the numbers.** `roloMarqueeOneSetW` for this 3-ticker Free
page measures ~356px; at the marquee's own speed, reaching that distance
takes 6-12 seconds depending on device refresh rate. Both anomalies
happen at ~2.2-2.6s -- 3-5x too early to be the marquee's first wrap.
Checked this before shipping anything based on the wrap theory, per this
investigation's own repeated lesson about not shipping a fix ahead of
confirmed arithmetic.

**Real root cause of why niether diagnostic screenshot showed anything,
found and fixed.** `marqueeDiagCheck`'s own logic (comparing the
divider's real position each frame against a 3px threshold) SHOULD
already catch a bare, non-wrap 26px jump like this -- there was no
structural reason for it to miss it. The actual problem: the overlay's
single shared 20-entry cap. Routine, expected layout-shift noise
(`.content` settling, plus the `#marqueeDiag`-self-shift noise fixed
`?v=17`) accumulates continuously during normal use and was evicting the
one rare, real, notable entry long before the entry ever got
screenshotted -- both live screenshots were taken minutes into a session,
plenty of time for 20 routine entries to cycle through and push the real
one out. **Fix:** split the overlay into two independent lists -- rare
`notable` events (marqueeDiagLog, scroll-ground-truth mismatches) now
get their own 40-slot cap effectively never evicted by routine noise,
while high-frequency routine layout-shift entries keep a small 10-slot
cap. Verified directly: simulated the exact video finding, then flooded
the overlay with 30 subsequent routine shift events, and confirmed the
notable entry was still present and visible afterward.

**Status: still no confirmed root-cause mechanism**, but the search
space is now much narrower (not wrap-related, permanent not transient,
deterministic magnitude across two independent recordings) and the
overlay retention bug that likely explains every "diagnostic caught
nothing" report so far is fixed. Next real occurrence: check the
overlay -- a `marqueeDiagCheck`-sourced "ROLO moved ...px unexplained"
entry should now actually survive to be seen, which would confirm
whether this specific mechanism is (or isn't) what's firing.

`preview/rolodex/app.js` and `preview/rolodex/index.html` bumped to
`?v=18` per the cache-busting rule.

## Frontend: Rolodex preview — third video, marquee-loop heartbeat + self-healing (Aug 16, 2026, `?v=19`)

A third real screen recording (91fps, 2.39s) was analyzed the same
way: full-resolution lossless frame-by-frame cross-correlation. Same
result again -- a clean, precise **-26px single-frame shift**, this
time at frame 13→14 (~0.14s into this particular clip; this recording
plausibly started well after the marquee had already been running for a
while, so this timing isn't directly comparable to the ~2.2s figure from
the first two videos, but the magnitude is the same to the pixel).

**The overlay showed literally zero new entries for the entire clip**,
before and after the jump, despite the `?v=18` retention fix
specifically targeting this. That fix addressed EVICTION, but this is
evidence of a DETECTION gap, not a retention one -- nothing was ever
logged in the first place, notable or otherwise, so there was nothing to
evict. `marqueeDiagCheck`'s own logic (a plain 3px threshold compare,
called unconditionally every tick) has no structural reason to miss a
~26 real-device-px (~7 CSS px) shift -- unless the function it lives
inside, `stepRoloMarquee`, silently stopped running at some point before
the jump. An uncaught exception anywhere in that function would do
exactly that (stop calling `requestAnimationFrame` again, with nothing
visible on a real phone to say so) -- and the marquee's continuing
smooth visual motion doesn't rule this out, since `#roloIndex` has
`-webkit-overflow-scrolling:touch` + `touch-action:pan-x`, so native
momentum/scroll-anchoring could plausibly keep things moving even if
this specific JS loop had already died.

**Fix: a live heartbeat plus a self-healing loop.** `#diagHeartbeat` (a
small always-visible line, separate from the scrollable event log so it
never gets overwritten by a re-render) shows a live "loop alive:
HH:MM:SS.mmm (tick N)" reading, updated every 15 ticks from inside
`stepRoloMarquee` itself -- directly provable on the next
screenshot/video whether this function is genuinely still executing at
the moment of a jump, removing the need to infer it indirectly.
`stepRoloMarquee`'s body is now wrapped in `try/finally`:
`requestAnimationFrame(stepRoloMarquee)` is guaranteed to fire again
regardless of what happens inside, and any exception gets caught,
logged as a notable `ROLO-LOOP-ERROR` diag event (so it's visible
instead of silent), and the loop keeps running afterward rather than
dying permanently.

**Verified via injected fault, not just that it compiles.** Directly
overrode `#roloIndex`'s `scrollLeft` setter to throw once (simulating an
unexpected real-device failure inside the exact line that would trigger
one) and confirmed: the error is caught and logged (`ROLO-LOOP-ERROR`,
correctly flagged notable/red); the heartbeat keeps advancing
uninterrupted through and after the injected failure; the loop provably
never stops. Also confirmed the heartbeat advances normally under
ordinary operation with zero errors.

**Status: still no confirmed root-cause mechanism for the jump itself**,
but this closes the one remaining structural gap in the diagnostic
tooling -- if the loop really is dying on a real device, the next
video/screenshot's heartbeat will show a stale timestamp frozen before
the jump, which would finally explain why nothing has been caught
despite three independent, precisely-matching occurrences. If the
heartbeat is instead still ticking normally right through the next
occurrence, that rules this theory out too and narrows things further.

`preview/rolodex/app.js` and `preview/rolodex/index.html` bumped to
`?v=19` per the cache-busting rule.

## Frontend: Rolodex preview — fourth video rules out dead loop, scrollWidth diagnostic added (Aug 16, 2026, `?v=20`)

A fourth real screen recording (91fps, 6.32s) reproduced the same
anomaly a fourth independent time -- **-27px**, same precise magnitude
as the prior three (-26, -26, -28, -27), same single-frame signature,
confirmed via the same full-resolution lossless frame-by-frame method.

**Direct, in-frame proof the loop was alive.** This video happened to
have the `?v=19` heartbeat already visible on screen. Read it at the
exact video frame the jump occurs (tick 4905) and again ~25 frames later
(tick 4935) -- the heartbeat had genuinely advanced right through the
moment of the jump. This is the first hard, direct evidence (not
inference) that `stepRoloMarquee`'s loop was NOT dead at the moment of a
real occurrence, ruling out the `?v=19` theory for good.

**Three concrete hypotheses were checked against the actual code
directly, not assumed either way, per a live suggestion:**
- *Missing clones causing an empty gap before snapping back* -- doesn't
  apply; the strip already renders multiple full duplicate passes (see
  the marquee-wrap work earlier in this file), confirmed still true by
  reading `appendChipPass()`/the guard loop in
  `renderRolodexFromWatchlist()`.
- *Wrap math using `offsetWidth`/`clientWidth` instead of `scrollWidth`,
  introducing rounding error* -- already ruled out by the `?v=11` fix,
  which specifically moved `sizeRoloMarquee()` to sub-pixel
  `getBoundingClientRect()` for exactly this reason. Re-confirmed by
  reading the current code -- still true.
- *A CSS `transition` (or `scroll-behavior:smooth`) on the scroll
  container animating the "snap back" instead of resetting instantly* --
  checked directly: `.rolo-index`/`#roloIndex` has no `transition`
  property of any kind, and `scroll-behavior:smooth` doesn't appear
  anywhere in this file. Doesn't apply here (this is a real, common cause
  of marquee "sliding backward" bugs in general, just not present in this
  specific implementation).

**So if the loop is alive and none of those three apply, why does
`marqueeDiagCheck` still miss it every time?** Re-examined its actual
tracking scope, and found a real, previously-unnoticed gap:
`marqueeDiagCheck` only ever watches ONE reference element --
`roloCountDivider`, specifically the FIRST duplicate pass's divider.
`renderPill(sym)` updates every duplicate instance of a symbol's chip
independently (`document.querySelectorAll('.rolo-chip[data-sym="..."]')`,
not one shared/templated node) -- if a chip's rendered width changes in
a LATER pass, only content sharing that pass (and everything after it)
shifts; content before it, including the FIRST pass's divider being
tracked, wouldn't move at all, or would move by a different amount
depending on where in the DOM order the affected pass sits. A single
fixed tracking point can miss a real, visible shift purely because of
where it happens to sit relative to whatever actually changed.

**Fix: track `#roloIndex.scrollWidth` itself, not just one element's
position.** `checkRoloScrollWidth()` runs every tick alongside the
existing check, comparing the strip's total content width frame to
frame -- immune to the tracking-gap above, since a real per-chip width
change shows up in the TOTAL regardless of which specific DOM node
caused it or where it sits. Reset alongside `roloMarqueePos`/
`roloMarqueeDataReady` in `renderRolodexFromWatchlist()` so a real,
legitimate watchlist rebuild doesn't false-positive against its own
large, expected content-width change.

**Verified concretely, not just that it compiles:** confirmed zero false
positives during ordinary idle operation; directly mutated ONE chip in a
LATER duplicate pass only (not the first, matching the exact gap this
fix targets) and confirmed it's caught and logged, where the prior
divider-only check would have missed it; confirmed a real watchlist
rebuild via the actual Import UI does not false-positive despite its own
genuine, large scrollWidth change.

**Status: still no confirmed root-cause mechanism**, but the dead-loop
theory is now conclusively ruled out (not just untested), three
plausible general causes have been checked against the actual code and
ruled out specifically for this implementation, and the diagnostic now
covers a real tracking gap the last three rounds couldn't see past. Next
real occurrence: check for a `SCROLLWIDTH changed` entry -- if content
width genuinely is changing somewhere in the strip, this will name the
exact before/after numbers even if `marqueeDiagCheck`'s own single
tracked point stays silent.

`preview/rolodex/app.js` and `preview/rolodex/index.html` bumped to
`?v=20` per the cache-busting rule.

## Frontend: Rolodex preview — fifth video, found the real reason nothing was ever visible (Aug 16, 2026, `?v=21`)

A fifth real screen recording reproduced the same jump a fifth
independent time -- **-26px**, same signature (frame 142→143, ~1.56s in,
residual 0.08, confirmed via a proper 2D search this time, not just
horizontal-only, to rule out a vertical-misalignment measurement
artifact -- the best alignment was still purely horizontal, dx=-26,
dy=0). The `?v=19` heartbeat was visible throughout this clip too and
advanced normally (tick 2715 -> 2850 -> 3105) right through the jump,
reconfirming the loop was alive. The overlay's content stayed completely
unchanged for the ENTIRE clip -- `?v=20`'s `checkRoloScrollWidth()`
caught nothing either, ruling that leading hypothesis out too.

**With loop-liveness, scrollLeft, scrollWidth, and general layout-shift
coverage all in place and all coming back empty five times in a row,
the diagnostic tooling itself became the thing to re-audit** -- and
found a real, confirmed bug in it, not the app. Reproduced directly:
`renderDiagOverlay()` reassigns `#marqueeDiag`'s `innerHTML` on every
new event, but reassigning `innerHTML` does NOT reset `scrollTop`. The
panel is deliberately touch-scrollable (`?v=15`) so a real touch on it
-- entirely plausible over a multi-minute session, especially once
enough content has accumulated to actually scroll -- leaves it scrolled
away from the top. A brand new event still renders into the DOM
correctly, but sits scrolled OUT OF the panel's own visible viewport,
invisible on screen even though it's genuinely there.

**Confirmed via direct reproduction, not inferred:** padded the panel
with realistic multi-minute-session-scale content, scrolled it partway
down (matching a real touch), fired a real notable event, and measured
via `getBoundingClientRect()` that the new entry's rect sat entirely
above the panel's own visible rect (`entryBottom: 702.5` vs
`panelTop: 688`) -- present in the DOM, provably invisible on screen.
This is a real, plausible explanation for every single "the overlay
caught nothing" report across all five rounds of this investigation --
the events may well have been firing correctly the entire time.

**Fix:** `renderDiagOverlay()` now force-sets `scrollTop = 0` after every
render. The panel's whole purpose is surfacing the latest event, so
snapping back to the top on every update is the correct behavior, not
just a bug patch. Re-ran the exact same reproduction after the fix and
confirmed the new entry now measures as visible within the panel's rect.
Full pill-tap/auto-analyze/accordion/dock regression suite re-run, zero
errors.

**This is the first fix in this investigation targeted at the
diagnostic's own visibility rather than at what it's supposed to be
watching** -- if the marquee-side checks really have been firing this
whole time, the next occurrence should finally show something.

`preview/rolodex/app.js` and `preview/rolodex/index.html` bumped to
`?v=21` per the cache-busting rule.

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

## Engineering: TypeScript adoption path — investigated, not yet started (Aug 14, 2026)

Mr. T got questioned externally on why this project is plain JavaScript and
asked directly: what's actually lost by staying JS, is a pivot away from it
realistic, and is there a real benefit. Answered in two parts, then asked to
turn the answer into an actual plan, framed as something that could ride
along with the planned Rolodex UI rework (see the collapsing-card
exploration section above) rather than as a separate effort. **Nothing in
this section has been built — this is a plan plus one real investigation,
not a change to either repo.** Full formatted version, including the actual
terminal output:
`https://claude.ai/code/artifact/100a336b-d173-4f0f-9d88-875d628bdd0f`.

**The framing that survived scrutiny:** don't change the runtime for either
side. The backend (`Tra`) is I/O-bound API-proxying work (Finnhub/Alpaca/SEC)
— Node's non-blocking model already fits that, and a language rewrite would
mean re-deriving every hard-won fix already in this file (the Finnhub/Alpaca
throttle queues, the Supabase session-leak fix, the SEC rate limiter) with
real risk of quietly reintroducing bugs that cost actual production incidents
to find the first time. The frontend can't leave JavaScript at all — it's a
static site a browser executes, full stop. What's actually on the table is
layering **TypeScript type-checking** on top of the existing JS, incrementally,
and separately, whether to eventually add a **bundler** (a bigger, different
question from "types," addressed below).

**This wasn't just reasoned about — it was tested against the real repos.**
Ran actual `tsc` (TypeScript 6.0.2) with `allowJs`/`checkJs`/`noEmit` against
`shared/*.js` and both repos' `gates-extended.js` before writing any of the
plan below, specifically to avoid shipping a fourth confident-but-unverified
claim in this file. Three findings came out of it:

1. **The `?v=N` cache-busting convention breaks static module resolution
   completely.** `tsc` (and by extension any bundler) cannot resolve
   `'./prefs.js?v=10'` as a module specifier at all — every hand-versioned
   import in this codebase fails the same way. This is the concrete,
   demonstrated reason a bundler would help, not a generic "modern tooling"
   claim — it's specifically what makes the existing cache-busting rule's
   failure mode (documented above, cost real hours Aug 2-3) structurally
   possible in the first place. A real bundler content-hashes output
   filenames automatically, which makes that whole bug class unrepresentable.
2. **Plain `checkJs` with zero type annotations catches almost nothing.**
   Once the import-resolution problem above is worked around, the only
   remaining errors on the actual `shared/*.js` files are generic DOM-typing
   noise (`Property 'value' does not exist on type 'HTMLElement'` from
   `querySelector`'s return type) — expected, not real bugs, fixed with
   casts. The real payoff only shows up once actual shapes are written down
   as JSDoc `@typedef`s — that annotation work IS the actual task, not
   flipping a compiler flag.
3. **Reproduced the real Aug 13 Gate 5 bug directly.** Wrote the pre-fix
   `evaluateProxyStatus` shape (`marketData[s].pct`, assuming an object) next
   to a one-line `@typedef` for what `sectorContext[symbol]` actually is in
   production (`Record<string, string>` — a formatted `"+1.23%"` string,
   never an object) and `tsc` flagged `Property 'pct' does not exist on type
   'string'` immediately, at the exact line. That's the same bug that
   shipped silently and made Gate 5's RED status unreachable until it got
   root-caused by hand three weeks later — caught here on save, from nothing
   but a type declaration for a shape that was already true.

**The path — five phases, each shippable as its own PR, same as everything
else in this file:**
- **Phase 0 — JSDoc + `checkJs`, no `.ts` files, no build step, ever.** One
  `tsconfig.json` (`checkJs`/`noEmit`), then real `@typedef`s for the highest-
  risk shapes first: the `/analyze` request/response, `TickerData`,
  `GateResult` — the exact contract that's broken twice already. Effort low,
  risk none, payoff high — this is what Finding 3 above demonstrates directly.
- **Phase 1 — shared contract types, hand-mirrored.** One `types/api.d.ts`
  copied into both `Tra` and this repo, same "keep these files identical"
  convention already used for the mirrored `server.js`. Doesn't fix the
  two-repo drift problem itself, but gives both sides something concrete to
  drift *against* instead of drifting silently. Effort low, risk none.
- **Phase 2 — real `.ts`, transpile-only, still no bundler.** Convert
  `shared/` leaf modules and both `gates-extended.js` files one at a time,
  highest-fan-out first. `tsc` emits one `.js` per `.ts` with no bundling —
  GitHub Pages keeps serving the exact same file layout it does today.
  Effort medium, risk low.
- **Phase 3 — a real bundler (esbuild or Vite), paired with the Rolodex UI
  work, not before.** This is the one phase that changes the deploy
  pipeline, so do it when the UI rebuild is actually greenlit — that work
  already touches every tier's markup and every shared module, so the
  bundler-adoption cost lands in the same PRs instead of a separate
  migration nobody asked for. This is what actually eliminates Finding 1,
  structurally, not just documents around it. Effort medium-high, risk
  medium.
- **Phase 4 — formalize the simulation scripts into a real test suite,
  after Phase 3.** Every recent gate-logic change (Proposal 3, Proposal 4,
  the Gate 5 fix) was already verified with a throwaway Node script
  simulating real inputs, documented above each time as "verified by
  simulation" then discarded. Checking those in as a real test suite (Vitest,
  or even Node's built-in runner without waiting on Phase 3) converts work
  already being done into permanent regression coverage for the trickiest
  logic in the app. Effort low-medium, risk none.

**Explicitly not part of this plan:** a backend language swap (already
covered above — I/O-bound work, Node isn't the bottleneck); adopting a
frontend framework (bigger, separate decision, real dependency surface this
app has deliberately avoided so far); converting Shark now (already flagged
elsewhere in this file as deliberately deferred pending the Alpaca "Plus"
decision — fold TS into that rebuild whenever it happens, don't do it
twice); one big-bang PR (no test suite exists yet, so file-by-file keeps
every step revertable).

**If picked back up in a future session:** Phases 0 and 1 need nothing
decided about the UI rework first and can start immediately — a
`tsconfig.json` scoped to `shared/*.js` and both `gates-extended.js` files,
one hand-written `types/api.d.ts` for the real `/analyze` and
`/ticker/:symbol` shapes mirrored into both repos, then a baseline
`tsc --noEmit` run to see what else surfaces beyond what's already found
above.

### Phase 0 shipped (Aug 14, 2026, `trade-verdict` only — not yet in `Tra`)

Landed the same day as the plan above: a real `tsconfig.json`
(`checkJs`/`noEmit`/`allowJs`, no build step) scoped exactly to
`shared/*.js` + this repo's own `gates-extended.js`, plus
`shared/types.js` — JSDoc-only `@typedef`s for `GateResult`,
`SectorContext`, `TickerData`, `AnalyzeRequestBody`, `AnalyzeResponse`
(the highest-risk shapes the plan named). `shared/types.js` is never
loaded at runtime (JSDoc `@typedef {import(...)}` references are erased
comments, not real imports), so it's exempt from the cache-busting rule —
don't add it a `?v=`.

Applied the typedefs to real call sites within the checked scope, not just
declared them: `gates-extended.js`'s exported functions
(`proxyCoherenceCheck`, `regimeValidation`, `hasForceDownAuthority`,
`resolveFixedProxyBreak`, `evaluateGate1Sessions`, `contextTextMatches`,
`buildupPatternCheck`, `corroborateSessionContext`, `dailyReturns`,
`pearson`) now have real `@param`/`@returns` JSDoc instead of implicit
`any`; `shared/ticker-cache.js`'s `fetchTickerData()`/`tickerCache`/
`inFlight` are typed against `TickerData`; `shared/watchlist.js`'s
`updateCardMeta(ticker, td)` — the actual `TickerData` consumer that
renders a card's price/52W/news/phase strip — is typed the same way.

**Actually verified the mechanism works, not just that it compiles clean.**
Built a throwaway scratch reproduction of the real Aug 13, 2026 Gate 5 bug
shape (feeding `sectorContext.tsm` — a formatted `"-6.20%"` *string* — into
`proxyCoherenceCheck()`, which expects a parsed `number`, the exact mistake
`evaluateProxyStatus()` made in production for three weeks) against the
real `gates-extended.js` JSDoc types: `tsc` flagged
`Argument of type 'string' is not assignable to parameter of type
'number'` immediately. Confirms this isn't just documentation — it would
have caught that exact bug class on save. Scratch file discarded after
confirming, never part of the repo.

One real (harmless) type mismatch turned up and got fixed along the way:
`shared/watchlist.js`'s `updateCardMeta()` called
`parseFloat(td.metrics.price)` before `.toFixed(2)`, but
`metrics.price` is already a `number` on the wire (`fetchTickerMetrics()`
in server.js never stringifies it — that's a different function,
`fetchQuote()`, used for `/market`'s tracked-symbol entries, not
`/ticker/:symbol`). `parseFloat` on an already-numeric value is a no-op
(JS coerces it to a string and back to the identical number), so this was
never a live bug, just sloppy — simplified to
`td.metrics.price.toFixed(2)` directly, byte-identical output.

**A fresh `tsc -p tsconfig.json` run still shows ~26 known, expected
errors** — unchanged in nature from what the investigation already found
and documented above, not something this pass tried to silence:
`./foo.js?v=N` import-resolution failures (every real ES import in the
checked files, since `?v=` isn't a valid module specifier to any
resolver — the concrete reason Phase 3's bundler is on the roadmap) and a
handful of generic DOM-typing errors (`Property 'value' does not exist on
type 'HTMLElement'`, `window.foo` assignments) on pre-existing
`getElementById`-heavy code in `shared/settings-modal.js`/`track-record.js`/
`watchlist.js`. Left alone deliberately — real but low-value casting churn
outside Phase 0's actual scope (the typedefs), not a regression and not
something Phase 0 promised to zero out.

**Not done in this pass:** mirroring `tsconfig.json`/`shared/types.js`'s
JSDoc-typing approach into `Tra`'s own copy of `gates-extended.js` — this
session's repo scope was `trade-verdict` only. `server.js` (where the
real `/analyze` handler, `evaluateProxyStatus()`, and `evaluateGate1()`
actually live) and every tier's `app.js` are still outside `checkJs`'s
scope too, per the plan's own reasoning (untyped Express/Stripe/Supabase
surface, much higher noise) — a natural widening for a future pass, not
an oversight here.

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
