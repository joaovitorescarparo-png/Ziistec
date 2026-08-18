-- ZiisTec: gravação atômica de orçamento, OS e compra.
-- Evita documentos parciais em queda de rede entre cabeçalho/itens/financeiro.

create or replace function zt_private.zt_save_quote(p_company uuid, p_quote uuid, p_row jsonb, p_items jsonb default '[]'::jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_uid uuid:=auth.uid(); v_id uuid; v_number text; item jsonb; pos int:=0;
begin
  if v_uid is null then raise exception 'Não autenticado' using errcode='28000'; end if;
  if not public.zt_is_owner(p_company) then raise exception 'Somente o proprietário salva orçamentos' using errcode='42501'; end if;
  if jsonb_typeof(coalesce(p_items,'[]'::jsonb)) <> 'array' then raise exception 'Itens inválidos'; end if;
  if jsonb_array_length(coalesce(p_items,'[]'::jsonb)) > 500 then raise exception 'Itens demais no orçamento'; end if;
  if p_quote is null then
    v_number:=zt_private.zt_next_number(p_company,'quote','ORC');
    insert into public.quotes(company_id,number,client_id,status,issue_date,valid_until,discount,surcharge,payment_terms,notes,address,service_place,created_by)
    values(p_company,v_number,nullif(p_row->>'client_id','')::uuid,coalesce(nullif(p_row->>'status','')::public.zt_quote_status,'draft'),coalesce(nullif(p_row->>'issue_date','')::date,current_date),nullif(p_row->>'valid_until','')::date,coalesce((p_row->>'discount')::numeric,0),coalesce((p_row->>'surcharge')::numeric,0),nullif(p_row->>'payment_terms',''),nullif(p_row->>'notes',''),nullif(p_row->>'address',''),nullif(p_row->>'service_place',''),v_uid) returning id into v_id;
  else
    select id into v_id from public.quotes where id=p_quote and company_id=p_company for update;
    if v_id is null then raise exception 'Orçamento não encontrado' using errcode='42501'; end if;
    update public.quotes set client_id=nullif(p_row->>'client_id','')::uuid,status=coalesce(nullif(p_row->>'status','')::public.zt_quote_status,status),issue_date=coalesce(nullif(p_row->>'issue_date','')::date,issue_date),valid_until=nullif(p_row->>'valid_until','')::date,discount=coalesce((p_row->>'discount')::numeric,0),surcharge=coalesce((p_row->>'surcharge')::numeric,0),payment_terms=nullif(p_row->>'payment_terms',''),notes=nullif(p_row->>'notes',''),address=nullif(p_row->>'address',''),service_place=nullif(p_row->>'service_place',''),updated_at=now() where id=v_id;
    delete from public.quote_items where quote_id=v_id;
  end if;
  for item in select value from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) loop
    insert into public.quote_items(quote_id,company_id,kind,service_id,product_id,name,unit,quantity,unit_price,unit_cost,notes,position)
    values(v_id,p_company,coalesce(nullif(item->>'kind','')::public.zt_item_kind,'free'),nullif(item->>'service_id','')::uuid,nullif(item->>'product_id','')::uuid,left(coalesce(nullif(item->>'name',''),'Item'),500),left(coalesce(nullif(item->>'unit',''),'unidade'),50),coalesce((item->>'quantity')::numeric,1),coalesce((item->>'unit_price')::numeric,0),coalesce((item->>'unit_cost')::numeric,0),nullif(item->>'notes',''),pos);
    pos:=pos+1;
  end loop;
  return v_id;
end $$;

create or replace function public.zt_save_quote(p_company uuid,p_quote uuid,p_row jsonb,p_items jsonb default '[]'::jsonb)
returns uuid language sql security definer set search_path=zt_private as $$ select zt_private.zt_save_quote(p_company,p_quote,p_row,p_items); $$;
revoke all on function public.zt_save_quote(uuid,uuid,jsonb,jsonb) from public,anon;
grant execute on function public.zt_save_quote(uuid,uuid,jsonb,jsonb) to authenticated,service_role;

create or replace function zt_private.zt_save_work_order(p_company uuid,p_wo uuid,p_row jsonb,p_items jsonb default '[]'::jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_uid uuid:=auth.uid(); v_id uuid; v_number text; item jsonb;
begin
  if v_uid is null then raise exception 'Não autenticado' using errcode='28000'; end if;
  if not public.zt_is_owner(p_company) then raise exception 'Somente o proprietário salva ordens de serviço por este fluxo' using errcode='42501'; end if;
  if jsonb_typeof(coalesce(p_items,'[]'::jsonb)) <> 'array' then raise exception 'Itens inválidos'; end if;
  if jsonb_array_length(coalesce(p_items,'[]'::jsonb)) > 500 then raise exception 'Itens demais na OS'; end if;
  if p_wo is null then
    v_number:=zt_private.zt_next_number(p_company,'work_order','OS');
    insert into public.work_orders(company_id,number,client_id,quote_id,assigned_to,status,scheduled_date,scheduled_time,address,service_place,request,pre_notes,pending_note,extra_cost,needs_return,warranty_id,origin_wo_id,is_warranty_visit,problem_report,created_by)
    values(p_company,v_number,nullif(p_row->>'client_id','')::uuid,nullif(p_row->>'quote_id','')::uuid,coalesce(nullif(p_row->>'assigned_to','')::uuid,v_uid),coalesce(nullif(p_row->>'status','')::public.zt_wo_status,'unscheduled'),nullif(p_row->>'scheduled_date','')::date,nullif(p_row->>'scheduled_time','')::time,nullif(p_row->>'address',''),nullif(p_row->>'service_place',''),nullif(p_row->>'request',''),nullif(p_row->>'pre_notes',''),nullif(p_row->>'pending_note',''),coalesce((p_row->>'extra_cost')::numeric,0),coalesce((p_row->>'needs_return')::boolean,false),nullif(p_row->>'warranty_id','')::uuid,nullif(p_row->>'origin_wo_id','')::uuid,coalesce((p_row->>'is_warranty_visit')::boolean,false),nullif(p_row->>'problem_report',''),v_uid) returning id into v_id;
  else
    select id into v_id from public.work_orders where id=p_wo and company_id=p_company for update;
    if v_id is null then raise exception 'Ordem de serviço não encontrada' using errcode='42501'; end if;
    if exists(select 1 from public.work_orders where id=v_id and status='done') then raise exception 'OS concluída não pode ser regravada por este fluxo' using errcode='42501'; end if;
    update public.work_orders set client_id=nullif(p_row->>'client_id','')::uuid,quote_id=nullif(p_row->>'quote_id','')::uuid,assigned_to=coalesce(nullif(p_row->>'assigned_to','')::uuid,assigned_to),status=coalesce(nullif(p_row->>'status','')::public.zt_wo_status,status),scheduled_date=nullif(p_row->>'scheduled_date','')::date,scheduled_time=nullif(p_row->>'scheduled_time','')::time,address=nullif(p_row->>'address',''),service_place=nullif(p_row->>'service_place',''),request=nullif(p_row->>'request',''),pre_notes=nullif(p_row->>'pre_notes',''),pending_note=nullif(p_row->>'pending_note',''),extra_cost=coalesce((p_row->>'extra_cost')::numeric,0),needs_return=coalesce((p_row->>'needs_return')::boolean,false),warranty_id=nullif(p_row->>'warranty_id','')::uuid,origin_wo_id=nullif(p_row->>'origin_wo_id','')::uuid,is_warranty_visit=coalesce((p_row->>'is_warranty_visit')::boolean,false),problem_report=nullif(p_row->>'problem_report',''),updated_at=now() where id=v_id;
    delete from public.work_order_items where work_order_id=v_id;
  end if;
  for item in select value from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) loop
    insert into public.work_order_items(work_order_id,company_id,kind,service_id,product_id,name,unit,quantity,unit_price,unit_cost,notes,is_extra,price_pending)
    values(v_id,p_company,coalesce(nullif(item->>'kind','')::public.zt_item_kind,'free'),nullif(item->>'service_id','')::uuid,nullif(item->>'product_id','')::uuid,left(coalesce(nullif(item->>'name',''),'Item'),500),left(coalesce(nullif(item->>'unit',''),'unidade'),50),coalesce((item->>'quantity')::numeric,1),coalesce((item->>'unit_price')::numeric,0),coalesce((item->>'unit_cost')::numeric,0),nullif(item->>'notes',''),coalesce((item->>'is_extra')::boolean,false),coalesce((item->>'price_pending')::boolean,false));
  end loop;
  return v_id;
end $$;

create or replace function public.zt_save_work_order(p_company uuid,p_wo uuid,p_row jsonb,p_items jsonb default '[]'::jsonb)
returns uuid language sql security definer set search_path=zt_private as $$ select zt_private.zt_save_work_order(p_company,p_wo,p_row,p_items); $$;
revoke all on function public.zt_save_work_order(uuid,uuid,jsonb,jsonb) from public,anon;
grant execute on function public.zt_save_work_order(uuid,uuid,jsonb,jsonb) to authenticated,service_role;

create or replace function zt_private.zt_save_purchase(p_company uuid,p_purchase uuid,p_row jsonb,p_items jsonb default '[]'::jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_uid uuid:=auth.uid(); v_id uuid; v_number text; v_entry uuid; v_total numeric(12,2):=0; item jsonb; v_supplier text; v_date date; v_due date; v_paid boolean; v_method text;
begin
  if v_uid is null then raise exception 'Não autenticado' using errcode='28000'; end if;
  if not public.zt_is_owner(p_company) then raise exception 'Somente o proprietário salva compras' using errcode='42501'; end if;
  if jsonb_typeof(coalesce(p_items,'[]'::jsonb)) <> 'array' then raise exception 'Itens inválidos'; end if;
  if jsonb_array_length(coalesce(p_items,'[]'::jsonb)) = 0 then raise exception 'A compra precisa ter ao menos um item'; end if;
  if jsonb_array_length(coalesce(p_items,'[]'::jsonb)) > 500 then raise exception 'Itens demais na compra'; end if;
  v_supplier:=left(coalesce(nullif(trim(p_row->>'supplier_name'),''),'Fornecedor'),300); v_date:=coalesce(nullif(p_row->>'purchase_date','')::date,current_date); v_due:=coalesce(nullif(p_row->>'due_date','')::date,v_date); v_paid:=coalesce((p_row->>'paid')::boolean,false); v_method:=nullif(left(coalesce(p_row->>'payment_method',''),100),'');
  for item in select value from jsonb_array_elements(p_items) loop
    if coalesce((item->>'quantity')::numeric,0) <= 0 then raise exception 'Quantidade inválida'; end if;
    if coalesce((item->>'unit_cost')::numeric,-1) < 0 then raise exception 'Custo inválido'; end if;
    v_total:=v_total+((item->>'quantity')::numeric*(item->>'unit_cost')::numeric);
  end loop;
  if v_total <= 0 then raise exception 'O total da compra precisa ser maior que zero'; end if;
  if p_purchase is null then
    v_number:=zt_private.zt_next_number(p_company,'purchase','CMP');
    insert into public.purchases(company_id,number,supplier_name,purchase_date,payment_method,due_date,notes,created_by) values(p_company,v_number,v_supplier,v_date,v_method,nullif(p_row->>'due_date','')::date,nullif(p_row->>'notes',''),v_uid) returning id into v_id;
  else
    select id,entry_id,number into v_id,v_entry,v_number from public.purchases where id=p_purchase and company_id=p_company for update;
    if v_id is null then raise exception 'Compra não encontrada' using errcode='42501'; end if;
    update public.purchases set supplier_name=v_supplier,purchase_date=v_date,payment_method=v_method,due_date=nullif(p_row->>'due_date','')::date,notes=nullif(p_row->>'notes',''),updated_at=now() where id=v_id;
    delete from public.purchase_items where purchase_id=v_id;
  end if;
  for item in select value from jsonb_array_elements(p_items) loop
    insert into public.purchase_items(purchase_id,company_id,product_id,name,quantity,unit_cost) values(v_id,p_company,nullif(item->>'product_id','')::uuid,left(coalesce(nullif(item->>'name',''),'Item'),500),(item->>'quantity')::numeric,(item->>'unit_cost')::numeric);
  end loop;
  if v_entry is null then
    insert into public.financial_entries(company_id,kind,description,amount,due_date,paid,paid_at,payment_method,category,purchase_id) values(p_company,'expense',left('Compra '||v_number||' · '||v_supplier,500),v_total,v_due,v_paid,case when v_paid then v_date else null end,case when v_paid then v_method else null end,'Materiais',v_id) returning id into v_entry;
    update public.purchases set entry_id=v_entry where id=v_id;
  else
    update public.financial_entries set description=left('Compra '||v_number||' · '||v_supplier,500),amount=v_total,due_date=v_due,paid=v_paid,paid_at=case when v_paid then coalesce(paid_at,v_date) else null end,payment_method=case when v_paid then v_method else null end,category='Materiais',purchase_id=v_id where id=v_entry and company_id=p_company;
    if not found then raise exception 'Lançamento financeiro da compra não encontrado' using errcode='42501'; end if;
  end if;
  return v_id;
end $$;

create or replace function public.zt_save_purchase(p_company uuid,p_purchase uuid,p_row jsonb,p_items jsonb default '[]'::jsonb)
returns uuid language sql security definer set search_path=zt_private as $$ select zt_private.zt_save_purchase(p_company,p_purchase,p_row,p_items); $$;
revoke all on function public.zt_save_purchase(uuid,uuid,jsonb,jsonb) from public,anon;
grant execute on function public.zt_save_purchase(uuid,uuid,jsonb,jsonb) to authenticated,service_role;
