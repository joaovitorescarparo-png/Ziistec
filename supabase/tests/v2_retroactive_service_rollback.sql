-- ZiisTec REGISTRAR SERVIÇO REALIZADO (0117) — OS lançada depois do atendimento.
-- Hoje e passado valem; futuro é recusado; a OS nasce concluída normal, com
-- cliente, responsável, serviços, materiais, estoque, financeiro e garantia
-- coerentes com a data REAL do serviço, enquanto created_at continua sendo a
-- data real do registro. Retry do mesmo pedido não duplica nada.
-- Técnico não registra; proprietário de outra empresa não alcança a empresa A.
-- Nova OS normal e finalização normal seguem intactas.
-- Usa as identidades de ci_local_seed.sql. Destino: SOMENTE CI descartável.
-- Tudo termina em ROLLBACK.

begin;

create temp table zt_retro_results (name text primary key, ok boolean not null, detail text) on commit drop;
grant select, insert, update on zt_retro_results to authenticated, anon;

create function pg_temp.retro_check(p_name text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into zt_retro_results(name,ok,detail) values(p_name,coalesce(p_ok,false),left(p_detail,500));
$$;

create function pg_temp.retro_state(p_sql text)
returns text language plpgsql as $$
begin
  execute p_sql; return 'ok';
exception when others then return sqlstate; end $$;

create function pg_temp.retro_count(p_sql text)
returns bigint language plpgsql as $$
declare n bigint;
begin
  execute 'select count(*) from ('||p_sql||') q' into n; return n;
exception when others then return -1; end $$;

create function pg_temp.retro_as(p_uid uuid)
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claim.sub',p_uid::text,true);
  perform set_config('request.jwt.claims',json_build_object('sub',p_uid,'role','authenticated','aal','aal1')::text,true);
  set local role authenticated;
end $$;

create function pg_temp.retro_anon()
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims','',true);
  set local role anon;
end $$;

grant execute on function pg_temp.retro_check(text,boolean,text), pg_temp.retro_state(text),
  pg_temp.retro_count(text), pg_temp.retro_as(uuid), pg_temp.retro_anon() to authenticated, anon;

-- ---------------------------------------------------------------- fixtures
-- Fixtures como superusuário, mas com identidade do proprietário A nos claims:
-- os guards de assinatura e autoria exigem auth.uid() nas escritas.
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal1"}',true);

insert into public.clients(id,company_id,person_type,name,contact_name,phone)
values
  ('31000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','PF','Cliente Retro A','Ana','11999990001'),
  ('31000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','PF','Cliente Retro B','Bruno','11999990002');

insert into public.services(id,company_id,name,unit,price,cost,active,warranty_days)
values ('32000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',
        'Manutenção preventiva','serviço',200,50,true,90);

-- P1 controla estoque; P2 não controla; P3 controla mas tem saldo curto.
insert into public.products(id,company_id,name,unit,cost,price,active,track_stock,stock_qty,warranty_months)
values
  ('33000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Filtro de ar','un',30,50,true,true,10,6),
  ('33000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','Fita isolante','un',5,9,true,false,0,0),
  ('33000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','Compressor','un',900,1500,true,true,1,12);

-- ======================================================= 1. registro de hoje
select pg_temp.retro_as('10000000-0000-0000-0000-000000000001');

do $$
declare v jsonb; v_wo uuid; v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  v := public.zt_register_completed_work_order(
    '20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-00000000a001',
    jsonb_build_object('client_id','31000000-0000-0000-0000-000000000001',
                       'service_date',v_hoje::text,'request','Troca de filtro'),
    jsonb_build_array(jsonb_build_object('kind','service',
      'service_id','32000000-0000-0000-0000-000000000001','name','Manutenção preventiva',
      'quantity',1,'unit_price',200)),
    '[]'::jsonb, jsonb_build_object('status','pending'));
  v_wo := (v->>'work_order_id')::uuid;
  perform pg_temp.retro_check('hoje_registra', v_wo is not null, v::text);
  perform pg_temp.retro_check('hoje_concluida',
    exists(select 1 from public.work_orders where id=v_wo and status='done'),null);
  perform pg_temp.retro_check('hoje_data_servico',
    exists(select 1 from public.work_orders where id=v_wo and scheduled_date=v_hoje),null);
exception when others then
  perform pg_temp.retro_check('hoje_registra', false, sqlstate||' '||sqlerrm);
end $$;

-- =============================================== 2. registro de 5 dias atrás
do $$
declare v jsonb; v_wo uuid; v_dia date := ((now() at time zone 'America/Sao_Paulo')::date - 5);
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_fin uuid; v_saldo numeric;
begin
  v := public.zt_register_completed_work_order(
    '20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-00000000a002',
    jsonb_build_object('client_id','31000000-0000-0000-0000-000000000001',
                       'service_date',v_dia::text,'service_time','14:30',
                       'assigned_to','10000000-0000-0000-0000-000000000003',
                       'request','Serviço feito há 5 dias','address','Rua Antiga, 100'),
    jsonb_build_array(jsonb_build_object('kind','service',
      'service_id','32000000-0000-0000-0000-000000000001','name','Manutenção preventiva',
      'quantity',1,'unit_price',200)),
    jsonb_build_array(
      jsonb_build_object('product_id','33000000-0000-0000-0000-000000000001','name','Filtro de ar','quantity',3,'unit_cost',30),
      jsonb_build_object('product_id','33000000-0000-0000-0000-000000000002','name','Fita isolante','quantity',2,'unit_cost',5)),
    jsonb_build_object('status','pending','due_days',7));
  v_wo := (v->>'work_order_id')::uuid;
  v_fin := (v->>'billing_entry_id')::uuid;

  perform pg_temp.retro_check('passado_registra', v_wo is not null, v::text);
  -- 4. aparece em Concluídas
  perform pg_temp.retro_check('passado_em_concluidas',
    exists(select 1 from public.work_orders where id=v_wo and status='done'),null);
  -- 16. a data do serviço continua histórica
  perform pg_temp.retro_check('passado_data_servico_historica',
    exists(select 1 from public.work_orders where id=v_wo and scheduled_date=v_dia and scheduled_time='14:30'),null);
  -- conclusão vale no momento histórico real
  perform pg_temp.retro_check('passado_completed_at_historico',
    exists(select 1 from public.work_orders
            where id=v_wo and (completed_at at time zone 'America/Sao_Paulo')::date=v_dia),null);
  -- 15. created_at permanece a data real do registro
  perform pg_temp.retro_check('passado_created_at_real',
    exists(select 1 from public.work_orders
            where id=v_wo and (created_at at time zone 'America/Sao_Paulo')::date=v_hoje),null);
  perform pg_temp.retro_check('passado_created_at_nao_falsificado',
    not exists(select 1 from public.work_orders
                where id=v_wo and (created_at at time zone 'America/Sao_Paulo')::date=v_dia),null);
  -- 5. cliente correto
  perform pg_temp.retro_check('passado_cliente_correto',
    exists(select 1 from public.work_orders
            where id=v_wo and client_id='31000000-0000-0000-0000-000000000001'),null);
  -- 6. responsável correto
  perform pg_temp.retro_check('passado_responsavel_correto',
    exists(select 1 from public.work_orders
            where id=v_wo and assigned_to='10000000-0000-0000-0000-000000000003'),null);
  -- 7. serviços persistem
  perform pg_temp.retro_check('passado_servicos_persistem',
    (select count(*) from public.work_order_items
      where work_order_id=v_wo and service_id='32000000-0000-0000-0000-000000000001')=1,null);
  -- 8. materiais persistem
  perform pg_temp.retro_check('passado_materiais_persistem',
    (select count(*) from public.work_order_materials where work_order_id=v_wo)=2,null);
  -- 9. estoque muda exatamente uma vez, só no produto que controla estoque
  select stock_qty into v_saldo from public.products where id='33000000-0000-0000-0000-000000000001';
  perform pg_temp.retro_check('passado_estoque_baixou', v_saldo=7, 'saldo='||coalesce(v_saldo::text,'null'));
  perform pg_temp.retro_check('passado_estoque_um_movimento',
    (select count(*) from public.inventory_movements
      where product_id='33000000-0000-0000-0000-000000000001'
        and company_id='20000000-0000-0000-0000-000000000001')=1,null);
  perform pg_temp.retro_check('passado_movimento_cita_servico_e_registro',
    exists(select 1 from public.inventory_movements
            where product_id='33000000-0000-0000-0000-000000000001'
              and notes like '%'||to_char(v_dia,'DD/MM/YYYY')||'%'
              and notes like '%registrado em '||to_char(v_hoje,'DD/MM/YYYY')||'%'),null);
  -- produto sem controle de estoque não gera movimento nem passa a controlar
  perform pg_temp.retro_check('sem_controle_nao_movimenta',
    (select count(*) from public.inventory_movements
      where product_id='33000000-0000-0000-0000-000000000002')=0,null);
  perform pg_temp.retro_check('sem_controle_nao_liga_track_stock',
    exists(select 1 from public.products
            where id='33000000-0000-0000-0000-000000000002' and track_stock=false),null);
  -- 10. financeiro pendente, vencendo a partir da data real do serviço
  perform pg_temp.retro_check('passado_financeiro_pendente',
    exists(select 1 from public.financial_entries
            where id=v_fin and paid=false and due_date=v_dia+7 and work_order_id=v_wo),null);
  perform pg_temp.retro_check('passado_financeiro_um_lancamento',
    (select count(*) from public.financial_entries where work_order_id=v_wo)=1,null);
  -- 3 (garantia). começa na data real do serviço, preservando a duração
  perform pg_temp.retro_check('passado_garantia_na_data_do_servico',
    not exists(select 1 from public.warranties where work_order_id=v_wo and starts_on<>v_dia)
    and exists(select 1 from public.warranties where work_order_id=v_wo),
    (select string_agg(starts_on::text||'->'||ends_on::text,', ') from public.warranties where work_order_id=v_wo));
  perform pg_temp.retro_check('passado_garantia_duracao_preservada',
    not exists(select 1 from public.warranties where work_order_id=v_wo and ends_on<=starts_on),null);
  -- histórico distingue quando aconteceu de quando foi lançado
  perform pg_temp.retro_check('passado_historico_distingue_datas',
    exists(select 1 from public.work_order_reports
            where work_order_id=v_wo
              and body like '%'||to_char(v_dia,'DD/MM/YYYY')||'%'
              and body like '%registrado no sistema em '||to_char(v_hoje,'DD/MM/YYYY')||'%'),null);
exception when others then
  perform pg_temp.retro_check('passado_registra', false, sqlstate||' '||sqlerrm);
end $$;

-- ================================= 12/13/14. retry do mesmo pedido não duplica
do $$
declare v jsonb; v_dia date := ((now() at time zone 'America/Sao_Paulo')::date - 5);
begin
  v := public.zt_register_completed_work_order(
    '20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-00000000a002',
    jsonb_build_object('client_id','31000000-0000-0000-0000-000000000001',
                       'service_date',v_dia::text,'service_time','14:30',
                       'assigned_to','10000000-0000-0000-0000-000000000003'),
    jsonb_build_array(jsonb_build_object('kind','service',
      'service_id','32000000-0000-0000-0000-000000000001','name','Manutenção preventiva',
      'quantity',1,'unit_price',200)),
    jsonb_build_array(
      jsonb_build_object('product_id','33000000-0000-0000-0000-000000000001','name','Filtro de ar','quantity',3,'unit_cost',30)),
    jsonb_build_object('status','pending','due_days',7));
  perform pg_temp.retro_check('retry_reaproveita_registro', (v->>'replayed')::boolean is true, v::text);
  perform pg_temp.retro_check('retry_nao_duplica_os',
    (select count(*) from public.work_orders
      where company_id='20000000-0000-0000-0000-000000000001'
        and client_request_id='40000000-0000-0000-0000-00000000a002')=1,null);
  perform pg_temp.retro_check('retry_nao_duplica_estoque',
    (select stock_qty from public.products where id='33000000-0000-0000-0000-000000000001')=7
    and (select count(*) from public.inventory_movements
          where product_id='33000000-0000-0000-0000-000000000001')=1,null);
  perform pg_temp.retro_check('retry_nao_duplica_financeiro',
    (select count(*) from public.financial_entries
      where work_order_id=(select id from public.work_orders
                            where client_request_id='40000000-0000-0000-0000-00000000a002'))=1,null);
  perform pg_temp.retro_check('retry_nao_duplica_materiais',
    (select count(*) from public.work_order_materials
      where work_order_id=(select id from public.work_orders
                            where client_request_id='40000000-0000-0000-0000-00000000a002'))=2,null);
exception when others then
  perform pg_temp.retro_check('retry_reaproveita_registro', false, sqlstate||' '||sqlerrm);
end $$;

-- ================================================== 11. financeiro já pago
do $$
declare v jsonb; v_fin uuid; v_dia date := ((now() at time zone 'America/Sao_Paulo')::date - 2);
begin
  v := public.zt_register_completed_work_order(
    '20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-00000000a003',
    jsonb_build_object('client_id','31000000-0000-0000-0000-000000000001','service_date',v_dia::text),
    jsonb_build_array(jsonb_build_object('kind','service',
      'service_id','32000000-0000-0000-0000-000000000001','name','Manutenção preventiva',
      'quantity',1,'unit_price',200)),
    '[]'::jsonb,
    jsonb_build_object('status','paid','method','pix'));
  v_fin := (v->>'billing_entry_id')::uuid;
  perform pg_temp.retro_check('pago_marca_lancamento',
    exists(select 1 from public.financial_entries
            where id=v_fin and paid=true and paid_at=v_dia and payment_method='pix'),null);
  perform pg_temp.retro_check('pago_sem_cobranca_duplicada',
    (select count(*) from public.financial_entries
      where work_order_id=(v->>'work_order_id')::uuid)=1,null);
  perform pg_temp.retro_check('pago_sem_pendente_residual',
    not exists(select 1 from public.financial_entries
                where work_order_id=(v->>'work_order_id')::uuid and paid=false),null);
exception when others then
  perform pg_temp.retro_check('pago_marca_lancamento', false, sqlstate||' '||sqlerrm);
end $$;

-- =================================================== 3. data futura recusada
do $$
declare v_amanha date := ((now() at time zone 'America/Sao_Paulo')::date + 1);
begin
  perform pg_temp.retro_check('futuro_recusado',
    pg_temp.retro_state(format($q$select public.zt_register_completed_work_order(
      '20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-00000000a004',
      '{"client_id":"31000000-0000-0000-0000-000000000001","service_date":"%s"}'::jsonb)$q$, v_amanha))='22023',
    pg_temp.retro_state(format($q$select public.zt_register_completed_work_order(
      '20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-00000000a005',
      '{"client_id":"31000000-0000-0000-0000-000000000001","service_date":"%s"}'::jsonb)$q$, v_amanha)));
  perform pg_temp.retro_check('futuro_nao_cria_os',
    (select count(*) from public.work_orders
      where client_request_id in ('40000000-0000-0000-0000-00000000a004',
                                  '40000000-0000-0000-0000-00000000a005'))=0,null);
  perform pg_temp.retro_check('data_obrigatoria',
    pg_temp.retro_state($q$select public.zt_register_completed_work_order(
      '20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-00000000a006',
      '{"client_id":"31000000-0000-0000-0000-000000000001"}'::jsonb)$q$)='22023',null);
  perform pg_temp.retro_check('pedido_obrigatorio',
    pg_temp.retro_state($q$select public.zt_register_completed_work_order(
      '20000000-0000-0000-0000-000000000001',null,
      '{"client_id":"31000000-0000-0000-0000-000000000001","service_date":"2026-01-10"}'::jsonb)$q$)='22023',null);
end $$;

-- ============================ responsável e cliente precisam ser da empresa
do $$
begin
  perform pg_temp.retro_check('responsavel_externo_recusado',
    pg_temp.retro_state($q$select public.zt_register_completed_work_order(
      '20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-00000000a007',
      '{"client_id":"31000000-0000-0000-0000-000000000001","service_date":"2026-01-10",
        "assigned_to":"10000000-0000-0000-0000-000000000004"}'::jsonb)$q$)='23503',null);
  perform pg_temp.retro_check('cliente_de_outra_empresa_recusado',
    pg_temp.retro_state($q$select public.zt_register_completed_work_order(
      '20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-00000000a008',
      '{"client_id":"31000000-0000-0000-0000-000000000002","service_date":"2026-01-10"}'::jsonb)$q$)='23503',null);
  perform pg_temp.retro_check('cliente_obrigatorio',
    pg_temp.retro_state($q$select public.zt_register_completed_work_order(
      '20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-00000000a009',
      '{"service_date":"2026-01-10"}'::jsonb)$q$)='22023',null);
end $$;

-- ============================ estoque insuficiente aborta o registro inteiro
do $$
declare v_dia date := ((now() at time zone 'America/Sao_Paulo')::date - 1);
begin
  perform pg_temp.retro_check('estoque_insuficiente_recusa',
    pg_temp.retro_state(format($q$select public.zt_register_completed_work_order(
      '20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-00000000a010',
      '{"client_id":"31000000-0000-0000-0000-000000000001","service_date":"%s"}'::jsonb,
      '[]'::jsonb,
      '[{"product_id":"33000000-0000-0000-0000-000000000003","name":"Compressor","quantity":5}]'::jsonb)$q$,
      v_dia))='23514', null);
  -- nada pela metade: sem OS, sem movimento, sem saldo alterado
  perform pg_temp.retro_check('estoque_insuficiente_nao_deixa_os',
    (select count(*) from public.work_orders
      where client_request_id='40000000-0000-0000-0000-00000000a010')=0,null);
  perform pg_temp.retro_check('estoque_insuficiente_nao_move_saldo',
    (select stock_qty from public.products where id='33000000-0000-0000-0000-000000000003')=1,null);
end $$;

-- ========================================= 17/18. quem não pode, não registra
select pg_temp.retro_as('10000000-0000-0000-0000-000000000003');
do $$
begin
  perform pg_temp.retro_check('tecnico_nao_registra',
    pg_temp.retro_state($q$select public.zt_register_completed_work_order(
      '20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-00000000b001',
      '{"client_id":"31000000-0000-0000-0000-000000000001","service_date":"2026-01-10"}'::jsonb)$q$)='42501',null);
  perform pg_temp.retro_check('tecnico_nao_cria_os_pela_porta_lateral',
    (select count(*) from public.work_orders
      where client_request_id='40000000-0000-0000-0000-00000000b001')=0,null);
end $$;

select pg_temp.retro_as('10000000-0000-0000-0000-000000000002');
do $$
begin
  perform pg_temp.retro_check('owner_b_nao_alcanca_empresa_a',
    pg_temp.retro_state($q$select public.zt_register_completed_work_order(
      '20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-00000000b002',
      '{"client_id":"31000000-0000-0000-0000-000000000001","service_date":"2026-01-10"}'::jsonb)$q$)='42501',null);
  perform pg_temp.retro_check('owner_b_nao_cria_na_empresa_a',
    (select count(*) from public.work_orders
      where client_request_id='40000000-0000-0000-0000-00000000b002')=0,null);
  -- a empresa de destino nunca vem do corpo enviado pelo navegador
  perform pg_temp.retro_check('company_id_do_corpo_ignorado',
    pg_temp.retro_state($q$select public.zt_register_completed_work_order(
      '20000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-00000000b003',
      '{"company_id":"20000000-0000-0000-0000-000000000001",
        "client_id":"31000000-0000-0000-0000-000000000001","service_date":"2026-01-10"}'::jsonb)$q$)='23503',null);
end $$;

select pg_temp.retro_anon();
do $$
begin
  perform pg_temp.retro_check('anon_nao_registra',
    pg_temp.retro_state($q$select public.zt_register_completed_work_order(
      '20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-00000000b004',
      '{"client_id":"31000000-0000-0000-0000-000000000001","service_date":"2026-01-10"}'::jsonb)$q$)
      in ('28000','42501'),null);
end $$;

-- ============================ 19/20. Nova OS e finalização normais intactas
select pg_temp.retro_as('10000000-0000-0000-0000-000000000001');
do $$
declare v_wo uuid; v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  v_wo := public.zt_save_work_order_idempotent(
    '20000000-0000-0000-0000-000000000001', null, '40000000-0000-0000-0000-00000000c001',
    jsonb_build_object('client_id','31000000-0000-0000-0000-000000000001',
                       'status','scheduled','scheduled_date',v_hoje::text),
    jsonb_build_array(jsonb_build_object('kind','service',
      'service_id','32000000-0000-0000-0000-000000000001','name','Manutenção preventiva',
      'quantity',1,'unit_price',200)));
  perform pg_temp.retro_check('nova_os_normal_funciona',
    exists(select 1 from public.work_orders where id=v_wo and status='scheduled'),null);

  perform public.zt_finalize_work_order_with_warranty_overrides(v_wo,'Relato normal',null,0,7);
  perform pg_temp.retro_check('finalizacao_normal_funciona',
    exists(select 1 from public.work_orders where id=v_wo and status='done'
            and billing_entry_id is not null),null);
  -- a conclusão normal continua valendo agora, não no passado
  perform pg_temp.retro_check('finalizacao_normal_completed_at_agora',
    exists(select 1 from public.work_orders where id=v_wo
            and (completed_at at time zone 'America/Sao_Paulo')::date=v_hoje),null);
  -- e a garantia normal continua começando hoje
  perform pg_temp.retro_check('finalizacao_normal_garantia_hoje',
    not exists(select 1 from public.warranties where work_order_id=v_wo and starts_on<>current_date),null);
  perform pg_temp.retro_check('finalizacao_normal_vencimento_de_hoje',
    exists(select 1 from public.financial_entries
            where work_order_id=v_wo and due_date=current_date+7),null);
exception when others then
  perform pg_temp.retro_check('nova_os_normal_funciona', false, sqlstate||' '||sqlerrm);
end $$;

-- ====================================================== forma e superfície
do $$
begin
  perform pg_temp.retro_check('pagamento_pago_exige_forma',
    pg_temp.retro_state($q$select public.zt_register_completed_work_order(
      '20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-00000000c002',
      '{"client_id":"31000000-0000-0000-0000-000000000001","service_date":"2026-01-10"}'::jsonb,
      '[{"kind":"service","name":"X","quantity":1,"unit_price":100}]'::jsonb,
      '[]'::jsonb,'{"status":"paid"}'::jsonb)$q$)='22023',null);
  perform pg_temp.retro_check('situacao_pagamento_invalida_recusada',
    pg_temp.retro_state($q$select public.zt_register_completed_work_order(
      '20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-00000000c003',
      '{"client_id":"31000000-0000-0000-0000-000000000001","service_date":"2026-01-10"}'::jsonb,
      '[]'::jsonb,'[]'::jsonb,'{"status":"faturado"}'::jsonb)$q$)='22023',null);
  -- não nasceu tabela paralela de serviços realizados
  perform pg_temp.retro_check('sem_tabela_paralela',
    not exists(select 1 from information_schema.tables
                where table_schema='public'
                  and table_name in ('completed_services','retroactive_work_orders',
                                     'past_services','service_records')),null);
  -- nem coluna só para marcar "registrado posteriormente"
  perform pg_temp.retro_check('sem_coluna_de_marcacao',
    not exists(select 1 from information_schema.columns
                where table_schema='public' and table_name='work_orders'
                  and column_name in ('registered_later','is_retroactive','retroactive')),null);
  perform pg_temp.retro_check('rpc_e_definer_owner_only',
    exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
            where n.nspname='public' and p.proname='zt_register_completed_work_order'
              and p.prosecdef),null);
  perform pg_temp.retro_check('rpc_nao_exposta_a_anon',
    not has_function_privilege('anon',
      'public.zt_register_completed_work_order(uuid,uuid,jsonb,jsonb,jsonb,jsonb)','execute'),null);
end $$;

do $$
declare v_failures text;
begin
  select string_agg(name||' => '||coalesce(detail,''),' ; ' order by name) into v_failures
    from zt_retro_results where not ok;
  if v_failures is not null then raise exception 'RETROACTIVE_SERVICE_FAILED: %', v_failures; end if;
  if (select count(*) from zt_retro_results) < 45 then
    raise exception 'RETROACTIVE_SERVICE_INCOMPLETE: % checks',(select count(*) from zt_retro_results);
  end if;
end $$;

select 'RETROACTIVE_SERVICE' as test, count(*) as checks, bool_and(ok) as all_ok from zt_retro_results;

rollback;
