-- Assistant Universal Owner V1 · consultas do proprietário: histórico do cliente, detalhe da OS,
-- agenda, estoque, compras, garantias, contratos, pós-venda, financeiro e relatório operacional.
-- Forward-only sobre 0092–0095 (não as altera; 0095 já está no Staging).
--
-- public.zt_assistant_read é a única entrada destas consultas. Ela confere papel (somente owner),
-- membership ativa, assinatura e o contrato fechado de cada consulta; filtra tudo por company_id,
-- ordena e limita no banco e audita como 'read'. Nada além da auditoria é gravado.
-- O resultado vai só para a tela do proprietário: o provedor de IA nunca recebe estes dados.
-- Custo e margem de produto/serviço nunca saem daqui; compras mostram o total da nota, que é o
-- próprio documento da compra. O financeiro segue as definições da tela FinanceV2.

-- Cliente citado pelo nome (ou escolhido numa pergunta anterior): {match} ou {question[, options]}.
create or replace function zt_private.assistant_read_client(p_company uuid,p_input jsonb)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_match jsonb; v_name text:=nullif(btrim(coalesce(p_input->>'client','')),'');
begin
  if v_name is null and p_input->>'clientRef' is null then
    return jsonb_build_object('question','Qual cliente? Informe o nome.');
  end if;
  v_match:=zt_private.assistant_match(p_company,'client',coalesce(v_name,''),nullif(p_input->>'clientRef','')::uuid);
  if v_match ? 'options' then
    return jsonb_build_object('question',format('Encontrei mais de um cliente para "%s". Qual deles?',left(coalesce(v_name,''),80)),
      'options',(select jsonb_agg(jsonb_build_object('label',o->>'label','slot','client','ref',o->>'id')) from jsonb_array_elements(v_match->'options') o));
  elsif v_match ? 'none' then
    return jsonb_build_object('question',format('Não encontrei o cliente "%s". Confira o nome.',left(coalesce(v_name,'escolhido'),80)));
  end if;
  return v_match;
end $$;

-- Produto do próprio catálogo pelo nome (ativo ou não, sem os excluídos): {match} ou {question}.
create or replace function zt_private.assistant_read_product(p_company uuid,p_query text)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_rows jsonb; v_exact jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,
      'exact',zt_private.assistant_fold(p.name)=zt_private.assistant_fold(p_query)) order by p.name,p.id),'[]'::jsonb)
    into v_rows from public.products p
   where p.company_id=p_company and p.deleted_at is null
     and (zt_private.assistant_fold(p.name)=zt_private.assistant_fold(p_query)
       or zt_private.assistant_name_matches(concat_ws(' ',p.name,p.brand,p.model,p.sku),p_query));
  select coalesce(jsonb_agg(r),'[]'::jsonb) into v_exact from jsonb_array_elements(v_rows) r where (r->>'exact')::boolean;
  if jsonb_array_length(v_exact)=1 then return jsonb_build_object('match',v_exact->0); end if;
  if jsonb_array_length(v_rows)=1 then return jsonb_build_object('match',v_rows->0); end if;
  if jsonb_array_length(v_rows)=0 then
    return jsonb_build_object('question',format('Não encontrei o produto "%s" no catálogo.',left(p_query,80)));
  end if;
  return jsonb_build_object('question',format('Encontrei mais de um produto para "%s": %s. Qual deles? Informe o nome completo.',left(p_query,80),
    (select string_agg(x.r->>'name','; ') from (select r from jsonb_array_elements(v_rows) r limit 6) x)));
end $$;

-- OS com o assunto pedido ("portão"): solicitação, problema, local, itens, relato e equipamentos.
create or replace function zt_private.assistant_wo_matches(p_company uuid,p_wo uuid,p_query text)
returns boolean language sql stable security invoker set search_path='' as $$
  select coalesce(zt_private.assistant_name_matches(concat_ws(' ',w.request,w.problem_report,w.service_place,w.pre_notes,
      (select string_agg(i.name,' ') from public.work_order_items i where i.work_order_id=w.id and i.company_id=w.company_id),
      (select string_agg(r.body,' ') from public.work_order_reports r where r.work_order_id=w.id and r.company_id=w.company_id and r.entry_type='report'),
      (select string_agg(concat_ws(' ',e.name,e.brand,e.model),' ') from public.installed_equipment e where e.work_order_id=w.id and e.company_id=w.company_id)),
    p_query),false)
    from public.work_orders w where w.id=p_wo and w.company_id=p_company;
$$;

-- Ficha de uma OS para o proprietário: data real do atendimento, situação, técnico, local,
-- solicitação, relato técnico, itens (sem valores), equipamentos, garantia e retornos.
create or replace function zt_private.assistant_wo_card(p_company uuid,p_wo uuid,p_full boolean)
returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('id',w.id,'entityType','work_order','number',w.number,'title',concat_ws(' · ',w.number,c.name),
    'detail',concat_ws(E'\n',
      concat_ws(' · ',to_char(coalesce((w.completed_at at time zone 'America/Sao_Paulo')::date,w.scheduled_date),'DD/MM/YYYY'),
        zt_private.assistant_wo_status(w.status::text),'Técnico: '||nullif(btrim(t.full_name),''),
        'Local: '||coalesce(nullif(btrim(l.name),''),nullif(btrim(w.service_place),''),nullif(btrim(w.address),''))),
      'Solicitação: '||left(nullif(btrim(w.request),''),case when p_full then 1000 else 200 end),
      case when p_full then 'Problema relatado: '||left(nullif(btrim(w.problem_report),''),1000) end,
      'Relato: '||left(nullif(btrim(r.body),''),case when p_full then 1500 else 280 end),
      'Itens: '||nullif(i.list,''),
      'Equipamentos: '||nullif(e.list,''),
      case when g.ends_on is not null then 'Garantia: até '||to_char(g.ends_on,'DD/MM/YYYY')
        ||case when g.ends_on>=(now() at time zone 'America/Sao_Paulo')::date then ' (ativa)' else ' (vencida)' end end,
      case when p_full then 'Pendência: '||left(nullif(btrim(w.pending_note),''),500) end,
      'Retorno: '||nullif(rt.list,''),
      case when p_full and ev.n>0 then 'Evidências: '||ev.n||' arquivo(s) na memória da OS' end))
    from public.work_orders w
    left join public.clients c on c.id=w.client_id and c.company_id=w.company_id
    left join public.profiles t on t.id=w.assigned_to
    left join public.client_locations l on l.id=w.client_location_id and l.company_id=w.company_id
    left join lateral (select x.body from public.work_order_reports x where x.work_order_id=w.id and x.company_id=w.company_id
      and x.entry_type='report' order by x.created_at desc,x.id desc limit 1) r on true
    left join lateral (select string_agg(zt_private.assistant_qty(x.quantity)||' × '||x.name,'; ' order by x.id) as list
      from public.work_order_items x where x.work_order_id=w.id and x.company_id=w.company_id) i on true
    left join lateral (select string_agg(concat_ws(' ',x.name,nullif(concat_ws(' ',x.brand,x.model),''),'(série '||nullif(x.serial_number,'')||')'),'; '
      order by x.installed_at,x.id) as list from public.installed_equipment x where x.work_order_id=w.id and x.company_id=w.company_id) e on true
    left join lateral (select max(x.ends_on) as ends_on from public.warranties x
      where x.work_order_id=w.id and x.company_id=w.company_id and x.deleted_at is null) g on true
    left join lateral (select string_agg(left(x.reason,200)||case when x.resolved_at is null then ' (pendente)' else ' (resolvido)' end,'; '
      order by x.created_at) as list from public.work_order_returns x where x.work_order_id=w.id and x.company_id=w.company_id) rt on true
    left join lateral (select count(*) as n from public.attachments x where x.work_order_id=w.id and x.company_id=w.company_id) ev on true
   where w.id=p_wo and w.company_id=p_company and w.deleted_at is null;
$$;

-- Linha de agenda: dia da semana, data, horário, situação, técnico e local.
create or replace function zt_private.assistant_agenda_card(p_company uuid,p_wo uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('id',w.id,'entityType','work_order','number',w.number,'title',concat_ws(' · ',w.number,c.name),
    'detail',concat_ws(' · ',
      case when w.scheduled_date is not null then (array['dom','seg','ter','qua','qui','sex','sáb'])[extract(dow from w.scheduled_date)::int+1]
        ||' '||to_char(w.scheduled_date,'DD/MM') end,
      to_char(w.scheduled_time,'HH24:MI'),zt_private.assistant_wo_status(w.status::text),'Técnico: '||nullif(btrim(t.full_name),''),
      coalesce(nullif(btrim(l.name),''),nullif(btrim(w.service_place),''),nullif(btrim(w.address),'')),left(nullif(btrim(w.request),''),160)))
    from public.work_orders w
    left join public.clients c on c.id=w.client_id and c.company_id=w.company_id
    left join public.profiles t on t.id=w.assigned_to
    left join public.client_locations l on l.id=w.client_location_id and l.company_id=w.company_id
   where w.id=p_wo and w.company_id=p_company;
$$;

-- Contrato fechado de cada consulta, repetido na fronteira de autoridade.
create or replace function zt_private.assistant_read_validate(p_action text,p_input jsonb)
returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare
  v_allowed text[]; v_required text[]:='{}'; k text; v jsonb; t text; v_num numeric; v_out jsonb:='{}'::jsonb;
  v_uuid constant text:='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  if p_input is null or jsonb_typeof(p_input)<>'object' or octet_length(p_input::text)>4000 then
    raise exception 'Argumentos inválidos' using errcode='22023';
  end if;
  case p_action
    when 'owner_client_history' then v_allowed:=array['client','clientRef','limit','query'];
    when 'owner_client_equipment','owner_maintenance_contracts' then v_allowed:=array['client','clientRef'];
    when 'owner_client_warranties' then v_allowed:=array['client','clientRef','active'];
    when 'owner_receivables' then v_allowed:=array['client','clientRef','overdue'];
    when 'owner_work_order_details' then v_allowed:=array['workOrder']; v_required:=v_allowed;
    when 'owner_day_schedule' then v_allowed:=array['date']; v_required:=v_allowed;
    when 'owner_stock_level' then v_allowed:=array['query']; v_required:=v_allowed;
    when 'owner_stock_movements' then v_allowed:=array['query','limit']; v_required:=array['query'];
    when 'owner_product_purchases' then v_allowed:=array['query','month']; v_required:=array['query'];
    when 'owner_week_schedule','owner_unscheduled_work_orders','owner_low_stock','owner_overdue_clients' then v_allowed:='{}';
    when 'owner_recent_purchases' then v_allowed:=array['limit'];
    when 'owner_expiring_warranties','owner_purchases_due','owner_post_sale_due' then v_allowed:=array['days'];
    when 'owner_contracts_due' then v_allowed:=array['period'];
    when 'owner_inactive_clients' then v_allowed:=array['months'];
    when 'owner_finance_summary','owner_operational_report' then v_allowed:=array['month'];
    else raise exception 'Consulta desconhecida' using errcode='22023';
  end case;
  if not p_input ?& v_required then raise exception 'Preencha os campos obrigatórios' using errcode='22023'; end if;
  for k,v in select * from jsonb_each(p_input) loop
    if not k=any(v_allowed) then raise exception 'Campo não permitido: %',k using errcode='22023'; end if;
    if k in ('limit','days','months') then
      if jsonb_typeof(v)<>'number' then raise exception 'Valor numérico inválido' using errcode='22023'; end if;
      v_num:=(v::text)::numeric;
      if v_num<>trunc(v_num) or v_num<1 or v_num>(case k when 'limit' then 10 when 'days' then 365 else 36 end) then
        raise exception 'Valor fora dos limites' using errcode='22023';
      end if;
      v_out:=v_out||jsonb_build_object(k,v_num::integer);
    elsif k in ('active','overdue') then
      if jsonb_typeof(v)<>'boolean' then raise exception 'Opção inválida: %',k using errcode='22023'; end if;
      v_out:=v_out||jsonb_build_object(k,v);
    else
      if jsonb_typeof(v)<>'string' then raise exception 'Texto inválido: %',k using errcode='22023'; end if;
      t:=btrim(p_input->>k);
      if k='clientRef' then
        if t !~ v_uuid then raise exception 'Escolha inválida' using errcode='22023'; end if;
      elsif k='date' then
        if t !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Data inválida' using errcode='22023'; end if;
        perform t::date;
      elsif k='month' then
        if t !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'Mês inválido' using errcode='22023'; end if;
      elsif k='period' then
        if t not in ('month','overdue') then raise exception 'Período inválido' using errcode='22023'; end if;
      elsif t='' or length(t)>120 then
        raise exception 'Texto vazio ou muito longo: %',k using errcode='22023';
      end if;
      v_out:=v_out||jsonb_build_object(k,t);
    end if;
  end loop;
  if p_action in ('owner_client_history','owner_client_equipment','owner_client_warranties') and not v_out ?| array['client','clientRef'] then
    raise exception 'Informe o cliente' using errcode='22023';
  end if;
  return v_out;
end $$;

-- Consultas do proprietário: {items, message[, subject]} ou {question[, options]}. Somente leitura.
create or replace function zt_private.assistant_read_run(p_company uuid,p_action text,p_input jsonb)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare
  v_today date:=(now() at time zone 'America/Sao_Paulo')::date;
  v_client jsonb; v_id uuid; v_name text; v_items jsonb; v_n integer; v_open integer; v_limit integer;
  v_from date; v_to date; v_label text; v_total numeric(14,2); v_late numeric(14,2); v_qty numeric(14,3);
  v_wo uuid; v_subject jsonb; v_product jsonb; v_rows jsonb; v_days integer:=coalesce((p_input->>'days')::int,
    case when p_action='owner_post_sale_due' then 7 else 30 end);
  v_months constant text[]:=array['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
begin
  v_from:=to_date(coalesce(p_input->>'month',to_char(v_today,'YYYY-MM'))||'-01','YYYY-MM-DD');
  v_to:=(v_from+interval '1 month')::date;
  v_label:=v_months[extract(month from v_from)::int]||' de '||extract(year from v_from)::int;

  if p_action in ('owner_client_history','owner_client_equipment','owner_client_warranties')
     or (p_action in ('owner_maintenance_contracts','owner_receivables') and p_input ?| array['client','clientRef']) then
    v_client:=zt_private.assistant_read_client(p_company,p_input);
    if v_client ? 'question' then return v_client; end if;
    v_id:=(v_client#>>'{match,id}')::uuid; v_name:=v_client#>>'{match,name}';
    v_subject:=jsonb_build_object('id',v_id,'entityType','client','title',v_name);
  end if;

  case p_action
  -- ---------------------------------------------------------------- cliente e memória técnica
  when 'owner_client_history' then
    v_limit:=coalesce((p_input->>'limit')::int,3);
    select coalesce(jsonb_agg(zt_private.assistant_wo_card(p_company,x.id,false)
        order by x.completed_at desc nulls last,x.scheduled_date desc nulls last,x.created_at desc,x.id),'[]'::jsonb)
      into v_items from (
        select w.id,w.completed_at,w.scheduled_date,w.created_at from public.work_orders w
         where w.company_id=p_company and w.client_id=v_id and w.deleted_at is null and w.status='done'
           and (p_input->>'query' is null or zt_private.assistant_wo_matches(p_company,w.id,p_input->>'query'))
         order by w.completed_at desc nulls last,w.scheduled_date desc nulls last,w.created_at desc,w.id
         limit v_limit) x;
    select count(*) into v_open from public.work_orders w
     where w.company_id=p_company and w.client_id=v_id and w.deleted_at is null and w.status in ('unscheduled','scheduled','in_progress');
    v_n:=jsonb_array_length(v_items);
    return jsonb_build_object('items',v_items,'subject',v_subject,'message',
      case when v_n=0 then format('Nenhum atendimento concluído de %s%s.',v_name,coalesce(' sobre "'||(p_input->>'query')||'"',''))
        when v_n=1 then format('Último atendimento concluído de %s%s.',v_name,coalesce(' sobre "'||(p_input->>'query')||'"',''))
        else format('Últimos %s atendimentos concluídos de %s%s.',v_n,v_name,coalesce(' sobre "'||(p_input->>'query')||'"','')) end
      ||case when v_open>0 then format(' Há %s OS em aberto.',v_open) else '' end);

  when 'owner_work_order_details' then
    v_wo:=zt_private.assistant_doc_find(p_company,'work_order',p_input->>'workOrder');
    if v_wo is null then
      return jsonb_build_object('question',format('Não encontrei a OS "%s". Informe o número, por exemplo OS-0007.',left(p_input->>'workOrder',40)));
    end if;
    v_items:=jsonb_build_array(zt_private.assistant_wo_card(p_company,v_wo,true));
    return jsonb_build_object('items',v_items,'message',format('Detalhes da %s.',v_items#>>'{0,number}'));

  when 'owner_client_equipment' then
    select coalesce(jsonb_agg(x.item order by x.installed_at desc,x.id),'[]'::jsonb) into v_items from (
      select e.id,e.installed_at,jsonb_strip_nulls(jsonb_build_object('id',w.id,'entityType',case when w.id is not null then 'work_order' end,'number',w.number,
          'title',concat_ws(' ',e.name,nullif(concat_ws(' ',e.brand,e.model),'')),
          'detail',concat_ws(' · ','Local: '||nullif(btrim(l.name),''),'Instalado em '||to_char((e.installed_at at time zone 'America/Sao_Paulo')::date,'DD/MM/YYYY'),
            w.number,'Série: '||nullif(e.serial_number,''),
            case when g.ends_on is not null then 'Garantia até '||to_char(g.ends_on,'DD/MM/YYYY')||case when g.ends_on>=v_today then ' (ativa)' else ' (vencida)' end end))) as item
        from public.installed_equipment e
        left join public.client_locations l on l.id=e.client_location_id and l.company_id=e.company_id
        left join public.work_orders w on w.id=e.work_order_id and w.company_id=e.company_id and w.deleted_at is null
        left join public.warranties g on g.id=e.warranty_id and g.company_id=e.company_id and g.deleted_at is null
       where e.company_id=p_company and e.client_id=v_id
       order by e.installed_at desc,e.id limit 30) x;
    v_n:=jsonb_array_length(v_items);
    return jsonb_build_object('items',v_items,'subject',v_subject,'message',case when v_n=0
      then format('Não há equipamento instalado registrado para %s.',v_name) else format('%s equipamento(s) instalado(s) de %s.',v_n,v_name) end);

  when 'owner_client_warranties' then
    select coalesce(jsonb_agg(x.item order by x.ends_on,x.id),'[]'::jsonb),count(*) filter (where x.ends_on>=v_today)
      into v_items,v_n from (
      select g.id,g.ends_on,jsonb_strip_nulls(jsonb_build_object('id',w.id,'entityType',case when w.id is not null then 'work_order' end,'number',w.number,
          'title',g.description,
          'detail',concat_ws(' · ',case g.kind when 'product' then 'Produto' else 'Serviço' end,
            'de '||to_char(g.starts_on,'DD/MM/YYYY')||' até '||to_char(g.ends_on,'DD/MM/YYYY'),
            case when g.ends_on>=v_today then 'ativa' else 'vencida' end,'Originada na '||w.number,
            'Local: '||nullif(btrim(g.service_place),''),'Série: '||nullif(g.serial_number,'')))) as item
        from public.warranties g
        left join public.work_orders w on w.id=g.work_order_id and w.company_id=g.company_id and w.deleted_at is null
       where g.company_id=p_company and g.client_id=v_id and g.deleted_at is null
         and (coalesce((p_input->>'active')::boolean,true)=false or g.ends_on>=v_today)
       order by g.ends_on,g.id limit 30) x;
    return jsonb_build_object('items',v_items,'subject',v_subject,'message',case when jsonb_array_length(v_items)=0
      then format('%s não tem garantia%s registrada.',v_name,case when coalesce((p_input->>'active')::boolean,true) then ' ativa' else '' end)
      else format('%s garantia(s) ativa(s) de %s.',v_n,v_name) end);

  when 'owner_expiring_warranties' then
    select coalesce(jsonb_agg(x.item order by x.ends_on,x.id),'[]'::jsonb) into v_items from (
      select g.id,g.ends_on,jsonb_build_object('id',c.id,'entityType','client','title',concat_ws(' · ',c.name,g.description),
          'detail',concat_ws(' · ','vence '||to_char(g.ends_on,'DD/MM/YYYY'),case g.kind when 'product' then 'Produto' else 'Serviço' end,w.number)) as item
        from public.warranties g
        join public.clients c on c.id=g.client_id and c.company_id=g.company_id
        left join public.work_orders w on w.id=g.work_order_id and w.company_id=g.company_id
       where g.company_id=p_company and g.deleted_at is null and g.ends_on between v_today and v_today+v_days
       order by g.ends_on,g.id limit 30) x;
    return jsonb_build_object('items',v_items,'message',format('%s garantia(s) vencendo nos próximos %s dias.',jsonb_array_length(v_items),v_days));

  -- ---------------------------------------------------------------- agenda
  when 'owner_week_schedule','owner_day_schedule' then
    v_from:=case when p_action='owner_day_schedule' then (p_input->>'date')::date else v_today end;
    v_to:=case when p_action='owner_day_schedule' then v_from else v_today+6 end;
    select coalesce(jsonb_agg(zt_private.assistant_agenda_card(p_company,x.id) order by x.scheduled_date,x.scheduled_time nulls last,x.number),'[]'::jsonb)
      into v_items from (
        select w.id,w.scheduled_date,w.scheduled_time,w.number from public.work_orders w
         where w.company_id=p_company and w.deleted_at is null and w.scheduled_date between v_from and v_to
           and w.status<>'canceled' and (p_action='owner_day_schedule' or w.status<>'done')
         order by w.scheduled_date,w.scheduled_time nulls last,w.number limit 50) x;
    return jsonb_build_object('items',v_items,'message',case when p_action='owner_day_schedule'
      then format('%s atendimento(s) em %s.',jsonb_array_length(v_items),to_char(v_from,'DD/MM/YYYY'))
      else format('%s atendimento(s) de %s a %s.',jsonb_array_length(v_items),to_char(v_from,'DD/MM'),to_char(v_to,'DD/MM')) end);

  when 'owner_unscheduled_work_orders' then
    select coalesce(jsonb_agg(zt_private.assistant_agenda_card(p_company,x.id) order by x.created_at,x.id),'[]'::jsonb) into v_items from (
      select w.id,w.created_at from public.work_orders w
       where w.company_id=p_company and w.deleted_at is null and w.status in ('unscheduled','scheduled','in_progress') and w.scheduled_date is null
       order by w.created_at,w.id limit 30) x;
    return jsonb_build_object('items',v_items,'message',format('%s OS em aberto sem data na agenda.',jsonb_array_length(v_items)));

  -- ---------------------------------------------------------------- catálogo e estoque
  when 'owner_stock_level','owner_low_stock' then
    select coalesce(jsonb_agg(x.item order by x.ord,x.name,x.id),'[]'::jsonb) into v_items from (
      select p.id,p.name,case when p_action='owner_low_stock' then p.stock_qty-p.low_stock_threshold else 0 end as ord,
        jsonb_build_object('id',p.id,'entityType','product','title',p.name,'detail',concat_ws(' · ',nullif(concat_ws(' ',p.brand,p.model),''),
          case when p.track_stock then 'Estoque: '||zt_private.assistant_qty(p.stock_qty)||' '||coalesce(nullif(p.unit,''),'unidade') else 'Estoque não controlado' end,
          case when p.track_stock and p.low_stock_threshold is not null then 'Mínimo: '||zt_private.assistant_qty(p.low_stock_threshold) end,
          case when p.track_stock and p.low_stock_threshold is not null and p.stock_qty<=p.low_stock_threshold then 'abaixo do mínimo' end,
          'Venda: '||zt_private.assistant_money(p.price),case when not p.active then 'inativo' end)) as item
        from public.products p
       where p.company_id=p_company and p.deleted_at is null
         and case when p_action='owner_low_stock' then p.active and p.track_stock and p.low_stock_threshold is not null and p.stock_qty<=p.low_stock_threshold
           else zt_private.assistant_fold(p.name)=zt_private.assistant_fold(p_input->>'query')
             or zt_private.assistant_name_matches(concat_ws(' ',p.name,p.brand,p.model,p.sku),p_input->>'query') end
       order by 3,p.name,p.id limit 30) x;
    return jsonb_build_object('items',v_items,'message',case when p_action='owner_low_stock'
      then case when jsonb_array_length(v_items)=0 then 'Nenhum produto abaixo do estoque mínimo.' else format('%s produto(s) abaixo do estoque mínimo.',jsonb_array_length(v_items)) end
      else case when jsonb_array_length(v_items)=0 then format('Não encontrei "%s" no catálogo.',left(p_input->>'query',80)) else 'Estoque consultado.' end end);

  when 'owner_stock_movements' then
    v_product:=zt_private.assistant_read_product(p_company,p_input->>'query');
    if v_product ? 'question' then return v_product; end if;
    select coalesce(jsonb_agg(x.item order by x.created_at desc,x.id),'[]'::jsonb) into v_items from (
      select m.id,m.created_at,jsonb_build_object('title',case m.kind when 'purchase' then 'Entrada por compra' when 'sale' then 'Venda'
            when 'usage' then 'Uso em OS' when 'adjustment' then 'Ajuste' when 'return' then 'Devolução' else m.kind end
          ||': '||case when m.quantity_delta>0 then '+' else '' end||zt_private.assistant_qty(m.quantity_delta),
          'detail',concat_ws(' · ',to_char((m.created_at at time zone 'America/Sao_Paulo')::date,'DD/MM/YYYY'),w.number,'Compra '||u.number,
            left(nullif(btrim(m.notes),''),120))) as item
        from public.inventory_movements m
        left join public.work_orders w on w.id=m.work_order_id and w.company_id=m.company_id
        left join public.purchases u on u.id=m.purchase_id and u.company_id=m.company_id
       where m.company_id=p_company and m.product_id=(v_product#>>'{match,id}')::uuid
       order by m.created_at desc,m.id limit coalesce((p_input->>'limit')::int,5)) x;
    return jsonb_build_object('items',v_items,'message',case when jsonb_array_length(v_items)=0
      then format('Não há movimentação de estoque de %s.',v_product#>>'{match,name}')
      else format('Últimas movimentações de %s.',v_product#>>'{match,name}') end);

  -- ---------------------------------------------------------------- compras
  when 'owner_recent_purchases' then
    select coalesce(jsonb_agg(x.item order by x.purchase_date desc nulls last,x.created_at desc,x.id),'[]'::jsonb) into v_items from (
      select u.id,u.purchase_date,u.created_at,jsonb_build_object('title',concat_ws(' · ',u.number,nullif(btrim(u.supplier_name),'')),
          'detail',concat_ws(' · ',to_char(u.purchase_date,'DD/MM/YYYY'),'Total: '||zt_private.assistant_money(t.total),
            case when f.id is not null then case when f.paid then 'paga' else 'a pagar até '||to_char(f.due_date,'DD/MM/YYYY') end end)) as item
        from public.purchases u
        left join lateral (select coalesce(sum(round(i.quantity*i.unit_cost,2)),0) as total from public.purchase_items i
          where i.purchase_id=u.id and i.company_id=u.company_id) t on true
        left join public.financial_entries f on f.purchase_id=u.id and f.company_id=u.company_id and f.deleted_at is null
       where u.company_id=p_company and u.deleted_at is null
       order by u.purchase_date desc nulls last,u.created_at desc,u.id limit coalesce((p_input->>'limit')::int,5)) x;
    return jsonb_build_object('items',v_items,'message',case when jsonb_array_length(v_items)=0 then 'Nenhuma compra registrada.' else 'Últimas compras.' end);

  when 'owner_purchases_due' then
    select coalesce(jsonb_agg(x.item order by x.due_date,x.id),'[]'::jsonb),coalesce(sum(x.amount),0) into v_items,v_total from (
      select f.id,f.due_date,f.amount,jsonb_build_object('id',f.id,'entityType','financial_entry','title',concat_ws(' · ',u.number,nullif(btrim(u.supplier_name),'')),
          'detail',concat_ws(' · ','vence '||to_char(f.due_date,'DD/MM/YYYY')||case when f.due_date<v_today then ' (vencida)' else '' end,
            zt_private.assistant_money(f.amount))) as item
        from public.financial_entries f
        join public.purchases u on u.id=f.purchase_id and u.company_id=f.company_id and u.deleted_at is null
       where f.company_id=p_company and f.deleted_at is null and f.kind='expense' and not f.paid and f.due_date<=v_today+v_days
       order by f.due_date,f.id limit 30) x;
    return jsonb_build_object('items',v_items,'message',case when jsonb_array_length(v_items)=0
      then format('Nenhuma compra a pagar até %s.',to_char(v_today+v_days,'DD/MM/YYYY'))
      else format('%s compra(s) a pagar até %s, total %s.',jsonb_array_length(v_items),to_char(v_today+v_days,'DD/MM/YYYY'),zt_private.assistant_money(v_total)) end);

  when 'owner_product_purchases' then
    v_product:=zt_private.assistant_read_product(p_company,p_input->>'query');
    if v_product ? 'question' then return v_product; end if;
    select coalesce(jsonb_agg(x.item order by x.purchase_date desc,x.id),'[]'::jsonb),coalesce(sum(x.qty),0),coalesce(sum(x.total),0)
      into v_items,v_qty,v_total from (
      select u.id,u.purchase_date,sum(i.quantity) as qty,sum(round(i.quantity*i.unit_cost,2)) as total,
        jsonb_build_object('title',concat_ws(' · ',u.number,nullif(btrim(u.supplier_name),'')),'detail',concat_ws(' · ',to_char(u.purchase_date,'DD/MM/YYYY'),
          zt_private.assistant_qty(sum(i.quantity))||' un.',zt_private.assistant_money(sum(round(i.quantity*i.unit_cost,2))))) as item
        from public.purchase_items i
        join public.purchases u on u.id=i.purchase_id and u.company_id=i.company_id and u.deleted_at is null
       where i.company_id=p_company and i.product_id=(v_product#>>'{match,id}')::uuid and u.purchase_date>=v_from and u.purchase_date<v_to
       group by u.id,u.purchase_date,u.number,u.supplier_name
       order by u.purchase_date desc,u.id limit 10) x;
    return jsonb_build_object('items',v_items,'message',case when jsonb_array_length(v_items)=0
      then format('Nenhuma compra de %s em %s.',v_product#>>'{match,name}',v_label)
      else format('Em %s você comprou %s de %s, total %s.',v_label,zt_private.assistant_qty(v_qty),v_product#>>'{match,name}',zt_private.assistant_money(v_total)) end);

  -- ---------------------------------------------------------------- contratos e pós-venda
  when 'owner_maintenance_contracts','owner_contracts_due' then
    select coalesce(jsonb_agg(x.item order by x.ord,x.next_service_on nulls last,x.id),'[]'::jsonb) into v_items from (
      select m.id,m.next_service_on,case when m.status='active' then 0 else 1 end as ord,
        jsonb_build_object('id',c.id,'entityType','client','title',concat_ws(' · ',c.name,m.name),'detail',concat_ws(' · ',
          case m.status when 'active' then 'ativo' when 'paused' then 'pausado' else m.status end,
          zt_private.assistant_money(m.amount)||' a cada '||m.interval_months||case when m.interval_months=1 then ' mês' else ' meses' end,
          'Próxima visita: '||to_char(m.next_service_on,'DD/MM/YYYY')||case when m.status='active' and m.next_service_on<v_today then ' (atrasada)' else '' end,
          'Próxima cobrança: '||to_char(m.next_billing_on,'DD/MM/YYYY'),'Responsável: '||nullif(btrim(t.full_name),''))) as item
        from public.maintenance_contracts m
        join public.clients c on c.id=m.client_id and c.company_id=m.company_id
        left join public.profiles t on t.id=m.assigned_to
       where m.company_id=p_company and (v_id is null or m.client_id=v_id)
         and case when p_action='owner_maintenance_contracts' then m.status in ('active','paused')
           when coalesce(p_input->>'period','month')='overdue' then m.status='active' and m.next_service_on<v_today
           else m.status='active' and ((m.next_service_on>=v_from and m.next_service_on<v_to) or (m.next_billing_on>=v_from and m.next_billing_on<v_to)) end
       order by 3,m.next_service_on nulls last,m.id limit 30) x;
    return jsonb_build_object('items',v_items,'subject',v_subject,'message',case
      when p_action='owner_maintenance_contracts' then format('%s contrato(s) ativos ou pausados%s.',jsonb_array_length(v_items),coalesce(' de '||v_name,''))
      when coalesce(p_input->>'period','month')='overdue' then format('%s contrato(s) com visita atrasada.',jsonb_array_length(v_items))
      else format('%s contrato(s) com visita ou cobrança em %s.',jsonb_array_length(v_items),v_label) end);

  when 'owner_post_sale_due' then
    select coalesce(jsonb_agg(x.item order by x.due_on,x.id),'[]'::jsonb) into v_items from (
      select f.id,f.due_on,jsonb_strip_nulls(jsonb_build_object('id',c.id,'entityType','client','title',c.name,'phone',nullif(c.phone,''),'whatsapp',nullif(c.whatsapp,''),
          'detail',concat_ws(' · ',f.description,'para '||to_char(f.due_on,'DD/MM/YYYY')||case when f.due_on<v_today then ' (atrasado)' else '' end,
            case f.kind when 'service_review' then 'revisão do serviço' when 'check_in' then 'contato' when 'satisfaction' then 'satisfação'
              when 'maintenance' then 'manutenção' when 'warranty_expiring' then 'garantia vencendo' else 'pós-venda' end,w.number))) as item
        from public.post_sale_followups f
        join public.clients c on c.id=f.client_id and c.company_id=f.company_id
        left join public.work_orders w on w.id=f.work_order_id and w.company_id=f.company_id
       where f.company_id=p_company and f.status='pending' and f.due_on<=v_today+v_days
       order by f.due_on,f.id limit 30) x;
    return jsonb_build_object('items',v_items,'message',format('%s pós-venda pendente(s) até %s.',jsonb_array_length(v_items),to_char(v_today+v_days,'DD/MM/YYYY')));

  when 'owner_inactive_clients' then
    select coalesce(jsonb_agg(x.item order by x.last_at,x.id),'[]'::jsonb) into v_items from (
      select c.id,max(w.completed_at) as last_at,jsonb_build_object('id',c.id,'entityType','client','title',c.name,
          'detail','Último atendimento concluído: '||to_char((max(w.completed_at) at time zone 'America/Sao_Paulo')::date,'DD/MM/YYYY')
            ||' ('||(array_agg(w.number order by w.completed_at desc))[1]||')') as item
        from public.clients c
        join public.work_orders w on w.client_id=c.id and w.company_id=c.company_id and w.deleted_at is null and w.status='done' and w.completed_at is not null
       where c.company_id=p_company and c.deleted_at is null
         and not exists(select 1 from public.work_orders o where o.client_id=c.id and o.company_id=c.company_id and o.deleted_at is null
           and o.status in ('unscheduled','scheduled','in_progress'))
       group by c.id,c.name
      having max(w.completed_at)<now()-make_interval(months=>coalesce((p_input->>'months')::int,6))
       order by 2,c.id limit 20) x;
    return jsonb_build_object('items',v_items,'message',format('%s cliente(s) sem atendimento concluído há mais de %s meses e sem OS em aberto.',
      jsonb_array_length(v_items),coalesce((p_input->>'months')::int,6)));

  -- ---------------------------------------------------------------- financeiro (definições da FinanceV2)
  when 'owner_finance_summary' then
    select jsonb_build_array(
        jsonb_build_object('title','Faturado','detail',zt_private.assistant_money(coalesce(sum(f.amount) filter (where f.kind='income'
          and f.due_date>=v_from and f.due_date<v_to),0))||' · receitas com vencimento no mês'),
        jsonb_build_object('title','Recebido','detail',zt_private.assistant_money(coalesce(sum(f.amount) filter (where f.kind='income' and f.paid
          and coalesce(f.paid_at,f.due_date)>=v_from and coalesce(f.paid_at,f.due_date)<v_to),0))||' · entrada efetiva no mês'),
        jsonb_build_object('title','A receber','detail',zt_private.assistant_money(coalesce(sum(f.amount) filter (where f.kind='income' and not f.paid
          and f.due_date>=v_from and f.due_date<v_to),0))||' · ainda em aberto neste mês'),
        jsonb_build_object('title','Despesas','detail',zt_private.assistant_money(coalesce(sum(f.amount) filter (where f.kind='expense'
          and f.due_date>=v_from and f.due_date<v_to),0))||' · '||zt_private.assistant_money(coalesce(sum(f.amount) filter (where f.kind='expense' and f.paid
          and coalesce(f.paid_at,f.due_date)>=v_from and coalesce(f.paid_at,f.due_date)<v_to),0))||' já pago'),
        jsonb_build_object('title','Resultado de caixa','detail',zt_private.assistant_money(
          coalesce(sum(f.amount) filter (where f.kind='income' and f.paid and coalesce(f.paid_at,f.due_date)>=v_from and coalesce(f.paid_at,f.due_date)<v_to),0)
          -coalesce(sum(f.amount) filter (where f.kind='expense' and f.paid and coalesce(f.paid_at,f.due_date)>=v_from and coalesce(f.paid_at,f.due_date)<v_to),0))
          ||' · recebido menos despesas pagas'),
        jsonb_build_object('title','Clientes em atraso','detail',zt_private.assistant_money(coalesce(sum(f.amount) filter (where f.kind='income'
          and not f.paid and f.due_date<v_today),0))||' · receitas vencidas até hoje'),
        jsonb_build_object('title','Contas vencidas','detail',zt_private.assistant_money(coalesce(sum(f.amount) filter (where f.kind='expense'
          and not f.paid and f.due_date<v_today),0))||' · despesas em atraso'))
      into v_items from public.financial_entries f where f.company_id=p_company and f.deleted_at is null;
    return jsonb_build_object('items',v_items,'message',format('Resumo financeiro de %s.',v_label));

  when 'owner_receivables' then
    select coalesce(jsonb_agg(x.item order by x.due_date,x.id),'[]'::jsonb) into v_items from (
      select f.id,f.due_date,jsonb_build_object('id',f.id,'entityType','financial_entry','title',coalesce(c.name,f.description),
          'detail',concat_ws(' · ',f.description,'vence '||to_char(f.due_date,'DD/MM/YYYY')||case when f.due_date<v_today then ' (em atraso)' else '' end,
            zt_private.assistant_money(f.amount),w.number)) as item
        from public.financial_entries f
        left join public.clients c on c.id=f.client_id and c.company_id=f.company_id
        left join public.work_orders w on w.id=f.work_order_id and w.company_id=f.company_id
       where f.company_id=p_company and f.deleted_at is null and f.kind='income' and not f.paid
         and (v_id is null or f.client_id=v_id) and (coalesce((p_input->>'overdue')::boolean,false)=false or f.due_date<v_today)
       order by f.due_date,f.id limit 30) x;
    select count(*),coalesce(sum(f.amount),0),coalesce(sum(f.amount) filter (where f.due_date<v_today),0) into v_n,v_total,v_late
      from public.financial_entries f
     where f.company_id=p_company and f.deleted_at is null and f.kind='income' and not f.paid
       and (v_id is null or f.client_id=v_id) and (coalesce((p_input->>'overdue')::boolean,false)=false or f.due_date<v_today);
    return jsonb_build_object('items',v_items,'subject',v_subject,'message',case when v_n=0
      then case when v_id is not null then format('%s não tem valores em aberto.',v_name) else 'Nenhum valor a receber em aberto.' end
      else format('%s%s em aberto em %s lançamento(s)%s.',coalesce(v_name||' deve ','A receber: '),zt_private.assistant_money(v_total),v_n,
        case when v_late>0 then ', '||zt_private.assistant_money(v_late)||' em atraso' else '' end) end);

  when 'owner_overdue_clients' then
    select coalesce(jsonb_agg(x.item order by x.total desc,x.id),'[]'::jsonb),coalesce(sum(x.total),0) into v_items,v_total from (
      select c.id,sum(f.amount) as total,jsonb_build_object('id',c.id,'entityType','client','title',c.name,
          'detail',zt_private.assistant_money(sum(f.amount))||' em atraso · '||count(*)||' lançamento(s) · desde '||to_char(min(f.due_date),'DD/MM/YYYY')) as item
        from public.financial_entries f
        join public.clients c on c.id=f.client_id and c.company_id=f.company_id
       where f.company_id=p_company and f.deleted_at is null and f.kind='income' and not f.paid and f.due_date<v_today
       group by c.id,c.name
       order by 2 desc,c.id limit 20) x;
    return jsonb_build_object('items',v_items,'message',case when jsonb_array_length(v_items)=0 then 'Nenhum cliente em atraso.'
      else format('%s cliente(s) em atraso, total %s.',jsonb_array_length(v_items),zt_private.assistant_money(v_total)) end);

  -- ---------------------------------------------------------------- relatório operacional
  when 'owner_operational_report' then
    select jsonb_build_array(
        jsonb_build_object('title','OS concluídas','detail',(count(*) filter (where w.status='done'
          and (w.completed_at at time zone 'America/Sao_Paulo')::date>=v_from and (w.completed_at at time zone 'America/Sao_Paulo')::date<v_to))::text||' em '||v_label),
        jsonb_build_object('title','OS em aberto agora','detail',(count(*) filter (where w.status in ('unscheduled','scheduled','in_progress')))::text),
        jsonb_build_object('title','Agendadas nos próximos 7 dias','detail',(count(*) filter (where w.status in ('scheduled','in_progress')
          and w.scheduled_date between v_today and v_today+6))::text))
      into v_items from public.work_orders w where w.company_id=p_company and w.deleted_at is null;
    select jsonb_build_object('title','Clientes mais atendidos','detail',coalesce(string_agg(x.name||' ('||x.n||')','; ' order by x.n desc,x.name),
        'nenhum atendimento concluído no mês'))
      into v_rows from (
        select c.name,count(*) as n from public.work_orders w join public.clients c on c.id=w.client_id and c.company_id=w.company_id
         where w.company_id=p_company and w.deleted_at is null and w.status='done'
           and (w.completed_at at time zone 'America/Sao_Paulo')::date>=v_from and (w.completed_at at time zone 'America/Sao_Paulo')::date<v_to
         group by c.name order by 2 desc,c.name limit 5) x;
    v_items:=v_items||jsonb_build_array(v_rows);
    select jsonb_build_object('title','Serviços mais realizados','detail',coalesce(string_agg(x.name||' ('||zt_private.assistant_qty(x.qty)||')','; '
        order by x.qty desc,x.name),'nenhum serviço concluído no mês'))
      into v_rows from (
        select i.name,sum(i.quantity) as qty from public.work_order_items i
          join public.work_orders w on w.id=i.work_order_id and w.company_id=i.company_id
         where i.company_id=p_company and i.kind='service' and w.deleted_at is null and w.status='done'
           and (w.completed_at at time zone 'America/Sao_Paulo')::date>=v_from and (w.completed_at at time zone 'America/Sao_Paulo')::date<v_to
         group by i.name order by 2 desc,i.name limit 5) x;
    v_items:=v_items||jsonb_build_array(v_rows);
    return jsonb_build_object('items',v_items,'message',format('Relatório operacional de %s.',v_label));
  else
    raise exception 'Consulta desconhecida' using errcode='22023';
  end case;
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
    'owner_post_sale_due','owner_inactive_clients','owner_finance_summary','owner_receivables','owner_overdue_clients','owner_operational_report']) then
    if v_role<>'owner' then raise exception 'Ação exclusiva do proprietário' using errcode='42501'; end if;
  elsif p_action = any(array['technician_today_orders','technician_next_appointment','technician_open_assigned_order','add_assigned_work_report',
    'mark_assigned_order_pending','mark_assigned_order_return','finalize_assigned_work_order']) then
    if v_role<>'technician' then raise exception 'Ação exclusiva do técnico atribuído' using errcode='42501'; end if;
  else raise exception 'Ação desconhecida' using errcode='22023';
  end if;
  return v_role;
end $$;

-- Entrada única das consultas do proprietário. Somente leitura: grava apenas a auditoria.
create or replace function public.zt_assistant_read(p_company uuid,p_action text,p_input jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_input jsonb; v_hash bytea; v_out jsonb;
begin
  -- Bounded digest for denied attempts too; no raw input is written to audit.
  if p_input is not null and octet_length(p_input::text)<=4000 then
    v_hash:=sha256(convert_to(p_input::text,'UTF8'));
  end if;
  perform zt_private.assistant_authorize(p_company,p_action);
  if not p_action=any(array['owner_client_history','owner_work_order_details','owner_client_equipment','owner_client_warranties','owner_expiring_warranties',
    'owner_week_schedule','owner_day_schedule','owner_unscheduled_work_orders','owner_stock_level','owner_low_stock','owner_stock_movements',
    'owner_recent_purchases','owner_purchases_due','owner_product_purchases','owner_maintenance_contracts','owner_contracts_due',
    'owner_post_sale_due','owner_inactive_clients','owner_finance_summary','owner_receivables','owner_overdue_clients','owner_operational_report']) then
    raise exception 'Consulta desconhecida' using errcode='22023';
  end if;
  perform zt_private.assistant_subscription(p_company);
  if p_request_id is null then raise exception 'Identificador da tentativa obrigatório' using errcode='22023'; end if;
  v_input:=zt_private.assistant_read_validate(p_action,p_input);
  v_hash:=sha256(convert_to(p_action||':'||v_input::text,'UTF8'));
  v_out:=zt_private.assistant_read_run(p_company,p_action,v_input);
  if v_out ? 'question' then
    -- Homônimos viram opções do próprio tenant + rascunho a completar; nada é inventado.
    perform zt_private.assistant_audit(p_company,p_request_id,'denied','CLARIFICATION',p_action,v_hash);
    return jsonb_strip_nulls(jsonb_build_object('question',v_out->>'question','options',v_out->'options','action',p_action,
      'draft',case when v_out ? 'options' then v_input end));
  end if;
  insert into public.assistant_action_audit(company_id,actor_user_id,action,request_id,success,status,input_hash)
    values(p_company,auth.uid(),p_action,p_request_id,true,'read',v_hash);
  return jsonb_build_object('requestId',p_request_id,'action',p_action,'confirmationRequired',false,'result',v_out);
exception when others then
  perform zt_private.assistant_audit(p_company,p_request_id,'denied',zt_private.assistant_error_code(sqlstate),p_action,v_hash);
  return jsonb_build_object('error','Não foi possível consultar agora. Verifique os dados e o acesso.',
    'code',zt_private.assistant_error_code(sqlstate));
end $$;

revoke all on function zt_private.assistant_read_client(uuid,jsonb) from public,anon,authenticated;
revoke all on function zt_private.assistant_read_product(uuid,text) from public,anon,authenticated;
revoke all on function zt_private.assistant_wo_matches(uuid,uuid,text) from public,anon,authenticated;
revoke all on function zt_private.assistant_wo_card(uuid,uuid,boolean) from public,anon,authenticated;
revoke all on function zt_private.assistant_agenda_card(uuid,uuid) from public,anon,authenticated;
revoke all on function zt_private.assistant_read_validate(text,jsonb) from public,anon,authenticated;
revoke all on function zt_private.assistant_read_run(uuid,text,jsonb) from public,anon,authenticated;
revoke all on function zt_private.assistant_audit(uuid,uuid,text,text,text,bytea) from public,anon,authenticated;
revoke all on function zt_private.assistant_authorize(uuid,text) from public,anon,authenticated;
revoke all on function public.zt_assistant_read(uuid,text,jsonb,uuid) from public,anon;
grant execute on function public.zt_assistant_read(uuid,text,jsonb,uuid) to authenticated;
