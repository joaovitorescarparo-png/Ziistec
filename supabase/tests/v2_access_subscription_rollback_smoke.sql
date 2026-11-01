-- ZiisTec V2 — smoke de segurança com dados temporários e ROLLBACK.
--
-- Destino preferido: HOMOLOGAÇÃO/STAGING.
-- Requisitos: ao menos 1 owner ativo existente para fornecer um auth.uid() de teste.
-- O script cria empresa/cliente/OS/assinatura temporários e termina cada bloco com ROLLBACK.
-- Não substitui E2E com dois usuários reais; prova os guards centrais do banco.

-- =============================================================================
-- TESTE 1 — técnico ativo perde imediatamente zt_is_member / zt_wo_is_mine
-- =============================================================================
begin;

create temp table zt_access_revocation_test (
  user_id uuid,
  company_id uuid,
  client_id uuid,
  wo_id uuid,
  active_member boolean,
  active_wo boolean,
  disabled_member boolean,
  disabled_wo boolean
) on commit drop;
grant select, update on zt_access_revocation_test to authenticated;

insert into zt_access_revocation_test(user_id,company_id,client_id,wo_id)
select m.user_id, gen_random_uuid(), gen_random_uuid(), gen_random_uuid()
from public.company_members m
where m.role='owner' and m.status='active'
limit 1;

select set_config('request.jwt.claim.sub',(select user_id::text from zt_access_revocation_test),true);

insert into public.companies(id,name)
select company_id,'__V2_ACCESS_REVOCATION_TEST__' from zt_access_revocation_test;

insert into public.subscriptions(company_id,status,current_period_start,current_period_end)
select company_id,'trial'::public.zt_sub_status,current_date,current_date+14
from zt_access_revocation_test;

insert into public.company_members(company_id,user_id,role,status)
select company_id,user_id,'technician'::public.zt_role,'active'::public.zt_member_status
from zt_access_revocation_test;

insert into public.clients(id,company_id,name)
select client_id,company_id,'__V2_ACCESS_REVOCATION_CLIENT__' from zt_access_revocation_test;

insert into public.work_orders(id,company_id,number,client_id,assigned_to)
select wo_id,company_id,'__V2-ACCESS-TEST__',client_id,user_id
from zt_access_revocation_test;

set local role authenticated;
update zt_access_revocation_test
set active_member=public.zt_is_member(company_id),
    active_wo=public.zt_wo_is_mine(wo_id);
reset role;

update public.company_members m
set status='disabled'::public.zt_member_status
from zt_access_revocation_test t
where m.company_id=t.company_id and m.user_id=t.user_id;

set local role authenticated;
update zt_access_revocation_test
set disabled_member=public.zt_is_member(company_id),
    disabled_wo=public.zt_wo_is_mine(wo_id);
reset role;

select
  'V2_ACCESS_REVOCATION_OK' as result,
  active_member,
  active_wo,
  disabled_member,
  disabled_wo,
  (active_member=true and active_wo=true and disabled_member=false and disabled_wo=false) as passed
from zt_access_revocation_test;

rollback;

-- =============================================================================
-- TESTE 2 — cancelamento bloqueia escrita; reativação preserva dados
-- =============================================================================
begin;

create temp table zt_subscription_reactivation_test (
  user_id uuid,
  company_id uuid,
  client_id uuid,
  canceled_status text,
  can_write_after_cancel boolean,
  client_exists_after_cancel boolean,
  reactivated_status text,
  can_write_after_reactivate boolean,
  client_exists_after_reactivate boolean
) on commit drop;
grant select, update on zt_subscription_reactivation_test to authenticated;

insert into zt_subscription_reactivation_test(user_id,company_id,client_id)
select m.user_id,gen_random_uuid(),gen_random_uuid()
from public.company_members m
where m.role='owner' and m.status='active'
limit 1;

select set_config('request.jwt.claim.sub',(select user_id::text from zt_subscription_reactivation_test),true);

insert into public.companies(id,name)
select company_id,'__V2_SUBSCRIPTION_REACTIVATION_TEST__' from zt_subscription_reactivation_test;

insert into public.subscriptions(company_id,status,current_period_start,current_period_end)
select company_id,'trial'::public.zt_sub_status,current_date,current_date+14
from zt_subscription_reactivation_test;

insert into public.company_members(company_id,user_id,role,status)
select company_id,user_id,'owner'::public.zt_role,'active'::public.zt_member_status
from zt_subscription_reactivation_test;

insert into public.clients(id,company_id,name)
select client_id,company_id,'__V2_SUBSCRIPTION_CLIENT__' from zt_subscription_reactivation_test;

set local role authenticated;
update zt_subscription_reactivation_test
set canceled_status=public.zt_cancel_subscription(company_id)::text;

update zt_subscription_reactivation_test
set can_write_after_cancel=public.zt_subscription_can_write(company_id),
    client_exists_after_cancel=exists(select 1 from public.clients c where c.id=client_id);

update zt_subscription_reactivation_test
set reactivated_status=public.zt_reactivate_subscription(company_id)::text;

update zt_subscription_reactivation_test
set can_write_after_reactivate=public.zt_subscription_can_write(company_id),
    client_exists_after_reactivate=exists(select 1 from public.clients c where c.id=client_id);
reset role;

select
  'V2_SUBSCRIPTION_REACTIVATION_OK' as result,
  canceled_status,
  can_write_after_cancel,
  client_exists_after_cancel,
  reactivated_status,
  can_write_after_reactivate,
  client_exists_after_reactivate,
  (canceled_status='canceled'
   and can_write_after_cancel=false
   and client_exists_after_cancel=true
   and reactivated_status='trial'
   and can_write_after_reactivate=true
   and client_exists_after_reactivate=true) as passed
from zt_subscription_reactivation_test;

rollback;
