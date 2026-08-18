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

## Frontend: Rolodex preview — ticker pill marquee jump, full saga and resolution (Aug 15-16, 2026, `?v=11` → `?v=23`)

Consolidated from what was originally ~20 separate dated entries
(`?v=11` through `?v=23`) tracking a single live-reported bug: the
Rolodex preview's auto-scrolling ticker pill strip (and, it turned out,
the docked Gate's own index marquee) visibly "jumped" or "snapped"
during normal operation. Kept as one entry now that the real root cause
is found, fixed, and **confirmed resolved live by Mr. T** — the
blow-by-blow diagnostic history is no longer useful day-to-day and was
making this file unwieldy; the reasoning trail below is the condensed
version.

**Real, confirmed sub-bugs found and fixed along the way (all still in
effect, all genuine improvements regardless of the final root cause):**
- Sub-pixel wrap-boundary measurement (`?v=11`/`?v=12`) — replaced
  `offsetLeft`/`offsetWidth`/`scrollWidth/2` (which round to the nearest
  integer per spec) with `getBoundingClientRect()`-based measurement, for
  both the pill strip and the Gate's own index marquee.
- Content-reflow timing (`?v=13`/`?v=14`) — held the marquee paused until
  a render pass's real ticker data has actually loaded (`roloMarqueeDataReady`),
  and reserved price-text width up front (`min-width:7ch` on `.rc-price`)
  so a placeholder-to-real-data swap can't reflow content out from under
  an already-scrolling strip.
- Marquee pause/resume reliability (`?v=7`) — made the 2s tap-pause
  self-scheduling instead of relying solely on `pointerup`/`pointercancel`,
  which don't reliably fire on a real device.
- Native focus-scroll suppression — `pointerdown` → `preventDefault()` on
  each chip so tapping one can't let the browser's own "scroll focused
  element into view" yank the strip's position independent of the
  marquee's own state.

**The much longer chase: an elusive, seemingly one-time ~26-28px jump,
never conclusively explained by any live diagnostic.** Starting `?v=15`,
built an escalating series of real-device diagnostics after repeated
live reports of "still jumping" that none of the above fixes resolved:
a Layout Instability API observer (`?v=15`, then fixed to stop catching
its own address-bar-driven repositioning, `?v=17`), a native `scroll`-event
ground-truth watcher (`?v=16`), a live loop-heartbeat plus self-healing
`try/finally` wrapper to rule out the marquee's `requestAnimationFrame`
loop silently dying (`?v=19`), a `scrollWidth`-based check to catch a
width change anywhere in the strip regardless of which specific DOM node
caused it (`?v=20`), a fix for the diagnostic overlay's own `scrollTop`
not resetting on new entries — a real, separately-confirmed bug that
could have hidden any of the above (`?v=21`), and an integer-rounding
mitigation for the marquee's `scrollLeft` writes (`?v=22`). Six separate
real screen recordings (91fps slow-motion, analyzed frame-by-frame via
`ffmpeg` + lossless PNG cross-correlation) all showed the same precise
~26-28px anomaly, but **every one of these live diagnostics came back
empty every single time** — including once independently confirming the
diagnostic pipeline itself was demonstrably healthy and simply had
nothing to report. This pattern (real, reproducible, precisely
consistent magnitude; totally invisible to scrollLeft/scrollWidth/layout-shift
instrumentation) was reasoned about at length as possibly being a
paint/compositor-layer phenomenon outside what page-level JavaScript can
observe at all — a reasonable dead end at the time, given what live
diagnostics alone had turned up.

**Root cause, found by direct code review instead of another live
diagnostic round.** Mr. T reviewed `app.js` directly and identified a
real, precise bug in `sizeGateMarquee()`/`sizeRoloMarquee()`'s
wrap-boundary math that none of the runtime diagnostics above were
built to catch: `boundary.right − container.left + scrollLeft` silently
assumes the container's own left edge sits exactly one repeat-period
before the measured boundary — true only with zero container padding and
a trailing flex `gap` that happens to net to zero against it. Neither
held: `.gate-marquee` has `gap:16px` and no padding; `#roloIndex` has
`padding-left:14px` and `gap:6px`. Verified directly against the real
rendered page before changing anything: the old formula computed
500.20px for the Gate against a true repeat-period of 516.20px (a
constant **-16px**, matching the gap exactly) and 356.19px for the pill
strip against a true 348.19px (a constant **+8px**, matching
`padding(14) − gap(6)` exactly) — not noise, not intermittent, a fixed
arithmetic error every time.

**Fix (`?v=23`):** both functions now measure the distance between pass
1's first item and pass 2's first item directly
(`items[0].getBoundingClientRect().left` vs.
`items[itemsPerPass].getBoundingClientRect().left`), rather than
reasoning about the container's edge, its padding, and the flex gap
individually. Both reads happen at the same instant with the same
`scrollLeft` applied to both, so the scroll offset cancels out of the
difference automatically — no `+ scrollLeft` term needed either,
simplifying the formula while fixing it. Re-verified the fix eliminates
both errors to `<0.01px` (floating-point-exact) against the same
true-period measurement, then the full pill-tap/auto-analyze/accordion/dock
regression suite, then a live device test — **confirmed fixed by Mr. T.**

**Lesson worth keeping, independent of this specific bug:** six rounds
of live, real-device diagnostic tooling — genuinely rigorous, individually
well-reasoned, each one verified before shipping — never surfaced this,
because none of them were built to check wrap-boundary *arithmetic*
correctness; they were all built to catch *unexpected* runtime state
changes (scrollLeft mismatches, width changes, dead loops). A
systematic, deterministic math error that fires the same way every
single time doesn't look anomalous to instrumentation designed to catch
anomalies — it just looks like "how this always behaves." Direct code
review, or a from-scratch derivation of what the correct value *should*
be and comparing it to what the code actually computes, found in one
pass what six rounds of runtime diagnostics across real device video
could not. Neither approach is strictly superior — the diagnostics did
conclusively rule out several other real hypotheses (dead loop, single-
element tracking gaps, overlay visibility) that needed ruling out either
way — but this is a concrete case where stepping back to re-derive the
expected math from first principles was the more direct path to the
actual bug.

The diagnostic tooling built during the chase (`#marqueeDiag` overlay,
`#diagHeartbeat`, the Layout Instability observer, the scroll
ground-truth watcher, `checkRoloScrollWidth()`) is still in
`preview/rolodex/app.js`/`index.html` as of this writing — harmless and
still genuinely useful if any *new* marquee-adjacent issue shows up, not
removed as part of this consolidation. A future pass could reasonably
strip it out now that the bug it was built to chase is resolved, but
that's a separate, deliberate cleanup decision, not implied by this one.

`preview/rolodex/app.js` and `preview/rolodex/index.html` are at `?v=23`.

| Tier | Files | Status |
|---|---|---|
| Free | `index.html` + `app.js` | Rebuilt onto the Rolodex UI Aug 16, 2026 (see "Frontend: Rolodex UI shipped to Free" below) — second real (non-preview) tier on the Rolodex UI, after Starter. **`app.js` is now a bundled build artifact, not hand-written** — the real source is `app.ts` (repo root), compiled via `node esbuild.config.mjs`; edit the `.ts`, never the `.js` directly. Consumes `shared/rolodex.ts` for Gate dock/marquee/stacked-card/swipe mechanics, same as Starter. Its top-level "redirect a paid session elsewhere" check still halts the rest of module init (`redirectingToPaidTier` flag, unchanged from before this rebuild) — see the testing note below for why that mattered. |
| Starter | `starter/index.html` + `starter/app.js` | Rebuilt onto the Rolodex UI Aug 16, 2026 (see "Frontend: Rolodex UI shipped to Starter" below) — sticky-docking Gate, marquee ticker-pill strip, single-active-card stage with tap-pill-then-swipe-to-delete, real auth/credits/Settings/Session-Context-highlighting/server-sync unchanged. First real (non-preview) tier on the Rolodex UI; Pro/Shark still on their prior designs. **`starter/app.js` is now a bundled build artifact, not hand-written** (Phase 3 kickoff, same day) — the real source is `starter/app.ts`, compiled via `node esbuild.config.mjs`; edit the `.ts`, never the `.js` directly. Its Rolodex-mechanics half now lives in `shared/rolodex.ts`, shared with (and now also consumed by) Free's own Rolodex build rather than re-copied. |
| Pro | `pro/index.html` + `pro/app.js` | Rebuilt onto the Rolodex UI Aug 16, 2026 (see "Frontend: Rolodex UI shipped to Pro" below) — third real (non-preview) tier on the Rolodex UI, after Starter and Free. **`pro/app.js` is now a bundled build artifact, not hand-written** — the real source is `pro/app.ts`, compiled via `node esbuild.config.mjs`; edit the `.ts`, never the `.js` directly. Consumes `shared/rolodex.ts` for Gate dock/marquee/stacked-card/swipe mechanics, same as Starter/Free. Keeps its pre-Rolodex Pro-exclusive features — Analyst View (per-card expandable subsection), Proxy Resolution Explorer + live coherence strip, Sector Heat Map, real (not teaser) server-synced Track Record with trigger/ticker accuracy breakdowns, CSV export — all ported forward, not dropped; see that section for exactly what changed shape (card/watchlist split → pill-strip cap + overflow accordion) vs. what ported unchanged. |
| Shark | `shark/index.html` (no separate `app.js` — still monolithic) | **NOT rebuilt — shelved indefinitely as of Aug 17, 2026, not a backlog gap.** Earlier notes here framed this as blocked on an Alpaca "Plus" data-plan upgrade Mr. T might do at some point; that framing is retired per direct instruction — it's just off the table now, not "pending a decision." Don't pick this up proactively; it still carries the same reorder/log-button bugs Pro had before its rebuild (shared original template) whenever it does eventually happen. A separate, standalone `shark/coming-soon.html` splash (added Aug 2, 2026, licensed mascot art at `shared/assets/shark-mascot.png`) exists alongside it — email waitlist writes directly to Supabase's `shark_waitlist` table (anon insert-only via RLS) from the browser, no backend involvement. |

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

### Phase 0 shipped (Aug 14, 2026, `trade-verdict`; mirrored into `Tra` Aug 16, 2026)

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

**Mirrored into `Tra` (Aug 16, 2026, `Tra` PR #35).** `Tra`'s repo scope
wasn't available to the session that shipped Phase 0 above, so this was
flagged there as a deliberate follow-up rather than done in that same
pass — picked back up once `Tra` was added. `Tra` now has its own
`tsconfig.json` (scoped to `gates-extended.js`; that repo has no
`shared/` subdirectory, so it's a flatter layout than this one) and
`types.js`, kept identical to this repo's `shared/types.js` in the actual
`@typedef` bodies (only header commentary differs, adjusted for `Tra`'s
own context) — confirmed via diff that `Tra`'s `gates-extended.js` was
otherwise byte-identical to this repo's copy before adding the JSDoc, so
this was a pure annotation mirror, not a reimplementation carrying any
logic-drift risk. Re-verified the mechanism there too, not just assumed
it would transfer: reproduced the same Aug 13, 2026 Gate 5 bug shape
against `Tra`'s real typedefs and got the same `tsc` error, plus a clean
`tsc -p tsconfig.json` run (exit 0, zero errors — `Tra`'s
`gates-extended.js` has no ES `import`/`export` statements at all,
unlike this repo's browser-loaded `shared/*.js`, so it doesn't carry the
`?v=`-cache-busting-driven noise category documented above).

`server.js` (in both repos — where the real `/analyze` handler,
`evaluateProxyStatus()`, and `evaluateGate1()` actually live), `Tra`'s
`credits.js`, and every tier's `app.js` are still outside `checkJs`'s
scope, per the plan's own reasoning (untyped Express/Stripe/Supabase
surface, much higher noise) — a natural widening for a future pass, not
an oversight here.

### Phase 1 folded into the `Tra` mirror above; Phase 2 kicked off (Aug 16, 2026)

Picked back up in the same session as the `Tra` mirror. Phase 1's own
description ("shared contract types, hand-mirrored... one file copied
into both `Tra` and this repo") turned out to be the exact same artifact
as the `Tra` mirror just shipped — `shared/types.d.ts` (see below) and
`Tra`'s `types.js` now ARE that one shared, hand-mirrored contract file.
No separate Phase 1 pass was needed; noted here so it doesn't read as
skipped.

**Phase 2 (real `.ts`, transpile-only, still no bundler) started with
two changes:**

1. **`shared/types.js` (JSDoc) replaced by `shared/types.d.ts` (real
   `interface`/`type` declarations)** — same shapes, formalized into
   actual TS syntax instead of typedef comments. Zero runtime-behavior
   risk: this file was never loaded at runtime before (JSDoc
   `@typedef {import(...)}` is an erased comment) and a `.d.ts` file
   can't be loaded at runtime either. **Verified, not assumed, that every
   existing consumer's `@typedef {import('./types.js').X}` reference
   still resolves correctly against the new `.d.ts` sibling:** temporarily
   removed `shared/types.js` entirely and re-ran `tsc -p tsconfig.json` —
   the exact same 26 known/expected baseline errors, zero new ones, zero
   mentions of `types.js` failing to resolve. This is TypeScript's
   standard Node-style "`.js` specifier resolves to a sibling `.d.ts`"
   behavior working exactly as documented, confirmed against this repo's
   real files rather than taken on faith.
2. **`shared/ticker-cache.ts`** — the first real `.ts` conversion.
   Picked as the starting point deliberately: highest fan-out (imported
   by 6 other files, tied for most in `shared/`) among files with zero
   *internal* `shared/` dependencies of their own (a true leaf — unlike
   `watchlist.js`, which imports `ticker-cache.js` and so needs to convert
   after it, not before). `tsconfig.build.json` (separate from
   `tsconfig.json`, which stays `noEmit:true` for pure type-checking) is
   the actual compile step — `npx tsc -p tsconfig.build.json` emits
   `shared/ticker-cache.js` in place from the `.ts` source, so GitHub
   Pages keeps serving the identical file path/layout it always has. The
   emitted `.js` (not the `.ts`) is the real deploy artifact — both are
   committed together, and the compiled output is what actually ships.

**The full cache-busting cascade this triggered, worked through
completely, not just the first hop:** `ticker-cache.js`'s content changed
(even though its behavior is equivalent, the emitted bytes differ from
the hand-written original) → bumped `?v=4→5` in its 5 importers
(`shared/watchlist.js`, `app.js`, `starter/app.js`, `pro/app.js`,
`preview/rolodex/app.js`) → `shared/watchlist.js`'s own content changed
as a result, so its `?v=27→28` bumped in ITS importers
(`shared/watchlist-sync.js`'s own relative import, `app.js`,
`starter/app.js`, `pro/app.js`) → `shared/watchlist-sync.js`'s content
changed too, `?v=20→21` bumped in its 3 importers → finally, every tier's
own top-level `app.js` changed (multiple import lines inside each),
so each tier's `<script src="./app.js?v=N">` bumped too (`index.html`
42→43, `starter/index.html`/`pro/index.html` 43→44,
`preview/rolodex/index.html` 23→24). `shark/index.html` confirmed
untouched (monolithic, no `shared/` imports at all).

**Verified via real headless Chromium, not just that `tsc` was clean:**
loaded Free tier and the Rolodex preview against a mocked backend,
confirmed zero JS errors on either, confirmed a real ticker card/pill
actually renders fetched price data end-to-end through the newly
TS-compiled `ticker-cache.js` (not just that the file parses).

### `shared/watchlist.js` converted to `.ts` (Aug 16, 2026)

Second Phase 2 conversion, picked up immediately after `ticker-cache.ts`
per the plan above — `watchlist.js` was the natural next step since it
depends on the now-converted `ticker-cache.js` and is tied for the
highest fan-out (7 importers) in `shared/`. Same transpile-only workflow:
`shared/watchlist.ts` authored, `tsconfig.build.json`'s `include` widened
to cover it, `tsc -p tsconfig.build.json` emits `shared/watchlist.js` in
place — the compiled output is the real deploy artifact, committed
alongside the `.ts` source.

**This file is far more DOM-heavy than `ticker-cache.ts`** (gesture
handling, card rendering, undo toast, drag-to-reorder) — worth being
explicit about which parts actually got real types vs. which stayed
loose, since that was a deliberate line, not an oversight:
- The public API — `initWatchlist`/`setWatchlist`/`addTickers`/
  `removeTicker`/`updateCardMeta`/etc. — now has real parameter/return
  types, including `updateCardMeta(ticker: string, td: TickerData | null)`
  against `shared/types.d.ts`'s real `TickerData` interface (previously
  JSDoc-only).
- The four concrete DOM-typing errors this file actually had under
  `checkJs` (`newsEl.style` on an `Element`-typed `querySelector` result,
  `.value` on `#context-input`/`#ticker-input` typed as bare
  `HTMLElement`) got real, minimal casts (`as HTMLElement`,
  `as HTMLTextAreaElement`, `as HTMLInputElement`) — verified against the
  actual markup (`grep` confirmed `#context-input` is a `<textarea>`,
  `#ticker-input` an `<input>`) rather than guessed. The
  `window.addTickers = addTickers` bridge (the inline `onclick`
  attribute's only way to reach the module scope) got a real
  `declare global { interface Window { addTickers: ... } }` augmentation
  instead of an `as any` escape hatch.
- The drag/swipe gesture state machine (`ACTIVE`, `onPointerDown`/`Move`/
  `Up`, `trySwap`, `finishSwipe`/`Reorder`) was deliberately **left
  untyped** (`any`), matching — not fighting — the same implicit-any
  behavior this code already had as plain `.js` under `checkJs` (`var
  ACTIVE=null` already widened to `any` under this repo's
  `strictNullChecks:false` setting, so typing it explicitly would only
  add churn without catching anything). Properly typing pointer-event
  target chains (`e.target.closest(...)`) would mean casting nearly
  every DOM access in this section for no real payoff — exactly the
  "real but low-value churn" category `tsconfig.json`'s own comments
  already called out as deliberately left alone. This is a scoping
  choice, not a gap: the goal is real types on the data contracts that
  have actually shipped bugs (`TickerData`, the gesture code has never
  been the source of one), not maximal annotation coverage.

**Verified two ways, not just that `tsc` compiled clean:** (1) a
function-signature diff between the pre- and post-conversion
`shared/watchlist.js` — identical 27-function set, confirming nothing
was dropped or renamed in the conversion; (2) real headless Chromium
against a mocked backend — rendered the default 3-card Free-tier
watchlist with real price data flowing through the compiled output,
called `addTickers()`/`removeTicker()` through their actual DOM entry
points (the ticker-input field, `window.addTickers`, and a dynamic
`import()` of the compiled module for `removeTicker`), confirmed the
undo toast's opacity/pointer-events casts work correctly end-to-end
(the exact lines that got new `as HTMLElement` casts), and confirmed
zero page errors throughout.

**Cache-busting cascade, same shape as the `ticker-cache.ts` conversion:**
`watchlist.js` `?v=28→29` in its 4 importers (`shared/watchlist-sync.js`'s
relative import, `app.js`, `starter/app.js`, `pro/app.js`) →
`watchlist-sync.js`'s own content changed as a result (its import line),
`?v=21→22` bumped in its 3 importers → each tier's own `app.js` content
changed (multiple import lines), so each tier's `<script src="./app.js?v=N">`
bumped too (`index.html` 43→44, `starter/index.html`/`pro/index.html`
44→45). `preview/rolodex/` and `shark/index.html` both confirmed
untouched — neither imports `shared/watchlist.js` at all (the Rolodex
preview deliberately reimplements watchlist state standalone, per its
own section above; Shark is still fully monolithic).

### `shared/prefs.js` converted to `.ts` (Aug 16, 2026)

Third Phase 2 conversion — tied with `watchlist.js` for the highest
fan-out (6 importers by direct count) among the remaining `shared/*.js`
files, and unlike `watchlist.js`/`ticker-cache.js` it has **zero internal
`shared/` dependencies of its own** (no imports at all — it's pure
localStorage-backed preference logic plus a small amount of DOM at the
very end), so it converted cleanly with no ordering constraint against
the other two already-converted files. Same transpile-only workflow:
`shared/prefs.ts` authored, `tsconfig.build.json`'s `include` widened,
`tsc -p tsconfig.build.json` emits `shared/prefs.js` in place.

**This file had zero DOM-typing errors under `checkJs` to begin with**
(unlike `watchlist.js`'s four) — its only DOM touchpoint is
`refreshTickerLinks()`'s `querySelectorAll('a[data-ticker]')` loop, and
TypeScript's real return type for that call already carries enough of
the right shape that no cast was strictly required to compile clean;
`as HTMLAnchorElement`/`as HTMLElement` casts were added anyway on the
`.href`/`.dataset` reads for explicitness, not because `tsc` demanded
them. Everything else got real, meaningful types: `TIMEZONES`/
`LINK_SITES` are now typed against real `TimezoneInfo`/`LinkSite`
interfaces (`LinkSite.newsHref` correctly modeled as optional, matching
that Robinhood is the one site with no `newsHref` and falls back to
`href` at the call site), and every exported function
(`buildTemplateFromExample`, `detectTickerInUrl`,
`isValidCustomTemplate`, the getter/setter pairs for both custom
templates, `tickerHref`/`newsHref` themselves) has real parameter/return
types.

**Verified three ways:** (1) an export-name diff between pre- and
post-conversion `shared/prefs.js` — identical 18-export set; (2)
`tsc -p tsconfig.json` — zero errors internal to `prefs.ts` itself, only
the expected `?v=`-import-resolution noise in its consumers; (3) real
headless Chromium against a mocked backend on Pro tier (a fake-but-valid
`tv_session` primed per this file's own testing-notes pattern below) —
confirmed the default Yahoo href renders correctly, switching the Settings
modal's link-site dropdown to TradingView live-updates an already-rendered
ticker link via the `onPrefsChange` → `refreshTickerLinks` cascade,
pasting a real example URL into the custom-link field correctly
auto-detects the ticker and saves a working template
(`buildTemplateFromExample`/`detectTickerInUrl`/`isValidCustomTemplate`
all exercised together, not just unit-tested in isolation), and switching
the timezone dropdown correctly round-trips through `getTzPref`/
`getTzIana` — zero page errors throughout. (A first pass at this test
had a self-inflicted harness bug worth noting for future test-writing in
this repo: overly broad Playwright route patterns like `**/watchlist**`
and `**/track**` — meant to mock the backend's `/watchlist` and `/track`
endpoints — also matched the *local script* fetches for
`shared/watchlist.js` and `shared/track-record.js`, since those filenames
contain the same substrings, and Playwright fulfilled them with mocked
JSON instead of letting the real JS load. Fixed by scoping every mock
route to the real API host (`https://tra-zacg.onrender.com/watchlist**`
etc.) instead of a bare path substring — not a bug in the conversion
itself, but a reminder that this repo's own file-naming overlap with its
own API paths (`watchlist.js` / `/watchlist`, `track-record.js` /
`/track`) is a real trap for any future test route pattern too.)

**Cache-busting cascade, the deepest one yet** — `prefs.js` has more
importers than either prior conversion, and two of them
(`track-record.js`, `settings-modal.js`) hadn't been touched by this
migration before, so this pass also bumped their versions without
converting their content:
`prefs.js` `?v=10→11` in its 6 importers (`shared/track-record.js`,
`shared/watchlist.js`, `shared/settings-modal.js`, `app.js`,
`starter/app.js`, `pro/app.js`) → three of those had their own content
change as a result (an import line), cascading further: `track-record.js`
`?v=15→16` in its 4 importers (`shared/track-record-sync.js`'s relative
import, `app.js`, `starter/app.js`, `pro/app.js`); `watchlist.js`
`?v=29→30` in its 4 importers (`shared/watchlist-sync.js`'s relative
import, `app.js`, `starter/app.js`, `pro/app.js`); `settings-modal.js`
`?v=13→14` in its 2 importers (`starter/app.js`, `pro/app.js` — Free has
no Settings UI and never imports it) → those cascaded one hop further in
turn: `track-record-sync.js` `?v=12→13` in its 1 importer (`pro/app.js`
only — Free/Starter don't sync track record, Pro-only per this file's
own Frontend architecture section), `watchlist-sync.js` `?v=22→23` in
its 3 importers → finally every tier's own `app.js` had multiple import
lines change, so each tier's `<script src="./app.js?v=N">` bumped too
(`index.html` 44→45, `starter/index.html`/`pro/index.html` 45→46).
`preview/rolodex/` and `shark/index.html` both confirmed untouched —
neither imports any of `prefs.js`/`track-record.js`/`settings-modal.js`
(Rolodex hardcodes Yahoo directly rather than importing `prefs.js`, per
its own section above; Shark is fully monolithic).

### `shared/track-record.js` converted to `.ts` (Aug 16, 2026)

Fourth Phase 2 conversion, next by fan-out (4 importers). Same
transpile-only workflow: `shared/track-record.ts` authored,
`tsconfig.build.json`'s `include` widened, `tsc -p tsconfig.build.json`
emits `shared/track-record.js` in place. Real types added throughout:
`TrackEntry`/`LogMeta` interfaces for the `tv_accuracy_log` entry shape
and `logResult()`'s optional `meta` param, `Record<string, {c,t}>` for
the type/ticker tally accumulators inside `renderTrackRecord()`, and the
`window.logResult`/`window.clearLog` inline-`onclick` bridges got the
same `declare global { interface Window {...} }` treatment as
`watchlist.ts`'s `addTickers` bridge, instead of `as any`.

**A real bug caught before this shipped, not by any test — by the diff
itself.** Recompiling for this conversion silently reverted
`shared/watchlist.js`'s `prefs.js` import back to `?v=10`, even though
the `prefs.ts` conversion (immediately above) had correctly bumped it to
`?v=11` in every `.js`/`.html` file. Root cause: that bump was applied
with `sed` scoped to `--include=*.js --include=*.html`, which correctly
updated the *compiled* `shared/watchlist.js`, but `shared/watchlist.ts`
— the actual source `tsc` regenerates that file from — still had the
stale `./prefs.js?v=10` hardcoded, since `.ts` files were never in scope
for that grep/sed pass. The bump "worked" only until the next `tsc`
build touched `watchlist.ts` again, at which point it silently
regenerated the old, wrong import — invisible until a `git diff --stat`
sanity check (run as a matter of course before committing, not because
anything looked wrong) showed `shared/watchlist.js` had a 1-line diff it
had no business having. **This is a new, Phase-2-specific corollary to
the cache-busting rule, worth stating explicitly:** once a shared
module has a `.ts` source, that source — not just its compiled `.js` —
is the thing that has to carry the correct `?v=N` on every import it
makes of another shared module. Bumping only the emitted `.js` (by hand,
or via a grep/sed pass scoped to `*.js`/`*.html` the way every prior
cache-busting cascade in this file has been done) is invisible-broken:
correct until the next recompile, then silently wrong again. Fixed here
by correcting `watchlist.ts`'s import to `?v=11` directly and
recompiling; going forward, any `?v=` bump that touches a module with a
`.ts` source must include the `.ts` file in the grep/sed scope, not just
`*.js`/`*.html`.

**Verified three ways:** (1) exact-output comparison, not just an export
diff — ran the pre- and post-conversion module side by side in a
minimal Node harness (stubbed `localStorage`/`document`), fed both the
same synthetic log entries, and confirmed `renderTrackRecord()` produces
**byte-for-byte identical HTML** from both, not just similar-looking
output; (2) `tsc -p tsconfig.json` — zero errors internal to
`track-record.ts`, and after the `watchlist.ts` fix above, `git diff
--stat` against every previously-converted file's compiled output is
empty; (3) real headless Chromium on Pro tier — called `logResult()`
through the compiled module directly (with a real `meta.trigger`),
confirmed the row's injected HTML, confirmed `getAccuracyLog()` returns
the pushed entry with `trigger` correctly attached, confirmed
`renderTrackRecord()` populates `#track-body` with real hit-rate/ticker
data, confirmed both `window.logResult`/`window.clearLog` bridges exist
and work, and confirmed `clearLog()` actually empties the log — zero
page errors throughout.

**Cache-busting cascade:** `track-record.js` `?v=16→17` in its 4
importers (`shared/track-record-sync.js`'s relative import, `app.js`,
`starter/app.js`, `pro/app.js`) → `track-record-sync.js`'s own content
changed as a result, `?v=13→14` in its 1 importer (`pro/app.js` only —
Free/Starter don't sync track record) → every tier's `app.js` changed,
each tier's `<script src="./app.js?v=N">` bumped too (`index.html`
45→46, `starter/index.html`/`pro/index.html` 46→47). `preview/rolodex/`
and `shark/index.html` confirmed untouched.

**Before any future `?v=` bump on a module with a `.ts` source, check
that source's own import lines too** — the lesson from the bug caught in
the `track-record.ts` pass above.

### `shared/analysis-cache.js` converted to `.ts` (Aug 16, 2026)

Fifth Phase 2 conversion — tied with `shared/watchlist-sync.js` for
next-highest fan-out (3 importers), picked first as the true leaf (zero
internal `shared/` dependencies at all — no imports, not even of
`types.js`, until this pass added one). Small, simple module (the
per-ticker/per-day verdict cache backing `tv_v_*` localStorage keys) —
converted in one pass with no DOM surface to reason about at all. Typed
against `AnalyzeResponse` from `shared/types.d.ts` (`cacheVerdict`/
`getCachedVerdict`'s `d`/return value is exactly the parsed `/analyze`
JSON response, confirmed by checking the real call sites in all three
tiers' `app.js` — `var _r=await res.json();cacheVerdict(ticker,_r)`).

**Verified via an exact-output comparison again** (same technique as
`track-record.ts`) — ran the pre- and post-conversion module side by
side in a minimal Node harness with a stubbed `localStorage`, exercised
`cacheVerdict`/`getCachedVerdict`/`cleanLS` against identical inputs,
confirmed identical `JSON.stringify` output and identical surviving
localStorage keys after `cleanLS()`. Also re-ran the same exercise
through real headless Chromium (not just the Node harness) on Free tier
for a live-DOM/live-`localStorage` confirmation, zero page errors.
`git diff --stat` against every previously-converted file's compiled
output was empty both before and after emit — no repeat of the
`watchlist.ts`-drift bug from the prior pass.

**Cache-busting cascade:** `analysis-cache.js` `?v=2→3` in its 3
importers (`app.js`, `starter/app.js`, `pro/app.js` — no other `shared/`
file imports it, so no further hop needed there) → each tier's own
`app.js` content changed, each tier's `<script src="./app.js?v=N">`
bumped too (`index.html` 46→47, `starter/index.html`/`pro/index.html`
47→48). `preview/rolodex/` and `shark/index.html` confirmed untouched.

### `shared/watchlist-sync.js` converted to `.ts` (Aug 16, 2026)

Sixth Phase 2 conversion, next by fan-out (3 importers), depends on the
already-converted `watchlist.js` so it slotted in cleanly. New
`WatchlistSyncConfig` interface (`API_URL`/`authH`/`addSecret`) for
`initWatchlistSync()`'s config param — the same shape `ticker-cache.ts`'s
`TickerCacheConfig` already established, kept as its own separate
interface rather than shared, since the two configs happen to be
structurally identical today but aren't guaranteed to stay that way (no
reason to couple two independent modules' public APIs to save one type
declaration).

**Verified via real behavioral comparison across all four code paths**,
not just a happy-path check — a Node harness ran the pre- and
post-conversion module side by side against a fake `fetch`, confirming
byte-identical results for: (1) a normal successful pull, (2) the
empty-GET-response seed-push fallback (confirms the exact POST body,
`seed:true`), (3) the retry-with-backoff loop on network failure
(confirms 3 attempts and the ~1500ms+ delay before the 3rd succeeds,
matching `PULL_RETRY_DELAYS_MS`), and (4) `schedulePushWatchlist()`'s
debounce (two calls → one POST). Then re-confirmed the two paths that
actually matter most in production through real headless Chromium
against the real Pro-tier app: a mocked `GET /watchlist` returning
`NVDA`/`AMD` correctly hydrates the rendered watchlist on login (the
actual `pullWatchlistFromServer()` call site, not a synthetic one), and
adding a ticker correctly fires a debounced `POST /watchlist` with the
right body (`{"tickers":["AAPL","NVDA","AMD"],"seed":false}`) — zero
page errors throughout.

**Cache-busting cascade:** `watchlist-sync.js` `?v=23→24` in its 3
importers (`app.js`, `starter/app.js`, `pro/app.js` — no other
`shared/` file imports it) → each tier's own `app.js` content changed,
each tier's `<script src="./app.js?v=N">` bumped too (`index.html`
47→48, `starter/index.html`/`pro/index.html` 48→49). `preview/rolodex/`
and `shark/index.html` confirmed untouched. `git diff --stat` against
every previously-converted file's compiled output was empty both before
and after emit.

### `shared/context-highlight.js` converted to `.ts` (Aug 16, 2026)

Seventh Phase 2 conversion, tied with `shared/settings-modal.js` for
next-highest fan-out (2 importers each), picked first as the smaller,
zero-DOM leaf (pure tokenize/escape/regex-match logic backing Session
Context highlighting — no `document`/`window` touched at all).

**Cache-busting cascade needed the `.ts`-source discipline from the
`track-record.ts` bug fix, and got it right this time**: this module's 2
importers are `shared/watchlist.js` (whose own `.ts` source also had to
be bumped, not just its compiled output) and `pro/app.js` — and since
`watchlist.js`'s content changed as a result, that cascaded a further
hop into `watchlist-sync.js` (both its compiled `.js` **and** its `.ts`
source, since it also imports `watchlist.js` by version-pinned path),
which cascaded once more into every tier's `app.js`, and finally each
tier's `<script src="./app.js?v=N">`. Full chain: `context-highlight.js`
`?v=1→2` in `shared/watchlist.js`+`.ts` and `pro/app.js` → `watchlist.js`
`?v=30→31` in `shared/watchlist-sync.js`+`.ts` and all three tiers'
`app.js` → `watchlist-sync.js` `?v=24→25` in all three tiers' `app.js`
→ each tier's `<script>` bumped (`index.html` 48→49,
`starter/index.html`/`pro/index.html` 49→50). Recompiled after every
`.ts` source edit (not just the newly-converted file) to regenerate
`watchlist.js`/`watchlist-sync.js` from their corrected sources, then
confirmed via `git status --short` that only the files actually touched
by this cascade changed — no repeat of the silent-revert bug.

**Verified via exact-output comparison across 8 cases**, not just the
happy path — a normal 2-word match, a no-match case, an HTML-escaping/
XSS-adjacent case (`<script>` in the headline), a regex-special-character
case (`C++`), a stopword-only context (correctly produces zero matches),
empty headline, empty context, and a case with `&`/`%` punctuation —
all byte-identical between the pre- and post-conversion module. Then
confirmed live through real headless Chromium on Pro tier: typing real
Session Context text that shares 2+ words with a mocked headline
correctly triggers the 250ms-debounced highlight (via
`refreshNewsHighlights()` → `updateCardMeta()` → the compiled
`highlightContextMatches()`), producing real `<mark class="ctx-match">`
spans in the live-rendered news line — zero page errors.

### `shared/settings-modal.js` converted to `.ts` (Aug 16, 2026)

Eighth Phase 2 conversion, the more DOM-heavy of the two files tied at 2
importers (the Settings modal — timezone/link-site/custom-template UI).
Unlike `watchlist.ts`'s deliberate choice to leave its gesture code
untyped, **this file's real, pre-existing `checkJs` errors — all 11 of
them (9× `.value` on a bare-`HTMLElement`-typed `getElementById` result,
2× the `window.openSettingsModal`/`closeSettingsModal` bridges) — got
actually fixed**, not left as accepted noise: `as HTMLSelectElement`/
`as HTMLInputElement`/`as HTMLElement` casts at every `getElementById`
call (matching each element's real tag — `<select id="settings-tz">`,
`<input id="settings-custom-ex-url">`, etc. — confirmed against the
literal markup this same function injects via `innerHTML`, not guessed),
and a `declare global { interface Window {...} }` augmentation for both
bridges, same pattern as `watchlist.ts`'s `addTickers` and
`track-record.ts`'s `logResult`/`clearLog`. The difference from
`watchlist.ts`'s gesture code isn't inconsistency — it's that this
file's DOM structure is fixed and known (a template string this same
module owns and injects once), not a dynamic pointer-event target chain
with no fixed shape to cast against.

**Verified with the most direct comparison yet, given how DOM-heavy this
file is**: rather than a Node harness stubbing `document`, ran the
pre- and post-conversion module **each in its own real page** against
the real compiled `shared/prefs.js` (not a stub), driven by an identical
Playwright interaction script — open the modal, switch timezone, switch
link-site to Custom (reveals the custom-template fields), paste a real
example URL to exercise `detectTickerInUrl`/`buildTemplateFromExample`
end-to-end, close, reopen, and confirm every field correctly rehydrates
from saved prefs. Every observed value (dropdown option lists, selected
values, status text/color, `display` states, zero page errors) was
**byte-identical** between the two runs. Then re-ran the two most
load-bearing interactions (open modal, switch timezone, close) through
real headless Chromium against the actual repo's Pro-tier page —
confirmed `window.openSettingsModal`/`closeSettingsModal` work, and the
timezone switch round-trips through the real compiled `prefs.js`.

**Cache-busting cascade:** `settings-modal.js` `?v=14→15` in its 2
importers (`starter/app.js`, `pro/app.js` — Free has no Settings UI and
never imports it, so `index.html`'s own `<script>` tag correctly stays
untouched) → each importer's own `<script src="./app.js?v=N">` bumped
(`starter/index.html`/`pro/index.html` 50→51). `preview/rolodex/` and
`shark/index.html` confirmed untouched.

**Next in Phase 2, not done in this pass:** `shared/track-record-sync.js`
(1 importer, depends on the already-converted `track-record.js`) — then
both repos' `gates-extended.js` last (largest, highest-stakes file, best
converted once the pattern is well-proven on smaller modules first).
Once `track-record-sync.js` lands, every file in `shared/` will be real
`.ts` except `gates-extended.js` itself.

### `shared/track-record-sync.js` converted to `.ts` (Aug 16, 2026)

Ninth Phase 2 conversion — the last file in `shared/` besides
`gates-extended.js` itself. Its only importer (`pro/app.js`, since
track-record sync is Pro-only — see Frontend architecture above) and its
one dependency (`track-record.js`) were both already in place, so this
converted with zero new coordination needed. Structurally near-identical
to `watchlist-sync.ts` (same pull/retry/seed-push/debounced-push shape),
new `TrackRecordSyncConfig` interface kept separate from
`WatchlistSyncConfig` for the same reason as before — coincidentally
identical shapes today, not a guarantee they stay coupled.

**Verified via real behavioral comparison across all three code paths**
(same technique as `watchlist-sync.ts`) — a Node harness ran the pre- and
post-conversion module side by side against a fake `fetch`, confirming
byte-identical results for a normal pull, the empty-GET-response
seed-push fallback, and `schedulePushTrackRecord()`'s debounce. Then
confirmed the two paths that matter most in production through real
headless Chromium against the real Pro-tier app: a mocked `GET /track`
correctly hydrates the log via `replaceLog()` on login (the actual
`pullTrackRecordFromServer()` call site), and logging a new result plus
`schedulePushTrackRecord()` correctly fires a debounced `POST /track`
carrying both the pulled and newly-logged entries — zero page errors.

**Cache-busting cascade:** `track-record-sync.js` `?v=14→15` in its 1
importer (`pro/app.js` only) → `pro/index.html`'s own `<script
src="./app.js?v=N">` bumped (51→52). `app.js`/`starter/app.js` and their
`index.html`s correctly untouched — Free/Starter never sync track
record. `preview/rolodex/` and `shark/index.html` confirmed untouched.

### `gates-extended.js` (`trade-verdict`'s copy) converted to `.ts` (Aug 16, 2026)

Tenth Phase 2 conversion — the file the whole plan named as "last,"
picked up now that the pattern was proven across nine smaller modules
with zero behavioral regressions. **Structurally different from every
prior conversion in one important way**: this file is required via
plain CommonJS `require("./gates-extended")` in `server.js`, not
ES-module-loaded by a browser — no `?v=` cache-busting applies to it at
all, and (per the two-repo rule) it exists in both this repo and `Tra`,
the real backend. This PR covers only `trade-verdict`'s copy; the `Tra`
mirror is a separate follow-up, same split as Phase 0's Tra mirror.

**A real, non-obvious compatibility bug found and fixed before this
could ship, not caught by `tsc` at all.** The first attempt imported
`RegimeState` from `shared/types.d.ts` via a real `import type {...}`
statement, matching every other Phase 2 file's pattern. That compiled
clean under `tsc -p tsconfig.json` — but silently broke the file at
*runtime*: any real `import`/`export` statement (type-only or not)
makes `tsc` treat the whole file as an ES module, which — regardless of
`isolatedModules` — emits a trailing `export {};` into the compiled
output once every real import is type-erased. That single line is
enough for Node's module-type auto-detection to load the file as ESM
instead of CommonJS, which silently discards the real
`module.exports = {...}` assignment — confirmed directly: `require()`
against the broken build returned `{}`, zero exports, no thrown error
of any kind to signal the problem. Caught by actually calling
`require()` on the compiled output and checking `Object.keys()`, not by
`tsc` or `node --check` (both passed clean on the broken version) —
worth remembering for any future CommonJS `.ts` conversion in either
repo: **`tsc`/`node --check` passing is not sufficient proof a
CommonJS-required file still works; actually `require()` it and check
what it exports.**

**A JSDoc-based workaround was tried and rejected, not just skipped.**
Reusing `RegimeState` via a JSDoc `@typedef {import(...)}`/`@type`
comment (the exact mechanism this file's own JSDoc-only phase, and
every plain-`.js` file under this repo's `checkJs` setup, already relies
on) avoids the `export {}` problem — but a scratch repro confirmed
TypeScript silently does **not** enforce JSDoc type annotations inside
a real `.ts` file, only inside `.js` under `checkJs`. That would have
shipped code that *looks* typed without being checked at all — worse
than no typing, since it creates false confidence. **The actual fix:**
a real, `tsc`-enforced local `RegimeValidationResult` interface,
deliberately duplicated rather than imported from
`shared/types.d.ts`'s `RegimeState` — a narrow, documented exception to
every other Phase 2 file's "reuse the shared contract type" pattern,
forced by this one file's CommonJS constraint rather than an oversight.
If the two shapes ever need to diverge, that's a real thing to
reconcile by hand, flagged in the code itself.

**Verified far more thoroughly than any prior conversion, given this is
the file that has shipped two real production bugs already (the Aug 13
Gate 5 `evaluateProxyStatus` bug, and the Proxy Coherence Check bug one
level up).** A real behavioral comparison ran all 13 exported functions
against the pre- and post-conversion module side by side via direct
`require()` calls (not a browser harness) — 33 individual cases
covering every branch: all 8 branches of `evaluateGate1Sessions`
(insufficient data, flat, all three uptrend bands, all three downtrend
bands), all 3 cases of `proxyCoherenceCheck` (including the real
crash-scale `-6.20%` TSM value from the Aug 13 incident), all 3 reachable
states of `regimeValidation` (UNKNOWN/INTACT/a real decorrelated series
producing DEGRADING), all 3 tiers of `resolveFixedProxyBreak`
(primary-proxy adoption, fundamentals-confirmed, fundamentals-speculative),
5 scenarios of `hasForceDownAuthority` (unknown gate, unscoped exemption,
out-of-scope ticker, BROKEN-regime suspension, DEGRADING-regime
mandatory-coherence-check), plus `contextTextMatches`/
`buildupPatternCheck`/`corroborateSessionContext` and the exported
constants — **every single case byte-identical** between old and new.
Then, same discipline as Phase 0's own verification, reproduced the
real Aug 13 Gate 5 bug shape directly against the new file's actual
`proxyCoherenceCheck(tickerPct: number, proxyPct: number)` signature —
`tsc` flagged `Argument of type 'string' is not assignable to parameter
of type 'number'` immediately, confirming this would have caught that
exact bug class on save.

**`Tra`'s copy — done, confirmed Aug 16, 2026 (`Tra` PR #36, merged before
this note was corrected).** This entry previously said "still open" —
that was stale: a separate session with `Tra` access had already mirrored
the conversion (same non-behavioral, transpile-only approach, same local
`RegimeValidationResult` interface duplicated for the same CommonJS
reason) and merged it. Re-confirmed directly by cloning `Tra` and
diffing its `gates-extended.ts` against this repo's own — identical
except for one header-comment line adjusted for `Tra`'s flatter layout
(`types.js` vs `shared/types.d.ts`), and `require('./gates-extended.js')`
against `Tra`'s compiled output returns all 14 expected exports (not the
empty-object ESM/CommonJS gotcha this file documents above). **Phase 2 is
fully complete in both repos.**

## Frontend: Rolodex UI shipped to Starter — the first real (non-preview) tier (Aug 16, 2026)

Direct instruction: "I'm ready to move forward with roladex UI change in
Starter tier first. make sure to update the version number note at the
bottom. also add Alpaca to the list of sources." This is the first time
the Rolodex UI (prototyped and iterated at `preview/rolodex/`, Aug
13-16, all entries above) lands on a real, live, paying tier — not
another preview iteration. Two decisions confirmed via `AskUserQuestion`
before writing code:

1. **Ticker removal UX** ("click pill to allow card to swipe to
   delete"): tap a pill to make it the active card (existing
   `goRolo()`), then that active card itself becomes swipeable-to-delete
   — new gesture code (`onRoloPointerDown`/`Move`/`Up`,
   `finishRoloSwipe`), since the Rolodex's single-active-card stage has
   no per-row list for `shared/watchlist.ts`'s existing list-swipe
   gestures to bind to. Same visual/threshold pattern as production's
   real card-list swipe (spring-back under threshold, slide-out +
   fade over it), calling the real `removeTicker(ticker)` from
   `shared/watchlist.ts`'s state exports on a successful swipe — so
   persistence, the real undo toast, and the sync push are all the
   exact same code path the old card-list swipe already used, just
   re-bound to one card instead of a list.
2. **Deploy target** ("Build directly into the live tier"): explicitly
   rejected staging at `/preview/` first — this is live for real paying
   Starter users the instant it merges, no staging step, unlike every
   `/preview/rolodex/` iteration above.

**Approach: invert the build direction, don't extend the preview.** The
Rolodex preview is deliberately Free-tier-scoped and isolated from real
auth/credits/Settings/Session-Context-highlighting/server-sync (see its
own section above) — bolting those onto it would mean re-deriving
already-correct, already-live logic. Instead, `starter/app.js`/
`starter/index.html` (the real, working Starter tier) were rewritten
from their existing base, porting the Rolodex's sticky-docking Gate,
marquee pill strip, and single-active-card stage mechanics **in**, while
keeping every real piece — `TIER` config, `checkAuth()`/
`checkTierAccess()`, the real credit-consuming `/analyze` call and its
402/`NO_CREDITS` handling, `shared/prefs.js`/`shared/settings-modal.js`,
`shared/context-highlight.js`, `shared/watchlist-sync.js` — byte-
equivalent to what was already live. `shared/watchlist.js`'s **state**
exports (`watchlist`, `initWatchlist`, `addTickers`, `removeTicker`,
`onWatchlistSave`) are reused for validation/dedup/cap/persistence; its
DOM-coupled **rendering** (`renderWatchlist()`'s `.card-wrap` list) is
not — the Rolodex renders its own card/pill DOM entirely.

**A real latent bug fixed proactively before it could fire.**
`shared/watchlist.ts`'s `renderWatchlist()` unconditionally wrote into
`#watchlist` — every tier before this had that element; Starter's new
Rolodex-based DOM doesn't. Calling `addTickers()`/`removeTicker()`/
`setWatchlist()` (all of which call `renderWatchlist()` internally)
would have thrown `TypeError: Cannot set properties of null` the first
time a user typed a ticker into Import. Fixed with a one-line null guard
(`if (!wl) return;`) before any of the new code exercised that path —
harmless for every other tier, which still has `#watchlist` and is
unaffected.

**Two real regressions caught by a DOM-ID/window-export cross-check
before shipping, not by a live report — worth being explicit about,
since neither would have thrown an error, just silently not worked:**
1. **`#live-clock` was dropped entirely.** The new header design (ported
   from the Rolodex preview, which has no clock feature at all — it
   hardcodes Yahoo and never imports `prefs.js`) had nowhere for it to
   live, but `app.js` still called `startClock()`, which updates
   `#live-clock` behind a null-guard (`if(cl)cl.textContent=...`) — so
   it would have compiled, run, and thrown nothing, just silently never
   shown a clock. This is a real, already-shipped Aug 9, 2026 feature
   (timezone-aware, always-labeled live clock), not something this pass
   was asked to remove. Fixed by adding `<span id="live-clock">` into
   the header's `.brand-meta` row, next to the tier chip — that row
   already `flex-wrap`s, so it absorbs the extra element without
   reopening the Aug 14 header-overflow bug documented above.
2. **Sector Pulse (`#pulse-text`) was never populated.** The original
   `fetchMarket()` read `data.pulse` off the same `/market` response
   used for the Gate and rendered it into `#pulse-text`; the rewritten
   `fetchMarket()` only handled the Gate half. Starter has real,
   un-gated Sector Pulse (`TIER.pulse:true`) — this would have silently
   left the card showing "Generating market pulse..." forever. Fixed by
   adding a `renderPulse()` call (mirroring the original's `data.pulse`/
   loading/`Unavailable` branches) into `fetchMarket()`'s success and
   catch paths.

Caught both by grep-cross-checking every `getElementById('x')` in the
new `app.js` against every `id="x"` in the new `index.html` (and every
inline `onclick="fn(...)"` against a matching `window.fn =`) before any
browser testing — the same technique this file's own "Verifying changes"
section below already recommends, run here as a first pass specifically
*because* a full rewrite (as opposed to an incremental edit) has no diff
to eyeball for an accidentally-dropped element.

**Cache-busting cascade, one layer deeper than usual.** The
`renderWatchlist()` fix changed `shared/watchlist.js`'s compiled output
for *every* importer, not just Starter's new one — so per this file's
own standing rule, all of them needed their `?v=` bumped, not only the
file actually being worked on: `shared/watchlist.ts`'s fix recompiled to
`watchlist.js?v=31→32`; bumped in `shared/watchlist-sync.ts`'s own
internal import (`?v=32`, both the `.ts` source and its compiled
`.js` — per the `.ts`-source-must-carry-the-bump-too lesson from the
`track-record.ts` conversion above) and in every direct importer
(`starter/app.js` new at `?v=32` from the start, `app.js`/`pro/app.js`
bumped `?v=31→32`); `watchlist-sync.js`'s own content changed as a
result, `?v=25→26` in `app.js`/`pro/app.js` (Starter's new file already
written at `?v=26`); finally each tier's own `<script src="./app.js?v=N">`
bumped since its content changed (`index.html` 49→50, `pro/index.html`
52→53). `starter/index.html`'s own script tag is new at `?v=52` (a
straight continuation of the pre-rewrite file's last live value, `?v=51`
— chosen over restarting at `?v=1` specifically so the URL's version
history stays continuous with what real browsers may already have
cached, even though a brand-new query string would technically have
been just as safe). `preview/rolodex/` and `shark/index.html` confirmed
untouched — neither imports `shared/watchlist.js`/`watchlist-sync.js`.

**Verified: syntax + types + a real headless-Chromium pass exercising
every real code path, not just that pages load.** `node --check` on
every touched/rewritten JS file; `tsc -p tsconfig.json` shows the same
~7 known `?v=N`-import-resolution errors as before (zero new ones).
Then a full Playwright pass against realistic mocked `/market`/
`/ticker/:symbol`/`/analyze`/`/watchlist`/`/status`/`/auth/me` responses
(shapes read directly from `server.js`'s actual response-building code,
not simplified — the exact mistake this file's own testing notes flag
as a documented prior error) with a primed fake `tv_session` (tier
`starter`), at a pinned market-open clock time via Playwright's clock
API: confirmed the auth screen is bypassed and the real watchlist loads
from the mocked sync pull; confirmed the Gate renders GREEN with a real
note and docks/undocks correctly across a real incremental scroll (not
a single jump); confirmed `#live-clock` and `#pulse-text` both render
real content (the two regressions above, re-verified fixed); confirmed
tapping a pill switches the active card and auto-analyzes it through the
real `/analyze` POST, whose body carries all eight extra fields
(`gate1Data`/`preGateData`/`weeklyCarryoverData`/`regimeData`/
`proxyRule`/`openingBarData`/`metricsData`/`newsData`) alongside
`ticker`/`sectorContext`/`marketContext`; confirmed a Gate-5-forceDown
DOWN result renders its `LOOK FOR:` Pre-Gate strip and the full 6-row
gate list uncut (not the old preview's "only 3 gates" clipping bug —
this build never had the fixed-height `.rolo-stage` that caused it);
confirmed the Settings modal opens, the timezone select is present and
switchable, and it closes via its real `#settings-close-btn`; confirmed
typing real Session Context text produces real `<mark class="ctx-match">`
highlights via the debounced `wireContextHighlight()` → `refreshRoloCards()`
path; confirmed Import respects the real 7-ticker Starter cap (adding an
8th ticker to an already-full watchlist silently no-ops behind the
native `alert()`, exactly as `shared/watchlist.ts`'s `addTickers()`
already behaves everywhere else) and successfully adds a ticker when
under cap; confirmed the new swipe-to-delete gesture removes the active
ticker end-to-end (pill and card both gone afterward) via the real
`removeTicker()`; confirmed Glossary search filters correctly. Zero real
console/page errors — the only network failure observed was
`fonts.googleapis.com` (pre-existing in both the old and new
`index.html`, and consistent with this file's own documented sandbox
network restrictions elsewhere — not a regression from this change).

**Not verified:** a real end-to-end round trip against live credentials
(`tra-zacg.onrender.com` is unreachable from this sandbox, same standing
limitation as every other backend-dependent feature in this file) — spot-
check a real sign-in and a real `/analyze` call after deploy. The
`.rolo-swipe-bg`'s `z-index:9` sits below the active card's inline
`z-index:10` but at the same level as the immediately-adjacent inactive
cards (`z-index:9` for `abs===1`) — resolved correctly by DOM order in
testing (the bg is always the stage's first child) but worth a visual
spot-check on a real device if the stack ordering ever changes.

**Explicitly not done in this pass:** Pro's or Free's own Rolodex
rebuild — this PR is Starter only, per the user's own framing ("Starter
tier first"). Shark is untouched (still deliberately deferred, per
Tier status above). `preview/rolodex/` itself is untouched — it remains
the Free-tier, mocked-`/analyze`, isolated-from-`shared/` staging ground
it always was, not superseded by this real build.

## Frontend: Starter header regression fix + disclaimer trim (Aug 16, 2026)

Direct live feedback right after the Starter Rolodex build above shipped:
the personal live clock added to the header (to cover what looked like a
dropped Aug 9 feature) crowded `.app-topbar` on a real device and pushed
the profile badge/credits chip out of place — not asked for, and a real
regression from the rebuild itself, not a pre-existing issue. Removed
`#live-clock` from the header entirely rather than trying to fit it more
carefully — direct instruction ("you can remove the current completely").

**The market-data "Live · Updated ..." timestamp moved back into the Gate
box, as a real visible line, not the tooltip-only `title` attribute it had
regressed to during the rebuild.** New `.market-ts`/`#marketTs` element
inside `.gate-full-overlay`, between `#gateNote` and `.session-note`;
`renderMarketTs()` now sets its `textContent` instead of a `title` on
`#gateNote`. `startClock()` (and its `getTzIana()`/`getTzPref()`-driven
per-second tick) was removed outright rather than kept dead — nothing
else in Starter's build referenced it once the header span was gone.

**Also dropped "short-term " from the "trading support" disclaimer
line**, per direct request — applied everywhere the exact sentence is
duplicated (`index.html`, `pro/index.html`, `starter/index.html`,
`shark/index.html`, `preview/rolodex/index.html`), not just Starter,
since the identical text is copy-pasted across all five and a wording
correction should hold consistently across all of them.

Verified via headless Chromium: `#live-clock` confirmed absent, `#marketTs`
renders the real "🔴 Live · Updated ..." text, disclaimer text confirmed
free of "short-term" everywhere, and the full Starter regression suite
(auth bypass, Gate dock/undock, pill-tap auto-analyze, Settings modal,
Session Context highlighting, Import cap, swipe-to-delete, Glossary
search) re-passed with zero new console errors. `starter/app.js`'s own
content changed, so its `<script src="./app.js?v=N">` bumped (52→53) —
no shared-module content changed, so no cascade beyond that one file.

## Frontend: mandatory typography convention — one grey, one size (Aug 16, 2026)

Direct feedback, same round as the header fix above, screenshotted
against a live Pro-tier page for reference: "ALL grey font must be the
same lighter shade and size. I'm getting complaints that the font is
hard to read... What we decide on needs to be mandatory convention
moving forward." Investigated rather than guessed a number — grepped
every rule in `starter/index.html` using either grey text token
(`--ink-dim`/`--ink-faint`, plus the inline `--dim` alias used on the
auth screen) and found real, unintentional fragmentation: **30 separate
rules, 6 different font-sizes (9px/9.5px/10px/10.5px/11px/11.5px) and
two different grey colors**, with no consistent logic behind which
element got which — pure organic drift across many small edits over the
Rolodex build, not a deliberate hierarchy.

**Computed actual contrast ratios rather than eyeballing which grey
looked "hard to read"** (WCAG relative-luminance formula, against this
theme's three background tones):
- `--ink-dim` (`#7d8896`): **4.87–5.44:1** — passes WCAG AA (4.5:1) for
  normal text.
- `--ink-faint` (`#4c5563`): **2.32–2.60:1** — well below AA, and below
  even the 3:1 floor for large text. This is almost certainly the
  concrete "hard to read" complaint, not just the small font sizes.

**Decision, now the mandatory convention for grey/secondary text in this
app:** every piece of non-primary text (labels, captions, notes, hints,
meta rows, placeholders, disclaimers, footers) uses exactly
`color:var(--ink-dim)` at exactly `font-size:11px` — no other grey token,
no other size, for this text tier. `--ink-faint` is retired for text
entirely; it stays defined only for genuinely non-text uses (currently
just `.chevron`'s icon color) where WCAG contrast doesn't apply.
`11px` was picked as the floor (not a smaller "average") specifically so
this pass raises the worst-offending small text up rather than shrinking
anything already at 11/11.5px down — a few purely-cosmetic, non-grey
caption labels that happened to sit at 10-10.5px right next to now-11px
grey siblings (`.track-teaser-title`, `.disclaimer-title`,
`.glossary-cat`, etc.) were bumped to 11px too for visual consistency
with their neighbors, even though they keep their own brand colors and
weren't part of the literal "grey font" complaint. Primary/emphasized
text (prices, verdicts, headings, ticker symbols) is unaffected — this
convention only governs the secondary/dim text tier.

**Scoped to Starter** (the only tier currently on the Rolodex UI) rather
than retrofitted onto Free/Pro/Shark's older, structurally different CSS
— those still use their own pre-existing (and, per this same principle,
likely equally inconsistent) grey-text patterns. **This is now the
required standard for any future work on this typography tier — apply
`var(--ink-dim)` + `11px` by default whenever grey/secondary text is
added or touched anywhere in this app, including the next tier's own
Rolodex rebuild (Free/Pro), rather than picking a new ad-hoc size.**

**Verified for layout breakage, not just visually approved** — the
biggest real risk of a blanket size increase in this specific app is the
several fixed-height, tight-fit containers this file has already
documented fragile height math for (the 44px docked Gate bar sharing
space between its marquee and the "↑ top" jump label, the 3-column Gate
stat grid, the `.card-head` accordion rows). Headless-Chromium checks
confirmed: `.app-topbar` stays within its 390px viewport width with zero
overflow (the exact class of bug documented in the Aug 14 header-overflow
entry above); the docked `.gate-mini-row` — jump label now at 11px
instead of 9.5px — still fits with zero horizontal overflow and the jump
label still fully visible; `#gateGrid`'s 3-column stat labels (SPY/QQQ/
BTC/etc., now 11px instead of 9.5px) don't overflow their grid cells;
all three utility cards' collapsed `.card-head` rows stay at their fixed
44px height with their `.card-sub` text not silently truncated. The full
prior Starter regression suite (auth, Gate dock/undock, pill-tap
auto-analyze, Settings, Session Context highlighting, Import, swipe-to-
delete, Glossary) re-passed unchanged.

## Frontend: mandatory rule — every ticker symbol is a hyperlink (Aug 16, 2026)

Direct instruction: "ticker symbols in the gate should be hyperlinked,
this should be annotated as a rule for all ticker symbols." The Gate's
own index tickers (SPY/QQQ/BTC/SOXX/XBI/IWM/GLD/USO/TSM/MSFT, in both
`#gateGrid`'s full-detail view and `#gateMarquee`'s docked marquee) were
plain text — every other ticker symbol in the app (card ticker/news
links, Pro's compact rows/heat-map/trigger labels) already routes through
`tickerHref()`, so this was a real, isolated gap rather than a
considered exception.

**Rule, now permanent for any ticker symbol displayed anywhere in this
app:** if it identifies a specific security, it links out via
`tickerHref()` (or `newsHref()` where a news-specific link makes more
sense, per the existing convention). This applies to passive/label
tickers, not just the ones already inside a ticker card. Two carve-outs,
both deliberate:
- **BTC needs `tickerHref('BTC-USD')`, not `tickerHref('BTC')`** — the
  app displays the bare label "BTC" but Yahoo/the other link sites all
  need the real `BTC-USD` symbol to resolve correctly. This isn't a new
  decision — Free/Pro's own static Gate markup already hardcodes exactly
  this override for their BTC tile (`data-ticker="BTC-USD"`,
  `shared/prefs.ts`'s own top comment even calls this out: "or 'BTC-USD'
  for the header's crypto tile"). Starter's new `GATE_LINK_OVERRIDE`
  map/`gateLinkSymbol()` helper generalizes that same pattern rather than
  hardcoding BTC inline, so a future non-equity symbol needing the same
  treatment has somewhere to go.
- **A proxy label only gets linked when it resolves to exactly one real
  symbol.** Gate 5's proxy can be a combined multi-symbol rule (e.g. TSM
  + KOSPI); the display name in that case isn't a single linkable
  ticker, and KOSPI itself isn't a US-tradable symbol `tickerHref()` can
  route correctly in the first place (same class of problem the Aug 10
  ARCC/Egypt mis-route incident already taught this app to take
  seriously). `roloCardHTML`'s meta-row PROXY field only wraps the label
  in an `<a>` when `td.proxyRule.proxy.symbols.length === 1`; otherwise
  it stays plain text, matching this file's established "fail safe to
  plain text rather than guess a wrong link" posture.

**Live-updates when the link-site preference changes.** Ticker cards
already re-render on every `onPrefsChange` fire (which calls
`tickerHref()` fresh), so they needed no extra wiring. The Gate's grid/
marquee links are built once per `/market` fetch (every 4 minutes), not
on every pref change, so they'd otherwise go stale until the next fetch
— fixed by giving both a `data-ticker` attribute and calling the shared
`refreshTickerLinks()` (already used by Free/Pro's static markup for the
same reason) scoped to `#gateGrid`/`#gateMarquee` inside the
`onPrefsChange` callback, rather than fully rebuilding the grid/marquee
(which would reset the marquee's scroll position and visibly jump).

Verified via headless Chromium: every Gate grid/marquee link resolves to
the correct `tickerHref()` URL, BTC correctly resolves to `BTC-USD`, a
single-symbol proxy (TSM) renders as a real link, and the docked
marquee's `.sym` links call `event.stopPropagation()` so tapping one
doesn't also trigger the docked bar's own tap-to-jump-to-top handler.

## Frontend: Export CSV moved to the profile-menu dropdown (Aug 16, 2026)

Closes a note left open since the Rolodex prototype work (Aug 14, "the
import is missing the input window... remove the export button and
write a print to add it to the profile badge drop-down... not built
here, since this prototype has no profile badge component at all yet")
— Starter's real build has a real profile-menu dropdown now, so this
picked that plan back up for real, per direct instruction.

**Not a copy of Pro's CSV shape.** Pro's `exportWatchlistCSV()`
(`pro/app.js`) exports `Ticker,List,Price,IV,Change%` — the `List`
column exists because Pro splits its watchlist into a 15-card window vs.
a compact overflow list, and `IV` because Pro has real IV entitlement
(`tierConfig.iv`). Starter has neither: every ticker in its 7-ticker cap
is already a full card (no card/list split to tag), and Starter has no
`iv` flag — including an `IV` column that always read `N/A` would be
misleading rather than just absent. Starter's export is a plain
`Ticker,Price,Change%` of the full (7-ticker-max) watchlist — same
`fetchTickerData()`-backed row-building, CSV-escaping, and
`trade-tribunal-watchlist-<date>.csv` filename convention as Pro's, just
without the two columns Starter can't populate honestly.

Wired as `#exportCsvBtn` in the profile-menu dropdown (between SETTINGS
and SIGN OUT), calling the same `exportWatchlistCSV(this)` pattern as
Pro's button (disables + shows "EXPORTING…" while the per-ticker
`fetchTickerData()` calls resolve, restores after). Verified via headless
Chromium: clicking it from the open profile menu triggers a real file
download with the correct header row and real per-ticker data.

## Frontend: tapping a ticker pill smooth-scrolls to its card (Aug 16, 2026)

Direct instruction: "when tapping a ticker pill from the marquee,
smoothly jump screen to the ticker card and prompt to analyze." The
auto-analyze-on-tap half of this already existed (`goRolo()`, Aug 15,
`?v=6`) — what was missing is that `#roloIndex` (the pill strip) stays
sticky-docked all the way through the Glossary/Track Record/disclaimer/
footer (the Aug 15 "pill dock persisting past the Glossary" fix), so a
pill tapped while scrolled that far down leaves the actual card
(`.rolo-wrap`/`#roloStage`, plain document flow, not sticky) well above
the current viewport with nothing bringing it back into view.

**Implementation deliberately avoids hand-computed scroll offsets.**
This file already has an extensive, hard-won history of scroll-position
math going subtly wrong in this exact page (the Gate dock-threshold
sagas, the marquee wrap-boundary arithmetic bug) — every one of those
was eventually fixed by measuring the real rendered thing instead of
assuming a derived value. `scrollToActiveCard()` uses the browser's own
`scrollIntoView({behavior:'smooth', block:'start'})` on `.rolo-wrap`,
with `scroll-margin-top` set fresh on every call from the two real
sticky elements currently stacked above it (`GATE_DOCKED_H` + `#roloIndex`'s
own live `getBoundingClientRect().height`) — no coordinate arithmetic of
this app's own to get wrong, and it stays correct automatically if either
sticky element's height ever changes. Called from `goRolo()`, which is
only ever invoked from a pill's click handler — never fires on the
initial render or on any other call path.

Verified via headless Chromium: scrolled to the true bottom of the page
(past the Glossary/Track Record/disclaimer/footer, confirming the exact
scenario this was built for), tapped a pill, and confirmed the page
smooth-scrolled up with the target card back in the viewport afterward
— re-ran the full existing pill-tap/auto-analyze regression alongside it
with no regressions.

## Frontend: gate-card text color, status-word removal, confidence-driven "LOOK FOR" dot (Aug 16, 2026)

Three direct instructions, landed together, all scoped to a card's gate
breakdown (not the Gate 0 market box, which is unaffected):

1. **"the news links and gate language font should be white."** The
   news headline (`.headline`/`.headline a`) and each gate's descriptive
   note (`.gate-row .gn`) were on `var(--ink-dim)` — correct per the
   mandatory grey-text convention above for genuinely secondary text, but
   these two are substantive analysis content, not captions/labels, and
   reads as under-emphasized next to it. Both switched to `var(--ink)`
   (full-brightness white). `.headline .age` (the "9d ago" timestamp) and
   `.gate-row .gl` (the "G1 14D" gate label) deliberately stay on
   `var(--ink-dim)` — those are genuinely secondary annotations, not the
   "language" being asked for here.
2. **"remove the color words 'yellow, green, red' next to gates."** Each
   gate row rendered its literal status word (`<span class="gs"
   style="color:...">${gate.status}</span>`) next to the label — fully
   redundant with the color-coded dot immediately to its left. Removed
   the `.gs` span (and its now-dead CSS rule) entirely; the dot alone
   still conveys GREEN/YELLOW/RED. `CONFIDENCE`'s `HIGH`/`MEDIUM`/`LOW`
   text is a different word set, not a "color word," and was left alone.
3. **"the dot color next to 'look for' should match the confidence level
   color. if the confidence is low, the look for should be red."** The
   Pre-Gate strip's dot (`pregateStripHTML()`) was colored off Gate 5's
   own status (`sigColor(g5.status)`) — a leftover from before the strip
   was generalized to show `result.wait_for` regardless of which gate
   triggered it. Re-pointed at `result.confidence` instead, via a new
   shared `confColor()` helper (`HIGH`→green, `MEDIUM`→amber, `LOW`/
   fallback→red) — the exact same mapping the `CONFIDENCE` row already
   used inline, now a single source of truth both call sites share
   instead of two copies that could drift.

Verified via headless Chromium: a LOW-confidence mocked result renders
the "LOOK FOR" dot in `var(--red)` (confirmed via computed style, not
just reading the code); zero `.gs` elements exist anywhere in the DOM
after rendering a full gate breakdown; a gate row's label text is
exactly `"G1  14D"` with no trailing status word; both `.headline` and
`.gate-row .gn` compute to `rgb(233, 237, 243)` (`--ink`) rather than the
dim grey. Full prior Starter regression suite and the fixed-height
overflow checks re-passed with zero new console errors.

## Backend: LOW confidence didn't always ship a real wait_for (Aug 16, 2026)

Prompted by a direct question, right after the confidence-driven "LOOK
FOR" dot above shipped: is the LOW-confidence/`wait_for` overlap actually
always true? Audited every place `/analyze` sets `confidence = "LOW"`
(`Tra`'s `server.js`, 3 explicit sites) rather than assume the "heavily
overlap" claim from that PR's own summary held everywhere:

1. Gate 5 RED downgrading an UP verdict to FLAT — sets `wait_for` in the
   same statement. Guaranteed.
2. The non-exempt-DOWN congruency fallback (redCount < 2) — uses
   `parsed.wait_for = parsed.wait_for || "default text"`. Guaranteed.
3. **The Proxy Coherence Check's "possible decoupling" branch
   (`coherence.forceDown === false`) — sets only `confidence = "LOW"`,
   never touches `wait_for` at all.** Real gap.

A fourth path has no guarantee either: when the model self-assigns `LOW`
on its own (per the CONFIDENCE rubric, with no server override firing),
the prompt never instructs it to pair that with a `wait_for`.

**Fix (`Tra` PR #37, mirrored into `trade-verdict`'s `server.js`): one
invariant, not four patches.** Rather than fix each site individually,
added a single check after every confidence-setting branch has already
run: `if (parsed.confidence === "LOW" && (!parsed.wait_for ||
parsed.wait_for === "null")) parsed.wait_for = "Additional confirmation
needed before directional entry.";` — closes the real gap and the
model-only path in one place, and the `||`/falsy check means it never
overwrites a real `wait_for` a branch or the model already provided
(including the `"null"` literal string, which every tier's frontend
already treats as empty).

Verified by extracting the exact snippet and running it against 7
synthetic cases: the real gap gets the default filled in; all three
branches that already set a real `wait_for` are left untouched; a
model-provided `"null"` string is caught the same as `undefined`;
MEDIUM/HIGH confidence cases are never touched. **Not verified against a
live deploy** — same standing sandbox limitation as every other backend
change in this file. This closes the loop the confidence-driven "LOOK
FOR" dot needed: LOW confidence now always ships with something to
actually look for, not just sometimes.

## Backend: confidence redefined as price-confirmed corroboration, not "did a rule fire" (Aug 16, 2026)

Direct follow-up, same conversation as the `wait_for` fix above. Prompted
by a pointed question — why not extend the same guarantee to MEDIUM and
HIGH? — that surfaced a much bigger issue than the `wait_for` gap: **every
server-side override branch in `/analyze` capped `confidence` at a flat
`MEDIUM` or `LOW` regardless of how corroborated its own trigger actually
was.** Not one of the ~9 override branches could ever produce `HIGH` —
`HIGH` only survived when the model self-assigned it *and* no override
fired at all. Worked through with Mr. T directly (not guessed at) what
`confidence` should actually mean: **the AI's own sense of certainty in
its read, given all the inputs** — and specifically, whether the ticker's
own observed price move *and* its sector/proxy's observed price move
independently confirm the mechanical trigger driving the verdict. "If the
chart is showing what the math says it should be doing, that's the
indication of confidence" — his framing, confirmed as the actual design.

**Why blanket pass-through of the model's own number doesn't work
either.** When an override *flips* the verdict (e.g. the model says UP,
then Pre-Gate finds a solvency red flag and forces DOWN), the model's
original confidence was about its own UP call — not the DOWN that
actually ships. Confidence has to be re-grounded in whatever verdict
*actually ships*, including overridden ones — it can't just be "whatever
the model said," and it can't just be "capped because a rule fired"
either. Both are wrong for the same reason: neither actually measures
whether the final call is corroborated.

**The real definition, agreed on before writing any code:**
- **HIGH** — the ticker's own price move AND its proxy/sector's price
  move both independently agree with the direction being asserted. Two
  real, independent signals confirming each other is the actual bar —
  not "nothing objected."
- **MEDIUM** — the trigger is real and clean on its own terms, but there's
  no independent price data to confirm or deny it (missing, or a move too
  small to be a real signal) — genuinely unconfirmed, not contradicted.
- **LOW** — a signal that IS available moves opposite the asserted
  direction — the math and the chart are actively disagreeing. This
  should be the tier the app is trying to avoid landing in, not a routine
  third of the distribution — if the underlying gates are sound and the
  market's behaving the way the rules expect, LOW shouldn't come up
  often. Its recurring is itself a signal worth noticing.

**Implementation (`Tra` server.js, mirrored into `trade-verdict`'s
`server.js`):** new `priceConfirmedConfidence(direction, tickerPct,
proxyPct)` helper, reused across every override branch that asserts a
direction, replacing the flat `"MEDIUM"` literal each one used to write.
`tickerPct`/`proxyPct` were already computed once at the top of
`/analyze` (Proposal 2/4's own tickerPct/proxyPct, sourced from
`openingBarData`'s bar-1 move and `sectorContext`'s parsed change
strings) — no new fetches needed. Moves inside ±1.0% count as
negligible/unavailable, not agreement or disagreement — the same
tolerance `gates-extended.ts`'s own `proxyCoherenceCheck()` already uses
for its flat band (`COHERENCE_FLAT_BAND_PCT`), kept as its own local
constant here rather than importing that one, since coupling a
single-check-tuned value to a generic threshold for no real reason isn't
worth it. This directly answers the "don't tie confidence to anything
negligible" concern raised mid-discussion — a 0.1% intraday wobble can no
longer register as either confirming or contradicting anything.

**Per-branch application, not a blanket swap** — six sites now call the
helper, three intentionally don't:
- Pre-Gate hardTrigger, Gate 0 RED, Gate 1 forceDown, and the Gate 5
  RED+Gate 2 RED double-negative — all now call
  `priceConfirmedConfidence("DOWN", tickerPct, proxyPct)`. Gate 0
  YELLOW+UP calls it with `"UP"` instead of just capping at MEDIUM — if
  the ticker's own price is genuinely cutting through the sector
  headwind, that's real evidence, not something to hedge against by
  default.
- **Gate 5's Proxy Coherence Check branch got more nuance than a plain
  helper call, because `proxyCoherenceCheck()` already distinguishes two
  meaningfully different `forceDown:true` cases that a generic sign check
  would flatten together:** Case 1 (ticker actively moved *with* the
  proxy) is genuine two-signal confirmation → `HIGH`. Case 2 (ticker is
  flat, inside the coherence check's own flat band — hasn't caught up
  yet, but hasn't contradicted the trigger either) → `MEDIUM`, not HIGH.
  The prior code treated both cases identically (`coherence.forceDown ===
  true` → flat `MEDIUM`); `coherence.case` was already being returned by
  `gates-extended.ts`, just never read here.
- Gate 5's plain-forceDown `else` branch (no coherence check possible —
  either not Taiwan/Korea-gated, or `tickerPct`/`proxyPct` genuinely
  missing) now calls the generic helper instead of a flat `MEDIUM` too —
  a real, incidental improvement for dynamically-resolved primary proxies
  (Patch 2), which skip the coherence check entirely today since it's
  scoped to the fixed Taiwan/Korea case, but still get real credit now
  when their own `tickerPct`/`proxyPct` happen to be available and agree.
- **Left untouched, deliberately:** the Gate 5 RED-alone case that
  downgrades an UP verdict to FLAT (catalyst fighting sector — a genuine
  *gate-vs-gate* conflict, Gate 2 positive vs. Gate 5 negative, not a
  price-confirmation question) and the non-exempt-DOWN congruency
  fallback (insufficient RED-gate count — genuinely insufficient
  evidence, also not a price question). Both stay `LOW` for reasons that
  have nothing to do with `tickerPct`/`proxyPct` agreeing or not.

**The LLM-facing prompt got the same philosophy, not just the
server-enforced branches.** Added one clarifying line under the
`CONFIDENCE:` rubric: `"Congruency confirmed" means the ticker's own
price action and its sector/proxy's price action both point the same way
as the verdict — not just that the pre-determined gate statuses happen to
be green.` A light, additive clarification rather than a rewrite of the
tuned rubric — the self-assigned (no-override) path already implicitly
required multi-signal gate agreement; this makes explicit that "agreement"
means the same price-confirmation test the server-enforced branches now
use, not just gate-status color.

**Verified by simulation** (same discipline as every other gate-logic
change in this file — no way to test a live `/analyze` call from this
sandbox): extracted `priceConfirmedConfidence()` and ran it against 14
synthetic cases — both signals confirming (HIGH), both missing (MEDIUM),
one confirming/one missing (MEDIUM), either signal contradicting (LOW),
negligible/noise-level moves on either side correctly treated as
non-signals (MEDIUM, not LOW or HIGH), the exact ±1.0% boundary (at the
threshold = MEDIUM, just past it = HIGH/LOW), and the real Aug 13, 2026
crash-scale TSM value (-6.2%) from the Gate 5 bug-fix history above
(HIGH, both signals agree). Separately verified the Gate 5 coherence-check
Case 1/Case 2/Case 3 split end-to-end against `proxyCoherenceCheck()`'s
real logic (not reimplemented) — Case 1 → HIGH, Case 2 (flat/lagging
ticker) → MEDIUM, Case 3 (decoupled) → LOW, using the same real Aug 13
example plus a synthetic Case 2. **Not verified against a live deploy** —
same standing sandbox limitation as every backend change in this file.
To confirm live: watch for a HIGH-confidence card on a clean forceDown
(e.g. a genuine Gate 0 RED session where the ticker itself is also down
hard) — something that was structurally impossible before this change —
and watch whether LOW confidence actually stays rare in practice, per the
"this is the tier we're trying to avoid" framing above.

## Frontend: Rolodex mechanics extracted to shared/rolodex.ts; Phase 3 (bundler) kicked off on Starter (Aug 16, 2026)

Direct instruction, following a requested audit of the Rolodex build
before extending it to Free/Pro: the audit's top structural finding was
that the Rolodex UI mechanics (Gate dock/spacer/marquee, ticker-pill
marquee, stacked-card positioning, swipe-to-delete) lived entirely inside
`starter/app.js` — a second and third tier copy-pasting that code would
mean every hard-won fix from this file's own Rolodex saga (dock-
threshold math, marquee wrap-boundary arithmetic, the self-healing
pause) needing independent rediscovery in Free and Pro's own copies.
Recommended extracting a shared module before duplicating, and doing it
alongside Phase 3 (the bundler) rather than deferring Phase 3 again,
since a new shared module consumed by multiple tiers is exactly the case
that makes the `?v=N` cache-busting convention actually painful (this
file's own Starter-build history shows several PRs needing 3-4 files'
versions bumped by hand for one shared-module change).

**Scope boundary for the extraction, deliberate:** `shared/rolodex.ts`
owns HOW the UI moves (dock/undock, marquee stepping, stacked-card
positioning, the swipe gesture) — never WHAT it shows. Card content
(`roloCardHTML`, gate rendering, ticker links), `GATE_FIELDS`, and all
business logic (`analyzeOne`, the real `/analyze` call) stay tier-owned,
since those genuinely differ per tier (Pro's card/list-window split and
exclusive features, Free's teased Sector Pulse). Forcing those into the
shared module before a second real consumer (Free) proves out what's
actually shared would be premature abstraction in the other direction —
matching this file's own repeated lesson about not guessing at
abstractions ahead of a second real use case.

**Phase 3, scoped as "convert the one file this extraction actually
needs," not a full-site migration.** `starter/app.js` converted to
`starter/app.ts` (Starter is now the second tier-level `app.js` on real
TypeScript, after the shared/*.ts modules) and is now the bundle's real
source; the committed `starter/app.js` is `esbuild`'s emitted output,
same "compile, commit both, GitHub Pages keeps serving from branch, zero
deploy-config change" posture as every Phase 2 conversion — `npm run
build:bundle` (or `node esbuild.config.mjs`) after touching
`starter/app.ts` or anything it imports, then commit the result and bump
`starter/index.html`'s own `<script>` tag. `package.json` is now a real,
committed file (`typescript` + `esbuild` devDependencies) — the
`tsconfig.json` comment claiming otherwise was updated to match.

**Two distinct duplicate-module bugs found and fixed while proving this
out — both real, both would have shipped broken if the build had "looked
done" after the first one:**
1. **Query-string identity.** esbuild's module cache is keyed by the
   exact specifier string, so `'./watchlist.js?v=32'` (used inside
   `shared/watchlist-sync.ts`, necessary there since it's also loaded
   raw by unbundled tiers) and `'../shared/watchlist'` (a clean import
   written fresh in `starter/app.ts`) resolve to the same file but don't
   deduplicate into the same module instance — confirmed first via a
   synthetic two-importer repro before touching the real build, then
   found for real in the bundle output as a renamed `watchlist2` binding
   with its own independent array.
2. **`.ts`-vs-compiled-`.js` identity, a second and different collision
   the first fix's query-stripping alone didn't catch.** Every Phase 2
   file has BOTH its `.ts` source and its `tsc`-emitted `.js` sibling
   committed side by side (the `.js` is the real deploy artifact for
   unbundled tiers). An extensionless specifier resolves to the `.ts`
   source; an explicit `.js`-suffixed specifier (even with its `?v=N`
   query already stripped) resolves to the literal, separately-compiled
   `.js` file — a genuinely different physical file, with its own
   independent top-level state. This one was the more dangerous of the
   two precisely because it looked fixed: after the query-string fix
   alone, `watchlist` had exactly one instance visible in a quick grep,
   but `setWatchlist()`'s own writes were landing on a *second*,
   differently-resolved copy (`shared/watchlist.js`, not `.ts`) that
   nothing else in the bundle read from — the real, server-synced
   watchlist silently never appeared on screen, while the page otherwise
   looked completely normal (no console error, no exception, just a
   ticker count that stayed on Starter's 7-ticker localStorage default
   forever). Caught only by adding a real console.log inside
   `renderRolodexFromWatchlist()` and tracing the actual call stack and
   timing, not by reading the code — the bundle output's own chunk
   headers (`// shared/watchlist.ts` at one line, `// shared/watchlist.js`
   at another) were the tell once looked for directly.

**Fix: `esbuild.config.mjs`'s `normalizeSharedImports` plugin**, an
`onResolve` hook matching any `.js`(`?v=N`)? specifier, that checks
whether a `.ts` sibling exists on disk and redirects to it when one does
(falling back to the plain, query-stripped `.js` path otherwise) —
rather than hand-matching every entry point's own import specifiers to
whatever version number and extension a shared file's internal imports
happen to carry right now, which is exactly the fragile manual
bookkeeping Phase 3 exists to eliminate. Verified by checking the
bundle's own chunk-header comments after the fix: every `shared/*`
module now appears exactly once, always as its `.ts` source.

**A real, incidental cleanup caught along the way:** an earlier debugging
command (`tsc ... --noEmit false` run against `starter/app.ts` mid-
investigation) accidentally emitted a stray, untracked `shared/rolodex.js`
— `rolodex.ts` is bundler-only (nothing loads it as a raw browser
module, so it has no `?v=N` consumer and was never added to
`tsconfig.build.json`'s emit scope) — deleted before committing; flagged
here since an untracked stray `.js` sibling next to a `.ts` file would
have silently reintroduced exactly the collision class this same pass
just fixed, the moment anything referenced it by a `.js`-suffixed path.

**Verified end-to-end, not just that the build produced output:** the
full existing Starter regression suite (headless Chromium against
realistic mocked backend responses) re-run against the bundled output —
auth bypass, real watchlist pull from a mocked `/watchlist` (the exact
path the duplicate-module bug broke), Gate dock/undock via real
incremental scroll, pill-tap auto-analyze with the real `/analyze` body
shape, ticker hyperlinks (Gate grid/marquee + card + proxy), CSV export,
confidence-driven "LOOK FOR" dot, Settings modal, Session Context
highlighting, Import cap, swipe-to-delete, Glossary search, scroll-to-
card on pill tap — all pass identically to the pre-bundle build, plus
the fixed-height overflow checks. `tsc -p tsconfig.json` shows the same
known `?v=N`-import-resolution baseline as before, zero new errors.
`node --check` on the emitted `starter/app.js`.

**Explicitly not done in this pass:** Free/Pro's own bundled entry
points (this was scoped to "convert what the extraction needs," not a
full-site Phase 3 migration — each tier adds its own `esbuild.config.mjs`
entry when its own Rolodex work actually starts); stripping `?v=N` from
the shared `.ts` files' own internal imports (still needed for Free/Pro's
current unbundled consumption — only the *bundler's resolution*, not the
source files themselves, was changed); minification/source maps (no
build-artifact story exists yet for this repo, deliberately deferred).

## Frontend: Rolodex UI shipped to Free, written as real TypeScript from the start (Aug 16, 2026)

Direct instruction: "start the Free tier Rolodex build and continue
following through phase 3." Second real (non-preview) tier on the
Rolodex UI, after Starter — and the first tier whose Rolodex build was
authored as real `.ts` from day one (`app.ts` at repo root) rather than
converted after the fact, continuing Phase 3 alongside the feature work
itself rather than as a separate pass.

**Same "invert build direction" approach as Starter**: started from
Free's real, working `app.js`/`index.html` (anonymous `APP_SECRET` auth,
`redirectingToPaidTier` guard, `forceDefaults()`, the real weekly-reset
credit system) and ported the Rolodex mechanics in via `shared/rolodex.ts`
— not the other way around. `esbuild.config.mjs` gained a second entry
(`{ in: 'app.ts', out: 'app' }`); the emitted, committed `app.js` is the
real deploy artifact, same posture as Starter's bundle. Confirmed via the
same chunk-header grep used for Starter's own duplicate-module check
(`grep "^// shared/" app.js`) that all 7 shared modules bundle exactly
once — the `normalizeSharedImports` plugin built during Starter's Phase 3
kickoff needed no changes to handle a second entry point correctly.

**Real, deliberate differences from Starter's build, each a judgment
call made in the absence of further instruction:**
- **Sector Pulse is a static blurred teaser**, ported verbatim from
  `preview/rolodex/`'s own Free-scoped design (`TIER.pulse:false` — Free
  has never had real Sector Pulse content). Needs no JS rendering at all,
  unlike Starter's real `renderPulse()`.
- **Gate labels shortened to Starter's wording** (`G1  14D` etc., not
  Free's old longer `G1  PRE-WINDOW 14D`) and the **Gate-1-driven card
  rim-color mechanic was dropped** — neither Starter's Rolodex nor the
  original preview ever had a colored card rim, and the verdict glow
  (`verdict-up`/`verdict-down` green/red pulse) already carries that
  signal in the Rolodex card language. Kept the two builds visually
  consistent rather than preserving a Free-only affordance nothing else
  on the Rolodex UI has.
- **"WAIT FOR" unified to Starter's "LOOK FOR:"** — CLAUDE.md never
  established this as tier-specific wording, and the confidence-driven
  dot color (`confColor()`) this labels was already ported from Starter
  unchanged, so keeping mismatched label text next to it would've been
  the actual inconsistency.
- **The real weekly-credit-reset splash is genuine, live functionality
  here — not dead code the way `#comeback-screen` was on Starter.**
  Ported as a full-page overlay (`#comeback-screen`/`startComebackTimer`/
  `handleNoCredits`), independent of the Rolodex card stack rather than
  wired into any card — the original design was already a full-viewport
  takeover regardless of which ticker triggered it, and there was no
  reason to change that shape. The dual anonymous/signed-in buy-button
  behavior (sign-in prompt vs. real $0.99 purchase link, since Stripe
  purchases key off account email) carried over unchanged.
- **Ticker/news links hardcoded to Yahoo Finance directly**, not routed
  through `shared/prefs.ts`'s `tickerHref()`/`newsHref()` — Free has
  never had a Settings UI or a link-site preference (`forceDefaults()`
  already forces Yahoo/ET regardless of what's saved from another tier
  in the same browser), so importing `prefs.ts` at all would have been a
  new dependency for zero behavioral gain. Still satisfies the mandatory
  "every ticker symbol is a hyperlink" rule — just via a two-line local
  `tickerHref()`/`newsHref()` instead of the shared helper.
- **No live clock in the header, timestamp lives in the Gate's
  `#marketTs` line instead** — built straight into this state rather than
  reintroducing Starter's since-fixed Aug 16 header-crowding regression
  (documented above, "Starter header regression fix") and then having to
  fix it a second time.
- **No manual refresh button** — matches Starter's Rolodex convention
  (auto-refresh every 4 minutes via `setInterval`, plus tap-Gate-to-jump-
  to-top when docked); the old refresh button (`fetchMarket(true)`) was
  Free's own pre-Rolodex affordance, not carried forward.
- **Sources line now includes Alpaca** (extended-hours pricing, weekly
  carryover) — this was previously only listed on Starter's disclaimer,
  but `Tra`'s Alpaca integrations apply uniformly to every tier's
  `/ticker/:symbol` and `/analyze` responses regardless of tier, so the
  old Free-only Finnhub/Anthropic/Unusual-Whales list was already
  factually incomplete, not a deliberate scope difference.
- **Footer keeps its Privacy Policy link** (`/privacy/`), which Starter's
  footer doesn't have — Free is the tier actually wrapped in the Android
  TWA and submitted to Play Console (see the Google Play launch section
  above), where a reachable privacy policy is a real Play Store
  requirement, not just a nice-to-have.

**A real, genuine bug in `shared/rolodex.ts` found and fixed during
verification — affects Starter too, not something this build
introduced.** Testing swipe-to-delete via a real headless-Chromium
pointer-drag (not just reading the code) intermittently landed the
`pointerdown` on `#roloIndex`'s sticky pill strip instead of the
`.rolo-card` underneath it — confirmed via `elementFromPoint()` and
direct `getBoundingClientRect()` sampling that the active card's real
rendered top edge was ABOVE the pill strip's bottom edge, a genuine
visual/interactive overlap. Root-caused by sampling `#gateSpacer`'s real
computed height every 30ms through a pill tap: `scrollToActiveCard()`
(in `shared/rolodex.ts`, used by both Free and Starter) sets
`wrap.style.scrollMarginTop` and calls `scrollIntoView({behavior:
'smooth'})` while the Gate is still undocked — the resulting scroll
itself is what normally triggers `updateGateDockState()` to collapse
`#gateSpacer`'s ~150-200px of reserved flow space, but that collapse is
CSS-transitioned (`.2s`), so the *layout* `scrollIntoView` and the
in-flight scroll animation actually observe keeps shifting for the next
200ms while the transition eases — the page moves out from under the
already-committed scroll target and it consistently lands short,
overlapping the sticky pill strip. A first fix attempt (forcing
`gateSpacer.style.height='0px'` synchronously before computing the
scroll target) still didn't work — the same 30ms-sampling technique
showed the *style* was set immediately but the *rendered* height stayed
at its old value for one full frame before the transition took over,
proving a style write alone doesn't make the layout `scrollIntoView`
reads reflect the change. **Actual fix:** suppress `gateSpacer`'s
transition for this one forced, synchronous collapse
(`transition:'none'`, force a reflow via `offsetHeight`, restore the
transition), so `scrollIntoView` and the real scroll animation both
operate against an already-final, stable layout. Natural scroll-driven
docking (the normal case, not a pill tap) is untouched — it still eases
via the transition exactly as before. Re-verified via the same
30ms-sampling technique: the active card's real position now lands
flush against the pill strip's bottom edge with zero overlap, and the
swipe gesture removes the correct ticker end-to-end. Re-ran Starter's
full existing regression suite (`verify-starter.mjs`) against the fixed
shared module — all pass, zero new errors, confirming the fix is a pure
correctness improvement for both tiers, not a Free-specific patch.

**Verified via real headless Chromium, both an anonymous session and a
signed-in-but-free session** (the lapsed-subscriber/free-account sync
path) — separately, since they exercise genuinely different code paths
(`initWatchlistSync`/`pullWatchlistFromServer` only fire when
`sbSession.token` is set): ticker count, Gate render, no live-clock
element, `#marketTs` populated, Sources line includes Alpaca, footer
Privacy Policy link present, Sector Pulse teaser renders (blur + upsell,
no Settings modal/profile-menu/CSV-export elements exist anywhere in the
DOM, matching Free's real capability set), pill-tap auto-analyze,
real `/analyze` request body shape (all 8 relay fields present), Gate
dock/undock via real incremental scroll, Session Context highlighting
produces real `<mark class="ctx-match">` spans, Import respects the real
3-ticker cap (an over-cap add silently no-ops behind the native
`alert()`), swipe-to-delete removes the correct ticker end-to-end in
both auth states, Glossary search filters correctly, and a real
`NO_CREDITS` 402 correctly shows the full-page comeback splash with the
right buy-button text/link for each auth state and correctly hides again
on close. Zero real console/page errors in either auth state — the only
network failures observed were `fonts.googleapis.com` (this sandbox's
own documented restriction, not a regression) and intermittent
`/status` fetch failures that don't affect any assertion (matches this
file's own fail-safe-by-design posture for that endpoint).

**Not verified:** a real end-to-end round trip against live credentials
(`tra-zacg.onrender.com` is unreachable from this sandbox, same standing
limitation as every other backend-dependent feature in this file) —
spot-check a real anonymous analysis and a real signed-in-but-free
watchlist sync after deploy.

**Explicitly not done in this pass:** Pro's own Rolodex rebuild (needs
its own design pass per the deep-dive audit that preceded this build —
Pro's card/list-window split and exclusive features don't map onto the
Rolodex UI as directly as Free/Starter's did); Shark (still deliberately
deferred, per Tier status above). `preview/rolodex/` itself is untouched
— it remains the mocked-`/analyze`, isolated-from-`shared/` staging
ground it always was, not superseded by this real build.

## Frontend: Free's ticker pill strip gets a permanent "Starter?" upsell pill (Aug 16, 2026)

Direct instruction: add a non-ticker pill reading "Starter?" to Free's
`#roloIndex` marquee that links to the Starter upgrade Stripe page —
explicitly not counted as a ticker.

**Extended `shared/rolodex.ts`'s `rebuildRoloIndex()` with an optional
4th `buildExtraChip` parameter**, rather than building this directly in
`app.ts` outside the shared marquee mechanism. A one-off pill appended
after `rebuildRoloIndex()` finishes (outside its repeating-pass loop)
would only ever be reachable by dragging past the last pass — the
continuous auto-scroll marquee never legitimately scrolls that far, since
`stepRoloMarquee()` only ever cycles `scrollLeft` between `0` and
`roloMarqueeOneSetW` (one pass's width). `buildExtraChip`, when supplied,
gets appended once per repeated pass (after the real ticker chips, before
the divider) so it repeats naturally alongside them and is genuinely
visible during normal marquee playback, not just via a manual drag.
`roloItemsPerPass` (used by `sizeRoloMarquee()`'s child-index-based
pass-width fallback) is bumped by one whenever `buildExtraChip` is
supplied, so that measurement still points at the correct second-pass
start. Fully backward compatible — omitting the 4th argument (Starter's
own call site, unchanged) behaves identically to before.

**Kept deliberately outside every ticker-aware mechanism, not just
visually different.** `buildUpsellChip()` (`app.ts`) returns a plain
`<a>` styled with a new `.rolo-chip-upsell` class, not `.rolo-chip` —
so it's automatically excluded from `positionRoloStack()`'s active-chip
toggling (`.rolo-chip` class-scoped query) and `renderPill()`'s
per-symbol updates (`.rolo-chip[data-sym="..."]`, which it doesn't
match either way, having no `data-sym`) by construction, not by a
special-case check. It's never added to `watchlist`, never passed
through `goRolo()`/`analyzeOne()`, and the `"— N —"` divider text is
still computed from `watchlist.length` alone — so it doesn't count
toward the 3-ticker cap, the ticker-count header, or the divider count,
exactly as asked. A plain `<a href="..." target="_blank">` needs no
click handler of its own; the existing native-focus-scroll suppression
(`pointerdown → preventDefault()`, already applied to every appended
element inside a pass) is applied to it the same as any real chip, so
tapping it can't fight the marquee's own scroll position.

Verified via headless Chromium: the pill renders once per marquee pass
(3 real chips × 3 tickers = 9 real chips, 3 upsell pills, matching);
correct text ("Starter?"), `href` (the Starter Stripe link), and
`target="_blank"`; the ticker-count header and the `"— 3 —"` divider are
both unaffected; the marquee still auto-scrolls; tapping the pill opens
a new tab and leaves the currently-active ticker card/pill completely
unchanged (no `goRolo()` side effect). Re-ran Free's full existing
regression suite (anonymous and signed-in-but-free) — all pass, zero new
errors. `starter/app.js` (unaffected — Starter's own `rebuildRoloIndex()`
call site doesn't pass the new argument) re-verified via its own
existing regression suite for the same reason as always: this change
touches the shared `rolodex.ts` module.

## Frontend: Free header's credits/sign-in chips stacked vertically, not a horizontal row (Aug 16, 2026)

Direct correction: `.topbar-actions` (the credits chip + the SIGN UP/SIGN
IN or SIGN OUT chip) was laid out as a horizontal row (`display:flex`,
no `flex-direction` set — defaults to `row`), so whenever `.app-topbar`
ran out of width the whole pair wrapped as a unit onto its own line
*below* the logo/brand, still side-by-side. **Not what's wanted, now or
in any future pass on this header:** changed `.topbar-actions` to
`flex-direction:column; align-items:flex-end`, matching
`preview/rolodex/`'s original design for this same element — the two
chips now always stack vertically on the right, whether or not the pair
as a whole still needs to wrap below the logo on a very narrow viewport.

Verified via headless Chromium at two widths (390px and a much tighter
320px): confirmed both chips stack vertically and stay right-aligned
(their right edges match) at both widths, confirmed zero horizontal
overflow (`.app-topbar`'s `scrollWidth` never exceeds its own rendered
width) at either width, and visually confirmed via screenshot at both.
Scoped to Free only (`index.html`) — this is the only tier with this
exact "credits chip + login/sign-up chip" pair; Starter/Pro's header
uses a credits chip + a single profile-menu button instead, a different
layout not touched by this fix. Pure CSS/HTML change — `app.js`'s own
content is unaffected, so no `?v=` bump applies.

## Frontend: Free header — missed cache-bust, then a scroll-hide header tried and reverted same day (Aug 16, 2026)

**Bug — a real, embarrassing repeat of this file's own documented
cache-busting rule.** The PR that added the "Starter?" upsell pill
(above) changed `app.ts`/`shared/rolodex.ts` and rebuilt `app.js`, but
never bumped `index.html`'s own `<script src="./app.js?v=51">` — so a
browser that had already loaded the page kept running the stale,
pre-upsell-pill bundle, exactly the failure mode this file has warned
about since the Aug 2-3, 2026 `watchlist.js` incident. Caught live
("I'm not seeing the teaser pill"), fixed with the one bump. **Permanent
reminder, not just a one-off:** Free's `index.html` has no importers to
cascade into, so a content change to `app.ts` always means bumping this
one `?v=` by hand — there's no shared-module cascade to catch it for you
here the way there is for `shared/*.ts` files.

**Feature tried, then reverted the same day.** Also built: a
`position:fixed` header that hid on scroll-down and revealed on
scroll-up (transform-only motion, per the Aug 13, 2026 collapsing-card
lesson), with `#scroller`'s own `padding-top` collapsing in lockstep so
the Gate genuinely reclaimed the vacated space (its real viewport `top`
measured `71px → 0px`, not just a visual cover-up). Building this
surfaced a real bug worth remembering even though the feature itself is
gone: the header-hide listener reacted to a pill-tap's own resulting
scroll and collapsed `#scroller`'s padding **during** the in-flight
`scrollIntoView()` animation — the exact same "layout shifts out from
under an in-flight scroll" race already fixed once for the Gate's own
`gateSpacer`, just via a different property this time. Fixed by adding
an optional `beforeScrollToCard()` hook to `shared/rolodex.ts`'s
`RolodexCallbacks`, letting a tier settle its own fixed chrome
synchronously before `scrollToActiveCard()` measures anything.

**Reverted in full the same day, direct feedback: "remove the header
hiding. that broke too much and I don't like it."** Every piece came
back out cleanly — `.app-header`'s `position:fixed`/transform CSS, the
DOM wrapper (`.safe-top`/`.app-topbar` are direct `.app-shell` children
again), `app.ts`'s `setHeaderHidden()`/`sizeHeaderSpacer()`/
`wireHeaderScroll()`, and the now-unused `beforeScrollToCard` hook
itself (removed as dead API surface, not left disabled) — confirmed via
`grep` on both compiled bundles (zero matches) and a live check
(`#appHeader` `null`, header position byte-identical before/after a full
scroll). `?v=52→53` for the removal, same as any other content change.
Starter was never touched by either the feature or the revert (the hook
was optional and it has no fixed header).

**The lesson worth keeping, independent of the header itself:** the Aug
13, 2026 collapsing-card principle (transform/opacity-only, never a
reactive layout-affecting property mid-gesture) held up fine here too —
what broke was the *interaction* between two independently-reasonable
pieces (the header's hide/show and `scrollToActiveCard()`'s pre-existing
scroll-margin math) each written assuming the other didn't exist. That's
the standing risk with any future "add fixed chrome above `#scroller`"
change on this page, not something specific to headers. No plan to
revisit a scroll-hide header on its own.

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

## Backend: signup confirmation emails redirecting to a dead site (Aug 16, 2026)

Reported live: users confirming their email after signup landed on a dead
site — the confirmation itself succeeded (Supabase processed the token
fine), but the link didn't ship them anywhere useful afterward.

**Root cause.** `/auth/signup`'s `authClient().auth.signUp({ email,
password })` call never passed an `emailRedirectTo` option, so Supabase
fell back to the project's default **Site URL** (Auth → URL
Configuration) for the confirmation link instead of the app itself.
`/auth/reset` already sets `redirectTo` explicitly
(`https://tradetribunal.app/reset`) — signup was the one auth path that
never got the equivalent treatment, so this same class of bug (documented
elsewhere in this file for `/reset`'s own redirect) had a second, unfixed
instance sitting right next to it the whole time.

**Fix (`Tra` PR #39 / `trade-verdict` PR #167, both merged):** added
`options: { emailRedirectTo: "https://tradetribunal.app/" }` to the
`signUp()` call — root, not a tier subpath, since every new signup starts
as a `free` subscriber (`upsertSubscriber(email, "free", ...)` runs
immediately after). Mirrored into `trade-verdict`'s copy per the
two-repo rule; `Tra` is what actually deploys.

**Required companion step, same shape as the Aug 4, 2026 `/reset`
rollout:** `https://tradetribunal.app/` had to be added to Supabase's
Auth → URL Configuration → Redirect URLs allowlist, or Supabase would
keep rejecting the redirect even with the code fix deployed — **done,
confirmed by Mr. T Aug 16, 2026.**

**Unverified against a live signup** — same standing sandbox limitation
as every other Supabase/backend change in this file (no reachable
credentials, no way to actually receive a confirmation email from here).
To confirm: sign up with a real test email once `Tra`'s deploy picks up
PR #39, click the confirmation link, and check it lands on
`https://tradetribunal.app/` instead of the old dead URL.
## Frontend: Rolodex UI shipped to Pro — third real tier, Phase 3 bundler entry (Aug 16, 2026)

Direct instruction: "finish out phase 3 and continue phase to finish out the app update." Third real
(non-preview) tier on the Rolodex UI, after Starter and Free — and per the plan already laid out in
"Frontend: Rolodex mechanics extracted to shared/rolodex.ts" above, Pro's build needed its own design
pass first (its card/watchlist split and four Pro-exclusive features don't map onto the Rolodex UI as
directly as Starter/Free's did). Shark stayed untouched — still the deliberately-deferred rebuild
pending the Alpaca "Plus" data-plan decision, not picked up.

**The one genuinely blocking structural question, scoped via `AskUserQuestion` before writing any
code:** how should Pro's existing 15-card-window / unlimited-watchlist split (and its role as a
credit-cost guardrail on `analyzeAll()`, capped at CARD_CAP/3 = 5 credits) map onto the Rolodex's
single-active-card model? **Answer, verbatim: "the pills are capped at 15. the watchlist stays as
built in pro. it can be in a drop down like everything else."** Confirmed and implemented exactly as
answered: `cardWindow()` (`watchlist.slice(0, CARD_CAP)`) is the pill strip's only source array —
`rolodex.initRolodex()`'s `getWatchlist` callback is wired to `cardWindow`, not the raw `watchlist` —
while the underlying `watchlist` array itself stays exactly as unlimited as it already was
(`maxTickers: 999`, unchanged). Everything beyond the top 15 renders in a new "Watchlist" accordion
utility card (`data-card="watchlist"`), the same tap-to-expand pattern already established for Sector
Pulse/Session Context/Import — "like everything else," per the literal answer.

**Approach: same "invert the build direction" pattern as Starter/Free, not a preview extension.**
Started from Pro's real, working `pro/app.js`/`pro/index.html` (real auth/credits/`/analyze`, real
server-synced watchlist AND track record — Pro is the only tier with the latter — Settings modal,
Session Context highlighting) and ported the Rolodex's sticky-docking Gate, marquee pill strip, and
single-active-card stage mechanics in via `shared/rolodex.ts`, exactly as Starter/Free's own sections
above describe. `pro/app.ts` was authored as real TypeScript from day one (matching Free's precedent,
not Starter's convert-after-the-fact one) — `npx tsc --noEmit` against it (Pro isn't in `tsconfig.json`'s
narrow Phase 0 scope, so checked directly with the same compiler flags) came back with only the same 7
known `?v=N`-import-resolution baseline errors shared modules already carry — zero errors from
`pro/app.ts` itself.

**Every Pro-exclusive feature ported forward, not dropped — reshaped only where the CARD_CAP decision
above required it:**
- **Analyst View** — unchanged in substance (trigger classification via `classifyTrigger()`,
  corroboration tally, resolved proxy tier/risk flags), now a per-card expandable subsection
  (`data-toggle-analyst`/`data-analyst-body`, wired via `wireCardButtons()` rather than the old
  `window.toggleAnalyst` inline `onclick`) instead of a fixed list-row subsection — calls
  `rolodex.syncRoloStageHeight()` on toggle since expanding it changes the active card's real height,
  same discipline as every other dynamic-height change on this page.
- **Real Track Record** (not a teaser — Pro has no upgrade gate on this) — its own accordion utility
  card (`data-card="track"`), `refreshTrackRecordCard()` (new, consolidates `renderTrackRecord()` +
  `renderGateAttribution()` + `renderTickerAccuracy()`) called once unconditionally at `initApp()` so
  the card's content is already correct by the time a user taps it open — unlike Watchlist/Proxy/Heat
  Map, Track Record needed no lazy-load-on-expand wiring. Real ✓ RIGHT/✗ WRONG/SKIP log buttons
  (`logSectionHTML`/`logResultUI`) replace Starter/Free's "UPGRADE to log results" teaser link.
- **Proxy Resolution Explorer** and **Sector Heat Map** — both became accordion utility cards
  (`data-card="proxy"`/`"heatmap"`), lazy-rendered on first expand via `wireAccordionHead()`'s
  `kind==='proxy'`/`'heatmap'` branches (mirroring `'watchlist'`'s same lazy-load shape). Both
  correctly cover the **full** watchlist (all 18 in testing, not just the 15-card window) via a
  priority-first pattern — `cardWindow()` resolves first, `overflowTickers()` streams in after —
  reusing the exact priority-first/generation-counter shape this file's Aug 5, 2026 "watchlist
  load-time fixes" entry already established for these same two panels. Both now `await
  pillHydrationDone` (a new per-render promise, replacing the old shared-module `cardsReady()` gate)
  before firing their own fetches, so they don't compete with the top-15 pills' own hydration burst.
- **Watchlist overflow accordion** (`data-card="watchlist"`, replacing the old always-visible compact
  list) — tickers beyond CARD_CAP, ported near-verbatim from the old `renderCompactList`/pointer-gesture
  code: price/%chg/news, swipe-to-delete, sort toggle, a "+" promote-to-card button
  (`promoteToCard()`, splices the ticker into index `CARD_CAP-1` via `setWatchlist()` — whatever was
  already there shifts down to become the new top overflow row).
- **CSV export** — same `Ticker,List,Price,IV,Change%` shape (`List` = `CARD` if index < CARD_CAP else
  `WATCHLIST`) as before, moved into the profile-menu dropdown (`#exportCsvBtn`), matching where
  Starter's own CSV export already lives, replacing the old in-Import-tile button.

**`#comeback-screen` dropped, same call as Starter's, confirmed the same way.** Grepped the OLD
`pro/app.js` before assuming: `showScreen()`'s allowed-list included `'comeback-screen'`, but no call
site anywhere in the file ever actually invoked `showScreen('comeback-screen')` — same dead-code
pattern Starter's own build already found and documented. Dropped in favor of the same
`handleNoCredits()` inline-error path Starter/Free use, not re-verified with the user since the
evidence (a grep, not a guess) already matched an established precedent in this file.

**A real, pre-existing CSS gap found and fixed, not inherited silently.** `shared/track-record.ts`'s
STREAK/TOP TICKERS row has always referenced `var(--fs-sm)` inline — a leftover from the old
pre-Rolodex Pro/Starter CSS (`--fs-sm:11px`). Starter's own Rolodex `:root` never defined it, but
Starter never surfaced the gap because `TIER.tracker:false` means it never calls
`renderTrackRecord()`. Pro's real Track Record does call it, so the gap would have rendered that one
row at the browser's inherited font size instead of 11px. Fixed by adding `--fs-sm: 11px;` to
`pro/index.html`'s `:root` as a legacy alias, same pattern already used there for
`--card`/`--white`/`--dim`.

**Phase 3 (bundler): third entry point, zero plugin changes needed.** `esbuild.config.mjs`'s
`entryPoints` array gained `{ in: 'pro/app.ts', out: 'pro/app' }` — the `normalizeSharedImports` plugin
built during Starter's Phase 3 kickoff (redirects `.js`(`?v=N`)? shared-module specifiers onto their
`.ts` siblings, preventing the two duplicate-module bug classes documented there) needed no changes to
handle a third entry point. Confirmed via the same chunk-header grep used for Starter/Free's own
duplicate-module checks: `pro/app.js` bundles exactly 10 shared modules, every one as its `.ts` source,
zero duplicates. `starter/app.js`/`app.js` (Free) were unaffected by the new entry — re-confirmed via
`git status` showing only the files this pass actually touched.

**Verified via real headless Chromium against a realistic mocked backend** (an 18-ticker watchlist —
15 inside the card window, 3 overflowing — to actually exercise the CARD_CAP split, not just assert it
in isolation): ticker-count reflects the full 18-ticker watchlist while card-count correctly reads
`15/15`; the pill strip contains zero overflow tickers; pill-tap auto-analyze and the confidence-driven
"LOOK FOR" dot work; Analyst View expands with real trigger/corroboration/proxy-tier content; real log
buttons record a result and both accuracy breakdowns populate immediately; the Watchlist accordion
shows exactly the 3 overflow tickers sorted by % change, and promoting one moves it into the pill strip;
Proxy Resolution Explorer and Heat Map both cover all 18 tickers (not just 15); Gate dock/undock via
real incremental scroll; Settings modal opens; CSV export downloads a real file with the correct
`List` column and all 18 rows; Session Context highlighting produces real marks; **Analyze All fires
exactly 15 `/analyze` calls, never 18** — confirming the 5-credit-max guardrail survived the rebuild
unchanged; the real `/analyze` request body carries all 8 relay fields; Gate ticker links resolve
correctly including the `BTC-USD` override; Glossary search filters; swipe-to-delete removes the
correct ticker end-to-end. Re-ran Starter's and Free's full existing regression suites afterward since
this pass touches `esbuild.config.mjs` (shared by all three bundled entry points) — both pass
unchanged, zero new errors. **A real bug caught and fixed in the test script itself, not the app**,
worth noting since it cost real debugging time before being ruled out: the CSV-export step's own click
sequence assumed the profile menu started closed going into that step, but `settings-modal.ts`'s panel
calls `event.stopPropagation()` on its own clicks (to stop backdrop-click side effects) — which also
means closing Settings never reaches the profile-menu's outside-click-closes listener, so the menu was
still open from the earlier Settings step. The test's own next click on `#profile-btn` was therefore
closing the menu, not opening it. Not a Pro-specific bug — the same `settings-modal.ts` behavior
applies identically to Starter, whose own test script happens to click something outside the menu
between those two steps and never hit it. Fixed in the test by explicitly closing the menu first.

**Not verified:** a real end-to-end round trip against live credentials (`tra-zacg.onrender.com` is
unreachable from this sandbox, same standing limitation as every other backend-dependent feature in
this file) — spot-check a real sign-in, a real `/analyze` call, and the real server-synced Track Record
pull/push after deploy.

**Phase 3 status after this pass:** Starter, Free, and Pro all have their own bundled `app.ts` entry
point. Shark remains the only tier not on this pattern — still deliberately deferred, per Tier status
above.

## Engineering: Phase 4 shipped — real test suite, TypeScript adoption plan closed out (Aug 17, 2026)

Direct instruction: "finish up the loose end from phase 2 and complete phase 4 so this can be done,"
with Shark explicitly confirmed shelved indefinitely (no longer "pending the Alpaca Plus decision" —
just off the table, don't revisit without being asked).

**Phase 2's "loose end" turned out to already be closed — the note above was stale, not the work.**
Re-read the "gates-extended.js (trade-verdict's copy) converted to .ts" entry above and found it still
said `Tra`'s own mirror was "still open, a real follow-up, not forgotten." Added `Tra` to this session's
repo scope to actually check, rather than trust the note — its `gates-extended.ts` was already there,
committed via `Tra` PR #36 and merged *before* the Aug 16 confidence-redefinition work even started.
Confirmed it's a real, working mirror, not a stray file: `require('./gates-extended.js')` against `Tra`'s
compiled output returns all 14 expected exports, and diffing `Tra`'s `gates-extended.ts` against this
repo's own showed the code identical, only one header-comment line differing (`types.js` vs
`shared/types.d.ts`, matching `Tra`'s flatter layout). Corrected the stale note in place rather than
leaving both versions in the file.

**Phase 4 — a real gap, not stale documentation, so this pass actually built it.** The plan's own
description named exactly what to protect: "every recent gate-logic change... was already verified with
a throwaway Node script... converts work already being done into permanent regression coverage for the
trickiest logic in the app." `gates-extended.ts`'s 10 exported functions were cleanly testable as-is
(already a real, `require()`-able CommonJS module) — but the *other* half of "the trickiest logic," the
functions behind the Aug 13, 2026 Gate 5 forceDown-unreachable bug and the Aug 16 LOW-confidence gap
(`priceConfirmedConfidence`, `normalizeMarketReading`, `evaluateProxyStatus`), lived inline inside
`server.js`, which has no `module.exports` at all and calls `app.listen()` at the bottom — requiring it
for a test would start a real server as a side effect. Skipping those and testing only `gates-extended.ts`
would have left Phase 4 covering half of what it was actually scoped to protect.

**Fix: extracted the four pure functions into `analyze-helpers.ts`**, a new file following the exact
same CommonJS-safe pattern `gates-extended.ts` already established (no `import`/`export` statements —
same ESM/`export {}`-silently-breaks-`require()` trap documented there — a plain
`declare var module: {exports:any}` plus a literal `module.exports = {...}` at the bottom instead).
`server.js` now requires it via `const ah = require("./analyze-helpers");` and calls the four functions
through the `ah.` namespace, matching the existing `gx.` convention for `gates-extended.js`. **Verified
this was pure code motion, not just asserted:** extracted the *original* inline function bodies from
`git show HEAD:server.js` into a throwaway comparison module and ran both old and new side by side
across 23 cases — including the real Aug 13, 2026 crash-scale `-6.20%` TSM value and the exact
multi-symbol label-pairing bug case — every single one byte-identical. Also did a full real boot test
(`npm install`, `node server.js`) to confirm the edited file starts cleanly end-to-end, not just that
`node --check` and `tsc` were happy.

**The real test suite (`tests/gates-extended.test.js`, `tests/analyze-helpers.test.js`, 75 cases,
`node --test tests/*.test.js` via `npm test`) — no new dependency, Node's built-in test runner, exactly
as the plan's own text suggested.** Covers every branch this file's own incident writeups already
named: all 8 `evaluateGate1Sessions` branches, all 3 `proxyCoherenceCheck` cases (including the real
Aug 13 crash example), all 4 `regimeValidation`/`hasForceDownAuthority` states (UNKNOWN/INTACT/
DEGRADING/BROKEN), all 4 `resolveFixedProxyBreak` tiers, `contextTextMatches`/`buildupPatternCheck`/
`corroborateSessionContext`, and for `analyze-helpers.ts`: every `priceConfirmedConfidence` boundary
(including the exact ±1.0% negligible-move threshold), `normalizeMarketReading`'s two accepted shapes,
and `evaluateProxyStatus`'s RED/YELLOW/GREEN thresholds plus the exact multi-symbol mislabeling case
the Aug 13 fix targeted.

**A real, honest snag while writing the `gates-extended.ts` tests, worth keeping as a technique note:**
three of the DEGRADING/secondary-tier/exhaustion-threshold fixtures failed on the first run — not
because the underlying logic was wrong, but because hand-guessed synthetic price/correlation series
didn't actually land in the target band (e.g. a "decorrelated" fixture that was still positively
correlated enough to read as INTACT). Rather than loosen the assertions to fit whatever the fixture
produced, tuned the *fixtures* by running small throwaway scripts against the real `gx.pearson()`/
`gx.regimeValidation()`/`gx.resolveFixedProxyBreak()` functions themselves until they landed cleanly in
the intended band, then locked in those exact values with a comment explaining why. All 75 cases pass
on a clean run.

**Both changes landed the same way this file's two-repo rule always requires:** `Tra` (the real backend)
gets the actual `analyze-helpers.ts`/`server.js` change and its own copy of the test suite (`Tra` PR
#40); this repo's `server.js`/`analyze-helpers.ts` are the mirror, cosmetic/historical per the usual
rule, but this repo's own copy of the test suite is real and load-bearing here too, since
`gates-extended.ts` is genuinely used by both. `Tra`'s `tsconfig.json`/`tsconfig.build.json` both
widened to include `analyze-helpers.ts`, same as this repo's.

**Status: the TypeScript adoption plan (Phases 0-4) is now fully complete in both repos.** Phase 0/1
(JSDoc + shared contract types): done. Phase 2 (real `.ts`, transpile-only): done in both repos,
confirmed above. Phase 3 (bundler): done for Starter/Free/Pro, Shark intentionally excluded (see next
paragraph). Phase 4 (real test suite): done, this entry. Nothing further planned on this thread unless
new work surfaces a reason to revisit it.

**Shark: shelved indefinitely, not "pending a decision" anymore.** Every earlier note in this file
framed Shark's rebuild as blocked on an Alpaca "Plus" data-plan upgrade that might happen at some
point. Per direct instruction this session, that framing is retired — Shark is shelved indefinitely.
Don't pick it up, don't ask about the Alpaca plan, unless explicitly asked to revisit it.

## Frontend: gate-dot alignment fix, Pro header/topbar bug, Watchlist/Import card-sub truncation (Aug 18, 2026)

Three live-reported issues from a real phone, two screenshots (one unlabeled, one Pro) — all Rolodex-UI
polish, no logic changes.

**1. Gate status dots not lined up with their label's first line, "across all tiers."** The
`.gate-row`/`.gate-dot` CSS (byte-identical, hand-copied into Free/Starter/Pro's `index.html`) relied on
a guessed `margin-top:4px` on the dot to visually center it against the label's cap-height — a constant
tuned to look right for whatever monospace font a desktop browser happens to resolve `--mono`'s stack
to. A synthetic repro with that exact CSS in this sandbox measured only a 1-2.5px dot/label offset and
looked fine on screen — but the `--mono` stack's real first match on Android is `Roboto Mono` (a font
this sandbox doesn't have installed, and Playwright's browser couldn't fetch from Google Fonts either to
test against, since browser launches here don't pick up the proxy the way `curl`/Node do) — different
fonts have different line-height metrics, so a margin-top tuned against one font's metrics is not
guaranteed to land correctly against another's. Rather than guess a new constant for a font this sandbox
can't actually render, **fixed the alignment structurally instead of numerically**: restructured the
markup so the dot and the label share their own inner flex row
(`.gate-row-head{display:flex;align-items:center;gap:8px}`), decoupled from the multi-line note text
below it (`.gate-row` itself becomes `flex-direction:column`, `.gn` gets `padding-left:16px` to stay
visually indented under the label like before). `align-items:center` on a two-item single-line flex row
centers the dot against the label's actual line-box by construction, for any font, with nothing left to
mistune. Verified two ways: (1) a font-metric-sensitivity test — same markup, deliberately different
computed line-heights — showed 0.00px dot/label-center offset in every case, versus the old approach's
1-2.5px-and-unverifiable-on-a-real-device gap; (2) a real Pro-tier render with a full mocked 6-gate
analyzed card measured `0` offset on all 6 rows. Applied identically to `index.html`/`starter/index.html`/
`pro/index.html`'s CSS and each tier's own `gateListHTML()` markup (not a shared module — three
hand-copied, now-identical edits, same as the CSS always was).

**2. Pro's credits chip stacked above the profile button instead of beside it, unlike Starter.** A real
bug from Pro's own build (Aug 16, 2026): `pro/index.html`'s `.topbar-actions` was written as
`flex-direction:column;align-items:flex-end` — Free tier's deliberate vertical-stack pattern (a direct,
different-shaped fix from earlier the same day, for Free's two-chip credits+sign-in pair) — instead of
Starter's actual horizontal `display:flex;gap:6px;align-items:center`. Since Pro was built by copying
Starter's CSS as the base, this was very likely an absent-minded copy from the Free-tier work done
immediately prior in the same session, not a deliberate choice. Fixed by matching Starter's rule exactly.
Verified via real render: credits chip and profile avatar now share one row, vertically centered against
each other (confirmed via `getBoundingClientRect()`, not just a screenshot glance — a 20px-tall chip and
a 32px-tall circular avatar centered on a `align-items:center` row do NOT share the same `.top`, so the
real check compares vertical centers, not raw top values).

**3. Watchlist (and, caught by directly measuring rather than guessing, Import) accordion subtitles
clipping.** `.card-sub` is a fixed single-line `overflow:hidden;text-overflow:ellipsis;white-space:nowrap`
element, and the Watchlist card's subtitle text ("Beyond the top 15 · tap + to promote to a card") is the
longest of any utility card *and* has to share its row with a count badge, shrinking its available width
further than the others. Measured every card-sub's `scrollWidth` vs `clientWidth` on the real page rather
than guessing which ones clip from character count alone — two genuinely clip: **Watchlist** (as
reported) and **Import** ("Paste or type tickers to add · unlimited on Pro," never reported but longer
than Watchlist's own text and confirmed clipping the same way). The other five (Pulse/Context/Proxy/
Heatmap/Track) measured clean, left untouched.

**First fix attempt built a redundant second "(?)" system, caught before it shipped.** Per the direct
request ("this info is better suited in (?) instead of the text per drop down"), the first pass added a
new `.info-btn` next to the card label plus a `showCardInfo(e, text)` helper (`stopPropagation` +
`alert()`). Before committing, `git fetch origin main` turned up two PRs merged by a *different*,
concurrent session in the time since this repo was last synced — "Add card-header help balloons with
glossary screen-jump links" and a font-size/Gate-label follow-up — that had **already** added a proper
`.help-btn`/`data-help="X"` system (`shared/rolodex.ts`'s `initHelpBalloons()`, fading balloon popups
with inline Glossary jump-links, not a plain `alert()`) to every utility card on all three tiers,
**including Watchlist and Import specifically** — confirmed by diffing that PR's `HELP_CONTENT` object
directly rather than assuming. Shipping the from-scratch `.info-btn` on top of that would have put two
different-looking "?" buttons and two different help mechanisms on the same card. Reverted the whole
`.info-btn`/`showCardInfo` addition before it was committed.

**What that other PR did NOT do: shorten the actual `.card-sub` text.** It added the help balloon
*alongside* the still-too-long subtitle, so the real clipping bug this entry opened with was still live
even after both PRs merged — confirmed directly, not assumed, by re-measuring `scrollWidth` vs
`clientWidth` against the post-merge markup. **The actual fix, once the redundant system was removed:**
just shorten the two clipping `.card-sub` strings — Watchlist to "Beyond top 15", Import to "Paste or
type tickers to add" — leaving the already-existing `.help-btn`/balloon exactly where the other session
put it (a sibling of `.card-title-wrap`, unaffected by the text edit). Both now measure clean at 0px
overflow.

**A second, real regression surfaced only after rebasing onto the concurrent PRs, caught by re-measuring
rather than assuming the fix was complete.** Adding a `.help-btn` sibling to *every* utility card (not
just Watchlist, which already had a count-badge eating into its width) shrank `.card-title-wrap`'s
available space on cards that had measured clean before — **Session Context** ("Empty · auto-included in
every analysis," clipping by 6px on all three tiers) and Pro's **Proxy Resolution Explorer** ("Gate 5
proxy + live coherence per ticker," clipping by 13px). Neither was part of the original report; both were
found by re-running the exact same `scrollWidth`-vs-`clientWidth` measurement against the merged tree
instead of trusting the pre-rebase result. Fixed the same way: Context shortened to "Auto-included in
every analysis" (drops the redundant "Empty · " prefix — the textarea itself already shows emptiness),
Proxy shortened to "Proxy + live coherence per ticker" (drops the redundant "Gate 5 " prefix — the card's
own title already says "Proxy Resolution Explorer"). Re-measured clean across all three tiers afterward.

**Lesson worth keeping:** before adding new UI mechanics to a shared file mid-session, re-fetch and check
for concurrent work first — this file's own two-repo-drift lessons are about staying in sync
across repos, but the exact same discipline applies within one repo when another session might be
landing overlapping work in parallel.

**Verified together via one real headless-Chromium pass** (mocked backend, a full 6-gate analyzed card,
tapping the pill first, run against the rebased tree with both concurrent PRs merged in): all 6 gate-dot
offsets measured `0`; topbar `flexDirection:row` with credits left of and vertically centered against the
profile avatar; all 7 card-subs measured non-clipping; the pre-existing `.help-btn`/balloon for Watchlist
and Import both confirmed still present and unaffected by the text shortening. Re-ran the full existing
Free/Starter/Pro regression suites afterward since the gate-row markup change touches every tier — all
pass, zero new errors. `index.html`/`starter/index.html`/`pro/index.html` `?v=` bumped since each tier's
own `app.ts` content changed on top of the concurrent session's own bumps; no shared module was touched
by this pass, so no further cascade was needed.

## Frontend: utility/watchlist cards soft-snap under whichever dock sits above them (Aug 18, 2026)

Direct request: expanding Sector Pulse should soft-snap its top edge to sit right under the collapsed
docked Gate; more generally, tapping any card to expand it should smooth-scroll (not jump, not reorder)
so its top lands flush under whichever sticky bar is directly above it on the page — the docked Gate for
Pulse/Session Context/Import, and (Pro only) the docked ticker-pill strip for Watchlist/Proxy/Heat
Map/Track Record, since those sit below `#roloIndex` in the page. Explicit constraints from the request,
carried through the implementation: never reorder cards, only scroll; keep free scrolling completely
unaffected afterward — no persistent CSS `scroll-snap-type` lock, just a one-time smooth scroll on expand.

**Implementation, entirely in `shared/rolodex.ts` — mechanics, not tier-specific content, per this
module's own scope boundary.** `scrollToActiveCard()` (the existing pill-tap-to-ticker-card scroll,
Aug 16) already did exactly this for one specific case — force the Gate docked synchronously, then
`scrollIntoView` with a `scrollMarginTop` accounting for the Gate's docked height plus the pill strip's
own docked height. Extracted that shared "force-dock + measure the pill strip's real height" logic into
`forceGateDockedSync()`, then added a new export, `snapCardUnderDock(cardEl)`, that applies the same
scroll to any card element — determining whether to also add the pill strip's height via a live
`Node.compareDocumentPosition()` check against `#roloIndex`, rather than a hand-maintained per-tier list
of "which cards come before/after the pill strip." This is deliberate: it stays correct automatically as
tiers add or reorder utility cards (Pro's Watchlist/Proxy/Heat Map/Track Record cards all sit after
`#roloIndex` in the DOM, same as the active ticker card; Free/Starter's three utility cards all sit
before it, same as the Gate) without this module needing to know anything tier-specific about which
cards exist.

Wired into each tier's own `wireAccordionHead()` (`app.ts`, `starter/app.ts`, `pro/app.ts` — this
listener itself stays tier-owned, same split as everywhere else in `shared/rolodex.ts`'s design): calls
`rolodex.snapCardUnderDock(card)` only when the card is being *expanded* (`!wasExpanded`), never on
collapse — collapsing a card should never move the scroll position. Pro's version calls it before its
existing lazy-render dispatch (`renderOverflowList()`/`renderProxyExplorer()`/`renderHeatMap()`) — order
doesn't actually matter here, since a card's top edge doesn't move when its body's content populates
below it, only its bottom does.

**No new failure mode re-litigated — reused the already-hard-won `forceGateDockedSync()` fix
verbatim.** The synchronous-collapse-before-measuring dance (kill `gateSpacer`'s transition, force a
reflow, restore it) that `scrollToActiveCard()` needed on Aug 16 to avoid the scroll target shifting out
from under an in-flight animation applies identically here — sharing the one implementation instead of
duplicating it means any future fix to that mechanism benefits both call sites automatically.

**Verified via real, incremental headless-Chromium checks, not a single fixed-position jump** — matching
this file's own repeatedly-learned lesson about scroll-timing bugs specifically: measured, for each of
Free/Starter/Pro, that (1) expanding Sector Pulse or Session Context from the very top of the page forces
the Gate to dock and lands the card's top exactly `GATE_DOCKED_H` (44px) below `#scroller`'s own top
(not raw viewport coordinates — this file's own Aug 15 measurement-methodology lesson), (2) the existing
ticker-card pill-tap snap still lands at `GATE_DOCKED_H + roloIndexHeight`, unchanged, (3) on Pro,
expanding the Watchlist accordion (which sits below `#roloIndex`) lands at that same combined offset, not
the Gate-only one, confirming the DOM-position check correctly classifies a tier-specific card it knows
nothing about, (4) collapsing an already-expanded card never moves `#scroller`'s `scrollTop`, and
(5) a manual scroll immediately after a snap moves the page normally — free scroll is genuinely
unaffected, not locked. Re-ran the full existing Free/Starter/Pro regression suites afterward — all pass,
zero new console errors (only the standing, pre-existing `fonts.googleapis.com`/`/status` sandbox-network
failures already documented elsewhere in this file).

**A real, self-inflicted testing bug caught and fixed while writing this verification, not an app bug —
worth keeping as its own reminder alongside the Aug 15 ALAB-pill flakiness lesson.** A fixed
`waitForTimeout(700)` after triggering a snap intermittently read the scroll position before the smooth
`scrollIntoView` animation had actually finished, producing a spurious failing measurement on an
otherwise-correct page (confirmed by re-running the identical scenario multiple times back to back — the
underlying app behavior was 100% consistent, only the fixed-delay test assertion flickered). Fixed the
test harness with a `waitForScrollSettle()` helper that polls `#scroller.scrollTop` until it stops
changing between checks, rather than guessing an animation duration — the same "measure the real thing,
don't guess a constant" discipline this file already applies to the app's own code, applied here to the
test script that verifies it.

`app.js`/`starter/app.js`/`pro/app.js` rebuilt from their `.ts` sources via `node esbuild.config.mjs`
(only `shared/rolodex.ts` and the three tiers' `wireAccordionHead()` changed — no other shared module
touched); confirmed via the usual chunk-header grep that all three bundles still contain exactly one
`shared/rolodex.ts` chunk, no duplicate-module regression. `?v=` bumped in all three tiers' own
`<script>` tags (`index.html` 56→57, `starter/index.html` 59→60, `pro/index.html` 4→5) since each
tier's own bundled `app.js` content changed as a result of the shared `rolodex.ts` edit — no shared
module besides the bundler-only `rolodex.ts` was touched, so no further `?v=` cascade applies (`rolodex.ts`
has no raw-browser `?v=N` consumer at all, same as noted when it was first extracted).

## Frontend: Sector Pulse soft-snaps flush under the Gate's own natural scroll-driven dock (Aug 18, 2026)

Direct follow-up to the tap-to-expand soft-snap above: "mostly it works great but one thing I still want
to smooth out on all tiers... at the moment when gate collapses and docks, the screen should snap the top
edge of the sector pulse card [to the] edge of the docked gate." A real, distinct gap from what the entry
above shipped — that one only snapped a card when a user *tapped* it open; the Gate's own **natural**
scroll-driven dock transition (`updateGateDockState()`, no tap involved) had no equivalent correction at
all.

**Confirmed the gap was real before writing any fix, not assumed.** `updateGateDockState()`'s existing
behavior — collapsing `gateSpacer` to `0` with a CSS transition once the Gate docks — is a passive layout
reflow, not a scroll; it "pulls" the page's content up, but nothing about it guarantees the very next
card's top edge lands pixel-flush against the docked bar's bottom edge. Verified directly in headless
Chromium: stopping a scroll gesture that overshoots the ~14px dock threshold by a realistic ~40px (a
normal real-device overshoot, not an edge case) left Sector Pulse's top edge 26px **under** the docked
Gate — a real, visible overlap, not merely "off by a rounding error." Landing exactly on the 14px
threshold itself happens to reflow perfectly flush by the existing algebra (`gateSpacer` is sized to
exactly `overlayHeight − GATE_DOCKED_H`) — but that's a razor's edge no real scroll gesture reliably stops
on, which is why the bug reads as "usually a little off" rather than "always broken."

**Fix (`shared/rolodex.ts`), same "measure the real thing, correct the residual" discipline as the entry
above, not a new mechanism:** a debounced scroll-settle check (`snapFirstCardUnderGateDock()`, gated by
`scheduleFirstCardSnapCheck()`) measures `.content`'s first child (Sector Pulse on every real tier,
generic by DOM position rather than an id — this module's own "mechanics, not tier content" scope
boundary) against the scroller's own `getBoundingClientRect()` (never raw viewport coordinates — this
file's own Aug 15 measurement lesson) and, once scrolling has genuinely stopped, nudges `scrollTop` by
whatever small delta is needed to land the card exactly `GATE_DOCKED_H` below the docked bar.

Two deliberate guards, both load-bearing:
- **Debounced to scroll-*settle* (120ms of no further scroll events), never fired synchronously off the
  scroll/rAF loop that flips the `docked` class.** Programmatically moving `scrollTop` while a real touch
  gesture or momentum scroll is still in flight is exactly the fragile pattern the Aug 13, 2026
  collapsing-card lesson found broken three separate ways on a real device — waiting for the scroll to
  actually stop means this can never fight the user's own gesture, at the cost of the correction landing a
  beat after the dock visually finishes rather than perfectly mid-motion. Accepted trade given that
  history repeating itself once already would be worse.
- **Bounded to a small max correction (80px)**, not a hand-maintained "are we near the threshold" flag —
  so it structurally only ever behaves as a soft snap of a residual few pixels right at the transition.
  Scrolled deep into later content, or back up near the top before the Gate would undock, the measured
  delta is far outside the bound and the check is a no-op by construction — never a surprise jump anywhere
  else on the page.

Also invoked once from `sizeGateSpacer()` (same call site `updateGateDockState()` already runs from) so
content that changes size independent of any scroll event — e.g. Sector Pulse's real text landing after
`/market` resolves — gets re-checked too, not just live scroll activity.

**Verified via real headless Chromium, including an A/B comparison against the pre-fix code (not just the
post-fix behavior in isolation) — same repro used to confirm the bug was real in the first place:**
temporarily reverted the fix, re-ran the ~40px-overshoot scenario, confirmed the same 26px overlap it was
built to fix; restored the fix, re-ran the identical scenario, confirmed the card lands exactly
`GATE_DOCKED_H` (44px) below the docked bar and stays there through a longer settle window. Also confirmed:
scrolling deep past Sector Pulse into later content produces no jump at all (bound correctly excludes it);
scrolling back up toward the dock zone from below re-snaps flush the same way, symmetric to scrolling down;
the pre-existing tap-to-expand `snapCardUnderDock()` from the entry above is unaffected (still lands flush
at 44px); a real pill-tap still fires `/analyze` and renders a verdict correctly. `npx tsc -p tsconfig.json`
shows the same known 7-error `?v=N`-import-resolution baseline, zero new errors; `npm test` (75 cases,
`gates-extended`/`analyze-helpers`) unaffected, all pass — this change only touches `shared/rolodex.ts`.

`app.js`/`starter/app.js`/`pro/app.js` rebuilt via `node esbuild.config.mjs` (only `shared/rolodex.ts`
changed — confirmed via the usual chunk-header grep that all three bundles still contain exactly one
`shared/rolodex.ts` chunk, no duplicate-module regression); `?v=` bumped in all three tiers' own
`<script>` tags (`index.html` 57→58, `starter/index.html` 60→61, `pro/index.html` 5→6).

## Frontend: below-pill card snap fixed for real (not just "consistent already"), card bodies capped to screen height (Aug 18, 2026)

Direct live report: cards below the ticker pills (Pro's Watchlist/Proxy/Heat Map/Track Record) "aren't
soft snapping consistently to the nearest docked marquee when expanded," and separately, expanded cards
"should only expand the frame height of the available screen" — currently a card grows to the full length
of its content (many watchlist rows, a long track record table) with no visible bottom, forcing a lot of
extra scrolling to find where it ends.

**The snap-consistency report was real, not imagined — reproduced and root-caused before touching
anything.** A real headless-Chromium pass against Pro with a realistic watchlist confirmed Watchlist and
Proxy landed flush (44px + pill-strip height below the docked bars) but Heat Map and Track Record landed
20-80px short, worse the further down the page the card sat — exactly the "not consistent" symptom.

**Root cause: `snapCardUnderDock()`'s `scrollIntoView` call computes its target against the document's
CURRENT (still-collapsed) height, before the just-toggled accordion's own CSS-transitioned
`grid-template-rows:0fr→1fr` growth has actually happened.** For a card near the bottom of the page —
Heat Map, Track Record — there isn't yet enough content below it (while still collapsed) to physically
scroll far enough to reach the flush position; the browser silently clamps the scroll to whatever's
scrollable AT THAT INSTANT, and once the accordion finishes growing a moment later and more room becomes
available, the already-dispatched scroll animation never revisits its target — it just stops wherever it
got clamped. Confirmed directly: sampling `#scroller.scrollHeight` frame-by-frame after the click showed
it climbing over the next ~250ms as the accordion's own CSS transition progressed, while the smooth-scroll
animation had already committed to (and stopped at) a scrollTop matching the maxScroll available at click
time, not the larger one available once the accordion caught up a moment later. Watchlist/Proxy "worked"
purely because they happen to sit higher up the page, where there's already enough content below them even
before their own body grows — not because the mechanism was actually correct.

This is the exact same class of bug `forceGateDockedSync()` already exists to prevent for the Gate's own
spacer — just in the opposite direction (a GROWING element instead of a shrinking one), and on the card
being expanded itself rather than the dock above it.

**Fix, mirroring `forceGateDockedSync()`'s own suppress/force-reflow/restore dance:** `snapCardUnderDock()`
now temporarily forces the card's `.card-body` to its real final height synchronously (transition
suppressed, forced reflow) immediately before calling `scrollIntoView`, so the scroll target is computed
against the true final layout — then reverts to collapsed and restores the transition so the visual
accordion-open animation still plays normally afterward, unaffected. Verified via frame-sampling that the
accordion still visibly animates open (not an instant jump) with this dance in place, and re-verified the
original repro (Watchlist/Proxy/Heat Map/Track Record from a real incremental scroll) now lands all four
flush, not just the two that happened to work before.

**Card-height cap, landed in the same pass since it's the same code path.** Added
`capCardBodyHeight(cardEl, dockOffset)`, called from `snapCardUnderDock()` right before the forced-height
dance above (so the forced-height measurement automatically respects the cap, no separate plumbing
needed) — computes the space actually available below whichever dock sits above the card
(`scroller.clientHeight − dockOffset − headHeight − margin`) and applies it as a `max-height` to
`.card-body-pad` specifically, not `.card-body-inner` (which must keep a plain, uncapped `overflow:hidden`
for the existing 0fr/1fr collapse trick to keep working — `.card-body`'s grid row sizes to
`.card-body-inner`'s intrinsic content height, which naturally shrinks to match its now-capped child, so
the collapse mechanism needed zero changes). `.card-body-pad` picked up `overflow-y:auto` (plus
`overflow-x:hidden`, `overscroll-behavior:contain` so an internal scroll doesn't chain into scrolling the
whole page once it hits its own end, and `-webkit-overflow-scrolling:touch` for iOS momentum) as baseline
CSS in all three tiers' `<style>` blocks (identical hand-copied rule, same as every other shared CSS
constant in this file) — harmless when no JS-driven `max-height` is set (a card that fits within one
screen just never triggers scrolling), and a real internal scrollbar once a card's content exceeds it.
Re-capped on window resize (`recapExpandedCards()`, wired alongside the existing `sizeGateMarquee`/
`sizeGateSpacer`/`sizeRoloMarquee` resize listeners) since the available-height math is a snapshot of the
viewport at expand time and doesn't self-update otherwise — a phone rotation or a desktop window resize
while a card is open re-measures and re-applies the cap for every currently-expanded card.

**Verified, not assumed:** a synthetic 50-ticker watchlist (35 overflow rows) confirmed the Watchlist
card's body caps at the computed available height (567px in the test viewport) while its true content
height (1788px) is much taller, and that the capped body is genuinely internally scrollable
(`pad.scrollTop` moves, `pad.scrollHeight > pad.clientHeight`). Re-ran the full existing regression suite
afterward since this touches the shared `snapCardUnderDock()` every tier calls: pill-tap auto-analyze, the
Sector Pulse natural-dock soft-snap (previous entry, unaffected), Free/Starter's Pulse/Context/Import
accordion snaps (all still land flush at 44px — the fix and the cap are both no-ops for cards with modest
content, by construction), and a deep-scroll stability check (no unwanted jump). `npx tsc -p tsconfig.json`
shows the same known 7-error `?v=N` baseline, zero new errors; `npm test` (75 cases) unaffected, all pass.

`app.js`/`starter/app.js`/`pro/app.js` rebuilt via `node esbuild.config.mjs` (only `shared/rolodex.ts`
changed — confirmed via the usual chunk-header grep that all three bundles still contain exactly one
`shared/rolodex.ts` chunk, no duplicate-module regression); `?v=` bumped in all three tiers' own
`<script>` tags (`index.html` 58→59, `starter/index.html` 61→62, `pro/index.html` 6→7).

## Frontend: Glossary converted to a real accordion card, profile-menu "About" link, Proxy term added (Aug 18, 2026)

Direct live report, same round as the below-pill card snap fix above: "you missed the Glossary with that
previous fix for all tiers." Correct — the Glossary was never actually part of the `.card[data-card]`
accordion family the snap/height-cap fix above (and the tap-to-expand snap before it) both apply to. It
had its own bespoke markup (`.glossary-tile`/`.glossary-tile-header`/`.glossary-panel`) and its own bespoke
toggle (`toggleGlossary()`/`setGlossaryOpen()`, plain class-toggling, no `snapCardUnderDock()` call at
all) and its own static `max-height:60vh` cap instead of the dynamic, dock-aware one every other card now
has — so it had neither the snap-to-dock behavior nor the "cap to actually-available screen space"
behavior, in any tier.

**Fix: stopped maintaining a second, parallel accordion mechanism — converted the Glossary into a real
`.card[data-card="glossary"]`, identical in shape to every other utility card**, in all three tiers'
HTML (`.glossary-tile-header` → `.card-head` with the standard icon/title-wrap/chevron; `.glossary-panel`
→ `.card-body`/`.card-body-inner`/`.card-body-pad`). It's now picked up automatically by the same
`document.querySelectorAll('.card[data-card] > .card-head').forEach(wireAccordionHead)` loop every other
card already goes through — no separate click listener, no separate `.open`-class toggling, and it
inherits `snapCardUnderDock()`'s snap-to-dock fix and `capCardBodyHeight()`'s dynamic height cap for free,
with zero changes needed in `shared/rolodex.ts` itself (the whole point of that module being "mechanics,
not tier content" — Glossary just needed to actually BE a card, not a special case). `.glossary-search-wrap`/
`.glossary-cat`/`.glossary-term`/`.glossary-no-results` kept their own CSS (search box, term rows, category
headers, the flash-on-jump animation) but had their own horizontal `14px` padding stripped, since
`.card-body-pad` now provides that — left in place, it would have doubled up to a 28px left/right inset,
visually inconsistent with every other card's content.

**`wireAccordionHead()` refactored in all three tiers to extract a shared `expandCard(card)`** (previously
a closure-local `toggle()` did everything inline) — collapse stays a simple class removal, but expand now
goes through one function every "jump to this card" caller can reuse: the accordion click handler, the
help-balloon's existing `jumpToGlossaryTerm()` (now built on a new `ensureGlossaryOpen()` — idempotent,
re-snaps even if already open, since a caller reaching for it is explicitly asking to jump there), and the
new profile-menu "About" link below. On Pro, `expandCard()` also carries the pre-existing Watchlist/Proxy/
Heat Map lazy-render dispatch, now joined by a `kind === 'glossary'` branch. **Ordering matters and is
deliberate:** `buildGlossary()` (synchronous — a plain string-concat + `innerHTML` assignment over the
whole term list, not fetched) is called **before** `snapCardUnderDock()`, not after, so the forced-height
scroll-target measurement inside `snapCardUnderDock()` sees the real, already-capped content height
instead of the still-empty panel — the exact "forced height must reflect the true final layout" discipline
the below-pill card snap fix above already established, applied here to content-population timing instead
of a CSS transition. Watchlist/Proxy/Heat Map's own renders stayed in their existing after-snap position
since they're fetch-based and populate well after this function returns regardless of ordering.

**"About" in the profile-menu dropdown (Starter + Pro only — Free has no profile menu at all).** Per
direct instruction: since the Glossary's first category (CRF FRAMEWORK — CRF, Pre-Gate, Gate 0-5) is
already a plain-English walkthrough of the whole app, jumping there **is** the About page — no separate
About content was written or needed. `jumpToAbout()` closes the profile menu, clears any active Glossary
search filter (so CRF FRAMEWORK can't be hidden behind a leftover query), and calls `ensureGlossaryOpen()`
— landing the user at the top of the Glossary, CRF FRAMEWORK visible first, exactly the section that
explains the app. Wired as a plain `.profile-menu-item` button (`onclick="jumpToAbout()"`, same inline-
onclick + `window.fn` bridge convention every other profile-menu item and this repo's inline-handler cards
already use), placed between EXPORT CSV and the danger-styled SIGN OUT — matching where Starter/Pro already
group their non-destructive account actions.

**"Add Proxy to the terms list."** A generic "Proxy" term didn't exist in any tier — only a Pro-exclusive
"Proxy tier (Gate 5)" (the *confidence* label for a comparison) and (Pro-only) "Proxy Resolution Explorer"
existed; nothing defined what a Proxy actually *is*, even though every tier's card meta row shows a
"PROXY" field. Added under CRF FRAMEWORK, right after "Gate 5 — Dynamic Sector Proxy" (where the concept is
introduced) in all three tiers — identical definition on Free/Starter, Pro's copy adds one sentence
cross-referencing "Proxy tier (Gate 5)" for the confidence label, since that term only exists there. Each
tier's search-box placeholder term count bumped to match (`index.html`/`starter/index.html` 63→64,
`pro/index.html` 65→66).

**Verified via real headless Chromium across all three tiers, not assumed to transfer from one:** confirmed
the old `.glossary-tile`/`.glossary-panel` classes are gone from the rendered DOM (real conversion, not a
CSS-only reskin); confirmed a real incremental scroll to the Glossary (which sits near the very bottom of
the page, after Track Record on Pro) followed by a tap lands its head flush at the correct dock offset on
all three tiers — the exact scenario the below-pill snap fix above was built for, now covering the one card
that had been missed; confirmed the body genuinely caps (measured `padScrollH` in the 8,000-9,000px range
against a ~565-567px rendered/capped height — the full term list is long) and is internally scrollable;
confirmed the search filter and the flash-on-jump-via-help-balloon behavior both still work unchanged
end-to-end (clicked a real `[data-help="gate"]` balloon, followed its "Gate 0" link, confirmed the Glossary
opened, scrolled to, and flashed the correct term); confirmed the new Proxy term renders with the right
per-tier copy; confirmed the About link (Starter + Pro) closes the profile menu, expands+snaps the Glossary,
and lands on "CRF (Catalyst Response Framework)" as the first visible term. Re-ran the full existing
regression suite afterward since this touches the shared `wireAccordionHead()` pattern in all three tiers:
pill-tap auto-analyze, the Sector Pulse natural-dock soft-snap, and all four of Pro's below-pill card snaps
(Watchlist/Proxy/Heat Map/Track Record) — all still land flush, confirming the `expandCard()` refactor is a
pure reorganization, not a behavior change for anything that isn't the Glossary. `npx tsc --noEmit` against
each tier's own `app.ts` (not in `tsconfig.json`'s narrow Phase 0 scope, checked directly, same as every
other tier-level `app.ts` change) shows only the known `?v=N`-import-resolution baseline, zero new errors;
`npm test` (75 cases) unaffected, all pass — this change doesn't touch `gates-extended.ts`/`analyze-helpers.ts`.

No `shared/rolodex.ts` changes were needed — `snapCardUnderDock()`/`capCardBodyHeight()` already worked
generically off DOM structure and position, exactly as designed; the Glossary just needed to actually join
the `.card[data-card]` family instead of staying a special case. `app.js`/`starter/app.js`/`pro/app.js`
rebuilt via `node esbuild.config.mjs` (each tier's own `app.ts` changed; `shared/rolodex.ts` did not —
confirmed via the usual chunk-header grep that all three bundles still contain exactly one
`shared/rolodex.ts` chunk); `?v=` bumped in all three tiers' own `<script>` tags (`index.html` 59→60,
`starter/index.html` 62→63, `pro/index.html` 7→8).

## Frontend: the active ticker card also caps to the available screen height (Aug 18, 2026)

Direct follow-up, same round as the Glossary fix above: "I should have mentioned the ticker cards should
get the same treatment... keeping the frame height limited to the screen." The height-cap fix (the
below-pill card snap entry above) only ever touched `.card[data-card]` utility cards — the Rolodex's own
active `.rolo-card` (a real analyzed ticker, 6 gates + confidence + a possibly-long note per gate) was
never in scope for it and still grew to its full, uncapped content height, same "hard to find the bottom"
problem for a long analyzed card as the utility cards had before their own fix.

**Same cap, applied to a structurally different element.** `.rolo-card` isn't an accordion body — it's an
absolutely-positioned card inside `.rolo-stage`, whose own height `syncRoloStageHeight()` already sets to
match the active card's real height on every switch/re-render. New `capRoloCardHeight(activeCard)`
computes the same "space available below whichever dock sits above it" as `capCardBodyHeight()` — always
`GATE_DOCKED_H + roloIndex height`, since `.rolo-wrap` (and the stage inside it) always sits after
`#roloIndex` in every tier's markup, exactly like the below-pill utility cards — and applies it as the
active card's own `max-height` + `overflow-y:auto` before `syncRoloStageHeight()` reads
`activeCard.offsetHeight` to size the stage, so the stage's own height (and its existing `.28s` grow/shrink
transition when switching between cards) automatically tracks the capped value with no separate plumbing.
Reading `activeCard.scrollHeight` (not `offsetHeight`) to decide whether to cap is what makes this safe to
call unconditionally on every sync, capped-already-or-not: `scrollHeight` always reports the true,
un-clipped content height regardless of any `max-height` a previous call already applied.

**No scroll-clamping bug to fix here, unlike the below-pill cards.** That fix was needed because
`snapCardUnderDock()`'s `scrollIntoView` computes its target against the still-collapsing accordion body,
and a card near the bottom of the page doesn't have enough content below it yet to physically scroll that
far. `scrollToActiveCard()` (the Rolodex's own pill-tap-to-card scroll) doesn't have this problem by
construction — it scrolls so `.rolo-wrap`'s TOP edge lands at the dock offset, which never depends on the
stage's own height, and `.rolo-wrap` is never the last thing on the page (Watchlist/Proxy/Heat Map/Track/
Glossary all follow it on Pro, plenty of room regardless of the active card's height). Confirmed directly,
not assumed: re-ran the exact pill-tap snap check against a deliberately tall (6 RED/YELLOW gates, long
notes) mocked `/analyze` response — still lands flush at the same `GATE_DOCKED_H + roloIndexH` offset as
before, capped or not.

Also added baseline CSS (`overflow-x:hidden; overscroll-behavior:contain; -webkit-overflow-scrolling:touch;`)
to `.rolo-card` in all three tiers, matching `.card-body-pad`'s own baseline from the earlier fix — inert
when a card isn't capped, a real internally-scrollable card (with momentum on iOS, no scroll-chaining into
the outer page) once one is.

**Verified via real headless Chromium, a genuinely tall mocked `/analyze` response (6 gates, all RED/
YELLOW, long notes) across all three tiers:** confirmed the active card's true content height
(~1,114-1,155px in the test viewport) genuinely exceeds its capped/rendered height (~609-611px) and that
the card is actually internally scrollable (`scrollTop` moves, `scrollHeight > clientHeight`); confirmed a
normal, short analyzed card stays completely uncapped (`max-height` empty) — the fix is a no-op for
anything that already fits; confirmed swipe-to-delete still works correctly on an uncapped card (capping
only ever changes `overflow-y`/`max-height`, nothing about the swipe gesture's own transform/pointer
handling). Re-ran the full existing regression suite afterward since this touches shared
`syncRoloStageHeight()`, called from every tier's own re-render path: pill-tap auto-analyze, the Sector
Pulse natural-dock soft-snap, and all five of Pro's below-pill/Glossary card snaps (Watchlist/Proxy/Heat
Map/Track Record/Glossary) — all unaffected, still land flush. `npx tsc -p tsconfig.json` shows the same
known 7-error `?v=N` baseline, zero new errors; `npm test` (75 cases) unaffected, all pass — this change
doesn't touch `gates-extended.ts`/`analyze-helpers.ts`.

`app.js`/`starter/app.js`/`pro/app.js` rebuilt via `node esbuild.config.mjs` (only `shared/rolodex.ts`
changed — confirmed via the usual chunk-header grep that all three bundles still contain exactly one
`shared/rolodex.ts` chunk, no duplicate-module regression); `?v=` bumped in all three tiers' own
`<script>` tags (`index.html` 60→61, `starter/index.html` 63→64, `pro/index.html` 8→9).

## Frontend: the card-height-cap CSS broke swipe-to-delete and blocked scroll-chaining (Aug 18, 2026)

Direct live report on the two height-cap fixes just above: "swipe to delete the ticker card is broke" and
"a persistent scrolling past the end of the inside of a card should continue scrolling the whole page."
Both real, both self-inflicted by the baseline CSS those two fixes added to `.rolo-card`/`.card-body-pad`
— `overflow-x:hidden; overscroll-behavior:contain; -webkit-overflow-scrolling:touch;` — reasoned about at
the time as harmless safety padding, not verified against a real touch gesture before shipping.

**Root cause 1 (swipe-to-delete): `overflow-x:hidden` alone silently turns on `overflow-y:auto`.** Per the
CSS spec's overflow computed-value rule, setting only one axis to a non-`visible` value forces the OTHER
axis to compute as `auto` too — confirmed directly via `getComputedStyle()`: a plain, short/uncapped
`.rolo-card` (never touched by the JS-driven `max-height`/`overflow-y` cap at all) already reported
`overflowY: 'auto'`, purely from the baseline `overflow-x:hidden` rule. That's enough for the browser's
native touch-scroll-gesture recognizer to treat the card as a scrollable container and capture the touch
before it ever reaches the app's own pointer-based swipe handler (`onRoloPointerDown`/`onRoloPointerMove`
in `shared/rolodex.ts`) — invisible to a mouse-based test (confirmed: `page.mouse`-driven drag swiped
correctly every time) and only reproducible with real touch input, which is exactly why this shipped
without being caught the first time. Reproduced conclusively with Chromium's CDP `Input.dispatchTouchEvent`
(real touch-event dispatch, not mouse emulation) — swipe consistently failed with the broken CSS in place,
consistently worked once removed.

**Fix: `touch-action:pan-y` instead of leaving the browser to infer gesture intent from `overflow`
alone.** Same relationship `.rolo-stage` already has with the page (`touch-action:pan-y` there reserves
vertical panning for native scrolling and leaves horizontal panning for the JS swipe handler) — applied
directly to `.rolo-card` and `.card-body-pad` themselves now that each one is independently scrollable.
Verified via the same real-touch CDP technique: vertical touch-drag on a genuinely tall/capped card still
scrolls it natively (`scrollTop` moves), AND horizontal swipe-to-delete still works on that same capped
card — both gestures coexist correctly on one element once `touch-action` (not an inferred `overflow`
side-effect) is what's actually telling the browser which direction to hand off to native scrolling.

**A second, latent instance of the identical bug, not yet reported but fixed the same way.** Pro's
Watchlist accordion has its own independent compact-row swipe-to-delete gesture
(`onCompactPointerDown`/`onCompactPointerMove` in `pro/app.ts`) inside `.card-body-pad` — the exact same
`overflow-x:hidden`-forces-`overflow-y:auto` mechanism applied there too, for the same reason, so it was
silently broken by the same commit even though nobody had hit it yet. Fixed by the same `touch-action:pan-y`
change on `.card-body-pad` (shared CSS across all three tiers), verified directly with a real CDP touch
swipe on a compact row — confirmed working.

**Root cause 2 (scroll-chaining): `overscroll-behavior:contain` was the literal opposite of what was
wanted.** Added in the original height-cap work with the stated reasoning "so an internal scroll doesn't
chain into scrolling the whole page once it hits its own end" — a real design decision, just the wrong
one; direct correction: scrolling to a capped card's own end should hand off to `#scroller` and keep
going, not stop dead. Fix: removed the declaration entirely, falling back to the CSS default
`overscroll-behavior:auto`, which is precisely "chain to the next scrollable ancestor once this one can't
scroll further."

**Verified with real, continuous wheel-scroll gestures (not a single jump), both card types:** scrolled a
capped `.rolo-card` past its own max in one continuous set of wheel ticks and confirmed `#scroller` picked
up the remainder and kept scrolling past where the card's own end left off; repeated the same check against
a capped `.card-body-pad` (Pro's Watchlist accordion, 18-ticker watchlist) with the same result. **Touch-
specific scroll-chaining (as opposed to swipe-to-delete, verified above) was not independently confirmed
via CDP's synthetic touch dispatch** — the same touch-simulation attempt that cleanly reproduced/fixed the
swipe-to-delete bug did not show `#scroller` picking up the remainder the way wheel scrolling did, most
likely a CDP synthetic-touch limitation (multi-phase "scroll inner then chain to outer" gestures depend on
compositor-thread touch handling that `Input.dispatchTouchEvent` doesn't fully replicate) rather than a
real app bug, given `overscroll-behavior:auto` is the browser's own literal default chaining behavior and
wheel-based chaining through the exact same `overflow:hidden` ancestors (`.rolo-stage`, `.card-body-inner`)
worked cleanly — flagged here rather than asserted as proven, same "say what's unverified" posture as
every other sandbox-limited check in this file. Spot-check a real continuous finger drag on an actual
device if this resurfaces.

Pure CSS change — no `.ts`/`.js` files touched, so no `esbuild` rebuild or `?v=` bump was needed for this
one. `npx tsc -p tsconfig.json` (unaffected either way) still shows the same known 7-error baseline;
`npm test` (75 cases) unaffected, all pass. Re-ran the full existing regression suite (pill-tap
auto-analyze, the Sector Pulse natural-dock soft-snap, all five of Pro's below-pill/Glossary card snaps)
to confirm the `touch-action` change didn't disturb anything else — all still land flush.

## Terminology rule

Verdicts are UP / DOWN / FLAT only, with a magnitude and a sizing action.
"Stand down" and "go" are prohibited anywhere in UI copy, verdict labels, or
generated text (a permanent rule from the Jul 28-29, 2026 framework rebuild).
