-- ZiisTec Beta — convites beta, plano Profissional e trava do zt_create_company (0099).
-- Usuários sintéticos só dentro da transação; convite de equipe intacto; isolamento entre empresas;
-- assinatura continua controlando escrita e Assistente; assinaturas existentes não mudam.
-- Destino: SOMENTE CI descartável ou staging/homologação. Tudo termina em ROLLBACK.
begin;

create temp table zt_bi_users (key text primary key, id uuid not null, email text not null, confirmed boolean not null) on commit drop;
create temp table zt_bi (company_x uuid, company_a uuid, invite_a uuid, invite_u uuid, invite_e uuid, invite_r uuid, invite_f uuid) on commit drop;
create temp table zt_bi_subs (id uuid primary key, fingerprint text not null) on commit drop;
create temp table zt_bi_calls (name text primary key, result jsonb) on commit drop;
create temp table zt_bi_results (name text primary key, ok boolean not null, detail text) on commit drop;
grant select, insert, update on zt_bi_users, zt_bi, zt_bi_subs, zt_bi_calls, zt_bi_results to authenticated, anon;

create function pg_temp.record_result(p_name text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into zt_bi_results(name,ok,detail) values(p_name,coalesce(p_ok,false),left(p_detail,600));
$$;
create function pg_temp.uid(p_key text) returns uuid language sql as $$ select id from zt_bi_users where key=p_key $$;
create function pg_temp.call(p_name text) returns jsonb language sql as $$ select result from zt_bi_calls where name=p_name $$;
create function pg_temp.claims(p_user uuid, p_aal text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text,''), true);
  perform set_config('request.jwt.claims', json_build_object('sub',p_user,'role','authenticated','aal',p_aal)::text, true);
end $$;
-- Onboarding real: chama a RPC pública como o usuário; erro vira {"error": SQLSTATE, "hint": ...}.
create function pg_temp.create_company_as(p_user uuid, p_name text)
returns jsonb language plpgsql as $$
declare v uuid; v_state text; v_hint text;
begin
  perform pg_temp.claims(p_user,'aal1');
  v:=public.zt_create_company(p_name,'Teste beta',false,null,null);
  return jsonb_build_object('company',v);
exception when others then
  get stacked diagnostics v_state=returned_sqlstate, v_hint=pg_exception_hint;
  return jsonb_build_object('error',v_state,'hint',nullif(v_hint,''));
end $$;
create function pg_temp.act(p_user uuid, p_aal text, p_action text, p_email text default null, p_days integer default null, p_invite uuid default null)
returns jsonb language plpgsql as $$
declare v_state text;
begin
  perform pg_temp.claims(p_user,p_aal);
  if p_action='list' then return jsonb_build_object('rows',public.zt_platform_list_beta_invites()); end if;
  if p_action='create' then return public.zt_platform_create_beta_invite(p_email,p_days); end if;
  if p_action='revoke' then return public.zt_platform_revoke_beta_invite(p_invite); end if;
  if p_action='status' then return public.zt_beta_invite_status(); end if;
  if p_action='select' then return jsonb_build_object('count',(select count(*) from public.beta_invites)); end if;
  if p_action='accept' then return jsonb_build_object('accepted',public.zt_accept_invites()); end if;
  raise exception 'acao desconhecida: %',p_action;
exception when others then
  get stacked diagnostics v_state=returned_sqlstate;
  return jsonb_build_object('error',v_state);
end $$;
create function pg_temp.invite(p_id uuid) returns jsonb language sql as $$
  select jsonb_build_object('status',i.status,'email',i.email,'used_by',i.used_by,'company_id',i.company_id,'used',i.used_at is not null)
    from public.beta_invites i where i.id=p_id;
$$;
create function pg_temp.owner_companies(p_user uuid) returns integer language sql as $$
  select count(*)::integer from public.company_members m where m.user_id=p_user and m.role='owner';
$$;

-- Assinaturas existentes: fotografia antes de qualquer chamada.
insert into zt_bi_subs(id,fingerprint) select s.id, md5(to_jsonb(s)::text) from public.subscriptions s;

-- Identidades sintéticas (e-mail aleatório, domínio reservado). O "a" tem caixa mista no Auth.
with sfx as (select left(md5(gen_random_uuid()::text),10) as v)
insert into zt_bi_users(key,id,email,confirmed)
select k, gen_random_uuid(),
       case when k='a' then 'Zt-0099-A-'||sfx.v||'@Example.Invalid' else 'zt-0099-'||k||'-'||sfx.v||'@example.invalid' end,
       k<>'u'
  from sfx, unnest(array['admin','a','n','b','u','e','r','f','t','xowner']) as k;

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select '00000000-0000-0000-0000-000000000000',u.id,'authenticated','authenticated',u.email,'',
       case when u.confirmed then now() end,'{"provider":"email","providers":["email"]}'::jsonb,
       jsonb_build_object('full_name','Beta '||u.key),now(),now()
  from zt_bi_users u;
insert into public.profiles(id,full_name,email)
select u.id,'Beta '||u.key,u.email from zt_bi_users u
on conflict (id) do nothing;

-- Administrador da plataforma só dentro desta transação; "f" já usou o trial inicial.
update public.profiles set is_platform_admin=true where id=pg_temp.uid('admin');
update public.profiles set onboarding_company_created_at=now()-interval '30 days' where id=pg_temp.uid('f');

-- Empresa existente X, com proprietário próprio, para o convite de equipe.
insert into zt_bi(company_x) values(gen_random_uuid());
insert into public.companies(id,name,has_team) select company_x,'__BI_X__',true from zt_bi;
insert into public.subscriptions(company_id,status,current_period_start,current_period_end)
select company_x,'active'::public.zt_sub_status,current_date,current_date+30 from zt_bi
on conflict (company_id) do update set status=excluded.status,
  current_period_start=excluded.current_period_start,current_period_end=excluded.current_period_end;
insert into public.company_members(company_id,user_id,role,status)
select company_x,pg_temp.uid('xowner'),'owner'::public.zt_role,'active'::public.zt_member_status from zt_bi;

-- ------------------------------------------------------------------ recusas
set local role anon;
do $$
declare v jsonb;
begin
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims','{"role":"anon"}',true);
  begin perform 1 from public.beta_invites limit 1; v:='{"ok":true}';
  exception when others then v:=jsonb_build_object('error',sqlstate); end;
  insert into zt_bi_calls values('anon_select',v);
  begin v:=jsonb_build_object('rows',public.zt_platform_list_beta_invites());
  exception when others then v:=jsonb_build_object('error',sqlstate); end;
  insert into zt_bi_calls values('anon_list',v);
  begin v:=public.zt_beta_invite_status();
  exception when others then v:=jsonb_build_object('error',sqlstate); end;
  insert into zt_bi_calls values('anon_status',v);
  begin v:=jsonb_build_object('company',public.zt_create_company('Anon','x',false,null,null));
  exception when others then v:=jsonb_build_object('error',sqlstate); end;
  insert into zt_bi_calls values('anon_create_company',v);
end $$;
reset role;

set local role authenticated;
do $$
declare x text:=(select email from zt_bi_users where key='n');
begin
  -- Proprietário comum, mesmo com MFA, não lê nem administra convites.
  insert into zt_bi_calls values('owner_select',pg_temp.act(pg_temp.uid('xowner'),'aal2','select'));
  insert into zt_bi_calls values('owner_list',pg_temp.act(pg_temp.uid('xowner'),'aal2','list'));
  insert into zt_bi_calls values('owner_create',pg_temp.act(pg_temp.uid('xowner'),'aal2','create',x,7));
  insert into zt_bi_calls values('owner_self_invite',pg_temp.act(pg_temp.uid('xowner'),'aal2','create',(select email from zt_bi_users where key='xowner'),7));
  insert into zt_bi_calls values('owner_revoke',pg_temp.act(pg_temp.uid('xowner'),'aal2','revoke',null,null,gen_random_uuid()));
  -- Administrador sem MFA é recusado.
  insert into zt_bi_calls values('admin_aal1_list',pg_temp.act(pg_temp.uid('admin'),'aal1','list'));
  insert into zt_bi_calls values('admin_aal1_create',pg_temp.act(pg_temp.uid('admin'),'aal1','create',x,7));
  -- Validações do administrador com MFA.
  insert into zt_bi_calls values('admin_self_invite',pg_temp.act(pg_temp.uid('admin'),'aal2','create',upper((select email from zt_bi_users where key='admin')),7));
  insert into zt_bi_calls values('admin_bad_email',pg_temp.act(pg_temp.uid('admin'),'aal2','create','sem-arroba',7));
  insert into zt_bi_calls values('admin_days_0',pg_temp.act(pg_temp.uid('admin'),'aal2','create',x,0));
  insert into zt_bi_calls values('admin_days_91',pg_temp.act(pg_temp.uid('admin'),'aal2','create',x,91));
  insert into zt_bi_calls values('admin_revoke_unknown',pg_temp.act(pg_temp.uid('admin'),'aal2','revoke',null,null,gen_random_uuid()));
end $$;
reset role;

-- ------------------------------------------------------------------ convites do administrador
set local role authenticated;
do $$
declare v_admin uuid:=pg_temp.uid('admin');
begin
  insert into zt_bi_calls values('create_a',pg_temp.act(v_admin,'aal2','create','  '||upper((select email from zt_bi_users where key='a'))||' ',null));
  insert into zt_bi_calls values('create_a_retry',pg_temp.act(v_admin,'aal2','create',lower((select email from zt_bi_users where key='a')),30));
  insert into zt_bi_calls values('create_u',pg_temp.act(v_admin,'aal2','create',(select email from zt_bi_users where key='u'),7));
  insert into zt_bi_calls values('create_e',pg_temp.act(v_admin,'aal2','create',(select email from zt_bi_users where key='e'),7));
  insert into zt_bi_calls values('create_r',pg_temp.act(v_admin,'aal2','create',(select email from zt_bi_users where key='r'),7));
  insert into zt_bi_calls values('create_f',pg_temp.act(v_admin,'aal2','create',(select email from zt_bi_users where key='f'),14));
end $$;
reset role;

update zt_bi set
  invite_a=(pg_temp.call('create_a')->>'id')::uuid, invite_u=(pg_temp.call('create_u')->>'id')::uuid,
  invite_e=(pg_temp.call('create_e')->>'id')::uuid, invite_r=(pg_temp.call('create_r')->>'id')::uuid,
  invite_f=(pg_temp.call('create_f')->>'id')::uuid;
-- O convite de "e" vence (data simulada no passado).
update public.beta_invites set created_at=now()-interval '10 days', expires_at=now()-interval '1 day'
 where id=(select invite_e from zt_bi);

set local role authenticated;
do $$
declare v_admin uuid:=pg_temp.uid('admin'); t zt_bi%rowtype;
begin
  select * into t from zt_bi;
  insert into zt_bi_calls values('revoke_r',pg_temp.act(v_admin,'aal2','revoke',null,null,t.invite_r));
  insert into zt_bi_calls values('revoke_r_retry',pg_temp.act(v_admin,'aal2','revoke',null,null,t.invite_r));
  insert into zt_bi_calls values('status_a',pg_temp.act(pg_temp.uid('a'),'aal1','status'));
  insert into zt_bi_calls values('status_n',pg_temp.act(pg_temp.uid('n'),'aal1','status'));
  insert into zt_bi_calls values('status_e',pg_temp.act(pg_temp.uid('e'),'aal1','status'));
  insert into zt_bi_calls values('status_r',pg_temp.act(pg_temp.uid('r'),'aal1','status'));
  insert into zt_bi_calls values('status_u',pg_temp.act(pg_temp.uid('u'),'aal1','status'));
  -- Tentativas de criar empresa sem convite válido.
  insert into zt_bi_calls values('company_n',pg_temp.create_company_as(pg_temp.uid('n'),'Empresa N'));
  insert into zt_bi_calls values('company_b',pg_temp.create_company_as(pg_temp.uid('b'),'Empresa B'));
  insert into zt_bi_calls values('company_u',pg_temp.create_company_as(pg_temp.uid('u'),'Empresa U'));
  insert into zt_bi_calls values('company_e',pg_temp.create_company_as(pg_temp.uid('e'),'Empresa E'));
  insert into zt_bi_calls values('company_r',pg_temp.create_company_as(pg_temp.uid('r'),'Empresa R'));
  -- Convite válido, mas a criação falha: o convite não pode ser consumido.
  insert into zt_bi_calls values('company_f_trial_used',pg_temp.create_company_as(pg_temp.uid('f'),'Empresa F'));
  insert into zt_bi_calls values('company_a_blank',pg_temp.create_company_as(pg_temp.uid('a'),'   '));
  insert into zt_bi_calls values('invite_a_after_failure',pg_temp.invite(t.invite_a));
  -- Convite válido: cria; repetir devolve a mesma empresa.
  insert into zt_bi_calls values('company_a',pg_temp.create_company_as(pg_temp.uid('a'),'Empresa Beta A'));
  insert into zt_bi_calls values('company_a_retry',pg_temp.create_company_as(pg_temp.uid('a'),'Empresa Beta A'));
  insert into zt_bi_calls values('status_a_after',pg_temp.act(pg_temp.uid('a'),'aal1','status'));
  insert into zt_bi_calls values('admin_list',pg_temp.act(v_admin,'aal2','list'));
  insert into zt_bi_calls values('revoke_used',pg_temp.act(v_admin,'aal2','revoke',null,null,t.invite_a));
end $$;
reset role;

update zt_bi set company_a=(pg_temp.call('company_a')->>'company')::uuid;

-- Convite de equipe: técnico sem convite beta entra na empresa existente X.
insert into public.company_invites(company_id,email,role,job_title,name)
select company_x,(select email from zt_bi_users where key='t'),'technician','Técnico beta','Beta t' from zt_bi;

set local role authenticated;
do $$
declare t zt_bi%rowtype;
begin
  select * into t from zt_bi;
  insert into zt_bi_calls values('team_accept',pg_temp.act(pg_temp.uid('t'),'aal1','accept'));
  -- Isolamento: o novo proprietário A não enxerga a empresa X.
  perform pg_temp.claims(pg_temp.uid('a'),'aal1');
  insert into zt_bi_calls values('a_visibility',jsonb_build_object(
    'companies',(select count(*) from public.companies),
    'own',(select count(*) from public.companies where id=t.company_a),
    'x_companies',(select count(*) from public.companies where id=t.company_x),
    'x_subscriptions',(select count(*) from public.subscriptions where company_id=t.company_x),
    'x_members',(select count(*) from public.company_members where company_id=t.company_x)));
end $$;
reset role;

-- Convite usado não volta a valer: A deixa de ser proprietário e tenta de novo.
delete from public.company_members where user_id=pg_temp.uid('a') and company_id=(select company_a from zt_bi);
update public.profiles set onboarding_company_created_at=null where id=pg_temp.uid('a');
set local role authenticated;
do $$ begin
  insert into zt_bi_calls values('company_a_reuse',pg_temp.create_company_as(pg_temp.uid('a'),'Empresa Beta A2'));
end $$;
reset role;
insert into public.company_members(company_id,user_id,role,status)
select company_a,pg_temp.uid('a'),'owner'::public.zt_role,'active'::public.zt_member_status from zt_bi;

-- Trial vencido (2 dias: o Assistente usa a data de São Paulo): escrita e Assistente bloqueados; dados preservados.
update public.subscriptions set current_period_start=current_date-20, current_period_end=current_date-2
 where company_id=(select company_a from zt_bi);
do $$
declare t zt_bi%rowtype; v jsonb;
begin
  select * into t from zt_bi;
  perform pg_temp.claims(pg_temp.uid('a'),'aal1');
  begin perform zt_private.assert_operational_write_allowed(t.company_a); v:='{"ok":true}';
  exception when others then v:=jsonb_build_object('error',sqlstate); end;
  insert into zt_bi_calls values('expired_write',v);
  begin perform zt_private.assistant_subscription(t.company_a); v:='{"ok":true}';
  exception when others then v:=jsonb_build_object('error',sqlstate); end;
  insert into zt_bi_calls values('expired_assistant',v);
end $$;
set local role authenticated;
do $$
declare t zt_bi%rowtype;
begin
  select * into t from zt_bi;
  perform pg_temp.claims(pg_temp.uid('a'),'aal1');
  insert into zt_bi_calls values('expired_refresh',jsonb_build_object('status',public.zt_refresh_subscription_status(t.company_a)));
end $$;
reset role;

-- ------------------------------------------------------------------ verificações
do $$
declare t zt_bi%rowtype; v_rows jsonb:=pg_temp.call('admin_list')->'rows'; v_fn text;
begin
  select * into t from zt_bi;

  perform pg_temp.record_result('00_acl_rpcs',
    (select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']::text[]
       and not has_function_privilege('anon',p.oid,'EXECUTE') and has_function_privilege('authenticated',p.oid,'EXECUTE')
       and not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE'))
       from pg_proc p where p.oid in (to_regprocedure('public.zt_beta_invite_status()'),to_regprocedure('public.zt_platform_list_beta_invites()'),
         to_regprocedure('public.zt_platform_create_beta_invite(text,integer)'),to_regprocedure('public.zt_platform_revoke_beta_invite(uuid)')))
    and (select count(*) from pg_proc p where p.oid in (to_regprocedure('public.zt_beta_invite_status()'),to_regprocedure('public.zt_platform_list_beta_invites()'),
         to_regprocedure('public.zt_platform_create_beta_invite(text,integer)'),to_regprocedure('public.zt_platform_revoke_beta_invite(uuid)')))=4
    and (select p.prosecdef and p.proconfig @> array['search_path=""']::text[]
           and not has_function_privilege('authenticated',p.oid,'EXECUTE') and not has_function_privilege('anon',p.oid,'EXECUTE')
           from pg_proc p where p.oid=to_regprocedure('zt_private.zt_create_company(text,text,boolean,text,text)')),
    'rpc acl');
  perform pg_temp.record_result('01_tabela_fechada',
    (select c.relrowsecurity from pg_class c where c.oid='public.beta_invites'::regclass)
    and not exists(select 1 from pg_policies p where p.schemaname='public' and p.tablename='beta_invites')
    and not has_table_privilege('anon','public.beta_invites','SELECT,INSERT,UPDATE,DELETE')
    and not has_table_privilege('authenticated','public.beta_invites','SELECT,INSERT,UPDATE,DELETE'),
    'rls/grants');
  perform pg_temp.record_result('02_defaults_profissional',
    (select column_default from information_schema.columns where table_schema='public' and table_name='subscriptions' and column_name='plan')='''Profissional''::text'
    and (select column_default from information_schema.columns where table_schema='public' and table_name='subscriptions' and column_name='amount')='79.90',
    (select string_agg(column_name||'='||column_default,', ') from information_schema.columns where table_schema='public' and table_name='subscriptions' and column_name in ('plan','amount')));
  perform pg_temp.record_result('03_anon_negado',
    pg_temp.call('anon_select')->>'error'='42501' and pg_temp.call('anon_list')->>'error'='42501'
    and pg_temp.call('anon_status')->>'error'='42501' and pg_temp.call('anon_create_company')->>'error'='42501',
    (select jsonb_object_agg(name,result)::text from zt_bi_calls where name like 'anon_%'));
  perform pg_temp.record_result('04_owner_negado',
    (select bool_and(result->>'error'='42501') from zt_bi_calls where name in ('owner_select','owner_list','owner_create','owner_self_invite','owner_revoke')),
    (select jsonb_object_agg(name,result)::text from zt_bi_calls where name like 'owner_%'));
  perform pg_temp.record_result('05_admin_sem_mfa_negado',
    pg_temp.call('admin_aal1_list')->>'error'='42501' and pg_temp.call('admin_aal1_create')->>'error'='42501',
    (select jsonb_object_agg(name,result)::text from zt_bi_calls where name like 'admin_aal1_%'));
  perform pg_temp.record_result('06_admin_nao_convida_a_si_mesmo', pg_temp.call('admin_self_invite')->>'error'='42501',
    pg_temp.call('admin_self_invite')::text);
  perform pg_temp.record_result('07_validacoes',
    pg_temp.call('admin_bad_email')->>'error'='22023' and pg_temp.call('admin_days_0')->>'error'='22023'
    and pg_temp.call('admin_days_91')->>'error'='22023' and pg_temp.call('admin_revoke_unknown')->>'error'='P0002',
    (select jsonb_object_agg(name,result)::text from zt_bi_calls where name in ('admin_bad_email','admin_days_0','admin_days_91','admin_revoke_unknown')));
  perform pg_temp.record_result('08_convite_normalizado_e_unico',
    pg_temp.call('create_a') @> '{"created":true,"status":"pending"}'
    and pg_temp.call('create_a')->>'email'=lower((select email from zt_bi_users where key='a'))
    and pg_temp.call('create_a_retry') @> jsonb_build_object('created',false,'id',t.invite_a)
    and (select count(*) from public.beta_invites i where i.email=lower((select email from zt_bi_users where key='a')))=1
    and (select (expires_at-created_at) between interval '6 days 23 hours' and interval '7 days 1 hour' from public.beta_invites where id=t.invite_a),
    pg_temp.call('create_a')::text||' / '||pg_temp.call('create_a_retry')::text);
  perform pg_temp.record_result('09_auditoria_admin',
    (select count(*) from public.platform_audit_logs a where a.action='beta_invite_created' and a.actor_id=pg_temp.uid('admin'))=5
    and (select count(*) from public.platform_audit_logs a where a.action='beta_invite_revoked' and a.actor_id=pg_temp.uid('admin'))=1,
    (select string_agg(action,',') from public.platform_audit_logs a where a.actor_id=pg_temp.uid('admin')));
  perform pg_temp.record_result('10_revogacao_idempotente_e_usado_irrevogavel',
    pg_temp.call('revoke_r') @> '{"changed":true,"status":"revoked"}' and pg_temp.call('revoke_r_retry') @> '{"changed":false,"status":"revoked"}'
    and pg_temp.call('revoke_used')->>'error'='22023' and pg_temp.invite(t.invite_a)->>'status'='used',
    pg_temp.call('revoke_r')::text||' / '||pg_temp.call('revoke_used')::text);
  perform pg_temp.record_result('11_status_do_proprio_email',
    pg_temp.call('status_a') @> '{"invited":true,"email_confirmed":true}' and pg_temp.call('status_n') @> '{"invited":false}'
    and pg_temp.call('status_e') @> '{"invited":false}' and pg_temp.call('status_r') @> '{"invited":false}'
    and pg_temp.call('status_u') @> '{"invited":false,"email_confirmed":false}' and pg_temp.call('status_a_after') @> '{"invited":false}',
    (select jsonb_object_agg(name,result)::text from zt_bi_calls where name like 'status_%'));
  perform pg_temp.record_result('12_sem_convite_nao_cria',
    (select bool_and(result @> '{"error":"42501","hint":"beta_invite_required"}') from zt_bi_calls where name in ('company_n','company_b','company_e','company_r'))
    and pg_temp.owner_companies(pg_temp.uid('n'))+pg_temp.owner_companies(pg_temp.uid('b'))+pg_temp.owner_companies(pg_temp.uid('e'))+pg_temp.owner_companies(pg_temp.uid('r'))=0
    and not exists(select 1 from public.profiles p join zt_bi_users u on u.id=p.id where u.key in ('n','b','e','r','u') and p.onboarding_company_created_at is not null),
    (select jsonb_object_agg(name,result)::text from zt_bi_calls where name in ('company_n','company_b','company_e','company_r')));
  perform pg_temp.record_result('13_email_nao_confirmado_nao_cria',
    pg_temp.call('company_u') @> '{"error":"42501","hint":"email_not_confirmed"}' and pg_temp.invite(t.invite_u)->>'status'='pending'
    and pg_temp.owner_companies(pg_temp.uid('u'))=0,
    pg_temp.call('company_u')::text);
  perform pg_temp.record_result('14_expirado_e_revogado_listados',
    exists(select 1 from jsonb_array_elements(v_rows) r where r->>'id'=t.invite_e::text and r->>'status'='expired')
    and exists(select 1 from jsonb_array_elements(v_rows) r where r->>'id'=t.invite_r::text and r->>'status'='revoked')
    and exists(select 1 from jsonb_array_elements(v_rows) r where r->>'id'=t.invite_a::text and r->>'status'='used'
      and r->>'company_id'=t.company_a::text and r->>'company_name'='Empresa Beta A' and r->>'subscription_status'='trial'
      and r->>'period_start'=current_date::text and r->>'period_end'=(current_date+14)::text),
    left(v_rows::text,600));
  perform pg_temp.record_result('15_falha_nao_consome_convite',
    pg_temp.call('company_f_trial_used')->>'error'='42501' and coalesce(pg_temp.call('company_f_trial_used')->>'hint','')=''
    and pg_temp.invite(t.invite_f)->>'status'='pending' and pg_temp.owner_companies(pg_temp.uid('f'))=0
    and pg_temp.call('company_a_blank') ? 'error' and pg_temp.call('invite_a_after_failure')->>'status'='pending',
    pg_temp.call('company_f_trial_used')::text||' / '||pg_temp.call('company_a_blank')::text);
  perform pg_temp.record_result('16_convite_valido_cria_trial_profissional',
    t.company_a is not null
    and (select count(*) from public.company_members m where m.company_id=t.company_a and m.user_id=pg_temp.uid('a') and m.role='owner' and m.status='active')=1
    and (select jsonb_build_object('status',s.status,'plan',s.plan,'amount',s.amount,'start',s.current_period_start,'end',s.current_period_end)
           from public.subscriptions s where s.company_id=t.company_a)
        = jsonb_build_object('status','trial','plan','Profissional','amount',79.90,'start',current_date,'end',current_date+14)
    and (select p.onboarding_company_created_at is not null from public.profiles p where p.id=pg_temp.uid('a')),
    (select to_jsonb(s)::text from public.subscriptions s where s.company_id=t.company_a));
  perform pg_temp.record_result('17_convite_marcado_usado',
    pg_temp.invite(t.invite_a) = jsonb_build_object('status','used','email',lower((select email from zt_bi_users where key='a')),
      'used_by',pg_temp.uid('a'),'company_id',t.company_a,'used',true),
    pg_temp.invite(t.invite_a)::text);
  perform pg_temp.record_result('18_retry_idempotente_sem_duplicar',
    pg_temp.call('company_a_retry')->>'company'=t.company_a::text
    and (select count(*) from public.companies c where c.created_at=now())=2
    and (select count(*) from public.subscriptions s join public.companies c on c.id=s.company_id where c.created_at=now())=2,
    pg_temp.call('company_a_retry')::text||' companies='||(select count(*) from public.companies c where c.created_at=now()));
  perform pg_temp.record_result('19_convite_usado_nao_reutiliza',
    pg_temp.call('company_a_reuse') @> '{"error":"42501","hint":"beta_invite_required"}',
    pg_temp.call('company_a_reuse')::text);
  perform pg_temp.record_result('20_convite_de_equipe_intacto',
    pg_temp.call('team_accept') @> '{"accepted":1}'
    and exists(select 1 from public.company_members m where m.company_id=t.company_x and m.user_id=pg_temp.uid('t') and m.role='technician' and m.status='active')
    and pg_temp.owner_companies(pg_temp.uid('t'))=0
    and (select count(*) from public.company_members m where m.user_id=pg_temp.uid('t'))=1,
    pg_temp.call('team_accept')::text);
  perform pg_temp.record_result('21_isolamento_entre_empresas',
    pg_temp.call('a_visibility') = '{"companies":1,"own":1,"x_companies":0,"x_subscriptions":0,"x_members":0}'::jsonb,
    pg_temp.call('a_visibility')::text);
  perform pg_temp.record_result('22_trial_vencido_bloqueia_sem_apagar',
    pg_temp.call('expired_write')->>'error'='42501' and pg_temp.call('expired_assistant')->>'error'='42501'
    and pg_temp.call('expired_refresh')->>'status'='suspended'
    and exists(select 1 from public.companies c where c.id=t.company_a and c.name='Empresa Beta A'),
    (select jsonb_object_agg(name,result)::text from zt_bi_calls where name like 'expired_%'));
  perform pg_temp.record_result('23_assinaturas_existentes_intactas',
    not exists(select 1 from zt_bi_subs b left join public.subscriptions s on s.id=b.id where s.id is null or md5(to_jsonb(s)::text)<>b.fingerprint),
    (select count(*)::text||' existentes' from zt_bi_subs));
end $$;

do $$
declare failures text;
begin
  select string_agg(name||': '||coalesce(detail,''),E'\n' order by name) into failures from zt_bi_results where not ok;
  if failures is not null then raise exception 'BETA_INVITES_0099_FAILED: %',failures; end if;
  if (select count(*) from zt_bi_results)<>24 then raise exception 'BETA_INVITES_0099_INCOMPLETE: % checks',(select count(*) from zt_bi_results); end if;
end $$;
select 'BETA_INVITES_0099' as test,count(*) as checks,bool_and(ok) as all_ok from zt_bi_results;
rollback;
