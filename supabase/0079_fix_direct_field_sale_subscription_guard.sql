-- ZiisTec V2 — alinha a venda rápida ao guard canônico de assinatura.
-- Mantém o contrato/atomicidade/idempotência da 0075 e substitui somente o helper legado.

create or replace function public.zt_sell_product_direct(
  p_company uuid,
  p_product uuid,
  p_quantity numeric,
  p_payment_method text,
  p_notes text,
  p_request uuid,
  p_client uuid,
  p_service_place text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_product public.products%rowtype;
  v_sale public.field_sales%rowtype;
  v_sale_id uuid;
  v_financial uuid;
  v_total numeric(12,2);
  v_method text;
  v_allow_pix boolean;
  v_allow_cash boolean;
  v_allow_card boolean;
  v_allow_transfer boolean;
  v_allow_other boolean;
  v_pix_key text;
  v_pix_name text;
  v_pix_city text;
begin
  if v_user is null then raise exception 'Não autenticado' using errcode='28000'; end if;
  if p_company is null or p_product is null or p_request is null then raise exception 'Parâmetros obrigatórios ausentes' using errcode='22023'; end if;
  if p_quantity is null or p_quantity<=0 then raise exception 'Quantidade inválida' using errcode='22023'; end if;

  v_method := public.zt_normalize_field_sale_payment_method(p_payment_method);
  perform zt_private.assert_operational_write_allowed(p_company);

  if not public.zt_is_owner(p_company) and not exists(
    select 1 from public.company_members m
    where m.company_id=p_company
      and m.user_id=v_user
      and m.role='technician'
      and m.status='active'
  ) then
    raise exception 'Sem permissão para vender nesta empresa' using errcode='42501';
  end if;

  select
    c.field_sales_allow_pix,c.field_sales_allow_cash,c.field_sales_allow_card,
    c.field_sales_allow_transfer,c.field_sales_allow_other,
    nullif(trim(c.pix_key),''),nullif(trim(c.pix_receiver_name),''),nullif(trim(c.pix_receiver_city),'')
  into v_allow_pix,v_allow_cash,v_allow_card,v_allow_transfer,v_allow_other,v_pix_key,v_pix_name,v_pix_city
  from public.companies c
  where c.id=p_company;
  if not found then raise exception 'Empresa não encontrada' using errcode='P0002'; end if;

  if (v_method='pix' and not v_allow_pix)
    or (v_method='cash' and not v_allow_cash)
    or (v_method='card' and not v_allow_card)
    or (v_method='transfer' and not v_allow_transfer)
    or (v_method='other' and not v_allow_other) then
    raise exception 'Forma de recebimento não habilitada pela empresa' using errcode='42501';
  end if;
  if v_method='pix' and (v_pix_key is null or v_pix_name is null or v_pix_city is null) then
    raise exception 'Configure chave, recebedor e cidade do Pix antes de vender' using errcode='23514';
  end if;

  if p_client is not null then
    if not exists(
      select 1 from public.clients c
      where c.id=p_client and c.company_id=p_company and c.deleted_at is null
    ) then
      raise exception 'Cliente indisponível' using errcode='P0002';
    end if;
    if not public.zt_is_owner(p_company) and not public.zt_client_visible(p_client,p_company) then
      raise exception 'Cliente fora do escopo do técnico' using errcode='42501';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_company::text||':'||p_request::text,0));

  select * into v_sale
  from public.field_sales s
  where s.company_id=p_company and s.client_request_id=p_request;
  if found then
    if v_sale.origin<>'quick'
      or v_sale.product_id<>p_product
      or v_sale.quantity<>p_quantity
      or v_sale.payment_method<>v_method
      or v_sale.client_id is distinct from p_client then
      raise exception 'client_request_id já utilizado por outra venda' using errcode='23505';
    end if;
    return v_sale.id;
  end if;

  select * into v_product
  from public.products p
  where p.id=p_product
    and p.company_id=p_company
    and p.active=true
    and p.sale_enabled=true
    and p.deleted_at is null
  for update;
  if not found then raise exception 'Produto indisponível para venda' using errcode='P0002'; end if;
  if v_product.track_stock and v_product.stock_qty<p_quantity then
    raise exception 'Estoque insuficiente: disponível %',v_product.stock_qty using errcode='23514';
  end if;

  v_total := round(v_product.price*p_quantity,2);

  insert into public.financial_entries(
    company_id,kind,description,amount,due_date,paid,paid_at,payment_method,category,client_id,client_request_id
  ) values(
    p_company,'income',left('Venda em campo · '||v_product.name,500),v_total,current_date,true,current_date,
    v_method,'Venda em campo',p_client,p_request
  ) returning id into v_financial;

  insert into public.field_sales(
    company_id,sold_by,product_id,quantity,unit_price,total,payment_method,notes,
    financial_entry_id,client_request_id,client_id,service_place,origin
  ) values(
    p_company,v_user,v_product.id,p_quantity,v_product.price,v_total,v_method,
    left(nullif(trim(p_notes),''),1000),v_financial,p_request,p_client,
    left(nullif(trim(p_service_place),''),500),'quick'
  ) returning id into v_sale_id;

  if v_product.track_stock then
    update public.products set stock_qty=stock_qty-p_quantity where id=v_product.id;
    insert into public.inventory_movements(
      company_id,product_id,kind,quantity_delta,unit_cost,notes,created_by
    ) values(
      p_company,v_product.id,'sale',-p_quantity,v_product.cost,
      left('Venda em campo · '||coalesce(nullif(trim(p_notes),''),'recebimento confirmado'),1000),v_user
    );
  end if;

  return v_sale_id;
end;
$$;
revoke all on function public.zt_sell_product_direct(uuid,uuid,numeric,text,text,uuid,uuid,text) from public,anon;
grant execute on function public.zt_sell_product_direct(uuid,uuid,numeric,text,text,uuid,uuid,text) to authenticated,service_role;
