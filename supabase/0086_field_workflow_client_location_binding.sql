-- ZiisTec · FIELD WORKFLOW V1 · Wave 4A.1
-- Fecha exclusivamente o vínculo relacional de local na reutilização de atendimento.
--
-- Princípios:
--   * client_locations continua sendo a única autoridade de local;
--   * client_location_id precisa pertencer ao MESMO company_id + client_id do documento;
--   * service_place/address continuam como snapshot textual histórico e não como autoridade;
--   * OS legada sem client_location_id não ganha vínculo por similaridade textual;
--   * nenhum backfill textual é executado.

-- A PK de client_locations já torna id globalmente único, mas esta chave composta permite
-- uma FK que prove simultaneamente empresa + cliente + local.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid='public.client_locations'::regclass
       and conname='client_locations_company_client_id_uk'
  ) then
    alter table public.client_locations
      add constraint client_locations_company_client_id_uk unique(company_id,client_id,id);
  end if;
end $$;

alter table public.quotes add column if not exists client_location_id uuid;
alter table public.work_orders add column if not exists client_location_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid='public.quotes'::regclass
       and conname='quotes_client_location_company_client_fk'
  ) then
    alter table public.quotes
      add constraint quotes_client_location_company_client_fk
      foreign key(company_id,client_id,client_location_id)
      references public.client_locations(company_id,client_id,id)
      on delete restrict not valid;
    alter table public.quotes validate constraint quotes_client_location_company_client_fk;
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid='public.work_orders'::regclass
       and conname='work_orders_client_location_company_client_fk'
  ) then
    alter table public.work_orders
      add constraint work_orders_client_location_company_client_fk
      foreign key(company_id,client_id,client_location_id)
      references public.client_locations(company_id,client_id,id)
      on delete restrict not valid;
    alter table public.work_orders validate constraint work_orders_client_location_company_client_fk;
  end if;
end $$;

create index if not exists ix_quotes_client_location on public.quotes(company_id,client_id,client_location_id) where client_location_id is not null;
create index if not exists ix_work_orders_client_location on public.work_orders(company_id,client_id,client_location_id) where client_location_id is not null;

comment on column public.quotes.client_location_id is
  'Vínculo relacional atual com client_locations. service_place/address são snapshots textuais do momento do documento.';
comment on column public.work_orders.client_location_id is
  'Vínculo relacional atual com client_locations. service_place/address permanecem snapshots históricos.';

-- Owner-only: lista apenas os locais do cliente informado. Técnico não recebe visão global.
create or replace function public.zt_list_client_locations_for_quote(p_client uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_company uuid;
  v_result jsonb;
begin
  select c.company_id into v_company
    from public.clients c
   where c.id=p_client and c.deleted_at is null;
  if not found then raise exception 'Cliente arquivado ou indisponível' using errcode='23514'; end if;

  perform zt_private.zt_assert_wave4a_owner(v_company,false);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',l.id,'client_id',l.client_id,'name',l.name,'address',l.address,'location_key',l.location_key
  ) order by l.name,l.id),'[]'::jsonb)
    into v_result
    from public.client_locations l
   where l.company_id=v_company and l.client_id=p_client;

  return v_result;
end;
$$;
revoke all on function public.zt_list_client_locations_for_quote(uuid) from public,anon;
grant execute on function public.zt_list_client_locations_for_quote(uuid) to authenticated,service_role;

-- Criação idempotente por (company, client, location_key), reutilizando a regra existente da Wave 3A.
create or replace function public.zt_create_client_location_for_quote(
  p_client uuid,
  p_name text,
  p_address text default null
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_company uuid;
  v_name text;
  v_key text;
  v_address text;
  v_location public.client_locations%rowtype;
begin
  select c.company_id into v_company
    from public.clients c
   where c.id=p_client and c.deleted_at is null;
  if not found then raise exception 'Cliente arquivado ou indisponível' using errcode='23514'; end if;

  perform zt_private.zt_assert_wave4a_owner(v_company,true);

  v_name:=left(btrim(coalesce(p_name,'')),300);
  if v_name='' then raise exception 'Nome do local é obrigatório' using errcode='22023'; end if;
  v_key:=zt_private.zt_normalize_location_key(v_name);
  v_address:=left(nullif(btrim(coalesce(p_address,'')),''),1000);

  select l.* into v_location
    from public.client_locations l
   where l.company_id=v_company and l.client_id=p_client and l.location_key=v_key;

  if not found then
    begin
      insert into public.client_locations(company_id,client_id,name,location_key,address,created_by)
      values(v_company,p_client,v_name,v_key,v_address,auth.uid())
      returning * into v_location;
    exception when unique_violation then
      select l.* into v_location
        from public.client_locations l
       where l.company_id=v_company and l.client_id=p_client and l.location_key=v_key;
    end;
  end if;

  return jsonb_build_object('id',v_location.id,'client_id',v_location.client_id,'name',v_location.name,'address',v_location.address,'location_key',v_location.location_key);
end;
$$;
revoke all on function public.zt_create_client_location_for_quote(uuid,text,text) from public,anon;
grant execute on function public.zt_create_client_location_for_quote(uuid,text,text) to authenticated,service_role;

-- Regrava apenas a função de seed da Wave 4A: texto legado vira referência visual separada.
-- Nenhum match automático por service_place é feito nesta wave.
create or replace function public.zt_quote_seed_from_work_order(p_work_order uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  w public.work_orders%rowtype;
  c public.clients%rowtype;
  l public.client_locations%rowtype;
  v_items jsonb;
  v_location_confirmed boolean:=false;
begin
  select * into w from public.work_orders where id=p_work_order and status='done' and deleted_at is null;
  if not found then raise exception 'Atendimento concluído não encontrado' using errcode='P0002'; end if;
  perform zt_private.zt_assert_wave4a_owner(w.company_id,false);
  if w.client_id is null then raise exception 'Atendimento sem cliente não pode originar orçamento' using errcode='23514'; end if;

  select * into c from public.clients where id=w.client_id and company_id=w.company_id and deleted_at is null;
  if not found then raise exception 'Cliente arquivado ou indisponível' using errcode='23514'; end if;

  if w.client_location_id is not null then
    select * into l
      from public.client_locations x
     where x.id=w.client_location_id and x.company_id=w.company_id and x.client_id=w.client_id;
    v_location_confirmed:=found;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'reuse_key','work_order:'||w.id::text||':'||i.id::text,
    'kind',i.kind::text,'service_id',i.service_id,'product_id',i.product_id,
    'name',case when i.service_id is not null then coalesce(s.name,i.name) when i.product_id is not null then coalesce(p.name,i.name) else i.name end,
    'unit',case when i.service_id is not null then coalesce(s.unit,i.unit) when i.product_id is not null then coalesce(p.unit,i.unit) else i.unit end,
    'quantity',i.quantity,'notes',i.notes,
    'historical_unit_price',i.unit_price,
    'unit_price',case when i.service_id is not null then case when s.id is not null and s.active and s.deleted_at is null then s.price end when i.product_id is not null then case when p.id is not null and p.active and p.deleted_at is null then p.price end else null end,
    'unit_cost',case when i.service_id is not null then case when s.id is not null and s.active and s.deleted_at is null then s.cost end when i.product_id is not null then case when p.id is not null and p.active and p.deleted_at is null then p.cost end else 0 end,
    'available',case when i.service_id is not null then (s.id is not null and s.active and s.deleted_at is null) when i.product_id is not null then (p.id is not null and p.active and p.deleted_at is null) else true end,
    'requires_price',(i.service_id is null and i.product_id is null),
    'price_changed',case when i.service_id is not null and s.id is not null and s.active and s.deleted_at is null then s.price is distinct from i.unit_price when i.product_id is not null and p.id is not null and p.active and p.deleted_at is null then p.price is distinct from i.unit_price else false end,
    'availability_reason',case when i.service_id is not null and not (s.id is not null and s.active and s.deleted_at is null) then 'Serviço arquivado ou inativo' when i.product_id is not null and not (p.id is not null and p.active and p.deleted_at is null) then 'Produto arquivado ou inativo' when i.service_id is null and i.product_id is null then 'Item livre exige revisão de preço' else null end
  ) order by i.id),'[]'::jsonb) into v_items
  from public.work_order_items i
  left join public.services s on s.id=i.service_id and s.company_id=w.company_id
  left join public.products p on p.id=i.product_id and p.company_id=w.company_id
  where i.work_order_id=w.id and i.company_id=w.company_id;

  return jsonb_build_object(
    'source_kind','work_order','source_id',w.id,'source_number',w.number,
    'client_id',c.id,'client_name',c.name,
    'client_location_id',case when v_location_confirmed then l.id else null end,
    'client_location_name',case when v_location_confirmed then l.name else null end,
    'client_location_address',case when v_location_confirmed then l.address else null end,
    'location_confirmed',v_location_confirmed,
    'legacy_service_place',w.service_place,
    'address',case when v_location_confirmed then coalesce(l.address,c.address) else c.address end,
    'service_place',case when v_location_confirmed then l.name else null end,
    'description',coalesce(nullif(w.request,''),nullif(w.pre_notes,'')),
    'items',v_items
  );
end;
$$;
revoke all on function public.zt_quote_seed_from_work_order(uuid) from public,anon;
grant execute on function public.zt_quote_seed_from_work_order(uuid) to authenticated,service_role;

-- O save genérico aceita vínculo opcional, mas sempre o valida no backend e deriva o snapshot
-- do cadastro atual do local no instante do save.
create or replace function public.zt_save_reuse_quote_idempotent(
  p_company uuid,p_quote uuid,p_request uuid,p_row jsonb,p_items jsonb default '[]'::jsonb
) returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_id uuid;
  v_checklist uuid;
  v_existing uuid;
  v_client uuid;
  v_location uuid;
  v_location_name text;
  v_location_address text;
begin
  perform zt_private.zt_assert_wave4a_owner(p_company,true);

  if p_quote is null then
    if p_request is null then raise exception 'Identificador da tentativa é obrigatório' using errcode='22023'; end if;
    select q.id into v_existing from public.quotes q where q.company_id=p_company and q.client_request_id=p_request;
    if v_existing is not null then return v_existing; end if;
  end if;

  begin
    v_client:=nullif(p_row->>'client_id','')::uuid;
    v_location:=nullif(p_row->>'client_location_id','')::uuid;
    v_checklist:=nullif(p_row->>'checklist_template_id','')::uuid;
  exception when invalid_text_representation then
    raise exception 'Cliente, local ou checklist inválido' using errcode='22023';
  end;

  if v_client is null or not exists(
    select 1 from public.clients c where c.id=v_client and c.company_id=p_company and c.deleted_at is null
  ) then raise exception 'Cliente arquivado, inválido ou de outra empresa' using errcode='23514'; end if;

  if v_location is not null then
    select l.name,l.address into v_location_name,v_location_address
      from public.client_locations l
     where l.id=v_location and l.company_id=p_company and l.client_id=v_client;
    if not found then raise exception 'Local não pertence ao cliente/empresa selecionado' using errcode='23514'; end if;
  end if;

  if v_checklist is not null and not exists(
    select 1 from public.checklist_templates t where t.id=v_checklist and t.company_id=p_company and t.active
  ) then raise exception 'Checklist indisponível ou de outra empresa' using errcode='23514'; end if;

  v_id:=zt_private.zt_save_quote_idempotent(p_company,p_quote,p_request,p_row,p_items);
  update public.quotes set
    client_location_id=v_location,
    title=left(nullif(trim(p_row->>'title'),''),300),
    customer_message=left(nullif(trim(p_row->>'customer_message'),''),5000),
    description=left(nullif(trim(p_row->>'description'),''),10000),
    warranty_note=left(nullif(trim(p_row->>'warranty_note'),''),2000),
    execution_forecast_date=nullif(p_row->>'execution_forecast_date','')::date,
    show_product_images=coalesce((p_row->>'show_product_images')::boolean,show_product_images),
    checklist_template_id=v_checklist,
    service_place=case when v_location is not null then v_location_name else service_place end,
    address=case when v_location is not null then v_location_address else address end,
    updated_at=now()
  where id=v_id and company_id=p_company;
  return v_id;
end;
$$;
revoke all on function public.zt_save_reuse_quote_idempotent(uuid,uuid,uuid,jsonb,jsonb) from public,anon;
grant execute on function public.zt_save_reuse_quote_idempotent(uuid,uuid,uuid,jsonb,jsonb) to authenticated,service_role;

-- Caminho específico de "Criar orçamento baseado neste atendimento". A empresa vem da OS,
-- enquanto cliente/local são a seleção atual revisada pelo owner e validados dentro desse tenant.
create or replace function public.zt_save_quote_from_work_order_idempotent(
  p_work_order uuid,
  p_location uuid,
  p_request uuid,
  p_row jsonb,
  p_items jsonb default '[]'::jsonb
) returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  w public.work_orders%rowtype;
  v_client uuid;
begin
  select * into w from public.work_orders where id=p_work_order and status='done' and deleted_at is null;
  if not found then raise exception 'Atendimento concluído não encontrado' using errcode='P0002'; end if;
  perform zt_private.zt_assert_wave4a_owner(w.company_id,true);

  begin v_client:=nullif(p_row->>'client_id','')::uuid;
  exception when invalid_text_representation then raise exception 'Cliente inválido' using errcode='22023'; end;
  if v_client is null or not exists(
    select 1 from public.clients c where c.id=v_client and c.company_id=w.company_id and c.deleted_at is null
  ) then raise exception 'Cliente arquivado, inválido ou de outra empresa' using errcode='23514'; end if;

  if p_location is null or not exists(
    select 1 from public.client_locations l
     where l.id=p_location and l.company_id=w.company_id and l.client_id=v_client
  ) then raise exception 'Confirme um local válido deste cliente antes de salvar' using errcode='23514'; end if;

  p_row:=coalesce(p_row,'{}'::jsonb)||jsonb_build_object('client_id',v_client,'client_location_id',p_location);
  return public.zt_save_reuse_quote_idempotent(w.company_id,null,p_request,p_row,p_items);
end;
$$;
revoke all on function public.zt_save_quote_from_work_order_idempotent(uuid,uuid,uuid,jsonb,jsonb) from public,anon;
grant execute on function public.zt_save_quote_from_work_order_idempotent(uuid,uuid,uuid,jsonb,jsonb) to authenticated,service_role;

-- Conversão mantém o snapshot textual já aprovado no orçamento e acrescenta o vínculo relacional.
create or replace function public.zt_create_work_order_from_quote(
  p_quote uuid,p_assigned_to uuid default null,p_scheduled_date date default null,p_scheduled_time time default null
) returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare v_uid uuid:=auth.uid(); v_quote public.quotes%rowtype; v_existing uuid; v_wo uuid; v_items jsonb; v_status public.zt_wo_status;
begin
  if v_uid is null then raise exception 'Não autenticado' using errcode='28000'; end if;
  select q.* into v_quote from public.quotes q where q.id=p_quote for update;
  if not found then raise exception 'Orçamento não encontrado' using errcode='P0002'; end if;
  if not public.zt_is_owner(v_quote.company_id) then raise exception 'Somente o proprietário pode converter orçamento em OS' using errcode='42501'; end if;
  if v_quote.status<>'approved' then raise exception 'O orçamento precisa estar aprovado antes de gerar a OS' using errcode='23514'; end if;
  select w.id into v_existing from public.work_orders w where w.company_id=v_quote.company_id and w.quote_id=v_quote.id order by w.created_at limit 1;
  if v_existing is not null then
    if v_quote.checklist_template_id is not null then perform public.zt_apply_checklist_template(v_existing,v_quote.checklist_template_id); end if;
    return v_existing;
  end if;
  if p_scheduled_time is not null and p_scheduled_date is null then raise exception 'Horário exige uma data de agendamento' using errcode='22023'; end if;
  v_status:=case when p_scheduled_date is null then 'unscheduled'::public.zt_wo_status else 'scheduled'::public.zt_wo_status end;
  select coalesce(jsonb_agg(jsonb_build_object('kind',qi.kind::text,'service_id',qi.service_id,'product_id',qi.product_id,'name',qi.name,'unit',qi.unit,'quantity',qi.quantity,'unit_price',qi.unit_price,'unit_cost',qi.unit_cost,'notes',qi.notes,'is_extra',false,'price_pending',false) order by qi.position,qi.id),'[]'::jsonb)
    into v_items from public.quote_items qi where qi.quote_id=v_quote.id and qi.company_id=v_quote.company_id;
  v_wo:=zt_private.zt_save_work_order(v_quote.company_id,null,jsonb_build_object(
    'client_id',v_quote.client_id,'quote_id',v_quote.id,'assigned_to',coalesce(p_assigned_to,v_uid),'status',v_status::text,
    'scheduled_date',p_scheduled_date,'scheduled_time',p_scheduled_time,'address',v_quote.address,'service_place',v_quote.service_place,
    'request',left('Gerada a partir do orçamento '||v_quote.number,10000),'pre_notes',v_quote.notes,'extra_cost',0,'needs_return',false,'is_warranty_visit',false
  ),v_items);
  if v_quote.client_location_id is not null then
    update public.work_orders
       set client_location_id=v_quote.client_location_id,
           address=v_quote.address,
           service_place=v_quote.service_place,
           updated_at=now()
     where id=v_wo and company_id=v_quote.company_id;
  end if;
  if v_quote.checklist_template_id is not null then perform public.zt_apply_checklist_template(v_wo,v_quote.checklist_template_id); end if;
  return v_wo;
exception when unique_violation then
  select w.id into v_existing from public.work_orders w where w.quote_id=p_quote order by w.created_at limit 1;
  if v_existing is not null then return v_existing; end if;
  raise;
end;
$$;
revoke all on function public.zt_create_work_order_from_quote(uuid,uuid,date,time) from public,anon;
grant execute on function public.zt_create_work_order_from_quote(uuid,uuid,date,time) to authenticated,service_role;

comment on function public.zt_quote_seed_from_work_order(uuid) is
  'Seed seguro: client_location_id somente quando comprovado por company+client; service_place legado é apenas referência visual.';
comment on function public.zt_save_quote_from_work_order_idempotent(uuid,uuid,uuid,jsonb,jsonb) is
  'Cria orçamento a partir de OS concluída exigindo local atual relacionalmente pertencente ao cliente selecionado no mesmo tenant.';