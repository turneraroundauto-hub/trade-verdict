-- Trade Verdict — Patch 5 (Supabase-backed credits storage)
-- Run manually in the Supabase SQL editor before deploying this
-- server.js/credits.js to Render.
--
-- Problem: credits.js stored every user's balance in a JSON file on the
-- Render web service's local disk (credits.json). That disk is ephemeral
-- on Render's default plans — every deploy or restart silently wiped
-- every user's credits, which looked exactly like "credits are broken."
--
-- Fix: point every mutation at the public.credits table that already
-- exists in this Supabase project (columns confirmed via
-- information_schema.columns: api_key, tier, credits, purchased_credits,
-- last_reset, last_daily_drip, created_at, updated_at) via atomic
-- Postgres functions instead of app-level read-then-write. That matters
-- beyond durability: "Analyze All" fires one /analyze call per watchlist
-- ticker concurrently, and a naive read/modify/write over the network
-- could let two concurrent deducts both read the same pre-deduction
-- balance and double-spend it. Expressing each deduction as a single
-- locked UPDATE closes that gap.
--
-- last_daily_drip is renamed to last_weekly_reset below. Its name
-- suggests the original design intended a daily trickle of credits
-- rather than a hard periodic reset — that column was otherwise unused
-- (no code in this repo ever read or wrote it), so it's repurposed here
-- to track the free tier's weekly reset instead, per an explicit
-- product decision to cap anonymous/free usage at 3 credits/week rather
-- than a daily drip. The rename is a metadata-only operation (no data
-- rewrite) and is idempotent — safe to run again.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'credits' and column_name = 'last_daily_drip'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'credits' and column_name = 'last_weekly_reset'
  ) then
    alter table public.credits rename column last_daily_drip to last_weekly_reset;
  end if;
end $$;

-- Guarantees a unique index on api_key so the ON CONFLICT (api_key)
-- upserts below work, regardless of whether api_key was already
-- declared as this table's primary key. Harmless/no-op if one already
-- exists.
create unique index if not exists credits_api_key_idx on public.credits (api_key);

-- RLS disabled to match this table's existing style — server-only
-- access via the service_role key (server.js never uses the anon key
-- for this table). No-op if already disabled.
alter table public.credits disable row level security;

-- ── get_or_create_user_credits ──────────────────────────────────────
-- Ensures a row exists for p_key, applies the weekly (free) or monthly
-- (paid) reset if due, keeps tier in sync with the authoritative tier
-- passed in from the app — this row is a cache, not the source of truth
-- for who's on what plan; server.js resolves the real tier from the
-- subscribers table on every request — and returns the current row.
-- The INSERT ... ON CONFLICT DO UPDATE is a get-or-create in one atomic,
-- row-locking statement, so two concurrent first-touches of the same new
-- key can't both try to INSERT and collide. Reset comparisons use
-- IS DISTINCT FROM (not <>) so a legacy row with last_reset/
-- last_weekly_reset still NULL from before this migration reliably
-- triggers its first reset instead of silently never resetting.
create or replace function public.get_or_create_user_credits(p_key text, p_tier text default null)
returns setof public.credits as $$
declare
  v_tier    text := coalesce(p_tier, 'free');
  v_start   int;
  v_monthly int;
  v_roll    int;
  v_week    text := floor(extract(epoch from now()) / 604800)::text;
  v_month   text := to_char(now(), 'YYYY-MM');
  v_row     public.credits%rowtype;
begin
  case v_tier
    when 'starter' then v_start := 0; v_monthly := 45;  v_roll := 45;
    when 'pro'     then v_start := 0; v_monthly := 100; v_roll := 45;
    when 'shark'   then v_start := 0; v_monthly := 145; v_roll := 45;
    else                v_start := 3; v_monthly := 0;   v_roll := 0;
  end case;

  insert into public.credits (api_key, tier, credits, purchased_credits, last_reset, last_weekly_reset)
  values (p_key, v_tier, v_start, 0, v_month, v_week)
  on conflict (api_key) do update set updated_at = public.credits.updated_at
  returning * into v_row;

  if p_tier is not null and v_row.tier <> p_tier then
    v_tier := p_tier;
    case v_tier
      when 'starter' then v_start := 0; v_monthly := 45;  v_roll := 45;
      when 'pro'     then v_start := 0; v_monthly := 100; v_roll := 45;
      when 'shark'   then v_start := 0; v_monthly := 145; v_roll := 45;
      else                v_start := 3; v_monthly := 0;   v_roll := 0;
    end case;
    update public.credits set tier = v_tier, updated_at = now()
      where api_key = p_key returning * into v_row;
  else
    v_tier := v_row.tier;
  end if;

  if v_tier = 'free' then
    if v_row.last_weekly_reset is distinct from v_week then
      update public.credits
        set credits = v_start, last_weekly_reset = v_week, updated_at = now()
        where api_key = p_key returning * into v_row;
    end if;
  else
    if v_row.last_reset is distinct from v_month then
      update public.credits
        set credits = least(greatest(v_row.credits, 0), v_roll) + v_monthly,
            last_reset = v_month, updated_at = now()
        where api_key = p_key returning * into v_row;
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
  v_row public.credits%rowtype;
begin
  select * into v_row from public.get_or_create_user_credits(p_key, p_tier);

  if (v_row.credits + v_row.purchased_credits) < p_count then
    return query select false, v_row.credits, v_row.purchased_credits, v_row.tier;
    return;
  end if;

  if v_row.purchased_credits >= p_count then
    update public.credits
      set purchased_credits = purchased_credits - p_count, updated_at = now()
      where api_key = p_key returning * into v_row;
  else
    update public.credits
      set credits = credits - (p_count - purchased_credits),
          purchased_credits = 0,
          updated_at = now()
      where api_key = p_key returning * into v_row;
  end if;

  return query select true, v_row.credits, v_row.purchased_credits, v_row.tier;
end;
$$ language plpgsql;

-- ── add_purchased_credits ───────────────────────────────────────────
-- The $0.99/10-credit top-up. Purchased credits never expire and are
-- never touched by weekly/monthly resets.
create or replace function public.add_purchased_credits(p_key text, p_tier text default null, p_count int default 0)
returns setof public.credits as $$
declare
  v_tier  text := coalesce(p_tier, 'free');
  v_start int;
  v_week  text := floor(extract(epoch from now()) / 604800)::text;
  v_month text := to_char(now(), 'YYYY-MM');
  v_row   public.credits%rowtype;
begin
  v_start := case when v_tier = 'free' then 3 else 0 end;

  insert into public.credits (api_key, tier, credits, purchased_credits, last_reset, last_weekly_reset)
  values (p_key, v_tier, v_start, p_count, v_month, v_week)
  on conflict (api_key) do update
    set purchased_credits = public.credits.purchased_credits + p_count,
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
returns setof public.credits as $$
declare
  v_monthly int;
  v_roll    int;
  v_row     public.credits%rowtype;
begin
  case p_new_tier
    when 'starter' then v_monthly := 45;  v_roll := 45;
    when 'pro'     then v_monthly := 100; v_roll := 45;
    when 'shark'   then v_monthly := 145; v_roll := 45;
    else                v_monthly := 0;   v_roll := 0;
  end case;

  select * into v_row from public.get_or_create_user_credits(p_key, p_new_tier);

  update public.credits
    set tier       = p_new_tier,
        credits    = least(greatest(v_row.credits, 0), v_roll) + v_monthly,
        last_reset = to_char(now(), 'YYYY-MM'),
        updated_at = now()
    where api_key = p_key
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
returns setof public.credits as $$
begin
  return query select * from public.get_or_create_user_credits(p_key, p_new_tier);
end;
$$ language plpgsql;

-- If public.credits isn't already exposed via Data API -> Exposed
-- tables in the Supabase dashboard, add it there before server.js's
-- supabase-js client can call these functions or select from the table.
