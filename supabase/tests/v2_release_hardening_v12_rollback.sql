-- ZiisTec · Hardening adversarial V1.2 — ataques que a suíte anterior não exercitava.
--   1. SEC-V12-02: o proprietário não reescreve user_id/company_id/id de company_members (0112).
--   2. Colaborador desativado com JWT ainda válido perde as RPCs da 0111, a leitura da OS, a cota de IA e o Storage.
--   3. Registro de evidência (upload) recusa caminho adulterado, empresa trocada, MIME executável e tamanho fora do limite.
--   4. Técnico não atribuído (técnico 2) não registra evidência, não lê a OS e não grava no Storage dela.
--   5. Cotas de IA e de PDF: limite por minuto/dia no banco, mensagens exatas (a rota só repassa estas frases),
--      outro tenant e anônimo negados.
--   6. A empresa B (vítima) não muda durante os ataques.
-- Usa as identidades sintéticas de ci_local_seed.sql. Destino: SOMENTE CI descartável ou homologação. Tudo termina em ROLLBACK.

begin;

create temp table v12_results (name text primary key, ok boolean not null, detail text) on commit drop;
grant select, insert, update on v12_results to authenticated, anon;

create function pg_temp.v12_check(p_name text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into v12_results(name,ok,detail) values (p_name,coalesce(p_ok,false),left(p_detail,400));
$$;

-- SQLSTATE do comando ('ok' quando passa).
create function pg_temp.v12_state(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $$;

-- SQLSTATE e mensagem do erro (para provar a frase exata de produto das RPCs de cota).
create function pg_temp.v12_msg(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'ok'; exception when others then return sqlstate||'|'||sqlerrm; end $$;

create function pg_temp.v12_affected(p_sql text) returns integer language plpgsql as $$
declare n integer;
begin execute p_sql; get diagnostics n = row_count; return n; exception when others then return -1; end $$;

create function pg_temp.v12_count(p_sql text) returns bigint language plpgsql as $$
declare n bigint;
begin execute 'select count(*) from ('||p_sql||') q' into n; return n; exception when others then return -1; end $$;

create function pg_temp.v12_as(p_uid uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claim.sub',p_uid::text,true);
  perform set_config('request.jwt.claims',json_build_object('sub',p_uid,'role','authenticated','aal','aal1')::text,true);
  set local role authenticated;
end $$;

create function pg_temp.v12_anon() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims','',true);
  set local role anon;
end $$;

do $$
begin
  if current_setting('session_replication_role') <> 'origin' then raise exception 'V12_REQUIRES_ORIGIN'; end if;
  if (select count(*) from public.company_members where status='active'
        and (company_id,user_id,role) in (
          ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','owner'),
          ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000003','technician'),
          ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','owner')))<>3 then
    raise exception 'V12_FIXTURE_MISSING';
  end if;
  -- O usuário 004 é a "vítima" do SEC-V12-02: existe, mas não pertence a nenhuma empresa.
  if exists (select 1 from public.company_members where user_id='10000000-0000-0000-0000-000000000004') then
    raise exception 'V12_FIXTURE_VICTIM_HAS_MEMBERSHIP';
  end if;
end $$;

-- ---------------------------------------------------------------- fixtures
-- Gravação fora dos fluxos oficiais: gatilhos desligados só para semear; voltam a 'origin' antes dos ataques.
set local session_replication_role = replica;
insert into public.clients(id,company_id,name,address) values
  ('e1200000-0000-4000-8000-000000000001','20000000-0000-0000-0000-000000000001','__V12_CLIENTE_A__','Rua Privada A, 100'),
  ('e2200000-0000-4000-8000-000000000001','20000000-0000-0000-0000-000000000002','__V12_CLIENTE_B__','Rua Privada B, 200');
insert into public.work_orders(id,company_id,number,client_id,assigned_to,status,request,address) values
  ('e1200000-0000-4000-8000-0000000000a1','20000000-0000-0000-0000-000000000001','V12-A1','e1200000-0000-4000-8000-000000000001','10000000-0000-0000-0000-000000000003','in_progress','Instalar split V12','Rua Privada A, 100'),
  ('e2200000-0000-4000-8000-0000000000b1','20000000-0000-0000-0000-000000000002','V12-B1','e2200000-0000-4000-8000-000000000001','10000000-0000-0000-0000-000000000002','in_progress','OS da empresa B V12','Rua Privada B, 200');
insert into storage.objects(id,bucket_id,name,metadata) values
  (gen_random_uuid(),'zt-work-orders','20000000-0000-0000-0000-000000000001/work-orders/e1200000-0000-4000-8000-0000000000a1/before/'||repeat('c',64)||'.jpg','{}'::jsonb),
  (gen_random_uuid(),'zt-work-orders','20000000-0000-0000-0000-000000000002/work-orders/e2200000-0000-4000-8000-0000000000b1/before/'||repeat('d',64)||'.jpg','{}'::jsonb);
set local session_replication_role = origin;

-- Foto da empresa B antes dos ataques (a vítima não pode mudar).
create temp table v12_before on commit drop as
select (select count(*) from public.company_members where company_id='20000000-0000-0000-0000-000000000002') as members_b,
       (select md5(string_agg(m::text, '|' order by m.id)) from public.company_members m where company_id='20000000-0000-0000-0000-000000000002') as members_hash_b,
       (select md5(string_agg(w::text, '|' order by w.id)) from public.work_orders w where company_id='20000000-0000-0000-0000-000000000002') as work_orders_hash_b,
       (select md5(string_agg(p::text, '|' order by p.id)) from public.profiles p where p.id in ('10000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000004')) as profiles_hash;
grant select on v12_before to authenticated, anon;

-- ---------------------------------------------------------------- 1. SEC-V12-02 — identidade do vínculo é imutável
select pg_temp.v12_as('10000000-0000-0000-0000-000000000001');
do $$
begin
  perform pg_temp.v12_check('sec_v12_02_dono_nao_troca_user_id_do_vinculo',
    pg_temp.v12_state($q$update public.company_members set user_id='10000000-0000-0000-0000-000000000004' where company_id='20000000-0000-0000-0000-000000000001' and user_id='10000000-0000-0000-0000-000000000003'$q$)='42501', null);
  perform pg_temp.v12_check('sec_v12_02_dono_nao_troca_id_do_vinculo',
    pg_temp.v12_state($q$update public.company_members set id=gen_random_uuid() where company_id='20000000-0000-0000-0000-000000000001' and user_id='10000000-0000-0000-0000-000000000003'$q$)='42501', null);
  perform pg_temp.v12_check('sec_v12_02_dono_nao_move_vinculo_para_a_empresa_da_vitima',
    pg_temp.v12_state($q$update public.company_members set company_id='20000000-0000-0000-0000-000000000002' where company_id='20000000-0000-0000-0000-000000000001' and user_id='10000000-0000-0000-0000-000000000003'$q$)='42501', null);
  perform pg_temp.v12_check('sec_v12_02_vitima_continua_invisivel_para_o_dono',
    pg_temp.v12_count($q$select 1 from public.profiles where id='10000000-0000-0000-0000-000000000004'$q$)=0, null);
  perform pg_temp.v12_check('sec_v12_02_dono_nao_edita_perfil_de_quem_nao_e_da_equipe',
    pg_temp.v12_state($q$select public.zt_update_team_member('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000004','HACK V12','11999990000',null)$q$)='42501', null);
  -- O que o proprietário PODE continuar fazendo na equipe.
  perform pg_temp.v12_check('sec_v12_02_dono_ainda_edita_cargo',
    pg_temp.v12_affected($q$update public.company_members set job_title='Instalador V12' where company_id='20000000-0000-0000-0000-000000000001' and user_id='10000000-0000-0000-0000-000000000003'$q$)=1, null);
  perform pg_temp.v12_check('sec_v12_02_dono_ainda_edita_colaborador_pela_rpc',
    pg_temp.v12_state($q$select public.zt_update_team_member('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000003','Tecnico A V12',null,'Instalador V12')$q$)='ok', null);
end $$;
select pg_temp.v12_as('10000000-0000-0000-0000-000000000003');
do $$
begin
  perform pg_temp.v12_check('sec_v12_02_tecnico_nao_reescreve_o_proprio_vinculo',
    pg_temp.v12_affected($q$update public.company_members set user_id='10000000-0000-0000-0000-000000000004' where user_id='10000000-0000-0000-0000-000000000003'$q$) <= 0, null);
end $$;
reset role;
do $$
declare v_fn oid:=to_regprocedure('public.zt_guard_company_member_identity()');
begin
  perform pg_temp.v12_check('sec_v12_02_vitima_nao_entrou_na_empresa',
    not exists (select 1 from public.company_members where user_id='10000000-0000-0000-0000-000000000004'), null);
  perform pg_temp.v12_check('sec_v12_02_nem_o_dono_do_banco_troca_a_identidade',
    pg_temp.v12_state($q$update public.company_members set user_id='10000000-0000-0000-0000-000000000004' where company_id='20000000-0000-0000-0000-000000000001' and user_id='10000000-0000-0000-0000-000000000003'$q$)='42501', null);
  perform pg_temp.v12_check('sec_v12_02_gatilho_de_identidade_existe_e_nao_e_chamavel',
    v_fn is not null
    and exists (select 1 from pg_trigger where tgname='trg_guard_company_member_identity' and tgrelid='public.company_members'::regclass and not tgisinternal and tgenabled='O')
    and not has_function_privilege('authenticated',v_fn,'EXECUTE')
    and not has_function_privilege('anon',v_fn,'EXECUTE')
    and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f',p.proowner))) a where p.oid=v_fn and a.grantee=0)
    and not (select prosecdef from pg_proc where oid=v_fn), null);
end $$;

-- Técnico 2 da empresa A: ativo, mas SEM atribuição na OS a1. Entra só depois dos ataques da seção 1, que usam o 004 como vítima.
set local session_replication_role = replica;
insert into public.company_members(company_id,user_id,role,status,job_title)
values ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000004','technician','active','V12 Technician 2')
on conflict (company_id,user_id) do update set role='technician', status='active';
set local session_replication_role = origin;

-- ---------------------------------------------------------------- 2. registro de evidência: ataques ao caminho, empresa, MIME e tamanho
-- Técnico A (atribuído): o controle positivo prova que cada recusa abaixo vem da validação e não de fixture quebrada.
select pg_temp.v12_as('10000000-0000-0000-0000-000000000003');
do $$
declare
  a constant text:='20000000-0000-0000-0000-000000000001';
  b constant text:='20000000-0000-0000-0000-000000000002';
  wo constant text:='e1200000-0000-4000-8000-0000000000a1';
  sha constant text:=repeat('a',64);
  good constant text:='20000000-0000-0000-0000-000000000001/work-orders/e1200000-0000-4000-8000-0000000000a1/before/'||repeat('a',64)||'.jpg';
begin
  perform pg_temp.v12_check('ev_controle_positivo_registra_evidencia_valida',
    pg_temp.v12_state(format($q$select public.zt_register_work_order_evidence(%L,%L,%L,'foto.jpg','image/jpeg',1000,'before',null,null,%L)$q$,a,wo,good,sha))='ok', null);
  perform pg_temp.v12_check('ev_caminho_com_traversal_recusado',
    pg_temp.v12_state(format($q$select public.zt_register_work_order_evidence(%L,%L,%L,'foto.jpg','image/jpeg',1000,'before',null,null,%L)$q$,a,wo,
      a||'/work-orders/'||wo||'/before/../../../'||b||'/work-orders/x/'||sha||'.jpg',sha))='22023', null);
  perform pg_temp.v12_check('ev_caminho_na_empresa_da_vitima_recusado',
    pg_temp.v12_state(format($q$select public.zt_register_work_order_evidence(%L,%L,%L,'foto.jpg','image/jpeg',1000,'before',null,null,%L)$q$,a,wo,
      b||'/work-orders/'||wo||'/before/'||sha||'.jpg',sha))='22023', null);
  perform pg_temp.v12_check('ev_caminho_com_extensao_diferente_do_mime_recusado',
    pg_temp.v12_state(format($q$select public.zt_register_work_order_evidence(%L,%L,%L,'foto.jpg','image/jpeg',1000,'before',null,null,%L)$q$,a,wo,
      a||'/work-orders/'||wo||'/before/'||sha||'.html',sha))='22023', null);
  perform pg_temp.v12_check('ev_etapa_diferente_da_do_caminho_recusada',
    pg_temp.v12_state(format($q$select public.zt_register_work_order_evidence(%L,%L,%L,'foto.jpg','image/jpeg',1000,'after',null,null,%L)$q$,a,wo,good,sha))='22023', null);
  perform pg_temp.v12_check('ev_empresa_da_vitima_com_os_da_empresa_a_recusada',
    pg_temp.v12_state(format($q$select public.zt_register_work_order_evidence(%L,%L,%L,'foto.jpg','image/jpeg',1000,'before',null,null,%L)$q$,b,wo,
      b||'/work-orders/'||wo||'/before/'||sha||'.jpg',sha))='42501', null);
  perform pg_temp.v12_check('ev_os_da_vitima_com_empresa_a_recusada',
    pg_temp.v12_state(format($q$select public.zt_register_work_order_evidence(%L,%L,%L,'foto.jpg','image/jpeg',1000,'before',null,null,%L)$q$,a,'e2200000-0000-4000-8000-0000000000b1',
      a||'/work-orders/e2200000-0000-4000-8000-0000000000b1/before/'||sha||'.jpg',sha))='42501', null);
  perform pg_temp.v12_check('ev_os_da_vitima_com_empresa_da_vitima_recusada',
    pg_temp.v12_state(format($q$select public.zt_register_work_order_evidence(%L,%L,%L,'foto.jpg','image/jpeg',1000,'before',null,null,%L)$q$,b,'e2200000-0000-4000-8000-0000000000b1',
      b||'/work-orders/e2200000-0000-4000-8000-0000000000b1/before/'||sha||'.jpg',sha))='42501', null);
  perform pg_temp.v12_check('ev_mime_html_svg_e_executavel_recusados',
    pg_temp.v12_state(format($q$select public.zt_register_work_order_evidence(%L,%L,%L,'x.html','text/html',1000,'before',null,null,%L)$q$,a,wo,good,sha))='22023'
    and pg_temp.v12_state(format($q$select public.zt_register_work_order_evidence(%L,%L,%L,'x.svg','image/svg+xml',1000,'before',null,null,%L)$q$,a,wo,good,sha))='22023'
    and pg_temp.v12_state(format($q$select public.zt_register_work_order_evidence(%L,%L,%L,'x.exe','application/x-msdownload',1000,'before',null,null,%L)$q$,a,wo,good,sha))='22023', null);
  perform pg_temp.v12_check('ev_tamanho_acima_do_limite_negativo_ou_nulo_recusado',
    pg_temp.v12_state(format($q$select public.zt_register_work_order_evidence(%L,%L,%L,'foto.jpg','image/jpeg',%s,'before',null,null,%L)$q$,a,wo,good,15*1024*1024+1,sha))='22023'
    and pg_temp.v12_state(format($q$select public.zt_register_work_order_evidence(%L,%L,%L,'foto.jpg','image/jpeg',-1,'before',null,null,%L)$q$,a,wo,good,sha))='22023'
    and pg_temp.v12_state(format($q$select public.zt_register_work_order_evidence(%L,%L,%L,'foto.jpg','image/jpeg',null,'before',null,null,%L)$q$,a,wo,good,sha))='22023'
    and pg_temp.v12_state(format($q$select public.zt_register_work_order_evidence(%L,%L,%L,'v.mp4','video/mp4',%s,'video',null,null,%L)$q$,a,wo,
        a||'/work-orders/'||wo||'/video/'||sha||'.mp4',30*1024*1024+1,sha))='22023', null);
  perform pg_temp.v12_check('ev_sha_nome_e_etapa_invalidos_recusados',
    pg_temp.v12_state(format($q$select public.zt_register_work_order_evidence(%L,%L,%L,'foto.jpg','image/jpeg',1000,'before',null,null,%L)$q$,a,wo,good,upper(sha)))='22023'
    and pg_temp.v12_state(format($q$select public.zt_register_work_order_evidence(%L,%L,%L,'foto.jpg','image/jpeg',1000,'before',null,null,%L)$q$,a,wo,good,repeat('a',63)))='22023'
    and pg_temp.v12_state(format($q$select public.zt_register_work_order_evidence(%L,%L,%L,%L,'image/jpeg',1000,'before',null,null,%L)$q$,a,wo,good,repeat('n',256),sha))='22023'
    and pg_temp.v12_state(format($q$select public.zt_register_work_order_evidence(%L,%L,%L,'','image/jpeg',1000,'before',null,null,%L)$q$,a,wo,good,sha))='22023'
    and pg_temp.v12_state(format($q$select public.zt_register_work_order_evidence(%L,%L,%L,'foto.jpg','image/jpeg',1000,'../../etc',null,null,%L)$q$,a,wo,good,sha))='22023', null);
  perform pg_temp.v12_check('ev_so_a_evidencia_valida_foi_gravada',
    (select count(*) from public.attachments where work_order_id=wo::uuid)=1, null);
end $$;

-- Técnico 2 (ativo, mas não atribuído): não registra, não lê e não grava no Storage da OS do colega.
select pg_temp.v12_as('10000000-0000-0000-0000-000000000004');
do $$
declare
  a constant text:='20000000-0000-0000-0000-000000000001';
  wo constant text:='e1200000-0000-4000-8000-0000000000a1';
  sha constant text:=repeat('e',64);
begin
  perform pg_temp.v12_check('t2_tecnico_nao_atribuido_nao_registra_evidencia',
    pg_temp.v12_state(format($q$select public.zt_register_work_order_evidence(%L,%L,%L,'foto.jpg','image/jpeg',1000,'before',null,null,%L)$q$,a,wo,
      a||'/work-orders/'||wo||'/before/'||sha||'.jpg',sha))='42501', null);
  perform pg_temp.v12_check('t2_tecnico_nao_atribuido_nao_le_a_os_nem_o_cliente',
    pg_temp.v12_count($q$select 1 from public.work_orders where id='e1200000-0000-4000-8000-0000000000a1'$q$)=0
    and pg_temp.v12_count($q$select 1 from public.clients where id='e1200000-0000-4000-8000-000000000001'$q$)=0
    and pg_temp.v12_count($q$select 1 from public.attachments where work_order_id='e1200000-0000-4000-8000-0000000000a1'$q$)=0, null);
  perform pg_temp.v12_check('t2_tecnico_nao_atribuido_nao_ve_nem_grava_storage_da_os',
    pg_temp.v12_count($q$select 1 from storage.objects where name like '20000000-0000-0000-0000-000000000001/work-orders/e1200000-0000-4000-8000-0000000000a1/%'$q$)=0
    and pg_temp.v12_state($q$insert into storage.objects(bucket_id,name,owner_id) values ('zt-work-orders','20000000-0000-0000-0000-000000000001/work-orders/e1200000-0000-4000-8000-0000000000a1/before/zz.jpg','x')$q$)='42501', null);
  perform pg_temp.v12_check('t2_tecnico_nao_atribuido_nao_usa_as_rpcs_da_0111',
    pg_temp.v12_state($q$select public.zt_save_work_order_technical_base('e1200000-0000-4000-8000-0000000000a1','Causa T2','Solucao T2','medium','Aprendizado T2','e1700000-0000-4000-8000-000000000002')$q$) = '42501'
    and pg_temp.v12_state($q$select public.zt_work_order_report_facts('e1200000-0000-4000-8000-0000000000a1')$q$) = '42501'
    and pg_temp.v12_state($q$select public.zt_claim_work_order_ai_report('e1200000-0000-4000-8000-0000000000a1','e1700000-0000-4000-8000-000000000003')$q$) = '42501', null);
end $$;

-- ---------------------------------------------------------------- 3. colaborador desativado com JWT ainda válido
-- Controle positivo antes de desativar: as mesmas chamadas passam para o técnico atribuído ativo.
select pg_temp.v12_as('10000000-0000-0000-0000-000000000003');
do $$
begin
  perform pg_temp.v12_check('d_controle_tecnico_ativo_usa_base_tecnica_e_le_a_os',
    pg_temp.v12_state($q$select public.zt_save_work_order_technical_base('e1200000-0000-4000-8000-0000000000a1','Causa V12','Solucao V12','medium','Aprendizado V12','e1700000-0000-4000-8000-000000000001')$q$)='ok'
    and pg_temp.v12_state($q$select public.zt_work_order_report_facts('e1200000-0000-4000-8000-0000000000a1')$q$)='ok'
    and pg_temp.v12_count($q$select 1 from public.work_orders where id='e1200000-0000-4000-8000-0000000000a1'$q$)=1
    and pg_temp.v12_count($q$select 1 from storage.objects where name like '20000000-0000-0000-0000-000000000001/work-orders/e1200000-0000-4000-8000-0000000000a1/%'$q$)=1, null);
end $$;
select pg_temp.v12_as('10000000-0000-0000-0000-000000000001');
do $$
begin
  perform pg_temp.v12_check('d_dono_desativa_o_tecnico_pelo_caminho_do_aplicativo',
    pg_temp.v12_affected($q$update public.company_members set status='disabled' where company_id='20000000-0000-0000-0000-000000000001' and user_id='10000000-0000-0000-0000-000000000003'$q$)=1, null);
end $$;
-- O JWT do técnico continua o mesmo: quem decide é o banco.
select pg_temp.v12_as('10000000-0000-0000-0000-000000000003');
do $$
declare
  a constant text:='20000000-0000-0000-0000-000000000001';
  wo constant text:='e1200000-0000-4000-8000-0000000000a1';
  sha constant text:=repeat('f',64);
begin
  perform pg_temp.v12_check('d_desativado_nao_usa_nenhuma_rpc_da_0111',
    pg_temp.v12_state($q$select public.zt_save_work_order_technical_base('e1200000-0000-4000-8000-0000000000a1','Causa depois','Solucao depois','medium','Aprendizado depois','e1700000-0000-4000-8000-000000000004')$q$) = '42501'
    and pg_temp.v12_state($q$select public.zt_save_attendance_confirmation('e1200000-0000-4000-8000-0000000000a1','Maria V12',false,'e1700000-0000-4000-8000-000000000005')$q$) = '42501'
    and pg_temp.v12_state($q$select public.zt_work_order_report_facts('e1200000-0000-4000-8000-0000000000a1')$q$) = '42501'
    and pg_temp.v12_state($q$select public.zt_claim_work_order_ai_report('e1200000-0000-4000-8000-0000000000a1','e1700000-0000-4000-8000-000000000006')$q$) = '42501'
    and pg_temp.v12_state($q$select public.zt_work_order_ai_report_usage('e1200000-0000-4000-8000-0000000000a1')$q$) = '42501', null);
  perform pg_temp.v12_check('d_desativado_nao_registra_evidencia',
    pg_temp.v12_state(format($q$select public.zt_register_work_order_evidence(%L,%L,%L,'foto.jpg','image/jpeg',1000,'before',null,null,%L)$q$,a,wo,
      a||'/work-orders/'||wo||'/before/'||sha||'.jpg',sha))='42501', null);
  perform pg_temp.v12_check('d_desativado_nao_le_os_cliente_base_tecnica_nem_storage',
    pg_temp.v12_count($q$select 1 from public.work_orders where id='e1200000-0000-4000-8000-0000000000a1'$q$)=0
    and pg_temp.v12_count($q$select 1 from public.clients where company_id='20000000-0000-0000-0000-000000000001'$q$)=0
    and pg_temp.v12_count($q$select 1 from public.work_order_technical_base$q$)=0
    and pg_temp.v12_count($q$select 1 from storage.objects where name like '20000000-0000-0000-0000-000000000001/%'$q$)=0, null);
  perform pg_temp.v12_check('d_desativado_nao_grava_no_storage',
    pg_temp.v12_state($q$insert into storage.objects(bucket_id,name,owner_id) values ('zt-work-orders','20000000-0000-0000-0000-000000000001/work-orders/e1200000-0000-4000-8000-0000000000a1/before/novo.jpg','x')$q$)='42501', null);
  perform pg_temp.v12_check('d_desativado_nao_consome_cota_de_ia_nem_e_membro',
    pg_temp.v12_msg($q$select public.zt_consume_ai_quota('20000000-0000-0000-0000-000000000001')$q$)='42501|Sem acesso a esta empresa'
    and not public.zt_is_member('20000000-0000-0000-0000-000000000001')
    and not public.zt_is_owner('20000000-0000-0000-0000-000000000001'), null);
  perform pg_temp.v12_check('d_desativado_nao_se_reativa',
    pg_temp.v12_affected($q$update public.company_members set status='active' where user_id='10000000-0000-0000-0000-000000000003'$q$) <= 0, null);
end $$;
-- Reativar devolve o acesso (prova que a negação vinha do status, não de dado quebrado).
select pg_temp.v12_as('10000000-0000-0000-0000-000000000001');
do $$
begin
  perform pg_temp.v12_check('d_dono_reativa_o_tecnico',
    pg_temp.v12_affected($q$update public.company_members set status='active' where company_id='20000000-0000-0000-0000-000000000001' and user_id='10000000-0000-0000-0000-000000000003'$q$)=1, null);
end $$;
select pg_temp.v12_as('10000000-0000-0000-0000-000000000003');
do $$
begin
  perform pg_temp.v12_check('d_reativado_volta_a_ler_a_os_e_usar_as_rpcs',
    pg_temp.v12_count($q$select 1 from public.work_orders where id='e1200000-0000-4000-8000-0000000000a1'$q$)=1
    and pg_temp.v12_state($q$select public.zt_work_order_ai_report_usage('e1200000-0000-4000-8000-0000000000a1')$q$)='ok', null);
end $$;

-- ---------------------------------------------------------------- 4. cotas de IA e de PDF: o limite mora no banco
select pg_temp.v12_as('10000000-0000-0000-0000-000000000001');
do $$
declare i int; v_last text:='ok';
begin
  perform pg_temp.v12_check('q_dono_consome_cota_de_ia_da_propria_empresa',
    pg_temp.v12_state($q$select public.zt_consume_ai_quota('20000000-0000-0000-0000-000000000001')$q$)='ok', null);
  for i in 2..10 loop
    v_last := pg_temp.v12_state($q$select public.zt_consume_ai_quota('20000000-0000-0000-0000-000000000001')$q$);
    exit when v_last <> 'ok';
  end loop;
  perform pg_temp.v12_check('q_dez_chamadas_por_minuto_passam', v_last='ok', v_last);
  perform pg_temp.v12_check('q_decima_primeira_no_minuto_e_recusada_com_a_frase_exata',
    pg_temp.v12_msg($q$select public.zt_consume_ai_quota('20000000-0000-0000-0000-000000000001')$q$)='P0001|Limite temporário de IA atingido. Tente novamente em instantes', null);
end $$;
reset role;
do $$
begin
  perform pg_temp.v12_check('q_exatamente_dez_eventos_foram_gravados',
    (select count(*) from public.ai_usage_events where user_id='10000000-0000-0000-0000-000000000001' and company_id='20000000-0000-0000-0000-000000000001')=10, null);
end $$;
-- Limite diário: cem eventos antigos (fora da janela de um minuto) para o dono da empresa B.
insert into public.ai_usage_events(user_id,company_id,created_at)
select '10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002', now()-interval '2 hours' from generate_series(1,100);
select pg_temp.v12_as('10000000-0000-0000-0000-000000000002');
do $$
begin
  perform pg_temp.v12_check('q_centesima_primeira_no_dia_e_recusada_com_a_frase_exata',
    pg_temp.v12_msg($q$select public.zt_consume_ai_quota('20000000-0000-0000-0000-000000000002')$q$)='P0001|Limite diário de IA atingido', null);
  perform pg_temp.v12_check('q_dono_b_nao_consome_cota_na_empresa_a',
    pg_temp.v12_msg($q$select public.zt_consume_ai_quota('20000000-0000-0000-0000-000000000001')$q$)='42501|Sem acesso a esta empresa', null);
  perform pg_temp.v12_check('q_dono_b_nao_gera_pdf_na_empresa_a',
    pg_temp.v12_state($q$select public.zt_consume_quote_pdf_quota('20000000-0000-0000-0000-000000000001')$q$)='42501', null);
  perform pg_temp.v12_check('q_dono_b_gera_pdf_na_propria_empresa',
    pg_temp.v12_state($q$select public.zt_consume_quote_pdf_quota('20000000-0000-0000-0000-000000000002')$q$)='ok', null);
end $$;
select pg_temp.v12_as('10000000-0000-0000-0000-000000000003');
do $$
begin
  perform pg_temp.v12_check('q_tecnico_nao_gera_pdf_de_orcamento_com_a_frase_exata',
    pg_temp.v12_msg($q$select public.zt_consume_quote_pdf_quota('20000000-0000-0000-0000-000000000001')$q$)='42501|Somente o proprietário gera PDF de orçamento', null);
end $$;
select pg_temp.v12_as('10000000-0000-0000-0000-000000000004');
do $$
begin
  perform pg_temp.v12_check('q_tecnico_2_nao_gera_pdf_de_orcamento',
    pg_temp.v12_state($q$select public.zt_consume_quote_pdf_quota('20000000-0000-0000-0000-000000000001')$q$)='42501', null);
end $$;
reset role;
-- Sem papel de dono ativo nem assinatura utilizável a cota recusa (assinatura vencida, como no vencimento do plano).
update public.subscriptions set current_period_start = current_date - 40, current_period_end = current_date - 1 where company_id='20000000-0000-0000-0000-000000000001';
select pg_temp.v12_as('10000000-0000-0000-0000-000000000001');
do $$
begin
  perform pg_temp.v12_check('q_assinatura_vencida_nega_a_cota_de_ia_com_a_frase_exata',
    pg_temp.v12_msg($q$select public.zt_consume_ai_quota('20000000-0000-0000-0000-000000000001')$q$)='42501|Assinatura sem acesso à IA', null);
  perform pg_temp.v12_check('q_assinatura_vencida_nega_a_cota_de_pdf_com_a_frase_exata',
    pg_temp.v12_msg($q$select public.zt_consume_quote_pdf_quota('20000000-0000-0000-0000-000000000001')$q$)='42501|Assinatura inativa', null);
end $$;
reset role;
-- Muitos PDFs em pouco tempo: trinta no minuto passam, o trigésimo primeiro é recusado.
update public.subscriptions set current_period_end = current_date + 30 where company_id='20000000-0000-0000-0000-000000000001';
select pg_temp.v12_as('10000000-0000-0000-0000-000000000001');
do $$
declare i int; v_last text:='ok';
begin
  for i in 1..30 loop
    v_last := pg_temp.v12_state($q$select public.zt_consume_quote_pdf_quota('20000000-0000-0000-0000-000000000001')$q$);
    exit when v_last <> 'ok';
  end loop;
  perform pg_temp.v12_check('q_trinta_pdfs_por_minuto_passam', v_last='ok', v_last);
  perform pg_temp.v12_check('q_pdf_31_no_minuto_e_recusado_com_a_frase_exata',
    pg_temp.v12_msg($q$select public.zt_consume_quote_pdf_quota('20000000-0000-0000-0000-000000000001')$q$)='P0001|Muitos PDFs em pouco tempo. Aguarde um minuto', null);
end $$;
reset role;
insert into public.document_usage_events(user_id,company_id,kind,created_at)
select '10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','quote_pdf', now()-interval '2 hours' from generate_series(1,300);
select pg_temp.v12_as('10000000-0000-0000-0000-000000000002');
do $$
begin
  perform pg_temp.v12_check('q_pdf_301_no_dia_e_recusado_com_a_frase_exata',
    pg_temp.v12_msg($q$select public.zt_consume_quote_pdf_quota('20000000-0000-0000-0000-000000000002')$q$)='P0001|Limite diário de PDFs atingido', null);
end $$;

-- ---------------------------------------------------------------- 5. anônimo
select pg_temp.v12_anon();
do $$
begin
  perform pg_temp.v12_check('anon_nao_consome_cota_nem_registra_evidencia_nem_usa_a_0111',
    pg_temp.v12_state($q$select public.zt_consume_ai_quota('20000000-0000-0000-0000-000000000001')$q$)='42501'
    and pg_temp.v12_state($q$select public.zt_consume_quote_pdf_quota('20000000-0000-0000-0000-000000000001')$q$)='42501'
    and pg_temp.v12_state($q$select public.zt_register_work_order_evidence('20000000-0000-0000-0000-000000000001','e1200000-0000-4000-8000-0000000000a1','x','x.jpg','image/jpeg',1,'before',null,null,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')$q$)='42501'
    and pg_temp.v12_state($q$select public.zt_work_order_report_facts('e1200000-0000-4000-8000-0000000000a1')$q$)='42501'
    and pg_temp.v12_state($q$update public.company_members set status='disabled'$q$)='42501', null);
end $$;
reset role;

-- ---------------------------------------------------------------- 6. a empresa B e os perfis da vítima não mudaram
do $$
declare b record; v_members bigint; v_mh text; v_wh text; v_ph text;
begin
  select * into b from v12_before;
  select count(*) into v_members from public.company_members where company_id='20000000-0000-0000-0000-000000000002';
  select md5(string_agg(m::text, '|' order by m.id)) into v_mh from public.company_members m where company_id='20000000-0000-0000-0000-000000000002';
  select md5(string_agg(w::text, '|' order by w.id)) into v_wh from public.work_orders w where company_id='20000000-0000-0000-0000-000000000002';
  select md5(string_agg(p::text, '|' order by p.id)) into v_ph from public.profiles p where p.id in ('10000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000004');
  perform pg_temp.v12_check('z_empresa_b_e_perfis_da_vitima_intactos_depois_de_todos_os_ataques',
    v_members=b.members_b and v_mh=b.members_hash_b and v_wh=b.work_orders_hash_b and v_ph=b.profiles_hash, null);
  perform pg_temp.v12_check('z_nenhuma_evidencia_gravada_na_empresa_b',
    (select count(*) from public.attachments where company_id='20000000-0000-0000-0000-000000000002' and path like '%'||repeat('a',64)||'%')=0, null);
end $$;

do $$
declare v_failures text;
begin
  select string_agg(name||' => '||coalesce(detail,''),' ; ' order by name) into v_failures from v12_results where not ok;
  if v_failures is not null then raise exception 'RELEASE_HARDENING_V12_FAILED: %', v_failures; end if;
  if (select count(*) from v12_results) <> 55 then
    raise exception 'RELEASE_HARDENING_V12_INCOMPLETE: % checks', (select count(*) from v12_results);
  end if;
end $$;

select 'RELEASE_HARDENING_V12' as test, count(*) as checks, bool_and(ok) as all_ok from v12_results;

rollback;
