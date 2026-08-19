create or replace function public.zt_skip_warranty_renewal_on_warranty_visit()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1 from public.work_orders w
    where w.id = new.work_order_id
      and w.company_id = new.company_id
      and w.is_warranty_visit = true
  ) then
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_skip_warranty_renewal_on_visit on public.warranties;
create trigger trg_skip_warranty_renewal_on_visit
before insert on public.warranties
for each row execute function public.zt_skip_warranty_renewal_on_warranty_visit();

revoke all on function public.zt_skip_warranty_renewal_on_warranty_visit() from public, anon, authenticated;
