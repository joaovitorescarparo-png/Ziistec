-- Bloco 2 · Assistant Wave 2: referência ativa revalidada, edição/duplicação/arquivamento de
-- orçamento, agenda (tirar da agenda/cancelar OS), cadastro de serviço e busca no catálogo.
-- Forward-only sobre 0092/0093/0094 (não as altera).
--
-- Regras reais reutilizadas:
--   * orçamento aprovado é histórico (0044): não é alterado; pode ser duplicado;
--   * orçamento que já originou OS (work_orders.quote_id) não é alterado nem arquivado;
--   * "excluir" orçamento = arquivar por deleted_at (0066/0070), nunca DELETE físico;
--   * tirar da agenda = data/hora nulas e status unscheduled (somente OS agendada);
--   * cancelar OS = status canceled; OS concluída ou cancelada não muda (assistant_target);
--   * "mesmos valores" = snapshot dos quote_items do documento; "preço atual" = catálogo.
-- O provedor de IA só cita números de documento e nomes; IDs, preços e estado vêm daqui.
--
-- Número provisório: as migrations dos Blocos 3/4 (branch blocks-3-4-os-history-receipt,
-- 0093–0098) precisam ser renumeradas para depois desta (a partir de 0096) antes de integrar.

create or replace function zt_private.assistant_quote_status(p_status text)
returns text language sql immutable security invoker set search_path='' as $$
  select case p_status when 'draft' then 'rascunho' when 'sent' then 'enviado' when 'approved' then 'aprovado'
    when 'declined' then 'recusado' when 'expired' then 'vencido' else p_status end;
$$;

create or replace function zt_private.assistant_wo_status(p_status text)
returns text language sql immutable security invoker set search_path='' as $$
  select case p_status when 'unscheduled' then 'sem data' when 'scheduled' then 'agendada' when 'in_progress' then 'em andamento'
    when 'done' then 'concluída' when 'canceled' then 'cancelada' else p_status end;
$$;

-- Documento da própria empresa pelo número dito ("ORC-0003", "orçamento 3", "OS 7"); nunca por UUID.
create or replace function zt_private.assistant_doc_find(p_company uuid,p_kind text,p_query text)
returns uuid language plpgsql stable security invoker set search_path='' as $$
declare v_q text:=btrim(coalesce(p_query,'')); v_digits text; v_ids uuid[];
begin
  if v_q ~* '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' then return null; end if;
  v_digits:=ltrim(regexp_replace(v_q,'\D','','g'),'0');
  if p_kind='quote' then
    select array_agg(q.id) into v_ids from public.quotes q
     where q.company_id=p_company and q.deleted_at is null
       and (lower(q.number)=lower(v_q) or (v_digits<>'' and ltrim(regexp_replace(q.number,'\D','','g'),'0')=v_digits));
  elsif p_kind='work_order' then
    select array_agg(w.id) into v_ids from public.work_orders w
     where w.company_id=p_company and w.deleted_at is null
       and (lower(w.number)=lower(v_q) or (v_digits<>'' and ltrim(regexp_replace(w.number,'\D','','g'),'0')=v_digits));
  else
    raise exception 'Tipo de documento inválido' using errcode='22023';
  end if;
  return case when cardinality(v_ids)=1 then v_ids[1] end;
end $$;

-- Contrato de alterar/duplicar orçamento: número do documento + mudanças ditas pelo usuário.
create or replace function zt_private.assistant_validate_quote_change(p_action text,p_input jsonb)
returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare
  v_out jsonb:='{}'::jsonb; k text; v jsonb; t text; v_num numeric;
  v_allowed text[]:=case when p_action='owner_update_quote' then array['quote','items','discount','surcharge','notes']
    else array['quote','client','clientRef','items','prices','discount','surcharge','notes'] end;
  v_uuid constant text:='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  if p_input is null or jsonb_typeof(p_input)<>'object' or octet_length(p_input::text)>24000 then
    raise exception 'Argumentos inválidos' using errcode='22023';
  end if;
  if not p_input ? 'quote' then raise exception 'Informe o orçamento' using errcode='22023'; end if;
  for k,v in select * from jsonb_each(p_input) loop
    if not k=any(v_allowed) then raise exception 'Campo não permitido: %',k using errcode='22023'; end if;
    if k in ('discount','surcharge') then
      if jsonb_typeof(v)<>'number' then raise exception 'Valor numérico inválido' using errcode='22023'; end if;
      v_num:=(v::text)::numeric;
      if v_num<0 or v_num>999999.99 or v_num<>round(v_num,2) then raise exception 'Valor fora dos limites' using errcode='22023'; end if;
      v_out:=v_out||jsonb_build_object(k,v_num);
    elsif k='items' then
      -- Mesmo contrato de itens do orçamento novo (nome, quantidade, unidade, preço dito, escolha).
      v_out:=v_out||jsonb_build_object('items',zt_private.assistant_validate_quote(jsonb_build_object('client','-','items',v))->'items');
    else
      if jsonb_typeof(v)<>'string' then raise exception 'Texto inválido: %',k using errcode='22023'; end if;
      t:=btrim(p_input->>k);
      if k='clientRef' then
        if t !~ v_uuid then raise exception 'Escolha inválida' using errcode='22023'; end if;
      elsif k='prices' then
        if t not in ('same','current') then raise exception 'Opção de preço inválida' using errcode='22023'; end if;
      elsif t='' or length(t)>(case when k='notes' then 2000 else 120 end) then
        raise exception 'Texto vazio ou muito longo: %',k using errcode='22023';
      end if;
      v_out:=v_out||jsonb_build_object(k,t);
    end if;
  end loop;
  if p_action='owner_update_quote' and not v_out ?| array['items','discount','surcharge','notes'] then
    raise exception 'Diga o que deve mudar no orçamento' using errcode='22023';
  end if;
  return v_out;
end $$;

-- Motivo para não alterar/arquivar o documento (null = permitido). Duplicar é sempre possível.
create or replace function zt_private.assistant_quote_block(p_company uuid,p_quote uuid,p_action text)
returns text language plpgsql stable security invoker set search_path='' as $$
declare q public.quotes%rowtype; v_wo text;
begin
  select * into q from public.quotes where id=p_quote and company_id=p_company;
  if not found or q.deleted_at is not null then return 'Este orçamento não está mais disponível.'; end if;
  if p_action='owner_duplicate_quote' then return null; end if;
  select w.number into v_wo from public.work_orders w
   where w.quote_id=q.id and w.company_id=p_company and w.deleted_at is null order by w.created_at limit 1;
  if v_wo is not null then
    return format('O %s já originou a %s e não pode ser alterado nem arquivado. Posso duplicar como um novo orçamento.',q.number,v_wo);
  end if;
  if q.status='approved' and p_action='owner_update_quote' then
    return format('O %s está aprovado e não pode ser alterado. Posso duplicar como um novo orçamento.',q.number);
  end if;
  return null;
end $$;

-- Prévia de alterar/duplicar/arquivar: {question[,options]} ou {resolved, preview}. Não grava nada.
create or replace function zt_private.assistant_quote_change(p_company uuid,p_action text,p_input jsonb)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare
  q public.quotes%rowtype; v_id uuid; v_block text; v_client_name text; v_client_id uuid; v_match jsonb;
  v_src jsonb; v_item jsonb; v_line jsonb; v_cand jsonb; v_exact jsonb; v_catalog jsonb; v_lines jsonb:='[]'::jsonb;
  v_used text[]:='{}'; v_idx integer:=0; v_ref uuid; v_name text; v_qty numeric(12,3); v_price numeric(12,2); v_active boolean;
  v_prices text:=coalesce(p_input->>'prices','same'); v_subtotal numeric(12,2):=0; v_before numeric(12,2):=0;
  v_discount numeric(12,2); v_surcharge numeric(12,2); v_total numeric(12,2); v_preview jsonb; v_pos bigint;
begin
  v_id:=zt_private.assistant_doc_find(p_company,'quote',p_input->>'quote');
  if v_id is null then
    return jsonb_build_object('question',format('Não encontrei o orçamento "%s". Informe o número, por exemplo ORC-0003.',left(p_input->>'quote',40)));
  end if;
  select * into q from public.quotes where id=v_id and company_id=p_company;
  v_block:=zt_private.assistant_quote_block(p_company,q.id,p_action);
  if v_block is not null then return jsonb_build_object('question',v_block); end if;
  select c.name into v_client_name from public.clients c where c.id=q.client_id and c.company_id=p_company;

  if p_action='owner_archive_quote' then
    return jsonb_build_object('resolved',jsonb_build_object('quote',q.number,'quoteId',q.id,'version',q.updated_at::text),
      'preview',jsonb_build_array(jsonb_build_object('label','Orçamento','value',q.number),
        jsonb_build_object('label','Cliente','value',v_client_name),
        jsonb_build_object('label','Situação','value',zt_private.assistant_quote_status(q.status::text)),
        jsonb_build_object('label','Ação','value','Arquivar: o orçamento sai das listas ativas e o histórico é preservado.')));
  end if;

  -- Snapshot comercial do documento: nome, unidade, quantidade e valor (o custo fica no banco).
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('sourceItemId',i.id,'kind',i.kind,'productId',i.product_id,
      'serviceId',i.service_id,'name',i.name,'unit',i.unit,'quantity',i.quantity,'unitPrice',i.unit_price)) order by i.position,i.id),'[]'::jsonb)
    into v_src from public.quote_items i where i.quote_id=q.id and i.company_id=p_company;
  select coalesce(sum(round((s->>'quantity')::numeric*(s->>'unitPrice')::numeric,2)),0) into v_before from jsonb_array_elements(v_src) s;

  v_client_id:=q.client_id;
  if p_action='owner_duplicate_quote' and p_input ? 'client' then
    v_match:=zt_private.assistant_match(p_company,'client',p_input->>'client',nullif(p_input->>'clientRef','')::uuid);
    if v_match ? 'options' then
      return jsonb_build_object('question',format('Encontrei mais de um cliente para "%s". Qual deles?',left(p_input->>'client',80)),
        'options',(select jsonb_agg(jsonb_build_object('label',o->>'label','slot','client','ref',o->>'id')) from jsonb_array_elements(v_match->'options') o));
    elsif v_match ? 'none' then
      return jsonb_build_object('question',format('Não encontrei o cliente "%s". Confira o nome ou cadastre o cliente antes.',left(p_input->>'client',80)));
    end if;
    v_client_id:=(v_match#>>'{match,id}')::uuid; v_client_name:=v_match#>>'{match,name}';
  end if;

  -- Itens finais. Sem lista: o documento inteiro. Com lista: cada item casa com uma linha do
  -- documento (mesmo valor) ou é resolvido no catálogo como item novo; o que ficar de fora sai.
  for v_item in select value from jsonb_array_elements(coalesce(p_input->'items',
      (select jsonb_agg(jsonb_build_object('name',s->>'name','quantity',(s->>'quantity')::numeric,'ref',s->>'sourceItemId')) from jsonb_array_elements(v_src) s))) loop
    v_name:=v_item->>'name'; v_qty:=(v_item->>'quantity')::numeric; v_ref:=nullif(v_item->>'ref','')::uuid;
    select coalesce(jsonb_agg(s),'[]'::jsonb) into v_cand from jsonb_array_elements(v_src) s
     where not ((s->>'sourceItemId')=any(v_used))
       and (case when v_ref is not null then (s->>'sourceItemId')::uuid=v_ref
         else (v_item->>'kind' is null or s->>'kind'=v_item->>'kind')
           and (zt_private.assistant_fold(s->>'name')=zt_private.assistant_fold(v_name) or zt_private.assistant_name_matches(s->>'name',v_name)) end);
    select coalesce(jsonb_agg(s),'[]'::jsonb) into v_exact from jsonb_array_elements(v_cand) s
     where zt_private.assistant_fold(s->>'name')=zt_private.assistant_fold(v_name);
    if jsonb_array_length(v_exact)=0 then
      -- 'câmera' prefere a linha que começa por câmera, não 'Instalação de câmera'.
      select coalesce(jsonb_agg(s),'[]'::jsonb) into v_exact from jsonb_array_elements(v_cand) s
       where zt_private.assistant_fold(s->>'name') like regexp_replace(split_part(btrim(zt_private.assistant_fold(v_name)),' ',1),'(oes|aes|es|s)$','')||'%';
    end if;
    if jsonb_array_length(v_exact)=1 then v_cand:=v_exact; end if;
    if jsonb_array_length(v_cand)>1 then
      return jsonb_build_object('question',format('O %s tem mais de um item compatível com "%s". Qual deles?',q.number,left(v_name,80)),
        'options',(select jsonb_agg(jsonb_build_object('label',concat_ws(' · ',x.s->>'name',zt_private.assistant_money((x.s->>'unitPrice')::numeric)),
          'slot','item:'||v_idx,'ref',x.s->>'sourceItemId')) from (select s from jsonb_array_elements(v_cand) s limit 6) x));
    elsif jsonb_array_length(v_cand)=1 then
      v_line:=v_cand->0; v_used:=v_used||(v_line->>'sourceItemId');
      v_active:=true; v_price:=null;
      if v_line ? 'productId' then
        select (p.active and p.deleted_at is null),p.price into v_active,v_price from public.products p
         where p.id=(v_line->>'productId')::uuid and p.company_id=p_company;
      elsif v_line ? 'serviceId' then
        select (s.active and s.deleted_at is null),s.price into v_active,v_price from public.services s
         where s.id=(v_line->>'serviceId')::uuid and s.company_id=p_company;
      end if;
      if p_action='owner_duplicate_quote' and not coalesce(v_active,false) then
        return jsonb_build_object('question',format('"%s" não está mais ativo no catálogo e não pode entrar em um novo orçamento. Remova o item ou informe como item livre com preço.',left(v_line->>'name',80)));
      end if;
      v_line:=jsonb_strip_nulls(jsonb_build_object('kind',v_line->>'kind','productId',v_line->>'productId','serviceId',v_line->>'serviceId',
        'sourceItemId',v_line->>'sourceItemId','name',v_line->>'name','unit',coalesce(v_item->>'unit',v_line->>'unit'),'quantity',v_qty,
        'unitPrice',(v_line->>'unitPrice')::numeric,'origin','snapshot','sourcePrice',(v_line->>'unitPrice')::numeric));
      if v_item ? 'unitPrice' then
        v_line:=v_line||jsonb_build_object('unitPrice',(v_item->>'unitPrice')::numeric,'origin','informed');
      elsif v_prices='current' and v_line->>'kind'<>'free' then
        if not coalesce(v_active,false) then
          return jsonb_build_object('question',format('"%s" não está mais ativo no catálogo, então não há preço atual. Use os mesmos valores ou remova o item.',left(v_line->>'name',80)));
        end if;
        v_line:=v_line||jsonb_build_object('unitPrice',v_price,'origin','catalog');
      end if;
    else
      -- Item novo: mesma resolução de catálogo do orçamento novo (ambiguidade vira pergunta).
      v_catalog:=zt_private.assistant_quote_resolve(p_company,jsonb_build_object('client',q.client_id::text,'items',jsonb_build_array(v_item)));
      if v_catalog ? 'question' then
        return jsonb_strip_nulls(jsonb_build_object('question',v_catalog->>'question','options',
          (select jsonb_agg(o||jsonb_build_object('slot','item:'||v_idx)) from jsonb_array_elements(v_catalog->'options') o)));
      end if;
      v_line:=v_catalog#>'{resolved,items,0}';
    end if;
    v_lines:=v_lines||jsonb_build_array(v_line);
    v_subtotal:=v_subtotal+round((v_line->>'quantity')::numeric*(v_line->>'unitPrice')::numeric,2);
    v_idx:=v_idx+1;
  end loop;
  v_discount:=coalesce((p_input->>'discount')::numeric,q.discount);
  v_surcharge:=coalesce((p_input->>'surcharge')::numeric,q.surcharge);
  v_total:=round(greatest(0,v_subtotal-v_discount+v_surcharge),2);

  v_preview:=jsonb_build_array(
    jsonb_build_object('label',case when p_action='owner_update_quote' then 'Orçamento' else 'Novo orçamento a partir de' end,'value',q.number),
    jsonb_build_object('label','Cliente','value',v_client_name));
  for v_line,v_pos in select value,ordinality from jsonb_array_elements(v_lines) with ordinality loop
    v_preview:=v_preview||jsonb_build_array(jsonb_build_object('label','Item '||v_pos,'value',format('%s × %s — %s cada = %s · %s',
      zt_private.assistant_qty((v_line->>'quantity')::numeric),v_line->>'name',zt_private.assistant_money((v_line->>'unitPrice')::numeric),
      zt_private.assistant_money(round((v_line->>'quantity')::numeric*(v_line->>'unitPrice')::numeric,2)),
      case v_line->>'origin' when 'snapshot' then 'mesmo valor do '||q.number when 'catalog' then 'preço do catálogo'
        else case when v_line->>'kind'='free' and not v_line ? 'sourceItemId' then 'item livre, preço informado' else 'preço informado' end end)));
  end loop;
  if p_action='owner_update_quote' then
    for v_line in select value from jsonb_array_elements(v_src) where not ((value->>'sourceItemId')=any(v_used)) loop
      v_preview:=v_preview||jsonb_build_array(jsonb_build_object('label','Removido','value',v_line->>'name'));
    end loop;
  end if;
  v_preview:=v_preview||jsonb_build_array(jsonb_build_object('label','Subtotal','value',zt_private.assistant_money(v_subtotal)));
  if v_discount>0 then
    v_preview:=v_preview||jsonb_build_array(jsonb_build_object('label','Desconto','value',zt_private.assistant_money(v_discount)));
  end if;
  if v_surcharge>0 then
    v_preview:=v_preview||jsonb_build_array(jsonb_build_object('label','Acréscimo','value',zt_private.assistant_money(v_surcharge)));
  end if;
  v_preview:=v_preview||jsonb_build_array(jsonb_build_object('label','Total','value',zt_private.assistant_money(v_total)));
  if p_action='owner_update_quote' then
    v_preview:=v_preview||jsonb_build_array(jsonb_build_object('label','Total anterior','value',
      zt_private.assistant_money(round(greatest(0,v_before-q.discount+q.surcharge),2))));
  else
    v_preview:=v_preview||jsonb_build_array(jsonb_build_object('label','Valores','value',
      case when v_prices='current' then 'preço atual do catálogo' else 'mesmos valores do '||q.number end));
  end if;
  if p_input ? 'notes' then
    v_preview:=v_preview||jsonb_build_array(jsonb_build_object('label','Observações','value',p_input->>'notes'));
  end if;
  return jsonb_build_object('preview',v_preview,'resolved',jsonb_strip_nulls(jsonb_build_object(
    'quote',q.number,'quoteId',case when p_action='owner_update_quote' then q.id end,
    'sourceQuoteId',case when p_action='owner_duplicate_quote' then q.id end,'version',q.updated_at::text,
    'client',v_client_name,'clientId',case when p_action='owner_duplicate_quote' then v_client_id end,'prices',case when p_action='owner_duplicate_quote' then v_prices end,
    'items',v_lines,'discount',v_discount,'surcharge',v_surcharge,'notes',p_input->>'notes','subtotal',v_subtotal,'total',v_total)));
end $$;

-- Confirmação de alterar/duplicar/arquivar: revalida documento, estado, versão e catálogo e grava
-- pelo caminho canônico (zt_save_quote_idempotent) ou arquiva por deleted_at.
create or replace function zt_private.assistant_quote_apply(p_company uuid,p_action text,p_operation uuid,p_client uuid,p_input jsonb)
returns uuid language plpgsql volatile security invoker set search_path='' as $$
declare
  q public.quotes%rowtype; v_block text; v_line jsonb; v_items jsonb:='[]'::jsonb; v_new jsonb; v_price numeric(12,2); v_cost numeric(12,2); v_id uuid;
  v_today date:=(now() at time zone 'America/Sao_Paulo')::date;
begin
  select * into q from public.quotes
   where id=coalesce(p_input->>'quoteId',p_input->>'sourceQuoteId')::uuid and company_id=p_company for update;
  if not found or q.deleted_at is not null then raise exception 'Orçamento indisponível' using errcode='42501'; end if;
  v_block:=zt_private.assistant_quote_block(p_company,q.id,p_action);
  if v_block is not null then raise exception '%',v_block using errcode='42501'; end if;
  if q.updated_at::text is distinct from p_input->>'version' then
    raise exception 'O orçamento mudou depois da prévia' using errcode='22023';
  end if;
  if p_action='owner_archive_quote' then
    update public.quotes set deleted_at=now() where id=q.id and company_id=p_company;
    return q.id;
  end if;
  for v_line in select value from jsonb_array_elements(p_input->'items') loop
    if v_line ? 'sourceItemId' and v_line->>'origin'<>'catalog' then
      -- Mesma linha do documento: valor da prévia (snapshot ou dito) e custo do próprio snapshot.
      select i.unit_price,i.unit_cost into v_price,v_cost from public.quote_items i
       where i.id=(v_line->>'sourceItemId')::uuid and i.quote_id=q.id and i.company_id=p_company;
      if not found or v_price is distinct from (v_line->>'sourcePrice')::numeric then
        raise exception 'O orçamento mudou depois da prévia' using errcode='22023';
      end if;
      v_new:=jsonb_strip_nulls(jsonb_build_object('kind',v_line->>'kind','product_id',v_line->>'productId','service_id',v_line->>'serviceId',
        'name',v_line->>'name','unit',v_line->>'unit','quantity',(v_line->>'quantity')::numeric,
        'unit_price',(v_line->>'unitPrice')::numeric,'unit_cost',coalesce(v_cost,0)));
    else
      -- Item de catálogo (novo ou com preço atual) ou item livre: mesma conferência do orçamento novo.
      v_new:=zt_private.assistant_quote_items(p_company,jsonb_build_object('items',jsonb_build_array(v_line)))->0;
    end if;
    v_items:=v_items||jsonb_build_array(v_new);
  end loop;
  if p_action='owner_update_quote' then
    v_id:=public.zt_save_quote_idempotent(p_company,q.id,p_operation,jsonb_build_object('client_id',q.client_id,'status',q.status,
      'issue_date',q.issue_date,'valid_until',q.valid_until,'discount',(p_input->>'discount')::numeric,'surcharge',(p_input->>'surcharge')::numeric,
      'payment_terms',q.payment_terms,'notes',coalesce(p_input->>'notes',q.notes),'address',q.address,'service_place',q.service_place,
      'show_product_images',q.show_product_images),v_items);
  else
    -- Mesma trava do caminho canônico de criação: chave interna ocupada falha fechada.
    perform pg_advisory_xact_lock(hashtextextended(p_company::text||':quote:'||p_operation::text,0));
    if exists(select 1 from public.quotes where company_id=p_company and client_request_id=p_operation) then
      raise exception 'Colisão de operação interna' using errcode='23505';
    end if;
    v_id:=public.zt_save_quote_idempotent(p_company,null,p_operation,jsonb_strip_nulls(jsonb_build_object('client_id',p_client,
      'status','draft','issue_date',v_today,'discount',(p_input->>'discount')::numeric,'surcharge',(p_input->>'surcharge')::numeric,
      'payment_terms',q.payment_terms,'notes',coalesce(p_input->>'notes',q.notes),'address',q.address,'service_place',q.service_place,
      'show_product_images',q.show_product_images)),v_items);
  end if;
  return v_id;
end $$;

-- Prévia de tirar da agenda/cancelar OS: {question} ou {targetId, preview}. Não grava nada.
create or replace function zt_private.assistant_wo_change(p_company uuid,p_action text,p_input jsonb)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_ids uuid[]; v_match jsonb; w public.work_orders%rowtype; v_client text; v_list text;
begin
  if p_input ? 'workOrder' then
    v_ids:=array_remove(array[zt_private.assistant_doc_find(p_company,'work_order',p_input->>'workOrder')],null);
    if coalesce(cardinality(v_ids),0)=0 then
      return jsonb_build_object('question',format('Não encontrei a OS "%s". Informe o número, por exemplo OS-0007.',left(p_input->>'workOrder',40)));
    end if;
  else
    v_match:=zt_private.assistant_match(p_company,'client',p_input->>'client',null);
    if v_match ? 'options' then
      return jsonb_build_object('question',format('Encontrei mais de um cliente para "%s": %s. Qual deles? Informe o nome completo.',
        left(p_input->>'client',80),(select string_agg(o->>'name','; ') from jsonb_array_elements(v_match->'options') o)));
    elsif v_match ? 'none' then
      return jsonb_build_object('question',format('Não encontrei o cliente "%s".',left(p_input->>'client',80)));
    end if;
    select array_agg(x.id order by x.scheduled_date nulls last,x.scheduled_time nulls last,x.number) into v_ids
      from public.work_orders x
     where x.company_id=p_company and x.client_id=(v_match#>>'{match,id}')::uuid and x.deleted_at is null
       and (case when p_action='owner_unschedule_work_order' then x.status='scheduled' else x.status in ('unscheduled','scheduled','in_progress') end)
       and (not p_input ? 'date' or x.scheduled_date=(p_input->>'date')::date);
    if coalesce(cardinality(v_ids),0)=0 then
      return jsonb_build_object('question',case when p_action='owner_unschedule_work_order'
        then 'Não encontrei atendimento agendado desse cliente para esse pedido.' else 'Não encontrei OS aberta desse cliente para esse pedido.' end);
    elsif cardinality(v_ids)>1 then
      select string_agg(concat_ws(' ',x.number,to_char(x.scheduled_date,'DD/MM'),to_char(x.scheduled_time,'HH24:MI')),'; '
          order by x.scheduled_date nulls last,x.scheduled_time nulls last,x.number)
        into v_list from public.work_orders x where x.id=any(v_ids);
      return jsonb_build_object('question',format('Encontrei mais de uma OS: %s. Qual delas? Informe o número.',v_list));
    end if;
  end if;
  select * into w from public.work_orders where id=v_ids[1] and company_id=p_company;
  if w.status in ('done','canceled') then
    return jsonb_build_object('question',format('A %s já está %s.',w.number,zt_private.assistant_wo_status(w.status::text)));
  end if;
  if p_action='owner_unschedule_work_order' and w.status<>'scheduled' then
    return jsonb_build_object('question',format('A %s não está agendada (%s). Para encerrar o serviço, peça para cancelar a OS.',
      w.number,zt_private.assistant_wo_status(w.status::text)));
  end if;
  select c.name into v_client from public.clients c where c.id=w.client_id and c.company_id=p_company;
  return jsonb_build_object('targetId',w.id,'preview',jsonb_build_array(
    jsonb_build_object('label','OS','value',w.number),
    jsonb_build_object('label','Cliente','value',v_client),
    jsonb_build_object('label','Agendamento atual','value',coalesce(nullif(concat_ws(' ',to_char(w.scheduled_date,'DD/MM/YYYY'),to_char(w.scheduled_time,'HH24:MI')),''),'sem data')),
    jsonb_build_object('label','Ação','value',case when p_action='owner_unschedule_work_order'
      then 'Tirar da agenda: a OS continua aberta, sem data.' else 'Cancelar a OS: o serviço não será feito; o histórico é preservado.' end)));
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
    'owner_update_quote','owner_duplicate_quote','owner_archive_quote','owner_unschedule_work_order','owner_cancel_work_order','create_service','owner_find_product','owner_find_service']) then
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
    if p.action not in ('create_quote_draft','owner_update_quote','owner_duplicate_quote','owner_archive_quote') then x:=zt_private.assistant_validate(p.action,p.input); end if;
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
  elsif p.action='owner_archive_quote' then
    v:=jsonb_build_object('quote',p.input->>'quote');
  else
    v:=p.input;
  end if;
  return jsonb_build_object('action',p.action,'input',v);
exception when others then
  return jsonb_build_object('error','Não foi possível recuperar a prévia.','code',zt_private.assistant_error_code(sqlstate));
end $$;

-- Referência ativa da conversa ("esse orçamento", "essa OS"): o navegador só sugere tipo + id;
-- aqui se revalida usuário, empresa, papel, assinatura, existência e estado. A resposta nunca
-- traz UUID nem custo: só o que o papel pode ver e o que o planejador precisa citar.
create or replace function public.zt_assistant_reference(p_company uuid,p_type text,p_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_role text; q public.quotes%rowtype; w public.work_orders%rowtype; v_client text; v_items jsonb;
  v_sub numeric(12,2); v_block text; v_name text; v_price numeric(12,2); v_active boolean;
begin
  if auth.uid() is null then raise exception 'Sessão necessária' using errcode='28000'; end if;
  select m.role::text into v_role from public.company_members m
   where m.company_id=p_company and m.user_id=auth.uid() and m.status='active';
  if v_role is null then raise exception 'Sem acesso ativo à empresa' using errcode='42501'; end if;
  perform zt_private.assistant_subscription(p_company);
  if p_id is null then raise exception 'Referência inválida' using errcode='22023'; end if;
  if p_type='work_order' then
    select * into w from public.work_orders
     where id=p_id and company_id=p_company and deleted_at is null and (v_role='owner' or assigned_to=auth.uid());
    if not found then raise exception 'Referência indisponível' using errcode='42501'; end if;
    select c.name into v_client from public.clients c where c.id=w.client_id and c.company_id=p_company;
    return jsonb_build_object('type','work_order','label',concat_ws(' · ',w.number,v_client),'context',jsonb_strip_nulls(jsonb_build_object(
      'type','work_order','number',w.number,'client',v_client,'date',w.scheduled_date,'time',to_char(w.scheduled_time,'HH24:MI'),
      'status',zt_private.assistant_wo_status(w.status::text))));
  end if;
  if v_role<>'owner' then raise exception 'Referência indisponível' using errcode='42501'; end if;
  if p_type='quote' then
    select * into q from public.quotes where id=p_id and company_id=p_company and deleted_at is null;
    if not found then raise exception 'Referência indisponível' using errcode='42501'; end if;
    select c.name into v_client from public.clients c where c.id=q.client_id and c.company_id=p_company;
    select coalesce(jsonb_agg(jsonb_build_object('kind',i.kind,'name',i.name,'quantity',i.quantity,'unit',i.unit,'unitPrice',i.unit_price)
        order by i.position,i.id),'[]'::jsonb),coalesce(sum(round(i.quantity*i.unit_price,2)),0)
      into v_items,v_sub from public.quote_items i where i.quote_id=q.id and i.company_id=p_company;
    v_block:=zt_private.assistant_quote_block(p_company,q.id,'owner_update_quote');
    return jsonb_build_object('type','quote','label',concat_ws(' · ',q.number,v_client),'context',jsonb_strip_nulls(jsonb_build_object(
      'type','quote','number',q.number,'client',v_client,'status',zt_private.assistant_quote_status(q.status::text),
      'editable',v_block is null,'blocked',v_block,'items',v_items,'discount',q.discount,'surcharge',q.surcharge,
      'total',round(greatest(0,v_sub-q.discount+q.surcharge),2))));
  elsif p_type='client' then
    select c.name into v_name from public.clients c where c.id=p_id and c.company_id=p_company and c.deleted_at is null;
    if v_name is null then raise exception 'Referência indisponível' using errcode='42501'; end if;
    return jsonb_build_object('type','client','label',v_name,'context',jsonb_build_object('type','client','name',v_name));
  elsif p_type='product' then
    select p.name,p.price,p.active into v_name,v_price,v_active from public.products p
     where p.id=p_id and p.company_id=p_company and p.deleted_at is null;
    if v_name is null then raise exception 'Referência indisponível' using errcode='42501'; end if;
    return jsonb_build_object('type','product','label',v_name,'context',jsonb_build_object('type','product','name',v_name,'unitPrice',v_price,'active',v_active));
  elsif p_type='service' then
    select s.name,s.price,s.active into v_name,v_price,v_active from public.services s
     where s.id=p_id and s.company_id=p_company and s.deleted_at is null;
    if v_name is null then raise exception 'Referência indisponível' using errcode='42501'; end if;
    return jsonb_build_object('type','service','label',v_name,'context',jsonb_build_object('type','service','name',v_name,'unitPrice',v_price,'active',v_active));
  end if;
  raise exception 'Tipo de referência inválido' using errcode='22023';
exception when others then
  return jsonb_build_object('error','A referência não está mais disponível.','code',zt_private.assistant_error_code(sqlstate));
end $$;

revoke all on function zt_private.assistant_quote_status(text) from public,anon,authenticated;
revoke all on function zt_private.assistant_wo_status(text) from public,anon,authenticated;
revoke all on function zt_private.assistant_doc_find(uuid,text,text) from public,anon,authenticated;
revoke all on function zt_private.assistant_validate_quote_change(text,jsonb) from public,anon,authenticated;
revoke all on function zt_private.assistant_quote_block(uuid,uuid,text) from public,anon,authenticated;
revoke all on function zt_private.assistant_quote_change(uuid,text,jsonb) from public,anon,authenticated;
revoke all on function zt_private.assistant_quote_apply(uuid,text,uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function zt_private.assistant_wo_change(uuid,text,jsonb) from public,anon,authenticated;
revoke all on function zt_private.assistant_audit(uuid,uuid,text,text,text,bytea) from public,anon,authenticated;
revoke all on function zt_private.assistant_authorize(uuid,text) from public,anon,authenticated;
revoke all on function zt_private.assistant_validate(text,jsonb) from public,anon,authenticated;
revoke all on function public.zt_assistant_plan(uuid,text,jsonb,uuid) from public,anon;
revoke all on function public.zt_assistant_execute(uuid,uuid,text) from public,anon;
revoke all on function public.zt_assistant_plan_context(uuid,uuid) from public,anon;
revoke all on function public.zt_assistant_reference(uuid,text,uuid) from public,anon;
grant execute on function public.zt_assistant_plan(uuid,text,jsonb,uuid) to authenticated;
grant execute on function public.zt_assistant_execute(uuid,uuid,text) to authenticated;
grant execute on function public.zt_assistant_plan_context(uuid,uuid) to authenticated;
grant execute on function public.zt_assistant_reference(uuid,text,uuid) to authenticated;
