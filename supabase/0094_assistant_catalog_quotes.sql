-- Bloco 2 · Assistant: orçamento em linguagem natural resolvido no catálogo do tenant e
-- ajustes de uma prévia ainda não confirmada. Forward-only sobre 0092/0093 (não as altera).
--
-- O provedor de IA só propõe nomes, quantidades e preços ditos pelo usuário. Este banco:
--   * resolve cliente, produtos e serviços ativos da própria empresa por nome (sem acento/caixa);
--   * usa ID e preço reais do catálogo; preço diferente só quando informado explicitamente;
--   * devolve pergunta com opções quando há mais de um registro compatível ou nenhum;
--   * grava o orçamento somente na confirmação da prévia, uma vez, conferindo o catálogo de novo.
-- Revisar uma prévia gera nova solicitação e novo previewHash e expira a anterior, então a
-- confirmação antiga nunca vale para a prévia alterada.
--
-- Número provisório: as migrations dos Blocos 3/4 (branch blocks-3-4-os-history-receipt,
-- 0093–0098) precisam ser renumeradas para depois desta antes de qualquer integração.

-- Nome sem acento e em minúsculas, sem depender de extensões.
create or replace function zt_private.assistant_fold(p_text text)
returns text language sql immutable security invoker set search_path='' as $$
  select lower(translate(coalesce(p_text,''),
    'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ',
    'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn'));
$$;

-- Todas as palavras relevantes da busca aparecem no nome (aceita plural simples: câmeras, instalações).
create or replace function zt_private.assistant_name_matches(p_name text,p_query text)
returns boolean language sql immutable security invoker set search_path='' as $$
  select coalesce(bool_and(position(w.t in a.n)>0 or (length(w.s)>=3 and position(w.s in a.n)>0)),false)
    from (select zt_private.assistant_fold(p_name) as n) a,
    lateral (select t,regexp_replace(t,'(oes|aes|es|s)$','') as s
               from regexp_split_to_table(zt_private.assistant_fold(p_query),'[^a-z0-9]+') as t
              where length(t)>=3) w;
$$;

create or replace function zt_private.assistant_money(p_value numeric)
returns text language sql immutable security invoker set search_path='' as $$
  select 'R$ '||translate(to_char(round(coalesce(p_value,0),2),'FM999,999,990.00'),',.','.,');
$$;

create or replace function zt_private.assistant_qty(p_value numeric)
returns text language sql immutable security invoker set search_path='' as $$
  select replace(trim(trailing '.' from trim(trailing '0' from round(coalesce(p_value,0),3)::text)),'.',',');
$$;

-- Um registro do tenant por nome (ou pela escolha feita pelo usuário numa pergunta anterior;
-- cliente também pelo identificador exato, como no formato manual da 0092):
-- {match}, {none} ou {options} com no máximo 6 opções. Nunca escolhe entre homônimos.
create or replace function zt_private.assistant_match(p_company uuid,p_kind text,p_query text,p_ref uuid default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_rows jsonb; v_exact jsonb; v_q text:=btrim(coalesce(p_query,''));
begin
  if p_kind='client' then
    select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,
        'label',concat_ws(' · ',c.name,nullif(c.trade_name,''),nullif(c.phone,'')),
        'exact',c.id::text=v_q or zt_private.assistant_fold(c.name)=zt_private.assistant_fold(v_q)
          or zt_private.assistant_fold(c.trade_name)=zt_private.assistant_fold(v_q)) order by c.name,c.id),'[]'::jsonb)
      into v_rows from public.clients c
     where c.company_id=p_company and c.deleted_at is null
       and case when p_ref is not null then c.id=p_ref
         else c.id::text=v_q or zt_private.assistant_fold(c.name)=zt_private.assistant_fold(v_q)
           or zt_private.assistant_fold(c.trade_name)=zt_private.assistant_fold(v_q)
           or zt_private.assistant_name_matches(concat_ws(' ',c.name,c.trade_name),v_q) end;
  elsif p_kind='product' then
    select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'kind','product','name',p.name,'unit',p.unit,'price',p.price,
        'label',concat_ws(' · ',p.name,nullif(concat_ws(' ',p.brand,p.model),''),zt_private.assistant_money(p.price)),
        'exact',zt_private.assistant_fold(p.name)=zt_private.assistant_fold(v_q)) order by p.name,p.id),'[]'::jsonb)
      into v_rows from public.products p
     where p.company_id=p_company and p.active and p.deleted_at is null
       and case when p_ref is not null then p.id=p_ref
         else zt_private.assistant_fold(p.name)=zt_private.assistant_fold(v_q)
           or zt_private.assistant_name_matches(concat_ws(' ',p.name,p.brand,p.model),v_q) end;
  elsif p_kind='service' then
    select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'kind','service','name',s.name,'unit',s.unit,'price',s.price,
        'label',concat_ws(' · ',s.name,zt_private.assistant_money(s.price)),
        'exact',zt_private.assistant_fold(s.name)=zt_private.assistant_fold(v_q)) order by s.name,s.id),'[]'::jsonb)
      into v_rows from public.services s
     where s.company_id=p_company and s.active and s.deleted_at is null
       and case when p_ref is not null then s.id=p_ref
         else zt_private.assistant_fold(s.name)=zt_private.assistant_fold(v_q)
           or zt_private.assistant_name_matches(concat_ws(' ',s.name,s.category),v_q) end;
  else
    raise exception 'Tipo de busca inválido' using errcode='22023';
  end if;
  select coalesce(jsonb_agg(r),'[]'::jsonb) into v_exact from jsonb_array_elements(v_rows) r where (r->>'exact')::boolean;
  if jsonb_array_length(v_exact)=1 then return jsonb_build_object('match',v_exact->0); end if;
  if jsonb_array_length(v_rows)=1 then return jsonb_build_object('match',v_rows->0); end if;
  if jsonb_array_length(v_rows)=0 then return jsonb_build_object('none',true); end if;
  return jsonb_build_object('options',(select jsonb_agg(r) from (select r from jsonb_array_elements(v_rows) r limit 6) x));
end $$;

-- Contrato do orçamento: cliente + itens. O formato antigo de um item vira um item livre.
create or replace function zt_private.assistant_validate_quote(p_input jsonb)
returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare
  v_in jsonb:=p_input; v_out jsonb:='{}'::jsonb; v_items jsonb:='[]'::jsonb; v_item jsonb; v_clean jsonb;
  k text; v jsonb; t text; v_num numeric;
  v_uuid constant text:='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  if v_in is null or jsonb_typeof(v_in)<>'object' or octet_length(v_in::text)>24000 then
    raise exception 'Argumentos inválidos' using errcode='22023';
  end if;
  if v_in ?| array['description','quantity','unit','unitPrice'] then
    if v_in ? 'items' then raise exception 'Use itens ou o formato simples, não os dois' using errcode='22023'; end if;
    v_in:=(v_in-'description'-'quantity'-'unit'-'unitPrice')||jsonb_build_object('items',jsonb_build_array(jsonb_strip_nulls(
      jsonb_build_object('kind','free','name',v_in->'description','quantity',v_in->'quantity','unit',v_in->'unit','unitPrice',v_in->'unitPrice'))));
  end if;
  if not v_in ?& array['client','items'] then raise exception 'Preencha os campos obrigatórios' using errcode='22023'; end if;
  for k,v in select * from jsonb_each(v_in) loop
    if not k=any(array['client','clientRef','items','discount','surcharge','notes','servicePlace']) then
      raise exception 'Campo não permitido: %',k using errcode='22023';
    end if;
    if k in ('discount','surcharge') then
      if jsonb_typeof(v)<>'number' then raise exception 'Valor numérico inválido' using errcode='22023'; end if;
      v_num:=(v::text)::numeric;
      if v_num<0 or v_num>999999.99 or v_num<>round(v_num,2) then raise exception 'Valor fora dos limites' using errcode='22023'; end if;
      v_out:=v_out||jsonb_build_object(k,v_num);
    elsif k='items' then
      if jsonb_typeof(v)<>'array' or jsonb_array_length(v)<1 or jsonb_array_length(v)>30 then
        raise exception 'Informe de 1 a 30 itens' using errcode='22023';
      end if;
    else
      if jsonb_typeof(v)<>'string' then raise exception 'Texto inválido: %',k using errcode='22023'; end if;
      t:=btrim(v_in->>k);
      if k='clientRef' then
        if t !~ v_uuid then raise exception 'Escolha inválida' using errcode='22023'; end if;
      elsif length(t)>(case k when 'notes' then 2000 when 'servicePlace' then 500 else 120 end) or (t='' and k='client') then
        raise exception 'Texto vazio ou muito longo: %',k using errcode='22023';
      end if;
      if t<>'' then v_out:=v_out||jsonb_build_object(k,t); end if;
    end if;
  end loop;
  for v_item in select value from jsonb_array_elements(v_in->'items') loop
    if jsonb_typeof(v_item)<>'object' or not v_item ?& array['name','quantity'] then
      raise exception 'Item sem nome ou quantidade' using errcode='22023';
    end if;
    v_clean:='{}'::jsonb;
    for k,v in select * from jsonb_each(v_item) loop
      if not k=any(array['kind','name','quantity','unit','unitPrice','ref']) then
        raise exception 'Campo de item não permitido: %',k using errcode='22023';
      end if;
      if k in ('quantity','unitPrice') then
        if jsonb_typeof(v)<>'number' then raise exception 'Valor numérico inválido' using errcode='22023'; end if;
        v_num:=(v::text)::numeric;
        if k='quantity' and (v_num<=0 or v_num>10000 or v_num<>round(v_num,3)) then raise exception 'Quantidade fora dos limites' using errcode='22023'; end if;
        if k='unitPrice' and (v_num<0 or v_num>999999.99 or v_num<>round(v_num,2)) then raise exception 'Preço fora dos limites' using errcode='22023'; end if;
        v_clean:=v_clean||jsonb_build_object(k,case when k='quantity' then v_num::numeric(12,3) else v_num end);
      else
        if jsonb_typeof(v)<>'string' then raise exception 'Texto inválido no item: %',k using errcode='22023'; end if;
        t:=btrim(v_item->>k);
        if k='kind' and t not in ('product','service','free') then raise exception 'Tipo de item inválido' using errcode='22023'; end if;
        if k='ref' and t !~ v_uuid then raise exception 'Escolha inválida' using errcode='22023'; end if;
        if k='name' and (t='' or length(t)>200) then raise exception 'Nome do item vazio ou muito longo' using errcode='22023'; end if;
        if k='unit' and (t='' or length(t)>50) then raise exception 'Unidade inválida' using errcode='22023'; end if;
        v_clean:=v_clean||jsonb_build_object(k,t);
      end if;
    end loop;
    v_items:=v_items||jsonb_build_array(v_clean);
  end loop;
  return v_out||jsonb_build_object('items',v_items);
end $$;

-- Resolve o rascunho no catálogo do tenant sem gravar: {resolved} ou {question, options}.
create or replace function zt_private.assistant_quote_resolve(p_company uuid,p_input jsonb)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare
  v_client jsonb; v_match jsonb; v_product jsonb; v_service jsonb; v_item jsonb; v_kind text; v_ref uuid; v_idx integer:=0;
  v_items jsonb:='[]'::jsonb; v_options jsonb; v_line jsonb; v_price numeric(12,2); v_qty numeric(12,3);
  v_subtotal numeric(12,2):=0; v_discount numeric(12,2):=coalesce((p_input->>'discount')::numeric,0);
  v_surcharge numeric(12,2):=coalesce((p_input->>'surcharge')::numeric,0); v_name text; v_catalog text;
begin
  v_match:=zt_private.assistant_match(p_company,'client',p_input->>'client',nullif(p_input->>'clientRef','')::uuid);
  if v_match ? 'options' then
    return jsonb_build_object('question',format('Encontrei mais de um cliente para "%s". Qual deles?',left(p_input->>'client',80)),
      'options',(select jsonb_agg(jsonb_build_object('label',o->>'label','slot','client','ref',o->>'id')) from jsonb_array_elements(v_match->'options') o));
  elsif v_match ? 'none' then
    return jsonb_build_object('question',format('Não encontrei o cliente "%s". Confira o nome ou cadastre o cliente antes do orçamento.',left(p_input->>'client',80)));
  end if;
  v_client:=v_match->'match';

  for v_item in select value from jsonb_array_elements(p_input->'items') loop
    v_kind:=v_item->>'kind'; v_ref:=nullif(v_item->>'ref','')::uuid; v_qty:=(v_item->>'quantity')::numeric; v_name:=v_item->>'name';
    if v_kind='free' then
      if not v_item ? 'unitPrice' then
        return jsonb_build_object('question',format('Qual é o preço de "%s"? Itens livres não usam preço do catálogo.',left(v_name,80)));
      end if;
      v_line:=jsonb_build_object('kind','free','name',v_name,'unit',coalesce(v_item->>'unit','unidade'),'quantity',v_qty,
        'unitPrice',(v_item->>'unitPrice')::numeric,'origin','informed');
    else
      v_product:=case when v_kind is null or v_kind='product' then zt_private.assistant_match(p_company,'product',v_name,v_ref) end;
      v_service:=case when v_kind is null or v_kind='service' then zt_private.assistant_match(p_company,'service',v_name,v_ref) end;
      if v_product ? 'match' and (v_service is null or v_service ? 'none') then v_match:=v_product;
      elsif v_service ? 'match' and (v_product is null or v_product ? 'none') then v_match:=v_service;
      elsif (v_product is null or v_product ? 'none') and (v_service is null or v_service ? 'none') then v_match:=jsonb_build_object('none',true);
      else
        -- Compatível em mais de um registro (ou nos dois catálogos): o usuário escolhe.
        select jsonb_agg(o) into v_options from (
          select jsonb_build_object('label',case when v_kind is null then 'Produto: ' else '' end||(x->>'label'),'slot','item:'||v_idx,'ref',x->>'id') o
            from jsonb_array_elements(coalesce(v_product->'options',case when v_product ? 'match' then jsonb_build_array(v_product->'match') end,'[]'::jsonb)) x
          union all
          select jsonb_build_object('label',case when v_kind is null then 'Serviço: ' else '' end||(x->>'label'),'slot','item:'||v_idx,'ref',x->>'id')
            from jsonb_array_elements(coalesce(v_service->'options',case when v_service ? 'match' then jsonb_build_array(v_service->'match') end,'[]'::jsonb)) x
          limit 6) y;
        return jsonb_build_object('question',format('Encontrei mais de uma opção para "%s". Qual delas?',left(v_name,80)),'options',v_options);
      end if;
      if v_match ? 'none' then
        v_catalog:=case v_kind when 'product' then ' de produtos' when 'service' then ' de serviços' else '' end;
        return jsonb_build_object('question',format('Não encontrei "%s" no catálogo%s. Quer usar um item livre informando o preço ou cadastrar primeiro?',left(v_name,80),v_catalog));
      end if;
      v_match:=v_match->'match';
      -- Preço do catálogo, salvo override dito pelo usuário (mostrado na prévia com a origem).
      v_line:=jsonb_build_object('kind',v_match->>'kind',case when v_match->>'kind'='product' then 'productId' else 'serviceId' end,v_match->>'id',
        'name',v_match->>'name','unit',coalesce(v_item->>'unit',v_match->>'unit','unidade'),'quantity',v_qty,
        'unitPrice',coalesce((v_item->>'unitPrice')::numeric,(v_match->>'price')::numeric),
        'origin',case when v_item ? 'unitPrice' then 'informed' else 'catalog' end,'catalogPrice',(v_match->>'price')::numeric);
    end if;
    v_price:=(v_line->>'unitPrice')::numeric;
    v_subtotal:=v_subtotal+round(v_qty*v_price,2);
    v_items:=v_items||jsonb_build_array(v_line);
    v_idx:=v_idx+1;
  end loop;

  return jsonb_build_object('resolved',jsonb_strip_nulls(jsonb_build_object('client',v_client->>'name','clientId',v_client->>'id',
    'items',v_items,'discount',v_discount,'surcharge',v_surcharge,'notes',p_input->>'notes','servicePlace',p_input->>'servicePlace',
    'subtotal',v_subtotal,'total',round(greatest(0,v_subtotal-v_discount+v_surcharge),2))));
end $$;

-- Itens canônicos na confirmação: confere de novo empresa, catálogo ativo e preço da prévia.
create or replace function zt_private.assistant_quote_items(p_company uuid,p_input jsonb)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_line jsonb; v_items jsonb:='[]'::jsonb; v_price numeric(12,2); v_cost numeric(12,2);
begin
  for v_line in select value from jsonb_array_elements(p_input->'items') loop
    v_cost:=0;
    if v_line->>'kind'='product' then
      select p.price,p.cost into v_price,v_cost from public.products p
       where p.id=(v_line->>'productId')::uuid and p.company_id=p_company and p.active and p.deleted_at is null;
      if not found then raise exception 'Produto do orçamento não está mais disponível' using errcode='22023'; end if;
    elsif v_line->>'kind'='service' then
      select s.price,s.cost into v_price,v_cost from public.services s
       where s.id=(v_line->>'serviceId')::uuid and s.company_id=p_company and s.active and s.deleted_at is null;
      if not found then raise exception 'Serviço do orçamento não está mais disponível' using errcode='22023'; end if;
    end if;
    if v_line->>'origin'='catalog' and v_price is distinct from (v_line->>'unitPrice')::numeric then
      raise exception 'O preço do catálogo mudou depois da prévia' using errcode='22023';
    end if;
    v_items:=v_items||jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('kind',v_line->>'kind',
      'product_id',v_line->>'productId','service_id',v_line->>'serviceId','name',v_line->>'name','unit',v_line->>'unit',
      'quantity',(v_line->>'quantity')::numeric,'unit_price',(v_line->>'unitPrice')::numeric,'unit_cost',coalesce(v_cost,0))));
  end loop;
  return v_items;
end $$;

create or replace function zt_private.assistant_validate(p_action text,p_input jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  v_allowed text[]; v_required text[]; k text; v jsonb; t text; v_out jsonb:=p_input;
  v_limit integer; v_num numeric;
begin
  -- Orçamento tem contrato próprio com itens; o catálogo é resolvido no plano.
  if p_action='create_quote_draft' then return zt_private.assistant_validate_quote(p_input); end if;
  if p_input is null or jsonb_typeof(p_input)<>'object' or octet_length(p_input::text)>24000 then
    raise exception 'Argumentos inválidos' using errcode='22023';
  end if;
  case p_action
    when 'owner_today_schedule','technician_today_orders','owner_next_appointment','technician_next_appointment' then v_allowed:='{}'; v_required:='{}';
    when 'owner_find_client','owner_find_quote','owner_find_work_order' then v_allowed:=array['query']; v_required:=v_allowed;
    when 'technician_open_assigned_order' then v_allowed:=array['workOrder']; v_required:=v_allowed;
    when 'create_client' then v_allowed:=array['name','phone','address']; v_required:=array['name'];
    when 'create_product' then v_allowed:=array['name','unit','price']; v_required:=array['name','price'];
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
  if p_action='schedule_work_order' and (p_input ? 'workOrder')=(p_input ? 'client') then
    raise exception 'Informe somente cliente ou OS' using errcode='22023';
  end if;
  if p_action='create_financial_entry' then
    if (p_input->>'paid')::boolean then
      if not p_input ?& array['paidAt','paymentMethod'] then raise exception 'Informe a data e a forma do recebimento' using errcode='22023'; end if;
    elsif p_input ?| array['paidAt','paymentMethod'] then raise exception 'Receita pendente não possui recebimento' using errcode='22023';
    end if;
    v_out:=jsonb_set(v_out,'{category}',to_jsonb(coalesce(v_out->>'category','Serviços')));
  end if;
  if p_action in ('create_quote_draft','create_product') then v_out:=jsonb_set(v_out,'{unit}',to_jsonb(coalesce(v_out->>'unit','unidade'))); end if;
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
    if p.action<>'create_quote_draft' then x:=zt_private.assistant_validate(p.action,p.input); end if;
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

-- Contexto estruturado de uma prévia pendente do próprio usuário, para o provedor ajustar:
-- somente nomes, quantidades e preços informados. Nunca IDs, custos ou dados de contato.
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
  else
    v:=p.input;
  end if;
  return jsonb_build_object('action',p.action,'input',v);
exception when others then
  return jsonb_build_object('error','Não foi possível recuperar a prévia.','code',zt_private.assistant_error_code(sqlstate));
end $$;

-- Ajuste de uma prévia pendente: cria a nova prévia (novo requestId e previewHash) e só então
-- expira a anterior, na mesma transação. Pergunta ou erro mantêm a prévia vigente.
create or replace function public.zt_assistant_revise(p_company uuid,p_previous uuid,p_action text,p_input jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p zt_private.assistant_plans%rowtype; v_result jsonb;
begin
  if auth.uid() is null then raise exception 'Sessão necessária' using errcode='28000'; end if;
  if p_previous is null or p_request_id is null or p_previous=p_request_id then
    raise exception 'Ajuste inválido' using errcode='22023';
  end if;
  select * into p from zt_private.assistant_plans
   where company_id=p_company and actor_user_id=auth.uid() and request_id=p_previous for update;
  if not found or p.state<>'pending' or p.expires_at<=clock_timestamp() then
    return jsonb_build_object('error','A prévia anterior não está mais pendente. Faça um novo pedido.','code','PLAN_EXPIRED');
  end if;
  v_result:=public.zt_assistant_plan(p_company,p_action,p_input,p_request_id);
  if v_result ? 'previewHash' and coalesce((v_result->>'confirmationRequired')::boolean,false) then
    update zt_private.assistant_plans set input=null,preview=null,state='expired'
     where company_id=p_company and actor_user_id=auth.uid() and request_id=p_previous;
    perform zt_private.assistant_audit(p_company,p_previous,'expired','PLAN_REVISED');
  end if;
  return v_result;
exception when others then
  return jsonb_build_object('error','Não foi possível ajustar a prévia.','code',zt_private.assistant_error_code(sqlstate));
end $$;

revoke all on function zt_private.assistant_fold(text) from public,anon,authenticated;
revoke all on function zt_private.assistant_name_matches(text,text) from public,anon,authenticated;
revoke all on function zt_private.assistant_money(numeric) from public,anon,authenticated;
revoke all on function zt_private.assistant_qty(numeric) from public,anon,authenticated;
revoke all on function zt_private.assistant_match(uuid,text,text,uuid) from public,anon,authenticated;
revoke all on function zt_private.assistant_validate_quote(jsonb) from public,anon,authenticated;
revoke all on function zt_private.assistant_quote_resolve(uuid,jsonb) from public,anon,authenticated;
revoke all on function zt_private.assistant_quote_items(uuid,jsonb) from public,anon,authenticated;
revoke all on function zt_private.assistant_validate(text,jsonb) from public,anon,authenticated;
revoke all on function public.zt_assistant_plan(uuid,text,jsonb,uuid) from public,anon;
revoke all on function public.zt_assistant_execute(uuid,uuid,text) from public,anon;
revoke all on function public.zt_assistant_plan_context(uuid,uuid) from public,anon;
revoke all on function public.zt_assistant_revise(uuid,uuid,text,jsonb,uuid) from public,anon;
grant execute on function public.zt_assistant_plan(uuid,text,jsonb,uuid) to authenticated;
grant execute on function public.zt_assistant_execute(uuid,uuid,text) to authenticated;
grant execute on function public.zt_assistant_plan_context(uuid,uuid) to authenticated;
grant execute on function public.zt_assistant_revise(uuid,uuid,text,jsonb,uuid) to authenticated;
