-- ZiisTec Segurança V1.1 (SEC-03, 0108) — o fornecedor de um produto ou compra pertence à MESMA empresa.
-- A→A permitido; A→B negado no banco (produto e compra, INSERT e UPDATE); supplier_id nulo continua permitido;
-- o dono da empresa B segue normal; apagar o fornecedor anula só o vínculo e nunca o company_id.
-- Usa as identidades sintéticas de ci_local_seed.sql. Destino: SOMENTE CI descartável ou homologação.
-- Tudo termina em ROLLBACK.

begin;

create temp table zt_sup_results (name text primary key, ok boolean not null, detail text) on commit drop;
grant select, insert, update on zt_sup_results to authenticated, anon;

create function pg_temp.sup_check(p_name text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into zt_sup_results(name,ok,detail) values(p_name,coalesce(p_ok,false),left(p_detail,500));
$$;

-- SQLSTATE de uma instrução (ou 'ok').
create function pg_temp.sup_state(p_sql text)
returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate;
end $$;

do $$
begin
  if (select count(*) from public.company_members where role='owner' and status='active'
        and (company_id,user_id) in (('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001'),
                                     ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002')))<>2 then
    raise exception 'SUPPLIER_FK_FIXTURE_MISSING';
  end if;
end $$;

-- ---------------------------------------------------------------- catálogo
do $$
declare v_products text; v_purchases text;
begin
  select pg_get_constraintdef(oid) into v_products from pg_constraint where conrelid='public.products'::regclass and conname='products_supplier_company_fk';
  select pg_get_constraintdef(oid) into v_purchases from pg_constraint where conrelid='public.purchases'::regclass and conname='purchases_supplier_company_fk';
  perform pg_temp.sup_check('fk_produto_composta_por_empresa', v_products ~ '^FOREIGN KEY \(supplier_id, company_id\) REFERENCES suppliers\(id, company_id\) ON DELETE SET NULL \(supplier_id\)$', v_products);
  perform pg_temp.sup_check('fk_compra_composta_por_empresa', v_purchases ~ '^FOREIGN KEY \(supplier_id, company_id\) REFERENCES suppliers\(id, company_id\) ON DELETE SET NULL \(supplier_id\)$', v_purchases);
  perform pg_temp.sup_check('fk_simples_antiga_removida', not exists (
    select 1 from pg_constraint where contype='f' and confrelid='public.suppliers'::regclass and array_length(conkey,1)=1), 'nenhuma FK de coluna única aponta para suppliers');
  perform pg_temp.sup_check('suppliers_unique_id_empresa', exists (
    select 1 from pg_constraint where conrelid='public.suppliers'::regclass and conname='suppliers_id_company_key' and contype='u'
      and pg_get_constraintdef(oid)='UNIQUE (id, company_id)'), null);
  perform pg_temp.sup_check('supplier_id_continua_anulavel', not exists (
    select 1 from information_schema.columns where table_schema='public' and column_name='supplier_id'
      and table_name in ('products','purchases') and is_nullable='NO'), null);
  perform pg_temp.sup_check('company_id_nao_anulavel_pelo_set_null', not exists (
    select 1 from information_schema.columns where table_schema='public' and column_name='company_id'
      and table_name in ('products','purchases','suppliers') and is_nullable='YES'), null);
  -- Mesma consulta de leitura que a migration usa para falhar fechada: o ambiente não tem vínculo cruzado.
  perform pg_temp.sup_check('nenhum_vinculo_cruzado_no_ambiente',
    not exists (select 1 from public.products p join public.suppliers s on s.id=p.supplier_id where s.company_id<>p.company_id)
    and not exists (select 1 from public.purchases p join public.suppliers s on s.id=p.supplier_id where s.company_id<>p.company_id), null);
end $$;

-- ---------------------------------------------------------------- fixtures (fora dos fluxos oficiais, só para semear)
set local session_replication_role = replica;
insert into public.suppliers(id,company_id,name) values
  ('a1000000-0000-4000-8000-000000000001','20000000-0000-0000-0000-000000000001','SUP A1'),
  ('b1000000-0000-4000-8000-000000000001','20000000-0000-0000-0000-000000000002','SUP B1');
set local session_replication_role = origin;

-- ---------------------------------------------------------------- dono da empresa A
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;

do $$
begin
  perform pg_temp.sup_check('a_ve_so_o_proprio_fornecedor',
    (select count(*) from public.suppliers where id='a1000000-0000-4000-8000-000000000001')=1
    and (select count(*) from public.suppliers where id='b1000000-0000-4000-8000-000000000001')=0, null);

  -- Produto
  perform pg_temp.sup_check('produto_A_com_fornecedor_A_permitido',
    pg_temp.sup_state($q$insert into public.products(id,company_id,name,supplier_id) values ('a2000000-0000-4000-8000-000000000001','20000000-0000-0000-0000-000000000001','Produto A com SUP A','a1000000-0000-4000-8000-000000000001')$q$)='ok', null);
  perform pg_temp.sup_check('produto_A_com_fornecedor_B_negado',
    pg_temp.sup_state($q$insert into public.products(id,company_id,name,supplier_id) values ('a2000000-0000-4000-8000-000000000002','20000000-0000-0000-0000-000000000001','Produto A com SUP B','b1000000-0000-4000-8000-000000000001')$q$)='23503', null);
  perform pg_temp.sup_check('produto_A_sem_fornecedor_permitido',
    pg_temp.sup_state($q$insert into public.products(id,company_id,name,supplier_id) values ('a2000000-0000-4000-8000-000000000003','20000000-0000-0000-0000-000000000001','Produto A sem fornecedor',null)$q$)='ok', null);
  perform pg_temp.sup_check('produto_A_troca_para_fornecedor_B_negado',
    pg_temp.sup_state($q$update public.products set supplier_id='b1000000-0000-4000-8000-000000000001' where id in ('a2000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000003')$q$)='23503'
    and (select count(*) from public.products where supplier_id='b1000000-0000-4000-8000-000000000001')=0, null);
  perform pg_temp.sup_check('produto_A_troca_para_fornecedor_A_e_para_nulo_permitido',
    pg_temp.sup_state($q$update public.products set supplier_id='a1000000-0000-4000-8000-000000000001' where id='a2000000-0000-4000-8000-000000000003'$q$)='ok'
    and pg_temp.sup_state($q$update public.products set supplier_id=null where id='a2000000-0000-4000-8000-000000000003'$q$)='ok', null);

  -- Compra
  perform pg_temp.sup_check('compra_A_com_fornecedor_A_permitida',
    pg_temp.sup_state($q$insert into public.purchases(id,company_id,number,supplier_id,supplier_name) values ('a3000000-0000-4000-8000-000000000001','20000000-0000-0000-0000-000000000001','ZZ-SUP-1','a1000000-0000-4000-8000-000000000001','SUP A1')$q$)='ok', null);
  perform pg_temp.sup_check('compra_A_com_fornecedor_B_negada',
    pg_temp.sup_state($q$insert into public.purchases(id,company_id,number,supplier_id,supplier_name) values ('a3000000-0000-4000-8000-000000000002','20000000-0000-0000-0000-000000000001','ZZ-SUP-2','b1000000-0000-4000-8000-000000000001','SUP B1')$q$)='23503', null);
  perform pg_temp.sup_check('compra_A_sem_fornecedor_permitida',
    pg_temp.sup_state($q$insert into public.purchases(id,company_id,number,supplier_id,supplier_name) values ('a3000000-0000-4000-8000-000000000003','20000000-0000-0000-0000-000000000001','ZZ-SUP-3',null,'Avulso')$q$)='ok', null);
  perform pg_temp.sup_check('compra_A_troca_para_fornecedor_B_negada',
    pg_temp.sup_state($q$update public.purchases set supplier_id='b1000000-0000-4000-8000-000000000001' where id in ('a3000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000003')$q$)='23503'
    and (select count(*) from public.purchases where supplier_id='b1000000-0000-4000-8000-000000000001')=0, null);
end $$;

-- ---------------------------------------------------------------- dono da empresa B segue normal
reset role;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;

do $$
begin
  perform pg_temp.sup_check('produto_B_com_fornecedor_B_permitido',
    pg_temp.sup_state($q$insert into public.products(id,company_id,name,supplier_id) values ('b2000000-0000-4000-8000-000000000001','20000000-0000-0000-0000-000000000002','Produto B com SUP B','b1000000-0000-4000-8000-000000000001')$q$)='ok', null);
  perform pg_temp.sup_check('compra_B_com_fornecedor_B_permitida',
    pg_temp.sup_state($q$insert into public.purchases(id,company_id,number,supplier_id,supplier_name) values ('b3000000-0000-4000-8000-000000000001','20000000-0000-0000-0000-000000000002','ZZ-SUP-B1','b1000000-0000-4000-8000-000000000001','SUP B1')$q$)='ok', null);
  perform pg_temp.sup_check('produto_B_com_fornecedor_A_negado',
    pg_temp.sup_state($q$insert into public.products(id,company_id,name,supplier_id) values ('b2000000-0000-4000-8000-000000000002','20000000-0000-0000-0000-000000000002','Produto B com SUP A','a1000000-0000-4000-8000-000000000001')$q$)='23503', null);
  perform pg_temp.sup_check('compra_B_com_fornecedor_A_negada',
    pg_temp.sup_state($q$insert into public.purchases(id,company_id,number,supplier_id,supplier_name) values ('b3000000-0000-4000-8000-000000000002','20000000-0000-0000-0000-000000000002','ZZ-SUP-B2','a1000000-0000-4000-8000-000000000001','SUP A1')$q$)='23503', null);
  perform pg_temp.sup_check('b_ve_so_o_proprio_fornecedor',
    (select count(*) from public.suppliers where id='b1000000-0000-4000-8000-000000000001')=1
    and (select count(*) from public.suppliers where id='a1000000-0000-4000-8000-000000000001')=0, null);
end $$;

-- ---------------------------------------------------------------- apagar o fornecedor anula só o vínculo
reset role;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
do $$
begin
  perform pg_temp.sup_check('apagar_fornecedor_A_permitido', pg_temp.sup_state($q$delete from public.suppliers where id='a1000000-0000-4000-8000-000000000001'$q$)='ok', null);
  perform pg_temp.sup_check('apagar_fornecedor_anula_so_o_vinculo',
    (select supplier_id is null and company_id='20000000-0000-0000-0000-000000000001' from public.products where id='a2000000-0000-4000-8000-000000000001')
    and (select supplier_id is null and company_id='20000000-0000-0000-0000-000000000001' from public.purchases where id='a3000000-0000-4000-8000-000000000001'), null);
end $$;

-- ---------------------------------------------------------------- a empresa B não foi tocada
reset role;
do $$
begin
  perform pg_temp.sup_check('registros_de_B_intactos',
    (select supplier_id from public.products where id='b2000000-0000-4000-8000-000000000001')='b1000000-0000-4000-8000-000000000001'
    and (select supplier_id from public.purchases where id='b3000000-0000-4000-8000-000000000001')='b1000000-0000-4000-8000-000000000001'
    and (select count(*) from public.suppliers where id='b1000000-0000-4000-8000-000000000001')=1, null);
end $$;

-- ---------------------------------------------------------------- falha fechada da migration 0108
-- O bloco abaixo é cópia literal do guarda da migration (um teste JS compara os dois textos). Como o ambiente de teste
-- já tem a FK, ela é removida dentro da transação e um vínculo cruzado "de ambiente antigo" é semeado: a migration
-- deve abortar com 23503 e sem corrigir nem apagar nada.
alter table public.products drop constraint products_supplier_company_fk;
set local session_replication_role = replica;
insert into public.products(id,company_id,name,supplier_id) values ('a2000000-0000-4000-8000-0000000000f1','20000000-0000-0000-0000-000000000001','Vínculo cruzado de ambiente antigo','b1000000-0000-4000-8000-000000000001');
set local session_replication_role = origin;
do $$
declare v_state text; v_rows bigint; v_rows_after bigint; v_detail text;
begin
  select count(*) into v_rows from public.products;
  begin
    execute $run$do $g$
declare
  v_products integer;
  v_purchases integer;
begin
  select count(*) into v_products
  from public.products p join public.suppliers s on s.id = p.supplier_id
  where s.company_id <> p.company_id;

  select count(*) into v_purchases
  from public.purchases p join public.suppliers s on s.id = p.supplier_id
  where s.company_id <> p.company_id;

  if v_products + v_purchases > 0 then
    raise exception 'SEC03_CROSS_TENANT_SUPPLIER_REFERENCES products=% purchases=%', v_products, v_purchases
      using errcode = '23503',
            hint = 'Nada foi alterado. Liste os registros com a consulta de somente leitura no cabeçalho da migration 0108, revise com o dono do dado, anule o vínculo inválido manualmente e reaplique.';
  end if;
end $g$;$run$;
    v_state := 'ok';
  exception when others then
    v_state := sqlstate; v_detail := sqlerrm;
  end;
  select count(*) into v_rows_after from public.products;
  perform pg_temp.sup_check('migration_falha_fechada_com_vinculo_cruzado_existente', v_state = '23503' and v_detail like 'SEC03_CROSS_TENANT_SUPPLIER_REFERENCES products=1 purchases=0', v_state || ' / ' || coalesce(v_detail, ''));
  perform pg_temp.sup_check('migration_nao_corrige_nem_apaga_dados_ao_falhar', v_rows = v_rows_after
    and (select supplier_id from public.products where id = 'a2000000-0000-4000-8000-0000000000f1') = 'b1000000-0000-4000-8000-000000000001', v_rows || ' / ' || v_rows_after);
end $$;

do $$
declare v_failures text;
begin
  select string_agg(name||' => '||coalesce(detail,''),' ; ' order by name) into v_failures from zt_sup_results where not ok;
  if v_failures is not null then raise exception 'SUPPLIER_TENANT_FK_FAILED: %', v_failures; end if;
  if (select count(*) from zt_sup_results)<>27 then
    raise exception 'SUPPLIER_TENANT_FK_INCOMPLETE: % checks',(select count(*) from zt_sup_results);
  end if;
end $$;

select 'SUPPLIER_TENANT_FK' as test, count(*) as checks, bool_and(ok) as all_ok from zt_sup_results;

rollback;
