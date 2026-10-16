-- ZiisTec Assistant MVP (0092) — autorização, isolamento multiempresa, prévia/confirmação,
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

-- OS canônicas da empresa A: uma sem técnico e três atribuídas ao técnico para hoje.
select set_config('request.jwt.claim.sub',(select owner_a::text from zt_assistant_test),true);
set local role authenticated;
do $$
declare t zt_assistant_test%rowtype; v uuid[]:='{}'; v_label text;
begin
  select * into t from zt_assistant_test;
  foreach v_label in array array['OPEN','REPORT','RETURN','FINALIZE'] loop
    v:=v||public.zt_save_work_order_idempotent(t.company_a,null,gen_random_uuid(),
      jsonb_build_object('client_id',t.client_a,'status','unscheduled','request','__ASSISTANT_WO_'||v_label||'__')
        ||case when v_label='OPEN' then '{}'::jsonb else jsonb_build_object('assigned_to',t.tech_a) end,
      '[]'::jsonb);
  end loop;
  update zt_assistant_test set wo_open=v[1],wo_report=v[2],wo_return=v[3],wo_finalize=v[4];
end $$;
reset role;
update public.work_orders w
set scheduled_date=(now() at time zone 'America/Sao_Paulo')::date,scheduled_time='09:00',status='scheduled'
from zt_assistant_test t
where w.id in (t.wo_report,t.wo_return,t.wo_finalize);

-- 1. Sem autenticação: anon não executa; sessão sem usuário falha fechado.
set local role anon;
do $$
begin
  begin
    perform public.zt_assistant_plan(gen_random_uuid(),'owner_today_schedule','{}'::jsonb,gen_random_uuid());
    perform pg_temp.record_result('01_anon_sem_execute',false,'anon executou zt_assistant_plan');
  exception when insufficient_privilege then
    perform pg_temp.record_result('01_anon_sem_execute',true,sqlstate);
  end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role authenticated;
do $$
declare t zt_assistant_test%rowtype; r jsonb;
begin
  select * into t from zt_assistant_test;
  r:=public.zt_assistant_plan(t.company_a,'owner_today_schedule','{}'::jsonb,gen_random_uuid());
  perform pg_temp.record_result('01_sem_sessao_plan_negado',r->>'code'='ACCESS_DENIED' and not r ? 'result',r::text);
  r:=public.zt_assistant_execute(t.company_a,gen_random_uuid(),repeat('a',64));
  perform pg_temp.record_result('01_sem_sessao_execute_negado',r->>'code'='ACCESS_DENIED',r::text);
end $$;
reset role;

-- 2, 6, 7, 8, 9, 11 e 12. Proprietário A: empresa inválida, leitura isolada, prévia, confirmação e idempotência.
select set_config('request.jwt.claim.sub',(select owner_a::text from zt_assistant_test),true);
set local role authenticated;
do $$
declare t zt_assistant_test%rowtype; r jsonb; r2 jsonb; v_request uuid:=gen_random_uuid(); v_ids uuid[];
begin
  select * into t from zt_assistant_test;
  r:=public.zt_assistant_plan(gen_random_uuid(),'owner_today_schedule','{}'::jsonb,gen_random_uuid());
  perform pg_temp.record_result('02_empresa_invalida_negada',r->>'code'='ACCESS_DENIED',r::text);

  r:=public.zt_assistant_plan(t.company_a,'owner_today_schedule','{}'::jsonb,gen_random_uuid());
  select array_agg((i->>'id')::uuid) into v_ids from jsonb_array_elements(r#>'{result,items}') i;
  perform pg_temp.record_result('06_owner_agenda_hoje',r->>'confirmationRequired'='false'
    and v_ids @> array[t.wo_report,t.wo_return,t.wo_finalize] and not v_ids @> array[t.wo_open]
    and v_ids <@ array[t.wo_report,t.wo_return,t.wo_finalize],r::text);
  r:=public.zt_assistant_plan(t.company_a,'owner_find_client',jsonb_build_object('query','__ASSISTANT_CLIENT_'),gen_random_uuid());
  select array_agg((i->>'id')::uuid) into v_ids from jsonb_array_elements(r#>'{result,items}') i;
  perform pg_temp.record_result('06_owner_clientes_somente_empresa',v_ids=array[t.client_a],r::text);

  r:=public.zt_assistant_plan(t.company_a,'create_client',jsonb_build_object('name','__ASSISTANT_NEW_CLIENT__','phone','11900000003'),v_request);
  perform pg_temp.record_result('07_08_plan_gera_previa',(r->>'confirmationRequired')::boolean
    and r->>'previewHash' ~ '^[0-9a-f]{64}$' and r->>'previewVersion'='1'
    and jsonb_array_length(r->'preview')>0 and not r ? 'result',r::text);
  update zt_assistant_test set request_client=v_request,client_hash=r->>'previewHash';

  r2:=public.zt_assistant_plan(t.company_a,'create_client',jsonb_build_object('name','__ASSISTANT_NEW_CLIENT__','phone','11900000003'),v_request);
  perform pg_temp.record_result('11_mesmo_request_mesma_previa',r2->>'previewHash'=r->>'previewHash',r2::text);
  r2:=public.zt_assistant_plan(t.company_a,'create_client',jsonb_build_object('name','__ASSISTANT_OTHER__'),v_request);
  perform pg_temp.record_result('11_mesmo_request_outra_acao_conflita',r2->>'code'='REQUEST_CONFLICT',r2::text);

  r2:=public.zt_assistant_execute(t.company_a,v_request,null);
  perform pg_temp.record_result('09_execute_sem_hash_falha',r2 ? 'error' and r2->>'code'='INVALID_INPUT',r2::text);
  r2:=public.zt_assistant_execute(t.company_a,v_request,repeat('0',64));
  perform pg_temp.record_result('10_execute_hash_errado_falha',r2 ? 'error' and r2->>'code'='INVALID_INPUT',r2::text);
  r2:=public.zt_assistant_execute(t.company_a,gen_random_uuid(),r->>'previewHash');
  perform pg_temp.record_result('10_execute_sem_previa_falha',r2 ? 'error' and r2->>'code'='ACCESS_DENIED',r2::text);
end $$;
reset role;

do $$
declare t zt_assistant_test%rowtype;
begin
  select * into t from zt_assistant_test;
  perform pg_temp.record_result('07_09_10_nada_salvo_antes_confirmar',
    not exists(select 1 from public.clients where company_id=t.company_a and name='__ASSISTANT_NEW_CLIENT__')
    and exists(select 1 from zt_private.assistant_plans p where p.company_id=t.company_a and p.request_id=t.request_client
      and p.state='pending' and p.confirmed_at is null and p.input is not null),null);
end $$;

-- 4 e 10. Outro usuário (técnico da mesma empresa e dono de outra empresa) não confirma a prévia de A.
select set_config('request.jwt.claim.sub',(select tech_a::text from zt_assistant_test),true);
set local role authenticated;
do $$
declare t zt_assistant_test%rowtype; r jsonb;
begin
  select * into t from zt_assistant_test;
  r:=public.zt_assistant_execute(t.company_a,t.request_client,t.client_hash);
  perform pg_temp.record_result('10_tecnico_nao_confirma_previa_do_owner',r ? 'error' and r->>'code'='ACCESS_DENIED',r::text);
end $$;
reset role;
select set_config('request.jwt.claim.sub',(select owner_b::text from zt_assistant_test),true);
set local role authenticated;
do $$
declare t zt_assistant_test%rowtype; r jsonb;
begin
  select * into t from zt_assistant_test;
  r:=public.zt_assistant_execute(t.company_a,t.request_client,t.client_hash);
  perform pg_temp.record_result('04_outro_tenant_nao_confirma_previa',r ? 'error' and r->>'code'='ACCESS_DENIED',r::text);
  r:=public.zt_assistant_execute(t.company_b,t.request_client,t.client_hash);
  perform pg_temp.record_result('04_previa_nao_atravessa_empresa',r ? 'error' and r->>'code'='ACCESS_DENIED',r::text);
end $$;
reset role;

-- 12. Confirmação válida executa uma vez; retry e novo plan devolvem o mesmo resultado.
select set_config('request.jwt.claim.sub',(select owner_a::text from zt_assistant_test),true);
set local role authenticated;
do $$
declare t zt_assistant_test%rowtype; r jsonb; r2 jsonb;
begin
  select * into t from zt_assistant_test;
  r:=public.zt_assistant_execute(t.company_a,t.request_client,t.client_hash);
  perform pg_temp.record_result('12_execute_confirmado',r#>>'{result,entityType}'='client' and r#>>'{result,id}' is not null,r::text);
  update zt_assistant_test set created_client=(r#>>'{result,id}')::uuid;
  r2:=public.zt_assistant_execute(t.company_a,t.request_client,t.client_hash);
  perform pg_temp.record_result('12_retry_execute_idempotente',r2=r,r2::text);
  r2:=public.zt_assistant_plan(t.company_a,'create_client',jsonb_build_object('name','__ASSISTANT_NEW_CLIENT__','phone','11900000003'),t.request_client);
  perform pg_temp.record_result('12_retry_plan_devolve_resultado',r2=r,r2::text);
end $$;
reset role;

do $$
declare t zt_assistant_test%rowtype;
begin
  select * into t from zt_assistant_test;
  perform pg_temp.record_result('12_sem_duplicidade',
    (select count(*) from public.clients where company_id=t.company_a and name='__ASSISTANT_NEW_CLIENT__')=1
    and exists(select 1 from public.clients where id=t.created_client and company_id=t.company_a),null);
  perform pg_temp.record_result('14_plano_concluido_sem_argumentos',
    exists(select 1 from zt_private.assistant_plans p where p.company_id=t.company_a and p.request_id=t.request_client
      and p.state='succeeded' and p.input is null and p.preview is null and p.confirmed_by=t.owner_a),null);
end $$;

-- Demais ações do proprietário passam pelas RPCs canônicas e permanecem na empresa A.
select set_config('request.jwt.claim.sub',(select owner_a::text from zt_assistant_test),true);
set local role authenticated;
do $$
declare t zt_assistant_test%rowtype; r jsonb; v_today date:=(now() at time zone 'America/Sao_Paulo')::date;
begin
  select * into t from zt_assistant_test;
  r:=pg_temp.assistant_run(t.company_a,'create_product',jsonb_build_object('name','__ASSISTANT_PRODUCT__','price',12.5));
  perform pg_temp.record_result('acao_create_product',r#>>'{exec,result,entityType}'='product',r::text);
  r:=pg_temp.assistant_run(t.company_a,'create_quote_draft',jsonb_build_object('client',t.client_a::text,
    'description','__ASSISTANT_QUOTE_ITEM__','quantity',2,'unitPrice',150.5));
  perform pg_temp.record_result('acao_create_quote_draft',r#>>'{exec,result,entityType}'='quote'
    and r#>>'{exec,result,number}' is not null,r::text);
  r:=pg_temp.assistant_run(t.company_a,'create_work_order',jsonb_build_object('client','__ASSISTANT_CLIENT_A__',
    'description','__ASSISTANT_NEW_WO__','address','Rua Assistente A, 1'));
  perform pg_temp.record_result('acao_create_work_order',r#>>'{exec,result,entityType}'='work_order'
    and r#>>'{exec,result,number}' is not null,r::text);
  r:=pg_temp.assistant_run(t.company_a,'schedule_work_order',jsonb_build_object('workOrder',t.wo_open::text,
    'date',(v_today+1)::text,'time','10:30'));
  perform pg_temp.record_result('acao_schedule_work_order',r#>>'{exec,result,id}'=t.wo_open::text,r::text);
  r:=pg_temp.assistant_run(t.company_a,'create_financial_entry',jsonb_build_object('description','__ASSISTANT_INCOME_PENDING__',
    'amount',99.9,'dueDate',v_today::text,'paid',false));
  perform pg_temp.record_result('acao_create_financial_entry_pendente',r#>>'{exec,result,entityType}'='financial_entry',r::text);
  r:=pg_temp.assistant_run(t.company_a,'create_financial_entry',jsonb_build_object('description','__ASSISTANT_INCOME_PAID__',
    'amount',50,'dueDate',v_today::text,'paid',true,'paidAt',v_today::text,'paymentMethod','pix','client',t.client_a::text));
  perform pg_temp.record_result('acao_create_financial_entry_recebida',r#>>'{exec,result,entityType}'='financial_entry',r::text);
  r:=public.zt_assistant_plan(t.company_a,'technician_today_orders','{}'::jsonb,gen_random_uuid());
  perform pg_temp.record_result('05_owner_nao_usa_acao_de_tecnico',r->>'code'='ACCESS_DENIED',r::text);
  begin
    perform zt_private.assistant_purge_plans();
    perform pg_temp.record_result('15_authenticated_sem_purge',false,'authenticated executou purge');
  exception when insufficient_privilege then
    perform pg_temp.record_result('15_authenticated_sem_purge',true,sqlstate);
  end;
end $$;
reset role;

do $$
declare t zt_assistant_test%rowtype; v_today date:=(now() at time zone 'America/Sao_Paulo')::date;
begin
  select * into t from zt_assistant_test;
  perform pg_temp.record_result('acoes_owner_persistidas_na_empresa',
    exists(select 1 from public.products where company_id=t.company_a and name='__ASSISTANT_PRODUCT__' and price=12.5 and cost=0)
    and exists(select 1 from public.quotes q join public.quote_items i on i.quote_id=q.id
      where q.company_id=t.company_a and q.client_id=t.client_a and q.status='draft' and i.name='__ASSISTANT_QUOTE_ITEM__')
    and exists(select 1 from public.work_orders where company_id=t.company_a and request='__ASSISTANT_NEW_WO__' and client_id=t.client_a)
    and exists(select 1 from public.work_orders where id=t.wo_open and status='scheduled'
      and scheduled_date=v_today+1 and scheduled_time='10:30')
    and (select count(*) from public.financial_entries where company_id=t.company_a
      and description in ('__ASSISTANT_INCOME_PENDING__','__ASSISTANT_INCOME_PAID__'))=2
    and not exists(select 1 from public.products where company_id=t.company_b and name='__ASSISTANT_PRODUCT__'),null);
end $$;

-- 5. Técnico: sem ações/dados administrativos, somente OS atribuídas.
select set_config('request.jwt.claim.sub',(select tech_a::text from zt_assistant_test),true);
set local role authenticated;
do $$
declare t zt_assistant_test%rowtype; r jsonb; v_ids uuid[]; v_rows integer;
begin
  select * into t from zt_assistant_test;
  r:=public.zt_assistant_plan(t.company_a,'owner_find_client',jsonb_build_object('query','__ASSISTANT_CLIENT_'),gen_random_uuid());
  perform pg_temp.record_result('05_tecnico_sem_busca_de_clientes',r->>'code'='ACCESS_DENIED' and not r ? 'result',r::text);
  r:=public.zt_assistant_plan(t.company_a,'create_financial_entry',jsonb_build_object('description','x','amount',1,'dueDate','2026-01-01','paid',false),gen_random_uuid());
  perform pg_temp.record_result('05_tecnico_sem_financeiro',r->>'code'='ACCESS_DENIED',r::text);
  r:=public.zt_assistant_plan(t.company_a,'technician_today_orders','{}'::jsonb,gen_random_uuid());
  select array_agg((i->>'id')::uuid) into v_ids from jsonb_array_elements(r#>'{result,items}') i;
  perform pg_temp.record_result('05_tecnico_somente_os_atribuidas',v_ids @> array[t.wo_report,t.wo_return,t.wo_finalize]
    and v_ids <@ array[t.wo_report,t.wo_return,t.wo_finalize],r::text);
  r:=public.zt_assistant_plan(t.company_a,'technician_open_assigned_order',jsonb_build_object('workOrder',t.wo_open::text),gen_random_uuid());
  perform pg_temp.record_result('05_tecnico_nao_abre_os_nao_atribuida',r ? 'error' and not r ? 'result',r::text);
  r:=pg_temp.assistant_run(t.company_a,'add_assigned_work_report',jsonb_build_object('workOrder',t.wo_open::text,'report','__ASSISTANT_DENIED__'));
  perform pg_temp.record_result('05_tecnico_nao_relata_os_nao_atribuida',r#>>'{plan,error}' is not null and not r ? 'exec',r::text);
  r:=pg_temp.assistant_run(t.company_a,'add_assigned_work_report',jsonb_build_object('workOrder',t.wo_report::text,'report','__ASSISTANT_REPORT__'));
  perform pg_temp.record_result('acao_add_assigned_work_report',r#>>'{exec,result,id}'=t.wo_report::text,r::text);
  r:=pg_temp.assistant_run(t.company_a,'mark_assigned_order_pending',jsonb_build_object('workOrder',t.wo_report::text,'note','__ASSISTANT_PENDING__'));
  perform pg_temp.record_result('acao_mark_assigned_order_pending',r#>>'{exec,result,id}'=t.wo_report::text,r::text);
  r:=pg_temp.assistant_run(t.company_a,'mark_assigned_order_return',jsonb_build_object('workOrder',t.wo_return::text,'reason','__ASSISTANT_RETURN__'));
  perform pg_temp.record_result('acao_mark_assigned_order_return',r#>>'{exec,result,id}'=t.wo_return::text,r::text);
  r:=pg_temp.assistant_run(t.company_a,'finalize_assigned_work_order',jsonb_build_object('workOrder',t.wo_finalize::text,'report','__ASSISTANT_FINAL__'));
  perform pg_temp.record_result('acao_finalize_assigned_work_order',r#>>'{exec,result,id}'=t.wo_finalize::text,r::text);
  select count(*) into v_rows from public.assistant_action_audit where company_id in (t.company_a,t.company_b);
  perform pg_temp.record_result('05_tecnico_nao_le_auditoria',v_rows=0,v_rows::text);
  begin
    perform 1 from zt_private.assistant_plans limit 1;
    perform pg_temp.record_result('05_tecnico_sem_planos_privados',false,'technician leu zt_private.assistant_plans');
  exception when insufficient_privilege then
    perform pg_temp.record_result('05_tecnico_sem_planos_privados',true,sqlstate);
  end;
end $$;
reset role;

do $$
declare t zt_assistant_test%rowtype;
begin
  select * into t from zt_assistant_test;
  perform pg_temp.record_result('acoes_tecnico_persistidas',
    exists(select 1 from public.work_order_reports where work_order_id=t.wo_report and body='__ASSISTANT_REPORT__' and author_id=t.tech_a)
    and exists(select 1 from public.work_orders where id=t.wo_report and pending_note='__ASSISTANT_PENDING__')
    and (select count(*) from public.work_order_returns where company_id=t.company_a)=1
    and exists(select 1 from public.work_orders where id=t.wo_finalize and status='done')
    and not exists(select 1 from public.work_order_reports where work_order_id=t.wo_open),null);
end $$;

-- 3 e 4. Usuário sem vínculo e dono de outra empresa.
select set_config('request.jwt.claim.sub',(select external_user::text from zt_assistant_test),true);
set local role authenticated;
do $$
declare t zt_assistant_test%rowtype; r jsonb;
begin
  select * into t from zt_assistant_test;
  r:=public.zt_assistant_plan(t.company_a,'owner_today_schedule','{}'::jsonb,gen_random_uuid());
  perform pg_temp.record_result('03_sem_membership_negado',r->>'code'='ACCESS_DENIED' and not r ? 'result',r::text);
  r:=public.zt_assistant_plan(t.company_a,'create_client',jsonb_build_object('name','__ASSISTANT_INTRUDER__'),gen_random_uuid());
  perform pg_temp.record_result('03_sem_membership_sem_previa',r->>'code'='ACCESS_DENIED',r::text);
end $$;
reset role;
select set_config('request.jwt.claim.sub',(select owner_b::text from zt_assistant_test),true);
set local role authenticated;
do $$
declare t zt_assistant_test%rowtype; r jsonb; v_ids uuid[]; v_rows integer;
begin
  select * into t from zt_assistant_test;
  r:=public.zt_assistant_plan(t.company_a,'owner_find_client',jsonb_build_object('query','__ASSISTANT_CLIENT_'),gen_random_uuid());
  perform pg_temp.record_result('04_outro_tenant_nao_le_empresa_a',r->>'code'='ACCESS_DENIED' and not r ? 'result',r::text);
  r:=public.zt_assistant_plan(t.company_b,'owner_find_client',jsonb_build_object('query','__ASSISTANT_CLIENT_'),gen_random_uuid());
  select array_agg((i->>'id')::uuid) into v_ids from jsonb_array_elements(r#>'{result,items}') i;
  perform pg_temp.record_result('04_owner_b_ve_somente_empresa_b',v_ids=array[t.client_b],r::text);
  select count(*) into v_rows from public.assistant_action_audit where company_id=t.company_a;
  perform pg_temp.record_result('04_owner_b_nao_le_auditoria_de_a',v_rows=0,v_rows::text);
end $$;
reset role;

-- 13. Quota: limite por usuário/empresa, membership ativa e assinatura válida.
select set_config('request.jwt.claim.sub',(select owner_a::text from zt_assistant_test),true);
set local role authenticated;
do $$
declare t zt_assistant_test%rowtype; i integer; v_state text;
begin
  select * into t from zt_assistant_test;
  for i in 1..10 loop perform public.zt_assistant_consume_ai_quota(t.company_a); end loop;
  begin
    perform public.zt_assistant_consume_ai_quota(t.company_a);
    v_state:='aceitou a 11a chamada';
  exception when others then v_state:=sqlstate;
  end;
  perform pg_temp.record_result('13_quota_limite_por_minuto',v_state='P0001',v_state);
end $$;
reset role;
update public.subscriptions s set status='canceled'::public.zt_sub_status from zt_assistant_test t where s.company_id=t.company_b;
select set_config('request.jwt.claim.sub',(select owner_b::text from zt_assistant_test),true);
set local role authenticated;
do $$
declare t zt_assistant_test%rowtype; r jsonb; v_state text;
begin
  select * into t from zt_assistant_test;
  begin
    perform public.zt_assistant_consume_ai_quota(t.company_a);
    v_state:='consumiu quota de outra empresa';
  exception when others then v_state:=sqlstate;
  end;
  perform pg_temp.record_result('13_quota_outro_tenant_negada',v_state='42501',v_state);
  begin
    perform public.zt_assistant_consume_ai_quota(t.company_b);
    v_state:='consumiu quota com assinatura cancelada';
  exception when others then v_state:=sqlstate;
  end;
  perform pg_temp.record_result('13_quota_assinatura_cancelada_negada',v_state='42501',v_state);
  r:=public.zt_assistant_plan(t.company_b,'create_client',jsonb_build_object('name','__ASSISTANT_CANCELED__'),gen_random_uuid());
  perform pg_temp.record_result('13_mutacao_sem_assinatura_negada',r->>'code'='ACCESS_DENIED',r::text);
end $$;
reset role;

-- 15. Retenção: sem pg_cron, a limpeza privada expira e apaga argumentos; prévia expirada não executa.
select set_config('request.jwt.claim.sub',(select owner_a::text from zt_assistant_test),true);
set local role authenticated;
do $$
declare t zt_assistant_test%rowtype; r jsonb; v_request uuid:=gen_random_uuid();
begin
  select * into t from zt_assistant_test;
  r:=public.zt_assistant_plan(t.company_a,'create_product',jsonb_build_object('name','__ASSISTANT_EXPIRED_PRODUCT__','price',1),v_request);
  update zt_assistant_test set request_expired=v_request,expired_hash=r->>'previewHash';
end $$;
reset role;
update zt_private.assistant_plans p
set retain_until=clock_timestamp()-interval '1 second',expires_at=clock_timestamp()-interval '1 second'
from zt_assistant_test t where p.company_id=t.company_a and p.request_id=t.request_expired;
select zt_private.assistant_purge_plans();
do $$
declare t zt_assistant_test%rowtype;
begin
  select * into t from zt_assistant_test;
  perform pg_temp.record_result('15_purge_expira_e_apaga_argumentos',
    exists(select 1 from zt_private.assistant_plans p where p.company_id=t.company_a and p.request_id=t.request_expired
      and p.state='expired' and p.input is null and p.preview is null),null);
end $$;
select set_config('request.jwt.claim.sub',(select owner_a::text from zt_assistant_test),true);
set local role authenticated;
do $$
declare t zt_assistant_test%rowtype; r jsonb;
begin
  select * into t from zt_assistant_test;
  r:=public.zt_assistant_execute(t.company_a,t.request_expired,t.expired_hash);
  perform pg_temp.record_result('15_previa_expirada_nao_executa',r->>'code'='PLAN_EXPIRED',r::text);
end $$;
reset role;

-- Membership desativada perde acesso imediatamente.
update public.company_members m set status='disabled'::public.zt_member_status
from zt_assistant_test t where m.company_id=t.company_a and m.user_id=t.tech_a;
select set_config('request.jwt.claim.sub',(select tech_a::text from zt_assistant_test),true);
set local role authenticated;
do $$
declare t zt_assistant_test%rowtype; r jsonb;
begin
  select * into t from zt_assistant_test;
  r:=public.zt_assistant_plan(t.company_a,'technician_today_orders','{}'::jsonb,gen_random_uuid());
  perform pg_temp.record_result('05_tecnico_desativado_perde_acesso',r->>'code'='ACCESS_DENIED' and not r ? 'result',r::text);
end $$;
reset role;

-- 14. Auditoria: proprietário lê a própria empresa; nenhum argumento bruto; tentativas de não-membros não materializadas.
select set_config('request.jwt.claim.sub',(select owner_a::text from zt_assistant_test),true);
set local role authenticated;
do $$
declare t zt_assistant_test%rowtype; v_rows integer;
begin
  select * into t from zt_assistant_test;
  select count(*) into v_rows from public.assistant_action_audit where company_id=t.company_a;
  perform pg_temp.record_result('14_owner_le_auditoria_da_empresa',v_rows>0,v_rows::text);
end $$;
reset role;
do $$
declare t zt_assistant_test%rowtype;
begin
  select * into t from zt_assistant_test;
  perform pg_temp.record_result('14_auditoria_do_ciclo_completo',
    (select array_agg(distinct a.status order by a.status) from public.assistant_action_audit a
      where a.company_id=t.company_a and a.request_id=t.request_client)=array['denied','prepared','succeeded']
    and exists(select 1 from public.assistant_action_audit a where a.company_id=t.company_a and a.request_id=t.request_client
      and a.status='succeeded' and a.target_type='client' and a.target_id=t.created_client and a.confirmed_by=t.owner_a),null);
  perform pg_temp.record_result('14_auditoria_sem_argumentos_brutos',
    not exists(select 1 from public.assistant_action_audit a where a.company_id in (t.company_a,t.company_b)
      and (row_to_json(a)::text like '%__ASSISTANT_NEW_CLIENT__%' or row_to_json(a)::text like '%11900000003%'
        or row_to_json(a)::text like '%__ASSISTANT_REPORT__%')),null);
  perform pg_temp.record_result('14_nao_membros_nao_materializados',
    not exists(select 1 from public.assistant_action_audit a where a.actor_user_id=t.external_user and a.company_id=t.company_a)
    and not exists(select 1 from public.assistant_action_audit a where a.actor_user_id=t.owner_b and a.company_id=t.company_a),null);
  perform pg_temp.record_result('14_negacao_de_membro_auditada',
    exists(select 1 from public.assistant_action_audit a where a.company_id=t.company_a and a.actor_user_id=t.tech_a
      and a.status='denied' and a.error_code='ACCESS_DENIED'),null);
end $$;

do $$
declare v_failures text;
begin
  select string_agg(name||' => '||coalesce(detail,''),E'\n' order by name) into v_failures
  from zt_assistant_results where not ok;
  if v_failures is not null then raise exception 'ASSISTANT_REGRESSION_FAILED%', E'\n'||v_failures; end if;
  if (select count(*) from zt_assistant_results)<>59 then
    raise exception 'ASSISTANT_REGRESSION_INCOMPLETE: % checks', (select count(*) from zt_assistant_results);
  end if;
end $$;

select 'ASSISTANT_0092_ACTIONS' as test, count(*) as checks, bool_and(ok) as all_ok from zt_assistant_results;

rollback;
