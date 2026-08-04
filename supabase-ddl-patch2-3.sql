-- Trade Tribunal — Patch 2 (Dynamic Proxy) + Patch 3 (Pre-Gate) new tables
-- Run manually in the Supabase SQL editor before deploying this server.js
-- to Render. Matches the existing subscribers/credits tables' style
-- documented in the Build Log (bigint id, created_at default now()).
--
-- Both server.js call sites guard every query with `if (!supabase) return`
-- and wrap in try/catch, so the app boots and runs fine (always recomputes,
-- never caches/escalates) even before these tables exist — but Patch 2's
-- quarterly-recompute caching and Patch 3's 30-day soft-trigger escalation
-- won't work until they're created.

-- ── PATCH 2 — Gate 5 Dynamic Proxy Resolution cache ─────────────────
-- One row per ticker that fell through to the Dynamic Proxy Resolution
-- Algorithm (i.e. no static PROXY_RULES match). Reused for up to 90 days
-- (Step 5, quarterly recompute) unless a Pre-Gate hard trigger forces an
-- off-cycle recompute first (Step 6).
create table if not exists public.proxy_resolution (
  id             bigint generated always as identity primary key,
  ticker         text not null unique,
  tier           text not null,  -- primary | secondary | fundamentals-confirmed | fundamentals-speculative
  proxy_symbol   text,           -- null for the two fundamentals-* tiers
  correlation_r  double precision,
  computed_at    timestamptz not null default now(),
  trigger        text not null default 'quarterly',  -- quarterly | pre_gate_hard_trigger
  created_at     timestamptz not null default now()
);

-- RLS disabled to match subscribers/credits — server-only access via the
-- service_role key, same rationale documented in the Build Log (RLS blocks
-- upserts and provides no value for a service-role-only table).
alter table public.proxy_resolution disable row level security;

-- ── PATCH 3 — Pre-Gate soft-trigger escalation history ──────────────
-- One row per detected soft trigger (dilution / guidance-cut language found
-- in a SEC filing). 2+ rows for the same ticker within a rolling 30 days
-- escalates to hard-trigger (forceDown) treatment. Hard triggers (solvency/
-- going-concern) force DOWN immediately and are not logged here — only soft
-- triggers need history, since hard triggers don't need an escalation count.
create table if not exists public.pre_gate_triggers (
  id                bigint generated always as identity primary key,
  ticker            text not null,
  category          text not null,  -- solvency | dilution | guidanceCut
  hard_or_soft      text not null,  -- always 'soft' in practice today, column kept for completeness
  filing_accession  text,           -- SEC EDGAR accession/hit id, for traceability
  detected_at       timestamptz not null default now(),
  created_at        timestamptz not null default now()
);

create index if not exists pre_gate_triggers_ticker_detected_idx
  on public.pre_gate_triggers (ticker, detected_at);

alter table public.pre_gate_triggers disable row level security;

-- Both tables must be added to Data API -> Exposed tables in the Supabase
-- dashboard (same Apr 2026 breaking change documented in the Build Log for
-- subscribers/credits — new tables are opt-in unless "Automatically expose
-- new tables" is already toggled on for this project).
