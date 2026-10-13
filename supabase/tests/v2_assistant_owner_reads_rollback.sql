-- ZiisTec Assistant Universal Owner V1 (0096) — consultas do proprietário por zt_assistant_read:
-- histórico do cliente, detalhe da OS, equipamentos, garantias, agenda, estoque, compras, contratos,
-- pós-venda, financeiro e relatório. Papéis, membership, tenant, assinatura, anon, auditoria e
-- ausência de escrita/custo. Destino: SOMENTE CI descartável ou staging/homologação. Tudo termina em ROLLBACK.

begin;

create temp table zt_w3 (
  owner_a uuid, tech_a uuid, owner_b uuid, company_a uuid, company_b uuid,
  carmelo uuid, carmelo2 uuid, mauro uuid, quiet uuid, carmelo_b uuid, loc uuid,
  cam uuid, dome uuid, intf uuid, svc_portao uuid, svc_intf uuid, purchase uuid,
  wo1 uuid, wo2 uuid, wo3 uuid, wo4 uuid, wo_open uuid, wo_unsched uuid, wo_quiet uuid, wo_b uuid,
  wo4_number text, wo1_number text, past_month text, counts jsonb
) on commit drop;
create temp table zt_w3_results (name text primary key, ok boolean not null, detail text) on commit drop;
grant select, insert, update on zt_w3, zt_w3_results to authenticated, anon;

create function pg_temp.record_result(p_name text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into zt_w3_results(name,ok,detail) values(p_name,coalesce(p_ok,false),left(p_detail,600));
$$;
create function pg_temp.r(p_company uuid, p_action text, p_input jsonb)
returns jsonb language sql as $$ select public.zt_assistant_read(p_company,p_action,p_input,gen_random_uuid()); $$;
create function pg_temp.counts(p_company uuid) returns jsonb language sql as $$
  select jsonb_build_object('wo',(select count(*) from public.work_orders where company_id=p_company),
    'quotes',(select count(*) from public.quotes where company_id=p_company),
    'entries',(select count(*) from public.financial_entries where company_id=p_company),
    'products',(select sum(stock_qty) from public.products where company_id=p_company),
    'followups',(select count(*) from public.post_sale_followups where company_id=p_company),
    'warranties',(select count(*) from public.warranties where company_id=p_company));
$$;

with candidates as (
  select u.id, row_number() over (order by u.id) as rn
  from auth.users u left join public.profiles p on p.id=u.id
  where not coalesce(p.is_platform_admin,false)
)
insert into zt_w3(owner_a,tech_a,owner_b,company_a,company_b,carmelo,carmelo2,mauro,quiet,carmelo_b,loc,cam,dome,intf,svc_portao,svc_intf,purchase,past_month)
select (select id from candidates where rn=1),(select id from candidates where rn=2),(select id from candidates where rn=3),
       gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),
       gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),
       to_char(((now() at time zone 'America/Sao_Paulo')::date - interval '2 months'),'YYYY-MM');

do $$
begin
  if exists(select 1 from zt_w3 where owner_a is null or tech_a is null or owner_b is null) then
    raise exception 'OWNER_V1_NEEDS_THREE_AUTH_USERS';
  end if;
end $$;

select set_config('request.jwt.claim.sub',(select owner_a::text from zt_w3),true);
insert into public.companies(id,name,has_team)
select company_a,'__W3_A__',true from zt_w3 union all select company_b,'__W3_B__',true from zt_w3;
insert into public.subscriptions(company_id,status,current_period_start,current_period_end)
select company_a,'trial'::public.zt_sub_status,current_date,current_date+14 from zt_w3
union all select company_b,'trial'::public.zt_sub_status,current_date,current_date+14 from zt_w3
on conflict (company_id) do update set status=excluded.status,
  current_period_start=excluded.current_period_start,current_period_end=excluded.current_period_end;
insert into public.company_members(company_id,user_id,role,status)
select company_a,owner_a,'owner'::public.zt_role,'active'::public.zt_member_status from zt_w3
union all select company_a,tech_a,'technician'::public.zt_role,'active'::public.zt_member_status from zt_w3
union all select company_b,owner_b,'owner'::public.zt_role,'active'::public.zt_member_status from zt_w3
union all select company_a,owner_b,'owner'::public.zt_role,'disabled'::public.zt_member_status from zt_w3;
insert into public.profiles(id,full_name,email) select tech_a,'Técnico W3','w3-tech@example.invalid' from zt_w3
on conflict (id) do update set full_name=excluded.full_name;
insert into public.clients(id,company_id,name,phone,address)
select carmelo,company_a,'Residencial Carmelo','1130000101','Rua do Carmelo, 1' from zt_w3
union all select carmelo2,company_a,'Residencial Carmelo II','1130000102','Rua do Carmelo, 2' from zt_w3
union all select mauro,company_a,'Mauro Silva','1130000103','Rua A, 3' from zt_w3
union all select quiet,company_a,'Cliente Antigo','1130000104','Rua A, 4' from zt_w3
union all select carmelo_b,company_b,'Residencial Carmelo','1130000105','Rua B, 5' from zt_w3;
insert into public.client_locations(id,company_id,client_id,name,location_key,address)
select loc,company_a,carmelo,'Portaria','portaria','Rua do Carmelo, 1' from zt_w3;
insert into public.products(id,company_id,name,brand,model,unit,cost,price,active,track_stock,stock_qty,low_stock_threshold)
select cam,company_a,'Câmera Wi-Fi Intelbras','Intelbras','IM5','unidade',120,250,true,true,2,5 from zt_w3
union all select dome,company_a,'Câmera Dome Hikvision','Hikvision','DS2','unidade',140,300,true,true,10,3 from zt_w3
union all select intf,company_a,'Interfone TDMI','HDL','TDMI','unidade',70,150,true,false,0,null from zt_w3;
insert into public.services(id,company_id,name,unit,price,cost,active)
select svc_portao,company_a,'Manutenção do portão','serviço',200,60,true from zt_w3
union all select svc_intf,company_a,'Troca de interfone','serviço',180,50,true from zt_w3;

-- OS pelo caminho canônico; datas e conclusão ajustadas depois (fixture fora do comportamento testado).
set local role authenticated;
do $$
declare t zt_w3%rowtype;
begin
  select * into t from zt_w3;
  update zt_w3 set
    wo1=public.zt_save_work_order_idempotent(t.company_a,null,gen_random_uuid(),jsonb_build_object('client_id',t.carmelo,'request','Instalação de fechadura','assigned_to',t.tech_a,'status','unscheduled'),'[]'),
    wo2=public.zt_save_work_order_idempotent(t.company_a,null,gen_random_uuid(),jsonb_build_object('client_id',t.carmelo,'request','Troca de interfone','assigned_to',t.tech_a,'status','unscheduled'),'[]'),
    wo3=public.zt_save_work_order_idempotent(t.company_a,null,gen_random_uuid(),jsonb_build_object('client_id',t.carmelo,'request','Manutenção do portão','assigned_to',t.tech_a,'status','unscheduled'),'[]'),
    wo4=public.zt_save_work_order_idempotent(t.company_a,null,gen_random_uuid(),jsonb_build_object('client_id',t.carmelo,'request','Manutenção do portão da garagem','assigned_to',t.tech_a,'status','unscheduled'),'[]'),
    wo_open=public.zt_save_work_order_idempotent(t.company_a,null,gen_random_uuid(),jsonb_build_object('client_id',t.carmelo,'request','Revisão anual','assigned_to',t.tech_a,'status','unscheduled'),'[]'),
    wo_unsched=public.zt_save_work_order_idempotent(t.company_a,null,gen_random_uuid(),jsonb_build_object('client_id',t.mauro,'request','Orçar cerca elétrica','status','unscheduled'),'[]'),
    wo_quiet=public.zt_save_work_order_idempotent(t.company_a,null,gen_random_uuid(),jsonb_build_object('client_id',t.quiet,'request','Visita antiga','status','unscheduled'),'[]');
end $$;
reset role;
select set_config('request.jwt.claim.sub',(select owner_b::text from zt_w3),true);
set local role authenticated;
update zt_w3 set wo_b=public.zt_save_work_order_idempotent(company_b,null,gen_random_uuid(),jsonb_build_object('client_id',carmelo_b,'request','Serviço na outra empresa','status','unscheduled'),'[]');
reset role;
select set_config('request.jwt.claim.sub',(select owner_a::text from zt_w3),true);

do $$
declare t zt_w3%rowtype; d date:=(now() at time zone 'America/Sao_Paulo')::date;
begin
  select * into t from zt_w3;
  update public.work_orders set scheduled_date=d-60,scheduled_time='09:00',status='scheduled' where id=t.wo1;
  update public.work_orders set scheduled_date=d-30,scheduled_time='10:00',status='scheduled',client_location_id=t.loc where id=t.wo2;
  update public.work_orders set scheduled_date=d-10,scheduled_time='11:00',status='scheduled' where id=t.wo3;
  update public.work_orders set scheduled_date=d-2,scheduled_time='14:00',status='scheduled',problem_report='Portão não fechava' where id=t.wo4;
  update public.work_orders set scheduled_date=d+1,scheduled_time='08:30',status='scheduled' where id=t.wo_open;
  update public.work_orders set scheduled_date=d-250,status='scheduled' where id=t.wo_quiet;
  insert into public.work_order_items(work_order_id,company_id,kind,service_id,name,unit,quantity,unit_price,unit_cost)
  values (t.wo3,t.company_a,'service',t.svc_portao,'Manutenção do portão','serviço',1,200,60),
         (t.wo4,t.company_a,'service',t.svc_portao,'Manutenção do portão','serviço',1,200,60),
         (t.wo2,t.company_a,'service',t.svc_intf,'Troca de interfone','serviço',1,180,50);
  insert into public.work_order_reports(work_order_id,company_id,entry_type,body,author_id)
  values (t.wo4,t.company_a,'report','Ajuste da central e testes do portão',t.tech_a),
         (t.wo1,t.company_a,'report','Fechadura digital instalada na entrada',t.tech_a);
  insert into public.installed_equipment(company_id,client_id,client_location_id,work_order_id,product_id,name,brand,model,serial_number,installed_at,registration_key,created_by)
  values (t.company_a,t.carmelo,t.loc,t.wo2,t.intf,'Interfone TDMI','HDL','TDMI','SN-W3-1',now()-interval '30 days','w3-intf-1',t.owner_a);
  insert into public.warranties(company_id,client_id,work_order_id,kind,service_id,description,starts_on,ends_on,source)
  values (t.company_a,t.carmelo,t.wo2,'service',t.svc_intf,'Garantia da troca de interfone',d-30,d+300,'manual'),
         (t.company_a,t.carmelo,t.wo1,'service',null,'Garantia da fechadura',d-60,d-10,'manual'),
         (t.company_a,t.mauro,null,'product',null,'Garantia do portão eletrônico',d-355,d+10,'manual');
  insert into public.work_order_returns(company_id,work_order_id,reason,request_id,created_by)
  values (t.company_a,t.wo3,'Trocar sensor',gen_random_uuid(),t.owner_a);
  update public.work_orders set status='done',completed_at=now()-interval '60 days' where id=t.wo1;
  update public.work_orders set status='done',completed_at=now()-interval '30 days' where id=t.wo2;
  update public.work_orders set status='done',completed_at=now()-interval '10 days' where id=t.wo3;
  update public.work_orders set status='done',completed_at=now()-interval '2 days' where id=t.wo4;
  update public.work_orders set status='done',completed_at=now()-interval '8 months' where id=t.wo_quiet;
  update public.work_orders set status='done',completed_at=now()-interval '1 day' where id=t.wo_b;
  -- Compra, estoque e contas.
  insert into public.purchases(id,company_id,number,supplier_name,purchase_date,due_date,created_by)
  values (t.purchase,t.company_a,'CP-W3-1','Distribuidora W3',d,d+3,t.owner_a);
  insert into public.purchase_items(purchase_id,company_id,product_id,name,quantity,unit_cost)
  values (t.purchase,t.company_a,t.dome,'Câmera Dome Hikvision',10,140);
  insert into public.inventory_movements(company_id,product_id,kind,quantity_delta,unit_cost,purchase_id,created_by)
  values (t.company_a,t.dome,'purchase',10,140,t.purchase,t.owner_a);
  insert into public.financial_entries(company_id,kind,description,amount,due_date,paid,purchase_id)
  values (t.company_a,'expense','Compra CP-W3-1',1400,d+3,false,t.purchase);
  insert into public.financial_entries(company_id,kind,description,amount,due_date,paid,paid_at,client_id,payment_method)
  values (t.company_a,'income','Parcela Carmelo vencida',300,d-1,false,null,t.carmelo,null),
         (t.company_a,'income','Parcela Carmelo a vencer',200,d+5,false,null,t.carmelo,null),
         (t.company_a,'income','Serviço Mauro (mês passado)',500,to_date(t.past_month||'-05','YYYY-MM-DD'),true,to_date(t.past_month||'-06','YYYY-MM-DD'),t.mauro,'pix'),
         (t.company_a,'income','Serviço Mauro em aberto (mês passado)',300,to_date(t.past_month||'-07','YYYY-MM-DD'),false,null,t.mauro,null),
         (t.company_a,'expense','Despesa paga (mês passado)',100,to_date(t.past_month||'-08','YYYY-MM-DD'),true,to_date(t.past_month||'-08','YYYY-MM-DD'),null,'pix'),
         (t.company_a,'expense','Despesa em aberto (mês passado)',200,to_date(t.past_month||'-09','YYYY-MM-DD'),false,null,null,null);
  insert into public.maintenance_contracts(company_id,client_id,name,status,amount,interval_months,next_service_on,next_billing_on,assigned_to)
  values (t.company_a,t.carmelo,'Preventiva mensal do portão','active',450,1,d-3,d+10,t.tech_a),
         (t.company_a,t.mauro,'Contrato pausado','paused',300,3,d+20,d+20,null);
  insert into public.post_sale_followups(company_id,client_id,work_order_id,description,due_on,status,kind,source_key)
  values (t.company_a,t.carmelo,t.wo4,'Ligar para conferir o portão W3',d+2,'pending','check_in','w3-followup-1');
  update zt_w3 set wo4_number=(select number from public.work_orders where id=t.wo4),wo1_number=(select number from public.work_orders where id=t.wo1),
    counts=pg_temp.counts(t.company_a);
end $$;

-- ------------------------------------------------------------------ catálogo/ACL
do $$
declare v_proc pg_proc%rowtype;
begin
  select * into strict v_proc from pg_proc where oid=to_regprocedure('public.zt_assistant_read(uuid,text,jsonb,uuid)');
  perform pg_temp.record_result('00_acl_read', v_proc.prosecdef
    and exists(select 1 from unnest(coalesce(v_proc.proconfig,array[]::text[])) s where s in ('search_path=','search_path=""'))
    and not has_function_privilege('anon',v_proc.oid,'EXECUTE') and has_function_privilege('authenticated',v_proc.oid,'EXECUTE')
    and lower(v_proc.prosrc) !~ '\mexecute\M');
  perform pg_temp.record_result('00_helpers_privados',
    not has_function_privilege('authenticated','zt_private.assistant_read_run(uuid,text,jsonb)','EXECUTE')
    and not has_function_privilege('authenticated','zt_private.assistant_wo_card(uuid,uuid,boolean)','EXECUTE')
    and not has_function_privilege('authenticated','zt_private.assistant_read_client(uuid,jsonb)','EXECUTE')
    and not (select prosecdef from pg_proc where oid=to_regprocedure('zt_private.assistant_read_run(uuid,text,jsonb)')));
end $$;

-- ------------------------------------------------------------------ proprietário A: histórico e memória técnica
set local role authenticated;
do $$
declare t zt_w3%rowtype; r jsonb; e jsonb; d date:=(now() at time zone 'America/Sao_Paulo')::date;
begin
  select * into t from zt_w3;
  r:=pg_temp.r(t.company_a,'owner_client_history',jsonb_build_object('client','Residencial Carmelo'));
  perform pg_temp.record_result('01_historico_ultimos_3', jsonb_array_length(r#>'{result,items}')=3
    and (r#>>'{result,items,0,id}')::uuid=t.wo4 and (r#>>'{result,items,1,id}')::uuid=t.wo3 and (r#>>'{result,items,2,id}')::uuid=t.wo2
    and r#>>'{result,message}'='Últimos 3 atendimentos concluídos de Residencial Carmelo. Há 1 OS em aberto.'
    and (r#>>'{result,subject,id}')::uuid=t.carmelo and r#>>'{result,subject,entityType}'='client', r::text);
  perform pg_temp.record_result('02_historico_dados_reais', r#>>'{result,items,0,number}'=t.wo4_number
    and r#>>'{result,items,0,detail}' like to_char(d-2,'DD/MM/YYYY')||' · concluída · Técnico: Técnico W3%'
    and r#>>'{result,items,0,detail}' like '%Relato: Ajuste da central e testes do portão%'
    and r#>>'{result,items,0,detail}' like '%Itens: 1 × Manutenção do portão%'
    and (r#>'{result,items}')::text not like '%R$%', r::text);
  r:=pg_temp.r(t.company_a,'owner_client_history',jsonb_build_object('client','Residencial Carmelo','limit',1));
  perform pg_temp.record_result('03_o_que_foi_feito_no_ultimo', jsonb_array_length(r#>'{result,items}')=1 and (r#>>'{result,items,0,id}')::uuid=t.wo4
    and r#>>'{result,message}' like 'Último atendimento concluído de Residencial Carmelo.%', r::text);
  r:=pg_temp.r(t.company_a,'owner_client_history',jsonb_build_object('client','Residencial Carmelo','limit',10));
  e:=pg_temp.r(t.company_a,'owner_client_history',jsonb_build_object('client','Residencial Carmelo','limit',11));
  perform pg_temp.record_result('04_ultimos_10_limitado', jsonb_array_length(r#>'{result,items}')=4
    and not r#>'{result,items}' @> jsonb_build_array(jsonb_build_object('id',t.wo_open)) and not r#>'{result,items}' @> jsonb_build_array(jsonb_build_object('id',t.wo_b))
    and e->>'code'='INVALID_INPUT', r::text||e::text);
  r:=pg_temp.r(t.company_a,'owner_client_history',jsonb_build_object('client','Residencial Carmelo','query','portão','limit',1));
  e:=pg_temp.r(t.company_a,'owner_client_history',jsonb_build_object('client','Residencial Carmelo','query','fechadura'));
  perform pg_temp.record_result('05_ultima_manutencao_do_portao', (r#>>'{result,items,0,id}')::uuid=t.wo4
    and jsonb_array_length(e#>'{result,items}')=1 and (e#>>'{result,items,0,id}')::uuid=t.wo1, r::text||e::text);
  r:=pg_temp.r(t.company_a,'owner_client_history',jsonb_build_object('client','Residencial Carmelo','limit',10));
  perform pg_temp.record_result('06_equipamento_garantia_retorno',
    r#>>'{result,items,2,detail}' like '%Equipamentos: Interfone TDMI HDL TDMI (série SN-W3-1)%'
    and r#>>'{result,items,2,detail}' like '%Garantia: até '||to_char(d+300,'DD/MM/YYYY')||' (ativa)%'
    and r#>>'{result,items,2,detail}' like '%Local: Portaria%'
    and r#>>'{result,items,1,detail}' like '%Retorno: Trocar sensor (resolvido)%'
    and r#>>'{result,items,3,detail}' like '%Garantia: até '||to_char(d-10,'DD/MM/YYYY')||' (vencida)%', r::text);
  r:=pg_temp.r(t.company_a,'owner_client_history',jsonb_build_object('client','Carmelo'));
  perform pg_temp.record_result('07_cliente_ambiguo_pergunta_com_opcoes', r->>'question' like 'Encontrei mais de um cliente para "Carmelo"%'
    and jsonb_array_length(r->'options')=2 and r->'options' @> jsonb_build_array(jsonb_build_object('slot','client','ref',t.carmelo2::text))
    and r->>'action'='owner_client_history' and r#>>'{draft,client}'='Carmelo' and not r ? 'result', r::text);
  r:=pg_temp.r(t.company_a,'owner_client_history',jsonb_build_object('client','Carmelo','clientRef',t.carmelo2));
  perform pg_temp.record_result('08_escolha_resolve_cliente', r#>>'{result,message}'='Nenhum atendimento concluído de Residencial Carmelo II.'
    and (r#>>'{result,subject,id}')::uuid=t.carmelo2, r::text);
  r:=pg_temp.r(t.company_a,'owner_client_history',jsonb_build_object('client','Residencial Carmelo','clientRef',t.carmelo_b));
  perform pg_temp.record_result('09_referencia_de_outro_tenant_nao_vaza', r->>'question' like 'Não encontrei o cliente%' and not r ? 'result'
    and r::text not like '%'||t.wo_b::text||'%', r::text);
  r:=pg_temp.r(t.company_a,'owner_work_order_details',jsonb_build_object('workOrder',t.wo4_number));
  e:=pg_temp.r(t.company_a,'owner_work_order_details',jsonb_build_object('workOrder','OS-9999'));
  perform pg_temp.record_result('10_detalhe_da_os', jsonb_array_length(r#>'{result,items}')=1 and (r#>>'{result,items,0,id}')::uuid=t.wo4
    and r#>>'{result,items,0,detail}' like '%Problema relatado: Portão não fechava%' and r#>>'{result,items,0,detail}' like '%Técnico: Técnico W3%'
    and e->>'question' like 'Não encontrei a OS "OS-9999"%', r::text||e::text);
  r:=pg_temp.r(t.company_a,'owner_client_equipment',jsonb_build_object('client','Residencial Carmelo'));
  perform pg_temp.record_result('11_equipamentos_do_cliente', jsonb_array_length(r#>'{result,items}')=1
    and r#>>'{result,items,0,title}'='Interfone TDMI HDL TDMI' and r#>>'{result,items,0,detail}' like 'Local: Portaria%'
    and (r#>>'{result,items,0,id}')::uuid=t.wo2, r::text);
  r:=pg_temp.r(t.company_a,'owner_client_warranties',jsonb_build_object('client','Residencial Carmelo'));
  e:=pg_temp.r(t.company_a,'owner_client_warranties',jsonb_build_object('client','Residencial Carmelo','active',false));
  perform pg_temp.record_result('12_garantia_ativa', jsonb_array_length(r#>'{result,items}')=1 and r#>>'{result,items,0,title}'='Garantia da troca de interfone'
    and r#>>'{result,items,0,detail}' like '%ativa · Originada na %' and r#>>'{result,message}'='1 garantia(s) ativa(s) de Residencial Carmelo.'
    and jsonb_array_length(e#>'{result,items}')=2, r::text||e::text);
  r:=pg_temp.r(t.company_a,'owner_expiring_warranties',jsonb_build_object('days',30));
  perform pg_temp.record_result('13_garantias_vencendo', r#>'{result,items}' @> jsonb_build_array(jsonb_build_object('id',t.mauro))
    and not r#>'{result,items}' @> jsonb_build_array(jsonb_build_object('title','Residencial Carmelo · Garantia da troca de interfone')), r::text);
end $$;

-- ------------------------------------------------------------------ agenda, estoque, compras, contratos, pós-venda
do $$
declare t zt_w3%rowtype; r jsonb; e jsonb; d date:=(now() at time zone 'America/Sao_Paulo')::date;
begin
  select * into t from zt_w3;
  r:=pg_temp.r(t.company_a,'owner_week_schedule','{}');
  perform pg_temp.record_result('14_semana', r#>'{result,items}' @> jsonb_build_array(jsonb_build_object('id',t.wo_open))
    and not r#>'{result,items}' @> jsonb_build_array(jsonb_build_object('id',t.wo4)), r::text);
  r:=pg_temp.r(t.company_a,'owner_day_schedule',jsonb_build_object('date',(d-10)::text));
  perform pg_temp.record_result('15_dia_inclui_servico_feito', r#>'{result,items}' @> jsonb_build_array(jsonb_build_object('id',t.wo3))
    and r#>>'{result,items,0,detail}' like '%concluída%', r::text);
  r:=pg_temp.r(t.company_a,'owner_unscheduled_work_orders','{}');
  perform pg_temp.record_result('16_os_sem_agenda', r#>'{result,items}' @> jsonb_build_array(jsonb_build_object('id',t.wo_unsched)), r::text);
  r:=pg_temp.r(t.company_a,'owner_stock_level',jsonb_build_object('query','câmera dome'));
  perform pg_temp.record_result('17_estoque_sem_custo', jsonb_array_length(r#>'{result,items}')=1 and r#>>'{result,items,0,detail}' like '%Estoque: 10 unidade%'
    and r#>>'{result,items,0,detail}' like '%Venda: R$ 300,00%' and r#>>'{result,items,0,detail}' not like '%140%', r::text);
  r:=pg_temp.r(t.company_a,'owner_low_stock','{}');
  perform pg_temp.record_result('18_estoque_baixo', r#>'{result,items}' @> jsonb_build_array(jsonb_build_object('id',t.cam))
    and not r#>'{result,items}' @> jsonb_build_array(jsonb_build_object('id',t.dome)), r::text);
  r:=pg_temp.r(t.company_a,'owner_stock_movements',jsonb_build_object('query','câmera dome'));
  e:=pg_temp.r(t.company_a,'owner_stock_movements',jsonb_build_object('query','câmera'));
  perform pg_temp.record_result('19_movimentacao', r#>>'{result,items,0,title}'='Entrada por compra: +10' and r#>>'{result,items,0,detail}' like '%Compra CP-W3-1%'
    and (r#>'{result,items}')::text not like '%140%' and e->>'question' like 'Encontrei mais de um produto para "câmera"%', r::text||e::text);
  r:=pg_temp.r(t.company_a,'owner_recent_purchases','{}');
  perform pg_temp.record_result('20_ultimas_compras', r#>>'{result,items,0,title}'='CP-W3-1 · Distribuidora W3'
    and r#>>'{result,items,0,detail}' like '%Total: R$ 1.400,00 · a pagar até '||to_char(d+3,'DD/MM/YYYY'), r::text);
  r:=pg_temp.r(t.company_a,'owner_purchases_due',jsonb_build_object('days',7));
  perform pg_temp.record_result('21_compras_vencendo', jsonb_array_length(r#>'{result,items}')=1 and r#>>'{result,message}' like '1 compra(s) a pagar até %, total R$ 1.400,00.', r::text);
  r:=pg_temp.r(t.company_a,'owner_product_purchases',jsonb_build_object('query','câmera dome'));
  perform pg_temp.record_result('22_compras_do_produto_no_mes', r#>>'{result,message}' like 'Em % você comprou 10 de Câmera Dome Hikvision, total R$ 1.400,00.', r::text);
  r:=pg_temp.r(t.company_a,'owner_maintenance_contracts',jsonb_build_object('client','Residencial Carmelo'));
  e:=pg_temp.r(t.company_a,'owner_contracts_due',jsonb_build_object('period','overdue'));
  perform pg_temp.record_result('23_contratos_e_visita_atrasada', jsonb_array_length(r#>'{result,items}')=1
    and r#>>'{result,items,0,detail}' like 'ativo · R$ 450,00 a cada 1 mês · Próxima visita: '||to_char(d-3,'DD/MM/YYYY')||' (atrasada)%'
    and e#>'{result,items}' @> jsonb_build_array(jsonb_build_object('id',t.carmelo)) and jsonb_array_length(e#>'{result,items}')=1, r::text||e::text);
  r:=pg_temp.r(t.company_a,'owner_post_sale_due',jsonb_build_object('days',7));
  perform pg_temp.record_result('24_pos_venda_da_semana', exists(select 1 from jsonb_array_elements(r#>'{result,items}') i
    where i->>'detail' like 'Ligar para conferir o portão W3 · para '||to_char(d+2,'DD/MM/YYYY')||' · contato%'), r::text);
  r:=pg_temp.r(t.company_a,'owner_inactive_clients',jsonb_build_object('months',6));
  perform pg_temp.record_result('25_clientes_inativos', r#>'{result,items}' @> jsonb_build_array(jsonb_build_object('id',t.quiet))
    and not r#>'{result,items}' @> jsonb_build_array(jsonb_build_object('id',t.carmelo)), r::text);
end $$;

-- ------------------------------------------------------------------ financeiro e relatório
do $$
declare t zt_w3%rowtype; r jsonb; e jsonb;
begin
  select * into t from zt_w3;
  r:=pg_temp.r(t.company_a,'owner_finance_summary',jsonb_build_object('month',t.past_month));
  perform pg_temp.record_result('26_resumo_financeiro_definicoes_financev2',
    r#>'{result,items}' @> '[{"title":"Faturado","detail":"R$ 800,00 · receitas com vencimento no mês"},{"title":"Recebido","detail":"R$ 500,00 · entrada efetiva no mês"},
      {"title":"A receber","detail":"R$ 300,00 · ainda em aberto neste mês"},{"title":"Despesas","detail":"R$ 300,00 · R$ 100,00 já pago"},
      {"title":"Resultado de caixa","detail":"R$ 400,00 · recebido menos despesas pagas"}]'::jsonb, r::text);
  r:=pg_temp.r(t.company_a,'owner_receivables',jsonb_build_object('client','Residencial Carmelo'));
  perform pg_temp.record_result('27_quanto_o_cliente_deve', r#>>'{result,message}'='Residencial Carmelo deve R$ 500,00 em aberto em 2 lançamento(s), R$ 300,00 em atraso.'
    and jsonb_array_length(r#>'{result,items}')=2, r::text);
  r:=pg_temp.r(t.company_a,'owner_receivables','{}');
  e:=pg_temp.r(t.company_a,'owner_overdue_clients','{}');
  perform pg_temp.record_result('28_a_receber_e_atrasados', r#>>'{result,message}' like 'A receber: R$ 800,00 em aberto em 3 lançamento(s), R$ 600,00 em atraso.'
    and e#>'{result,items}' @> jsonb_build_array(jsonb_build_object('id',t.carmelo,'detail','R$ 300,00 em atraso · 1 lançamento(s) · desde '
      ||to_char((now() at time zone 'America/Sao_Paulo')::date-1,'DD/MM/YYYY'))), r::text||e::text);
  r:=pg_temp.r(t.company_a,'owner_operational_report','{}');
  perform pg_temp.record_result('29_relatorio_operacional', jsonb_array_length(r#>'{result,items}')=5 and r#>>'{result,items,0,title}'='OS concluídas'
    and r#>>'{result,items,1,detail}'=(select count(*)::text from public.work_orders where company_id=t.company_a and deleted_at is null and status in ('unscheduled','scheduled','in_progress')), r::text);
  perform pg_temp.record_result('30_consultas_nao_gravam', pg_temp.counts(t.company_a)=t.counts, pg_temp.counts(t.company_a)::text||t.counts::text);
end $$;
reset role;

-- ------------------------------------------------------------------ técnico, membership desativada, outro tenant, anon
select set_config('request.jwt.claim.sub',(select tech_a::text from zt_w3),true);
set local role authenticated;
do $$
declare t zt_w3%rowtype; a text; ok boolean:=true;
begin
  select * into t from zt_w3;
  foreach a in array array['owner_client_history','owner_work_order_details','owner_client_equipment','owner_client_warranties','owner_expiring_warranties',
    'owner_week_schedule','owner_day_schedule','owner_unscheduled_work_orders','owner_stock_level','owner_low_stock','owner_stock_movements',
    'owner_recent_purchases','owner_purchases_due','owner_product_purchases','owner_maintenance_contracts','owner_contracts_due',
    'owner_post_sale_due','owner_inactive_clients','owner_finance_summary','owner_receivables','owner_overdue_clients','owner_operational_report'] loop
    ok:=ok and pg_temp.r(t.company_a,a,'{"client":"Residencial Carmelo"}')->>'code'='ACCESS_DENIED';
  end loop;
  perform pg_temp.record_result('31_tecnico_negado_em_todas_as_consultas', ok);
end $$;
reset role;

select set_config('request.jwt.claim.sub',(select owner_b::text from zt_w3),true);
set local role authenticated;
do $$
declare t zt_w3%rowtype; r jsonb;
begin
  select * into t from zt_w3;
  perform pg_temp.record_result('32_membership_desativada_negada',
    pg_temp.r(t.company_a,'owner_client_history','{"client":"Residencial Carmelo"}')->>'code'='ACCESS_DENIED'
    and pg_temp.r(t.company_a,'owner_finance_summary','{}')->>'code'='ACCESS_DENIED');
  r:=pg_temp.r(t.company_b,'owner_client_history','{"client":"Residencial Carmelo"}');
  perform pg_temp.record_result('33_outro_tenant_isolado', jsonb_array_length(r#>'{result,items}')=1 and (r#>>'{result,items,0,id}')::uuid=t.wo_b
    and r::text not like '%'||t.wo4::text||'%' and r::text not like '%Técnico W3%', r::text);
end $$;
reset role;

set local role anon;
do $$
declare v_ok boolean:=false;
begin
  begin
    perform public.zt_assistant_read((select company_a from zt_w3),'owner_finance_summary','{}',gen_random_uuid());
  exception when insufficient_privilege then v_ok:=true;
  end;
  perform pg_temp.record_result('34_anon_negado', v_ok);
end $$;
reset role;

-- Auditoria (antes de invalidar a assinatura).
do $$
declare t zt_w3%rowtype;
begin
  select * into t from zt_w3;
  perform pg_temp.record_result('35_auditoria_das_consultas',
    (select count(distinct a.action) from public.assistant_action_audit a where a.company_id=t.company_a and a.actor_user_id=t.owner_a and a.status='read')>=20
    and exists(select 1 from public.assistant_action_audit a where a.company_id=t.company_a and a.action='owner_client_history' and a.status='denied' and a.error_code='CLARIFICATION')
    and exists(select 1 from public.assistant_action_audit a where a.company_id=t.company_a and a.actor_user_id=t.tech_a and a.status='denied' and a.error_code='ACCESS_DENIED'));
end $$;

update public.subscriptions set status='canceled' where company_id=(select company_a from zt_w3);
select set_config('request.jwt.claim.sub',(select owner_a::text from zt_w3),true);
set local role authenticated;
do $$
declare t zt_w3%rowtype;
begin
  select * into t from zt_w3;
  perform pg_temp.record_result('36_assinatura_invalida_negada',
    pg_temp.r(t.company_a,'owner_client_history','{"client":"Residencial Carmelo"}')->>'code'='ACCESS_DENIED');
end $$;
reset role;

do $$
declare failures text;
begin
  select string_agg(name||': '||coalesce(detail,''),E'\n' order by name) into failures from zt_w3_results where not ok;
  if failures is not null then raise exception 'ASSISTANT_0096_FAILED: %',failures; end if;
  if (select count(*) from zt_w3_results)<>38 then raise exception 'ASSISTANT_0096_INCOMPLETE: % checks',(select count(*) from zt_w3_results); end if;
end $$;
select 'ASSISTANT_0096_OWNER_READS' as test,count(*) as checks,bool_and(ok) as all_ok from zt_w3_results;
rollback;
