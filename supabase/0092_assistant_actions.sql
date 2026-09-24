-- Assistente MVP: a model proposes; the database authorizes, previews and executes.
-- No changes to the existing commercial /api/ai owner-only contract.
create table public.assistant_action_audit (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  actor_user_id uuid not null references auth.users(id),
  action text not null,
  target_type text,
  target_id uuid,
  request_id uuid not null,
  success boolean not null,
  created_at timestamptz not null default now(),
  unique(company_id,actor_user_id,request_id)
);
alter table public.assistant_action_audit enable row level security;
revoke all on public.assistant_action_audit from public,anon,authenticated;
grant select on public.assistant_action_audit to authenticated;
create policy assistant_audit_owner_select on public.assistant_action_audit
for select to authenticated using (public.zt_is_owner(company_id));

-- Pending arguments contain operational data, never the original transcript.
-- They are not exposed by the Data API and are scrubbed on completion/expiry.
create table zt_private.assistant_plans (
  company_id uuid not null references public.companies(id),
  actor_user_id uuid not null references auth.users(id),
  request_id uuid not null,
  action text not null,
  input_hash bytea not null,
  input jsonb,
  preview jsonb,
  target_id uuid,
  client_id uuid,
  state text not null default 'pending' check (state in ('pending','succeeded','failed','expired')),
  result jsonb,
  expires_at timestamptz not null default now()+interval '30 minutes',
  created_at timestamptz not null default now(),
  primary key(company_id,actor_user_id,request_id)
);
alter table zt_private.assistant_plans enable row level security;
revoke all on zt_private.assistant_plans from public,anon,authenticated;

create function zt_private.assistant_authorize(p_company uuid,p_action text)
returns text language plpgsql security definer set search_path='' as $$
declare v_role text;
begin
  if auth.uid() is null then raise exception 'Sessão necessária' using errcode='28000'; end if;
  select m.role::text into v_role from public.company_members m
  where m.company_id=p_company and m.user_id=auth.uid() and m.status='active' for share;
  if v_role is null then raise exception 'Sem acesso ativo à empresa' using errcode='42501'; end if;
  if p_action = any(array['owner_today_schedule','owner_find_client','owner_find_quote','owner_find_work_order',
    'create_client','create_quote_draft','create_work_order','schedule_work_order','create_product','create_financial_entry']) then
    if v_role<>'owner' then raise exception 'Ação exclusiva do proprietário' using errcode='42501'; end if;
  elsif p_action = any(array['technician_today_orders','technician_open_assigned_order','add_assigned_work_report',
    'mark_assigned_order_pending','mark_assigned_order_return','finalize_assigned_work_order']) then
    if v_role<>'technician' then raise exception 'Ação exclusiva do técnico atribuído' using errcode='42501'; end if;
  else raise exception 'Ação desconhecida' using errcode='22023';
  end if;
  return v_role;
end $$;

create function zt_private.assistant_subscription(p_company uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.subscriptions s where s.company_id=p_company
    and s.status in ('trial','active') and (s.current_period_end is null
      or s.current_period_end >= (now() at time zone 'America/Sao_Paulo')::date)) then
    raise exception 'Assinatura sem acesso ao assistente' using errcode='42501';
  end if;
end $$;

-- A compact, closed schema repeated at the authority boundary: API validation is not authorization.
create function zt_private.assistant_validate(p_action text,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_allowed text[]; v_required text[]; k text; v jsonb; t text; v_out jsonb:=p_input;
  v_limit integer; v_num numeric;
begin
  if p_input is null or jsonb_typeof(p_input)<>'object' or octet_length(p_input::text)>24000 then
    raise exception 'Argumentos inválidos' using errcode='22023';
  end if;
  case p_action
    when 'owner_today_schedule','technician_today_orders' then v_allowed:='{}'; v_required:='{}';
    when 'owner_find_client','owner_find_quote','owner_find_work_order' then v_allowed:=array['query']; v_required:=v_allowed;
    when 'technician_open_assigned_order' then v_allowed:=array['workOrder']; v_required:=v_allowed;
    when 'create_client' then v_allowed:=array['name','phone','address']; v_required:=array['name'];
    when 'create_product' then v_allowed:=array['name','unit','price']; v_required:=array['name','price'];
    when 'create_quote_draft' then v_allowed:=array['client','description','quantity','unit','unitPrice']; v_required:=array['client','description','quantity','unitPrice'];
    when 'create_work_order' then v_allowed:=array['client','description','address']; v_required:=array['client','description'];
    when 'schedule_work_order' then v_allowed:=array['workOrder','date','time']; v_required:=v_allowed;
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
        or v_num>case when k='quantity' then 10000 when k='amount' then 999999999.99 else 999999.99 end
        or (k<>'quantity' and v_num<>round(v_num,2)) then
        raise exception 'Valor fora dos limites' using errcode='22023';
      end if;
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

create function zt_private.assistant_resolve(p_company uuid,p_kind text,p_query text,p_technician boolean default false)
returns uuid language plpgsql security definer set search_path='' as $$
declare ids uuid[];
begin
  if p_kind='client' and not p_technician then
    select array_agg(c.id) into ids from public.clients c where c.company_id=p_company and c.deleted_at is null
      and (c.id::text=p_query or lower(c.name)=lower(p_query) or lower(c.trade_name)=lower(p_query));
  elsif p_kind='work_order' then
    select array_agg(w.id) into ids from public.work_orders w where w.company_id=p_company and w.deleted_at is null
      and (not p_technician or w.assigned_to=auth.uid())
      and (w.id::text=p_query or lower(w.number)=lower(p_query)
        or regexp_replace(lower(w.number),'[^0-9]','','g')=regexp_replace(lower(p_query),'^(os[ -]*)?','','g'));
  else raise exception 'Tipo de busca inválido' using errcode='22023'; end if;
  if coalesce(cardinality(ids),0)<>1 then raise exception 'Registro ausente ou ambíguo. Use o identificador exato.' using errcode='22023'; end if;
  return ids[1];
end $$;

create function zt_private.assistant_target(p_company uuid,p_action text,p_target uuid,p_closed_ok boolean default false)
returns void language plpgsql security definer set search_path='' as $$
declare w public.work_orders%rowtype;
begin
  if p_target is null then return; end if;
  select * into w from public.work_orders where id=p_target and company_id=p_company and deleted_at is null for update;
  if not found or (p_action like '%assigned%' and w.assigned_to is distinct from auth.uid()) then
    raise exception 'OS não permitida' using errcode='42501';
  end if;
  if not p_closed_ok and w.status in ('done','canceled') then raise exception 'OS encerrada' using errcode='42501'; end if;
end $$;

create function public.zt_assistant_plan(p_company uuid,p_action text,p_input jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_role text; v_input jsonb; v_hash bytea; v_plan zt_private.assistant_plans%rowtype;
  v_target uuid; v_client uuid; v_preview jsonb:='[]'; v_items jsonb; v_result jsonb; k text; t text;
  v_today date:=(now() at time zone 'America/Sao_Paulo')::date;
begin
  v_role:=zt_private.assistant_authorize(p_company,p_action);
  if p_request_id is null then raise exception 'Identificador da tentativa obrigatório' using errcode='22023'; end if;
  v_input:=zt_private.assistant_validate(p_action,p_input);
  v_hash:=sha256(convert_to(p_action||':'||v_input::text,'UTF8'));
  perform pg_advisory_xact_lock(hashtextextended(p_company::text||':'||auth.uid()::text||':'||p_request_id::text,0));
  -- Scrub expired operational input; retain identifiers/digests to prevent key reuse.
  update zt_private.assistant_plans set input=null,preview=null,state='expired'
    where company_id=p_company and actor_user_id=auth.uid() and state='pending' and expires_at<now();
  select * into v_plan from zt_private.assistant_plans where company_id=p_company and actor_user_id=auth.uid() and request_id=p_request_id for update;
  if found then
    if v_plan.action<>p_action or v_plan.input_hash<>v_hash then raise exception 'Identificador já usado em outra ação' using errcode='23505'; end if;
    perform zt_private.assistant_target(p_company,p_action,v_plan.target_id,true);
    if v_plan.state='expired' then raise exception 'Prévia expirada. Prepare uma nova ação.' using errcode='22023'; end if;
    if v_plan.state<>'pending' then return v_plan.result; end if;
    return jsonb_build_object('requestId',p_request_id,'action',p_action,'input',v_plan.input,'preview',v_plan.preview,'confirmationRequired',true);
  end if;
  if p_action in ('owner_today_schedule','technician_today_orders','owner_find_work_order','technician_open_assigned_order') then
    if p_action='technician_open_assigned_order' then v_target:=zt_private.assistant_resolve(p_company,'work_order',v_input->>'workOrder',true); end if;
    select coalesce(jsonb_agg(q.item),'[]') into v_items from (
      select jsonb_build_object('id',w.id,'entityType','work_order','number',w.number,'title',w.number,
        'detail',concat_ws(' · ',w.status::text,w.scheduled_date::text,w.scheduled_time::text,w.address,w.request)) item
      from public.work_orders w where w.company_id=p_company and w.deleted_at is null
        and (v_role='owner' or w.assigned_to=auth.uid())
        and (case when p_action in ('owner_today_schedule','technician_today_orders') then w.scheduled_date=v_today
          when p_action='technician_open_assigned_order' then w.id=v_target
          else w.id::text=v_input->>'query' or position(lower(v_input->>'query') in lower(w.number))>0 end)
      order by w.scheduled_date,w.scheduled_time,w.number limit 20
    ) q;
  elsif p_action='owner_find_client' then
    select coalesce(jsonb_agg(q.item),'[]') into v_items from (
      select jsonb_build_object('id',c.id,'entityType','client','title',c.name,'detail',concat_ws(' · ',c.phone,c.address)) item
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
    return jsonb_build_object('requestId',p_request_id,'action',p_action,'confirmationRequired',false,
      'result',jsonb_build_object('items',v_items,'message','Consulta concluída. Até 20 resultados.'));
  end if;
  perform zt_private.assistant_subscription(p_company);
  if v_input ? 'client' then v_client:=zt_private.assistant_resolve(p_company,'client',v_input->>'client'); end if;
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
  if p_action='create_quote_draft' then
    v_preview:=v_preview||jsonb_build_array(jsonb_build_object('label','Total (R$)','value',round((v_input->>'quantity')::numeric*(v_input->>'unitPrice')::numeric,2)::text));
  end if;
  insert into zt_private.assistant_plans(company_id,actor_user_id,request_id,action,input_hash,input,preview,target_id,client_id)
  values(p_company,auth.uid(),p_request_id,p_action,v_hash,v_input,v_preview,v_target,v_client);
  return jsonb_build_object('requestId',p_request_id,'action',p_action,'input',v_input,'preview',v_preview,'confirmationRequired',true);
end $$;

create function public.zt_assistant_execute(p_company uuid,p_request_id uuid)
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
  if p.state in ('succeeded','failed') then return p.result; end if;
  if p.state='expired' or p.expires_at<now() then
    update zt_private.assistant_plans set input=null,preview=null,state='expired' where company_id=p_company and actor_user_id=auth.uid() and request_id=p_request_id;
    return jsonb_build_object('error','Prévia expirada. Prepare uma nova ação.');
  end if;
  -- Catch inside a subtransaction: any partial canonical write rolls back before audit persists.
  begin
    perform zt_private.assistant_target(p_company,p.action,p.target_id);
    if p.client_id is not null and not exists(select 1 from public.clients where id=p.client_id and company_id=p_company and deleted_at is null) then
      raise exception 'Cliente não está mais disponível' using errcode='42501';
    end if;
    x:=zt_private.assistant_validate(p.action,p.input);
    case p.action
      when 'create_client' then
        insert into public.clients(company_id,name,phone,address) values(p_company,x->>'name',nullif(x->>'phone',''),nullif(x->>'address','')) returning id into v_id;
        v_type:='client';
      when 'create_product' then
        insert into public.products(company_id,name,unit,price,cost,active) values(p_company,x->>'name',x->>'unit',(x->>'price')::numeric,0,true) returning id into v_id;
        v_type:='product';
      when 'create_quote_draft' then
        v_id:=public.zt_save_quote_idempotent(p_company,null,p_request_id,
          jsonb_build_object('client_id',p.client_id,'status','draft','issue_date',v_today),
          jsonb_build_array(jsonb_build_object('kind','free','name',x->>'description','quantity',(x->>'quantity')::numeric,
            'unit',x->>'unit','unit_price',(x->>'unitPrice')::numeric,'unit_cost',0)));
        select number into v_number from public.quotes where id=v_id; v_type:='quote';
      when 'create_work_order' then
        v_id:=public.zt_save_work_order_idempotent(p_company,null,p_request_id,
          jsonb_build_object('client_id',p.client_id,'request',x->>'description','address',x->>'address','status','unscheduled'),'[]');
        select number into v_number from public.work_orders where id=v_id; v_type:='work_order';
      when 'create_financial_entry' then
        v_id:=public.zt_save_manual_financial_entry(p_company,null,p_request_id,jsonb_build_object(
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
        perform public.zt_mark_work_order_needs_return(p.target_id,x->>'reason',null,null,'normal',null,p_request_id);
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
    v_result:=jsonb_build_object('error','Não foi possível executar a ação. Confira o registro e prepare uma nova tentativa.');
  end;
  insert into public.assistant_action_audit(company_id,actor_user_id,action,target_type,target_id,request_id,success)
    values(p_company,auth.uid(),p.action,v_type,coalesce(v_id,p.target_id),p_request_id,not(v_result ? 'error'));
  update zt_private.assistant_plans set input=null,preview=null,result=v_result,
    state=case when v_result ? 'error' then 'failed' else 'succeeded' end
    where company_id=p_company and actor_user_id=auth.uid() and request_id=p_request_id;
  return v_result;
end $$;

create function public.zt_assistant_consume_ai_quota(p_company uuid)
returns uuid language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not public.zt_is_member(p_company) then raise exception 'Sem acesso ativo' using errcode='42501'; end if;
  perform zt_private.assistant_subscription(p_company);
  perform pg_advisory_xact_lock(hashtextextended(p_company::text||':'||auth.uid()::text||':assistant_ai_quota',0));
  return public.zt_consume_ai_quota(p_company);
end $$;

revoke all on function zt_private.assistant_authorize(uuid,text) from public,anon,authenticated;
revoke all on function zt_private.assistant_subscription(uuid) from public,anon,authenticated;
revoke all on function zt_private.assistant_validate(text,jsonb) from public,anon,authenticated;
revoke all on function zt_private.assistant_resolve(uuid,text,text,boolean) from public,anon,authenticated;
revoke all on function zt_private.assistant_target(uuid,text,uuid,boolean) from public,anon,authenticated;
revoke all on function public.zt_assistant_plan(uuid,text,jsonb,uuid) from public,anon;
revoke all on function public.zt_assistant_execute(uuid,uuid) from public,anon;
revoke all on function public.zt_assistant_consume_ai_quota(uuid) from public,anon;
grant execute on function public.zt_assistant_plan(uuid,text,jsonb,uuid) to authenticated;
grant execute on function public.zt_assistant_execute(uuid,uuid) to authenticated;
grant execute on function public.zt_assistant_consume_ai_quota(uuid) to authenticated;
