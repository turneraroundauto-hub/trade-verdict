-- Trade Verdict — Patch 7 (Shark "coming soon" email waitlist)
-- Run manually in the Supabase SQL editor. No backend deploy needed —
-- shark/coming-soon.html writes to this table directly from the browser
-- using the anon key already embedded in every tier's frontend.

create table if not exists public.shark_waitlist (
  id bigint generated always as identity primary key,
  email text not null unique,
  created_at timestamptz not null default now()
);

alter table public.shark_waitlist enable row level security;

-- Anonymous visitors may INSERT (submit their email) but cannot SELECT,
-- UPDATE, or DELETE — no policy is created for those, so PostgREST denies
-- them by default. Read the list from the Supabase table editor
-- (service_role bypasses RLS there) or add a server-only export route
-- later if needed.
create policy "anon can join shark waitlist"
  on public.shark_waitlist
  for insert
  to anon
  with check (true);

-- Remember: Data API → Exposed tables requires this table to be listed
-- (or "Automatically expose new tables" left ON) before PostgREST will
-- serve it — same gotcha as every other table added to this project.
