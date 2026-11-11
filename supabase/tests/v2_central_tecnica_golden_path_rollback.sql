-- ZiisTec CENTRAL TÉCNICA V1 (0113-0115) — golden path sobre a arquitetura atual.
-- Empresa -> owner -> técnico -> cliente -> local -> produto -> modelo técnico ->
-- ficha -> documento -> OS -> vínculo do equipamento -> Ajuda Técnica -> execução
-- -> Base Técnica (RPC da 0111) -> conclusão (RPC de finalização com garantias) ->
-- equipamento instalado (RPC da 0083) identificado com o modelo -> caso aparece na
-- Central com causa/solução -> sem PII, sem financeiro -> Empresa B não enxerga ->
-- busca devolve só o autorizado.
-- Usa as identidades de ci_local_seed.sql. Destino: SOMENTE CI descartável.
-- Tudo termina em ROLLBACK.

begin;

create temp table zt_ctg_results (name text primary key, ok boolean not null, detail text) on commit drop;
create temp table zt_ctg_state (k text primary key, v text) on commit drop;
grant select, insert, update on zt_ctg_results, zt_ctg_state to authenticated, anon;

create function pg_temp.g_check(p_name text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into zt_ctg_results(name,ok,detail) values(p_name,coalesce(p_ok,false),left(p_detail,500));
$$;
create function pg_temp.g_put(p_k text, p_v text) returns void language sql as $$
  insert into zt_ctg_state(k,v) values(p_k,p_v) on conflict (k) do update set v=excluded.v;
$$;
create function pg_temp.g_get(p_k text) returns text language sql stable as $$
  select v from zt_ctg_state where k=p_k;
$$;
create function pg_temp.g_state(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql; return 'ok';
exception when others then return sqlstate; end $$;
create function pg_temp.g_count(p_sql text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute 'select count(*) from ('||p_sql||') q' into n; return n;
exception when others then return -1; end $$;
create function pg_temp.g_as(p_uid uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claim.sub',p_uid::text,true);
  perform set_config('request.jwt.claims',json_build_object('sub',p_uid,'role','authenticated','aal','aal1')::text,true);
  set local role authenticated;
end $$;
grant execute on function pg_temp.g_check(text,boolean,text), pg_temp.g_put(text,text),
  pg_temp.g_get(text), pg_temp.g_state(text), pg_temp.g_count(text), pg_temp.g_as(uuid)
  to authenticated, anon;

-- Technician B entra para o teste de isolamento.
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal1"}',true);
insert into public.company_members(company_id,user_id,role,status,job_title)
values ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000004','technician','active','CI Tech B')
on conflict (company_id,user_id) do update set role='technician',status='active';

-- ============================================ 1-6. cliente, local, produto (Owner A)
do $$
begin
  perform pg_temp.g_as('10000000-0000-0000-0000-000000000001');

  insert into public.clients(id,company_id,person_type,name,phone,address,tax_id)
  values ('d1000000-0000-4000-8000-000000000001','20000000-0000-0000-0000-000000000001','PJ',
          'Condomínio Reservado','11988887777','Avenida Confidencial 900','12345678000199');
  perform pg_temp.g_check('1_cliente_criado',
    pg_temp.g_count($q$select 1 from public.clients where id='d1000000-0000-4000-8000-000000000001'$q$)=1,null);

  insert into public.products(id,company_id,name,brand,model,unit,cost,price,warranty_months,active)
  values ('d1000000-0000-4000-8000-00000000a001','20000000-0000-0000-0000-000000000001',
          'Fechadura Demo CT-100','Fabricante Demo','CT-100','unidade',300,699,12,true);
  perform pg_temp.g_check('2_produto_criado',
    pg_temp.g_count($q$select 1 from public.products where id='d1000000-0000-4000-8000-00000000a001'$q$)=1,null);
end $$;
reset role;

-- ====================================== 7-9. modelo técnico, ficha e documento
do $$
declare
  v_mfr uuid;
  v_cat uuid;
  v_model uuid;
begin
  perform pg_temp.g_as('10000000-0000-0000-0000-000000000001');

  insert into public.equipment_manufacturers(company_id,name,website,created_by)
  values ('20000000-0000-0000-0000-000000000001','Fabricante Demo','https://exemplo.invalid',
          '10000000-0000-0000-0000-000000000001') returning id into v_mfr;
  select id into v_cat from public.equipment_categories where company_id is null and slug='fechaduras';

  insert into public.equipment_models(company_id,manufacturer_id,category_id,name,model_code,description,tags,created_by)
  values ('20000000-0000-0000-0000-000000000001',v_mfr,v_cat,'CT-100','CT 100',
          'Fechadura eletrônica de demonstração',array['fechadura','acesso'],
          '10000000-0000-0000-0000-000000000001') returning id into v_model;
  perform pg_temp.g_put('model',v_model::text);
  perform pg_temp.g_check('3_modelo_tecnico_criado',v_model is not null,null);
  perform pg_temp.g_check('3b_modelo_privado_sobre_categoria_global',
    (select company_id is null from public.equipment_categories where id=v_cat),null);

  insert into public.equipment_quick_guides(company_id,model_id,sections,created_by)
  values ('20000000-0000-0000-0000-000000000001',v_model,
    '[{"kind":"power","title":"Alimentação","items":[{"label":"Tensão","value":"12 VDC"},{"label":"Corrente","value":"1 A"}]},
      {"kind":"wiring","title":"Bornes","items":[{"label":"+12V","value":"vermelho"},{"label":"GND","value":"preto"},{"label":"NA/NF/COM","value":"relé de saída"}]},
      {"kind":"reset","title":"Reset total","items":[{"label":"Procedimento","steps":["Desligue a alimentação","Mantenha o botão interno pressionado","Religue mantendo por 10 segundos"]}]},
      {"kind":"codes","title":"Códigos de erro","items":[{"code":"E4","meaning":"Sensor de porta aberto","action":"Conferir o chicote do sensor"}]},
      {"kind":"alerts","title":"Atenção","items":[{"risk":"O reset total apaga todas as credenciais cadastradas"}]}]'::jsonb,
    '10000000-0000-0000-0000-000000000001');
  perform pg_temp.g_check('4_ficha_rapida_criada_e_versionada',
    (select version=1 and char_length(search_text)>50 from public.equipment_quick_guides where model_id=v_model),null);

  insert into public.equipment_documents(company_id,model_id,title,doc_type,source_kind,official_url,created_by)
  values ('20000000-0000-0000-0000-000000000001',v_model,'Manual de instalação CT-100','manual','official_url',
          'https://exemplo.invalid/ct100.pdf','10000000-0000-0000-0000-000000000001');
  perform pg_temp.g_check('5_documento_por_link_oficial',
    pg_temp.g_count(format($q$select 1 from public.equipment_documents where model_id=%L and source_kind='official_url'$q$,v_model))=1,null);
  perform pg_temp.g_check('5b_documento_nao_nasce_marcado_como_oficial',
    (select not is_official from public.equipment_documents where model_id=v_model),null);

  perform pg_temp.g_check('6_owner_a_encontra_na_busca',
    pg_temp.g_count($q$select 1 from public.zt_equipment_search('20000000-0000-0000-0000-000000000001','CT 100')$q$)=1,null);
end $$;
reset role;

-- ============================================== 10-12. OS e vínculo do equipamento
do $$
declare
  v_wo uuid;
  v_model uuid := pg_temp.g_get('model')::uuid;
begin
  perform pg_temp.g_as('10000000-0000-0000-0000-000000000001');

  v_wo := public.zt_save_work_order_idempotent(
    '20000000-0000-0000-0000-000000000001',null,'d1000000-0000-4000-8000-00000000f001',
    jsonb_build_object(
      'company_id','20000000-0000-0000-0000-000000000001',
      'client_id','d1000000-0000-4000-8000-000000000001',
      'assigned_to','10000000-0000-0000-0000-000000000003',
      'status','scheduled','scheduled_date',current_date::text,
      'address','Avenida Confidencial 900','service_place','Portaria social',
      'request','Fechadura não abre com tag',
      'problem_report','Fechadura não abre com tag',
      'created_by','10000000-0000-0000-0000-000000000001'),
    jsonb_build_array(jsonb_build_object(
      'company_id','20000000-0000-0000-0000-000000000001','kind','service',
      'name','Atendimento técnico','unit','unidade','quantity',1,
      'unit_price',450,'unit_cost',0,'is_extra',false,'price_pending',false)));
  perform pg_temp.g_put('wo',v_wo::text);
  perform pg_temp.g_check('10_os_criada',v_wo is not null,null);

  -- idempotência: o mesmo pedido devolve a mesma OS
  perform pg_temp.g_check('10b_criacao_de_os_idempotente',
    public.zt_save_work_order_idempotent(
      '20000000-0000-0000-0000-000000000001',null,'d1000000-0000-4000-8000-00000000f001',
      jsonb_build_object(
        'company_id','20000000-0000-0000-0000-000000000001',
        'client_id','d1000000-0000-4000-8000-000000000001',
        'assigned_to','10000000-0000-0000-0000-000000000003',
        'status','scheduled','request','Fechadura não abre com tag',
        'created_by','10000000-0000-0000-0000-000000000001'),
      '[]'::jsonb)=v_wo,null);
end $$;
reset role;

-- cenário B (diagnóstico): o técnico vincula só o modelo e abre a Ajuda Técnica
do $$
declare
  v_wo uuid := pg_temp.g_get('wo')::uuid;
  v_model uuid := pg_temp.g_get('model')::uuid;
begin
  perform pg_temp.g_as('10000000-0000-0000-0000-000000000003');

  update public.work_orders set status='in_progress' where id=v_wo;

  insert into public.work_order_equipment(company_id,work_order_id,model_id,notes,created_by)
  values ('20000000-0000-0000-0000-000000000001',v_wo,v_model,'fechadura da portaria social',
          '10000000-0000-0000-0000-000000000003');
  perform pg_temp.g_check('11_tecnico_vincula_modelo_na_os',
    pg_temp.g_count(format($q$select 1 from public.work_order_equipment where work_order_id=%L and installed_equipment_id is null$q$,v_wo))=1,null);

  -- 12. Ajuda Técnica: a ficha e o manual do equipamento vinculado abrem para o técnico
  perform pg_temp.g_check('12_tecnico_abre_ficha_pelo_vinculo',
    pg_temp.g_count(format($q$
      select 1 from public.work_order_equipment e
        join public.equipment_quick_guides g on g.model_id=e.model_id and g.status='active'
       where e.work_order_id=%L$q$,v_wo))=1,null);
  perform pg_temp.g_check('12b_tecnico_abre_manual_pelo_vinculo',
    pg_temp.g_count(format($q$
      select 1 from public.work_order_equipment e
        join public.equipment_documents d on d.model_id=e.model_id and d.status='active'
       where e.work_order_id=%L$q$,v_wo))=1,null);
  perform pg_temp.g_check('12c_tecnico_busca_por_codigo_de_erro',
    pg_temp.g_count($q$select 1 from public.zt_equipment_search('20000000-0000-0000-0000-000000000001','E4')$q$)=1,null);

  insert into public.equipment_recent_views(user_id,company_id,model_id)
  values ('10000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001',v_model)
  on conflict (user_id,company_id,model_id) do update set viewed_at=now();
  perform pg_temp.g_check('12d_equipamento_entra_em_recentes',
    pg_temp.g_count($q$select 1 from public.equipment_recent_views where user_id='10000000-0000-0000-0000-000000000003'$q$)=1,null);
end $$;
reset role;

-- ============================ 13-15. execução, Base Técnica (0111) e conclusão
do $$
declare
  v_wo uuid := pg_temp.g_get('wo')::uuid;
  v_base jsonb;
begin
  perform pg_temp.g_as('10000000-0000-0000-0000-000000000003');

  insert into public.work_order_materials(
    id,work_order_id,company_id,product_id,name,quantity,unit_cost,serial_number,created_by)
  values ('d1000000-0000-4000-8000-00000000a002',v_wo,'20000000-0000-0000-0000-000000000001',
          'd1000000-0000-4000-8000-00000000a001','Fechadura Demo CT-100',1,0,'SN-CT-7001',
          '10000000-0000-0000-0000-000000000003');

  -- 14. Base Técnica pela RPC da 0111 (fonte do caso; nada é copiado depois)
  v_base := public.zt_save_work_order_technical_base(
    v_wo,
    'Fonte de 12V em curto por infiltração na caixa de passagem.',
    'Substituída a fonte, vedada a caixa e recadastradas as três tags do condomínio.',
    'medium',
    'Nesse modelo, conferir a vedação da caixa antes de trocar a placa.',
    'd1000000-0000-4000-8000-00000000f002');
  perform pg_temp.g_check('14_base_tecnica_salva_pela_rpc_atual',
    coalesce(v_base->>'revision','')='1',v_base::text);
  perform pg_temp.g_check('14b_base_tecnica_idempotente_no_retry',
    (public.zt_save_work_order_technical_base(
      v_wo,
      'Fonte de 12V em curto por infiltração na caixa de passagem.',
      'Substituída a fonte, vedada a caixa e recadastradas as três tags do condomínio.',
      'medium',
      'Nesse modelo, conferir a vedação da caixa antes de trocar a placa.',
      'd1000000-0000-4000-8000-00000000f002')->>'revision')='1',null);

  -- 15. conclusão pelo fluxo real de finalização
  perform public.zt_finalize_work_order_with_warranty_overrides(
    v_wo,'Atendimento concluído e testado com três tags.',null,0,7,'[]'::jsonb,'[]'::jsonb,null);
end $$;
reset role;
set constraints all immediate;

do $$
declare v_wo uuid := pg_temp.g_get('wo')::uuid;
begin
  perform pg_temp.g_check('15b_os_concluida',
    (select status='done' from public.work_orders where id=v_wo),null);
  perform pg_temp.g_check('15c_cobranca_gerada_fora_da_central_tecnica',
    pg_temp.g_count(format($q$select 1 from public.financial_entries where work_order_id=%L$q$,v_wo))>=1,null);
end $$;

-- ================= 16. unidade física registrada e identificada com o modelo
do $$
declare
  v_wo uuid := pg_temp.g_get('wo')::uuid;
  v_model uuid := pg_temp.g_get('model')::uuid;
  v_unit uuid;
begin
  perform pg_temp.g_as('10000000-0000-0000-0000-000000000003');
  v_unit := public.zt_register_installed_equipment(
    v_wo,'d1000000-0000-4000-8000-00000000a002',null,'Portaria social',null,'SN-CT-7001',
    'BARCODE-CT-7001','Instalada na folha principal',null);
  perform pg_temp.g_put('unit',v_unit::text);
  perform pg_temp.g_check('16_unidade_fisica_registrada_pela_rpc_existente',v_unit is not null,null);

  -- identifica o modelo técnico da unidade (ponte unidade física -> conhecimento)
  perform public.zt_set_installed_equipment_model(v_unit,v_model);
  reset role;
  perform pg_temp.g_check('16b_unidade_aponta_para_o_modelo_tecnico',
    (select equipment_model_id=v_model from public.installed_equipment where id=v_unit),null);
  perform pg_temp.g_check('16c_unidade_continua_com_serial_e_local_da_0083',
    (select serial_number='SN-CT-7001' and client_location_id is not null
       from public.installed_equipment where id=v_unit),null);
end $$;
reset role;

-- ===================================== 17-19. o caso aparece na Central Técnica
do $$
declare
  v_model uuid := pg_temp.g_get('model')::uuid;
  v_case record;
  v_row text;
begin
  perform pg_temp.g_as('10000000-0000-0000-0000-000000000003');

  perform pg_temp.g_check('17_caso_aparece_para_o_tecnico_a',
    pg_temp.g_count(format($q$select 1 from public.zt_equipment_cases('20000000-0000-0000-0000-000000000001',%L)$q$,v_model))=1,null);
  perform pg_temp.g_check('17b_contagem_de_casos_bate',
    public.zt_equipment_cases_count('20000000-0000-0000-0000-000000000001',v_model)=1,null);

  select * into v_case
    from public.zt_equipment_cases('20000000-0000-0000-0000-000000000001',v_model) limit 1;

  perform pg_temp.g_check('18_caso_traz_causa_da_base_tecnica',
    v_case.cause like '%curto por infiltração%',v_case.cause);
  perform pg_temp.g_check('18b_caso_traz_solucao_da_base_tecnica',
    v_case.solution like '%Substituída a fonte%',v_case.solution);
  perform pg_temp.g_check('18c_caso_traz_dificuldade_e_aprendizado',
    v_case.difficulty='medium' and v_case.learning like '%vedação da caixa%',null);
  perform pg_temp.g_check('18d_caso_traz_sintoma_da_os',
    v_case.symptom like '%não abre com tag%',v_case.symptom);
  perform pg_temp.g_check('18e_caso_traz_data_de_conclusao',
    v_case.completed_on=current_date,null);
  perform pg_temp.g_check('18f_caso_marca_unidade_identificada',
    v_case.unit_identified,null);

  -- 19. sanitização estrutural: nem PII nem financeiro saem na linha do caso
  v_row := v_case::text;
  perform pg_temp.g_check('19_caso_sem_nome_do_cliente',
    position('Condomínio Reservado' in v_row)=0,null);
  perform pg_temp.g_check('19b_caso_sem_endereco',
    position('Avenida Confidencial' in v_row)=0,null);
  perform pg_temp.g_check('19c_caso_sem_telefone',
    position('11988887777' in v_row)=0,null);
  perform pg_temp.g_check('19d_caso_sem_documento_do_cliente',
    position('12345678000199' in v_row)=0,null);
  perform pg_temp.g_check('19e_caso_sem_valor_cobrado',
    position('450' in v_row)=0,null);
  perform pg_temp.g_check('19f_caso_sem_custo_do_produto',
    position('300' in v_row)=0 and position('699' in v_row)=0,null);
  perform pg_temp.g_check('19g_contrato_da_rpc_sem_coluna_financeira',
    not exists(
      select 1 from information_schema.routines r
        join information_schema.parameters pa on pa.specific_name=r.specific_name
       where r.routine_schema='public' and r.routine_name='zt_equipment_cases'
         and lower(coalesce(pa.parameter_name,'')) ~ '(price|cost|amount|margin|valor|preco|custo)'),null);
end $$;
reset role;

-- ================================= 20-22. isolamento e busca autorizada
do $$
declare v_model uuid := pg_temp.g_get('model')::uuid;
begin
  perform pg_temp.g_as('10000000-0000-0000-0000-000000000002');
  perform pg_temp.g_check('20_owner_b_nao_le_casos_da_a',
    pg_temp.g_state(format($q$select public.zt_equipment_cases('20000000-0000-0000-0000-000000000001',%L)$q$,v_model))<>'ok',null);
  perform pg_temp.g_check('20b_owner_b_nao_ve_modelo_da_a',
    pg_temp.g_count('select 1 from public.equipment_models')=0,null);
  perform pg_temp.g_check('20c_busca_da_b_nao_devolve_modelo_da_a',
    pg_temp.g_count($q$select 1 from public.zt_equipment_search('20000000-0000-0000-0000-000000000002','CT 100')$q$)=0,null);
  perform pg_temp.g_check('20d_owner_b_nao_ve_unidade_da_a',
    pg_temp.g_count('select 1 from public.installed_equipment')=0,null);
  reset role;

  perform pg_temp.g_as('10000000-0000-0000-0000-000000000004');
  perform pg_temp.g_check('21_tecnico_b_nao_le_casos_da_a',
    pg_temp.g_state(format($q$select public.zt_equipment_cases('20000000-0000-0000-0000-000000000001',%L)$q$,v_model))<>'ok',null);
  perform pg_temp.g_check('21b_tecnico_b_nao_ve_ficha_da_a',
    pg_temp.g_count('select 1 from public.equipment_quick_guides')=0,null);
  reset role;

  perform pg_temp.g_as('10000000-0000-0000-0000-000000000003');
  perform pg_temp.g_check('22_busca_do_tecnico_a_segue_autorizada',
    pg_temp.g_count($q$select 1 from public.zt_equipment_search('20000000-0000-0000-0000-000000000001','CT 100')$q$)=1,null);
  perform pg_temp.g_check('22b_tecnico_a_nao_ve_valor_na_central_tecnica',
    not exists(
      select 1 from information_schema.columns
       where table_schema='public'
         and table_name in ('equipment_models','equipment_quick_guides','equipment_documents',
                            'equipment_categories','equipment_manufacturers','work_order_equipment')
         and lower(column_name) ~ '(price|cost|amount|margin|valor|preco|custo)'),null);
end $$;
reset role;

do $$
declare v_failures text;
begin
  select string_agg(name||' => '||coalesce(detail,''),' ; ' order by name) into v_failures
    from zt_ctg_results where not ok;
  if v_failures is not null then raise exception 'CENTRAL_TECNICA_GOLDEN_FAILED: %', v_failures; end if;
  if (select count(*) from zt_ctg_results) < 35 then
    raise exception 'CENTRAL_TECNICA_GOLDEN_INCOMPLETE: % checks',(select count(*) from zt_ctg_results);
  end if;
end $$;

select 'CENTRAL_TECNICA_GOLDEN_PATH' as test, count(*) as checks, bool_and(ok) as all_ok from zt_ctg_results;

rollback;
