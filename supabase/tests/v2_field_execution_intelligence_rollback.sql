-- ZiisTec Field Execution Intelligence V1 (0111) — Base Técnica, confirmação do atendimento e relatório com IA.
-- Técnico preenche a Base Técnica da própria OS; outro técnico, outra empresa, anon e escrita direta ficam negados;
-- dono lê a da própria empresa; o retry do mesmo envio não duplica e o mesmo identificador com outro conteúdo é recusado;
-- needs_return continua sendo o campo existente; os fatos do relatório vêm do banco SEM custo, preço, margem, dificuldade,
-- observação interna ou dados do cliente; no máximo 3 gerações por OS (contagem no banco, com tentativas em andamento,
-- repetição do pedido e expiração); a confirmação exige nome OU responsável ausente.
-- Nenhum provedor de IA é chamado aqui. Usa as identidades de ci_local_seed.sql.
-- Destino: SOMENTE CI descartável ou homologação. Tudo termina em ROLLBACK.

begin;

create temp table zt_fei_results (name text primary key, ok boolean not null, detail text) on commit drop;
create temp table zt_fei_obs (name text primary key, val jsonb) on commit drop;
grant select, insert, update on zt_fei_results, zt_fei_obs to authenticated, anon;

create function pg_temp.fei_check(p_name text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into zt_fei_results(name,ok,detail) values(p_name,coalesce(p_ok,false),left(p_detail,500));
$$;

-- Executa no papel atual; devolve 'ok' ou o SQLSTATE.
create function pg_temp.fei_state(p_sql text)
returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate;
end $$;

-- Linhas visíveis no papel atual; erro vira -1.
create function pg_temp.fei_count(p_sql text)
returns bigint language plpgsql as $$
declare n bigint;
begin
  execute 'select count(*) from ('||p_sql||') q' into n;
  return n;
exception when others then
  return -1;
end $$;

-- Mensagem do erro de uma chamada (para comparar OS inexistente com OS de outra empresa).
create function pg_temp.fei_message(p_sql text)
returns text language plpgsql as $$
begin
  execute p_sql;
  return 'sem erro';
exception when others then
  return sqlstate || ':' || sqlerrm;
end $$;

create function pg_temp.fei_obs(p_name text, p_val jsonb)
returns void language sql as $$
  insert into zt_fei_obs(name,val) values(p_name,p_val) on conflict (name) do update set val=excluded.val;
$$;

create function pg_temp.fei_val(p_name text)
returns jsonb language sql as $$
  select val from zt_fei_obs where name=p_name;
$$;

-- Troca a identidade da sessão (volta a postgres antes).
create function pg_temp.fei_as(p_uid uuid)
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claim.sub',p_uid::text,true);
  perform set_config('request.jwt.claims',json_build_object('sub',p_uid,'role','authenticated','aal','aal1')::text,true);
  set local role authenticated;
end $$;

create function pg_temp.fei_anon()
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims','',true);
  set local role anon;
end $$;

-- Resultado da RPC como jsonb ou {"error":"<sqlstate>"} (nunca interrompe o teste).
create function pg_temp.fei_try(p_sql text)
returns jsonb language plpgsql as $$
declare r jsonb;
begin
  execute 'select to_jsonb(q) from ('||p_sql||') q' into r;
  return r;
exception when others then
  return jsonb_build_object('error',sqlstate,'message',sqlerrm);
end $$;

do $$
begin
  if (select count(*) from public.company_members where status='active'
        and (company_id,user_id,role) in (
          ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','owner'),
          ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000003','technician'),
          ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','owner')))<>3 then
    raise exception 'FIELD_EXEC_FIXTURE_MISSING';
  end if;
end $$;

-- ---------------------------------------------------------------- catálogo e ACL
do $$
declare v_sig text; v_fn oid; v_bad text;
begin
  foreach v_sig in array array[
    'public.zt_save_work_order_technical_base(uuid,text,text,text,text,uuid)',
    'public.zt_save_attendance_confirmation(uuid,text,boolean,uuid)',
    'public.zt_work_order_report_facts(uuid,jsonb)',
    'public.zt_claim_work_order_ai_report(uuid,uuid)',
    'public.zt_complete_work_order_ai_report(uuid,uuid,text)',
    'public.zt_mark_work_order_ai_report_used(uuid,uuid,text)',
    'public.zt_work_order_ai_report_usage(uuid)'] loop
    v_fn := to_regprocedure(v_sig);
    perform pg_temp.fei_check('funcao_'||split_part(split_part(v_sig,'.',2),'(',1)||'_definer_search_path_vazio',
      v_fn is not null and (select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid=v_fn), v_sig);
    perform pg_temp.fei_check('funcao_'||split_part(split_part(v_sig,'.',2),'(',1)||'_so_authenticated',
      has_function_privilege('authenticated',v_fn,'EXECUTE') and not has_function_privilege('anon',v_fn,'EXECUTE')
      and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f',p.proowner))) a where p.oid=v_fn and a.grantee=0), v_sig);
  end loop;

  perform pg_temp.fei_check('tabelas_com_rls',
    (select bool_and(relrowsecurity) from pg_class where oid in (
      'public.work_order_technical_base'::regclass,'public.work_order_attendance_confirmations'::regclass,'public.work_order_ai_reports'::regclass)), null);
  perform pg_temp.fei_check('base_e_confirmacao_so_select_para_navegador',
    has_table_privilege('authenticated','public.work_order_technical_base','SELECT')
    and not has_table_privilege('authenticated','public.work_order_technical_base','INSERT')
    and not has_table_privilege('authenticated','public.work_order_technical_base','UPDATE')
    and not has_table_privilege('authenticated','public.work_order_technical_base','DELETE')
    and has_table_privilege('authenticated','public.work_order_attendance_confirmations','SELECT')
    and not has_table_privilege('authenticated','public.work_order_attendance_confirmations','INSERT')
    and not has_table_privilege('authenticated','public.work_order_attendance_confirmations','UPDATE')
    and not has_table_privilege('authenticated','public.work_order_attendance_confirmations','DELETE')
    and not has_table_privilege('anon','public.work_order_technical_base','SELECT')
    and not has_table_privilege('anon','public.work_order_attendance_confirmations','SELECT'), null);
  perform pg_temp.fei_check('registro_de_geracoes_sem_policy_e_sem_privilegio',
    not exists (select 1 from pg_policies where schemaname='public' and tablename='work_order_ai_reports')
    and not has_table_privilege('authenticated','public.work_order_ai_reports','SELECT')
    and not has_table_privilege('authenticated','public.work_order_ai_reports','INSERT')
    and not has_table_privilege('authenticated','public.work_order_ai_reports','UPDATE')
    and not has_table_privilege('authenticated','public.work_order_ai_reports','DELETE')
    and not has_table_privilege('anon','public.work_order_ai_reports','SELECT'), null);
  perform pg_temp.fei_check('fk_composta_por_empresa_nas_tres_tabelas',
    (select count(*) from pg_constraint where contype='f' and confrelid='public.work_orders'::regclass
       and conrelid in ('public.work_order_technical_base'::regclass,'public.work_order_attendance_confirmations'::regclass,'public.work_order_ai_reports'::regclass)
       and array_length(conkey,1)=2)=3, null);
  perform pg_temp.fei_check('guarda_de_assinatura_nas_tabelas_de_escrita',
    (select count(*) from pg_trigger where tgname='trg_subscription_write_guard' and not tgisinternal
       and tgrelid in ('public.work_order_technical_base'::regclass,'public.work_order_attendance_confirmations'::regclass))=2, null);
  perform pg_temp.fei_check('work_orders_nao_ganhou_coluna',
    not exists (select 1 from information_schema.columns where table_schema='public' and table_name='work_orders'
      and column_name ~* 'cause|solution|difficulty|learning|received|ai_report'), null);
  -- Dificuldade e aprendizado não podem existir em nenhuma coluna legível pelo técnico em tabela de documento do cliente.
  select string_agg(table_name||'.'||column_name,',') into v_bad from information_schema.columns
   where table_schema='public' and column_name in ('difficulty','learning','technical_learning')
     and table_name not in ('work_order_technical_base');
  perform pg_temp.fei_check('dificuldade_e_aprendizado_so_na_base_tecnica', v_bad is null, v_bad);
end $$;

-- ---------------------------------------------------------------- fixtures (empresa A: dono + técnico A + técnico 2; empresa B: dono)
insert into public.company_members(company_id,user_id,role,status,job_title)
values ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000004','technician','active','CI Technician 2')
on conflict (company_id,user_id) do update set role='technician',status='active';

set local session_replication_role = replica;
insert into public.clients(id,company_id,name,address) values
  ('f1000000-0000-4000-8000-000000000001','20000000-0000-0000-0000-000000000001','__FEI_CLIENTE_A__','Rua Privada A, 100'),
  ('f2000000-0000-4000-8000-000000000001','20000000-0000-0000-0000-000000000002','__FEI_CLIENTE_B__','Rua Privada B, 200');
insert into public.work_orders(id,company_id,number,client_id,assigned_to,status,request,address) values
  ('f1000000-0000-4000-8000-0000000000a1','20000000-0000-0000-0000-000000000001','FEI-A1','f1000000-0000-4000-8000-000000000001','10000000-0000-0000-0000-000000000003','in_progress','Instalar ar-condicionado split 12000 BTU','Rua Privada A, 100'),
  ('f1000000-0000-4000-8000-0000000000a2','20000000-0000-0000-0000-000000000001','FEI-A2','f1000000-0000-4000-8000-000000000001','10000000-0000-0000-0000-000000000004','in_progress','OS do outro técnico','Rua Privada A, 100'),
  ('f1000000-0000-4000-8000-0000000000a3','20000000-0000-0000-0000-000000000001','FEI-A3','f1000000-0000-4000-8000-000000000001','10000000-0000-0000-0000-000000000003','in_progress','OS sem Base Técnica','Rua Privada A, 100'),
  ('f1000000-0000-4000-8000-0000000000a4','20000000-0000-0000-0000-000000000001','FEI-A4','f1000000-0000-4000-8000-000000000001','10000000-0000-0000-0000-000000000003','done','OS encerrada','Rua Privada A, 100'),
  ('f1000000-0000-4000-8000-0000000000a5','20000000-0000-0000-0000-000000000001','FEI-A5','f1000000-0000-4000-8000-000000000001','10000000-0000-0000-0000-000000000003','in_progress','OS do limite de IA','Rua Privada A, 100'),
  ('f1000000-0000-4000-8000-0000000000a6','20000000-0000-0000-0000-000000000001','FEI-A6','f1000000-0000-4000-8000-000000000001','10000000-0000-0000-0000-000000000003','in_progress','OS das gerações simultâneas','Rua Privada A, 100'),
  ('f1000000-0000-4000-8000-0000000000a7','20000000-0000-0000-0000-000000000001','FEI-A7','f1000000-0000-4000-8000-000000000001','10000000-0000-0000-0000-000000000003','in_progress','OS da expiração','Rua Privada A, 100'),
  ('f2000000-0000-4000-8000-0000000000b1','20000000-0000-0000-0000-000000000002','FEI-B1','f2000000-0000-4000-8000-000000000001','10000000-0000-0000-0000-000000000002','in_progress','OS da empresa B','Rua Privada B, 200');
insert into public.products(id,company_id,name,cost,price) values
  ('f1000000-0000-4000-8000-0000000000d1','20000000-0000-0000-0000-000000000001','Gás R410A',31.40,77.00),
  ('f2000000-0000-4000-8000-0000000000d1','20000000-0000-0000-0000-000000000002','Produto privado da empresa B',1,2);
insert into public.work_order_items(work_order_id,company_id,kind,name,unit,quantity,unit_price,unit_cost) values
  ('f1000000-0000-4000-8000-0000000000a1','20000000-0000-0000-0000-000000000001','service','Instalação de split','unidade',1,900,111),
  ('f1000000-0000-4000-8000-0000000000a1','20000000-0000-0000-0000-000000000001','product','Cabo PP 3 metros','unidade',2,90,40);
insert into public.work_order_materials(work_order_id,company_id,name,quantity,unit_cost) values
  ('f1000000-0000-4000-8000-0000000000a1','20000000-0000-0000-0000-000000000001','Fita isolante',1,5);
insert into public.attachments(company_id,bucket,path,file_name,work_order_id,category) values
  ('20000000-0000-0000-0000-000000000001','zt-work-orders','20000000-0000-0000-0000-000000000001/fei-1.jpg','fei-1.jpg','f1000000-0000-4000-8000-0000000000a1','antes'),
  ('20000000-0000-0000-0000-000000000001','zt-work-orders','20000000-0000-0000-0000-000000000001/fei-2.jpg','fei-2.jpg','f1000000-0000-4000-8000-0000000000a1','depois');
set local session_replication_role = origin;

-- ---------------------------------------------------------------- Base Técnica: técnico A na própria OS
select pg_temp.fei_as('10000000-0000-0000-0000-000000000003');
do $$
declare r jsonb; r2 jsonb; r3 jsonb; v_rows bigint;
begin
  r := pg_temp.fei_try($q$select public.zt_save_work_order_technical_base('f1000000-0000-4000-8000-0000000000a1','Capacitor queimado','Troca do capacitor de partida','medium','APRENDIZADO_INTERNO_XYZ','f1100000-0000-4000-8000-000000000001') as r$q$) -> 'r';
  perform pg_temp.fei_check('tecnico_preenche_base_da_propria_os',
    r->>'cause'='Capacitor queimado' and r->>'solution'='Troca do capacitor de partida' and r->>'difficulty'='medium'
    and (r->>'revision')::int=1, r::text);
  perform pg_temp.fei_obs('base_first',r);

  r2 := pg_temp.fei_try($q$select public.zt_save_work_order_technical_base('f1000000-0000-4000-8000-0000000000a1','Capacitor queimado','Troca do capacitor de partida','medium','APRENDIZADO_INTERNO_XYZ','f1100000-0000-4000-8000-000000000001') as r$q$) -> 'r';
  r3 := pg_temp.fei_try($q$select public.zt_save_work_order_technical_base('f1000000-0000-4000-8000-0000000000a1','  Capacitor queimado ','Troca do capacitor de partida','MEDIUM','APRENDIZADO_INTERNO_XYZ','f1100000-0000-4000-8000-000000000001') as r$q$) -> 'r';
  reset role;
  select count(*) into v_rows from public.work_order_technical_base where work_order_id='f1000000-0000-4000-8000-0000000000a1';
  perform pg_temp.fei_check('retry_do_mesmo_envio_nao_duplica_linha_nem_revisao',
    r2->>'id'=r->>'id' and (r2->>'revision')::int=1 and r3->>'id'=r->>'id' and (r3->>'revision')::int=1 and v_rows=1,
    'linhas='||v_rows||' rev='||(r2->>'revision'));
  perform pg_temp.fei_as('10000000-0000-0000-0000-000000000003');

  perform pg_temp.fei_check('mesmo_identificador_com_outro_conteudo_e_recusado',
    pg_temp.fei_try($q$select public.zt_save_work_order_technical_base('f1000000-0000-4000-8000-0000000000a1','Outra causa','Troca do capacitor de partida','medium','APRENDIZADO_INTERNO_XYZ','f1100000-0000-4000-8000-000000000001') as r$q$)->>'error'='23505', null);

  r2 := pg_temp.fei_try($q$select public.zt_save_work_order_technical_base('f1000000-0000-4000-8000-0000000000a1','Capacitor queimado','Troca do capacitor de partida e limpeza','hard','APRENDIZADO_INTERNO_XYZ','f1100000-0000-4000-8000-000000000002') as r$q$) -> 'r';
  reset role;
  select count(*) into v_rows from public.work_order_technical_base where work_order_id='f1000000-0000-4000-8000-0000000000a1';
  perform pg_temp.fei_check('nova_edicao_incrementa_revisao_na_mesma_linha',
    r2->>'id'=r->>'id' and (r2->>'revision')::int=2 and r2->>'difficulty'='hard' and v_rows=1, r2::text);
  perform pg_temp.fei_as('10000000-0000-0000-0000-000000000003');

  perform pg_temp.fei_check('dificuldade_invalida_recusada',
    pg_temp.fei_try($q$select public.zt_save_work_order_technical_base('f1000000-0000-4000-8000-0000000000a1','c','s','impossivel','l','f1100000-0000-4000-8000-000000000003') as r$q$)->>'error'='22023', null);
  perform pg_temp.fei_check('campo_acima_de_3000_caracteres_recusado',
    pg_temp.fei_try(format($q$select public.zt_save_work_order_technical_base('f1000000-0000-4000-8000-0000000000a1',%L,'s','easy','l','f1100000-0000-4000-8000-000000000004') as r$q$, repeat('x',3001)))->>'error'='22023', null);
  perform pg_temp.fei_check('identificador_obrigatorio',
    pg_temp.fei_try($q$select public.zt_save_work_order_technical_base('f1000000-0000-4000-8000-0000000000a1','c','s','easy','l',null) as r$q$)->>'error'='22023', null);

  r := pg_temp.fei_try($q$select public.zt_save_work_order_technical_base('f1000000-0000-4000-8000-0000000000a3','  ','','','  ','f1100000-0000-4000-8000-000000000005') as r$q$);
  reset role;
  select count(*) into v_rows from public.work_order_technical_base where work_order_id='f1000000-0000-4000-8000-0000000000a3';
  perform pg_temp.fei_check('envio_totalmente_vazio_nao_cria_linha', (r->'r') = 'null'::jsonb and r->>'error' is null and v_rows=0, r::text);
  perform pg_temp.fei_as('10000000-0000-0000-0000-000000000003');

  r := pg_temp.fei_try($q$select public.zt_save_work_order_technical_base('f1000000-0000-4000-8000-0000000000a3','','Somente a solução','','','f1100000-0000-4000-8000-000000000006') as r$q$) -> 'r';
  perform pg_temp.fei_check('causa_vazia_continua_vazia_na_base', r->>'cause' is null and r->>'solution'='Somente a solução', r::text);
end $$;

-- Outro técnico, outra empresa e escrita direta.
do $$
declare v_msg_foreign text; v_msg_unknown text;
begin
  perform pg_temp.fei_check('tecnico_nao_grava_base_de_os_de_outro_tecnico',
    pg_temp.fei_try($q$select public.zt_save_work_order_technical_base('f1000000-0000-4000-8000-0000000000a2','c','s','easy','l','f1100000-0000-4000-8000-000000000007') as r$q$)->>'error'='42501', null);
  perform pg_temp.fei_check('tecnico_nao_grava_base_de_os_de_outra_empresa',
    pg_temp.fei_try($q$select public.zt_save_work_order_technical_base('f2000000-0000-4000-8000-0000000000b1','c','s','easy','l','f1100000-0000-4000-8000-000000000008') as r$q$)->>'error'='42501', null);
  perform pg_temp.fei_check('tecnico_nao_grava_base_de_os_encerrada',
    pg_temp.fei_try($q$select public.zt_save_work_order_technical_base('f1000000-0000-4000-8000-0000000000a4','c','s','easy','l','f1100000-0000-4000-8000-000000000009') as r$q$)->>'error'='42501', null);
  v_msg_foreign := pg_temp.fei_message($q$select public.zt_save_work_order_technical_base('f2000000-0000-4000-8000-0000000000b1','c','s','easy','l','f1100000-0000-4000-8000-00000000000a')$q$);
  v_msg_unknown := pg_temp.fei_message($q$select public.zt_save_work_order_technical_base('f9999999-0000-4000-8000-0000000000ff','c','s','easy','l','f1100000-0000-4000-8000-00000000000a')$q$);
  perform pg_temp.fei_check('os_inexistente_e_de_outra_empresa_dao_o_mesmo_erro', v_msg_foreign = v_msg_unknown and v_msg_foreign like '42501:%', v_msg_foreign||' / '||v_msg_unknown);

  perform pg_temp.fei_check('tecnico_nao_insere_direto_na_base',
    pg_temp.fei_state($q$insert into public.work_order_technical_base(company_id,work_order_id,cause) values ('20000000-0000-0000-0000-000000000001','f1000000-0000-4000-8000-0000000000a1','x')$q$)='42501', null);
  perform pg_temp.fei_check('tecnico_nao_atualiza_direto_a_base',
    pg_temp.fei_state($q$update public.work_order_technical_base set cause='alterada'$q$)='42501', null);
  perform pg_temp.fei_check('tecnico_nao_apaga_direto_a_base',
    pg_temp.fei_state($q$delete from public.work_order_technical_base$q$)='42501', null);
  perform pg_temp.fei_check('tecnico_ve_so_a_base_da_propria_os',
    pg_temp.fei_count($q$select 1 from public.work_order_technical_base$q$)=2
    and pg_temp.fei_count($q$select 1 from public.work_order_technical_base where work_order_id='f1000000-0000-4000-8000-0000000000a1'$q$)=1, null);
end $$;

-- ---------------------------------------------------------------- técnico 2 e dono da empresa A
select pg_temp.fei_as('10000000-0000-0000-0000-000000000004');
do $$
declare r jsonb;
begin
  r := pg_temp.fei_try($q$select public.zt_save_work_order_technical_base('f1000000-0000-4000-8000-0000000000a2','Causa do técnico 2','Solução do técnico 2','easy','Aprendizado 2','f1200000-0000-4000-8000-000000000001') as r$q$);
  perform pg_temp.fei_check('outro_tecnico_preenche_a_base_da_sua_os', (r->'r'->>'cause')='Causa do técnico 2', r::text);
  perform pg_temp.fei_check('outro_tecnico_nao_ve_base_do_primeiro',
    pg_temp.fei_count($q$select 1 from public.work_order_technical_base$q$)=1
    and pg_temp.fei_count($q$select 1 from public.work_order_technical_base where work_order_id='f1000000-0000-4000-8000-0000000000a1'$q$)=0, null);
  perform pg_temp.fei_check('outro_tecnico_nao_grava_na_os_do_primeiro',
    pg_temp.fei_try($q$select public.zt_save_work_order_technical_base('f1000000-0000-4000-8000-0000000000a1','x','y','easy','z','f1200000-0000-4000-8000-000000000002') as r$q$)->>'error'='42501', null);
end $$;

select pg_temp.fei_as('10000000-0000-0000-0000-000000000001');
do $$
declare r jsonb;
begin
  perform pg_temp.fei_check('dono_ve_a_base_de_todas_as_os_da_propria_empresa',
    pg_temp.fei_count($q$select 1 from public.work_order_technical_base$q$)=3, null);
  r := pg_temp.fei_try($q$select public.zt_save_work_order_technical_base('f1000000-0000-4000-8000-0000000000a2','Causa revisada pelo dono','Solução do técnico 2','easy','Aprendizado 2','f1300000-0000-4000-8000-000000000001') as r$q$);
  perform pg_temp.fei_check('dono_ajusta_a_base_da_propria_empresa', (r->'r'->>'cause')='Causa revisada pelo dono' and (r->'r'->>'revision')::int=2, r::text);
  perform pg_temp.fei_check('dono_nao_grava_base_de_outra_empresa',
    pg_temp.fei_try($q$select public.zt_save_work_order_technical_base('f2000000-0000-4000-8000-0000000000b1','c','s','easy','l','f1300000-0000-4000-8000-000000000002') as r$q$)->>'error'='42501', null);
end $$;

-- ---------------------------------------------------------------- empresa B: isolada nos dois sentidos
select pg_temp.fei_as('10000000-0000-0000-0000-000000000002');
do $$
declare r jsonb;
begin
  r := pg_temp.fei_try($q$select public.zt_save_work_order_technical_base('f2000000-0000-4000-8000-0000000000b1','Causa B','Solução B','easy','Aprendizado B','f1400000-0000-4000-8000-000000000001') as r$q$);
  perform pg_temp.fei_check('dono_b_grava_a_base_da_propria_os', (r->'r'->>'cause')='Causa B', r::text);
  perform pg_temp.fei_check('empresa_b_nao_ve_base_da_empresa_a',
    pg_temp.fei_count($q$select 1 from public.work_order_technical_base$q$)=1
    and pg_temp.fei_count($q$select 1 from public.work_order_technical_base where company_id='20000000-0000-0000-0000-000000000001'$q$)=0, null);
  perform pg_temp.fei_check('dono_b_nao_grava_na_os_da_empresa_a',
    pg_temp.fei_try($q$select public.zt_save_work_order_technical_base('f1000000-0000-4000-8000-0000000000a1','x','y','easy','z','f1400000-0000-4000-8000-000000000002') as r$q$)->>'error'='42501', null);
end $$;
select pg_temp.fei_as('10000000-0000-0000-0000-000000000001');
do $$
begin
  perform pg_temp.fei_check('empresa_a_nao_ve_base_da_empresa_b',
    pg_temp.fei_count($q$select 1 from public.work_order_technical_base where company_id='20000000-0000-0000-0000-000000000002'$q$)=0, null);
end $$;

select pg_temp.fei_anon();
do $$
begin
  perform pg_temp.fei_check('anon_nao_le_a_base', pg_temp.fei_state($q$select * from public.work_order_technical_base$q$)='42501', null);
  perform pg_temp.fei_check('anon_nao_chama_a_gravacao',
    pg_temp.fei_state($q$select public.zt_save_work_order_technical_base('f1000000-0000-4000-8000-0000000000a1','c','s','easy','l','f1500000-0000-4000-8000-000000000001')$q$)='42501', null);
end $$;
reset role;

-- ---------------------------------------------------------------- needs_return continua sendo o campo existente
select pg_temp.fei_as('10000000-0000-0000-0000-000000000003');
do $$
declare v_before boolean; v_after boolean; v_status text; v_rows bigint;
begin
  reset role;
  select needs_return into v_before from public.work_orders where id='f1000000-0000-4000-8000-0000000000a1';
  perform pg_temp.fei_as('10000000-0000-0000-0000-000000000003');
  perform public.zt_mark_work_order_needs_return('f1000000-0000-4000-8000-0000000000a1','Falta a válvula de serviço',null,null,'normal',null,'f1600000-0000-4000-8000-000000000001');
  reset role;
  select needs_return, status::text into v_after, v_status from public.work_orders where id='f1000000-0000-4000-8000-0000000000a1';
  select count(*) into v_rows from public.work_order_returns where work_order_id='f1000000-0000-4000-8000-0000000000a1';
  perform pg_temp.fei_check('retorno_usa_o_campo_e_a_rpc_existentes', coalesce(v_before,false)=false and v_after and v_status='in_progress' and v_rows=1,
    format('antes=%s depois=%s status=%s retornos=%s',v_before,v_after,v_status,v_rows));
  perform pg_temp.fei_as('10000000-0000-0000-0000-000000000003');
  perform public.zt_save_work_order_technical_base('f1000000-0000-4000-8000-0000000000a1','Capacitor queimado','Troca do capacitor de partida e limpeza','hard','APRENDIZADO_INTERNO_XYZ','f1100000-0000-4000-8000-000000000002');
  reset role;
  perform pg_temp.fei_check('salvar_a_base_nao_altera_retorno_nem_status',
    (select needs_return and status='in_progress' from public.work_orders where id='f1000000-0000-4000-8000-0000000000a1')
    and (select count(*) from public.work_order_returns where work_order_id='f1000000-0000-4000-8000-0000000000a1')=1, null);
  perform pg_temp.fei_as('10000000-0000-0000-0000-000000000003');
end $$;

-- ---------------------------------------------------------------- fatos do relatório (o que a IA pode receber)
do $$
declare f jsonb; v_keys text; v_materials jsonb; v_names text;
begin
  f := pg_temp.fei_try($q$select public.zt_work_order_report_facts('f1000000-0000-4000-8000-0000000000a1','[]'::jsonb) as r$q$) -> 'r';
  select string_agg(k,',' order by k) into v_keys from jsonb_object_keys(f) k;
  perform pg_temp.fei_check('fatos_so_com_as_chaves_permitidas',
    v_keys='cause,evidenceCount,materials,returnNeeded,returnReason,scheduledDate,serviceRequested,services,solution,workOrderNumber', v_keys);
  perform pg_temp.fei_check('fatos_trazem_o_confirmado_na_os',
    f->>'workOrderNumber'='FEI-A1' and f->>'serviceRequested'='Instalar ar-condicionado split 12000 BTU'
    and f->>'cause'='Capacitor queimado' and f->>'solution'='Troca do capacitor de partida e limpeza'
    and (f->'services') = '["Instalação de split"]'::jsonb
    and (f->>'returnNeeded')::boolean and f->>'returnReason'='Falta a válvula de serviço'
    and (f->>'evidenceCount')::int=2, f::text);
  select string_agg(m->>'name',',' order by m->>'name') into v_names from jsonb_array_elements(f->'materials') m;
  perform pg_temp.fei_check('fatos_trazem_materiais_da_os_sem_inventar', v_names='Cabo PP 3 metros,Fita isolante', v_names);
  perform pg_temp.fei_check('fatos_sem_custo_preco_margem_dificuldade_aprendizado_ou_cliente',
    f::text !~* 'price|cost|margin|margem|custo|preco|preço|difficulty|dificuldade|learning|APRENDIZADO_INTERNO_XYZ|__FEI_CLIENTE_A__|Rua Privada|900|111'
    and not exists (select 1 from jsonb_array_elements(f->'materials') m where (select count(*) from jsonb_object_keys(m))<>2), f::text);

  -- Materiais extras vindos do app: só produto da própria empresa, nome do catálogo, quantidade positiva.
  f := pg_temp.fei_try($q$select public.zt_work_order_report_facts('f1000000-0000-4000-8000-0000000000a1',
    '[{"productId":"f1000000-0000-4000-8000-0000000000d1","quantity":1.5},{"productId":"f2000000-0000-4000-8000-0000000000d1","quantity":2},{"productId":"f9999999-0000-4000-8000-0000000000d1","quantity":1},{"productId":"f1000000-0000-4000-8000-0000000000d1","quantity":0}]'::jsonb) as r$q$) -> 'r';
  select string_agg((m->>'name')||'='||(m->>'quantity'),',' order by m->>'name') into v_names from jsonb_array_elements(f->'materials') m;
  perform pg_temp.fei_check('material_extra_so_do_catalogo_da_propria_empresa',
    v_names like '%Gás R410A=1.5%' and v_names not like '%privado%' and v_names not like '%=0%', v_names);
  perform pg_temp.fei_check('material_extra_nunca_leva_preco_nem_custo_do_catalogo', f::text !~* '31\.4|77|cost|price', f::text);
  perform pg_temp.fei_check('material_com_id_invalido_recusado',
    pg_temp.fei_try($q$select public.zt_work_order_report_facts('f1000000-0000-4000-8000-0000000000a1','[{"productId":"nao-e-uuid","quantity":1}]'::jsonb) as r$q$)->>'error'='22023', null);
  perform pg_temp.fei_check('material_que_nao_e_lista_recusado',
    pg_temp.fei_try($q$select public.zt_work_order_report_facts('f1000000-0000-4000-8000-0000000000a1','{"a":1}'::jsonb) as r$q$)->>'error'='22023', null);
  perform pg_temp.fei_check('lista_de_materiais_grande_demais_recusada',
    pg_temp.fei_try($q$select public.zt_work_order_report_facts('f1000000-0000-4000-8000-0000000000a1',(select jsonb_agg(jsonb_build_object('productId','f1000000-0000-4000-8000-0000000000d1','quantity',1)) from generate_series(1,31))) as r$q$)->>'error'='22023', null);

  -- OS sem causa informada: a chave existe e vem nula (o texto final omite a causa).
  f := pg_temp.fei_try($q$select public.zt_work_order_report_facts('f1000000-0000-4000-8000-0000000000a3','[]'::jsonb) as r$q$) -> 'r';
  perform pg_temp.fei_check('causa_vazia_chega_nula_aos_fatos', f ? 'cause' and f->'cause' = 'null'::jsonb and f->>'solution'='Somente a solução', f::text);

  perform pg_temp.fei_check('tecnico_nao_pede_fatos_de_os_de_outro_tecnico',
    pg_temp.fei_try($q$select public.zt_work_order_report_facts('f1000000-0000-4000-8000-0000000000a2','[]'::jsonb) as r$q$)->>'error'='42501', null);
  perform pg_temp.fei_check('tecnico_nao_pede_fatos_de_outra_empresa',
    pg_temp.fei_try($q$select public.zt_work_order_report_facts('f2000000-0000-4000-8000-0000000000b1','[]'::jsonb) as r$q$)->>'error'='42501', null);
  perform pg_temp.fei_check('fatos_de_os_inexistente_e_de_outra_empresa_dao_o_mesmo_erro',
    pg_temp.fei_message($q$select public.zt_work_order_report_facts('f9999999-0000-4000-8000-0000000000ff','[]'::jsonb)$q$)
    = pg_temp.fei_message($q$select public.zt_work_order_report_facts('f2000000-0000-4000-8000-0000000000b1','[]'::jsonb)$q$), null);
end $$;

select pg_temp.fei_as('10000000-0000-0000-0000-000000000001');
do $$
declare f jsonb;
begin
  f := pg_temp.fei_try($q$select public.zt_work_order_report_facts('f1000000-0000-4000-8000-0000000000a1','[]'::jsonb) as r$q$) -> 'r';
  perform pg_temp.fei_check('dono_tambem_recebe_fatos_sem_custo_ou_preco',
    f is not null and f::text !~* 'price|cost|margin|custo|difficulty|learning|APRENDIZADO_INTERNO_XYZ|__FEI_CLIENTE_A__', f::text);
  perform pg_temp.fei_check('dono_nao_pede_fatos_de_outra_empresa',
    pg_temp.fei_try($q$select public.zt_work_order_report_facts('f2000000-0000-4000-8000-0000000000b1','[]'::jsonb) as r$q$)->>'error'='42501', null);
end $$;

-- ---------------------------------------------------------------- confirmação de quem recebeu o serviço
select pg_temp.fei_as('10000000-0000-0000-0000-000000000003');
do $$
declare r jsonb; r2 jsonb; v_rows bigint;
begin
  r := pg_temp.fei_try($q$select public.zt_save_attendance_confirmation('f1000000-0000-4000-8000-0000000000a1','Maria da Silva',false,'f1700000-0000-4000-8000-000000000001') as r$q$) -> 'r';
  perform pg_temp.fei_check('confirmacao_com_nome_de_quem_recebeu', r->>'received_by_name'='Maria da Silva' and not (r->>'receiver_absent')::boolean, r::text);
  r2 := pg_temp.fei_try($q$select public.zt_save_attendance_confirmation('f1000000-0000-4000-8000-0000000000a1','Maria da Silva',false,'f1700000-0000-4000-8000-000000000001') as r$q$) -> 'r';
  reset role;
  select count(*) into v_rows from public.work_order_attendance_confirmations where work_order_id='f1000000-0000-4000-8000-0000000000a1';
  perform pg_temp.fei_check('retry_da_confirmacao_nao_duplica', r2->>'id'=r->>'id' and v_rows=1, 'linhas='||v_rows);
  perform pg_temp.fei_as('10000000-0000-0000-0000-000000000003');
  perform pg_temp.fei_check('mesmo_identificador_com_outra_confirmacao_e_recusado',
    pg_temp.fei_try($q$select public.zt_save_attendance_confirmation('f1000000-0000-4000-8000-0000000000a1','Outra Pessoa',false,'f1700000-0000-4000-8000-000000000001') as r$q$)->>'error'='23505', null);

  r := pg_temp.fei_try($q$select public.zt_save_attendance_confirmation('f1000000-0000-4000-8000-0000000000a1','Fulano que sera ignorado',true,'f1700000-0000-4000-8000-000000000002') as r$q$) -> 'r';
  perform pg_temp.fei_check('responsavel_ausente_descarta_o_nome', (r->>'receiver_absent')::boolean and r->>'received_by_name' is null, r::text);
  r := pg_temp.fei_try($q$select public.zt_save_attendance_confirmation('f1000000-0000-4000-8000-0000000000a1',E'Ana\nSouza\t',false,'f1700000-0000-4000-8000-000000000003') as r$q$) -> 'r';
  perform pg_temp.fei_check('nome_sem_quebra_de_linha_nem_controle', r->>'received_by_name'='Ana Souza', r::text);
  perform pg_temp.fei_check('sem_nome_e_sem_ausencia_recusado',
    pg_temp.fei_try($q$select public.zt_save_attendance_confirmation('f1000000-0000-4000-8000-0000000000a1','   ',false,'f1700000-0000-4000-8000-000000000004') as r$q$)->>'error'='22023', null);
  perform pg_temp.fei_check('nome_de_um_caractere_recusado',
    pg_temp.fei_try($q$select public.zt_save_attendance_confirmation('f1000000-0000-4000-8000-0000000000a1','A',false,'f1700000-0000-4000-8000-000000000005') as r$q$)->>'error'='22023', null);
  perform pg_temp.fei_check('nome_acima_de_120_caracteres_recusado',
    pg_temp.fei_try(format($q$select public.zt_save_attendance_confirmation('f1000000-0000-4000-8000-0000000000a1',%L,false,'f1700000-0000-4000-8000-000000000006') as r$q$, repeat('n',121)))->>'error'='22023', null);
  perform pg_temp.fei_check('identificador_da_confirmacao_obrigatorio',
    pg_temp.fei_try($q$select public.zt_save_attendance_confirmation('f1000000-0000-4000-8000-0000000000a1','Maria',false,null) as r$q$)->>'error'='22023', null);
  perform pg_temp.fei_check('tecnico_nao_confirma_os_de_outro_tecnico',
    pg_temp.fei_try($q$select public.zt_save_attendance_confirmation('f1000000-0000-4000-8000-0000000000a2','Maria',false,'f1700000-0000-4000-8000-000000000007') as r$q$)->>'error'='42501', null);
  perform pg_temp.fei_check('tecnico_nao_confirma_os_de_outra_empresa',
    pg_temp.fei_try($q$select public.zt_save_attendance_confirmation('f2000000-0000-4000-8000-0000000000b1','Maria',false,'f1700000-0000-4000-8000-000000000008') as r$q$)->>'error'='42501', null);
  perform pg_temp.fei_check('tecnico_nao_confirma_os_encerrada',
    pg_temp.fei_try($q$select public.zt_save_attendance_confirmation('f1000000-0000-4000-8000-0000000000a4','Maria',false,'f1700000-0000-4000-8000-000000000009') as r$q$)->>'error'='42501', null);
  perform pg_temp.fei_check('tecnico_nao_grava_direto_a_confirmacao',
    pg_temp.fei_state($q$insert into public.work_order_attendance_confirmations(company_id,work_order_id,received_by_name) values ('20000000-0000-0000-0000-000000000001','f1000000-0000-4000-8000-0000000000a3','Maria')$q$)='42501'
    and pg_temp.fei_state($q$update public.work_order_attendance_confirmations set received_by_name='X'$q$)='42501'
    and pg_temp.fei_state($q$delete from public.work_order_attendance_confirmations$q$)='42501', null);
end $$;

select pg_temp.fei_as('10000000-0000-0000-0000-000000000004');
do $$
begin
  perform pg_temp.fei_check('outro_tecnico_nao_ve_confirmacao_alheia', pg_temp.fei_count($q$select 1 from public.work_order_attendance_confirmations$q$)=0, null);
end $$;
select pg_temp.fei_as('10000000-0000-0000-0000-000000000001');
do $$
begin
  perform pg_temp.fei_check('dono_ve_a_confirmacao_da_propria_empresa', pg_temp.fei_count($q$select 1 from public.work_order_attendance_confirmations$q$)=1, null);
end $$;
select pg_temp.fei_as('10000000-0000-0000-0000-000000000002');
do $$
begin
  perform pg_temp.fei_check('empresa_b_nao_ve_confirmacao_da_empresa_a', pg_temp.fei_count($q$select 1 from public.work_order_attendance_confirmations$q$)=0, null);
  perform pg_temp.fei_check('dono_b_nao_confirma_os_da_empresa_a',
    pg_temp.fei_try($q$select public.zt_save_attendance_confirmation('f1000000-0000-4000-8000-0000000000a1','Maria',false,'f1800000-0000-4000-8000-000000000001') as r$q$)->>'error'='42501', null);
end $$;
select pg_temp.fei_anon();
do $$
begin
  perform pg_temp.fei_check('anon_nao_le_nem_grava_confirmacao',
    pg_temp.fei_state($q$select * from public.work_order_attendance_confirmations$q$)='42501'
    and pg_temp.fei_state($q$select public.zt_save_attendance_confirmation('f1000000-0000-4000-8000-0000000000a1','Maria',false,'f1800000-0000-4000-8000-000000000002')$q$)='42501', null);
end $$;
-- As constraints do banco valem mesmo para quem escreve direto (superusuário com a identidade do dono, para passar a guarda de assinatura).
select pg_temp.fei_as('10000000-0000-0000-0000-000000000001');
reset role;
do $$
begin
  perform pg_temp.fei_check('banco_recusa_nome_junto_com_ausente',
    pg_temp.fei_state($q$insert into public.work_order_attendance_confirmations(company_id,work_order_id,received_by_name,receiver_absent) values ('20000000-0000-0000-0000-000000000001','f1000000-0000-4000-8000-0000000000a3','Fulano',true)$q$)='23514', null);
  perform pg_temp.fei_check('banco_recusa_confirmacao_sem_nome_e_sem_ausencia',
    pg_temp.fei_state($q$insert into public.work_order_attendance_confirmations(company_id,work_order_id,received_by_name,receiver_absent) values ('20000000-0000-0000-0000-000000000001','f1000000-0000-4000-8000-0000000000a3',null,false)$q$)='23514', null);
end $$;
select pg_temp.fei_as('10000000-0000-0000-0000-000000000002');
reset role;
do $$
begin
  perform pg_temp.fei_check('banco_recusa_confirmacao_com_empresa_trocada',
    pg_temp.fei_state($q$insert into public.work_order_attendance_confirmations(company_id,work_order_id,received_by_name) values ('20000000-0000-0000-0000-000000000002','f1000000-0000-4000-8000-0000000000a3','Maria')$q$)='23503', null);
end $$;
reset role;

-- ---------------------------------------------------------------- limite de 3 gerações por OS (decidido no banco)
select pg_temp.fei_as('10000000-0000-0000-0000-000000000003');
do $$
declare c jsonb; v_events_before bigint; v_events_after bigint; v_rows bigint; v_text text := 'Foi realizado atendimento referente a Instalar ar-condicionado split 12000 BTU. A solução aplicada foi: Troca do capacitor de partida e limpeza.';
begin
  reset role;
  select count(*) into v_events_before from public.ai_usage_events where company_id='20000000-0000-0000-0000-000000000001';
  perform pg_temp.fei_as('10000000-0000-0000-0000-000000000003');

  c := pg_temp.fei_try($q$select public.zt_claim_work_order_ai_report('f1000000-0000-4000-8000-0000000000a5','f1900000-0000-4000-8000-000000000001') as r$q$) -> 'r';
  perform pg_temp.fei_check('primeira_geracao_permitida', (c->>'allowed')::boolean and not (c->>'replay')::boolean and (c->>'used')::int=1 and (c->>'remaining')::int=2, c::text);
  c := pg_temp.fei_try($q$select public.zt_claim_work_order_ai_report('f1000000-0000-4000-8000-0000000000a5','f1900000-0000-4000-8000-000000000001') as r$q$) -> 'r';
  perform pg_temp.fei_check('repeticao_do_pedido_em_andamento_nao_abre_outra_vaga', not (c->>'allowed')::boolean and c->>'reason'='in_progress' and (c->>'used')::int=1, c::text);

  c := pg_temp.fei_try(format($q$select public.zt_complete_work_order_ai_report('f1000000-0000-4000-8000-0000000000a5','f1900000-0000-4000-8000-000000000001',%L) as r$q$, v_text)) -> 'r';
  perform pg_temp.fei_check('geracao_concluida_conta_uma_vez', (c->>'used')::int=1 and (c->>'remaining')::int=2, c::text);
  c := pg_temp.fei_try($q$select public.zt_claim_work_order_ai_report('f1000000-0000-4000-8000-0000000000a5','f1900000-0000-4000-8000-000000000001') as r$q$) -> 'r';
  perform pg_temp.fei_check('refresh_com_o_mesmo_pedido_devolve_o_texto_sem_nova_geracao',
    (c->>'allowed')::boolean and (c->>'replay')::boolean and c->>'text'=v_text and (c->>'used')::int=1, c::text);

  perform pg_temp.fei_try($q$select public.zt_claim_work_order_ai_report('f1000000-0000-4000-8000-0000000000a5','f1900000-0000-4000-8000-000000000002') as r$q$);
  perform pg_temp.fei_try($q$select public.zt_complete_work_order_ai_report('f1000000-0000-4000-8000-0000000000a5','f1900000-0000-4000-8000-000000000002','Segundo texto') as r$q$);
  c := pg_temp.fei_try($q$select public.zt_claim_work_order_ai_report('f1000000-0000-4000-8000-0000000000a5','f1900000-0000-4000-8000-000000000003') as r$q$) -> 'r';
  perform pg_temp.fei_check('terceira_geracao_permitida_e_ultima', (c->>'allowed')::boolean and (c->>'used')::int=3 and (c->>'remaining')::int=0, c::text);
  perform pg_temp.fei_try($q$select public.zt_complete_work_order_ai_report('f1000000-0000-4000-8000-0000000000a5','f1900000-0000-4000-8000-000000000003','Terceiro texto') as r$q$);

  c := pg_temp.fei_try($q$select public.zt_claim_work_order_ai_report('f1000000-0000-4000-8000-0000000000a5','f1900000-0000-4000-8000-000000000004') as r$q$) -> 'r';
  perform pg_temp.fei_check('quarta_geracao_bloqueada_pelo_banco', not (c->>'allowed')::boolean and c->>'reason'='limit_reached' and (c->>'used')::int=3 and (c->>'remaining')::int=0, c::text);
  c := pg_temp.fei_try($q$select public.zt_claim_work_order_ai_report('f1000000-0000-4000-8000-0000000000a5','f1900000-0000-4000-8000-000000000005') as r$q$) -> 'r';
  perform pg_temp.fei_check('novo_identificador_nao_burla_o_limite', not (c->>'allowed')::boolean and c->>'reason'='limit_reached', c::text);
  c := pg_temp.fei_try($q$select public.zt_claim_work_order_ai_report('f1000000-0000-4000-8000-0000000000a5','f1900000-0000-4000-8000-000000000002') as r$q$) -> 'r';
  perform pg_temp.fei_check('texto_ja_gerado_continua_acessivel_apos_o_limite', (c->>'allowed')::boolean and (c->>'replay')::boolean and c->>'text'='Segundo texto', c::text);

  reset role;
  select count(*) into v_rows from public.work_order_ai_reports where work_order_id='f1000000-0000-4000-8000-0000000000a5';
  select count(*) into v_events_after from public.ai_usage_events where company_id='20000000-0000-0000-0000-000000000001';
  perform pg_temp.fei_check('so_geracoes_aceitas_ficam_registradas_e_gastam_quota', v_rows=3 and v_events_after - v_events_before = 3,
    format('registros=%s eventos=%s',v_rows,v_events_after - v_events_before));
  perform pg_temp.fei_as('10000000-0000-0000-0000-000000000003');

  c := pg_temp.fei_try($q$select public.zt_work_order_ai_report_usage('f1000000-0000-4000-8000-0000000000a5') as r$q$) -> 'r';
  perform pg_temp.fei_check('uso_mostra_3_de_3', (c->>'used')::int=3 and (c->>'limit')::int=3 and (c->>'remaining')::int=0, c::text);
  perform pg_temp.fei_check('uso_de_os_de_outro_tecnico_negado',
    pg_temp.fei_try($q$select public.zt_work_order_ai_report_usage('f1000000-0000-4000-8000-0000000000a2') as r$q$)->>'error'='42501', null);
end $$;

-- Dono compartilha o mesmo limite da OS; outro técnico, outra empresa e anon não geram.
select pg_temp.fei_as('10000000-0000-0000-0000-000000000001');
do $$
declare c jsonb;
begin
  c := pg_temp.fei_try($q$select public.zt_claim_work_order_ai_report('f1000000-0000-4000-8000-0000000000a5','f1a00000-0000-4000-8000-000000000001') as r$q$) -> 'r';
  perform pg_temp.fei_check('limite_e_por_os_e_vale_tambem_para_o_dono', not (c->>'allowed')::boolean and c->>'reason'='limit_reached', c::text);
  perform pg_temp.fei_check('identificador_de_outro_usuario_nao_devolve_texto_alheio',
    pg_temp.fei_try($q$select public.zt_claim_work_order_ai_report('f1000000-0000-4000-8000-0000000000a5','f1900000-0000-4000-8000-000000000001') as r$q$)->>'error'='23505', null);
end $$;
select pg_temp.fei_as('10000000-0000-0000-0000-000000000004');
do $$
begin
  perform pg_temp.fei_check('outro_tecnico_nao_gera_na_os_alheia',
    pg_temp.fei_try($q$select public.zt_claim_work_order_ai_report('f1000000-0000-4000-8000-0000000000a5','f1b00000-0000-4000-8000-000000000001') as r$q$)->>'error'='42501', null);
  perform pg_temp.fei_check('outro_tecnico_nao_conclui_geracao_alheia',
    pg_temp.fei_try($q$select public.zt_complete_work_order_ai_report('f1000000-0000-4000-8000-0000000000a5','f1900000-0000-4000-8000-000000000003','Texto forjado') as r$q$)->>'error'='P0002', null);
  perform pg_temp.fei_check('outro_tecnico_nao_marca_uso_alheio',
    (pg_temp.fei_try($q$select public.zt_mark_work_order_ai_report_used('f1000000-0000-4000-8000-0000000000a5','f1900000-0000-4000-8000-000000000003','x') as r$q$)->'r') = 'false'::jsonb, null);
end $$;
select pg_temp.fei_as('10000000-0000-0000-0000-000000000002');
do $$
begin
  perform pg_temp.fei_check('dono_b_nao_gera_na_os_da_empresa_a',
    pg_temp.fei_try($q$select public.zt_claim_work_order_ai_report('f1000000-0000-4000-8000-0000000000a5','f1c00000-0000-4000-8000-000000000001') as r$q$)->>'error'='42501', null);
  perform pg_temp.fei_check('registro_de_geracoes_nao_e_legivel_nem_gravavel',
    pg_temp.fei_state($q$select * from public.work_order_ai_reports$q$)='42501'
    and pg_temp.fei_state($q$delete from public.work_order_ai_reports$q$)='42501'
    and pg_temp.fei_state($q$update public.work_order_ai_reports set status='pending'$q$)='42501'
    and pg_temp.fei_state($q$insert into public.work_order_ai_reports(company_id,work_order_id,requested_by,request_id) values ('20000000-0000-0000-0000-000000000002','f2000000-0000-4000-8000-0000000000b1','10000000-0000-0000-0000-000000000002',gen_random_uuid())$q$)='42501', null);
end $$;
select pg_temp.fei_anon();
do $$
begin
  perform pg_temp.fei_check('anon_nao_gera_nem_le_fatos',
    pg_temp.fei_state($q$select public.zt_claim_work_order_ai_report('f1000000-0000-4000-8000-0000000000a5',gen_random_uuid())$q$)='42501'
    and pg_temp.fei_state($q$select public.zt_work_order_report_facts('f1000000-0000-4000-8000-0000000000a1','[]'::jsonb)$q$)='42501', null);
end $$;

-- Tentativas simultâneas contam enquanto estão em andamento: três cliques paralelos não passam do limite.
select pg_temp.fei_as('10000000-0000-0000-0000-000000000003');
do $$
declare c1 jsonb; c2 jsonb; c3 jsonb; c4 jsonb; v_text text;
begin
  c1 := pg_temp.fei_try($q$select public.zt_claim_work_order_ai_report('f1000000-0000-4000-8000-0000000000a6','f1d00000-0000-4000-8000-000000000001') as r$q$) -> 'r';
  c2 := pg_temp.fei_try($q$select public.zt_claim_work_order_ai_report('f1000000-0000-4000-8000-0000000000a6','f1d00000-0000-4000-8000-000000000002') as r$q$) -> 'r';
  c3 := pg_temp.fei_try($q$select public.zt_claim_work_order_ai_report('f1000000-0000-4000-8000-0000000000a6','f1d00000-0000-4000-8000-000000000003') as r$q$) -> 'r';
  c4 := pg_temp.fei_try($q$select public.zt_claim_work_order_ai_report('f1000000-0000-4000-8000-0000000000a6','f1d00000-0000-4000-8000-000000000004') as r$q$) -> 'r';
  perform pg_temp.fei_check('tres_em_andamento_ocupam_as_tres_vagas',
    (c1->>'allowed')::boolean and (c2->>'allowed')::boolean and (c3->>'allowed')::boolean
    and not (c4->>'allowed')::boolean and c4->>'reason'='limit_reached', concat_ws(' | ',c1,c2,c3,c4));
  perform pg_temp.fei_check('conclusao_sem_texto_recusada',
    pg_temp.fei_try($q$select public.zt_complete_work_order_ai_report('f1000000-0000-4000-8000-0000000000a6','f1d00000-0000-4000-8000-000000000001','   ') as r$q$)->>'error'='22023', null);
  perform pg_temp.fei_check('identificador_obrigatorio_na_geracao',
    pg_temp.fei_try($q$select public.zt_claim_work_order_ai_report('f1000000-0000-4000-8000-0000000000a6',null) as r$q$)->>'error'='22023', null);
  perform pg_temp.fei_check('conclusao_de_geracao_inexistente_recusada',
    pg_temp.fei_try($q$select public.zt_complete_work_order_ai_report('f1000000-0000-4000-8000-0000000000a6','f1d00000-0000-4000-8000-0000000000ff','Texto') as r$q$)->>'error'='P0002', null);
end $$;

-- Tentativa que o servidor não conclui expira sozinha (provedor caiu): a vaga volta, sem ação do navegador.
do $$
declare c jsonb;
begin
  c := pg_temp.fei_try($q$select public.zt_claim_work_order_ai_report('f1000000-0000-4000-8000-0000000000a7','f1e00000-0000-4000-8000-000000000001') as r$q$) -> 'r';
  perform pg_temp.fei_check('tentativa_pendente_conta_enquanto_recente', (c->>'allowed')::boolean and (c->>'used')::int=1, c::text);
  reset role;
  update public.work_order_ai_reports set created_at = clock_timestamp() - interval '120 seconds'
   where work_order_id='f1000000-0000-4000-8000-0000000000a7';
  perform pg_temp.fei_as('10000000-0000-0000-0000-000000000003');
  c := pg_temp.fei_try($q$select public.zt_work_order_ai_report_usage('f1000000-0000-4000-8000-0000000000a7') as r$q$) -> 'r';
  perform pg_temp.fei_check('tentativa_pendente_expirada_deixa_de_contar', (c->>'used')::int=0 and (c->>'remaining')::int=3, c::text);
  c := pg_temp.fei_try($q$select public.zt_claim_work_order_ai_report('f1000000-0000-4000-8000-0000000000a7','f1e00000-0000-4000-8000-000000000001') as r$q$) -> 'r';
  perform pg_temp.fei_check('repeticao_do_pedido_expirado_reabre_a_mesma_vaga', (c->>'allowed')::boolean and not (c->>'replay')::boolean and (c->>'used')::int=1, c::text);
  reset role;
  perform pg_temp.fei_check('pedido_expirado_reaberto_continua_uma_linha',
    (select count(*) from public.work_order_ai_reports where work_order_id='f1000000-0000-4000-8000-0000000000a7')=1, null);
  perform pg_temp.fei_as('10000000-0000-0000-0000-000000000003');
end $$;

-- Marcação de uso: qual geração virou o relato e se foi editada depois.
do $$
declare c jsonb;
begin
  perform pg_temp.fei_try($q$select public.zt_complete_work_order_ai_report('f1000000-0000-4000-8000-0000000000a7','f1e00000-0000-4000-8000-000000000001','Texto gerado pela IA') as r$q$);
  perform pg_temp.fei_check('marcar_uso_de_texto_editado',
    (pg_temp.fei_try($q$select public.zt_mark_work_order_ai_report_used('f1000000-0000-4000-8000-0000000000a7','f1e00000-0000-4000-8000-000000000001','Texto gerado pela IA, ajustado pelo técnico') as r$q$)->'r') = 'true'::jsonb, null);
  c := pg_temp.fei_try($q$select public.zt_work_order_ai_report_usage('f1000000-0000-4000-8000-0000000000a7') as r$q$) -> 'r';
  perform pg_temp.fei_check('uso_informa_origem_ia_editada', c->>'lastUsedAt' is not null and (c->>'lastUsedEdited')::boolean, c::text);
  perform pg_temp.fei_try($q$select public.zt_mark_work_order_ai_report_used('f1000000-0000-4000-8000-0000000000a7','f1e00000-0000-4000-8000-000000000001','  Texto gerado pela IA ') as r$q$);
  c := pg_temp.fei_try($q$select public.zt_work_order_ai_report_usage('f1000000-0000-4000-8000-0000000000a7') as r$q$) -> 'r';
  perform pg_temp.fei_check('uso_informa_origem_ia_sem_edicao', not (c->>'lastUsedEdited')::boolean, c::text);
  perform pg_temp.fei_check('marcar_uso_de_geracao_nao_concluida_nao_faz_nada',
    (pg_temp.fei_try($q$select public.zt_mark_work_order_ai_report_used('f1000000-0000-4000-8000-0000000000a6','f1d00000-0000-4000-8000-000000000001','x') as r$q$)->'r') = 'false'::jsonb, null);
end $$;

-- OS encerrada: ninguém gera relatório novo com IA.
do $$
begin
  perform pg_temp.fei_check('tecnico_nao_gera_em_os_encerrada',
    pg_temp.fei_try($q$select public.zt_claim_work_order_ai_report('f1000000-0000-4000-8000-0000000000a4','f1f00000-0000-4000-8000-000000000001') as r$q$)->>'error'='42501', null);
end $$;
select pg_temp.fei_as('10000000-0000-0000-0000-000000000001');
do $$
begin
  perform pg_temp.fei_check('dono_nao_gera_em_os_encerrada',
    pg_temp.fei_try($q$select public.zt_claim_work_order_ai_report('f1000000-0000-4000-8000-0000000000a4','f1f00000-0000-4000-8000-000000000002') as r$q$)->>'error'='42501', null);
end $$;

-- ---------------------------------------------------------------- assinatura vencida bloqueia escrita, geração e quota
reset role;
update public.subscriptions set status='canceled', current_period_start=current_date-40, current_period_end=current_date-10 where company_id='20000000-0000-0000-0000-000000000002';
select pg_temp.fei_as('10000000-0000-0000-0000-000000000002');
do $$
begin
  perform pg_temp.fei_check('assinatura_vencida_bloqueia_a_gravacao_da_base',
    pg_temp.fei_try($q$select public.zt_save_work_order_technical_base('f2000000-0000-4000-8000-0000000000b1','Outra causa B','Solução B','easy','Aprendizado B','f1400000-0000-4000-8000-000000000009') as r$q$)->>'error' is not null, null);
  perform pg_temp.fei_check('assinatura_vencida_bloqueia_a_confirmacao',
    pg_temp.fei_try($q$select public.zt_save_attendance_confirmation('f2000000-0000-4000-8000-0000000000b1','Maria',false,'f1400000-0000-4000-8000-000000000010') as r$q$)->>'error' is not null, null);
  perform pg_temp.fei_check('assinatura_vencida_bloqueia_a_geracao_com_ia',
    pg_temp.fei_try($q$select public.zt_claim_work_order_ai_report('f2000000-0000-4000-8000-0000000000b1','f1400000-0000-4000-8000-000000000011') as r$q$)->>'error' is not null, null);
end $$;
reset role;
do $$
begin
  perform pg_temp.fei_check('geracao_recusada_pela_assinatura_nao_deixa_registro',
    (select count(*) from public.work_order_ai_reports where work_order_id='f2000000-0000-4000-8000-0000000000b1')=0, null);
end $$;

do $$
declare v_failures text;
begin
  select string_agg(name||' => '||coalesce(detail,''),' ; ' order by name) into v_failures from zt_fei_results where not ok;
  if v_failures is not null then raise exception 'FIELD_EXEC_FAILED: %', v_failures; end if;
  if (select count(*) from zt_fei_results)<>125 then
    raise exception 'FIELD_EXEC_INCOMPLETE: % checks',(select count(*) from zt_fei_results);
  end if;
end $$;

select 'FIELD_EXECUTION_INTELLIGENCE' as test, count(*) as checks, bool_and(ok) as all_ok from zt_fei_results;

rollback;
