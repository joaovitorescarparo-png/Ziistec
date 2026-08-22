create or replace function public.zt_guard_subscription_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
begin
  v_company := case when tg_op = 'DELETE' then old.company_id else new.company_id end;
  perform zt_private.assert_operational_write_allowed(v_company);
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.zt_guard_subscription_write() from public, anon, authenticated;
