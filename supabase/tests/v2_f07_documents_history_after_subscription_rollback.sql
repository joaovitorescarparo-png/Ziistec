-- ZiisTec V2 — F07 histórico de documentos privados após assinatura inativa.
-- Staging/CI only. Todos os dados terminam em ROLLBACK.
--
-- Contrato:
-- * owner ativo da empresa lê zt-documents próprio;
-- * owner continua lendo o mesmo histórico em canceled, suspended e período expirado;
-- * technician nunca lê zt-documents;
-- * empresa A nunca lê documento da empresa B;
-- * INSERT/UPDATE/DELETE permanecem condicionados à assinatura com escrita habilitada.

begin;

create temp table zt_f07_test(
  user_id uuid,
  company_a uuid,
  company_b uuid,
  object_a uuid,
  object_b uuid,
  owner_active_read boolean default false,
  owner_canceled_read boolean default false,
  owner_suspended_read boolean default false,
  owner_expired_read boolean default false,
  technician_read boolean default false,
  cross_company_read boolean default false,
  active_insert_ok boolean default false,
  canceled_insert_blocked boolean default false,
  canceled_update_blocked boolean default false,
  canceled_delete_blocked boolean default false
) on commit drop;

grant select,update on zt_f07_test to authenticated;

insert into zt_f07_test(user_id,company_a,company_b,object_a,object_b)
select m.user_id,gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()
from public.company_members m
where m.role='owner' and m.status='active'
limit 1;

do $$ begin
  if not exists(select 1 from zt_f07_test) then raise exception 'F07_NEEDS_ACTIVE_OWNER'; end if;
end $$;

select set_config('request.jwt.claim.sub',(select user_id::text from zt_f07_test),true);

insert into public.companies(id,name) select company_a,'__F07_COMPANY_A__' from zt_f07_test;
insert into public.companies(id,name) select company_b,'__F07_COMPANY_B__' from zt_f07_test;
insert into public.subscriptions(company_id,status,current_period_start,current_period_end)
select company_a,'trial'::public.zt_sub_status,current_date,current_date+14 from zt_f07_test;
insert into public.subscriptions(company_id,status,current_period_start,current_period_end)
select company_b,'trial'::public.zt_sub_status,current_date,current_date+14 from zt_f07_test;
insert into public.company_members(company_id,user_id,role,status)
select company_a,user_id,'owner'::public.zt_role,'active'::public.zt_member_status from zt_f07_test;

insert into storage.objects(id,bucket_id,name,owner,owner_id,metadata)
select object_a,'zt-documents',company_a::text||'/history/f07-a.pdf',user_id,user_id::text,'{}'::jsonb from zt_f07_test;
insert into storage.objects(id,bucket_id,name,metadata)
select object_b,'zt-documents',company_b::text||'/history/f07-b.pdf','{}'::jsonb from zt_f07_test;

-- Owner + assinatura ativa: leitura e escrita próprias devem funcionar.
set local role authenticated;
update zt_f07_test t set
  owner_active_read=exists(select 1 from storage.objects o where o.id=t.object_a),
  cross_company_read=exists(select 1 from storage.objects o where o.id=t.object_b);

do $$ declare v_id uuid:=gen_random_uuid(); begin
  begin
    insert into storage.objects(id,bucket_id,name,owner,owner_id,metadata)
    select v_id,'zt-documents',company_a::text||'/active-write.pdf',user_id,user_id::text,'{}'::jsonb from zt_f07_test;
    update zt_f07_test set active_insert_ok=true;
  exception when others then
    update zt_f07_test set active_insert_ok=false;
  end;
end $$;
reset role;

-- canceled: leitura histórica continua; toda escrita é bloqueada.
update public.subscriptions s set status='canceled'::public.zt_sub_status
from zt_f07_test t where s.company_id=t.company_a;
set local role authenticated;
update zt_f07_test t set owner_canceled_read=exists(select 1 from storage.objects o where o.id=t.object_a);

do $$ declare v_count integer:=0; begin
  begin
    insert into storage.objects(id,bucket_id,name,owner,owner_id,metadata)
    select gen_random_uuid(),'zt-documents',company_a::text||'/canceled-insert.pdf',user_id,user_id::text,'{}'::jsonb from zt_f07_test;
    update zt_f07_test set canceled_insert_blocked=false;
  exception when others then update zt_f07_test set canceled_insert_blocked=true; end;

  begin
    with changed as (
      update storage.objects o set metadata=jsonb_build_object('f07','changed')
      from zt_f07_test t where o.id=t.object_a returning o.id
    ) select count(*) into v_count from changed;
    update zt_f07_test set canceled_update_blocked=(v_count=0);
  exception when others then update zt_f07_test set canceled_update_blocked=true; end;

  begin
    with removed as (
      delete from storage.objects o using zt_f07_test t where o.id=t.object_a returning o.id
    ) select count(*) into v_count from removed;
    update zt_f07_test set canceled_delete_blocked=(v_count=0);
  exception when others then update zt_f07_test set canceled_delete_blocked=true; end;
end $$;
reset role;

-- suspended também preserva leitura histórica.
update public.subscriptions s set status='suspended'::public.zt_sub_status,current_period_end=current_date+14
from zt_f07_test t where s.company_id=t.company_a;
set local role authenticated;
update zt_f07_test t set owner_suspended_read=exists(select 1 from storage.objects o where o.id=t.object_a);
reset role;

-- expirada: status nominalmente active, porém período terminou ontem.
update public.subscriptions s set status='active'::public.zt_sub_status,current_period_end=current_date-1
from zt_f07_test t where s.company_id=t.company_a;
set local role authenticated;
update zt_f07_test t set owner_expired_read=exists(select 1 from storage.objects o where o.id=t.object_a);
reset role;

-- Technician ativo não ganha acesso ao bucket privado.
update public.subscriptions s set status='trial'::public.zt_sub_status,current_period_end=current_date+14
from zt_f07_test t where s.company_id=t.company_a;
update public.company_members m set role='technician'::public.zt_role
from zt_f07_test t where m.company_id=t.company_a and m.user_id=t.user_id;
set local role authenticated;
update zt_f07_test t set technician_read=exists(select 1 from storage.objects o where o.id=t.object_a);
reset role;

select
  'F07_DOCUMENT_HISTORY_ACCESS' as result,
  owner_active_read,
  owner_canceled_read,
  owner_suspended_read,
  owner_expired_read,
  technician_read,
  cross_company_read,
  active_insert_ok,
  canceled_insert_blocked,
  canceled_update_blocked,
  canceled_delete_blocked,
  (owner_active_read
   and owner_canceled_read
   and owner_suspended_read
   and owner_expired_read
   and not technician_read
   and not cross_company_read
   and active_insert_ok
   and canceled_insert_blocked
   and canceled_update_blocked
   and canceled_delete_blocked) as passed
from zt_f07_test;

do $$ begin
  if not exists(
    select 1 from zt_f07_test
    where owner_active_read
      and owner_canceled_read
      and owner_suspended_read
      and owner_expired_read
      and not technician_read
      and not cross_company_read
      and active_insert_ok
      and canceled_insert_blocked
      and canceled_update_blocked
      and canceled_delete_blocked
  ) then
    raise exception 'F07_DOCUMENT_HISTORY_ACCESS_FAILED';
  end if;
end $$;

rollback;
