-- FIELD WORKFLOW V1 · Wave 2 — Relatório de Atendimento / ROLLBACK.
-- Executado somente no Supabase descartável da CI após ci_local_seed.sql.
begin;

create temp table zt_fw2 (
  client_id uuid not null default gen_random_uuid(),
  work_order_id uuid not null default gen_random_uuid(),
  product_id uuid not null default gen_random_uuid(),
  attachment_id uuid not null default gen_random_uuid(),
  report_id uuid,
  stock_before numeric,
  inventory_before integer,
  finance_before integer,
  unauthorized_tech_rows integer,
  cross_tenant_rows integer,
  authorized_tech_rows integer,
  disabled_tech_rows integer
) on commit drop;
insert into zt_fw2 default values;
grant select,update on zt_fw2 to authenticated;

-- ---------------------------------------------------------------- fixtures: owner A
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
set local role authenticated;

insert into public.clients(id,company_id,person_type,name,tax_id,address)
select client_id,'20000000-0000-0000-0000-000000000001','PJ','Condomínio Snapshot Original','11.222.333/0001-44','Rua Original, 100'
from zt_fw2;

insert into public.products(
  id,company_id,name,brand,model,unit,cost,price,warranty_months,active,sale_enabled,track_stock,stock_qty,low_stock_threshold
)
select product_id,'20000000-0000-0000-0000-000000000001','Fechadura Snapshot Original','Marca CI','Modelo CI','unidade',70,250,12,true,true,true,8,1
from zt_fw2;

insert into public.work_orders(
  id,company_id,number,client_id,assigned_to,status,address,service_place,request,pre_notes
)
select work_order_id,'20000000-0000-0000-0000-000000000001','CI-FW2-001',client_id,
  '10000000-0000-0000-0000-000000000003','in_progress','Rua da OS, 200','Condomínio Snapshot · Bloco A · Apto 101',
  'Instalar e testar fechadura','Acesso autorizado pela portaria'
from zt_fw2;

-- O custo interno é fixture legítima, mas o contrato atual proíbe authenticated de
-- gravá-lo diretamente. Usa o mesmo contexto privilegiado aceito pelo trigger de
-- captura: ele persiste 70 no ledger privado e zera unit_cost na linha pública.
reset role;
set local role service_role;
insert into public.work_order_items(
  work_order_id,company_id,kind,product_id,name,unit,quantity,unit_price,unit_cost,is_extra,price_pending,notes
)
select work_order_id,'20000000-0000-0000-0000-000000000001','product',product_id,
  'Fechadura Snapshot Original','unidade',1,250,70,false,false,'Item contratado'
from zt_fw2;
reset role;
set local role authenticated;

insert into public.attachments(
  id,company_id,bucket,path,file_name,content_type,size_bytes,category,work_order_id,uploaded_by,media_kind,media_stage,caption
)
select attachment_id,'20000000-0000-0000-0000-000000000001','zt-work-orders',
  '20000000-0000-0000-0000-000000000001/work-orders/ci-fake/antes.jpg','antes.jpg','image/jpeg',12345,
  'Antes',work_order_id,'10000000-0000-0000-0000-000000000003','photo','before','Estado anterior'
from zt_fw2;

update zt_fw2 t set
  stock_before=(select p.stock_qty from public.products p where p.id=t.product_id),
  inventory_before=(select count(*) from public.inventory_movements m where m.product_id=t.product_id),
  finance_before=(select count(*) from public.financial_entries f where f.work_order_id=t.work_order_id);

reset role;

-- ---------------------------------------------------------------- técnico atribuído seleciona evidência e finaliza
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
set local role authenticated;

select public.zt_set_service_report_evidence((select attachment_id from zt_fw2),true);

select public.zt_finalize_work_order_with_warranty_overrides(
  (select work_order_id from zt_fw2),
  'Relato técnico snapshot: instalação concluída e testes realizados.',
  null,null,7,'[]'::jsonb,'[]'::jsonb,null
);

-- O snapshot é disparado no fim da transação de finalização. Na regressão rollback-safe,
-- força o constraint trigger diferido agora para podermos inspecionar o resultado.
set constraints zt_service_report_after_done immediate;

update zt_fw2 t set report_id=(
  select r.id from public.work_order_reports r
   where r.work_order_id=t.work_order_id
     and r.entry_type='service_report'
     and r.report_version=1
     and r.is_active
);

-- Retry da mesma finalização: não reaplica material/garantia/financeiro nem relatório.
select public.zt_finalize_work_order_with_warranty_overrides(
  (select work_order_id from zt_fw2),
  'Relato ignorado no retry',
  null,null,7,'[]'::jsonb,'[]'::jsonb,null
);

-- Snapshot não contém campos privados e mantém vínculos/valores comerciais permitidos.
do $$
declare
  v jsonb;
  v_wo uuid := (select work_order_id from zt_fw2);
begin
  select snapshot into v
    from public.work_order_reports
   where id=(select report_id from zt_fw2);

  if v is null then raise exception 'Relatório de Atendimento não foi criado'; end if;
  if (select count(*) from public.work_order_reports where work_order_id=v_wo and entry_type='service_report' and is_active) <> 1 then
    raise exception 'Finalização/retry duplicou relatório ativo';
  end if;
  if coalesce(v#>>'{client,name}','') <> 'Condomínio Snapshot Original' then
    raise exception 'Snapshot do cliente incorreto';
  end if;
  if coalesce(v#>>'{location,service_place}','') <> 'Condomínio Snapshot · Bloco A · Apto 101' then
    raise exception 'Snapshot do local incorreto';
  end if;
  if coalesce(v#>>'{work_order,number}','') <> 'CI-FW2-001' then
    raise exception 'Snapshot perdeu vínculo com OS';
  end if;
  if coalesce(v#>>'{technical_report,body}','') not like 'Relato técnico snapshot:%' then
    raise exception 'Relato técnico final não foi congelado';
  end if;
  if jsonb_array_length(coalesce(v->'evidence','[]'::jsonb)) <> 1 then
    raise exception 'Evidência selecionada não foi congelada';
  end if;
  if v::text ~* 'unit_cost|extra_cost|margin|supplier|fornecedor' then
    raise exception 'Snapshot expôs custo/margem/fornecedor privado';
  end if;
end $$;

-- Relatório é efeito sem efeito colateral financeiro/estoque próprio.
do $$
declare
  t zt_fw2%rowtype;
  v_fin integer;
  v_inv integer;
  v_stock numeric;
begin
  select * into t from zt_fw2;
  select count(*) into v_fin from public.financial_entries f where f.work_order_id=t.work_order_id;
  select count(*) into v_inv from public.inventory_movements m where m.product_id=t.product_id;
  select stock_qty into v_stock from public.products where id=t.product_id;

  -- A finalização normal desta OS cria uma única conta a receber. O relatório não cria outra.
  if v_fin <> t.finance_before + 1 then raise exception 'Relatório/finalização criou quantidade financeira inesperada: %',v_fin; end if;
  if v_inv <> t.inventory_before then raise exception 'Relatório movimentou estoque'; end if;
  if v_stock <> t.stock_before then raise exception 'Relatório alterou saldo de estoque'; end if;
end $$;

reset role;

-- ---------------------------------------------------------------- mutações posteriores não alteram snapshot
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
set local role authenticated;
update public.clients c set name='Cliente Alterado Depois' from zt_fw2 t where c.id=t.client_id;
update public.products p set name='Produto Alterado Depois',price=999 from zt_fw2 t where p.id=t.product_id;

do $$
declare v jsonb;
begin
  select snapshot into v from public.work_order_reports where id=(select report_id from zt_fw2);
  if v#>>'{client,name}' <> 'Condomínio Snapshot Original' then raise exception 'Snapshot do cliente mudou após edição'; end if;
  if v#>>'{items,0,name}' <> 'Fechadura Snapshot Original' then raise exception 'Snapshot do item mudou após edição'; end if;
  if (v#>>'{items,0,unit_price}')::numeric <> 250 then raise exception 'Preço snapshot mudou após catálogo'; end if;
end $$;
reset role;

-- ---------------------------------------------------------------- RLS: técnico não atribuído não lê
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000004',true);
insert into public.company_members(company_id,user_id,role,status,job_title)
values('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000004','technician','active','CI Tech não atribuído')
on conflict(company_id,user_id) do update set role='technician',status='active';
set local role authenticated;
update zt_fw2 set unauthorized_tech_rows=(select count(*) from public.work_order_reports where id=(select report_id from zt_fw2));
reset role;

-- Owner da outra empresa também não lê.
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
set local role authenticated;
update zt_fw2 set cross_tenant_rows=(select count(*) from public.work_order_reports where id=(select report_id from zt_fw2));
reset role;

-- Técnico atribuído e ativo lê o snapshot sanitizado.
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
set local role authenticated;
update zt_fw2 set authorized_tech_rows=(select count(*) from public.work_order_reports where id=(select report_id from zt_fw2));
reset role;

-- Desativação remove acesso imediatamente.
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
set local role authenticated;
update public.company_members set status='disabled'
 where company_id='20000000-0000-0000-0000-000000000001'
   and user_id='10000000-0000-0000-0000-000000000003';
reset role;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
set local role authenticated;
update zt_fw2 set disabled_tech_rows=(select count(*) from public.work_order_reports where id=(select report_id from zt_fw2));
reset role;

do $$
declare t zt_fw2%rowtype;
begin
  select * into t from zt_fw2;
  if t.report_id is null then raise exception 'Relatório ausente'; end if;
  if t.unauthorized_tech_rows <> 0 then raise exception 'Técnico não atribuído leu relatório'; end if;
  if t.cross_tenant_rows <> 0 then raise exception 'Cross-tenant leu relatório'; end if;
  if t.authorized_tech_rows <> 1 then raise exception 'Técnico atribuído não leu relatório'; end if;
  if t.disabled_tech_rows <> 0 then raise exception 'Técnico desativado continuou lendo relatório'; end if;
end $$;

rollback;
