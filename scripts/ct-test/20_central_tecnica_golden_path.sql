-- =====================================================================
-- ZiisTec · Central Técnica — golden path de integração
-- Fluxo completo: catálogo → busca → ficha → OS → Base Técnica → caso.
-- Roda no banco descartável; transação revertida no final (re-executável).
-- =====================================================================
\set ON_ERROR_STOP on

begin;

do $$
declare
  ua uuid; ta uuid; ub uuid; tb uuid;
  ca uuid; cb uuid;
  cat uuid; mfr uuid; model uuid; guide uuid; doc uuid;
  client_a uuid; wo uuid; wo2 uuid; req uuid := gen_random_uuid();
  v_count int; v_case record; v_txt text;
begin
  -- fixtures
  perform tests.reset();
  insert into auth.users (email) values ('gp.owner.a@teste.zii') returning id into ua;
  insert into auth.users (email) values ('gp.tech.a@teste.zii')  returning id into ta;
  insert into auth.users (email) values ('gp.owner.b@teste.zii') returning id into ub;
  insert into auth.users (email) values ('gp.tech.b@teste.zii')  returning id into tb;
  perform tests.login(ua); ca := public.zt_create_company('GP Empresa A','seguranca',true,null,null); perform tests.reset();
  perform tests.login(ub); cb := public.zt_create_company('GP Empresa B','portoes',true,null,null); perform tests.reset();
  insert into public.company_members(company_id,user_id,role,status) values
    (ca, ta, 'technician', 'active'), (cb, tb, 'technician', 'active');

  -- 1-2) fabricante + categoria (categoria global seed + categoria privada)
  perform tests.login(ua);
  insert into public.equipment_manufacturers (company_id, name, website)
    values (ca, 'Fabricante Demo', 'https://exemplo.dev') returning id into mfr;
  insert into public.equipment_categories (company_id, name, slug)
    values (ca, 'Controle de acesso (interno)', 'controle-acesso-interno') returning id into cat;

  -- 3) modelo
  insert into public.equipment_models (company_id, manufacturer_id, category_id, name, model_code, description, tags, created_by)
    values (ca, mfr, cat, 'CT-100', 'CT 100', 'Fechadura eletrônica de demonstração', array['fechadura','acesso'], ua)
    returning id into model;

  -- 4) ficha rápida estruturada
  insert into public.equipment_quick_guides (company_id, model_id, sections, created_by)
    values (ca, model, '[
      {"kind":"power","title":"Alimentação","items":[{"label":"Tensão","value":"12 VDC"},{"label":"Corrente","value":"1 A"}]},
      {"kind":"wiring","title":"Bornes","items":[{"label":"+12V","value":"vermelho"},{"label":"GND","value":"preto"},{"label":"NA/NF/COM","value":"relé de saída"}]},
      {"kind":"reset","title":"Reset total","items":[{"label":"Procedimento","steps":["Desligue a alimentação","Mantenha o botão interno pressionado","Religue mantendo por 10 segundos"]}]},
      {"kind":"codes","title":"Códigos de erro","items":[{"code":"E4","meaning":"Sensor de porta aberto","action":"Verificar chicote do sensor"}]},
      {"kind":"alerts","title":"Atenção","items":[{"risk":"Reset total apaga todas as credenciais cadastradas"}]}
    ]'::jsonb, ua)
    returning id into guide;

  -- 5) documento (URL oficial — metadados, sem re-hospedar)
  insert into public.equipment_documents (company_id, model_id, title, doc_type, source_kind, official_url, created_by)
    values (ca, model, 'Manual de instalação CT-100', 'manual', 'official_url', 'https://exemplo.dev/ct100.pdf', ua)
    returning id into doc;

  -- 6) Owner A pesquisa
  select count(*) into v_count from public.zt_equipment_search(ca, 'CT 100', null, 10, 0);
  perform tests.ok(v_count = 1, '6. Owner A encontra o modelo na busca');
  perform tests.reset();

  -- 7) Technician A pesquisa (por erro da ficha e por nome)
  perform tests.login(ta);
  select count(*) into v_count from public.zt_equipment_search(ca, 'E4', null, 10, 0);
  perform tests.ok(v_count = 1, '7. Technician A encontra por código de erro');
  select count(*) into v_count from public.zt_equipment_search(ca, 'fechadura', null, 10, 0);
  perform tests.ok(v_count = 1, '7b. Technician A encontra por tag');

  -- 8) técnico abre a ficha (registra recente)
  select count(*) into v_count from public.equipment_quick_guides where model_id = model and status = 'active';
  perform tests.ok(v_count = 1, '8. ficha aberta pelo técnico');
  insert into public.equipment_recent_views (user_id, company_id, model_id) values (ta, ca, model)
    on conflict (user_id, company_id, model_id) do update set viewed_at = now();
  perform tests.reset();

  -- 9) OS criada e equipamento vinculado
  perform tests.login(ua);
  insert into public.clients (company_id, person_type, name, address) values (ca, 'PF', 'Cliente Confidencial', 'Rua Secreta, 123') returning id into client_a;
  wo := public.zt_save_work_order_idempotent(ca, null, req,
    jsonb_build_object('company_id', ca, 'client_id', client_a, 'assigned_to', ta,
      'status', 'scheduled', 'scheduled_date', current_date::text,
      'request', 'Fechadura não abre com tag', 'created_by', ua),
    jsonb_build_array(jsonb_build_object('company_id', ca, 'kind', 'service', 'name', 'Troca de fonte',
      'unit', 'unidade', 'quantity', 1, 'unit_price', 150, 'unit_cost', 0,
      'is_extra', false, 'price_pending', false)));
  -- idempotência: mesmo request id devolve a MESMA OS
  wo2 := public.zt_save_work_order_idempotent(ca, null, req,
    jsonb_build_object('company_id', ca, 'client_id', client_a, 'assigned_to', ta,
      'status', 'scheduled', 'request', 'Fechadura não abre com tag', 'created_by', ua),
    '[]'::jsonb);
  perform tests.ok(wo = wo2, '9b. criação de OS é idempotente por request id');
  perform tests.reset();

  perform tests.login(ta);
  insert into public.work_order_equipment (company_id, work_order_id, model_id, notes)
    values (ca, wo, model, 'fechadura da entrada principal');
  perform tests.reset();

  -- 10) OS iniciada
  perform tests.login(ua);
  update public.work_orders set status = 'in_progress' where id = wo;
  perform tests.reset();

  -- 11-12) Base Técnica preenchida na finalização (relato = fonte do caso)
  perform tests.login(ta);
  perform public.zt_finalize_work_order_atomic(wo,
    'DIAGNÓSTICO' || chr(10) || 'Fonte da fechadura em curto.' || chr(10) ||
    'SERVIÇO EXECUTADO' || chr(10) || 'Substituída a fonte 12V e recadastradas as tags.' || chr(10) ||
    'RESULTADO' || chr(10) || 'Equipamento funcionando, testado com 3 tags.',
    null, 0, 7, '[]'::jsonb, '[]'::jsonb);
  perform tests.reset();

  -- 13) caso aparece na Central Técnica para a Empresa A
  perform tests.login(ta);
  select count(*) into v_count from public.zt_equipment_cases(ca, model, 10, 0);
  perform tests.ok(v_count = 1, '13. caso resolvido aparece para Technician A');
  select * into v_case from public.zt_equipment_cases(ca, model, 10, 0) limit 1;
  perform tests.ok(v_case.symptom like 'Fechadura não abre%', '13b. sintoma vem da OS');
  perform tests.ok(v_case.report like '%Fonte da fechadura em curto%', '13c. relato vem da Base Técnica');
  perform tests.ok(v_case.completed_on = current_date, '13d. data de conclusão presente');

  -- 14) caso NÃO contém preço, cliente ou endereço
  v_txt := v_case::text;
  perform tests.ok(position('150' in v_txt) = 0, '14. caso não expõe valor cobrado');
  perform tests.ok(position('Cliente Confidencial' in v_txt) = 0, '14b. caso não expõe nome do cliente');
  perform tests.ok(position('Rua Secreta' in v_txt) = 0, '14c. caso não expõe endereço');
  -- a cobrança existe no financeiro (fluxo completo rodou), mas fora do caso
  perform tests.reset();
  select count(*) into v_count from public.financial_entries where work_order_id = wo and amount = 150;
  perform tests.ok(v_count = 1, '14d. financeiro gerado pela finalização (fora da Central Técnica)');

  -- 15) Owner B não enxerga
  perform tests.login(ub);
  perform tests.must_fail(
    format('select * from public.zt_equipment_cases(%L,%L,10,0)', ca, model),
    '15. Owner B consulta casos da A');
  select count(*) into v_count from public.zt_equipment_search(cb, 'CT 100', null, 10, 0);
  perform tests.ok(v_count = 0, '15b. busca da B não devolve modelo da A');
  perform tests.reset();

  -- 16) Technician B não enxerga
  perform tests.login(tb);
  perform tests.must_fail(
    format('select * from public.zt_equipment_cases(%L,%L,10,0)', ca, model),
    '16. Technician B consulta casos da A');
  select count(*) into v_count from public.equipment_quick_guides;
  perform tests.ok(v_count = 0, '16b. Technician B não vê fichas da A');
  perform tests.reset();

  -- 17) busca devolve apenas registros autorizados
  perform tests.login(ta);
  select count(*) into v_count from public.zt_equipment_search(ca, 'CT 100', null, 10, 0);
  perform tests.ok(v_count = 1, '17. busca do técnico A segue devolvendo só o autorizado');
  perform tests.reset();

  raise notice 'Golden path Central Técnica: 17 passos verdes.';
end $$;

rollback;
