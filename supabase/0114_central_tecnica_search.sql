-- ZiisTec · CENTRAL TÉCNICA V1 (0114) — busca única de campo.
--
-- Convenção reaproveitada: a 0087 já estabeleceu que busca neste produto é
-- pg_trgm + lower() sobre colunas tenant-scoped, sem extensão nova e sem serviço
-- externo. Esta migration segue a mesma linha: as colunas search_text/compact_code
-- da 0113 são normalizadas (acento e caixa dobrados) e têm índice GIN trigrama.
-- Nenhuma extensão é instalada aqui.
--
-- O técnico digita uma coisa só: "FR 101", "erro E4", "reset", "motor não fecha".
-- A RPC confere membresia, devolve apenas biblioteca global + conteúdo da própria
-- empresa, pagina e diz onde casou. Nada financeiro trafega por aqui.

-- Divide o texto do usuário em termos seguros (sem interpolar texto cru em SQL).
create or replace function zt_private.zt_ct_terms(p_query text)
returns text[]
language sql
immutable
security invoker
set search_path=''
as $$
  select coalesce(
    (select array_agg(t order by char_length(t) desc)
       from (
         select distinct t
           from unnest(regexp_split_to_array(public.zt_ct_norm(p_query),'[^a-z0-9]+')) t
          where char_length(t) between 1 and 60
          limit 8
       ) x),
    '{}'::text[]);
$$;
revoke all on function zt_private.zt_ct_terms(text) from public,anon,authenticated;
grant execute on function zt_private.zt_ct_terms(text) to service_role;

-- Busca da Central Técnica. SECURITY DEFINER com checagem explícita de membresia:
-- o resultado nunca inclui conteúdo privado de outra empresa.
create or replace function public.zt_equipment_search(
  p_company uuid,
  p_query text,
  p_category uuid default null,
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  model_id uuid,
  name text,
  model_code text,
  description text,
  manufacturer_id uuid,
  manufacturer_name text,
  category_id uuid,
  category_name text,
  scope text,
  matched_in text[],
  rank real
)
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_terms text[];
  v_main text;
  v_rest text[];
  v_compact text;
  v_limit integer;
  v_offset integer;
begin
  if p_company is null then
    raise exception 'Informe a empresa' using errcode='22023';
  end if;
  if not public.zt_is_member(p_company) then
    raise exception 'Você não tem permissão para esta ação nesta empresa.' using errcode='42501';
  end if;

  v_terms := zt_private.zt_ct_terms(p_query);
  v_compact := public.zt_ct_compact(coalesce(p_query,''));
  v_limit := least(greatest(coalesce(p_limit,20),1),50);
  v_offset := greatest(coalesce(p_offset,0),0);

  if coalesce(array_length(v_terms,1),0)=0 and char_length(coalesce(v_compact,''))=0 then
    return;
  end if;

  -- O termo mais longo entra como predicado indexável (GIN trigrama) e os demais
  -- filtram o conjunto já reduzido: evita varredura sem perder o "E" entre termos.
  v_main := case when coalesce(array_length(v_terms,1),0) > 0 then v_terms[1] else null end;
  v_rest := case
    when coalesce(array_length(v_terms,1),0) > 1 then v_terms[2:array_length(v_terms,1)]
    else '{}'::text[]
  end;

  return query
  with visible_models as (
    select m.id,m.company_id,m.name,m.model_code,m.description,
           m.manufacturer_id,m.category_id,m.search_text,m.compact_code
      from public.equipment_models m
     where m.status='active'
       and (m.company_id is null or m.company_id=p_company)
       and (p_category is null or m.category_id=p_category)
  ),
  hits as (
    -- nome, código, descrição e tags do modelo
    select m.id as model_id,'model'::text as source,1.0::real as weight
      from visible_models m
     where v_main is not null
       and m.search_text like '%'||v_main||'%'
       and (coalesce(array_length(v_rest,1),0)=0
            or (select bool_and(m.search_text like '%'||t||'%') from unnest(v_rest) t))
    union all
    -- código compacto: "FR101" encontra "FR 101"
    select m.id,'model',1.2::real
      from visible_models m
     where char_length(coalesce(v_compact,'')) >= 3
       and m.compact_code like '%'||v_compact||'%'
    union all
    -- fabricante
    select m.id,'manufacturer',0.4::real
      from visible_models m
      join public.equipment_manufacturers f on f.id=m.manufacturer_id
     where v_main is not null
       and public.zt_ct_norm(f.name) like '%'||v_main||'%'
       and (coalesce(array_length(v_rest,1),0)=0
            or (select bool_and(public.zt_ct_norm(f.name) like '%'||t||'%') from unnest(v_rest) t))
    union all
    -- conteúdo da ficha rápida: código de erro, sintoma, passo de reset
    select g.model_id,'guide',0.8::real
      from public.equipment_quick_guides g
      join visible_models m on m.id=g.model_id
     where v_main is not null
       and g.status='active'
       and (g.company_id is null or g.company_id=p_company)
       and g.search_text like '%'||v_main||'%'
       and (coalesce(array_length(v_rest,1),0)=0
            or (select bool_and(g.search_text like '%'||t||'%') from unnest(v_rest) t))
    union all
    -- título de documento
    select d.model_id,'document',0.3::real
      from public.equipment_documents d
      join visible_models m on m.id=d.model_id
     where v_main is not null
       and d.status='active'
       and (d.company_id is null or d.company_id=p_company)
       and d.search_text like '%'||v_main||'%'
       and (coalesce(array_length(v_rest,1),0)=0
            or (select bool_and(d.search_text like '%'||t||'%') from unnest(v_rest) t))
  ),
  ranked as (
    select h.model_id as mid,
           array_agg(distinct h.source order by h.source) as sources,
           max(h.weight) as best
      from hits h
     group by h.model_id
  )
  select m.id,m.name,m.model_code,m.description,
         f.id,f.name,
         c.id,c.name,
         case when m.company_id is null then 'global' else 'company' end,
         r.sources,
         r.best::real
    from ranked r
    join public.equipment_models m on m.id=r.mid
    join public.equipment_manufacturers f on f.id=m.manufacturer_id
    join public.equipment_categories c on c.id=m.category_id
   order by r.best desc,m.name asc
   limit v_limit offset v_offset;
end;
$$;
revoke all on function public.zt_equipment_search(uuid,text,uuid,integer,integer) from public,anon;
grant execute on function public.zt_equipment_search(uuid,text,uuid,integer,integer) to authenticated,service_role;
