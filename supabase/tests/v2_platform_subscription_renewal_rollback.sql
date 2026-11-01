-- ZiisTec Beta — renovação/reativação de assinatura pelo administrador da plataforma (0098).
-- Somente admin com MFA; validações; período vencido recomeça, vigente só estende; reativação;
-- dados preservados; auditoria única por mudança; retry sem efeito; guard de escrita liberado.
-- Destino: SOMENTE CI descartável ou staging/homologação. Tudo termina em ROLLBACK.
begin;

create temp table zt_pr (
  admin_id uuid, owner_id uuid, outsider_id uuid, company_a uuid, company_b uuid, company_c uuid,
  company_a_md5 text, client_a_md5 text, members_a integer, sub_a_fixed text
) on commit drop;
create temp table zt_pr_calls (name text primary key, result jsonb) on commit drop;
create temp table zt_pr_results (name text primary key, ok boolean not null, detail text) on commit drop;
grant select, insert, update on zt_pr, zt_pr_calls, zt_pr_results to authenticated, anon;

create function pg_temp.record_result(p_name text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into zt_pr_results(name,ok,detail) values(p_name,coalesce(p_ok,false),left(p_detail,600));
$$;
-- Chama a RPC como o usuário e o nível de MFA informados; erro vira {"error": SQLSTATE}.
create function pg_temp.renew_as(p_user uuid, p_aal text, p_company uuid, p_end date, p_status text, p_reason text)
returns jsonb language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text,''), true);
  perform set_config('request.jwt.claims', json_build_object('sub',p_user,'role','authenticated','aal',p_aal)::text, true);
  return public.zt_platform_renew_subscription(p_company,p_end,p_status::public.zt_sub_status,p_reason);
exception when others then
  return jsonb_build_object('error',sqlstate);
end $$;
create function pg_temp.sub(p_company uuid) returns jsonb language sql as $$
  select jsonb_build_object('status',s.status,'start',s.current_period_start,'end',s.current_period_end,
    'canceled',s.canceled_at is not null,'plan',s.plan,'amount',s.amount,'provider',s.provider)
    from public.subscriptions s where s.company_id=p_company;
$$;
-- Campos que a renovação nunca pode tocar.
create function pg_temp.sub_fixed(p_company uuid) returns text language sql as $$
  select md5(jsonb_build_object('id',s.id,'company_id',s.company_id,'plan',s.plan,'amount',s.amount,'provider',s.provider,
    'customer',s.provider_customer_id,'subscription',s.provider_subscription_id,'created_at',s.created_at)::text)
    from public.subscriptions s where s.company_id=p_company;
$$;
create function pg_temp.renewals(p_company uuid) returns integer language sql as $$
  select count(*)::integer from public.platform_audit_logs a where a.company_id=p_company and a.action='subscription_renewed';
$$;

with candidates as (
  select u.id, row_number() over (order by u.id) as rn
  from auth.users u left join public.profiles p on p.id=u.id
  where not coalesce(p.is_platform_admin,false)
)
insert into zt_pr(admin_id,owner_id,outsider_id,company_a,company_b,company_c)
select (select id from candidates where rn=1),(select id from candidates where rn=2),(select id from candidates where rn=3),
       gen_random_uuid(),gen_random_uuid(),gen_random_uuid();

do $$
begin
  if exists(select 1 from zt_pr where admin_id is null or owner_id is null or outsider_id is null) then
    raise exception 'PLATFORM_RENEWAL_NEEDS_THREE_AUTH_USERS';
  end if;
  if not exists(select 1 from public.profiles p join zt_pr t on p.id=t.admin_id) then
    raise exception 'PLATFORM_RENEWAL_ADMIN_PROFILE_MISSING';
  end if;
end $$;

-- Administrador da plataforma só dentro desta transação.
update public.profiles set is_platform_admin=true where id=(select admin_id from zt_pr);

select set_config('request.jwt.claim.sub',(select owner_id::text from zt_pr),true);
insert into public.companies(id,name,has_team)
select company_a,'__PR_A__',false from zt_pr
union all select company_b,'__PR_B__',false from zt_pr
union all select company_c,'__PR_C__',false from zt_pr;
insert into public.subscriptions(company_id,status,current_period_start,current_period_end)
select company_a,'trial'::public.zt_sub_status,current_date,current_date+14 from zt_pr
union all select company_b,'trial'::public.zt_sub_status,current_date,current_date+14 from zt_pr
union all select company_c,'trial'::public.zt_sub_status,current_date,current_date+14 from zt_pr
on conflict (company_id) do update set status=excluded.status,
  current_period_start=excluded.current_period_start,current_period_end=excluded.current_period_end;
insert into public.company_members(company_id,user_id,role,status)
select company_a,owner_id,'owner'::public.zt_role,'active'::public.zt_member_status from zt_pr
union all select company_b,owner_id,'owner'::public.zt_role,'active'::public.zt_member_status from zt_pr
union all select company_c,owner_id,'owner'::public.zt_role,'active'::public.zt_member_status from zt_pr;
insert into public.clients(company_id,name,phone,address)
select company_a,'Cliente Beta PR','1130000301','Rua Beta, 1' from zt_pr;

-- Estados de partida: A com trial vencido, B cancelada e vencida, C com trial vigente iniciado há 5 dias.
update public.subscriptions set current_period_start=current_date-30,current_period_end=current_date-1
 where company_id=(select company_a from zt_pr);
update public.subscriptions set status='canceled',canceled_at=now(),current_period_start=current_date-60,current_period_end=current_date-30
 where company_id=(select company_b from zt_pr);
update public.subscriptions set current_period_start=current_date-5,current_period_end=current_date+9
 where company_id=(select company_c from zt_pr);
update zt_pr set
  company_a_md5=(select md5(to_jsonb(c)::text) from public.companies c where c.id=zt_pr.company_a),
  client_a_md5=(select md5(to_jsonb(c)::text) from public.clients c where c.company_id=zt_pr.company_a),
  members_a=(select count(*) from public.company_members m where m.company_id=zt_pr.company_a),
  sub_a_fixed=pg_temp.sub_fixed(zt_pr.company_a);

-- Guard de escrita do proprietário antes da renovação.
do $$
declare t zt_pr%rowtype; v jsonb;
begin
  select * into t from zt_pr;
  perform set_config('request.jwt.claim.sub',t.owner_id::text,true);
  begin
    perform zt_private.assert_operational_write_allowed(t.company_a);
    v:='{"ok":true}';
  exception when others then v:=jsonb_build_object('error',sqlstate);
  end;
  insert into zt_pr_calls values('owner_write_before',v);
end $$;

-- ------------------------------------------------------------------ chamadas recusadas
set local role authenticated;
do $$
declare t zt_pr%rowtype;
begin
  select * into t from zt_pr;
  insert into zt_pr_calls values('owner',pg_temp.renew_as(t.owner_id,'aal2',t.company_a,current_date+30,'trial','Beta: extensão'));
  insert into zt_pr_calls values('outsider',pg_temp.renew_as(t.outsider_id,'aal2',t.company_a,current_date+30,'trial','Beta: extensão'));
  insert into zt_pr_calls values('admin_aal1',pg_temp.renew_as(t.admin_id,'aal1',t.company_a,current_date+30,'trial','Beta: extensão'));
  insert into zt_pr_calls values('past',pg_temp.renew_as(t.admin_id,'aal2',t.company_a,current_date-1,'trial','Beta: extensão'));
  insert into zt_pr_calls values('too_far',pg_temp.renew_as(t.admin_id,'aal2',t.company_a,current_date+401,'trial','Beta: extensão'));
  insert into zt_pr_calls values('bad_status',pg_temp.renew_as(t.admin_id,'aal2',t.company_a,current_date+30,'suspended','Beta: extensão'));
  insert into zt_pr_calls values('no_reason',pg_temp.renew_as(t.admin_id,'aal2',t.company_a,current_date+30,'trial','  '));
  insert into zt_pr_calls values('unknown',pg_temp.renew_as(t.admin_id,'aal2',gen_random_uuid(),current_date+30,'trial','Beta: extensão'));
  insert into zt_pr_calls values('null_company',pg_temp.renew_as(t.admin_id,'aal2',null,current_date+30,'trial','Beta: extensão'));
end $$;
reset role;

set local role anon;
do $$
declare t zt_pr%rowtype; v jsonb;
begin
  select * into t from zt_pr;
  begin
    v:=public.zt_platform_renew_subscription(t.company_a,current_date+30,'trial','Beta: extensão');
  exception when others then v:=jsonb_build_object('error',sqlstate);
  end;
  insert into zt_pr_calls values('anon',v);
end $$;
reset role;

do $$
declare t zt_pr%rowtype;
begin
  select * into t from zt_pr;
  perform pg_temp.record_result('00_acl',
    (select p.prosecdef and p.proconfig @> array['search_path=""']::text[]
       and not has_function_privilege('anon',p.oid,'EXECUTE') and has_function_privilege('authenticated',p.oid,'EXECUTE')
       and not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE')
     from pg_proc p where p.oid=to_regprocedure('public.zt_platform_renew_subscription(uuid,date,public.zt_sub_status,text)')),
    (select proconfig::text from pg_proc where oid=to_regprocedure('public.zt_platform_renew_subscription(uuid,date,public.zt_sub_status,text)')));
  perform pg_temp.record_result('01_proprietario_e_outro_usuario_negados',
    (select result->>'error' from zt_pr_calls where name='owner')='42501' and (select result->>'error' from zt_pr_calls where name='outsider')='42501',
    (select jsonb_object_agg(name,result)::text from zt_pr_calls where name in ('owner','outsider')));
  perform pg_temp.record_result('02_admin_sem_mfa_negado', (select result->>'error' from zt_pr_calls where name='admin_aal1')='42501',
    (select result::text from zt_pr_calls where name='admin_aal1'));
  perform pg_temp.record_result('03_anon_negado', (select result->>'error' from zt_pr_calls where name='anon')='42501',
    (select result::text from zt_pr_calls where name='anon'));
  perform pg_temp.record_result('04_validacoes',
    (select bool_and(result->>'error'='22023') from zt_pr_calls where name in ('past','too_far','bad_status','no_reason','null_company'))
    and (select result->>'error' from zt_pr_calls where name='unknown')='P0002',
    (select jsonb_object_agg(name,result)::text from zt_pr_calls where name in ('past','too_far','bad_status','no_reason','null_company','unknown')));
  perform pg_temp.record_result('05_recusas_nao_alteram_nada',
    pg_temp.sub(t.company_a) @> jsonb_build_object('status','trial','start',current_date-30,'end',current_date-1)
    and pg_temp.renewals(t.company_a)=0
    and not exists(select 1 from public.platform_audit_logs a where a.company_id in (t.company_a,t.company_b,t.company_c)),
    pg_temp.sub(t.company_a)::text);
  perform pg_temp.record_result('06_guard_bloqueava_antes', (select result->>'error' from zt_pr_calls where name='owner_write_before')='42501',
    (select result::text from zt_pr_calls where name='owner_write_before'));
end $$;

-- ------------------------------------------------------------------ renovações do administrador
set local role authenticated;
do $$
declare t zt_pr%rowtype;
begin
  select * into t from zt_pr;
  insert into zt_pr_calls values('renew_a',pg_temp.renew_as(t.admin_id,'aal2',t.company_a,current_date+30,'trial','Beta: extensão do teste'));
  insert into zt_pr_calls values('renew_a_retry',pg_temp.renew_as(t.admin_id,'aal2',t.company_a,current_date+30,'trial','Beta: extensão do teste'));
  insert into zt_pr_calls values('reactivate_b',pg_temp.renew_as(t.admin_id,'aal2',t.company_b,current_date+365,'active','Beta pago: reativação'));
  insert into zt_pr_calls values('extend_c',pg_temp.renew_as(t.admin_id,'aal2',t.company_c,current_date+40,'active','Beta pago: primeira mensalidade'));
end $$;
reset role;

do $$
declare t zt_pr%rowtype; v jsonb;
begin
  select * into t from zt_pr;
  perform set_config('request.jwt.claim.sub',t.owner_id::text,true);
  begin
    perform zt_private.assert_operational_write_allowed(t.company_a);
    v:='{"ok":true}';
  exception when others then v:=jsonb_build_object('error',sqlstate);
  end;
  insert into zt_pr_calls values('owner_write_after',v);
end $$;

do $$
declare t zt_pr%rowtype; a public.platform_audit_logs%rowtype;
begin
  select * into t from zt_pr;
  select * into a from public.platform_audit_logs x where x.company_id=t.company_a and x.action='subscription_renewed';
  perform pg_temp.record_result('07_renova_trial_vencido_preservando_dados',
    (select result from zt_pr_calls where name='renew_a') @> jsonb_build_object('changed',true,'status','trial')
    and pg_temp.sub(t.company_a) @> jsonb_build_object('status','trial','start',current_date,'end',current_date+30,'canceled',false)
    and pg_temp.sub_fixed(t.company_a)=t.sub_a_fixed
    and (select md5(to_jsonb(c)::text) from public.companies c where c.id=t.company_a)=t.company_a_md5
    and (select md5(to_jsonb(c)::text) from public.clients c where c.company_id=t.company_a)=t.client_a_md5
    and (select count(*) from public.company_members m where m.company_id=t.company_a)=t.members_a,
    pg_temp.sub(t.company_a)::text);
  perform pg_temp.record_result('08_auditoria_unica_e_retry_sem_efeito',
    (select result from zt_pr_calls where name='renew_a_retry') @> jsonb_build_object('changed',false,'status','trial')
    and pg_temp.renewals(t.company_a)=1 and a.actor_id=t.admin_id
    and a.before_data @> jsonb_build_object('status','trial','current_period_end',current_date-1)
    and a.after_data @> jsonb_build_object('status','trial','current_period_end',current_date+30,'reason','Beta: extensão do teste'),
    coalesce(to_jsonb(a)::text,'sem auditoria'));
  perform pg_temp.record_result('09_proprietario_volta_a_operar', (select result from zt_pr_calls where name='owner_write_after')=jsonb_build_object('ok',true),
    (select result::text from zt_pr_calls where name='owner_write_after'));
  perform pg_temp.record_result('10_reativa_cancelada',
    (select result from zt_pr_calls where name='reactivate_b') @> jsonb_build_object('changed',true,'status','active')
    and pg_temp.sub(t.company_b) @> jsonb_build_object('status','active','start',current_date,'end',current_date+365,'canceled',false)
    and pg_temp.renewals(t.company_b)=1,
    pg_temp.sub(t.company_b)::text);
  perform pg_temp.record_result('11_periodo_vigente_estende_sem_mudar_inicio',
    pg_temp.sub(t.company_c) @> jsonb_build_object('status','active','start',current_date-5,'end',current_date+40,'canceled',false)
    and pg_temp.renewals(t.company_c)=1,
    pg_temp.sub(t.company_c)::text);
end $$;

do $$
declare failures text;
begin
  select string_agg(name||': '||coalesce(detail,''),E'\n' order by name) into failures from zt_pr_results where not ok;
  if failures is not null then raise exception 'PLATFORM_RENEWAL_0098_FAILED: %',failures; end if;
  if (select count(*) from zt_pr_results)<>12 then raise exception 'PLATFORM_RENEWAL_0098_INCOMPLETE: % checks',(select count(*) from zt_pr_results); end if;
end $$;
select 'PLATFORM_RENEWAL_0098' as test,count(*) as checks,bool_and(ok) as all_ok from zt_pr_results;
rollback;
