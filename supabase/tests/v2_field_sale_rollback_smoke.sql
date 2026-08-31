-- ZiisTec V2 — venda rápida em campo por técnico, idempotência e ROLLBACK.
begin;

create temp table zt_field_sale_test (
  user_id uuid,
  company_id uuid,
  product_id uuid,
  request_id uuid,
  blocked_request_id uuid,
  sale_id uuid,
  retry_id uuid,
  disabled_blocked boolean default false,
  stock_after numeric,
  movement_delta numeric,
  financial_count int,
  financial_amount numeric,
  financial_paid boolean,
  financial_method text
) on commit drop;

grant select, update on zt_field_sale_test to authenticated;

insert into zt_field_sale_test(user_id,company_id,product_id,request_id,blocked_request_id)
select m.user_id,gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()
from public.company_members m
where m.role='owner' and m.status='active'
limit 1;

do $$ begin
  if not exists(select 1 from zt_field_sale_test) then
    raise exception 'V2_FIELD_SALE_NEEDS_ACTIVE_TEST_USER';
  end if;
end $$;

select set_config('request.jwt.claim.sub',(select user_id::text from zt_field_sale_test),true);

insert into public.companies(id,name,has_team)
select company_id,'__V2_FIELD_SALE_COMPANY__',true from zt_field_sale_test;

insert into public.subscriptions(company_id,status,current_period_start,current_period_end)
select company_id,'trial'::public.zt_sub_status,current_date,current_date+14 from zt_field_sale_test;

insert into public.company_members(company_id,user_id,role,status,job_title)
select company_id,user_id,'technician'::public.zt_role,'active'::public.zt_member_status,'__V2_FIELD_TECH__'
from zt_field_sale_test;

insert into public.products(
  id,company_id,name,brand,unit,cost,price,warranty_months,active,sale_enabled,track_stock,stock_qty,low_stock_threshold
)
select product_id,company_id,'__V2_FIELD_PRODUCT__','ZiisTec','unidade',30,100,12,true,true,true,5,1
from zt_field_sale_test;

set local role authenticated;
update zt_field_sale_test set sale_id=public.zt_sell_product_direct(company_id,product_id,2,'Pix','__V2_FIELD_OK__',request_id);
update zt_field_sale_test set retry_id=public.zt_sell_product_direct(company_id,product_id,2,'Pix','__V2_FIELD_RETRY__',request_id);
reset role;

update zt_field_sale_test t set
  stock_after=(select p.stock_qty from public.products p where p.id=t.product_id),
  movement_delta=(select coalesce(sum(m.quantity_delta),0) from public.inventory_movements m where m.product_id=t.product_id and m.kind='sale'),
  financial_count=(select count(*) from public.financial_entries f join public.field_sales s on s.financial_entry_id=f.id where s.id=t.sale_id),
  financial_amount=(select f.amount from public.financial_entries f join public.field_sales s on s.financial_entry_id=f.id where s.id=t.sale_id),
  financial_paid=(select f.paid from public.financial_entries f join public.field_sales s on s.financial_entry_id=f.id where s.id=t.sale_id),
  financial_method=(select f.payment_method from public.financial_entries f join public.field_sales s on s.financial_entry_id=f.id where s.id=t.sale_id);

-- Produto desabilitado para venda deve ser rejeitado mesmo para técnico ativo.
update public.products p set sale_enabled=false from zt_field_sale_test t where p.id=t.product_id;
set local role authenticated;
do $$ begin
  begin
    perform public.zt_sell_product_direct(
      (select company_id from zt_field_sale_test),
      (select product_id from zt_field_sale_test),
      1,'Pix','__V2_FIELD_MUST_FAIL__',
      (select blocked_request_id from zt_field_sale_test)
    );
  exception when sqlstate 'P0002' then
    update zt_field_sale_test set disabled_blocked=true;
  end;
end $$;
reset role;

select
  'V2_FIELD_SALE_OK' as result,
  sale_id is not null as sale_created,
  sale_id=retry_id as retry_same_sale,
  stock_after,
  movement_delta,
  financial_count,
  financial_amount,
  financial_paid,
  financial_method,
  disabled_blocked,
  (
    sale_id is not null
    and sale_id=retry_id
    and stock_after=3
    and movement_delta=-2
    and financial_count=1
    and financial_amount=200
    and financial_paid=true
    and financial_method='Pix'
    and disabled_blocked=true
  ) as passed
from zt_field_sale_test;

rollback;
