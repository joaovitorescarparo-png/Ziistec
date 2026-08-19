create or replace function zt_private.zt_save_purchase(p_company uuid, p_purchase uuid, p_row jsonb, p_items jsonb default '[]'::jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid:=auth.uid(); v_id uuid; v_number text; v_entry uuid; v_total numeric(12,2):=0; item jsonb; v_supplier text; v_date date; v_due date; v_paid boolean; v_method text; v_product uuid;
begin
  if v_uid is null then raise exception 'Não autenticado' using errcode='28000'; end if;
  if not public.zt_is_owner(p_company) then raise exception 'Somente o proprietário salva compras' using errcode='42501'; end if;
  if jsonb_typeof(coalesce(p_items,'[]'::jsonb)) <> 'array' then raise exception 'Itens inválidos'; end if;
  if jsonb_array_length(coalesce(p_items,'[]'::jsonb)) = 0 then raise exception 'A compra precisa ter ao menos um item'; end if;
  if jsonb_array_length(coalesce(p_items,'[]'::jsonb)) > 500 then raise exception 'Itens demais na compra'; end if;

  v_supplier:=left(coalesce(nullif(trim(p_row->>'supplier_name'),''),'Fornecedor'),300);
  v_date:=coalesce(nullif(p_row->>'purchase_date','')::date,current_date);
  v_due:=coalesce(nullif(p_row->>'due_date','')::date,v_date);
  v_paid:=coalesce((p_row->>'paid')::boolean,false);
  v_method:=nullif(left(coalesce(p_row->>'payment_method',''),100),'');

  for item in select value from jsonb_array_elements(p_items) loop
    if coalesce((item->>'quantity')::numeric,0) <= 0 then raise exception 'Quantidade inválida'; end if;
    if coalesce((item->>'unit_cost')::numeric,-1) < 0 then raise exception 'Custo inválido'; end if;
    v_product:=nullif(item->>'product_id','')::uuid;
    if v_product is not null and not exists(select 1 from public.products p where p.id=v_product and p.company_id=p_company) then
      raise exception 'Produto da compra não pertence à empresa' using errcode='42501';
    end if;
    v_total:=v_total + ((item->>'quantity')::numeric * (item->>'unit_cost')::numeric);
  end loop;
  if v_total <= 0 then raise exception 'O total da compra precisa ser maior que zero'; end if;

  if p_purchase is null then
    v_number:=zt_private.zt_next_number(p_company,'purchase','CMP');
    insert into public.purchases(company_id,number,supplier_name,purchase_date,payment_method,due_date,notes,created_by)
    values(p_company,v_number,v_supplier,v_date,v_method,nullif(p_row->>'due_date','')::date,nullif(p_row->>'notes',''),v_uid)
    returning id into v_id;
  else
    select id,entry_id,number into v_id,v_entry,v_number from public.purchases where id=p_purchase and company_id=p_company for update;
    if v_id is null then raise exception 'Compra não encontrada' using errcode='42501'; end if;
    update public.purchases set supplier_name=v_supplier,purchase_date=v_date,payment_method=v_method,due_date=nullif(p_row->>'due_date','')::date,notes=nullif(p_row->>'notes',''),updated_at=now() where id=v_id;
    delete from public.purchase_items where purchase_id=v_id;
  end if;

  for item in select value from jsonb_array_elements(p_items) loop
    v_product:=nullif(item->>'product_id','')::uuid;
    insert into public.purchase_items(purchase_id,company_id,product_id,name,quantity,unit_cost)
    values(v_id,p_company,v_product,left(coalesce(nullif(item->>'name',''),'Item'),500),(item->>'quantity')::numeric,(item->>'unit_cost')::numeric);
  end loop;

  if v_entry is null then
    insert into public.financial_entries(company_id,kind,description,amount,due_date,paid,paid_at,payment_method,category,purchase_id)
    values(p_company,'expense',left('Compra '||v_number||' · '||v_supplier,500),v_total,v_due,v_paid,case when v_paid then v_date else null end,case when v_paid then v_method else null end,'Materiais',v_id)
    returning id into v_entry;
    update public.purchases set entry_id=v_entry where id=v_id;
  else
    update public.financial_entries set description=left('Compra '||v_number||' · '||v_supplier,500),amount=v_total,due_date=v_due,paid=v_paid,paid_at=case when v_paid then coalesce(paid_at,v_date) else null end,payment_method=case when v_paid then v_method else null end,category='Materiais',purchase_id=v_id where id=v_entry and company_id=p_company;
    if not found then raise exception 'Lançamento financeiro da compra não encontrado' using errcode='42501'; end if;
  end if;
  return v_id;
end $function$;
