-- ZiisTec V2 — venda de produto por técnico, isolamento de custo e ROLLBACK.
--
-- Destino: SOMENTE HOMOLOGAÇÃO/STAGING após migrations 0050→0061.
-- Requisito: ao menos 1 owner ativo existente para fornecer um auth.uid() de teste.
-- Não substitui E2E com usuários Auth separados. Nenhum dado permanece: ROLLBACK final.

begin;

create temp table zt_technician_sale_test (
  user_id uuid,
  company_id uuid,
  client_id uuid,
  assigned_wo_id uuid,
  unassigned_wo_id uuid,
  product_id uuid,
  sold_item_id uuid,
  unassigned_blocked boolean default false,
  tech_public_item_visible boolean,
  tech_public_unit_cost numeric,
  tech_private_cost_visible boolean,
  stock_after numeric,
  movement_delta numeric,
  owner_private_cost_visible boolean,
  owner_private_cost numeric
) on commit drop;

grant select, update on zt_technician_sale_test to authenticated;

insert into zt_technician_sale_test(
  user_id, company_id, client_id, assigned_wo_id, unassigned_wo_id, product_id
)
select
  m.user_id,
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid()
from public.company_members m
where m.role='owner' and m.status='active'
limit 1;

-- Falha explícita se a base de staging não tiver um usuário real para simular auth.uid().
do $$
begin
  if not exists (select 1 from zt_technician_sale_test) then
    raise exception 'V2_TECH_SALE_NEEDS_ACTIVE_TEST_USER';
  end if;
end
$$;

select set_config(
  'request.jwt.claim.sub',
  (select user_id::text from zt_technician_sale_test),
  true
);

insert into public.companies(id,name,has_team)
select company_id,'__V2_TECH_SALE_COMPANY__',true
from zt_technician_sale_test;

insert into public.subscriptions(company_id,status,current_period_start,current_period_end)
select company_id,'trial'::public.zt_sub_status,current_date,current_date+14
from zt_technician_sale_test;

insert into public.company_members(company_id,user_id,role,status,job_title)
select company_id,user_id,'technician'::public.zt_role,'active'::public.zt_member_status,'__V2_TEST_TECH__'
from zt_technician_sale_test;

insert into public.clients(id,company_id,name)
select client_id,company_id,'__V2_TECH_SALE_CLIENT__'
from zt_technician_sale_test;

insert into public.work_orders(id,company_id,number,client_id,assigned_to,status)
select assigned_wo_id,company_id,'__V2-TECH-SALE-ASSIGNED__',client_id,user_id,'in_progress'::public.zt_wo_status
from zt_technician_sale_test;

insert into public.work_orders(id,company_id,number,client_id,assigned_to,status)
select unassigned_wo_id,company_id,'__V2-TECH-SALE-UNASSIGNED__',client_id,null,'in_progress'::public.zt_wo_status
from zt_technician_sale_test;

insert into public.products(
  id,company_id,name,brand,model,unit,cost,price,warranty_months,active,
  sale_enabled,track_stock,stock_qty,low_stock_threshold
)
select
  product_id,company_id,'__V2_TEST_PRODUCT__','ZiisTec','Smoke','unidade',30,100,12,true,
  true,true,5,1
from zt_technician_sale_test;

-- ---------------------------------------------------------------- technician
set local role authenticated;

update zt_technician_sale_test
set sold_item_id = public.zt_sell_product_on_work_order(
  assigned_wo_id,
  product_id,
  2,
  '__V2_TECH_SALE_OK__'
);

update zt_technician_sale_test t
set tech_public_item_visible = exists(
      select 1 from public.work_order_items i where i.id=t.sold_item_id
    ),
    tech_public_unit_cost = (
      select i.unit_cost from public.work_order_items i where i.id=t.sold_item_id
    ),
    tech_private_cost_visible = exists(
      select 1 from public.work_order_item_costs c where c.work_order_item_id=t.sold_item_id
    );

-- Técnico ativo, mas sem atribuição na segunda OS: a RPC deve negar antes de vender.
do $$
begin
  begin
    perform public.zt_sell_product_on_work_order(
      (select unassigned_wo_id from zt_technician_sale_test),
      (select product_id from zt_technician_sale_test),
      1,
      '__V2_TECH_SALE_MUST_FAIL__'
    );
    update zt_technician_sale_test set unassigned_blocked=false;
  exception when sqlstate '42501' then
    update zt_technician_sale_test set unassigned_blocked=true;
  end;
end
$$;

reset role;

-- ----------------------------------------------------------- privileged audit
-- O teste verifica o efeito real após a chamada do técnico, sem expor isso ao técnico.
update zt_technician_sale_test t
set stock_after = (select p.stock_qty from public.products p where p.id=t.product_id),
    movement_delta = (
      select coalesce(sum(m.quantity_delta),0)
      from public.inventory_movements m
      where m.product_id=t.product_id and m.work_order_id=t.assigned_wo_id and m.kind='sale'
    );

-- Para provar a outra metade da RLS, promovemos somente a membership TEMPORÁRIA do
-- mesmo usuário para owner e consultamos o ledger privado como authenticated.
update public.company_members m
set role='owner'::public.zt_role
from zt_technician_sale_test t
where m.company_id=t.company_id and m.user_id=t.user_id;

set local role authenticated;
update zt_technician_sale_test t
set owner_private_cost_visible = exists(
      select 1 from public.work_order_item_costs c where c.work_order_item_id=t.sold_item_id
    ),
    owner_private_cost = (
      select c.unit_cost from public.work_order_item_costs c where c.work_order_item_id=t.sold_item_id
    );
reset role;

select
  'V2_TECHNICIAN_SALE_COST_ISOLATION_OK' as result,
  sold_item_id is not null as sale_created,
  unassigned_blocked,
  tech_public_item_visible,
  tech_public_unit_cost,
  tech_private_cost_visible,
  stock_after,
  movement_delta,
  owner_private_cost_visible,
  owner_private_cost,
  (
    sold_item_id is not null
    and unassigned_blocked=true
    and tech_public_item_visible=true
    and tech_public_unit_cost=0
    and tech_private_cost_visible=false
    and stock_after=3
    and movement_delta=-2
    and owner_private_cost_visible=true
    and owner_private_cost=30
  ) as passed
from zt_technician_sale_test;

rollback;
