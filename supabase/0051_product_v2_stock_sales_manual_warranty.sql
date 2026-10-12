-- ZiisTec Product V2: operações seguras de estoque, venda em OS e garantia manual.

create or replace function public.zt_adjust_product_stock(
  p_company uuid,
  p_product uuid,
  p_delta numeric,
  p_notes text default null
) returns numeric
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_current numeric;
  v_next numeric;
begin
  if auth.uid() is null then raise exception 'Não autenticado' using errcode='28000'; end if;
  if not public.zt_is_owner(p_company) then raise exception 'Sem permissão' using errcode='42501'; end if;
  if p_delta is null or p_delta = 0 then raise exception 'Ajuste deve ser diferente de zero' using errcode='22023'; end if;

  select stock_qty into v_current
    from public.products
   where id=p_product and company_id=p_company
   for update;
  if not found then raise exception 'Produto não encontrado' using errcode='P0002'; end if;

  v_next := v_current + p_delta;
  if v_next < 0 then raise exception 'Estoque insuficiente' using errcode='23514'; end if;

  update public.products set stock_qty=v_next, track_stock=true where id=p_product and company_id=p_company;
  insert into public.inventory_movements(company_id,product_id,kind,quantity_delta,notes,created_by)
  values(p_company,p_product,'adjustment',p_delta,left(nullif(trim(p_notes),''),1000),auth.uid());
  return v_next;
end;
$$;
revoke all on function public.zt_adjust_product_stock(uuid,uuid,numeric,text) from public,anon;
grant execute on function public.zt_adjust_product_stock(uuid,uuid,numeric,text) to authenticated,service_role;

create or replace function public.zt_sell_product_on_work_order(
  p_wo uuid,
  p_product uuid,
  p_quantity numeric,
  p_notes text default null
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user uuid := auth.uid();
  v_company uuid;
  v_assigned uuid;
  v_status public.zt_wo_status;
  v_is_owner boolean;
  v_product public.products%rowtype;
  v_item uuid;
begin
  if v_user is null then raise exception 'Não autenticado' using errcode='28000'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Quantidade inválida' using errcode='22023'; end if;

  select company_id,assigned_to,status into v_company,v_assigned,v_status
    from public.work_orders where id=p_wo for update;
  if not found then raise exception 'OS não encontrada' using errcode='P0002'; end if;
  if v_status in ('done','canceled') then raise exception 'A OS precisa estar aberta para vender produto' using errcode='23514'; end if;

  v_is_owner := public.zt_is_owner(v_company);
  if not v_is_owner then
    if v_assigned is distinct from v_user or not exists (
      select 1 from public.company_members m
       where m.company_id=v_company and m.user_id=v_user and m.role='technician' and m.status='active'
    ) then
      raise exception 'Sem permissão para esta OS' using errcode='42501';
    end if;
  end if;

  select * into v_product from public.products
   where id=p_product and company_id=v_company and active=true and sale_enabled=true
   for update;
  if not found then raise exception 'Produto indisponível para venda' using errcode='P0002'; end if;

  if v_product.track_stock and v_product.stock_qty < p_quantity then
    raise exception 'Estoque insuficiente: disponível %',v_product.stock_qty using errcode='23514';
  end if;

  insert into public.work_order_items(
    work_order_id,company_id,kind,product_id,name,unit,quantity,unit_price,unit_cost,is_extra,price_pending,notes
  ) values(
    p_wo,v_company,'product',v_product.id,v_product.name,v_product.unit,p_quantity,v_product.price,v_product.cost,true,false,left(nullif(trim(p_notes),''),1000)
  ) returning id into v_item;

  if v_product.track_stock then
    update public.products set stock_qty=stock_qty-p_quantity where id=v_product.id;
    insert into public.inventory_movements(company_id,product_id,kind,quantity_delta,unit_cost,work_order_id,notes,created_by)
    values(v_company,v_product.id,'sale',-p_quantity,v_product.cost,p_wo,left(nullif(trim(p_notes),''),1000),v_user);
  end if;

  return v_item;
end;
$$;
revoke all on function public.zt_sell_product_on_work_order(uuid,uuid,numeric,text) from public,anon;
grant execute on function public.zt_sell_product_on_work_order(uuid,uuid,numeric,text) to authenticated,service_role;

create or replace function public.zt_create_manual_warranty(
  p_company uuid,
  p_client uuid,
  p_kind text,
  p_description text,
  p_starts_on date,
  p_ends_on date,
  p_service_place text default null,
  p_service uuid default null,
  p_product uuid default null,
  p_serial text default null,
  p_notes text default null
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'Não autenticado' using errcode='28000'; end if;
  if not public.zt_is_owner(p_company) then raise exception 'Sem permissão' using errcode='42501'; end if;
  if p_kind not in ('service','product') then raise exception 'Tipo de garantia inválido' using errcode='22023'; end if;
  if nullif(trim(p_description),'') is null then raise exception 'Informe a descrição' using errcode='22023'; end if;
  if p_starts_on is null or p_ends_on is null or p_ends_on < p_starts_on then raise exception 'Período de garantia inválido' using errcode='22023'; end if;
  if not exists(select 1 from public.clients c where c.id=p_client and c.company_id=p_company) then
    raise exception 'Cliente não pertence à empresa' using errcode='42501';
  end if;
  if p_service is not null and not exists(select 1 from public.services s where s.id=p_service and s.company_id=p_company) then
    raise exception 'Serviço não pertence à empresa' using errcode='42501';
  end if;
  if p_product is not null and not exists(select 1 from public.products p where p.id=p_product and p.company_id=p_company) then
    raise exception 'Produto não pertence à empresa' using errcode='42501';
  end if;

  insert into public.warranties(
    company_id,client_id,work_order_id,kind,service_id,product_id,description,service_place,starts_on,ends_on,serial_number,source,notes
  ) values(
    p_company,p_client,null,p_kind::public.zt_warranty_kind,
    case when p_kind='service' then p_service else null end,
    case when p_kind='product' then p_product else null end,
    trim(p_description),left(nullif(trim(p_service_place),''),500),p_starts_on,p_ends_on,left(nullif(trim(p_serial),''),200),'manual',left(nullif(trim(p_notes),''),5000)
  ) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.zt_create_manual_warranty(uuid,uuid,text,text,date,date,text,uuid,uuid,text,text) from public,anon;
grant execute on function public.zt_create_manual_warranty(uuid,uuid,text,text,date,date,text,uuid,uuid,text,text) to authenticated,service_role;
