-- ZiisTec blocker regression F01 — orçamento aprovado precisa faturar o total comercial aprovado.
-- Destino: SOMENTE staging/homologação. Tudo termina em ROLLBACK.
-- Pré-fix esperado: passed=false, com billed_amount=1000 e expected_amount=900.

begin;

create temp table zt_f01_quote_billing_test (
  owner_id uuid,
  company_id uuid,
  client_id uuid,
  quote_id uuid,
  wo_id uuid,
  entry_id uuid,
  expected_amount numeric(12,2),
  billed_amount numeric(12,2)
) on commit drop;
grant select, update on zt_f01_quote_billing_test to authenticated;

insert into zt_f01_quote_billing_test(owner_id,company_id,client_id,quote_id,expected_amount)
select m.user_id, gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 900
from public.company_members m
where m.role='owner' and m.status='active'
limit 1;

do $$
begin
  if not exists (select 1 from zt_f01_quote_billing_test) then
    raise exception 'F01_NEEDS_ACTIVE_OWNER';
  end if;
end $$;

select set_config('request.jwt.claim.sub',(select owner_id::text from zt_f01_quote_billing_test),true);

insert into public.companies(id,name)
select company_id,'__F01_QUOTE_BILLING__' from zt_f01_quote_billing_test;
insert into public.subscriptions(company_id,status,current_period_start,current_period_end)
select company_id,'trial'::public.zt_sub_status,current_date,current_date+14 from zt_f01_quote_billing_test;
insert into public.company_members(company_id,user_id,role,status)
select company_id,owner_id,'owner'::public.zt_role,'active'::public.zt_member_status from zt_f01_quote_billing_test;
insert into public.clients(id,company_id,name)
select client_id,company_id,'__F01_CLIENT__' from zt_f01_quote_billing_test;

insert into public.quotes(
  id,company_id,number,client_id,status,issue_date,discount,surcharge,created_by
)
select quote_id,company_id,'__F01-ORC__',client_id,'approved'::public.zt_quote_status,current_date,100,0,owner_id
from zt_f01_quote_billing_test;

insert into public.quote_items(
  quote_id,company_id,kind,name,unit,quantity,unit_price,unit_cost,position
)
select quote_id,company_id,'free'::public.zt_item_kind,'Serviço aprovado','unidade',1,1000,0,0
from zt_f01_quote_billing_test;

set local role authenticated;
update zt_f01_quote_billing_test
set wo_id=public.zt_create_work_order_from_quote(quote_id,null,null,null);

update zt_f01_quote_billing_test
set entry_id=public.zt_finalize_work_order_atomic(
  wo_id,
  '__F01_FINALIZE__',
  null,
  null,
  7,
  '[]'::jsonb,
  '[]'::jsonb
);
reset role;

update zt_f01_quote_billing_test t
set billed_amount=(select f.amount from public.financial_entries f where f.id=t.entry_id);

select
  'F01_QUOTE_APPROVED_TOTAL_BILLING' as test,
  expected_amount,
  billed_amount,
  (billed_amount=expected_amount) as passed,
  case when billed_amount<>expected_amount then 'REPRODUCED_F01' else 'OK' end as outcome
from zt_f01_quote_billing_test;

rollback;
