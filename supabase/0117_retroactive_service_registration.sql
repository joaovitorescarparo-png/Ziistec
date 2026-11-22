-- ZiisTec · REGISTRAR SERVIÇO REALIZADO (0117) — OS lançada depois do atendimento.
--
-- Auditoria antes de criar (o que já existe e é REUTILIZADO, não duplicado):
--   * public.work_orders continua a única autoridade: o resultado é uma OS
--     concluída normal, não uma "tabela de serviços realizados";
--   * zt_private.zt_save_work_order_idempotent cria a OS (número, local do
--     cliente, itens) com idempotência por client_request_id;
--   * zt_private.zt_complete_work_order conclui pelo fluxo oficial: relato no
--     histórico, garantias e o lançamento em financial_entries;
--   * public.zt_adjust_product_stock(...,p_request) é o fluxo oficial de baixa,
--     idempotente por pedido. NÃO usamos zt_sell_product_on_work_order: ele
--     criaria um SEGUNDO recebível (field_sales) junto do faturamento da OS;
--   * work_order_materials/work_order_items seguem como estão — o comportamento
--     geral delas não muda nesta migration.
--
-- O que é específico deste fluxo (e só dele):
--   1. data do serviço no passado é legítima; data futura é recusada;
--   2. completed_at recebe o momento histórico real da conclusão (data/hora do
--      serviço). created_at NUNCA é tocado: é quando o registro foi lançado, e é
--      o que permite o histórico distinguir "serviço em X, registrado em Y";
--   3. garantia começa na data real do serviço, preservando a duração;
--   4. vencimento do recebível conta da data real do serviço;
--   5. produto que controla estoque dá baixa; produto que não controla, não gera
--      movimento (chamar o ajuste ligaria track_stock sem pedido do usuário).
--
-- A OS normal e a finalização normal não mudam em nada: nenhuma função existente
-- é redefinida aqui.
--
-- Transacional por construção: a função é uma só unidade. Qualquer falha em OS,
-- estoque, garantia ou financeiro desfaz o registro inteiro.
-- Idempotente: o mesmo p_request devolve o mesmo registro, sem repetir baixa de
-- estoque nem lançamento financeiro.

create or replace function public.zt_register_completed_work_order(
  p_company uuid,
  p_request uuid,
  p_row jsonb,
  p_items jsonb default '[]'::jsonb,
  p_materials jsonb default '[]'::jsonb,
  p_payment jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_uid uuid := auth.uid();
  v_service_date date;
  v_service_time time;
  v_completed_at timestamptz;
  v_assignee uuid;
  v_client uuid;
  v_wo uuid;
  v_existing public.work_orders%rowtype;
  v_due_days integer;
  v_billing uuid;
  v_payment_status text;
  v_paid_at date;
  v_method text;
  v_due_date date;
  v_extra_cost numeric;
  v_report text;
  v_row jsonb;
  m jsonb;
  v_product uuid;
  v_qty numeric;
  v_track boolean;
  v_stock_request uuid;
  v_moves jsonb := '[]'::jsonb;
  v_balance numeric;
begin
  if v_uid is null then
    raise exception 'Não autenticado' using errcode='28000';
  end if;
  if p_company is null then
    raise exception 'Informe a empresa' using errcode='22023';
  end if;
  -- Registro retroativo é ato administrativo: somente o proprietário.
  if not public.zt_is_owner(p_company) then
    raise exception 'Somente o proprietário pode registrar um serviço já realizado' using errcode='42501';
  end if;
  if p_request is null then
    raise exception 'Identificador da operação obrigatório' using errcode='22023';
  end if;
  perform zt_private.assert_operational_write_allowed(p_company);

  -- Idempotência: o mesmo pedido devolve o registro já feito, sem repetir nada.
  select * into v_existing
    from public.work_orders
   where company_id=p_company and client_request_id=p_request;
  if found then
    return jsonb_build_object(
      'work_order_id', v_existing.id,
      'number', v_existing.number,
      'service_date', v_existing.scheduled_date,
      'completed_at', v_existing.completed_at,
      'billing_entry_id', v_existing.billing_entry_id,
      'stock_movements', '[]'::jsonb,
      'replayed', true);
  end if;

  -- ------------------------------------------------------------- data real
  begin
    v_service_date := nullif(p_row->>'service_date','')::date;
  exception when others then
    raise exception 'Data do serviço inválida' using errcode='22023';
  end;
  if v_service_date is null then
    raise exception 'Informe a data em que o serviço foi realizado' using errcode='22023';
  end if;
  -- Serviço realizado não acontece no futuro.
  if v_service_date > (now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'A data do serviço não pode ser futura' using errcode='22023';
  end if;
  begin
    v_service_time := nullif(p_row->>'service_time','')::time;
  exception when others then
    raise exception 'Horário do serviço inválido' using errcode='22023';
  end;
  -- Momento histórico da conclusão, no fuso do produto. Meio-dia quando não há
  -- hora informada: não inventa madrugada nem atravessa o dia.
  v_completed_at := ((v_service_date::text||' '||coalesce(v_service_time::text,'12:00:00'))::timestamp)
                      at time zone 'America/Sao_Paulo';

  -- --------------------------------------------------------- responsável
  v_assignee := coalesce(nullif(p_row->>'assigned_to','')::uuid, v_uid);
  if not exists (
    select 1 from public.company_members m
     where m.company_id=p_company
       and m.user_id=v_assignee
       and m.status='active'
       and m.role in ('owner','technician')
  ) then
    raise exception 'Responsável precisa ser membro ativo da empresa' using errcode='23503';
  end if;

  -- -------------------------------------------------------------- cliente
  v_client := nullif(p_row->>'client_id','')::uuid;
  if v_client is null then
    raise exception 'Informe o cliente' using errcode='22023';
  end if;
  if not exists (
    select 1 from public.clients c
     where c.id=v_client and c.company_id=p_company and c.deleted_at is null
  ) then
    raise exception 'Cliente não pertence a esta empresa' using errcode='23503';
  end if;

  -- ------------------------------------------------- cria a OS pelo caminho oficial
  -- company_id vem SEMPRE do argumento validado acima, nunca do p_row.
  v_row := jsonb_build_object(
    'company_id', p_company,
    'client_id', v_client,
    'client_location_id', nullif(p_row->>'client_location_id',''),
    'assigned_to', v_assignee,
    'status', 'scheduled',
    'scheduled_date', v_service_date::text,
    'scheduled_time', coalesce(v_service_time::text, null),
    'address', nullif(p_row->>'address',''),
    'service_place', nullif(p_row->>'service_place',''),
    'request', nullif(p_row->>'request',''),
    'created_by', v_uid);

  v_wo := zt_private.zt_save_work_order_idempotent(p_company, null, p_request, v_row, coalesce(p_items,'[]'::jsonb));
  if v_wo is null then
    raise exception 'Não foi possível criar a ordem de serviço' using errcode='P0002';
  end if;

  -- ------------------------------- materiais consumidos (antes de concluir)
  -- A trava de documento concluído impede inserir material depois da conclusão.
  if jsonb_typeof(coalesce(p_materials,'[]'::jsonb)) <> 'array' then
    raise exception 'Materiais precisam ser uma lista' using errcode='22023';
  end if;
  if jsonb_array_length(coalesce(p_materials,'[]'::jsonb)) > 100 then
    raise exception 'Quantidade de materiais excede o limite por atendimento' using errcode='22023';
  end if;

  for m in select value from jsonb_array_elements(coalesce(p_materials,'[]'::jsonb)) loop
    v_product := null;
    if coalesce(m->>'product_id','') <> '' then
      begin
        v_product := (m->>'product_id')::uuid;
      exception when invalid_text_representation then
        raise exception 'Produto inválido no material' using errcode='22023';
      end;
      if not exists (
        select 1 from public.products p where p.id=v_product and p.company_id=p_company
      ) then
        raise exception 'Produto do material não pertence à empresa' using errcode='23503';
      end if;
    end if;
    v_qty := greatest(coalesce((m->>'quantity')::numeric,1),0.001);

    insert into public.work_order_materials(
      work_order_id, company_id, product_id, name, quantity, unit_cost, serial_number, created_by)
    values (
      v_wo, p_company, v_product,
      left(coalesce(nullif(btrim(m->>'name'),''),'Material'),500),
      v_qty,
      greatest(coalesce((m->>'unit_cost')::numeric,0),0),
      nullif(left(coalesce(m->>'serial_number',''),200),''),
      v_uid);
  end loop;

  -- ------------------------------------------- conclusão pelo fluxo oficial
  v_due_days := greatest(least(coalesce((p_payment->>'due_days')::integer,7),365),0);
  v_extra_cost := greatest(coalesce((p_row->>'extra_cost')::numeric,0),0);
  v_report := nullif(btrim(coalesce(p_row->>'report', p_row->>'request','')),'');

  v_billing := zt_private.zt_complete_work_order(v_wo, v_report, null, v_extra_cost, v_due_days);

  -- ================= correções retroativas, exclusivas deste fluxo =========
  -- Em contexto SECURITY DEFINER a trava de documento histórico libera passagem
  -- (ela barra apenas o papel `authenticated`), que é como as demais funções
  -- internas confiáveis do produto já operam.

  -- 1. a conclusão passa a valer no momento histórico real do serviço.
  --    created_at permanece intocado: é a data real do registro.
  update public.work_orders
     set completed_at = v_completed_at
   where id = v_wo;

  -- 2. garantia começa na data real do serviço, preservando a duração.
  update public.warranties
     set starts_on = v_service_date,
         ends_on = v_service_date + (ends_on - starts_on)
   where work_order_id = v_wo
     and company_id = p_company;

  -- 3. vencimento conta da data real do serviço, com a mesma regra de dias.
  if v_billing is not null then
    begin
      v_due_date := nullif(p_payment->>'due_date','')::date;
    exception when others then
      raise exception 'Vencimento informado inválido' using errcode='22023';
    end;
    update public.financial_entries
       set due_date = coalesce(v_due_date, v_service_date + v_due_days)
     where id = v_billing and company_id = p_company;
  end if;

  -- 4. pagamento: marca o lançamento que JÁ existe; nunca cria um segundo.
  v_payment_status := lower(btrim(coalesce(p_payment->>'status','pending')));
  if v_payment_status not in ('pending','paid') then
    raise exception 'Situação de pagamento inválida' using errcode='22023';
  end if;
  if v_payment_status='paid' then
    if v_billing is null then
      raise exception 'Não há cobrança para marcar como paga neste registro' using errcode='22023';
    end if;
    v_method := nullif(btrim(coalesce(p_payment->>'method','')),'');
    if v_method is null then
      raise exception 'Informe a forma de pagamento' using errcode='22023';
    end if;
    begin
      v_paid_at := nullif(p_payment->>'paid_at','')::date;
    exception when others then
      raise exception 'Data de pagamento inválida' using errcode='22023';
    end;
    v_paid_at := coalesce(v_paid_at, v_service_date);
    if v_paid_at > (now() at time zone 'America/Sao_Paulo')::date then
      raise exception 'A data de pagamento não pode ser futura' using errcode='22023';
    end if;
    update public.financial_entries
       set paid = true,
           paid_at = v_paid_at,
           payment_method = left(v_method,100)
     where id = v_billing and company_id = p_company;
  end if;

  -- 5. estoque: baixa oficial, idempotente, só para produto que controla estoque.
  for m in select value from jsonb_array_elements(coalesce(p_materials,'[]'::jsonb)) loop
    if coalesce(m->>'product_id','') = '' then continue; end if;
    v_product := (m->>'product_id')::uuid;
    v_qty := greatest(coalesce((m->>'quantity')::numeric,1),0.001);

    select p.track_stock into v_track from public.products p
     where p.id=v_product and p.company_id=p_company;
    -- Produto que não controla estoque não gera movimento: chamar o ajuste
    -- ligaria track_stock sem o usuário ter pedido isso.
    if not coalesce(v_track,false) then continue; end if;

    -- Pedido derivado do registro: retry do mesmo registro não baixa de novo.
    v_stock_request := md5(p_request::text||':'||v_product::text)::uuid;
    v_balance := public.zt_adjust_product_stock(
      p_company, v_product, -v_qty,
      'Serviço realizado em '||to_char(v_service_date,'DD/MM/YYYY')
        ||' · OS '||(select w.number from public.work_orders w where w.id=v_wo)
        ||' · registrado em '||to_char((now() at time zone 'America/Sao_Paulo')::date,'DD/MM/YYYY'),
      v_stock_request);
    v_moves := v_moves || jsonb_build_object(
      'product_id', v_product, 'quantity', v_qty, 'balance_after', v_balance);
  end loop;

  -- 6. o histórico distingue quando o serviço aconteceu e quando foi lançado.
  insert into public.work_order_reports(work_order_id, company_id, entry_type, body, author_id)
  values (v_wo, p_company, 'history',
    'Serviço realizado em '||to_char(v_service_date,'DD/MM/YYYY')
      ||coalesce(' às '||to_char(v_service_time,'HH24:MI'),'')
      ||' · registrado no sistema em '||to_char((now() at time zone 'America/Sao_Paulo')::date,'DD/MM/YYYY'),
    v_uid);

  return jsonb_build_object(
    'work_order_id', v_wo,
    'number', (select w.number from public.work_orders w where w.id=v_wo),
    'service_date', v_service_date,
    'completed_at', v_completed_at,
    'billing_entry_id', v_billing,
    'payment_status', v_payment_status,
    'stock_movements', v_moves,
    'replayed', false);
end;
$$;

revoke all on function public.zt_register_completed_work_order(uuid,uuid,jsonb,jsonb,jsonb,jsonb) from public,anon;
grant execute on function public.zt_register_completed_work_order(uuid,uuid,jsonb,jsonb,jsonb,jsonb) to authenticated,service_role;
