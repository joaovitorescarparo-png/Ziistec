-- ZiisTec Product V2: compras alimentam o estoque sem duplicar em retries/edições.
-- Depende de 0050 (products.stock_qty + inventory_movements).
-- Não recalcula o estoque histórico ao migrar: compras antigas viram baseline para
-- que uma edição futura aplique somente a diferença, evitando inflar saldo existente.

alter table public.purchases
  add column if not exists updated_at timestamptz not null default now();

create table if not exists zt_private.purchase_inventory_sync (
  purchase_id uuid not null,
  company_id uuid not null,
  product_id uuid not null,
  quantity_accounted numeric(14,3) not null check (quantity_accounted >= 0),
  unit_cost numeric(12,2) check (unit_cost is null or unit_cost >= 0),
  updated_at timestamptz not null default now(),
  primary key (purchase_id, product_id),
  constraint purchase_inventory_sync_purchase_company_fk
    foreign key (purchase_id, company_id)
    references public.purchases(id, company_id)
    on delete cascade,
  constraint purchase_inventory_sync_product_company_fk
    foreign key (product_id, company_id)
    references public.products(id, company_id)
    on delete cascade
);

revoke all on table zt_private.purchase_inventory_sync from public, anon, authenticated;
grant select, insert, update, delete on table zt_private.purchase_inventory_sync to service_role;

-- Compras já existentes são apenas baseline. Não alteramos products.stock_qty aqui,
-- pois compras históricas podem já ter sido consumidas antes do módulo de estoque.
insert into zt_private.purchase_inventory_sync(
  purchase_id, company_id, product_id, quantity_accounted, unit_cost
)
select
  pi.purchase_id,
  pi.company_id,
  pi.product_id,
  sum(pi.quantity)::numeric(14,3),
  case when sum(pi.quantity) > 0
       then (sum(pi.quantity * pi.unit_cost) / sum(pi.quantity))::numeric(12,2)
       else null end
from public.purchase_items pi
where pi.product_id is not null
  and exists (
    select 1 from public.products p
    where p.id=pi.product_id and p.company_id=pi.company_id
  )
group by pi.purchase_id, pi.company_id, pi.product_id
on conflict (purchase_id, product_id) do update
set company_id=excluded.company_id,
    quantity_accounted=excluded.quantity_accounted,
    unit_cost=excluded.unit_cost,
    updated_at=now();

create or replace function zt_private.zt_save_purchase(
  p_company uuid,
  p_purchase uuid,
  p_row jsonb,
  p_items jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_number text;
  v_entry uuid;
  v_total numeric(12,2) := 0;
  item jsonb;
  v_supplier text;
  v_date date;
  v_due date;
  v_paid boolean;
  v_method text;
  v_product uuid;
  v_stock record;
  v_current_stock numeric(14,3);
  v_track_stock boolean;
  v_delta numeric(14,3);
begin
  if v_uid is null then
    raise exception 'Não autenticado' using errcode='28000';
  end if;
  if not public.zt_is_owner(p_company) then
    raise exception 'Somente o proprietário salva compras' using errcode='42501';
  end if;
  if jsonb_typeof(coalesce(p_items,'[]'::jsonb)) <> 'array' then
    raise exception 'Itens inválidos';
  end if;
  if jsonb_array_length(coalesce(p_items,'[]'::jsonb)) = 0 then
    raise exception 'A compra precisa ter ao menos um item';
  end if;
  if jsonb_array_length(coalesce(p_items,'[]'::jsonb)) > 500 then
    raise exception 'Itens demais na compra';
  end if;

  v_supplier := left(coalesce(nullif(trim(p_row->>'supplier_name'),''),'Fornecedor'),300);
  v_date := coalesce(nullif(p_row->>'purchase_date','')::date,current_date);
  v_due := coalesce(nullif(p_row->>'due_date','')::date,v_date);
  v_paid := coalesce((p_row->>'paid')::boolean,false);
  v_method := nullif(left(coalesce(p_row->>'payment_method',''),100),'');

  for item in select value from jsonb_array_elements(p_items) loop
    if coalesce((item->>'quantity')::numeric,0) <= 0 then
      raise exception 'Quantidade inválida';
    end if;
    if coalesce((item->>'unit_cost')::numeric,-1) < 0 then
      raise exception 'Custo inválido';
    end if;
    v_product := nullif(item->>'product_id','')::uuid;
    if v_product is not null and not exists (
      select 1 from public.products p
      where p.id=v_product and p.company_id=p_company
    ) then
      raise exception 'Produto da compra não pertence à empresa' using errcode='42501';
    end if;
    v_total := v_total + ((item->>'quantity')::numeric * (item->>'unit_cost')::numeric);
  end loop;

  if v_total <= 0 then
    raise exception 'O total da compra precisa ser maior que zero';
  end if;

  if p_purchase is null then
    v_number := zt_private.zt_next_number(p_company,'purchase','CMP');
    insert into public.purchases(
      company_id,number,supplier_name,purchase_date,payment_method,due_date,notes,created_by
    ) values (
      p_company,v_number,v_supplier,v_date,v_method,nullif(p_row->>'due_date','')::date,
      nullif(p_row->>'notes',''),v_uid
    ) returning id into v_id;
  else
    select id,entry_id,number
      into v_id,v_entry,v_number
      from public.purchases
     where id=p_purchase and company_id=p_company
     for update;

    if v_id is null then
      raise exception 'Compra não encontrada' using errcode='42501';
    end if;

    update public.purchases
       set supplier_name=v_supplier,
           purchase_date=v_date,
           payment_method=v_method,
           due_date=nullif(p_row->>'due_date','')::date,
           notes=nullif(p_row->>'notes',''),
           updated_at=now()
     where id=v_id and company_id=p_company;

    delete from public.purchase_items where purchase_id=v_id and company_id=p_company;
  end if;

  for item in select value from jsonb_array_elements(p_items) loop
    v_product := nullif(item->>'product_id','')::uuid;
    insert into public.purchase_items(
      purchase_id,company_id,product_id,name,quantity,unit_cost
    ) values (
      v_id,p_company,v_product,left(coalesce(nullif(item->>'name',''),'Item'),500),
      (item->>'quantity')::numeric,(item->>'unit_cost')::numeric
    );
  end loop;

  -- Compara o que esta compra representa agora com o que já havia sido contabilizado.
  -- Para produto sem controle de estoque, apenas atualizamos o baseline: se o controle
  -- for ativado no futuro, uma compra antiga não entra retroativamente por acidente.
  for v_stock in
    with current_purchase as (
      select
        pi.product_id,
        sum(pi.quantity)::numeric(14,3) as current_qty,
        (sum(pi.quantity*pi.unit_cost)/nullif(sum(pi.quantity),0))::numeric(12,2) as current_cost
      from public.purchase_items pi
      where pi.purchase_id=v_id
        and pi.company_id=p_company
        and pi.product_id is not null
      group by pi.product_id
    ), accounted as (
      select product_id,quantity_accounted,unit_cost
      from zt_private.purchase_inventory_sync
      where purchase_id=v_id and company_id=p_company
    )
    select
      coalesce(c.product_id,a.product_id) as product_id,
      coalesce(a.quantity_accounted,0)::numeric(14,3) as old_qty,
      coalesce(c.current_qty,0)::numeric(14,3) as new_qty,
      a.unit_cost as old_cost,
      c.current_cost as new_cost
    from current_purchase c
    full join accounted a using(product_id)
  loop
    v_delta := (v_stock.new_qty - v_stock.old_qty)::numeric(14,3);

    select p.stock_qty,p.track_stock
      into v_current_stock,v_track_stock
      from public.products p
     where p.id=v_stock.product_id and p.company_id=p_company
     for update;

    if found and v_track_stock and v_delta <> 0 then
      if v_current_stock + v_delta < 0 then
        raise exception 'Não é possível reduzir a compra: o estoque de um produto já foi consumido ou vendido'
          using errcode='23514';
      end if;

      update public.products
         set stock_qty=stock_qty+v_delta
       where id=v_stock.product_id and company_id=p_company;

      insert into public.inventory_movements(
        company_id,product_id,kind,quantity_delta,unit_cost,purchase_id,notes,created_by
      ) values (
        p_company,
        v_stock.product_id,
        'purchase',
        v_delta,
        case when v_delta > 0 then v_stock.new_cost else coalesce(v_stock.old_cost,v_stock.new_cost) end,
        v_id,
        case when p_purchase is null
             then left('Entrada pela compra '||v_number,1000)
             else left('Ajuste pela edição da compra '||v_number,1000) end,
        v_uid
      );
    end if;
  end loop;

  -- Baseline passa a refletir exatamente os itens atuais da compra.
  delete from zt_private.purchase_inventory_sync
   where purchase_id=v_id and company_id=p_company;

  insert into zt_private.purchase_inventory_sync(
    purchase_id,company_id,product_id,quantity_accounted,unit_cost
  )
  select
    pi.purchase_id,
    pi.company_id,
    pi.product_id,
    sum(pi.quantity)::numeric(14,3),
    (sum(pi.quantity*pi.unit_cost)/nullif(sum(pi.quantity),0))::numeric(12,2)
  from public.purchase_items pi
  where pi.purchase_id=v_id
    and pi.company_id=p_company
    and pi.product_id is not null
  group by pi.purchase_id,pi.company_id,pi.product_id;

  if v_entry is null then
    insert into public.financial_entries(
      company_id,kind,description,amount,due_date,paid,paid_at,payment_method,category,purchase_id
    ) values (
      p_company,'expense',left('Compra '||v_number||' · '||v_supplier,500),v_total,v_due,v_paid,
      case when v_paid then v_date else null end,
      case when v_paid then v_method else null end,
      'Materiais',v_id
    ) returning id into v_entry;

    update public.purchases
       set entry_id=v_entry,updated_at=now()
     where id=v_id and company_id=p_company;
  else
    update public.financial_entries
       set description=left('Compra '||v_number||' · '||v_supplier,500),
           amount=v_total,
           due_date=v_due,
           paid=v_paid,
           paid_at=case when v_paid then coalesce(paid_at,v_date) else null end,
           payment_method=case when v_paid then v_method else null end,
           category='Materiais',
           purchase_id=v_id
     where id=v_entry and company_id=p_company;

    if not found then
      raise exception 'Lançamento financeiro da compra não encontrado' using errcode='42501';
    end if;
  end if;

  return v_id;
end;
$$;

revoke all on function zt_private.zt_save_purchase(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function zt_private.zt_save_purchase(uuid,uuid,jsonb,jsonb) to service_role;
