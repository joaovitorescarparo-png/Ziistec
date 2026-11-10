-- =====================================================================
-- ZiisTec · migration 0050 — Central Técnica (fundação)
--
-- Biblioteca operacional para o técnico de campo: categorias, fabricantes,
-- modelos de equipamento, documentos técnicos e fichas rápidas.
--
-- Dois escopos de conhecimento na MESMA tabela, separados por company_id:
--   company_id IS NULL  → biblioteca global ZiisTec (leitura para todos os
--                         tenants; escrita apenas por platform admin AAL2
--                         ou service_role — nunca por usuário comum).
--   company_id NOT NULL → conhecimento privado da empresa (RLS por tenant;
--                         escrita do owner, leitura de qualquer membro ativo).
--
-- Idempotente. Não contém DROP TABLE, TRUNCATE nem DELETE de dados.
-- =====================================================================

-- ---------------------------------------------------------------- tipos
do $$ begin
  create type zt_eq_doc_type as enum
    ('manual','datasheet','diagram','guide','installation','programming',
     'troubleshooting','firmware','other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type zt_eq_doc_source as enum ('official_url','company_upload','ziistec_hosted');
exception when duplicate_object then null; end $$;

do $$ begin
  create type zt_eq_content_status as enum ('active','archived');
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------ categorias
create table if not exists public.equipment_categories (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  name       text not null check (length(btrim(name)) between 1 and 80),
  slug       text not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,78}[a-z0-9]$'),
  icon       text check (icon is null or length(icon) <= 40),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_eq_categories_global_slug
  on public.equipment_categories (slug) where company_id is null;
create unique index if not exists uq_eq_categories_company_slug
  on public.equipment_categories (company_id, slug) where company_id is not null;
create index if not exists idx_eq_categories_company
  on public.equipment_categories (company_id) where company_id is not null;

-- ----------------------------------------------------------- fabricantes
create table if not exists public.equipment_manufacturers (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  name       text not null check (length(btrim(name)) between 1 and 120),
  website    text check (website is null or website ~* '^https://'),
  logo_url   text check (logo_url is null or logo_url ~* '^https://'),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_eq_manufacturers_global_name
  on public.equipment_manufacturers (lower(name)) where company_id is null;
create unique index if not exists uq_eq_manufacturers_company_name
  on public.equipment_manufacturers (company_id, lower(name)) where company_id is not null;
create index if not exists idx_eq_manufacturers_company
  on public.equipment_manufacturers (company_id) where company_id is not null;

-- ------------------------------------------------- modelos de equipamento
create table if not exists public.equipment_models (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid references public.companies(id) on delete cascade,
  manufacturer_id uuid not null references public.equipment_manufacturers(id) on delete restrict,
  category_id     uuid not null references public.equipment_categories(id) on delete restrict,
  name            text not null check (length(btrim(name)) between 1 and 160),
  model_code      text check (model_code is null or length(model_code) <= 80),
  description     text check (description is null or length(description) <= 600),
  tags            text[] not null default '{}' check (array_length(tags,1) is null or array_length(tags,1) <= 20),
  status          zt_eq_content_status not null default 'active',
  created_by      uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_eq_models_company  on public.equipment_models (company_id) where company_id is not null;
create index if not exists idx_eq_models_category on public.equipment_models (category_id);
create index if not exists idx_eq_models_manufacturer on public.equipment_models (manufacturer_id);
create index if not exists idx_eq_models_created_by on public.equipment_models (created_by);

-- ----------------------------------------------------- documentos técnicos
-- Direitos autorais: conteúdo de terceiros entra como URL oficial (metadata
-- + link), nunca re-hospedado sem autorização. Upload próprio da empresa vai
-- para bucket privado com signed URL. is_official só por via administrativa.
create table if not exists public.equipment_documents (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid references public.companies(id) on delete cascade,
  model_id     uuid not null references public.equipment_models(id) on delete cascade,
  title        text not null check (length(btrim(title)) between 1 and 200),
  doc_type     zt_eq_doc_type not null default 'manual',
  version      text check (version is null or length(version) <= 40),
  language     text not null default 'pt-BR' check (length(language) <= 10),
  source_kind  zt_eq_doc_source not null,
  official_url text check (official_url is null or (official_url ~* '^https://' and length(official_url) <= 1000)),
  bucket       text check (bucket is null or bucket = 'zt-equipment-docs'),
  path         text check (path is null or length(path) <= 600),
  file_name    text check (file_name is null or length(file_name) <= 255),
  content_type text check (content_type is null or length(content_type) <= 120),
  size_bytes   bigint check (size_bytes is null or (size_bytes > 0 and size_bytes <= 52428800)),
  checksum     text check (checksum is null or checksum ~ '^[a-f0-9]{64}$'),
  is_official  boolean not null default false,
  status       zt_eq_content_status not null default 'active',
  created_by   uuid references public.profiles(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- cada origem exige os campos correspondentes
  constraint eq_docs_source_shape check (
    (source_kind = 'official_url'   and official_url is not null and path is null and bucket is null)
    or (source_kind = 'company_upload' and bucket is not null and path is not null and company_id is not null)
    or (source_kind = 'ziistec_hosted' and (official_url is not null or path is not null))
  )
);
create index if not exists idx_eq_docs_model   on public.equipment_documents (model_id, status);
create index if not exists idx_eq_docs_company on public.equipment_documents (company_id) where company_id is not null;
create index if not exists idx_eq_docs_created_by on public.equipment_documents (created_by);

-- ------------------------------------------------------------ ficha rápida
-- Seções estruturadas em JSONB validado (não é blob livre): alimentação,
-- bornes/ligações, programação, reset, parâmetros, diagnóstico, códigos,
-- alertas. Versionável (version) e pesquisável (search_text mantido por
-- trigger, indexado na migration 0051).
create table if not exists public.equipment_quick_guides (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid references public.companies(id) on delete cascade,
  model_id    uuid not null references public.equipment_models(id) on delete cascade,
  title       text not null default 'Ficha rápida' check (length(btrim(title)) between 1 and 160),
  sections    jsonb not null,
  version     integer not null default 1 check (version >= 1),
  status      zt_eq_content_status not null default 'active',
  search_text text not null default '',
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
-- uma ficha ATIVA por modelo e escopo (histórico fica como archived)
create unique index if not exists uq_eq_guides_global_active
  on public.equipment_quick_guides (model_id) where company_id is null and status = 'active';
create unique index if not exists uq_eq_guides_company_active
  on public.equipment_quick_guides (model_id, company_id) where company_id is not null and status = 'active';
create index if not exists idx_eq_guides_company on public.equipment_quick_guides (company_id) where company_id is not null;
create index if not exists idx_eq_guides_model on public.equipment_quick_guides (model_id);
create index if not exists idx_eq_guides_created_by on public.equipment_quick_guides (created_by);

-- ------------------------------------------------- favoritos e recentes
create table if not exists public.equipment_favorites (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  model_id   uuid not null references public.equipment_models(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, company_id, model_id)
);
create index if not exists idx_eq_favorites_company_model on public.equipment_favorites (company_id, model_id);

create table if not exists public.equipment_recent_views (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  model_id   uuid not null references public.equipment_models(id) on delete cascade,
  viewed_at  timestamptz not null default now(),
  primary key (user_id, company_id, model_id)
);
create index if not exists idx_eq_recent_user on public.equipment_recent_views (user_id, company_id, viewed_at desc);
create index if not exists idx_eq_recent_company_model on public.equipment_recent_views (company_id, model_id);

-- ------------------------------------------- áreas técnicas da empresa
create table if not exists public.company_technical_areas (
  company_id  uuid not null references public.companies(id) on delete cascade,
  category_id uuid not null references public.equipment_categories(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (company_id, category_id)
);

-- =====================================================================
-- Guardas de integridade de escopo (tenant nunca vaza por referência)
-- =====================================================================

-- modelo: global só referencia fabricante/categoria globais; privado pode
-- referenciar global ou da própria empresa — nunca de outra empresa.
create or replace function public.zt_eq_guard_model()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_mfr uuid; v_cat uuid;
begin
  select m.company_id into v_mfr from public.equipment_manufacturers m where m.id = new.manufacturer_id;
  select c.company_id into v_cat from public.equipment_categories c where c.id = new.category_id;
  if new.company_id is null then
    if v_mfr is not null or v_cat is not null then
      raise exception 'Modelo global exige fabricante e categoria globais' using errcode='23514';
    end if;
  else
    if (v_mfr is not null and v_mfr <> new.company_id)
       or (v_cat is not null and v_cat <> new.company_id) then
      raise exception 'Fabricante/categoria de outra empresa' using errcode='42501';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.zt_eq_guard_model() from public, anon, authenticated;
drop trigger if exists trg_eq_guard_model on public.equipment_models;
create trigger trg_eq_guard_model
  before insert or update of company_id, manufacturer_id, category_id
  on public.equipment_models
  for each row execute function public.zt_eq_guard_model();

-- conteúdo ligado a modelo: global exige modelo global; privado exige modelo
-- global ou da mesma empresa.
create or replace function public.zt_eq_guard_model_scope()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_model_company uuid;
begin
  select m.company_id into v_model_company from public.equipment_models m where m.id = new.model_id;
  if new.company_id is null then
    if v_model_company is not null then
      raise exception 'Conteúdo global exige modelo global' using errcode='23514';
    end if;
  elsif v_model_company is not null and v_model_company <> new.company_id then
    raise exception 'Modelo pertence a outra empresa' using errcode='42501';
  end if;
  return new;
end $$;
revoke all on function public.zt_eq_guard_model_scope() from public, anon, authenticated;

drop trigger if exists trg_eq_guard_doc_scope on public.equipment_documents;
create trigger trg_eq_guard_doc_scope
  before insert or update of company_id, model_id on public.equipment_documents
  for each row execute function public.zt_eq_guard_model_scope();

drop trigger if exists trg_eq_guard_guide_scope on public.equipment_quick_guides;
create trigger trg_eq_guard_guide_scope
  before insert or update of company_id, model_id on public.equipment_quick_guides
  for each row execute function public.zt_eq_guard_model_scope();

drop trigger if exists trg_eq_guard_favorite_scope on public.equipment_favorites;
create trigger trg_eq_guard_favorite_scope
  before insert or update of company_id, model_id on public.equipment_favorites
  for each row execute function public.zt_eq_guard_model_scope();

drop trigger if exists trg_eq_guard_recent_scope on public.equipment_recent_views;
create trigger trg_eq_guard_recent_scope
  before insert or update of company_id, model_id on public.equipment_recent_views
  for each row execute function public.zt_eq_guard_model_scope();

-- áreas técnicas: categoria global ou da própria empresa
create or replace function public.zt_eq_guard_area()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_cat uuid;
begin
  select c.company_id into v_cat from public.equipment_categories c where c.id = new.category_id;
  if v_cat is not null and v_cat <> new.company_id then
    raise exception 'Categoria pertence a outra empresa' using errcode='42501';
  end if;
  return new;
end $$;
revoke all on function public.zt_eq_guard_area() from public, anon, authenticated;
drop trigger if exists trg_eq_guard_area on public.company_technical_areas;
create trigger trg_eq_guard_area
  before insert or update on public.company_technical_areas
  for each row execute function public.zt_eq_guard_area();

-- --------------------------------------------- validação da ficha rápida
-- Estrutura: array de seções {kind, title, items:[{...campos texto...}]}.
-- Limites de tamanho impedem blob gigante e mantêm a ficha renderizável.
create or replace function public.zt_eq_validate_guide_sections(p jsonb)
returns void language plpgsql immutable as $$
declare
  v_section jsonb; v_item jsonb; v_key text; v_val jsonb;
  v_allowed_kinds constant text[] := array[
    'power','wiring','programming','reset','parameters','diagnostics','codes','alerts','other'];
  v_allowed_item_keys constant text[] := array[
    'label','value','steps','code','name','meaning','action','symptom','cause','test','solution','risk','note'];
  v_steps jsonb; v_step jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'array' then
    raise exception 'Ficha rápida: sections deve ser um array' using errcode='23514';
  end if;
  if jsonb_array_length(p) > 40 then
    raise exception 'Ficha rápida: máximo de 40 seções' using errcode='23514';
  end if;
  if pg_column_size(p) > 131072 then
    raise exception 'Ficha rápida: conteúdo excede 128KB' using errcode='23514';
  end if;
  for v_section in select * from jsonb_array_elements(p) loop
    if jsonb_typeof(v_section) <> 'object' then
      raise exception 'Ficha rápida: cada seção deve ser um objeto' using errcode='23514';
    end if;
    if not (v_section ? 'kind') or not (v_section->>'kind' = any (v_allowed_kinds)) then
      raise exception 'Ficha rápida: kind de seção inválido (%)', v_section->>'kind' using errcode='23514';
    end if;
    if not (v_section ? 'title') or jsonb_typeof(v_section->'title') <> 'string'
       or length(v_section->>'title') not between 1 and 120 then
      raise exception 'Ficha rápida: título de seção obrigatório (até 120 caracteres)' using errcode='23514';
    end if;
    if v_section ? 'items' then
      if jsonb_typeof(v_section->'items') <> 'array' or jsonb_array_length(v_section->'items') > 60 then
        raise exception 'Ficha rápida: items deve ser array com até 60 entradas' using errcode='23514';
      end if;
      for v_item in select * from jsonb_array_elements(v_section->'items') loop
        if jsonb_typeof(v_item) <> 'object' then
          raise exception 'Ficha rápida: cada item deve ser um objeto' using errcode='23514';
        end if;
        for v_key, v_val in select * from jsonb_each(v_item) loop
          if not (v_key = any (v_allowed_item_keys)) then
            raise exception 'Ficha rápida: campo de item não permitido (%)', v_key using errcode='23514';
          end if;
          if v_key = 'steps' then
            if jsonb_typeof(v_val) <> 'array' or jsonb_array_length(v_val) > 40 then
              raise exception 'Ficha rápida: steps deve ser array com até 40 passos' using errcode='23514';
            end if;
            for v_step in select * from jsonb_array_elements(v_val) loop
              if jsonb_typeof(v_step) <> 'string' or length(v_step #>> '{}') > 500 then
                raise exception 'Ficha rápida: cada passo deve ser texto de até 500 caracteres' using errcode='23514';
              end if;
            end loop;
          else
            if jsonb_typeof(v_val) <> 'string' or length(v_val #>> '{}') > 2000 then
              raise exception 'Ficha rápida: campo % deve ser texto de até 2000 caracteres', v_key using errcode='23514';
            end if;
          end if;
        end loop;
      end loop;
    end if;
  end loop;
end $$;
revoke all on function public.zt_eq_validate_guide_sections(jsonb) from public, anon, authenticated;

-- texto pesquisável derivado das seções (consumido pela 0051)
create or replace function public.zt_eq_guide_search_text(p jsonb)
returns text language sql immutable as $$
  select coalesce(string_agg(t, ' '), '') from (
    select s->>'title' as t from jsonb_array_elements(coalesce(p,'[]'::jsonb)) s
    union all
    select v.value #>> '{}' from jsonb_array_elements(coalesce(p,'[]'::jsonb)) s
      cross join lateral jsonb_array_elements(coalesce(s->'items','[]'::jsonb)) i
      cross join lateral jsonb_each(i.value) v(key, value)
      where jsonb_typeof(v.value) = 'string'
    union all
    select st #>> '{}' from jsonb_array_elements(coalesce(p,'[]'::jsonb)) s
      cross join lateral jsonb_array_elements(coalesce(s->'items','[]'::jsonb)) i
      cross join lateral jsonb_array_elements(coalesce(i->'steps','[]'::jsonb)) st
  ) x where t is not null;
$$;
revoke all on function public.zt_eq_guide_search_text(jsonb) from public, anon, authenticated;

create or replace function public.zt_eq_guide_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.zt_eq_validate_guide_sections(new.sections);
  new.search_text := left(public.zt_eq_guide_search_text(new.sections), 20000);
  if tg_op = 'UPDATE' and new.sections is distinct from old.sections then
    new.version := old.version + 1;
  end if;
  return new;
end $$;
revoke all on function public.zt_eq_guide_guard() from public, anon, authenticated;
drop trigger if exists trg_eq_guide_guard on public.equipment_quick_guides;
create trigger trg_eq_guide_guard
  before insert or update on public.equipment_quick_guides
  for each row execute function public.zt_eq_guide_guard();

-- updated_at automático (mesma convenção do resto do banco)
do $$
declare t text;
begin
  foreach t in array array['equipment_models','equipment_documents','equipment_quick_guides'] loop
    execute format('drop trigger if exists zt_touch_%1$s on public.%1$s', t);
    execute format('create trigger zt_touch_%1$s before update on public.%1$s for each row execute function public.zt_touch()', t);
  end loop;
end $$;

-- assinatura ativa para escrever conteúdo operacional (mesma regra da 0044,
-- tolerante ao escopo global: conteúdo global é escrito por admin/service_role
-- e não tem assinatura de tenant para validar)
create or replace function public.zt_guard_subscription_write_if_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
begin
  v_company := case when tg_op = 'DELETE' then old.company_id else new.company_id end;
  if v_company is not null then
    perform zt_private.assert_operational_write_allowed(v_company);
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
revoke all on function public.zt_guard_subscription_write_if_tenant() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array[
    'equipment_categories','equipment_manufacturers','equipment_models',
    'equipment_documents','equipment_quick_guides','company_technical_areas'
  ] loop
    execute format('drop trigger if exists trg_subscription_write_guard on public.%I', t);
    execute format('create trigger trg_subscription_write_guard
      before insert or update or delete on public.%I
      for each row
      when (pg_trigger_depth() = 0)
      execute function public.zt_guard_subscription_write_if_tenant()', t);
  end loop;
end $$;

-- =====================================================================
-- RLS
-- =====================================================================
alter table public.equipment_categories     enable row level security;
alter table public.equipment_manufacturers  enable row level security;
alter table public.equipment_models         enable row level security;
alter table public.equipment_documents      enable row level security;
alter table public.equipment_quick_guides   enable row level security;
alter table public.equipment_favorites      enable row level security;
alter table public.equipment_recent_views   enable row level security;
alter table public.company_technical_areas  enable row level security;

-- leitura: biblioteca global para qualquer autenticado com membresia ativa
-- em alguma empresa; conteúdo privado apenas para membros daquela empresa.
create or replace function public.zt_eq_can_read(target uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when target is null then public.zt_is_platform_admin() or exists (
      select 1 from public.company_members m
      where m.user_id = (select auth.uid()) and m.status = 'active')
    else public.zt_is_member(target)
  end;
$$;
revoke all on function public.zt_eq_can_read(uuid) from public, anon;
grant execute on function public.zt_eq_can_read(uuid) to authenticated, service_role;

-- escrita privada: owner da empresa. escrita global: platform admin (AAL2).
create or replace function public.zt_eq_can_write(target uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when target is null then public.zt_is_platform_admin()
    else public.zt_is_owner(target)
  end;
$$;
revoke all on function public.zt_eq_can_write(uuid) from public, anon;
grant execute on function public.zt_eq_can_write(uuid) to authenticated, service_role;

do $$
declare t text;
begin
  foreach t in array array[
    'equipment_categories','equipment_manufacturers','equipment_models',
    'equipment_documents','equipment_quick_guides'
  ] loop
    execute format('drop policy if exists p_%1$s_select on public.%1$s', t);
    execute format('create policy p_%1$s_select on public.%1$s for select to authenticated
      using (public.zt_eq_can_read(company_id))', t);
    execute format('drop policy if exists p_%1$s_insert on public.%1$s', t);
    execute format('create policy p_%1$s_insert on public.%1$s for insert to authenticated
      with check (public.zt_eq_can_write(company_id))', t);
    execute format('drop policy if exists p_%1$s_update on public.%1$s', t);
    execute format('create policy p_%1$s_update on public.%1$s for update to authenticated
      using (public.zt_eq_can_write(company_id)) with check (public.zt_eq_can_write(company_id))', t);
    execute format('drop policy if exists p_%1$s_delete on public.%1$s', t);
    execute format('create policy p_%1$s_delete on public.%1$s for delete to authenticated
      using (company_id is not null and public.zt_eq_can_write(company_id))', t);
  end loop;
end $$;

-- favoritos/recentes: sempre do próprio usuário, dentro de empresa onde
-- ele é membro ativo; o modelo precisa ser visível para aquele usuário.
drop policy if exists p_eq_favorites_all on public.equipment_favorites;
create policy p_eq_favorites_all on public.equipment_favorites for all to authenticated
  using (user_id = (select auth.uid()) and public.zt_is_member(company_id))
  with check (user_id = (select auth.uid()) and public.zt_is_member(company_id));

drop policy if exists p_eq_recent_all on public.equipment_recent_views;
create policy p_eq_recent_all on public.equipment_recent_views for all to authenticated
  using (user_id = (select auth.uid()) and public.zt_is_member(company_id))
  with check (user_id = (select auth.uid()) and public.zt_is_member(company_id));

drop policy if exists p_company_areas_select on public.company_technical_areas;
create policy p_company_areas_select on public.company_technical_areas for select to authenticated
  using (public.zt_is_member(company_id));
drop policy if exists p_company_areas_write on public.company_technical_areas;
create policy p_company_areas_write on public.company_technical_areas for all to authenticated
  using (public.zt_is_owner(company_id)) with check (public.zt_is_owner(company_id));

-- =====================================================================
-- Grants (padrão de menor privilégio da 0034; nada para anon)
-- =====================================================================
revoke all on table public.equipment_categories,
                     public.equipment_manufacturers,
                     public.equipment_models,
                     public.equipment_documents,
                     public.equipment_quick_guides,
                     public.equipment_favorites,
                     public.equipment_recent_views,
                     public.company_technical_areas
  from public, anon;

grant select, insert, update, delete on table
  public.equipment_categories,
  public.equipment_manufacturers,
  public.equipment_models,
  public.equipment_documents,
  public.equipment_quick_guides,
  public.equipment_favorites,
  public.equipment_recent_views,
  public.company_technical_areas
  to authenticated;

grant all on table
  public.equipment_categories,
  public.equipment_manufacturers,
  public.equipment_models,
  public.equipment_documents,
  public.equipment_quick_guides,
  public.equipment_favorites,
  public.equipment_recent_views,
  public.company_technical_areas
  to service_role;

-- =====================================================================
-- Storage: bucket privado para documentos de equipamento da empresa
--   caminho: company_id/equipment/<model_id>/<arquivo>
--   leitura: qualquer membro ativo da empresa (técnico consulta manual)
--   escrita/remoção: owner, com assinatura ativa
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('zt-equipment-docs', 'zt-equipment-docs', false, 52428800,
        array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists zt_eq_docs_read on storage.objects;
create policy zt_eq_docs_read on storage.objects for select to authenticated using (
  bucket_id = 'zt-equipment-docs'
  and public.zt_is_member(public.zt_path_company(name))
  and name like public.zt_path_company(name)::text || '/equipment/%'
);

drop policy if exists zt_eq_docs_write on storage.objects;
create policy zt_eq_docs_write on storage.objects for insert to authenticated with check (
  bucket_id = 'zt-equipment-docs'
  and public.zt_is_owner(public.zt_path_company(name))
  and public.zt_subscription_can_write(public.zt_path_company(name))
  and name like public.zt_path_company(name)::text || '/equipment/%'
);

drop policy if exists zt_eq_docs_delete on storage.objects;
create policy zt_eq_docs_delete on storage.objects for delete to authenticated using (
  bucket_id = 'zt-equipment-docs'
  and public.zt_is_owner(public.zt_path_company(name))
);

-- =====================================================================
-- Categorias globais iniciais (metadados neutros; sem conteúdo técnico)
-- =====================================================================
insert into public.equipment_categories (company_id, name, slug, icon) values
  (null, 'Fechaduras',            'fechaduras',          'lock'),
  (null, 'Controle de acesso',    'controle-de-acesso',  'key'),
  (null, 'Portões',               'portoes',             'door'),
  (null, 'CFTV',                  'cftv',                'camera'),
  (null, 'Alarmes',               'alarmes',             'bell'),
  (null, 'Interfonia',            'interfonia',          'phone'),
  (null, 'Elétrica',              'eletrica',            'zap'),
  (null, 'Automação',             'automacao',           'cpu'),
  (null, 'Ar-condicionado',       'ar-condicionado',     'wind'),
  (null, 'Bombas',                'bombas',              'droplets'),
  (null, 'Redes',                 'redes',               'network')
on conflict do nothing;
