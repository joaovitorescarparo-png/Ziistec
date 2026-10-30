-- RC-1C.2: persist the legacy quote editor product-photo preference.
-- No table, RLS, Storage or grant changes. Keeps the existing save contract and only
-- adds quotes.show_product_images to the canonical private quote write function.

create or replace function zt_private.zt_save_quote(
  p_company uuid,
  p_quote uuid,
  p_row jsonb,
  p_items jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_uid uuid:=auth.uid();
  v_id uuid;
  v_number text;
  item jsonb;
  pos int:=0;
begin
  if v_uid is null then raise exception 'Não autenticado' using errcode='28000'; end if;
  if not public.zt_is_owner(p_company) then raise exception 'Somente o proprietário salva orçamentos' using errcode='42501'; end if;
  if jsonb_typeof(coalesce(p_items,'[]'::jsonb)) <> 'array' then raise exception 'Itens inválidos'; end if;
  if jsonb_array_length(coalesce(p_items,'[]'::jsonb)) > 500 then raise exception 'Itens demais no orçamento'; end if;

  if p_quote is null then
    v_number:=zt_private.zt_next_number(p_company,'quote','ORC');
    insert into public.quotes(
      company_id,number,client_id,status,issue_date,valid_until,discount,surcharge,
      payment_terms,notes,address,service_place,show_product_images,created_by
    )
    values(
      p_company,
      v_number,
      nullif(p_row->>'client_id','')::uuid,
      coalesce(nullif(p_row->>'status','')::public.zt_quote_status,'draft'),
      coalesce(nullif(p_row->>'issue_date','')::date,current_date),
      nullif(p_row->>'valid_until','')::date,
      coalesce((p_row->>'discount')::numeric,0),
      coalesce((p_row->>'surcharge')::numeric,0),
      nullif(p_row->>'payment_terms',''),
      nullif(p_row->>'notes',''),
      nullif(p_row->>'address',''),
      nullif(p_row->>'service_place',''),
      coalesce((p_row->>'show_product_images')::boolean,false),
      v_uid
    )
    returning id into v_id;
  else
    select id into v_id
    from public.quotes
    where id=p_quote and company_id=p_company
    for update;

    if v_id is null then raise exception 'Orçamento não encontrado' using errcode='42501'; end if;

    update public.quotes
    set client_id=nullif(p_row->>'client_id','')::uuid,
        status=coalesce(nullif(p_row->>'status','')::public.zt_quote_status,status),
        issue_date=coalesce(nullif(p_row->>'issue_date','')::date,issue_date),
        valid_until=nullif(p_row->>'valid_until','')::date,
        discount=coalesce((p_row->>'discount')::numeric,0),
        surcharge=coalesce((p_row->>'surcharge')::numeric,0),
        payment_terms=nullif(p_row->>'payment_terms',''),
        notes=nullif(p_row->>'notes',''),
        address=nullif(p_row->>'address',''),
        service_place=nullif(p_row->>'service_place',''),
        show_product_images=coalesce((p_row->>'show_product_images')::boolean,show_product_images),
        updated_at=now()
    where id=v_id;

    delete from public.quote_items where quote_id=v_id;
  end if;

  for item in select value from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) loop
    insert into public.quote_items(
      quote_id,company_id,kind,service_id,product_id,name,unit,quantity,unit_price,unit_cost,notes,position
    )
    values(
      v_id,
      p_company,
      coalesce(nullif(item->>'kind','')::public.zt_item_kind,'free'),
      nullif(item->>'service_id','')::uuid,
      nullif(item->>'product_id','')::uuid,
      left(coalesce(nullif(item->>'name',''),'Item'),500),
      left(coalesce(nullif(item->>'unit',''),'unidade'),50),
      coalesce((item->>'quantity')::numeric,1),
      coalesce((item->>'unit_price')::numeric,0),
      coalesce((item->>'unit_cost')::numeric,0),
      nullif(item->>'notes',''),
      pos
    );
    pos:=pos+1;
  end loop;

  return v_id;
end
$$;
