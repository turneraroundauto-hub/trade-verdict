-- Trade Tribunal — Patch 11 (Notion "Proposal 5 — Amendment: Entity
-- Resolution, News Caching, Options Data Gap, Topical Fallback," logged
-- Aug 25, 2026, built Sep 1, 2026 — Fix 2)
--
-- Per-ticker, per-source overwrite cache for the news headline this app
-- already fetches live on every per-ticker news lookup (ticker cards via
-- /ticker/:symbol, the Agitator Gauge's primary ticker + its comps, and
-- Path B's validated-company reactions) — read as a fallback ONLY when
-- the live Finnhub/Alpaca fetch itself comes back empty, never read-first.
--
-- Two separate timestamps by design, per the amendment's own spec:
--   last_checked_at — updates on every check, whether or not the article
--     changed. Proves the app looked.
--   published_at    — only updates when the returned article is genuinely
--     different (a new URL). Decay math (Proposal 7's Corroboration Decay
--     Indicator) reads from this field only, never last_checked_at — so a
--     ticker the app happens to re-check often doesn't read as falsely
--     "Fresh" on a headline that hasn't actually changed in days.
--
-- Same write path also feeds Proposal 7's corroboration_log directly (a
-- genuinely NEW cached article == a real corroborating event, source
-- 'finnhub_secondary') — one write path, not two separate pipelines for
-- the same underlying event.

-- ── STEP 1 — run this first ─────────────────────────────────────────
create table if not exists public.news_cache (
  ticker            text primary key,
  headline          text,
  url               text,
  source            text,
  published_at      timestamptz,
  last_checked_at   timestamptz not null default now()
);

-- corroboration_log (patch10) constrained `source` to 3 values that
-- predate this patch — widen it rather than replace it, so the three
-- existing values (news_match, now-retired but kept for old rows;
-- gate3_buildup; earnings_calendar) keep working unchanged.
alter table public.corroboration_log drop constraint if exists corroboration_log_source_check;
alter table public.corroboration_log add constraint corroboration_log_source_check
  check (source in ('news_match','gate3_buildup','earnings_calendar','finnhub_secondary'));

-- ── STEP 2 — run this SECOND, as its own separate execution ────────
-- Confirmed on this project (Aug 4, 2026, patch8): bundling this in the
-- same script/run as the CREATE TABLE above does not reliably stick.
alter table public.news_cache disable row level security;

-- "RLS disabled" alone is NOT sufficient on this project (Aug 4, 2026).
revoke all on public.news_cache from anon, authenticated;

-- Verify the revoke actually took (zero rows back is the only thing that
-- confirms it):
--   select grantee, table_name, privilege_type
--   from information_schema.role_table_grants
--   where table_schema = 'public' and table_name = 'news_cache'
--     and grantee in ('anon','authenticated');

-- Must be added to Data API -> Exposed tables in the Supabase dashboard
-- (same opt-in requirement every prior table here has needed) — server.js's
-- own supabase-js calls go through PostgREST even with the service_role
-- key, so an un-exposed table silently no-ops the write path. NOT done as
-- part of this migration — flagged for Mr. T to check/toggle manually,
-- same as every prior patch's own note on this.
