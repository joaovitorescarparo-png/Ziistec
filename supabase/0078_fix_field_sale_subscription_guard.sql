-- ZiisTec V2 — alinha a venda em OS ao guard canônico de assinatura.
-- O baseline endurecido moveu a autoridade de escrita operacional para zt_private.
-- Mantém o mesmo contrato de venda/idempotência da 0075; altera somente o helper de assinatura.

create or replace function public.zt_sell_product_on_work_order(
  p_wo uuid,
  p_product uuid,
  p_quantity numeric,
  p_notes text,
  p_request uuid
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_wo public.work_orders%rowtype;
  v_product public.products%rowtype;
  v_existing public.field_sales%rowtype;
  v_is_owner boolean;
  v_item uuid;
  v_total numeric(12,2);
begin
  if v_user is null then raise exception 'Não autenticado' using errcode='28000'; end if;
  if p_wo is null or p_product is null or p_request is null then raise exception 'Parâmetros obrigatórios ausentes' using errcode='22023'; end if;
  if p_quantity is null or p_quantity<=0 then raise exception 'Quantidade inválida' using errcode='22023'; end if;

  select * into v_wo
  from public.work_orders w
  where w.id=p_wo and w.deleted_at is null
  for update;
  if not found then raise exception 'OS não encontrada' using errcode='P0002'; end if;
  if v_wo.status in ('done','canceled') then raise exception 'A OS precisa estar aberta para vender produto' using errcode='23514'; end if;

  perform zt_private.assert_operational_write_allowed(v_wo.company_id);
  v_is_owner := public.zt_is_owner(v_wo.company_id);
  if not v_is_owner and (
    v_wo.assigned_to is distinct from v_user
    or not exists(
      select 1 from public.company_members m
      where m.company_id=v_wo.company_id
        and m.user_id=v_user
        and m.role='technician'
        and m.status='active'
    )
  ) then
    raise exception 'Sem permissão para esta OS' using errcode='42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_wo.company_id::text||':'||p_request::text,0));

  select * into v_existing
  from public.field_sales s
  where s.company_id=v_wo.company_id and s.client_request_id=p_request;
  if found then
    if v_existing.origin<>'work_order'
      or v_existing.work_order_id<>p_wo
      or v_existing.product_id<>p_product
      or v_existing.quantity<>p_quantity then
      raise exception 'client_request_id já utilizado por outra venda' using errcode='23505';
    end if;
    return v_existing.work_order_item_id;
  end if;

  select * into v_product
  from public.products p
  where p.id=p_product
    and p.company_id=v_wo.company_id
    and p.active=true
    and p.sale_enabled=true
    and p.deleted_at is null
  for update;
  if not found then raise exception 'Produto indisponível para venda' using errcode='P0002'; end if;
  if v_product.track_stock and v_product.stock_qty<p_quantity then
    raise exception 'Estoque insuficiente: disponível %',v_product.stock_qty using errcode='23514';
  end if;

  v_total := round(v_product.price*p_quantity,2);

  insert into public.work_order_items(
    work_order_id,company_id,kind,product_id,name,unit,quantity,unit_price,unit_cost,
    is_extra,price_pending,notes
  ) values(
    p_wo,v_wo.company_id,'product',v_product.id,v_product.name,v_product.unit,p_quantity,
    v_product.price,v_product.cost,true,false,left(nullif(trim(p_notes),''),1000)
  ) returning id into v_item;

  insert into public.field_sales(
    company_id,sold_by,product_id,quantity,unit_price,total,payment_method,notes,
    financial_entry_id,client_request_id,client_id,service_place,origin,work_order_id,work_order_item_id
  ) values(
    v_wo.company_id,v_user,v_product.id,p_quantity,v_product.price,v_total,null,
    left(nullif(trim(p_notes),''),1000),null,p_request,v_wo.client_id,
    left(coalesce(nullif(trim(v_wo.service_place),''),nullif(trim(v_wo.address),'')),500),
    'work_order',p_wo,v_item
  );

  if v_product.track_stock then
    update public.products set stock_qty=stock_qty-p_quantity where id=v_product.id;
    insert into public.inventory_movements(
      company_id,product_id,kind,quantity_delta,unit_cost,work_order_id,notes,created_by
    ) values(
      v_wo.company_id,v_product.id,'sale',-p_quantity,v_product.cost,p_wo,
      left(nullif(trim(p_notes),''),1000),v_user
    );
  end if;

  return v_item;
end;
$$;
revoke all on function public.zt_sell_product_on_work_order(uuid,uuid,numeric,text,uuid) from public,anon;
grant execute on function public.zt_sell_product_on_work_order(uuid,uuid,numeric,text,uuid) to authenticated,service_role;
