-- ZiisTec · Field Execution Intelligence V1 (0111) — Base Técnica, confirmação do atendimento e relatório com IA.
--
-- Auditoria antes de criar (nada abaixo duplica estrutura existente):
--   * needs_return/work_order_returns (0084) continuam sendo a única fonte de "precisa retornar";
--   * work_order_reports (0082/0102) continua sendo o relato/relatório do cliente; o snapshot do relatório
--     de atendimento continua imutável e nenhuma tabela nova entra nele;
--   * work_order_materials/work_order_items continuam sendo a autoridade de materiais; a IA não recebe preço nem custo;
--   * started_at/completed_at (0101) são só lidos pelo app (nenhuma coluna de duração é criada).
--
-- 1. work_order_technical_base: causa, solução, dificuldade e observação técnica final, INTERNAS e sem PII do cliente
--    (a futura busca de "casos semelhantes" parte daqui). Uma linha por OS, isolada por empresa; o proprietário lê tudo
--    da empresa e o técnico só a OS atribuída a ele. Escrita só pela RPC, idempotente por pedido.
-- 2. work_order_attendance_confirmations: nome de quem recebeu o serviço ou "responsável ausente". Separada da Base
--    Técnica de propósito (contém nome de pessoa). Mesma regra de acesso e de escrita.
-- 3. work_order_ai_reports: livro-razão das gerações de relatório por IA. O limite de 3 por OS é decidido aqui, no banco:
--    conta a geração aceita no pedido (não o clique), não depende do navegador e reaproveita o mesmo pedido sem nova cobrança.
--    O navegador não lê nem grava a tabela; só as funções abaixo.
--
-- Nada altera work_orders (sem coluna nova, sem mudança nas colunas legíveis do técnico), a finalização atômica,
-- cobrança, garantia ou estoque. Ordem de publicação: frontend novo antes das migrations 0100–0111, como no pacote atual.

-- ---------------------------------------------------------------- 1. Base Técnica
create table if not exists public.work_order_technical_base (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  work_order_id uuid not null,
  cause text,
  solution text,
  difficulty text,
  learning text,
  revision integer not null default 1,
  last_request_id uuid,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wo_technical_base_wo_company_fk
    foreign key (work_order_id, company_id) references public.work_orders(id, company_id) on delete cascade,
  constraint wo_technical_base_one_per_wo unique (work_order_id),
  constraint wo_technical_base_cause_len check (cause is null or char_length(cause) between 1 and 3000),
  constraint wo_technical_base_solution_len check (solution is null or char_length(solution) between 1 and 3000),
  constraint wo_technical_base_learning_len check (learning is null or char_length(learning) between 1 and 3000),
  constraint wo_technical_base_difficulty_ck check (difficulty is null or difficulty in ('easy','medium','hard'))
);

create index if not exists idx_wo_technical_base_company
  on public.work_order_technical_base(company_id, updated_at desc);

alter table public.work_order_technical_base enable row level security;
revoke all on public.work_order_technical_base from public, anon, authenticated;
grant select on public.work_order_technical_base to authenticated;

drop policy if exists wo_technical_base_visible on public.work_order_technical_base;
create policy wo_technical_base_visible on public.work_order_technical_base
  for select to authenticated
  using (public.zt_is_owner(company_id) or public.zt_wo_is_mine(work_order_id));

drop trigger if exists trg_subscription_write_guard on public.work_order_technical_base;
create trigger trg_subscription_write_guard
before insert or update or delete on public.work_order_technical_base
for each row execute function public.zt_guard_subscription_write();

create or replace function public.zt_save_work_order_technical_base(
  p_wo uuid,
  p_cause text,
  p_solution text,
  p_difficulty text,
  p_learning text,
  p_request uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_wo public.work_orders%rowtype;
  v_row public.work_order_technical_base%rowtype;
  v_cause text := nullif(btrim(coalesce(p_cause, '')), '');
  v_solution text := nullif(btrim(coalesce(p_solution, '')), '');
  v_learning text := nullif(btrim(coalesce(p_learning, '')), '');
  v_difficulty text := nullif(lower(btrim(coalesce(p_difficulty, ''))), '');
begin
  if v_uid is null then raise exception 'Não autenticado' using errcode = '28000'; end if;
  if p_request is null then raise exception 'Identificador da operação obrigatório' using errcode = '22023'; end if;
  if char_length(v_cause) > 3000 or char_length(v_solution) > 3000 or char_length(v_learning) > 3000 then
    raise exception 'Cada campo da Base Técnica aceita no máximo 3.000 caracteres' using errcode = '22023';
  end if;
  if v_difficulty is not null and v_difficulty not in ('easy', 'medium', 'hard') then
    raise exception 'Nível de dificuldade inválido' using errcode = '22023';
  end if;

  if p_wo is null or not (public.zt_wo_is_owned(p_wo) or (public.zt_wo_is_mine(p_wo) and public.zt_wo_open(p_wo))) then
    raise exception 'Sem permissão para registrar a Base Técnica desta OS' using errcode = '42501';
  end if;
  select w.* into v_wo from public.work_orders w where w.id = p_wo and w.deleted_at is null for update;
  if not found then raise exception 'OS não encontrada' using errcode = 'P0002'; end if;
  perform zt_private.assert_operational_write_allowed(v_wo.company_id);

  select b.* into v_row from public.work_order_technical_base b where b.work_order_id = v_wo.id;
  if found and v_row.last_request_id = p_request then
    -- Retry do mesmo envio devolve a mesma linha; o mesmo pedido com outro conteúdo é recusado.
    if v_row.cause is distinct from v_cause or v_row.solution is distinct from v_solution
       or v_row.difficulty is distinct from v_difficulty or v_row.learning is distinct from v_learning then
      raise exception 'Identificador já usado em outra versão da Base Técnica' using errcode = '23505';
    end if;
    return to_jsonb(v_row);
  end if;
  if not found and v_cause is null and v_solution is null and v_difficulty is null and v_learning is null then
    return null;
  end if;

  insert into public.work_order_technical_base as b(
    company_id, work_order_id, cause, solution, difficulty, learning, last_request_id, created_by, updated_by
  ) values (
    v_wo.company_id, v_wo.id, v_cause, v_solution, v_difficulty, v_learning, p_request, v_uid, v_uid
  )
  on conflict (work_order_id) do update
    set cause = excluded.cause,
        solution = excluded.solution,
        difficulty = excluded.difficulty,
        learning = excluded.learning,
        revision = b.revision + 1,
        last_request_id = excluded.last_request_id,
        updated_by = excluded.updated_by,
        updated_at = now()
  returning b.* into v_row;
  return to_jsonb(v_row);
end;
$$;

revoke all on function public.zt_save_work_order_technical_base(uuid, text, text, text, text, uuid) from public, anon;
grant execute on function public.zt_save_work_order_technical_base(uuid, text, text, text, text, uuid) to authenticated;

-- ---------------------------------------------------------------- 2. Confirmação do atendimento
create table if not exists public.work_order_attendance_confirmations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  work_order_id uuid not null,
  received_by_name text,
  receiver_absent boolean not null default false,
  last_request_id uuid,
  confirmed_by uuid references public.profiles(id) on delete set null,
  confirmed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wo_attendance_wo_company_fk
    foreign key (work_order_id, company_id) references public.work_orders(id, company_id) on delete cascade,
  constraint wo_attendance_one_per_wo unique (work_order_id),
  constraint wo_attendance_name_or_absent_ck check (
    (receiver_absent and received_by_name is null)
    or (not receiver_absent and received_by_name is not null and char_length(received_by_name) between 2 and 120)
  )
);

alter table public.work_order_attendance_confirmations enable row level security;
revoke all on public.work_order_attendance_confirmations from public, anon, authenticated;
grant select on public.work_order_attendance_confirmations to authenticated;

drop policy if exists wo_attendance_visible on public.work_order_attendance_confirmations;
create policy wo_attendance_visible on public.work_order_attendance_confirmations
  for select to authenticated
  using (public.zt_is_owner(company_id) or public.zt_wo_is_mine(work_order_id));

drop trigger if exists trg_subscription_write_guard on public.work_order_attendance_confirmations;
create trigger trg_subscription_write_guard
before insert or update or delete on public.work_order_attendance_confirmations
for each row execute function public.zt_guard_subscription_write();

create or replace function public.zt_save_attendance_confirmation(
  p_wo uuid,
  p_name text,
  p_absent boolean,
  p_request uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_wo public.work_orders%rowtype;
  v_row public.work_order_attendance_confirmations%rowtype;
  v_absent boolean := coalesce(p_absent, false);
  v_name text;
begin
  if v_uid is null then raise exception 'Não autenticado' using errcode = '28000'; end if;
  if p_request is null then raise exception 'Identificador da operação obrigatório' using errcode = '22023'; end if;

  v_name := nullif(btrim(regexp_replace(coalesce(p_name, ''), '[[:cntrl:]]+', ' ', 'g')), '');
  if v_absent then
    v_name := null;
  elsif v_name is null or char_length(v_name) < 2 or char_length(v_name) > 120 then
    raise exception 'Informe o nome de quem recebeu o serviço ou marque Responsável ausente' using errcode = '22023';
  end if;

  if p_wo is null or not (public.zt_wo_is_owned(p_wo) or (public.zt_wo_is_mine(p_wo) and public.zt_wo_open(p_wo))) then
    raise exception 'Sem permissão para confirmar o atendimento desta OS' using errcode = '42501';
  end if;
  select w.* into v_wo from public.work_orders w where w.id = p_wo and w.deleted_at is null for update;
  if not found then raise exception 'OS não encontrada' using errcode = 'P0002'; end if;
  perform zt_private.assert_operational_write_allowed(v_wo.company_id);

  select c.* into v_row from public.work_order_attendance_confirmations c where c.work_order_id = v_wo.id;
  if found and v_row.last_request_id = p_request then
    if v_row.receiver_absent is distinct from v_absent or v_row.received_by_name is distinct from v_name then
      raise exception 'Identificador já usado em outra confirmação' using errcode = '23505';
    end if;
    return to_jsonb(v_row);
  end if;

  insert into public.work_order_attendance_confirmations as c(
    company_id, work_order_id, received_by_name, receiver_absent, last_request_id, confirmed_by
  ) values (
    v_wo.company_id, v_wo.id, v_name, v_absent, p_request, v_uid
  )
  on conflict (work_order_id) do update
    set received_by_name = excluded.received_by_name,
        receiver_absent = excluded.receiver_absent,
        last_request_id = excluded.last_request_id,
        confirmed_by = excluded.confirmed_by,
        updated_at = now()
  returning c.* into v_row;
  return to_jsonb(v_row);
end;
$$;

revoke all on function public.zt_save_attendance_confirmation(uuid, text, boolean, uuid) from public, anon;
grant execute on function public.zt_save_attendance_confirmation(uuid, text, boolean, uuid) to authenticated;

-- ---------------------------------------------------------------- 3. Relatório com IA: fatos, limite e registro
create table if not exists public.work_order_ai_reports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  work_order_id uuid not null,
  requested_by uuid not null,
  request_id uuid not null,
  status text not null default 'pending',
  output_text text,
  used_at timestamptz,
  used_edited boolean,
  created_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  constraint wo_ai_reports_wo_company_fk
    foreign key (work_order_id, company_id) references public.work_orders(id, company_id) on delete cascade,
  constraint wo_ai_reports_request_once unique (work_order_id, request_id),
  constraint wo_ai_reports_status_ck check (status in ('pending', 'completed')),
  constraint wo_ai_reports_output_ck check (
    (status = 'pending' and output_text is null)
    or (status = 'completed' and output_text is not null and char_length(output_text) between 1 and 12000)
  )
);

create index if not exists idx_wo_ai_reports_wo on public.work_order_ai_reports(work_order_id, created_at desc);

alter table public.work_order_ai_reports enable row level security;
-- Sem policy e sem privilégio: leitura e escrita só pelas funções abaixo.
revoke all on public.work_order_ai_reports from public, anon, authenticated;

-- Fatos que podem ir ao texto do cliente. O banco decide o que sai: sem custo, preço, margem, dificuldade, observação
-- técnica interna, nome, telefone ou endereço do cliente. Materiais extras do app chegam só como produto + quantidade e
-- o nome vem do catálogo da própria empresa.
create or replace function public.zt_work_order_report_facts(p_wo uuid, p_materials jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_wo public.work_orders%rowtype;
  v_base public.work_order_technical_base%rowtype;
  v_return public.work_order_returns%rowtype;
  v_services jsonb;
  v_materials jsonb;
  v_extra jsonb := '[]'::jsonb;
  v_evidence integer;
begin
  if v_uid is null then raise exception 'Não autenticado' using errcode = '28000'; end if;
  if p_wo is null or not (public.zt_wo_is_owned(p_wo) or public.zt_wo_is_mine(p_wo)) then
    raise exception 'Sem permissão para esta OS' using errcode = '42501';
  end if;
  select w.* into v_wo from public.work_orders w where w.id = p_wo and w.deleted_at is null;
  if not found then raise exception 'OS não encontrada' using errcode = 'P0002'; end if;

  if p_materials is not null and jsonb_typeof(p_materials) <> 'array' then
    raise exception 'Materiais inválidos' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(p_materials, '[]'::jsonb)) > 30 then
    raise exception 'Materiais demais para o relatório' using errcode = '22023';
  end if;
  begin
    select coalesce(jsonb_agg(jsonb_build_object('name', pr.name, 'quantity', e.qty) order by e.ord), '[]'::jsonb)
      into v_extra
      from (
        select x.ord, (x.item ->> 'productId')::uuid as product_id, (x.item ->> 'quantity')::numeric as qty
          from jsonb_array_elements(coalesce(p_materials, '[]'::jsonb)) with ordinality as x(item, ord)
      ) e
      join public.products pr on pr.id = e.product_id and pr.company_id = v_wo.company_id and pr.deleted_at is null
     where e.qty > 0 and e.qty <= 9999;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'Materiais inválidos' using errcode = '22023';
  end;

  select b.* into v_base from public.work_order_technical_base b where b.work_order_id = v_wo.id;
  select r.* into v_return from public.work_order_returns r
   where r.work_order_id = v_wo.id and r.company_id = v_wo.company_id
   order by r.created_at desc limit 1;

  select coalesce(jsonb_agg(i.name order by i.name), '[]'::jsonb) into v_services
    from public.work_order_items i
   where i.work_order_id = v_wo.id and i.company_id = v_wo.company_id and i.kind <> 'product';

  select coalesce(jsonb_agg(m.item order by m.ord), '[]'::jsonb) into v_materials
    from (
      select 1 as ord, jsonb_build_object('name', i.name, 'quantity', i.quantity) as item
        from public.work_order_items i
       where i.work_order_id = v_wo.id and i.company_id = v_wo.company_id and i.kind = 'product'
      union all
      select 2, jsonb_build_object('name', mt.name, 'quantity', mt.quantity)
        from public.work_order_materials mt
       where mt.work_order_id = v_wo.id and mt.company_id = v_wo.company_id
      union all
      select 3, e.item from jsonb_array_elements(v_extra) as e(item)
    ) m;

  select count(*) into v_evidence from public.attachments a
   where a.work_order_id = v_wo.id and a.company_id = v_wo.company_id;

  return jsonb_build_object(
    'workOrderNumber', v_wo.number,
    'scheduledDate', v_wo.scheduled_date,
    'serviceRequested', nullif(btrim(coalesce(v_wo.request, '')), ''),
    'services', v_services,
    'cause', v_base.cause,
    'solution', v_base.solution,
    'materials', v_materials,
    'returnNeeded', coalesce(v_wo.needs_return, false),
    'returnReason', case when coalesce(v_wo.needs_return, false) then v_return.reason end,
    'evidenceCount', v_evidence
  );
end;
$$;

revoke all on function public.zt_work_order_report_facts(uuid, jsonb) from public, anon;
grant execute on function public.zt_work_order_report_facts(uuid, jsonb) to authenticated;

-- Uma geração conta quando termina ou enquanto está em andamento recente (90 s > tempo limite do provedor). Uma
-- tentativa que o servidor não conclui expira sozinha e deixa de contar; o navegador não tem como liberar vaga.
create or replace function public.zt_claim_work_order_ai_report(p_wo uuid, p_request uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_limit constant integer := 3;
  c_inflight constant interval := interval '90 seconds';
  v_uid uuid := auth.uid();
  v_wo public.work_orders%rowtype;
  v_row public.work_order_ai_reports%rowtype;
  v_used integer;
begin
  if v_uid is null then raise exception 'Não autenticado' using errcode = '28000'; end if;
  if p_request is null then raise exception 'Identificador da geração obrigatório' using errcode = '22023'; end if;

  if p_wo is null or not (public.zt_wo_is_owned(p_wo) or (public.zt_wo_is_mine(p_wo) and public.zt_wo_open(p_wo))) then
    raise exception 'Sem permissão para esta OS' using errcode = '42501';
  end if;
  -- O lock da OS serializa os pedidos: dois cliques simultâneos não passam do limite.
  select w.* into v_wo from public.work_orders w where w.id = p_wo and w.deleted_at is null for update;
  if not found then raise exception 'OS não encontrada' using errcode = 'P0002'; end if;
  if v_wo.status in ('done', 'canceled') then
    raise exception 'OS encerrada não gera novo relatório com IA' using errcode = '42501';
  end if;
  perform zt_private.assert_operational_write_allowed(v_wo.company_id);

  select r.* into v_row from public.work_order_ai_reports r where r.work_order_id = v_wo.id and r.request_id = p_request;
  if found then
    if v_row.requested_by <> v_uid then
      raise exception 'Identificador já usado em outra geração' using errcode = '23505';
    end if;
    select count(*) into v_used from public.work_order_ai_reports r
     where r.work_order_id = v_wo.id and (r.status = 'completed' or r.created_at > clock_timestamp() - c_inflight);
    if v_row.status = 'completed' then
      return jsonb_build_object('allowed', true, 'replay', true, 'text', v_row.output_text,
        'used', v_used, 'limit', c_limit, 'remaining', greatest(c_limit - v_used, 0));
    end if;
    if v_row.created_at > clock_timestamp() - c_inflight then
      return jsonb_build_object('allowed', false, 'reason', 'in_progress', 'used', v_used, 'limit', c_limit,
        'remaining', greatest(c_limit - v_used, 0));
    end if;
  end if;

  select count(*) into v_used from public.work_order_ai_reports r
   where r.work_order_id = v_wo.id and r.request_id <> p_request
     and (r.status = 'completed' or r.created_at > clock_timestamp() - c_inflight);
  if v_used >= c_limit then
    return jsonb_build_object('allowed', false, 'reason', 'limit_reached', 'used', v_used, 'limit', c_limit, 'remaining', 0);
  end if;

  -- Quota geral de IA (por usuário e empresa, assinatura ativa). Só é gasta depois do limite da OS.
  perform zt_private.zt_consume_ai_quota(v_wo.company_id);

  if v_row.id is null then
    insert into public.work_order_ai_reports(company_id, work_order_id, requested_by, request_id)
    values (v_wo.company_id, v_wo.id, v_uid, p_request);
  else
    update public.work_order_ai_reports set created_at = clock_timestamp() where id = v_row.id;
  end if;
  return jsonb_build_object('allowed', true, 'replay', false, 'used', v_used + 1, 'limit', c_limit,
    'remaining', c_limit - v_used - 1);
end;
$$;

revoke all on function public.zt_claim_work_order_ai_report(uuid, uuid) from public, anon;
grant execute on function public.zt_claim_work_order_ai_report(uuid, uuid) to authenticated;

create or replace function public.zt_complete_work_order_ai_report(p_wo uuid, p_request uuid, p_text text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_limit constant integer := 3;
  v_uid uuid := auth.uid();
  v_row public.work_order_ai_reports%rowtype;
  v_text text := btrim(coalesce(p_text, ''));
  v_used integer;
begin
  if v_uid is null then raise exception 'Não autenticado' using errcode = '28000'; end if;
  if v_text = '' or char_length(v_text) > 12000 then
    raise exception 'Texto do relatório inválido' using errcode = '22023';
  end if;

  select r.* into v_row from public.work_order_ai_reports r
   where r.work_order_id = p_wo and r.request_id = p_request and r.requested_by = v_uid for update;
  if not found then raise exception 'Geração não encontrada' using errcode = 'P0002'; end if;
  if v_row.status = 'pending' then
    update public.work_order_ai_reports set status = 'completed', output_text = v_text, finished_at = clock_timestamp()
     where id = v_row.id;
  end if;

  select count(*) into v_used from public.work_order_ai_reports r
   where r.work_order_id = p_wo and (r.status = 'completed' or r.created_at > clock_timestamp() - interval '90 seconds');
  return jsonb_build_object('used', v_used, 'limit', c_limit, 'remaining', greatest(c_limit - v_used, 0));
end;
$$;

revoke all on function public.zt_complete_work_order_ai_report(uuid, uuid, text) from public, anon;
grant execute on function public.zt_complete_work_order_ai_report(uuid, uuid, text) to authenticated;

-- Marca qual geração virou o relato salvo e se o texto foi editado depois (origem IA × manual).
create or replace function public.zt_mark_work_order_ai_report_used(p_wo uuid, p_request uuid, p_final_text text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.work_order_ai_reports%rowtype;
begin
  if v_uid is null then raise exception 'Não autenticado' using errcode = '28000'; end if;
  select r.* into v_row from public.work_order_ai_reports r
   where r.work_order_id = p_wo and r.request_id = p_request and r.requested_by = v_uid and r.status = 'completed' for update;
  if not found then return false; end if;
  update public.work_order_ai_reports
     set used_at = coalesce(used_at, clock_timestamp()),
         used_edited = btrim(coalesce(p_final_text, '')) is distinct from btrim(output_text)
   where id = v_row.id;
  return true;
end;
$$;

revoke all on function public.zt_mark_work_order_ai_report_used(uuid, uuid, text) from public, anon;
grant execute on function public.zt_mark_work_order_ai_report_used(uuid, uuid, text) to authenticated;

create or replace function public.zt_work_order_ai_report_usage(p_wo uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c_limit constant integer := 3;
  v_uid uuid := auth.uid();
  v_wo public.work_orders%rowtype;
  v_used integer;
  v_last public.work_order_ai_reports%rowtype;
begin
  if v_uid is null then raise exception 'Não autenticado' using errcode = '28000'; end if;
  if p_wo is null or not (public.zt_wo_is_owned(p_wo) or public.zt_wo_is_mine(p_wo)) then
    raise exception 'Sem permissão para esta OS' using errcode = '42501';
  end if;
  select w.* into v_wo from public.work_orders w where w.id = p_wo and w.deleted_at is null;
  if not found then raise exception 'OS não encontrada' using errcode = 'P0002'; end if;
  select count(*) into v_used from public.work_order_ai_reports r
   where r.work_order_id = v_wo.id and (r.status = 'completed' or r.created_at > clock_timestamp() - interval '90 seconds');
  select r.* into v_last from public.work_order_ai_reports r
   where r.work_order_id = v_wo.id and r.used_at is not null order by r.used_at desc limit 1;
  return jsonb_build_object('used', v_used, 'limit', c_limit, 'remaining', greatest(c_limit - v_used, 0),
    'lastUsedAt', v_last.used_at, 'lastUsedEdited', v_last.used_edited);
end;
$$;

revoke all on function public.zt_work_order_ai_report_usage(uuid) from public, anon;
grant execute on function public.zt_work_order_ai_report_usage(uuid) to authenticated;

comment on table public.work_order_technical_base is
  'Base Técnica INTERNA da OS (causa, solução, dificuldade, observação final). Nunca entra em documento do cliente.';
comment on table public.work_order_attendance_confirmations is
  'Nome de quem recebeu o serviço ou responsável ausente. Separada da Base Técnica por conter nome de pessoa.';
comment on table public.work_order_ai_reports is
  'Gerações de relatório com IA por OS. O limite por OS é decidido em zt_claim_work_order_ai_report.';

notify pgrst, 'reload schema';
