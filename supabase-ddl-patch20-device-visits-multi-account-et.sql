-- Mirror only -- real migration applied live via Supabase MCP (project
-- oinomcikdyisrbfeeirp) and committed as this same PR's patch19 in Tra;
-- this repo's server.js /device-ping mirror was updated in the same PR.
--
-- Supersedes patch19 (device_accounts): direct correction, verbatim --
-- "I specifically ask you to change the timestamps and the user email
-- correlation in the device visit table. NO OTHER TABLE WAS MENTIONED."
-- The separate device_accounts table from patch19 was a reasonable design
-- on its own, but it wasn't what was asked for -- the multi-account fix and
-- the ET-display fix both belong inside device_visits itself. This
-- migration folds device_accounts back into device_visits and drops it.
--
-- device_visits used to be keyed by device_id alone, with a single
-- user_email column holding whichever account last pinged -- so a shared/
-- multi-account device silently lost the earlier account's association the
-- moment a second account signed in. Re-keyed to (device_id, user_email):
-- an anonymous ping now writes '' (empty string, not NULL -- Postgres
-- treats every NULL as distinct within a unique/PK constraint, which would
-- insert a fresh "anonymous" row on every single anonymous ping instead of
-- updating one running counter) for user_email; a signed-in ping writes the
-- real account email. A device used by 2+ accounts now gets one row per
-- account, never collapsing one login's history into another's.
--
-- first_seen_et/last_seen_et: plain Eastern-time text columns, written
-- directly on device_visits by device-ping's own etTimestampStr() helper
-- (server.js) alongside the real (always-UTC) timestamptz columns -- so the
-- table itself reads in ET without depending on Supabase Studio's own
-- display settings, which is what was actually being seen as "still UTC."
--
-- See Tra's patch19 for the full step-by-step and the real verification
-- (both accounts on the one genuinely shared device now showing as
-- separate device_visits rows with real ET timestamps, device_accounts
-- confirmed dropped, standard grants-check re-run clean).
alter table public.device_visits add column if not exists first_seen_et text;
alter table public.device_visits add column if not exists last_seen_et text;

update public.device_visits set user_email = '' where user_email is null;
alter table public.device_visits alter column user_email set default '';
alter table public.device_visits alter column user_email set not null;

alter table public.device_visits drop constraint device_visits_pkey;
alter table public.device_visits add primary key (device_id, user_email);

insert into public.device_visits (device_id, user_email, first_seen_at, last_seen_at, visit_count, platform, first_tier)
select da.device_id, da.user_email, da.first_seen_at, da.last_seen_at, da.visit_count,
       coalesce(dv.platform, 'web'), dv.first_tier
from public.device_accounts da
left join public.device_visits dv on dv.device_id = da.device_id
where not exists (
  select 1 from public.device_visits dv2
  where dv2.device_id = da.device_id and dv2.user_email = da.user_email
);

update public.device_visits
set first_seen_et = to_char(first_seen_at at time zone 'America/New_York', 'YYYY-MM-DD HH24:MI:SS') || ' ET',
    last_seen_et  = to_char(last_seen_at  at time zone 'America/New_York', 'YYYY-MM-DD HH24:MI:SS') || ' ET'
where first_seen_et is null or last_seen_et is null;

drop table public.device_accounts;

comment on table public.device_visits is
  'Anonymous per-device visit counter, one row per (device_id, user_email) pair -- an anonymous ping uses the empty-string sentinel for user_email, a signed-in ping uses the real account email, so a device used by 2+ accounts gets a row per account rather than collapsing to the last one. device_id is a random UUID the client generates and stores in localStorage. No IP, user-agent is ever stored here. first_seen_et/last_seen_et are plain Eastern-time text siblings of the real (UTC) timestamptz columns, for reading directly in the table editor.';

comment on column public.device_visits.user_email is
  'The signed-in account this row belongs to, or '''' for the device''s own anonymous activity. Part of the primary key alongside device_id -- never overwritten by a different account, never collapsed.';
