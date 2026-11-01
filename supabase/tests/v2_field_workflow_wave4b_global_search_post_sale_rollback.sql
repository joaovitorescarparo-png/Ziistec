-- FIELD WORKFLOW V1 · Wave 4B — busca global + pós-venda / ROLLBACK.
-- Somente Supabase descartável da CI.
begin;

create temp table zt_fw4b(
  client_a uuid not null default gen_random_uuid(),
  client_b uuid not null default gen_random_uuid(),
  location_a uuid not null default gen_random_uuid(),
  product_a uuid not null default gen_random_uuid(),
  service_a uuid not null default gen_random_uuid(),
  wo_search uuid not null default gen_random_uuid(),
  wo_follow uuid not null default gen_random_uuid(),
  wo_warranty_visit uuid not null default gen_random_uuid(),
  quote_a uuid not null default gen_random_uuid(),
  item_search uuid not null default gen_random_uuid(),
  item_follow uuid not null default gen_random_uuid(),
  item_warranty uuid not null default gen_random_uuid(),
  equipment_a uuid not null default gen_random_uuid(),
  warranty_a uuid not null default gen_random_uuid(),
  check_policy uuid,
  warranty_policy uuid,
  disabled_policy uuid,
  followup_id uuid,
  finance_after_first integer,
  warranty_after_first integer,
  report_after_first integer,
  inventory_after_first integer,
  stock_after_first numeric
) on commit drop;
insert into zt_fw4b default values;
grant select,update on zt_fw4b to authenticated;

-- Fixtures sem efeitos colaterais; os efeitos da Wave 4B são ativados depois.
set local session_replication_role=replica;
insert into public.clients(id,company_id,person_type,name,trade_name,tax_id,phone,whatsapp,address)
select client_a,'20000000-0000-0000-0000-000000000001','PJ','Condomínio Atlântico FW4B','Atlântico FW4B','12.345.678/0001-90','(48) 99999-9999','(48) 98888-7777','Rua Oceano FW4B, 124' from zt_fw4b;
insert into public.clients(id,company_id,person_type,name,phone,address)
select client_b,'20000000-0000-0000-0000-000000000002','PF','Cliente B Isolado FW4B','(47) 97777-6666','Rua B FW4B' from zt_fw4b;

insert into public.client_locations(id,company_id,client_id,name,location_key,address,created_by)
select location_a,'20000000-0000-0000-0000-000000000001',client_a,'Apartamento 502 FW4B','apartamento 502 fw4b','Rua Oceano FW4B, 124 · Apto 502','10000000-0000-0000-0000-000000000001' from zt_fw4b;

insert into public.products(id,company_id,name,brand,model,description,unit,cost,price,warranty_months,active,sku,barcode)
select product_a,'20000000-0000-0000-0000-000000000001','Fechadura digital FW4B','Intelbras','FR220 FW4B','Produto de busca','unidade',500,850,12,true,'INT-FR220-FW4B','7891234567890' from zt_fw4b;
insert into public.services(id,company_id,name,category,description,unit,price,cost,active,warranty_days,followup_days)
select service_a,'20000000-0000-0000-0000-000000000001','Instalação FW4B','Controle de acesso','Serviço pós-venda','serviço',300,50,true,90,7 from zt_fw4b;

insert into public.work_orders(id,company_id,number,client_id,client_location_id,assigned_to,status,address,service_place,request)
select wo_search,'20000000-0000-0000-0000-000000000001','OS-FW4B-0098',client_a,location_a,'10000000-0000-0000-0000-000000000001','done','Rua Oceano FW4B, 124 · Apto 502','Apartamento 502 FW4B','Instalar FR220 FW4B' from zt_fw4b;
insert into public.work_orders(id,company_id,number,client_id,client_location_id,assigned_to,status,address,service_place,request)
select wo_follow,'20000000-0000-0000-0000-000000000001','OS-FW4B-FOLLOW',client_a,location_a,'10000000-0000-0000-0000-000000000001','in_progress','Rua Oceano FW4B, 124 · Apto 502','Apartamento 502 FW4B','Concluir e gerar pós-venda' from zt_fw4b;
insert into public.work_orders(id,company_id,number,client_id,client_location_id,assigned_to,status,address,service_place,request,is_warranty_visit)
select wo_warranty_visit,'20000000-0000-0000-0000-000000000001','OS-FW4B-GAR',client_a,location_a,'10000000-0000-0000-0000-000000000001','in_progress','Rua Oceano FW4B, 124 · Apto 502','Apartamento 502 FW4B','Visita em garantia',true from zt_fw4b;

insert into public.work_order_items(id,work_order_id,company_id,kind,service_id,product_id,name,unit,quantity,unit_price,unit_cost)
select item_search,wo_search,'20000000-0000-0000-0000-000000000001','product',null,product_a,'Intelbras FR220 FW4B','unidade',1,850,500 from zt_fw4b;
insert into public.work_order_items(id,work_order_id,company_id,kind,service_id,name,unit,quantity,unit_price,unit_cost)
select item_follow,wo_follow,'20000000-0000-0000-0000-000000000001','service',service_a,'Instalação FW4B','serviço',1,300,50 from zt_fw4b;
insert into public.work_order_items(id,work_order_id,company_id,kind,service_id,name,unit,quantity,unit_price,unit_cost)
select item_warranty,wo_warranty_visit,'20000000-0000-0000-0000-000000000001','service',service_a,'Instalação FW4B','serviço',1,300,50 from zt_fw4b;

insert into public.quotes(id,company_id,number,client_id,client_location_id,status,issue_date,title,description,address,service_place,created_by)
select quote_a,'20000000-0000-0000-0000-000000000001','ORC-FW4B-0124',client_a,location_a,'draft',current_date,'Orçamento FR220 FW4B','Proposta busca global','Rua Oceano FW4B, 124 · Apto 502','Apartamento 502 FW4B','10000000-0000-0000-0000-000000000001' from zt_fw4b;
insert into public.quote_items(quote_id,company_id,kind,product_id,name,unit,quantity,unit_price,unit_cost)
select quote_a,'20000000-0000-0000-0000-000000000001','product',product_a,'Intelbras FR220 FW4B','unidade',1,850,500 from zt_fw4b;

insert into public.installed_equipment(id,company_id,client_id,client_location_id,work_order_id,product_id,name,brand,model,serial_number,barcode,installed_at,warranty_id,source_item_id,registration_key,created_by)
select equipment_a,'20000000-0000-0000-0000-000000000001',client_a,location_a,wo_search,product_a,'Fechadura digital FW4B','Intelbras','FR220 FW4B','SERIAL-FW4B-ABC123','7891234567890',now(),null,item_search,'fw4b-equip-1','10000000-0000-0000-0000-000000000001' from zt_fw4b;
set local session_replication_role=origin;

-- Owner A: busca segura e contextual.
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
set local role authenticated;
do $$
declare t zt_fw4b%rowtype; r jsonb;
begin
  select * into t from zt_fw4b;
  r:=public.zt_global_operational_search('20000000-0000-0000-0000-000000000001','48999999999',30,0);
  if not exists(select 1 from jsonb_array_elements(r->'items') x where x->>'type'='client' and (x->>'id')::uuid=t.client_a) then raise exception 'Telefone normalizado não encontrou cliente'; end if;
  r:=public.zt_global_operational_search('20000000-0000-0000-0000-000000000001','12345678000190',30,0);
  if not exists(select 1 from jsonb_array_elements(r->'items') x where x->>'type'='client' and (x->>'id')::uuid=t.client_a) then raise exception 'Documento normalizado não encontrou cliente'; end if;
  r:=public.zt_global_operational_search('20000000-0000-0000-0000-000000000001','Apartamento 502 FW4B',30,0);
  if not exists(select 1 from jsonb_array_elements(r->'items') x where x->>'type'='location' and (x->>'id')::uuid=t.location_a) then raise exception 'Local não encontrado'; end if;
  r:=public.zt_global_operational_search('20000000-0000-0000-0000-000000000001','OS-FW4B-0098',30,0);
  if not exists(select 1 from jsonb_array_elements(r->'items') x where x->>'type'='work_order' and (x->>'id')::uuid=t.wo_search) then raise exception 'OS não encontrada'; end if;
  r:=public.zt_global_operational_search('20000000-0000-0000-0000-000000000001','ORC-FW4B-0124',30,0);
  if not exists(select 1 from jsonb_array_elements(r->'items') x where x->>'type'='quote' and (x->>'id')::uuid=t.quote_a) then raise exception 'Orçamento não encontrado'; end if;
  r:=public.zt_global_operational_search('20000000-0000-0000-0000-000000000001','Fechadura digital FW4B',30,0);
  if not exists(select 1 from jsonb_array_elements(r->'items') x where x->>'type'='product' and (x->>'id')::uuid=t.product_a) then raise exception 'Produto não encontrado pelo nome'; end if;
  r:=public.zt_global_operational_search('20000000-0000-0000-0000-000000000001','INT-FR220-FW4B',30,0);
  if not exists(select 1 from jsonb_array_elements(r->'items') x where x->>'type'='product' and (x->>'id')::uuid=t.product_a) then raise exception 'SKU não encontrou produto'; end if;
  r:=public.zt_global_operational_search('20000000-0000-0000-0000-000000000001','7891234567890',30,0);
  if not exists(select 1 from jsonb_array_elements(r->'items') x where x->>'type'='product' and (x->>'id')::uuid=t.product_a) then raise exception 'Barcode não encontrou produto'; end if;
  r:=public.zt_global_operational_search('20000000-0000-0000-0000-000000000001','SERIAL-FW4B-ABC123',30,0);
  if not exists(select 1 from jsonb_array_elements(r->'items') x where x->>'type'='equipment' and (x->>'id')::uuid=t.equipment_a) then raise exception 'Serial não encontrou equipamento'; end if;
  if r::text ~* 'unit_cost|supplier|margin|financial' then raise exception 'Busca vazou campo privado'; end if;
  r:=public.zt_global_operational_search('20000000-0000-0000-0000-000000000001','FW4B',2,0);
  if jsonb_array_length(r->'items')>2 then raise exception 'Limite da busca não foi respeitado'; end if;
  if jsonb_array_length(r->'items')=2 and not coalesce((r->>'has_more')::boolean,false) then raise exception 'Paginação não sinalizou próxima página'; end if;
end $$;

-- Tenant isolation: owner A não encontra Company B e não pode pedir o tenant B.
do $$ declare r jsonb;
begin
  r:=public.zt_global_operational_search('20000000-0000-0000-0000-000000000001','Cliente B Isolado FW4B',30,0);
  if jsonb_array_length(r->'items')<>0 then raise exception 'Busca cruzou tenant'; end if;
  begin
    perform public.zt_global_operational_search('20000000-0000-0000-0000-000000000002','Cliente',30,0);
    raise exception 'Owner A pesquisou Company B';
  exception when sqlstate '42501' then null; end;
end $$;

-- Técnico não recebe a nova busca global.
reset role;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
set local role authenticated;
do $$ begin
  perform public.zt_global_operational_search('20000000-0000-0000-0000-000000000001','FW4B',30,0);
  raise exception 'Técnico ganhou busca global';
exception when sqlstate '42501' then null; end $$;

-- Owner configura políticas. Uma desabilitada não gera evento.
reset role;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
set local role authenticated;
update zt_fw4b t set check_policy=public.zt_save_post_sale_policy('20000000-0000-0000-0000-000000000001',null,'Check-in FW4B','check_in',7,true);
update zt_fw4b t set disabled_policy=public.zt_save_post_sale_policy('20000000-0000-0000-0000-000000000001',null,'Manutenção pausada FW4B','maintenance',30,false);

-- Conclusão definitiva: usa o fluxo oficial. Compatibilidade followup_days + política ativa.
select public.zt_finalize_work_order_with_warranty_overrides(
  (select wo_follow from zt_fw4b),
  'Conclusão oficial FW4B',
  null,null,7,'[]'::jsonb,'[]'::jsonb,null
);
set constraints all immediate;

do $$ declare t zt_fw4b%rowtype; n integer; snap jsonb; due0 date;
begin
  select * into t from zt_fw4b;
  select count(*) into n from public.post_sale_followups where company_id='20000000-0000-0000-0000-000000000001' and work_order_id=t.wo_follow;
  if n<>2 then raise exception 'Conclusão deveria gerar exatamente revisão legada + política ativa, gerou %',n; end if;
  if exists(select 1 from public.post_sale_followups where work_order_id=t.wo_follow and policy_id=t.disabled_policy) then raise exception 'Política pausada gerou follow-up'; end if;
  if not exists(select 1 from public.post_sale_followups where work_order_id=t.wo_follow and kind='service_review' and due_on=current_date+7) then raise exception 'services.followup_days deixou de funcionar'; end if;
  select id,policy_snapshot,due_on into t.followup_id,snap,due0 from public.post_sale_followups where work_order_id=t.wo_follow and policy_id=t.check_policy;
  update zt_fw4b set followup_id=t.followup_id;
  if snap->>'kind'<>'check_in' or (snap->>'days_offset')::integer<>7 then raise exception 'Snapshot da política incorreto'; end if;
  if due0<>current_date+7 then raise exception 'Data pós-venda incorreta'; end if;
end $$;

-- Congela efeitos da primeira finalização para comparar com o retry real.
update zt_fw4b t set
  finance_after_first=(select count(*) from public.financial_entries f where f.work_order_id=t.wo_follow),
  warranty_after_first=(select count(*) from public.warranties w where w.work_order_id=t.wo_follow),
  report_after_first=(select count(*) from public.work_order_reports r where r.work_order_id=t.wo_follow and r.entry_type='service_report'),
  inventory_after_first=(select count(*) from public.inventory_movements m where m.product_id=t.product_a),
  stock_after_first=(select p.stock_qty from public.products p where p.id=t.product_a);

do $$ declare t zt_fw4b%rowtype;
begin
  select * into t from zt_fw4b;
  if t.finance_after_first<>1 then raise exception 'Finalização oficial não gerou exatamente um financeiro'; end if;
  if t.warranty_after_first<>1 then raise exception 'Finalização oficial não gerou exatamente uma garantia'; end if;
  if t.report_after_first<>1 then raise exception 'Finalização oficial não gerou exatamente um relatório'; end if;
end $$;

-- Retry: repete a mesma RPC oficial/idempotente; nenhum efeito pode duplicar.
select public.zt_finalize_work_order_with_warranty_overrides(
  (select wo_follow from zt_fw4b),
  'Conclusão oficial FW4B',
  null,null,7,'[]'::jsonb,'[]'::jsonb,null
);
set constraints all immediate;

do $$ declare t zt_fw4b%rowtype; n integer; v_fin integer; v_war integer; v_rep integer; v_inv integer; v_stock numeric;
begin
  select * into t from zt_fw4b;
  select count(*) into n from public.post_sale_followups where work_order_id=t.wo_follow;
  select count(*) into v_fin from public.financial_entries f where f.work_order_id=t.wo_follow;
  select count(*) into v_war from public.warranties w where w.work_order_id=t.wo_follow;
  select count(*) into v_rep from public.work_order_reports r where r.work_order_id=t.wo_follow and r.entry_type='service_report';
  select count(*) into v_inv from public.inventory_movements m where m.product_id=t.product_a;
  select stock_qty into v_stock from public.products where id=t.product_a;
  if n<>2 then raise exception 'Retry duplicou follow-up'; end if;
  if (select count(*) from public.post_sale_followups where work_order_id=t.wo_follow and kind='service_review')<>1 then raise exception 'Retry duplicou services.followup_days'; end if;
  if (select count(*) from public.post_sale_followups where work_order_id=t.wo_follow and policy_id=t.check_policy)<>1 then raise exception 'Retry duplicou policy follow-up'; end if;
  if v_fin<>t.finance_after_first then raise exception 'Retry duplicou financeiro'; end if;
  if v_war<>t.warranty_after_first then raise exception 'Retry duplicou garantia'; end if;
  if v_rep<>t.report_after_first then raise exception 'Retry duplicou relatório'; end if;
  if v_inv<>t.inventory_after_first or v_stock is distinct from t.stock_after_first then raise exception 'Retry duplicou ou alterou estoque'; end if;
end $$;

-- Editar política não reescreve evento já gerado/snapshot.
do $$ declare t zt_fw4b%rowtype; old_due date; old_snap jsonb;
begin
  select * into t from zt_fw4b;
  select due_on,policy_snapshot into old_due,old_snap from public.post_sale_followups where id=t.followup_id;
  perform public.zt_save_post_sale_policy('20000000-0000-0000-0000-000000000001',t.check_policy,'Check-in FW4B editado','check_in',30,true);
  if (select due_on from public.post_sale_followups where id=t.followup_id)<>old_due or (select policy_snapshot from public.post_sale_followups where id=t.followup_id)<>old_snap then raise exception 'Edição de política reescreveu evento existente'; end if;
end $$;

-- Visita de garantia usa o mesmo fluxo oficial e não reinicia ciclo comercial.
select public.zt_finalize_work_order_with_warranty_overrides(
  (select wo_warranty_visit from zt_fw4b),
  'Conclusão oficial da visita em garantia FW4B',
  null,null,7,'[]'::jsonb,'[]'::jsonb,null
);
set constraints all immediate;
do $$ declare t zt_fw4b%rowtype;
begin select * into t from zt_fw4b; if exists(select 1 from public.post_sale_followups where work_order_id=t.wo_warranty_visit) then raise exception 'Visita de garantia reiniciou pós-venda'; end if; end $$;

-- Política de garantia é ativada só agora para isolar o ciclo comercial da OS anterior.
update zt_fw4b t set warranty_policy=public.zt_save_post_sale_policy('20000000-0000-0000-0000-000000000001',null,'Garantia FW4B','warranty_expiring',15,true);

-- Garantia: política relativa ao vencimento nasce uma vez e usa snapshot.
reset role;
insert into public.warranties(id,company_id,client_id,work_order_id,kind,product_id,description,service_place,starts_on,ends_on,serial_number)
select warranty_a,'20000000-0000-0000-0000-000000000001',client_a,wo_search,'product',product_a,'FR220 FW4B garantia','Apartamento 502 FW4B',current_date,current_date+120,'SERIAL-FW4B-WARRANTY' from zt_fw4b;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
set local role authenticated;
do $$ declare t zt_fw4b%rowtype; n integer; f public.post_sale_followups%rowtype;
begin
  select * into t from zt_fw4b;
  select count(*) into n from public.post_sale_followups where warranty_id=t.warranty_a and policy_id=t.warranty_policy;
  if n<>1 then raise exception 'Garantia deveria gerar um follow-up, gerou %',n; end if;
  select * into f from public.post_sale_followups where warranty_id=t.warranty_a and policy_id=t.warranty_policy;
  if f.due_on<>current_date+105 then raise exception 'Lembrete de garantia não ficou 15 dias antes'; end if;
  if f.policy_snapshot->>'basis'<>'before_warranty_end' then raise exception 'Snapshot da garantia incorreto'; end if;
  if not exists(select 1 from jsonb_array_elements((public.zt_global_operational_search('20000000-0000-0000-0000-000000000001','SERIAL-FW4B-WARRANTY',30,0))->'items') x where x->>'type'='warranty' and (x->>'id')::uuid=t.warranty_a) then raise exception 'Busca não encontrou garantia pelo serial'; end if;
end $$;

-- Adiar preserva o mesmo registro. Data passada é bloqueada.
do $$ declare t zt_fw4b%rowtype;
begin
  select * into t from zt_fw4b;
  perform public.zt_update_post_sale_followup(t.followup_id,'pending',current_date+12,'Cliente pediu contato depois.');
  if not exists(select 1 from public.post_sale_followups where id=t.followup_id and due_on=current_date+12 and note='Cliente pediu contato depois.' and status='pending') then raise exception 'Adiar não atualizou follow-up'; end if;
  begin
    perform public.zt_update_post_sale_followup(t.followup_id,'pending',current_date-1,null);
    raise exception 'Adiar aceitou data passada';
  exception when sqlstate '22023' then null; end;
end $$;

-- Concluir registra executor/nota/histórico uma vez; retry não duplica histórico.
do $$ declare t zt_fw4b%rowtype; before_n integer; after_n integer;
begin
  select * into t from zt_fw4b;
  select count(*) into before_n from public.work_order_reports where work_order_id=t.wo_follow and entry_type='history' and body like 'Pós-venda concluído ·%';
  perform public.zt_update_post_sale_followup(t.followup_id,'done',null,'Tudo funcionando corretamente.');
  if not exists(select 1 from public.post_sale_followups where id=t.followup_id and status='done' and completed_at is not null and completed_by='10000000-0000-0000-0000-000000000001' and note='Tudo funcionando corretamente.') then raise exception 'Conclusão não persistiu auditoria'; end if;
  perform public.zt_update_post_sale_followup(t.followup_id,'done',null,null);
  select count(*) into after_n from public.work_order_reports where work_order_id=t.wo_follow and entry_type='history' and body like 'Pós-venda concluído ·%';
  if after_n<>before_n+1 then raise exception 'Conclusão/retry duplicou ou não registrou histórico'; end if;
end $$;

-- Listagem owner-only e tenant-safe.
do $$ declare r jsonb;
begin
  r:=public.zt_list_post_sale_followups('20000000-0000-0000-0000-000000000001','all',100,0);
  if not exists(select 1 from jsonb_array_elements(r->'items') x where x->>'client_name' like '%Atlântico FW4B%') then raise exception 'Lista pós-venda perdeu contexto do cliente'; end if;
end $$;

reset role;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
set local role authenticated;
do $$ begin
  perform public.zt_list_post_sale_policies('20000000-0000-0000-0000-000000000001');
  raise exception 'Técnico listou políticas';
exception when sqlstate '42501' then null; end $$;
do $$ begin
  perform public.zt_list_post_sale_followups('20000000-0000-0000-0000-000000000001','open',50,0);
  raise exception 'Técnico ganhou tela global de pós-venda';
exception when sqlstate '42501' then null; end $$;
do $$ begin
  perform public.zt_update_post_sale_followup((select followup_id from zt_fw4b),'pending',current_date+20,null);
  raise exception 'Técnico alterou pós-venda';
exception when sqlstate '42501' then null; end $$;

-- Subscription guard continua bloqueando escrita administrativa/operacional.
reset role;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
set local role authenticated;
select public.zt_cancel_subscription('20000000-0000-0000-0000-000000000001');
do $$ begin
  perform public.zt_save_post_sale_policy('20000000-0000-0000-0000-000000000001',null,'Bloqueada','custom',5,true);
  raise exception 'Assinatura cancelada permitiu política';
exception when sqlstate '42501' then null; end $$;
do $$ begin
  perform public.zt_update_post_sale_followup((select id from public.post_sale_followups where status='pending' and company_id='20000000-0000-0000-0000-000000000001' limit 1),'pending',current_date+10,null);
  raise exception 'Assinatura cancelada permitiu atualizar follow-up';
exception when sqlstate '42501' then null; end $$;
select public.zt_reactivate_subscription('20000000-0000-0000-0000-000000000001');

-- Direct writes/configuração não foram abertas ao browser.
do $$ begin
  if has_table_privilege('authenticated','public.post_sale_policies','INSERT') then raise exception 'Authenticated ganhou INSERT direto em políticas'; end if;
  if has_table_privilege('authenticated','public.post_sale_followups','UPDATE') then raise exception 'Authenticated ganhou UPDATE direto em followups'; end if;
end $$;

reset role;
rollback;