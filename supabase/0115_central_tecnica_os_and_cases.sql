-- ZiisTec · CENTRAL TÉCNICA V1 (0115) — vínculo com a OS e casos resolvidos.
--
-- Reconciliação com o que já existe (nada é duplicado):
--   * public.installed_equipment (0083) continua sendo a ÚNICA autoridade da
--     unidade física instalada no cliente (serial, local, foto, garantia, origem).
--     Aqui ela apenas ganha equipment_model_id: o ponteiro opcional para o MODELO
--     técnico da Central. Nenhuma coluna existente muda de significado e
--     zt_register_installed_equipment não é alterada.
--   * public.work_order_technical_base (0111) continua sendo a autoridade do
--     conhecimento do atendimento (causa, solução, dificuldade, aprendizado).
--     Os casos da Central LEEM dela por RPC; nada é copiado para tabela nova.
--   * needs_return/work_order_returns (0084) seguem sendo a fonte de "precisa
--     retornar"; aqui a flag só é lida.
--
-- Dois conceitos distintos, sem confusão:
--   MODELO  = equipment_models (conhecimento de mercado: "Intelbras FR 101").
--   UNIDADE = installed_equipment (a peça com serial instalada no cliente X).
--
-- work_order_equipment liga a OS ao conhecimento e cobre os dois cenários de campo:
--   A. manutenção: a unidade física já existe -> installed_equipment_id preenchido
--      (o modelo vem junto, e precisa ser coerente com o da unidade).
--   B. diagnóstico/instalação nova: ainda não há unidade registrada -> só o modelo.

-- ---------------------------------------- unidade física -> modelo técnico
alter table public.installed_equipment
  add column if not exists equipment_model_id uuid references public.equipment_models(id) on delete set null;

create index if not exists idx_installed_equipment_model
  on public.installed_equipment(company_id,equipment_model_id)
  where equipment_model_id is not null;

-- Modelo global ou da própria empresa; nunca de outra empresa.
create or replace function public.zt_eq_guard_installed_equipment_model()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_model_company uuid;
begin
  if new.equipment_model_id is null then
    return new;
  end if;
  select m.company_id into v_model_company
    from public.equipment_models m where m.id=new.equipment_model_id;
  if not found then
    raise exception 'Modelo técnico inexistente' using errcode='23503';
  end if;
  if v_model_company is not null and v_model_company <> new.company_id then
    raise exception 'Modelo técnico pertence a outra empresa' using errcode='42501';
  end if;
  return new;
end;
$$;
revoke all on function public.zt_eq_guard_installed_equipment_model() from public,anon,authenticated;
grant execute on function public.zt_eq_guard_installed_equipment_model() to service_role;
drop trigger if exists trg_installed_equipment_model_scope on public.installed_equipment;
create trigger trg_installed_equipment_model_scope
before insert or update of equipment_model_id,company_id on public.installed_equipment
for each row execute function public.zt_eq_guard_installed_equipment_model();

-- A unidade física é escrita só por RPC (0083 revogou write direto). Mantemos a
-- regra: identificar o modelo técnico de uma unidade também passa por RPC, com
-- a mesma autorização de quem pode mexer naquela OS.
create or replace function public.zt_set_installed_equipment_model(
  p_equipment uuid,
  p_model uuid
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_uid uuid := auth.uid();
  v_company uuid;
  v_work_order uuid;
  v_model_company uuid;
begin
  if v_uid is null then raise exception 'Não autenticado' using errcode='28000'; end if;
  select e.company_id,e.work_order_id into v_company,v_work_order
    from public.installed_equipment e where e.id=p_equipment;
  if not found then raise exception 'Equipamento instalado não encontrado' using errcode='P0002'; end if;
  if not (public.zt_is_owner(v_company) or public.zt_wo_is_mine(v_work_order)) then
    raise exception 'Sem permissão para este equipamento' using errcode='42501';
  end if;
  perform zt_private.assert_operational_write_allowed(v_company);

  if p_model is not null then
    select m.company_id into v_model_company
      from public.equipment_models m
     where m.id=p_model and m.status='active'
       and (m.company_id is null or m.company_id=v_company);
    if not found then raise exception 'Modelo técnico indisponível para esta empresa' using errcode='42501'; end if;
  end if;

  update public.installed_equipment
     set equipment_model_id=p_model
   where id=p_equipment;
  return p_equipment;
end;
$$;
revoke all on function public.zt_set_installed_equipment_model(uuid,uuid) from public,anon;
grant execute on function public.zt_set_installed_equipment_model(uuid,uuid) to authenticated,service_role;

-- ------------------------------------------------ vínculo equipamento <-> OS
create table if not exists public.work_order_equipment (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  work_order_id uuid not null,
  model_id uuid not null references public.equipment_models(id) on delete restrict,
  installed_equipment_id uuid,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint work_order_equipment_wo_company_fk
    foreign key (work_order_id,company_id) references public.work_orders(id,company_id) on delete cascade,
  -- FK simples de propósito: com FK composta, ON DELETE SET NULL anularia também
  -- company_id (NOT NULL) e travaria a remoção da unidade. O isolamento de tenant
  -- da unidade é garantido pelo trigger abaixo, que exige mesma empresa E mesmo
  -- cliente da OS — condição mais forte que a FK composta.
  constraint work_order_equipment_unit_fk
    foreign key (installed_equipment_id) references public.installed_equipment(id) on delete set null,
  constraint work_order_equipment_notes_len check (notes is null or char_length(notes) <= 500)
);
-- Sem unidade física: um vínculo por modelo. Com unidade: um vínculo por unidade.
create unique index if not exists uq_work_order_equipment_model
  on public.work_order_equipment(work_order_id,model_id) where installed_equipment_id is null;
create unique index if not exists uq_work_order_equipment_unit
  on public.work_order_equipment(work_order_id,installed_equipment_id) where installed_equipment_id is not null;
create index if not exists idx_work_order_equipment_wo
  on public.work_order_equipment(company_id,work_order_id);
create index if not exists idx_work_order_equipment_model
  on public.work_order_equipment(company_id,model_id);
create index if not exists idx_work_order_equipment_unit
  on public.work_order_equipment(company_id,installed_equipment_id) where installed_equipment_id is not null;
create index if not exists idx_work_order_equipment_created_by
  on public.work_order_equipment(created_by);

create or replace function public.zt_eq_guard_work_order_equipment()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_model_company uuid;
  v_wo_client uuid;
  v_unit_client uuid;
  v_unit_model uuid;
begin
  -- modelo: global ou da própria empresa
  select m.company_id into v_model_company
    from public.equipment_models m where m.id=new.model_id;
  if not found then raise exception 'Modelo técnico inexistente' using errcode='23503'; end if;
  if v_model_company is not null and v_model_company <> new.company_id then
    raise exception 'Modelo técnico pertence a outra empresa' using errcode='42501';
  end if;

  -- unidade física (quando informada): mesma empresa e MESMO CLIENTE da OS, e
  -- sem contradizer o modelo já identificado na unidade.
  if new.installed_equipment_id is not null then
    select w.client_id into v_wo_client
      from public.work_orders w
     where w.id=new.work_order_id and w.company_id=new.company_id;
    if not found then raise exception 'OS pertence a outra empresa' using errcode='42501'; end if;
    select e.client_id,e.equipment_model_id into v_unit_client,v_unit_model
      from public.installed_equipment e
     where e.id=new.installed_equipment_id and e.company_id=new.company_id;
    if not found then raise exception 'Equipamento instalado pertence a outra empresa' using errcode='42501'; end if;
    if v_unit_client <> v_wo_client then
      raise exception 'Equipamento instalado é de outro cliente' using errcode='42501';
    end if;
    if v_unit_model is not null and v_unit_model <> new.model_id then
      raise exception 'A unidade já está identificada com outro modelo técnico' using errcode='23514';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.zt_eq_guard_work_order_equipment() from public,anon,authenticated;
grant execute on function public.zt_eq_guard_work_order_equipment() to service_role;
drop trigger if exists trg_work_order_equipment_scope on public.work_order_equipment;
create trigger trg_work_order_equipment_scope
before insert or update on public.work_order_equipment
for each row execute function public.zt_eq_guard_work_order_equipment();

drop trigger if exists trg_subscription_write_guard on public.work_order_equipment;
create trigger trg_subscription_write_guard
before insert or update or delete on public.work_order_equipment
for each row execute function public.zt_guard_subscription_write();

alter table public.work_order_equipment enable row level security;

-- Mesmo recorte das demais tabelas de OS: owner vê tudo da empresa; técnico só
-- as OS atribuídas a ele, e só escreve enquanto a OS está aberta.
drop policy if exists work_order_equipment_visible on public.work_order_equipment;
create policy work_order_equipment_visible on public.work_order_equipment
for select to authenticated
using (public.zt_wo_is_owned(work_order_id) or public.zt_wo_is_mine(work_order_id));

drop policy if exists work_order_equipment_insert on public.work_order_equipment;
create policy work_order_equipment_insert on public.work_order_equipment
for insert to authenticated
with check (
  public.zt_wo_is_owned(work_order_id)
  or (
    public.zt_wo_is_mine(work_order_id)
    and public.zt_wo_open(work_order_id)
    and created_by=(select auth.uid())
  )
);

drop policy if exists work_order_equipment_delete on public.work_order_equipment;
create policy work_order_equipment_delete on public.work_order_equipment
for delete to authenticated
using (
  public.zt_wo_is_owned(work_order_id)
  or (
    public.zt_wo_is_mine(work_order_id)
    and public.zt_wo_open(work_order_id)
    and created_by=(select auth.uid())
  )
);
-- Sem UPDATE: troca de vínculo é remover e criar (observação é curta).

revoke all on table public.work_order_equipment from public,anon,authenticated;
grant select,insert,delete on table public.work_order_equipment to authenticated;
grant all on table public.work_order_equipment to service_role;

-- =====================================================================
-- Casos resolvidos: Base Técnica (0111) -> Central Técnica
-- =====================================================================
-- Por que RPC e não view: o técnico não enxerga a OS dos colegas por RLS, mas o
-- caso técnico é conhecimento DA EMPRESA. A mediação SECURITY DEFINER é o ponto
-- único de sanitização, com as colunas escolhidas uma a uma.
--
-- NUNCA sai daqui: nome/telefone/endereço/documento/e-mail do cliente, preço,
-- custo, margem ou qualquer dado financeiro. Essas colunas não entram no SELECT.
create or replace function public.zt_equipment_cases(
  p_company uuid,
  p_model uuid,
  p_limit integer default 10,
  p_offset integer default 0
)
returns table (
  case_id uuid,
  wo_number text,
  completed_on date,
  symptom text,
  cause text,
  solution text,
  difficulty text,
  learning text,
  needs_return boolean,
  linked_notes text,
  unit_identified boolean
)
language plpgsql
stable
security definer
set search_path=''
as $$
begin
  if p_company is null or p_model is null then
    raise exception 'Informe a empresa e o modelo' using errcode='22023';
  end if;
  if not public.zt_is_member(p_company) then
    raise exception 'Você não tem permissão para esta ação nesta empresa.' using errcode='42501';
  end if;

  return query
  with linked as (
    -- (a) modelo vinculado à OS
    select e.work_order_id,e.notes,(e.installed_equipment_id is not null) as unit
      from public.work_order_equipment e
     where e.company_id=p_company and e.model_id=p_model
    union all
    -- (b) unidade física vinculada à OS, já identificada com este modelo
    select e.work_order_id,e.notes,true
      from public.work_order_equipment e
      join public.installed_equipment u
        on u.id=e.installed_equipment_id and u.company_id=e.company_id
     where e.company_id=p_company and u.equipment_model_id=p_model
    union all
    -- (c) unidade física registrada naquela OS e identificada com este modelo
    select u.work_order_id,u.notes,true
      from public.installed_equipment u
     where u.company_id=p_company and u.equipment_model_id=p_model
  ),
  scoped as (
    select l.work_order_id,
           max(l.notes) as notes,
           bool_or(l.unit) as unit
      from linked l
     group by l.work_order_id
  )
  select w.id,
         w.number,
         (w.completed_at at time zone 'UTC')::date,
         left(coalesce(nullif(btrim(w.problem_report),''),nullif(btrim(w.request),''),''),2000),
         left(coalesce(b.cause,''),3000),
         left(coalesce(b.solution,''),3000),
         coalesce(b.difficulty,''),
         left(coalesce(b.learning,''),3000),
         coalesce(w.needs_return,false),
         left(coalesce(s.notes,''),500),
         s.unit
    from scoped s
    join public.work_orders w
      on w.id=s.work_order_id and w.company_id=p_company
    join public.work_order_technical_base b
      on b.work_order_id=w.id and b.company_id=p_company
   where w.status='done'
     and w.deleted_at is null
     and (b.cause is not null or b.solution is not null or b.learning is not null)
   order by w.completed_at desc nulls last,w.id
   limit least(greatest(coalesce(p_limit,10),1),30)
  offset greatest(coalesce(p_offset,0),0);
end;
$$;
revoke all on function public.zt_equipment_cases(uuid,uuid,integer,integer) from public,anon;
grant execute on function public.zt_equipment_cases(uuid,uuid,integer,integer) to authenticated,service_role;

-- Contagem leve para o badge da aba "Casos", com a mesma mediação.
create or replace function public.zt_equipment_cases_count(p_company uuid,p_model uuid)
returns integer
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_total integer;
begin
  if p_company is null or p_model is null then
    raise exception 'Informe a empresa e o modelo' using errcode='22023';
  end if;
  if not public.zt_is_member(p_company) then
    raise exception 'Você não tem permissão para esta ação nesta empresa.' using errcode='42501';
  end if;
  select count(*)::integer into v_total
    from (
      select w.id
        from public.work_orders w
        join public.work_order_technical_base b
          on b.work_order_id=w.id and b.company_id=p_company
       where w.company_id=p_company
         and w.status='done'
         and w.deleted_at is null
         and (b.cause is not null or b.solution is not null or b.learning is not null)
         and (
           exists (
             select 1 from public.work_order_equipment e
              where e.work_order_id=w.id and e.company_id=p_company and e.model_id=p_model
           )
           or exists (
             select 1
               from public.work_order_equipment e
               join public.installed_equipment u
                 on u.id=e.installed_equipment_id and u.company_id=e.company_id
              where e.work_order_id=w.id and e.company_id=p_company and u.equipment_model_id=p_model
           )
           or exists (
             select 1 from public.installed_equipment u
              where u.work_order_id=w.id and u.company_id=p_company and u.equipment_model_id=p_model
           )
         )
    ) x;
  return v_total;
end;
$$;
revoke all on function public.zt_equipment_cases_count(uuid,uuid) from public,anon;
grant execute on function public.zt_equipment_cases_count(uuid,uuid) to authenticated,service_role;
