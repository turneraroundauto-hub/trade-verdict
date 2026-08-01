-- Trade Verdict — Patch 4 (subscription history tracking)
-- Run manually in the Supabase SQL editor before deploying this server.js
-- to Render.
--
-- Problem: the tier-mismatch login flow (Starter page, user logged in but
-- their subscriber row resolves to tier=free) could not tell a brand-new
-- signup (never paid) apart from a lapsed/cancelled Starter subscriber —
-- both produce an identical row: tier='free', status='active',
-- stripe_customer_id/stripe_subscription_id both null. That's because
-- upsertSubscriber() writes the exact same shape from /auth/signup and
-- from the customer.subscription.deleted webhook.
--
-- Fix: a has_subscribed flag that is set true the moment a subscriber
-- is ever upgraded to a paid tier (starter/pro/shark) via Stripe, and is
-- never cleared again — including when their subscription later lapses
-- and their tier row is reset back to 'free'. server.js's
-- upsertSubscriber() now only includes has_subscribed in its upsert
-- payload when explicitly marking it true, so the column is left
-- untouched (not reset) on every other call, e.g. cancellation.

alter table public.subscribers
  add column if not exists has_subscribed boolean not null default false;

-- Backfill: any row that already shows an active paid tier today has,
-- by definition, subscribed before — mark it so lapses are recognized
-- correctly from day one instead of looking like a fresh signup.
update public.subscribers
  set has_subscribed = true
  where tier in ('starter', 'pro', 'shark');
