-- FIELD WORKFLOW V1 · Wave 4A — modelos + kits + reutilização / ROLLBACK.
-- Executado somente no Supabase descartável da CI após ci_local_seed.sql.
begin;

create temp table zt_fw4a(
  client_id uuid not null default gen_random_uuid(),
  service_id uuid not null default gen_random_uuid(),
  product_id uuid not null default gen_random_uuid(),
  other_product_id uuid not null default gen_random_uuid(),
  checklist_id uuid,
  template_id uuid,
  kit_id uuid,
  quote_id uuid,
  retry_quote_id uuid,
  wo_id uuid not null default gen_random_uuid(),
  source_finance integer,
  source_warranty integer,
  source_reports integer,
  finance_before integer,
  finance_after integer,
  stock_before numeric,
  stock_after numeric,
  cross_visible integer,
  disabled_visible integer,
  request_id uuid not null default gen_random_uuid()
) on commit drop;
insert into zt_fw4a default values;
grant select,update on zt_fw4a to authenticated;

-- Owner A cria catálogo, checklist, modelo e kit.
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
set local role authenticated;
insert into public.clients(id,company_id,person_type,name,address)
select client_id,'20000000-0000-0000-0000-000000000001','PJ','CI Wave4A Cliente','Rua Atual, 410' from zt_fw4a;
insert into public.services(id,company_id,name,unit,price,cost,active,warranty_days)
select service_id,'20000000-0000-0000-0000-000000000001','Instalação CI','serviço',180,40,true,90 from zt_fw4a;
insert into public.products(id,company_id,name,unit,price,cost,active,stock_qty,track_stock,warranty_months)
select product_id,'20000000-0000-0000-0000-000000000001','FR220 CI','unidade',720,500,true,5,true,12 from zt_fw4a;
update zt_fw4a set checklist_id=public.zt_save_checklist_template(
 '20000000-0000-0000-0000-000000000001',null,'Checklist Wave4A',null,true,'[{"text":"programar usuários","required":true}]'::jsonb
);
update zt_fw4a t set template_id=public.zt_save_quote_template(
 '20000000-0000-0000-0000-000000000001',null,
 jsonb_build_object('name','Instalação de fechadura digital','quote_title','Instalação FR220','customer_message','Olá, segue a proposta.','description','Instalação e configuração','notes','Levar ferramentas','payment_terms','Pix na conclusão','warranty_note','Garantia conforme catálogo','validity_days',15,'execution_forecast_days',3,'checklist_template_id',t.checklist_id,'active',true),
 jsonb_build_array(jsonb_build_object('product_id',t.product_id,'quantity',1),jsonb_build_object('service_id',t.service_id,'quantity',1))
);
update zt_fw4a t set kit_id=public.zt_save_quote_kit(
 '20000000-0000-0000-0000-000000000001',null,jsonb_build_object('name','Kit FR220','description','Produto + instalação','active',true),
 jsonb_build_array(jsonb_build_object('product_id',t.product_id,'quantity',1),jsonb_build_object('service_id',t.service_id,'quantity',1))
);

-- Modelo/kit não armazenam preço/custo e resolver não move estoque/financeiro.
update zt_fw4a t set finance_before=(select count(*) from public.financial_entries where company_id='20000000-0000-0000-0000-000000000001'),stock_before=(select stock_qty from public.products where id=t.product_id);
select public.zt_resolve_quote_template((select template_id from zt_fw4a));
select public.zt_resolve_quote_kit((select kit_id from zt_fw4a));
select public.zt_resolve_quote_kit((select kit_id from zt_fw4a));
update zt_fw4a t set finance_after=(select count(*) from public.financial_entries where company_id='20000000-0000-0000-0000-000000000001'),stock_after=(select stock_qty from public.products where id=t.product_id);
do $$ declare t zt_fw4a%rowtype; payload text;
begin
 select * into t from zt_fw4a;
 if t.finance_after<>t.finance_before then raise exception 'Resolver modelo/kit movimentou financeiro'; end if;
 if t.stock_after<>t.stock_before then raise exception 'Resolver kit movimentou estoque'; end if;
 select to_jsonb(i)::text into payload from public.quote_template_items i where i.template_id=t.template_id limit 1;
 if payload ~* 'unit_price|unit_cost|price|cost' then raise exception 'Modelo persistiu preço/custo como autoridade'; end if;
 select to_jsonb(i)::text into payload from public.quote_kit_items i where i.kit_id=t.kit_id limit 1;
 if payload ~* 'unit_price|unit_cost|price|cost' then raise exception 'Kit persistiu preço/custo como autoridade'; end if;
end $$;

-- Salva snapshot independente do orçamento com preços resolvidos atuais.
update zt_fw4a t set quote_id=public.zt_save_reuse_quote_idempotent(
 '20000000-0000-0000-0000-000000000001',null,t.request_id,
 jsonb_build_object('client_id',t.client_id,'status','draft','issue_date',current_date,'valid_until',current_date+15,'discount',0,'surcharge',0,'payment_terms','Pix na conclusão','notes','Snapshot CI','address','Rua Atual, 410','service_place','Porta social','title','Instalação FR220','customer_message','Olá, segue a proposta.','description','Instalação e configuração','warranty_note','Garantia conforme catálogo','execution_forecast_date',current_date+3,'checklist_template_id',t.checklist_id),
 jsonb_build_array(
  jsonb_build_object('kind','product','product_id',t.product_id,'name','FR220 CI','unit','unidade','quantity',1,'unit_price',720,'unit_cost',500),
  jsonb_build_object('kind','service','service_id',t.service_id,'name','Instalação CI','unit','serviço','quantity',1,'unit_price',180,'unit_cost',40)
 )
);
update zt_fw4a t set retry_quote_id=public.zt_save_reuse_quote_idempotent(
 '20000000-0000-0000-0000-000000000001',null,t.request_id,
 jsonb_build_object('client_id',t.client_id,'status','draft'),
 '[]'::jsonb
);
do $$ declare t zt_fw4a%rowtype;
begin
 select * into t from zt_fw4a;
 if t.quote_id is null or t.retry_quote_id<>t.quote_id then raise exception 'Retry criou orçamento duplicado'; end if;
 if (select count(*) from public.quote_items where quote_id=t.quote_id)<>2 then raise exception 'Retry duplicou/removeu itens do snapshot'; end if;
 if exists(select 1 from public.work_order_checklists c where c.company_id='20000000-0000-0000-0000-000000000001' and c.work_order_id is null) then raise exception 'Checklist foi criado antes da OS'; end if;
end $$;

-- Alterar modelo e catálogo depois não muda orçamento antigo; nova resolução usa preço atual.
update public.products set price=790 where id=(select product_id from zt_fw4a);
update zt_fw4a t set template_id=public.zt_save_quote_template(
 '20000000-0000-0000-0000-000000000001',t.template_id,
 jsonb_build_object('name','Instalação de fechadura v2','quote_title','NOVO TÍTULO','active',true),
 jsonb_build_array(jsonb_build_object('product_id',t.product_id,'quantity',2))
);
do $$ declare t zt_fw4a%rowtype; r jsonb;
begin
 select * into t from zt_fw4a;
 if (select unit_price from public.quote_items where quote_id=t.quote_id and product_id=t.product_id)<>720 then raise exception 'Alteração de catálogo mudou orçamento antigo'; end if;
 if (select count(*) from public.quote_items where quote_id=t.quote_id)<>2 then raise exception 'Alteração de modelo mudou orçamento antigo'; end if;
 r:=public.zt_resolve_quote_template(t.template_id);
 if (r->'items'->0->>'unit_price')::numeric<>790 then raise exception 'Modelo não resolveu preço atual'; end if;
end $$;

-- Produto arquivado/inativo nunca é aplicado silenciosamente.
update public.products set active=false where id=(select product_id from zt_fw4a);
do $$ declare r jsonb;
begin
 r:=public.zt_resolve_quote_kit((select kit_id from zt_fw4a));
 if coalesce((r->'items'->0->>'available')::boolean,true) then raise exception 'Produto inativo foi marcado como disponível'; end if;
 if r->'items'->0->'unit_price' <> 'null'::jsonb then raise exception 'Produto inativo manteve preço aplicável'; end if;
end $$;
update public.products set active=true where id=(select product_id from zt_fw4a);

-- Atendimento histórico concluído com preço antigo + dados que NÃO podem ser copiados.
insert into public.work_orders(id,company_id,number,client_id,assigned_to,status,address,service_place,request,pre_notes,completed_at)
select wo_id,'20000000-0000-0000-0000-000000000001','CI-FW4A-OLD',client_id,'10000000-0000-0000-0000-000000000001','done','Rua Antiga, 1','Porta social','Troca de fechadura','Relatório prévio',now() from zt_fw4a;
insert into public.work_order_items(work_order_id,company_id,kind,product_id,name,unit,quantity,unit_price,unit_cost)
select wo_id,'20000000-0000-0000-0000-000000000001','product',product_id,'FR220 CI','unidade',1,650,500 from zt_fw4a;
insert into public.work_order_reports(work_order_id,company_id,entry_type,body,author_id)
select wo_id,'20000000-0000-0000-0000-000000000001','report','EVIDÊNCIA QUE NÃO PODE SER COPIADA','10000000-0000-0000-0000-000000000001' from zt_fw4a;
insert into public.warranties(company_id,client_id,work_order_id,kind,product_id,description,starts_on,ends_on)
select '20000000-0000-0000-0000-000000000001',client_id,wo_id,'product',product_id,'GARANTIA ANTIGA',current_date-30,current_date+300 from zt_fw4a;
update zt_fw4a t set source_reports=(select count(*) from public.work_order_reports where work_order_id=t.wo_id),source_warranty=(select count(*) from public.warranties where work_order_id=t.wo_id),source_finance=(select count(*) from public.financial_entries where work_order_id=t.wo_id);
do $$ declare t zt_fw4a%rowtype; r jsonb; item jsonb; txt text;
begin
 select * into t from zt_fw4a; r:=public.zt_quote_seed_from_work_order(t.wo_id); item:=r->'items'->0; txt:=r::text;
 if r->>'client_id'<>t.client_id::text or r->>'address'<>'Rua Atual, 410' or r->>'service_place'<>'Porta social' then raise exception 'Seed não preservou contexto cliente/local atual válido'; end if;
 if (item->>'historical_unit_price')::numeric<>650 or (item->>'unit_price')::numeric<>790 or not (item->>'price_changed')::boolean then raise exception 'Seed não usou preço atual nem sinalizou mudança'; end if;
 if txt ~* 'billing_entry|financial|warrant|GARANTIA ANTIGA|EVIDÊNCIA QUE NÃO PODE SER COPIADA|signature|return_request|needs_return|completed_at|status' then raise exception 'Seed copiou dado histórico proibido'; end if;
 if (select count(*) from public.work_order_reports where work_order_id=t.wo_id)<>t.source_reports then raise exception 'Seed alterou relatórios'; end if;
 if (select count(*) from public.warranties where work_order_id=t.wo_id)<>t.source_warranty then raise exception 'Seed alterou garantia'; end if;
 if (select count(*) from public.financial_entries where work_order_id=t.wo_id)<>t.source_finance then raise exception 'Seed alterou financeiro'; end if;
end $$;

-- Checklist só nasce quando orçamento aprovado vira OS; retry não duplica.
update public.quotes set status='approved' where id=(select quote_id from zt_fw4a);
do $$ declare t zt_fw4a%rowtype; w uuid; w2 uuid;
begin
 select * into t from zt_fw4a;
 if (select count(*) from public.work_order_checklists c join public.work_orders x on x.id=c.work_order_id where x.quote_id=t.quote_id)<>0 then raise exception 'Checklist existia antes da conversão'; end if;
 w:=public.zt_create_work_order_from_quote(t.quote_id,null,null,null);
 w2:=public.zt_create_work_order_from_quote(t.quote_id,null,null,null);
 if w<>w2 then raise exception 'Retry da conversão gerou outra OS'; end if;
 if (select count(*) from public.work_order_checklists where work_order_id=w)<>1 then raise exception 'Checklist não foi snapshotado uma única vez na OS'; end if;
end $$;

-- Owner B cria produto próprio; Owner A não pode referenciá-lo nem ler seus agrupadores.
reset role;
insert into public.products(id,company_id,name,unit,price,cost,active)
select other_product_id,'20000000-0000-0000-0000-000000000002','Produto empresa B','unidade',99,10,true from zt_fw4a;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
set local role authenticated;
do $$ begin
 perform public.zt_save_quote_kit('20000000-0000-0000-0000-000000000001',null,'{"name":"Kit cross"}'::jsonb,jsonb_build_array(jsonb_build_object('product_id',(select other_product_id from zt_fw4a),'quantity',1)));
 raise exception 'Owner referenciou produto cross-tenant';
exception when sqlstate '23514' then null; end $$;
reset role;

-- Técnico não administra nem resolve modelos/kits globais.
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
set local role authenticated;
do $$ begin
 perform public.zt_save_quote_template('20000000-0000-0000-0000-000000000001',null,'{"name":"Modelo técnico"}'::jsonb,'[]'::jsonb);
 raise exception 'Técnico administrou modelo'; exception when sqlstate '42501' then null; end $$;
do $$ begin
 perform public.zt_resolve_quote_kit((select kit_id from zt_fw4a));
 raise exception 'Técnico resolveu kit global'; exception when sqlstate '42501' then null; end $$;
reset role;

-- Disabled user perde leitura administrativa.
update public.company_members set status='disabled' where company_id='20000000-0000-0000-0000-000000000001' and user_id='10000000-0000-0000-0000-000000000003';
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
set local role authenticated;
do $$ begin
 perform public.zt_list_quote_templates('20000000-0000-0000-0000-000000000001');
 raise exception 'Usuário desativado leu modelos'; exception when sqlstate '42501' then null; end $$;
reset role;
update public.company_members set status='active' where company_id='20000000-0000-0000-0000-000000000001' and user_id='10000000-0000-0000-0000-000000000003';

-- Cliente arquivado impede seed de nova proposta.
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
set local role authenticated;
update public.clients set deleted_at=now() where id=(select client_id from zt_fw4a);
do $$ begin
 perform public.zt_quote_seed_from_work_order((select wo_id from zt_fw4a));
 raise exception 'Cliente arquivado originou seed'; exception when sqlstate '23514' then null; end $$;
update public.clients set deleted_at=null where id=(select client_id from zt_fw4a);

-- Assinatura cancelada bloqueia qualquer nova administração/escrita.
select public.zt_cancel_subscription('20000000-0000-0000-0000-000000000001');
do $$ begin
 perform public.zt_save_quote_kit('20000000-0000-0000-0000-000000000001',null,'{"name":"Kit bloqueado"}'::jsonb,'[]'::jsonb);
 raise exception 'Assinatura cancelada permitiu kit'; exception when sqlstate '42501' then null; end $$;
select public.zt_reactivate_subscription('20000000-0000-0000-0000-000000000001');
reset role;

-- Cross-tenant leitura direta continua sem grant/policy útil.
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
set local role authenticated;
-- Não há SELECT grant nas tabelas Wave4A; RPC com company A também deve falhar.
do $$ begin
 perform public.zt_list_quote_kits('20000000-0000-0000-0000-000000000001');
 raise exception 'Owner B listou kits da empresa A'; exception when sqlstate '42501' then null; end $$;
reset role;

rollback;
