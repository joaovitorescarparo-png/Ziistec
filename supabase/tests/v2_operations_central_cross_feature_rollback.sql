-- ZiisTec CROSS-FEATURE — Central de Operações (0116) e Central Técnica segura
-- (0113-0115 corrigidas) sobre a MESMA ordem de serviço.
--
-- Owner cria a OS -> vincula o modelo técnico -> distribui para o Technician A
-- pelo despacho oficial -> o técnico vê a própria OS -> usa a Ajuda Técnica
-- (ficha e manual) -> registra a Base Técnica -> conclui -> o Owner PUBLICA o
-- caso curado -> um segundo técnico consulta o caso -> e nada de PII, texto
-- bruto da OS ou financeiro vaza em nenhum ponto.
--
-- Usa as identidades de ci_local_seed.sql. SOMENTE CI descartável; ROLLBACK.

begin;

create temp table zt_xf (name text primary key, ok boolean not null, detail text) on commit drop;
grant select, insert, update on zt_xf to authenticated, anon;

create function pg_temp.xf_check(p_name text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into zt_xf(name,ok,detail) values(p_name,coalesce(p_ok,false),left(p_detail,500));
$$;
create function pg_temp.xf_count(p_sql text) returns bigint language plpgsql as $$
declare n bigint;
begin execute 'select count(*) from ('||p_sql||') q' into n; return n;
exception when others then return -1; end $$;
create function pg_temp.xf_state(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'ok';
exception when others then return sqlstate; end $$;
create function pg_temp.xf_as(p_uid uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claim.sub',p_uid::text,true);
  perform set_config('request.jwt.claims',json_build_object('sub',p_uid,'role','authenticated','aal','aal1')::text,true);
  set local role authenticated;
end $$;
grant execute on function pg_temp.xf_check(text,boolean,text), pg_temp.xf_count(text),
  pg_temp.xf_state(text), pg_temp.xf_as(uuid) to authenticated, anon;

-- ---------------------------------------------------------------- fixtures
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal1"}',true);

-- Segundo técnico da Empresa A: é ele que vai CONSULTAR o caso publicado.
insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('00000000-0000-0000-0000-000000000000','10000000-0000-4000-8000-0000000000a2','authenticated','authenticated','ci-tech-a2@example.invalid','',now(),'{}'::jsonb,'{}'::jsonb,now(),now())
on conflict (id) do nothing;
insert into public.profiles(id,full_name,email)
values ('10000000-0000-4000-8000-0000000000a2','CI Technician A2','ci-tech-a2@example.invalid')
on conflict (id) do nothing;
insert into public.company_members(company_id,user_id,role,status,job_title)
values ('20000000-0000-0000-0000-000000000001','10000000-0000-4000-8000-0000000000a2','technician','active','CI Tech A2')
on conflict (company_id,user_id) do update set role='technician',status='active';

-- Cliente com PII, local, e OS com valor aprovado: tudo que NÃO pode vazar.
insert into public.clients(id,company_id,person_type,name,phone,address,tax_id,contact_name)
values ('f1000000-0000-4000-8000-000000000001','20000000-0000-0000-0000-000000000001','PJ',
        'Edifício Plaza Confidencial','11977776666','Rua Sigilosa 404','98765432000188','Sindico Pedro Sigiloso');
insert into public.client_locations(id,company_id,client_id,name,location_key)
values ('f1000000-0000-4000-8000-00000000d001','20000000-0000-0000-0000-000000000001',
        'f1000000-0000-4000-8000-000000000001','Garagem / Rampa','garagem / rampa');
insert into public.products(id,company_id,name,brand,model,unit,cost,price,warranty_months,active)
values ('f1000000-0000-4000-8000-00000000a001','20000000-0000-0000-0000-000000000001',
        'Fechadura Demo CT-100','Fabricante Demo','CT-100','unidade',300,699,12,true);

-- Modelo técnico privado da empresa, com ficha e manual.
insert into public.equipment_manufacturers(id,company_id,name,website,created_by)
values ('f1000000-0000-4000-8000-00000000e001','20000000-0000-0000-0000-000000000001',
        'Fabricante Demo','https://exemplo.invalid','10000000-0000-0000-0000-000000000001');
insert into public.equipment_models(id,company_id,manufacturer_id,category_id,name,model_code,description,tags,created_by)
select 'f1000000-0000-4000-8000-00000000c001','20000000-0000-0000-0000-000000000001',
       'f1000000-0000-4000-8000-00000000e001',c.id,'CT-100','CT 100',
       'Fechadura eletrônica de demonstração',array['fechadura','acesso'],
       '10000000-0000-0000-0000-000000000001'
  from public.equipment_categories c where c.company_id is null and c.slug='fechaduras';
insert into public.equipment_quick_guides(company_id,model_id,sections,created_by)
values ('20000000-0000-0000-0000-000000000001','f1000000-0000-4000-8000-00000000c001',
  '[{"kind":"power","title":"Alimentação","items":[{"label":"Tensão","value":"12 VDC"}]},
    {"kind":"codes","title":"Códigos","items":[{"code":"E4","meaning":"Sensor de porta aberto","action":"Conferir o chicote"}]}]'::jsonb,
  '10000000-0000-0000-0000-000000000001');
insert into public.equipment_documents(company_id,model_id,title,doc_type,source_kind,official_url,created_by)
values ('20000000-0000-0000-0000-000000000001','f1000000-0000-4000-8000-00000000c001',
        'Manual CT-100','manual','official_url','https://exemplo.invalid/ct100.pdf',
        '10000000-0000-0000-0000-000000000001');

-- A OS que vai atravessar as duas features, com texto bruto e valor.
insert into public.work_orders(id,company_id,number,client_id,client_location_id,status,
  request,problem_report,scheduled_date,scheduled_time,approved_total,extra_cost)
values ('f1000000-0000-4000-8000-00000000b001','20000000-0000-0000-0000-000000000001','CI-XF-001',
        'f1000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-00000000d001','unscheduled',
        'SEGREDO-REQUEST: sindico Pedro reclamou do portao',
        'SEGREDO-PROBLEMA: morador ficou preso na rampa',
        current_date,'09:00',4321.99,77.70);

-- ====================== 1-2. Operações: a OS nasce sem responsável e é vinculada
do $$
declare v_board jsonb;
begin
  perform pg_temp.xf_as('10000000-0000-0000-0000-000000000001');

  v_board := public.zt_operations_board('20000000-0000-0000-0000-000000000001',current_date,current_date+7);
  perform pg_temp.xf_check('1_quadro_mostra_a_os_sem_responsavel',
    exists(select 1 from jsonb_array_elements(v_board->'cards') c
            where c->>'number'='CI-XF-001' and c->'assignee_id'='null'::jsonb), null);
  -- a mesma OS, no quadro, já não expõe nada financeiro nem PII
  perform pg_temp.xf_check('1b_quadro_sem_valor_nem_pii',
    v_board::text !~* '(4321\.99|77\.70|11977776666|98765432000188|Sindico Pedro Sigiloso)', null);

  -- vínculo do modelo técnico (Central Técnica) na MESMA OS
  insert into public.work_order_equipment(company_id,work_order_id,model_id,notes,created_by)
  values ('20000000-0000-0000-0000-000000000001','f1000000-0000-4000-8000-00000000b001',
          'f1000000-0000-4000-8000-00000000c001','fechadura da rampa',
          '10000000-0000-0000-0000-000000000001');
  perform pg_temp.xf_check('2_equipamento_vinculado_a_mesma_os',
    pg_temp.xf_count($q$select 1 from public.work_order_equipment where work_order_id='f1000000-0000-4000-8000-00000000b001'$q$)=1, null);

  -- 3. despacho oficial para o Technician A
  perform pg_temp.xf_check('3_despacho_para_tecnico_a',
    (public.zt_assign_work_order('f1000000-0000-4000-8000-00000000b001',
      '10000000-0000-0000-0000-000000000003','f1000000-0000-4000-8000-00000000f001')->>'action')='assign', null);
  perform pg_temp.xf_check('3b_auditoria_do_despacho_registrada',
    pg_temp.xf_count($q$select 1 from public.work_order_dispatch_events where work_order_id='f1000000-0000-4000-8000-00000000b001' and action='assign'$q$)=1, null);
end $$;
reset role;

-- ============ 4-6. Technician A: vê a OS, usa a Ajuda Técnica, registra a Base
do $$
declare v_base jsonb;
begin
  perform pg_temp.xf_as('10000000-0000-0000-0000-000000000003');

  perform pg_temp.xf_check('4_tecnico_ve_a_os_que_recebeu',
    pg_temp.xf_count($q$select 1 from public.work_orders where id='f1000000-0000-4000-8000-00000000b001'$q$)=1, null);
  perform pg_temp.xf_check('4b_tecnico_nao_le_valor_aprovado',
    pg_temp.xf_count($q$select approved_total from public.work_orders where id='f1000000-0000-4000-8000-00000000b001'$q$)=-1, null);
  perform pg_temp.xf_check('4c_tecnico_le_prioridade',
    pg_temp.xf_count($q$select priority from public.work_orders where id='f1000000-0000-4000-8000-00000000b001'$q$)=1, null);
  perform pg_temp.xf_check('4d_tecnico_nao_recebe_o_quadro_da_equipe',
    pg_temp.xf_state($q$select public.zt_operations_board('20000000-0000-0000-0000-000000000001',current_date,current_date+7)$q$)='42501', null);

  -- 5. Ajuda Técnica: ficha e manual do equipamento vinculado àquela OS
  perform pg_temp.xf_check('5_ajuda_tecnica_abre_a_ficha_pelo_vinculo',
    pg_temp.xf_count($q$
      select 1 from public.work_order_equipment e
        join public.equipment_quick_guides g on g.model_id=e.model_id and g.status='active'
       where e.work_order_id='f1000000-0000-4000-8000-00000000b001'$q$)=1, null);
  perform pg_temp.xf_check('5b_ajuda_tecnica_abre_o_manual',
    pg_temp.xf_count($q$
      select 1 from public.work_order_equipment e
        join public.equipment_documents d on d.model_id=e.model_id and d.status='active'
       where e.work_order_id='f1000000-0000-4000-8000-00000000b001'$q$)=1, null);
  perform pg_temp.xf_check('5c_tecnico_busca_por_codigo_de_erro',
    pg_temp.xf_count($q$select 1 from public.zt_equipment_search('20000000-0000-0000-0000-000000000001','E4')$q$)=1, null);

  -- 6. Base Técnica pela RPC da 0111 (interna; não é caso automaticamente)
  v_base := public.zt_save_work_order_technical_base(
    'f1000000-0000-4000-8000-00000000b001',
    'BASE-INTERNA: fonte em curto por infiltração',
    'BASE-INTERNA: fonte trocada e caixa vedada',
    'medium',
    'BASE-INTERNA: conferir vedação antes de trocar a placa',
    'f1000000-0000-4000-8000-00000000f002');
  perform pg_temp.xf_check('6_base_tecnica_registrada', coalesce(v_base->>'revision','')='1', v_base::text);
end $$;
reset role;

-- ========== 7. Base Técnica interna NÃO vira caso sozinha (regra do security fix)
do $$
begin
  perform pg_temp.xf_as('10000000-0000-4000-8000-0000000000a2');
  perform pg_temp.xf_check('7_sem_publicacao_nao_existe_caso',
    pg_temp.xf_count($q$select 1 from public.zt_equipment_cases('20000000-0000-0000-0000-000000000001','f1000000-0000-4000-8000-00000000c001')$q$)=0, null);
end $$;
reset role;

-- ==================================== 8. conclusão da OS pelo fluxo oficial
do $$
begin
  perform pg_temp.xf_as('10000000-0000-0000-0000-000000000003');
  perform public.zt_finalize_work_order_with_warranty_overrides(
    'f1000000-0000-4000-8000-00000000b001','Atendimento concluído e testado.',null,0,7,'[]'::jsonb,'[]'::jsonb,null);
end $$;
reset role;
set constraints all immediate;
do $$
begin
  perform pg_temp.xf_check('8_os_concluida',
    (select status='done' from public.work_orders where id='f1000000-0000-4000-8000-00000000b001'), null);
  perform pg_temp.xf_check('8b_os_concluida_sai_da_distribuicao',
    pg_temp.xf_count($q$select 1 from public.work_order_dispatch_events where work_order_id='f1000000-0000-4000-8000-00000000b001'$q$)>=1, null);
end $$;

-- ======= 9. só o Owner publica o caso curado; o técnico não publica
do $$
begin
  perform pg_temp.xf_as('10000000-0000-0000-0000-000000000003');
  perform pg_temp.xf_check('9_tecnico_nao_publica_caso',
    pg_temp.xf_state($q$select public.zt_publish_work_order_technical_case(
      'f1000000-0000-4000-8000-00000000b001','sintoma','causa','solucao','aprendizado',gen_random_uuid())$q$)='42501', null);
  reset role;

  perform pg_temp.xf_as('10000000-0000-0000-0000-000000000002');
  perform pg_temp.xf_check('9b_owner_b_nao_publica_caso_da_a',
    pg_temp.xf_state($q$select public.zt_publish_work_order_technical_case(
      'f1000000-0000-4000-8000-00000000b001','sintoma','causa','solucao','aprendizado',gen_random_uuid())$q$)='42501', null);
  reset role;

  perform pg_temp.xf_as('10000000-0000-0000-0000-000000000001');
  perform pg_temp.xf_check('9c_owner_publica_caso_curado',
    pg_temp.xf_state($q$select public.zt_publish_work_order_technical_case(
      'f1000000-0000-4000-8000-00000000b001',
      'Portao da rampa nao abre com tag',
      'Fonte de 12V em curto por infiltracao',
      'Fonte substituida e caixa vedada',
      'Conferir vedacao antes de trocar a placa',
      'f1000000-0000-4000-8000-00000000f003')$q$)='ok', null);
end $$;
reset role;

-- ====== 10. o segundo técnico consulta o caso: conteúdo curado e nada mais
do $$
declare
  v_caso record;
  v_linha text;
begin
  perform pg_temp.xf_as('10000000-0000-4000-8000-0000000000a2');

  perform pg_temp.xf_check('10_caso_publicado_visivel_para_outro_tecnico',
    pg_temp.xf_count($q$select 1 from public.zt_equipment_cases('20000000-0000-0000-0000-000000000001','f1000000-0000-4000-8000-00000000c001')$q$)=1, null);

  select * into v_caso
    from public.zt_equipment_cases('20000000-0000-0000-0000-000000000001','f1000000-0000-4000-8000-00000000c001') limit 1;
  v_linha := v_caso::text;

  perform pg_temp.xf_check('10b_caso_traz_o_texto_curado',
    v_caso.cause like '%curto por infiltracao%' and v_caso.solution like '%caixa vedada%', v_caso::text);
  perform pg_temp.xf_check('10c_caso_traz_dificuldade_e_aprendizado',
    v_caso.difficulty='medium' and v_caso.learning like '%vedacao%', null);
  perform pg_temp.xf_check('10d_caso_marca_unidade_identificada_como_booleano',
    v_caso.unit_identified is not null, null);

  -- o texto bruto da OS e a Base Técnica interna NUNCA aparecem
  perform pg_temp.xf_check('11_caso_sem_texto_bruto_da_os',
    position('SEGREDO-REQUEST' in v_linha)=0 and position('SEGREDO-PROBLEMA' in v_linha)=0, null);
  perform pg_temp.xf_check('11b_caso_sem_base_tecnica_interna',
    position('BASE-INTERNA' in v_linha)=0, null);
  -- nem PII do cliente, nem número/id da OS, nem financeiro
  perform pg_temp.xf_check('11c_caso_sem_pii_do_cliente',
    v_linha !~* '(Plaza Confidencial|11977776666|Rua Sigilosa|98765432000188|Sindico Pedro Sigiloso)', null);
  perform pg_temp.xf_check('11d_caso_sem_identificacao_da_os',
    position('CI-XF-001' in v_linha)=0 and position('f1000000-0000-4000-8000-00000000b001' in v_linha)=0, null);
  perform pg_temp.xf_check('11e_caso_sem_financeiro',
    v_linha !~* '(4321|77\.70|699|300)', null);

  -- e o técnico que consulta o caso segue sem o quadro e sem financeiro
  perform pg_temp.xf_check('12_tecnico_consultor_nao_recebe_quadro',
    pg_temp.xf_state($q$select public.zt_operations_board('20000000-0000-0000-0000-000000000001',current_date,current_date+7)$q$)='42501', null);
  perform pg_temp.xf_check('12b_tecnico_consultor_nao_ve_a_os_de_outro',
    pg_temp.xf_count($q$select 1 from public.work_orders where id='f1000000-0000-4000-8000-00000000b001'$q$)=0, null);
end $$;
reset role;

-- ================= 13. Empresa B não alcança nada disso
do $$
begin
  perform pg_temp.xf_as('10000000-0000-0000-0000-000000000002');
  perform pg_temp.xf_check('13_owner_b_nao_le_caso_da_a',
    pg_temp.xf_state($q$select public.zt_equipment_cases('20000000-0000-0000-0000-000000000001','f1000000-0000-4000-8000-00000000c001')$q$)='42501', null);
  perform pg_temp.xf_check('13b_owner_b_nao_ve_vinculo_da_a',
    pg_temp.xf_count('select 1 from public.work_order_equipment')=0, null);
  perform pg_temp.xf_check('13c_owner_b_nao_ve_auditoria_de_despacho_da_a',
    pg_temp.xf_count($q$select 1 from public.work_order_dispatch_events where company_id='20000000-0000-0000-0000-000000000001'$q$)=0, null);
  perform pg_temp.xf_check('13d_owner_b_nao_distribui_os_da_a',
    pg_temp.xf_state($q$select public.zt_assign_work_order('f1000000-0000-4000-8000-00000000b001','10000000-0000-0000-0000-000000000003',gen_random_uuid())$q$)='42501', null);
end $$;
reset role;

-- ================= 14. installed_equipment segue a autoridade física
do $$
begin
  perform pg_temp.xf_check('14_installed_equipment_segue_a_autoridade_fisica',
    exists(select 1 from information_schema.columns
            where table_schema='public' and table_name='installed_equipment' and column_name='equipment_model_id')
    and exists(select 1 from information_schema.tables
            where table_schema='public' and table_name='installed_equipment'), null);
  perform pg_temp.xf_check('14b_despacho_nao_criou_conceito_paralelo_de_equipamento',
    not exists(select 1 from information_schema.tables
                where table_schema='public'
                  and table_name in ('operations_equipment','dispatch_equipment','work_order_assets')), null);
  perform pg_temp.xf_check('14c_base_tecnica_continua_a_fonte_interna',
    exists(select 1 from public.work_order_technical_base
            where work_order_id='f1000000-0000-4000-8000-00000000b001'
              and cause like 'BASE-INTERNA%'), null);
end $$;

do $$
declare v_failures text;
begin
  select string_agg(name||' => '||coalesce(detail,''),' ; ' order by name) into v_failures
    from zt_xf where not ok;
  if v_failures is not null then raise exception 'CROSS_FEATURE_FAILED: %', v_failures; end if;
  if (select count(*) from zt_xf) < 28 then
    raise exception 'CROSS_FEATURE_INCOMPLETE: % checks',(select count(*) from zt_xf);
  end if;
end $$;

select 'OPERATIONS_CENTRAL_CROSS_FEATURE' as test, count(*) as checks, bool_and(ok) as all_ok from zt_xf;

rollback;
