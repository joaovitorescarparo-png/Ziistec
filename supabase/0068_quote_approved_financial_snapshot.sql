-- ZiisTec · 0068 — snapshot comercial aprovado do orçamento na OS.
--
-- Regra:
--   * OS ligada a orçamento aprovado guarda subtotal/desconto/acréscimo/total no momento da ligação;
--   * o snapshot não é recalculado em edições normais da OS;
--   * cobrança base de OS com orçamento = approved_total;
--   * somente itens posteriores marcados is_extra=true e já precificados somam à cobrança;
--   * item price_pending impede os fluxos de cobrança já existentes;
--   * custos privados/materiais não entram automaticamente na cobrança;
--   * OS sem orçamento preserva a regra anterior: soma dos work_order_items;
--   * visita de garantia continua sem cobrança.

alter table public.work_orders
  add column if not exists approved_subtotal numeric(12,2),
  add column if not exists approved_discount numeric(12,2),
  add column if not exists approved_surcharge numeric(12,2),
  add column if not exists approved_total numeric(12,2);

-- Backfill seguro para OS antigas já vinculadas a orçamento. Orçamentos aprovados são
-- a melhor fonte histórica disponível para preencher o snapshot pré-0068.
with snapshot as (
  select
    w.id as work_order_id,
    round(coalesce(sum(qi.quantity * qi.unit_price),0),2)::numeric(12,2) as subtotal,
    round(greatest(coalesce(q.discount,0),0),2)::numeric(12,2) as discount,
    round(greatest(coalesce(q.surcharge,0),0),2)::numeric(12,2) as surcharge
  from public.work_orders w
  join public.quotes q
    on q.id=w.quote_id and q.company_id=w.company_id
  left join public.quote_items qi
    on qi.quote_id=q.id and qi.company_id=q.company_id
  where w.quote_id is not null
  group by w.id,q.discount,q.surcharge
)
update public.work_orders w
   set approved_subtotal=s.subtotal,
       approved_discount=s.discount,
       approved_surcharge=s.surcharge,
       approved_total=round(greatest(0::numeric,s.subtotal-s.discount+s.surcharge),2)::numeric(12,2)
  from snapshot s
 where w.id=s.work_order_id
   and (w.approved_subtotal is null
        or w.approved_discount is null
        or w.approved_surcharge is null
        or w.approved_total is null);

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid='public.work_orders'::regclass
       and conname='work_orders_approved_snapshot_ck'
  ) then
    alter table public.work_orders
      add constraint work_orders_approved_snapshot_ck check (
        (
          approved_subtotal is null
          and approved_discount is null
          and approved_surcharge is null
          and approved_total is null
        )
        or
        (
          approved_subtotal is not null
          and approved_discount is not null
          and approved_surcharge is not null
          and approved_total is not null
          and approved_subtotal >= 0
          and approved_discount >= 0
          and approved_surcharge >= 0
          and approved_total >= 0
          and approved_total = round(greatest(0::numeric,approved_subtotal-approved_discount+approved_surcharge),2)
        )
      ) not valid;
    alter table public.work_orders validate constraint work_orders_approved_snapshot_ck;
  end if;
end $$;

-- Autoridade do snapshot: qualquer INSERT com quote_id captura o orçamento aprovado.
-- Em UPDATE comum, manter o mesmo quote_id mantém também o mesmo snapshot. Se a ligação
-- for deliberadamente trocada para outro orçamento, um novo snapshot é capturado.
create or replace function zt_private.zt_capture_approved_quote_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote public.quotes%rowtype;
  v_subtotal numeric(12,2);
begin
  if tg_op='UPDATE' and new.quote_id is not distinct from old.quote_id then
    new.approved_subtotal := old.approved_subtotal;
    new.approved_discount := old.approved_discount;
    new.approved_surcharge := old.approved_surcharge;
    new.approved_total := old.approved_total;
    return new;
  end if;

  if new.quote_id is null then
    new.approved_subtotal := null;
    new.approved_discount := null;
    new.approved_surcharge := null;
    new.approved_total := null;
    return new;
  end if;

  select q.* into v_quote
    from public.quotes q
   where q.id=new.quote_id and q.company_id=new.company_id;
  if not found then
    raise exception 'Orçamento não pertence à empresa da OS' using errcode='23503';
  end if;
  if v_quote.status <> 'approved' then
    raise exception 'Somente orçamento aprovado pode ser vinculado à OS' using errcode='23514';
  end if;

  select round(coalesce(sum(qi.quantity*qi.unit_price),0),2)::numeric(12,2)
    into v_subtotal
    from public.quote_items qi
   where qi.quote_id=v_quote.id and qi.company_id=v_quote.company_id;

  new.approved_subtotal := v_subtotal;
  new.approved_discount := round(greatest(coalesce(v_quote.discount,0),0),2)::numeric(12,2);
  new.approved_surcharge := round(greatest(coalesce(v_quote.surcharge,0),0),2)::numeric(12,2);
  new.approved_total := round(greatest(
    0::numeric,
    new.approved_subtotal-new.approved_discount+new.approved_surcharge
  ),2)::numeric(12,2);
  return new;
end;
$$;

revoke all on function zt_private.zt_capture_approved_quote_snapshot() from public,anon,authenticated;

drop trigger if exists trg_capture_approved_quote_snapshot on public.work_orders;
create trigger trg_capture_approved_quote_snapshot
before insert or update of quote_id,approved_subtotal,approved_discount,approved_surcharge,approved_total
on public.work_orders
for each row execute function zt_private.zt_capture_approved_quote_snapshot();

-- Única regra de total faturável. Não exposta à Data API.
create or replace function zt_private.zt_work_order_billable_total(p_wo uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_wo public.work_orders%rowtype;
  v_items numeric(12,2) := 0;
  v_extras numeric(12,2) := 0;
begin
  select * into v_wo from public.work_orders where id=p_wo;
  if not found then raise exception 'Ordem de serviço não encontrada' using errcode='P0002'; end if;

  if v_wo.is_warranty_visit then return 0::numeric; end if;

  if v_wo.quote_id is not null then
    if v_wo.approved_total is null then
      raise exception 'OS vinculada a orçamento sem snapshot comercial aprovado' using errcode='23514';
    end if;
    select round(coalesce(sum(i.quantity*i.unit_price),0),2)::numeric(12,2)
      into v_extras
      from public.work_order_items i
     where i.work_order_id=p_wo
       and i.company_id=v_wo.company_id
       and i.is_extra
       and not i.price_pending;
    return round(greatest(0::numeric,v_wo.approved_total+v_extras),2)::numeric(12,2);
  end if;

  select round(coalesce(sum(i.quantity*i.unit_price),0),2)::numeric(12,2)
    into v_items
    from public.work_order_items i
   where i.work_order_id=p_wo and i.company_id=v_wo.company_id;
  return round(greatest(0::numeric,v_items),2)::numeric(12,2);
end;
$$;

revoke all on function zt_private.zt_work_order_billable_total(uuid) from public,anon,authenticated;
grant execute on function zt_private.zt_work_order_billable_total(uuid) to service_role;

-- Caminho de faturamento service-only também usa a mesma regra.
create or replace function zt_private.zt_bill_work_order(p_wo uuid, p_due_days integer default 7)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wo public.work_orders%rowtype;
  v_total numeric(12,2);
  v_entry uuid;
begin
  if auth.uid() is null then raise exception 'Não autenticado' using errcode='28000'; end if;
  select * into v_wo from public.work_orders where id=p_wo for update;
  if v_wo.id is null then raise exception 'Ordem de serviço não encontrada' using errcode='42501'; end if;
  if not public.zt_is_owner(v_wo.company_id) then raise exception 'Somente o proprietário consolida a cobrança' using errcode='42501'; end if;
  if v_wo.billing_entry_id is not null then return v_wo.billing_entry_id; end if;
  if v_wo.status <> 'done' then raise exception 'Atendimento ainda não foi concluído' using errcode='42501'; end if;
  if exists(select 1 from public.work_order_items where work_order_id=p_wo and price_pending) then
    raise exception 'Ainda há adicional sem preço definido' using errcode='42501';
  end if;
  if v_wo.is_warranty_visit then
    update public.work_orders set pending_pricing=false where id=p_wo;
    return null;
  end if;
  p_due_days := greatest(0,least(coalesce(p_due_days,7),365));
  v_total := zt_private.zt_work_order_billable_total(p_wo);
  if v_total <= 0 then
    update public.work_orders set pending_pricing=false where id=p_wo;
    return null;
  end if;
  insert into public.financial_entries(company_id,kind,description,amount,due_date,client_id,work_order_id,category)
  values(v_wo.company_id,'income',left(v_wo.number||' · atendimento',500),v_total,current_date+p_due_days,v_wo.client_id,p_wo,'Serviços')
  on conflict (work_order_id) where work_order_id is not null do nothing
  returning id into v_entry;
  if v_entry is null then select id into v_entry from public.financial_entries where work_order_id=p_wo; end if;
  update public.work_orders set billing_entry_id=v_entry,pending_pricing=false where id=p_wo;
  insert into public.work_order_reports(work_order_id,company_id,entry_type,body,author_id)
  values(p_wo,v_wo.company_id,'history','Cobrança gerada em contas a receber',auth.uid());
  return v_entry;
end;
$$;

revoke all on function zt_private.zt_bill_work_order(uuid,integer) from public,anon,authenticated;
grant execute on function zt_private.zt_bill_work_order(uuid,integer) to service_role;

-- Finalização principal do app: mantém garantias/custos e troca apenas a fonte do total faturável.
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
  if v_uid is null then raise exception 'Não autenticado' using errcode='28000'; end if;
  select * into v_wo from public.work_orders where id=p_wo for update;
  if v_wo.id is null then raise exception 'Ordem de serviço não encontrada' using errcode='42501'; end if;

  v_is_owner := zt_private.is_owner(v_wo.company_id);
  v_assigned := (v_wo.assigned_to=v_uid) and exists(
    select 1 from public.company_members m
     where m.company_id=v_wo.company_id and m.user_id=v_uid and m.status='active'
  );
  if not (v_is_owner or v_assigned) then
    raise exception 'Sem permissão para finalizar esta ordem de serviço' using errcode='42501';
  end if;
  if exists(
    select 1 from public.subscriptions s
     where s.company_id=v_wo.company_id and s.status in ('suspended','canceled','past_due')
  ) then raise exception 'Assinatura inativa' using errcode='42501'; end if;
  if v_wo.status='done' or v_wo.billing_entry_id is not null then return v_wo.billing_entry_id; end if;

  select c.extra_cost into v_existing_extra
    from public.work_order_private_costs c
   where c.work_order_id=p_wo and c.company_id=v_wo.company_id;
  v_existing_extra := coalesce(v_existing_extra,0);
  if v_is_owner then
    v_effective_extra := case when p_extra_cost is null then v_existing_extra else greatest(p_extra_cost,0) end;
  else
    v_effective_extra := v_existing_extra;
    p_due_days := 7;
  end if;

  p_due_days := greatest(0,least(coalesce(p_due_days,7),365));
  if p_report is not null and length(p_report)>10000 then raise exception 'Relato muito longo'; end if;
  if p_pending is not null and length(p_pending)>5000 then raise exception 'Pendência muito longa'; end if;

  v_total := zt_private.zt_work_order_billable_total(p_wo);
  select exists(select 1 from public.work_order_items i where i.work_order_id=p_wo and i.price_pending)
    into v_pendente;

  update public.work_orders
     set status='done',completed_at=now(),pending_note=coalesce(p_pending,pending_note),
         extra_cost=v_effective_extra,updated_at=now()
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
      left join public.services s on s.id=i.service_id and s.company_id=i.company_id
      left join public.products p on p.id=i.product_id and p.company_id=i.company_id
     where i.work_order_id=p_wo and i.company_id=v_wo.company_id
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
      insert into public.warranties(company_id,client_id,work_order_id,kind,service_id,description,service_place,starts_on,ends_on)
      values(v_wo.company_id,v_wo.client_id,p_wo,'service',r.service_id,left(r.name,500),v_wo.service_place,current_date,current_date+least(v_service_days,3650));
    end if;
    if r.product_id is not null and v_product_months>0 then
      insert into public.warranties(company_id,client_id,work_order_id,kind,product_id,description,service_place,starts_on,ends_on)
      values(v_wo.company_id,v_wo.client_id,p_wo,'product',r.product_id,left(r.name,500),v_wo.service_place,current_date,(current_date+(least(v_product_months,120)||' months')::interval)::date);
    end if;
  end loop;

  for r in
    select m.product_id,m.name,m.warranty_policy,m.warranty_override_months,p.warranty_months
      from public.work_order_materials m
      left join public.products p on p.id=m.product_id and p.company_id=m.company_id
     where m.work_order_id=p_wo and m.company_id=v_wo.company_id
  loop
    v_product_months := case
      when r.warranty_policy='disabled' then 0
      when r.warranty_policy='custom' then coalesce(r.warranty_override_months,0)
      else coalesce(r.warranty_months,0)
    end;
    if r.product_id is not null and v_product_months>0 then
      insert into public.warranties(company_id,client_id,work_order_id,kind,product_id,description,service_place,starts_on,ends_on)
      values(v_wo.company_id,v_wo.client_id,p_wo,'product',r.product_id,left(r.name,500),v_wo.service_place,current_date,(current_date+(least(v_product_months,120)||' months')::interval)::date);
    end if;
  end loop;

  update public.work_orders set pending_pricing=v_pendente where id=p_wo;
  if v_pendente then
    insert into public.work_order_reports(work_order_id,company_id,entry_type,body,author_id)
    values(p_wo,v_wo.company_id,'history','Execução concluída. Há adicional aguardando precificação do proprietário — cobrança não gerada.',v_uid);
    return null;
  end if;

  if v_total>0 and not v_wo.is_warranty_visit then
    insert into public.financial_entries(company_id,kind,description,amount,due_date,client_id,work_order_id,category)
    values(v_wo.company_id,'income',left(v_wo.number||' · atendimento',500),v_total,current_date+p_due_days,v_wo.client_id,p_wo,'Serviços')
    on conflict (work_order_id) where work_order_id is not null do nothing
    returning id into v_entry;
    if v_entry is null then select f.id into v_entry from public.financial_entries f where f.work_order_id=p_wo; end if;
    update public.work_orders set billing_entry_id=v_entry where id=p_wo;
    insert into public.work_order_reports(work_order_id,company_id,entry_type,body,author_id)
    values(p_wo,v_wo.company_id,'history','Cobrança gerada em contas a receber',v_uid);
  end if;
  return v_entry;
end;
$$;

revoke all on function zt_private.zt_complete_work_order(uuid,text,text,numeric,integer) from public,anon,authenticated;
grant execute on function zt_private.zt_complete_work_order(uuid,text,text,numeric,integer) to service_role;

-- Owner resolve valores pendentes; a cobrança final usa o mesmo total centralizado.
create or replace function public.zt_resolve_work_order_pricing(
  p_wo uuid,
  p_prices jsonb,
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
  r jsonb;
  v_item uuid;
  v_price numeric;
begin
  if auth.uid() is null then raise exception 'Não autenticado' using errcode='28000'; end if;
  select * into v_wo from public.work_orders where id=p_wo for update;
  if not found then raise exception 'Ordem de serviço não encontrada'; end if;
  if not public.zt_is_owner(v_wo.company_id) then raise exception 'Somente o proprietário pode definir os valores'; end if;
  if v_wo.status <> 'done' then raise exception 'A OS ainda não foi concluída'; end if;
  if v_wo.billing_entry_id is not null then return v_wo.billing_entry_id; end if;
  if not v_wo.pending_pricing then raise exception 'A OS não está aguardando precificação'; end if;
  if jsonb_typeof(coalesce(p_prices,'[]'::jsonb)) <> 'array' then raise exception 'Lista de valores inválida'; end if;

  for r in select value from jsonb_array_elements(coalesce(p_prices,'[]'::jsonb)) loop
    begin v_item := (r->>'id')::uuid; exception when others then raise exception 'Item de precificação inválido'; end;
    v_price := coalesce((r->>'price')::numeric,0);
    if v_price < 0 then raise exception 'Valor não pode ser negativo'; end if;
    update public.work_order_items
       set unit_price=v_price,price_pending=false
     where id=v_item and work_order_id=p_wo and company_id=v_wo.company_id and price_pending=true;
    if not found then raise exception 'Item pendente não pertence a esta OS'; end if;
  end loop;
  if exists(select 1 from public.work_order_items where work_order_id=p_wo and price_pending) then
    raise exception 'Ainda existem itens aguardando valor';
  end if;

  p_due_days := greatest(0,least(coalesce(p_due_days,7),365));
  v_total := zt_private.zt_work_order_billable_total(p_wo);
  if v_wo.is_warranty_visit or v_total<=0 then
    update public.work_orders set pending_pricing=false,updated_at=now() where id=p_wo;
    insert into public.work_order_reports(work_order_id,company_id,entry_type,body,author_id)
    values(p_wo,v_wo.company_id,'history','Precificação concluída sem geração de cobrança',auth.uid());
    return null;
  end if;

  insert into public.financial_entries(company_id,kind,description,amount,due_date,client_id,work_order_id,category)
  values(v_wo.company_id,'income',left(v_wo.number||' · atendimento',500),v_total,current_date+p_due_days,v_wo.client_id,p_wo,'Serviços')
  on conflict (work_order_id) where work_order_id is not null do nothing
  returning id into v_entry;
  if v_entry is null then select id into v_entry from public.financial_entries where work_order_id=p_wo; end if;
  update public.work_orders set billing_entry_id=v_entry,pending_pricing=false,updated_at=now() where id=p_wo;
  insert into public.work_order_reports(work_order_id,company_id,entry_type,body,author_id)
  values(p_wo,v_wo.company_id,'history','Valores adicionais definidos e cobrança liberada',auth.uid());
  return v_entry;
end;
$$;

revoke all on function public.zt_resolve_work_order_pricing(uuid,jsonb,integer) from public,anon;
grant execute on function public.zt_resolve_work_order_pricing(uuid,jsonb,integer) to authenticated,service_role;

-- Compatibilidade service-only para o fluxo legado de liberar precificação.
create or replace function public.zt_finalize_pending_work_order_pricing(p_wo uuid,p_due_days integer default 7)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wo public.work_orders%rowtype;
  v_total numeric(12,2);
  v_entry uuid;
begin
  if auth.uid() is null then raise exception 'Não autenticado' using errcode='28000'; end if;
  select * into v_wo from public.work_orders where id=p_wo for update;
  if not found then raise exception 'Ordem de serviço não encontrada'; end if;
  if not public.zt_is_owner(v_wo.company_id) then raise exception 'Somente o proprietário pode liberar a cobrança'; end if;
  if v_wo.status <> 'done' then raise exception 'A OS ainda não foi concluída'; end if;
  if v_wo.billing_entry_id is not null then return v_wo.billing_entry_id; end if;
  if not v_wo.pending_pricing then raise exception 'A OS não está aguardando precificação'; end if;
  if exists(select 1 from public.work_order_items where work_order_id=p_wo and price_pending) then
    raise exception 'Ainda existem itens aguardando valor';
  end if;

  p_due_days := greatest(0,least(coalesce(p_due_days,7),365));
  v_total := zt_private.zt_work_order_billable_total(p_wo);
  if v_wo.is_warranty_visit or v_total<=0 then
    update public.work_orders set pending_pricing=false,updated_at=now() where id=p_wo;
    insert into public.work_order_reports(work_order_id,company_id,entry_type,body,author_id)
    values(p_wo,v_wo.company_id,'history','Precificação concluída sem geração de cobrança',auth.uid());
    return null;
  end if;

  insert into public.financial_entries(company_id,kind,description,amount,due_date,client_id,work_order_id,category)
  values(v_wo.company_id,'income',left(v_wo.number||' · atendimento',500),v_total,current_date+p_due_days,v_wo.client_id,p_wo,'Serviços')
  on conflict (work_order_id) where work_order_id is not null do nothing
  returning id into v_entry;
  if v_entry is null then select id into v_entry from public.financial_entries where work_order_id=p_wo; end if;
  update public.work_orders set billing_entry_id=v_entry,pending_pricing=false,updated_at=now() where id=p_wo;
  insert into public.work_order_reports(work_order_id,company_id,entry_type,body,author_id)
  values(p_wo,v_wo.company_id,'history','Precificação concluída e cobrança gerada em contas a receber',auth.uid());
  return v_entry;
end;
$$;

revoke all on function public.zt_finalize_pending_work_order_pricing(uuid,integer) from public,anon,authenticated;
grant execute on function public.zt_finalize_pending_work_order_pricing(uuid,integer) to service_role;
