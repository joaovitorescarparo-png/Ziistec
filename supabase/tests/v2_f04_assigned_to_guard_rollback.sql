-- ZiisTec blocker regression F04 — RPC privilegiada de OS deve validar assigned_to.
-- Destino: SOMENTE staging/homologação. Tudo termina em ROLLBACK.
-- Pré-fix esperado: técnico válido passa; pelo menos os casos inválidos abaixo não são bloqueados.

begin;

create temp table zt_f04_assignee_test (
  owner_id uuid,
  valid_tech_id uuid,
  disabled_tech_id uuid,
  external_user_id uuid,
  company_id uuid,
  client_id uuid,
  valid_created boolean default false,
  disabled_blocked boolean default false,
  cross_company_blocked boolean default false,
  no_target_membership_blocked boolean default false,
  disabled_sqlstate text,
  cross_sqlstate text,
  no_membership_sqlstate text
) on commit drop;
grant select, update on zt_f04_assignee_test to authenticated;

insert into zt_f04_assignee_test(owner_id,company_id,client_id)
select m.user_id,gen_random_uuid(),gen_random_uuid()
from public.company_members m
where m.role='owner' and m.status='active'
limit 1;

update zt_f04_assignee_test t
set valid_tech_id=(select u.id from auth.users u where u.id<>t.owner_id order by u.id limit 1 offset 0),
    disabled_tech_id=(select u.id from auth.users u where u.id<>t.owner_id order by u.id limit 1 offset 1),
    external_user_id=(select u.id from auth.users u where u.id<>t.owner_id order by u.id limit 1 offset 2);

do $$
begin
  if not exists (
    select 1 from zt_f04_assignee_test
    where owner_id is not null and valid_tech_id is not null
      and disabled_tech_id is not null and external_user_id is not null
  ) then
    raise exception 'F04_NEEDS_FOUR_AUTH_USERS';
  end if;
end $$;

select set_config('request.jwt.claim.sub',(select owner_id::text from zt_f04_assignee_test),true);

insert into public.companies(id,name,has_team)
select company_id,'__F04_ASSIGNEE__',true from zt_f04_assignee_test;
insert into public.subscriptions(company_id,status,current_period_start,current_period_end)
select company_id,'trial'::public.zt_sub_status,current_date,current_date+14 from zt_f04_assignee_test;
insert into public.company_members(company_id,user_id,role,status)
select company_id,owner_id,'owner'::public.zt_role,'active'::public.zt_member_status from zt_f04_assignee_test;
insert into public.company_members(company_id,user_id,role,status)
select company_id,valid_tech_id,'technician'::public.zt_role,'active'::public.zt_member_status from zt_f04_assignee_test;
insert into public.company_members(company_id,user_id,role,status)
select company_id,disabled_tech_id,'technician'::public.zt_role,'disabled'::public.zt_member_status from zt_f04_assignee_test;
insert into public.clients(id,company_id,name)
select client_id,company_id,'__F04_CLIENT__' from zt_f04_assignee_test;

set local role authenticated;

-- Controle positivo: técnico ativo da mesma empresa deve receber OS.
do $$
declare t zt_f04_assignee_test%rowtype; v_id uuid;
begin
  select * into t from zt_f04_assignee_test;
  v_id:=public.zt_save_work_order_idempotent(
    t.company_id,null,gen_random_uuid(),
    jsonb_build_object(
      'client_id',t.client_id,
      'assigned_to',t.valid_tech_id,
      'status','unscheduled',
      'request','__F04_VALID__'
    ),
    '[]'::jsonb
  );
  update zt_f04_assignee_test set valid_created=(v_id is not null);
end $$;

-- Técnico disabled deve ser rejeitado pela própria RPC privilegiada.
do $$
declare t zt_f04_assignee_test%rowtype;
begin
  select * into t from zt_f04_assignee_test;
  begin
    perform public.zt_save_work_order_idempotent(
      t.company_id,null,gen_random_uuid(),
      jsonb_build_object(
        'client_id',t.client_id,
        'assigned_to',t.disabled_tech_id,
        'status','unscheduled',
        'request','__F04_DISABLED__'
      ),
      '[]'::jsonb
    );
    update zt_f04_assignee_test set disabled_blocked=false;
  exception when others then
    update zt_f04_assignee_test set disabled_blocked=true, disabled_sqlstate=sqlstate;
  end;
end $$;

-- Usuário real que não pertence à empresa alvo (possui identidade/profile e pode pertencer a outra empresa) deve falhar.
do $$
declare t zt_f04_assignee_test%rowtype;
begin
  select * into t from zt_f04_assignee_test;
  begin
    perform public.zt_save_work_order_idempotent(
      t.company_id,null,gen_random_uuid(),
      jsonb_build_object(
        'client_id',t.client_id,
        'assigned_to',t.external_user_id,
        'status','unscheduled',
        'request','__F04_CROSS_COMPANY__'
      ),
      '[]'::jsonb
    );
    update zt_f04_assignee_test set cross_company_blocked=false;
  exception when others then
    update zt_f04_assignee_test set cross_company_blocked=true, cross_sqlstate=sqlstate;
  end;
end $$;

-- Depois de remover somente a membership TEMPORÁRIA do usuário disabled nesta empresa,
-- o profile continua válido, mas não existe membership na empresa alvo.
reset role;
delete from public.company_members m
using zt_f04_assignee_test t
where m.company_id=t.company_id and m.user_id=t.disabled_tech_id;
set local role authenticated;

do $$
declare t zt_f04_assignee_test%rowtype;
begin
  select * into t from zt_f04_assignee_test;
  begin
    perform public.zt_save_work_order_idempotent(
      t.company_id,null,gen_random_uuid(),
      jsonb_build_object(
        'client_id',t.client_id,
        'assigned_to',t.disabled_tech_id,
        'status','unscheduled',
        'request','__F04_NO_TARGET_MEMBERSHIP__'
      ),
      '[]'::jsonb
    );
    update zt_f04_assignee_test set no_target_membership_blocked=false;
  exception when others then
    update zt_f04_assignee_test set no_target_membership_blocked=true, no_membership_sqlstate=sqlstate;
  end;
end $$;

reset role;

select
  'F04_ASSIGNED_TO_MEMBERSHIP_GUARD' as test,
  valid_created,
  disabled_blocked,
  cross_company_blocked,
  no_target_membership_blocked,
  disabled_sqlstate,
  cross_sqlstate,
  no_membership_sqlstate,
  (valid_created and disabled_blocked and cross_company_blocked and no_target_membership_blocked) as passed,
  case
    when valid_created and disabled_blocked and cross_company_blocked and no_target_membership_blocked then 'OK'
    else 'REPRODUCED_F04'
  end as outcome
from zt_f04_assignee_test;

rollback;
