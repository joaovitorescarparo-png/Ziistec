-- ZiisTec · CENTRAL TÉCNICA V1 (0113) — biblioteca técnica: categoria, fabricante,
-- modelo de equipamento, documento técnico e ficha rápida.
--
-- Auditoria antes de criar (o que já existe e NÃO é duplicado aqui):
--   * public.products (catálogo comercial: preço, estoque, SKU, venda) continua sendo
--     a autoridade de produto vendável. Modelo técnico não tem preço nem estoque.
--   * public.installed_equipment + public.client_locations (0083) continuam sendo a
--     autoridade da UNIDADE FÍSICA instalada no cliente. Nada aqui registra unidade
--     física; a 0115 apenas liga a unidade existente ao modelo técnico.
--   * public.work_order_technical_base (0111) continua sendo a autoridade do
--     conhecimento do atendimento. A 0115 lê dela; nenhuma cópia é feita.
--   * Busca segue a convenção da 0087 (pg_trgm + lower, sem extensão nova e sem
--     serviço externo). Nenhuma extensão é instalada por esta migration.
--
-- O que é novo e por quê: MODELO DE MERCADO/CONHECIMENTO (ex.: "Intelbras FR 101").
-- Não existia no produto. É o que dá ficha rápida, manual, esquema e casos ao técnico.
--
-- Dois escopos na mesma tabela, separados por company_id:
--   company_id IS NULL  -> biblioteca global ZiisTec: leitura para membro ativo de
--                          qualquer empresa; escrita só platform admin (AAL2)/service_role.
--   company_id NOT NULL -> conhecimento privado da empresa: leitura de membro ativo
--                          daquela empresa; escrita do owner.
-- Idempotente. Sem DROP TABLE, TRUNCATE ou DELETE de dados.

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

-- ------------------------------------------------------------------ helpers
-- Normalização de busca sem extensão nova: dobra acento e caixa. IMMUTABLE para
-- servir coluna gerada e índice. Convenção da 0087: trigrama sobre lower().
create or replace function public.zt_ct_norm(p_value text)
returns text
language sql
immutable
security invoker
set search_path=''
as $$
  select translate(
    lower(coalesce(p_value,'')),
    'áàâãäåéèêëíìîïóòôõöøúùûüçñ',
    'aaaaaaeeeeiiiioooooouuuucn'
  );
$$;
revoke all on function public.zt_ct_norm(text) from public,anon;
grant execute on function public.zt_ct_norm(text) to authenticated,service_role;

-- Código compacto: só letras/números. Faz "FR101" encontrar "FR 101" e "FR-101".
create or replace function public.zt_ct_compact(p_value text)
returns text
language sql
immutable
security invoker
set search_path=''
as $$
  select regexp_replace(public.zt_ct_norm(p_value),'[^a-z0-9]','','g');
$$;
revoke all on function public.zt_ct_compact(text) from public,anon;
grant execute on function public.zt_ct_compact(text) to authenticated,service_role;

-- array_to_string é STABLE no catálogo; para text[] puro o resultado é
-- determinístico. Wrapper imutável para a coluna gerada de tags.
create or replace function public.zt_ct_join_tags(p_tags text[])
returns text
language sql
immutable
security invoker
set search_path=''
as $$
  select coalesce(array_to_string(p_tags,' '),'');
$$;
revoke all on function public.zt_ct_join_tags(text[]) from public,anon;
grant execute on function public.zt_ct_join_tags(text[]) to authenticated,service_role;

-- Leitura: global para membro ativo de qualquer empresa; privado só da empresa.
create or replace function public.zt_eq_can_read(p_company uuid)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select case
    when p_company is null then
      public.zt_is_platform_admin()
      or exists (
        select 1 from public.company_members m
         where m.user_id=(select auth.uid()) and m.status='active'
      )
    else public.zt_is_member(p_company)
  end;
$$;
revoke all on function public.zt_eq_can_read(uuid) from public,anon;
grant execute on function public.zt_eq_can_read(uuid) to authenticated,service_role;

-- Escrita: privado = owner da empresa; global = platform admin (AAL2)/service_role.
-- Usuário comum nunca escreve conteúdo global, nem escondendo botão no frontend.
create or replace function public.zt_eq_can_write(p_company uuid)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select case
    when p_company is null then public.zt_is_platform_admin()
    else public.zt_is_owner(p_company)
  end;
$$;
revoke all on function public.zt_eq_can_write(uuid) from public,anon;
grant execute on function public.zt_eq_can_write(uuid) to authenticated,service_role;

-- Mesmo guard de assinatura dos demais dados operacionais (0044/0045), tolerante
-- ao escopo global: linha global não tem empresa e portanto não tem assinatura.
create or replace function public.zt_guard_subscription_write_if_tenant()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_company uuid;
begin
  v_company := case when tg_op='DELETE' then old.company_id else new.company_id end;
  if v_company is not null then
    perform zt_private.assert_operational_write_allowed(v_company);
  end if;
  return case when tg_op='DELETE' then old else new end;
end;
$$;
revoke all on function public.zt_guard_subscription_write_if_tenant() from public,anon,authenticated;
grant execute on function public.zt_guard_subscription_write_if_tenant() to service_role;

-- ---------------------------------------------------------------- categorias
create table if not exists public.equipment_categories (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  name text not null,
  slug text not null,
  icon text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  constraint equipment_categories_name_len check (char_length(btrim(name)) between 1 and 80),
  constraint equipment_categories_slug_shape check (slug ~ '^[a-z0-9][a-z0-9-]{0,78}[a-z0-9]$'),
  constraint equipment_categories_icon_len check (icon is null or char_length(icon) <= 40)
);
create unique index if not exists uq_equipment_categories_global_slug
  on public.equipment_categories(slug) where company_id is null;
create unique index if not exists uq_equipment_categories_company_slug
  on public.equipment_categories(company_id,slug) where company_id is not null;
create index if not exists idx_equipment_categories_company
  on public.equipment_categories(company_id) where company_id is not null;
create index if not exists idx_equipment_categories_created_by
  on public.equipment_categories(created_by);

-- --------------------------------------------------------------- fabricantes
create table if not exists public.equipment_manufacturers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  name text not null,
  website text,
  logo_url text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  constraint equipment_manufacturers_name_len check (char_length(btrim(name)) between 1 and 120),
  constraint equipment_manufacturers_website_https
    check (website is null or (website ~* '^https://' and char_length(website) <= 1000)),
  constraint equipment_manufacturers_logo_https
    check (logo_url is null or (logo_url ~* '^https://' and char_length(logo_url) <= 1000))
);
create unique index if not exists uq_equipment_manufacturers_global_name
  on public.equipment_manufacturers(lower(name)) where company_id is null;
create unique index if not exists uq_equipment_manufacturers_company_name
  on public.equipment_manufacturers(company_id,lower(name)) where company_id is not null;
create index if not exists idx_equipment_manufacturers_company
  on public.equipment_manufacturers(company_id) where company_id is not null;
create index if not exists idx_equipment_manufacturers_created_by
  on public.equipment_manufacturers(created_by);
create index if not exists idx_equipment_manufacturers_search_trgm
  on public.equipment_manufacturers using gin (public.zt_ct_norm(name) gin_trgm_ops);

-- ------------------------------------------------- modelo técnico de mercado
create table if not exists public.equipment_models (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  manufacturer_id uuid not null references public.equipment_manufacturers(id) on delete restrict,
  category_id uuid not null references public.equipment_categories(id) on delete restrict,
  name text not null,
  model_code text,
  description text,
  tags text[] not null default '{}',
  status zt_eq_content_status not null default 'active',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_text text generated always as (
    public.zt_ct_norm(name)||' '||
    public.zt_ct_norm(coalesce(model_code,''))||' '||
    public.zt_ct_norm(coalesce(description,''))||' '||
    public.zt_ct_norm(public.zt_ct_join_tags(tags))
  ) stored,
  compact_code text generated always as (
    public.zt_ct_compact(name||' '||coalesce(model_code,''))
  ) stored,
  constraint equipment_models_name_len check (char_length(btrim(name)) between 1 and 160),
  constraint equipment_models_code_len check (model_code is null or char_length(model_code) <= 80),
  constraint equipment_models_description_len check (description is null or char_length(description) <= 600),
  constraint equipment_models_tags_len check (coalesce(array_length(tags,1),0) <= 20),
  unique (company_id,id)
);
create index if not exists idx_equipment_models_company
  on public.equipment_models(company_id) where company_id is not null;
create index if not exists idx_equipment_models_category
  on public.equipment_models(category_id,status);
create index if not exists idx_equipment_models_manufacturer
  on public.equipment_models(manufacturer_id);
create index if not exists idx_equipment_models_created_by
  on public.equipment_models(created_by);
create index if not exists idx_equipment_models_search_trgm
  on public.equipment_models using gin (search_text gin_trgm_ops);
create index if not exists idx_equipment_models_compact_trgm
  on public.equipment_models using gin (compact_code gin_trgm_ops);

-- ------------------------------------------------------- documento técnico
-- Direito autoral: conteúdo de terceiro entra como METADADO + link oficial.
-- Upload só do que a empresa pode guardar, em bucket privado por tenant.
-- is_official nunca é decidido pelo browser: só escopo global/administrativo.
create table if not exists public.equipment_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  model_id uuid not null references public.equipment_models(id) on delete cascade,
  title text not null,
  doc_type zt_eq_doc_type not null default 'manual',
  version text,
  language text not null default 'pt-BR',
  source_kind zt_eq_doc_source not null,
  official_url text,
  bucket text,
  path text,
  file_name text,
  content_type text,
  size_bytes bigint,
  checksum text,
  is_official boolean not null default false,
  status zt_eq_content_status not null default 'active',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_text text generated always as (public.zt_ct_norm(title)) stored,
  constraint equipment_documents_title_len check (char_length(btrim(title)) between 1 and 200),
  constraint equipment_documents_version_len check (version is null or char_length(version) <= 40),
  constraint equipment_documents_language_len check (char_length(language) between 2 and 10),
  constraint equipment_documents_url_https
    check (official_url is null or (official_url ~* '^https://' and char_length(official_url) <= 1000)),
  constraint equipment_documents_bucket_ck check (bucket is null or bucket='zt-equipment-docs'),
  constraint equipment_documents_path_len check (path is null or char_length(path) <= 600),
  constraint equipment_documents_file_name_len check (file_name is null or char_length(file_name) <= 255),
  constraint equipment_documents_content_type_len check (content_type is null or char_length(content_type) <= 120),
  constraint equipment_documents_size_ck check (size_bytes is null or (size_bytes > 0 and size_bytes <= 52428800)),
  constraint equipment_documents_checksum_shape check (checksum is null or checksum ~ '^[a-f0-9]{64}$'),
  constraint equipment_documents_source_shape check (
    (source_kind='official_url' and official_url is not null and bucket is null and path is null)
    or (source_kind='company_upload' and bucket is not null and path is not null and company_id is not null)
    or (source_kind='ziistec_hosted' and (official_url is not null or path is not null))
  )
);
create index if not exists idx_equipment_documents_model
  on public.equipment_documents(model_id,status);
create index if not exists idx_equipment_documents_company
  on public.equipment_documents(company_id) where company_id is not null;
create index if not exists idx_equipment_documents_created_by
  on public.equipment_documents(created_by);
create index if not exists idx_equipment_documents_search_trgm
  on public.equipment_documents using gin (search_text gin_trgm_ops);

-- ------------------------------------------------------------- ficha rápida
-- Seções estruturadas em JSONB VALIDADO (não é blob livre): alimentação, bornes,
-- programação, reset, parâmetros, diagnóstico, códigos/LEDs e alertas.
-- Versionada e pesquisável; search_text é derivado por trigger.
create table if not exists public.equipment_quick_guides (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  model_id uuid not null references public.equipment_models(id) on delete cascade,
  title text not null default 'Ficha rápida',
  sections jsonb not null,
  version integer not null default 1,
  status zt_eq_content_status not null default 'active',
  search_text text not null default '',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint equipment_quick_guides_title_len check (char_length(btrim(title)) between 1 and 160),
  constraint equipment_quick_guides_version_ck check (version >= 1),
  constraint equipment_quick_guides_search_len check (char_length(search_text) <= 20000)
);
-- Uma ficha ATIVA por modelo e por escopo; histórico fica como archived.
create unique index if not exists uq_equipment_quick_guides_global_active
  on public.equipment_quick_guides(model_id) where company_id is null and status='active';
create unique index if not exists uq_equipment_quick_guides_company_active
  on public.equipment_quick_guides(model_id,company_id) where company_id is not null and status='active';
create index if not exists idx_equipment_quick_guides_model
  on public.equipment_quick_guides(model_id,status);
create index if not exists idx_equipment_quick_guides_company
  on public.equipment_quick_guides(company_id) where company_id is not null;
create index if not exists idx_equipment_quick_guides_created_by
  on public.equipment_quick_guides(created_by);
create index if not exists idx_equipment_quick_guides_search_trgm
  on public.equipment_quick_guides using gin (search_text gin_trgm_ops);

-- --------------------------------------------------- favoritos e recentes
create table if not exists public.equipment_favorites (
  user_id uuid not null references public.profiles(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  model_id uuid not null references public.equipment_models(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id,company_id,model_id)
);
create index if not exists idx_equipment_favorites_company_model
  on public.equipment_favorites(company_id,model_id);

create table if not exists public.equipment_recent_views (
  user_id uuid not null references public.profiles(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  model_id uuid not null references public.equipment_models(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (user_id,company_id,model_id)
);
create index if not exists idx_equipment_recent_views_user
  on public.equipment_recent_views(user_id,company_id,viewed_at desc);
create index if not exists idx_equipment_recent_views_company_model
  on public.equipment_recent_views(company_id,model_id);

-- ------------------------------------------- áreas técnicas da empresa
create table if not exists public.company_technical_areas (
  company_id uuid not null references public.companies(id) on delete cascade,
  category_id uuid not null references public.equipment_categories(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (company_id,category_id)
);

-- =====================================================================
-- Guardas de integridade de escopo: tenant nunca vaza por referência
-- =====================================================================

-- Modelo global só referencia fabricante/categoria globais. Modelo privado pode
-- referenciar global ou da própria empresa — nunca de outra empresa.
create or replace function public.zt_eq_guard_model()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_manufacturer uuid;
  v_category uuid;
  v_manufacturer_found boolean;
  v_category_found boolean;
begin
  select m.company_id into v_manufacturer
    from public.equipment_manufacturers m where m.id=new.manufacturer_id;
  v_manufacturer_found := found;
  select c.company_id into v_category
    from public.equipment_categories c where c.id=new.category_id;
  v_category_found := found;
  if not v_manufacturer_found or not v_category_found then
    raise exception 'Fabricante ou categoria inexistente' using errcode='23503';
  end if;
  if new.company_id is null then
    if v_manufacturer is not null or v_category is not null then
      raise exception 'Modelo global exige fabricante e categoria globais' using errcode='23514';
    end if;
  else
    if (v_manufacturer is not null and v_manufacturer <> new.company_id)
       or (v_category is not null and v_category <> new.company_id) then
      raise exception 'Fabricante/categoria pertence a outra empresa' using errcode='42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.zt_eq_guard_model() from public,anon,authenticated;
grant execute on function public.zt_eq_guard_model() to service_role;
drop trigger if exists trg_equipment_models_scope on public.equipment_models;
create trigger trg_equipment_models_scope
before insert or update of company_id,manufacturer_id,category_id on public.equipment_models
for each row execute function public.zt_eq_guard_model();

-- Conteúdo ligado a modelo: global exige modelo global; privado exige modelo
-- global ou da mesma empresa.
create or replace function public.zt_eq_guard_model_scope()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_model_company uuid;
begin
  select m.company_id into v_model_company
    from public.equipment_models m where m.id=new.model_id;
  if not found then
    raise exception 'Modelo inexistente' using errcode='23503';
  end if;
  if new.company_id is null then
    if v_model_company is not null then
      raise exception 'Conteúdo global exige modelo global' using errcode='23514';
    end if;
  elsif v_model_company is not null and v_model_company <> new.company_id then
    raise exception 'Modelo pertence a outra empresa' using errcode='42501';
  end if;
  return new;
end;
$$;
revoke all on function public.zt_eq_guard_model_scope() from public,anon,authenticated;
grant execute on function public.zt_eq_guard_model_scope() to service_role;

drop trigger if exists trg_equipment_documents_scope on public.equipment_documents;
create trigger trg_equipment_documents_scope
before insert or update of company_id,model_id on public.equipment_documents
for each row execute function public.zt_eq_guard_model_scope();

drop trigger if exists trg_equipment_quick_guides_scope on public.equipment_quick_guides;
create trigger trg_equipment_quick_guides_scope
before insert or update of company_id,model_id on public.equipment_quick_guides
for each row execute function public.zt_eq_guard_model_scope();

drop trigger if exists trg_equipment_favorites_scope on public.equipment_favorites;
create trigger trg_equipment_favorites_scope
before insert or update of company_id,model_id on public.equipment_favorites
for each row execute function public.zt_eq_guard_model_scope();

drop trigger if exists trg_equipment_recent_views_scope on public.equipment_recent_views;
create trigger trg_equipment_recent_views_scope
before insert or update of company_id,model_id on public.equipment_recent_views
for each row execute function public.zt_eq_guard_model_scope();

-- Área técnica: categoria global ou da própria empresa.
create or replace function public.zt_eq_guard_area()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_category uuid;
begin
  select c.company_id into v_category
    from public.equipment_categories c where c.id=new.category_id;
  if not found then
    raise exception 'Categoria inexistente' using errcode='23503';
  end if;
  if v_category is not null and v_category <> new.company_id then
    raise exception 'Categoria pertence a outra empresa' using errcode='42501';
  end if;
  return new;
end;
$$;
revoke all on function public.zt_eq_guard_area() from public,anon,authenticated;
grant execute on function public.zt_eq_guard_area() to service_role;
drop trigger if exists trg_company_technical_areas_scope on public.company_technical_areas;
create trigger trg_company_technical_areas_scope
before insert or update on public.company_technical_areas
for each row execute function public.zt_eq_guard_area();

-- ------------------------------------------- validação da ficha rápida
-- Estrutura: array de seções {kind,title,items:[{campos de texto}]}. Os limites
-- impedem blob gigante e mantêm a ficha renderizável e pesquisável.
create or replace function zt_private.zt_eq_validate_guide_sections(p_sections jsonb)
returns void
language plpgsql
immutable
security invoker
set search_path=''
as $$
declare
  v_section jsonb;
  v_item jsonb;
  v_key text;
  v_value jsonb;
  v_step jsonb;
  v_allowed_kinds constant text[] := array[
    'power','wiring','programming','reset','parameters','diagnostics','codes','alerts','other'];
  v_allowed_item_keys constant text[] := array[
    'label','value','steps','code','name','meaning','action',
    'symptom','cause','test','solution','risk','note'];
begin
  if p_sections is null or jsonb_typeof(p_sections) <> 'array' then
    raise exception 'Ficha rápida: as seções precisam ser uma lista' using errcode='22023';
  end if;
  if jsonb_array_length(p_sections) > 40 then
    raise exception 'Ficha rápida: no máximo 40 seções' using errcode='22023';
  end if;
  if pg_column_size(p_sections) > 131072 then
    raise exception 'Ficha rápida: conteúdo acima de 128KB' using errcode='22023';
  end if;
  for v_section in select value from jsonb_array_elements(p_sections) loop
    if jsonb_typeof(v_section) <> 'object' then
      raise exception 'Ficha rápida: cada seção precisa ser um objeto' using errcode='22023';
    end if;
    if not (v_section ? 'kind') or not (v_section->>'kind' = any (v_allowed_kinds)) then
      raise exception 'Ficha rápida: tipo de seção inválido' using errcode='22023';
    end if;
    if not (v_section ? 'title') or jsonb_typeof(v_section->'title') <> 'string'
       or char_length(v_section->>'title') not between 1 and 120 then
      raise exception 'Ficha rápida: título de seção obrigatório com até 120 caracteres' using errcode='22023';
    end if;
    if v_section ? 'items' then
      if jsonb_typeof(v_section->'items') <> 'array' or jsonb_array_length(v_section->'items') > 60 then
        raise exception 'Ficha rápida: cada seção aceita até 60 itens' using errcode='22023';
      end if;
      for v_item in select value from jsonb_array_elements(v_section->'items') loop
        if jsonb_typeof(v_item) <> 'object' then
          raise exception 'Ficha rápida: cada item precisa ser um objeto' using errcode='22023';
        end if;
        for v_key,v_value in select key,value from jsonb_each(v_item) loop
          if not (v_key = any (v_allowed_item_keys)) then
            raise exception 'Ficha rápida: campo de item não permitido' using errcode='22023';
          end if;
          if v_key='steps' then
            if jsonb_typeof(v_value) <> 'array' or jsonb_array_length(v_value) > 40 then
              raise exception 'Ficha rápida: até 40 passos por procedimento' using errcode='22023';
            end if;
            for v_step in select value from jsonb_array_elements(v_value) loop
              if jsonb_typeof(v_step) <> 'string' or char_length(v_step #>> '{}') > 500 then
                raise exception 'Ficha rápida: cada passo aceita até 500 caracteres' using errcode='22023';
              end if;
            end loop;
          else
            if jsonb_typeof(v_value) <> 'string' or char_length(v_value #>> '{}') > 2000 then
              raise exception 'Ficha rápida: cada campo aceita até 2.000 caracteres de texto' using errcode='22023';
            end if;
          end if;
        end loop;
      end loop;
    end if;
  end loop;
end;
$$;
revoke all on function zt_private.zt_eq_validate_guide_sections(jsonb) from public,anon,authenticated;
grant execute on function zt_private.zt_eq_validate_guide_sections(jsonb) to service_role;

-- Texto pesquisável derivado das seções (títulos, valores e passos).
create or replace function zt_private.zt_eq_guide_search_text(p_sections jsonb)
returns text
language sql
immutable
security invoker
set search_path=''
as $$
  select coalesce(string_agg(public.zt_ct_norm(t),' '),'')
    from (
      select s.value->>'title' as t
        from jsonb_array_elements(coalesce(p_sections,'[]'::jsonb)) s
      union all
      select v.value #>> '{}'
        from jsonb_array_elements(coalesce(p_sections,'[]'::jsonb)) s
        cross join lateral jsonb_array_elements(coalesce(s.value->'items','[]'::jsonb)) i
        cross join lateral jsonb_each(i.value) v(key,value)
       where jsonb_typeof(v.value)='string'
      union all
      select st.value #>> '{}'
        from jsonb_array_elements(coalesce(p_sections,'[]'::jsonb)) s
        cross join lateral jsonb_array_elements(coalesce(s.value->'items','[]'::jsonb)) i
        cross join lateral jsonb_array_elements(coalesce(i.value->'steps','[]'::jsonb)) st
    ) x
   where t is not null;
$$;
revoke all on function zt_private.zt_eq_guide_search_text(jsonb) from public,anon,authenticated;
grant execute on function zt_private.zt_eq_guide_search_text(jsonb) to service_role;

create or replace function public.zt_eq_guide_guard()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  perform zt_private.zt_eq_validate_guide_sections(new.sections);
  new.search_text := left(zt_private.zt_eq_guide_search_text(new.sections),20000);
  if tg_op='UPDATE' and new.sections is distinct from old.sections then
    new.version := old.version + 1;
  end if;
  return new;
end;
$$;
revoke all on function public.zt_eq_guide_guard() from public,anon,authenticated;
grant execute on function public.zt_eq_guide_guard() to service_role;
drop trigger if exists trg_equipment_quick_guides_guard on public.equipment_quick_guides;
create trigger trg_equipment_quick_guides_guard
before insert or update on public.equipment_quick_guides
for each row execute function public.zt_eq_guide_guard();

-- updated_at pela mesma convenção do restante do banco
do $$
declare t text;
begin
  foreach t in array array['equipment_models','equipment_documents','equipment_quick_guides'] loop
    execute format('drop trigger if exists zt_touch_%1$s on public.%1$s',t);
    execute format(
      'create trigger zt_touch_%1$s before update on public.%1$s for each row execute function public.zt_touch()',t);
  end loop;
end
$$;

-- assinatura ativa para escrever conteúdo da empresa (global não tem assinatura)
do $$
declare t text;
begin
  foreach t in array array[
    'equipment_categories','equipment_manufacturers','equipment_models',
    'equipment_documents','equipment_quick_guides','company_technical_areas'
  ] loop
    execute format('drop trigger if exists trg_subscription_write_guard on public.%I',t);
    execute format(
      'create trigger trg_subscription_write_guard before insert or update or delete on public.%I '
      'for each row execute function public.zt_guard_subscription_write_if_tenant()',t);
  end loop;
end
$$;

-- =====================================================================
-- RLS
-- =====================================================================
alter table public.equipment_categories enable row level security;
alter table public.equipment_manufacturers enable row level security;
alter table public.equipment_models enable row level security;
alter table public.equipment_documents enable row level security;
alter table public.equipment_quick_guides enable row level security;
alter table public.equipment_favorites enable row level security;
alter table public.equipment_recent_views enable row level security;
alter table public.company_technical_areas enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'equipment_categories','equipment_manufacturers','equipment_models',
    'equipment_documents','equipment_quick_guides'
  ] loop
    execute format('drop policy if exists %1$s_visible on public.%1$s',t);
    execute format(
      'create policy %1$s_visible on public.%1$s for select to authenticated '
      'using (public.zt_eq_can_read(company_id))',t);
    execute format('drop policy if exists %1$s_insert on public.%1$s',t);
    execute format(
      'create policy %1$s_insert on public.%1$s for insert to authenticated '
      'with check (public.zt_eq_can_write(company_id))',t);
    execute format('drop policy if exists %1$s_update on public.%1$s',t);
    execute format(
      'create policy %1$s_update on public.%1$s for update to authenticated '
      'using (public.zt_eq_can_write(company_id)) with check (public.zt_eq_can_write(company_id))',t);
    -- Conteúdo global não é apagado por cliente: arquiva-se por status.
    execute format('drop policy if exists %1$s_delete on public.%1$s',t);
    execute format(
      'create policy %1$s_delete on public.%1$s for delete to authenticated '
      'using (company_id is not null and public.zt_eq_can_write(company_id))',t);
  end loop;
end
$$;

-- Favoritos/recentes: sempre do próprio usuário, em empresa onde ele é membro ativo.
drop policy if exists equipment_favorites_own on public.equipment_favorites;
create policy equipment_favorites_own on public.equipment_favorites
for all to authenticated
using (user_id=(select auth.uid()) and public.zt_is_member(company_id))
with check (user_id=(select auth.uid()) and public.zt_is_member(company_id));

drop policy if exists equipment_recent_views_own on public.equipment_recent_views;
create policy equipment_recent_views_own on public.equipment_recent_views
for all to authenticated
using (user_id=(select auth.uid()) and public.zt_is_member(company_id))
with check (user_id=(select auth.uid()) and public.zt_is_member(company_id));

drop policy if exists company_technical_areas_visible on public.company_technical_areas;
create policy company_technical_areas_visible on public.company_technical_areas
for select to authenticated using (public.zt_is_member(company_id));
drop policy if exists company_technical_areas_write on public.company_technical_areas;
create policy company_technical_areas_write on public.company_technical_areas
for all to authenticated
using (public.zt_is_owner(company_id)) with check (public.zt_is_owner(company_id));

-- =====================================================================
-- Grants de menor privilégio (nada para anon)
-- =====================================================================
revoke all on table
  public.equipment_categories,public.equipment_manufacturers,public.equipment_models,
  public.equipment_documents,public.equipment_quick_guides,public.equipment_favorites,
  public.equipment_recent_views,public.company_technical_areas
  from public,anon,authenticated;

grant select,insert,update,delete on table
  public.equipment_categories,public.equipment_manufacturers,public.equipment_models,
  public.equipment_documents,public.equipment_quick_guides,public.equipment_favorites,
  public.equipment_recent_views,public.company_technical_areas
  to authenticated;

grant all on table
  public.equipment_categories,public.equipment_manufacturers,public.equipment_models,
  public.equipment_documents,public.equipment_quick_guides,public.equipment_favorites,
  public.equipment_recent_views,public.company_technical_areas
  to service_role;

-- =====================================================================
-- Storage: bucket privado de documento técnico da empresa
--   caminho: company_id/equipment/<model_id>/<arquivo>
--   leitura: membro ativo da empresa (técnico consulta manual em campo)
--   escrita/remoção: owner, com assinatura operacionalmente ativa
-- =====================================================================
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values(
  'zt-equipment-docs',
  'zt-equipment-docs',
  false,
  52428800,
  array['application/pdf','image/jpeg','image/png','image/webp']::text[]
)
on conflict(id) do update
  set public=false,
      file_size_limit=excluded.file_size_limit,
      allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists zt_equipment_docs_read on storage.objects;
create policy zt_equipment_docs_read on storage.objects
for select to authenticated
using (
  bucket_id='zt-equipment-docs'
  and public.zt_is_member(public.zt_path_company(name))
  and storage.objects.name like public.zt_path_company(storage.objects.name)::text||'/equipment/%'
);

drop policy if exists zt_equipment_docs_write on storage.objects;
create policy zt_equipment_docs_write on storage.objects
for insert to authenticated
with check (
  bucket_id='zt-equipment-docs'
  and public.zt_is_owner(public.zt_path_company(name))
  and public.zt_subscription_can_write(public.zt_path_company(name))
  and storage.objects.name like public.zt_path_company(storage.objects.name)::text||'/equipment/%'
);

drop policy if exists zt_equipment_docs_delete on storage.objects;
create policy zt_equipment_docs_delete on storage.objects
for delete to authenticated
using (
  bucket_id='zt-equipment-docs'
  and public.zt_is_owner(public.zt_path_company(name))
);

-- =====================================================================
-- Categorias globais iniciais: metadado neutro, sem instrução técnica.
-- =====================================================================
insert into public.equipment_categories(company_id,name,slug,icon) values
  (null,'Fechaduras','fechaduras','lock'),
  (null,'Controle de acesso','controle-de-acesso','key'),
  (null,'Portões','portoes','door'),
  (null,'CFTV','cftv','camera'),
  (null,'Alarmes','alarmes','bell'),
  (null,'Interfonia','interfonia','phone'),
  (null,'Elétrica','eletrica','zap'),
  (null,'Automação','automacao','cpu'),
  (null,'Ar-condicionado','ar-condicionado','wind'),
  (null,'Bombas','bombas','droplets'),
  (null,'Redes','redes','network')
on conflict do nothing;
