-- ZiisTec Segurança V1.1 (SEC-04, 0109) — ajuste manual de estoque idempotente.
-- O mesmo pedido lógico (p_request) altera o estoque UMA vez: retry, duplo clique e reenvio após timeout devolvem o
-- saldo do primeiro ajuste. O mesmo pedido com outro produto ou outro delta é recusado. Entrada (+10), saída (-3),
-- saldo insuficiente e isolamento entre empresas. O overload antigo (sem pedido) não é mais chamável pelo navegador.
-- Usa as identidades sintéticas de ci_local_seed.sql. Destino: SOMENTE CI descartável ou homologação.
-- Duas conexões simultâneas reais são cobertas por scripts/test-stock-adjustment-concurrency.sh.
-- Tudo termina em ROLLBACK.

begin;

create temp table zt_stk_results (name text primary key, ok boolean not null, detail text) on commit drop;
grant select, insert, update on zt_stk_results to authenticated, anon;

create function pg_temp.stk_check(p_name text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into zt_stk_results(name,ok,detail) values(p_name,coalesce(p_ok,false),left(p_detail,500));
$$;

create function pg_temp.stk_state(p_sql text)
returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate;
end $$;

-- Saldo devolvido por um ajuste (ou o SQLSTATE do erro, em texto).
create function pg_temp.stk_adjust(p_company uuid, p_product uuid, p_delta numeric, p_request uuid, p_notes text default null)
returns text language plpgsql as $$
begin
  return public.zt_adjust_product_stock(p_company, p_product, p_delta, p_notes, p_request)::text;
exception when others then
  return 'E' || sqlstate;
end $$;

do $$
begin
  if (select count(*) from public.company_members where role='owner' and status='active'
        and (company_id,user_id) in (('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001'),
                                     ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002')))<>2 then
    raise exception 'STOCK_IDEMPOTENCY_FIXTURE_MISSING';
  end if;
end $$;

-- ---------------------------------------------------------------- catálogo e ACL
do $$
declare v_new oid := to_regprocedure('public.zt_adjust_product_stock(uuid,uuid,numeric,text,uuid)');
        v_old oid := to_regprocedure('public.zt_adjust_product_stock(uuid,uuid,numeric,text)');
begin
  perform pg_temp.stk_check('overload_com_pedido_existe_definer_search_path_vazio',
    v_new is not null and (select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid=v_new), null);
  perform pg_temp.stk_check('overload_com_pedido_somente_authenticated',
    has_function_privilege('authenticated',v_new,'EXECUTE') and not has_function_privilege('anon',v_new,'EXECUTE')
    and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f',p.proowner))) a where p.oid=v_new and a.grantee=0), 'sem EXECUTE para PUBLIC');
  perform pg_temp.stk_check('overload_antigo_nao_chamavel_pelo_navegador',
    v_old is not null and not has_function_privilege('authenticated',v_old,'EXECUTE') and not has_function_privilege('anon',v_old,'EXECUTE')
    and not has_function_privilege('service_role',v_old,'EXECUTE'), 'o Assistente o chama por dentro, como definer');
  perform pg_temp.stk_check('pedido_unico_por_empresa', exists (
    select 1 from pg_indexes where schemaname='public' and tablename='inventory_movements' and indexname='uq_inventory_movements_client_request'
      and indexdef ~ 'UNIQUE INDEX.*\(company_id, client_request_id\) WHERE \(client_request_id IS NOT NULL\)'), null);
  perform pg_temp.stk_check('colunas_novas_existem', (select count(*) from information_schema.columns where table_schema='public'
    and table_name='inventory_movements' and column_name in ('client_request_id','balance_after'))=2, null);
  perform pg_temp.stk_check('movimentos_continuam_sem_escrita_direta',
    not has_table_privilege('authenticated','public.inventory_movements','INSERT')
    and not has_table_privilege('authenticated','public.inventory_movements','UPDATE')
    and not has_table_privilege('authenticated','public.inventory_movements','DELETE')
    and not has_table_privilege('anon','public.inventory_movements','SELECT'), null);
end $$;

-- ---------------------------------------------------------------- fixtures
set local session_replication_role = replica;
insert into public.products(id,company_id,name,stock_qty,track_stock) values
  ('a2000000-0000-4000-8000-0000000000a1','20000000-0000-0000-0000-000000000001','Produto A1',0,true),
  ('a2000000-0000-4000-8000-0000000000a2','20000000-0000-0000-0000-000000000001','Produto A2',4,true),
  ('b2000000-0000-4000-8000-0000000000b1','20000000-0000-0000-0000-000000000002','Produto B1',7,true);
set local session_replication_role = origin;

-- ---------------------------------------------------------------- dono da empresa A
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;

do $$
declare
  c_a constant uuid := '20000000-0000-0000-0000-000000000001';
  c_p1 constant uuid := 'a2000000-0000-4000-8000-0000000000a1';
  c_p2 constant uuid := 'a2000000-0000-4000-8000-0000000000a2';
  r1 constant uuid := 'c0000000-0000-4000-8000-000000000001';
  r2 constant uuid := 'c0000000-0000-4000-8000-000000000002';
  r3 constant uuid := 'c0000000-0000-4000-8000-000000000003';
  r4 constant uuid := 'c0000000-0000-4000-8000-000000000004';
  r5 constant uuid := 'c0000000-0000-4000-8000-000000000005';
  v1 text; v2 text; v3 text; v4 text;
begin
  -- +10: primeira chamada aplica, repetição devolve o mesmo saldo e não reaplica.
  v1 := pg_temp.stk_adjust(c_a, c_p1, 10, r1, 'Entrada manual');
  v2 := pg_temp.stk_adjust(c_a, c_p1, 10, r1, 'Entrada manual');
  perform pg_temp.stk_check('entrada_mais_10_aplica_uma_vez', v1='10.000' and v2='10.000'
    and (select stock_qty from public.products where id=c_p1)=10
    and (select count(*) from public.inventory_movements where company_id=c_a and client_request_id=r1)=1, v1||' / '||v2);

  -- -3: saída aplica; retry, duplo clique e reenvio após timeout (4 repetições) não mudam nada.
  v1 := pg_temp.stk_adjust(c_a, c_p1, -3, r2, 'Saída manual');
  v2 := pg_temp.stk_adjust(c_a, c_p1, -3, r2, 'Saída manual');
  v3 := pg_temp.stk_adjust(c_a, c_p1, -3, r2, 'Saída manual');
  v4 := pg_temp.stk_adjust(c_a, c_p1, -3, r2, 'Saída manual');
  perform pg_temp.stk_check('saida_menos_3_aplica_uma_vez_em_retry_duplo_clique_e_timeout',
    v1='7.000' and v2='7.000' and v3='7.000' and v4='7.000'
    and (select stock_qty from public.products where id=c_p1)=7
    and (select count(*) from public.inventory_movements where company_id=c_a and client_request_id=r2)=1, v1||'/'||v2||'/'||v3||'/'||v4);

  -- A repetição devolve o saldo do primeiro ajuste mesmo depois de outro ajuste (resultado estável).
  v1 := pg_temp.stk_adjust(c_a, c_p1, 5, r3, null);
  v2 := pg_temp.stk_adjust(c_a, c_p1, 2, r4, null);
  v3 := pg_temp.stk_adjust(c_a, c_p1, 5, r3, null);
  perform pg_temp.stk_check('repeticao_devolve_o_saldo_do_primeiro_ajuste',
    v1='12.000' and v2='14.000' and v3='12.000' and (select stock_qty from public.products where id=c_p1)=14, v1||'/'||v2||'/'||v3);

  -- Pedido reutilizado de forma incompatível: outro delta, outro produto, inclusive o sinal oposto.
  perform pg_temp.stk_check('pedido_reutilizado_com_outro_delta_e_recusado',
    pg_temp.stk_adjust(c_a, c_p1, 11, r1)='E23505' and pg_temp.stk_adjust(c_a, c_p1, -10, r1)='E23505'
    and (select stock_qty from public.products where id=c_p1)=14, null);
  perform pg_temp.stk_check('pedido_reutilizado_com_outro_produto_e_recusado',
    pg_temp.stk_adjust(c_a, c_p2, 10, r1)='E23505' and (select stock_qty from public.products where id=c_p2)=4, null);

  -- Entradas inválidas.
  perform pg_temp.stk_check('pedido_nulo_recusado', pg_temp.stk_adjust(c_a, c_p1, 1, null)='E22023', null);
  perform pg_temp.stk_check('delta_zero_recusado', pg_temp.stk_adjust(c_a, c_p1, 0, r5)='E22023', null);

  -- Saldo insuficiente não consome o pedido: o mesmo pedido pode ser reenviado com um valor válido.
  perform pg_temp.stk_check('saldo_insuficiente_recusado_sem_alterar',
    pg_temp.stk_adjust(c_a, c_p1, -100, r5)='E23514' and (select stock_qty from public.products where id=c_p1)=14
    and (select count(*) from public.inventory_movements where client_request_id=r5)=0, null);
  v1 := pg_temp.stk_adjust(c_a, c_p1, -4, r5);
  perform pg_temp.stk_check('pedido_recusado_por_saldo_pode_ser_reenviado_com_valor_valido',
    v1='10.000' and (select stock_qty from public.products where id=c_p1)=10, v1||' / '||(select stock_qty::text from public.products where id=c_p1));

  -- Produto inexistente (ou de outra empresa) não grava nada.
  perform pg_temp.stk_check('produto_de_outra_empresa_nao_existe_para_A',
    pg_temp.stk_adjust(c_a, 'b2000000-0000-4000-8000-0000000000b1', 1, 'c0000000-0000-4000-8000-0000000000f1')='EP0002', null);

  -- Overload antigo: negado ao navegador.
  perform pg_temp.stk_check('overload_antigo_negado_ao_dono',
    pg_temp.stk_state($q$select public.zt_adjust_product_stock('20000000-0000-0000-0000-000000000001','a2000000-0000-4000-8000-0000000000a1',5,'x')$q$)='42501'
    and (select stock_qty from public.products where id=c_p1)=10, null);

  -- Cada ajuste gravou o saldo e as notas; as linhas antigas (sem pedido) continuam possíveis.
  perform pg_temp.stk_check('movimento_guarda_saldo_e_nota',
    (select balance_after=7 and notes='Saída manual' and quantity_delta=-3 and kind='adjustment' and created_by='10000000-0000-0000-0000-000000000001'
       from public.inventory_movements where company_id=c_a and client_request_id=r2), null);
end $$;

-- ---------------------------------------------------------------- isolamento: dono da empresa B
reset role;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
do $$
declare v1 text;
begin
  -- O mesmo UUID de pedido é livre em outra empresa e o resultado de A nunca é devolvido a B.
  -- (O saldo é lido em outro comando: uma subconsulta no mesmo comando enxergaria o estado anterior à chamada.)
  v1 := pg_temp.stk_adjust('20000000-0000-0000-0000-000000000002','b2000000-0000-4000-8000-0000000000b1',3,'c0000000-0000-4000-8000-000000000001');
  perform pg_temp.stk_check('mesmo_uuid_em_outra_empresa_e_independente', v1='10.000'
    and (select stock_qty from public.products where id='b2000000-0000-4000-8000-0000000000b1')=10, v1);
  perform pg_temp.stk_check('b_nao_ajusta_empresa_A',
    pg_temp.stk_adjust('20000000-0000-0000-0000-000000000001','a2000000-0000-4000-8000-0000000000a1',9,'c0000000-0000-4000-8000-000000000001')='E42501'
    and pg_temp.stk_adjust('20000000-0000-0000-0000-000000000001','a2000000-0000-4000-8000-0000000000a1',9,'c0000000-0000-4000-8000-0000000000e1')='E42501', null);
end $$;

-- ---------------------------------------------------------------- técnico, usuário sem empresa e anon
reset role;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
do $$
begin
  perform pg_temp.stk_check('tecnico_nao_ajusta_estoque',
    pg_temp.stk_adjust('20000000-0000-0000-0000-000000000001','a2000000-0000-4000-8000-0000000000a1',1,'c0000000-0000-4000-8000-0000000000a1')='E42501', null);
end $$;
reset role;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000004',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
do $$
begin
  perform pg_temp.stk_check('usuario_sem_empresa_nao_ajusta_estoque',
    pg_temp.stk_adjust('20000000-0000-0000-0000-000000000001','a2000000-0000-4000-8000-0000000000a1',1,'c0000000-0000-4000-8000-0000000000a2')='E42501', null);
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','',true);
set local role anon;
do $$
begin
  perform pg_temp.stk_check('anon_nao_chama_a_funcao',
    pg_temp.stk_state($q$select public.zt_adjust_product_stock('20000000-0000-0000-0000-000000000001','a2000000-0000-4000-8000-0000000000a1',1,null,'c0000000-0000-4000-8000-0000000000a3')$q$)='42501', null);
end $$;
reset role;

-- ---------------------------------------------------------------- estoque final conferido por quem tem acesso
do $$
begin
  perform pg_temp.stk_check('estoque_final_consistente_com_os_movimentos',
    (select stock_qty from public.products where id='a2000000-0000-4000-8000-0000000000a1')=10
    and (select coalesce(sum(quantity_delta),0) from public.inventory_movements where product_id='a2000000-0000-4000-8000-0000000000a1')=10
    and (select stock_qty from public.products where id='a2000000-0000-4000-8000-0000000000a2')=4
    and (select stock_qty from public.products where id='b2000000-0000-4000-8000-0000000000b1')=10, null);
end $$;

do $$
declare v_failures text;
begin
  select string_agg(name||' => '||coalesce(detail,''),' ; ' order by name) into v_failures from zt_stk_results where not ok;
  if v_failures is not null then raise exception 'STOCK_IDEMPOTENCY_FAILED: %', v_failures; end if;
  if (select count(*) from zt_stk_results)<>24 then
    raise exception 'STOCK_IDEMPOTENCY_INCOMPLETE: % checks',(select count(*) from zt_stk_results);
  end if;
end $$;

select 'STOCK_IDEMPOTENCY' as test, count(*) as checks, bool_and(ok) as all_ok from zt_stk_results;

rollback;
