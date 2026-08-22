create or replace function zt_private.assert_operational_write_allowed(p_company uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status public.zt_sub_status;
  v_end date;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado' using errcode='28000';
  end if;

  select s.status, s.current_period_end
    into v_status, v_end
    from public.subscriptions s
   where s.company_id = p_company;

  if not found then
    raise exception 'Assinatura não encontrada' using errcode='42501';
  end if;

  if v_status not in ('trial','active')
     or (v_end is not null and v_end < current_date) then
    raise exception 'Assinatura inativa' using errcode='42501';
  end if;
end;
$$;

revoke all on function zt_private.assert_operational_write_allowed(uuid) from public, anon, authenticated;

create or replace function public.zt_guard_subscription_write()
returns trigger
language plpgsql
security invoker
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

do $$
declare
  t text;
begin
  foreach t in array array[
    'clients','services','products','quotes','quote_items','work_orders','work_order_items',
    'work_order_materials','work_order_reports','work_order_checklists','financial_entries',
    'purchases','purchase_items','attachments','warranties','post_sale_followups','suppliers'
  ]
  loop
    execute format('drop trigger if exists trg_subscription_write_guard on public.%I', t);
    execute format(
      'create trigger trg_subscription_write_guard before insert or update or delete on public.%I for each row execute function public.zt_guard_subscription_write()',
      t
    );
  end loop;
end $$;
