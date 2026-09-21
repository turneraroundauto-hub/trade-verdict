-- Patch 17: push_subscriptions -- anonymous, account-free web push.
--
-- Keyed to the same device_id every tier already generates for the
-- Sep 17, 2026 device-visit counter (shared/device-id.ts / device_visits)
-- -- not to a person. No email, no phone number, nothing requested from
-- the visitor beyond the browser's own native "Allow notifications?"
-- permission prompt. See push-notifications.js and CLAUDE.md, "Anonymous
-- per-device push notifications".
--
-- Applied directly against production via the Supabase MCP connection
-- (Sep 2026). This file is the historical/reviewable record of that
-- change, same convention as every other supabase-ddl-patch*.sql in this
-- repo -- it is not run automatically by anything.
--
-- Same two-step pattern every service-role-only table in this project
-- uses (CLAUDE.md, "Supabase tables: 'RLS disabled' != 'access blocked'"):
-- `disable row level security` run as its OWN separate execution (bundling
-- it with the `create table` above it has not reliably stuck on this
-- project before), then an explicit `revoke all ... from anon,
-- authenticated` -- disabling RLS alone does nothing about the underlying
-- anon/authenticated role GRANTs. Verify with the standard query:
--   select grantee, table_name, privilege_type
--   from information_schema.role_table_grants
--   where table_schema = 'public' and table_name = 'push_subscriptions'
--     and grantee in ('anon','authenticated');
-- Zero rows back is the only thing that actually confirms it closed.

create table if not exists public.push_subscriptions (
  device_id  text primary key,
  endpoint   text not null,
  p256dh     text not null,
  auth       text not null,
  tier       text,
  disabled   boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.push_subscriptions is
  'Anonymous per-device web push subscriptions. No PII -- see push-notifications.js.';

-- Run as its own separate step, after the table above already exists:
-- alter table public.push_subscriptions disable row level security;

-- Run as its own separate step, after the RLS-disable above:
-- revoke all on public.push_subscriptions from anon, authenticated;
