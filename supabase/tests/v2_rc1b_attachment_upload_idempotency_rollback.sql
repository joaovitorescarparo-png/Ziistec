-- ZiisTec RC-1B — attachment idempotency + RLS matrix. Disposable CI/Staging only.
begin;

-- Synthetic fixtures use the CI identities already provisioned by ci_local_seed.sql.
insert into public.company_members(company_id,user_id,role,status,job_title)
values ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000004','technician','active','RC1B Tech B')
on conflict (company_id,user_id) do update set role='technician',status='active';

insert into public.clients(id,company_id,name) values
 ('31000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','RC1B Client A'),
 ('31000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','RC1B Client B');

insert into public.work_orders(id,company_id,number,client_id,status,assigned_to) values
 ('32000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','RC1B-A1','31000000-0000-0000-0000-000000000001','in_progress','10000000-0000-0000-0000-000000000003'),
 ('32000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','RC1B-A2','31000000-0000-0000-0000-000000000001','scheduled',null),
 ('32000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','RC1B-A3','31000000-0000-0000-0000-000000000001','done','10000000-0000-0000-0000-000000000003'),
 ('32000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000002','RC1B-B1','31000000-0000-0000-0000-000000000002','in_progress','10000000-0000-0000-0000-000000000004');

create temp table rc1b_result(k text primary key, ok boolean, detail text) on commit drop;
grant select,insert,update on rc1b_result to authenticated,anon;

-- Owner A: first upload and response-lost retry must resolve to one row and same id.
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
set local role authenticated;
do $$
declare a jsonb; b jsonb; c int;
begin
  a:=public.zt_register_work_order_evidence(
    '20000000-0000-0000-0000-000000000001','32000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001/work-orders/32000000-0000-0000-0000-000000000001/before/'||repeat('a',64)||'.jpg',
    'foto-a.jpg','image/jpeg',100,'before',null,'Antes',repeat('a',64));
  b:=public.zt_register_work_order_evidence(
    '20000000-0000-0000-0000-000000000001','32000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001/work-orders/32000000-0000-0000-0000-000000000001/before/'||repeat('a',64)||'.jpg',
    'retry-nome-diferente.jpg','image/jpeg',100,'before','retry','Antes',repeat('a',64));
  select count(*) into c from public.attachments where company_id='20000000-0000-0000-0000-000000000001' and work_order_id='32000000-0000-0000-0000-000000000001' and media_stage='before' and content_sha256=repeat('a',64);
  insert into rc1b_result values ('first_retry', (a->>'id')=(b->>'id') and c=1, 'count='||c);

  perform public.zt_register_work_order_evidence(
    '20000000-0000-0000-0000-000000000001','32000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001/work-orders/32000000-0000-0000-0000-000000000001/after/'||repeat('a',64)||'.jpg',
    'foto-a.jpg','image/jpeg',100,'after',null,'Depois',repeat('a',64));
  insert into rc1b_result values ('different_stage', (select count(*)=2 from public.attachments where company_id='20000000-0000-0000-0000-000000000001' and work_order_id='32000000-0000-0000-0000-000000000001' and content_sha256=repeat('a',64)), null);

  perform public.zt_register_work_order_evidence(
    '20000000-0000-0000-0000-000000000001','32000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001/work-orders/32000000-0000-0000-0000-000000000001/before/'||repeat('b',64)||'.jpg',
    'foto-b.jpg','image/jpeg',101,'before',null,'Antes',repeat('b',64));
  insert into rc1b_result values ('different_file', (select count(*)=1 from public.attachments where work_order_id='32000000-0000-0000-0000-000000000001' and content_sha256=repeat('b',64)), null);

  perform public.zt_register_work_order_evidence(
    '20000000-0000-0000-0000-000000000001','32000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000001/work-orders/32000000-0000-0000-0000-000000000002/before/'||repeat('a',64)||'.jpg',
    'foto-a.jpg','image/jpeg',100,'before',null,'Antes',repeat('a',64));
  insert into rc1b_result values ('different_work_order', (select count(*)=1 from public.attachments where work_order_id='32000000-0000-0000-0000-000000000002' and content_sha256=repeat('a',64)), null);
end $$;
reset role;

-- Owner B: same bytes/hash are independent in another tenant.
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
set local role authenticated;
do $$ begin
  perform public.zt_register_work_order_evidence(
    '20000000-0000-0000-0000-000000000002','32000000-0000-0000-0000-000000000004',
    '20000000-0000-0000-0000-000000000002/work-orders/32000000-0000-0000-0000-000000000004/before/'||repeat('a',64)||'.jpg',
    'foto-a.jpg','image/jpeg',100,'before',null,'Antes',repeat('a',64));
  insert into rc1b_result values ('other_company', (select count(*)=1 from public.attachments where company_id='20000000-0000-0000-0000-000000000002' and work_order_id='32000000-0000-0000-0000-000000000004' and content_sha256=repeat('a',64)), null);
end $$;
reset role;

-- Technician A: assigned/open positive; unassigned, closed and cross-tenant negative.
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
set local role authenticated;
do $$
declare blocked boolean;
begin
  perform public.zt_register_work_order_evidence(
    '20000000-0000-0000-0000-000000000001','32000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001/work-orders/32000000-0000-0000-0000-000000000001/during/'||repeat('c',64)||'.png',
    'tech.png','image/png',200,'during',null,'Durante',repeat('c',64));
  insert into rc1b_result values ('assigned_tech',true,null);

  blocked:=false; begin perform public.zt_register_work_order_evidence('20000000-0000-0000-0000-000000000001','32000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001/work-orders/32000000-0000-0000-0000-000000000002/before/'||repeat('d',64)||'.jpg','x.jpg','image/jpeg',10,'before',null,'Antes',repeat('d',64)); exception when others then blocked:=true; end;
  insert into rc1b_result values ('unassigned_tech',blocked,null);

  blocked:=false; begin perform public.zt_register_work_order_evidence('20000000-0000-0000-0000-000000000001','32000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001/work-orders/32000000-0000-0000-0000-000000000003/before/'||repeat('e',64)||'.jpg','x.jpg','image/jpeg',10,'before',null,'Antes',repeat('e',64)); exception when others then blocked:=true; end;
  insert into rc1b_result values ('closed_tech',blocked,null);

  blocked:=false; begin perform public.zt_register_work_order_evidence('20000000-0000-0000-0000-000000000002','32000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000002/work-orders/32000000-0000-0000-0000-000000000004/before/'||repeat('f',64)||'.jpg','x.jpg','image/jpeg',10,'before',null,'Antes',repeat('f',64)); exception when others then blocked:=true; end;
  insert into rc1b_result values ('cross_tenant',blocked,null);
end $$;
reset role;

-- Inactive subscription blocks writes at DB trigger/RLS authority.
update public.subscriptions set status='canceled' where company_id='20000000-0000-0000-0000-000000000001';
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
set local role authenticated;
do $$ declare blocked boolean:=false; begin
  begin perform public.zt_register_work_order_evidence('20000000-0000-0000-0000-000000000001','32000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001/work-orders/32000000-0000-0000-0000-000000000001/equipment/'||repeat('1',64)||'.jpg','x.jpg','image/jpeg',10,'equipment',null,'Equipamento',repeat('1',64)); exception when others then blocked:=true; end;
  insert into rc1b_result values ('subscription',blocked,null);
end $$;
reset role;
update public.subscriptions set status='active',current_period_start=current_date,current_period_end=current_date+30 where company_id='20000000-0000-0000-0000-000000000001';

-- Disabled membership also loses access.
update public.company_members set status='disabled' where company_id='20000000-0000-0000-0000-000000000001' and user_id='10000000-0000-0000-0000-000000000003';
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
set local role authenticated;
do $$ declare blocked boolean:=false; begin
  begin perform public.zt_register_work_order_evidence('20000000-0000-0000-0000-000000000001','32000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001/work-orders/32000000-0000-0000-0000-000000000001/equipment/'||repeat('2',64)||'.jpg','x.jpg','image/jpeg',10,'equipment',null,'Equipamento',repeat('2',64)); exception when others then blocked:=true; end;
  insert into rc1b_result values ('disabled_member',blocked,null);
end $$;
reset role;

-- Invalid metadata/hash fails before creating any attachment row.
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
set local role authenticated;
do $$ declare blocked boolean:=false; before_count int; after_count int; begin
  select count(*) into before_count from public.attachments where work_order_id='32000000-0000-0000-0000-000000000001';
  begin perform public.zt_register_work_order_evidence('20000000-0000-0000-0000-000000000001','32000000-0000-0000-0000-000000000001','bad/path','x.jpg','image/jpeg',10,'before',null,'Antes','not-a-hash'); exception when others then blocked:=true; end;
  select count(*) into after_count from public.attachments where work_order_id='32000000-0000-0000-0000-000000000001';
  insert into rc1b_result values ('metadata_failure',blocked and before_count=after_count,'before='||before_count||',after='||after_count);
end $$;
reset role;

-- Every assertion must be true.
do $$ declare failed text; begin
  select string_agg(k||coalesce(' ('||detail||')',''),', ') into failed from rc1b_result where not ok;
  if failed is not null then raise exception 'RC1B_ATTACHMENT_TEST_FAILED: %',failed; end if;
  if (select count(*) from rc1b_result) <> 11 then raise exception 'RC1B_ATTACHMENT_TEST_INCOMPLETE'; end if;
end $$;

select 'RC1B_ATTACHMENT_IDEMPOTENCY_RLS_OK' as test, count(*) as assertions from rc1b_result where ok;
rollback;
