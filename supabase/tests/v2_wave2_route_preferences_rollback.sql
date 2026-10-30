-- ZiisTec Onda 2 (0106) — preferência de aplicativo de rota POR USUÁRIO.
-- Cada usuário lê, cria e altera somente a própria linha; proprietário não mexe na do técnico; a
-- preferência não pertence à empresa (sem company_id); anon não acessa; valor fora da lista é recusado.
-- Usa as identidades sintéticas de ci_local_seed.sql. Destino: SOMENTE CI descartável ou homologação.
-- Tudo termina em ROLLBACK.

begin;

create temp table zt_urp_results (name text primary key, ok boolean not null, detail text) on commit drop;
grant select, insert, update on zt_urp_results to authenticated, anon;

create function pg_temp.urp_check(p_name text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into zt_urp_results(name,ok,detail) values(p_name,coalesce(p_ok,false),left(p_detail,500));
$$;

-- Devolve o SQLSTATE de uma gravação negada (ou 'ok').
create function pg_temp.urp_write_state(p_user uuid, p_app text)
returns text language plpgsql as $$
begin
  insert into public.user_route_preferences(user_id,route_app) values (p_user,p_app);
  return 'ok';
exception when others then
  return sqlstate;
end $$;

-- ---------------------------------------------------------------- fixtures sintéticas do CI
do $$
begin
  if (select count(*) from public.profiles where id in (
        '10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002',
        '10000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000004'))<>4 then
    raise exception 'USER_ROUTE_FIXTURE_MISSING';
  end if;
  delete from public.user_route_preferences;
end $$;

-- ---------------------------------------------------------------- catálogo/ACL
do $$
begin
  perform pg_temp.urp_check('tabela_existe',to_regclass('public.user_route_preferences') is not null,null);
  perform pg_temp.urp_check('tabela_rls_ativa',(select c.relrowsecurity from pg_class c where c.oid='public.user_route_preferences'::regclass),null);
  perform pg_temp.urp_check('tabela_sem_company_id',not exists(select 1 from information_schema.columns
    where table_schema='public' and table_name='user_route_preferences' and column_name='company_id'),'a preferência é do usuário, não da empresa');
  perform pg_temp.urp_check('anon_sem_acesso',
    not has_table_privilege('anon','public.user_route_preferences','SELECT')
    and not has_table_privilege('anon','public.user_route_preferences','INSERT')
    and not has_table_privilege('anon','public.user_route_preferences','UPDATE')
    and not has_table_privilege('anon','public.user_route_preferences','DELETE'),null);
  perform pg_temp.urp_check('authenticated_sem_delete',
    has_table_privilege('authenticated','public.user_route_preferences','SELECT')
    and has_table_privilege('authenticated','public.user_route_preferences','INSERT')
    and has_table_privilege('authenticated','public.user_route_preferences','UPDATE')
    and not has_table_privilege('authenticated','public.user_route_preferences','DELETE'),null);
  perform pg_temp.urp_check('politicas_somente_proprias',
    (select count(*) from pg_policies where schemaname='public' and tablename='user_route_preferences')=3
    and not exists(select 1 from pg_policies where schemaname='public' and tablename='user_route_preferences'
      and (coalesce(qual,'')||coalesce(with_check,'')) !~ 'user_id'),null);
  perform pg_temp.urp_check('sem_funcao_definer_nova',not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prosecdef and p.proname ilike '%route_pref%'),null);
end $$;

-- ---------------------------------------------------------------- proprietário A salva a própria preferência
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
set local role authenticated;
do $$
declare v text; v_count integer;
begin
  v:=pg_temp.urp_write_state('10000000-0000-0000-0000-000000000001','waze');
  perform pg_temp.urp_check('owner_salva_propria',v='ok',v);
  select route_app into v from public.user_route_preferences where user_id='10000000-0000-0000-0000-000000000001';
  perform pg_temp.urp_check('owner_le_propria',v='waze',v);

  -- upsert: a mesma linha é atualizada sem duplicar
  insert into public.user_route_preferences(user_id,route_app) values ('10000000-0000-0000-0000-000000000001','google')
    on conflict (user_id) do update set route_app=excluded.route_app, updated_at=now();
  select route_app, (select count(*) from public.user_route_preferences) into v, v_count
    from public.user_route_preferences where user_id='10000000-0000-0000-0000-000000000001';
  perform pg_temp.urp_check('owner_upsert_atualiza',v='google' and v_count=1,v||'/'||v_count);

  -- valor fora da lista é recusado pelo banco
  v:=pg_temp.urp_write_state('10000000-0000-0000-0000-000000000001','bing');
  perform pg_temp.urp_check('valor_invalido_recusado',v in ('23514','23505'),v);
  update public.user_route_preferences set route_app='waze' where user_id='10000000-0000-0000-0000-000000000001';
  begin
    update public.user_route_preferences set route_app='bing' where user_id='10000000-0000-0000-0000-000000000001';
    perform pg_temp.urp_check('update_invalido_recusado',false,'aceitou bing');
  exception when check_violation then
    perform pg_temp.urp_check('update_invalido_recusado',true,null);
  end;
end $$;
reset role;

-- ---------------------------------------------------------------- técnico da mesma empresa: independente do proprietário
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
set local role authenticated;
do $$
declare v text; v_count integer;
begin
  select count(*) into v_count from public.user_route_preferences;
  perform pg_temp.urp_check('tecnico_nao_ve_preferencia_do_owner',v_count=0,v_count::text);
  v:=pg_temp.urp_write_state('10000000-0000-0000-0000-000000000003','apple');
  perform pg_temp.urp_check('tecnico_salva_propria',v='ok',v);
  select route_app into v from public.user_route_preferences where user_id='10000000-0000-0000-0000-000000000003';
  perform pg_temp.urp_check('tecnico_le_propria',v='apple',v);
  select count(*) into v_count from public.user_route_preferences;
  perform pg_temp.urp_check('tecnico_ve_somente_uma_linha',v_count=1,v_count::text);

  -- o técnico não grava em nome do proprietário
  v:=pg_temp.urp_write_state('10000000-0000-0000-0000-000000000001','google');
  perform pg_temp.urp_check('tecnico_nao_insere_para_owner',v='42501',v);
  update public.user_route_preferences set route_app='google' where user_id='10000000-0000-0000-0000-000000000001';
  get diagnostics v_count = row_count;
  perform pg_temp.urp_check('tecnico_nao_altera_owner',v_count=0,v_count::text);
end $$;
reset role;

-- ---------------------------------------------------------------- proprietário não altera nem lê a do técnico
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
set local role authenticated;
do $$
declare v text; v_count integer;
begin
  select count(*) into v_count from public.user_route_preferences where user_id='10000000-0000-0000-0000-000000000003';
  perform pg_temp.urp_check('owner_nao_le_a_do_tecnico',v_count=0,v_count::text);
  update public.user_route_preferences set route_app='google' where user_id='10000000-0000-0000-0000-000000000003';
  get diagnostics v_count = row_count;
  perform pg_temp.urp_check('owner_nao_altera_a_do_tecnico',v_count=0,v_count::text);
  -- o EXCEPTION precisa ficar em sub-bloco: se o handler do bloco externo disparasse, os checks acima seriam desfeitos
  begin
    delete from public.user_route_preferences where user_id='10000000-0000-0000-0000-000000000003';
    perform pg_temp.urp_check('owner_nao_apaga_a_do_tecnico',false,'apagou');
  exception when insufficient_privilege then
    perform pg_temp.urp_check('owner_nao_apaga_a_do_tecnico',true,null);
  end;
end $$;
do $$
declare v text;
begin
  -- não consegue reatribuir a própria linha a outro usuário (WITH CHECK)
  begin
    update public.user_route_preferences set user_id='10000000-0000-0000-0000-000000000003' where user_id='10000000-0000-0000-0000-000000000001';
    perform pg_temp.urp_check('owner_nao_reatribui_linha',false,'reatribuiu');
  exception when others then
    perform pg_temp.urp_check('owner_nao_reatribui_linha',sqlstate in ('42501','23505'),sqlstate);
  end;
  v:=pg_temp.urp_write_state('10000000-0000-0000-0000-000000000003','google');
  perform pg_temp.urp_check('owner_nao_insere_para_tecnico',v='42501',v);
end $$;
reset role;

-- ---------------------------------------------------------------- empresa B: outro proprietário, preferência própria
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
set local role authenticated;
do $$
declare v text; v_count integer;
begin
  select count(*) into v_count from public.user_route_preferences;
  perform pg_temp.urp_check('owner_b_nao_ve_empresa_a',v_count=0,v_count::text);
  v:=pg_temp.urp_write_state('10000000-0000-0000-0000-000000000002','google');
  perform pg_temp.urp_check('owner_b_salva_propria',v='ok',v);
end $$;
reset role;

-- ---------------------------------------------------------------- usuário sem empresa também só enxerga a própria
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000004',true);
set local role authenticated;
do $$
declare v_count integer;
begin
  select count(*) into v_count from public.user_route_preferences;
  perform pg_temp.urp_check('usuario_externo_nao_ve_nenhuma',v_count=0,v_count::text);
end $$;
reset role;

-- ---------------------------------------------------------------- as preferências continuam independentes (visão do dono do banco)
do $$
declare v_owner_a text; v_tech text; v_owner_b text;
begin
  select route_app into v_owner_a from public.user_route_preferences where user_id='10000000-0000-0000-0000-000000000001';
  select route_app into v_tech from public.user_route_preferences where user_id='10000000-0000-0000-0000-000000000003';
  select route_app into v_owner_b from public.user_route_preferences where user_id='10000000-0000-0000-0000-000000000002';
  perform pg_temp.urp_check('preferencias_independentes',v_owner_a='waze' and v_tech='apple' and v_owner_b='google',
    coalesce(v_owner_a,'-')||'/'||coalesce(v_tech,'-')||'/'||coalesce(v_owner_b,'-'));
  perform pg_temp.urp_check('uma_linha_por_usuario',(select count(*) from public.user_route_preferences)=3,
    (select count(*)::text from public.user_route_preferences));
end $$;

-- ---------------------------------------------------------------- anônimo não acessa
set local role anon;
do $$
declare v text;
begin
  begin
    perform 1 from public.user_route_preferences;
    perform pg_temp.urp_check('anon_nao_le',false,'leu');
  exception when insufficient_privilege then
    perform pg_temp.urp_check('anon_nao_le',true,null);
  end;
  v:=pg_temp.urp_write_state('10000000-0000-0000-0000-000000000004','google');
  perform pg_temp.urp_check('anon_nao_grava',v='42501',v);
end $$;
reset role;

do $$
declare v_failures text;
begin
  select string_agg(name||' => '||coalesce(detail,''),E'\n' order by name) into v_failures
  from zt_urp_results where not ok;
  if v_failures is not null then raise exception 'ROUTE_PREFERENCES_REGRESSION_FAILED%', E'\n'||v_failures; end if;
  if (select count(*) from zt_urp_results)<>30 then
    raise exception 'ROUTE_PREFERENCES_REGRESSION_INCOMPLETE: % checks', (select count(*) from zt_urp_results);
  end if;
end $$;

select 'WAVE2_0106_ROUTE_PREFERENCES' as test, count(*) as checks, bool_and(ok) as all_ok from zt_urp_results;

rollback;
