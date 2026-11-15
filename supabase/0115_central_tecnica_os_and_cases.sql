-- ZiisTec · CENTRAL TÉCNICA V1 (0115) — vínculo com a OS e casos resolvidos.
--
-- Reconciliação com o que já existe (nada é duplicado):
--   * public.installed_equipment (0083) continua sendo a ÚNICA autoridade da
--     unidade física instalada no cliente (serial, local, foto, garantia, origem).
--     Aqui ela apenas ganha equipment_model_id: o ponteiro opcional para o MODELO
--     técnico da Central. Nenhuma coluna existente muda de significado e
--     zt_register_installed_equipment não é alterada.
--   * public.work_order_technical_base (0111) continua sendo a autoridade do
--     conhecimento do atendimento (causa, solução, dificuldade, aprendizado):
--     o registro INTERNO e ORIGINAL da OS, escrito pelo técnico em campo.
--     Ela NÃO vira caso sozinha. O caso da Central é uma PUBLICAÇÃO curada pelo
--     owner (colunas case_* na mesma linha, sem tabela nova): texto técnico
--     revisado, entregue explicitamente na RPC de publicação. A RPC de consulta
--     lê só as colunas case_*; o texto bruto da OS nunca entra na resposta.
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
  -- FK simples e CASCADE de propósito. Com FK composta, ON DELETE SET NULL
  -- anularia também company_id (NOT NULL) e travaria a remoção da unidade; e
  -- anular apenas a unidade transformaria o vínculo em "só modelo", podendo
  -- colidir com um vínculo de modelo já existente na mesma OS. Removida a
  -- unidade física, o vínculo àquela unidade perde sentido e sai junto — o
  -- vínculo de conhecimento (modelo) é outra linha e sobrevive.
  -- O isolamento de tenant da unidade é garantido pelo trigger abaixo, que exige
  -- mesma empresa E mesmo cliente da OS: condição mais forte que a FK composta.
  constraint work_order_equipment_unit_fk
    foreign key (installed_equipment_id) references public.installed_equipment(id) on delete cascade,
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
-- Casos técnicos: publicação CURADA, separada da Base Técnica da OS
-- =====================================================================
-- Dois registros diferentes na mesma linha de work_order_technical_base:
--
--   BASE TÉCNICA DA OS (0111)      cause, solution, difficulty, learning
--     registro interno original; o técnico escreve em campo, com pressa, e pode
--     citar nome, telefone, endereço ou valor. Visível só ao owner e ao técnico
--     atribuído àquela OS (RLS da 0111). zt_save_work_order_technical_base não muda.
--
--   CASO PUBLICADO NA CENTRAL      case_symptom, case_cause, case_solution,
--                                  case_learning (+ case_public_id, metadados)
--     conhecimento compartilhado com TODA a equipe da empresa. Só existe quando o
--     owner publica, entregando o texto técnico revisado.
--
-- A garantia é ESTRUTURAL, não de filtro: nenhum caminho copia cause/solution/
-- learning, problem_report, request ou notas para as colunas case_*; e a consulta
-- (zt_equipment_cases) só seleciona colunas case_*. Truncar não é sanitizar e
-- nenhuma regex "detecta PII" em texto livre — por isso o texto bruto simplesmente
-- não participa da resposta. O que o owner escreve no caso é decisão dele.
--
-- Escrita só por RPC: a 0111 deu ao navegador apenas SELECT nesta tabela.
alter table public.work_order_technical_base
  add column if not exists case_public_id uuid,
  add column if not exists case_symptom text,
  add column if not exists case_cause text,
  add column if not exists case_solution text,
  add column if not exists case_learning text,
  add column if not exists case_published_at timestamptz,
  add column if not exists case_published_by uuid references public.profiles(id) on delete set null,
  add column if not exists case_updated_at timestamptz,
  add column if not exists case_updated_by uuid references public.profiles(id) on delete set null,
  add column if not exists case_revision integer not null default 0,
  add column if not exists case_last_request_id uuid;

alter table public.work_order_technical_base
  drop constraint if exists wo_technical_base_case_symptom_len,
  drop constraint if exists wo_technical_base_case_cause_len,
  drop constraint if exists wo_technical_base_case_solution_len,
  drop constraint if exists wo_technical_base_case_learning_len,
  drop constraint if exists wo_technical_base_case_revision_ck,
  drop constraint if exists wo_technical_base_case_shape;
alter table public.work_order_technical_base
  add constraint wo_technical_base_case_symptom_len
    check (case_symptom is null or char_length(case_symptom) between 1 and 500),
  add constraint wo_technical_base_case_cause_len
    check (case_cause is null or char_length(case_cause) between 1 and 3000),
  add constraint wo_technical_base_case_solution_len
    check (case_solution is null or char_length(case_solution) between 1 and 3000),
  add constraint wo_technical_base_case_learning_len
    check (case_learning is null or char_length(case_learning) between 1 and 3000),
  add constraint wo_technical_base_case_revision_ck check (case_revision >= 0),
  -- Publicado: tem identificador próprio, autor/data e algum conteúdo curado.
  -- Não publicado: nenhum texto de caso permanece na linha.
  add constraint wo_technical_base_case_shape check (
    (case_published_at is not null
      and case_public_id is not null
      and (case_cause is not null or case_solution is not null or case_learning is not null))
    or
    (case_published_at is null
      and case_symptom is null and case_cause is null
      and case_solution is null and case_learning is null)
  );

-- Identificador técnico do caso: é o que a Central devolve. Não é o id nem o
-- número da OS, então o técnico não atribuído não recebe referência à OS.
create unique index if not exists uq_wo_technical_base_case_public_id
  on public.work_order_technical_base(case_public_id) where case_public_id is not null;
create index if not exists idx_wo_technical_base_case_published
  on public.work_order_technical_base(company_id,case_published_at desc)
  where case_published_at is not null;
create index if not exists idx_wo_technical_base_case_published_by
  on public.work_order_technical_base(case_published_by) where case_published_by is not null;
create index if not exists idx_wo_technical_base_case_updated_by
  on public.work_order_technical_base(case_updated_by) where case_updated_by is not null;

-- Estado da publicação devolvido ao owner. Só colunas case_*.
create or replace function zt_private.zt_ct_case_payload(p_row public.work_order_technical_base)
returns jsonb
language sql
immutable
security invoker
set search_path=''
as $$
  select jsonb_build_object(
    'published',p_row.case_published_at is not null,
    'case_id',p_row.case_public_id,
    'published_at',p_row.case_published_at,
    'updated_at',p_row.case_updated_at,
    'revision',p_row.case_revision,
    'symptom',p_row.case_symptom,
    'cause',p_row.case_cause,
    'solution',p_row.case_solution,
    'learning',p_row.case_learning);
$$;
revoke all on function zt_private.zt_ct_case_payload(public.work_order_technical_base) from public,anon,authenticated;
grant execute on function zt_private.zt_ct_case_payload(public.work_order_technical_base) to service_role;

-- Publica (ou revisa) o caso técnico de uma OS concluída.
--   * empresa vem da OS, nunca do cliente; ownership conferido pela sessão;
--   * assinatura operacional ativa;
--   * os textos são os PARÂMETROS revisados — a função não lê cause/solution/
--     learning nem campo algum de cliente ou financeiro;
--   * idempotente por p_request: o mesmo pedido devolve o mesmo estado; o mesmo
--     pedido com outro conteúdo é recusado;
--   * auditável: quem publicou, quando, quem revisou por último e a revisão.
create or replace function public.zt_publish_work_order_technical_case(
  p_wo uuid,
  p_symptom text,
  p_cause text,
  p_solution text,
  p_learning text,
  p_request uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_uid uuid := auth.uid();
  v_company uuid;
  v_status text;
  v_row public.work_order_technical_base%rowtype;
  v_symptom text := nullif(btrim(coalesce(p_symptom,'')),'');
  v_cause text := nullif(btrim(coalesce(p_cause,'')),'');
  v_solution text := nullif(btrim(coalesce(p_solution,'')),'');
  v_learning text := nullif(btrim(coalesce(p_learning,'')),'');
  v_same boolean;
begin
  if v_uid is null then raise exception 'Não autenticado' using errcode='28000'; end if;
  if p_request is null then
    raise exception 'Identificador da operação obrigatório' using errcode='22023';
  end if;
  if p_wo is null or not public.zt_wo_is_owned(p_wo) then
    raise exception 'Somente o proprietário publica o caso técnico desta OS' using errcode='42501';
  end if;
  if v_cause is null and v_solution is null and v_learning is null then
    raise exception 'Informe a causa, a solução ou o aprendizado do caso técnico' using errcode='22023';
  end if;
  if char_length(v_symptom) > 500 then
    raise exception 'O sintoma do caso aceita no máximo 500 caracteres' using errcode='22023';
  end if;
  if char_length(v_cause) > 3000 or char_length(v_solution) > 3000 or char_length(v_learning) > 3000 then
    raise exception 'Cada campo do caso técnico aceita no máximo 3.000 caracteres' using errcode='22023';
  end if;

  select w.company_id,w.status::text into v_company,v_status
    from public.work_orders w
   where w.id=p_wo and w.deleted_at is null;
  if not found then raise exception 'OS não encontrada' using errcode='P0002'; end if;
  if not public.zt_is_owner(v_company) then
    raise exception 'Somente o proprietário publica o caso técnico desta OS' using errcode='42501';
  end if;
  if v_status <> 'done' then
    raise exception 'O caso técnico só pode ser publicado depois que a OS for concluída' using errcode='22023';
  end if;
  perform zt_private.assert_operational_write_allowed(v_company);

  select b.* into v_row
    from public.work_order_technical_base b
   where b.work_order_id=p_wo and b.company_id=v_company
     for update;
  if not found then
    raise exception 'Registre a Base Técnica desta OS antes de publicar o caso' using errcode='P0002';
  end if;

  v_same := v_row.case_published_at is not null
    and v_row.case_symptom is not distinct from v_symptom
    and v_row.case_cause is not distinct from v_cause
    and v_row.case_solution is not distinct from v_solution
    and v_row.case_learning is not distinct from v_learning;

  if v_row.case_last_request_id = p_request then
    if not v_same then
      raise exception 'Identificador já usado em outra versão do caso técnico' using errcode='23505';
    end if;
    return zt_private.zt_ct_case_payload(v_row);
  end if;
  if v_same then
    return zt_private.zt_ct_case_payload(v_row);
  end if;

  update public.work_order_technical_base b
     set case_public_id=coalesce(b.case_public_id,gen_random_uuid()),
         case_symptom=v_symptom,
         case_cause=v_cause,
         case_solution=v_solution,
         case_learning=v_learning,
         case_published_at=coalesce(b.case_published_at,now()),
         case_published_by=case when b.case_published_at is null then v_uid else b.case_published_by end,
         case_updated_at=now(),
         case_updated_by=v_uid,
         case_revision=b.case_revision+1,
         case_last_request_id=p_request
   where b.id=v_row.id
  returning b.* into v_row;
  return zt_private.zt_ct_case_payload(v_row);
end;
$$;
revoke all on function public.zt_publish_work_order_technical_case(uuid,text,text,text,text,uuid) from public,anon;
grant execute on function public.zt_publish_work_order_technical_case(uuid,text,text,text,text,uuid) to authenticated,service_role;

-- Retira o caso da Central. Idempotente: retirar o que não está publicado devolve
-- o mesmo estado. A Base Técnica original da OS não é tocada.
create or replace function public.zt_unpublish_work_order_technical_case(p_wo uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_uid uuid := auth.uid();
  v_company uuid;
  v_row public.work_order_technical_base%rowtype;
begin
  if v_uid is null then raise exception 'Não autenticado' using errcode='28000'; end if;
  if p_wo is null or not public.zt_wo_is_owned(p_wo) then
    raise exception 'Somente o proprietário retira o caso técnico desta OS' using errcode='42501';
  end if;
  select w.company_id into v_company from public.work_orders w where w.id=p_wo;
  if not found then raise exception 'OS não encontrada' using errcode='P0002'; end if;
  if not public.zt_is_owner(v_company) then
    raise exception 'Somente o proprietário retira o caso técnico desta OS' using errcode='42501';
  end if;
  perform zt_private.assert_operational_write_allowed(v_company);

  select b.* into v_row
    from public.work_order_technical_base b
   where b.work_order_id=p_wo and b.company_id=v_company
     for update;
  if not found then
    return jsonb_build_object('published',false);
  end if;
  if v_row.case_published_at is null then
    return zt_private.zt_ct_case_payload(v_row);
  end if;

  update public.work_order_technical_base b
     set case_symptom=null,
         case_cause=null,
         case_solution=null,
         case_learning=null,
         case_published_at=null,
         case_published_by=null,
         case_updated_at=now(),
         case_updated_by=v_uid,
         case_revision=b.case_revision+1,
         case_last_request_id=null
   where b.id=v_row.id
  returning b.* into v_row;
  return zt_private.zt_ct_case_payload(v_row);
end;
$$;
revoke all on function public.zt_unpublish_work_order_technical_case(uuid) from public,anon;
grant execute on function public.zt_unpublish_work_order_technical_case(uuid) to authenticated,service_role;

-- =====================================================================
-- Consulta dos casos publicados
-- =====================================================================
-- Por que RPC e não view: o técnico não enxerga a OS dos colegas por RLS, mas o
-- caso PUBLICADO é conhecimento da empresa. A mediação SECURITY DEFINER devolve
-- só o que foi deliberadamente publicado.
--
-- Contrato de saída (nada além disto):
--   case_id          identificador técnico do caso (não é id nem número da OS)
--   published_on     data da publicação
--   completed_on     data de conclusão do atendimento
--   symptom/cause/solution/learning   texto CURADO (colunas case_*)
--   difficulty       easy|medium|hard (valor fechado, não é texto livre)
--   unit_identified  havia unidade física identificada com o modelo
--
-- De work_orders só participam id, company_id, status, deleted_at e completed_at.
-- A função não seleciona texto livre da OS, nota de vínculo, dado de cliente,
-- confirmação de atendimento nem coluna financeira; o teste adversarial confere
-- isso no corpo da função e no resultado.
create or replace function public.zt_equipment_cases(
  p_company uuid,
  p_model uuid,
  p_limit integer default 10,
  p_offset integer default 0
)
returns table (
  case_id uuid,
  published_on date,
  completed_on date,
  symptom text,
  cause text,
  solution text,
  learning text,
  difficulty text,
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
    select e.work_order_id,(e.installed_equipment_id is not null) as unit
      from public.work_order_equipment e
     where e.company_id=p_company and e.model_id=p_model
    union all
    select e.work_order_id,true
      from public.work_order_equipment e
      join public.installed_equipment u
        on u.id=e.installed_equipment_id and u.company_id=e.company_id
     where e.company_id=p_company and u.equipment_model_id=p_model
    union all
    select u.work_order_id,true
      from public.installed_equipment u
     where u.company_id=p_company and u.equipment_model_id=p_model
  ),
  scoped as (
    select l.work_order_id,bool_or(l.unit) as unit
      from linked l
     group by l.work_order_id
  )
  select b.case_public_id,
         (b.case_published_at at time zone 'UTC')::date,
         (w.completed_at at time zone 'UTC')::date,
         coalesce(b.case_symptom,''),
         coalesce(b.case_cause,''),
         coalesce(b.case_solution,''),
         coalesce(b.case_learning,''),
         coalesce(b.difficulty,''),
         s.unit
    from scoped s
    join public.work_orders w
      on w.id=s.work_order_id and w.company_id=p_company
    join public.work_order_technical_base b
      on b.work_order_id=w.id and b.company_id=p_company
   where b.case_published_at is not null
     and w.status='done'
     and w.deleted_at is null
   order by b.case_published_at desc,b.case_public_id
   limit least(greatest(coalesce(p_limit,10),1),30)
  offset greatest(coalesce(p_offset,0),0);
end;
$$;
revoke all on function public.zt_equipment_cases(uuid,uuid,integer,integer) from public,anon;
grant execute on function public.zt_equipment_cases(uuid,uuid,integer,integer) to authenticated,service_role;

-- Contagem leve para o badge da aba "Casos": só casos PUBLICADOS, mesma mediação.
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
         and b.case_published_at is not null
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
