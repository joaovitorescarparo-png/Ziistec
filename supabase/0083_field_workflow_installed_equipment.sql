-- ZiisTec · FIELD WORKFLOW V1 · Wave 3A
-- Equipamento instalado durável + local lógico + serial/barcode/foto/garantia.
-- Backend é autoridade: company/client/product/warranty/anexo são derivados/validados pela OS.

create table if not exists public.client_locations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null,
  location_key text not null,
  address text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  constraint client_locations_client_company_fk foreign key (client_id,company_id)
    references public.clients(id,company_id),
  constraint client_locations_name_len check (char_length(name) between 1 and 300),
  constraint client_locations_key_len check (char_length(location_key) between 1 and 300),
  constraint client_locations_address_len check (address is null or char_length(address) <= 1000),
  unique(company_id,id),
  unique(company_id,client_id,location_key)
);

create table if not exists public.installed_equipment (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  client_location_id uuid not null references public.client_locations(id) on delete restrict,
  work_order_id uuid not null references public.work_orders(id) on delete restrict,
  product_id uuid references public.products(id) on delete set null,
  name text not null,
  brand text,
  model text,
  serial_number text,
  barcode text,
  image_attachment_id uuid references public.attachments(id) on delete set null,
  image_path text,
  installed_at timestamptz not null,
  notes text,
  warranty_id uuid references public.warranties(id) on delete set null,
  source_material_id uuid references public.work_order_materials(id) on delete set null,
  source_item_id uuid references public.work_order_items(id) on delete set null,
  registration_key text not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  constraint installed_equipment_client_company_fk foreign key (client_id,company_id)
    references public.clients(id,company_id),
  constraint installed_equipment_location_company_fk foreign key (client_location_id,company_id)
    references public.client_locations(id,company_id),
  constraint installed_equipment_work_order_company_fk foreign key (work_order_id,company_id)
    references public.work_orders(id,company_id),
  constraint installed_equipment_product_company_fk foreign key (product_id,company_id)
    references public.products(id,company_id),
  constraint installed_equipment_name_len check (char_length(name) between 1 and 500),
  constraint installed_equipment_brand_len check (brand is null or char_length(brand) <= 200),
  constraint installed_equipment_model_len check (model is null or char_length(model) <= 200),
  constraint installed_equipment_serial_len check (serial_number is null or char_length(serial_number) between 1 and 240),
  constraint installed_equipment_barcode_len check (barcode is null or char_length(barcode) between 1 and 240),
  constraint installed_equipment_image_path_len check (image_path is null or char_length(image_path) <= 1500),
  constraint installed_equipment_notes_len check (notes is null or char_length(notes) <= 5000),
  constraint installed_equipment_registration_key_len check (char_length(registration_key) between 1 and 600),
  constraint installed_equipment_source_check check ((source_material_id is null) <> (source_item_id is null)),
  unique(company_id,id),
  unique(company_id,registration_key)
);

create index if not exists idx_client_locations_client on public.client_locations(company_id,client_id,name);
create index if not exists idx_installed_equipment_client_location on public.installed_equipment(company_id,client_id,client_location_id,installed_at desc);
create index if not exists idx_installed_equipment_work_order on public.installed_equipment(company_id,work_order_id);
create index if not exists idx_installed_equipment_serial on public.installed_equipment(company_id,serial_number) where serial_number is not null;

alter table public.client_locations enable row level security;
alter table public.installed_equipment enable row level security;

drop policy if exists client_locations_visible on public.client_locations;
create policy client_locations_visible on public.client_locations
  for select to authenticated
  using (
    public.zt_is_owner(company_id)
    or exists (
      select 1 from public.installed_equipment e
       where e.client_location_id=client_locations.id
         and e.company_id=client_locations.company_id
         and public.zt_wo_is_mine(e.work_order_id)
    )
  );

drop policy if exists installed_equipment_visible on public.installed_equipment;
create policy installed_equipment_visible on public.installed_equipment
  for select to authenticated
  using (public.zt_is_owner(company_id) or public.zt_wo_is_mine(work_order_id));

revoke all on public.client_locations from anon, authenticated;
revoke all on public.installed_equipment from anon, authenticated;
grant select on public.client_locations to authenticated;
grant select on public.installed_equipment to authenticated;

-- Mantém o mesmo guard de assinatura dos demais dados operacionais.
drop trigger if exists trg_subscription_write_guard on public.client_locations;
create trigger trg_subscription_write_guard
before insert or update or delete on public.client_locations
for each row execute function public.zt_guard_subscription_write();

drop trigger if exists trg_subscription_write_guard on public.installed_equipment;
create trigger trg_subscription_write_guard
before insert or update or delete on public.installed_equipment
for each row execute function public.zt_guard_subscription_write();

create or replace function zt_private.zt_normalize_location_key(p_name text)
returns text
language sql
immutable
security invoker
set search_path=''
as $$
  select lower(regexp_replace(btrim(coalesce(p_name,'')), '\s+', ' ', 'g'));
$$;
revoke all on function zt_private.zt_normalize_location_key(text) from public,anon,authenticated;
grant execute on function zt_private.zt_normalize_location_key(text) to service_role;

create or replace function public.zt_register_installed_equipment(
  p_wo uuid,
  p_source_material uuid default null,
  p_source_item uuid default null,
  p_location_name text default null,
  p_location_id uuid default null,
  p_serial text default null,
  p_barcode text default null,
  p_notes text default null,
  p_image_attachment uuid default null
) returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_uid uuid := auth.uid();
  v_wo public.work_orders%rowtype;
  v_owner boolean;
  v_assigned boolean;
  v_product uuid;
  v_name text;
  v_brand text;
  v_model text;
  v_source_serial text;
  v_qty numeric;
  v_serial text;
  v_barcode text;
  v_notes text;
  v_location_name text;
  v_location_key text;
  v_location uuid;
  v_image_path text;
  v_warranty uuid;
  v_registration_key text;
  v_existing uuid;
begin
  if v_uid is null then raise exception 'Não autenticado' using errcode='28000'; end if;
  if (p_source_material is null) = (p_source_item is null) then
    raise exception 'Informe exatamente um produto/material de origem da OS' using errcode='22023';
  end if;

  select * into v_wo from public.work_orders where id=p_wo for update;
  if not found then raise exception 'Ordem de serviço não encontrada' using errcode='P0002'; end if;
  if v_wo.status <> 'done' then raise exception 'A OS precisa estar finalizada para registrar equipamento instalado' using errcode='23514'; end if;

  v_owner := zt_private.is_owner(v_wo.company_id);
  v_assigned := v_wo.assigned_to=v_uid and exists (
    select 1 from public.company_members m
     where m.company_id=v_wo.company_id and m.user_id=v_uid and m.role='technician' and m.status='active'
  );
  if not (v_owner or v_assigned) then raise exception 'Sem permissão para esta OS' using errcode='42501'; end if;
  perform zt_private.assert_operational_write_allowed(v_wo.company_id);

  if p_source_material is not null then
    select m.product_id,m.name,m.serial_number,m.quantity
      into v_product,v_name,v_source_serial,v_qty
      from public.work_order_materials m
     where m.id=p_source_material and m.work_order_id=p_wo and m.company_id=v_wo.company_id;
    if not found then raise exception 'Material não pertence a esta OS' using errcode='42501'; end if;
  else
    select i.product_id,i.name,null::text,i.quantity
      into v_product,v_name,v_source_serial,v_qty
      from public.work_order_items i
     where i.id=p_source_item and i.work_order_id=p_wo and i.company_id=v_wo.company_id and i.product_id is not null;
    if not found then raise exception 'O item selecionado não é um produto desta OS' using errcode='42501'; end if;
  end if;

  if v_product is not null then
    select p.brand,p.model into v_brand,v_model
      from public.products p where p.id=v_product and p.company_id=v_wo.company_id;
    if not found then raise exception 'Produto não pertence à empresa da OS' using errcode='42501'; end if;
  end if;

  v_serial := nullif(left(btrim(coalesce(p_serial,v_source_serial,'')),240),'');
  v_barcode := nullif(left(btrim(coalesce(p_barcode,'')),240),'');
  v_notes := nullif(left(btrim(coalesce(p_notes,'')),5000),'');
  if coalesce(v_qty,1) > 1 and v_serial is null then
    raise exception 'Quantidade maior que 1 exige serial para individualizar cada equipamento' using errcode='22023';
  end if;

  v_registration_key := case
    when p_source_material is not null then 'material:'||p_source_material::text
    else 'item:'||p_source_item::text
  end;
  if coalesce(v_qty,1) > 1 then
    v_registration_key := v_registration_key||':serial:'||lower(v_serial);
  end if;

  select e.id into v_existing
    from public.installed_equipment e
   where e.company_id=v_wo.company_id and e.registration_key=v_registration_key;
  if found then return v_existing; end if;

  if p_location_id is not null then
    select l.id,l.name into v_location,v_location_name
      from public.client_locations l
     where l.id=p_location_id and l.company_id=v_wo.company_id and l.client_id=v_wo.client_id;
    if not found then raise exception 'Local não pertence a este cliente/empresa' using errcode='42501'; end if;
  else
    v_location_name := left(coalesce(nullif(btrim(p_location_name),''),nullif(btrim(v_wo.service_place),''),nullif(btrim(v_wo.address),''),'Local do atendimento'),300);
    v_location_key := zt_private.zt_normalize_location_key(v_location_name);
    select l.id into v_location from public.client_locations l
     where l.company_id=v_wo.company_id and l.client_id=v_wo.client_id and l.location_key=v_location_key;
    if not found then
      begin
        insert into public.client_locations(company_id,client_id,name,location_key,address,created_by)
        values(v_wo.company_id,v_wo.client_id,v_location_name,v_location_key,left(nullif(btrim(v_wo.address),''),1000),v_uid)
        returning id into v_location;
      exception when unique_violation then
        select l.id into v_location from public.client_locations l
         where l.company_id=v_wo.company_id and l.client_id=v_wo.client_id and l.location_key=v_location_key;
      end;
    end if;
  end if;

  if p_image_attachment is not null then
    select a.path into v_image_path
      from public.attachments a
     where a.id=p_image_attachment and a.company_id=v_wo.company_id and a.work_order_id=p_wo
       and a.bucket='zt-work-orders' and a.media_kind='photo' and a.media_stage='equipment';
    if not found then raise exception 'Foto precisa ser evidência de equipamento desta OS' using errcode='42501'; end if;
  end if;

  if coalesce(v_wo.is_warranty_visit,false) and v_wo.warranty_id is not null then
    select w.id into v_warranty from public.warranties w
     where w.id=v_wo.warranty_id and w.company_id=v_wo.company_id and w.client_id=v_wo.client_id
       and (v_product is null or w.product_id is null or w.product_id=v_product);
  elsif v_product is not null then
    select w.id into v_warranty from public.warranties w
     where w.company_id=v_wo.company_id and w.client_id=v_wo.client_id and w.work_order_id=p_wo
       and w.kind='product' and w.product_id=v_product
       and (v_serial is null or w.serial_number is null or w.serial_number=v_serial)
     order by (w.serial_number=v_serial) desc nulls last,w.ends_on desc,w.id
     limit 1;
  end if;

  insert into public.installed_equipment(
    company_id,client_id,client_location_id,work_order_id,product_id,name,brand,model,
    serial_number,barcode,image_attachment_id,image_path,installed_at,notes,warranty_id,
    source_material_id,source_item_id,registration_key,created_by
  ) values(
    v_wo.company_id,v_wo.client_id,v_location,p_wo,v_product,left(btrim(v_name),500),
    left(nullif(btrim(v_brand),''),200),left(nullif(btrim(v_model),''),200),v_serial,v_barcode,
    p_image_attachment,v_image_path,coalesce(v_wo.completed_at,v_wo.updated_at,v_wo.created_at,now()),v_notes,v_warranty,
    p_source_material,p_source_item,v_registration_key,v_uid
  )
  on conflict(company_id,registration_key) do nothing
  returning id into v_existing;

  if v_existing is null then
    select e.id into v_existing from public.installed_equipment e
     where e.company_id=v_wo.company_id and e.registration_key=v_registration_key;
  end if;
  return v_existing;
end;
$$;
revoke all on function public.zt_register_installed_equipment(uuid,uuid,uuid,text,uuid,text,text,text,uuid) from public,anon;
grant execute on function public.zt_register_installed_equipment(uuid,uuid,uuid,text,uuid,text,text,text,uuid) to authenticated,service_role;

create or replace function public.zt_installed_equipment_history(p_client uuid)
returns table(
  id uuid,
  client_location_id uuid,
  location_name text,
  work_order_id uuid,
  work_order_number text,
  product_id uuid,
  name text,
  brand text,
  model text,
  serial_number text,
  barcode text,
  image_path text,
  installed_at timestamptz,
  notes text,
  warranty_id uuid,
  warranty_starts_on date,
  warranty_ends_on date,
  source_material_id uuid,
  source_item_id uuid
)
language sql
stable
security definer
set search_path=''
as $$
  select e.id,e.client_location_id,l.name,e.work_order_id,w.number,e.product_id,e.name,e.brand,e.model,
         e.serial_number,e.barcode,e.image_path,e.installed_at,e.notes,e.warranty_id,g.starts_on,g.ends_on,
         e.source_material_id,e.source_item_id
    from public.installed_equipment e
    join public.client_locations l on l.id=e.client_location_id and l.company_id=e.company_id
    join public.work_orders w on w.id=e.work_order_id and w.company_id=e.company_id
    left join public.warranties g on g.id=e.warranty_id and g.company_id=e.company_id
   where e.client_id=p_client
     and (
       zt_private.is_owner(e.company_id)
       or (
         w.assigned_to=auth.uid()
         and exists(select 1 from public.company_members m where m.company_id=e.company_id and m.user_id=auth.uid() and m.role='technician' and m.status='active')
       )
     )
   order by l.name,e.installed_at desc,e.created_at desc;
$$;
revoke all on function public.zt_installed_equipment_history(uuid) from public,anon;
grant execute on function public.zt_installed_equipment_history(uuid) to authenticated,service_role;

comment on table public.installed_equipment is 'Equipamentos duráveis efetivamente instalados no cliente/local; não representa materiais consumíveis.';
comment on column public.installed_equipment.serial_number is 'Serial físico do equipamento; texto livre limitado, distinto de SKU e barcode.';
comment on column public.installed_equipment.barcode is 'Código físico lido no equipamento quando aplicável; não substitui SKU nem serial.';
comment on column public.installed_equipment.image_path is 'Path validado de uma foto stage=equipment no bucket privado zt-work-orders; nunca base64.';
