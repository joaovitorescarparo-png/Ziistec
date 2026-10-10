-- ZiisTec · FIELD WORKFLOW V1 · Wave 4A
-- Modelos + kits + reutilização segura de atendimento.
--
-- Autoridades preservadas:
--   * company/role/subscription são validados no banco;
--   * modelo/kit guardam referências + quantidade, nunca preço/custo como autoridade;
--   * resolução usa preço/custo ATUAL do catálogo no momento da reutilização;
--   * aplicar modelo/kit não toca estoque, financeiro, venda, garantia ou OS;
--   * atendimento antigo só produz uma prévia segura; documento histórico não é alterado;
--   * checklist do orçamento só vira snapshot quando o orçamento aprovado gera a OS.

alter table public.quotes
  add column if not exists title text,
  add column if not exists description text,
  add column if not exists warranty_note text,
  add column if not exists checklist_template_id uuid references public.checklist_templates(id) on delete set null;

comment on column public.quotes.checklist_template_id is
  'Checklist sugerido pelo modelo; work_order_checklists só são criados quando o orçamento vira OS.';

create table if not exists public.quote_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  quote_title text,
  customer_message text,
  description text,
  notes text,
  payment_terms text,
  warranty_note text,
  validity_days integer,
  execution_forecast_days integer,
  checklist_template_id uuid references public.checklist_templates(id) on delete set null,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quote_templates_name_ck check (length(trim(name)) between 1 and 200),
  constraint quote_templates_validity_ck check (validity_days is null or validity_days between 1 and 3650),
  constraint quote_templates_forecast_ck check (execution_forecast_days is null or execution_forecast_days between 0 and 3650)
);

create table if not exists public.quote_template_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  template_id uuid not null references public.quote_templates(id) on delete cascade,
  service_id uuid references public.services(id) on delete restrict,
  product_id uuid references public.products(id) on delete restrict,
  quantity numeric(12,3) not null default 1,
  notes text,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  constraint quote_template_items_one_ref_ck check ((service_id is not null) <> (product_id is not null)),
  constraint quote_template_items_qty_ck check (quantity > 0),
  constraint quote_template_items_position_ck check (position >= 0)
);

create table if not exists public.quote_kits (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  description text,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quote_kits_name_ck check (length(trim(name)) between 1 and 200)
);

create table if not exists public.quote_kit_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  kit_id uuid not null references public.quote_kits(id) on delete cascade,
  service_id uuid references public.services(id) on delete restrict,
  product_id uuid references public.products(id) on delete restrict,
  quantity numeric(12,3) not null default 1,
  notes text,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  constraint quote_kit_items_one_ref_ck check ((service_id is not null) <> (product_id is not null)),
  constraint quote_kit_items_qty_ck check (quantity > 0),
  constraint quote_kit_items_position_ck check (position >= 0)
);

create index if not exists ix_quote_templates_company_active on public.quote_templates(company_id,active,name);
create index if not exists ix_quote_template_items_parent on public.quote_template_items(template_id,position);
create index if not exists ix_quote_kits_company_active on public.quote_kits(company_id,active,name);
create index if not exists ix_quote_kit_items_parent on public.quote_kit_items(kit_id,position);
create index if not exists ix_quotes_checklist_template on public.quotes(company_id,checklist_template_id) where checklist_template_id is not null;

alter table public.quote_templates enable row level security;
alter table public.quote_template_items enable row level security;
alter table public.quote_kits enable row level security;
alter table public.quote_kit_items enable row level security;

-- Leitura direta continua fechada por grants; policies são defesa em profundidade.
drop policy if exists p_quote_templates_owner_select on public.quote_templates;
create policy p_quote_templates_owner_select on public.quote_templates
  for select to authenticated using (public.zt_is_owner(company_id));
drop policy if exists p_quote_template_items_owner_select on public.quote_template_items;
create policy p_quote_template_items_owner_select on public.quote_template_items
  for select to authenticated using (public.zt_is_owner(company_id));
drop policy if exists p_quote_kits_owner_select on public.quote_kits;
create policy p_quote_kits_owner_select on public.quote_kits
  for select to authenticated using (public.zt_is_owner(company_id));
drop policy if exists p_quote_kit_items_owner_select on public.quote_kit_items;
create policy p_quote_kit_items_owner_select on public.quote_kit_items
  for select to authenticated using (public.zt_is_owner(company_id));

revoke all on public.quote_templates,public.quote_template_items,public.quote_kits,public.quote_kit_items from public,anon,authenticated;
grant all on public.quote_templates,public.quote_template_items,public.quote_kits,public.quote_kit_items to service_role;

-- Novas estruturas operacionais obedecem ao mesmo bloqueio de assinatura.
do $$ declare t text;
begin
  foreach t in array array['quote_templates','quote_template_items','quote_kits','quote_kit_items'] loop
    execute format('drop trigger if exists trg_subscription_write_guard on public.%I',t);
    execute format(
      'create trigger trg_subscription_write_guard before insert or update or delete on public.%I for each row execute function public.zt_guard_subscription_write()',t
    );
  end loop;
end $$;

-- Um orçamento nunca pode apontar para checklist de outra empresa. Ao escolher/trocar,
-- o checklist também precisa estar ativo; documento já salvo pode continuar existindo se
-- o checklist for arquivado depois.
create or replace function zt_private.zt_guard_quote_checklist_template()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.checklist_template_id is null then return new; end if;
  if tg_op='UPDATE' and new.checklist_template_id is not distinct from old.checklist_template_id then
    return new;
  end if;
  if not exists(
    select 1 from public.checklist_templates t
     where t.id=new.checklist_template_id and t.company_id=new.company_id and t.active
  ) then
    raise exception 'Checklist indisponível ou de outra empresa' using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function zt_private.zt_guard_quote_checklist_template() from public,anon,authenticated;
drop trigger if exists trg_quotes_checklist_template_guard on public.quotes;
create trigger trg_quotes_checklist_template_guard
before insert or update of checklist_template_id,company_id on public.quotes
for each row execute function zt_private.zt_guard_quote_checklist_template();

create or replace function zt_private.zt_assert_wave4a_owner(p_company uuid, p_write boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Não autenticado' using errcode='28000'; end if;
  if not public.zt_is_owner(p_company) then
    raise exception 'Somente o proprietário administra modelos e kits' using errcode='42501';
  end if;
  if p_write then perform zt_private.assert_operational_write_allowed(p_company); end if;
end;
$$;
revoke all on function zt_private.zt_assert_wave4a_owner(uuid,boolean) from public,anon,authenticated;
grant execute on function zt_private.zt_assert_wave4a_owner(uuid,boolean) to service_role;

-- Valida e insere linhas de um modelo/kit. Preço/custo NÃO são recebidos nem persistidos.
create or replace function zt_private.zt_insert_reuse_items(
  p_company uuid,p_parent uuid,p_kind text,p_items jsonb
) returns void language plpgsql security definer set search_path = '' as $$
declare r jsonb; v_service uuid; v_product uuid; v_qty numeric; v_pos int:=0;
begin
  if p_kind not in ('template','kit') then raise exception 'Tipo de agrupador inválido' using errcode='22023'; end if;
  if jsonb_typeof(coalesce(p_items,'[]'::jsonb))<>'array' then raise exception 'Itens precisam ser uma lista' using errcode='22023'; end if;
  if jsonb_array_length(coalesce(p_items,'[]'::jsonb))>100 then raise exception 'Itens demais' using errcode='22023'; end if;
  for r in select value from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) loop
    begin
      v_service:=nullif(r->>'service_id','')::uuid;
      v_product:=nullif(r->>'product_id','')::uuid;
      v_qty:=coalesce(nullif(r->>'quantity','')::numeric,1);
    exception when invalid_text_representation then
      raise exception 'Referência ou quantidade inválida' using errcode='22023';
    end;
    if (v_service is null)=(v_product is null) then raise exception 'Cada item deve referenciar um serviço ou produto' using errcode='22023'; end if;
    if v_qty<=0 or v_qty>100000 then raise exception 'Quantidade inválida' using errcode='22023'; end if;
    if v_service is not null and not exists(
      select 1 from public.services s where s.id=v_service and s.company_id=p_company and s.active and s.deleted_at is null
    ) then raise exception 'Serviço indisponível ou de outra empresa' using errcode='23514'; end if;
    if v_product is not null and not exists(
      select 1 from public.products p where p.id=v_product and p.company_id=p_company and p.active and p.deleted_at is null
    ) then raise exception 'Produto indisponível ou de outra empresa' using errcode='23514'; end if;
    if p_kind='template' then
      insert into public.quote_template_items(company_id,template_id,service_id,product_id,quantity,notes,position)
      values(p_company,p_parent,v_service,v_product,v_qty,left(nullif(trim(r->>'notes'),''),1000),v_pos);
    else
      insert into public.quote_kit_items(company_id,kit_id,service_id,product_id,quantity,notes,position)
      values(p_company,p_parent,v_service,v_product,v_qty,left(nullif(trim(r->>'notes'),''),1000),v_pos);
    end if;
    v_pos:=v_pos+1;
  end loop;
end;
$$;
revoke all on function zt_private.zt_insert_reuse_items(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function zt_private.zt_insert_reuse_items(uuid,uuid,text,jsonb) to service_role;

create or replace function public.zt_save_quote_template(
  p_company uuid,p_template uuid,p_payload jsonb,p_items jsonb default '[]'::jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_name text; v_checklist uuid; v_validity int; v_forecast int;
begin
  perform zt_private.zt_assert_wave4a_owner(p_company,true);
  v_name:=left(trim(coalesce(p_payload->>'name','')),200);
  if v_name='' then raise exception 'Nome do modelo é obrigatório' using errcode='22023'; end if;
  begin
    v_checklist:=nullif(p_payload->>'checklist_template_id','')::uuid;
    v_validity:=nullif(p_payload->>'validity_days','')::integer;
    v_forecast:=nullif(p_payload->>'execution_forecast_days','')::integer;
  exception when invalid_text_representation then raise exception 'Prazo ou checklist inválido' using errcode='22023'; end;
  if v_validity is not null and (v_validity<1 or v_validity>3650) then raise exception 'Validade fora do limite' using errcode='22023'; end if;
  if v_forecast is not null and (v_forecast<0 or v_forecast>3650) then raise exception 'Previsão fora do limite' using errcode='22023'; end if;
  if v_checklist is not null and not exists(
    select 1 from public.checklist_templates t where t.id=v_checklist and t.company_id=p_company and t.active
  ) then raise exception 'Checklist indisponível ou de outra empresa' using errcode='23514'; end if;

  if p_template is null then
    insert into public.quote_templates(company_id,name,quote_title,customer_message,description,notes,payment_terms,warranty_note,validity_days,execution_forecast_days,checklist_template_id,active,created_by)
    values(p_company,v_name,left(nullif(trim(p_payload->>'quote_title'),''),300),left(nullif(trim(p_payload->>'customer_message'),''),5000),left(nullif(trim(p_payload->>'description'),''),10000),left(nullif(trim(p_payload->>'notes'),''),5000),left(nullif(trim(p_payload->>'payment_terms'),''),2000),left(nullif(trim(p_payload->>'warranty_note'),''),2000),v_validity,v_forecast,v_checklist,coalesce((p_payload->>'active')::boolean,true),auth.uid()) returning id into v_id;
  else
    select id into v_id from public.quote_templates where id=p_template and company_id=p_company for update;
    if not found then raise exception 'Modelo não encontrado' using errcode='42501'; end if;
    update public.quote_templates set name=v_name,quote_title=left(nullif(trim(p_payload->>'quote_title'),''),300),customer_message=left(nullif(trim(p_payload->>'customer_message'),''),5000),description=left(nullif(trim(p_payload->>'description'),''),10000),notes=left(nullif(trim(p_payload->>'notes'),''),5000),payment_terms=left(nullif(trim(p_payload->>'payment_terms'),''),2000),warranty_note=left(nullif(trim(p_payload->>'warranty_note'),''),2000),validity_days=v_validity,execution_forecast_days=v_forecast,checklist_template_id=v_checklist,active=coalesce((p_payload->>'active')::boolean,active),updated_at=now() where id=v_id;
    delete from public.quote_template_items where template_id=v_id;
  end if;
  perform zt_private.zt_insert_reuse_items(p_company,v_id,'template',p_items);
  return v_id;
end;
$$;
revoke all on function public.zt_save_quote_template(uuid,uuid,jsonb,jsonb) from public,anon;
grant execute on function public.zt_save_quote_template(uuid,uuid,jsonb,jsonb) to authenticated,service_role;

create or replace function public.zt_save_quote_kit(
  p_company uuid,p_kit uuid,p_payload jsonb,p_items jsonb default '[]'::jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_name text;
begin
  perform zt_private.zt_assert_wave4a_owner(p_company,true);
  v_name:=left(trim(coalesce(p_payload->>'name','')),200);
  if v_name='' then raise exception 'Nome do kit é obrigatório' using errcode='22023'; end if;
  if p_kit is null then
    insert into public.quote_kits(company_id,name,description,active,created_by)
    values(p_company,v_name,left(nullif(trim(p_payload->>'description'),''),3000),coalesce((p_payload->>'active')::boolean,true),auth.uid()) returning id into v_id;
  else
    select id into v_id from public.quote_kits where id=p_kit and company_id=p_company for update;
    if not found then raise exception 'Kit não encontrado' using errcode='42501'; end if;
    update public.quote_kits set name=v_name,description=left(nullif(trim(p_payload->>'description'),''),3000),active=coalesce((p_payload->>'active')::boolean,active),updated_at=now() where id=v_id;
    delete from public.quote_kit_items where kit_id=v_id;
  end if;
  perform zt_private.zt_insert_reuse_items(p_company,v_id,'kit',p_items);
  return v_id;
end;
$$;
revoke all on function public.zt_save_quote_kit(uuid,uuid,jsonb,jsonb) from public,anon;
grant execute on function public.zt_save_quote_kit(uuid,uuid,jsonb,jsonb) to authenticated,service_role;

-- Administração: RPCs retornam somente configuração e referências. Não expõem preço/custo.
create or replace function public.zt_list_quote_templates(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  perform zt_private.zt_assert_wave4a_owner(p_company,false);
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',t.id,'company_id',t.company_id,'name',t.name,'quote_title',t.quote_title,'customer_message',t.customer_message,
    'description',t.description,'notes',t.notes,'payment_terms',t.payment_terms,'warranty_note',t.warranty_note,
    'validity_days',t.validity_days,'execution_forecast_days',t.execution_forecast_days,'checklist_template_id',t.checklist_template_id,
    'checklist_name',ct.name,'active',t.active,'updated_at',t.updated_at,
    'items',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'service_id',i.service_id,'product_id',i.product_id,'quantity',i.quantity,'notes',i.notes,'position',i.position) order by i.position,i.id) from public.quote_template_items i where i.template_id=t.id and i.company_id=t.company_id),'[]'::jsonb)
  ) order by t.active desc,t.name,t.id),'[]'::jsonb) into v
  from public.quote_templates t left join public.checklist_templates ct on ct.id=t.checklist_template_id and ct.company_id=t.company_id
  where t.company_id=p_company;
  return v;
end;
$$;
revoke all on function public.zt_list_quote_templates(uuid) from public,anon;
grant execute on function public.zt_list_quote_templates(uuid) to authenticated,service_role;

create or replace function public.zt_list_quote_kits(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  perform zt_private.zt_assert_wave4a_owner(p_company,false);
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',k.id,'company_id',k.company_id,'name',k.name,'description',k.description,'active',k.active,'updated_at',k.updated_at,
    'items',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'service_id',i.service_id,'product_id',i.product_id,'quantity',i.quantity,'notes',i.notes,'position',i.position) order by i.position,i.id) from public.quote_kit_items i where i.kit_id=k.id and i.company_id=k.company_id),'[]'::jsonb)
  ) order by k.active desc,k.name,k.id),'[]'::jsonb) into v from public.quote_kits k where k.company_id=p_company;
  return v;
end;
$$;
revoke all on function public.zt_list_quote_kits(uuid) from public,anon;
grant execute on function public.zt_list_quote_kits(uuid) to authenticated,service_role;

-- Resolve um item reutilizável no CATÁLOGO ATUAL. Se foi arquivado/inativado, devolve
-- available=false e preço/custo null: o frontend deve exigir substituição/remoção.
create or replace function zt_private.zt_resolved_reuse_items(p_company uuid,p_parent uuid,p_kind text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  if p_kind='template' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'reuse_key','template:'||p_parent::text||':'||i.id::text,
      'kind',case when i.service_id is not null then 'service' else 'product' end,
      'service_id',i.service_id,'product_id',i.product_id,
      'name',case when i.service_id is not null then coalesce(s.name,'Serviço indisponível') else coalesce(p.name,'Produto indisponível') end,
      'unit',case when i.service_id is not null then coalesce(s.unit,'unidade') else coalesce(p.unit,'unidade') end,
      'quantity',i.quantity,'notes',i.notes,
      'unit_price',case when i.service_id is not null then case when s.id is not null and s.active and s.deleted_at is null then s.price end else case when p.id is not null and p.active and p.deleted_at is null then p.price end end,
      'unit_cost',case when i.service_id is not null then case when s.id is not null and s.active and s.deleted_at is null then s.cost end else case when p.id is not null and p.active and p.deleted_at is null then p.cost end end,
      'available',case when i.service_id is not null then (s.id is not null and s.active and s.deleted_at is null) else (p.id is not null and p.active and p.deleted_at is null) end,
      'availability_reason',case when i.service_id is not null and not (s.id is not null and s.active and s.deleted_at is null) then 'Serviço arquivado ou inativo' when i.product_id is not null and not (p.id is not null and p.active and p.deleted_at is null) then 'Produto arquivado ou inativo' else null end
    ) order by i.position,i.id),'[]'::jsonb) into v
    from public.quote_template_items i
    left join public.services s on s.id=i.service_id and s.company_id=p_company
    left join public.products p on p.id=i.product_id and p.company_id=p_company
    where i.template_id=p_parent and i.company_id=p_company;
  elsif p_kind='kit' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'reuse_key','kit:'||p_parent::text||':'||i.id::text,
      'kind',case when i.service_id is not null then 'service' else 'product' end,
      'service_id',i.service_id,'product_id',i.product_id,
      'name',case when i.service_id is not null then coalesce(s.name,'Serviço indisponível') else coalesce(p.name,'Produto indisponível') end,
      'unit',case when i.service_id is not null then coalesce(s.unit,'unidade') else coalesce(p.unit,'unidade') end,
      'quantity',i.quantity,'notes',i.notes,
      'unit_price',case when i.service_id is not null then case when s.id is not null and s.active and s.deleted_at is null then s.price end else case when p.id is not null and p.active and p.deleted_at is null then p.price end end,
      'unit_cost',case when i.service_id is not null then case when s.id is not null and s.active and s.deleted_at is null then s.cost end else case when p.id is not null and p.active and p.deleted_at is null then p.cost end end,
      'available',case when i.service_id is not null then (s.id is not null and s.active and s.deleted_at is null) else (p.id is not null and p.active and p.deleted_at is null) end,
      'availability_reason',case when i.service_id is not null and not (s.id is not null and s.active and s.deleted_at is null) then 'Serviço arquivado ou inativo' when i.product_id is not null and not (p.id is not null and p.active and p.deleted_at is null) then 'Produto arquivado ou inativo' else null end
    ) order by i.position,i.id),'[]'::jsonb) into v
    from public.quote_kit_items i
    left join public.services s on s.id=i.service_id and s.company_id=p_company
    left join public.products p on p.id=i.product_id and p.company_id=p_company
    where i.kit_id=p_parent and i.company_id=p_company;
  else raise exception 'Tipo inválido' using errcode='22023'; end if;
  return coalesce(v,'[]'::jsonb);
end;
$$;
revoke all on function zt_private.zt_resolved_reuse_items(uuid,uuid,text) from public,anon,authenticated;
grant execute on function zt_private.zt_resolved_reuse_items(uuid,uuid,text) to service_role;

create or replace function public.zt_resolve_quote_template(p_template uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare t public.quote_templates%rowtype;
begin
  select * into t from public.quote_templates where id=p_template;
  if not found then raise exception 'Modelo não encontrado' using errcode='P0002'; end if;
  perform zt_private.zt_assert_wave4a_owner(t.company_id,false);
  if not t.active then raise exception 'Modelo arquivado' using errcode='23514'; end if;
  return jsonb_build_object(
    'source_kind','template','source_id',t.id,'name',t.name,'title',t.quote_title,'customer_message',t.customer_message,
    'description',t.description,'notes',t.notes,'payment_terms',t.payment_terms,'warranty_note',t.warranty_note,
    'validity_days',t.validity_days,'execution_forecast_days',t.execution_forecast_days,
    'execution_forecast_date',case when t.execution_forecast_days is null then null else current_date+t.execution_forecast_days end,
    'checklist_template_id',t.checklist_template_id,
    'items',zt_private.zt_resolved_reuse_items(t.company_id,t.id,'template')
  );
end;
$$;
revoke all on function public.zt_resolve_quote_template(uuid) from public,anon;
grant execute on function public.zt_resolve_quote_template(uuid) to authenticated,service_role;

create or replace function public.zt_resolve_quote_kit(p_kit uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare k public.quote_kits%rowtype;
begin
  select * into k from public.quote_kits where id=p_kit;
  if not found then raise exception 'Kit não encontrado' using errcode='P0002'; end if;
  perform zt_private.zt_assert_wave4a_owner(k.company_id,false);
  if not k.active then raise exception 'Kit arquivado' using errcode='23514'; end if;
  return jsonb_build_object('source_kind','kit','source_id',k.id,'name',k.name,'description',k.description,'items',zt_private.zt_resolved_reuse_items(k.company_id,k.id,'kit'));
end;
$$;
revoke all on function public.zt_resolve_quote_kit(uuid) from public,anon;
grant execute on function public.zt_resolve_quote_kit(uuid) to authenticated,service_role;

-- Lista enxuta para o histórico. Não devolve financeiro, custo, garantia, relatório ou evidência.
create or replace function public.zt_list_reusable_work_orders(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  perform zt_private.zt_assert_wave4a_owner(p_company,false);
  select coalesce(jsonb_agg(jsonb_build_object('id',w.id,'number',w.number,'client_name',c.name,'completed_at',w.completed_at,'service_place',w.service_place,'request',w.request) order by w.completed_at desc nulls last,w.created_at desc),'[]'::jsonb)
    into v from public.work_orders w join public.clients c on c.id=w.client_id and c.company_id=w.company_id
   where w.company_id=p_company and w.status='done' and w.deleted_at is null;
  return v;
end;
$$;
revoke all on function public.zt_list_reusable_work_orders(uuid) from public,anon;
grant execute on function public.zt_list_reusable_work_orders(uuid) to authenticated,service_role;

-- Prévia de um atendimento concluído. A empresa é derivada da OS; não existe p_company
-- para o frontend tentar trocar tenant. Cliente deve continuar ativo. Endereço vem do
-- cadastro ATUAL do cliente; service_place é apenas seleção/texto inicial revisável.
create or replace function public.zt_quote_seed_from_work_order(p_work_order uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare w public.work_orders%rowtype; c public.clients%rowtype; v_items jsonb;
begin
  select * into w from public.work_orders where id=p_work_order and status='done' and deleted_at is null;
  if not found then raise exception 'Atendimento concluído não encontrado' using errcode='P0002'; end if;
  perform zt_private.zt_assert_wave4a_owner(w.company_id,false);
  if w.client_id is null then raise exception 'Atendimento sem cliente não pode originar orçamento' using errcode='23514'; end if;
  select * into c from public.clients where id=w.client_id and company_id=w.company_id and deleted_at is null;
  if not found then raise exception 'Cliente arquivado ou indisponível' using errcode='23514'; end if;

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
    'client_id',c.id,'client_name',c.name,'address',c.address,'service_place',w.service_place,
    'description',coalesce(nullif(w.request,''),nullif(w.pre_notes,'')),
    'items',v_items
  );
end;
$$;
revoke all on function public.zt_quote_seed_from_work_order(uuid) from public,anon;
grant execute on function public.zt_quote_seed_from_work_order(uuid) to authenticated,service_role;

-- Grava o NOVO orçamento de reutilização. O client_request_id do fluxo existente continua
-- sendo a autoridade contra retry/duplo clique. Campos de origem histórica nunca entram.
create or replace function public.zt_save_reuse_quote_idempotent(
  p_company uuid,p_quote uuid,p_request uuid,p_row jsonb,p_items jsonb default '[]'::jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_checklist uuid; v_existing uuid;
begin
  perform zt_private.zt_assert_wave4a_owner(p_company,true);
  if p_quote is null then
    if p_request is null then raise exception 'Identificador da tentativa é obrigatório' using errcode='22023'; end if;
    select q.id into v_existing from public.quotes q where q.company_id=p_company and q.client_request_id=p_request;
    if v_existing is not null then return v_existing; end if;
  end if;
  if nullif(p_row->>'client_id','') is null or not exists(
    select 1 from public.clients c where c.id=nullif(p_row->>'client_id','')::uuid and c.company_id=p_company and c.deleted_at is null
  ) then raise exception 'Cliente arquivado, inválido ou de outra empresa' using errcode='23514'; end if;
  begin v_checklist:=nullif(p_row->>'checklist_template_id','')::uuid;
  exception when invalid_text_representation then raise exception 'Checklist inválido' using errcode='22023'; end;
  if v_checklist is not null and not exists(
    select 1 from public.checklist_templates t where t.id=v_checklist and t.company_id=p_company and t.active
  ) then raise exception 'Checklist indisponível ou de outra empresa' using errcode='23514'; end if;

  v_id:=zt_private.zt_save_quote_idempotent(p_company,p_quote,p_request,p_row,p_items);
  update public.quotes set
    title=left(nullif(trim(p_row->>'title'),''),300),
    customer_message=left(nullif(trim(p_row->>'customer_message'),''),5000),
    description=left(nullif(trim(p_row->>'description'),''),10000),
    warranty_note=left(nullif(trim(p_row->>'warranty_note'),''),2000),
    execution_forecast_date=nullif(p_row->>'execution_forecast_date','')::date,
    show_product_images=coalesce((p_row->>'show_product_images')::boolean,show_product_images),
    checklist_template_id=v_checklist,
    updated_at=now()
  where id=v_id and company_id=p_company;
  return v_id;
end;
$$;
revoke all on function public.zt_save_reuse_quote_idempotent(uuid,uuid,uuid,jsonb,jsonb) from public,anon;
grant execute on function public.zt_save_reuse_quote_idempotent(uuid,uuid,uuid,jsonb,jsonb) to authenticated,service_role;

-- Preserva a conversão existente e acrescenta SOMENTE o snapshot do checklist no ponto
-- correto: depois de criar a OS. Retry continua devolvendo a mesma OS e reaplicar checklist
-- é idempotente pela Wave 3B.
create or replace function public.zt_create_work_order_from_quote(
  p_quote uuid,p_assigned_to uuid default null,p_scheduled_date date default null,p_scheduled_time time default null
) returns uuid language plpgsql security definer set search_path = '' as $$
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

comment on function public.zt_create_work_order_from_quote(uuid,uuid,date,time) is
  'Converte orçamento aprovado em uma única OS e aplica, de forma idempotente, o checklist associado ao orçamento.';
