-- ZiisTec V2 — recebimentos/venda em campo/OS: contrato, RLS, retry e ROLLBACK.
-- Executado somente na stack Supabase descartável da CI após ci_local_seed.sql.
begin;

create temp table zt_fs75 (
  product_id uuid not null default gen_random_uuid(),
  client_id uuid not null default gen_random_uuid(),
  hidden_client_id uuid not null default gen_random_uuid(),
  work_order_id uuid not null default gen_random_uuid(),
  quick_request uuid not null default gen_random_uuid(),
  quick_retry_id uuid,
  quick_sale_id uuid,
  os_request uuid not null default gen_random_uuid(),
  os_item_id uuid,
  os_retry_item_id uuid,
  owner_request uuid not null default gen_random_uuid(),
  owner_sale_id uuid,
  invalid_method_blocked boolean default false,
  disabled_method_blocked boolean default false,
  hidden_client_blocked boolean default false,
  forged_company_blocked boolean default false,
  disabled_tech_blocked boolean default false,
  sale_disabled_blocked boolean default false,
  insufficient_stock_blocked boolean default false,
  tech_context_count integer,
  tech_hidden_context_count integer,
  tech_sale_count integer,
  tech_b_sale_count integer,
  owner_a_sale_count integer,
  owner_b_sale_count integer
) on commit drop;
insert into zt_fs75 default values;
grant select,update on zt_fs75 to authenticated;

-- Os fixtures operacionais também passam pelos guards reais. Autentica o owner A
-- antes de criá-los; depois cada trecho troca explicitamente para o usuário que testa.
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);

-- ---------------------------------------------------------------- fixtures
update public.companies
set pix_key='ci-pix@example.invalid',
    pix_receiver_name='ZIISTEC CI',
    pix_receiver_city='ITAPEMA',
    field_sales_allow_pix=true,
    field_sales_allow_cash=true,
    field_sales_allow_card=true,
    field_sales_allow_transfer=false,
    field_sales_allow_other=false
where id='20000000-0000-0000-0000-000000000001';

-- O usuário externo vira um segundo técnico somente dentro desta transação de teste.
insert into public.company_members(company_id,user_id,role,status,job_title)
values(
  '20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000004',
  'technician','active','CI Technician B'
)
on conflict (company_id,user_id) do update
set role='technician',status='active',job_title='CI Technician B';

insert into public.clients(id,company_id,name)
select client_id,'20000000-0000-0000-0000-000000000001','CI Condomínio Permitido' from zt_fs75;
insert into public.clients(id,company_id,name)
select hidden_client_id,'20000000-0000-0000-0000-000000000001','CI Cliente Fora do Escopo' from zt_fs75;

insert into public.work_orders(
  id,company_id,number,client_id,assigned_to,status,address,service_place
)
select work_order_id,'20000000-0000-0000-0000-000000000001','CI-FS75-001',client_id,
  '10000000-0000-0000-0000-000000000003','in_progress','Rua CI 75','Portaria'
from zt_fs75;

insert into public.products(
  id,company_id,name,brand,unit,cost,price,warranty_months,active,sale_enabled,
  track_stock,stock_qty,low_stock_threshold
)
select product_id,'20000000-0000-0000-0000-000000000001','Controle Intelbras CI','Intelbras',
  'unidade',30,123.45,12,true,true,true,10,1
from zt_fs75;

-- ---------------------------------------------------------------- technician quick sale
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
set local role authenticated;

update zt_fs75 t set quick_sale_id=public.zt_sell_product_direct(
  '20000000-0000-0000-0000-000000000001',t.product_id,2,'PIX','CI QUICK',t.quick_request,t.client_id,'Portaria'
);
update zt_fs75 t set quick_retry_id=public.zt_sell_product_direct(
  '20000000-0000-0000-0000-000000000001',t.product_id,2,'pix','CI RETRY',t.quick_request,t.client_id,'Portaria'
);

do $$ begin
  begin
    perform public.zt_sell_product_direct(
      '20000000-0000-0000-0000-000000000001',(select product_id from zt_fs75),1,
      'boleto','CI INVALID',gen_random_uuid(),null,null
    );
  exception when sqlstate '22023' then update zt_fs75 set invalid_method_blocked=true; end;
end $$;

do $$ begin
  begin
    perform public.zt_sell_product_direct(
      '20000000-0000-0000-0000-000000000001',(select product_id from zt_fs75),1,
      'transfer','CI DISABLED METHOD',gen_random_uuid(),null,null
    );
  exception when sqlstate '42501' then update zt_fs75 set disabled_method_blocked=true; end;
end $$;

do $$ begin
  begin
    perform public.zt_sell_product_direct(
      '20000000-0000-0000-0000-000000000001',(select product_id from zt_fs75),1,
      'cash','CI HIDDEN CLIENT',gen_random_uuid(),(select hidden_client_id from zt_fs75),'Local oculto'
    );
  exception when sqlstate '42501' then update zt_fs75 set hidden_client_blocked=true; end;
end $$;

do $$ begin
  begin
    perform public.zt_sell_product_direct(
      '20000000-0000-0000-0000-000000000002',(select product_id from zt_fs75),1,
      'cash','CI FORGED COMPANY',gen_random_uuid(),null,null
    );
  exception when sqlstate '42501' then update zt_fs75 set forged_company_blocked=true; end;
end $$;

update zt_fs75 set
  tech_context_count=(select count(*) from public.zt_field_sale_client_contexts('20000000-0000-0000-0000-000000000001') c where c.client_id=(select client_id from zt_fs75)),
  tech_hidden_context_count=(select count(*) from public.zt_field_sale_client_contexts('20000000-0000-0000-0000-000000000001') c where c.client_id=(select hidden_client_id from zt_fs75));

reset role;

-- ---------------------------------------------------------------- disabled/sale-disabled/stock guards
update public.company_members
set status='disabled'
where company_id='20000000-0000-0000-0000-000000000001'
  and user_id='10000000-0000-0000-0000-000000000003';
set local role authenticated;
do $$ begin
  begin
    perform public.zt_sell_product_direct(
      '20000000-0000-0000-0000-000000000001',(select product_id from zt_fs75),1,
      'cash','CI DISABLED TECH',gen_random_uuid(),null,null
    );
  exception when sqlstate '42501' then update zt_fs75 set disabled_tech_blocked=true; end;
end $$;
reset role;
update public.company_members set status='active'
where company_id='20000000-0000-0000-0000-000000000001'
  and user_id='10000000-0000-0000-0000-000000000003';

update public.products p set sale_enabled=false from zt_fs75 t where p.id=t.product_id;
set local role authenticated;
do $$ begin
  begin
    perform public.zt_sell_product_direct(
      '20000000-0000-0000-0000-000000000001',(select product_id from zt_fs75),1,
      'cash','CI SALE DISABLED',gen_random_uuid(),null,null
    );
  exception when sqlstate 'P0002' then update zt_fs75 set sale_disabled_blocked=true; end;
end $$;
reset role;
update public.products p set sale_enabled=true from zt_fs75 t where p.id=t.product_id;

set local role authenticated;
do $$ begin
  begin
    perform public.zt_sell_product_direct(
      '20000000-0000-0000-0000-000000000001',(select product_id from zt_fs75),999,
      'cash','CI STOCK',gen_random_uuid(),null,null
    );
  exception when sqlstate '23514' then update zt_fs75 set insufficient_stock_blocked=true; end;
end $$;
reset role;

-- ---------------------------------------------------------------- technician sale in work order
set local role authenticated;
update zt_fs75 t set os_item_id=public.zt_sell_product_on_work_order(
  t.work_order_id,t.product_id,1,'CI OS SALE',t.os_request
);
update zt_fs75 t set os_retry_item_id=public.zt_sell_product_on_work_order(
  t.work_order_id,t.product_id,1,'CI OS RETRY',t.os_request
);
reset role;

-- ---------------------------------------------------------------- owner creates one own quick sale, then RLS views are checked
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
set local role authenticated;
update zt_fs75 t set owner_sale_id=public.zt_sell_product_direct(
  '20000000-0000-0000-0000-000000000001',t.product_id,1,'Dinheiro','CI OWNER SALE',t.owner_request,t.client_id,'Portaria'
);
update zt_fs75 set owner_a_sale_count=(
  select count(*) from public.field_sales where company_id='20000000-0000-0000-0000-000000000001'
);
reset role;

select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
set local role authenticated;
update zt_fs75 set owner_b_sale_count=(
  select count(*) from public.field_sales where company_id='20000000-0000-0000-0000-000000000001'
);
reset role;

select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
set local role authenticated;
update zt_fs75 set tech_sale_count=(
  select count(*) from public.field_sales where company_id='20000000-0000-0000-0000-000000000001'
);
reset role;

select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000004',true);
set local role authenticated;
update zt_fs75 set tech_b_sale_count=(
  select count(*) from public.field_sales where company_id='20000000-0000-0000-0000-000000000001'
);
reset role;

-- ---------------------------------------------------------------- assertions privileged
select
  'V2_FIELD_SALES_CONSISTENCY_OK' as result,
  t.quick_sale_id=t.quick_retry_id as quick_retry_same_sale,
  t.os_item_id=t.os_retry_item_id as os_retry_same_item,
  t.invalid_method_blocked,
  t.disabled_method_blocked,
  t.hidden_client_blocked,
  t.forged_company_blocked,
  t.disabled_tech_blocked,
  t.sale_disabled_blocked,
  t.insufficient_stock_blocked,
  t.tech_context_count,
  t.tech_hidden_context_count,
  t.tech_sale_count,
  t.tech_b_sale_count,
  t.owner_a_sale_count,
  t.owner_b_sale_count,
  (
    t.quick_sale_id=t.quick_retry_id
    and t.os_item_id=t.os_retry_item_id
    and t.invalid_method_blocked
    and t.disabled_method_blocked
    and t.hidden_client_blocked
    and t.forged_company_blocked
    and t.disabled_tech_blocked
    and t.sale_disabled_blocked
    and t.insufficient_stock_blocked
    and t.tech_context_count=1
    and t.tech_hidden_context_count=0
    and t.tech_sale_count=2
    and t.tech_b_sale_count=0
    and t.owner_a_sale_count=3
    and t.owner_b_sale_count=0
    and (select count(*) from public.field_sales s where s.id=t.quick_sale_id and s.origin='quick' and s.payment_method='pix' and s.client_id=t.client_id and s.financial_entry_id is not null)=1
    and (select count(*) from public.financial_entries f join public.field_sales s on s.financial_entry_id=f.id where s.id=t.quick_sale_id and f.paid=true and f.payment_method='pix' and f.amount=246.90)=1
    and (select count(*) from public.inventory_movements m where m.product_id=t.product_id and m.kind='sale' and m.work_order_id is null and m.quantity_delta=-2)=1
    and (select count(*) from public.field_sales s where s.work_order_item_id=t.os_item_id and s.origin='work_order' and s.work_order_id=t.work_order_id and s.client_id=t.client_id and s.service_place='Portaria' and s.payment_method is null and s.financial_entry_id is null and s.unit_price=123.45)=1
    and (select count(*) from public.work_order_items i where i.id=t.os_item_id and i.work_order_id=t.work_order_id and i.product_id=t.product_id and i.unit_price=123.45 and i.kind='product')=1
    and (select count(*) from public.work_order_materials m where m.work_order_id=t.work_order_id and m.product_id=t.product_id)=0
    and (select count(*) from public.inventory_movements m where m.product_id=t.product_id and m.work_order_id=t.work_order_id and m.kind='sale' and m.quantity_delta=-1)=1
    and (select p.stock_qty from public.products p where p.id=t.product_id)=6
  ) as passed
from zt_fs75 t;

rollback;
