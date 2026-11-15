-- ZiisTec · OPERATIONS DISPATCH V1 (0116) — despacho de OS entre técnicos.
--
-- Auditoria antes de criar (o que já existe e NÃO é duplicado aqui):
--   * public.work_orders continua sendo a ÚNICA autoridade da OS. Nenhuma tabela
--     paralela de "escalação" é criada; a distribuição é o próprio assigned_to.
--   * public.company_members (papel owner/technician + status) continua sendo a
--     autoridade de quem pode executar. A Central de Operações lê dela.
--   * scheduled_date/scheduled_time (0001) continuam sendo o agendamento; não há
--     coluna nova de data. completed_at/started_at (0101) seguem só de leitura.
--   * public.platform_audit_logs (0010) é auditoria de PLATAFORMA (só platform
--     admin lê) — não serve para a empresa auditar o próprio despacho. Daí a
--     tabela de eventos abaixo, isolada por company_id.
--   * Idempotência segue a convenção de field_sales/0109: client_request_id
--     único por empresa, com o mesmo pedido devolvendo o mesmo resultado.
--
-- O que é novo e por quê:
--   1. priority: NÃO existia em work_orders (só work_order_returns tinha, e é
--      outro conceito: prioridade do retorno). O quadro de operações precisa
--      ordenar o que é urgente. Três níveis, sem SLA.
--   2. work_order_dispatch_events: quem atribuiu, de quem saiu, para quem foi,
--      quando e por qual origem (web/mobile/assistant/whatsapp).
--   3. RPCs oficiais de despacho: hoje a atribuição é UPDATE direto na tabela,
--      sem auditoria, sem idempotência e sem validar técnico ativo. Passa a ter
--      um único caminho, usado igualmente pela tela e pelo futuro agente.
--
-- O técnico continua sem poder distribuir: o guard de 0012/0031 já recusa mudar
-- assigned_to, e esta migration estende o mesmo guard para priority.
-- Idempotente. Sem DROP TABLE, TRUNCATE ou DELETE de dados.

-- ------------------------------------------------------------- 1. prioridade
alter table public.work_orders
  add column if not exists priority text not null default 'normal';

do $$ begin
  alter table public.work_orders drop constraint if exists work_orders_priority_ck;
  alter table public.work_orders add constraint work_orders_priority_ck
    check (priority in ('normal','high','urgent'));
end $$;

-- Índices do quadro: a leitura é sempre por empresa + janela de data.
create index if not exists idx_work_orders_dispatch_window
  on public.work_orders(company_id, scheduled_date, scheduled_time)
  where deleted_at is null;
create index if not exists idx_work_orders_dispatch_unassigned
  on public.work_orders(company_id, scheduled_date)
  where deleted_at is null and assigned_to is null;
create index if not exists idx_work_orders_dispatch_assignee
  on public.work_orders(company_id, assigned_to, scheduled_date)
  where deleted_at is null;

-- O técnico não altera prioridade (mesma lista administrativa do guard atual).
create or replace function public.zt_guard_work_order_technician_update()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  -- Chamadas internas via funções SECURITY DEFINER confiáveis executam com papel
  -- privilegiado e já fazem suas próprias validações de auth.uid()/membership.
  if current_user not in ('authenticated','anon') then
    return new;
  end if;

  if auth.uid() is null then
    return new;
  end if;

  if public.zt_is_owner(old.company_id) then
    return new;
  end if;

  if not public.zt_wo_is_mine(old.id) then
    raise exception 'Sem permissão para alterar esta ordem de serviço' using errcode='42501';
  end if;

  if new.id is distinct from old.id
     or new.company_id is distinct from old.company_id
     or new.number is distinct from old.number
     or new.client_id is distinct from old.client_id
     or new.quote_id is distinct from old.quote_id
     or new.assigned_to is distinct from old.assigned_to
     or new.extra_cost is distinct from old.extra_cost
     or new.pending_pricing is distinct from old.pending_pricing
     or new.warranty_id is distinct from old.warranty_id
     or new.origin_wo_id is distinct from old.origin_wo_id
     or new.is_warranty_visit is distinct from old.is_warranty_visit
     or new.billing_entry_id is distinct from old.billing_entry_id
     or new.maintenance_contract_id is distinct from old.maintenance_contract_id
     or new.contract_cycle is distinct from old.contract_cycle
     or new.priority is distinct from old.priority
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'Técnicos não podem alterar campos administrativos ou financeiros da OS' using errcode='42501';
  end if;

  return new;
end;
$$;

-- ------------------------------------------------- 2. auditoria do despacho
-- Escrita só pelas RPCs abaixo (SECURITY DEFINER). O navegador lê, não grava.
create table if not exists public.work_order_dispatch_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  work_order_id uuid not null,
  action text not null,
  from_assignee uuid references public.profiles(id) on delete set null,
  to_assignee uuid references public.profiles(id) on delete set null,
  from_scheduled_date date,
  to_scheduled_date date,
  from_scheduled_time time,
  to_scheduled_time time,
  from_priority text,
  to_priority text,
  source text not null default 'web',
  client_request_id uuid,
  actor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint wo_dispatch_events_wo_company_fk
    foreign key (work_order_id, company_id) references public.work_orders(id, company_id) on delete cascade,
  constraint wo_dispatch_events_action_ck
    check (action in ('assign','unassign','reassign','schedule','unschedule','priority')),
  -- Origens previstas: a tela (web/mobile) e, no futuro, o agente.
  constraint wo_dispatch_events_source_ck
    check (source in ('web','mobile','assistant','whatsapp','system'))
);
create index if not exists idx_wo_dispatch_events_company
  on public.work_order_dispatch_events(company_id, created_at desc);
create index if not exists idx_wo_dispatch_events_wo
  on public.work_order_dispatch_events(company_id, work_order_id, created_at desc);
create index if not exists idx_wo_dispatch_events_actor
  on public.work_order_dispatch_events(actor_id);
create index if not exists idx_wo_dispatch_events_from_assignee
  on public.work_order_dispatch_events(from_assignee);
create index if not exists idx_wo_dispatch_events_to_assignee
  on public.work_order_dispatch_events(to_assignee);
-- Idempotência por pedido, na convenção da 0109/field_sales.
create unique index if not exists uq_wo_dispatch_events_request
  on public.work_order_dispatch_events(company_id, client_request_id)
  where client_request_id is not null;

alter table public.work_order_dispatch_events enable row level security;

-- O dono audita o próprio despacho; o técnico não precisa e não recebe.
drop policy if exists wo_dispatch_events_visible on public.work_order_dispatch_events;
create policy wo_dispatch_events_visible on public.work_order_dispatch_events
for select to authenticated
using (public.zt_is_owner(company_id));

revoke all on table public.work_order_dispatch_events from public, anon, authenticated;
grant select on table public.work_order_dispatch_events to authenticated;
grant all on table public.work_order_dispatch_events to service_role;

-- =====================================================================
-- 3. RPCs oficiais de despacho
-- =====================================================================
-- Um caminho só: a tela e o futuro agente chamam exatamente estas funções.
-- Cada uma confere dono, empresa, OS viva, executor ativo e assinatura, grava
-- auditoria com a origem e é idempotente por client_request_id.

-- Conflito de agenda é AVISO, não trava: quem despacha decide.
create or replace function zt_private.wo_schedule_conflicts(
  p_company uuid, p_work_order uuid, p_assignee uuid, p_date date, p_time time
)
returns integer
language sql
stable
security invoker
set search_path=''
as $$
  select count(*)::integer
    from public.work_orders w
   where w.company_id = p_company
     and w.id <> p_work_order
     and w.deleted_at is null
     and w.assigned_to is not null
     and p_assignee is not null
     and w.assigned_to = p_assignee
     and p_date is not null
     and w.scheduled_date = p_date
     and p_time is not null
     and w.scheduled_time = p_time
     and w.status in ('scheduled','in_progress');
$$;
revoke all on function zt_private.wo_schedule_conflicts(uuid,uuid,uuid,date,time) from public,anon,authenticated;
grant execute on function zt_private.wo_schedule_conflicts(uuid,uuid,uuid,date,time) to service_role;

-- Validações comuns: devolve a OS travada para escrita, ou falha fechada.
create or replace function zt_private.dispatch_load_work_order(p_work_order uuid, p_source text)
returns public.work_orders
language plpgsql
security definer
set search_path=''
as $$
declare
  v_wo public.work_orders;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado' using errcode='28000';
  end if;
  if p_source is null or p_source not in ('web','mobile','assistant','whatsapp','system') then
    raise exception 'Origem da operação inválida' using errcode='22023';
  end if;
  if p_work_order is null then
    raise exception 'Informe a ordem de serviço' using errcode='22023';
  end if;

  select * into v_wo from public.work_orders where id = p_work_order for update;
  if not found or v_wo.deleted_at is not null then
    raise exception 'Ordem de serviço não encontrada' using errcode='P0002';
  end if;
  -- Despacho é ato administrativo: só o dono da empresa da OS.
  if not public.zt_is_owner(v_wo.company_id) then
    raise exception 'Sem permissão para distribuir esta ordem de serviço' using errcode='42501';
  end if;
  if v_wo.status in ('done','canceled') then
    raise exception 'Ordem de serviço concluída ou cancelada não entra na distribuição' using errcode='23514';
  end if;
  perform zt_private.assert_operational_write_allowed(v_wo.company_id);
  return v_wo;
end;
$$;
revoke all on function zt_private.dispatch_load_work_order(uuid,text) from public,anon,authenticated;
grant execute on function zt_private.dispatch_load_work_order(uuid,text) to service_role;

-- Pedido repetido devolve o mesmo evento sem reaplicar nada.
create or replace function zt_private.dispatch_replay(p_company uuid, p_request uuid)
returns public.work_order_dispatch_events
language sql
stable
security definer
set search_path=''
as $$
  select e.* from public.work_order_dispatch_events e
   where e.company_id = p_company and e.client_request_id = p_request
   limit 1;
$$;
revoke all on function zt_private.dispatch_replay(uuid,uuid) from public,anon,authenticated;
grant execute on function zt_private.dispatch_replay(uuid,uuid) to service_role;

-- --------------------------------------------------------- atribuir/remover
-- p_assignee nulo = devolver para "Sem responsável".
create or replace function public.zt_assign_work_order(
  p_work_order uuid,
  p_assignee uuid,
  p_request uuid,
  p_source text default 'web'
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_wo public.work_orders;
  v_prev public.work_order_dispatch_events;
  v_action text;
  v_conflicts integer := 0;
  v_event uuid;
begin
  if p_request is null then
    raise exception 'Identificador da operação obrigatório' using errcode='22023';
  end if;
  v_wo := zt_private.dispatch_load_work_order(p_work_order, p_source);

  -- Idempotência: o mesmo pedido não reaplica; outro alvo com o mesmo pedido é recusado.
  v_prev := zt_private.dispatch_replay(v_wo.company_id, p_request);
  if v_prev.id is not null then
    if v_prev.work_order_id <> v_wo.id
       or v_prev.to_assignee is distinct from p_assignee
       or v_prev.action not in ('assign','unassign','reassign') then
      raise exception 'Identificador da operação já usado em outra distribuição' using errcode='23505';
    end if;
    return jsonb_build_object(
      'work_order_id', v_wo.id, 'assignee_id', v_wo.assigned_to,
      'event_id', v_prev.id, 'action', v_prev.action,
      'conflicts', 0, 'replayed', true);
  end if;

  if p_assignee is not null then
    -- Executor precisa ser membro ATIVO da empresa da OS. O próprio dono vale:
    -- uma empresa pode ser só o proprietário, ou ele atender junto com a equipe.
    if not exists (
      select 1 from public.company_members m
       where m.company_id = v_wo.company_id
         and m.user_id = p_assignee
         and m.status = 'active'
         and m.role in ('owner','technician')
    ) then
      raise exception 'Responsável precisa ser membro ativo da empresa' using errcode='23503';
    end if;
  end if;

  if v_wo.assigned_to is null and p_assignee is not null then v_action := 'assign';
  elsif v_wo.assigned_to is not null and p_assignee is null then v_action := 'unassign';
  elsif v_wo.assigned_to is distinct from p_assignee then v_action := 'reassign';
  else v_action := 'assign';
  end if;

  if p_assignee is not null then
    v_conflicts := zt_private.wo_schedule_conflicts(
      v_wo.company_id, v_wo.id, p_assignee, v_wo.scheduled_date, v_wo.scheduled_time);
  end if;

  update public.work_orders
     set assigned_to = p_assignee,
         updated_at = now()
   where id = v_wo.id;

  insert into public.work_order_dispatch_events(
    company_id, work_order_id, action, from_assignee, to_assignee,
    source, client_request_id, actor_id)
  values (
    v_wo.company_id, v_wo.id, v_action, v_wo.assigned_to, p_assignee,
    p_source, p_request, auth.uid())
  returning id into v_event;

  return jsonb_build_object(
    'work_order_id', v_wo.id, 'assignee_id', p_assignee,
    'event_id', v_event, 'action', v_action,
    'conflicts', v_conflicts, 'replayed', false);
end;
$$;
revoke all on function public.zt_assign_work_order(uuid,uuid,uuid,text) from public,anon;
grant execute on function public.zt_assign_work_order(uuid,uuid,uuid,text) to authenticated,service_role;

-- ------------------------------------------------------------- agendar
-- Data nula = tira do calendário e volta para 'unscheduled'.
create or replace function public.zt_schedule_work_order(
  p_work_order uuid,
  p_date date,
  p_time time,
  p_request uuid,
  p_source text default 'web'
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_wo public.work_orders;
  v_prev public.work_order_dispatch_events;
  v_action text;
  v_status public.zt_wo_status;
  v_conflicts integer := 0;
  v_event uuid;
begin
  if p_request is null then
    raise exception 'Identificador da operação obrigatório' using errcode='22023';
  end if;
  if p_date is null and p_time is not null then
    raise exception 'Informe a data junto com a hora' using errcode='22023';
  end if;
  v_wo := zt_private.dispatch_load_work_order(p_work_order, p_source);

  v_prev := zt_private.dispatch_replay(v_wo.company_id, p_request);
  if v_prev.id is not null then
    if v_prev.work_order_id <> v_wo.id
       or v_prev.to_scheduled_date is distinct from p_date
       or v_prev.to_scheduled_time is distinct from p_time
       or v_prev.action not in ('schedule','unschedule') then
      raise exception 'Identificador da operação já usado em outro agendamento' using errcode='23505';
    end if;
    return jsonb_build_object(
      'work_order_id', v_wo.id, 'scheduled_date', v_wo.scheduled_date,
      'scheduled_time', v_wo.scheduled_time, 'event_id', v_prev.id,
      'action', v_prev.action, 'conflicts', 0, 'replayed', true);
  end if;

  if p_date is null then
    v_action := 'unschedule';
    -- Em andamento continua em andamento: tirar a data não desfaz execução.
    v_status := case when v_wo.status = 'in_progress' then v_wo.status else 'unscheduled'::public.zt_wo_status end;
  else
    v_action := 'schedule';
    v_status := case when v_wo.status = 'in_progress' then v_wo.status else 'scheduled'::public.zt_wo_status end;
    v_conflicts := zt_private.wo_schedule_conflicts(
      v_wo.company_id, v_wo.id, v_wo.assigned_to, p_date, p_time);
  end if;

  update public.work_orders
     set scheduled_date = p_date,
         scheduled_time = p_time,
         status = v_status,
         updated_at = now()
   where id = v_wo.id;

  insert into public.work_order_dispatch_events(
    company_id, work_order_id, action,
    from_scheduled_date, to_scheduled_date, from_scheduled_time, to_scheduled_time,
    source, client_request_id, actor_id)
  values (
    v_wo.company_id, v_wo.id, v_action,
    v_wo.scheduled_date, p_date, v_wo.scheduled_time, p_time,
    p_source, p_request, auth.uid())
  returning id into v_event;

  return jsonb_build_object(
    'work_order_id', v_wo.id, 'scheduled_date', p_date, 'scheduled_time', p_time,
    'event_id', v_event, 'action', v_action,
    'conflicts', v_conflicts, 'replayed', false);
end;
$$;
revoke all on function public.zt_schedule_work_order(uuid,date,time,uuid,text) from public,anon;
grant execute on function public.zt_schedule_work_order(uuid,date,time,uuid,text) to authenticated,service_role;

-- ----------------------------------------------------------- prioridade
create or replace function public.zt_set_work_order_priority(
  p_work_order uuid,
  p_priority text,
  p_request uuid,
  p_source text default 'web'
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_wo public.work_orders;
  v_prev public.work_order_dispatch_events;
  v_priority text := lower(btrim(coalesce(p_priority,'')));
  v_event uuid;
begin
  if p_request is null then
    raise exception 'Identificador da operação obrigatório' using errcode='22023';
  end if;
  if v_priority not in ('normal','high','urgent') then
    raise exception 'Prioridade inválida' using errcode='22023';
  end if;
  v_wo := zt_private.dispatch_load_work_order(p_work_order, p_source);

  v_prev := zt_private.dispatch_replay(v_wo.company_id, p_request);
  if v_prev.id is not null then
    if v_prev.work_order_id <> v_wo.id
       or v_prev.to_priority is distinct from v_priority
       or v_prev.action <> 'priority' then
      raise exception 'Identificador da operação já usado em outra mudança de prioridade' using errcode='23505';
    end if;
    return jsonb_build_object(
      'work_order_id', v_wo.id, 'priority', v_wo.priority,
      'event_id', v_prev.id, 'action', 'priority', 'replayed', true);
  end if;

  update public.work_orders
     set priority = v_priority,
         updated_at = now()
   where id = v_wo.id;

  insert into public.work_order_dispatch_events(
    company_id, work_order_id, action, from_priority, to_priority,
    source, client_request_id, actor_id)
  values (
    v_wo.company_id, v_wo.id, 'priority', v_wo.priority, v_priority,
    p_source, p_request, auth.uid())
  returning id into v_event;

  return jsonb_build_object(
    'work_order_id', v_wo.id, 'priority', v_priority,
    'event_id', v_event, 'action', 'priority', 'replayed', false);
end;
$$;
revoke all on function public.zt_set_work_order_priority(uuid,text,uuid,text) from public,anon;
grant execute on function public.zt_set_work_order_priority(uuid,text,uuid,text) to authenticated,service_role;

-- =====================================================================
-- 4. Leitura do quadro: uma chamada, sem N+1 e sem financeiro
-- =====================================================================
-- Devolve, numa viagem só, o elenco de executores (inclusive o proprietário,
-- que pode atender) e os cartões operacionais da janela.
--
-- As colunas financeiras de work_orders (approved_subtotal/discount/surcharge/
-- total, extra_cost, pending_pricing, billing_entry_id) NÃO entram no SELECT:
-- a sanitização é estrutural, não filtro de frontend. O quadro é ferramenta de
-- despacho e por isso é do proprietário; o técnico segue com a própria Agenda.
create or replace function public.zt_operations_board(
  p_company uuid,
  p_from date,
  p_to date,
  p_limit integer default 400,
  p_include_done boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_from date := coalesce(p_from, current_date);
  v_to date := coalesce(p_to, coalesce(p_from, current_date) + 7);
  v_limit integer := least(greatest(coalesce(p_limit,400),1),1000);
  v_members jsonb;
  v_cards jsonb;
begin
  if p_company is null then
    raise exception 'Informe a empresa' using errcode='22023';
  end if;
  -- Despacho é do proprietário: o técnico não recebe o quadro da equipe.
  if not public.zt_is_owner(p_company) then
    raise exception 'Você não tem permissão para esta ação nesta empresa.' using errcode='42501';
  end if;
  if v_to < v_from then
    raise exception 'Janela de datas inválida' using errcode='22023';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'user_id', m.user_id,
           'name', coalesce(nullif(btrim(p.full_name),''), p.email, 'Colaborador'),
           'role', m.role,
           'job_title', m.job_title
         ) order by (m.role <> 'owner'), coalesce(p.full_name, p.email)), '[]'::jsonb)
    into v_members
    from public.company_members m
    left join public.profiles p on p.id = m.user_id
   where m.company_id = p_company
     and m.status = 'active'
     and m.role in ('owner','technician');

  select coalesce(jsonb_agg(c order by c->>'sort_key'), '[]'::jsonb)
    into v_cards
    from (
      select jsonb_build_object(
               'work_order_id', w.id,
               'number', w.number,
               'client_name', coalesce(nullif(btrim(cl.trade_name),''), cl.name),
               'location_name', coalesce(nullif(btrim(loc.name),''), nullif(btrim(w.service_place),''), nullif(btrim(w.address),'')),
               'summary', left(coalesce(nullif(btrim(w.request),''), nullif(btrim(w.problem_report),''), ''), 280),
               'scheduled_date', w.scheduled_date,
               'scheduled_time', w.scheduled_time,
               'status', w.status,
               'priority', w.priority,
               'assignee_id', w.assigned_to,
               'needs_return', coalesce(w.needs_return,false),
               'is_warranty_visit', coalesce(w.is_warranty_visit,false),
               'is_late', (w.scheduled_date is not null
                           and w.scheduled_date < current_date
                           and w.status in ('scheduled','in_progress')),
               'sort_key', coalesce(w.scheduled_date::text,'9999-12-31')||' '||
                           coalesce(w.scheduled_time::text,'99:99')||' '||w.number
             ) as c
        from public.work_orders w
        join public.clients cl on cl.id = w.client_id
        left join public.client_locations loc on loc.id = w.client_location_id
       where w.company_id = p_company
         and w.deleted_at is null
         and w.status <> 'canceled'
         -- Concluídas só entram quando a tela pede: o quadro de despacho é do
         -- que ainda vai acontecer, e carregar histórico encheria a coluna.
         and (coalesce(p_include_done,false) or w.status <> 'done')
         and (
           (w.scheduled_date between v_from and v_to)
           or (w.scheduled_date is null and w.status <> 'done')
           or (w.scheduled_date < v_from and w.status in ('scheduled','in_progress'))
         )
       order by coalesce(w.scheduled_date,'9999-12-31'), coalesce(w.scheduled_time,'23:59'), w.number
       limit v_limit
    ) x;

  return jsonb_build_object(
    'company_id', p_company,
    'from', v_from,
    'to', v_to,
    'members', v_members,
    'cards', v_cards);
end;
$$;
revoke all on function public.zt_operations_board(uuid,date,date,integer,boolean) from public,anon;
grant execute on function public.zt_operations_board(uuid,date,date,integer,boolean) to authenticated,service_role;

-- Aviso de conflito consultado pela tela antes de confirmar o arraste.
create or replace function public.zt_work_order_schedule_conflicts(
  p_work_order uuid,
  p_assignee uuid,
  p_date date,
  p_time time
)
returns integer
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_company uuid;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado' using errcode='28000';
  end if;
  select w.company_id into v_company
    from public.work_orders w where w.id = p_work_order and w.deleted_at is null;
  if not found then
    raise exception 'Ordem de serviço não encontrada' using errcode='P0002';
  end if;
  if not public.zt_is_owner(v_company) then
    raise exception 'Você não tem permissão para esta ação nesta empresa.' using errcode='42501';
  end if;
  return zt_private.wo_schedule_conflicts(v_company, p_work_order, p_assignee, p_date, p_time);
end;
$$;
revoke all on function public.zt_work_order_schedule_conflicts(uuid,uuid,date,time) from public,anon;
grant execute on function public.zt_work_order_schedule_conflicts(uuid,uuid,date,time) to authenticated,service_role;
