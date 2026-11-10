-- =====================================================================
-- ZiisTec · Central Técnica — matriz adversarial de RLS
-- Roda no banco descartável depois da cadeia completa de migrations.
-- Papéis: anônimo, Owner A, Technician A, Owner B, Technician B.
-- =====================================================================
\set ON_ERROR_STOP on

-- helper: espera falha (permissão/validação). Falha do teste se passar.
create or replace function tests.must_fail(p_sql text, p_msg text) returns void
language plpgsql as $$
begin
  execute p_sql;
  raise exception 'TESTE FALHOU (ação deveria ser bloqueada): %', p_msg;
exception
  when others then
    if sqlerrm like 'TESTE FALHOU%' then raise; end if;
    -- bloqueio esperado (RLS, grant, guard ou check)
end $$;
grant execute on function tests.must_fail(text, text) to public;

-- todo o cenário roda numa transação descartada no final: o teste é
-- re-executável e não deixa dados no banco.
begin;

do $$
declare
  ua uuid; ta uuid; ub uuid; tb uuid;          -- usuários
  ca uuid; cb uuid;                            -- empresas
  cat_global uuid;                             -- categoria global (seed)
  mfr_a uuid; model_a uuid; guide_a uuid; doc_a uuid;
  mfr_b uuid; model_b uuid;
  client_a uuid; wo_a uuid;
  v_count int; v_txt text;
begin
  -- ----------------------------------------------------------- fixtures
  perform tests.reset();
  insert into auth.users (email) values ('owner.a@teste.zii') returning id into ua;
  insert into auth.users (email) values ('tech.a@teste.zii')  returning id into ta;
  insert into auth.users (email) values ('owner.b@teste.zii') returning id into ub;
  insert into auth.users (email) values ('tech.b@teste.zii')  returning id into tb;

  perform tests.login(ua);
  ca := public.zt_create_company('Empresa A','seguranca eletronica',true,null,null);
  perform tests.reset();
  perform tests.login(ub);
  cb := public.zt_create_company('Empresa B','portoes',true,null,null);
  perform tests.reset();

  insert into public.company_members(company_id,user_id,role,status) values
    (ca, ta, 'technician', 'active'),
    (cb, tb, 'technician', 'active');

  select id into cat_global from public.equipment_categories
   where company_id is null and slug = 'fechaduras';
  perform tests.ok(cat_global is not null, 'seed de categorias globais presente');

  -- ======================================================= ANÔNIMO = 0
  perform tests.anon();
  perform tests.must_fail('select count(*) from public.equipment_models', 'anon lê equipment_models');
  perform tests.must_fail('select count(*) from public.equipment_categories', 'anon lê categorias');
  perform tests.must_fail('select count(*) from public.equipment_quick_guides', 'anon lê fichas');
  perform tests.must_fail('select count(*) from public.equipment_documents', 'anon lê documentos');
  perform tests.must_fail('select count(*) from public.work_order_equipment', 'anon lê vínculos de OS');
  perform tests.must_fail(
    format('select * from public.zt_equipment_search(%L,%L,null,10,0)', ca, 'teste'),
    'anon executa busca');
  perform tests.must_fail(
    format('select * from public.zt_equipment_cases(%L,%L,10,0)', ca, gen_random_uuid()),
    'anon executa casos');
  perform tests.reset();

  -- =============================================== OWNER A cria conteúdo
  perform tests.login(ua);

  insert into public.equipment_manufacturers (company_id, name, website)
    values (ca, 'Fabricante Demo', 'https://exemplo.dev') returning id into mfr_a;
  insert into public.equipment_models (company_id, manufacturer_id, category_id, name, model_code, description, tags, created_by)
    values (ca, mfr_a, cat_global, 'CT-100', 'CT 100', 'Fechadura de demonstração', array['fechadura','demo'], ua)
    returning id into model_a;
  insert into public.equipment_quick_guides (company_id, model_id, sections, created_by)
    values (ca, model_a, '[{"kind":"power","title":"Alimentação","items":[{"label":"Tensão","value":"12 VDC"}]},
                          {"kind":"reset","title":"Reset","items":[{"label":"Reset total","steps":["Desligue a fonte","Segure o botão por 10s"]}]},
                          {"kind":"codes","title":"Códigos","items":[{"code":"E4","meaning":"Sensor aberto","action":"Verificar chicote"}]}]'::jsonb, ua)
    returning id into guide_a;
  insert into public.equipment_documents (company_id, model_id, title, doc_type, source_kind, official_url, created_by)
    values (ca, model_a, 'Manual oficial CT-100', 'manual', 'official_url', 'https://exemplo.dev/ct100.pdf', ua)
    returning id into doc_a;

  -- owner vê global + próprio
  select count(*) into v_count from public.equipment_categories;
  perform tests.ok(v_count >= 11, 'Owner A vê categorias globais');
  select count(*) into v_count from public.equipment_models;
  perform tests.ok(v_count = 1, 'Owner A vê o próprio modelo');

  -- owner NÃO cria conteúdo global (platform admin AAL2 apenas)
  perform tests.must_fail(
    format('insert into public.equipment_categories (company_id,name,slug) values (null,%L,%L)', 'Hack', 'hack'),
    'Owner A cria categoria GLOBAL');
  perform tests.must_fail(
    format('insert into public.equipment_models (company_id,manufacturer_id,category_id,name) values (null,%L,%L,%L)', mfr_a, cat_global, 'Global fake'),
    'Owner A cria modelo GLOBAL');
  -- owner não edita conteúdo global (RLS filtra a linha: update não afeta nada)
  update public.equipment_categories set name = 'Renomeada' where id = cat_global;
  select name into v_txt from public.equipment_categories where id = cat_global;
  perform tests.ok(v_txt = 'Fechaduras', 'Owner A não altera categoria global');

  -- ficha inválida é rejeitada (estrutura validada)
  perform tests.must_fail(
    format('insert into public.equipment_quick_guides (company_id,model_id,sections) values (%L,%L,%L)',
      ca, model_a, '{"solto":"blob"}'::text),
    'ficha sem array de seções');
  perform tests.must_fail(
    format('insert into public.equipment_quick_guides (company_id,model_id,sections) values (%L,%L,%L)',
      ca, model_a, '[{"kind":"invalido","title":"x"}]'::text),
    'ficha com kind inválido');
  perform tests.reset();

  -- =============================================== OWNER B isolado de A
  perform tests.login(ub);
  insert into public.equipment_manufacturers (company_id, name) values (cb, 'Marca B') returning id into mfr_b;
  insert into public.equipment_models (company_id, manufacturer_id, category_id, name, model_code, created_by)
    values (cb, mfr_b, cat_global, 'PB-900', 'PB 900', ub) returning id into model_b;

  select count(*) into v_count from public.equipment_models;
  perform tests.ok(v_count = 1, 'Owner B vê apenas o próprio modelo (não o da A)');
  select count(*) into v_count from public.equipment_quick_guides;
  perform tests.ok(v_count = 0, 'Owner B não vê ficha da Empresa A');
  select count(*) into v_count from public.equipment_documents;
  perform tests.ok(v_count = 0, 'Owner B não vê documento da Empresa A');

  -- escrita cruzada bloqueada (a linha nem é visível para B)
  update public.equipment_models set name = 'invadido' where id = model_a;
  perform tests.reset();
  select name into v_txt from public.equipment_models where id = model_a;
  perform tests.ok(v_txt = 'CT-100', 'Owner B não altera modelo da A');
  perform tests.login(ub);
  perform tests.must_fail(
    format('insert into public.equipment_models (company_id,manufacturer_id,category_id,name) values (%L,%L,%L,%L)',
      cb, mfr_a, cat_global, 'Roubo de fabricante'),
    'Owner B usa fabricante da A');
  -- busca da B não devolve modelo da A
  select count(*) into v_count from public.zt_equipment_search(cb, 'CT-100', null, 10, 0);
  perform tests.ok(v_count = 0, 'busca da B não enxerga modelo da A');
  -- busca da B não roda no tenant A
  perform tests.must_fail(
    format('select * from public.zt_equipment_search(%L,%L,null,10,0)', ca, 'CT'),
    'Owner B busca no tenant A');
  perform tests.reset();

  -- ============================================ TECHNICIAN A (consulta)
  perform tests.login(ta);
  select count(*) into v_count from public.equipment_models;
  perform tests.ok(v_count = 1, 'Technician A vê modelo da empresa');
  select count(*) into v_count from public.equipment_quick_guides where model_id = model_a;
  perform tests.ok(v_count = 1, 'Technician A vê ficha da empresa');
  select count(*) into v_count from public.equipment_documents where model_id = model_a;
  perform tests.ok(v_count = 1, 'Technician A vê documento autorizado');
  select count(*) into v_count from public.zt_equipment_search(ca, 'fechadura demo', null, 10, 0);
  perform tests.ok(v_count = 1, 'busca por tag funciona para técnico');
  select count(*) into v_count from public.zt_equipment_search(ca, 'CT100', null, 10, 0);
  perform tests.ok(v_count = 1, 'busca por código compacto (CT100 → CT 100)');
  select count(*) into v_count from public.zt_equipment_search(ca, 'E4', null, 10, 0);
  perform tests.ok(v_count = 1, 'busca por código de erro via ficha');

  -- técnico NÃO administra a biblioteca
  perform tests.must_fail(
    format('insert into public.equipment_manufacturers (company_id,name) values (%L,%L)', ca, 'Tentativa Tech'),
    'Technician A cria fabricante');
  update public.equipment_quick_guides set title = 'hack' where id = guide_a;
  delete from public.equipment_documents where id = doc_a;
  select title into v_txt from public.equipment_quick_guides where id = guide_a;
  perform tests.ok(v_txt = 'Ficha rápida', 'Technician A não edita ficha');
  select count(*) into v_count from public.equipment_documents where id = doc_a;
  perform tests.ok(v_count = 1, 'Technician A não apaga documento');

  -- favoritos e recentes: próprios, funcionam
  insert into public.equipment_favorites (user_id, company_id, model_id) values (ta, ca, model_a);
  insert into public.equipment_recent_views (user_id, company_id, model_id) values (ta, ca, model_a)
    on conflict (user_id, company_id, model_id) do update set viewed_at = now();
  select count(*) into v_count from public.equipment_favorites;
  perform tests.ok(v_count = 1, 'Technician A favorita modelo');
  -- não favorita em nome de outro usuário nem em outra empresa
  perform tests.must_fail(
    format('insert into public.equipment_favorites (user_id,company_id,model_id) values (%L,%L,%L)', ua, ca, model_a),
    'Technician A favorita como Owner A');
  perform tests.must_fail(
    format('insert into public.equipment_favorites (user_id,company_id,model_id) values (%L,%L,%L)', ta, cb, model_b),
    'Technician A favorita na Empresa B');
  perform tests.reset();

  -- ======================================= OS + vínculo de equipamento
  perform tests.login(ua);
  insert into public.clients (company_id, person_type, name) values (ca, 'PF', 'Cliente Sigiloso') returning id into client_a;
  wo_a := public.zt_save_work_order_idempotent(ca, null, gen_random_uuid(),
    jsonb_build_object('company_id', ca, 'client_id', client_a, 'assigned_to', ta,
                       'status', 'scheduled', 'scheduled_date', current_date::text,
                       'request', 'Fechadura não abre', 'created_by', ua),
    '[]'::jsonb);
  perform tests.reset();

  -- técnico vincula equipamento à própria OS aberta
  perform tests.login(ta);
  insert into public.work_order_equipment (company_id, work_order_id, model_id, notes)
    values (ca, wo_a, model_a, 'equipamento da recepção');
  select count(*) into v_count from public.work_order_equipment where work_order_id = wo_a;
  perform tests.ok(v_count = 1, 'Technician A vincula equipamento à própria OS');
  perform tests.reset();

  -- técnico B / owner B não enxergam nem mexem no vínculo da A
  perform tests.login(tb);
  select count(*) into v_count from public.work_order_equipment;
  perform tests.ok(v_count = 0, 'Technician B não vê vínculos da A');
  perform tests.must_fail(
    format('insert into public.work_order_equipment (company_id,work_order_id,model_id) values (%L,%L,%L)', cb, wo_a, model_b),
    'Technician B vincula modelo à OS da A');
  perform tests.must_fail(
    format('select * from public.zt_equipment_cases(%L,%L,10,0)', ca, model_a),
    'Technician B consulta casos da A');
  perform tests.reset();

  -- ====================================== storage: caminhos por tenant
  perform tests.login(ua);
  insert into storage.objects (bucket_id, name, owner)
    values ('zt-equipment-docs', ca || '/equipment/' || model_a || '/manual.pdf', ua);
  perform tests.reset();

  perform tests.login(ta);
  select count(*) into v_count from storage.objects where bucket_id = 'zt-equipment-docs';
  perform tests.ok(v_count = 1, 'Technician A lê documento da empresa no bucket');
  perform tests.must_fail(
    format('insert into storage.objects (bucket_id,name,owner) values (%L,%L,%L)',
      'zt-equipment-docs', ca || '/equipment/' || model_a || '/tech.pdf', ta),
    'Technician A grava no bucket (owner apenas)');
  perform tests.reset();

  perform tests.login(ub);
  select count(*) into v_count from storage.objects where bucket_id = 'zt-equipment-docs';
  perform tests.ok(v_count = 0, 'Owner B não lê documento da empresa A no bucket');
  perform tests.must_fail(
    format('insert into storage.objects (bucket_id,name,owner) values (%L,%L,%L)',
      'zt-equipment-docs', ca || '/equipment/' || model_a || '/intruso.pdf', ub),
    'Owner B grava em caminho da empresa A');
  perform tests.reset();

  -- ====================================== escopo global é blindado
  -- nem via UPDATE movendo company_id para null
  perform tests.login(ua);
  perform tests.must_fail(
    format('update public.equipment_models set company_id = null where id = %L', model_a),
    'Owner A promove modelo próprio a global');
  perform tests.reset();

  raise notice 'RLS Central Técnica: todos os cenários passaram.';
end $$;

rollback;
