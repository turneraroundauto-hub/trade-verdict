-- Trade Verdict — Patch 5 (Supabase-backed credits storage)
-- Run manually in the Supabase SQL editor before deploying this
-- server.js/credits.js to Render.
--
-- Problem: credits.js stored every user's balance in a JSON file on the
-- Render web service's local disk (credits.json). That disk is ephemeral
-- on Render's default plans — every deploy or restart silently wiped
-- every user's credits, which looked exactly like "credits are broken."
--
-- Fix: move the store into Supabase (already used for auth/subscribers),
-- with every mutation going through an atomic Postgres function instead
-- of app-level read-then-write. That matters because "Analyze All" fires
-- one /analyze call per watchlist ticker concurrently — a naive read/
-- modify/write over the network could let two concurrent deducts both
-- read the same pre-deduction balance and double-spend it. Expressing
-- each deduction as a single locked UPDATE closes that gap.
--
-- Table is named user_credits, not credits — this repo never had a
-- credits.js or a credits table DDL committed to it before this patch
-- chain, so if a differently-shaped `credits` table already exists in
-- this Supabase project from before, it is NOT reused here. Check first;
-- adjust the table/function names below if you want to migrate that data
-- in instead of starting fresh.

create table if not exists public.user_credits (
  key                 text primary key,        -- 'sub:<email>' | 'ip:<addr>' | legacy tier secret
  tier                text not null default 'free',
  credits             integer not null default 0,   -- weekly (free) / monthly (paid) allowance balance
  purchased_credits   integer not null default 0,    -- from $0.99/10-credit purchases — never expire, never reset
  last_reset          text not null default to_char(now(), 'YYYY-MM'),                    -- monthly reset marker (paid tiers)
  last_weekly_reset   bigint not null default floor(extract(epoch from now()) / 604800),   -- weekly reset marker (free tier)
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- RLS disabled to match subscribers' style — server-only access via the
-- service_role key (server.js never uses the anon key for this table).
alter table public.user_credits disable row level security;

-- ── get_or_create_user_credits ──────────────────────────────────────
-- Ensures a row exists for p_key, applies the weekly (free) or monthly
-- (paid) reset if due, keeps tier in sync with the authoritative tier
-- passed in from the app — this row is a cache, not the source of truth
-- for who's on what plan; server.js resolves the real tier from the
-- subscribers table on every request — and returns the current row.
-- The INSERT ... ON CONFLICT DO UPDATE is a get-or-create in one atomic,
-- row-locking statement, so two concurrent first-touches of the same new
-- key can't both try to INSERT and collide.
create or replace function public.get_or_create_user_credits(p_key text, p_tier text default null)
returns setof public.user_credits as $$
declare
  v_tier    text := coalesce(p_tier, 'free');
  v_start   int;
  v_monthly int;
  v_roll    int;
  v_week    bigint := floor(extract(epoch from now()) / 604800);
  v_month   text   := to_char(now(), 'YYYY-MM');
  v_row     public.user_credits%rowtype;
begin
  case v_tier
    when 'starter' then v_start := 0; v_monthly := 45;  v_roll := 45;
    when 'pro'     then v_start := 0; v_monthly := 100; v_roll := 45;
    when 'shark'   then v_start := 0; v_monthly := 145; v_roll := 45;
    else                v_start := 3; v_monthly := 0;   v_roll := 0;
  end case;

  insert into public.user_credits (key, tier, credits, purchased_credits, last_reset, last_weekly_reset)
  values (p_key, v_tier, v_start, 0, v_month, v_week)
  on conflict (key) do update set updated_at = public.user_credits.updated_at
  returning * into v_row;

  if p_tier is not null and v_row.tier <> p_tier then
    v_tier := p_tier;
    case v_tier
      when 'starter' then v_start := 0; v_monthly := 45;  v_roll := 45;
      when 'pro'     then v_start := 0; v_monthly := 100; v_roll := 45;
      when 'shark'   then v_start := 0; v_monthly := 145; v_roll := 45;
      else                v_start := 3; v_monthly := 0;   v_roll := 0;
    end case;
    update public.user_credits set tier = v_tier, updated_at = now()
      where key = p_key returning * into v_row;
  else
    v_tier := v_row.tier;
  end if;

  if v_tier = 'free' then
    if v_row.last_weekly_reset <> v_week then
      update public.user_credits
        set credits = v_start, last_weekly_reset = v_week, updated_at = now()
        where key = p_key returning * into v_row;
    end if;
  else
    if v_row.last_reset <> v_month then
      update public.user_credits
        set credits = least(greatest(v_row.credits, 0), v_roll) + v_monthly,
            last_reset = v_month, updated_at = now()
        where key = p_key returning * into v_row;
    end if;
  end if;

  return next v_row;
end;
$$ language plpgsql;

-- ── deduct_user_credit ──────────────────────────────────────────────
-- 1 credit = 1 ticker analysis (server.js calls this once per /analyze,
-- before the Anthropic call). Applies reset via get_or_create_user_credits
-- (which holds the row lock from its INSERT..ON CONFLICT for the rest of
-- this transaction), then spends purchased_credits first, then credits —
-- atomically, so concurrent deducts for the same key can't both pass the
-- balance check against the same stale balance.
create or replace function public.deduct_user_credit(p_key text, p_tier text default null, p_count int default 1)
returns table(success boolean, credits int, purchased_credits int, tier text) as $$
declare
  v_row public.user_credits%rowtype;
begin
  select * into v_row from public.get_or_create_user_credits(p_key, p_tier);

  if (v_row.credits + v_row.purchased_credits) < p_count then
    return query select false, v_row.credits, v_row.purchased_credits, v_row.tier;
    return;
  end if;

  if v_row.purchased_credits >= p_count then
    update public.user_credits
      set purchased_credits = purchased_credits - p_count, updated_at = now()
      where key = p_key returning * into v_row;
  else
    update public.user_credits
      set credits = credits - (p_count - purchased_credits),
          purchased_credits = 0,
          updated_at = now()
      where key = p_key returning * into v_row;
  end if;

  return query select true, v_row.credits, v_row.purchased_credits, v_row.tier;
end;
$$ language plpgsql;

-- ── add_purchased_credits ───────────────────────────────────────────
-- The $0.99/10-credit top-up. Purchased credits never expire and are
-- never touched by weekly/monthly resets.
create or replace function public.add_purchased_credits(p_key text, p_tier text default null, p_count int default 0)
returns setof public.user_credits as $$
declare
  v_tier  text := coalesce(p_tier, 'free');
  v_start int;
  v_week  bigint := floor(extract(epoch from now()) / 604800);
  v_month text   := to_char(now(), 'YYYY-MM');
  v_row   public.user_credits%rowtype;
begin
  v_start := case when v_tier = 'free' then 3 else 0 end;

  insert into public.user_credits (key, tier, credits, purchased_credits, last_reset, last_weekly_reset)
  values (p_key, v_tier, v_start, p_count, v_month, v_week)
  on conflict (key) do update
    set purchased_credits = public.user_credits.purchased_credits + p_count,
        updated_at = now()
  returning * into v_row;

  return next v_row;
end;
$$ language plpgsql;

-- ── upgrade_user_tier ───────────────────────────────────────────────
-- Stripe subscription created/updated/renewed: switch tier and grant
-- this cycle's allowance (rollover capped per-tier), same semantics as
-- the old in-memory upgradeTier().
create or replace function public.upgrade_user_tier(p_key text, p_new_tier text)
returns setof public.user_credits as $$
declare
  v_monthly int;
  v_roll    int;
  v_row     public.user_credits%rowtype;
begin
  case p_new_tier
    when 'starter' then v_monthly := 45;  v_roll := 45;
    when 'pro'     then v_monthly := 100; v_roll := 45;
    when 'shark'   then v_monthly := 145; v_roll := 45;
    else                v_monthly := 0;   v_roll := 0;
  end case;

  select * into v_row from public.get_or_create_user_credits(p_key, p_new_tier);

  update public.user_credits
    set tier       = p_new_tier,
        credits    = least(greatest(v_row.credits, 0), v_roll) + v_monthly,
        last_reset = to_char(now(), 'YYYY-MM'),
        updated_at = now()
    where key = p_key
    returning * into v_row;

  return next v_row;
end;
$$ language plpgsql;

-- ── set_user_tier ───────────────────────────────────────────────────
-- Tier-only sync, no credit change — used on subscription cancellation
-- (downgrade to free, credits preserved). get_or_create_user_credits
-- already syncs the tier field when p_tier differs from the stored one,
-- so this is just that call under a clearer name for the call site.
create or replace function public.set_user_tier(p_key text, p_new_tier text)
returns setof public.user_credits as $$
begin
  return query select * from public.get_or_create_user_credits(p_key, p_new_tier);
end;
$$ language plpgsql;

-- Must be added to Data API -> Exposed tables in the Supabase dashboard
-- (same opt-in step noted in patch2-3.sql) before server.js's supabase-js
-- client can call these functions or select from this table.
