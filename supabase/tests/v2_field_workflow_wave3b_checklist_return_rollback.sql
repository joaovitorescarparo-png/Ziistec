-- FIELD WORKFLOW V1 · Wave 3B — checklist templates + precisa retornar / ROLLBACK.
-- Executado somente no Supabase descartável da CI após ci_local_seed.sql.
begin;

create temp table zt_fw3b (
  client_id uuid not null default gen_random_uuid(),
  wo_id uuid not null default gen_random_uuid(),
  other_wo_id uuid not null default gen_random_uuid(),
  template_id uuid,
  other_template_id uuid,
  return_request uuid not null default gen_random_uuid(),
  return_id uuid,
  retry_return_id uuid,
  blocked_request uuid not null default gen_random_uuid(),
  reactivated_return_id uuid,
  finance_before integer,
  finance_after_return integer,
  warranty_before integer,
  warranty_after_return integer,
  service_report_before integer,
  service_report_after_return integer,
  tech_visible integer,
  tech_other_visible integer,
  disabled_visible integer,
  cross_tenant_visible integer
) on commit drop;
insert into zt_fw3b default values;
grant select,update on zt_fw3b to authenticated;
grant select on zt_fw3b to service_role;

-- -----------------------------------------------------------------------------
-- Owner A cria cliente/OS e template.
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
set local role authenticated;

insert into public.clients(id,company_id,person_type,name,address)
select client_id,'20000000-0000-0000-0000-000000000001','PJ','CI Wave3B Cliente','Rua Checklist, 84'
from zt_fw3b;

insert into public.work_orders(id,company_id,number,client_id,assigned_to,status,address,service_place,request)
select wo_id,'20000000-0000-0000-0000-000000000001','CI-FW3B-001',client_id,
  '10000000-0000-0000-0000-000000000003','in_progress','Rua Checklist, 84','Porta social','Instalação Wave 3B'
from zt_fw3b;

insert into public.work_orders(id,company_id,number,client_id,assigned_to,status,address,service_place,request)
select other_wo_id,'20000000-0000-0000-0000-000000000001','CI-FW3B-002',client_id,
  '10000000-0000-0000-0000-000000000001','in_progress','Rua Checklist, 84','Sala técnica','OS não atribuída ao técnico'
from zt_fw3b;

update zt_fw3b set template_id=public.zt_save_checklist_template(
  '20000000-0000-0000-0000-000000000001',null,'Instalação de fechadura digital','Checklist CI',true,
  '[{"text":"alimentação testada","required":true},{"text":"cliente orientado","required":false}]'::jsonb
);

-- Aplicação dupla não duplica.
do $$
declare t zt_fw3b%rowtype; a integer; b integer;
begin
  select * into t from zt_fw3b;
  a:=public.zt_apply_checklist_template(t.wo_id,t.template_id);
  b:=public.zt_apply_checklist_template(t.wo_id,t.template_id);
  if a<>2 or b<>2 then raise exception 'Aplicação idempotente retornou contagem inesperada'; end if;
  if (select count(*) from public.work_order_checklists where work_order_id=t.wo_id)<>2 then
    raise exception 'Aplicação dupla duplicou checklist';
  end if;
end $$;

-- Alterar template não altera snapshot já copiado para a OS.
update zt_fw3b t set template_id=public.zt_save_checklist_template(
  '20000000-0000-0000-0000-000000000001',t.template_id,'Instalação de fechadura digital v2','Template alterado',true,
  '[{"text":"NOVO texto do template","required":true}]'::jsonb
);
do $$
declare t zt_fw3b%rowtype;
begin
  select * into t from zt_fw3b;
  if (select count(*) from public.work_order_checklists where work_order_id=t.wo_id)<>2 then
    raise exception 'Alteração do template mudou quantidade da OS antiga';
  end if;
  if exists(select 1 from public.work_order_checklists where work_order_id=t.wo_id and text='NOVO texto do template') then
    raise exception 'Template alterou snapshot da OS antiga';
  end if;
end $$;
reset role;

-- Owner B cria template próprio. Owner A não pode ler/aplicar cross-tenant.
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
set local role authenticated;
update zt_fw3b set other_template_id=public.zt_save_checklist_template(
  '20000000-0000-0000-0000-000000000002',null,'Template empresa B',null,true,
  '[{"text":"item B","required":false}]'::jsonb
);
reset role;

select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
set local role authenticated;
do $$ begin
  perform public.zt_apply_checklist_template((select wo_id from zt_fw3b),(select other_template_id from zt_fw3b));
  raise exception 'Owner aplicou template cross-tenant';
exception when sqlstate '42501' then null; end $$;
if (select count(*) from public.checklist_templates where id=(select other_template_id from zt_fw3b))<>0 then
  raise exception 'Owner leu template cross-tenant';
end if;
reset role;

-- -----------------------------------------------------------------------------
-- Técnico não administra template e só interage com checklist da OS atribuída.
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
set local role authenticated;
do $$ begin
  perform public.zt_save_checklist_template(
    '20000000-0000-0000-0000-000000000001',null,'Template indevido',null,true,
    '[{"text":"x","required":false}]'::jsonb
  );
  raise exception 'Técnico administrou template';
exception when sqlstate '42501' then null; end $$;
update zt_fw3b t set
  tech_visible=(select count(*) from public.work_order_checklists c where c.work_order_id=t.wo_id),
  tech_other_visible=(select count(*) from public.work_order_checklists c where c.work_order_id=t.other_wo_id);

-- Marca obrigatório como concluído; texto/required não podem ser adulterados pelo técnico.
update public.work_order_checklists
   set done=true,text='TENTATIVA DE ALTERAÇÃO',required=false
 where work_order_id=(select wo_id from zt_fw3b) and required=true;
do $$
declare c public.work_order_checklists%rowtype;
begin
  select * into c from public.work_order_checklists
   where work_order_id=(select wo_id from zt_fw3b) and source_template_id is not null
   order by position limit 1;
  if not c.done then raise exception 'Técnico não conseguiu marcar checklist atribuído'; end if;
  if c.text<>'alimentação testada' or not c.required then raise exception 'Técnico adulterou item de template'; end if;
end $$;
reset role;

-- Disabled technician perde acesso imediatamente.
update public.company_members
   set status='disabled'
 where company_id='20000000-0000-0000-0000-000000000001'
   and user_id='10000000-0000-0000-0000-000000000003';
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
set local role authenticated;
update zt_fw3b t set disabled_visible=(select count(*) from public.work_order_checklists c where c.work_order_id=t.wo_id);
reset role;
update public.company_members
   set status='active'
 where company_id='20000000-0000-0000-0000-000000000001'
   and user_id='10000000-0000-0000-0000-000000000003';

-- -----------------------------------------------------------------------------
-- Precisa retornar: não conclui OS e não cria finance/garantia/service report.
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
set local role authenticated;
update zt_fw3b t set
  finance_before=(select count(*) from public.financial_entries f where f.work_order_id=t.wo_id),
  warranty_before=(select count(*) from public.warranties w where w.work_order_id=t.wo_id),
  service_report_before=(select count(*) from public.work_order_reports r where r.work_order_id=t.wo_id and r.entry_type='service_report');

update zt_fw3b t set return_id=public.zt_mark_work_order_needs_return(
  t.wo_id,'Falta peça de acabamento','Acabamento FR220','Retornar após chegada da peça','high',current_date+2,t.return_request
);
update zt_fw3b t set retry_return_id=public.zt_mark_work_order_needs_return(
  t.wo_id,'Falta peça de acabamento','Acabamento FR220','Retry','high',current_date+2,t.return_request
);
update zt_fw3b t set
  finance_after_return=(select count(*) from public.financial_entries f where f.work_order_id=t.wo_id),
  warranty_after_return=(select count(*) from public.warranties w where w.work_order_id=t.wo_id),
  service_report_after_return=(select count(*) from public.work_order_reports r where r.work_order_id=t.wo_id and r.entry_type='service_report');

do $$
declare t zt_fw3b%rowtype; w public.work_orders%rowtype;
begin
  select * into t from zt_fw3b;
  select * into w from public.work_orders where id=t.wo_id;
  if t.return_id is null or t.retry_return_id<>t.return_id then raise exception 'Retry duplicou pendência de retorno'; end if;
  if (select count(*) from public.work_order_returns where work_order_id=t.wo_id)<>1 then raise exception 'Retry criou retorno duplicado'; end if;
  if w.status='done' or w.completed_at is not null then raise exception 'Precisa retornar concluiu a OS'; end if;
  if not w.needs_return then raise exception 'OS não ficou marcada como precisa retornar'; end if;
  if t.finance_after_return<>t.finance_before then raise exception 'Precisa retornar criou financeiro'; end if;
  if t.warranty_after_return<>t.warranty_before then raise exception 'Precisa retornar criou garantia'; end if;
  if t.service_report_after_return<>t.service_report_before then raise exception 'Precisa retornar criou relatório final'; end if;
end $$;
reset role;

-- Cross-tenant não lê retorno.
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
set local role authenticated;
update zt_fw3b t set cross_tenant_visible=(select count(*) from public.work_order_returns r where r.work_order_id=t.wo_id);
reset role;

-- Assinatura cancelada bloqueia nova escrita; reativação restaura.
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
set local role authenticated;
perform public.zt_cancel_subscription('20000000-0000-0000-0000-000000000001');
do $$ begin
  perform public.zt_mark_work_order_needs_return(
    (select other_wo_id from zt_fw3b),'Retorno bloqueado pela assinatura',null,null,'normal',current_date+3,(select blocked_request from zt_fw3b)
  );
  raise exception 'Assinatura cancelada permitiu escrita de retorno';
exception when sqlstate '42501' then null; end $$;
perform public.zt_reactivate_subscription('20000000-0000-0000-0000-000000000001');
update zt_fw3b t set reactivated_return_id=public.zt_mark_work_order_needs_return(
  t.other_wo_id,'Retorno após reativação',null,null,'normal',current_date+3,t.blocked_request
);
reset role;

-- Checklist obrigatório é backend authority: item não concluído bloqueia done.
-- Cria obrigatório ad-hoc pelo owner na segunda OS para provar o guard central.
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
set local role authenticated;
insert into public.work_order_checklists(work_order_id,company_id,text,done,position,created_by,required)
select other_wo_id,'20000000-0000-0000-0000-000000000001','Obrigatório pendente',false,0,'10000000-0000-0000-0000-000000000001',true
from zt_fw3b;
do $$ begin
  perform public.zt_finalize_work_order_with_warranty_overrides(
    (select other_wo_id from zt_fw3b),'Tentativa bloqueada',null,null,7,'[]'::jsonb,'[]'::jsonb,null
  );
  raise exception 'Finalização ignorou checklist obrigatório';
exception when sqlstate '23514' then null; end $$;
update public.work_order_checklists set done=true where work_order_id=(select other_wo_id from zt_fw3b) and required;
reset role;

-- Conclusão posterior da OS original preserva histórico do retorno e registra data real.
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
set local role authenticated;
select public.zt_finalize_work_order_with_warranty_overrides(
  (select wo_id from zt_fw3b),'Serviço concluído no retorno',null,null,7,'[]'::jsonb,'[]'::jsonb,null
);
set constraints all immediate;
do $$
declare t zt_fw3b%rowtype; w public.work_orders%rowtype; r public.work_order_returns%rowtype;
begin
  select * into t from zt_fw3b;
  select * into w from public.work_orders where id=t.wo_id;
  select * into r from public.work_order_returns where id=t.return_id;
  if w.status<>'done' or w.completed_at is null then raise exception 'Conclusão posterior não concluiu OS'; end if;
  if w.needs_return then raise exception 'OS concluída permaneceu com needs_return'; end if;
  if r.returned_at is null or r.resolved_at is null then raise exception 'Data real do retorno não foi preservada'; end if;
  if (select count(*) from public.work_order_returns where work_order_id=t.wo_id)<>1 then raise exception 'Conclusão apagou histórico de retorno'; end if;
end $$;
reset role;

-- Asserções de isolamento final.
do $$
declare t zt_fw3b%rowtype; payload text;
begin
  select * into t from zt_fw3b;
  if t.tech_visible<>2 then raise exception 'Técnico atribuído não viu checklist'; end if;
  if t.tech_other_visible<>0 then raise exception 'Técnico viu checklist de OS não atribuída'; end if;
  if t.disabled_visible<>0 then raise exception 'Técnico desativado continuou vendo checklist'; end if;
  if t.cross_tenant_visible<>0 then raise exception 'Cross-tenant leu retorno'; end if;
  if t.reactivated_return_id is null then raise exception 'Reativação não restaurou escrita'; end if;
  select to_jsonb(r)::text into payload from public.work_order_returns r where r.id=t.return_id;
  if payload ~* 'unit_cost|margin|supplier|fornecedor|financial_entries' then raise exception 'Retorno expôs dado financeiro privado'; end if;
end $$;

rollback;
