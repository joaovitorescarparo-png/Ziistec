-- Assistant Universal Owner V1 · escritas do proprietário que já têm caminho canônico no banco:
--   * gerar a OS de um orçamento aprovado (zt_create_work_order_from_quote, idempotente);
--   * ajustar estoque de um produto (zt_adjust_product_stock, com trava da linha);
--   * registrar garantia manual (zt_create_manual_warranty);
--   * concluir ou dispensar um pós-venda pendente (zt_update_post_sale_followup).
-- Forward-only sobre 0092–0096 (não as altera). Mesma máquina de estados das escritas anteriores:
-- zt_assistant_plan resolve e mostra a prévia sem gravar; zt_assistant_execute grava uma única vez
-- (requestId + previewHash), revalidando empresa, papel, assinatura e estado antes da RPC canônica.
-- Fora desta versão (sem caminho canônico ou exige fluxo próprio): aprovar orçamento, editar
-- cliente/local/produto/serviço/contrato, lançar compra, baixa financeira, venda em campo.

-- Contrato fechado das escritas novas, repetido na fronteira de autoridade.
create or replace function zt_private.assistant_validate_owner_write(p_action text,p_input jsonb)
returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare
  v_allowed text[]; v_required text[]; k text; v jsonb; t text; v_num numeric; v_out jsonb:='{}'::jsonb;
  v_uuid constant text:='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  if p_input is null or jsonb_typeof(p_input)<>'object' or octet_length(p_input::text)>8000 then
    raise exception 'Argumentos inválidos' using errcode='22023';
  end if;
  case p_action
    when 'owner_convert_quote_to_work_order' then v_allowed:=array['quote','date','time']; v_required:=array['quote'];
    when 'owner_adjust_stock' then v_allowed:=array['product','quantity','direction','notes']; v_required:=array['product','quantity','direction'];
    when 'owner_create_warranty' then v_allowed:=array['client','clientRef','kind','description','startsOn','months','endsOn','servicePlace','serial'];
      v_required:=array['client','kind','description'];
    when 'owner_update_post_sale' then v_allowed:=array['client','clientRef','status','date','note']; v_required:=array['client','status'];
    else raise exception 'Ação desconhecida' using errcode='22023';
  end case;
  if not p_input ?& v_required then raise exception 'Preencha os campos obrigatórios' using errcode='22023'; end if;
  for k,v in select * from jsonb_each(p_input) loop
    if not k=any(v_allowed) then raise exception 'Campo não permitido: %',k using errcode='22023'; end if;
    if k in ('quantity','months') then
      if jsonb_typeof(v)<>'number' then raise exception 'Valor numérico inválido' using errcode='22023'; end if;
      v_num:=(v::text)::numeric;
      if (k='quantity' and (v_num<=0 or v_num>100000 or v_num<>round(v_num,3)))
        or (k='months' and (v_num<1 or v_num>120 or v_num<>trunc(v_num))) then
        raise exception 'Valor fora dos limites' using errcode='22023';
      end if;
      v_out:=v_out||jsonb_build_object(k,case when k='months' then to_jsonb(v_num::integer) else to_jsonb(v_num::numeric(14,3)) end);
    else
      if jsonb_typeof(v)<>'string' then raise exception 'Texto inválido: %',k using errcode='22023'; end if;
      t:=btrim(p_input->>k);
      if k='clientRef' then
        if t !~ v_uuid then raise exception 'Escolha inválida' using errcode='22023'; end if;
      elsif k in ('date','startsOn','endsOn') then
        if t !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Data inválida' using errcode='22023'; end if;
        perform t::date;
      elsif k='time' then
        if t !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'Horário inválido' using errcode='22023'; end if;
      elsif k='direction' then
        if t not in ('in','out') then raise exception 'Direção do ajuste inválida' using errcode='22023'; end if;
      elsif k='kind' then
        if t not in ('product','service') then raise exception 'Tipo de garantia inválido' using errcode='22023'; end if;
      elsif k='status' then
        if t not in ('done','dismissed') then raise exception 'Situação do pós-venda inválida' using errcode='22023'; end if;
      elsif t='' or length(t)>(case k when 'description' then 500 when 'servicePlace' then 500 when 'notes' then 1000 when 'note' then 1000 when 'serial' then 200 else 120 end) then
        raise exception 'Texto vazio ou muito longo: %',k using errcode='22023';
      end if;
      v_out:=v_out||jsonb_build_object(k,t);
    end if;
  end loop;
  if p_action='owner_convert_quote_to_work_order' and v_out ? 'time' and not v_out ? 'date' then
    raise exception 'Informe a data junto com o horário' using errcode='22023';
  end if;
  if p_action='owner_create_warranty' and not v_out ?| array['months','endsOn'] then
    raise exception 'Informe o prazo ou a data final da garantia' using errcode='22023';
  end if;
  return v_out;
end $$;

-- Prévia: registro resolvido no tenant e estado conferido. {question[, options]} ou {resolved, preview}.
create or replace function zt_private.assistant_owner_write_plan(p_company uuid,p_action text,p_input jsonb)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare
  v_today date:=(now() at time zone 'America/Sao_Paulo')::date;
  q public.quotes%rowtype; p public.products%rowtype; v_id uuid; v_client jsonb; v_name text; v_wo text; v_total numeric(14,2);
  v_items integer; v_product jsonb; v_delta numeric(14,3); v_starts date; v_ends date; v_rows jsonb;
begin
  if p_action='owner_convert_quote_to_work_order' then
    v_id:=zt_private.assistant_doc_find(p_company,'quote',p_input->>'quote');
    if v_id is null then
      return jsonb_build_object('question',format('Não encontrei o orçamento "%s". Informe o número, por exemplo ORC-0003.',left(p_input->>'quote',40)));
    end if;
    select * into q from public.quotes where id=v_id and company_id=p_company;
    select w.number into v_wo from public.work_orders w where w.company_id=p_company and w.quote_id=q.id order by w.created_at limit 1;
    if v_wo is not null then
      return jsonb_build_object('question',format('O %s já originou a %s. Posso mostrar os detalhes dessa OS.',q.number,v_wo));
    end if;
    if q.status<>'approved' then
      return jsonb_build_object('question',format('O %s está %s. A OS só é gerada de orçamento aprovado: aprove-o na tela de orçamentos e peça de novo.',
        q.number,zt_private.assistant_quote_status(q.status::text)));
    end if;
    select c.name into v_name from public.clients c where c.id=q.client_id and c.company_id=p_company;
    select count(*),coalesce(sum(round(i.quantity*i.unit_price,2)),0) into v_items,v_total from public.quote_items i where i.quote_id=q.id and i.company_id=p_company;
    return jsonb_build_object('resolved',jsonb_strip_nulls(jsonb_build_object('quote',q.number,'quoteId',q.id,'client',v_name,'clientId',q.client_id,
        'date',p_input->>'date','time',p_input->>'time')),
      'preview',jsonb_build_array(
        jsonb_build_object('label','Orçamento','value',q.number),
        jsonb_build_object('label','Cliente','value',v_name),
        jsonb_build_object('label','Itens','value',v_items||' item(ns) do orçamento aprovado'),
        jsonb_build_object('label','Total aprovado','value',zt_private.assistant_money(round(greatest(0,v_total-q.discount+q.surcharge),2))),
        jsonb_build_object('label','Agendamento','value',coalesce(to_char((p_input->>'date')::date,'DD/MM/YYYY')||coalesce(' '||(p_input->>'time'),''),
          'sem data: a OS fica em aberto para agendar')),
        jsonb_build_object('label','Ação','value','Gerar a OS a partir do orçamento aprovado (valores aprovados preservados).')));

  elsif p_action='owner_adjust_stock' then
    v_product:=zt_private.assistant_read_product(p_company,p_input->>'product');
    if v_product ? 'question' then return v_product; end if;
    select * into p from public.products where id=(v_product#>>'{match,id}')::uuid and company_id=p_company and deleted_at is null;
    v_delta:=case when p_input->>'direction'='out' then -(p_input->>'quantity')::numeric else (p_input->>'quantity')::numeric end;
    if p.stock_qty+v_delta<0 then
      return jsonb_build_object('question',format('Estoque insuficiente: %s tem %s %s. Informe uma quantidade menor.',p.name,
        zt_private.assistant_qty(p.stock_qty),coalesce(nullif(p.unit,''),'unidade')));
    end if;
    return jsonb_build_object('resolved',jsonb_strip_nulls(jsonb_build_object('product',p.name,'productId',p.id,'quantity',(p_input->>'quantity')::numeric,
        'direction',p_input->>'direction','delta',v_delta,'stock',p.stock_qty,'notes',p_input->>'notes')),
      'preview',jsonb_build_array(
        jsonb_build_object('label','Produto','value',p.name),
        jsonb_build_object('label','Estoque atual','value',zt_private.assistant_qty(p.stock_qty)||' '||coalesce(nullif(p.unit,''),'unidade')
          ||case when not p.track_stock then ' (controle de estoque será ligado)' else '' end),
        jsonb_build_object('label','Ajuste','value',case when v_delta>0 then 'entrada de +' else 'saída de ' end||zt_private.assistant_qty(v_delta)),
        jsonb_build_object('label','Estoque após o ajuste','value',zt_private.assistant_qty(p.stock_qty+v_delta)||' '||coalesce(nullif(p.unit,''),'unidade')))
        ||case when p_input ? 'notes' then jsonb_build_array(jsonb_build_object('label','Observação','value',p_input->>'notes')) else '[]'::jsonb end);

  elsif p_action='owner_create_warranty' then
    v_client:=zt_private.assistant_read_client(p_company,p_input);
    if v_client ? 'question' then return v_client; end if;
    v_starts:=coalesce((p_input->>'startsOn')::date,v_today);
    v_ends:=coalesce((p_input->>'endsOn')::date,(v_starts+make_interval(months=>(p_input->>'months')::int))::date);
    if v_ends<v_starts then
      return jsonb_build_object('question','A data final da garantia precisa ser depois do início. Informe o prazo de novo.');
    end if;
    return jsonb_build_object('resolved',jsonb_strip_nulls(jsonb_build_object('client',v_client#>>'{match,name}','clientId',v_client#>>'{match,id}',
        'kind',p_input->>'kind','description',p_input->>'description','startsOn',v_starts,'endsOn',v_ends,
        'servicePlace',p_input->>'servicePlace','serial',p_input->>'serial')),
      'preview',jsonb_build_array(
        jsonb_build_object('label','Cliente','value',v_client#>>'{match,name}'),
        jsonb_build_object('label','Tipo','value',case p_input->>'kind' when 'product' then 'Produto' else 'Serviço' end),
        jsonb_build_object('label','Descrição','value',p_input->>'description'),
        jsonb_build_object('label','Vigência','value',to_char(v_starts,'DD/MM/YYYY')||' até '||to_char(v_ends,'DD/MM/YYYY')))
        ||case when p_input ? 'servicePlace' then jsonb_build_array(jsonb_build_object('label','Local','value',p_input->>'servicePlace')) else '[]'::jsonb end
        ||case when p_input ? 'serial' then jsonb_build_array(jsonb_build_object('label','Número de série','value',p_input->>'serial')) else '[]'::jsonb end);

  elsif p_action='owner_update_post_sale' then
    v_client:=zt_private.assistant_read_client(p_company,p_input);
    if v_client ? 'question' then return v_client; end if;
    select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'description',x.description,'dueOn',x.due_on) order by x.due_on,x.id),'[]'::jsonb) into v_rows
      from public.post_sale_followups x
     where x.company_id=p_company and x.client_id=(v_client#>>'{match,id}')::uuid and x.status='pending'
       and (not p_input ? 'date' or x.due_on=(p_input->>'date')::date);
    if jsonb_array_length(v_rows)=0 then
      return jsonb_build_object('question',format('Não há pós-venda pendente de %s%s.',v_client#>>'{match,name}',
        coalesce(' para '||to_char((p_input->>'date')::date,'DD/MM/YYYY'),'')));
    elsif jsonb_array_length(v_rows)>1 then
      return jsonb_build_object('question',format('%s tem mais de um pós-venda pendente: %s. Qual deles? Informe a data.',v_client#>>'{match,name}',
        (select string_agg(to_char((r->>'dueOn')::date,'DD/MM/YYYY')||' '||(r->>'description'),'; ') from (select r from jsonb_array_elements(v_rows) r limit 6) y)));
    end if;
    return jsonb_build_object('resolved',jsonb_strip_nulls(jsonb_build_object('client',v_client#>>'{match,name}','clientId',v_client#>>'{match,id}',
        'followupId',v_rows#>>'{0,id}','status',p_input->>'status','note',p_input->>'note','dueOn',v_rows#>>'{0,dueOn}')),
      'preview',jsonb_build_array(
        jsonb_build_object('label','Cliente','value',v_client#>>'{match,name}'),
        jsonb_build_object('label','Pós-venda','value',v_rows#>>'{0,description}'),
        jsonb_build_object('label','Previsto para','value',to_char((v_rows#>>'{0,dueOn}')::date,'DD/MM/YYYY')),
        jsonb_build_object('label','Ação','value',case when p_input->>'status'='done' then 'Concluir o pós-venda (registra no histórico da OS)' else 'Dispensar o pós-venda' end))
        ||case when p_input ? 'note' then jsonb_build_array(jsonb_build_object('label','Observação','value',p_input->>'note')) else '[]'::jsonb end);
  end if;
  raise exception 'Ação desconhecida' using errcode='22023';
end $$;

-- Confirmação: revalida o estado da prévia e grava pela RPC canônica. {id, type, number}.
create or replace function zt_private.assistant_owner_write_apply(p_company uuid,p_action text,p_input jsonb)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare v_id uuid; v_stock numeric(14,3);
begin
  if p_action='owner_convert_quote_to_work_order' then
    if not exists(select 1 from public.quotes q where q.id=(p_input->>'quoteId')::uuid and q.company_id=p_company and q.deleted_at is null and q.status='approved') then
      raise exception 'O orçamento mudou depois da prévia' using errcode='22023';
    end if;
    v_id:=public.zt_create_work_order_from_quote((p_input->>'quoteId')::uuid,null,(p_input->>'date')::date,(p_input->>'time')::time);
    return jsonb_build_object('id',v_id,'type','work_order');
  elsif p_action='owner_adjust_stock' then
    select p.stock_qty into v_stock from public.products p
     where p.id=(p_input->>'productId')::uuid and p.company_id=p_company and p.deleted_at is null for update;
    if not found or v_stock is distinct from (p_input->>'stock')::numeric then
      raise exception 'O estoque mudou depois da prévia' using errcode='22023';
    end if;
    perform public.zt_adjust_product_stock(p_company,(p_input->>'productId')::uuid,(p_input->>'delta')::numeric,
      coalesce(p_input->>'notes','Ajuste pelo Assistente'));
    return jsonb_build_object('id',(p_input->>'productId')::uuid,'type','product');
  elsif p_action='owner_create_warranty' then
    v_id:=public.zt_create_manual_warranty(p_company,(p_input->>'clientId')::uuid,p_input->>'kind',p_input->>'description',
      (p_input->>'startsOn')::date,(p_input->>'endsOn')::date,p_input->>'servicePlace',null,null,p_input->>'serial',null);
    return jsonb_build_object('id',(p_input->>'clientId')::uuid,'type','client');
  elsif p_action='owner_update_post_sale' then
    if not exists(select 1 from public.post_sale_followups f where f.id=(p_input->>'followupId')::uuid and f.company_id=p_company and f.status='pending') then
      raise exception 'O pós-venda mudou depois da prévia' using errcode='22023';
    end if;
    perform public.zt_update_post_sale_followup((p_input->>'followupId')::uuid,p_input->>'status',null,p_input->>'note');
    return jsonb_build_object('id',(p_input->>'clientId')::uuid,'type','client');
  end if;
  raise exception 'Ação não executável' using errcode='22023';
end $$;

create or replace function zt_private.assistant_audit(p_company uuid,p_request uuid,p_status text,p_code text default null,
  p_action text default null,p_input_hash bytea default null)
returns void language plpgsql security definer set search_path='' as $$
declare p zt_private.assistant_plans%rowtype;
begin
  -- Denied requests can only be attributed to the caller's own membership.
  -- Unknown tenants/unauthenticated callers are not materialized in this ledger.
  if auth.uid() is null or p_request is null or not exists(select 1 from public.company_members
    where company_id=p_company and user_id=auth.uid()) then return; end if;
  select * into p from zt_private.assistant_plans
    where company_id=p_company and actor_user_id=auth.uid() and request_id=p_request;
  insert into public.assistant_action_audit(company_id,actor_user_id,action,request_id,success,status,error_code,
    input_hash,preview_hash,preview_version,confirmed_at,confirmed_by,target_type,target_id)
  values(p_company,auth.uid(),case when p_action=any(array[
    'owner_today_schedule','owner_next_appointment','owner_find_client','owner_find_quote','owner_find_work_order','create_client','create_quote_draft',
    'create_work_order','schedule_work_order','create_product','create_financial_entry','technician_today_orders','technician_next_appointment',
    'owner_update_quote','owner_duplicate_quote','owner_archive_quote','owner_unschedule_work_order','owner_cancel_work_order','create_service','owner_find_product','owner_find_service',
    'owner_client_history','owner_work_order_details','owner_client_equipment','owner_client_warranties','owner_expiring_warranties',
    'owner_week_schedule','owner_day_schedule','owner_unscheduled_work_orders','owner_stock_level','owner_low_stock','owner_stock_movements',
    'owner_recent_purchases','owner_purchases_due','owner_product_purchases','owner_maintenance_contracts','owner_contracts_due',
    'owner_post_sale_due','owner_inactive_clients','owner_finance_summary','owner_receivables','owner_overdue_clients','owner_operational_report',
    'owner_convert_quote_to_work_order','owner_adjust_stock','owner_create_warranty','owner_update_post_sale',
    'technician_open_assigned_order','add_assigned_work_report','mark_assigned_order_pending','mark_assigned_order_return',
    'finalize_assigned_work_order']) then p_action else coalesce(p.action,'unresolved') end,p_request,p_status in ('read','succeeded'),p_status,p_code,
    coalesce(p_input_hash,p.input_hash),p.preview_hash,p.preview_version,p.confirmed_at,p.confirmed_by,
    p.result#>>'{result,entityType}',(p.result#>>'{result,id}')::uuid);
end $$;

create or replace function zt_private.assistant_authorize(p_company uuid,p_action text)
returns text language plpgsql security definer set search_path='' as $$
declare v_role text;
begin
  if auth.uid() is null then raise exception 'Sessão necessária' using errcode='28000'; end if;
  select m.role::text into v_role from public.company_members m
  where m.company_id=p_company and m.user_id=auth.uid() and m.status='active' for share;
  if v_role is null then raise exception 'Sem acesso ativo à empresa' using errcode='42501'; end if;
  if p_action = any(array['owner_today_schedule','owner_next_appointment','owner_find_client','owner_find_quote','owner_find_work_order',
    'create_client','create_quote_draft','create_work_order','schedule_work_order','create_product','create_financial_entry',
    'owner_update_quote','owner_duplicate_quote','owner_archive_quote','owner_unschedule_work_order','owner_cancel_work_order','create_service','owner_find_product','owner_find_service',
    'owner_client_history','owner_work_order_details','owner_client_equipment','owner_client_warranties','owner_expiring_warranties',
    'owner_week_schedule','owner_day_schedule','owner_unscheduled_work_orders','owner_stock_level','owner_low_stock','owner_stock_movements',
    'owner_recent_purchases','owner_purchases_due','owner_product_purchases','owner_maintenance_contracts','owner_contracts_due',
    'owner_post_sale_due','owner_inactive_clients','owner_finance_summary','owner_receivables','owner_overdue_clients','owner_operational_report',
    'owner_convert_quote_to_work_order','owner_adjust_stock','owner_create_warranty','owner_update_post_sale']) then
    if v_role<>'owner' then raise exception 'Ação exclusiva do proprietário' using errcode='42501'; end if;
  elsif p_action = any(array['technician_today_orders','technician_next_appointment','technician_open_assigned_order','add_assigned_work_report',
    'mark_assigned_order_pending','mark_assigned_order_return','finalize_assigned_work_order']) then
    if v_role<>'technician' then raise exception 'Ação exclusiva do técnico atribuído' using errcode='42501'; end if;
  else raise exception 'Ação desconhecida' using errcode='22023';
  end if;
  return v_role;
end $$;

create or replace function zt_private.assistant_validate(p_action text,p_input jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  v_allowed text[]; v_required text[]; k text; v jsonb; t text; v_out jsonb:=p_input;
  v_limit integer; v_num numeric;
begin
  -- Orçamento tem contrato próprio com itens; o catálogo é resolvido no plano.
  if p_action='create_quote_draft' then return zt_private.assistant_validate_quote(p_input); end if;
  if p_action in ('owner_update_quote','owner_duplicate_quote') then return zt_private.assistant_validate_quote_change(p_action,p_input); end if;
  if p_action in ('owner_convert_quote_to_work_order','owner_adjust_stock','owner_create_warranty','owner_update_post_sale') then return zt_private.assistant_validate_owner_write(p_action,p_input); end if;
  if p_input is null or jsonb_typeof(p_input)<>'object' or octet_length(p_input::text)>24000 then
    raise exception 'Argumentos inválidos' using errcode='22023';
  end if;
  case p_action
    when 'owner_today_schedule','technician_today_orders','owner_next_appointment','technician_next_appointment' then v_allowed:='{}'; v_required:='{}';
    when 'owner_find_client','owner_find_quote','owner_find_work_order','owner_find_product','owner_find_service' then v_allowed:=array['query']; v_required:=v_allowed;
    when 'technician_open_assigned_order' then v_allowed:=array['workOrder']; v_required:=v_allowed;
    when 'create_client' then v_allowed:=array['name','phone','address']; v_required:=array['name'];
    when 'create_product' then v_allowed:=array['name','unit','price']; v_required:=array['name','price'];
    when 'create_service' then v_allowed:=array['name','unit','price']; v_required:=array['name','price'];
    when 'owner_archive_quote' then v_allowed:=array['quote']; v_required:=v_allowed;
    when 'owner_unschedule_work_order','owner_cancel_work_order' then v_allowed:=array['workOrder','client','date']; v_required:='{}';
    when 'create_quote_draft' then v_allowed:=array['client','description','quantity','unit','unitPrice']; v_required:=array['client','description','quantity','unitPrice'];
    when 'create_work_order' then v_allowed:=array['client','description','address','date','time']; v_required:=array['client','description'];
    when 'schedule_work_order' then v_allowed:=array['workOrder','client','date','time']; v_required:=array['date','time'];
    when 'create_financial_entry' then v_allowed:=array['description','amount','dueDate','paid','paidAt','paymentMethod','client','category']; v_required:=array['description','amount','dueDate','paid'];
    when 'add_assigned_work_report' then v_allowed:=array['workOrder','report']; v_required:=v_allowed;
    when 'mark_assigned_order_pending' then v_allowed:=array['workOrder','note']; v_required:=v_allowed;
    when 'mark_assigned_order_return' then v_allowed:=array['workOrder','reason']; v_required:=v_allowed;
    when 'finalize_assigned_work_order' then v_allowed:=array['workOrder','report']; v_required:=array['workOrder'];
    else raise exception 'Ação desconhecida' using errcode='22023';
  end case;
  if not p_input ?& v_required then raise exception 'Preencha os campos obrigatórios' using errcode='22023'; end if;
  for k,v in select * from jsonb_each(p_input) loop
    if not k=any(v_allowed) then raise exception 'Campo não permitido: %',k using errcode='22023'; end if;
    if k=any(array['amount','quantity','price','unitPrice']) then
      if jsonb_typeof(v)<>'number' then raise exception 'Valor numérico inválido' using errcode='22023'; end if;
      v_num:=(v::text)::numeric;
      if v_num<0 or (k in ('amount','quantity') and v_num=0)
        or v_num>(case when k='quantity' then 10000 when k='amount' then 999999999.99 else 999999.99 end)
        or (k='quantity' and v_num<>round(v_num,3))
        or (k<>'quantity' and v_num<>round(v_num,2)) then
        raise exception 'Valor fora dos limites' using errcode='22023';
      end if;
      if k='quantity' then v_out:=jsonb_set(v_out,array[k],to_jsonb(v_num::numeric(12,3))); end if;
    elsif k='paid' then
      if jsonb_typeof(v)<>'boolean' then raise exception 'Situação de pagamento inválida' using errcode='22023'; end if;
    else
      if jsonb_typeof(v)<>'string' then raise exception 'Texto inválido: %',k using errcode='22023'; end if;
      t:=btrim(p_input->>k);
      v_limit:=case k when 'report' then 10000 when 'reason' then 3000 when 'note' then 3000
        when 'description' then case when p_action='create_work_order' then 2000 else 500 end
        when 'address' then 500 when 'name' then 200 when 'phone' then 40 when 'unit' then 50 else 120 end;
      if length(t)>v_limit or (t='' and (k=any(v_required) or k in ('unit','client','category','paidAt','paymentMethod'))) then
        raise exception 'Texto vazio ou muito longo: %',k using errcode='22023';
      end if;
      if k in ('date','dueDate','paidAt') then
        if t !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Data inválida' using errcode='22023'; end if;
        perform t::date;
      elsif k='time' and t !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
        raise exception 'Horário inválido' using errcode='22023';
      elsif k='paymentMethod' and t not in ('pix','cash','credit_card','debit_card','bank_transfer') then
        raise exception 'Forma de pagamento inválida' using errcode='22023';
      end if;
      v_out:=jsonb_set(v_out,array[k],to_jsonb(t));
    end if;
  end loop;
  if p_action='create_work_order' and (p_input ? 'date')<>(p_input ? 'time') then
    raise exception 'Informe data e horário juntos' using errcode='22023';
  end if;
  if p_action in ('schedule_work_order','owner_unschedule_work_order','owner_cancel_work_order') and (p_input ? 'workOrder')=(p_input ? 'client') then
    raise exception 'Informe somente cliente ou OS' using errcode='22023';
  end if;
  if p_action='create_financial_entry' then
    if (p_input->>'paid')::boolean then
      if not p_input ?& array['paidAt','paymentMethod'] then raise exception 'Informe a data e a forma do recebimento' using errcode='22023'; end if;
    elsif p_input ?| array['paidAt','paymentMethod'] then raise exception 'Receita pendente não possui recebimento' using errcode='22023';
    end if;
    v_out:=jsonb_set(v_out,'{category}',to_jsonb(coalesce(v_out->>'category','Serviços')));
  end if;
  if p_action in ('create_quote_draft','create_product','create_service') then v_out:=jsonb_set(v_out,'{unit}',to_jsonb(coalesce(v_out->>'unit','unidade'))); end if;
  return v_out;
end $$;

create or replace function public.zt_assistant_plan(p_company uuid,p_action text,p_input jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_role text; v_input jsonb; v_hash bytea; v_plan zt_private.assistant_plans%rowtype;
  v_target uuid; v_client uuid; v_preview jsonb:='[]'; v_items jsonb; v_result jsonb; k text; t text; v_preview_hash text; v_ids uuid[];
  v_quote jsonb; v_line jsonb; v_pos bigint;
  v_today date:=(now() at time zone 'America/Sao_Paulo')::date;
begin
  -- Bounded digest for denied attempts too; no raw input is written to audit.
  if p_input is not null and octet_length(p_input::text)<=24000 then
    v_hash:=sha256(convert_to(p_input::text,'UTF8'));
  end if;
  v_role:=zt_private.assistant_authorize(p_company,p_action);
  perform zt_private.assistant_subscription(p_company);
  if p_request_id is null then raise exception 'Identificador da tentativa obrigatório' using errcode='22023'; end if;
  v_input:=zt_private.assistant_validate(p_action,p_input);
  v_hash:=sha256(convert_to(p_action||':'||v_input::text,'UTF8'));
  perform pg_advisory_xact_lock(hashtextextended(p_company::text||':'||auth.uid()::text||':'||p_request_id::text,0));
  select * into v_plan from zt_private.assistant_plans where company_id=p_company and actor_user_id=auth.uid() and request_id=p_request_id for update;
  if found then
    if v_plan.action<>p_action or v_plan.input_hash<>v_hash then raise exception 'Identificador já usado em outra ação' using errcode='23505'; end if;
    perform zt_private.assistant_target(p_company,p_action,v_plan.target_id,true);
    if v_plan.state='expired' or (v_plan.state='pending' and v_plan.expires_at<=clock_timestamp()) then
      update zt_private.assistant_plans set input=null,preview=null,state='expired'
        where company_id=p_company and actor_user_id=auth.uid() and request_id=p_request_id;
      perform zt_private.assistant_audit(p_company,p_request_id,'expired','PLAN_EXPIRED');
      return jsonb_build_object('error','Prévia expirada. Prepare uma nova ação.','code','PLAN_EXPIRED');
    end if;
    if v_plan.state<>'pending' then return v_plan.result; end if;
    return jsonb_build_object('requestId',p_request_id,'action',p_action,'input',v_plan.input,'preview',v_plan.preview,
      'previewHash',v_plan.preview_hash,'previewVersion',v_plan.preview_version,'confirmationRequired',true);
  end if;
  if p_action in ('owner_today_schedule','technician_today_orders','owner_find_work_order','technician_open_assigned_order','owner_next_appointment','technician_next_appointment') then
    if p_action='technician_open_assigned_order' then v_target:=zt_private.assistant_resolve(p_company,'work_order',v_input->>'workOrder',true); end if;
    select coalesce(jsonb_agg(q.item),'[]') into v_items from (
      select jsonb_build_object('id',w.id,'entityType','work_order','number',w.number,'title',w.number,
        'client',c.name,'date',w.scheduled_date,'time',w.scheduled_time,
        'detail',concat_ws(' · ',c.name,w.scheduled_date::text,w.scheduled_time::text,w.status::text,w.address,w.request)) item
      from public.work_orders w left join public.clients c on c.id=w.client_id and c.company_id=w.company_id
      where w.company_id=p_company and w.deleted_at is null
        and (v_role='owner' or w.assigned_to=auth.uid())
        and (case when p_action in ('owner_today_schedule','technician_today_orders') then w.scheduled_date=v_today and w.status not in ('done','canceled')
          when p_action in ('owner_next_appointment','technician_next_appointment') then w.status not in ('done','canceled')
            and w.scheduled_date is not null and w.scheduled_time is not null
            and w.scheduled_date+w.scheduled_time >= (now() at time zone 'America/Sao_Paulo')
          when p_action='technician_open_assigned_order' then w.id=v_target
          else w.id::text=v_input->>'query' or position(lower(v_input->>'query') in lower(w.number))>0 end)
      order by w.scheduled_date,w.scheduled_time,w.number limit (case when p_action in ('owner_next_appointment','technician_next_appointment') then 1 else 20 end)
    ) q;
  elsif p_action='owner_find_client' then
    select coalesce(jsonb_agg(q.item),'[]') into v_items from (
      select jsonb_build_object('id',c.id,'entityType','client','title',c.name,'phone',nullif(c.phone,''),'whatsapp',nullif(c.whatsapp,''),'detail',concat_ws(' · ',c.phone,c.address)) item
      from public.clients c where c.company_id=p_company and c.deleted_at is null
        and (c.id::text=v_input->>'query' or position(lower(v_input->>'query') in lower(concat_ws(' ',c.name,c.trade_name)))>0)
      order by c.name limit 20
    ) q;
  elsif p_action='owner_find_quote' then
    select coalesce(jsonb_agg(q.item),'[]') into v_items from (
      select jsonb_build_object('id',q.id,'entityType','quote','number',q.number,'title',q.number,'detail',q.status::text) item
      from public.quotes q where q.company_id=p_company and q.deleted_at is null
        and (q.id::text=v_input->>'query' or position(lower(v_input->>'query') in lower(q.number))>0)
      order by q.created_at desc limit 20
    ) q;
  elsif p_action in ('owner_find_product','owner_find_service') then
    -- Catálogo do próprio tenant por nome; preço de venda sim, custo nunca.
    select coalesce(jsonb_agg(q.item),'[]') into v_items from (
      select jsonb_build_object('id',p.id,'entityType','product','title',p.name,'detail',concat_ws(' · ',nullif(concat_ws(' ',p.brand,p.model),''),
          zt_private.assistant_money(p.price),case when not p.active then 'inativo' end)) item
        from public.products p
       where p_action='owner_find_product' and p.company_id=p_company and p.deleted_at is null
         and (position(zt_private.assistant_fold(v_input->>'query') in zt_private.assistant_fold(concat_ws(' ',p.name,p.brand,p.model)))>0
           or zt_private.assistant_name_matches(concat_ws(' ',p.name,p.brand,p.model),v_input->>'query'))
      union all
      select jsonb_build_object('id',s.id,'entityType','service','title',s.name,'detail',concat_ws(' · ',nullif(s.category,''),
          zt_private.assistant_money(s.price),case when not s.active then 'inativo' end)) item
        from public.services s
       where p_action='owner_find_service' and s.company_id=p_company and s.deleted_at is null
         and (position(zt_private.assistant_fold(v_input->>'query') in zt_private.assistant_fold(concat_ws(' ',s.name,s.category)))>0
           or zt_private.assistant_name_matches(concat_ws(' ',s.name,s.category),v_input->>'query'))
      limit 20
    ) q;
  end if;
  if v_items is not null then
    insert into public.assistant_action_audit(company_id,actor_user_id,action,request_id,success,status,input_hash)
      values(p_company,auth.uid(),p_action,p_request_id,true,'read',v_hash);
    return jsonb_build_object('requestId',p_request_id,'action',p_action,'confirmationRequired',false,
      'result',jsonb_build_object('items',v_items,'message',case when jsonb_array_length(v_items)=0 then 'Nenhum registro encontrado para esta consulta.' else 'Consulta concluída.' end));
  end if;
  perform zt_private.assistant_subscription(p_company);
  if p_action='create_quote_draft' then
    -- Orçamento: cliente, produtos e serviços resolvidos no catálogo do tenant; ambiguidade vira pergunta.
    v_quote:=zt_private.assistant_quote_resolve(p_company,v_input);
    if v_quote ? 'question' then
      perform zt_private.assistant_audit(p_company,p_request_id,'denied','CLARIFICATION',p_action,v_hash);
      return jsonb_strip_nulls(jsonb_build_object('question',v_quote->>'question','options',v_quote->'options','action',p_action,'draft',v_input));
    end if;
    v_input:=v_quote->'resolved';
    v_client:=(v_input->>'clientId')::uuid;
    v_preview:=jsonb_build_array(jsonb_build_object('label','Cliente','value',v_input->>'client'));
    for v_line,v_pos in select value,ordinality from jsonb_array_elements(v_input->'items') with ordinality loop
      v_preview:=v_preview||jsonb_build_array(jsonb_build_object('label','Item '||v_pos,'value',format('%s × %s — %s cada = %s · %s',
        zt_private.assistant_qty((v_line->>'quantity')::numeric),v_line->>'name',zt_private.assistant_money((v_line->>'unitPrice')::numeric),
        zt_private.assistant_money(round((v_line->>'quantity')::numeric*(v_line->>'unitPrice')::numeric,2)),
        case when v_line->>'origin'='catalog' then 'preço do catálogo'
          when v_line->>'kind'='free' then 'item livre, preço informado'
          else 'preço informado (catálogo: '||zt_private.assistant_money((v_line->>'catalogPrice')::numeric)||')' end)));
    end loop;
    v_preview:=v_preview||jsonb_build_array(jsonb_build_object('label','Subtotal','value',zt_private.assistant_money((v_input->>'subtotal')::numeric)));
    if (v_input->>'discount')::numeric>0 then
      v_preview:=v_preview||jsonb_build_array(jsonb_build_object('label','Desconto','value',zt_private.assistant_money((v_input->>'discount')::numeric)));
    end if;
    if (v_input->>'surcharge')::numeric>0 then
      v_preview:=v_preview||jsonb_build_array(jsonb_build_object('label','Acréscimo','value',zt_private.assistant_money((v_input->>'surcharge')::numeric)));
    end if;
    v_preview:=v_preview||jsonb_build_array(jsonb_build_object('label','Total','value',zt_private.assistant_money((v_input->>'total')::numeric)));
    if v_input ? 'notes' then v_preview:=v_preview||jsonb_build_array(jsonb_build_object('label','Observações','value',v_input->>'notes')); end if;
    if v_input ? 'servicePlace' then v_preview:=v_preview||jsonb_build_array(jsonb_build_object('label','Local do serviço','value',v_input->>'servicePlace')); end if;
  elsif p_action in ('owner_update_quote','owner_duplicate_quote','owner_archive_quote') then
    -- Documento citado pelo número, revalidado na empresa e no estado; ambiguidade ou bloqueio vira pergunta.
    v_quote:=zt_private.assistant_quote_change(p_company,p_action,v_input);
    if v_quote ? 'question' then
      perform zt_private.assistant_audit(p_company,p_request_id,'denied','CLARIFICATION',p_action,v_hash);
      return jsonb_strip_nulls(jsonb_build_object('question',v_quote->>'question','options',v_quote->'options','action',p_action,'draft',v_input));
    end if;
    v_input:=v_quote->'resolved'; v_preview:=v_quote->'preview';
    v_client:=nullif(v_input->>'clientId','')::uuid;
  elsif p_action in ('owner_convert_quote_to_work_order','owner_adjust_stock','owner_create_warranty','owner_update_post_sale') then
    -- Escrita canônica do proprietário (0097): prévia resolvida no tenant, sem gravar nada.
    v_quote:=zt_private.assistant_owner_write_plan(p_company,p_action,v_input);
    if v_quote ? 'question' then
      perform zt_private.assistant_audit(p_company,p_request_id,'denied','CLARIFICATION',p_action,v_hash);
      return jsonb_strip_nulls(jsonb_build_object('question',v_quote->>'question','options',v_quote->'options','action',p_action,
        'draft',case when v_quote ? 'options' then v_input end));
    end if;
    v_input:=v_quote->'resolved'; v_preview:=v_quote->'preview';
    v_client:=nullif(v_input->>'clientId','')::uuid;
  elsif p_action in ('owner_unschedule_work_order','owner_cancel_work_order') then
    -- OS por número ou cliente (+data); tirar da agenda nunca encerra a OS e cancelar nunca vira desagendar.
    v_quote:=zt_private.assistant_wo_change(p_company,p_action,v_input);
    if v_quote ? 'question' then
      perform zt_private.assistant_audit(p_company,p_request_id,'denied','CLARIFICATION',p_action,v_hash);
      return jsonb_build_object('question',v_quote->>'question','action',p_action);
    end if;
    v_target:=(v_quote->>'targetId')::uuid;
    perform zt_private.assistant_target(p_company,p_action,v_target);
    v_preview:=v_quote->'preview';
  else
  if v_input ? 'client' then v_client:=zt_private.assistant_resolve(p_company,'client',v_input->>'client'); end if;
  if p_action='schedule_work_order' and v_client is not null then
    select array_agg(w.id order by w.id) into v_ids from public.work_orders w
      where w.company_id=p_company and w.client_id=v_client and w.deleted_at is null and w.status not in ('done','canceled');
    if coalesce(cardinality(v_ids),0)<>1 then
      perform zt_private.assistant_audit(p_company,p_request_id,'denied','INVALID_INPUT',p_action,v_hash);
      return jsonb_build_object('question',case when coalesce(cardinality(v_ids),0)=0
        then 'Esse cliente não possui OS aberta. Deseja criar uma OS? Informe o serviço.'
        else 'Esse cliente possui mais de uma OS aberta. Qual número de OS deseja agendar?' end);
    end if;
    v_target:=v_ids[1];
    perform zt_private.assistant_target(p_company,p_action,v_target);
    select number into t from public.work_orders where id=v_target;
    v_preview:=v_preview||jsonb_build_array(jsonb_build_object('label','OS','value',t));
  end if;
  if v_input ? 'workOrder' then
    v_target:=zt_private.assistant_resolve(p_company,'work_order',v_input->>'workOrder',v_role='technician');
    perform zt_private.assistant_target(p_company,p_action,v_target);
    select number into t from public.work_orders where id=v_target;
    v_preview:=v_preview||jsonb_build_array(jsonb_build_object('label','OS','value',t));
  end if;
  if v_client is not null then
    select name into t from public.clients where id=v_client;
    v_preview:=v_preview||jsonb_build_array(jsonb_build_object('label','Cliente','value',t));
  end if;
  for k,t in select key,value from jsonb_each_text(v_input) where key not in ('client','workOrder') order by key loop
    v_preview:=v_preview||jsonb_build_array(jsonb_build_object('label',case k
      when 'name' then 'Nome' when 'phone' then 'Telefone' when 'address' then 'Endereço'
      when 'description' then 'Descrição' when 'quantity' then 'Quantidade' when 'unit' then 'Unidade'
      when 'unitPrice' then 'Preço unitário (R$)' when 'price' then 'Preço de venda (R$)'
      when 'amount' then 'Receita (R$)' when 'dueDate' then 'Vencimento' when 'paidAt' then 'Recebido em'
      when 'paid' then 'Recebido' when 'paymentMethod' then 'Forma de pagamento' when 'category' then 'Categoria'
      when 'date' then 'Data (São Paulo)' when 'time' then 'Horário (São Paulo)' when 'report' then 'Relato'
      when 'note' then 'Pendência' when 'reason' then 'Motivo do retorno' else k end,'value',t));
  end loop;
  if p_action='create_work_order' then
    select coalesce(nullif(p.full_name,''),'Você') into t from public.profiles p where p.id=auth.uid();
    v_preview:=v_preview||jsonb_build_array(jsonb_build_object('label','Responsável','value',coalesce(t,'Você')));
  end if;
  end if;
  -- Versioned digest binds normalized values AND resolved records/display snapshot.
  v_preview_hash:=encode(sha256(convert_to(jsonb_build_object('version',1,'company',p_company,'actor',auth.uid(),
    'request',p_request_id,'action',p_action,'input',v_input,'target',v_target,'client',v_client,'preview',v_preview)::text,'UTF8')),'hex');
  insert into zt_private.assistant_plans(company_id,actor_user_id,request_id,action,input_hash,input,preview,target_id,client_id,preview_hash)
  values(p_company,auth.uid(),p_request_id,p_action,v_hash,v_input,v_preview,v_target,v_client,v_preview_hash);
  perform zt_private.assistant_audit(p_company,p_request_id,'prepared');
  return jsonb_build_object('requestId',p_request_id,'action',p_action,'input',v_input,'preview',v_preview,
    'previewHash',v_preview_hash,'previewVersion',1,'confirmationRequired',true);
exception when others then
  -- This handler is outside the rolled-back body; denied attempts can persist.
  perform zt_private.assistant_audit(p_company,p_request_id,'denied',zt_private.assistant_error_code(sqlstate),p_action,v_hash);
  return jsonb_build_object('error','Não foi possível preparar a ação. Verifique os dados e o acesso.',
    'code',zt_private.assistant_error_code(sqlstate));
end $$;

create or replace function public.zt_assistant_execute(p_company uuid,p_request_id uuid,p_preview_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  p zt_private.assistant_plans%rowtype; x jsonb; v_id uuid; v_type text; v_number text; v_result jsonb;
  v_today date:=(now() at time zone 'America/Sao_Paulo')::date;
begin
  if auth.uid() is null then raise exception 'Sessão necessária' using errcode='28000'; end if;
  select * into p from zt_private.assistant_plans where company_id=p_company and actor_user_id=auth.uid() and request_id=p_request_id for update;
  if not found then raise exception 'Prévia não encontrada' using errcode='42501'; end if;
  perform zt_private.assistant_authorize(p_company,p.action);
  perform zt_private.assistant_subscription(p_company);
  perform zt_private.assistant_target(p_company,p.action,p.target_id,true);
  if p_preview_hash is null or p_preview_hash !~ '^[0-9a-f]{64}$' or p_preview_hash<>p.preview_hash then
    raise exception 'Confirmação não corresponde à prévia' using errcode='22023';
  end if;
  if p.state in ('succeeded','failed') then return p.result; end if;
  if p.state='expired' or p.expires_at<=clock_timestamp() then
    update zt_private.assistant_plans set input=null,preview=null,state='expired' where company_id=p_company and actor_user_id=auth.uid() and request_id=p_request_id;
    perform zt_private.assistant_audit(p_company,p_request_id,'expired','PLAN_EXPIRED');
    return jsonb_build_object('error','Prévia expirada. Prepare uma nova ação.','code','PLAN_EXPIRED');
  end if;
  update zt_private.assistant_plans set confirmed_at=clock_timestamp(),confirmed_by=auth.uid()
    where company_id=p_company and actor_user_id=auth.uid() and request_id=p_request_id;
  -- Catch inside a subtransaction: any partial canonical write rolls back before audit persists.
  begin
    perform zt_private.assistant_target(p_company,p.action,p.target_id);
    if p.client_id is not null and not exists(select 1 from public.clients where id=p.client_id and company_id=p_company and deleted_at is null) then
      raise exception 'Cliente não está mais disponível' using errcode='42501';
    end if;
    if p.action not in ('create_quote_draft','owner_update_quote','owner_duplicate_quote','owner_archive_quote','owner_convert_quote_to_work_order','owner_adjust_stock','owner_create_warranty','owner_update_post_sale') then x:=zt_private.assistant_validate(p.action,p.input); end if;
    case p.action
      when 'create_client' then
        insert into public.clients(company_id,name,phone,address) values(p_company,x->>'name',nullif(x->>'phone',''),nullif(x->>'address','')) returning id into v_id;
        v_type:='client';
      when 'create_product' then
        insert into public.products(company_id,name,unit,price,cost,active) values(p_company,x->>'name',x->>'unit',(x->>'price')::numeric,0,true) returning id into v_id;
        v_type:='product';
      when 'create_quote_draft' then
        -- Same lock as the canonical RPC: an occupied internal key fails closed.
        perform pg_advisory_xact_lock(hashtextextended(p_company::text||':quote:'||p.operation_id::text,0));
        if exists(select 1 from public.quotes where company_id=p_company and client_request_id=p.operation_id) then
          raise exception 'Colisão de operação interna' using errcode='23505';
        end if;
        -- Itens confirmados: catálogo conferido de novo, com o preço exatamente da prévia.
        x:=zt_private.assistant_quote_items(p_company,p.input);
        v_id:=public.zt_save_quote_idempotent(p_company,null,p.operation_id,
          jsonb_strip_nulls(jsonb_build_object('client_id',p.client_id,'status','draft','issue_date',v_today,
            'discount',p.input->'discount','surcharge',p.input->'surcharge','notes',p.input->>'notes','service_place',p.input->>'servicePlace')),x);
        select number into v_number from public.quotes where id=v_id; v_type:='quote';
      when 'owner_update_quote','owner_duplicate_quote','owner_archive_quote' then
        -- Documento revalidado (empresa, estado, versão da prévia, catálogo) e gravado pelo caminho canônico.
        v_id:=zt_private.assistant_quote_apply(p_company,p.action,p.operation_id,p.client_id,p.input);
        select number into v_number from public.quotes where id=v_id; v_type:='quote';
      when 'owner_convert_quote_to_work_order','owner_adjust_stock','owner_create_warranty','owner_update_post_sale' then
        -- Estado da prévia revalidado e gravado pela RPC canônica da tela (0097).
        x:=zt_private.assistant_owner_write_apply(p_company,p.action,p.input);
        v_id:=(x->>'id')::uuid; v_type:=x->>'type';
      when 'owner_unschedule_work_order' then
        -- Sai da agenda sem apagar nem encerrar a OS (mesma regra do app).
        update public.work_orders set scheduled_date=null,scheduled_time=null,status='unscheduled',updated_at=now()
         where id=p.target_id and company_id=p_company and status='scheduled';
        if not found then raise exception 'Somente OS agendada pode sair da agenda' using errcode='22023'; end if;
        v_id:=p.target_id; v_type:='work_order';
      when 'owner_cancel_work_order' then
        update public.work_orders set status='canceled',updated_at=now()
         where id=p.target_id and company_id=p_company and status in ('unscheduled','scheduled','in_progress');
        if not found then raise exception 'OS não pode ser cancelada' using errcode='22023'; end if;
        v_id:=p.target_id; v_type:='work_order';
      when 'create_service' then
        insert into public.services(company_id,name,unit,price,cost,active) values(p_company,x->>'name',x->>'unit',(x->>'price')::numeric,0,true) returning id into v_id;
        v_type:='service';
      when 'create_work_order' then
        perform pg_advisory_xact_lock(hashtextextended(p_company::text||':work_order:'||p.operation_id::text,0));
        if exists(select 1 from public.work_orders where company_id=p_company and client_request_id=p.operation_id) then
          raise exception 'Colisão de operação interna' using errcode='23505';
        end if;
        v_id:=public.zt_save_work_order_idempotent(p_company,null,p.operation_id,
          jsonb_build_object('client_id',p.client_id,'request',x->>'description','address',x->>'address','assigned_to',auth.uid(),
            'scheduled_date',x->>'date','scheduled_time',x->>'time','status',case when x ? 'date' then 'scheduled' else 'unscheduled' end),'[]');
        select number into v_number from public.work_orders where id=v_id; v_type:='work_order';
      when 'create_financial_entry' then
        perform pg_advisory_xact_lock(hashtextextended(p_company::text||':financial:'||p.operation_id::text,0));
        if exists(select 1 from public.financial_entries where company_id=p_company and client_request_id=p.operation_id) then
          raise exception 'Colisão de operação interna' using errcode='23505';
        end if;
        v_id:=public.zt_save_manual_financial_entry(p_company,null,p.operation_id,jsonb_build_object(
          'kind','income','description',x->>'description','amount',(x->>'amount')::numeric,'due_date',x->>'dueDate',
          'paid',(x->>'paid')::boolean,'paid_at',x->>'paidAt','payment_method',x->>'paymentMethod','category',x->>'category','client_id',p.client_id));
        v_type:='financial_entry';
      when 'schedule_work_order' then
        update public.work_orders set scheduled_date=(x->>'date')::date,scheduled_time=(x->>'time')::time,status='scheduled',updated_at=now() where id=p.target_id and company_id=p_company;
        v_id:=p.target_id; v_type:='work_order';
      when 'add_assigned_work_report' then
        insert into public.work_order_reports(company_id,work_order_id,entry_type,body,author_id) values(p_company,p.target_id,'report',x->>'report',auth.uid());
        v_id:=p.target_id; v_type:='work_order';
      when 'mark_assigned_order_pending' then
        update public.work_orders set pending_note=x->>'note',updated_at=now() where id=p.target_id and company_id=p_company;
        v_id:=p.target_id; v_type:='work_order';
      when 'mark_assigned_order_return' then
        -- assistant_target already holds the canonical work-order row lock.
        if exists(select 1 from public.work_order_returns where company_id=p_company and request_id=p.operation_id) then
          raise exception 'Colisão de operação interna' using errcode='23505';
        end if;
        perform public.zt_mark_work_order_needs_return(p.target_id,x->>'reason',null,null,'normal',null,p.operation_id);
        v_id:=p.target_id; v_type:='work_order';
      when 'finalize_assigned_work_order' then
        perform public.zt_finalize_work_order_with_warranty_overrides(p.target_id,nullif(x->>'report',''),null,null,7,'[]','[]',null);
        v_id:=p.target_id; v_type:='work_order';
      else raise exception 'Ação não executável' using errcode='22023';
    end case;
    if v_type='work_order' then select number into v_number from public.work_orders where id=v_id; end if;
    v_result:=jsonb_build_object('result',jsonb_build_object('entityType',v_type,'id',v_id,'number',v_number,'message','Ação concluída.'));
  exception when others then
    -- Do not expose database details, raw input or financial state in errors/audit.
    v_result:=jsonb_build_object('error','Não foi possível executar a ação. Confira o registro e prepare uma nova tentativa.',
      'code',zt_private.assistant_error_code(sqlstate));
  end;
  update zt_private.assistant_plans set input=null,preview=null,result=v_result,
    state=case when v_result ? 'error' then 'failed' else 'succeeded' end
    where company_id=p_company and actor_user_id=auth.uid() and request_id=p_request_id;
  perform zt_private.assistant_audit(p_company,p_request_id,case when v_result ? 'error' then 'failed' else 'succeeded' end,v_result->>'code');
  return v_result;
exception when others then
  perform zt_private.assistant_audit(p_company,p_request_id,'denied',zt_private.assistant_error_code(sqlstate));
  return jsonb_build_object('error','Não foi possível confirmar a ação. Verifique a prévia e o acesso.',
    'code',zt_private.assistant_error_code(sqlstate));
end $$;

create or replace function public.zt_assistant_plan_context(p_company uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p zt_private.assistant_plans%rowtype; v jsonb;
begin
  if auth.uid() is null then raise exception 'Sessão necessária' using errcode='28000'; end if;
  select * into p from zt_private.assistant_plans
   where company_id=p_company and actor_user_id=auth.uid() and request_id=p_request_id;
  if not found or p.state<>'pending' or p.expires_at<=clock_timestamp() or p.input is null then
    return jsonb_build_object('error','Não há prévia pendente para ajustar. Faça um novo pedido.','code','PLAN_EXPIRED');
  end if;
  perform zt_private.assistant_authorize(p_company,p.action);
  perform zt_private.assistant_subscription(p_company);
  if p.action='create_quote_draft' then
    v:=jsonb_strip_nulls(jsonb_build_object('client',p.input->>'client',
      'items',(select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('kind',i->>'kind','name',i->>'name',
          'quantity',(i->>'quantity')::numeric,'unit',i->>'unit',
          'unitPrice',case when i->>'origin'='informed' then (i->>'unitPrice')::numeric end)) order by o)
        from jsonb_array_elements(p.input->'items') with ordinality as e(i,o)),
      'discount',nullif((p.input->>'discount')::numeric,0),'surcharge',nullif((p.input->>'surcharge')::numeric,0),
      'notes',p.input->>'notes','servicePlace',p.input->>'servicePlace'));
  elsif p.action in ('owner_update_quote','owner_duplicate_quote') then
    -- Só número do documento, nomes, quantidades e valores ditos; nada de IDs ou custo.
    v:=jsonb_strip_nulls(jsonb_build_object('quote',p.input->>'quote',
      'client',case when p.action='owner_duplicate_quote' then p.input->>'client' end,'prices',p.input->>'prices',
      'items',(select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('kind',i->>'kind','name',i->>'name',
          'quantity',(i->>'quantity')::numeric,'unit',i->>'unit',
          'unitPrice',case when i->>'origin'='informed' then (i->>'unitPrice')::numeric end)) order by o)
        from jsonb_array_elements(p.input->'items') with ordinality as e(i,o)),
      'discount',nullif((p.input->>'discount')::numeric,0),'surcharge',nullif((p.input->>'surcharge')::numeric,0),
      'notes',p.input->>'notes'));
  elsif p.action in ('owner_convert_quote_to_work_order','owner_adjust_stock','owner_create_warranty','owner_update_post_sale') then
    v:=p.input-'quoteId'-'productId'-'clientId'-'followupId'-'stock'-'delta';
  elsif p.action='owner_archive_quote' then
    v:=jsonb_build_object('quote',p.input->>'quote');
  else
    v:=p.input;
  end if;
  return jsonb_build_object('action',p.action,'input',v);
exception when others then
  return jsonb_build_object('error','Não foi possível recuperar a prévia.','code',zt_private.assistant_error_code(sqlstate));
end $$;

revoke all on function zt_private.assistant_validate_owner_write(text,jsonb) from public,anon,authenticated;
revoke all on function zt_private.assistant_owner_write_plan(uuid,text,jsonb) from public,anon,authenticated;
revoke all on function zt_private.assistant_owner_write_apply(uuid,text,jsonb) from public,anon,authenticated;
revoke all on function zt_private.assistant_audit(uuid,uuid,text,text,text,bytea) from public,anon,authenticated;
revoke all on function zt_private.assistant_authorize(uuid,text) from public,anon,authenticated;
revoke all on function zt_private.assistant_validate(text,jsonb) from public,anon,authenticated;
revoke all on function public.zt_assistant_plan(uuid,text,jsonb,uuid) from public,anon;
revoke all on function public.zt_assistant_execute(uuid,uuid,text) from public,anon;
revoke all on function public.zt_assistant_plan_context(uuid,uuid) from public,anon;
grant execute on function public.zt_assistant_plan(uuid,text,jsonb,uuid) to authenticated;
grant execute on function public.zt_assistant_execute(uuid,uuid,text) to authenticated;
grant execute on function public.zt_assistant_plan_context(uuid,uuid) to authenticated;
