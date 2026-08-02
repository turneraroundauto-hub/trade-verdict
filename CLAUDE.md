# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Trade Verdict is a paid stock-analysis tool: a Node/Express API that runs a
ticker through a fixed sequence of rule-based "gates" plus one LLM call, and
a set of static, framework-free HTML/JS frontends (one per pricing tier)
that a user opens in a browser or as a home-screen web app.

- `server.js` — Express API, deployed to Render (`https://tra-zacg.onrender.com`).
- `index.html` / `app.js` — Free tier frontend, deployed via GitHub Pages
  (`https://turneraroundauto-hub.github.io/trade-verdict/`).
- `starter/`, `pro/`, `shark/` — the same frontend, one folder per paid tier,
  each served from its own GitHub Pages subpath.
- `reset/` — standalone password-reset page linked from Stripe/auth emails.
- `shared/` — ES modules imported by the Free and Starter frontends only.
- `credits.js`, `gates-extended.js` — server-side modules required by `server.js`.
- `supabase-ddl-*.sql` — hand-run migrations against the Supabase Postgres
  database (there is no migration runner; see Database section).

There is **no `package.json`** committed to this repo. `server.js` requires
`express`, `cors`, and `@supabase/supabase-js` — these are installed on
Render some other way (its build step, or a dependency cache), not tracked
here. If you need to run the server locally, you'll need to `npm init` and
install those three packages yourself; don't assume a lockfile exists.

## Development commands

There is no build step, no bundler, no linter, and no test suite in this
repo — the frontends are hand-written vanilla HTML/CSS/JS loaded directly by
the browser, and the backend is plain CommonJS Node.

- **Run the API locally**: `node server.js` (reads `PORT`, defaults to
  3001). Needs the env vars below to do anything useful; it boots fine with
  none set but every route degrades (no Supabase → subscribers/credits
  don't persist across restarts; no Anthropic key → `/analyze` 500s).
- **Serve a frontend locally**: these are static files with no dev server —
  `python3 -m http.server` (or any static file server) from the repo root,
  then open `/index.html`, `/starter/index.html`, `/pro/index.html`, or
  `/shark/index.html`. They all call the **production** API at
  `tra-zacg.onrender.com` unless you edit `API_URL` in the relevant `app.js`
  / inline `<script>` block — there's no separate local/staging API.
- **No automated tests exist.** Verify server changes by hitting routes
  with `curl` (see route list below) and verify frontend changes by loading
  the page in a browser and exercising the flow manually.

### Environment variables (server.js / credits.js)

| Var | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | required for `/analyze` (the LLM verdict call) |
| `FINNHUB_KEY` | quotes, company profile/sector, news |
| `ALPACA_KEY` / `ALPACA_SECRET` | intraday OHLCV bars (Gate 3) |
| `SEC_EDGAR_USER_AGENT` | required by SEC EDGAR full-text search (Pre-Gate) |
| `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` | subscribers, credits, proxy-resolution cache. Both must be set or the Supabase client is `null` and the app silently falls back to in-memory/ephemeral state |
| `FREE_KEY` (falls back to `APP_SECRET`), `STARTER_KEY`, `PRO_KEY`, `SHARK_KEY` | per-tier client secrets, see Auth below |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_STARTER_PRICE_ID`, `STRIPE_PRO_PRICE_ID`, `STRIPE_SHARK_PRICE_ID` | checkout + webhook handling |
| `PORT` | defaults to 3001 |

## Backend architecture (`server.js`)

### Auth: tier key OR Supabase session, per request

Every route except `/`, `/auth/*`, `/stripe/webhook`, `/stripe/credits` goes
through middleware that resolves `req.userTier` and `req.userKey` from
**either**:
- `x-app-secret` header / `secret` query param — a per-tier shared string
  (`FREE_KEY`/`STARTER_KEY`/`PRO_KEY`/`SHARK_KEY`), hardcoded in each
  frontend's JS (e.g. `pro/index.html` ships `tvPro2026!`). This is a
  paywall gate, not a real secret — it's visible in client source. Free-tier
  anonymous usage is then rate-limited **per IP** (`getClientIp`), not per
  secret, since every anonymous visitor sends the same key.
- `x-supabase-token` header / `supabase_token` query param — a real
  Supabase auth session, used for signed-in users so credits/tier follow
  the account rather than the browser.

If you add a tier or change a tier's key, update the frontend that ships it
*and* the `TIER_KEYS` map here.

### The gate system

A verdict is produced by evaluating six checks — Pre-Gate, Gate 0, Gate 1,
Gate 2, Gate 3, Gate 5 (Gate 4 does not exist in this framework) — most of
which are computed **server-side as fixed facts** and injected verbatim
into the LLM prompt with "USE EXACTLY THIS (do not recalculate)". The LLM
only reasons over Gate 2 (news catalyst) and synthesizes a final verdict;
it never recomputes the deterministic gates. This split exists specifically
so verdicts are reproducible (`temperature: 0`, `claude-sonnet-4-6`) instead
of drifting with the model's own arithmetic.

- **Pre-Gate** (`PRE_GATE_TRIGGERS`, ~line 311): SEC EDGAR full-text search
  for solvency/dilution/guidance-cut language. Computed once in
  `/ticker/:symbol`, passed through `/analyze` untouched.
- **Gate 0**: market-wide risk-off check — SPY and QQQ both down >1% forces
  RED, server-enforced (not AI-estimated, per the v4.0.0 changelog).
- **Gate 1** (`evaluateGate1Sessions` in `gates-extended.js`): bidirectional
  trend structure over session windows (60-session long lookback,
  14-session short), not calendar days — this was a deliberate bug fix,
  see the comment above `GATE1_LONG_SESSIONS`.
- **Gate 3**: opening-bar price action. Two modes depending on tier —
  `SWING_LEVEL` (Shark only, needs `openingBarData.swingLevels`) vs
  `BLIND_SEQUENCE` (everyone else).
- **Gate 5 — Smart Proxy Algorithm** (`PROXY_RULES` / `classifyTicker`,
  ~line 208): classifies any ticker into a sector proxy basket (e.g.
  AI/semis → TSM, biotech → XBI) so Gate 5 "never returns N/A." Tickers
  that don't match a static rule fall through to the **Dynamic Proxy
  Resolution Algorithm** (`resolveFixedProxyBreak` in
  `gates-extended.js`), whose results are cached up to 90 days in
  Supabase's `proxy_resolution` table (see `supabase-ddl-patch2-3.sql`).

**Force-down authority** (`FORCEDOWN_EXEMPT` / `hasForceDownAuthority` in
`gates-extended.js`) is a separate concept from gate status: normally a
DOWN verdict needs ≥2 RED gates corroborating each other, but a short
allowlist of triggers (Pre-Gate hard trigger, Gate 0 RED, Gate 1 60-session
structural breakdown, Korea/Taiwan proxy breaks) can force DOWN alone. A
fixed proxy's force-down authority is automatically suspended if
`regimeValidation()` finds the proxy's rolling correlation has gone
`BROKEN`, and requires an extra `proxyCoherenceCheck()` pass if it's merely
`DEGRADING` — don't grant a gate force-down power without checking whether
it needs to go through this registry.

If you touch gate logic, keep `server.js` and `gates-extended.js` in sync:
the extended module explicitly documents itself as "additive, no edits
required to existing server.js internals," so new gate behavior tends to be
added there and wired into `server.js` rather than rewritten in place.

### Market Pulse → per-ticker analysis

`generatePulse()` (~line 1078) makes one AI call per market-cache cycle
(`CACHE_MS`, 4 minutes) over broad market data (SPY/QQQ/XBI/TSM/etc.) to
produce a 2-sentence sector-rotation summary, cached on `marketCache.pulse`.
`/analyze` reads that same cached string and includes it in every ticker's
prompt, labeled explicitly as informational Gate 2 context that must not
override Pre-Gate/Gate 0/Gate 1/Gate 5 (both in the user message and as a
rule in `SYSTEM_PROMPT`). This means every ticker analyzed within the same
4-minute window — including a whole "Analyze All" batch — references the
identical AI market read, instead of each `/analyze` call reasoning about
the market independently. It's separate from `marketContext`, which is
still the free-text box the user can type into client-side.

### Credits (`credits.js`)

- Storage is Supabase (`public.credits` table + atomic RPC functions) when
  `setSupabase()` was called with a real client; otherwise falls back to an
  in-memory + JSON-file store. **The fallback is not viable in
  production** — Render's default disk is ephemeral, so a restart wipes
  local balances. Always configure Supabase for anything user-facing.
- Mutations go through single atomic Postgres functions (not app-level
  read-then-write) because "Analyze All" fires one `/analyze` call per
  watchlist ticker concurrently; a naive read/modify/write could let two
  concurrent deducts double-spend the same balance.
- Economics: 1 credit = 3 ticker analyses, on every tier. `server.js`
  deducts 1 *analysis* per `/analyze` call; `credits.js` converts that into
  whole-credit deductions via a 0–2 `pending_analyses` counter so the
  balance shown to users is always a whole number of full 3-packs.
- `TIERS` in `credits.js` is mirrored in `supabase-ddl-patch5-credits.sql`'s
  RPC functions — if you change credit/rollover amounts in one, update the
  other.
- Caching: `/analyze` checks a response cache (`getCached`, keyed by
  `tier:TICKER`, TTL from `credits.TIERS[tier].cacheMinutes`) **before**
  deducting a credit, so cache hits are free.

### Routes (all in `server.js`)

`GET /` (health), `GET /status`, `POST /credits/add`, `GET /market`,
`GET /ticker/:symbol`, `POST /analyze`, `POST /auth/login`,
`POST /auth/signup`, `GET /auth/me`, `POST /auth/reset`,
`POST /auth/reset-confirm`, `POST /stripe/webhook`, `POST /stripe/credits`.

`/ticker/:symbol` does the heavy lifting of computing Pre-Gate, Gate 0,
Gate 1, and the Gate 5 proxy rule once; `/analyze` expects those results
passed back in the request body (`preGateData`, `gate1Data`, `proxyRule`,
`sectorContext`) rather than recomputing them, so the two routes are meant
to be called in sequence by the frontend, not independently.

## Frontend architecture

- **Free (`/`) and Starter (`/starter/`)** are modular: `app.js` imports
  `initTickerCache`/`fetchTickerData`, `initWatchlist`/`renderWatchlist`,
  `cacheVerdict`/`getCachedVerdict`, `renderTrackRecord` from `shared/`.
  Changing shared behavior (watchlist limits, caching, track-record log)
  should go in `shared/*.js` and will apply to both.
- **Pro (`/pro/`) and Shark (`/shark/`)** are fully self-contained
  `index.html` files with the entire app inlined in a `<script>` tag — they
  do **not** import `shared/`. If you fix a bug or change behavior in
  `shared/watchlist.js` or `shared/ticker-cache.js`, you must manually
  port the equivalent change into `pro/index.html` and `shark/index.html`,
  or they will silently drift out of sync. Check whether a frontend fix
  needs to be applied in up to four places: `app.js`, `starter/app.js`,
  `pro/index.html`, `shark/index.html`.
- Each tier's frontend hardcodes its own `API_URL`, `APP_SECRET`, and
  `TIER` config object (pricing, `maxTickers`, feature flags like `pulse`/
  `tracker`/`alpaca`) at the top of its script — there's no shared config
  file for these.
- Shared modules are imported with a manual cache-busting query string
  (`./shared/ticker-cache.js?v=2`). If you edit a `shared/*.js` file, bump
  the `?v=N` suffix in every importer (`app.js` and `starter/app.js`), or
  browsers/GitHub Pages caching may keep serving the stale module.
- `tv_session` in `localStorage` is shared across all tiers on the same
  origin/path structure — a signed-in session set by the Starter login
  flow is recognized by the Free tier's header too (see the comment block
  at the top of `app.js`).
- Market-hours logic (`isMarketClosed`, 9:30am–4:00pm ET, Mon–Fri) is
  duplicated client-side (each frontend) and server-side (`isMarketOpen`
  in `server.js`) — keep both in sync if trading hours logic changes.

## Database (Supabase)

No migration tool — DDL patches are plain `.sql` files meant to be pasted
into the Supabase SQL editor manually **before** deploying the
corresponding `server.js`/`credits.js` change to Render. They're numbered
but not idempotent-by-framework; each one manually guards its own
statements with `if exists`/`if not exists` checks so they're safe to
re-run. When you need a schema change, add a new `supabase-ddl-patchN-*.sql`
file rather than editing an old one, and call out in it which server-side
change depends on it (follow the existing files' comment style — they
explain the *problem* being fixed, not just the DDL).

Known tables: `public.subscribers` (email, tier, status, Stripe IDs,
`has_subscribed` flag that is only ever set true and never cleared — see
`supabase-ddl-patch4-has-subscribed.sql`), `public.credits` (api_key, tier,
credits, purchased_credits, last_reset, last_weekly_reset), and
`public.proxy_resolution` (Gate 5 Dynamic Proxy Resolution cache, reused up
to 90 days).

Both `server.js` and `credits.js` guard every Supabase query with
`if (!supabase) return`/try-catch, so the app boots and runs (just with
degraded behavior — no persistence, no caching) even if these tables don't
exist yet or Supabase env vars are unset.
