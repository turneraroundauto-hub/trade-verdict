-- Trade Tribunal — Patch 26 (tester sign-up form, /testers/)
-- Applied via Supabase MCP. testers/index.html inserts directly from the
-- browser with the public anon key. anon gets column-level INSERT only —
-- it can never read the list (phone numbers are PII). Read it from the
-- table editor (service_role).
create table if not exists public.tester_signups (
  id bigint generated always as identity primary key,
  email text not null unique check (char_length(email) between 5 and 254 and email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  phone text not null check (char_length(phone) between 7 and 20 and phone ~ '^[0-9+()\-. ]+$'),
  device text check (device is null or device in ('android','iphone','other')),
  created_at timestamptz not null default now()
);
alter table public.tester_signups enable row level security;
revoke all on public.tester_signups from anon, authenticated;
grant insert (email, phone, device) on public.tester_signups to anon;
create policy "anon can sign up as tester" on public.tester_signups for insert to anon with check (true);
-- If this table has to be added under Data API -> Exposed tables, re-run the
-- grants check right after (that toggle has re-granted anon full access on
-- this project before) and re-apply the revoke + insert-only grant above.
