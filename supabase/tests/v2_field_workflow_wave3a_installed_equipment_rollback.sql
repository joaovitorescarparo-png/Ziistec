-- FIELD WORKFLOW V1 · Wave 3A — equipamento instalado / ROLLBACK.
-- Executado somente no Supabase descartável da CI após ci_local_seed.sql.
begin;

create temp table zt_fw3a (
  client_id uuid not null default gen_random_uuid(),
  product_id uuid not null default gen_random_uuid(),
  work_order_id uuid not null default gen_random_uuid(),
  material_id uuid not null default gen_random_uuid(),
  attachment_id uuid not null default gen_random_uuid(),
  equipment_id uuid,
  retry_equipment_id uuid,
  warranty_before integer,
  warranty_after integer,
  owner_rows integer,
  tech_rows integer,
  unauthorized_rows integer,
  cross_tenant_rows integer,
  disabled_rows integer
) on commit drop;
insert into zt_fw3a default values;
grant select,update on zt_fw3a to authenticated;
grant select on zt_fw3a to service_role;

select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
set local role authenticated;

insert into public.clients(id,company_id,person_type,name,address)
select client_id,'20000000-0000-0000-0000-000000000001','PJ','Condomínio Atlântico','Rua Atlântico, 124'
from zt_fw3a;

insert into public.products(
  id,company_id,name,brand,model,unit,cost,price,warranty_months,active,sale_enabled,track_stock,stock_qty,low_stock_threshold,sku,barcode
)
select product_id,'20000000-0000-0000-0000-000000000001','Fechadura Intelbras FR220','Intelbras','FR220','unidade',300,699,12,true,true,false,0,0,'FR220-CI','7891234567895'
from zt_fw3a;

insert into public.work_orders(
  id,company_id,number,client_id,assigned_to,status,address,service_place,request
)
select work_order_id,'20000000-0000-0000-0000-000000000001','CI-FW3A-124',client_id,
  '10000000-0000-0000-0000-000000000003','in_progress','Rua Atlântico, 124','Porta social','Instalar fechadura'
from zt_fw3a;

insert into public.work_order_materials(
  id,work_order_id,company_id,product_id,name,quantity,unit_cost,serial_number,created_by,warranty_policy
)
select material_id,work_order_id,'20000000-0000-0000-0000-000000000001',product_id,
  'Fechadura Intelbras FR220',1,0,'ABC123456','10000000-0000-0000-0000-000000000001','catalog'
from zt_fw3a;

insert into public.attachments(
  id,company_id,bucket,path,file_name,content_type,size_bytes,category,work_order_id,uploaded_by,media_kind,media_stage,caption
)
select attachment_id,'20000000-0000-0000-0000-000000000001','zt-work-orders',
  '20000000-0000-0000-0000-000000000001/work-orders/fw3a/equipamento.jpg','equipamento.jpg','image/jpeg',12000,
  'Equipamento',work_order_id,'10000000-0000-0000-0000-000000000001','photo','equipment','Serial visível'
from zt_fw3a;

select public.zt_finalize_work_order_with_warranty_overrides(
  (select work_order_id from zt_fw3a),'Instalação concluída e testada.',null,null,7,'[]'::jsonb,'[]'::jsonb,null
);
set constraints all immediate;

update zt_fw3a t set warranty_before=(select count(*) from public.warranties w where w.work_order_id=t.work_order_id);

update zt_fw3a t set equipment_id=public.zt_register_installed_equipment(
  t.work_order_id,t.material_id,null,'Porta social',null,'ABC123456','FW3A-PHYSICAL-001','Instalado na folha principal',t.attachment_id
);
update zt_fw3a t set retry_equipment_id=public.zt_register_installed_equipment(
  t.work_order_id,t.material_id,null,'Porta social',null,'ABC123456','FW3A-PHYSICAL-001','Retry idempotente',t.attachment_id
);
update zt_fw3a t set warranty_after=(select count(*) from public.warranties w where w.work_order_id=t.work_order_id),
  owner_rows=(select count(*) from public.installed_equipment e where e.id=t.equipment_id);

do $$
declare
  t zt_fw3a%rowtype;
  e public.installed_equipment%rowtype;
  loc public.client_locations%rowtype;
begin
  select * into t from zt_fw3a;
  select * into e from public.installed_equipment where id=t.equipment_id;
  select * into loc from public.client_locations where id=e.client_location_id;
  if t.equipment_id is null or t.retry_equipment_id <> t.equipment_id then raise exception 'Retry duplicou equipamento'; end if;
  if (select count(*) from public.installed_equipment where work_order_id=t.work_order_id) <> 1 then raise exception 'Registro idempotente falhou'; end if;
  if e.company_id <> '20000000-0000-0000-0000-000000000001' then raise exception 'Empresa do equipamento incorreta'; end if;
  if e.client_id <> t.client_id or e.work_order_id <> t.work_order_id or e.product_id <> t.product_id then raise exception 'Vínculos cliente/OS/produto incorretos'; end if;
  if loc.client_id <> t.client_id or loc.name <> 'Porta social' then raise exception 'Local do equipamento incorreto'; end if;
  if e.serial_number <> 'ABC123456' or e.barcode <> 'FW3A-PHYSICAL-001' then raise exception 'Serial/barcode não persistiram'; end if;
  if e.image_path not like '%/equipamento.jpg' then raise exception 'Foto não foi vinculada pela evidência'; end if;
  if e.warranty_id is null then raise exception 'Garantia existente da OS não foi vinculada'; end if;
  if t.warranty_after <> t.warranty_before then raise exception 'Registro/retry criou garantia nova'; end if;
  if t.owner_rows <> 1 then raise exception 'Owner não leu o próprio equipamento'; end if;
end $$;

reset role;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000004',true);
insert into public.company_members(company_id,user_id,role,status,job_title)
values('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000004','technician','active','CI Tech não atribuído')
on conflict(company_id,user_id) do update set role='technician',status='active';
set local role authenticated;
update zt_fw3a t set unauthorized_rows=(select count(*) from public.installed_equipment e where e.id=t.equipment_id);
do $$ begin
  perform public.zt_register_installed_equipment((select work_order_id from zt_fw3a),(select material_id from zt_fw3a),null,'Porta social',null,'ABC123456',null,null,null);
  raise exception 'Técnico sem contexto conseguiu registrar equipamento';
exception when sqlstate '42501' then null; end $$;
reset role;

select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
set local role authenticated;
update zt_fw3a t set tech_rows=(select count(*) from public.installed_equipment e where e.id=t.equipment_id);
do $$
declare v jsonb;
begin
  select to_jsonb(h) into v from public.zt_installed_equipment_history((select client_id from zt_fw3a)) h limit 1;
  if v is null then raise exception 'Histórico do técnico não trouxe equipamento atribuído'; end if;
  if v::text ~* 'unit_cost|cost|margin|supplier|fornecedor|finance' then raise exception 'Projeção técnica expôs campo privado'; end if;
  if v->>'serial_number' <> 'ABC123456' then raise exception 'Histórico perdeu serial'; end if;
end $$;
reset role;

select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
set local role authenticated;
update zt_fw3a t set cross_tenant_rows=(select count(*) from public.installed_equipment e where e.id=t.equipment_id);
reset role;

select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
set local role authenticated;
update public.company_members set status='disabled'
 where company_id='20000000-0000-0000-0000-000000000001' and user_id='10000000-0000-0000-0000-000000000003';
reset role;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
set local role authenticated;
update zt_fw3a t set disabled_rows=(select count(*) from public.installed_equipment e where e.id=t.equipment_id);
reset role;

do $$
declare t zt_fw3a%rowtype;
begin
  select * into t from zt_fw3a;
  if t.unauthorized_rows <> 0 then raise exception 'Técnico sem contexto leu equipamento'; end if;
  if t.tech_rows <> 1 then raise exception 'Técnico atribuído não leu equipamento'; end if;
  if t.cross_tenant_rows <> 0 then raise exception 'Cross-tenant leu equipamento'; end if;
  if t.disabled_rows <> 0 then raise exception 'Técnico desativado continuou lendo equipamento'; end if;
end $$;

select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
set local role authenticated;
update public.company_members set status='active'
 where company_id='20000000-0000-0000-0000-000000000001' and user_id='10000000-0000-0000-0000-000000000003';
update public.subscriptions set status='suspended' where company_id='20000000-0000-0000-0000-000000000001';
do $$ begin
  perform public.zt_register_installed_equipment((select work_order_id from zt_fw3a),(select material_id from zt_fw3a),null,'Porta social',null,'ABC123456',null,null,null);
  raise exception 'Assinatura suspensa permitiu registro';
exception when sqlstate '42501' then null; end $$;

rollback;
