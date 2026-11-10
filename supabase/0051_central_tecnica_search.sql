-- =====================================================================
-- ZiisTec · migration 0051 — Central Técnica (busca)
--
-- Busca única de campo: fabricante, modelo, categoria, tags, título de
-- documento e conteúdo da ficha rápida (códigos de erro, sintomas, reset).
-- Full Text Search com unaccent (acentos não atrapalham) + prefixo, e
-- comparação compacta de código de modelo ("FR101" encontra "FR 101").
-- Tudo passa por uma RPC que valida membresia; o resultado só contém
-- biblioteca global + conteúdo da própria empresa. Sem ILIKE '%x%' em
-- tabela grande: índices GIN cobrem as consultas.
-- =====================================================================

-- No Supabase as extensions moram no schema "extensions"; localmente podem
-- cair em public. O wrapper resolve pelos dois via search_path fixado.
do $$ begin
  if not exists (select 1 from pg_extension where extname = 'unaccent') then
    create extension unaccent;
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_trgm') then
    create extension pg_trgm;
  end if;
end $$;

-- wrapper imutável (dicionário unaccent é estável na prática; necessário
-- para usar em coluna gerada e índice)
create or replace function public.zt_ct_norm(t text)
returns text language sql immutable
set search_path = public, extensions
as $$
  select lower(unaccent('unaccent', coalesce(t, '')));
$$;
revoke all on function public.zt_ct_norm(text) from public, anon;
grant execute on function public.zt_ct_norm(text) to authenticated, service_role;

-- array_to_string é STABLE no catálogo; para text[] puro o resultado é
-- determinístico, então um wrapper imutável é seguro para coluna gerada.
create or replace function public.zt_ct_join_tags(t text[])
returns text language sql immutable as $$
  select coalesce(array_to_string(t, ' '), '');
$$;
revoke all on function public.zt_ct_join_tags(text[]) from public, anon;
grant execute on function public.zt_ct_join_tags(text[]) to authenticated, service_role;

-- código compacto: só letras/números, para casar "FR-101", "FR 101", "fr101"
create or replace function public.zt_ct_compact(t text)
returns text language sql immutable as $$
  select regexp_replace(public.zt_ct_norm(t), '[^a-z0-9]', '', 'g');
$$;
revoke all on function public.zt_ct_compact(text) from public, anon;
grant execute on function public.zt_ct_compact(text) to authenticated, service_role;

-- ------------------------------------------------- colunas de busca
alter table public.equipment_models
  add column if not exists search_tsv tsvector
  generated always as (
    to_tsvector('simple',
      public.zt_ct_norm(name) || ' ' ||
      public.zt_ct_norm(coalesce(model_code,'')) || ' ' ||
      public.zt_ct_norm(coalesce(description,'')) || ' ' ||
      public.zt_ct_norm(public.zt_ct_join_tags(tags)))
  ) stored;

alter table public.equipment_models
  add column if not exists compact_code text
  generated always as (public.zt_ct_compact(name || ' ' || coalesce(model_code,''))) stored;

create index if not exists idx_eq_models_tsv on public.equipment_models using gin (search_tsv);
-- trigram: sustenta o LIKE '%fr101%' do código compacto sem varrer a tabela
-- (resolve o schema real do opclass: "extensions" no Supabase, "public" local)
do $$
declare v_schema text;
begin
  select n.nspname into v_schema
    from pg_opclass oc join pg_namespace n on n.oid = oc.opcnamespace
   where oc.opcname = 'gin_trgm_ops' limit 1;
  execute format(
    'create index if not exists idx_eq_models_compact_trgm
       on public.equipment_models using gin (compact_code %I.gin_trgm_ops)', v_schema);
end $$;

alter table public.equipment_documents
  add column if not exists search_tsv tsvector
  generated always as (to_tsvector('simple', public.zt_ct_norm(title))) stored;
create index if not exists idx_eq_docs_tsv on public.equipment_documents using gin (search_tsv);

alter table public.equipment_quick_guides
  add column if not exists search_tsv tsvector
  generated always as (to_tsvector('simple', public.zt_ct_norm(left(search_text, 20000)))) stored;
create index if not exists idx_eq_guides_tsv on public.equipment_quick_guides using gin (search_tsv);

-- fabricantes entram na busca pelo nome
create index if not exists idx_eq_manufacturers_norm
  on public.equipment_manufacturers (public.zt_ct_norm(name));

-- ------------------------------------------------- tsquery defensiva
-- monta prefix-query a partir do texto do usuário; nunca interpola cru.
create or replace function public.zt_ct_build_tsquery(p_query text)
returns tsquery language plpgsql immutable as $$
declare
  v_words text[];
  v_q text;
begin
  v_words := regexp_split_to_array(public.zt_ct_norm(coalesce(p_query,'')), '[^a-z0-9]+');
  v_words := array(select w from unnest(v_words) w where length(w) between 1 and 60 limit 8);
  if array_length(v_words,1) is null then return null; end if;
  v_q := array_to_string(array(select w || ':*' from unnest(v_words) w), ' & ');
  return to_tsquery('simple', v_q);
end $$;
revoke all on function public.zt_ct_build_tsquery(text) from public, anon;
grant execute on function public.zt_ct_build_tsquery(text) to authenticated, service_role;

-- ------------------------------------------------------------ RPC busca
-- SECURITY DEFINER com checagem explícita de membresia. Devolve apenas
-- modelos visíveis (globais + da empresa) e diz ONDE casou (modelo,
-- fabricante, documento, ficha). Paginada. Nunca devolve dado financeiro.
create or replace function public.zt_equipment_search(
  p_company  uuid,
  p_query    text,
  p_category uuid default null,
  p_limit    int default 20,
  p_offset   int default 0
)
returns table (
  model_id          uuid,
  name              text,
  model_code        text,
  description       text,
  manufacturer_id   uuid,
  manufacturer_name text,
  category_id       uuid,
  category_name     text,
  scope             text,
  matched_in        text[],
  rank              real
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tsq tsquery;
  v_compact text;
  v_limit int;
begin
  if not public.zt_is_member(p_company) then
    raise exception 'Você não tem permissão para esta ação nesta empresa.' using errcode='42501';
  end if;

  v_tsq := public.zt_ct_build_tsquery(p_query);
  v_compact := public.zt_ct_compact(coalesce(p_query,''));
  v_limit := least(greatest(coalesce(p_limit,20),1),50);

  if v_tsq is null and (v_compact is null or v_compact = '') then
    return;
  end if;

  return query
  with visible_models as (
    select m.*
      from public.equipment_models m
     where m.status = 'active'
       and (m.company_id is null or m.company_id = p_company)
       and (p_category is null or m.category_id = p_category)
  ),
  hits as (
    select m.id, 'model'::text as src, ts_rank(m.search_tsv, v_tsq) + 0.5 as r
      from visible_models m
     where v_tsq is not null and m.search_tsv @@ v_tsq
    union all
    select m.id, 'model', 1.0
      from visible_models m
     where v_compact <> '' and length(v_compact) >= 3
       and m.compact_code like '%' || v_compact || '%'
    union all
    select m.id, 'manufacturer', 0.4
      from visible_models m
      join public.equipment_manufacturers f on f.id = m.manufacturer_id
     where v_tsq is not null
       and to_tsvector('simple', public.zt_ct_norm(f.name)) @@ v_tsq
    union all
    select g.model_id, 'guide', coalesce(ts_rank(g.search_tsv, v_tsq),0) + 0.2
      from public.equipment_quick_guides g
      join visible_models m on m.id = g.model_id
     where v_tsq is not null and g.status = 'active'
       and (g.company_id is null or g.company_id = p_company)
       and g.search_tsv @@ v_tsq
    union all
    select d.model_id, 'document', coalesce(ts_rank(d.search_tsv, v_tsq),0) + 0.1
      from public.equipment_documents d
      join visible_models m on m.id = d.model_id
     where v_tsq is not null and d.status = 'active'
       and (d.company_id is null or d.company_id = p_company)
       and d.search_tsv @@ v_tsq
  ),
  ranked as (
    select h.id as mid, array_agg(distinct h.src) as srcs, max(h.r) as best
      from hits h group by h.id
  )
  select m.id, m.name, m.model_code, m.description,
         f.id, f.name,
         c.id, c.name,
         case when m.company_id is null then 'global' else 'company' end,
         r.srcs, r.best::real
    from ranked r
    join public.equipment_models m on m.id = r.mid
    join public.equipment_manufacturers f on f.id = m.manufacturer_id
    join public.equipment_categories c on c.id = m.category_id
   order by r.best desc, m.name asc
   limit v_limit offset greatest(coalesce(p_offset,0),0);
end $$;

revoke all on function public.zt_equipment_search(uuid, text, uuid, int, int) from public, anon;
grant execute on function public.zt_equipment_search(uuid, text, uuid, int, int) to authenticated, service_role;
