-- RC-1C.2 runtime hotfix regression.
-- Disposable/local CI only: all data is synthetic and the transaction always rolls back.
-- Separates manual OS WRITE + READ-BACK and verifies quote image flag persistence.

begin;

create temp table zt_rc1c2_runtime_test (
  owner_id uuid,
  company_id uuid,
  client_id uuid,
  product_id uuid,
  request_id uuid,
  first_wo uuid,
  retry_wo uuid,
  quote_id uuid,
  quote_on boolean default false,
  quote_off boolean default false
) on commit drop;
grant select, update on zt_rc1c2_runtime_test to authenticated;

insert into zt_rc1c2_runtime_test(owner_id,company_id,client_id,product_id,request_id)
select m.user_id,gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()
from public.company_members m
where m.role='owner' and m.status='active'
limit 1;

do $$
begin
  if not exists (select 1 from zt_rc1c2_runtime_test) then
    raise exception 'RC1C2_NEEDS_ACTIVE_OWNER';
  end if;
end $$;

select set_config('request.jwt.claim.sub',(select owner_id::text from zt_rc1c2_runtime_test),true);

insert into public.companies(id,name)
select company_id,'__RC1C2_RUNTIME__' from zt_rc1c2_runtime_test;

insert into public.subscriptions(company_id,status,current_period_start,current_period_end)
select company_id,'trial'::public.zt_sub_status,current_date,current_date+14 from zt_rc1c2_runtime_test;

insert into public.company_members(company_id,user_id,role,status)
select company_id,owner_id,'owner'::public.zt_role,'active'::public.zt_member_status from zt_rc1c2_runtime_test;

insert into public.clients(id,company_id,name,address)
select client_id,company_id,'__RC1C2_CLIENT__','Rua RC1C2, 10' from zt_rc1c2_runtime_test;

insert into public.products(id,company_id,name,unit,cost,price,active,image_path)
select product_id,company_id,'Motor RC1C2','unidade',500,900,true,company_id::text||'/products/motor-rc1c2.jpg'
from zt_rc1c2_runtime_test;

set local role authenticated;

update zt_rc1c2_runtime_test t
set first_wo=public.zt_save_work_order_idempotent(
  t.company_id,
  null,
  t.request_id,
  jsonb_build_object(
    'company_id',t.company_id,
    'client_id',t.client_id,
    'assigned_to',t.owner_id,
    'status','unscheduled',
    'scheduled_date',null,
    'scheduled_time','09:00',
    'address','Rua RC1C2, 10',
    'service_place','Portaria',
    'request','Nova OS manual RC1C2',
    'pre_notes','Teste de escrita manual'
  ),
  '[]'::jsonb
);

update zt_rc1c2_runtime_test t
set retry_wo=public.zt_save_work_order_idempotent(
  t.company_id,
  null,
  t.request_id,
  jsonb_build_object(
    'company_id',t.company_id,
    'client_id',t.client_id,
    'assigned_to',t.owner_id,
    'status','unscheduled',
    'scheduled_date',null,
    'scheduled_time','09:00',
    'address','Rua RC1C2, 10',
    'service_place','Portaria',
    'request','Nova OS manual RC1C2',
    'pre_notes','Teste de escrita manual'
  ),
  '[]'::jsonb
);

update zt_rc1c2_runtime_test t
set quote_id=public.zt_save_quote_idempotent(
  t.company_id,
  null,
  gen_random_uuid(),
  jsonb_build_object(
    'company_id',t.company_id,
    'client_id',t.client_id,
    'status','draft',
    'issue_date',current_date,
    'valid_until',current_date+15,
    'discount',0,
    'surcharge',0,
    'payment_terms','Pix',
    'show_product_images',true,
    'address','Rua RC1C2, 10',
    'created_by',t.owner_id
  ),
  jsonb_build_array(jsonb_build_object(
    'company_id',t.company_id,
    'kind','product',
    'product_id',t.product_id,
    'name','Motor RC1C2',
    'unit','unidade',
    'quantity',1,
    'unit_price',900,
    'unit_cost',500,
    'position',0
  ))
);

update zt_rc1c2_runtime_test t
set quote_on=(select q.show_product_images from public.quotes q where q.id=t.quote_id);

update zt_rc1c2_runtime_test t
set quote_id=public.zt_save_quote_idempotent(
  t.company_id,
  t.quote_id,
  null,
  jsonb_build_object(
    'company_id',t.company_id,
    'client_id',t.client_id,
    'status','draft',
    'issue_date',current_date,
    'valid_until',current_date+15,
    'discount',0,
    'surcharge',0,
    'payment_terms','Pix',
    'show_product_images',false,
    'address','Rua RC1C2, 10',
    'created_by',t.owner_id
  ),
  jsonb_build_array(jsonb_build_object(
    'company_id',t.company_id,
    'kind','product',
    'product_id',t.product_id,
    'name','Motor RC1C2',
    'unit','unidade',
    'quantity',1,
    'unit_price',900,
    'unit_cost',500,
    'position',0
  ))
);

update zt_rc1c2_runtime_test t
set quote_off=not (select q.show_product_images from public.quotes q where q.id=t.quote_id);

reset role;

do $$
declare t zt_rc1c2_runtime_test%rowtype;
begin
  select * into t from zt_rc1c2_runtime_test;

  if not (
    t.first_wo is not null
    and t.retry_wo=t.first_wo
    and exists(
      select 1 from public.work_orders w
      where w.id=t.first_wo
        and w.company_id=t.company_id
        and w.client_id=t.client_id
        and w.assigned_to=t.owner_id
        and w.status='unscheduled'::public.zt_wo_status
        and w.scheduled_date is null
        and w.scheduled_time='09:00'::time
        and w.request='Nova OS manual RC1C2'
        and w.client_request_id=t.request_id
    )
    and (select count(*) from public.work_orders w where w.company_id=t.company_id and w.client_request_id=t.request_id)=1
  ) then
    raise exception 'RC1C2_MANUAL_OS_WRITE_READBACK_FAILED';
  end if;

  if not (
    t.quote_on
    and t.quote_off
    and exists(
      select 1
      from public.quote_items qi
      join public.products p on p.id=qi.product_id and p.company_id=qi.company_id
      where qi.quote_id=t.quote_id and p.image_path is not null
    )
  ) then
    raise exception 'RC1C2_QUOTE_PRODUCT_IMAGE_FLAG_FAILED';
  end if;
end $$;

select
  'RC1C2_MANUAL_OS_WRITE_READBACK' as test,
  t.first_wo is not null as write_created,
  exists(
    select 1 from public.work_orders w
    where w.id=t.first_wo
      and w.company_id=t.company_id
      and w.client_id=t.client_id
      and w.assigned_to=t.owner_id
      and w.status='unscheduled'::public.zt_wo_status
      and w.scheduled_date is null
      and w.scheduled_time='09:00'::time
      and w.request='Nova OS manual RC1C2'
      and w.client_request_id=t.request_id
  ) as read_back_ok,
  t.retry_wo=t.first_wo as retry_same_id,
  (select count(*) from public.work_orders w where w.company_id=t.company_id and w.client_request_id=t.request_id)=1 as exactly_one,
  (
    t.first_wo is not null
    and t.retry_wo=t.first_wo
    and exists(
      select 1 from public.work_orders w
      where w.id=t.first_wo and w.request='Nova OS manual RC1C2' and w.client_request_id=t.request_id
    )
    and (select count(*) from public.work_orders w where w.company_id=t.company_id and w.client_request_id=t.request_id)=1
  ) as passed
from zt_rc1c2_runtime_test t;

select
  'RC1C2_QUOTE_PRODUCT_IMAGE_FLAG' as test,
  t.quote_on as persisted_on,
  t.quote_off as persisted_off,
  exists(
    select 1
    from public.quote_items qi
    join public.products p on p.id=qi.product_id and p.company_id=qi.company_id
    where qi.quote_id=t.quote_id and p.image_path is not null
  ) as product_image_link_ok,
  (t.quote_on and t.quote_off and exists(
    select 1
    from public.quote_items qi
    join public.products p on p.id=qi.product_id and p.company_id=qi.company_id
    where qi.quote_id=t.quote_id and p.image_path is not null
  )) as passed
from zt_rc1c2_runtime_test t;

rollback;
