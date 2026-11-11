-- ZiisTec CENTRAL TÉCNICA V1 (0113-0115) — matriz de isolamento multiempresa.
-- Anônimo não alcança nada; Owner A cria e lê o próprio conteúdo e a biblioteca
-- global; Technician A consulta sem administrar a biblioteca; Owner B e
-- Technician B não alcançam nada privado da Empresa A por SELECT, UPDATE, RPC,
-- JOIN, busca ou Storage; escrita de conteúdo GLOBAL só com platform admin AAL2;
-- ficha rápida inválida é recusada; a unidade física não pode ser vinculada à OS
-- de outro cliente; os casos não trazem PII nem valor financeiro.
-- Usa as identidades de ci_local_seed.sql. Destino: SOMENTE CI descartável.
-- Tudo termina em ROLLBACK.

begin;

create temp table zt_ct_results (name text primary key, ok boolean not null, detail text) on commit drop;
grant select, insert, update on zt_ct_results to authenticated, anon;

create function pg_temp.ct_check(p_name text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into zt_ct_results(name,ok,detail) values(p_name,coalesce(p_ok,false),left(p_detail,500));
$$;

-- Executa no papel atual; devolve 'ok' ou o SQLSTATE do bloqueio.
create function pg_temp.ct_state(p_sql text)
returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate;
end $$;

-- Linhas visíveis no papel atual; erro (sem privilégio) vira -1.
create function pg_temp.ct_count(p_sql text)
returns bigint language plpgsql as $$
declare n bigint;
begin
  execute 'select count(*) from ('||p_sql||') q' into n;
  return n;
exception when others then
  return -1;
end $$;

create function pg_temp.ct_as(p_uid uuid, p_aal text default 'aal1')
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claim.sub',p_uid::text,true);
  perform set_config('request.jwt.claims',json_build_object('sub',p_uid,'role','authenticated','aal',p_aal)::text,true);
  set local role authenticated;
end $$;

create function pg_temp.ct_anon()
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims','',true);
  set local role anon;
end $$;

grant execute on function pg_temp.ct_check(text,boolean,text), pg_temp.ct_state(text),
  pg_temp.ct_count(text), pg_temp.ct_as(uuid,text), pg_temp.ct_anon() to authenticated, anon;

-- ---------------------------------------------------------------- fixtures
-- As tabelas operacionais têm guard de assinatura, que exige identidade; os
-- fixtures entram com a claim do owner (sem trocar de papel, como nos demais
-- testes do repositório) para que auth.uid() exista.
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal1"}',true);

-- Technician B não existe no seed; entra aqui, dentro do rollback.
insert into public.company_members(company_id,user_id,role,status,job_title)
values ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000004','technician','active','CI Tech B')
on conflict (company_id,user_id) do update set role='technician',status='active';

-- Cliente, OS e unidade física da Empresa A (para o cenário de manutenção).
insert into public.clients(id,company_id,person_type,name,phone,address,tax_id)
values ('c7000000-0000-4000-8000-000000000001','20000000-0000-0000-0000-000000000001','PF',
        'Cliente Sigiloso CT','11999990000','Rua Secreta 123','12345678901');

insert into public.products(id,company_id,name,brand,model,unit,cost,price,warranty_months,active)
values ('c7000000-0000-4000-8000-00000000a001'::uuid,'20000000-0000-0000-0000-000000000001',
        'Fechadura Demo CT-100','Fabricante Demo','CT-100','unidade',300,699,12,true);

insert into public.work_orders(id,company_id,number,client_id,assigned_to,status,address,service_place,request,problem_report)
values ('c7000000-0000-4000-8000-00000000b001'::uuid,'20000000-0000-0000-0000-000000000001','CI-CT-001',
        'c7000000-0000-4000-8000-000000000001','10000000-0000-0000-0000-000000000003','in_progress',
        'Rua Secreta 123','Portaria','Fechadura não abre com tag','Fechadura não abre com tag');

-- OS e cliente da Empresa B (para provar que a unidade de outro cliente é negada).
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal1"}',true);
insert into public.clients(id,company_id,person_type,name)
values ('c7000000-0000-4000-8000-000000000002','20000000-0000-0000-0000-000000000002','PF','Cliente B CT');
insert into public.work_orders(id,company_id,number,client_id,status,request)
values ('c7000000-0000-4000-8000-00000000b002'::uuid,'20000000-0000-0000-0000-000000000002','CI-CT-002',
        'c7000000-0000-4000-8000-000000000002','in_progress','Portão travado');

select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal1"}',true);

-- ============================================================== ANÔNIMO = 0
do $$
begin
  perform pg_temp.ct_anon();
  perform pg_temp.ct_check('anon_nao_le_categorias',
    pg_temp.ct_count('select 1 from public.equipment_categories')=-1,null);
  perform pg_temp.ct_check('anon_nao_le_fabricantes',
    pg_temp.ct_count('select 1 from public.equipment_manufacturers')=-1,null);
  perform pg_temp.ct_check('anon_nao_le_modelos',
    pg_temp.ct_count('select 1 from public.equipment_models')=-1,null);
  perform pg_temp.ct_check('anon_nao_le_fichas',
    pg_temp.ct_count('select 1 from public.equipment_quick_guides')=-1,null);
  perform pg_temp.ct_check('anon_nao_le_documentos',
    pg_temp.ct_count('select 1 from public.equipment_documents')=-1,null);
  perform pg_temp.ct_check('anon_nao_le_vinculo_de_os',
    pg_temp.ct_count('select 1 from public.work_order_equipment')=-1,null);
  perform pg_temp.ct_check('anon_nao_busca',
    pg_temp.ct_state($q$select public.zt_equipment_search('20000000-0000-0000-0000-000000000001','teste')$q$)<>'ok',null);
  perform pg_temp.ct_check('anon_nao_le_casos',
    pg_temp.ct_state($q$select public.zt_equipment_cases('20000000-0000-0000-0000-000000000001',gen_random_uuid())$q$)<>'ok',null);
  perform pg_temp.ct_check('anon_nao_conta_casos',
    pg_temp.ct_state($q$select public.zt_equipment_cases_count('20000000-0000-0000-0000-000000000001',gen_random_uuid())$q$)<>'ok',null);
end $$;
reset role;

-- ====================================================== OWNER A cria conteúdo
do $$
declare
  v_cat uuid;
  v_mfr uuid;
  v_model uuid;
begin
  perform pg_temp.ct_as('10000000-0000-0000-0000-000000000001');

  insert into public.equipment_manufacturers(company_id,name,website,created_by)
  values ('20000000-0000-0000-0000-000000000001','Fabricante Demo','https://exemplo.invalid',
          '10000000-0000-0000-0000-000000000001')
  returning id into v_mfr;

  insert into public.equipment_categories(company_id,name,slug,created_by)
  values ('20000000-0000-0000-0000-000000000001','Controle interno CT','controle-interno-ct',
          '10000000-0000-0000-0000-000000000001')
  returning id into v_cat;

  insert into public.equipment_models(company_id,manufacturer_id,category_id,name,model_code,description,tags,created_by)
  values ('20000000-0000-0000-0000-000000000001',v_mfr,v_cat,'CT-100','CT 100',
          'Fechadura eletrônica de demonstração',array['fechadura','acesso'],
          '10000000-0000-0000-0000-000000000001')
  returning id into v_model;

  insert into public.equipment_quick_guides(company_id,model_id,sections,created_by)
  values ('20000000-0000-0000-0000-000000000001',v_model,
    '[{"kind":"power","title":"Alimentação","items":[{"label":"Tensão","value":"12 VDC"}]},
      {"kind":"reset","title":"Reset total","items":[{"label":"Procedimento","steps":["Desligue a fonte","Mantenha o botão por 10 segundos"]}]},
      {"kind":"codes","title":"Códigos","items":[{"code":"E4","meaning":"Sensor de porta aberto","action":"Conferir o chicote"}]}]'::jsonb,
    '10000000-0000-0000-0000-000000000001');

  insert into public.equipment_documents(company_id,model_id,title,doc_type,source_kind,official_url,created_by)
  values ('20000000-0000-0000-0000-000000000001',v_model,'Manual CT-100','manual','official_url',
          'https://exemplo.invalid/ct100.pdf','10000000-0000-0000-0000-000000000001');

  perform pg_temp.ct_check('owner_a_ve_biblioteca_global',
    pg_temp.ct_count('select 1 from public.equipment_categories where company_id is null')>=11,null);
  perform pg_temp.ct_check('owner_a_ve_o_proprio_modelo',
    pg_temp.ct_count('select 1 from public.equipment_models')=1,null);
  perform pg_temp.ct_check('owner_a_ve_a_propria_ficha',
    pg_temp.ct_count('select 1 from public.equipment_quick_guides')=1,null);

  -- escrita de conteúdo GLOBAL negada para owner comum
  perform pg_temp.ct_check('owner_a_nao_cria_categoria_global',
    pg_temp.ct_state($q$insert into public.equipment_categories(company_id,name,slug) values (null,'Hack CT','hack-ct')$q$)<>'ok',null);
  perform pg_temp.ct_check('owner_a_nao_cria_fabricante_global',
    pg_temp.ct_state($q$insert into public.equipment_manufacturers(company_id,name) values (null,'Hack Fab')$q$)<>'ok',null);
  perform pg_temp.ct_check('owner_a_nao_cria_modelo_global',
    pg_temp.ct_state(format($q$insert into public.equipment_models(company_id,manufacturer_id,category_id,name) values (null,%L,%L,'Global falso')$q$,v_mfr,v_cat))<>'ok',null);

  -- edição de conteúdo global: RLS filtra a linha, UPDATE não afeta nada
  update public.equipment_categories set name='Renomeada' where company_id is null and slug='fechaduras';
  perform pg_temp.ct_check('owner_a_nao_altera_categoria_global',
    (select name from public.equipment_categories where company_id is null and slug='fechaduras')='Fechaduras',null);
  -- nem promove conteúdo próprio a global
  perform pg_temp.ct_check('owner_a_nao_promove_modelo_a_global',
    pg_temp.ct_state(format($q$update public.equipment_models set company_id=null where id=%L$q$,v_model))<>'ok'
    or (select company_id from public.equipment_models where id=v_model) is not null,null);

  -- ficha rápida inválida é recusada pelo banco
  perform pg_temp.ct_check('ficha_sem_lista_de_secoes_recusada',
    pg_temp.ct_state(format($q$insert into public.equipment_quick_guides(company_id,model_id,sections) values ('20000000-0000-0000-0000-000000000001',%L,'{"solto":"blob"}'::jsonb)$q$,v_model))<>'ok',null);
  perform pg_temp.ct_check('ficha_com_tipo_de_secao_invalido_recusada',
    pg_temp.ct_state(format($q$insert into public.equipment_quick_guides(company_id,model_id,sections) values ('20000000-0000-0000-0000-000000000001',%L,'[{"kind":"invalido","title":"x","items":[{"label":"a","value":"b"}]}]'::jsonb)$q$,v_model))<>'ok',null);
  perform pg_temp.ct_check('ficha_com_campo_de_item_nao_permitido_recusada',
    pg_temp.ct_state(format($q$insert into public.equipment_quick_guides(company_id,model_id,sections) values ('20000000-0000-0000-0000-000000000001',%L,'[{"kind":"power","title":"x","items":[{"preco":"100"}]}]'::jsonb)$q$,v_model))<>'ok',null);

  -- documento sem link nem arquivo é recusado pela forma da origem
  perform pg_temp.ct_check('documento_sem_origem_valida_recusado',
    pg_temp.ct_state(format($q$insert into public.equipment_documents(company_id,model_id,title,source_kind) values ('20000000-0000-0000-0000-000000000001',%L,'Sem origem','official_url')$q$,v_model))<>'ok',null);
  -- link não-https é recusado
  perform pg_temp.ct_check('documento_com_link_http_recusado',
    pg_temp.ct_state(format($q$insert into public.equipment_documents(company_id,model_id,title,source_kind,official_url) values ('20000000-0000-0000-0000-000000000001',%L,'Inseguro','official_url','http://exemplo.invalid/a.pdf')$q$,v_model))<>'ok',null);
end $$;
reset role;

-- ====================================== escrita global só com platform admin AAL2
do $$
begin
  update public.profiles set is_platform_admin=true where id='10000000-0000-0000-0000-000000000004';
  -- mesmo platform admin, com AAL1 não escreve global
  perform pg_temp.ct_as('10000000-0000-0000-0000-000000000004','aal1');
  perform pg_temp.ct_check('platform_admin_aal1_nao_escreve_global',
    pg_temp.ct_state($q$insert into public.equipment_categories(company_id,name,slug) values (null,'Global AAL1','global-aal1')$q$)<>'ok',null);
  reset role;
  -- com AAL2, escreve: é o caminho administrativo previsto
  perform pg_temp.ct_as('10000000-0000-0000-0000-000000000004','aal2');
  perform pg_temp.ct_check('platform_admin_aal2_escreve_global',
    pg_temp.ct_state($q$insert into public.equipment_categories(company_id,name,slug) values (null,'Global AAL2 CT','global-aal2-ct')$q$)='ok',null);
  reset role;
  update public.profiles set is_platform_admin=false where id='10000000-0000-0000-0000-000000000004';
end $$;
reset role;

-- ============================================== TECHNICIAN A: consulta, não administra
do $$
declare v_model uuid;
begin
  select id into v_model from public.equipment_models where company_id='20000000-0000-0000-0000-000000000001' and name='CT-100';
  perform pg_temp.ct_as('10000000-0000-0000-0000-000000000003');

  perform pg_temp.ct_check('tecnico_a_ve_modelo_da_empresa',
    pg_temp.ct_count('select 1 from public.equipment_models')=1,null);
  perform pg_temp.ct_check('tecnico_a_ve_ficha_da_empresa',
    pg_temp.ct_count('select 1 from public.equipment_quick_guides')=1,null);
  perform pg_temp.ct_check('tecnico_a_ve_documento_autorizado',
    pg_temp.ct_count('select 1 from public.equipment_documents')=1,null);
  perform pg_temp.ct_check('tecnico_a_busca_por_nome',
    pg_temp.ct_count($q$select 1 from public.zt_equipment_search('20000000-0000-0000-0000-000000000001','CT 100')$q$)=1,null);
  perform pg_temp.ct_check('tecnico_a_busca_por_codigo_compacto',
    pg_temp.ct_count($q$select 1 from public.zt_equipment_search('20000000-0000-0000-0000-000000000001','CT100')$q$)=1,null);
  perform pg_temp.ct_check('tecnico_a_busca_por_codigo_de_erro_da_ficha',
    pg_temp.ct_count($q$select 1 from public.zt_equipment_search('20000000-0000-0000-0000-000000000001','E4')$q$)=1,null);
  perform pg_temp.ct_check('tecnico_a_busca_por_tag',
    pg_temp.ct_count($q$select 1 from public.zt_equipment_search('20000000-0000-0000-0000-000000000001','fechadura')$q$)=1,null);
  perform pg_temp.ct_check('busca_ignora_acento',
    pg_temp.ct_count($q$select 1 from public.zt_equipment_search('20000000-0000-0000-0000-000000000001','eletrônica')$q$)=1,null);
  perform pg_temp.ct_check('busca_com_dois_termos_exige_os_dois',
    pg_temp.ct_count($q$select 1 from public.zt_equipment_search('20000000-0000-0000-0000-000000000001','fechadura demonstracao')$q$)=1
    and pg_temp.ct_count($q$select 1 from public.zt_equipment_search('20000000-0000-0000-0000-000000000001','fechadura inexistente')$q$)=0,null);
  perform pg_temp.ct_check('busca_vazia_nao_devolve_tudo',
    pg_temp.ct_count($q$select 1 from public.zt_equipment_search('20000000-0000-0000-0000-000000000001','   ')$q$)=0,null);
  perform pg_temp.ct_check('busca_com_injecao_nao_quebra',
    pg_temp.ct_count($q$select 1 from public.zt_equipment_search('20000000-0000-0000-0000-000000000001','''; drop table public.equipment_models;--')$q$)=0,null);
  perform pg_temp.ct_check('busca_com_simbolos_nao_quebra',
    pg_temp.ct_count($q$select 1 from public.zt_equipment_search('20000000-0000-0000-0000-000000000001','%_\ ( ) : *')$q$)>=0,null);

  -- não administra a biblioteca
  perform pg_temp.ct_check('tecnico_a_nao_cria_fabricante',
    pg_temp.ct_state($q$insert into public.equipment_manufacturers(company_id,name) values ('20000000-0000-0000-0000-000000000001','Tentativa Tech')$q$)<>'ok',null);
  perform pg_temp.ct_check('tecnico_a_nao_cria_modelo',
    pg_temp.ct_state($q$insert into public.equipment_models(company_id,manufacturer_id,category_id,name) select '20000000-0000-0000-0000-000000000001',manufacturer_id,category_id,'Tech model' from public.equipment_models limit 1$q$)<>'ok',null);
  update public.equipment_quick_guides set title='hack' where model_id=v_model;
  perform pg_temp.ct_check('tecnico_a_nao_edita_ficha',
    (select title from public.equipment_quick_guides where model_id=v_model)='Ficha rápida',null);
  delete from public.equipment_documents where model_id=v_model;
  perform pg_temp.ct_check('tecnico_a_nao_apaga_documento',
    pg_temp.ct_count('select 1 from public.equipment_documents')=1,null);

  -- favoritos e recentes: só em nome próprio
  perform pg_temp.ct_check('tecnico_a_favorita_para_si',
    pg_temp.ct_state(format($q$insert into public.equipment_favorites(user_id,company_id,model_id) values ('10000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001',%L)$q$,v_model))='ok',null);
  perform pg_temp.ct_check('tecnico_a_nao_favorita_por_outro_usuario',
    pg_temp.ct_state(format($q$insert into public.equipment_favorites(user_id,company_id,model_id) values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',%L)$q$,v_model))<>'ok',null);
  perform pg_temp.ct_check('tecnico_a_nao_favorita_em_outra_empresa',
    pg_temp.ct_state(format($q$insert into public.equipment_favorites(user_id,company_id,model_id) values ('10000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000002',%L)$q$,v_model))<>'ok',null);

  -- vincula equipamento à própria OS aberta (cenário B: só o modelo)
  perform pg_temp.ct_check('tecnico_a_vincula_modelo_na_propria_os',
    pg_temp.ct_state(format($q$insert into public.work_order_equipment(company_id,work_order_id,model_id,notes,created_by) values ('20000000-0000-0000-0000-000000000001','c7000000-0000-4000-8000-00000000b001',%L,'fechadura da portaria','10000000-0000-0000-0000-000000000003')$q$,v_model))='ok',null);
  perform pg_temp.ct_check('tecnico_a_nao_vincula_com_autoria_de_outro',
    pg_temp.ct_state(format($q$insert into public.work_order_equipment(company_id,work_order_id,model_id,created_by) values ('20000000-0000-0000-0000-000000000001','c7000000-0000-4000-8000-00000000b001',%L,'10000000-0000-0000-0000-000000000001')$q$,v_model))<>'ok',null);
end $$;
reset role;

-- =========================================== OWNER B e TECHNICIAN B: zero acesso
do $$
declare v_model_a uuid;
begin
  select id into v_model_a from public.equipment_models where company_id='20000000-0000-0000-0000-000000000001' and name='CT-100';

  perform pg_temp.ct_as('10000000-0000-0000-0000-000000000002');
  perform pg_temp.ct_check('owner_b_nao_ve_modelo_da_a',
    pg_temp.ct_count('select 1 from public.equipment_models where company_id=''20000000-0000-0000-0000-000000000001''')=0,null);
  perform pg_temp.ct_check('owner_b_nao_ve_ficha_da_a',
    pg_temp.ct_count('select 1 from public.equipment_quick_guides')=0,null);
  perform pg_temp.ct_check('owner_b_nao_ve_documento_da_a',
    pg_temp.ct_count('select 1 from public.equipment_documents')=0,null);
  perform pg_temp.ct_check('owner_b_nao_ve_vinculo_da_a',
    pg_temp.ct_count('select 1 from public.work_order_equipment')=0,null);
  perform pg_temp.ct_check('owner_b_ve_biblioteca_global',
    pg_temp.ct_count('select 1 from public.equipment_categories where company_id is null')>=11,null);
  update public.equipment_models set name='invadido' where id=v_model_a;
  perform pg_temp.ct_check('owner_b_nao_altera_modelo_da_a',
    pg_temp.ct_count(format('select 1 from public.equipment_models where id=%L and name=''invadido''',v_model_a))=0,null);
  perform pg_temp.ct_check('owner_b_nao_busca_no_tenant_a',
    pg_temp.ct_state($q$select public.zt_equipment_search('20000000-0000-0000-0000-000000000001','CT')$q$)<>'ok',null);
  perform pg_temp.ct_check('busca_da_b_nao_devolve_modelo_da_a',
    pg_temp.ct_count($q$select 1 from public.zt_equipment_search('20000000-0000-0000-0000-000000000002','CT 100')$q$)=0,null);
  perform pg_temp.ct_check('owner_b_nao_le_casos_da_a',
    pg_temp.ct_state(format($q$select public.zt_equipment_cases('20000000-0000-0000-0000-000000000001',%L)$q$,v_model_a))<>'ok',null);
  perform pg_temp.ct_check('owner_b_nao_conta_casos_da_a',
    pg_temp.ct_state(format($q$select public.zt_equipment_cases_count('20000000-0000-0000-0000-000000000001',%L)$q$,v_model_a))<>'ok',null);
  perform pg_temp.ct_check('owner_b_nao_vincula_modelo_da_a_na_propria_os',
    pg_temp.ct_state(format($q$insert into public.work_order_equipment(company_id,work_order_id,model_id) values ('20000000-0000-0000-0000-000000000002','c7000000-0000-4000-8000-00000000b002',%L)$q$,v_model_a))<>'ok',null);
  perform pg_temp.ct_check('owner_b_nao_vincula_na_os_da_a',
    pg_temp.ct_state(format($q$insert into public.work_order_equipment(company_id,work_order_id,model_id) values ('20000000-0000-0000-0000-000000000001','c7000000-0000-4000-8000-00000000b001',%L)$q$,v_model_a))<>'ok',null);
  reset role;

  perform pg_temp.ct_as('10000000-0000-0000-0000-000000000004');
  perform pg_temp.ct_check('tecnico_b_nao_ve_ficha_da_a',
    pg_temp.ct_count('select 1 from public.equipment_quick_guides')=0,null);
  perform pg_temp.ct_check('tecnico_b_nao_ve_vinculo_da_a',
    pg_temp.ct_count('select 1 from public.work_order_equipment')=0,null);
  perform pg_temp.ct_check('tecnico_b_nao_le_casos_da_a',
    pg_temp.ct_state(format($q$select public.zt_equipment_cases('20000000-0000-0000-0000-000000000001',%L)$q$,v_model_a))<>'ok',null);
end $$;
reset role;

-- ================================ unidade física: mesma empresa E mesmo cliente
do $$
declare
  v_model uuid;
  v_unit uuid := 'c7000000-0000-4000-8000-00000000c001';
begin
  select id into v_model from public.equipment_models where company_id='20000000-0000-0000-0000-000000000001' and name='CT-100';

  -- unidade física da Empresa A, cliente A (inserida como postgres: 0083 não dá
  -- escrita direta ao navegador; o caminho real é a RPC de registro).
  insert into public.client_locations(id,company_id,client_id,name,location_key)
  values ('c7000000-0000-4000-8000-00000000d001','20000000-0000-0000-0000-000000000001',
          'c7000000-0000-4000-8000-000000000001','Portaria','portaria');
  -- a 0083 exige exatamente uma origem (material ou item) para a unidade física
  insert into public.work_order_materials(
    id,work_order_id,company_id,product_id,name,quantity,unit_cost,serial_number,created_by)
  values ('c7000000-0000-4000-8000-00000000a002','c7000000-0000-4000-8000-00000000b001',
          '20000000-0000-0000-0000-000000000001','c7000000-0000-4000-8000-00000000a001',
          'Fechadura Demo CT-100',1,0,'SN-CT-0001','10000000-0000-0000-0000-000000000001');
  insert into public.installed_equipment(
    id,company_id,client_id,client_location_id,work_order_id,product_id,name,brand,model,
    serial_number,installed_at,registration_key,source_material_id,source_item_id)
  values (v_unit,'20000000-0000-0000-0000-000000000001','c7000000-0000-4000-8000-000000000001',
          'c7000000-0000-4000-8000-00000000d001','c7000000-0000-4000-8000-00000000b001',
          'c7000000-0000-4000-8000-00000000a001','Fechadura Demo CT-100','Fabricante Demo','CT-100',
          'SN-CT-0001',now(),'ci:ct:unit:1','c7000000-0000-4000-8000-00000000a002',null);

  perform pg_temp.ct_check('coluna_de_modelo_tecnico_existe_na_unidade',
    exists(select 1 from information_schema.columns
            where table_schema='public' and table_name='installed_equipment'
              and column_name='equipment_model_id'),null);

  -- identificar o modelo da unidade: owner pode, pela RPC
  perform pg_temp.ct_as('10000000-0000-0000-0000-000000000001');
  perform pg_temp.ct_check('owner_a_identifica_modelo_da_unidade',
    pg_temp.ct_state(format($q$select public.zt_set_installed_equipment_model(%L,%L)$q$,v_unit,v_model))='ok',null);
  reset role;
  perform pg_temp.ct_check('modelo_tecnico_gravado_na_unidade',
    (select equipment_model_id from public.installed_equipment where id=v_unit)=v_model,null);

  -- owner B não identifica modelo em unidade da A
  perform pg_temp.ct_as('10000000-0000-0000-0000-000000000002');
  perform pg_temp.ct_check('owner_b_nao_identifica_modelo_na_unidade_da_a',
    pg_temp.ct_state(format($q$select public.zt_set_installed_equipment_model(%L,%L)$q$,v_unit,v_model))<>'ok',null);
  reset role;

  -- vincular a unidade à OS do MESMO cliente funciona (cenário A: manutenção)
  perform pg_temp.ct_as('10000000-0000-0000-0000-000000000001');
  perform pg_temp.ct_check('owner_a_vincula_unidade_fisica_na_os_do_mesmo_cliente',
    pg_temp.ct_state(format($q$insert into public.work_order_equipment(company_id,work_order_id,model_id,installed_equipment_id,created_by) values ('20000000-0000-0000-0000-000000000001','c7000000-0000-4000-8000-00000000b001',%L,%L,'10000000-0000-0000-0000-000000000001')$q$,v_model,v_unit))='ok',null);
  reset role;

  -- OS de outro cliente da MESMA empresa: negado pelo guard
  insert into public.clients(id,company_id,person_type,name)
  values ('c7000000-0000-4000-8000-000000000003','20000000-0000-0000-0000-000000000001','PF','Outro Cliente A');
  insert into public.work_orders(id,company_id,number,client_id,status,request)
  values ('c7000000-0000-4000-8000-00000000b003','20000000-0000-0000-0000-000000000001','CI-CT-003',
          'c7000000-0000-4000-8000-000000000003','in_progress','Outro atendimento');
  perform pg_temp.ct_as('10000000-0000-0000-0000-000000000001');
  perform pg_temp.ct_check('unidade_de_outro_cliente_nao_entra_na_os',
    pg_temp.ct_state(format($q$insert into public.work_order_equipment(company_id,work_order_id,model_id,installed_equipment_id,created_by) values ('20000000-0000-0000-0000-000000000001','c7000000-0000-4000-8000-00000000b003',%L,%L,'10000000-0000-0000-0000-000000000001')$q$,v_model,v_unit))<>'ok',null);
  reset role;

  -- unidade já identificada com um modelo não aceita vínculo com modelo diferente
  insert into public.equipment_manufacturers(id,company_id,name)
  values ('c7000000-0000-4000-8000-00000000e002','20000000-0000-0000-0000-000000000001','Outro Fabricante CT');
  insert into public.equipment_models(id,company_id,manufacturer_id,category_id,name)
  select 'c7000000-0000-4000-8000-00000000f002','20000000-0000-0000-0000-000000000001',
         'c7000000-0000-4000-8000-00000000e002',category_id,'CT-200'
    from public.equipment_models where id=v_model;
  perform pg_temp.ct_as('10000000-0000-0000-0000-000000000001');
  perform pg_temp.ct_check('unidade_identificada_nao_aceita_modelo_divergente',
    pg_temp.ct_state(format($q$insert into public.work_order_equipment(company_id,work_order_id,model_id,installed_equipment_id,created_by) values ('20000000-0000-0000-0000-000000000001','c7000000-0000-4000-8000-00000000b001','c7000000-0000-4000-8000-00000000f002',%L,'10000000-0000-0000-0000-000000000001')$q$,v_unit))<>'ok',null);
  reset role;

  -- remover a unidade física não trava por FK: o vínculo àquela unidade sai
  -- junto e o vínculo de conhecimento (só modelo) continua.
  perform pg_temp.ct_check('remocao_da_unidade_nao_trava_por_fk',
    pg_temp.ct_state(format($q$delete from public.installed_equipment where id=%L$q$,v_unit))='ok',null);
  perform pg_temp.ct_check('vinculo_da_unidade_sai_com_a_unidade',
    pg_temp.ct_count(format($q$select 1 from public.work_order_equipment where installed_equipment_id=%L$q$,v_unit))=0,null);
  perform pg_temp.ct_check('vinculo_de_modelo_sobrevive_a_remocao_da_unidade',
    pg_temp.ct_count($q$select 1 from public.work_order_equipment where work_order_id='c7000000-0000-4000-8000-00000000b001' and installed_equipment_id is null$q$)=1,null);
end $$;
reset role;

-- ================================================= Storage: caminho por tenant
do $$
begin
  perform pg_temp.ct_check('bucket_de_documento_tecnico_e_privado',
    (select not public and file_size_limit=52428800 from storage.buckets where id='zt-equipment-docs'),null);

  insert into storage.objects(bucket_id,name,owner)
  values ('zt-equipment-docs','20000000-0000-0000-0000-000000000001/equipment/ct/manual.pdf',
          '10000000-0000-0000-0000-000000000001');

  perform pg_temp.ct_as('10000000-0000-0000-0000-000000000003');
  perform pg_temp.ct_check('tecnico_a_le_documento_da_empresa_no_bucket',
    pg_temp.ct_count($q$select 1 from storage.objects where bucket_id='zt-equipment-docs'$q$)=1,null);
  perform pg_temp.ct_check('tecnico_a_nao_grava_no_bucket',
    pg_temp.ct_state($q$insert into storage.objects(bucket_id,name,owner) values ('zt-equipment-docs','20000000-0000-0000-0000-000000000001/equipment/ct/tech.pdf','10000000-0000-0000-0000-000000000003')$q$)<>'ok',null);
  reset role;

  perform pg_temp.ct_as('10000000-0000-0000-0000-000000000002');
  perform pg_temp.ct_check('owner_b_nao_le_documento_da_a_no_bucket',
    pg_temp.ct_count($q$select 1 from storage.objects where bucket_id='zt-equipment-docs'$q$)=0,null);
  perform pg_temp.ct_check('owner_b_nao_grava_em_caminho_da_a',
    pg_temp.ct_state($q$insert into storage.objects(bucket_id,name,owner) values ('zt-equipment-docs','20000000-0000-0000-0000-000000000001/equipment/ct/intruso.pdf','10000000-0000-0000-0000-000000000002')$q$)<>'ok',null);
  reset role;

  perform pg_temp.ct_anon();
  perform pg_temp.ct_check('anon_nao_le_bucket_de_documento_tecnico',
    pg_temp.ct_count($q$select 1 from storage.objects where bucket_id='zt-equipment-docs'$q$)<=0,null);
end $$;
reset role;

-- ============================================ contratos estruturais do schema
do $$
declare v_bad text;
begin
  -- toda tabela nova com RLS
  select string_agg(c.relname,', ') into v_bad
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind='r' and not c.relrowsecurity
     and c.relname in ('equipment_categories','equipment_manufacturers','equipment_models',
       'equipment_documents','equipment_quick_guides','equipment_favorites',
       'equipment_recent_views','company_technical_areas','work_order_equipment');
  perform pg_temp.ct_check('tabelas_novas_com_rls',v_bad is null,v_bad);

  -- nenhum privilégio para anon
  select string_agg(table_name,', ') into v_bad
    from information_schema.role_table_grants
   where grantee='anon' and table_schema='public'
     and table_name in ('equipment_categories','equipment_manufacturers','equipment_models',
       'equipment_documents','equipment_quick_guides','equipment_favorites',
       'equipment_recent_views','company_technical_areas','work_order_equipment');
  perform pg_temp.ct_check('nenhum_privilegio_para_anon',v_bad is null,v_bad);

  -- RPCs novas: definer com search_path vazio
  select string_agg(p.proname,', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public'
     and p.proname in ('zt_equipment_search','zt_equipment_cases','zt_equipment_cases_count',
       'zt_set_installed_equipment_model','zt_eq_can_read','zt_eq_can_write')
     and not (p.prosecdef and coalesce(array_to_string(p.proconfig,','),'') like '%search_path=%');
  perform pg_temp.ct_check('rpcs_novas_definer_com_search_path_fixo',v_bad is null,v_bad);

  -- RPCs novas não são executáveis por anon
  select string_agg(p.proname,', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public'
     and p.proname in ('zt_equipment_search','zt_equipment_cases','zt_equipment_cases_count',
       'zt_set_installed_equipment_model')
     and has_function_privilege('anon',p.oid,'execute');
  perform pg_temp.ct_check('rpcs_novas_sem_execute_para_anon',v_bad is null,v_bad);

  -- guard de assinatura nas tabelas de escrita da empresa
  select string_agg(t.tbl,', ') into v_bad
    from (values ('equipment_categories'),('equipment_manufacturers'),('equipment_models'),
                 ('equipment_documents'),('equipment_quick_guides'),('company_technical_areas'),
                 ('work_order_equipment')) t(tbl)
   where not exists (
     select 1 from pg_trigger g join pg_class c on c.oid=g.tgrelid
      where c.relname=t.tbl and g.tgname='trg_subscription_write_guard' and not g.tgisinternal);
  perform pg_temp.ct_check('guard_de_assinatura_nas_tabelas_novas',v_bad is null,v_bad);

  -- work_order_equipment sem UPDATE para o navegador
  perform pg_temp.ct_check('vinculo_de_os_sem_update_para_authenticated',
    not exists(select 1 from information_schema.role_table_grants
                where grantee='authenticated' and table_name='work_order_equipment'
                  and privilege_type='UPDATE'),null);

  -- a Central Técnica não criou tabela de caso: a Base Técnica segue sendo a fonte
  perform pg_temp.ct_check('central_tecnica_nao_duplica_base_tecnica',
    not exists(select 1 from information_schema.tables
                where table_schema='public'
                  and table_name in ('equipment_cases','equipment_case_notes','central_tecnica_cases')),null);

  -- a Central Técnica não criou segundo conceito de unidade física
  perform pg_temp.ct_check('central_tecnica_nao_duplica_equipamento_instalado',
    not exists(select 1 from information_schema.tables
                where table_schema='public'
                  and table_name in ('equipment_assets','client_assets','central_tecnica_equipment')),null);

  -- nenhuma extensão nova
  perform pg_temp.ct_check('nenhuma_extensao_fora_do_previsto',
    not exists(select 1 from pg_extension where extname not in
      ('pgcrypto','pg_trgm','plpgsql','pg_graphql','pg_stat_statements','pgjwt','uuid-ossp',
       'supabase_vault','pgsodium','pg_net','pgaudit','index_advisor','hypopg','vector')),null);
end $$;

do $$
declare v_failures text;
begin
  select string_agg(name||' => '||coalesce(detail,''),' ; ' order by name) into v_failures
    from zt_ct_results where not ok;
  if v_failures is not null then raise exception 'CENTRAL_TECNICA_RLS_FAILED: %', v_failures; end if;
  if (select count(*) from zt_ct_results) < 60 then
    raise exception 'CENTRAL_TECNICA_RLS_INCOMPLETE: % checks',(select count(*) from zt_ct_results);
  end if;
end $$;

select 'CENTRAL_TECNICA_RLS' as test, count(*) as checks, bool_and(ok) as all_ok from zt_ct_results;

rollback;
