create function public.zt_guard_tenant_record_identity()
returns trigger language plpgsql security invoker set search_path=public
as $$
begin
  if current_user <> 'authenticated' then return new; end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    return new;
  end if;
  new.company_id := old.company_id;
  if to_jsonb(new) ? 'number' then new.number := old.number; end if;
  new.created_by := old.created_by;
  return new;
end $$;

create function public.zt_guard_work_order_assignment()
returns trigger language plpgsql security invoker set search_path=public
as $$
begin
  if current_user <> 'authenticated' then return new; end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  else
    new.company_id := old.company_id;
    new.number := old.number;
    new.created_by := old.created_by;
  end if;
  if new.assigned_to is not null and not exists (
    select 1 from public.company_members m
    where m.company_id=new.company_id and m.user_id=new.assigned_to and m.status='active'
  ) then
    raise exception 'Responsável precisa ser membro ativo da empresa' using errcode='23503';
  end if;
  return new;
end $$;

drop trigger if exists zt_guard_work_order_identity on public.work_orders;
create trigger zt_guard_work_order_identity before insert or update on public.work_orders
for each row execute function public.zt_guard_work_order_assignment();
drop trigger if exists zt_guard_quote_identity on public.quotes;
create trigger zt_guard_quote_identity before insert or update on public.quotes
for each row execute function public.zt_guard_tenant_record_identity();
drop trigger if exists zt_guard_purchase_identity on public.purchases;
create trigger zt_guard_purchase_identity before insert or update on public.purchases
for each row execute function public.zt_guard_tenant_record_identity();

revoke execute on function public.zt_guard_tenant_record_identity() from public, anon, authenticated;
revoke execute on function public.zt_guard_work_order_assignment() from public, anon, authenticated;
