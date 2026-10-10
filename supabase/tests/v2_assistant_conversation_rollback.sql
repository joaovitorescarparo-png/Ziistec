-- ZiisTec Assistant conversation (0093) — autorização, isolamento multiempresa, prévia/confirmação,
-- idempotência por requestId, quota, auditoria sem argumentos brutos e retenção sem pg_cron.
-- Destino: SOMENTE CI descartável ou staging/homologação. Tudo termina em ROLLBACK.

begin;

create temp table zt_assistant_test (
  owner_a uuid, tech_a uuid, owner_b uuid, external_user uuid,
  company_a uuid, company_b uuid, client_a uuid, client_b uuid,
  wo_open uuid, wo_report uuid, wo_return uuid, wo_finalize uuid,
  request_client uuid, client_hash text, created_client uuid,
  request_expired uuid, expired_hash text
) on commit drop;
create temp table zt_assistant_results (name text primary key, ok boolean not null, detail text) on commit drop;
grant select, insert, update on zt_assistant_test, zt_assistant_results to authenticated, anon;

create function pg_temp.record_result(p_name text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into zt_assistant_results(name,ok,detail) values(p_name,coalesce(p_ok,false),left(p_detail,500));
$$;

-- Prepara e confirma a própria prévia, como o fluxo revisado da API.
create function pg_temp.assistant_run(p_company uuid, p_action text, p_input jsonb)
returns jsonb language plpgsql as $$
declare v_request uuid:=gen_random_uuid(); v_plan jsonb; v_exec jsonb;
begin
  v_plan:=public.zt_assistant_plan(p_company,p_action,p_input,v_request);
  if v_plan ? 'error' or not coalesce((v_plan->>'confirmationRequired')::boolean,false) then
    return jsonb_build_object('plan',v_plan);
  end if;
  v_exec:=public.zt_assistant_execute(p_company,v_request,v_plan->>'previewHash');
  return jsonb_build_object('plan',v_plan,'exec',v_exec);
end $$;

with candidates as (
  select u.id, row_number() over (order by u.id) as rn
  from auth.users u left join public.profiles p on p.id=u.id
  where not coalesce(p.is_platform_admin,false)
)
insert into zt_assistant_test(owner_a,tech_a,owner_b,external_user,company_a,company_b,client_a,client_b)
select (select id from candidates where rn=1),(select id from candidates where rn=2),
       (select id from candidates where rn=3),(select id from candidates where rn=4),
       gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid();

do $$
begin
  if exists(select 1 from zt_assistant_test
    where owner_a is null or tech_a is null or owner_b is null or external_user is null) then
    raise exception 'ASSISTANT_NEEDS_FOUR_AUTH_USERS';
  end if;
end $$;

-- O guard de assinatura das tabelas operacionais exige uma identidade autenticada.
select set_config('request.jwt.claim.sub',(select owner_a::text from zt_assistant_test),true);

insert into public.companies(id,name,has_team)
select company_a,'__ASSISTANT_A__',true from zt_assistant_test
union all select company_b,'__ASSISTANT_B__',true from zt_assistant_test;
insert into public.subscriptions(company_id,status,current_period_start,current_period_end)
select company_a,'trial'::public.zt_sub_status,current_date,current_date+14 from zt_assistant_test
union all select company_b,'trial'::public.zt_sub_status,current_date,current_date+14 from zt_assistant_test
on conflict (company_id) do update set status=excluded.status,
  current_period_start=excluded.current_period_start,current_period_end=excluded.current_period_end;
insert into public.company_members(company_id,user_id,role,status)
select company_a,owner_a,'owner'::public.zt_role,'active'::public.zt_member_status from zt_assistant_test
union all select company_a,tech_a,'technician'::public.zt_role,'active'::public.zt_member_status from zt_assistant_test
union all select company_b,owner_b,'owner'::public.zt_role,'active'::public.zt_member_status from zt_assistant_test;
insert into public.clients(id,company_id,name,phone,address)
select client_a,company_a,'__ASSISTANT_CLIENT_A__','11900000001','Rua Assistente A, 1' from zt_assistant_test
union all select client_b,company_b,'__ASSISTANT_CLIENT_B__','11900000002','Rua Assistente B, 2' from zt_assistant_test;

set local role authenticated;
do $$
declare t zt_assistant_test%rowtype; p jsonb; r jsonb; again jsonb; req uuid:=gen_random_uuid();
  v_wo_id uuid; n integer; d date:=(now() at time zone 'America/Sao_Paulo')::date;
begin
  select * into t from zt_assistant_test;
  select count(*) into n from public.work_orders where company_id=t.company_a;
  p:=public.zt_assistant_plan(t.company_a,'create_work_order',jsonb_build_object(
    'client',t.client_a::text,'description','__CONVERSATION_CREATE__','date',(d+1)::text,'time','14:00'),req);
  perform pg_temp.record_result('01_create_preview',p->>'confirmationRequired'='true' and length(p->>'previewHash')=64,p::text);
  perform pg_temp.record_result('02_preview_no_write',(select count(*) from public.work_orders where company_id=t.company_a)=n);
  perform pg_temp.record_result('03_preview_schedule_owner',p->'preview' @> '[{"label":"Data (São Paulo)"}]'::jsonb
    and p->'preview' @> '[{"label":"Horário (São Paulo)","value":"14:00"}]'::jsonb
    and p->'preview' @> '[{"label":"Responsável"}]'::jsonb,p::text);
  r:=public.zt_assistant_execute(t.company_a,req,repeat('0',64));
  perform pg_temp.record_result('04_wrong_hash_denied',r->>'code'='INVALID_INPUT',r::text);
  r:=public.zt_assistant_execute(t.company_a,req,p->>'previewHash'); v_wo_id:=(r#>>'{result,id}')::uuid;
  again:=public.zt_assistant_execute(t.company_a,req,p->>'previewHash');
  perform pg_temp.record_result('05_create_retry_same_result',r=again and v_wo_id is not null,r::text);
  perform pg_temp.record_result('06_create_once',(select count(*) from public.work_orders where company_id=t.company_a)=n+1);
  perform pg_temp.record_result('07_create_persisted_schedule_owner',exists(select 1 from public.work_orders w where w.id=v_wo_id
    and w.scheduled_date=d+1 and w.scheduled_time='14:00' and w.assigned_to=t.owner_a and w.status='scheduled'));
  update zt_assistant_test set wo_open=v_wo_id;
  req:=gen_random_uuid();
  p:=public.zt_assistant_plan(t.company_a,'schedule_work_order',jsonb_build_object('client',t.client_a::text,'date',(d+3)::text,'time','09:00'),req);
  perform pg_temp.record_result('08_schedule_client_preview',p->>'confirmationRequired'='true' and p->'preview' @> '[{"label":"OS"}]'::jsonb,p::text);
  perform pg_temp.record_result('09_schedule_preview_no_write',exists(select 1 from public.work_orders w where w.id=v_wo_id and w.scheduled_date=d+1));
  r:=public.zt_assistant_execute(t.company_a,req,p->>'previewHash');
  again:=public.zt_assistant_execute(t.company_a,req,p->>'previewHash');
  perform pg_temp.record_result('10_schedule_same_existing_once',r=again and r#>>'{result,id}'=v_wo_id::text
    and (select count(*) from public.work_orders where company_id=t.company_a)=n+1,r::text);
  perform pg_temp.record_result('11_schedule_persisted',exists(select 1 from public.work_orders w where w.id=v_wo_id and w.scheduled_date=d+3 and w.scheduled_time='09:00'));

  -- Assigned future and today's visits; no costs/financial fields enter the projection.
  update zt_assistant_test set wo_report=public.zt_save_work_order_idempotent(t.company_a,null,gen_random_uuid(),
    jsonb_build_object('client_id',t.client_a,'request','__CONVERSATION_TECH__','assigned_to',t.tech_a,
      'status','scheduled','scheduled_date',d+2,'scheduled_time','10:00'),'[]');
  update zt_assistant_test set wo_return=public.zt_save_work_order_idempotent(t.company_a,null,gen_random_uuid(),
    jsonb_build_object('client_id',t.client_a,'request','__CONVERSATION_TODAY__','assigned_to',t.tech_a,
      'status','scheduled','scheduled_date',d,'scheduled_time','00:00'),'[]');
  r:=public.zt_assistant_plan(t.company_a,'schedule_work_order',jsonb_build_object('client',t.client_a::text,'date',(d+5)::text,'time','09:00'),gen_random_uuid());
  perform pg_temp.record_result('12_ambiguous_client_asks',r ? 'question' and not(r ? 'previewHash'),r::text);
  r:=public.zt_assistant_plan(t.company_a,'owner_next_appointment','{}',gen_random_uuid());
  perform pg_temp.record_result('13_owner_next_date_time_client',r#>>'{result,items,0,date}'=(d+2)::text
    and r#>>'{result,items,0,time}'='10:00:00' and r#>>'{result,items,0,client}'='__ASSISTANT_CLIENT_A__'
    and jsonb_array_length(r#>'{result,items}')=1 and r->>'confirmationRequired'='false',r::text);
  r:=public.zt_assistant_plan(t.company_a,'owner_today_schedule','{}',gen_random_uuid());
  perform pg_temp.record_result('14_today_read_only',jsonb_array_length(r#>'{result,items}')=1 and r->>'confirmationRequired'='false',r::text);
  r:=public.zt_assistant_plan(t.company_a,'owner_find_client','{"query":"__ASSISTANT_CLIENT_A__"}',gen_random_uuid());
  perform pg_temp.record_result('15_phone_read',r#>>'{result,items,0,detail}' like '%11900000001%',r::text);
  r:=public.zt_assistant_plan(t.company_a,'create_work_order',jsonb_build_object('client',t.client_a::text,'description','x','date',d::text),gen_random_uuid());
  perform pg_temp.record_result('16_date_requires_time',r->>'code'='INVALID_INPUT',r::text);
  r:=public.zt_assistant_plan(t.company_a,'schedule_work_order',jsonb_build_object('client',t.client_a::text,'workOrder',v_wo_id::text,'date',d::text,'time','09:00'),gen_random_uuid());
  perform pg_temp.record_result('17_ambiguous_reference_rejected',r->>'code'='INVALID_INPUT',r::text);
  r:=public.zt_assistant_plan(t.company_a,'create_work_order',jsonb_build_object('client',t.client_b::text,'description','cross'),gen_random_uuid());
  perform pg_temp.record_result('18_cross_tenant_client_rejected',r ? 'error',r::text);
end $$;
reset role;

select set_config('request.jwt.claim.sub',(select tech_a::text from zt_assistant_test),true);
set local role authenticated;
do $$
declare t zt_assistant_test%rowtype; r jsonb;
begin
  select * into t from zt_assistant_test;
  r:=public.zt_assistant_plan(t.company_a,'technician_next_appointment','{}',gen_random_uuid());
  perform pg_temp.record_result('19_tech_next_assigned_only',r#>>'{result,items,0,id}'=t.wo_report::text
    and r#>>'{result,items,0,client}'='__ASSISTANT_CLIENT_A__' and jsonb_array_length(r#>'{result,items}')=1,r::text);
  perform pg_temp.record_result('20_tech_projection_no_private',not ((r#>'{result,items,0}') ?| array['cost','margin','total','price','financial','supplier']),r::text);
  r:=public.zt_assistant_plan(t.company_a,'owner_next_appointment','{}',gen_random_uuid());
  perform pg_temp.record_result('21_tech_owner_tool_denied',r->>'code'='ACCESS_DENIED',r::text);
  r:=public.zt_assistant_plan(t.company_b,'technician_next_appointment','{}',gen_random_uuid());
  perform pg_temp.record_result('22_cross_tenant_read_denied',r->>'code'='ACCESS_DENIED',r::text);
  r:=public.zt_assistant_plan(t.company_a,'owner_find_client','{"query":"A"}',gen_random_uuid());
  perform pg_temp.record_result('23_tech_private_client_search_denied',r->>'code'='ACCESS_DENIED',r::text);
end $$;
reset role;
update public.company_members m set status='inactive' from zt_assistant_test t where m.company_id=t.company_a and m.user_id=t.tech_a;
set local role authenticated;
do $$
declare t zt_assistant_test%rowtype; r jsonb;
begin
  select * into t from zt_assistant_test;
  r:=public.zt_assistant_plan(t.company_a,'technician_next_appointment','{}',gen_random_uuid());
  perform pg_temp.record_result('24_deactivated_denied',r->>'code'='ACCESS_DENIED',r::text);
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role authenticated;
do $$
declare t zt_assistant_test%rowtype; r jsonb;
begin
  select * into t from zt_assistant_test;
  r:=public.zt_assistant_plan(t.company_a,'owner_next_appointment','{}',gen_random_uuid());
  perform pg_temp.record_result('25_no_auth_denied',r->>'code'='ACCESS_DENIED',r::text);
end $$;
reset role;
select set_config('request.jwt.claim.sub',(select owner_a::text from zt_assistant_test),true);
update public.subscriptions s set status='canceled' from zt_assistant_test t where s.company_id=t.company_a;
set local role authenticated;
do $$
declare t zt_assistant_test%rowtype; r jsonb;
begin
  select * into t from zt_assistant_test;
  r:=public.zt_assistant_plan(t.company_a,'owner_next_appointment','{}',gen_random_uuid());
  perform pg_temp.record_result('26_expired_subscription_read_denied',r->>'code'='ACCESS_DENIED',r::text);
end $$;
reset role;
do $$
declare failures text;
begin
  select string_agg(name||': '||coalesce(detail,''),E'\n') into failures from zt_assistant_results where not ok;
  if failures is not null then raise exception 'ASSISTANT_0093_FAILED: %',failures; end if;
  if (select count(*) from zt_assistant_results)<>26 then raise exception 'ASSISTANT_0093_INCOMPLETE'; end if;
end $$;
select 'ASSISTANT_0093_CONVERSATION' as test,count(*) as checks,bool_and(ok) as all_ok from zt_assistant_results;
rollback;
