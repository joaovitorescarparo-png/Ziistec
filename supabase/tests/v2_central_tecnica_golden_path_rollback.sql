-- ZiisTec CENTRAL TÉCNICA V1 (0113-0115) — golden path sobre a arquitetura atual.
-- Empresa -> owner -> técnico -> cliente -> local -> produto -> modelo técnico ->
-- ficha -> documento -> OS -> vínculo do equipamento -> Ajuda Técnica -> execução
-- -> Base Técnica ORIGINAL (RPC da 0111) -> conclusão (RPC de finalização com
-- garantias) -> equipamento instalado (RPC da 0083) identificado com o modelo ->
-- a OS concluída NÃO vira caso sozinha -> owner revisa e PUBLICA o caso técnico
-- -> caso aparece na Central -> OUTRO técnico da empresa (não atribuído à OS)
-- consulta e recebe somente o conteúdo técnico curado -> Empresa B não enxerga ->
-- busca devolve só o autorizado.
--
-- TESTE ADVERSARIAL (security fix): a OS é montada de propósito com dado sensível
-- em TODO campo de texto livre — telefone no request, endereço no problem_report,
-- e-mail na Base Técnica original, preço nas notas, cliente com nome/CPF/telefone.
-- O caso publicado é um texto separado e limpo. Qualquer valor bruto que volte a
-- aparecer na resposta derruba o teste.
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

-- Technician A2: técnico ativo da Empresa A que NÃO é atribuído à OS do teste.
-- É quem consulta a Central — o leitor para quem o caso é publicado.
insert into auth.users (
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values
  ('00000000-0000-0000-0000-000000000000','10000000-0000-0000-0000-000000000005','authenticated','authenticated','ci-tech-a2@example.invalid','',now(),'{}'::jsonb,'{}'::jsonb,now(),now())
on conflict (id) do nothing;
insert into public.profiles(id,full_name,email)
values ('10000000-0000-0000-0000-000000000005','CI Technician A2','ci-tech-a2@example.invalid')
on conflict (id) do nothing;

-- Valores sensíveis plantados na OS (um por campo de texto livre).
create temp table zt_ctg_secrets (label text primary key, needle text not null) on commit drop;
insert into zt_ctg_secrets(label,needle) values
  ('telefone_no_request','11 97777-1234'),
  ('telefone_no_request_so_digitos','977771234'),
  ('endereco_no_problem_report','Rua Sigilosa 77'),
  ('apartamento_no_problem_report','apto 1204'),
  ('email_na_base_tecnica','sindico.reservado@exemplo.invalid'),
  ('nome_na_base_tecnica','Dona Hermengarda'),
  ('preco_na_nota_do_vinculo','987,65'),
  ('preco_na_nota_da_unidade','1.234,56'),
  ('senha_na_nota_da_unidade','senha 4321'),
  ('nome_do_cliente','Condomínio Reservado'),
  ('endereco_do_cliente','Avenida Confidencial'),
  ('telefone_do_cliente','11988887777'),
  ('documento_do_cliente','12345678000199'),
  ('local_do_servico','Portaria social'),
  ('relato_ao_cliente','testado com três tags'),
  ('valor_cobrado','450'),
  ('custo_do_produto','300'),
  ('preco_do_produto','699'),
  ('serial_da_unidade','SN-CT-7001');
grant select on zt_ctg_secrets to authenticated, anon;

-- Technician B entra para o teste de isolamento.
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal1"}',true);
insert into public.company_members(company_id,user_id,role,status,job_title)
values ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000004','technician','active','CI Tech B')
on conflict (company_id,user_id) do update set role='technician',status='active';
insert into public.company_members(company_id,user_id,role,status,job_title)
values ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000005','technician','active','CI Tech A2')
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
      'request','Fechadura não abre com tag. Ligar antes para 11 97777-1234 (977771234)',
      'problem_report','Morador da Rua Sigilosa 77, apto 1204, relata que a fechadura não abre com tag',
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
        'status','scheduled','request','Fechadura não abre com tag. Ligar antes para 11 97777-1234 (977771234)',
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
  values ('20000000-0000-0000-0000-000000000001',v_wo,v_model,'fechadura da portaria social; visita cobrada R$ 987,65',
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

  -- 14. Base Técnica ORIGINAL pela RPC da 0111: registro interno, com dado sensível de propósito
  v_base := public.zt_save_work_order_technical_base(
    v_wo,
    'Fonte de 12V em curto por infiltração. Avisar sindico.reservado@exemplo.invalid.',
    'Trocada a fonte e recadastradas as tags; a Dona Hermengarda ficou com a chave reserva.',
    'medium',
    'Combinar acesso com a Dona Hermengarda pelo sindico.reservado@exemplo.invalid.',
    'd1000000-0000-4000-8000-00000000f002');
  perform pg_temp.g_check('14_base_tecnica_salva_pela_rpc_atual',
    coalesce(v_base->>'revision','')='1',v_base::text);
  perform pg_temp.g_check('14b_base_tecnica_idempotente_no_retry',
    (public.zt_save_work_order_technical_base(
      v_wo,
      'Fonte de 12V em curto por infiltração. Avisar sindico.reservado@exemplo.invalid.',
      'Trocada a fonte e recadastradas as tags; a Dona Hermengarda ficou com a chave reserva.',
      'medium',
      'Combinar acesso com a Dona Hermengarda pelo sindico.reservado@exemplo.invalid.',
      'd1000000-0000-4000-8000-00000000f002')->>'revision')='1',null);

  -- 14c. antes da conclusão não há o que publicar (o técnico não publica em hipótese alguma)
  perform pg_temp.g_check('14c_tecnico_atribuido_nao_publica_caso',
    pg_temp.g_state(format($q$select public.zt_publish_work_order_technical_case(%L,'s','c','s','l','d1000000-0000-4000-8000-00000000ca00')$q$,v_wo))='42501',null);

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
    'BARCODE-CT-7001','Instalada na folha principal; senha 4321; peça orçada em R$ 1.234,56',null);
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

-- ============ 17. OS concluída com Base Técnica NÃO vira caso compartilhado sozinha
do $$
declare
  v_wo uuid := pg_temp.g_get('wo')::uuid;
  v_model uuid := pg_temp.g_get('model')::uuid;
begin
  perform pg_temp.g_check('17_fixture_adversarial_esta_mesmo_na_os',
    (select request like '%11 97777-1234%' and problem_report like '%Rua Sigilosa 77%'
       from public.work_orders where id=v_wo)
    and (select cause like '%sindico.reservado@exemplo.invalid%' and solution like '%Dona Hermengarda%'
           from public.work_order_technical_base where work_order_id=v_wo)
    and exists(select 1 from public.work_order_equipment where work_order_id=v_wo and notes like '%987,65%')
    and exists(select 1 from public.installed_equipment where work_order_id=v_wo and notes like '%1.234,56%'),null);

  perform pg_temp.g_as('10000000-0000-0000-0000-000000000005');
  perform pg_temp.g_check('17b_sem_publicacao_nao_ha_caso_para_a_equipe',
    pg_temp.g_count(format($q$select 1 from public.zt_equipment_cases('20000000-0000-0000-0000-000000000001',%L)$q$,v_model))=0
    and public.zt_equipment_cases_count('20000000-0000-0000-0000-000000000001',v_model)=0,null);
  reset role;
  perform pg_temp.g_as('10000000-0000-0000-0000-000000000001');
  perform pg_temp.g_check('17c_sem_publicacao_nao_ha_caso_nem_para_o_owner',
    pg_temp.g_count(format($q$select 1 from public.zt_equipment_cases('20000000-0000-0000-0000-000000000001',%L)$q$,v_model))=0,null);
  reset role;
end $$;
reset role;

-- ======================= 18. o owner revisa e publica o caso técnico (texto limpo)
do $$
declare
  v_wo uuid := pg_temp.g_get('wo')::uuid;
  v_pub jsonb;
  v_again jsonb;
begin
  -- quem não é owner da empresa não publica
  perform pg_temp.g_as('10000000-0000-0000-0000-000000000003');
  perform pg_temp.g_check('18_tecnico_atribuido_nao_publica_nem_apos_concluir',
    pg_temp.g_state(format($q$select public.zt_publish_work_order_technical_case(%L,'s','c','s','l','d1000000-0000-4000-8000-00000000ca01')$q$,v_wo))='42501',null);
  reset role;
  perform pg_temp.g_as('10000000-0000-0000-0000-000000000005');
  perform pg_temp.g_check('18b_tecnico_nao_atribuido_nao_publica',
    pg_temp.g_state(format($q$select public.zt_publish_work_order_technical_case(%L,'s','c','s','l','d1000000-0000-4000-8000-00000000ca02')$q$,v_wo))='42501',null);
  reset role;
  perform pg_temp.g_as('10000000-0000-0000-0000-000000000002');
  perform pg_temp.g_check('18c_owner_b_nao_publica_caso_da_a',
    pg_temp.g_state(format($q$select public.zt_publish_work_order_technical_case(%L,'s','c','s','l','d1000000-0000-4000-8000-00000000ca03')$q$,v_wo))='42501',null);
  reset role;

  perform pg_temp.g_as('10000000-0000-0000-0000-000000000001');
  perform pg_temp.g_check('18d_publicacao_exige_conteudo_tecnico',
    pg_temp.g_state(format($q$select public.zt_publish_work_order_technical_case(%L,'só sintoma',null,'  ',null,'d1000000-0000-4000-8000-00000000ca04')$q$,v_wo))='22023',null);
  perform pg_temp.g_check('18e_publicacao_exige_identificador_da_operacao',
    pg_temp.g_state(format($q$select public.zt_publish_work_order_technical_case(%L,'s','c','s','l',null)$q$,v_wo))='22023',null);

  v_pub := public.zt_publish_work_order_technical_case(
    v_wo,
    'Fechadura não abre com tag cadastrada.',
    'Fonte de 12V em curto por infiltração na caixa de passagem.',
    'Substituída a fonte, vedada a caixa de passagem e recadastradas as tags.',
    'Nesse modelo, conferir a vedação da caixa antes de trocar a placa.',
    'd1000000-0000-4000-8000-00000000ca10');
  perform pg_temp.g_put('case',v_pub->>'case_id');
  perform pg_temp.g_check('18f_owner_publica_o_caso_revisado',
    (v_pub->>'published')::boolean and (v_pub->>'revision')='1' and (v_pub->>'case_id') is not null,v_pub::text);
  perform pg_temp.g_check('18g_identificador_do_caso_nao_e_o_da_os',
    (v_pub->>'case_id')::uuid <> v_wo,null);
  perform pg_temp.g_check('18h_retorno_da_publicacao_so_tem_campos_de_caso',
    (select array_agg(k order by k) from jsonb_object_keys(v_pub) k)
      = array['case_id','cause','learning','published','published_at','revision','solution','symptom','updated_at'],v_pub::text);

  -- idempotência: o mesmo pedido devolve o mesmo estado, sem nova revisão
  v_again := public.zt_publish_work_order_technical_case(
    v_wo,
    'Fechadura não abre com tag cadastrada.',
    'Fonte de 12V em curto por infiltração na caixa de passagem.',
    'Substituída a fonte, vedada a caixa de passagem e recadastradas as tags.',
    'Nesse modelo, conferir a vedação da caixa antes de trocar a placa.',
    'd1000000-0000-4000-8000-00000000ca10');
  perform pg_temp.g_check('18i_publicacao_idempotente_no_retry',v_again=v_pub,v_again::text);
  perform pg_temp.g_check('18j_mesmo_pedido_com_outro_conteudo_e_recusado',
    pg_temp.g_state(format($q$select public.zt_publish_work_order_technical_case(%L,'x','outro','outro','outro','d1000000-0000-4000-8000-00000000ca10')$q$,v_wo))='23505',null);
  reset role;

  -- auditável: quem publicou, quando e a revisão; a Base Técnica original fica intacta
  perform pg_temp.g_check('18k_publicacao_auditavel',
    (select case_published_by='10000000-0000-0000-0000-000000000001'
        and case_updated_by='10000000-0000-0000-0000-000000000001'
        and case_published_at is not null and case_updated_at is not null and case_revision=1
       from public.work_order_technical_base where work_order_id=v_wo),null);
  perform pg_temp.g_check('18l_base_tecnica_original_intacta_apos_publicar',
    (select cause like '%sindico.reservado@exemplo.invalid%' and solution like '%Dona Hermengarda%'
        and difficulty='medium' and revision=1
       from public.work_order_technical_base where work_order_id=v_wo),null);
end $$;
reset role;

-- == 19. TESTE ADVERSARIAL: técnico da empresa, NÃO atribuído à OS, consulta os casos
do $$
declare
  v_wo uuid := pg_temp.g_get('wo')::uuid;
  v_model uuid := pg_temp.g_get('model')::uuid;
  v_case record;
  v_row text;
  v_all text;
  v_leaks text;
  v_number text;
begin
  select number into v_number from public.work_orders where id=v_wo;

  perform pg_temp.g_as('10000000-0000-0000-0000-000000000005');

  -- o leitor não tem nenhum outro caminho até a OS: nem a OS, nem a Base, nem o vínculo
  perform pg_temp.g_check('19_tecnico_nao_atribuido_nao_le_a_os',
    pg_temp.g_count(format('select 1 from public.work_orders where id=%L',v_wo))=0,null);
  perform pg_temp.g_check('19b_tecnico_nao_atribuido_nao_le_a_base_tecnica_original',
    pg_temp.g_count(format('select 1 from public.work_order_technical_base where work_order_id=%L',v_wo))=0,null);
  perform pg_temp.g_check('19c_tecnico_nao_atribuido_nao_le_vinculo_nem_unidade',
    pg_temp.g_count(format('select 1 from public.work_order_equipment where work_order_id=%L',v_wo))=0
    and pg_temp.g_count(format('select 1 from public.installed_equipment where work_order_id=%L',v_wo))=0,null);

  perform pg_temp.g_check('19d_caso_publicado_aparece_para_o_outro_tecnico',
    pg_temp.g_count(format($q$select 1 from public.zt_equipment_cases('20000000-0000-0000-0000-000000000001',%L)$q$,v_model))=1
    and public.zt_equipment_cases_count('20000000-0000-0000-0000-000000000001',v_model)=1,null);

  select * into v_case
    from public.zt_equipment_cases('20000000-0000-0000-0000-000000000001',v_model) limit 1;

  perform pg_temp.g_check('19e_caso_traz_o_texto_curado',
    v_case.symptom='Fechadura não abre com tag cadastrada.'
    and v_case.cause='Fonte de 12V em curto por infiltração na caixa de passagem.'
    and v_case.solution='Substituída a fonte, vedada a caixa de passagem e recadastradas as tags.'
    and v_case.learning='Nesse modelo, conferir a vedação da caixa antes de trocar a placa.',v_case::text);
  perform pg_temp.g_check('19f_caso_traz_dificuldade_datas_e_unidade_identificada',
    v_case.difficulty='medium' and v_case.completed_on=current_date
    and v_case.published_on is not null and v_case.unit_identified,null);
  perform pg_temp.g_check('19g_caso_usa_identificador_proprio',
    v_case.case_id=pg_temp.g_get('case')::uuid and v_case.case_id<>v_wo,null);

  -- TUDO que a consulta devolve, em todas as páginas, como texto. O identificador
  -- do caso é um UUID aleatório e as datas são do dia do teste: saem de v_all para
  -- que agulhas numéricas curtas ("450", "300") não casem por acaso — o UUID é
  -- conferido à parte, em v_row, contra o id e o número da OS.
  select coalesce(string_agg((to_jsonb(c)-'case_id'-'published_on'-'completed_on')::text,' | '),'') into v_all
    from public.zt_equipment_cases('20000000-0000-0000-0000-000000000001',v_model,30,0) c;
  select coalesce(string_agg(c::text,' | '),'') into v_row
    from public.zt_equipment_cases('20000000-0000-0000-0000-000000000001',v_model,30,0) c;
  perform pg_temp.g_check('19g2_resposta_nao_vazia_antes_de_procurar_vazamento',
    char_length(v_all)>100 and v_all like '%vedação da caixa%',null);

  select string_agg(x.label,', ' order by x.label) into v_leaks
    from zt_ctg_secrets x
   where position(lower(x.needle) in lower(v_all))>0;
  perform pg_temp.g_check('19h_ADVERSARIAL_nenhum_valor_sensivel_bruto_na_resposta',v_leaks is null,v_leaks);

  perform pg_temp.g_check('19i_caso_sem_id_nem_numero_da_os',
    position(v_wo::text in v_row)=0 and position(v_number in v_row)=0
    and char_length(coalesce(v_number,''))>0,null);
  perform pg_temp.g_check('19j_caso_sem_texto_bruto_da_base_tecnica',
    position('Avisar' in v_all)=0 and position('chave reserva' in v_all)=0
    and position('Combinar acesso' in v_all)=0,null);
  perform pg_temp.g_check('19k_caso_sem_texto_do_request_ou_do_problem_report',
    position('Ligar antes' in v_all)=0 and position('Morador' in v_all)=0,null);
  perform pg_temp.g_check('19l_caso_sem_nota_de_vinculo_ou_de_unidade',
    position('visita cobrada' in v_all)=0 and position('folha principal' in v_all)=0
    and position('R$' in v_all)=0,null);

  -- busca explícita por cada valor adversarial: a Central não os indexa nem devolve
  select string_agg(x.label,', ' order by x.label) into v_leaks
    from zt_ctg_secrets x
   where x.label not in ('valor_cobrado','custo_do_produto','preco_do_produto')
     and exists(select 1 from public.zt_equipment_search('20000000-0000-0000-0000-000000000001',x.needle));
  perform pg_temp.g_check('19m_ADVERSARIAL_busca_pelos_valores_sensiveis_nao_devolve_nada',v_leaks is null,v_leaks);

  perform pg_temp.g_check('19n_contrato_da_rpc_so_com_colunas_de_caso',
    (select array_agg(pa.parameter_name::text order by pa.ordinal_position)
       from information_schema.routines r
       join information_schema.parameters pa on pa.specific_name=r.specific_name
      where r.routine_schema='public' and r.routine_name='zt_equipment_cases'
        and pa.parameter_mode='OUT')
      = array['case_id','published_on','completed_on','symptom','cause','solution','learning','difficulty','unit_identified'],null);
  perform pg_temp.g_check('19o_contrato_da_rpc_sem_coluna_financeira',
    not exists(
      select 1 from information_schema.routines r
        join information_schema.parameters pa on pa.specific_name=r.specific_name
       where r.routine_schema='public' and r.routine_name='zt_equipment_cases'
         and lower(coalesce(pa.parameter_name,'')) ~ '(price|cost|amount|margin|valor|preco|custo)'),null);
  reset role;

  -- o técnico atribuído vê o mesmo caso curado (e segue lendo a própria Base Técnica)
  perform pg_temp.g_as('10000000-0000-0000-0000-000000000003');
  perform pg_temp.g_check('19p_tecnico_atribuido_ve_o_mesmo_caso_curado',
    (select c.cause from public.zt_equipment_cases('20000000-0000-0000-0000-000000000001',v_model) c limit 1)
      ='Fonte de 12V em curto por infiltração na caixa de passagem.',null);
  perform pg_temp.g_check('19q_tecnico_atribuido_segue_lendo_a_propria_base_tecnica',
    pg_temp.g_count(format('select 1 from public.work_order_technical_base where work_order_id=%L',v_wo))=1,null);
  reset role;
end $$;
reset role;

-- ============ 19r-19v. revisão, retirada e republicação do caso (sempre pelo owner)
do $$
declare
  v_wo uuid := pg_temp.g_get('wo')::uuid;
  v_model uuid := pg_temp.g_get('model')::uuid;
  v_case uuid := pg_temp.g_get('case')::uuid;
  v_out jsonb;
begin
  perform pg_temp.g_as('10000000-0000-0000-0000-000000000001');
  v_out := public.zt_publish_work_order_technical_case(
    v_wo,'Fechadura não abre com tag cadastrada.',
    'Fonte de 12V em curto por infiltração na caixa de passagem.',
    'Substituída a fonte, vedada a caixa de passagem e recadastradas as tags.',
    'Nesse modelo, conferir a vedação da caixa e o aterramento antes de trocar a placa.',
    'd1000000-0000-4000-8000-00000000ca11');
  perform pg_temp.g_check('19r_revisao_do_caso_sobe_a_versao_e_mantem_o_identificador',
    (v_out->>'revision')='2' and (v_out->>'case_id')::uuid=v_case,v_out::text);

  v_out := public.zt_unpublish_work_order_technical_case(v_wo);
  perform pg_temp.g_check('19s_owner_retira_o_caso',
    not (v_out->>'published')::boolean and v_out->>'cause' is null,v_out::text);
  perform pg_temp.g_check('19t_retirada_idempotente',
    public.zt_unpublish_work_order_technical_case(v_wo)=v_out,null);
  reset role;

  perform pg_temp.g_as('10000000-0000-0000-0000-000000000005');
  perform pg_temp.g_check('19u_caso_retirado_some_da_central',
    pg_temp.g_count(format($q$select 1 from public.zt_equipment_cases('20000000-0000-0000-0000-000000000001',%L)$q$,v_model))=0
    and public.zt_equipment_cases_count('20000000-0000-0000-0000-000000000001',v_model)=0,null);
  reset role;

  perform pg_temp.g_check('19v_retirada_nao_apaga_a_base_tecnica_original',
    (select cause like '%sindico.reservado@exemplo.invalid%' and case_cause is null and case_published_at is null
       from public.work_order_technical_base where work_order_id=v_wo),null);

  -- republica para o restante do roteiro
  perform pg_temp.g_as('10000000-0000-0000-0000-000000000001');
  v_out := public.zt_publish_work_order_technical_case(
    v_wo,'Fechadura não abre com tag cadastrada.',
    'Fonte de 12V em curto por infiltração na caixa de passagem.',
    'Substituída a fonte, vedada a caixa de passagem e recadastradas as tags.',
    'Nesse modelo, conferir a vedação da caixa antes de trocar a placa.',
    'd1000000-0000-4000-8000-00000000ca12');
  perform pg_temp.g_check('19w_republicacao_mantem_o_identificador_do_caso',
    (v_out->>'published')::boolean and (v_out->>'case_id')::uuid=v_case,v_out::text);
  reset role;
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
  if (select count(*) from zt_ctg_results) < 68 then
    raise exception 'CENTRAL_TECNICA_GOLDEN_INCOMPLETE: % checks',(select count(*) from zt_ctg_results);
  end if;
end $$;

select 'CENTRAL_TECNICA_GOLDEN_PATH' as test, count(*) as checks, bool_and(ok) as all_ok from zt_ctg_results;

rollback;
