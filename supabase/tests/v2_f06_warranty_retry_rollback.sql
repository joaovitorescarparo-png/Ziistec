-- ZiisTec blocker regression F06 — retry idempotente da finalização com warranty override.
-- Destino: SOMENTE staging/homologação. Tudo termina em ROLLBACK.
-- Pré-fix esperado: primeira chamada conclui, segunda chamada idêntica falha com OS já done.

begin;

create temp table zt_f06_retry_test (
  owner_id uuid,
  company_id uuid,
  client_id uuid,
  service_id uuid,
  wo_id uuid,
  item_id uuid,
  first_entry uuid,
  retry_entry uuid,
  retry_succeeded boolean default false,
  retry_sqlstate text,
  financial_count integer,
  warranty_count integer
) on commit drop;
grant select, update on zt_f06_retry_test to authenticated;

insert into zt_f06_retry_test(owner_id,company_id,client_id,service_id,wo_id,item_id)
select m.user_id,gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()
from public.company_members m
where m.role='owner' and m.status='active'
limit 1;

do $$
begin
  if not exists (select 1 from zt_f06_retry_test) then
    raise exception 'F06_NEEDS_ACTIVE_OWNER';
  end if;
end $$;

select set_config('request.jwt.claim.sub',(select owner_id::text from zt_f06_retry_test),true);

insert into public.companies(id,name)
select company_id,'__F06_RETRY__' from zt_f06_retry_test;
insert into public.subscriptions(company_id,status,current_period_start,current_period_end)
select company_id,'trial'::public.zt_sub_status,current_date,current_date+14 from zt_f06_retry_test;
insert into public.company_members(company_id,user_id,role,status)
select company_id,owner_id,'owner'::public.zt_role,'active'::public.zt_member_status from zt_f06_retry_test;
insert into public.clients(id,company_id,name)
select client_id,company_id,'__F06_CLIENT__' from zt_f06_retry_test;
insert into public.services(id,company_id,name,unit,price,cost,warranty_days,active)
select service_id,company_id,'__F06_SERVICE__','unidade',100,0,90,true from zt_f06_retry_test;
insert into public.work_orders(id,company_id,number,client_id,assigned_to,status,created_by)
select wo_id,company_id,'__F06-OS__',client_id,owner_id,'in_progress'::public.zt_wo_status,owner_id from zt_f06_retry_test;
insert into public.work_order_items(
  id,work_order_id,company_id,kind,service_id,name,unit,quantity,unit_price,unit_cost,is_extra,price_pending
)
select item_id,wo_id,company_id,'service'::public.zt_item_kind,service_id,'__F06_SERVICE__','unidade',1,100,0,false,false
from zt_f06_retry_test;

set local role authenticated;

update zt_f06_retry_test t
set first_entry=public.zt_finalize_work_order_with_warranty_overrides(
  t.wo_id,
  '__F06_FIRST__',
  null,
  null,
  7,
  '[]'::jsonb,
  '[]'::jsonb,
  jsonb_build_array(jsonb_build_object('item_id',t.item_id,'policy','custom','days',30))
);

-- Simula resposta perdida: repete exatamente a operação já commitada.
do $$
declare t zt_f06_retry_test%rowtype; v_entry uuid;
begin
  select * into t from zt_f06_retry_test;
  begin
    v_entry:=public.zt_finalize_work_order_with_warranty_overrides(
      t.wo_id,
      '__F06_FIRST__',
      null,
      null,
      7,
      '[]'::jsonb,
      '[]'::jsonb,
      jsonb_build_array(jsonb_build_object('item_id',t.item_id,'policy','custom','days',30))
    );
    update zt_f06_retry_test set retry_entry=v_entry,retry_succeeded=true;
  exception when others then
    update zt_f06_retry_test set retry_succeeded=false,retry_sqlstate=sqlstate;
  end;
end $$;

reset role;

update zt_f06_retry_test t
set financial_count=(select count(*) from public.financial_entries f where f.work_order_id=t.wo_id),
    warranty_count=(select count(*) from public.warranties w where w.work_order_id=t.wo_id);

select
  'F06_WARRANTY_OVERRIDE_RETRY_IDEMPOTENCY' as test,
  first_entry,
  retry_entry,
  retry_succeeded,
  retry_sqlstate,
  financial_count,
  warranty_count,
  (
    first_entry is not null
    and retry_succeeded
    and retry_entry=first_entry
    and financial_count=1
    and warranty_count=1
  ) as passed,
  case
    when first_entry is not null and retry_succeeded and retry_entry=first_entry and financial_count=1 and warranty_count=1 then 'OK'
    else 'REPRODUCED_F06'
  end as outcome
from zt_f06_retry_test;

rollback;
