-- ZiisTec · Auditoria de segurança V1 — invariantes de catálogo, isolamento entre empresas, técnico x proprietário,
-- usuário desativado, anônimo e Storage. Complementa os testes por recurso (Blocos 3–5, RC1B, canário de RLS).
-- Usa as identidades sintéticas de ci_local_seed.sql. Destino: SOMENTE CI descartável ou homologação.
-- Tudo termina em ROLLBACK.

begin;

create temp table sec_results (name text primary key, ok boolean not null, detail text) on commit drop;
grant select, insert, update on sec_results to authenticated, anon;

create function pg_temp.sec_check(p_name text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into sec_results(name,ok,detail) values (p_name,coalesce(p_ok,false),left(p_detail,400));
$$;

-- SQLSTATE do comando ('ok' quando passa) e linhas afetadas.
create function pg_temp.sec_state(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $$;

create function pg_temp.sec_affected(p_sql text) returns integer language plpgsql as $$
declare n integer;
begin execute p_sql; get diagnostics n = row_count; return n; exception when others then return -1; end $$;

-- Executa uma consulta/chamada e devolve 'ERR:<sqlstate>' ou o texto do resultado (para procurar dado da vítima).
create function pg_temp.sec_probe(p_sql text) returns text language plpgsql as $$
declare v text;
begin
  execute format('select coalesce(string_agg(r::text, E''\n''), '''') from (%s) r', p_sql) into v;
  return coalesce(v,'');
exception when others then return 'ERR:'||sqlstate;
end $$;

-- ---------------------------------------------------------------- 1. invariantes de catálogo (como dono do banco)
do $$
declare v_list text;
begin
  select string_agg(c.relname, ',' order by c.relname) into v_list
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind in ('r','p') and not c.relrowsecurity;
  perform pg_temp.sec_check('catalogo_toda_tabela_public_tem_rls', v_list is null, v_list);

  select string_agg(c.relname, ',' order by c.relname) into v_list
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind in ('r','p','v','m')
     and (has_table_privilege('anon',c.oid,'SELECT') or has_table_privilege('anon',c.oid,'INSERT')
          or has_table_privilege('anon',c.oid,'UPDATE') or has_table_privilege('anon',c.oid,'DELETE'));
  perform pg_temp.sec_check('catalogo_anon_sem_privilegio_de_tabela', v_list is null, v_list);

  -- Funções do aplicativo (fora de extensões) nunca executáveis por anon nem por PUBLIC.
  select string_agg(p.proname, ',' order by p.proname) into v_list
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public'
     and not exists (select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')
     and (has_function_privilege('anon',p.oid,'EXECUTE')
          or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE'));
  perform pg_temp.sec_check('catalogo_funcoes_do_app_sem_execute_anon_ou_public', v_list is null, v_list);

  select string_agg(tablename||'.'||policyname, ',') into v_list
    from pg_policies
   where schemaname='public'
     and (regexp_replace(coalesce(qual,''),'[() ]','','g')='true' or regexp_replace(coalesce(with_check,''),'[() ]','','g')='true');
  perform pg_temp.sec_check('catalogo_nenhuma_policy_literalmente_true', v_list is null, v_list);

  select string_agg(tablename||'.'||policyname, ',') into v_list
    from pg_policies where schemaname='public' and cmd='UPDATE' and with_check is null;
  perform pg_temp.sec_check('catalogo_update_sempre_com_with_check', v_list is null, v_list);

  select string_agg(c.relname, ',' order by c.relname) into v_list
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind in ('v','m')
     and not (coalesce(c.reloptions,array[]::text[]) @> array['security_invoker=true']);
  perform pg_temp.sec_check('catalogo_views_public_sao_security_invoker', v_list is null, v_list);

  select string_agg(table_name, ',') into v_list
    from (select c.relname as table_name from pg_class c join pg_namespace n on n.oid=c.relnamespace
           where n.nspname='public' and c.relkind='r'
             and has_table_privilege('authenticated',c.oid,'DELETE')
             and c.relname not in ('attachments','clients','company_invites','financial_entries','products','purchase_items','purchases',
                                   'quote_items','quotes','services','suppliers','work_order_checklists','work_order_items','work_order_materials',
                                   'maintenance_contracts','work_orders','quote_templates','quote_template_items','quote_kits','quote_kit_items',
                                   'work_order_reports','warranties')) x;
  perform pg_temp.sec_check('catalogo_delete_direto_so_em_tabelas_revisadas', v_list is null, v_list);

  select string_agg(table_name, ',') into v_list
    from (select c.relname as table_name from pg_class c join pg_namespace n on n.oid=c.relnamespace
           where n.nspname='public' and c.relkind='r'
             and (has_table_privilege('authenticated',c.oid,'INSERT') or has_table_privilege('authenticated',c.oid,'UPDATE'))
             and c.relname not in ('attachments','clients','companies','company_invites','company_members','financial_entries','maintenance_contracts','products',
                                   'purchase_items','purchases','quote_items','quotes','services','suppliers','user_route_preferences',
                                   'work_order_checklists','work_order_items','work_order_materials','work_order_reports','work_orders',
                                   'quote_templates','quote_template_items','quote_kits','quote_kit_items','warranties','profiles','platform_audit_logs')) x;
  perform pg_temp.sec_check('catalogo_escrita_direta_so_em_tabelas_revisadas', v_list is null, v_list);

  select string_agg(id, ',') into v_list from storage.buckets where public;
  perform pg_temp.sec_check('storage_nenhum_bucket_publico', v_list is null, v_list);

  select string_agg(id, ',') into v_list from storage.buckets
   where (allowed_mime_types is null or file_size_limit is null) and id like 'zt-%';
  perform pg_temp.sec_check('storage_buckets_zt_com_limite_e_mime', v_list is null, v_list);

  select string_agg(id, ',') into v_list from storage.buckets where allowed_mime_types && array['image/svg+xml','text/html','application/javascript','text/javascript'];
  perform pg_temp.sec_check('storage_sem_mime_executavel_permitido', v_list is null, v_list);
end $$;

-- ---------------------------------------------------------------- 2. fixtures: empresa B (vítima) e empresa A
-- Gravação fora dos fluxos oficiais: gatilhos desligados só para semear; voltam a 'origin' antes dos ataques.
select set_config('sec.a','20000000-0000-0000-0000-000000000001',true), set_config('sec.b','20000000-0000-0000-0000-000000000002',true);
set local session_replication_role = replica;

insert into public.clients(id,company_id,name,phone,address) values
  ('b0000000-0000-4000-8000-000000000001','20000000-0000-0000-0000-000000000002','ZZVITIMA Cliente','11999990000','Rua ZZVITIMA, 1'),
  ('a0000000-0000-4000-8000-000000000001','20000000-0000-0000-0000-000000000001','Cliente A','11988880000','Rua A, 1');
insert into public.suppliers(id,company_id,name) values ('b0000000-0000-4000-8000-000000000002','20000000-0000-0000-0000-000000000002','ZZVITIMA Fornecedor');
insert into public.products(id,company_id,name,cost,price,sale_enabled) values
  ('b0000000-0000-4000-8000-000000000003','20000000-0000-0000-0000-000000000002','ZZVITIMA Produto',70,100,true),
  ('a0000000-0000-4000-8000-000000000003','20000000-0000-0000-0000-000000000001','Produto A',7777.77,9999.99,true);
insert into public.services(id,company_id,name,price) values ('b0000000-0000-4000-8000-000000000004','20000000-0000-0000-0000-000000000002','ZZVITIMA Servico',50);
insert into public.quotes(id,company_id,number,client_id,notes) values ('b0000000-0000-4000-8000-000000000005','20000000-0000-0000-0000-000000000002','ORC-B-1','b0000000-0000-4000-8000-000000000001','ZZVITIMA nota');
insert into public.work_orders(id,company_id,number,client_id,assigned_to,status,request,address) values
  ('b0000000-0000-4000-8000-000000000006','20000000-0000-0000-0000-000000000002','OS-B-1','b0000000-0000-4000-8000-000000000001','10000000-0000-0000-0000-000000000002','scheduled','ZZVITIMA pedido','Rua ZZVITIMA, 1'),
  ('a0000000-0000-4000-8000-000000000006','20000000-0000-0000-0000-000000000001','OS-A-1','a0000000-0000-4000-8000-000000000001','10000000-0000-0000-0000-000000000003','scheduled','pedido A','Rua A, 1'),
  ('a0000000-0000-4000-8000-000000000007','20000000-0000-0000-0000-000000000001','OS-A-2','a0000000-0000-4000-8000-000000000001','10000000-0000-0000-0000-000000000001','scheduled','pedido A2','Rua A, 1');
insert into public.work_order_items(id,work_order_id,company_id,kind,name,unit_price,unit_cost) values
  ('b0000000-0000-4000-8000-000000000013','b0000000-0000-4000-8000-000000000006','20000000-0000-0000-0000-000000000002','free','ZZVITIMA item OS',10,0),
  ('a0000000-0000-4000-8000-000000000021','a0000000-0000-4000-8000-000000000006','20000000-0000-0000-0000-000000000001','free','Item A',6666.66,3333.33);
insert into public.work_order_item_costs(work_order_item_id,work_order_id,company_id,unit_cost) values
  ('a0000000-0000-4000-8000-000000000021','a0000000-0000-4000-8000-000000000006','20000000-0000-0000-0000-000000000001',3333.33);
insert into public.work_order_reports(id,work_order_id,company_id,body,author_id,entry_type) values
  ('b0000000-0000-4000-8000-000000000014','b0000000-0000-4000-8000-000000000006','20000000-0000-0000-0000-000000000002','ZZVITIMA relato','10000000-0000-0000-0000-000000000002','report');
insert into public.financial_entries(id,company_id,kind,description,amount,due_date,client_id) values
  ('b0000000-0000-4000-8000-000000000007','20000000-0000-0000-0000-000000000002','income','ZZVITIMA lancamento',900,current_date,'b0000000-0000-4000-8000-000000000001'),
  ('a0000000-0000-4000-8000-000000000008','20000000-0000-0000-0000-000000000001','income','Receita A',8888.88,current_date,'a0000000-0000-4000-8000-000000000001');
insert into public.warranties(id,company_id,client_id,kind,description,ends_on) values
  ('b0000000-0000-4000-8000-000000000008','20000000-0000-0000-0000-000000000002','b0000000-0000-4000-8000-000000000001','service','ZZVITIMA garantia',current_date+30);
insert into public.attachments(id,company_id,bucket,path,file_name,work_order_id,uploaded_by) values
  ('b0000000-0000-4000-8000-000000000009','20000000-0000-0000-0000-000000000002','zt-work-orders','20000000-0000-0000-0000-000000000002/work-orders/b0000000-0000-4000-8000-000000000006/f.jpg','ZZVITIMA.jpg','b0000000-0000-4000-8000-000000000006','10000000-0000-0000-0000-000000000002');
insert into public.purchases(id,company_id,number,supplier_name) values ('b0000000-0000-4000-8000-000000000010','20000000-0000-0000-0000-000000000002','CMP-B-1','ZZVITIMA Fornecedor');
insert into public.maintenance_contracts(id,company_id,client_id,name,amount) values
  ('b0000000-0000-4000-8000-000000000011','20000000-0000-0000-0000-000000000002','b0000000-0000-4000-8000-000000000001','ZZVITIMA contrato',500),
  ('a0000000-0000-4000-8000-000000000011','20000000-0000-0000-0000-000000000001','a0000000-0000-4000-8000-000000000001','Contrato A',2222.22);
insert into public.client_locations(id,company_id,client_id,name,location_key,address) values
  ('b0000000-0000-4000-8000-000000000012','20000000-0000-0000-0000-000000000002','b0000000-0000-4000-8000-000000000001','ZZVITIMA local','loc-b','Rua ZZVITIMA');
insert into public.service_receipts(id,company_id,work_order_id,client_id,number,version,snapshot,request_id,issued_by) values
  ('b0000000-0000-4000-8000-000000000015','20000000-0000-0000-0000-000000000002','b0000000-0000-4000-8000-000000000006','b0000000-0000-4000-8000-000000000001','CS-B-1',1,'{"x":"ZZVITIMA"}'::jsonb,'b0000000-0000-4000-8000-000000000099','10000000-0000-0000-0000-000000000002');
insert into storage.objects(id,bucket_id,name,metadata) values
  ('b0000000-0000-4000-8000-0000000000a1','zt-work-orders','20000000-0000-0000-0000-000000000002/work-orders/b0000000-0000-4000-8000-000000000006/b.jpg','{}'::jsonb),
  ('b0000000-0000-4000-8000-0000000000a2','zt-documents','20000000-0000-0000-0000-000000000002/purchases/p/boleto.pdf','{}'::jsonb),
  ('a0000000-0000-4000-8000-0000000000a1','zt-work-orders','20000000-0000-0000-0000-000000000001/work-orders/a0000000-0000-4000-8000-000000000006/mine.jpg','{}'::jsonb),
  ('a0000000-0000-4000-8000-0000000000a2','zt-work-orders','20000000-0000-0000-0000-000000000001/work-orders/a0000000-0000-4000-8000-000000000007/owner-only.jpg','{}'::jsonb),
  ('a0000000-0000-4000-8000-0000000000a3','zt-documents','20000000-0000-0000-0000-000000000001/purchases/p/boleto.pdf','{}'::jsonb);

set local session_replication_role = origin;
do $$ begin
  if current_setting('session_replication_role') <> 'origin' then raise exception 'SEC_AUDIT_REQUIRES_ORIGIN'; end if;
end $$;

-- Tabelas com company_id e o instantâneo das linhas da empresa B (comparado no fim).
create temp table sec_tables on commit drop as
  select c.relname::text as t from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind='r'
     and exists (select 1 from pg_attribute a where a.attrelid=c.oid and a.attname='company_id' and not a.attisdropped);
grant select on sec_tables to authenticated, anon;

create function pg_temp.sec_snapshot() returns text language plpgsql as $$
declare r record; v text:=''; n bigint; h text;
begin
  for r in select t from sec_tables order by t loop
    execute format('select count(*), md5(coalesce(string_agg(x::text,''|'' order by x::text),'''')) from public.%I x where company_id=%L',r.t,'20000000-0000-0000-0000-000000000002') into n,h;
    v:=v||r.t||':'||n||':'||h||';';
  end loop;
  return md5(v);
end $$;

create temp table sec_state_before(h text) on commit drop;
insert into sec_state_before select pg_temp.sec_snapshot();
select pg_temp.sec_check('fixture_vitima_possui_linhas', (select count(*) from public.clients where company_id='20000000-0000-0000-0000-000000000002')=1, null);

-- RPCs/consultas disparadas com ids da vítima. As respostas nunca podem trazer dado da empresa B.
create temp table sec_rpc(label text primary key, sql text not null) on commit drop;
grant select on sec_rpc to authenticated, anon;
insert into sec_rpc values
  ('issue_receipt',        $q$select public.zt_issue_service_receipt('b0000000-0000-4000-8000-000000000006','b0000000-0000-4000-8000-000000000098',null,null)$q$),
  ('client_history',       $q$select public.zt_client_service_history('b0000000-0000-4000-8000-000000000001',null,20)$q$),
  ('wo_history_detail',    $q$select public.zt_work_order_history_detail('b0000000-0000-4000-8000-000000000006')$q$),
  ('service_report',       $q$select public.zt_get_service_report('b0000000-0000-4000-8000-000000000006')$q$),
  ('field_items',          $q$select * from public.zt_field_work_order_items('20000000-0000-0000-0000-000000000002','b0000000-0000-4000-8000-000000000006')$q$),
  ('quote_seed',           $q$select public.zt_quote_seed_from_work_order('b0000000-0000-4000-8000-000000000006')$q$),
  ('client_locations',     $q$select public.zt_list_client_locations_for_quote('b0000000-0000-4000-8000-000000000001')$q$),
  ('adjust_stock',         $q$select public.zt_adjust_product_stock('20000000-0000-0000-0000-000000000002','b0000000-0000-4000-8000-000000000003',5,'x')$q$),
  ('set_paid',             $q$select public.zt_set_financial_paid('b0000000-0000-4000-8000-000000000007',true,'pix')$q$),
  ('contract_cycle',       $q$select public.zt_generate_maintenance_contract_cycle('b0000000-0000-4000-8000-000000000011',current_date,null,null)$q$),
  ('technician_catalog',   $q$select public.zt_technician_catalog('20000000-0000-0000-0000-000000000002')$q$),
  ('save_wo_report',       $q$select public.zt_save_work_order_report('b0000000-0000-4000-8000-000000000006','ZZ','b0000000-0000-4000-8000-000000000097')$q$),
  ('sell_on_wo',           $q$select public.zt_sell_product_on_work_order('b0000000-0000-4000-8000-000000000006','b0000000-0000-4000-8000-000000000003',1,'x','b0000000-0000-4000-8000-000000000096')$q$),
  ('global_search',        $q$select public.zt_global_operational_search('20000000-0000-0000-0000-000000000002','ZZVITIMA',30,0)$q$),
  ('assistant_read',       $q$select public.zt_assistant_read('20000000-0000-0000-0000-000000000002','owner_find_client','{"query":"ZZVITIMA"}'::jsonb,'b0000000-0000-4000-8000-000000000095')$q$),
  ('assistant_plan',       $q$select public.zt_assistant_plan('20000000-0000-0000-0000-000000000002','create_quote_draft','{"client":"ZZVITIMA","items":[]}'::jsonb,'b0000000-0000-4000-8000-000000000094')$q$),
  ('assistant_reference',  $q$select public.zt_assistant_reference('20000000-0000-0000-0000-000000000002','client','b0000000-0000-4000-8000-000000000001')$q$),
  ('save_quote_b',         $q$select public.zt_save_quote_idempotent('20000000-0000-0000-0000-000000000002',null,'b0000000-0000-4000-8000-000000000093','{"client_id":"b0000000-0000-4000-8000-000000000001"}'::jsonb,'[]'::jsonb)$q$),
  ('manual_fin_b',         $q$select public.zt_save_manual_financial_entry('20000000-0000-0000-0000-000000000002',null,'b0000000-0000-4000-8000-000000000092','{"kind":"income","description":"x","amount":1,"due_date":"2026-01-01"}'::jsonb)$q$),
  ('refresh_subscription', $q$select public.zt_refresh_subscription_status('20000000-0000-0000-0000-000000000002')$q$),
  ('platform_list',        $q$select * from public.zt_platform_list_beta_invites()$q$),
  ('platform_renew',       $q$select public.zt_platform_renew_subscription('20000000-0000-0000-0000-000000000002',current_date+30,'active','x')$q$);

-- Rodada de ataques como proprietário A, técnico A, usuário sem empresa e técnico A desativado.
create temp table sec_users(label text primary key, uid uuid not null) on commit drop;
insert into sec_users values ('owner_a','10000000-0000-0000-0000-000000000001'),('tech_a','10000000-0000-0000-0000-000000000003'),('external','10000000-0000-0000-0000-000000000004');
grant select on sec_users to authenticated, anon;

-- 3a. proprietário A
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
do $$
declare r record; v text; n integer; leaks text:=''; reads text:=''; writes text:=''; deletes text:='';
begin
  for r in select t from sec_tables order by t loop
    n:=pg_temp.sec_affected(format('select 1 from public.%I where company_id=%L',r.t,'20000000-0000-0000-0000-000000000002'));
    if n>0 then reads:=reads||r.t||','; end if;
    n:=pg_temp.sec_affected(format('update public.%I set company_id=company_id where company_id=%L',r.t,'20000000-0000-0000-0000-000000000002'));
    if n>0 then writes:=writes||r.t||','; end if;
    n:=pg_temp.sec_affected(format('delete from public.%I where company_id=%L',r.t,'20000000-0000-0000-0000-000000000002'));
    if n>0 then deletes:=deletes||r.t||','; end if;
  end loop;
  perform pg_temp.sec_check('a_owner_nao_le_nenhuma_tabela_da_empresa_b', reads='', reads);
  perform pg_temp.sec_check('a_owner_nao_altera_nenhuma_tabela_da_empresa_b', writes='', writes);
  perform pg_temp.sec_check('a_owner_nao_apaga_nenhuma_tabela_da_empresa_b', deletes='', deletes);

  for r in select label, sql from sec_rpc where label not like 'platform%' order by label loop
    v:=pg_temp.sec_probe(r.sql);
    if v !~ '^ERR:' and (v ilike '%ZZVITIMA%' or v like '%20000000-0000-0000-0000-000000000002%' or v like '%b0000000-0000-4000-8000%') then leaks:=leaks||r.label||','; end if;
  end loop;
  perform pg_temp.sec_check('a_owner_rpcs_com_ids_da_vitima_nao_vazam', leaks='', leaks);
  for r in select label, sql from sec_rpc where label in ('issue_receipt','client_history','wo_history_detail','service_report','field_items','adjust_stock','set_paid','contract_cycle','technician_catalog','save_wo_report','sell_on_wo') order by label loop
    v:=pg_temp.sec_probe(r.sql);
    perform pg_temp.sec_check('a_owner_rpc_negada_'||r.label, v ~ '^ERR:(42501|P0002|P0001|28000)', left(v,160));
  end loop;
  for r in select label, sql from sec_rpc where label in ('assistant_read','assistant_plan') order by label loop
    v:=pg_temp.sec_probe(r.sql);
    perform pg_temp.sec_check('a_owner_'||r.label||'_acesso_negado', v like '%ACCESS_DENIED%', left(v,160));
  end loop;
  for r in select label, sql from sec_rpc where label like 'platform%' order by label loop
    v:=pg_temp.sec_probe(r.sql);
    perform pg_temp.sec_check('a_owner_'||r.label||'_exige_admin_da_plataforma', v ~ '^ERR:42501', left(v,160));
  end loop;
end $$;

-- 3b. referências cruzadas: dono A grava linhas da empresa A apontando para ids da empresa B
do $$
declare s text;
begin
  perform pg_temp.sec_check('b_insert_com_company_id_da_vitima_negado',
    pg_temp.sec_state($q$insert into public.clients(company_id,name) values ('20000000-0000-0000-0000-000000000002','x')$q$)='42501', null);
  perform pg_temp.sec_check('b_orcamento_para_cliente_da_vitima_negado',
    pg_temp.sec_state($q$insert into public.quotes(company_id,number,client_id) values ('20000000-0000-0000-0000-000000000001','ORC-X','b0000000-0000-4000-8000-000000000001')$q$) in ('23503','23514'), null);
  perform pg_temp.sec_check('b_os_para_cliente_da_vitima_negado',
    pg_temp.sec_state($q$update public.work_orders set client_id='b0000000-0000-4000-8000-000000000001' where id='a0000000-0000-4000-8000-000000000007'$q$) in ('23503','23514'), null);
  perform pg_temp.sec_check('b_os_com_orcamento_da_vitima_negado',
    pg_temp.sec_state($q$update public.work_orders set quote_id='b0000000-0000-4000-8000-000000000005' where id='a0000000-0000-4000-8000-000000000007'$q$) in ('23503','23514'), null);
  perform pg_temp.sec_check('b_os_com_responsavel_de_outra_empresa_negado',
    pg_temp.sec_state($q$update public.work_orders set assigned_to='10000000-0000-0000-0000-000000000002' where id='a0000000-0000-4000-8000-000000000007'$q$) in ('23503','23514'), null);
  perform pg_temp.sec_check('b_item_de_os_com_produto_da_vitima_negado',
    pg_temp.sec_state($q$insert into public.work_order_items(work_order_id,company_id,kind,name,product_id) values ('a0000000-0000-4000-8000-000000000007','20000000-0000-0000-0000-000000000001','product','x','b0000000-0000-4000-8000-000000000003')$q$) in ('23503','23514'), null);
  perform pg_temp.sec_check('b_item_na_os_da_vitima_negado',
    pg_temp.sec_state($q$insert into public.work_order_items(work_order_id,company_id,kind,name) values ('b0000000-0000-4000-8000-000000000006','20000000-0000-0000-0000-000000000001','free','x')$q$) in ('23503','23514','42501'), null);
  perform pg_temp.sec_check('b_contrato_para_cliente_da_vitima_negado',
    pg_temp.sec_state($q$insert into public.maintenance_contracts(company_id,client_id,name) values ('20000000-0000-0000-0000-000000000001','b0000000-0000-4000-8000-000000000001','x')$q$) in ('23503','23514'), null);
  perform pg_temp.sec_check('b_anexo_com_caminho_da_vitima_negado',
    pg_temp.sec_state($q$insert into public.attachments(company_id,bucket,path,file_name) values ('20000000-0000-0000-0000-000000000001','zt-work-orders','20000000-0000-0000-0000-000000000002/work-orders/x/x.jpg','x')$q$) in ('23514','23503'), null);
  perform pg_temp.sec_check('b_membership_nao_migra_para_empresa_da_vitima',
    pg_temp.sec_state($q$update public.company_members set company_id='20000000-0000-0000-0000-000000000002' where user_id='10000000-0000-0000-0000-000000000003'$q$)='42501', null);
  perform pg_temp.sec_check('b_membership_nao_pode_ser_inserida_pela_data_api',
    pg_temp.sec_state($q$insert into public.company_members(company_id,user_id,role,status) values ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000004','owner','active')$q$)='42501', null);
  perform pg_temp.sec_check('b_assinatura_nao_e_alteravel_pelo_dono',
    pg_temp.sec_state($q$update public.subscriptions set status='active', current_period_end=current_date+9999 where company_id='20000000-0000-0000-0000-000000000001'$q$)='42501', null);
  perform pg_temp.sec_check('b_perfil_nao_vira_admin_da_plataforma',
    pg_temp.sec_state($q$update public.profiles set is_platform_admin=true where id='10000000-0000-0000-0000-000000000001'$q$)='42501', null);
  -- billing_entry_id e approved_* são forçados pelo banco: a edição direta não muda nada.
  update public.work_orders set billing_entry_id='b0000000-0000-4000-8000-000000000007', approved_total=1 where id='a0000000-0000-4000-8000-000000000007';
end $$;
reset role;
-- approved_* não tem SELECT nem para o dono (leitura só por RPC); a conferência é feita como dono do banco.
select pg_temp.sec_check('b_billing_entry_e_snapshot_nao_sao_reescritos_pelo_dono',
  (select billing_entry_id is null and approved_total is null from public.work_orders where id='a0000000-0000-4000-8000-000000000007'), null);

-- 3c. usuário sem empresa, técnico A e técnico A desativado: nada da empresa B e nada privado da empresa A
create function pg_temp.sec_as_outsider(p_label text) returns void language plpgsql as $$
declare r record; v text; n integer; reads text:=''; writes text:=''; leaks text:='';
begin
  for r in select t from sec_tables order by t loop
    if pg_temp.sec_affected(format('select 1 from public.%I where company_id=%L',r.t,'20000000-0000-0000-0000-000000000002'))>0 then reads:=reads||r.t||','; end if;
    if pg_temp.sec_affected(format('update public.%I set company_id=company_id where company_id=%L',r.t,'20000000-0000-0000-0000-000000000002'))>0 then writes:=writes||r.t||','; end if;
  end loop;
  perform pg_temp.sec_check(p_label||'_nao_le_empresa_b', reads='', reads);
  perform pg_temp.sec_check(p_label||'_nao_altera_empresa_b', writes='', writes);
  for r in select label, sql from sec_rpc where label not like 'platform%' order by label loop
    v:=pg_temp.sec_probe(r.sql);
    if v !~ '^ERR:' and (v ilike '%ZZVITIMA%' or v like '%20000000-0000-0000-0000-000000000002%' or v like '%b0000000-0000-4000-8000%') then leaks:=leaks||r.label||','; end if;
  end loop;
  perform pg_temp.sec_check(p_label||'_rpcs_nao_vazam_empresa_b', leaks='', leaks);
end $$;

select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000004',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
select pg_temp.sec_as_outsider('c_sem_empresa');
do $$
declare v text;
begin
  perform pg_temp.sec_check('c_sem_empresa_nao_cria_empresa_sem_convite',
    pg_temp.sec_state($q$select public.zt_create_company('ZZ Nova','x',true,'Fulano','11999990000')$q$)='42501', null);
  perform pg_temp.sec_check('c_sem_empresa_nao_le_dados_da_empresa_a',
    (select count(*) from public.clients)=0 and (select count(*) from public.work_orders)=0 and (select count(*) from public.financial_entries)=0, null);
end $$;
reset role;

select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
select pg_temp.sec_as_outsider('c_tecnico_a');
reset role;

-- ---------------------------------------------------------------- 4. técnico x proprietário dentro da empresa A
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
set local role authenticated;
do $$
declare v text; priv text:='';
begin
  perform pg_temp.sec_check('d_tecnico_nao_le_snapshot_comercial_da_os',
    pg_temp.sec_state($q$select approved_total from public.work_orders where id='a0000000-0000-4000-8000-000000000006'$q$)='42501', null);
  perform pg_temp.sec_check('d_tecnico_le_a_propria_os',
    (select count(*) from public.work_orders where id='a0000000-0000-4000-8000-000000000006')=1, null);
  perform pg_temp.sec_check('d_tecnico_nao_le_os_nao_atribuida',
    (select count(*) from public.work_orders where id='a0000000-0000-4000-8000-000000000007')=0, null);
  perform pg_temp.sec_check('d_tecnico_nao_le_itens_com_preco',
    (select count(*) from public.work_order_items)=0, null);
  v:=pg_temp.sec_probe($q$select * from public.zt_field_work_order_items('20000000-0000-0000-0000-000000000001','a0000000-0000-4000-8000-000000000006')$q$);
  perform pg_temp.sec_check('d_tecnico_recebe_itens_sem_preco_nem_custo', v like '%Item A%' and v not like '%6666.66%' and v not like '%3333.33%', left(v,200));
  perform pg_temp.sec_check('d_tecnico_nao_le_tabelas_administrativas',
    (select count(*) from public.financial_entries)=0 and (select count(*) from public.quotes)=0 and (select count(*) from public.products)=0
    and (select count(*) from public.services)=0 and (select count(*) from public.suppliers)=0 and (select count(*) from public.purchases)=0
    and (select count(*) from public.maintenance_contracts)=0 and (select count(*) from public.work_order_item_costs)=0
    and (select count(*) from public.work_order_private_costs)=0 and (select count(*) from public.work_order_material_costs)=0
    and (select count(*) from public.inventory_movements)=0 and (select count(*) from public.service_receipts)=0, null);
  v:=pg_temp.sec_probe($q$select public.zt_technician_catalog('20000000-0000-0000-0000-000000000001')$q$);
  perform pg_temp.sec_check('d_catalogo_do_tecnico_sem_custo', v not like '%7777.77%', left(v,200));
  perform pg_temp.sec_check('d_tecnico_nao_administra_equipe',
    (select count(*) from public.company_members)=1 and pg_temp.sec_affected($q$update public.company_members set role='owner' where user_id='10000000-0000-0000-0000-000000000003'$q$)=0, null);
  perform pg_temp.sec_check('d_tecnico_nao_altera_empresa_nem_assinatura',
    pg_temp.sec_affected($q$update public.companies set name='x' where id='20000000-0000-0000-0000-000000000001'$q$)=0
    and pg_temp.sec_state($q$update public.subscriptions set status='active' where company_id='20000000-0000-0000-0000-000000000001'$q$)='42501', null);
  perform pg_temp.sec_check('d_tecnico_nao_cria_cadastros_nem_lancamentos',
    pg_temp.sec_state($q$insert into public.clients(company_id,name) values ('20000000-0000-0000-0000-000000000001','x')$q$)='42501'
    and pg_temp.sec_state($q$insert into public.products(company_id,name) values ('20000000-0000-0000-0000-000000000001','x')$q$)='42501'
    and pg_temp.sec_state($q$insert into public.financial_entries(company_id,kind,description,amount,due_date) values ('20000000-0000-0000-0000-000000000001','income','x',1,current_date)$q$)='42501', null);
  perform pg_temp.sec_check('d_tecnico_nao_conclui_nem_apaga_a_os_por_edicao_direta',
    pg_temp.sec_state($q$update public.work_orders set status='done' where id='a0000000-0000-4000-8000-000000000006'$q$)='42501'
    and pg_temp.sec_state($q$update public.work_orders set deleted_at=now() where id='a0000000-0000-4000-8000-000000000006'$q$)='42501', null);
  perform pg_temp.sec_check('d_tecnico_nao_inclui_item_com_preco',
    pg_temp.sec_state($q$insert into public.work_order_items(work_order_id,company_id,kind,name,is_extra,price_pending,unit_price) values ('a0000000-0000-4000-8000-000000000006','20000000-0000-0000-0000-000000000001','free','x',true,true,50)$q$)='42501', null);
  perform pg_temp.sec_check('d_tecnico_nao_grava_custo_interno_na_os',
    pg_temp.sec_state($q$insert into public.work_order_materials(work_order_id,company_id,name,quantity,unit_cost,created_by) values ('a0000000-0000-4000-8000-000000000006','20000000-0000-0000-0000-000000000001','Mat',1,999,'10000000-0000-0000-0000-000000000003')$q$)='42501', null);
  perform pg_temp.sec_check('d_tecnico_nao_cria_relatorio_de_atendimento',
    pg_temp.sec_state($q$insert into public.work_order_reports(work_order_id,company_id,entry_type,body,author_id) values ('a0000000-0000-4000-8000-000000000006','20000000-0000-0000-0000-000000000001','service_report','x','10000000-0000-0000-0000-000000000003')$q$)='42501', null);
  perform pg_temp.sec_check('d_tecnico_nao_emite_comprovante',
    pg_temp.sec_probe($q$select public.zt_issue_service_receipt('a0000000-0000-4000-8000-000000000006','a0000000-0000-4000-8000-000000000097',null,null)$q$) ~ '^ERR:42501', null);
  perform pg_temp.sec_check('d_tecnico_nao_consulta_historico_do_cliente',
    pg_temp.sec_probe($q$select public.zt_client_service_history('a0000000-0000-4000-8000-000000000001',null,20)$q$) ~ '^ERR:42501', null);
  perform pg_temp.sec_check('d_tecnico_nao_usa_financeiro_nem_estoque',
    pg_temp.sec_probe($q$select public.zt_set_financial_paid('a0000000-0000-4000-8000-000000000008',true,'pix')$q$) ~ '^ERR:'
    and pg_temp.sec_probe($q$select public.zt_adjust_product_stock('20000000-0000-0000-0000-000000000001','a0000000-0000-4000-8000-000000000003',5,'x')$q$) ~ '^ERR:42501', null);
  -- SEC-01 (0107): vínculo de contrato/ciclo da OS é campo administrativo/financeiro.
  perform pg_temp.sec_check('sec01_tecnico_nao_planta_ciclo_de_contrato',
    pg_temp.sec_state($q$update public.work_orders set maintenance_contract_id='a0000000-0000-4000-8000-000000000011', contract_cycle=current_date+30 where id='a0000000-0000-4000-8000-000000000006'$q$)='42501', null);
  perform pg_temp.sec_check('sec01_tecnico_nao_troca_contrato_da_os',
    pg_temp.sec_state($q$update public.work_orders set maintenance_contract_id='a0000000-0000-4000-8000-000000000011' where id='a0000000-0000-4000-8000-000000000006'$q$)='42501', null);
  perform pg_temp.sec_check('sec01_tecnico_continua_editando_campos_operacionais',
    pg_temp.sec_affected($q$update public.work_orders set pre_notes='observação do técnico' where id='a0000000-0000-4000-8000-000000000006'$q$)=1, null);
end $$;
reset role;

-- O proprietário continua podendo mexer no vínculo (fluxos administrativos e RPCs definer inalterados).
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
set local role authenticated;
do $$
begin
  perform pg_temp.sec_check('sec01_proprietario_continua_editando_o_vinculo_de_contrato',
    pg_temp.sec_affected($q$update public.work_orders set maintenance_contract_id='a0000000-0000-4000-8000-000000000011', contract_cycle=current_date+60 where id='a0000000-0000-4000-8000-000000000007'$q$)=1, null);
  perform pg_temp.sec_check('sec01_geracao_de_ciclo_pelo_proprietario_continua_funcionando',
    pg_temp.sec_probe($q$select public.zt_generate_maintenance_contract_cycle('a0000000-0000-4000-8000-000000000011',current_date+90,current_date+90,current_date+90)$q$) not like 'ERR:%', null);
end $$;
reset role;

-- ---------------------------------------------------------------- 5. técnico desativado perde o acesso imediatamente
update public.company_members set status='disabled' where user_id='10000000-0000-0000-0000-000000000003';
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
set local role authenticated;
do $$
declare v text; seen text:='';
begin
  perform pg_temp.sec_check('e_desativado_nao_le_a_propria_os', (select count(*) from public.work_orders)=0, null);
  perform pg_temp.sec_check('e_desativado_nao_le_clientes_nem_anexos', (select count(*) from public.clients)=0 and (select count(*) from public.attachments)=0, null);
  perform pg_temp.sec_check('e_desativado_nao_grava_na_os',
    pg_temp.sec_affected($q$update public.work_orders set pre_notes='x' where id='a0000000-0000-4000-8000-000000000006'$q$)=0, null);
  v:=pg_temp.sec_probe($q$select * from public.zt_field_work_order_items('20000000-0000-0000-0000-000000000001','a0000000-0000-4000-8000-000000000006')$q$);
  perform pg_temp.sec_check('e_desativado_nao_recebe_itens_de_campo', v ~ '^ERR:42501', left(v,120));
  v:=pg_temp.sec_probe($q$select public.zt_get_service_report('a0000000-0000-4000-8000-000000000006')$q$);
  perform pg_temp.sec_check('e_desativado_nao_le_relatorio', v ~ '^ERR:' or v='', left(v,120));
  v:=pg_temp.sec_probe($q$select public.zt_assistant_read('20000000-0000-0000-0000-000000000001','my_next_appointment','{}'::jsonb,'a0000000-0000-4000-8000-000000000095')$q$);
  perform pg_temp.sec_check('e_desativado_nao_usa_o_assistente', v like '%ACCESS_DENIED%' or v ~ '^ERR:', left(v,120));
  perform pg_temp.sec_check('e_desativado_nao_ve_objetos_de_storage', (select count(*) from storage.objects where name like '20000000-0000-0000-0000-000000000001/%')=0, null);
end $$;
reset role;

-- ---------------------------------------------------------------- 6. Storage: isolamento entre empresas e regra do técnico
update public.company_members set status='active' where user_id='10000000-0000-0000-0000-000000000003';
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
set local role authenticated;
do $$
begin
  perform pg_temp.sec_check('s_owner_nao_le_objetos_da_empresa_b', (select count(*) from storage.objects where name like '20000000-0000-0000-0000-000000000002/%')=0, null);
  perform pg_temp.sec_check('s_owner_le_os_proprios_objetos', (select count(*) from storage.objects where name like '20000000-0000-0000-0000-000000000001/%')=3, null);
  perform pg_temp.sec_check('s_owner_nao_grava_no_prefixo_da_empresa_b',
    pg_temp.sec_state($q$insert into storage.objects(bucket_id,name,owner_id) values ('zt-work-orders','20000000-0000-0000-0000-000000000002/work-orders/b0000000-0000-4000-8000-000000000006/x.jpg','x')$q$)='42501'
    and pg_temp.sec_state($q$insert into storage.objects(bucket_id,name,owner_id) values ('zt-documents','20000000-0000-0000-0000-000000000002/purchases/p/x.pdf','x')$q$)='42501', null);
  perform pg_temp.sec_check('s_owner_nao_altera_objetos_da_empresa_b',
    pg_temp.sec_affected($q$update storage.objects set metadata='{"x":1}'::jsonb where name like '20000000-0000-0000-0000-000000000002/%'$q$)=0, null);
end $$;
reset role;

select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
set local role authenticated;
do $$
begin
  perform pg_temp.sec_check('s_tecnico_le_so_a_foto_da_propria_os',
    (select count(*) from storage.objects where bucket_id='zt-work-orders' and name like '20000000-0000-0000-0000-000000000001/%')=1
    and (select count(*) from storage.objects where bucket_id='zt-documents')=0, null);
  perform pg_temp.sec_check('s_tecnico_grava_na_propria_os_aberta',
    pg_temp.sec_state($q$insert into storage.objects(bucket_id,name,owner_id) values ('zt-work-orders','20000000-0000-0000-0000-000000000001/work-orders/a0000000-0000-4000-8000-000000000006/novo.jpg','x')$q$)='ok', null);
  perform pg_temp.sec_check('s_tecnico_nao_grava_em_os_de_outro_nem_em_outros_buckets',
    pg_temp.sec_state($q$insert into storage.objects(bucket_id,name,owner_id) values ('zt-work-orders','20000000-0000-0000-0000-000000000001/work-orders/a0000000-0000-4000-8000-000000000007/novo.jpg','x')$q$)='42501'
    and pg_temp.sec_state($q$insert into storage.objects(bucket_id,name,owner_id) values ('zt-documents','20000000-0000-0000-0000-000000000001/purchases/p/x.pdf','x')$q$)='42501'
    and pg_temp.sec_state($q$insert into storage.objects(bucket_id,name,owner_id) values ('zt-branding','20000000-0000-0000-0000-000000000001/branding/logo.png','x')$q$)='42501', null);
end $$;
reset role;

-- ---------------------------------------------------------------- 7. anônimo
set local role anon;
do $$
declare s text; seen text:='';
begin
  perform pg_temp.sec_check('f_anon_nao_le_tabelas_de_negocio',
    pg_temp.sec_state($q$select 1 from public.clients$q$)='42501' and pg_temp.sec_state($q$select 1 from public.work_orders$q$)='42501'
    and pg_temp.sec_state($q$select 1 from public.financial_entries$q$)='42501' and pg_temp.sec_state($q$select 1 from public.profiles$q$)='42501'
    and pg_temp.sec_state($q$select 1 from public.user_route_preferences$q$)='42501', null);
  perform pg_temp.sec_check('f_anon_nao_executa_rpcs',
    pg_temp.sec_state($q$select public.zt_issue_service_receipt('b0000000-0000-4000-8000-000000000006','b0000000-0000-4000-8000-000000000098',null,null)$q$)='42501'
    and pg_temp.sec_state($q$select public.zt_is_owner('20000000-0000-0000-0000-000000000001')$q$)='42501'
    and pg_temp.sec_state($q$select * from public.zt_platform_list_beta_invites()$q$)='42501', null);
  perform pg_temp.sec_check('f_anon_nao_le_storage', pg_temp.sec_affected('select 1 from storage.objects') <= 0, null);
end $$;
reset role;

-- ---------------------------------------------------------------- 8. nenhuma linha da empresa B mudou durante os ataques
do $$
declare v_after text:=pg_temp.sec_snapshot(); v_before text;
begin
  select h into v_before from sec_state_before;
  perform pg_temp.sec_check('z_empresa_b_intacta_depois_de_todos_os_ataques', v_after=v_before, v_before||' / '||v_after);
end $$;

do $$
declare v_failures text;
begin
  select string_agg(name||' => '||coalesce(detail,''),' ; ' order by name) into v_failures from sec_results where not ok;
  if v_failures is not null then raise exception 'SECURITY_AUDIT_V1_FAILED: %', v_failures; end if;
  if (select count(*) from sec_results) <> 93 then
    raise exception 'SECURITY_AUDIT_V1_INCOMPLETE: % checks', (select count(*) from sec_results);
  end if;
end $$;

select 'SECURITY_AUDIT_V1' as test, count(*) as checks, bool_and(ok) as all_ok from sec_results;

rollback;
