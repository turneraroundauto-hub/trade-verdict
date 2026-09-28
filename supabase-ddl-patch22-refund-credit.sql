-- ════════════════════════════════════════════════════════════════════
-- Patch 22 — refund_user_credit (Sep 28, 2026)
-- ════════════════════════════════════════════════════════════════════
-- /analyze deducts 1 analysis BEFORE calling Anthropic (deduct_user_credit,
-- patch5). When that call then fails (Anthropic outage / account usage
-- cap / timeout / unparseable response) the user got no verdict but still
-- paid. This exactly reverses one deduct: rolls pending_analyses back, and
-- if that crosses a whole-credit boundary (deduct had spent a credit),
-- restores it as a purchased credit (never expires, can't be wiped by a
-- weekly/monthly reset). Total balance ends up exactly where it started.
--
-- Applied directly via Supabase MCP. Unlike the other credit RPCs, EXECUTE
-- is explicitly revoked from anon/authenticated: this function can CREATE
-- credits, so it must never be callable with the public anon key, even
-- though the credits table's own grants would already block it.
create or replace function public.refund_user_credit(p_key text, p_count int default 1)
returns table(success boolean, credits int, purchased_credits int, tier text)
language plpgsql
set search_path = ''
as $$
declare
  v_row     public.credits%rowtype;
  v_pending int;
  v_restore int := 0;
begin
  select * into v_row from public.credits as c where c.api_key = p_key for update;
  if not found then
    return query select false, null::int, null::int, null::text;
    return;
  end if;

  v_pending := coalesce(v_row.pending_analyses, 0) - p_count;
  while v_pending < 0 loop
    v_pending := v_pending + 3;
    v_restore := v_restore + 1;
  end loop;

  update public.credits as c
    set pending_analyses  = v_pending,
        purchased_credits = c.purchased_credits + v_restore,
        updated_at        = now()
    where c.api_key = p_key
    returning c.* into v_row;

  return query select true, v_row.credits, v_row.purchased_credits, v_row.tier;
end;
$$;

revoke all on function public.refund_user_credit(text, int) from public, anon, authenticated;
grant execute on function public.refund_user_credit(text, int) to service_role;
