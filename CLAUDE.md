# Trade Tribunal — CLAUDE.md

Trade Tribunal (renamed from "Trade Verdict" on Aug 4, 2026) is a systematic
day-trading decision app (the Catalyst Response Framework — Pre-Gate + Gates
0-5) built by Mr. T: a Node.js backend + a four-tier GitHub Pages frontend,
with Supabase auth/credits and Stripe subscriptions.

**Full history, architecture rationale, and the debug playbook live in
Notion, "Trade Tribunal — Full Build Log" (the source of truth).** This file
is a fast-orientation map for this repo. Update both when you finish
meaningful work here.

## Naming: Trade Verdict → Trade Tribunal (Aug 4-10, 2026; trade-verdict #47/#48/#83, Tra #15/#16) — DONE

Renamed because an unrelated competitor already used "TradeVerdict"/
"theverdict.app" and owned `tradeverdict.com`/`.io`. Custom domain
`tradetribunal.app` (`CNAME` in repo root) replaces
`turneraroundauto-hub.github.io`; GitHub auto-redirects the old URL.

- Cosmetic pass: page titles, headers/footers, comments, user-agent strings.
- Functional pass: cross-tier sign-up/sign-in redirect links, backend
  `TIER_URLS`, and Supabase auth `redirectTo` all point at
  `tradetribunal.app`. This required adding `https://tradetribunal.app/reset`
  to Supabase Auth → URL Configuration → Redirect URLs first (done) —
  skipping that would have broken password reset.
- Stripe product names renamed by Mr. T in the Stripe dashboard.
- Aug 10 scrub (#83) fixed the Pro CSV filename, the mirrored `server.js`
  banner, and the README heading.

**Deliberately NOT done, still open (reconfirmed Aug 10, no go-ahead):** the
`tv_*` identifiers (`tv_session`, `tv_wl`, `tv_accuracy_log`, Supabase
table/column names) — renaming them is a breaking data migration that needs
its own pass; and renaming the GitHub repo `trade-verdict` (breaks clone
URLs/CI references).

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

Every `finnhubGet()` call in `Tra`'s server.js goes through a shared
55-calls/min rolling-window queue (`finnhubThrottle()`) with retry-with-backoff
on 429 (free tier is 60/min; a cold `symbolMarketCache` used to blow past it
and fail everything with "No quote"). **New Finnhub-backed features must go
through `finnhubGet()` — never `fetch()` Finnhub directly.**

Slow-changing fundamentals (52W high/low, beta, market cap, IPO date, avg
volume) live in their own 24h cache (`symbolFundamentalsCache`,
`fetchTickerFundamentals()`), decoupled from price refresh. **Known
trade-off, confirmed with Mr. T:** 52W high/low can lag up to 24h; accepted
because Gate 1's forceDown uses fresh Alpaca 60-day data.

## Backend: Alpaca call budget, extended-hours pricing, dual-source news (Aug 4, 2026)

- Every `fetchOpeningBar`/`fetchDailyCloses`/`fetchImpliedVolatility`/
  `fetchExtendedHoursPrice` call goes through `alpacaGet()`, with a shared
  180-calls/min queue (`alpacaThrottle()`; free plan is 200/min) and
  retry-with-backoff on 429. A 429 isn't just slow: `fetchDailyCloses`
  failing to `null` silently degrades Gate 1. **New Alpaca-backed features
  must go through `alpacaGet()` — never `fetch()` `data.alpaca.markets`
  directly.**
- **Pre/post-market pricing comes from Alpaca during `isExtendedHoursWindow()`
  (8-9:30am / 4-8pm ET).** Finnhub's free `/quote` `c` holds the last
  regular-session price until 9:30am. Alpaca's `feed=iex` bars/latest-trade
  include IEX's own pre/post-market prints by default.
  `fetchExtendedHoursPrice()` (latest trade) substitutes for Finnhub's price
  and recomputes %change against Finnhub's `pc`. Thinner liquidity than the
  consolidated tape — imprecise but far better than a stale value. The data
  window stays 8am-8pm.
- **News comes from Finnhub *and* Alpaca (`/v1beta1/news`, Benzinga)
  concurrently; whichever headline is newer wins** — not an empty-only
  fallback (a Finnhub result can be non-empty but stale; root-caused on BB).
  **UNVERIFIED against live Alpaca news entitlement**; fails safe to
  Finnhub-only. Check Render logs for `fetchAlpacaNews` errors or a card
  showing "Benzinga".
- **Market-open cache warm** (`setInterval`): once per trading day in a
  9:30-9:35am ET window, refreshes `marketCache` (`warmTrackedMarketCache()`,
  shared with boot-time warm) and every symbol in `symbolMarketCache`
  (`refreshMarketEntry()`).

**Known follow-up, not built:** `fetchDailyCloses` refetches all 130 days on
every price refresh (as often as every 1 min on Pro) though only the latest
bar can change — a low-risk win to cache like fundamentals.

**Resolved:** `shared/ticker-cache.js`'s `fetchTickerData()` de-dupes
in-flight requests per symbol. PRE/Heat Map load priority-first (see next
section).

## Backend: watchlist load-time fixes (Aug 5, 2026)

A Pro watchlist took 2+ minutes to populate. Fixes:
- **Auth-lookup stampede.** `resolveAuth()`'s 60s `authCache` didn't help
  concurrent requests with the same token. Added an in-flight-promise map
  (`authInFlight`) so concurrent callers share one lookup.
- **Compact-list batching removed.** `renderCompactList()`'s 5-at-a-time
  `mapBatched()` became a plain `Promise.all` (redundant with Tra's throttles
  and ticker-cache de-dupe).
- **PRE and Heat Map load priority-first.** They paint the top-15 card-window
  tickers first, then stream in the rest. Both use a render-generation counter
  so a stale paint can't clobber a newer render. Tickers 16+ still get full
  coverage.
- **The real cause: `evaluatePreGate()` (SEC EDGAR full-text search, runs in
  every `/ticker/:symbol`) had no throttle**, and its result cache and
  ticker→CIK map are in-memory, cold after every deploy. Fixed with
  `secThrottle()` (8 req/sec rolling window) around the CIK map fetch and the
  full-text search, plus `tickerCikInFlight` guarding the cold CIK-map load.
  Unverified against a live deploy at the time.

## Supabase tables: "RLS disabled" ≠ "access blocked" (Aug 4-13, 2026; Tra #22)

Every service-role-only table in this project (`subscribers`, `credits`,
`proxy_resolution`, `pre_gate_triggers`, `watchlists`, `accuracy_log`, and
every later one) is documented as "RLS disabled, server-only access via the
service_role key." **That description is incomplete and was actively
dangerous:** disabling RLS just means Postgres stops filtering rows by
policy — it does nothing about the underlying `anon`/`authenticated` role
GRANTs. `credits`, `accuracy_log`, and `proxy_resolution` were found with
full `anon` **and** `authenticated` SELECT/INSERT/UPDATE/DELETE — anyone with
the public anon key (in every tier's page source) could have rewritten
credit balances, track records, or the proxy cache via the REST API.
`subscribers`/`watchlists` happened to have no such grants — luck, not
design.

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
for existing service-role-only tables include this revoke; any new patch
creating one must too.

**Run RLS-disable as its own separate SQL execution**, after the table
exists. Bundling `alter table ... disable row level security` in the same
SQL editor run as `create table` did not reliably stick (patch8,
`accuracy_log`). Structure patches as explicit separate steps.

**The Aug 4 outage and its root cause (fixed, Tra #22).** Revoking `credits`'
grants broke production (`permission denied for table credits`). Cause: the
`credits` RPC functions (`get_or_create_user_credits`, `deduct_user_credit`,
etc., `supabase-ddl-patch5-credits.sql`) are `SECURITY INVOKER` (the
default), so they run as the caller's role. Tra used one module-level
Supabase client (built with `SUPABASE_SERVICE_KEY`) for everything,
including `/auth/login`/`/auth/signup`. In `@supabase/supabase-js` v2,
`signInWithPassword`/`signUp` persist a session onto that client, after
which its `.from()/.rpc()` calls send the user's `authenticated` JWT
instead of the service key. **Fix:** the admin client sets
`persistSession: false`, and login/signup run on a fresh, throwaway anon-key
client (`authClient()`). **Never call auth sign-in/sign-up on the shared
admin client.** Mirrored into this repo's `server.js`.

**Closed out Aug 13, 2026.** `credits`' stopgap grants were re-revoked (a
real login and a real `/analyze` credit deduction both worked afterward).
The same day, `accuracy_log`, `proxy_resolution`, `pre_gate_triggers`, and
`watchlists` were found to have **regained** full `anon`/`authenticated`
grants (plus TRUNCATE on two). Root cause unconfirmed at the time (see the
Sep 17, 2026 Data API exposure finding later in this file for the first
real trigger caught). All re-revoked and verified in one query. **Don't
assume grants stay fixed — re-run the grants query across every
service-role table periodically, not just the one you touched.**

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
  `GET`/`POST /track` endpoints in `Tra`, structurally identical to
  `watchlist-sync.js`/`GET`/`POST /watchlist`: same debounced push, same
  seed/`ignoreDuplicates` write on an ambiguous empty pull. Free/Starter/
  Shark are localStorage-only. Backing table: `public.accuracy_log`
  (`supabase-ddl-patch8-track-record-sync.sql`).
- `shared/prefs.js` / `shared/settings-modal.js` / `shared/context-highlight.js`
  (added Aug 9-10, 2026, **Starter + Pro only**) — see "Frontend: user
  preferences" below.

`shared/watchlist.js`'s `hydrateCards()` fires every card's fetch
concurrently (the old batches-of-5 were removed Aug 4, 2026 as redundant
with Tra's throttle; they only added tail latency).

(Since Aug 16, 2026, shared modules are `.ts` sources with committed
compiled `.js`, and Free/Starter/Pro `app.js` are esbuild bundles — see the
TypeScript and Rolodex sections later in this file.)

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

**Same bug hit again Aug 9-10 with `prefs.js`:** bumping only
`settings-modal.js`'s import created two live `prefs.js` instances, and
`pro/app.js`'s `onPrefsChange` listener sat on the stale one. Bump every
importer in lockstep.

## Frontend: user preferences — time zone, ticker/news links, session-context highlighting (Aug 9-10, 2026; trade-verdict #75-#80, #82, #84-#89)

**Starter + Pro only.** Free must never show Settings and must ignore prefs
set by another tier in the same browser: `shared/prefs.js`'s
`forceDefaults()` runs on Free's load and always resolves to ET + Yahoo.
Free does not import `settings-modal.js`.

- **Time zone.** `prefs.js` exports `TIMEZONES` (ET/CT/MT/PT) and
  `getTzPref`/`setTzPref`/`getTzIana`; Starter/Pro times render in the chosen
  zone, always labeled.
- **Ticker/news links.** `LINK_SITES` (`yahoo`/`tradingview`/`stocktwits`/
  `google`/`robinhood`/`custom`) drives `tickerHref(t)` and `newsHref(t)`.
  Design decision: route links through the user's own site preference
  ("paywalled" is relative to the user) instead of hunting for a free source
  per headline (abandoned — 404s and `site:` search banners). Finnhub/Alpaca
  stay the data source; only the link changes. Current routes: Yahoo news
  `/quote/{TICKER}/news/`; Google news via `news.google.com`, Google ticker
  via plain `google.com/search?q={TICKER}+stock`; StockTwits news
  `stocktwits.com/symbol/{TICKER}/news`; TradingView ticker via a plain web
  search with a `tradingview` keyword (bare `tradingview.com/symbols/{TICKER}/`
  and Google Finance beta both mis-routed ARCC to an Egyptian company — they
  need a `TICKER:EXCHANGE` qualifier, and this app has no per-symbol exchange
  field). Yahoo, Robinhood, StockTwits, Custom left unchanged after audit (bare
  US tickers resolve to the US listing / US-only product / low collision /
  user's own choice). Unverified live: the sandbox egress proxy blocks
  google/tradingview/yahoo/stocktwits.
- **Custom link.** One URL field (`#settings-custom-ex-url`): paste an example
  URL, `detectTickerInUrl()` finds the ticker (path segments from the end,
  non-ticker blocklist, hyphen-split for Webull-style, query-param fallback
  like `?symbol=NASDAQ:AAPL`); auto-prepends `https://`; blank/invalid falls
  back to Yahoo. Helpers: `buildTemplateFromExample`, `isValidCustomTemplate`.
  Two independent templates: `getCustomTemplate`/`setCustomTemplate` (original
  key, now news link only — no migration needed) and
  `getCustomMarketTemplate`/`setCustomMarketTemplate`
  (`tv_link_custom_market_template`, ticker link).
- **Session Context highlighting.** `shared/context-highlight.js`'s
  `highlightContextMatches(headline, contextText)` HTML-escapes the headline
  (fixed a latent XSS-style missing escape) and wraps matches in
  `<mark class="ctx-match">` only when 2+ distinct stopword-filtered words
  overlap. (The Session Context card itself was later retired, Aug 26-27 —
  see the Agitator section.)
- **Watchlist ordering.** `addTickers()` prepends new tickers as a block
  (`watchlist.unshift.apply(watchlist, newOnes)`, preserving typed order).
  Also mirrored into `shark/index.html`.

**Lessons:** "pushed" and "merged" are different claims — #75 sat unmerged
from another session for days, found only by diffing every remote branch
against `main`. **Don't infer which of several recently-changed things a bug
report is about — confirm the actual state (e.g. which preference was
selected) before fixing.** Clarify ambiguous scope (e.g. "NASDAQ only" meant
"correct US company") before building.

## Deploying: GitHub Pages deployments can get stuck in `queued` forever (Aug 10, 2026)

A merged PR's "pages build and deployment" run can sit at `status: queued`
indefinitely; `rerun_workflow_run` fails with `403 This workflow is already
running`. **Fix: push any new commit to `main`** — a new run starts, the
stuck one flips to `cancelled`, and the new one deploys in about a minute.
If a deploy seems stuck beyond a couple of minutes, check the Actions run
status (filtered to `main`) before assuming propagation lag. Root cause
unconfirmed; suspect rapid successive merges.

## Google Play launch (Aug 11-12, 2026) — Free tier live in Internal testing

Scope (still in force): **no in-app purchases.** The Android app is a
Trusted Web Activity (TWA) wrapper around the Free tier only; sign-up/upgrade
happens on the website via Stripe. Package ID `app.tradetribunal.twa`.
Starter/Pro/Shark Play listings are a separate, unstarted decision.

### PWA groundwork (Free tier only, trade-verdict #91, #93-#97)

`manifest.json`, icons from `shared/assets/logo-mark.png`
(`shared/assets/icons/`), `sw.js` (**network-first, deliberately not
cache-first** — cache-first would reintroduce the cache-busting failure mode
at a new layer), `/privacy/index.html` (Play requirement), root `.nojekyll`.
`sw.js` sits at the root so its scope is the whole origin; its fetch handler
explicitly ignores `/starter/`, `/pro/`, `/shark/`, `/reset/`, `/privacy/`
(and `/preview/`) so it can never serve Free's cached page for another tier.

### The sandbox can't reach `dl.google.com` — plan accordingly

The egress proxy blocks `dl.google.com` (Android SDK) and `tradetribunal.app`.
**These are real org policy denials — don't retry, don't hunt for mirrors,
route around the need:**
- Gradle/`bubblewrap build` runs in GitHub Actions (not network-restricted).
- Bubblewrap `init` was fed the repo's local `manifest.json`/icons via a
  throwaway `localhost` server (loopback skips the proxy).
- Bubblewrap's CLI is interactive and breaks on non-TTY stdin. **Script
  against `@bubblewrap/core` instead** (`TwaManifest.fromWebManifestJson()`,
  `TwaGenerator.createTwaProject()`, `KeyTool.createSigningKey()`,
  `DigitalAssetLinks.generateAssetLinks()`).

### CI build pipeline: `.github/workflows/build-android.yml`

The Android project lives in `android/`. **The signing keystore is never
committed** (root `.gitignore`). The workflow (`workflow_dispatch`, one tap
from a phone) sets up JDK 21 + `android-actions/setup-android` + Node,
installs Bubblewrap, decodes the keystore from a secret, runs
`bubblewrap build` with `BUBBLEWRAP_KEYSTORE_PASSWORD`/
`BUBBLEWRAP_KEY_PASSWORD`, and uploads the `.aab` + signed `.apk`.

Gotchas, all fixed permanently in the workflow:
1. **`base64: invalid input`.** The ~4,700-char `ANDROID_KEYSTORE_BASE64`
   secret picks up whitespace when pasted from a phone. Decoded via
   `tr -d '[:space:]'` then `base64 -d -i`, with a size check that fails
   fast with `::error::`.
2. **`Wrong password?` / `BadPaddingException`.** **PKCS12 keystores (default
   since JDK 9) don't support a separate key password** — `keytool` silently
   ignores `-keypass` and uses the store password. **`BUBBLEWRAP_KEY_PASSWORD`
   must equal `BUBBLEWRAP_KEYSTORE_PASSWORD`.** Both secrets are
   whitespace-trimmed. A future keystore rotation just needs both set to the
   same value.

### Domain verification (`.well-known/assetlinks.json`)

1. **404 despite the file being on `main`:** without `.nojekyll`, Jekyll
   drops dot-directories. Root `.nojekyll` fixes it — keep it.
2. **Play-installed copy showed a browser bar:** Play App Signing re-signs
   with Google's own cert. `assetlinks.json` now lists both the upload
   keystore's and the Play-installed APK's fingerprints (pulled with
   `keytool -printcert -jarfile <apk>`, no SDK needed). **If the keystore is
   rotated or this regresses after a Play Console change, re-pull the
   installed APK's cert this way** — don't assume the fingerprint on file.

### Adaptive icon showed a white background/border (PR #97)

Bubblewrap's `android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml`
hardcodes the background layer to white with an 8.5dp inset. Added
`ic_launcher_background` (`#080C12`) to `colors.xml` and pointed
`ic_launcher.xml` at it. Not bench-tested against a rebuilt APK at the time.

### Keystore handling — read this before ever touching the signing key

The keystore was generated twice (the first handoff lost its credentials;
the local copy had already been deleted). **Always `unzip -l`/verify a
secrets handoff archive before sending it, and don't delete the local copy
until the recipient confirms receipt.** The live keystore's credentials are
with Mr. T only. **If you need to touch signing and don't have them, ask —
don't regenerate, a real Play Console app depends on the current key.**

### Play Console submission — decisions made

- **Not a paid app** (Free stays free on Play; monetization is website
  subscriptions).
- **Not a prediction markets app** (no wagers, no funds held).
- **Sign-in details: "No"** — Free needs no account; the Sign Up link is an
  optional path to a different tier.
- **Financial features:** guided toward no lending, no brokerage/account
  management, no crypto, no personalized advice (generic analysis with a
  not-financial-advice disclaimer). Not confirmed against the live wording.
- "Managed Google Play" (enterprise/MDM) was toggled by accident under
  Advanced settings — flagged to turn off; not confirmed done.
- Store listing copy, feature graphic (1024×500, padded not cropped), and
  7"/10" tablet screenshots (resized phone shots) were handed off.
- **First-time-publisher delay is expected:** a new app's first internal
  release can take hours to become fetchable ("Item not found"). Check, in
  order: the Play Store account matches the invited email; the tester opened
  `https://play.google.com/apps/testing/<packageId>` and tapped "Become a
  tester"; then wait.
- Content rating questionnaire and Production promotion: not reached at the
  time.

### Delivering files to Mr. T when `SendUserFile` doesn't work

Mr. T's client can't download `SendUserFile` attachments (only shows a
re-encoded inline image). **Fallback, use it first: commit the file to a
scratch branch (`store-assets/` folder) and give him the
`raw.githubusercontent.com` URL** — long-press-to-save works on his phone.

## UI staging: the `/preview/` subpath convention (Aug 14, 2026)

The Play app is a TWA opening the live root URL, so pushing to `main` goes
live for web **and** Play installs at once. Staging is a hidden subpath, not
a separate pipeline: `tradetribunal.app/preview/<name>/` deploys through the
normal Pages pipeline (real backend, real relative paths) but is:
- Never linked from any tier's nav or from `preview/index.html` (placeholder
  explaining the convention).
- Excluded from `sw.js`'s fetch handler (`OTHER_TIER_PATHS`, same list as
  `/starter/`, `/pro/`, `/shark/`).
- Disallowed in `robots.txt`.
- Never reached by the Play app (`twa-manifest.json` only opens the root).

**Deliberately not PR-preview deploys** — that means switching Pages to
"deploy via Actions," a risky change to a working pipeline that already gets
stuck sometimes.

**How to use it:** copy the tier files into `preview/<name>/` on a branch
(fix relative paths for the extra depth), PR and merge normally, review at
the URL. Going live is a **separate** follow-up change that wires the real
tier's `index.html`/nav to the new code.

## Backend: Gate 3 Mon/Fri overlay — timezone fix + weekly carryover (Aug 12, 2026; Tra #29/#30, trade-verdict #99/#100)

- **Timezone bug (Tra #29).** The `/analyze` prompt's `Today:` weekday used
  `toLocaleDateString` with no `timeZone`, so it formatted in UTC on Render.
  After ~8pm ET a Friday evening read as Saturday (no overlay). Now anchored
  to `America/New_York`. **Every day-of-week/date check must use an explicit
  ET timezone, never the server's local time** (same bug class as Tra #28's
  Gate 5 "Last checked" date). Unverified against a live Friday-evening run.
- **Weekly carryover (Tra #30), per Mr. T's correction:** the Friday→weekend→
  Monday reaction should keep informing Gate 3 through the week on a codified
  decay, alongside (not replacing) the same-day Mon/Fri rules.
  - `fetchWeeklyCarryover(symbol)`: a separate ~10-day dated-bars Alpaca
    fetch that finds the latest Friday/Monday close pair by timestamp
    (holiday-safe). **Do not derive it from `fetchDailyCloses`' 130-day
    array** — that array has no dates and must be indexed positionally only.
    Only runs Tue/Wed/Thu.
  - `carryoverDecayLabel()`: Tue = MODERATE, Wed = REDUCED, Thu = MINIMAL,
    computed server-side from the real ET weekday (never trust the client for
    the day). Null Mon/Fri/weekend.
  - New Gate 3 prompt section plus a `Gate 3 weekly carryover` context block.
    `weeklyCarryover` rides `/ticker/:symbol` and `refreshMarketEntry`; every
    tier's `analyzeTicker()` (incl. Shark) sends `weeklyCarryoverData`, same
    relay pattern as `gate1Data`/`proxyRule`.
  - The mirror's `fetchWeeklyCarryover` is adapted to this repo's
    `alpacaGet()` contract (full URL + `Response`, vs Tra's path-only URL +
    parsed JSON) — deliberate, flagged in a code comment.
- **Revisit once real Tue/Wed/Thu data exists:** the ±0.3% Fri→Mon
  CONFIRMED_UP/DOWN vs FLAT threshold and the MODERATE/REDUCED/MINIMAL decay
  are uncalibrated guesses (Mr. T didn't specify numbers). Check signal vs
  noise, the decay shape, and whether the model actually treats Thursday's
  MINIMAL as tie-break only. Unverified live.
- A Pro screenshot of gates rendering horizontally turned out to be stale
  browser cache (a hard refresh fixed it), not a regression.

## Backend: Pre-Gate fund-ticker CIK fallback (Aug 12, 2026; Tra #31/#32, trade-verdict #102/#104)

Pre-Gate showed "No SEC CIK found for DRAM" (Roundhill Memory ETF, under
Roundhill ETF Trust, CIK 1976517). `getCik()` only checked
`company_tickers.json`. Resolution order now:
1. `KNOWN_CIK_OVERRIDES` — small, hand-confirmed map (`DRAM → 1976517`).
2. `company_tickers.json` (primary).
3. `company_tickers_mf.json` — lazy, only on a miss, parsed by field name
   (`{fields, data}`), fails safe to `null`. This alone did NOT fix DRAM
   (likely scoped to NAV-priced mutual funds, not ETFs).
4. `getCikFromEdgarSearch()` — SEC's live `browse-edgar` search (ticker in
   the `CIK` param, atom `<company-info><cik>`; narrow `"CIK#:"` fallback),
   fails safe to `null`. Unverified live (`sec.gov` is blocked from the
   sandbox) — check Render logs for `getCikFromEdgarSearch` errors.

**Expected outcome for a fund:** a clean GREEN pass-through, not a trigger —
Pre-Gate's categories are operating-company risks.

**Lesson:** when a fix rests on unverifiable assumptions about an external
data source, pair the general mechanism with a small, guaranteed,
hand-confirmed override for the case actually reported — don't stake the fix
on one untested guess.

## Backend/Frontend: Pre-Gate robustness — wider SEC form coverage + de-emphasized GREEN UI (Aug 12, 2026; Tra #33, trade-verdict #106)

- `PRE_GATE_FORMS` widened from `8-K,10-Q,10-K` to
  `8-K,10-Q,10-K,S-1,S-3,424B2,424B3,424B4,424B5` — dilution (ATM, shelf,
  registered direct) often shows up only in a registration statement or
  prospectus supplement. Unverified against live data. (Keyword table
  `PRE_GATE_TRIGGERS` was later narrowed in the Aug 18 saga — see that
  section.)
- A GREEN Pre-Gate renders as one compact, muted "PRE-GATE clear" row on
  Free/Starter/Pro; YELLOW/RED stay full-weight. Detection uses reference
  equality against `data.gates.pre_gate`, not label text or array index.
  Shark doesn't render Pre-Gate.

## Backend: Proposal 4 — Context-Weighted Gate 2 Corroboration (Aug 13, 2026; Tra #34, trade-verdict #108)

Originally: the Session Context text (`marketContext`) was checked against
three sources, and ≥2 of 3 agreeing promoted a `CONTEXT-CORROBORATED`
modifier into Gate 2 Step 5. No extra credit cost. Sources
(`gates-extended.js` section 6):
1. News-content match on full article bodies
   (`fetchNewsBodiesForCorroboration()`), same 2-word overlap heuristic as
   `highlightContextMatches()`.
2. Gate 3 buildup pattern (`buildupPatternCheck()`): volume 1.5x+,
   outperformance read as magnitude `|tickerPct| > |proxyPct|`, no fresh
   priced news. Earnings-reaction history is omitted (no data source); all
   computable signals must agree and at least 2 of 3 must be computable.
3. Earnings-calendar event (`fetchEarningsCalendarFlag()`, Finnhub
   `/calendar/earnings` via `finnhubThrottle()`).

**Superseded Aug 28, 2026:** Session Context was retired from the UI, the
news-content source was removed, and corroboration now runs unconditionally
on sources 2+3 only (`computeGate2Corroboration`, `GATE2-CORROBORATED`) —
see the later Gate 2 corroboration section.

`tickerPct` comes from `openingBarData`'s bar-1 open→close and `proxyPct`
from parsing `sectorContext`'s change strings (`parsePctString()`). Out of
scope, still open: Gate 4 sizing influence, a Shark earnings-calendar
feature, logging corroboration events to `accuracy_log`.

## Backend: Gate 5 forceDown was silently unreachable — evaluateProxyStatus data-shape bug (Aug 13, 2026; Tra #34, trade-verdict #108)

**The wire format:** every tier's client sends `sectorContext[symbol]` as a
formatted change **string** (e.g. `"+1.23%"`), never an object with `.pct`.
`evaluateProxyStatus()` read `.pct`, so it always got `undefined` → Gate 5
was always GREEN. **Gate 5 RED/YELLOW, Proposal 1's forceDown authority, and
Proposal 2's coherence check were all unreachable dead code from launch.**
(Gate 0 was unaffected — it uses a server-computed `gateStatus` string.)

Fix:
- `normalizeMarketReading()` parses strings via `parsePctString()` and still
  accepts `{pct, change}` objects. `evaluateProxyStatus()` uses it; a real
  `-6.20%` TSM string now returns RED.
- Fixed mislabeling in multi-symbol rules (TSM+KOSPI) when an earlier symbol
  is missing: symbol and reading stay paired.
- The coherence check call site now uses the shared `tickerPct`/`proxyPct`
  (`metricsData.pct` and `sectorContext.tsm.pct` never existed).

Verified by simulation (real extracted code). To confirm live: a Gate 5 RED
card during a real 3%+ TSM/KOSPI move, with a correctly labeled note.

## Backend: Proposal 3 — Fixed-Proxy Regime Validation, weekly persistence (Aug 13, 2026; Tra #34, trade-verdict #108)

`regimeValidation()`/`resolveFixedProxyBreak()` (since Patch 4, Jul 29) are
now wired in, with weekly persistence in `proxy_regime_state`
(`supabase-ddl-patch9-proxy-regime.sql`, standard RLS-disable + revoke).
- `getCachedRegimeState()`/`saveRegimeState()` mirror the
  `proxy_resolution` helpers; `REGIME_RECOMPUTE_MAX_AGE_MS` = 7 days.
- `resolveProxyRegime(symbol, tickerCloses)` fetches the proxy's closes on a
  cache miss (at most weekly) and reuses the ticker's own `dailyCloses`.
- `resolveGate5()` takes a 5th `regime` param: for the fixed Taiwan/Korea
  (`AI/Semiconductor`) rule, a `BROKEN` regime skips the static return and
  falls through to Dynamic Proxy Resolution. `refreshMarketEntry()` computes
  `regime` first via a cheap `classifyTicker()` check.
- `regime` rides `/ticker/:symbol` and `symbolMarketCache`; every tier sends
  `regimeData` (`regimeData:td&&td.regime?td.regime:null`); `/analyze` uses
  `const regime = regimeData || null;`.
- DEGRADING needs no extra code (the coherence check already runs whenever
  Gate 5 reads RED for Taiwan/Korea tickers). BROKEN suspends forceDown via
  `hasForceDownAuthority()` → needs 2+ RED gates for DOWN.
- (Generalized to every static category on Sep 13, 2026 — see the
  proxy-fit section later in this file.)

**BROKEN is expected to be rare** — correlations converge under stress, so
this is a calm-market detector; absence of BROKEN isn't proof it's broken.
Watch Render logs for `resolveProxyRegime`/`getCachedRegimeState`/
`saveRegimeState` errors.

## Frontend: Rolodex UI — design exploration and prototype (Aug 13-14, 2026)

Mr. T wanted the watchlist to stop being a plain scroll that loses the Gate
status. A 3-way prototype (Accordion, Scroll-collapse, Rolodex) was built in
an Artifact (`https://claude.ai/code/artifact/a4c3fd53-111b-4c05-8e71-ddaf59f8b878`);
**Mr. T picked Rolodex as final** ("the only option we're sticking with").
The other two were removed outright.

**Standing rule from this work (confirmed three ways on his real phone):**
changing a `position:sticky` element's rendered height reactively during a
touch-scroll breaks scroll tracking — animated, instant, or disguised with
an opacity overlay. If something must dock/collapse with scrolling, prefer
(a) a plain tap toggle, or (b) drive motion through `transform`/`opacity`
only (never height, padding, grid-template-rows) and test on a real device.
A reflow of a *non-sticky* element on a discrete state change is fine.

Design decisions from the prototype rounds (carried into the real builds):
- **"Gate tickers" means the Gate's own indices** (SPY/QQQ/BTC…), not the
  watchlist. The Gate has its own marquee (`#gateMarquee`/`GATE_INDICES`,
  docked only); the watchlist pill strip (`#roloIndex`) is a separate
  marquee that runs continuously from page load and shows price per pill
  (`.rc-price`).
- **Card switching is pill-tap only** — no swipe/wheel paging, no prev/next
  buttons.
- **Pills are colored by the day's % change (`chg`), not the verdict.**
  Selected pill inverts (solid green/red fill, dark-grey text).
- Collapsed utility-card rows use the `--gate-docked-h` variable so they
  match the docked Gate's height.
- Import card has its own ticker textarea; Export CSV moved to the profile
  dropdown (later built for real).

**Lesson:** the marquee's "is this my own scroll?" check must compare the
observed `scrollLeft` against the value it last wrote (state comparison),
not a true/false timing flag — `scroll` events dispatch asynchronously.
**Lesson:** for layout math (cumulative offsets, stacked sticky elements),
measure real rendered rects in a headless browser, including borders — a
sum of head height + body `scrollHeight` missed the card's 1px borders.

## Frontend: Rolodex preview at `/preview/rolodex/` (Aug 14-16, 2026, final `?v=23`)

The finalized prototype was built for real as a standalone, Free-scoped page
(`preview/rolodex/index.html` + `preview/rolodex/app.js`), staged under the
`/preview/` convention. It was the staging ground for the real tier builds
(Starter/Free/Pro, Aug 16 — see their sections). It remains in the repo,
isolated: it reuses `shared/ticker-cache.js` but reimplements watchlist
state/rendering instead of importing `shared/watchlist.js`, and hardcodes
Yahoo links instead of importing `shared/prefs.js`.

Current behavior:
- Real `/market`, `/ticker/:symbol`, `/status` (free); **ANALYZE is mocked**
  (`MOCK_ANALYZE_PROFILES`, five full responses cycled per ticker via
  `state.mockIndex`, 400-700ms delay) — no real `/analyze`, no credit cost.
  The banner says so.
- If a paid `tv_session` exists, it never reads/writes the shared `tv_wl`
  key (uses `MU`/`IREN`/`ALAB` in memory).
- Analyzed cards match production: 👍/👎/HOLD verdict in a `.ticker-action`
  slot top-right (`.btn-compact` ANALYZE before a result), `isMarketClosed()`
  forces HOLD, TYPE/SIZING badges, CONFIDENCE row, real ticker/headline
  links, Glossary and Track Record teaser after the list. Pre-Gate strip shows
  only when `wait_for` has text, labeled "LOOK FOR:".
- Tapping a pill auto-analyzes a ticker with no result yet.
- Only the Gate and `#roloIndex` are sticky; utility cards scroll away.
  `#roloIndex` uses `top:var(--gate-docked-h)`, opaque background, and must be
  a **direct child of `.content`** (a sticky element only sticks within its
  parent's box).
- The Gate docks at ~14px of scroll (when its overlay starts covering the
  next card), via the constant `.content` top padding, not a live
  measurement. `#gateSpacer` (plain, non-sticky) collapses to 0 on dock with
  a `.2s` transition and is restored on undock.
- `.rolo-stage` has `overflow:hidden`; `syncRoloStageHeight()` sizes it to
  the active card's real `offsetHeight` on every render (no fixed height —
  a fixed `min-height:280px` once clipped gates 4-6). Inactive cards get
  `pointer-events:none` (set in `positionRoloStack()`).
- Marquee: pause on `pointerdown` self-schedules a 2s resume (pointerup/
  cancel just reset it); no scroll-listener pause path. Chips
  `preventDefault()` on `pointerdown` to stop native focus-scroll. Paused
  until real data loads (`roloMarqueeDataReady`); `.rc-price` has
  `min-width:7ch`. Every pass gets its own `— N —` divider
  (`appendChipPass()`); extra passes are appended until there's enough native
  scroll room for one full set (capped at 20 iterations).
- **Wrap period = distance between pass 1's first item and pass 2's first
  item** (`items[0]` vs `items[itemsPerPass]` `getBoundingClientRect().left`),
  in both `sizeRoloMarquee()` and `sizeGateMarquee()`. The old
  `boundary.right − container.left + scrollLeft` formula was off by a
  constant (gap/padding) and caused a visible ~26-28px jump.
- `.app-shell` must be `height:100vh`/`100dvh`, not `min-height` — otherwise
  the page scrolls instead of `#scroller` and docking silently breaks.
  `.app-topbar` has `flex-wrap:wrap`.
- **The page has a `Cache-Control: no-cache,no-store,must-revalidate` meta
  tag and a `?v=N` on its own `<script src="./app.js">`; bump it on every
  content change** like any other app.js.
- Diagnostic tooling from the jump chase (`#marqueeDiag`, `#diagHeartbeat`,
  Layout Instability observer, scroll watcher, `checkRoloScrollWidth()`) is
  still in the page; removing it is a separate, deliberate cleanup.

**Testing lessons from this work (all still apply):**
- Re-measure anything sized from content whenever that content can change
  (e.g. call `sizeGateSpacer()` after `renderGate()` fills real data, and
  re-check dock state from `sizeGateSpacer()` too, not only on scroll).
- Simulate real network latency in tests (delay mocked `/market`) — instant
  mocks hide race conditions.
- Use real incremental scrolling (`page.mouse.wheel()` in small steps), not
  one `scrollTo()` jump.
- `getBoundingClientRect()` reports layout geometry even when an ancestor's
  `overflow:hidden` clips the paint — check computed overflow or a
  screenshot to judge what's visible.
- **Mocks must match the real response shape** — check against the real code
  path (e.g. `/market` is flat: `market.gateStatus`, `market.spy`, read via
  `GATE_FIELDS`/`renderGate()`). When a live report contradicts a "verified"
  fix, re-check the mock's shape first.
- Measure a sticky element's position relative to its scroll container's own
  `getBoundingClientRect()`, never raw viewport coordinates.
- Scope element queries to the active card (`data-sym`) — the first matching
  button in DOM order may be a hidden inactive card's.
- Test both directions of a toggle (dock *and* undock).
- **When runtime diagnostics keep coming back empty, re-derive the expected
  value from first principles and compare it to what the code computes** — a
  deterministic arithmetic error doesn't look anomalous to instrumentation
  built to catch anomalies. (Mr. T found the wrap-math bug by reading the
  code after six rounds of device diagnostics missed it.)

## Tier status

| Tier | Files | Status |
|---|---|---|
| Free | `index.html` + `app.js` | Rebuilt onto the Rolodex UI Aug 16, 2026 (see "Frontend: Rolodex UI shipped to Free") — second real tier on it, after Starter. **`app.js` is a bundled build artifact** — the real source is `app.ts` (repo root), compiled via `node esbuild.config.mjs`; edit the `.ts`, never the `.js`. Consumes `shared/rolodex.ts` for Gate dock/marquee/stacked-card/swipe mechanics. Its top-level "redirect a paid session elsewhere" check still halts the rest of module init (`redirectingToPaidTier`) — see the testing note for why that matters. |
| Starter | `starter/index.html` + `starter/app.js` | Rebuilt onto the Rolodex UI Aug 16, 2026 (see "Frontend: Rolodex UI shipped to Starter") — sticky-docking Gate, marquee ticker-pill strip, single-active-card stage with tap-pill-then-swipe-to-delete; real auth/credits/Settings/server-sync unchanged. First real tier on the Rolodex UI. **`starter/app.js` is a bundled build artifact** — source is `starter/app.ts`, compiled via `node esbuild.config.mjs`; edit the `.ts`, never the `.js`. Its Rolodex mechanics live in `shared/rolodex.ts`, shared with Free and Pro. |
| Pro | `pro/index.html` + `pro/app.js` | Rebuilt onto the Rolodex UI Aug 16, 2026 (see "Frontend: Rolodex UI shipped to Pro") — third real tier. **`pro/app.js` is a bundled build artifact** — source is `pro/app.ts`, compiled via `node esbuild.config.mjs`; edit the `.ts`, never the `.js`. Consumes `shared/rolodex.ts`. Keeps its Pro-exclusive features: Analyst View (per-card expandable), Proxy Resolution Explorer + live coherence strip, Sector Heat Map, real server-synced Track Record, CSV export — ported forward (card/watchlist split became a 15-pill cap + overflow accordion). **Gate 3 reads the last 3 completed 15-min bars here (Oct 19, 2026, `GATE3_WINDOW_TIERS=pro`); Free and Starter still read bar 1 only.** |
| Shark | `shark/index.html` (no separate `app.js` — still monolithic) | **NOT rebuilt — shelved indefinitely as of Aug 17, 2026, not a backlog gap.** The old "blocked on an Alpaca Plus upgrade" framing is retired per direct instruction. Don't pick this up proactively; it still carries the same reorder/log-button bugs Pro had before its rebuild. A standalone `shark/coming-soon.html` splash (Aug 2, 2026, licensed mascot art at `shared/assets/shark-mascot.png`) exists alongside — its email waitlist writes directly to Supabase's `shark_waitlist` table (anon insert-only via RLS) from the browser, no backend involvement. |

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

## Engineering: TypeScript adoption plan (Aug 14, 2026)

Mr. T was asked externally why the project is plain JavaScript. Plan (full version with terminal output:
`https://claude.ai/code/artifact/100a336b-d173-4f0f-9d88-875d628bdd0f`):
- **Don't change either runtime.** `Tra` is I/O-bound API proxying; Node fits it, and a rewrite would mean
  re-deriving every hard-won fix (Finnhub/Alpaca throttles, the Supabase session-leak fix, the SEC limiter).
  The frontend is a static site, so it stays JavaScript. The real options are TypeScript type-checking layered
  on incrementally, and separately, a bundler.
- **Tested against the real repos with `tsc` (`allowJs`/`checkJs`/`noEmit`), three findings:**
  1. The `?v=N` cache-busting convention breaks static module resolution — no resolver accepts
     `'./prefs.js?v=10'`. This is the concrete reason for a bundler: content-hashed filenames make the
     cache-busting bug class (Aug 2-3) impossible.
  2. Plain `checkJs` with no annotations catches almost nothing (only DOM-typing noise from
     `querySelector`). The real value comes from writing shapes down as typedefs.
  3. A one-line typedef for `sectorContext[symbol]` (`Record<string,string>`, a `"+1.23%"` string) made
     `tsc` flag the real Aug 13 Gate 5 bug (`Property 'pct' does not exist on type 'string'`) immediately.
- **Phases, each its own PR:** 0 = JSDoc + `checkJs`, no build step. 1 = shared contract types,
  hand-mirrored in both repos. 2 = real `.ts`, transpile-only, no bundler. 3 = a bundler (esbuild), paired
  with the Rolodex UI work. 4 = turn the throwaway simulation scripts into a real test suite.
- **Out of scope:** a backend language swap, a frontend framework, converting Shark, any big-bang PR.
- **Status: all phases complete in both repos** (see Phase 0-3 below; Phase 4 shipped Aug 17, 2026 — see
  its own entry).

## Engineering: Phase 0 (Aug 14, 2026; `Tra` mirror Aug 16, `Tra` PR #35) and Phase 1

- `tsconfig.json` (`checkJs`/`noEmit`/`allowJs`) scoped to `shared/*.js` + `gates-extended.js`. Contract
  types were first JSDoc `@typedef`s for `GateResult`, `SectorContext`, `TickerData`, `AnalyzeRequestBody`,
  `AnalyzeResponse`; now real declarations in `shared/types.d.ts` (Phase 2).
- **The types file is never loaded at runtime** (typedef imports are erased), so it is exempt from the
  cache-busting rule — don't give it a `?v=`.
- Verified the mechanism catches the real Gate 5 bug shape (passing `sectorContext.tsm`, a string, to
  `proxyCoherenceCheck()`, which takes a `number`).
- `tsc -p tsconfig.json` still shows a known baseline of errors: every `./foo.js?v=N` import fails to
  resolve, plus some DOM-typing errors on old `getElementById` code. Deliberately left alone; treat this
  baseline as "no new errors" in later checks.
- `Tra` has its own `tsconfig.json` (scoped to `gates-extended.js`; flatter layout, no `shared/`) and
  `types.js`, identical typedef bodies. `Tra`'s check is clean (no ES imports there).
- **Phase 1 was satisfied by the same artifact:** `shared/types.d.ts` and `Tra`'s `types.js` are the one
  hand-mirrored contract file.
- `server.js` (both repos), `Tra`'s `credits.js`, and tier `app.js` files are outside `checkJs` scope.

## Engineering: Phase 2 — `shared/` and `gates-extended` converted to real `.ts` (Aug 16, 2026; `Tra` PR #36)

**Converted, in order:** `shared/types.js` → `shared/types.d.ts`, then `ticker-cache`, `watchlist`, `prefs`,
`track-record`, `analysis-cache`, `watchlist-sync`, `context-highlight`, `settings-modal`,
`track-record-sync`, and finally `gates-extended` (both repos). Every file in `shared/` is now real `.ts`.

**How it works:**
- `tsconfig.build.json` (separate from `tsconfig.json`, which stays `noEmit`) emits each `.js` in place:
  `npx tsc -p tsconfig.build.json`. The `.ts` is the source; the emitted `.js` is the deploy artifact for
  unbundled consumers. Commit both. GitHub Pages serves the same file layout as before.
- A `.js`-suffixed typedef import resolves to a sibling `.d.ts` (standard behavior, confirmed on real files).
- Typing choices: public APIs, data contracts (`TickerData`, `AnalyzeResponse`), config interfaces (one per
  module, e.g. `TickerCacheConfig`, `WatchlistSyncConfig`, `TrackRecordSyncConfig` — kept separate even when
  identical), and `window.fn` bridges via `declare global { interface Window {...} }` (never `as any`).
  DOM casts match the real element tag (`as HTMLInputElement`, etc.), checked against the markup.
  `watchlist.ts`'s drag/swipe gesture code was deliberately left `any` (low-value churn, never a bug source);
  `settings-modal.ts` got full casts because its DOM is a fixed template it owns.
- Each conversion was verified by an exact old-vs-new behavior comparison (same exports, byte-identical
  output, real headless Chromium on the affected tier).

**Rules and lessons from Phase 2:**
- **A `.ts` source must carry the `?v=N` bumps too, not just its emitted `.js`.** A bump applied by
  grep/sed to `*.js`/`*.html` only gets silently reverted the next time `tsc` regenerates that file from its
  stale `.ts`. Include `.ts` files in every `?v=` grep/sed. Run `git diff --stat` after a rebuild to catch
  unexpected changes in files you didn't mean to touch.
- **CommonJS `.ts` files (`gates-extended.ts`, `analyze-helpers.ts`) must not use any `import`/`export`
  statement, even `import type`.** Any import makes `tsc` emit `export {};`, Node then loads the file as ESM,
  and `require()` silently returns `{}`. `tsc` and `node --check` both pass on the broken file. **Always
  `require()` the compiled output and check `Object.keys()`.** Use `declare var module` +
  `module.exports = {...}`.
- **JSDoc types inside a real `.ts` file are not enforced** — that only works in `.js` under `checkJs`. So
  `gates-extended.ts` duplicates a local `RegimeValidationResult` interface instead of importing
  `RegimeState`; keep the two shapes in sync by hand.
- Test-harness trap: this repo's file names overlap its API paths (`watchlist.js`/`/watchlist`,
  `track-record.js`/`/track`). Scope Playwright mock routes to the API host
  (`https://tra-zacg.onrender.com/watchlist**`), not a bare path substring, or the local JS file gets mocked.
- `gates-extended` (all 13 exports, 33 cases) was byte-identical before/after; `Tra`'s copy is identical
  except one header comment (`types.js` vs `shared/types.d.ts`) and `require()` returns all 14 exports.

## Frontend: Rolodex UI shipped to Starter — first real tier (Aug 16, 2026)

Mr. T: "I'm ready to move forward with roladex UI change in Starter tier first." Decisions via
`AskUserQuestion`: tap a pill to make it the active card, then that card is swipeable-to-delete; build
directly into the live tier (no `/preview/` staging step).
- **Approach:** started from the real `starter/app.js`/`index.html` and ported the Rolodex mechanics in
  (sticky docking Gate, marquee pill strip, single-active-card stage). Real auth/credits/`/analyze` and 402
  handling, `prefs.js`/`settings-modal.js`, `context-highlight.js`, `watchlist-sync.js` kept as they were.
- `shared/watchlist.ts`'s state exports (`watchlist`, `initWatchlist`, `addTickers`, `removeTicker`,
  `onWatchlistSave`) are reused; its `.card-wrap` rendering is not. Swipe-to-delete is new gesture code
  (`onRoloPointerDown`/`Move`/`Up`, `finishRoloSwipe`) that calls the real `removeTicker()`, so persistence,
  the undo toast, and sync push are unchanged.
- `renderWatchlist()` got a null guard (`if (!wl) return;`) since Starter has no `#watchlist` element.
- **Two silent regressions caught by a DOM-ID / `window.fn` cross-check before shipping:** `#live-clock`
  dropped (later removed on purpose, see below) and Sector Pulse (`#pulse-text`) never populated —
  `renderPulse()` added to `fetchMarket()`. Lesson: a full rewrite has no diff to eyeball, so run the
  cross-check first.
- Not verified against live credentials. The `.rolo-swipe-bg` (`z-index:9`) shares a level with adjacent
  inactive cards and relies on DOM order — spot-check on a real device if stack order changes.

## Frontend: Starter header fix + disclaimer trim (Aug 16, 2026)

- The header live clock crowded `.app-topbar` and displaced the profile badge. Removed `#live-clock` and
  `startClock()` entirely (direct instruction).
- The "Live · Updated ..." market timestamp is now a visible line in the Gate box (`.market-ts`/`#marketTs`
  in `.gate-full-overlay`), not a `title` tooltip.
- Dropped "short-term " from the "trading support" disclaimer in all five copies (`index.html`,
  `pro/`, `starter/`, `shark/`, `preview/rolodex/`).

## Frontend: MANDATORY typography convention — one grey, one size (Aug 16, 2026)

Users complained grey text was hard to read. Starter had 30 rules, 6 font sizes (9-11.5px), and two greys.
Contrast measured: `--ink-dim` (`#7d8896`) 4.87-5.44:1 (passes WCAG AA); `--ink-faint` (`#4c5563`)
2.32-2.60:1 (fails).

**Rule, mandatory going forward:** all secondary/grey text (labels, captions, notes, hints, meta rows,
placeholders, disclaimers, footers) uses exactly `color:var(--ink-dim)` at `font-size:11px`. `--ink-faint`
is retired for text; it stays only for non-text uses (e.g. `.chevron`). 11px is a floor — raise small text,
never shrink 11/11.5px text. Primary text (prices, verdicts, headings, tickers) is unaffected. Apply this by
default to any grey text added or touched anywhere, including future tier rebuilds.

Caveat learned later (Sep 5, 2026): when matching a text size inside one specific card, measure that card's
own neighbors first — the 11px rule does not override a card whose prevailing size is different.

Verified no overflow in the fixed-height containers (docked Gate row and its "↑ top" label, the Gate stat
grid, 44px `.card-head` rows, `.app-topbar`).

## Frontend: MANDATORY rule — every ticker symbol is a hyperlink (Aug 16, 2026)

**Rule:** any displayed symbol that identifies a specific security links out via `tickerHref()` (or
`newsHref()` where news fits better), including passive/label tickers outside cards. Carve-outs:
- **BTC uses `tickerHref('BTC-USD')`**, not `'BTC'`. Generalized as `GATE_LINK_OVERRIDE`/`gateLinkSymbol()`
  so other non-equity symbols have a place to go.
- **A proxy label is linked only when it resolves to exactly one symbol**
  (`td.proxyRule.proxy.symbols.length === 1`). Multi-symbol proxies (e.g. TSM + KOSPI) stay plain text —
  KOSPI isn't US-tradable, and a wrong link is worse than none (see the ARCC/Egypt incident).

The Gate's `#gateGrid`/`#gateMarquee` links carry `data-ticker` and are refreshed via
`refreshTickerLinks()` inside `onPrefsChange` (not a full rebuild, which would jump the marquee). Docked
marquee `.sym` links call `event.stopPropagation()` so they don't trigger the bar's tap-to-top.

## Frontend: Starter small changes (Aug 16, 2026)

- **Export CSV moved to the profile-menu dropdown** (`#exportCsvBtn`, between SETTINGS and SIGN OUT).
  Starter's CSV is `Ticker,Price,Change%` — no `List` column (no card/list split) and no `IV` column (no
  `iv` flag; an always-N/A column would mislead). Filename `trade-tribunal-watchlist-<date>.csv`.
- **Tapping a pill smooth-scrolls to its card.** `scrollToActiveCard()` uses
  `scrollIntoView({behavior:'smooth', block:'start'})` on `.rolo-wrap` with `scroll-margin-top` set from
  `GATE_DOCKED_H` + `#roloIndex`'s live height — no hand-computed offsets. Called only from pill taps
  (`goRolo()`).
- **Gate breakdown on cards:** the headline (`.headline`/`.headline a`) and gate notes (`.gate-row .gn`) are
  `var(--ink)` white (substantive content, not captions); `.headline .age` and `.gate-row .gl` stay
  `--ink-dim`. The literal GREEN/YELLOW/RED status word (`.gs`) next to each gate is removed — the dot
  carries it. The "LOOK FOR" dot is colored by `result.confidence` via shared `confColor()`
  (HIGH green, MEDIUM amber, LOW/fallback red), the same mapping the CONFIDENCE row uses.

## Backend: confidence semantics and LOW → wait_for (Aug 16, 2026, `Tra` PR #37)

**LOW always ships a `wait_for`.** One invariant after all confidence branches run: if `confidence === "LOW"`
and `wait_for` is empty or the literal `"null"`, set it to "Additional confirmation needed before
directional entry." Closes the Proxy Coherence "possible decoupling" branch (which set LOW but no
`wait_for`) and model-self-assigned LOW. Never overwrites a real `wait_for`.

**Confidence = price-confirmed corroboration, not "did a rule fire."** Before, every override branch capped
at flat MEDIUM/LOW and HIGH was unreachable once any override fired. Definition agreed with Mr. T:
- **HIGH:** the ticker's own move and its proxy/sector move both independently agree with the shipped
  direction.
- **MEDIUM:** the trigger is real, but there's no usable price signal to confirm or deny it.
- **LOW:** an available signal moves against the direction. Should be rare; recurring LOW is a signal.
- Confidence must be grounded in the verdict that actually ships (including overridden ones), not the
  model's original call.

Implementation: `priceConfirmedConfidence(direction, tickerPct, proxyPct)` (now in `analyze-helpers.ts`,
called as `ah.`). Moves inside ±1.0% count as no signal (same tolerance as `COHERENCE_FLAT_BAND_PCT`, kept as
its own constant). Applied to Pre-Gate hardTrigger, Gate 0 RED, Gate 1 forceDown, Gate 5 RED + Gate 2 RED,
Gate 0 YELLOW + UP (as "UP"), and Gate 5's plain forceDown branch. Gate 5's Proxy Coherence branch uses
`coherence.case`: Case 1 (moved with proxy) → HIGH, Case 2 (flat/lagging) → MEDIUM, Case 3 (decoupled) →
LOW. Left as LOW on purpose: Gate 5 RED downgrading UP to FLAT (gate-vs-gate conflict) and the non-exempt
DOWN congruency fallback (too few RED gates). The prompt's CONFIDENCE rubric adds: "congruency confirmed"
means ticker and sector price action both point the verdict's way, not just green gate statuses.

Verified by simulation only. To confirm live: a HIGH card on a clean forceDown, and LOW staying rare.

## Frontend: `shared/rolodex.ts` + Phase 3 bundler (Aug 16, 2026)

Rolodex mechanics were extracted from `starter/app.js` before Free/Pro copied them, so fixes live in one place.
- **Scope boundary:** `shared/rolodex.ts` owns how the UI moves (Gate dock/spacer/marquee, pill marquee,
  stacked-card positioning, swipe-to-delete). Card content, `GATE_FIELDS`, `analyzeOne`, and business logic
  stay tier-owned.
- **Bundler:** esbuild via `esbuild.config.mjs`, one entry per tier (`app.ts` → `app`, `starter/app.ts` →
  `starter/app`, `pro/app.ts` → `pro/app`). **Edit the `.ts`, never the bundled `.js`.** After touching a
  tier's `app.ts` or anything it imports, run `node esbuild.config.mjs` (or `npm run build:bundle`), commit
  the output, and bump that tier's own `<script src="./app.js?v=N">`. `package.json` holds `typescript` +
  `esbuild` devDependencies. GitHub Pages still serves from the branch; no deploy-config change.
- `shared/rolodex.ts` is bundler-only — no raw-browser consumer, not in `tsconfig.build.json`, no `?v=`.
  Never leave a stray emitted `shared/rolodex.js` next to it.

**Two duplicate-module bug classes, both fixed by the `normalizeSharedImports` plugin:**
1. **Query-string identity.** esbuild keys modules by exact specifier, so `'./watchlist.js?v=32'` and
   `'../shared/watchlist'` became two instances.
2. **`.ts` vs compiled `.js` identity.** An extensionless specifier resolves to the `.ts`; a `.js`-suffixed
   one resolves to the separately compiled `.js` — a different file with its own state. This one looked
   fixed after (1): the server-synced watchlist silently never rendered, with no error.

The plugin (`onResolve` for any `.js(?v=N)?` specifier) redirects to the `.ts` sibling when one exists, else
to the plain query-stripped `.js`. **Check for duplicates after every rebuild:** `grep "^// shared/"` on each
bundle — every shared module must appear exactly once, as its `.ts`. The shared `.ts` files keep their own
`?v=N` imports because unbundled consumers still load them raw.

Not done: minification/source maps.

## Frontend: Rolodex UI shipped to Free, authored as TypeScript (Aug 16, 2026)

`app.ts` (repo root) was written as `.ts` from the start; second esbuild entry, no plugin changes needed.
Same port-into-the-real-tier approach as Starter (anonymous `APP_SECRET` auth, `redirectingToPaidTier`
guard, `forceDefaults()`, weekly credit reset all kept). Choices made without further instruction:
- Sector Pulse was a static blurred teaser (Free never had real Pulse). *Superseded Oct 19, 2026: Pulse now
  lives in the Gate box.*
- Gate labels shortened to Starter's (`G1  14D`); the Gate-1-driven card rim color dropped (the verdict glow
  carries the signal); "WAIT FOR" unified to "LOOK FOR:".
- The weekly-credit-reset splash (`#comeback-screen`/`startComebackTimer`/`handleNoCredits`) is real, live
  functionality here, kept as a full-page overlay with dual anonymous/signed-in buy buttons.
- Ticker/news links are hardcoded Yahoo via a local `tickerHref()`/`newsHref()` — Free has no Settings or
  link preference, so it doesn't import `prefs.ts`. Still satisfies the hyperlink rule.
- No header clock (timestamp in `#marketTs`); no manual refresh button (4-min auto-refresh + tap docked
  Gate to jump to top).
- Sources line includes Alpaca (true for every tier). The footer keeps its Privacy Policy link (required by
  Play, since the TWA wraps Free).

**Real bug in `shared/rolodex.ts` found here (affects Starter too):** after a pill tap, the active card
landed under the sticky pill strip. `scrollToActiveCard()` scrolled while the Gate was undocked; the
resulting dock collapsed `#gateSpacer` with a 0.2s CSS transition, so the layout kept shifting under the
in-flight scroll. Setting the height alone didn't help (rendered height lagged a frame). Fix: for this one
forced collapse, set `transition:'none'`, force a reflow via `offsetHeight`, then restore the transition.
Natural scroll-driven docking still eases. (Now `forceGateDockedSync()`.)

Verified anonymous and signed-in-but-free sessions separately (sync code only runs with a token). Not
verified against live credentials.

## Frontend: Free tier header and upsell pill (Aug 16, 2026)

- **"Starter?" upsell pill** in `#roloIndex`. `rebuildRoloIndex()` takes an optional 4th
  `buildExtraChip` argument, appended once per repeated marquee pass (a one-off pill outside the loop would
  never be reached by the auto-scroll, which only cycles one pass width). `roloItemsPerPass` grows by one
  when supplied. The pill is a plain `<a class="rolo-chip-upsell" target="_blank">` to the Starter Stripe
  link — not `.rolo-chip`, no `data-sym`, so it's excluded from active-chip toggling, per-symbol updates,
  the 3-ticker cap, and the `— N —` divider count by construction. Starter's call omits the argument.
- **Credits and sign-in chips stack vertically**: `.topbar-actions{flex-direction:column;align-items:flex-end}`.
  Don't revert to a horizontal row. Free only (Starter/Pro have a credits chip + profile button instead).
- **Missed cache-bust:** the upsell-pill PR rebuilt `app.js` but never bumped `index.html`'s `?v=`, so
  browsers kept the old bundle. **Reminder: Free's `index.html` has no cascade to catch this — any `app.ts`
  change means bumping its `?v=` by hand.**
- **A scroll-hide header was built and reverted the same day** ("that broke too much and I don't like it").
  All of it is gone, including the `beforeScrollToCard` hook. Lesson: two reasonable mechanisms (header
  hide/show and `scrollToActiveCard()`'s scroll-margin math) broke each other because each assumed the
  other didn't exist — the standing risk for any fixed chrome added above `#scroller`. No plan to revisit.

## Verifying changes (testing notes)

There's no full test suite for the frontend (backend gate logic has `npm test`, see Phase 4). What's useful:
- `node --input-type=module --check < path/to/file.js` — syntax only, fast.
- A grep-based DOM-ID / `onclick` cross-check between HTML and `app.js`: every `getElementById('x')` has an
  `id="x"`; every inline `onclick="fn(...)"` has a `window.fn = fn`.
- A headless-Chromium smoke pass (Playwright, pre-installed at `/opt/pw-browsers/chromium`): load the page,
  bypass auth, exercise the new paths, check for console/page errors. `tra-zacg.onrender.com` is usually
  unreachable from the sandbox; the point is confirming graceful degradation.
  - **Toggling `#app-root` visible is not an auth bypass on Starter/Pro/Shark.** `initApp()` only runs via
    `checkTierAccess()`, which only runs if `checkAuth()` finds a valid `tv_session`. Prime one first, then
    reload:
    ```
    localStorage.setItem('tv_session', JSON.stringify({token:'x', tier:'pro', expiresAt: Math.floor(Date.now()/1000)+3600}))
    ```
    Free needs no session for an anonymous test. But with a **paid** `tv_session` primed, Free's
    redirect-away check skips `initWatchlist`/`pullWatchlistFromServer` (`redirectingToPaidTier`, Aug 3,
    2026). Don't remove that guard — it stops a paid watchlist being truncated to Free's 3-ticker cap and
    written back to `tv_wl`.
  - **Exact-suffix patterns like `page.route('**/analyze')` match nothing.** `addSecret()` appends
    `?supabase_token=...`. Match a substring (`url.includes('/analyze')`).
  - **Free's Service Worker (`sw.js`) breaks `page.route()` mocking on Free only**, and it looks like the
    feature is broken. Requests fail with `net::ERR_FAILED` before reaching the mock, and once one fails,
    later requests to that origin fail too. A `page.route('**/sw.js', ...)` 404 is not enough; block
    registration before `page.goto()`:
    ```
    page.addInitScript(() => { navigator.serviceWorker.register = () => Promise.reject(new Error('blocked for test')); })
    ```
    If a Free-only test shows a backend URL escaping every mock while the same test passes on another tier,
    check this first.
- None of this replaces a real login against the live backend — say it's unverified rather than implying it
  was checked.
- Harder still for new third-party integrations in `Tra` (e.g. Alpaca options for IV, Aug 2, 2026): there's
  no way to test entitlement-gated credentials from a sandbox. Fail safe (catch everything, return null or a
  clear placeholder, never throw into the response), say in the PR it's unverified, and say what a human
  should check after deploy.

## Backend: signup confirmation emails redirected to a dead site (Aug 16, 2026, `Tra` PR #39 / `trade-verdict` PR #167)

`/auth/signup`'s `signUp()` never passed `emailRedirectTo`, so Supabase used the project's default Site URL.
Fixed with `options: { emailRedirectTo: "https://tradetribunal.app/" }` (root, since every new signup is
`free`). Required companion step, done and confirmed by Mr. T Aug 16, 2026: `https://tradetribunal.app/`
added to Supabase Auth → URL Configuration → Redirect URLs. Not verified with a real signup — confirm a
confirmation link lands on the root.

## Frontend: Rolodex UI shipped to Pro, third bundled entry (Aug 16, 2026)

Mr. T: "finish out phase 3 and continue phase to finish out the app update." Shark stayed untouched.
- **Card-cap decision (via `AskUserQuestion`, verbatim): "the pills are capped at 15. the watchlist stays as
  built in pro. it can be in a drop down like everything else."** `rolodex.initRolodex()`'s `getWatchlist`
  is `cardWindow()` (`watchlist.slice(0, CARD_CAP)`); the underlying watchlist stays unlimited
  (`maxTickers: 999`). Tickers beyond 15 render in a "Watchlist" accordion card (`data-card="watchlist"`).
- `pro/app.ts` authored as TypeScript; third esbuild entry, no plugin changes. Bundles 10 shared modules,
  each once.
- **Pro-exclusive features kept, reshaped only where the cap required:**
  - Analyst View: a per-card expandable subsection (`data-toggle-analyst`/`data-analyst-body`, wired in
    `wireCardButtons()`). It calls `rolodex.syncRoloStageHeight()` on toggle.
  - Real Track Record with real ✓/✗/SKIP log buttons (`logSectionHTML`/`logResultUI`). *Later merged into
    the "Verdict Record" card, see Sep 2026.*
  - Proxy Resolution Explorer (`data-card="proxy"`) and Sector Heat Map (`data-card="heatmap"`):
    - Lazy-rendered on first expand via `wireAccordionHead()`.
    - Both cover the full watchlist priority-first: `cardWindow()` first, then `overflowTickers()`, with a
      generation counter.
    - Both `await pillHydrationDone` before fetching.
  - Watchlist overflow accordion: price/%chg/news, swipe-to-delete, a sort toggle, and a "+"
    `promoteToCard()`, which splices the ticker into index `CARD_CAP-1`.
  - CSV export: `Ticker,List,Price,IV,Change%`, where `List` is `CARD` or `WATCHLIST`. It's in the
    profile menu (`#exportCsvBtn`).
- **Analyze All still fires exactly 15 `/analyze` calls** (the 5-credit-max guardrail).
- `#comeback-screen` dropped on Pro — confirmed dead code by grep (never invoked), same as Starter; uses
  `handleNoCredits()` inline errors.
- `--fs-sm: 11px` added to `pro/index.html` `:root` as a legacy alias, because `shared/track-record.ts`'s
  streak row references it (Starter never hit this since it doesn't render the track record).
- Test-script trap (not an app bug): `settings-modal.ts`'s panel calls `event.stopPropagation()`, so closing
  Settings never reaches the profile menu's outside-click listener. The menu stays open, and a test's next
  click on `#profile-btn` closes it. Close the menu explicitly in tests.
- Not verified against live credentials (sign-in, `/analyze`, Track Record sync).
- **Phase 3 status:** Starter, Free, and Pro all have bundled `app.ts` entries. Shark is shelved
  indefinitely.

## Engineering: Phase 4 shipped — real test suite; TypeScript plan closed (Aug 17, 2026, `Tra` PR #40)

**Phase 2's "loose end" was a stale note.** `Tra`'s `gates-extended.ts` mirror was already merged (`Tra` PR #36). Confirmed by `require()` returning all 14 exports and a diff showing only one header-comment line differs.

**Phase 4.** The trickiest pure functions behind the Aug 13 Gate 5 bug and the Aug 16 LOW-confidence gap (`priceConfirmedConfidence`, `normalizeMarketReading`, `evaluateProxyStatus`, plus one more) lived inline in `server.js`, which can't be required in a test (no exports, calls `app.listen()`). They were extracted into `analyze-helpers.ts`, same CommonJS-safe pattern as `gates-extended.ts`: no `import`/`export`, a `declare var module` plus literal `module.exports = {...}` (avoids the `export {}` → ESM → empty `require()` trap). `server.js` calls them via `const ah = require("./analyze-helpers");`, matching `gx.`. Confirmed pure code motion: old vs new byte-identical across 23 cases, plus a real boot.

**Test suite:** `tests/gates-extended.test.js` + `tests/analyze-helpers.test.js`, Node's built-in runner, `npm test` (`node --test tests/*.test.js`). Covers all `evaluateGate1Sessions` branches, all `proxyCoherenceCheck` cases (including the real Aug 13 `-6.20%` TSM case), all regime states, all `resolveFixedProxyBreak` tiers, corroboration functions, the ±1.0% confidence boundary, and the multi-symbol mislabel case. Lesson: when a synthetic fixture misses its target band, tune the fixture against the real functions; never loosen the assertion.

Both repos carry the suite. `Tra` gets the real `analyze-helpers.ts`/`server.js` change; this repo's copy is the mirror. Both repos' `tsconfig.json`/`tsconfig.build.json` include `analyze-helpers.ts`.

**Status: TypeScript plan Phases 0-4 complete in both repos.** Phase 3 (bundler) covers Starter/Free/Pro only.

**Shark is shelved indefinitely** (direct instruction). No longer "pending the Alpaca Plus decision." Don't pick it up or ask about the Alpaca plan unless asked.

## Frontend: Rolodex card-stack polish — gate dots, topbar, card-sub truncation, dock snaps, height caps, Glossary card (Aug 18, 2026)

All live on Free/Starter/Pro. Several sections merged here.

**Gate-dot alignment (all tiers).** The old `margin-top:4px` on `.gate-dot` was tuned to one font; Android resolves `--mono` to Roboto Mono, which this sandbox can't render. Fixed structurally: dot + label share `.gate-row-head{display:flex;align-items:center;gap:8px}`, `.gate-row` is a column, `.gn` gets `padding-left:16px`. (Later superseded by the Aug 22 single-line hyphen layout below.)

**Pro topbar.** `pro/index.html`'s `.topbar-actions` had copied Free's vertical stack. Fixed to match Starter: `display:flex;gap:6px;align-items:center`. Only Free stacks its two chips vertically.

**`.card-sub` truncation.** `.card-sub` is single-line ellipsis; adding `.help-btn` to every card shrank the available width. Measured `scrollWidth` vs `clientWidth` and shortened every clipping subtitle (Watchlist "Beyond top 15", Import "Paste or type tickers to add", Context "Auto-included in every analysis", Proxy "Coherence per ticker", Heat Map "Sectors + your watchlist", Track "Log & track accuracy", Scorecard "Auto-graded accuracy").
- Lesson: re-measure after any change that adds elements to a card head.
- Lesson: before adding new UI mechanics to a shared file, re-fetch `main`. A concurrent session had already built `.help-btn`/`data-help` balloons (`shared/rolodex.ts` `initHelpBalloons()`), and a duplicate `.info-btn` system was caught and reverted before commit.

**Tap-to-expand snap.** `shared/rolodex.ts` exports `snapCardUnderDock(cardEl)`. It reuses the shared `forceGateDockedSync()` (force the Gate docked synchronously: kill `gateSpacer`'s transition, force a reflow, restore), then `scrollIntoView` with a `scrollMarginTop` of `GATE_DOCKED_H`, plus `#roloIndex`'s height when the card sits after `#roloIndex` in the DOM. That's decided by `compareDocumentPosition()`, not a per-tier list. Each tier's `wireAccordionHead()` calls it on expand only, never on collapse. It's a one-time scroll, not a `scroll-snap-type` lock.

**Natural-dock snap for the first card.** `snapFirstCardUnderGateDock()` / `scheduleFirstCardSnapCheck()` corrects the residual overlap after the Gate's own scroll-driven dock: about 26px on a normal ~40px overshoot.
- It is debounced to scroll-settle (120ms idle), so it never moves `scrollTop` mid-gesture (Aug 13 lesson).
- It is bounded to 80px, so it's a no-op anywhere else on the page.
- `sizeGateSpacer()` also triggers it.
- Test lesson: poll `scrollTop` until it stops changing (`waitForScrollSettle()`); never use a fixed timeout.

**Below-pill snap fix.** For cards near the page bottom, `scrollIntoView` was computed against the still-collapsed document, so the browser clamped it short. `snapCardUnderDock()` now forces the card's `.card-body` to its final height synchronously (transition off, reflow), scrolls, then reverts so the open animation still plays. Same class of fix as `forceGateDockedSync()`, but for a growing element.

**Height caps.**
- `capCardBodyHeight(cardEl, dockOffset)` sets `max-height` on `.card-body-pad` to `scroller.clientHeight − dockOffset − headHeight − margin`. Never on `.card-body-inner`, which must keep plain `overflow:hidden` for the 0fr/1fr collapse trick.
- `recapExpandedCards()` re-runs on resize.
- `capRoloCardHeight(activeCard)` caps the active `.rolo-card` the same way (dock = `GATE_DOCKED_H + roloIndex`). It runs before `syncRoloStageHeight()` and uses `scrollHeight` so it's safe to call repeatedly.
- `.card-body-pad` and `.rolo-card` get `overflow-y:auto` (JS-capped), `overflow-x:hidden`, `-webkit-overflow-scrolling:touch`, and `touch-action:pan-y`.

**Gotcha: `overflow-x:hidden` alone forces `overflow-y:auto`** (CSS computed-value rule). That made every card a native scroll container, which captured touches and broke swipe-to-delete, on the ticker card and on Pro's compact rows. Mouse tests didn't catch it; reproduce with CDP `Input.dispatchTouchEvent`. Fix: `touch-action:pan-y`, so vertical goes to native scroll and horizontal to the JS swipe.

**Scroll-chaining.** `overscroll-behavior:contain` was removed, so scrolling past a capped card's end hands off to `#scroller` (verified with wheel; touch chaining under CDP was inconclusive — spot-check on a device).

**Glossary is a real `.card[data-card="glossary"]`** in all tiers. The old `.glossary-tile`/`.glossary-panel`/`toggleGlossary()` were removed. It inherits snap and cap automatically.
- `wireAccordionHead()` has a shared `expandCard(card)`. `ensureGlossaryOpen()` (idempotent, re-snaps) is used by help-balloon `jumpToGlossaryTerm()` and by `jumpToAbout()`.
- `buildGlossary()` runs before `snapCardUnderDock()`, so the forced-height measurement sees real content.
- Glossary rows dropped their own 14px horizontal padding (`.card-body-pad` supplies it).

**Profile-menu "About" (Starter + Pro)** = `jumpToAbout()`: closes the menu, clears the Glossary search, and opens the Glossary at CRF FRAMEWORK. No separate About content.

**"Proxy" glossary term** added under CRF FRAMEWORK, after Gate 5. Pro's copy cross-references "Proxy tier (Gate 5)".

## Terminology rule

Verdicts are UP / DOWN / FLAT only, with a magnitude and a sizing action.
"Stand down" and "go" are prohibited anywhere in UI copy, verdict labels, or
generated text (a permanent rule from the Jul 28-29, 2026 framework rebuild).

## Backend: Pre-Gate solvency saga — revert, rebuild, per-category search, narrow keywords, exhibit filter (Aug 18 – Sep 7, 2026)

**Revert (Aug 18).** Six same-day PRs (`Tra` #41-#46 / `trade-verdict` #180-#185) were all reverted: widened keywords, `dateRange=custom`, a persistent no-decay solvency flag (`pre_gate_solvency_state`), a 730-day lookback, a cross-company guard, and a `max_tokens` bump. Trigger: the persistent flag produced a live false positive on MU while distressed XTI stayed GREEN. Code reset to commit `e31db3f`; patch10/patch11 SQL files removed. The table itself was left behind (see the Aug 26 Supabase entry).
- Lesson: don't stack changes on an unverified live system in one day.
- Lesson: verify a merge actually happened in the repo that deploys. `Tra` #46 was reported merged but never was; only the mirror #185 merged.

**Observation-first rebuild (`Tra` #48 / `trade-verdict` #187).** Re-landed only the two request fixes (widened keywords, `dateRange=custom`) plus logging. `getCik()` logs the tier and company name. `searchEdgarFilings()` logs URL, status, hit count, and every hit's company name. No persistent flag, wide lookback, or cross-company guard. Check Render logs with grep `[PRE-GATE]`.

**Real root cause (`Tra` #49 / `trade-verdict` #188).** BALY logs showed the search was correct (3 hits, all Bally's). The bug was downstream: one combined query, then re-classifying hits by scanning `hit.highlight`, which EDGAR doesn't reliably populate, so real hits fell to GREEN. Fix: `evaluatePreGate()` runs one `searchEdgarFilings()` per `PRE_GATE_TRIGGERS` category; the query is the classification. That's 3 SEC calls per check, once per ticker per 24h (`preGateCache`).

**False-positive trims (`Tra` #50, #52 / `trade-verdict` #189, #190).**
- STWD went RED on "going concern basis" in a merger-agreement exhibit's Solvency rep (valuation boilerplate). So "going concern" was removed and "substantial doubt" kept; GAAP/PCAOB require it in real auditor qualifications.
- STWD then matched "insolvent" (1,648 boilerplate hits). Removed as a class: `insolvent`, `insolvency`, `receivership`, `event of default`, `notice of default`, `acceleration of indebtedness`.
- **Current solvency list:** `"substantial doubt"`, `"chapter 11"`, `"chapter 7 bankruptcy"`, `"voluntary petition for bankruptcy"`, `"bankruptcy protection"`, `"notice of delisting"`, `"delisting notice"`. Precision over recall; this will miss distress described in other words.
- Method for any future false positive: get the Render `[PRE-GATE]` lines, then the matched sentence via EDGAR's CIK-scoped search UI, before touching code.

**Exhibit filter (`Tra` #52 / `trade-verdict` #191).** XBRL `SubstantialDoubtAboutGoingConcernTextBlock` was a dead end: BALY's `companyfacts` has zero GoingConcern concepts. Restricting forms was also ruled out, since the STWD exhibit was filed inside a 10-Q. Fix: `searchEdgarFilings()` drops hits whose `_source.file_type` starts with `EX-` (`isExhibit()`, case-insensitive). Hits with missing metadata are kept (fail permissive). Excluded counts and types are logged (`excluded N exhibit-only hit(s)`).
- **Do not restore the broad keywords** because of this filter. Item 1A Risk Factors in the primary document carries the same hypothetical boilerplate, and the exhibit filter doesn't catch it. Only broaden alongside an evidence-driven fix for that vector.

**Live status (Sep 7).** STWD confirmed GREEN in production: Render logs show all 3 categories at 0 hits with the trimmed queries, 5 `verdict_log` rows GREEN, no `pre_gate_triggers` rows. Explained by the keyword trim alone.
- **Open:** BALY should be RED (still unconfirmed, no recent check).
- **Open:** the exhibit filter has never fired live. Watch for `excluded N exhibit-only hit(s)`.

## Backend: Gate 4 (Phase) is server-side math (Aug 22, 2026)

New `evaluateGate4(metricsData)`, same shape as `evaluateGate1`, reads `rangePosition` (52-week range %, already in `metricsData`): `<30%` GREEN, `30-70%` YELLOW, `>70%` RED. `/analyze` overwrites `parsed.gates.g4_phase` after parsing. SYSTEM_PROMPT marks Gate 4 "server-provided, never recalculate," and the prompt gets a `GATE 4 — USE EXACTLY THIS` block. The model now runs only Gates 2 and 3. `phaseProxy`'s cosmetic PHASE labels are unchanged. Not verified live: a >70% ticker should render RED.

## Backend: Gate 3 Friday full-weight exception + UP-with-one-RED sizing (Aug 22, 2026)

Both confirmed via `AskUserQuestion`.
- **Gate 5 "30 days of decoupling" wording:** plain-English framing of the existing weekly rolling-20-day correlation check. No code change.
- **Friday full-weight exception:** Friday normally gets a skepticism discount. Full weight applies when this week's Mon-Thu move is flat (±0.3%, reused from `fetchWeeklyCarryover`; not independently calibrated) AND Friday's 3-bar sequence is bullish/convicted.
  - `fetchWeekOwnRange(symbol)` is a dated-bars fetch (not `dailyCloses`, which is not date-anchored), called inside `/analyze` only when `etWeekday() === 5`. It is deliberately not relayed through `/ticker` or clients, so there are no frontend or `?v=` changes.
  - The prompt gets a `Gate 3 Friday full-weight check` line.
  - Revisit the threshold once real Friday data exists.
- **UP with one RED:** UP allows at most one RED among Gates 2/3/4; with exactly one, sizing caps at QUARTER (not NONE). Two or more REDs stay DOWN/FLAT. This is a SYSTEM_PROMPT rule only (sizing was never server-enforced except forceDown→NONE).
- **LOOK FOR** already shows on every verdict; only docs were wrong.
- Not verified live.

## Backend: Pre-Gate joins the corroboration pool — no blanket forceDown (Aug 22, 2026)

Direct instruction, scoped via `AskUserQuestion`:
- Pre-Gate RED alone no longer forces DOWN. It sets `parsed.verdict = "DOWN"` as a candidate and updates `reason`.
- `preGateResult.hardTrigger` was removed from `downForceAuthorized`.
- The congruency `redCount` now includes `preGateResult.status`.
- New `threeYellowBreakdown` (`g2Status`, `g3Status`, `g4Status` all YELLOW): when true, a single RED is enough to force DOWN. Implemented generically.
- Gate 3 is read only for this check, never in the RED tally.
- SYSTEM_PROMPT's Pre-Gate section was rewritten; the model still copies Pre-Gate status/note.
- Deliberate trade-off: a real solvency filing can now render FLAT when it's the only red flag. If a distressed ticker gets FLAT'd in a way that reads wrong, revisit. Not verified live.

## Frontend: touch-and-feel polish + Glossary overhaul (Aug 22, 2026, `trade-verdict` #201-#207)

All three tiers.
- **Gate 0 label:** "OPEN"/"CLOSED" (no "MARKET "). The dot still shows Gate 0's market-direction color.
- **Gate rows on one line:** `.gate-row-head` removed, `.gate-row` is a flex row, `.gate-dot` `margin-top:6px` (measured against real Martian Mono). Reads `G1  14D - note...`.
- **IEX/regular-session disclaimer** moved from `.session-note` into `HELP_CONTENT.gate`'s balloon.
- **Swipe hint:** `.ticker-swipe-hint` nests inside `.ticker-left` with `flex-basis:100%`, so a tall verdict badge can't push it down.
- Lesson: "Pro first" is not "Pro only." Confirm the final scope up front. #206/#207 had to back-fill Free/Starter and Pro.

**Glossary:**
- `.glossary-term-name` = `--amber`; `.glossary-term-def` = `--ink`; `.glossary-term-example` unchanged.
- Categories are alphabetical with CRF FRAMEWORK pinned first. Terms are alphabetical with "CRF (Catalyst Response Framework)" pinned first in its category (About depends on this).
- New category PRICE & VALUATION LANGUAGE (25 terms, identical text all tiers): Overweight, Undervalued, Overvalued, Fairly Priced, Par, Premium, Discount, 52-Week High/Low, ATH, ATL, Bullish, Bearish, Overbought, Oversold, Breakout, Breakdown, Range-bound, Sideways, Volatile, Rallying, Gapping Up/Down, Floating, Frozen.
- Pro has 3 extra terms (Proxy Resolution Explorer, Sector Heat Map, Proxy tier) and lacks "Phase 1 / 2 / 3". That's a pre-existing asymmetry.

**Purple auto-links.**
- `GLOSSARY_LINK_TERMS` / `linkTextSegment()` / `autoLinkGlossaryTerms()` link a curated subset in card headlines, gate `.gn` notes, the LOOK FOR line, and `#gateNote` (now `.innerHTML`). Pro also links `.compact-news`.
- It is a single pass over the original text, plain-text runs only, so a `<mark class="ctx-match">` nests correctly.
- Links are `.help-glossary-link term-link` (`var(--purple)`), clicked via `initHelpBalloons()`'s delegated listener.
- `wrapHeadlineLinks()` splits around term anchors so the article `<a>` and the term `<a>` are siblings, never nested.
- Gotcha: the split regex must be attribute-order-agnostic (`<a\b[^>]*\bclass="[^"]*\bterm-link\b[^"]*"[^>]*>`). An `href`-before-`class` mismatch once silently dropped the article link. A pure-logic Node test caught it.

## Frontend/Backend: Import recognizes company names (Aug 23, 2026, `Tra` #56 / `trade-verdict` #213)

Chosen via `AskUserQuestion`: a live backend lookup, not a static map.
- **Backend:** `GET /lookup?q=` (normal auth, no credit). `searchSymbolByName(query)` → Finnhub `/search` via `finnhubGet()`. Picks the first hit with a bare US symbol (`^[A-Z]{1,5}$`) and type `Common Stock`/`ETP`. Results and misses are cached a week in `symbolSearchCache`.
- **Frontend:** `lookupSymbol()` in `shared/ticker-cache.ts`. `addTickers()` (`shared/watchlist.ts`) splits on comma/semicolon/pipe/newline only, so multi-word names survive.
  - A fully UPPERCASE whitespace token is a literal ticker (zero network).
  - Any other casing is one company-name lookup.
  - `Promise.all` keeps typed order.
  - Results are deduped (first wins) before the cap check, so "AAPL, Apple" counts once.
  - The button shows `ADDING…` with `.btn-running`/`runPulse` and reverts in `finally`. One alert lists unresolved entries.
- Placeholder is `"e.g. AAPL, Tesla, NVDA..."`; the help text states the caps rule.
- **Test gotcha (Free only):** `sw.js` breaks `page.route()` mocking. Block registration with `page.addInitScript(() => { navigator.serviceWorker.register = () => Promise.reject(new Error('blocked for test')); })` before `goto` (a 404 on `sw.js` is not enough).
- Not verified against live Finnhub.

## Supabase: a reverted feature's table left wide open; all advisor findings cleared (Aug 26, 2026)

**Finding.** `pre_gate_solvency_state` (from the reverted Aug 18 saga) sat RLS-disabled with full `anon`/`authenticated` grants for 8 days. The six previously-fixed tables were still clean. Fixed: `revoke all on public.pre_gate_solvency_state from anon, authenticated;`, verified by zero grant rows and a clean advisor scan. All 11 rows were inspected; all were legitimate Aug 18 data with no later activity.

**Rule: any revert of a feature that created a table must drop the table or run the disable-RLS + revoke pattern on it.** "The revert removed the code" is not enough. Periodically re-run the grants check across every service-role table, including this one.

**Same-day follow-ups (via Supabase MCP):**
- `alter table public.subscribers enable row level security;` activates its existing `"service_role full access"` policy and clears `policy_exists_rls_disabled`. Safe: zero anon/auth grants, and the service-role client bypasses RLS.
- `alter function public.<fn>(...) set search_path = '';` on `get_or_create_user_credits`, `add_purchased_credits`, `upgrade_user_tier`, `set_user_tier`, `deduct_user_credit`. Safe because every reference in their bodies is already schema-qualified. Verified by a chained smoke test inside a rolled-back transaction.

**Deferred: leaked-password protection** (Auth WARN). The org is on the Free plan (the feature is Pro-plan+), and it's an Auth setting the MCP can't change. Judged low priority: conditional credential-stuffing risk, modest account exposure, bcrypt hashing. Revisit if more sensitive per-account data is stored, credential-stuffing shows up in auth logs, or the org upgrades.

## Agitator Gauge (Proposal 5) + Aggression Dial (Proposal 6) — design, lessons, and current shape (Aug 26-27, 2026)

Live on Pro, Starter, and (simple gauge) Free. PRs: initial rounds `trade-verdict` #221-#230 / `Tra` #59-#65; comp validation #232 / `Tra` #66; Session Context replacement + Free + "+" buttons #233 / `Tra` #67; relevance + overflow-style rows #235 / `Tra` #68; brand overrides #237 / `Tra` #69; `fetchQuote()` extended hours #239 / `Tra` #70; flat color #241; dial drag/labels #243; "CRF Default" #245.

**Lessons, one per real correction round:**
- If a feature's name implies a physical object (dial, slider, gauge, barometer), build that interaction model, not just a control with the same output. The button row was replaced with a real `<input type="range">` / drag dial.
- Placement is part of the spec for an actively tuned control (the dial moved to the top of the page).
- "Recognize context like a search engine" means one box, with resolution logic server-side; never ask the user to pre-sort input. Backend takes a single `q`.
- Evidence must be independently checkable. Headlines are real links. The resolved ticker shows its live price/% change (`tickerQuote`). Comps come from real data.
- Don't gate a correctness-critical fallback behind a proxy heuristic (length, punctuation). Test the real condition: did the raw text resolve as typed.
- Verify a claimed anomaly against the real data before explaining it.
- In a fast-glance UI, use plain-English labels, with the precise term behind `(?)`. Factors: Surprise, Uncertainty, Freshness, Ripple Effect, Swing Risk, Expected Move. A value the user only needs to classify should be a visual band gauge (3 bands + arrow, no digits), not a number.
- When the user already named the answer (companies typed in their own input), prefer it over a generic algorithm. Mentioned companies rank ahead of peer lookups.
- When the user names an existing UI element as the reference ("exactly like X"), stop designing and reuse it.
- **The thread through all of these:** don't stop at the first literally-correct implementation. Build toward the real-world metaphor and toward checkable evidence first.

**Current shape:**
- **Session Context card retired on all tiers; Agitator takes its slot** (after Pulse, before Import). "Analyze All" lives in the Import card. `marketContext` is always sent as `''` (the normal blank case). Backend Session-Context paths (Proposal 4 corroboration, `highlightContextMatches()`, `refreshNewsHighlights()`) are untouched; `wireContextHighlight()` was deleted. On Pro the Agitator card moved above `#roloIndex`; `snapCardUnderDock()` adapts automatically.
- **Free has the Agitator:** `TIERS.free.agitator = true`. `isFull = !!req.tierConfig?.tracker` gives Free/Starter the simple LOW/MEDIUM/HIGH gauge; Pro/Shark get the SIGNALS breakdown.
- **"+" add buttons:** `addKnownTicker(symbol)` in `shared/watchlist.ts` adds an already-resolved ticker, skipping parsing/lookup, with the same cap-eviction `confirm()`. An already-present ticker shows a disabled checkmark. Test gotcha: Free's 3-ticker cap is already full with defaults, so handle the dialog: `page.on('dialog', d => d.accept())`.
- **RELATED source order:** companies named in the user's own input (re-scanned via `extractCompanyCandidates()`), then the generic Finnhub peer fallback. Comps get their own fundamentals + relevance-filtered news.
- **RELATED rows** (`relatedRowHTML`) reuse Pro's Watchlist-overflow `.compact-row-wrap` / `.compact-row` / `.compact-plus-btn` markup on all tiers, with news via `newsHref()`. The old `.comp-chip*` CSS was removed.
- **Comp validation:** Title-Case headlines made common words into candidates that fuzzy-matched junk tickers (GDVM, PRDL). `computeAgitatorComps` pulls a pool of 6, displays 3, and keeps only candidates with a real positive live quote (validate the real condition, don't add stopwords). The mention-scan stops after N scanned, not N found.
- **Relevance:** `isHeadlineRelevant(headline, symbol, companyName)` (ticker or first word of the legal-suffix-stripped company name). `fetchFinnhubNews` / `fetchAlpacaNews` use `find(relevant) || articles[0]` (fallback unchanged). The plain `/ticker` card news passes no `companyName`, so it is unaffected.
- **Rating caption:** `X/10 avg. of 6 signals`. The `(?)` sits on the LOW/MEDIUM/HIGH rating, not the ticker. The query box has a clear (X) button and Enter-to-submit.
- **Help balloons** (`initHelpBalloons`): the close timer is `Math.ceil(lines / 4) * 5000`, measured from the real rendered line-height.
- **Brand names:** `KNOWN_BRAND_TICKER_OVERRIDES`, checked before Finnhub (google/alphabet/youtube → GOOGL; facebook/instagram/whatsapp → META). Finnhub matches legal names, not brands. Same pattern as the DRAM CIK override: a small guaranteed map for reported cases. Keep it narrow. Fixes Import and the Agitator alike (shared resolver).
- **`fetchQuote()` extended hours:** during `isExtendedHoursWindow()` it substitutes `fetchExtendedHoursPrice()` (Alpaca IEX), falling back to Finnhub. Skipped for BTC/crypto. It previously showed post-close moves as flat.
- **Flat color:** `direction:"flat"` (inside ±0.5%) renders `var(--amber)`, not `--ink-dim`, which means no data (6 call sites across tiers).

**Aggression Dial (Starter 3 positions, Pro 5):**
- Real pointer-drag (`wireDialDrag()` / `dialPosFromClientX()`), snapping live. `#dial-track` is re-queried on every call, because `setDialPosition()` re-renders `dial-body`. `touch-action:none` on the track and thumb.
- Active state is amber (`--amber` / `--amber-dim`) with a glowing thumb.
- Display labels: Aggressive, Light Aggressive, CRF Default, Light Passive, Passive (Starter's narrow range: the middle three). Detail rows read "CRF default". The dial's `(?)` help text uses the same on-screen words.
- **Only display labels changed.** Keys (`ACTIVE_SWING`, `POSITION_LONG`, `NEUTRAL`, ...) are wire values matched against `Tra`'s `DIAL_POSITIONS` (`sizingCeiling`) and stored in `tv_dial_position`. Don't rename them.

## Backend: Pre-Gate soft-trigger escalation over-counted since it shipped (Aug 27, 2026, `Tra` #71 / `trade-verdict` #247)

TWST escalated to HARD from "repeated soft triggers" with no real issue. Supabase showed 68 rows for 8 real filings: `logPreGateTrigger()` had no dedup, and the same in-window filing was re-inserted on every 24h re-check. This was systemic (IMVT 15 rows for 1 filing; KMI 29 for 4; SMMT 20 for 3; ET 15 for 4). TWST's 4 distinct filings were also one offering's paperwork trail. Confirmed via `AskUserQuestion`: cluster them.
- `logPreGateTrigger()` skips the insert if `(ticker, category, filing_accession)` is already logged. Not race-proof (no unique constraint), but the read side tolerates a rare duplicate.
- `getRecentSoftTriggerCount()` counts time clusters via `countTriggerClusters()`. `PRE_GATE_CLUSTER_WINDOW_DAYS = 7`, chained. Escalation still needs `PRE_GATE_ESCALATION_COUNT = 2` clusters within 30 days.
- One-time cleanup: `pre_gate_triggers` deduped from 222 rows to 28.
- Verified against real timestamps for TWST/KMI/SMMT/ET (each is 1 cluster) plus boundary cases.
- **Open:** re-check TWST live; it should no longer be HARD.

## Backend: Gate 2 corroboration rebuilt after Session Context retirement (Aug 28, 2026, `trade-verdict` #249 / `Tra` #72)

Checking Proposal 7 (Verdict Accuracy Scorecard + Corroboration Decay
Indicator) confirmed the backend is real: `verdict_log`/`corroboration_log`
tables, a 30-min grading job (`runVerdictGradingSweep`), and tier-scoped
`/scorecard` (Free aggregate/Directional-only, Starter personal, Pro full
breakdown).

**The bug.** `corroboration_log` had zero rows ever. Its only write path
(`logCorroborationHits`) sat behind `if (marketContext && marketContext.trim()...)`,
and every tier has sent an empty `marketContext` since Session Context was
retired (Aug 26-27). The same gate also silently disabled Proposal 4's Gate 2
corroboration modifier, a real verdict input. Every `verdict_log` row had a
null `gate2_corroboration_state`. Nothing in the Session Context removal's own
testing exercised this downstream dependency.

**Fix.** Of the three corroboration sources, only the news-content match ever
needed user-typed text. Removed it and its dead support code
(`gx.contextTextMatches`, `fetchNewsBodiesForCorroboration`,
`stripHtmlForCorroboration`). Renamed `corroborateSessionContext` →
`computeGate2Corroboration` (gates-extended.ts; recompiled via
`tsc -p tsconfig.build.json`, re-checked with `require()`). It now runs on
every `/analyze` call using the two deterministic signals (Gate 3 buildup
pattern, real earnings-calendar event). Both must agree
(`CONTEXT_CORROBORATION_THRESHOLD=2`) to set the `GATE2-CORROBORATED`
modifier. The Gate 2 note tag (`GATE2-CORROBORATED, N/2`) is appended only
on a positive hit. SYSTEM_PROMPT Step 5 and the context line now say
"Gate 2 corroboration," not "Session Context."

Also added `gate2_corroboration_state` to `/scorecard`'s SELECT and breakdown
(Proposal 7's spec named it; it was written but never read).

Tests: 72/72 (3 dead `contextTextMatches` tests removed). **Not verified
live.** Confirm: real `corroboration_log` inserts in Render logs and non-null
`gate2_corroboration_state` in `verdict_log`.

## Backend/Frontend: Scorecard per-ticker breakdown, personal vs. pool (Aug 28, 2026, `trade-verdict` #251 / `Tra` #73) — later removed

The Proposal 7 spec named Starter's scope as "personalized to user's tickers."
Grading is objective, so a pooled cross-user stat per ticker is more
meaningful than a thin personal slice. Shipped `tickerAccuracy` (personal +
pooled) with `SCORECARD_TICKER_MIN_GRADED = 5`, not gated behind
`tierConfig.tracker`. Also wired the missing "BY GATE 2 CORROBORATION"
section on both tiers.

**Superseded Sep 2, 2026** (see the Verdict Scorecard rework below): the
`BY TICKER` section was removed and replaced by a pooled TRACK RECORD row on
each ticker card. `SCORECARD_TICKER_MIN_GRADED` stays as the floor.

Flagged as a future idea, not built: feeding pooled accuracy back into the
verdict pipeline (partly done later — see the same-direction accuracy ceiling
in a later section).

## Backend/Frontend: Agitator Gauge entity resolution and topical fallback (Aug 28 – Sep 2, 2026, `Tra` #74-#90 / `trade-verdict` #253-#278)

### The Jackson Hole saga (Aug 28-31, `Tra` #74-#78)

"Jackson Hole Economic Policy Symposium" (a Fed event, no company) resolved to
JXN (Jackson Financial). Three keyword-blocklist patches (`EVENT_NAME_MARKERS`)
each got bypassed by a new phrasing: Title Case, then lowercase (lowercase
never forms a capitalized "run," so it hits the initial raw
`searchSymbolByName(raw)` call directly), then a phrase with no marker word.
Finnhub's fuzzy search matches the full phrase, not just the single word.

Mr. T's direct instructions after the third bypass, now standing:
- **"Stop making repetitive changes of things I've asked you not to do. Going
  forward, tell what you plan to change before you change anything."**
- He rejected adding a second AI confirmation call: the resolver should be a
  search engine that decides "context" vs. "ticker," not another AI call.

Other fixes from these rounds that still apply:
- **Topical fallback (`Tra` #75).** When no company resolves, find the newest
  related article and distill one-sentence sentiment, show `---` for the
  symbol, and hyperlink the cited article. The model picks an article by
  **index** from a real fetched list, never writes its own headline/URL, so a
  citation can't be hallucinated. `fetchGeneralNews()` (Finnhub
  `/news?category=general` + Alpaca `/v1beta1/news`, no symbol filter),
  `generalNewsCache` (5 min), `macroTopicCache` (15 min, normalized query).
  Also fixed a latent bug in this repo's mirror: `fetchWeekOwnRange()` called
  `alpacaKeys()`, which only exists in `Tra`.
- **Never cache a miss (`Tra` #76).** `macroTopicCache` is server-global and
  keyed only by query, so a cached null replayed to every tier for 15 min.
  Only a real, validated match is cached. Every null branch now logs its cause
  (no API key, zero articles, non-ok Anthropic, unparseable, invalid).
- **Always commit to an article (`Tra` #78).** The prompt's "index -1 =
  none" decline option was removed. The plain "Couldn't find a company" text
  now appears only on a real failure (no articles, no key, Anthropic error).

Lesson (Aug 31): when a fix can't be verified against the live dependency it
targets, treat the first contradicting live report as real evidence. Re-check
every code path the input can take, not just the one a synthetic fixture used.

### Rebuild from the Notion plan (Sep 1, `Tra` #79 / `trade-verdict` #263, #264)

Built from Notion "Proposal 5 — Amendment: Entity Resolution, News Caching,
Options Data Gap, Topical Fallback." Clarified decisions:
1. The "Did you mean" Yes/Cancel uses data already in hand (Finnhub's matched
   name); no new search. Path B renders alongside it regardless.
2. The known-ticker shortcut is a backend optimization for every tier
   (including anonymous Free, via a client-sent `watchlist` param); UI stays
   tier-diluted.
3. `news_cache` wires into every per-ticker news fetch, not just Agitator.
4. Overriding the Notion doc: **"the user should see a score either way and
   Pro should see that breakdown."**

What shipped:
- **`classifyEntityMatch(query, canonicalName)`** — strips legal suffixes
  (`stripLegalSuffix`) and returns `exact` / `partial` (all query words in the
  name, name has more) / `none` (the query has a word the name lacks).
  `EVENT_NAME_MARKERS`/`containsEventNameMarker` were removed.
  `resolveCompanyEntity()` (renamed from `searchSymbolByName`) takes the first
  Finnhub hit that isn't `none`. `partial` is never auto-accepted; it only
  produces a `suggestion: {company, ticker}`.
- **`resolveKnownTicker()`** skips Finnhub `/search` for symbols on
  `SYSTEM_TRACKED_SYMBOLS` or the caller's watchlist (plus a signed-in user's
  saved watchlist). Name matching only uses the existing 24h fundamentals cache
  (read-only peek).
- **Frontend (all three tiers):** "Did you mean X (TICKER)? [Yes] [Cancel]"
  banner above the Path B card. Yes re-runs with the ticker; Cancel removes the
  banner.
- **`news_cache` table** (`supabase-ddl-patch11-news-cache.sql`):
  `last_checked_at` updates on every check, `published_at` only on a new URL
  (so the Decay Indicator doesn't read a re-check as fresh). Wired into
  `fetchNews()`: live fetch first, cache only on an empty result. A new cached
  article also writes `corroboration_log` with `source: 'finnhub_secondary'`
  (CHECK constraint widened). RLS disabled + revoked, grants verified.
- **`fetchOptionsSnapshot()`** (Alpaca `/snapshots`, average IV across the
  chain) feeds `ivEnvironment` ahead of `fetchImpliedVolatility()`. The latter
  stays as fallback and as Pro/Shark's CSV-export source. Agitator-scoped
  only. Positioning stays AI-judged. **Unverified against live Alpaca options
  entitlement.**
- **`computeHistoricalReaction()`** pools `verdict_log` per ticker across all
  users, `null` below `SCORECARD_TICKER_MIN_GRADED`. Replaces the old "not
  tracked yet" placeholder.
- **Path B always scores.** `computeTopicalFallback()` (renamed from
  `computeMacroTopicalSentiment`) corroborates with real news first (no AI call
  if none). One AI call returns the article index, sentiment, 0-5 company
  names, and surprise/uncertainty/freshness scores. Every company name is
  re-validated through `classifyEntityMatch`. `computeReactionSincePublish()`
  (Alpaca dated bars) gives each company's move since publish.
  `computeTopicalFactors()` builds Ripple Effect/Swing Risk/Expected Move
  deterministically from those moves; composite via
  `computeAgitatorComposite()`. Sub-factor breakdown gated by `isFull`
  (`tierConfig.tracker`). A pure-macro query with zero companies still gets a
  real composite score.
- Mirror note: this repo's `alpacaGet(url)` takes a full URL and returns a raw
  `Response` (vs. `Tra`'s path-only, pre-parsed JSON) — adapted, not copied.

Follow-up (#264): RELATED and the headline line always render a row (real
content, or "No related companies found." / "No recent related news found.")
instead of vanishing. The "Past Reactions" row was hardcoded "not tracked yet"
in every frontend; now wired to real `historicalReaction`.

### Path B reads article bodies and gets keyword search (Sep 1, `Tra` #80-#81 / `trade-verdict` #266, #268)

- **#80:** `fetchGeneralNews()` now captures `summary`/`content`;
  `computeTopicalFallback()` sends a 300-char excerpt per headline so
  companies named only in the body can be extracted.
- **#81, Marketaux.** Finnhub `/news` is category-only and Alpaca news is
  symbol-only; neither supports keyword search, so a hot story can be missing
  from the pool. Mr. T chose Marketaux (he already had an account). Key is
  the Render env var `MARKETAUX_API_KEY` on `Tra` (never pasted in chat).
  `fetchMarketauxNews(query)` hits `/v1/news/all?search=`; results are merged
  ahead of the generic pool and deduped by URL. Marketaux's own tagged entities
  are trusted directly; AI-extracted names still go through
  `classifyEntityMatch`. Combined companies capped at 5. Daily budget guard
  `MARKETAUX_DAILY_LIMIT = 90` (UTC day; free tier ~100/day). Missing key,
  error, or exhausted budget all fail safe to the old behavior.
  **Unverified against a live response** — field names
  (`title`/`description`/`entities[].symbol`/`entities[].sentiment_score`)
  are triangulated from docs. Check Render logs for `fetchMarketauxNews`
  errors.

### QNX/BlackBerry and wiring in the Knowledge Graph (Sep 1-2, `Tra` #85-#90 / `trade-verdict` #273-#278)

"Qnx automotive iot" didn't resolve.
- **#85:** `extractCompanyCandidates()`'s punctuation strip also dropped
  digits ("G20" → "G"); digit-bearing tokens now break a run.
- **#86:** `resolveViaMarketaux(query)` resolves a query from an article's
  first tagged entity, plus a `qnx: "BB"` entry in
  `KNOWN_BRAND_TICKER_OVERRIDES` as a fast path.
- **#87 — the real fix.** Mr. T: "what happened to the table logic that we
  built?" The Neo4j Knowledge Graph was built for exactly this (Agitator
  RELATED companies) but was never wired into `/agitator` and only had the
  TSMC demo cluster. `fetchGraphPeers()` reads
  `kg.getCompanyRelationships()`. Added a researched BlackBerry/automotive
  cluster to `neo4j-seed.js`: BB, APTV, Wind River (private, `ticker:null`),
  F, QCOM, with `competes_with`/`supplies`/`subsidiary_of` edges.
- **#88:** RELATED priority chain in `computeAgitatorComps()`: **literal
  mentions in the user's text > Knowledge Graph (curated) > Marketaux > generic
  Finnhub peers.** Marketaux entities stay in a separate `marketauxMentioned`
  array so they never outrank a curated edge.
- **#90:** setting `headlineOverride = raw` as a fallback also skipped the real
  `fetchNews(symbol, companyName)` call. `headlineOverride` now only means an
  explicit client `headline` param; echoing the raw text is a true last resort
  after `fetchNews()` comes back empty.

Lesson: before building a narrower patch, check whether infrastructure built
for that class of problem is actually wired in and populated.

### Smaller Agitator resolution rules still in effect (Aug 27-28)

- `KNOWN_BRAND_TICKER_OVERRIDES` (checked first in the resolver):
  `google`/`alphabet`/`youtube` → GOOGL, `facebook`/`instagram`/`whatsapp`
  → META, `qnx` → BB. Finnhub `/search` matches legal names, not brands.
- `extractCompanyCandidates()` still decomposes multi-word runs into single
  words (needed for "Nvidia Reports Record Quarter," "Tesla Q").

## Ops: Neo4j seeding against live Aura (Sep 2, 2026)

This sandbox never has the Neo4j credentials. **Technique:** a temporary
Render Cron Job on the `Tra` repo (`build: npm install`, `start: node
neo4j-seed.js`), scheduled for Feb 31 so it never auto-fires, triggered
manually. Cron jobs don't inherit env vars, so Mr. T adds
`NEO4J_URI`/`NEO4J_USERNAME`/`NEO4J_PASSWORD` to that job's own Environment
tab. No free tier for cron jobs (`starter` plan, a real small charge — confirm
with Mr. T first). The Render MCP has no delete tool; delete the job by hand
in the dashboard afterward. Render's API never returns existing secret values.

Live result: schema ensured, 12 companies and 10 relationships upserted, both
round-trip checks passed (TSM 6, BB 3). First confirmed live Neo4j write.

**`RELATED_TO` facts (supply chain/competitors) only grow when someone
researches them, adds them to `neo4j-seed.js`, and runs the seed live as
above.** Nothing discovers them from traffic. The correlation/classification
half (next section) grows automatically.

## Backend: Neo4j Phase 1.5 — correlation/classification graph (Sep 2, 2026, `Tra` #89 / `trade-verdict` #277)

Scoped: wire the graph into data already being computed; deterministic
classification, no new AI call.

`neo4j-graph.js`:
- `Sector` node (`sector_id` unique) using the existing `PROXY_RULES`/
  `DEFAULT_PROXY` category strings.
- `upsertClassification(ticker, sectorId, {tier})` — `CLASSIFIED_AS` edge,
  tier from `resolveGate5`'s vocabulary.
- `upsertCorrelation(fromTicker, toTicker, {coefficient, tier, source})` —
  undirected `CORRELATES_WITH` (`MERGE (a)-[r]-(b)`).
- `getComparableTickers(ticker)` — `*1..2` traversal over both edge types.
- Both upserts lazily create a stand-in `Company` node (`company_id = ticker`)
  that a later `upsertCompany()` fills in.

`server.js`, fire-and-forget and fail-safe:
- `resolveGate5`'s static branch → `syncClassificationToGraph(...)`, deduped
  per process with a `Set`.
- `resolveGate5`'s dynamic branch and `resolveProxyRegime` →
  `syncCorrelationToGraph(...)`, not deduped (already rare).
- `fetchGraphPeers()` merges `kg.getComparableTickers()` behind curated
  `RELATED_TO` peers.

The schema uses only Community/Free-tier features (no APOC/GDS/multi-db).

## Frontend/Backend: Verdict Scorecard rework — pooled TRACK RECORD on the ticker card (Sep 2, 2026, same `Tra` #89 / `trade-verdict` #277)

Mr. T: per-ticker rows don't belong in the Scorecard; show pooled accuracy for
that one ticker on its own card, on every tier.

- `/scorecard`'s whole per-ticker block (personal/pool/graph-peers) was
  deleted from the backend and from `renderScorecardCard()` on Pro and
  Starter.
- `computeHistoricalReaction(symbol)` now returns
  `{ directionalPct, gradedCount }` (Agitator reads `.directionalPct`). It is
  relayed through `refreshMarketEntry`/`symbolMarketCache`/`/ticker/:symbol`,
  with a 1h `historicalReactionCache`. No sign-in or tier gate.
- New `TRACK RECORD 65% (12 graded)` row at the bottom of `gateListHTML()`
  after CONFIDENCE, all three tiers, omitted below 5 graded. First
  track-record signal on Free.
- Card subtitles shortened after pixel measurement (help-button addition had
  shrunk the space): "Coherence per ticker," "Sectors + your watchlist,"
  "Log & track accuracy," "Auto-graded accuracy."
- `gate0Status` still defaults to GREEN for enforcement, but the logged
  `gate0_read` now uses `gate0Reported` (raw client value, or `"UNKNOWN"`), so
  real calm and missing data are distinguishable.

**Playwright lesson:** `page.route()` matches LIFO. Register a broad
catch-all first and specific routes after, or the catch-all swallows
everything. Use `page.mouse.click()` at real coordinates for pill taps.

## Agitator Gauge — commodity/spot-price path and the standing "every path" rule (Sep 5, 2026, `Tra` #93-#101 / `trade-verdict` #290-#305)

**Standing rule, permanent — do not make Mr. T re-state it.** Every query
typed into the Agitator, with no exceptions for query type, must produce:
1. at least one real, cited news article;
2. 2-3 related recommendations;
3. a composite signal score (Pro/Shark also see the full per-factor SIGNALS
   breakdown).

This applies uniformly to all three result shapes: **Path A** (resolved
company/ticker), **Path B** (no-company topical fallback), and **Path C**
(commodity/currency spot code). None is a lesser case. A change that leaves
any path without all three is a regression, not a design choice. Mirror fixes
across all three paths.

Current commodity path:
- `resolveCommodityCode()`/`COMMODITY_ALIASES` match the **entire** trimmed,
  lowercased query (`xau`/`gold`, `xag`/`silver`, plus oil, natural gas,
  copper, platinum, palladium). Never a substring, so "gas prices surge" still
  goes through normal resolution.
- **Gold:** real spot from goldprice.dev via `fetchCommodityPrice()`, env var
  `GOLDPRICE_API_KEY` (`Authorization: Bearer`). The docs' "no key needed"
  claim was false (403). Real response shape is
  `{"symbols":[{"symbol":"XAU","price":"4429.83",...}]}` with **string**
  values; read `data.symbols[0].price` (fallback bid/ask average),
  `Number()`-coerced. Confirmed live.
- **Silver:** goldprice.dev's free plan is XAU-only (paid Pro needed for
  silver/copper; it has no platinum/palladium on any tier). Mr. T chose a
  different free source: `fetchSilverSpotFallback()` via keyless
  gold-api.com. **Unverified against a live response** (sandbox blocked);
  it logs the raw body on any shape mismatch. Check Render logs for
  `fetchSilverSpotFallback resolved $X` or `unexpected response shape`.
- **Oil, natural gas, copper, platinum, palladium:** proxy-only, no free real
  spot vendor exists. Tradable ETF proxies via `fetchQuote()`: USO, UNG, CPER,
  PPLT, PALL. Gold/silver fall back to GLD/SLV if spot fails.
- `COMMODITY_RELATED_FALLBACK` (own proxy excluded): gold → GDX/NEM/SLV,
  silver → SIL/PAAS/GLD, oil → XOM/CVX/OXY, natural gas → LNG/EQT/RRC,
  copper → FCX/SCCO/COPX, platinum → SBSW/PLG/GLD, palladium → SBSW/PLG/SLV.
- The commodity response reuses `computeTopicalFallback(commodityEntry.name, new Set())`
  for a real article and companies, and passes through `composite` (all tiers)
  and `factors` (Pro/Shark, `tierConfig.tracker`). Frontend reuses
  `agitatorFactorRow()`/`relatedRowHTML()`/`addTickerBtnHTML()` and is fully
  generic off the response fields.
- **Gauge ticker slot:** shows the tradable proxy as a hyperlink on the
  commodity path. On Path B it shows the first validated company's ticker
  whenever `topical.companies` is non-empty, `---` only when nothing tradable
  correlates. Mr. T: "any tradable correlation should be in the spot." The
  "not a company, so no Gate breakdown..." disclaimer clause was removed.

**Lesson:** a `return null` on a shape mismatch with no log cost two full
"check the logs" rounds. Always log the raw truncated body on a mismatch.
Also: a proxy substituting for the real answer isn't the same as pursuing the
real answer; Mr. T rejected the GLD/SLV stand-in.

**Not verified live:** the news/recommendations/score extension on the
commodity path. Confirm by typing "xau," "oil," or "copper" on a live Pro
account.

## Frontend: sticky controls rows in utility cards (Sep 5, 2026, `trade-verdict` #307, #309)

- `.ctx-hint` ("Sorted by % change") had no CSS rule at all. It is now 13px,
  matching that card's own `.card-sub` and `.sort-btn`. **Lesson:** measure
  the surrounding elements in that specific card before applying the generic
  11px secondary-text rule.
- Controls rows are `position:sticky; top:0; background:var(--surface)`:
  Watchlist `.wl-overflow-hdr`, Pro's Proxy Explorer `.proxy-sort-row`, and
  Glossary `.glossary-search-wrap` (all tiers). Use `--surface` (the card's
  background), not `--bg` (page background) — `--bg` painted a black band.
  Use `padding-bottom`, not `margin-bottom`, so the painted background covers
  the gap. Heat Map and Track Record need no sticky row.
- The Watchlist card has no search feature; a ticker filter would be a new
  request.

## Frontend: landscape HUD and wide-screen scaling (Sep 5-7, 2026, `trade-verdict` #311-#321, #331)

The landscape HUD is the ribbon + pane layout in `shared/rolodex.ts`. Current
behavior and the lessons behind it:

- **Independent scrolling (#311).** `sizeLandscapeHud()` computes available
  height (same `dockOffsetFor()` math as portrait) and sets a real `height` on
  `.landscape-hud` itself (not `max-height`, not on the pane). Both children
  are `overflow-y:auto`. Called from `activateLandscape()`, the resize
  listener, and `snapLandscapeHudUnderDock()`. `deactivateLandscape()` resets
  it. `LANDSCAPE_HUD_BOTTOM_MARGIN = 4`. Lesson: capping one flex child
  doesn't bound the container; the ancestor chain must be height-constrained.
- **Stale portrait caps (#313).** `recapExpandedCards()` returns immediately
  while `isLandscapeMode()`. `activateLandscape()` clears any inline
  `max-height` on a card's `.card-body-pad` when moving it into the pane.
- **Rotate from an open portrait card (#319).** `activateLandscape()` falls
  back to whichever card has `.expanded` when `lsActiveCard` is unset.
- **Ribbon taps (#313, #317, #319).** `selectLandscapeCard()` calls
  `btn.scrollIntoView({behavior:'smooth', block:'start'})` so the tapped
  item moves to the top and reveals what follows, and resets
  `lsEls.pane.scrollTop = 0`.
- **Sticky rows in landscape (#319).** `.card`, `.card-body-inner`, and
  `.card-body-pad` each have their own `overflow` in portrait. Any non-
  `visible` ancestor becomes a sticky containing block, so in landscape all
  three are set to `overflow:visible` (safe: radius reset, no accordion trick,
  no JS cap there). Control rows are padded tighter in landscape. Lesson:
  walk the real computed ancestor chain; it took three tries to find all three.
- **Horizontal bleed (#331).** Making those ancestors
  `overflow:visible` removed horizontal clipping. Fixes: `.utility-pane` has
  `overflow-x:hidden` in landscape; `.compact-row-top` has
  `flex-wrap:wrap; row-gap:2px; min-width:0` globally, so wide content wraps
  inside the row.
- **Dividers (#317).** New `--border-3` token (32% white) on the ribbon/pane
  border, ribbon buttons, Proxy Explorer items, Glossary terms/categories,
  Agitator SIGNALS rows, and Track Record log rows.
- **Wide-screen zoom (#315).** Mr. T wanted a real uniform zoom, not a
  reflow. `updateResponsiveScale()` (`APP_SCALE_REFERENCE_WIDTH = 960`)
  applies `transform:scale()` to `.app-shell` in landscape wider than 960px
  and sets its height to `viewport height / scale`, so it fills both
  dimensions. A no-op in portrait or ≤960px. It runs first in the resize
  listener and before activate/deactivate on orientation change.
  `currentAppScale()` mirrors its condition; every `getBoundingClientRect()`
  height combined with virtual-unit values (`dockOffsetFor`,
  `listHeadHeight`, `currentGateFullHeight`, `capCardBodyHeight`,
  `capRoloCardHeight`, `forceGateDockedSync`, `recapExpandedCards`) is divided
  by it.
- **Snap under the dock (#321).** `scrollIntoView()` miscomputes under an
  ancestor `transform:scale()`. `scrollToUnderDock(el, dockOffset)` computes
  the virtual position and calls `scroller.scrollTo()` directly; used by
  `snapLandscapeHudUnderDock()` and `scrollToActiveCard()`.
  `snapFirstCardUnderGateDock()` (portrait Sector-Pulse soft-snap) now returns
  early in landscape; it had been moving `scrollTop` ~200ms after every
  landscape snap. Lesson: when a fix only shrinks a gap, measure the actual
  inputs in effect; a second mechanism may be interfering.

**Release lesson (#315):** after restarting a branch from `origin/main`,
check the rebuilt bundle's diff shape against `origin/main` before
committing. A stale source copy can compile and pass every check while
silently reverting merged work.

**Testing lesson (#319):** before interacting in a headless check, confirm the
element's real rect is inside the viewport.

**Not verified on a real tablet/Chromebook** — check touch targets at real
finger scale.

## Backend: MCP-over-HTTP server + OAuth connector (Sep 7, 2026, `Tra` #103-#108)

All Claude-driven surfaces (this sandbox, Cowork) are blocked from reaching
`tradetribunal.app`/`tra-zacg.onrender.com`, but MCP connectors route around
that block. So `Tra` now hosts its own MCP server.

- **`mcp-server.js`** — Streamable HTTP MCP (`@modelcontextprotocol/sdk`) on
  Tra's Express app. Tools: `get_market`, `get_ticker`, `check_agitator`
  (free, read-only, internal loopback to real endpoints), and `analyze`
  (spends credits). `/mcp` is behind the normal auth middleware.
  `mountMcpAt()` mounts it at both `/mcp` and `/mcp2`.
- **`analyze` credentials:** env var `MCP_AGENT_KEY` resolves to a fixed pro
  tier (auth PATH 1.5) with its own credits key `mcp:agent` (never `PRO_KEY`,
  never a customer's balance). Provisioned with `tier: pro`,
  `purchased_credits: 100`. The request body is built server-side from
  `/market` + `/ticker/:symbol`, mirroring `starter/app.ts`'s `analyzeOne()`.
- **`oauth-server.js`** — single-owner OAuth 2.1 shim: RFC 8414/9728 metadata
  (including `/.well-known/oauth-protected-resource/mcp2`), RFC 7591 dynamic
  registration, authorization code + mandatory PKCE. `/authorize` requires
  typing the real `MCP_AGENT_KEY` into a form before issuing a code; `/token`
  then mints a revocable access token accepted as `Authorization: Bearer`.
  Logs every branch of `/register`/`/authorize`/`/token`.
- `callerCredentialFrom()` forwards the Bearer header to tools' inner calls
  (#107; tools 401'd before).
- **Durable state (#108):** `public.mcp_oauth_state`, one row per
  `(store, key)` across the four Maps. Write-through (memory first, then
  Supabase); `hydrateAll()` at boot reloads non-expired rows. RLS disabled +
  revoked, grants verified. Falls back to memory-only without Supabase.
- Why `/mcp2`: an old connector entry at `/mcp` had the literal string
  `MCP_AGENT_KEY` stuck as its client_id and couldn't be edited or deleted,
  and claude.ai allows one connector per URL.
- Confirmed live: a real `get_market` call from chat returned production data.
- `mcp-server.js`/`oauth-server.js` are `Tra`-only transport plumbing and are
  deliberately not mirrored here.

**Standing trading-safety rule (agreed via `AskUserQuestion` before
building): propose only.** Claude reads a Trade Tribunal verdict via the
`analyze` tool and may propose a specific trade (ticker, direction, size) for
Robinhood, but will never call Robinhood's `place_equity_order`/
`place_option_order`/etc. off that verdict without the user explicitly
confirming that exact trade first. No autonomous execution, no pre-set
risk-budget autonomy tier — full manual confirmation on every single trade.
This is a behavioral commitment, not enforced in code.

**How a future session uses it:**
1. The `Trade Tribunal` connector lives at account level (claude.ai →
   Settings → Connectors), URL `https://tra-zacg.onrender.com/mcp2`,
   "Requires sign-in" on. Any new chat in the account sees
   `mcp__Trade_Tribunal__get_market`/`get_ticker`/`check_agitator`/`analyze`.
2. Call `analyze(ticker)`, cross-check with the Robinhood connector's quotes/
   portfolio/positions, **propose** a trade, and wait for explicit
   confirmation before any order tool.
3. Not yet tested from inside a Cowork session specifically (inferred to work).
4. Re-authorization (after the 30-day access / 180-day refresh token
   lifetimes, or if `MCP_AGENT_KEY` is rotated): enter the current
   `MCP_AGENT_KEY` on the `/authorize` form. A deploy no longer forces this.
   If a stuck connector's cached key never matches, regenerate
   `MCP_AGENT_KEY` and re-enter it fresh.

**Open:** the full "verdict → propose → confirm → place" loop hasn't been run
for real. Mr. T planned a market-open "opening drive" check; nothing was
scheduled.

## Backend + Frontend: US market holiday awareness (Sep 7, 2026, `Tra` #109 / `trade-verdict` #333, #335)

`isMarketOpen()` (backend) and the client-side `isMarketClosed()` both only
checked weekday and time of day. Confirmed live: `marketOpen: true` on Labor
Day 2026.

- **Backend (`server.js`, both repos):** `MARKET_HOLIDAYS` (full-day
  closures, `YYYY-MM-DD` ET) and `MARKET_EARLY_CLOSE_DAYS` (1:00pm ET: day
  after Thanksgiving, Christmas Eve) for 2026 and 2027, checked via
  `etDateStr()`. A year with no data falls back to weekday/time rules.
- **Frontend:** the Gate's OPEN/CLOSED label and the market-closed → force
  HOLD behavior use the client `isMarketClosed()`, never
  `market.marketOpen`. It's deliberately tier-owned, so the same holiday data
  is copied into six places: `app.ts` + `app.js` (Free), `starter/app.ts` +
  `starter/app.js`, `pro/app.ts` + `pro/app.js`, `shark/index.html` (inline),
  and `preview/rolodex/app.js`.

**Needs a manual update for 2028+ in the backend `server.js` (both repos) AND
every client `isMarketClosed()` copy listed above.** Re-derive from NYSE's
published schedule (nyse.com/trade/hours-calendars) and cross-check,
especially Good Friday (depends on Easter). A web-search summary once
hallucinated 2027's Good Friday as April 16; the real date is March 26, 2027.

Lessons: a hand calculation with a checkable ground truth must be
cross-checked. Confirming a backend field is correct isn't confirming the UI
reads it — trace the actual render path. A discriminating test (run against
the pre-fix bundle, see it fail) beats a test that only passes once.

**Not verified live** on a real holiday; check the Gate label on the next one
(or with a devtools clock override).

## Backend: proxy-fit correlation check for every static category, BDC/REIT sizing cap, regime prewarm (Sep 13, 2026, `Tra` #111 / `trade-verdict` #339)

Data behind it (pooled `verdict_log`, 360 graded): UP calls were 34.4% right (n=61) vs DOWN 65.5%. All 40 failed UP calls were "clean" (Pre-Gate and Gate 0 GREEN), riding the model's own confidence with no server check. ALAB, ARCC, STWD, NU made up 41 of 61 UP calls at 24.4%; ALAB was 0/8.

Root cause: `resolveProxyRegime()` only ran for Taiwan/Korea semis (`isFixedTaiwanKorea`). Every other static category got a proxy with no correlation check ever. And "INTACT" only means "not worse than its own baseline", never "strong enough to trust" (ALAB: rolling_r 0.49, baseline 0.66 vs TSM). ARCC's proxy (IWM+SPY) was correct; BDCs/REITs just rarely move enough. That's a category trait, not a wiring bug.

Mr. T's constraint: fix the mechanism, not the tickers ("point at the problem, not the symptoms"). So no NU-specific reclassification, and `resolveGate5`'s BROKEN-regime dynamic fallback stays AI/Semiconductor-only.

Shipped:
1. `resolveProxyRegime()` now runs for any ticker with a static classification (`staticRule !== DEFAULT_PROXY`). It takes a `proxySymbol` (the rule's first proxy symbol; multi-symbol proxies like "USO + GLD" use the first only). `proxy_regime_state` gained `proxy_symbol` (patch12), so a reclassified ticker can't reuse a correlation computed against the old proxy. NULL rows self-heal on next check.
2. `ah.applyProxyFitCeiling()` runs once in `/analyze` after every confidence-setting branch, including clean verdicts. Below `PROXY_FIT_FLOOR` (0.5), HIGH → MEDIUM. MEDIUM/LOW are never touched. It's deliberately not inside `priceConfirmedConfidence()`, which only runs on override branches and can't reach clean verdicts.
3. `BDC/REIT/Income` gets `sizingOverride: "QUARTER"` on its `PROXY_RULES` entry (same check Patch 2's fundamentals-speculative tier uses). It applies at classification time, so new and keyword-matched tickers are covered on day one.
4. `runRegimePrewarmSweep()`: a daily in-process `setInterval` that warms the regime cache for every ticker named in `gx.PROXY_RULES`. A standalone service was considered and rejected (the check is already cheap and weekly-cached).
5. `classifyTicker()`/`PROXY_RULES`/`DEFAULT_PROXY` moved from `server.js` into `gates-extended.ts` unchanged, so the sweep can read the real list. `server.js` keeps local aliases (`const PROXY_RULES = gx.PROXY_RULES`, etc.).

Tests: 13 new cases (incl. the real ALAB 0.49 → MEDIUM and the floor boundary).
**Not verified live.** To confirm: ALAB caps at MEDIUM on a clean UP; ARCC/STWD never exceed QUARTER; Render logs show `runRegimePrewarmSweep` daily; `proxy_regime_state` fills with `proxy_symbol` rows beyond AI/Semiconductor.

## Backend/Frontend: Candidate Probation for replacement proxies (Sep 13, 2026)

Mr. T: when a proxy breaks, the replacement is a "search for new" placeholder that must earn sustainable correlation. `resolveFixedProxyBreak()` (Patch 2, unchanged) already finds a replacement. The gap was that a fresh `'primary'` find got forceDown authority off one snapshot.

Checked first: dynamic-path forceDown authority comes only from `rule.forceDownAuthority` in `buildDynamicProxyRule()`. It is independent of the static `FORCEDOWN_EXEMPT`/`TAIWAN_PROXY`/`GATE_5_KOREA` registry, so probation only touches the dynamic path.

Implementation (`server.js`, both repos; reuses `proxy_resolution`):
- `PROXY_CANDIDATE_REQUIRED_CONFIRMS = 2`: consecutive checks the same symbol must clear the primary floor before promotion.
- `GATE5_CANDIDATE_RECHECK_MAX_AGE_MS = 7 days` while on probation, vs `GATE5_RECOMPUTE_MAX_AGE_MS` (90 days) once promoted. `getCachedProxyResolution()` picks via `proxyCandidatePromoted(data.candidate_confirms)`.
- `proxy_resolution` gained `candidate_confirms integer not null default 0` and `candidate_since timestamptz` (`supabase-ddl-patch13-proxy-candidate-probation.sql`; grants checked clean).
- `saveProxyResolution()` reads the prior row and sets the streak: same symbol at `'primary'` → +1; a different symbol → 1; below the primary floor → 0 (a later re-clear restarts at 1). It returns `{candidateConfirms, candidateSince}`.
- `buildDynamicProxyRule(resolved, candidateConfirms)`: an unpromoted `'primary'` reports tier `"candidate"`, with `forceDownAuthority: false` and `sizingOverride: "QUARTER"`. Both `resolveGate5()` call sites pass the streak.
- Pro frontend: `tierColor` maps get `candidate: 'var(--purple)'`; `TIER_RANK` puts candidate at 1, between primary and secondary.

**Not verified live.** To confirm: force a regime-BROKEN recompute on a non-AI/Semi ticker. It should show as `"candidate"` (purple, no forceDown, QUARTER), then promote to `"primary"` after a second same-symbol weekly confirm.

## Ops: Neo4j moved from a paused Aura Professional trial to Aura Free (Sep 14, 2026)

Tra's Neo4j sync failed silently from roughly Sep 7 to Sep 13 (`Could not perform discovery. No routing servers available`, empty routing table). The trial instance (`c5605db2`) had been paused.

Lesson: **there is no Neo4j MCP connector in this environment.** All Neo4j health info comes indirectly from Tra's Render logs. Say a cause is unconfirmed until someone checks the Aura console.

The schema is Free-tier compatible (no APOC/GDS/multi-db/vector indexes; audited), so the move was a credential swap with zero code changes:
- New AuraDB Free instance; `NEO4J_URI`/`NEO4J_USERNAME`/`NEO4J_PASSWORD` set by Mr. T on Tra's Render Environment tab (never in chat). `Neo4j schema: ok` confirmed in logs.
- Reseeded with the one-off Render Cron Job technique: `node neo4j-seed.js`, scheduled Feb 31 so it never auto-fires, its own env vars (cron jobs don't inherit them). Triggered once: 12 companies, 10 relationships, both round-trip checks OK. The cron job was deleted by hand — the Render MCP has no delete tool.

Open, not urgent: delete the old paused instance `c5605db2` in the Aura console. To confirm health: `syncClassificationToGraph`/`syncCorrelationToGraph` only log on failure, so silence is good.

## Backend: same-direction historical-accuracy confidence ceiling (Sep 14, 2026)

Pooled grading now feeds the verdict, not just displays. Scoped with Mr. T: confidence cap only, one step HIGH → MEDIUM. **Not** a sizing cap and **not** forced FLAT — forcing FLAT is a "stopped clock": a ticker could never produce new graded calls to prove it improved.

`computeHistoricalReaction()` pools all directions, which hides ALAB's 0/8 UP record. So:
- `computeDirectionalAccuracy(symbol, direction)`: a separate function/cache (the original stays direction-agnostic for the two displays that use it). Same `SCORECARD_TICKER_MIN_GRADED` (5) floor, filters `.eq("verdict", direction)`.
- `ah.applyHistoricalAccuracyCeiling(confidence, sameDirectionPct)`, `HISTORICAL_ACCURACY_FLOOR_PCT = 40` (judgment, revisit with data). Demotes HIGH only; never MEDIUM/LOW, sizing, or direction.
- Wired in `/analyze` right after the proxy-fit ceiling, only when `confidence === "HIGH"` and verdict is UP/DOWN (so the query only runs when it matters).

Checked against ALAB's real 8 UP rows → `{directionalPct: 0}` → MEDIUM. **Not verified live.**

## Backend: `verdict_log` — confidence column, same-day dedup, dial (Sep 14-30, 2026; `Tra` #114 / `trade-verdict` #343 and later)

Current columns worth knowing (besides grading columns, see the Scorecard section):
- `confidence` (patch14): the final value after every ceiling. Pre-existing rows are null.
- `superseded boolean not null default false` (patch15). `supersedeSameDayVerdicts(ticker, userEmail)` runs at the top of `logVerdict()` and marks earlier same-UTC-day rows for the same `(ticker, user_email)` as superseded. **Last call of the day wins** (Mr. T's choice). Rows are never deleted and still get graded; every accuracy reader filters `.eq("superseded", false)` — TRACK RECORD, `computeDirectionalAccuracy` (a real verdict-pipeline input), `fetchScorecardPool`, `/scorecard`. Anonymous rows (no email) are never superseded, since they can't be attributed. Reason: Analyze All re-runs gave HOOD 5 different calls in an hour, each counted equally.
- `dial_position`: always `effectiveDialPosition` now. Free (no dial) logs `NEUTRAL` (CRF Default), not null — Free has always run CRF Default rules. 290 old null rows were backfilled (Sep 30). Logged in the Rogue Actions Log as a miss in the Sep 29 grading change.

Known asymmetry, not fixed (a design question): directional accuracy grades UP/DOWN calls even when `size_action` is `NONE`.

## Backend/Frontend: Scorecard grading — final rules (Sep 13-30, 2026; `Tra` #110, #128, #129 / `trade-verdict` #337, #368, #370)

How grading works now:
- **Market hours only.** `logVerdict()` stamps `issued_market_open` via `isMarketOpenAt()` (holiday- and early-close-aware). Off-hours verdicts (shown as HOLD in the UI) are never graded into any stat. Reason: pre-market UP calls were 1/15, weekend UP 0/10. Logged in the Rogue Actions Log.
- **Day and Long windows, every call graded both ways** (`GRADE_WINDOWS`, patch25 here / patch23 Tra): Day = same session's close, target +4%. Long = close 5 sessions later, target +16%, FLAT band ×√5. `backfillDayLongFields()`; `gradeWindowRows("day"|"long")`.
- **Horizon grading still runs** (patch23/patch21; `grade_horizon`, `horizon_sessions`, `horizon_target_date`, `horizon_due_at`, `actual_return_pct_horizon`, `graded_at_horizon`). Horizon = close of the Nth session per dial (`HORIZON_SESSIONS_BY_DIAL`: Aggressive 0, Light Aggressive / CRF Default / Free 1, Light Passive 2, Passive 5 — my calibration, not a spec). It feeds the confidence ceiling and the ticker-card TRACK RECORD. Grades against Alpaca daily-bar closes (IEX, raw); ungradeable rows (no entry price, crypto) close out with no grade 3 days after due.
- **UP/DOWN rule (`gradeDirectionalCall()`):** closing in the call's direction by any amount = TRUE; against = FALSE; against after touching the dial's target in the window = MARGINAL. The stop never decides the grade (Mr. T's correction to an earlier first-touch rule). Weights: TRUE 1, MARGINAL 0.5, FALSE 0.
- Trade path is still recorded: `path_outcome` (TARGET/STOP/NEITHER) and `path_return_pct` from 15-min bars (`TRADE_PATH_BY_DIAL`: Aggressive +4/−1, Light Aggressive +4/−3, CRF Default +6/−3, Light Passive +10/−5, Passive +16/−8; both in one bar = stop; a gap fills at the open).
- **FLAT rule (`classifyFlatReturn`):** band = ½ of `fetchNormalDailyMovePct()` (mean |daily move| over the prior 20 sessions, split-adjusted; stored `flat_band_pct`). TRUE within ½, MARGINAL within 1×, else FALSE; any move under 0.1% is TRUE; fixed band if no history. Caveat: a 5-session horizon FLAT is judged against a one-day band — strict; revisit if it looks harsh.
- **FLAT is separate.** `computeAccuracyStats()` headline (`directionalPct`, `gradedCount`) is UP/DOWN only; `flatPct`/`flatGradedCount` alongside (needs 5+). TRACK RECORD and Top Tickers are UP/DOWN only too.
- **`/scorecard` is pooled for every tier** (the old mix of personal headline + pooled rows under a "Pooled" badge was misleading). Day/Long tiles need 20 graded UP/DOWN calls; the day-vs-long UP/DOWN/FLAT rows and top tickers need 5. Grades are frozen once recorded. Avg return/expectancy is removed from the card (the Sep 13 `computeExpectancyStats` "if followed at recommended size" metric and its per-branch-breakdown removal are superseded). `strictPct` is always null.
- **Pro only (`proof`, sent only when `tierConfig.tracker`):** each tile shows a ±95% margin and "Always-UP X%" (share of the same graded calls whose window closed up). "beats it" (green) / "trails it" (red) if the gap exceeds the margin, else "not proven yet" (amber). The margin ignores same-day clustering, so it's optimistic.
- **Sweep (`runVerdictGradingSweep()`, every 30 min, plus once 60s after boot):** `gradeUntilCaughtUp()` repeats each window's grader (150 rows/batch) until a batch grades nothing, capped at `GRADING_MAX_BATCHES_PER_SWEEP` (10). `clearAccuracyCaches()` resets `scorecardPoolCache`, `historicalReactionCache`, `directionalAccuracyCache` when anything grades. `verdictGradingSweepRunning` prevents overlap. Alpaca calls still use `alpacaGet()`.

History: all horizon grades were cleared and re-graded after the Sep 29 deploy. Old baseline for comparison: 55.1% directional, +0.48% avg return per sized trade (Sep 13).

**Not verified live:** check Render logs for one `Verdict grading sweep:` line clearing the backlog, and for `fetchSessionBars`/`fetchNormalDailyMovePct` errors. Long grades lag 5 trading days by design.

## Frontend: "Verdict Record" card (Scorecard + Track Record merged) (Sep 2026, `trade-verdict` #344, #345)

Mr. T picked "Unified Stack" from three sandbox mockups (pooled stats on top, personal log below, no tabs).
- One card, kept as `data-card="scorecard"`/`id="card-scorecard"` (help balloon, tutorial anchor and `shared/rolodex.ts` mechanics key off it). Titled "Verdict Record". Pro's separate `card-track` is gone.
- Pooled half: `.sc-tile` stat boxes under a `.sc-pooled-badge` ("Pooled · N graded"), "TOP TICKERS (POOLED)". `Strict accuracy` and `Win rate` removed (flagged by Mr. T). Tiles are now Day/Long per the grading section above.
- "YOUR LOG" (Pro, `renderTrackRecord()` in `shared/track-record.ts`): streak as 🔥 + count + 5 `.track-streak-pip` squares injected into `#trackStreakInline` in the divider row; the 3 latest trades as `.tli-pill` verdict + `.tli-check` (✓/✗) + short `.tli-date`; the rest (up to 8) behind a "View full log (N) →" text link (`.view-full-log-link`); "Clear" is a plain link. Removed: hit rate, UP/DOWN/HOLD tally, personal top tickers, `renderGateAttribution()`/`renderTickerAccuracy()`, `refreshTrackRecordCard()`. `classifyTrigger()`/`TRIGGER_LABELS` stay (Analyst View).
- Starter: a blurred "YOUR LOG" teaser (`.record-log-blur`/`.record-log-upsell`, absolutely positioned overlay) with fake content using the real Pro classes, linking to the Pro Stripe link. Replaces the old standalone `.track-teaser`.

Lesson: building "the same thing" as an approved mockup needs checking against the mockup image, not just the written content spec — #344 got the content right but not the visual shape, costing a round trip.

**Not verified live** against real `/scorecard`/`tv_accuracy_log` data or on a real device.

## Android: Play Console edge-to-edge/orientation warnings (fixed Sep 3-4, 2026, `trade-verdict` #283, #285, #286; logged Sep 15-17)

What Google flagged: "Edge-to-edge may not display for all users", "uses deprecated APIs or parameters for edge-to-edge", and "Remove resizability and orientation restrictions".

Fix (live as versionCode 2, "2 (2)", across 3 releases, confirmed by Mr. T's App Bundle Explorer screenshot):
- `com.google.androidbrowserhelper` 2.6.2 → 2.7.3 (2.7.0-alpha03 added TWA edge-to-edge support; `GoogleChromeLabs/bubblewrap#967`).
- `minSdkVersion` 21 → 23, required by 2.7.3 (pinning older undoes the fix; `tools:overrideLibrary` risks runtime failures). Drops Android 5.0-5.1.
- Orientation unlocked everywhere (`twa-manifest.json`, `build.gradle`, root `manifest.json`, `LauncherActivity.java` → `SCREEN_ORIENTATION_UNSPECIFIED`). An Activity-level lock can't be overridden from CSS/JS, so the APK had to be rebuilt; `versionCode`/`versionName` 1 → 2.
- `.github/workflows/build-android.yml` fixes: pipe `"n"` to Bubblewrap's "regenerate twa-manifest.json?" prompt (yes would revert the library version); `git reset --hard`/`git clean -fd` before the publish branch switch. Signed builds publish to the `store-assets/android-builds` branch (raw.githubusercontent.com URLs). Workflow id `332215098`.

**Final conclusion on the remaining warning: non-blocking, not fixable in this repo.** Play's pre-launch report on release 2 (2) traces `setStatusBarColor`/`setNavigationBarColor` to `androidx.core.view.WindowCompat.enableEdgeToEdge` — inside AndroidX, called by androidbrowserhelper's `EdgeToEdgeController`. Nothing in this repo calls them. It's filed under "For your next release" (advisory) and has shipped 3 releases. Only an upstream androidbrowserhelper or androidx.core release can fix it — check `GoogleChrome/android-browser-helper` release notes before another version bump. Treat as closed.

Lesson: this sandbox has no Play Console visibility. Don't conclude what Mr. T did or didn't upload from GitHub state; ask.

For relaying to Google: upgraded androidbrowserhelper to 2.7.3 and removed the portrait lock, raising minSdk to 23 as a consequence; released as versionCode 2.

## Frontend: landscape HUD fixes (Sep 15, 2026)

- **Nowrap headline overflow.** Landscape sets `.utility-pane .card[data-card] .card-body-inner{overflow:visible}` (needed for the Sep 6 sticky fix). As a grid item with `overflow:visible`, its automatic `min-width` becomes content-sized, so a `white-space:nowrap` `.compact-news` row (Watchlist overflow, Agitator RELATED) widens past the pane with no ellipsis. Fix: add `min-width:0` to that same rule, in all three tiers' CSS. Covers every HUD card by construction. Lesson: one non-reproducing test isn't proof a theory is wrong — force a longer input first. Not verified on a real device.
- **`#roloHint` "N / N" removed.** Redundant since pill-tap-only switching. `roloHint` dropped from `RolodexEls` and all tiers; `.rolo-nav` is now a plain 1px `var(--border-3)` divider.
- **Open:** a reported faint "cutoff text" line between the ticker card and the Watchlist card. `#landscapeHud` is ruled out (hidden in portrait). Likely the Rolodex's intentional stacked-card peek (`positionRoloStack()`, translateY ±14/28px, low opacity), but unconfirmed — re-check now that the hint is gone.

## Supabase: toggling Data API exposure re-grants anon/authenticated — updated grants rule (Sep 17, 2026)

First caught trigger for the recurring "grants come back" problem (Aug 4/13/26): `device_visits` grants were zero just before adding it to Project Settings → Data API → Exposed tables, and full `anon`/`authenticated` SELECT/INSERT/UPDATE/DELETE immediately after. Re-revoked; all 12 service-role tables then checked clean.

**Rule:** exposing or re-exposing ANY table via Data API → Exposed tables is a trigger for the grants check, same as running a DDL patch. Right after, run:
```sql
select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name = '<table>'
  and grantee in ('anon','authenticated');
```
and `revoke all on public.<table> from anon, authenticated;` if anything comes back. Also re-check after schema changes to a service-role table.

Root cause is one strong data point, not proven. Open: confirm it on a second table the next time exposure is toggled.

## Backend/Frontend: `device_visits` — anonymous per-device visit counting (Sep 17-23, 2026; `Tra` #115 / `trade-verdict` #346, then patches through patch21)

Why: `credits`' `ip:<address>` keys overcount people (about 18% of anonymous IPs were in T-Mobile's `172.56.0.0/13` CGNAT block). Constraint from Mr. T: count phones without asking anyone for anything.

How it works:
- `shared/device-id.ts`: a random `crypto.randomUUID()` kept in localStorage. `platform` (`web`/`twa`) from `document.referrer` (`android-app://<package>` on a TWA launch). No IP, user-agent or fingerprinting; email only from the account the user signed into.
- `POST /device-ping` (behind normal auth middleware, so `req.userEmail` is set for signed-in pings). `pingDeviceVisit()` uses each tier's `authH()`/`addSecret()`.
- **Final schema:** primary key `(device_id, user_email)`. Anonymous pings write `user_email = ''` (not NULL — NULLs are distinct in a PK and would add a row per ping). A device used by 2+ accounts gets one row per account. `first_seen_at`/`first_tier` are never overwritten. `first_seen_pt`/`last_seen_pt` are plain-text Pacific Time strings (`ptTimestampStr()`, `America/Los_Angeles`, e.g. `"2026-09-22 18:47:18 PT"`) next to the real UTC `timestamptz` columns (Supabase always shows those in UTC).
- **When pings fire:** Free from `boot()` (its `sbSession` is set synchronously). Starter/Pro only at the end of `checkAuth()` and after a successful `handleLogin()` — before that fix, their top-level ping ran while `sbSession` was null and got 401'd (they have no tier secret), so they likely recorded no rows from Sep 17 to Sep 22. No anonymous ping on Starter/Pro.

Reversals worth knowing:
- A separate `device_accounts` table (Sep 22) was dropped on Sep 23. Mr. T: "I specifically asked you to change the timestamps and the user email correlation in the device visit table. NO OTHER TABLE WAS MENTIONED." Change the table that was asked about.
- Display columns were first built in ET; Mr. T had asked for **PT**. ET is right for market logic (`etWeekday()`), not for this admin table. Don't default to the app's own convention when the request says otherwise.

**Not verified live:** check a real shared device for one row per account with PT strings, and Starter/Pro row counts rising.

## Process: Rogue Actions Log in Notion (Sep 23, 2026)

CLAUDE.md's record of self-caused mistakes is not complete — it only holds what a session chose to write up (the ET-vs-PT mistake above wasn't logged until asked). A separate **Rogue Actions Log** database exists in Notion (not under the Build Log page), tracking every confirmed case where a session acted against an explicit instruction, shipped a wrong assumption as verified, or made an unrequested unilateral decision. **Any session that catches itself doing this, or is told it did, adds a row there** — not just a CLAUDE.md paragraph. Ask Mr. T for the link if needed.

## Backend/Frontend: Free-tier push notifications and the daily-notifications plan (Sep 17-22, 2026; `trade-verdict` #350, #351)

Why: Play closed testing needs testers re-opening the app over 14 days. Mr. T first wanted a login wall to enable push; rejected because Free is declared to Google Play as needing no account, and push is keyed to a device anyway.

Backend (`push-notifications.js`, both repos; `Tra` deploys):
- `web-push`, VAPID-signed. `GET /push/vapid-public-key`, `POST /push/subscribe` (upsert by `device_id`), `POST /push/unsubscribe`, `sendPushToAllSubscribers()` (404/410 deletes the row; other failures are skipped).
- `push_subscriptions` table (patch17 here): `device_id`/`endpoint`/`p256dh`/`auth`/`tier`/`disabled`, no email. RLS disabled + revoked, grants checked clean.
- Sends once a day after the 9:30am ET market-open cache warm. Body = first sentence of the Sector Pulse (`pulsePushBody(cache)`, ellipsis at 140 chars), falling back to `gateNote` if the pulse isn't ready. Best-effort; can't break the cache warm.
- **VAPID keys were set by Mr. T in Tra's Render Environment tab, never printed in a session.** Lesson: generating a secret is fine; routing it through your own output or tool-call arguments is not, even toward a trusted service. Hand it to Mr. T as a file.

Frontend (Free only — the only tier with a service worker; `shared/push.ts` is tier-agnostic):
- `shouldOfferPush()`/`enablePush()`/`resyncPushIfGranted()`. **No banner.** Mr. T wanted "opt-out, not opt-in", but browsers always need the native permission dialog, and iOS only allows it from a real user gesture. So `requestPushOfferOnFirstGesture()` asks on the first pill tap (`onActivate`) or ANALYZE tap. One-time: a no-op once `Notification.permission` isn't `'default'`. `resyncPushIfGranted()` silently re-posts on every boot. Trade-off: less context for the OS dialog may lower the grant rate; revisit only with data.
- `sw.js` `push`/`notificationclick`: renders `{title, body, url}`, generic message on a bad payload, focuses an open tab if there is one.
- No new Android bundle needed: the Play app already has TWA notification delegation.

Sign-up nudge and ANALYZE spotlight (Free):
- Nudge on **every** app open for visitors without a valid `tv_session` (Mr. T rejected a 7-day cadence). Copy: free to sign up, no notification pitch. Same SIGN UP/SIGN IN destination as the header (a Starter signup with no purchase is a real free account). Floating modal on a translucent `backdrop-filter:blur(6px)`, tap outside or "Not now" to dismiss. `#comeback-screen` (out of credits) stays a full blocker on purpose.
- After dismissal: spotlight on the active card's ANALYZE button (4 clickable dark strips, not a `pointer-events:none` box shadow) with "tap to ANALYZE - Could be your next favorite company!". Targeting: anonymous every time; first-ever sign-in on the device once (`tv_free_seen_signed_in`); returning signed-in users never. `nudgeOrSpotlight()` is the shared entry point (after the tutorial, or 3s after load).
- Caching checked: `index.html` has the no-cache meta tag, and `sw.js` is network-first for everything (`SHELL_CACHE` only stores navigations as an offline fallback; `app.js` is never cached), so it adds no staleness beyond the `?v=` rule.

Open items:
- **Phase 3 — personalized daily push for signed-in Starter/Pro/Shark users from their synced watchlist: NOT STARTED.** Needs a service worker on Starter/Pro, a `user_email` column on `push_subscriptions`, and a throttled daily send job picking 1-3 notable movers/Gate 5 flags per user.
- **Idea, not decided:** both onboarding mechanisms (tutorial, spotlight) fire once and go quiet. Suggested: a persistent subtle glow on ANALYZE until the visitor's first analysis. No direction confirmed.
- **Not verified live:** the sandbox can't reach the push service. Check Render logs for `push-notifications:` warnings (missing VAPID vars) or `Market-open push: sent N`, and test the permission dialog on a real device.

## Auth: sign-in lasts 24h (Sep 28, 2026)

The client used to treat Supabase's ~1h access-token expiry as "signed out".
- `/auth/login` also returns `refreshToken`. `POST /auth/refresh` (pre-auth allowlisted) runs on the throwaway `authClient()`, never the shared admin client.
- Bundler-only `shared/session.ts` owns `getStoredSession`/`storeSession`/`isSessionValid` for Free/Starter/Pro. It stamps `loginAt`; a session is valid for `SESSION_MAX_AGE_MS` (24h, Mr. T: "login once per day").
- `ensureFreshSession()` runs before API calls on load (Starter/Pro `checkAuth()`, Free `boot()`); `startSessionKeepAlive()` re-checks every 4 min and on `visibilitychange`. A 401 from refresh signs out; a network error keeps the session while its token works. Legacy sessions keep the 1h rule once. Shark untouched.

**Not verified against live Supabase** — confirm a real sign-in survives past 1h.

## Backend: ANALYZE cost and failure handling (Sep 28, 2026; `Tra` #124, #125 / `trade-verdict` #363, #364, plus output trim)

**Failed ANALYZE refunds the credit.** `/analyze` deducts before the model call. New `refund_user_credit` RPC (`supabase-ddl-patch22-refund-credit.sql`) exactly reverses one `deduct_user_credit` (a whole credit comes back as a purchased credit); EXECUTE revoked from anon/authenticated since it creates credits. `credits.refundCredit()` runs once on all three no-verdict exits (non-ok model response, parse/enforce failure, thrown error/timeout). Users see "Analysis is temporarily unavailable. You weren't charged a credit — please try again later." (`code: AI_UNAVAILABLE`/`AI_BAD_RESPONSE`); the raw error goes to Render logs only. Confirmed live. A one-time +2 purchased credits went to three accounts hit before the fix.

**Spend limit vs claude.ai usage — keep this straight.** The Sep 27-28 outage was the API org's monthly spend limit ("your *specified* API usage limits … regain access on <1st of month>"). Fix it in **console.anthropic.com → Settings → Limits**. claude.ai → Settings → Usage (extra usage) funds Mr. T's own app use and does nothing for Tra's `ANTHROPIC_API_KEY`. No redeploy needed after raising it.

**Cost levers (approved by Mr. T):**
- `/analyze` sends `SYSTEM_PROMPT` as a `cache_control: ephemeral` system block (`CLAUDE_MODEL_ANALYZE`). **Never interpolate per-request data into SYSTEM_PROMPT — it silently kills the cache.** All per-ticker data goes in the user message.
- `generatePulse()` reuses its last result when its input text is byte-identical.
- Agitator scoring, topical fallback and Sector Pulse use `CLAUDE_MODEL_LIGHT`. Their prompts are under the light model's caching minimum, so only `/analyze` caches.
- `logClaudeUsage()` writes `[CLAUDE USAGE] <label> in= out= cache_read= cache_write=`. Measured live: the rules block is 4,556 tokens; ~15% off total `/analyze` cost at low traffic (output dominates; cold writes cost 1.25×). Savings grow with traffic.
- **Output trim:** the model now outputs only `g2_catalyst` and `g3_openbar` in `gates`, as minified single-line JSON. `/analyze` rebuilds `parsed.gates` in canonical order (pre_gate, sector, g1, g2, g3, g4, g5) with the server's own values, so the response shape is unchanged; a missing `gates` object no longer throws. Estimated 35-40% fewer output tokens (was ~630-710 `out=`).

Open: compare `out=` before/after and spot-check that verdicts look the same. A newer model was considered for `/analyze` and deferred (it rejects `temperature`; needs a before/after check). Shortening gate notes further is a quality trade-off for Mr. T to decide.

## Frontend: Google Play rating prompt — all tiers, Play app only (Oct 14, 2026)

Mr. T asked for a 1-5 star prompt that sends happy users to Play. Not built that way: **showing stars and sending only happy users to Play is review gating, banned by Play policy** (and Play advises not to ask "do you like it" first) — risky on an app under review. Closed-testing testers can't post public reviews anyway. Chosen: no stars, everyone goes to Play, after the 3rd analysis.

`shared/rate-prompt.ts` (bundler-only) owns it. All three tiers call `initRatePrompt()` and `onAnalysisSucceeded()`; each `index.html` has `#rate-prompt`.
- Counts successes in `tv_rate_analyses`; shows 2s after the last success (so Analyze All shows it once).
- "Rate on Google Play" opens an `intent://` URL for `com.android.vending` (web fallback) and stops for good; "Later"/tap-outside snoozes 7 days; "Don't ask again" stops.
- Only in the Play app: `isPlayApp()` = `android-app://` referrer this session, `tv_device_platform === 'twa'`, or `tv_twa_session`. Free's `notePlayAppLaunch()` sets `tv_twa_session` in sessionStorage before redirecting a paid session to `/starter/`/`/pro/`, because the referrer only exists on the first page.
- Won't open during the tutorial (`rolodex.isTutorialActive()`) or while the nudge, spotlight, out-of-credits screen or settings modal is up; retries after the next analysis.
- Preview in a normal browser with `?ratepreview`, then run 3 analyses.

**Not verified on a real device** — confirm "Rate" opens the Play listing from the installed app.

## Testing gotchas (Sep-Oct 2026)

- **First-run tutorial swallows the first click.** It auto-starts ~900ms after load and its handler calls `stopPropagation()`. Before driving any interaction, set the tier's seen key in an init script — on Free it is now `tv_tutorial_seen_free_v2` (also set the old `tv_tutorial_seen_<tier>`).
- **Service Worker requests:** on Free, register mocks with `context.route()`, not `page.route()` — page routes don't reliably see SW-proxied requests. **Always `await` route registration before navigating.**
- `PushManager.subscribe()` can't be mocked at the network layer and fails in the sandbox (FCM is blocked). Stub `reg.pushManager.subscribe`/`getSubscription` via `addInitScript()`.
- `context.grantPermissions()` makes `Notification.permission` read granted immediately, which breaks tests of "ask on first gesture". Stub `Notification.requestPermission` instead.
- Headless Chromium drops an `android-app://` referrer from `goto({referer})`. Fake it with an init script overriding `document.referrer` on the root page only.
- `execute_sql` via Supabase MCP is read-only; test write logic with an in-memory fake client.
- After restarting a branch from `origin/main`, re-check `?v=` numbers against `main` — reusing a number `main` already used for other bytes defeats cache-busting. A `.ts` source with a `?v=` import must carry the bump too.

## Oct 19, 2026 — Gate 3 3-bar window (Pro), every gate logged, Pulse moved into the Gate, one Gate 0 rule set

### Gate 3 "only one bar" bug — fixed on Pro only (`Tra` #132 / `trade-verdict` #377)
Root cause (found Oct 13-14): `fetchOpeningBar()` asks Alpaca for five 15-min bars but returns only
bar 1, so Gate 3 could never see a sequence. **Free and Starter still have this** — their path is unchanged.
- **Switch (Render env on Tra):** `GATE3_WINDOW_TIERS=pro` is set (Mr. T is the only Pro account);
  `GATE3_BETA_EMAILS` turns it on per account. Unset = old bar-1 behavior, byte-for-byte. Porting to
  Starter/Free also needs their frontends (only `pro/app.ts` has the new card).
- **Window (`gate3-window.ts`, pure, 5 tests):** last 3 COMPLETED 15-min bars (in-progress bar dropped).
  FORMING n/3 → RESOLVED (first read 10:15 ET / 7:15 PT) → EXPIRED after 12:30 ET (9:30 PT, Long only)
  / CLOSED. Bars fetched once per symbol per candle (`fetchGate3Window`, reuses `fetchSessionBars`).
- **Long vs Day:** the model's verdict is the Long call (SYSTEM_PROMPT untouched, so caching still hits);
  `verdict_log` grades the Long, so the Scorecard is unchanged. Day = Long refined by fixed rules
  (`refineDayVerdict`): confirms → same; mixed → size down one step; against → FLAT; hard overrides
  (Gate 0 RED, Gate 1/5 forceDown, earnings block) never change; Friday with a non-flat week treats a
  one-way sequence as mixed. No second model call. These rules are my calibration — revisit with data.
- **Cache (per user+ticker+dial):** same candle → cached, no credit. After the cutoff a cached Long is
  reused only if the news headline, Pre-Gate status and Gate 0 are unchanged. A new candle before the
  cutoff is a fresh, charged analysis.
- **Pending Day reads:** ANALYZE before bar 3 stores a job (`day_refinement_jobs`, Tra patch24 /
  mirror patch27, RLS off + revoked). A 60s sweep or `GET /day/:ticker` (free) resolves it and
  broadcasts via Supabase Realtime to `day:<auth uid>` (policy `day_read_own_topic`); the card also asks
  `/day` at readyAt+20s. In-app only — Pro has no service worker, so no OS push yet.
- **Prop 9 live gate rows:** beta `/analyze` streams NDJSON (`gates` → `gate3` → `final`/`error`). Rows
  pulse blue while reading, ✓ in the gate's color, red ✗ when not read (or "1/3 bars"), grey – when the
  Day window doesn't apply. DAY/LONG toggle + "Bars as of" line. `@supabase/realtime-js` bundled into
  `pro/app.js` only (~200 → ~350 KB).
- **Verified:** Tra booted with Anthropic/Alpaca stubbed and a pinned clock (stream, same-candle cache,
  forming → `/day` READY with zero extra model calls, expired, catalyst-unchanged hit, Gate 0 change
  forcing a fresh run, switch-off plain JSON); headless Chromium on the real Pro bundle.
- **Not verified live (Stage 0, first market day):** real Alpaca bars and the Realtime round trip. Check
  Render logs for `fetchGate3Window` / `saveDayJob` / `broadcastDay` and `verdict_log.gates.g3_bars_done`.
  If `day_refinement_jobs` turns out to need Data API exposure, re-run the grants check right after.
- **Still to do:** port to Starter then Free; OS push for a ready Day read; plain-language copy with (?)
  Glossary links; a fuller test list (holiday, DST, early close, partial bar).

### `verdict_log.gates` — every gate's color on each verdict (`Tra` #133 / `trade-verdict` #378)
`gates jsonb`: `{ pre_gate, sector, g1, g2, g3, g4, g5, g3_note }`, statuses only (a missing gate is
`null`), built by `ah.gatesForLog()` (tested) — no new API or model calls. In the Gate 3 beta rows also
get `g3_bars`, `g3_bars_note`, `g3_bars_done`, `g3_window` (there the plain `g3` is the model's week
read). Order was migration → merge → deploy, because `logVerdict` doesn't check the insert error and an
unknown column would silently drop the verdict. Confirmed live (MU row, Oct 19 00:22 UTC); grants
re-checked clean across all 14 service-role tables.

### Sector Pulse moved into the Gate box, all tiers (`trade-verdict` #379, #380)
The Pulse card is gone; its text sits inside `#gateFullOverlay` under the "Live · Updated" line
(`#gatePulse` / `#pulse-text` / `data-help="pulse"`) and hides when the Gate docks. Starter/Pro show the
full text; Free shows the first 5 words, then one fogged line with "Read the rest? UPGRADE TO STARTER →".
No backend change. Landscape ribbon has no Pulse item; the tutorial's Pulse step points at the `?` in
the Gate. The Gate box is ~105-140px taller on a phone; dock/spacer math measures it live.

### One Gate 0 rule set, a steady factual Pulse (`Tra` #134 / `trade-verdict` #381)
Mr. T saw the Pulse and Gate contradict each other minutes apart. Causes and fixes:
- **Two Gate 0 copies disagreed.** The boot/9:30 warm (`warmTrackedMarketCache`) called ONE index
  down >1% RED; `/market` correctly calls that YELLOW. RED forces DOWN. **15 verdicts on Sep 14, 2026 at
  9:31 ET were forced DOWN by this** (SPY −0.74%, QQQ −1.66% per Robinhood 5-min bars). Other RED rows
  (Oct 14 4:23pm, Oct 18 Sunday) were off-hours and never graded. The 15 rows were left as is — Mr.
  T's call. Fix: `ah.computeGate0(data)` (tested) is the only Gate 0 rule set; both paths call it.
- **The Pulse rewrote itself constantly.** Input is each move rounded to 1 decimal
  (`ah.buildPulseInput`/`pulsePct`); while the market is closed the BTC line is left out (24/7 trading
  forced a new Pulse model call every 4 min all night). Chosen over a hard freeze, which would let pre/post-
  market grid numbers drift away from a frozen Pulse. Identical concurrent requests share one call.
- **The Pulse lagged the grid by one refresh.** `/market` and the warm wait up to 8s
  (`pulseForSnapshot`) for the Pulse built from the same numbers; on timeout they send the old one and
  swap the new one in when it lands.
- **The prompt invited themes/advice.** `PULSE_PROMPT`: 2 sentences (strongest up, weakest), numbers
  quoted exactly, no causes/themes ("defensive", "risk-off", "safe haven"), no advice/predictions,
  "broadly flat" when everything is within ±0.3%.
Verified: 107/107 tests; Tra booted with Finnhub/Anthropic stubbed (warm says YELLOW for the Sep 14
numbers, first `/market` carries the matching Pulse, repeat refresh makes no new model call). Not
verified live: the new Pulse wording on real data.

### Gate inputs logged, unread Gate 3 is null, same-session FLAT band shrinks (`Tra` #135 / mirror on `trade-verdict` #382)
- **`verdict_log.gates.inputs`** (`ah.gateInputsForLog`, tested; no migration, it's a new key in the
  jsonb): Gate 1 branch/`change14`/`change60`; Gate 2 type, corroboration count, proxy name/symbols/
  tier/r; Gate 3 bars (window bars on Pro, the opening bar elsewhere) and `read`; Gate 4 range
  position, price, 52W hi/lo; Gate 5 ticker/proxy % moves, regime state, rolling r, coherence case;
  `red_count`; `override` (which branch set the verdict: `pre_gate_candidate`, `gate0_red`,
  `gate1_forcedown`, `gate5_coherence_down`/`_flat`, `gate5_forcedown`, `gate5_g2_down`,
  `gate5_flat`, `congruency_flat`, `earnings_block`). Rows before this have no inputs (no backfill).
- **Gate 3 with no bar data is "not read":** logs `g3: null` + note "not read: no bar data", and no
  longer counts as YELLOW in the three-YELLOW corroboration check (a small verdict change).
- **Same-session FLAT band** (Day window and 0-session horizon) scales by √(share of the session
  left at issue), 15-min floor, early closes handled (`ah.sameSessionFlatScale`). Multi-session
  windows unchanged. Applies to rows graded after deploy; already-graded rows keep their grade.
- **Gate 4 is already range-position based** (since Aug 22, `evaluateGate4`): below 30% Phase 1, 30-70%
  Phase 2, above 70% Phase 3. The proposed "stretched above the 50-day average bumps a phase"
  modifier is NOT built — no validated cutoff, and the 50-day average isn't sent to `/analyze` yet.
- Weekend rows (e.g. NU DOWN on Sun Oct 18) store the raw model verdict but have
  `issued_market_open = false`, so they're never graded; the card shows HOLD client-side.

### Sector Pulse gives a market leaning again (`Tra` / `trade-verdict`, same day)
Mr. T: the factual-only Pulse turned into a list of numbers instead of a distilled read. Now the
server picks the leaning with fixed rules (`ah.computeMarketLeaning`, tested) and the model only
phrases it, so it can't claim a leaning the numbers contradict. Rules, first match wins, on the same
1-decimal values the Pulse quotes (BTC ignored): **Quiet** (every move within ±0.3%) → **Risk-off,
safety bid** (SPY/QQQ average ≤ −0.3% and gold ≥ +0.3%) → **Broad selloff** (market down, SPY and QQQ
both negative, most sectors negative) → **Commodity-led** (market not up, oil or gold ≥ +1% and above
every stock move) → **Risk-on** (market ≥ +0.3% with QQQ/SOXX/NVDA/IWM beating SPY) → **Rotation**
(market flat, one stock move ≥ +1% and one ≤ −1%) → fallback **Mild gains / Mild losses / Mixed**.
Gold is the only safe-haven proxy tracked (no bonds/utilities). The input gets a
"Market leaning (use exactly): …" line; `PULSE_PROMPT` asks for sentence 1 = leaning + direction,
sentence 2 = leaders/laggards with 2-3 exact numbers, no causes, no advice. Thresholds are my
calibration — revisit if a label reads wrong on a real day.

## Oct 20-27, 2026 — Pulse in words, snaps, DAY/LONG, help audit, tutorial replay, DAY call graded on its own, options lens, learning loop

PRs: `Tra` #137-#140 / `trade-verdict` #384-#388. All merged; migrations patch26 + patch27 (Tra) /
patch29 + patch30 (mirror) applied, grants verified clean. Nothing below verified on a real device or
against live Alpaca options data yet.

**UI (Oct 20, all tiers unless noted)**
- **Sector Pulse has no numbers** (Mr. T: it "regurgitated" the grid). The model gets only
  `ah.buildPulseWords()` (leaning + leading/lagging groups in words; moves under ±0.3% dropped, BTC not a
  group). Any digit/`%` in the reply, or an Anthropic error → rule-built `ah.pulseFallbackText()`. Watch
  Render for `Pulse: model reply had numbers`.
- **Snap on ANALYZE:** per-tier `snapOnAnalyze` set; the card snaps under the pill ribbon on the tap and
  again when the verdict lands (only if still active). Analyze All doesn't snap.
- **Pro DAY/LONG switch:** full-width raised buttons, 28px ("2mm at most"), amber when selected; DAY
  breathes while FORMING, flashes 3× when its read lands, greyed out after hours (`activeView()`). Own
  tutorial step.
- **Help (?) / tutorial / Glossary audit:** plain English + Glossary links everywhere. Fixed wrong credit
  math in Import help (1 credit = 3 analyses) and "6 gates" (it's 7 checks). New Glossary entries: Agitator
  Gauge, Credit, Sector Pulse, Aggression Dial (Starter/Pro), Day / Long Call (Pro); Pro's Gate 3 entry is
  "Recent Price Bars". `jumpToGlossaryTerm()` tries exact → prefix → substring.
- **Tutorial replays cleanly** (from ▶ Run Tutorial or first run): `shared/rolodex.ts`
  `resetForTutorial()` (collapse all, scroll to top), one card open per step, steps in page order,
  `positionTutorialBalloon()` keeps every balloon on screen below the docked chrome (`tutorialSafeTop()`),
  `tutorialBusy` swallows taps mid-step. Test note: hide Free's `#signin-nudge` in headless runs.

**DAY call logged and graded on its own (Oct 27).** Root cause of "Day and Long look the same": only the
LONG call was ever logged; the Day tile graded LONG at the close.
- `verdict_log` gained `day_verdict`/`day_sizing`/`day_issued_at`/`day_entry_price`/`grade_day_call`/
  `return_day_call_pct`/`graded_at_day_call`; `day_refinement_jobs.verdict_log_id`. `logVerdict()` returns
  the row id; `recordDayCall()` writes the DAY call when ready (at the tap or when bar 3 lands);
  `gradeDayCallRows()` grades entry bar → same-session close. Backfill linked 31 old jobs (30 graded, 11
  UP/DOWN at 81.8%, 4 differed from LONG).
- `/scorecard`: `day` = DAY calls, `long` = LONG at 5 sessions, `longAtClose` = old Day number, Pro
  `dayVsLong`. Tiles say "DAY calls" / "LONG calls (5 days)".
- **Decision (Mr. T):** DAY stays Pro-only until the DAY tile is **65%+** (floor: 100 graded calls), then
  roll to every tier.

**IV/delta options lens on Gate 3 (Pro DAY call only; off switch `GATE3_OPTIONS_LENS=off`).**
- `probeOptionsForDay()`: Alpaca `/v1beta1/options/snapshots` (indicative, ~15 min delayed, ±15% strikes,
  ≤45 DTE) + open interest from `/v2/options/contracts` (live then paper host). Logged to
  `gates.inputs.options` and `[OPTIONS PROBE]`. Math in `analyze-helpers.ts` (`summarizeOptionsChain`, etc.).
- Schedule (`gate3ScheduleFrom`): implied ÷ normal daily move > 1.3 → 5-min bars (read 6:45 AM PT), < 0.8 →
  30-min (8:00 AM PT), else 15-min (7:15 AM PT). Cutoff 12:30 ET. A bar counts only at ≥ 0.5 × its IV
  yardstick (`DAY_BAR_MIN_SHARE`); a delta lean (±0.15 band) against GREEN/RED → YELLOW → DAY sizes down a
  step. LONG untouched. Logged `gates.g3_bar_minutes`, `g3_lens`, `g3_day_opts`. All thresholds are
  starting guesses for the learning loop to test.

**Learning loop — Stage 1 + 2, record only (`learning.ts`, `tests/learning.test.js`).**
- **Standing rule (Mr. T): nothing changes a live setting without his pre-approval.** Stage 3 (promotion)
  is not built.
- `maybeRunLearningJobs()`: once per ET day after 5pm (off switch `LEARNING_JOBS=off`), 90-day lookback.
  `signal_stats` = hit rate + average move per input value, DAY and LONG separately. `tuning_runs` = past
  DAY calls replayed exactly like live under 13 one-change candidates (bar schedule, bar share, lean band);
  the `live` row reports replay faithfulness. A candidate is only *proposed* with ≥100 graded DAY calls, a
  gain bigger than the ±95% margin, and better in both halves. `GET /learning` (Pro/Shark).
- **Weekly readout:** scheduled task "Weekly learning readout", Saturdays 8:38 AM PT, printed in the chat
  session — freshness, DAY/LONG accuracy vs the 65%/100-call goal, strongest/weakest signals, tuner
  results (any guardrail-passing candidate shown as a proposal for approval), options data health.
- **Confirmed live Oct 27 03:30 UTC** (first run, right after deploy): 85 `signal_stats` rows, 13
  `tuning_runs` rows, live replay matched **28 of 28** logged DAY calls. ~30 graded DAY calls and options
  data only from Oct 27 on → expect proposals in ~a month.

**Open from this stretch:** confirm real Alpaca options fields/entitlement (`[OPTIONS PROBE]` lines — needs
Mr. T to confirm which Render workspace Tra is in before logs can be read); OS push for a ready DAY read (Pro has no service worker); port the Gate 3 window to
Starter → Free.

## Oct 27, 2026 — Proposal 7 Gate-Override Audit Trail (dial changes) (`Tra` patch28 / mirror patch31)

Unblocked since the dial shipped (Aug 26). Mr. T's choices: **app grades only** (no Robinhood join — Tra
can't reach Robinhood, only chat can), and **Saturday readout + a line on Pro's dial card**.
**Observational only:** nothing blocks a dial move or touches a verdict.
- **`dial_changes` table** (service-role only, RLS off + revoke, sequence revoked): account, tier,
  `from_position` → `to_position`, `direction` (`more_aggressive`/`more_passive`, from `learn.DIAL_ORDER`,
  most aggressive first), `source` (`app` | `rebuilt`), `changed_at`, `changed_after` (rebuilt rows: last
  evidence of the old position), `changed_pt`.
- **`POST /dial-change`** (signed-in, `tierConfig.dial`, position must be in the tier's `DIAL_RANGES`):
  the client sends only `{to}`; the server decides `from` (`lastKnownDialPosition()`: newest change or
  newest verdict, whichever is later) and skips a no-op. **`GET /dial-audit`**: the account's last 10
  changes + `learn.dialAuditSummary()` — for the latest change, dial-horizon accuracy (`grade_horizon`,
  MARGINAL = half, UP/DOWN only) and stop-out rate (`path_outcome = STOP`) since, vs before at the old
  position. 10-min per-account cache, cleared on a logged change.
- **Gap-fill:** `learn.inferDialChanges()` rebuilds changes the app never logged (history back to Aug 26,
  stale cached pages, failed calls) from each account's verdict sequence. Idempotent; an app log within
  10 min of the matching verdict counts as the same move. Runs once 90s after boot, before every nightly
  learning job, and before `/dial-audit`.
- **Learning signal `dial_shift`:** each Starter/Pro call is tagged `more_aggressive` / `more_passive`
  (account moved its dial within 7 days before the call) or `steady` (`learn.annotateDialShift()`).
- **Frontend:** bundler-only `shared/dial-audit.ts` (no `?v=`). `setDialPosition()` calls
  `noteDialPosition()`; it posts once the dial has been still 1.5s **and** the finger is up (a drag passes
  every tick), and skips a position already logged from this device (`tv_dial_logged`). Starter logs only;
  Pro also shows `#dial-audit-line` under the dial ("Last change … Since: X% right, Y% stopped out (N
  graded). Before, at …"); a % shows only at 5+ graded calls. Dial `(?)` help text updated.
- Verified: 140/140 tests; stubbed Tra + fake Supabase (history rebuilt as Aggressive Sep 2 → Light
  Aggressive Sep 15; app log, no-op, bad position 400, no token 401; nightly run adds no duplicates);
  headless Pro + Starter (one post per settle, none mid-drag, none on reload, audit line renders). Not
  verified live. Starter `?v=130`, Pro `?v=80`.
