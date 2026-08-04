-- Trade Tribunal — Patch 6 (server-side watchlist sync)
-- Run manually in the Supabase SQL editor before deploying this server.js
-- to Render. Matches the existing subscribers/credits tables' style
-- documented in the Build Log (RLS disabled, service-role-only access).
--
-- Problem: the watchlist lives only in localStorage (tv_wl) — a browser
-- "clear cookies and site data" wipes it along with everything else, with
-- no recovery. Separately: a lapsed Starter/Pro/Shark subscriber whose tier
-- resolves back to "free" on next login was losing their watchlist
-- entirely, since free's app.js only ever reads/writes tv_wl locally, with
-- no notion of what they'd built on a paid tier.
--
-- Fix: one row per authenticated account (any tier — see server.js's new
-- GET/POST /watchlist, gated on req.userEmail presence, not req.userTier),
-- storing the full, untruncated ticker list. Each tier's frontend already
-- caps what it *displays* to its own maxTickers (shared/watchlist.js) —
-- this table is intentionally never truncated by tier, so a lapsed user's
-- full list is preserved and reappears completely if they resubscribe.
create table if not exists public.watchlists (
  id          bigint generated always as identity primary key,
  email       text not null unique,
  tickers     jsonb not null default '[]'::jsonb,
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

create index if not exists watchlists_email_idx on public.watchlists (email);

-- RLS disabled to match subscribers/credits/proxy_resolution — server-only
-- access via the service_role key.
alter table public.watchlists disable row level security;

-- "RLS disabled" alone is NOT sufficient on this project — confirmed Aug 4,
-- 2026 (patches 2-3/5's tables) that anon/authenticated can end up with
-- full SELECT/INSERT/UPDATE/DELETE grants despite RLS being off, unless
-- explicitly revoked. This table happened to already have no such grants
-- when checked, but this revoke makes that guaranteed rather than
-- coincidental, and keeps this patch reproducible on a fresh project.
revoke all on public.watchlists from anon, authenticated;

-- Must be added to Data API -> Exposed tables in the Supabase dashboard
-- (same Apr 2026 breaking change documented in the Build Log for every
-- other table here — new tables are opt-in unless "Automatically expose
-- new tables" is already toggled on for this project).
