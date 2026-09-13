-- ZiisTec V2: override de garantia por item da OS, sem alterar o catálogo.
-- Regras:
--   * padrão: usa services.warranty_days / products.warranty_months;
--   * disabled: não gera garantia para aquele item naquela OS;
--   * custom: owner define prazo específico só para aquele item/OS;
--   * técnico nunca define ou altera override;
--   * OS concluída preserva a decisão como histórico imutável.

alter table public.work_order_items
  add column if not exists warranty_policy text not null default 'catalog',
  add column if not exists warranty_override_days integer,
  add column if not exists warranty_override_months integer;

alter table public.work_order_items drop constraint if exists work_order_items_warranty_policy_check;
alter table public.work_order_items add constraint work_order_items_warranty_policy_check
  check (warranty_policy in ('catalog','disabled','custom'));

alter table public.work_order_items drop constraint if exists work_order_items_warranty_override_check;
alter table public.work_order_items add constraint work_order_items_warranty_override_check
  check (
    (warranty_policy in ('catalog','disabled')
      and warranty_override_days is null
      and warranty_override_months is null)
    or
    (warranty_policy='custom' and (
      (service_id is not null and product_id is null
        and warranty_override_days between 1 and 3650
        and warranty_override_months is null)
      or
      (product_id is not null and service_id is null
        and warranty_override_months between 1 and 120
        and warranty_override_days is null)
    ))
  );

comment on column public.work_order_items.warranty_policy is
  'Garantia desta linha da OS: catalog usa o cadastro, disabled não gera, custom usa override.';
comment on column public.work_order_items.warranty_override_days is
  'Prazo customizado em dias para item de serviço; somente owner.';
comment on column public.work_order_items.warranty_override_months is
  'Prazo customizado em meses para item de produto; somente owner.';

-- Técnico continua podendo lançar adicional pendente, mas não consegue injetar
-- configuração administrativa de garantia no próprio INSERT.
drop policy if exists p_wo_items_insert on public.work_order_items;
create policy p_wo_items_insert on public.work_order_items
  for insert to authenticated
  with check (
    public.zt_wo_is_owned(work_order_id)
    or (
      public.zt_wo_is_mine(work_order_id)
      and public.zt_wo_open(work_order_id)
      and is_extra=true
      and price_pending=true
      and unit_price=0
      and unit_cost=0
      and warranty_policy='catalog'
      and warranty_override_days is null
      and warranty_override_months is null
    )
  );

-- Aplica somente overrides explicitamente enviados. Itens omitidos mantêm sua
-- configuração atual; para voltar ao padrão envie policy='catalog'.
create or replace function zt_private.zt_apply_work_order_warranty_overrides(
  p_wo uuid,
  p_overrides jsonb default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wo public.work_orders%rowtype;
  r jsonb;
  v_item uuid;
  v_policy text;
  v_days integer;
  v_months integer;
  v_service uuid;
  v_product uuid;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado' using errcode='28000';
  end if;

  select * into v_wo
    from public.work_orders
   where id=p_wo
   for update;
  if not found then
    raise exception 'Ordem de serviço não encontrada' using errcode='P0002';
  end if;
  if not zt_private.is_owner(v_wo.company_id) then
    raise exception 'Somente o proprietário pode alterar a garantia desta OS' using errcode='42501';
  end if;
  if v_wo.status='done' then
    raise exception 'OS concluída não pode ter garantia alterada' using errcode='42501';
  end if;

  if jsonb_typeof(coalesce(p_overrides,'[]'::jsonb)) <> 'array' then
    raise exception 'Overrides de garantia precisam ser uma lista' using errcode='22023';
  end if;
  if jsonb_array_length(coalesce(p_overrides,'[]'::jsonb)) > 500 then
    raise exception 'Overrides de garantia excedem o limite' using errcode='22023';
  end if;

  for r in select value from jsonb_array_elements(coalesce(p_overrides,'[]'::jsonb))
  loop
    begin
      v_item := nullif(r->>'item_id','')::uuid;
    exception when invalid_text_representation then
      raise exception 'Item inválido no override de garantia' using errcode='22023';
    end;
    if v_item is null then
      raise exception 'Informe o item do override de garantia' using errcode='22023';
    end if;

    select i.service_id,i.product_id
      into v_service,v_product
      from public.work_order_items i
     where i.id=v_item
       and i.work_order_id=p_wo
       and i.company_id=v_wo.company_id
     for update;
    if not found then
      raise exception 'Item não pertence a esta OS' using errcode='42501';
    end if;

    v_policy := coalesce(nullif(r->>'policy',''),nullif(r->>'mode',''),'catalog');
    if v_policy not in ('catalog','disabled','custom') then
      raise exception 'Política de garantia inválida' using errcode='22023';
    end if;

    if v_policy='custom' then
      if v_service is not null and v_product is null then
        begin v_days := nullif(r->>'days','')::integer;
        exception when invalid_text_representation then raise exception 'Prazo em dias inválido' using errcode='22023'; end;
        if v_days is null or v_days < 1 or v_days > 3650 then
          raise exception 'Prazo de serviço deve ficar entre 1 e 3650 dias' using errcode='22023';
        end if;
        v_months := null;
      elsif v_product is not null and v_service is null then
        begin v_months := nullif(r->>'months','')::integer;
        exception when invalid_text_representation then raise exception 'Prazo em meses inválido' using errcode='22023'; end;
        if v_months is null or v_months < 1 or v_months > 120 then
          raise exception 'Prazo de produto deve ficar entre 1 e 120 meses' using errcode='22023';
        end if;
        v_days := null;
      else
        raise exception 'Prazo personalizado exige item de serviço ou produto' using errcode='22023';
      end if;
    else
      v_days := null;
      v_months := null;
    end if;

    update public.work_order_items
       set warranty_policy=v_policy,
           warranty_override_days=v_days,
           warranty_override_months=v_months
     where id=v_item;
  end loop;
end;
$$;

revoke all on function zt_private.zt_apply_work_order_warranty_overrides(uuid,jsonb)
  from public, anon, authenticated;
grant execute on function zt_private.zt_apply_work_order_warranty_overrides(uuid,jsonb)
  to service_role;

create or replace function public.zt_set_work_order_warranty_overrides(
  p_wo uuid,
  p_overrides jsonb default '[]'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  select zt_private.zt_apply_work_order_warranty_overrides(p_wo,p_overrides);
$$;
revoke all on function public.zt_set_work_order_warranty_overrides(uuid,jsonb)
  from public, anon;
grant execute on function public.zt_set_work_order_warranty_overrides(uuid,jsonb)
  to authenticated, service_role;

-- Finalização central passa a calcular a garantia efetiva linha a linha.
create or replace function zt_private.zt_complete_work_order(
  p_wo uuid,
  p_report text default null,
  p_pending text default null,
  p_extra_cost numeric default null,
  p_due_days integer default 7
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wo public.work_orders%rowtype;
  v_total numeric(12,2);
  v_entry uuid;
  v_uid uuid := auth.uid();
  v_is_owner boolean;
  v_assigned boolean;
  v_pendente boolean;
  v_existing_extra numeric(12,2) := 0;
  v_effective_extra numeric(12,2) := 0;
  v_service_days integer;
  v_product_months integer;
  r record;
begin
  if v_uid is null then
    raise exception 'Não autenticado' using errcode='28000';
  end if;

  select * into v_wo
    from public.work_orders
   where id=p_wo
   for update;
  if v_wo.id is null then
    raise exception 'Ordem de serviço não encontrada' using errcode='42501';
  end if;

  v_is_owner := zt_private.is_owner(v_wo.company_id);
  v_assigned := (v_wo.assigned_to=v_uid) and exists (
    select 1 from public.company_members m
     where m.company_id=v_wo.company_id
       and m.user_id=v_uid
       and m.status='active'
  );
  if not (v_is_owner or v_assigned) then
    raise exception 'Sem permissão para finalizar esta ordem de serviço' using errcode='42501';
  end if;

  if exists (
    select 1 from public.subscriptions s
     where s.company_id=v_wo.company_id
       and s.status in ('suspended','canceled','past_due')
  ) then
    raise exception 'Assinatura inativa' using errcode='42501';
  end if;

  if v_wo.status='done' or v_wo.billing_entry_id is not null then
    return v_wo.billing_entry_id;
  end if;

  select c.extra_cost into v_existing_extra
    from public.work_order_private_costs c
   where c.work_order_id=p_wo
     and c.company_id=v_wo.company_id;
  v_existing_extra := coalesce(v_existing_extra,0);

  if v_is_owner then
    v_effective_extra := case
      when p_extra_cost is null then v_existing_extra
      else greatest(p_extra_cost,0)
    end;
  else
    v_effective_extra := v_existing_extra;
    p_due_days := 7;
  end if;

  p_due_days := greatest(0,least(coalesce(p_due_days,7),365));
  if p_report is not null and length(p_report)>10000 then raise exception 'Relato muito longo'; end if;
  if p_pending is not null and length(p_pending)>5000 then raise exception 'Pendência muito longa'; end if;

  select coalesce(sum(i.quantity*i.unit_price),0)
    into v_total
    from public.work_order_items i
   where i.work_order_id=p_wo;

  select exists(
    select 1 from public.work_order_items i
     where i.work_order_id=p_wo and i.price_pending
  ) into v_pendente;

  update public.work_orders
     set status='done',
         completed_at=now(),
         pending_note=coalesce(p_pending,pending_note),
         extra_cost=v_effective_extra,
         updated_at=now()
   where id=p_wo;

  if p_report is not null and length(trim(p_report))>0 then
    insert into public.work_order_reports(work_order_id,company_id,entry_type,body,author_id)
    values(p_wo,v_wo.company_id,'report',p_report,v_uid);
  end if;

  insert into public.work_order_reports(work_order_id,company_id,entry_type,body,author_id)
  values(p_wo,v_wo.company_id,'history','Serviço concluído',v_uid);

  for r in
    select i.service_id,i.product_id,i.name,
           i.warranty_policy,i.warranty_override_days,i.warranty_override_months,
           s.warranty_days,p.warranty_months
      from public.work_order_items i
      left join public.services s
        on s.id=i.service_id and s.company_id=i.company_id
      left join public.products p
        on p.id=i.product_id and p.company_id=i.company_id
     where i.work_order_id=p_wo
       and i.company_id=v_wo.company_id
  loop
    v_service_days := case
      when r.warranty_policy='disabled' then 0
      when r.warranty_policy='custom' then coalesce(r.warranty_override_days,0)
      else coalesce(r.warranty_days,0)
    end;

    v_product_months := case
      when r.warranty_policy='disabled' then 0
      when r.warranty_policy='custom' then coalesce(r.warranty_override_months,0)
      else coalesce(r.warranty_months,0)
    end;

    if r.service_id is not null and v_service_days>0 then
      insert into public.warranties(
        company_id,client_id,work_order_id,kind,service_id,
        description,service_place,starts_on,ends_on
      ) values(
        v_wo.company_id,v_wo.client_id,p_wo,'service',r.service_id,
        left(r.name,500),v_wo.service_place,current_date,
        current_date+least(v_service_days,3650)
      );
    end if;

    if r.product_id is not null and v_product_months>0 then
      insert into public.warranties(
        company_id,client_id,work_order_id,kind,product_id,
        description,service_place,starts_on,ends_on
      ) values(
        v_wo.company_id,v_wo.client_id,p_wo,'product',r.product_id,
        left(r.name,500),v_wo.service_place,current_date,
        (current_date+(least(v_product_months,120)||' months')::interval)::date
      );
    end if;
  end loop;

  update public.work_orders
     set pending_pricing=v_pendente
   where id=p_wo;

  if v_pendente then
    insert into public.work_order_reports(work_order_id,company_id,entry_type,body,author_id)
    values(
      p_wo,v_wo.company_id,'history',
      'Execução concluída. Há adicional aguardando precificação do proprietário — cobrança não gerada.',
      v_uid
    );
    return null;
  end if;

  if v_total>0 and not v_wo.is_warranty_visit then
    insert into public.financial_entries(
      company_id,kind,description,amount,due_date,
      client_id,work_order_id,category
    ) values(
      v_wo.company_id,'income',left(v_wo.number||' · atendimento',500),v_total,
      current_date+p_due_days,v_wo.client_id,p_wo,'Serviços'
    )
    on conflict (work_order_id) where work_order_id is not null do nothing
    returning id into v_entry;

    if v_entry is null then
      select f.id into v_entry
        from public.financial_entries f
       where f.work_order_id=p_wo;
    end if;

    update public.work_orders
       set billing_entry_id=v_entry
     where id=p_wo;

    insert into public.work_order_reports(work_order_id,company_id,entry_type,body,author_id)
    values(p_wo,v_wo.company_id,'history','Cobrança gerada em contas a receber',v_uid);
  end if;

  return v_entry;
end;
$$;

revoke all on function zt_private.zt_complete_work_order(uuid,text,text,numeric,integer)
  from public, anon, authenticated;
grant execute on function zt_private.zt_complete_work_order(uuid,text,text,numeric,integer)
  to service_role;

-- Nova superfície atômica para a UI. A RPC antiga continua intacta para compatibilidade.
create or replace function zt_private.zt_finalize_work_order_with_warranty_overrides(
  p_wo uuid,
  p_report text default null,
  p_pending text default null,
  p_extra_cost numeric default null,
  p_due_days integer default 7,
  p_materials jsonb default '[]'::jsonb,
  p_additions jsonb default '[]'::jsonb,
  p_warranty_overrides jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_warranty_overrides is not null then
    perform zt_private.zt_apply_work_order_warranty_overrides(p_wo,p_warranty_overrides);
  end if;
  return zt_private.zt_finalize_work_order_atomic(
    p_wo,p_report,p_pending,p_extra_cost,p_due_days,p_materials,p_additions
  );
end;
$$;
revoke all on function zt_private.zt_finalize_work_order_with_warranty_overrides(uuid,text,text,numeric,integer,jsonb,jsonb,jsonb)
  from public, anon, authenticated;
grant execute on function zt_private.zt_finalize_work_order_with_warranty_overrides(uuid,text,text,numeric,integer,jsonb,jsonb,jsonb)
  to service_role;

create or replace function public.zt_finalize_work_order_with_warranty_overrides(
  p_wo uuid,
  p_report text default null,
  p_pending text default null,
  p_extra_cost numeric default null,
  p_due_days integer default 7,
  p_materials jsonb default '[]'::jsonb,
  p_additions jsonb default '[]'::jsonb,
  p_warranty_overrides jsonb default null
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select zt_private.zt_finalize_work_order_with_warranty_overrides(
    p_wo,p_report,p_pending,p_extra_cost,p_due_days,p_materials,p_additions,p_warranty_overrides
  );
$$;
revoke all on function public.zt_finalize_work_order_with_warranty_overrides(uuid,text,text,numeric,integer,jsonb,jsonb,jsonb)
  from public, anon;
grant execute on function public.zt_finalize_work_order_with_warranty_overrides(uuid,text,text,numeric,integer,jsonb,jsonb,jsonb)
  to authenticated, service_role;
