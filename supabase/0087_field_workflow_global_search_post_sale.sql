-- ZiisTec · FIELD WORKFLOW V1 · Wave 4B
-- Busca global owner-only + extensão do pós-venda existente.
-- Não cria CRM paralelo, não envia WhatsApp e não altera financeiro/estoque/garantia.

create extension if not exists pg_trgm;

-- =============================================================================
-- BUSCA GLOBAL OPERACIONAL
-- =============================================================================

create or replace function zt_private.zt_search_digits(p_value text)
returns text
language sql
immutable
security invoker
set search_path=''
as $$
  select regexp_replace(coalesce(p_value,''),'[^0-9]','','g');
$$;

create or replace function zt_private.zt_search_match(p_value text,p_query text,p_digits text)
returns boolean
language sql
immutable
security invoker
set search_path=''
as $$
  select
    (char_length(coalesce(p_query,''))>=2 and position(lower(p_query) in lower(coalesce(p_value,'')))>0)
    or
    (char_length(coalesce(p_digits,''))>=3 and position(p_digits in regexp_replace(coalesce(p_value,''),'[^0-9]','','g'))>0);
$$;

revoke all on function zt_private.zt_search_digits(text) from public,anon,authenticated;
revoke all on function zt_private.zt_search_match(text,text,text) from public,anon,authenticated;
grant execute on function zt_private.zt_search_digits(text) to service_role;
grant execute on function zt_private.zt_search_match(text,text,text) to service_role;

-- Índices tenant-scoped continuam filtrando primeiro por company_id; trigramas
-- atendem contains/case-insensitive sem serviço externo.
create index if not exists idx_clients_global_search_trgm
  on public.clients using gin ((lower(coalesce(name,'')||' '||coalesce(trade_name,'')||' '||coalesce(contact_name,'')||' '||coalesce(address,''))) gin_trgm_ops)
  where deleted_at is null;
create index if not exists idx_client_locations_global_search_trgm
  on public.client_locations using gin ((lower(coalesce(name,'')||' '||coalesce(address,''))) gin_trgm_ops);
create index if not exists idx_work_orders_global_search_trgm
  on public.work_orders using gin ((lower(coalesce(number,'')||' '||coalesce(service_place,'')||' '||coalesce(address,'')||' '||coalesce(request,''))) gin_trgm_ops)
  where deleted_at is null;
create index if not exists idx_quotes_global_search_trgm
  on public.quotes using gin ((lower(coalesce(number,'')||' '||coalesce(title,'')||' '||coalesce(description,'')||' '||coalesce(service_place,'')||' '||coalesce(address,''))) gin_trgm_ops)
  where deleted_at is null;
create index if not exists idx_products_global_search_trgm
  on public.products using gin ((lower(coalesce(name,'')||' '||coalesce(brand,'')||' '||coalesce(model,'')||' '||coalesce(sku,'')||' '||coalesce(barcode,''))) gin_trgm_ops)
  where deleted_at is null;
create index if not exists idx_installed_equipment_global_search_trgm
  on public.installed_equipment using gin ((lower(coalesce(name,'')||' '||coalesce(brand,'')||' '||coalesce(model,'')||' '||coalesce(serial_number,'')||' '||coalesce(barcode,''))) gin_trgm_ops);
create index if not exists idx_warranties_global_search_trgm
  on public.warranties using gin ((lower(coalesce(description,'')||' '||coalesce(service_place,'')||' '||coalesce(serial_number,''))) gin_trgm_ops)
  where deleted_at is null;

create or replace function public.zt_global_operational_search(
  p_company uuid,
  p_query text,
  p_limit integer default 30,
  p_offset integer default 0
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_query text := lower(btrim(coalesce(p_query,'')));
  v_digits text := zt_private.zt_search_digits(p_query);
  v_limit integer := least(greatest(coalesce(p_limit,30),1),50);
  v_offset integer := least(greatest(coalesce(p_offset,0),0),5000);
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'Não autenticado' using errcode='28000'; end if;
  if p_company is null or not zt_private.is_owner(p_company) then
    raise exception 'Busca global disponível somente ao proprietário' using errcode='42501';
  end if;
  if char_length(v_query)>120 then raise exception 'Busca muito longa' using errcode='22023'; end if;
  if char_length(v_query)<2 and char_length(v_digits)<3 then
    return jsonb_build_object('items','[]'::jsonb,'has_more',false,'next_offset',null);
  end if;

  with hits as (
    select 10 priority,'client'::text result_type,c.id entity_id,
           coalesce(nullif(c.trade_name,''),c.name) title,
           concat_ws(' · ',nullif(c.name,''),nullif(c.phone,''),nullif(c.whatsapp,'')) subtitle,
           c.id client_id,null::uuid work_order_id,null::uuid client_location_id,null::uuid warranty_id,null::uuid product_id,
           jsonb_strip_nulls(jsonb_build_object('phone',c.phone,'whatsapp',c.whatsapp,'address',c.address,'tax_id',c.tax_id)) metadata
      from public.clients c
     where c.company_id=p_company and c.deleted_at is null
       and zt_private.zt_search_match(concat_ws(' ',c.name,c.trade_name,c.contact_name,c.phone,c.whatsapp,c.tax_id,c.address),v_query,v_digits)

    union all
    select 20,'location',l.id,l.name,
           concat_ws(' · ',coalesce(nullif(c.trade_name,''),c.name),nullif(l.address,'')),
           l.client_id,lw.id,l.id,null::uuid,null::uuid,
           jsonb_strip_nulls(jsonb_build_object('address',l.address,'client_name',coalesce(nullif(c.trade_name,''),c.name)))
      from public.client_locations l
      join public.clients c on c.id=l.client_id and c.company_id=l.company_id
      left join lateral (
        select w.id from public.work_orders w
         where w.company_id=l.company_id and w.client_id=l.client_id and w.client_location_id=l.id and w.deleted_at is null
         order by w.created_at desc limit 1
      ) lw on true
     where l.company_id=p_company
       and zt_private.zt_search_match(concat_ws(' ',l.name,l.address,c.name,c.trade_name),v_query,v_digits)

    union all
    select 30,'work_order',w.id,'OS #'||w.number,
           concat_ws(' · ',coalesce(nullif(c.trade_name,''),c.name),nullif(w.service_place,''),nullif(w.request,'')),
           w.client_id,w.id,w.client_location_id,null::uuid,null::uuid,
           jsonb_strip_nulls(jsonb_build_object('number',w.number,'status',w.status::text,'service_place',w.service_place,'address',w.address))
      from public.work_orders w
      join public.clients c on c.id=w.client_id and c.company_id=w.company_id
     where w.company_id=p_company and w.deleted_at is null
       and (
         zt_private.zt_search_match(concat_ws(' ',w.number,w.service_place,w.address,w.request,c.name,c.trade_name),v_query,v_digits)
         or exists(select 1 from public.work_order_items wi where wi.work_order_id=w.id and wi.company_id=w.company_id and zt_private.zt_search_match(wi.name,v_query,v_digits))
         or exists(select 1 from public.installed_equipment ie where ie.work_order_id=w.id and ie.company_id=w.company_id and zt_private.zt_search_match(concat_ws(' ',ie.name,ie.brand,ie.model,ie.serial_number,ie.barcode),v_query,v_digits))
       )

    union all
    select 40,'quote',q.id,'Orçamento #'||q.number,
           concat_ws(' · ',coalesce(nullif(c.trade_name,''),c.name),nullif(q.title,''),nullif(q.service_place,'')),
           q.client_id,null::uuid,q.client_location_id,null::uuid,null::uuid,
           jsonb_strip_nulls(jsonb_build_object('number',q.number,'status',q.status::text,'title',q.title,'service_place',q.service_place))
      from public.quotes q
      join public.clients c on c.id=q.client_id and c.company_id=q.company_id
     where q.company_id=p_company and q.deleted_at is null
       and (
         zt_private.zt_search_match(concat_ws(' ',q.number,q.title,q.description,q.service_place,q.address,c.name,c.trade_name),v_query,v_digits)
         or exists(select 1 from public.quote_items qi where qi.quote_id=q.id and qi.company_id=q.company_id and zt_private.zt_search_match(qi.name,v_query,v_digits))
       )

    union all
    select 50,'product',p.id,
           concat_ws(' ',nullif(p.brand,''),nullif(p.model,''),nullif(p.name,'')),
           concat_ws(' · ',case when p.sku is not null then 'SKU '||p.sku end,case when p.barcode is not null then 'Código '||p.barcode end),
           null::uuid,null::uuid,null::uuid,null::uuid,p.id,
           jsonb_strip_nulls(jsonb_build_object('brand',p.brand,'model',p.model,'sku',p.sku,'barcode',p.barcode,'active',p.active))
      from public.products p
     where p.company_id=p_company and p.deleted_at is null
       and zt_private.zt_search_match(concat_ws(' ',p.name,p.brand,p.model,p.sku,p.barcode,p.description),v_query,v_digits)

    union all
    select 60,'equipment',e.id,
           concat_ws(' ',nullif(e.brand,''),nullif(e.model,''),nullif(e.name,'')),
           concat_ws(' · ',coalesce(nullif(c.trade_name,''),c.name),l.name,case when e.serial_number is not null then 'Serial '||e.serial_number end),
           e.client_id,e.work_order_id,e.client_location_id,e.warranty_id,e.product_id,
           jsonb_strip_nulls(jsonb_build_object('serial_number',e.serial_number,'barcode',e.barcode,'location_name',l.name,'location_address',l.address,'installed_at',e.installed_at))
      from public.installed_equipment e
      join public.clients c on c.id=e.client_id and c.company_id=e.company_id
      join public.client_locations l on l.id=e.client_location_id and l.company_id=e.company_id and l.client_id=e.client_id
      left join public.products p on p.id=e.product_id and p.company_id=e.company_id
     where e.company_id=p_company
       and zt_private.zt_search_match(concat_ws(' ',e.name,e.brand,e.model,e.serial_number,e.barcode,l.name,l.address,c.name,c.trade_name,p.sku,p.barcode),v_query,v_digits)

    union all
    select 70,'warranty',w.id,'Garantia · '||w.description,
           concat_ws(' · ',coalesce(nullif(c.trade_name,''),c.name),nullif(w.service_place,''),'até '||to_char(w.ends_on,'DD/MM/YYYY')),
           w.client_id,w.work_order_id,null::uuid,w.id,w.product_id,
           jsonb_strip_nulls(jsonb_build_object('ends_on',w.ends_on,'serial_number',w.serial_number,'kind',w.kind::text,'service_place',w.service_place))
      from public.warranties w
      join public.clients c on c.id=w.client_id and c.company_id=w.company_id
      left join public.products p on p.id=w.product_id and p.company_id=w.company_id
      left join public.services s on s.id=w.service_id and s.company_id=w.company_id
     where w.company_id=p_company and w.deleted_at is null
       and zt_private.zt_search_match(concat_ws(' ',w.description,w.service_place,w.serial_number,c.name,c.trade_name,p.name,p.brand,p.model,p.sku,p.barcode,s.name),v_query,v_digits)
  ), page as (
    select * from hits
     order by priority,lower(title),entity_id
     limit v_limit+1 offset v_offset
  ), trimmed as (
    select * from page
     order by priority,lower(title),entity_id
     limit v_limit
  )
  select jsonb_build_object(
    'items',coalesce((select jsonb_agg(jsonb_build_object(
      'type',result_type,'id',entity_id,'title',title,'subtitle',subtitle,
      'client_id',client_id,'work_order_id',work_order_id,'client_location_id',client_location_id,
      'warranty_id',warranty_id,'product_id',product_id,'metadata',metadata
    ) order by priority,lower(title),entity_id) from trimmed),'[]'::jsonb),
    'has_more',(select count(*) from page)>v_limit,
    'next_offset',case when (select count(*) from page)>v_limit then v_offset+v_limit else null end
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.zt_global_operational_search(uuid,text,integer,integer) from public,anon;
grant execute on function public.zt_global_operational_search(uuid,text,integer,integer) to authenticated,service_role;

-- =============================================================================
-- PÓS-VENDA: POLÍTICAS + SNAPSHOT + AÇÕES
-- =============================================================================

create table if not exists public.post_sale_policies (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  kind text not null,
  days_offset integer not null,
  enabled boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint post_sale_policies_name_len check (char_length(name) between 1 and 200),
  constraint post_sale_policies_kind_ck check (kind in ('check_in','satisfaction','maintenance','warranty_expiring','custom')),
  constraint post_sale_policies_days_ck check (days_offset between 0 and 3650),
  unique(company_id,id)
);

create index if not exists idx_post_sale_policies_company_enabled
  on public.post_sale_policies(company_id,enabled,kind,days_offset);
create unique index if not exists uq_post_sale_warranty_policy_schedule
  on public.post_sale_policies(company_id,days_offset)
  where enabled and kind='warranty_expiring';

alter table public.post_sale_policies enable row level security;
revoke all on public.post_sale_policies from anon,authenticated;
grant select on public.post_sale_policies to authenticated;

drop policy if exists post_sale_policies_owner_select on public.post_sale_policies;
create policy post_sale_policies_owner_select on public.post_sale_policies
for select to authenticated using (public.zt_is_owner(company_id));

drop trigger if exists trg_subscription_write_guard on public.post_sale_policies;
create trigger trg_subscription_write_guard
before insert or update or delete on public.post_sale_policies
for each row execute function public.zt_guard_subscription_write();

alter table public.post_sale_followups alter column service_id drop not null;
alter table public.post_sale_followups alter column work_order_id drop not null;
alter table public.post_sale_followups
  add column if not exists policy_id uuid references public.post_sale_policies(id) on delete set null,
  add column if not exists warranty_id uuid references public.warranties(id) on delete set null,
  add column if not exists kind text not null default 'service_review',
  add column if not exists completed_by uuid references auth.users(id) on delete set null,
  add column if not exists note text,
  add column if not exists policy_snapshot jsonb,
  add column if not exists source_key text;

alter table public.post_sale_followups drop constraint if exists post_sale_followups_kind_ck;
alter table public.post_sale_followups add constraint post_sale_followups_kind_ck
  check (kind in ('service_review','check_in','satisfaction','maintenance','warranty_expiring','custom'));
alter table public.post_sale_followups drop constraint if exists post_sale_followups_note_len;
alter table public.post_sale_followups add constraint post_sale_followups_note_len
  check (note is null or char_length(note)<=5000);
alter table public.post_sale_followups drop constraint if exists post_sale_followups_source_key_len;
alter table public.post_sale_followups add constraint post_sale_followups_source_key_len
  check (source_key is null or char_length(source_key) between 1 and 500);

update public.post_sale_followups
   set source_key='legacy-service:'||work_order_id::text||':'||service_id::text,
       kind='service_review',
       policy_snapshot=coalesce(policy_snapshot,jsonb_build_object('source','services.followup_days'))
 where source_key is null;

alter table public.post_sale_followups alter column source_key set not null;
create unique index if not exists uq_post_sale_followups_source
  on public.post_sale_followups(company_id,source_key);
create index if not exists idx_post_sale_followups_policy
  on public.post_sale_followups(company_id,policy_id,due_on);
create index if not exists idx_post_sale_followups_warranty
  on public.post_sale_followups(company_id,warranty_id,due_on) where warranty_id is not null;

create or replace function public.zt_save_post_sale_policy(
  p_company uuid,
  p_policy uuid default null,
  p_name text default null,
  p_kind text default 'check_in',
  p_days_offset integer default 7,
  p_enabled boolean default true
) returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_id uuid;
  v_name text:=nullif(btrim(coalesce(p_name,'')),'');
  v_kind text:=lower(btrim(coalesce(p_kind,'')));
begin
  if auth.uid() is null then raise exception 'Não autenticado' using errcode='28000'; end if;
  if p_company is null or not zt_private.is_owner(p_company) then
    raise exception 'Somente o proprietário configura o pós-venda' using errcode='42501';
  end if;
  perform zt_private.assert_operational_write_allowed(p_company);
  if v_name is null or char_length(v_name)>200 then raise exception 'Nome da política inválido' using errcode='22023'; end if;
  if v_kind not in ('check_in','satisfaction','maintenance','warranty_expiring','custom') then raise exception 'Tipo de política inválido' using errcode='22023'; end if;
  if coalesce(p_days_offset,-1) not between 0 and 3650 then raise exception 'Prazo da política inválido' using errcode='22023'; end if;

  if p_policy is null then
    insert into public.post_sale_policies(company_id,name,kind,days_offset,enabled,created_by)
    values(p_company,v_name,v_kind,p_days_offset,coalesce(p_enabled,true),auth.uid()) returning id into v_id;
  else
    select id into v_id from public.post_sale_policies where id=p_policy and company_id=p_company for update;
    if not found then raise exception 'Política não pertence à empresa' using errcode='42501'; end if;
    update public.post_sale_policies
       set name=v_name,kind=v_kind,days_offset=p_days_offset,enabled=coalesce(p_enabled,true),updated_at=now()
     where id=v_id;
  end if;
  return v_id;
end;
$$;
revoke all on function public.zt_save_post_sale_policy(uuid,uuid,text,text,integer,boolean) from public,anon;
grant execute on function public.zt_save_post_sale_policy(uuid,uuid,text,text,integer,boolean) to authenticated,service_role;

create or replace function public.zt_list_post_sale_policies(p_company uuid)
returns table(id uuid,name text,kind text,days_offset integer,enabled boolean,created_at timestamptz,updated_at timestamptz)
language plpgsql
security definer
set search_path=''
as $$
begin
  if auth.uid() is null then raise exception 'Não autenticado' using errcode='28000'; end if;
  if p_company is null or not zt_private.is_owner(p_company) then raise exception 'Somente o proprietário consulta políticas' using errcode='42501'; end if;
  return query
    select p.id,p.name,p.kind,p.days_offset,p.enabled,p.created_at,p.updated_at
      from public.post_sale_policies p where p.company_id=p_company
     order by p.enabled desc,p.kind,p.days_offset,p.name;
end;
$$;
revoke all on function public.zt_list_post_sale_policies(uuid) from public,anon;
grant execute on function public.zt_list_post_sale_policies(uuid) to authenticated,service_role;

-- Amplia o trigger existente. Visita de garantia não reinicia ciclo comercial.
create or replace function zt_private.zt_generate_post_sale_followups()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare v_base date;
begin
  if new.status<>'done' or old.status='done' or coalesce(new.needs_return,false) or coalesce(new.is_warranty_visit,false) then
    return new;
  end if;
  v_base:=coalesce(new.completed_at::date,current_date);

  -- Compatibilidade: services.followup_days continua sendo uma fonte válida.
  insert into public.post_sale_followups(company_id,client_id,work_order_id,service_id,description,due_on,kind,policy_snapshot,source_key)
  select distinct on (s.id)
    new.company_id,new.client_id,new.id,s.id,left('Revisão de '||s.name,500),v_base+s.followup_days,
    'service_review',jsonb_build_object('source','services.followup_days','days_offset',s.followup_days,'service_name',s.name),
    'legacy-service:'||new.id::text||':'||s.id::text
  from public.work_order_items wi
  join public.services s on s.id=wi.service_id and s.company_id=new.company_id
  where wi.work_order_id=new.id and wi.company_id=new.company_id and wi.service_id is not null and coalesce(s.followup_days,0)>0
  order by s.id,wi.id
  on conflict (company_id,source_key) do nothing;

  insert into public.post_sale_followups(company_id,client_id,work_order_id,policy_id,description,due_on,kind,policy_snapshot,source_key)
  select new.company_id,new.client_id,new.id,p.id,left(p.name,500),v_base+p.days_offset,p.kind,
         jsonb_build_object('policy_id',p.id,'name',p.name,'kind',p.kind,'days_offset',p.days_offset,'basis','after_completion'),
         'policy:'||p.id::text||':wo:'||new.id::text
    from public.post_sale_policies p
   where p.company_id=new.company_id and p.enabled and p.kind<>'warranty_expiring'
  on conflict (company_id,source_key) do nothing;

  return new;
end;
$$;
revoke all on function zt_private.zt_generate_post_sale_followups() from public,anon,authenticated;
grant execute on function zt_private.zt_generate_post_sale_followups() to service_role;

-- Garantia é criada depois da mudança de status da OS; portanto o lembrete
-- relativo ao vencimento nasce no INSERT da própria garantia, não por texto da OS.
create or replace function zt_private.zt_generate_warranty_post_sale_followups()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if new.deleted_at is not null then return new; end if;
  insert into public.post_sale_followups(company_id,client_id,work_order_id,policy_id,warranty_id,description,due_on,kind,policy_snapshot,source_key)
  select new.company_id,new.client_id,new.work_order_id,p.id,new.id,
         left(p.name||' · '||new.description,500),new.ends_on-p.days_offset,'warranty_expiring',
         jsonb_build_object('policy_id',p.id,'name',p.name,'kind',p.kind,'days_offset',p.days_offset,'basis','before_warranty_end','warranty_ends_on',new.ends_on),
         'policy:'||p.id::text||':warranty:'||new.id::text
    from public.post_sale_policies p
   where p.company_id=new.company_id and p.enabled and p.kind='warranty_expiring'
  on conflict (company_id,source_key) do nothing;
  return new;
end;
$$;
revoke all on function zt_private.zt_generate_warranty_post_sale_followups() from public,anon,authenticated;
grant execute on function zt_private.zt_generate_warranty_post_sale_followups() to service_role;

drop trigger if exists trg_generate_warranty_post_sale_followups on public.warranties;
create trigger trg_generate_warranty_post_sale_followups
after insert on public.warranties
for each row execute function zt_private.zt_generate_warranty_post_sale_followups();

create or replace function zt_private.zt_manage_post_sale_followup(
  p_followup uuid,
  p_status text default null,
  p_scheduled_for date default null,
  p_note text default null
) returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v public.post_sale_followups%rowtype;
  v_status text;
  v_note text:=nullif(btrim(coalesce(p_note,'')),'');
  v_body text;
begin
  if auth.uid() is null then raise exception 'Não autenticado' using errcode='28000'; end if;
  select * into v from public.post_sale_followups where id=p_followup for update;
  if not found then raise exception 'Pós-venda não encontrado' using errcode='P0002'; end if;
  if not zt_private.is_owner(v.company_id) then raise exception 'Somente o proprietário gerencia o pós-venda' using errcode='42501'; end if;
  perform zt_private.assert_operational_write_allowed(v.company_id);

  v_status:=coalesce(nullif(lower(btrim(coalesce(p_status,''))),''),v.status);
  if v_status not in ('pending','done','dismissed') then raise exception 'Status de pós-venda inválido' using errcode='22023'; end if;
  if v_note is not null and char_length(v_note)>5000 then raise exception 'Observação muito longa' using errcode='22023'; end if;
  if p_scheduled_for is not null and v_status<>'pending' then raise exception 'Somente pós-venda pendente pode ser adiado' using errcode='22023'; end if;

  -- Estado terminal é idempotente e não é reaberto silenciosamente.
  if v.status in ('done','dismissed') then
    if v_status=v.status and p_scheduled_for is null and (v_note is null or v_note is not distinct from v.note) then return v.id; end if;
    raise exception 'Pós-venda já encerrado' using errcode='42501';
  end if;

  update public.post_sale_followups
     set status=v_status,
         due_on=coalesce(p_scheduled_for,due_on),
         note=coalesce(v_note,note),
         completed_at=case when v_status='done' then now() else null end,
         completed_by=case when v_status='done' then auth.uid() else null end,
         updated_at=now()
   where id=v.id;

  if v_status='done' and v.work_order_id is not null then
    v_body:=left('Pós-venda concluído · '||v.description||case when v_note is not null then E'\nObservação: '||v_note else '' end,10000);
    insert into public.work_order_reports(work_order_id,company_id,entry_type,body,author_id)
    values(v.work_order_id,v.company_id,'history',v_body,auth.uid());
  end if;
  return v.id;
end;
$$;
revoke all on function zt_private.zt_manage_post_sale_followup(uuid,text,date,text) from public,anon,authenticated;
grant execute on function zt_private.zt_manage_post_sale_followup(uuid,text,date,text) to service_role;

create or replace function public.zt_update_post_sale_followup(
  p_followup uuid,
  p_status text default null,
  p_scheduled_for date default null,
  p_note text default null
) returns uuid
language sql
security definer
set search_path=''
as $$
  select zt_private.zt_manage_post_sale_followup(p_followup,p_status,p_scheduled_for,p_note);
$$;
revoke all on function public.zt_update_post_sale_followup(uuid,text,date,text) from public,anon;
grant execute on function public.zt_update_post_sale_followup(uuid,text,date,text) to authenticated,service_role;

-- Compatibilidade com a UI legada já existente.
create or replace function zt_private.zt_set_followup_status(p_followup uuid,p_status text)
returns uuid
language sql
security definer
set search_path=''
as $$ select zt_private.zt_manage_post_sale_followup(p_followup,p_status,null,null); $$;
revoke all on function zt_private.zt_set_followup_status(uuid,text) from public,anon,authenticated;
grant execute on function zt_private.zt_set_followup_status(uuid,text) to service_role;

create or replace function public.zt_set_followup_status(p_followup uuid,p_status text)
returns uuid
language sql
security definer
set search_path=''
as $$ select zt_private.zt_manage_post_sale_followup(p_followup,p_status,null,null); $$;
revoke all on function public.zt_set_followup_status(uuid,text) from public,anon;
grant execute on function public.zt_set_followup_status(uuid,text) to authenticated,service_role;

create or replace function public.zt_list_post_sale_followups(
  p_company uuid,
  p_scope text default 'open',
  p_limit integer default 50,
  p_offset integer default 0
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_scope text:=lower(btrim(coalesce(p_scope,'open')));
  v_limit integer:=least(greatest(coalesce(p_limit,50),1),100);
  v_offset integer:=least(greatest(coalesce(p_offset,0),0),5000);
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'Não autenticado' using errcode='28000'; end if;
  if p_company is null or not zt_private.is_owner(p_company) then raise exception 'Somente o proprietário consulta o pós-venda' using errcode='42501'; end if;
  if v_scope not in ('open','completed','all') then raise exception 'Filtro de pós-venda inválido' using errcode='22023'; end if;

  with rows as (
    select f.id,f.kind,f.description,f.due_on,f.status,f.completed_at,f.completed_by,f.note,f.policy_snapshot,
           f.client_id,coalesce(nullif(c.trade_name,''),c.name) client_name,c.phone,c.whatsapp,
           f.work_order_id,wo.number work_order_number,wo.service_place,
           f.warranty_id,w.ends_on warranty_ends_on,
           f.policy_id,p.name policy_name,
           eq.id equipment_id,eq.name equipment_name,eq.brand equipment_brand,eq.model equipment_model
      from public.post_sale_followups f
      join public.clients c on c.id=f.client_id and c.company_id=f.company_id
      left join public.work_orders wo on wo.id=f.work_order_id and wo.company_id=f.company_id
      left join public.warranties w on w.id=f.warranty_id and w.company_id=f.company_id
      left join public.post_sale_policies p on p.id=f.policy_id and p.company_id=f.company_id
      left join lateral (
        select e.id,e.name,e.brand,e.model
          from public.installed_equipment e
         where e.company_id=f.company_id
           and ((f.warranty_id is not null and e.warranty_id=f.warranty_id)
             or (f.warranty_id is null and f.work_order_id is not null and e.work_order_id=f.work_order_id))
         order by e.installed_at desc limit 1
      ) eq on true
     where f.company_id=p_company
       and (v_scope='all' or (v_scope='open' and f.status='pending') or (v_scope='completed' and f.status in ('done','dismissed')))
     order by case when f.status='pending' then 0 else 1 end,f.due_on asc,f.created_at asc
     limit v_limit+1 offset v_offset
  ), trimmed as (
    select * from rows limit v_limit
  )
  select jsonb_build_object(
    'items',coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'id',id,'kind',kind,'description',description,'scheduled_for',due_on,'status',status,
      'completed_at',completed_at,'completed_by',completed_by,'note',note,'policy_snapshot',policy_snapshot,
      'client_id',client_id,'client_name',client_name,'phone',phone,'whatsapp',whatsapp,
      'work_order_id',work_order_id,'work_order_number',work_order_number,'service_place',service_place,
      'warranty_id',warranty_id,'warranty_ends_on',warranty_ends_on,'policy_id',policy_id,'policy_name',policy_name,
      'equipment_id',equipment_id,'equipment_name',equipment_name,'equipment_brand',equipment_brand,'equipment_model',equipment_model
    )) order by scheduled_for,id) from trimmed),'[]'::jsonb),
    'has_more',(select count(*) from rows)>v_limit,
    'next_offset',case when (select count(*) from rows)>v_limit then v_offset+v_limit else null end
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.zt_list_post_sale_followups(uuid,text,integer,integer) from public,anon;
grant execute on function public.zt_list_post_sale_followups(uuid,text,integer,integer) to authenticated,service_role;

notify pgrst,'reload schema';
