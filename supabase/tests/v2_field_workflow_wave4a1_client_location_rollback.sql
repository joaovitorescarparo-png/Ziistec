-- FIELD WORKFLOW V1 · Wave 4A.1 — vínculo relacional de local / ROLLBACK.
-- Executado somente no Supabase descartável da CI após ci_local_seed.sql.
begin;

create temp table zt_fw4a1(
  client_a uuid not null default gen_random_uuid(),
  client_b uuid not null default gen_random_uuid(),
  client_other uuid not null default gen_random_uuid(),
  location_a uuid,
  location_retry uuid,
  location_b uuid,
  location_other uuid,
  service_id uuid not null default gen_random_uuid(),
  legacy_wo uuid not null default gen_random_uuid(),
  linked_wo uuid not null default gen_random_uuid(),
  quote_id uuid,
  retry_quote_id uuid,
  created_wo uuid,
  request_id uuid not null default gen_random_uuid()
) on commit drop;
insert into zt_fw4a1 default values;
grant select,update on zt_fw4a1 to authenticated;

-- Fixtures no banco descartável.
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
set local role authenticated;
insert into public.clients(id,company_id,person_type,name,address)
select client_a,'20000000-0000-0000-0000-000000000001','PJ','FW4A1 Cliente A','Rua Cliente A' from zt_fw4a1;
insert into public.clients(id,company_id,person_type,name,address)
select client_b,'20000000-0000-0000-0000-000000000001','PJ','FW4A1 Cliente B','Rua Cliente B' from zt_fw4a1;
insert into public.services(id,company_id,name,unit,price,cost,active)
select service_id,'20000000-0000-0000-0000-000000000001','Serviço FW4A1','serviço',250,50,true from zt_fw4a1;

-- Criação de local é owner-only, subscription-guarded e idempotente pela location_key existente.
update zt_fw4a1 t set location_a=(public.zt_create_client_location_for_quote(t.client_a,'Porta social','Rua A, 10')->>'id')::uuid;
update zt_fw4a1 t set location_retry=(public.zt_create_client_location_for_quote(t.client_a,'  Porta   social  ','Rua ignorada no retry')->>'id')::uuid;
update zt_fw4a1 t set location_b=(public.zt_create_client_location_for_quote(t.client_b,'Apartamento 202','Rua B, 20')->>'id')::uuid;
do $$ declare t zt_fw4a1%rowtype;
begin
  select * into t from zt_fw4a1;
  if t.location_a is null or t.location_retry<>t.location_a then raise exception 'Retry de local duplicou ou trocou o vínculo'; end if;
  if (select count(*) from public.client_locations where company_id='20000000-0000-0000-0000-000000000001' and client_id=t.client_a and location_key=zt_private.zt_normalize_location_key('Porta social'))<>1 then raise exception 'Local duplicado em retry'; end if;
end $$;

reset role;
insert into public.clients(id,company_id,person_type,name,address)
select client_other,'20000000-0000-0000-0000-000000000002','PJ','FW4A1 Cliente Outra Empresa','Rua Outra' from zt_fw4a1;
insert into public.client_locations(id,company_id,client_id,name,location_key,address,created_by)
select gen_random_uuid(),'20000000-0000-0000-0000-000000000002',client_other,'Outro tenant','outro tenant','Rua Outra, 30','10000000-0000-0000-0000-000000000002' from zt_fw4a1 returning id;
update zt_fw4a1 t set location_other=(select id from public.client_locations where company_id='20000000-0000-0000-0000-000000000002' and client_id=t.client_other limit 1);

-- OS legada sem relação e OS nova com relação comprovada. Nenhum backfill textual.
set local session_replication_role=replica;
insert into public.work_orders(id,company_id,number,client_id,assigned_to,status,address,service_place,request,completed_at)
select legacy_wo,'20000000-0000-0000-0000-000000000001','CI-FW4A1-LEGACY',client_a,'10000000-0000-0000-0000-000000000001','done','Rua histórica','Porta social','Atendimento legado',now() from zt_fw4a1;
insert into public.work_orders(id,company_id,number,client_id,client_location_id,assigned_to,status,address,service_place,request,completed_at)
select linked_wo,'20000000-0000-0000-0000-000000000001','CI-FW4A1-LINKED',client_a,location_a,'10000000-0000-0000-0000-000000000001','done','Rua A, 10','Porta social','Atendimento vinculado',now() from zt_fw4a1;
insert into public.work_order_items(work_order_id,company_id,kind,service_id,name,unit,quantity,unit_price,unit_cost)
select legacy_wo,'20000000-0000-0000-0000-000000000001','service',service_id,'Serviço FW4A1','serviço',1,200,50 from zt_fw4a1;
insert into public.work_order_items(work_order_id,company_id,kind,service_id,name,unit,quantity,unit_price,unit_cost)
select linked_wo,'20000000-0000-0000-0000-000000000001','service',service_id,'Serviço FW4A1','serviço',1,200,50 from zt_fw4a1;
set local session_replication_role=origin;

select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
set local role authenticated;
do $$ declare t zt_fw4a1%rowtype; legacy jsonb; linked jsonb;
begin
  select * into t from zt_fw4a1;
  legacy:=public.zt_quote_seed_from_work_order(t.legacy_wo);
  if legacy->'client_location_id'<>'null'::jsonb or coalesce((legacy->>'location_confirmed')::boolean,false) then raise exception 'Texto legado virou vínculo confirmado'; end if;
  if legacy->>'legacy_service_place'<>'Porta social' or legacy->'service_place'<>'null'::jsonb then raise exception 'service_place legado deixou de ser apenas referência visual'; end if;

  linked:=public.zt_quote_seed_from_work_order(t.linked_wo);
  if (linked->>'client_location_id')::uuid<>t.location_a or not (linked->>'location_confirmed')::boolean then raise exception 'OS com local válido não reutilizou vínculo relacional'; end if;
  if linked->>'client_location_name'<>'Porta social' or linked->>'client_location_address'<>'Rua A, 10' then raise exception 'Seed vinculado não trouxe local atual válido'; end if;
end $$;

-- Mesmo cliente/empresa é aceito. O backend ignora texto forjado e captura snapshot do local.
update zt_fw4a1 t set quote_id=public.zt_save_quote_from_work_order_idempotent(
  t.legacy_wo,t.location_a,t.request_id,
  jsonb_build_object('client_id',t.client_a,'status','draft','issue_date',current_date,'valid_until',current_date+10,'address','FORJADO','service_place','FORJADO','title','Reuso com local'),
  jsonb_build_array(jsonb_build_object('kind','service','service_id',t.service_id,'name','Serviço FW4A1','unit','serviço','quantity',1,'unit_price',250,'unit_cost',50))
) from zt_fw4a1 t;
update zt_fw4a1 t set retry_quote_id=public.zt_save_quote_from_work_order_idempotent(
  t.legacy_wo,t.location_a,t.request_id,
  jsonb_build_object('client_id',t.client_a,'status','draft'),
  '[]'::jsonb
) from zt_fw4a1 t;
do $$ declare t zt_fw4a1%rowtype;
begin
  select * into t from zt_fw4a1;
  if t.quote_id is null or t.retry_quote_id<>t.quote_id then raise exception 'Retry gerou outro orçamento'; end if;
  if (select count(*) from public.quotes where company_id='20000000-0000-0000-0000-000000000001' and client_request_id=t.request_id)<>1 then raise exception 'Retry duplicou orçamento'; end if;
  if not exists(select 1 from public.quotes q where q.id=t.quote_id and q.client_location_id=t.location_a and q.client_id=t.client_a and q.service_place='Porta social' and q.address='Rua A, 10') then raise exception 'Quote não capturou relação + snapshot autorizado'; end if;
end $$;

-- Local de outro cliente da MESMA empresa é bloqueado.
do $$ begin
  perform public.zt_save_quote_from_work_order_idempotent(
    (select legacy_wo from zt_fw4a1),(select location_b from zt_fw4a1),gen_random_uuid(),
    jsonb_build_object('client_id',(select client_a from zt_fw4a1),'status','draft','issue_date',current_date),
    '[]'::jsonb
  );
  raise exception 'Local do cliente B foi aceito para cliente A';
exception when sqlstate '23514' then null; end $$;

-- Cliente/local de outro tenant é bloqueado mesmo que o frontend tente combiná-los.
do $$ begin
  perform public.zt_save_quote_from_work_order_idempotent(
    (select legacy_wo from zt_fw4a1),(select location_other from zt_fw4a1),gen_random_uuid(),
    jsonb_build_object('client_id',(select client_other from zt_fw4a1),'status','draft','issue_date',current_date),
    '[]'::jsonb
  );
  raise exception 'Cliente/local cross-tenant foi aceito';
exception when sqlstate '23514' then null; end $$;

-- O FK composto também bloqueia bypass SQL de local de outro cliente da mesma empresa.
reset role;
do $$ begin
  update public.quotes set client_location_id=(select location_b from zt_fw4a1) where id=(select quote_id from zt_fw4a1);
  raise exception 'FK composto aceitou local de outro cliente';
exception when foreign_key_violation then null; end $$;

-- Snapshot textual não acompanha edição posterior do cadastro do local.
do $$ declare t zt_fw4a1%rowtype; old_place text; old_address text;
begin
  select * into t from zt_fw4a1;
  select service_place,address into old_place,old_address from public.quotes where id=t.quote_id;
  update public.client_locations set name='Porta social RENOMEADA',address='Rua A, 999' where id=t.location_a;
  if (select service_place from public.quotes where id=t.quote_id)<>old_place or (select address from public.quotes where id=t.quote_id)<>old_address then raise exception 'Cadastro de local reescreveu snapshot do orçamento'; end if;
  if (select service_place from public.work_orders where id=t.legacy_wo)<>'Porta social' then raise exception 'OS histórica foi reescrita'; end if;
end $$;

-- Restaurar cadastro atual para provar conversão quote -> OS com relação e snapshot do quote.
update public.client_locations set name='Porta social RENOMEADA',address='Rua A, 999' where id=(select location_a from zt_fw4a1);
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
set local role authenticated;
update public.quotes set status='approved' where id=(select quote_id from zt_fw4a1);
update zt_fw4a1 t set created_wo=public.zt_create_work_order_from_quote(t.quote_id,null,null,null);
do $$ declare t zt_fw4a1%rowtype; q public.quotes%rowtype; w public.work_orders%rowtype;
begin
  select * into t from zt_fw4a1; select * into q from public.quotes where id=t.quote_id; select * into w from public.work_orders where id=t.created_wo;
  if w.client_location_id<>q.client_location_id or w.client_id<>q.client_id or w.company_id<>q.company_id then raise exception 'OS não preservou vínculo relacional do orçamento'; end if;
  if w.service_place<>q.service_place or w.address is distinct from q.address then raise exception 'OS não preservou snapshot textual aprovado'; end if;
end $$;

-- Técnico não recebe listagem global de locais por RPC.
reset role;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
set local role authenticated;
do $$ begin
  perform public.zt_list_client_locations_for_quote((select client_a from zt_fw4a1));
  raise exception 'Técnico ganhou acesso global a locais';
exception when sqlstate '42501' then null; end $$;
reset role;

-- Subscription cancelada continua bloqueando criação operacional de local.
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
set local role authenticated;
select public.zt_cancel_subscription('20000000-0000-0000-0000-000000000001');
do $$ begin
  perform public.zt_create_client_location_for_quote((select client_a from zt_fw4a1),'Local bloqueado','Rua X');
  raise exception 'Assinatura cancelada permitiu criar local';
exception when sqlstate '42501' then null; end $$;
select public.zt_reactivate_subscription('20000000-0000-0000-0000-000000000001');
reset role;

-- Estrutura: não existe conceito de arquivamento de client_locations nesta wave; inválidos
-- são ausência/wrong tuple e foram cobertos acima. Nenhum backfill por texto foi executado.
do $$ declare n integer;
begin
  select count(*) into n from information_schema.columns where table_schema='public' and table_name='client_locations' and column_name in ('deleted_at','active','archived_at');
  if n<>0 then raise exception 'Teste precisa ser atualizado: client_locations ganhou conceito de arquivamento'; end if;
end $$;

rollback;