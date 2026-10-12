-- ZiisTec Assistant Wave 2 (0095) — referência ativa revalidada, alterar/duplicar/arquivar orçamento,
-- tirar da agenda/cancelar OS, cadastro de serviço e busca no catálogo. Papéis, tenant, assinatura,
-- prévia sem escrita, confirmação única e auditoria. Destino: SOMENTE CI descartável ou staging/
-- homologação. Tudo termina em ROLLBACK.

begin;

create temp table zt_w2 (
  owner_a uuid, tech_a uuid, owner_b uuid, company_a uuid, company_b uuid,
  mauro uuid, ana uuid, bruno uuid, cam uuid, dome uuid, lock_p uuid, svc uuid,
  q1 uuid, q1_number text, q2 uuid, q2_number text, q3 uuid, q3_number text, q4 uuid, q4_number text,
  wo_sched uuid, wo_open uuid, wo_ana uuid, wo_done uuid, wo_tech uuid, wo_other uuid,
  req uuid, plan jsonb
) on commit drop;
create temp table zt_w2_results (name text primary key, ok boolean not null, detail text) on commit drop;
grant select, insert, update on zt_w2, zt_w2_results to authenticated, anon;

create function pg_temp.record_result(p_name text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into zt_w2_results(name,ok,detail) values(p_name,coalesce(p_ok,false),left(p_detail,600));
$$;

-- Prévia + confirmação + nova tentativa da mesma confirmação (idempotência).
create function pg_temp.run(p_company uuid, p_action text, p_input jsonb)
returns jsonb language plpgsql as $$
declare v_req uuid:=gen_random_uuid(); p jsonb; e jsonb;
begin
  p:=public.zt_assistant_plan(p_company,p_action,p_input,v_req);
  if p ? 'error' or not coalesce((p->>'confirmationRequired')::boolean,false) then return jsonb_build_object('plan',p); end if;
  e:=public.zt_assistant_execute(p_company,v_req,p->>'previewHash');
  return jsonb_build_object('plan',p,'exec',e,'again',public.zt_assistant_execute(p_company,v_req,p->>'previewHash'));
end $$;

create function pg_temp.items_of(p_quote uuid) returns jsonb language sql as $$
  select coalesce(jsonb_agg(jsonb_build_object('name',i.name,'product',i.product_id,'service',i.service_id,'qty',i.quantity,
    'price',i.unit_price,'cost',i.unit_cost) order by i.position),'[]') from public.quote_items i where i.quote_id=p_quote;
$$;

with candidates as (
  select u.id, row_number() over (order by u.id) as rn
  from auth.users u left join public.profiles p on p.id=u.id
  where not coalesce(p.is_platform_admin,false)
)
insert into zt_w2(owner_a,tech_a,owner_b,company_a,company_b,mauro,ana,bruno,cam,dome,lock_p,svc)
select (select id from candidates where rn=1),(select id from candidates where rn=2),(select id from candidates where rn=3),
       gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),
       gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid();

do $$
begin
  if exists(select 1 from zt_w2 where owner_a is null or tech_a is null or owner_b is null) then
    raise exception 'WAVE2_NEEDS_THREE_AUTH_USERS';
  end if;
end $$;

select set_config('request.jwt.claim.sub',(select owner_a::text from zt_w2),true);
insert into public.companies(id,name,has_team)
select company_a,'__W2_A__',true from zt_w2 union all select company_b,'__W2_B__',true from zt_w2;
insert into public.subscriptions(company_id,status,current_period_start,current_period_end)
select company_a,'trial'::public.zt_sub_status,current_date,current_date+14 from zt_w2
union all select company_b,'trial'::public.zt_sub_status,current_date,current_date+14 from zt_w2
on conflict (company_id) do update set status=excluded.status,
  current_period_start=excluded.current_period_start,current_period_end=excluded.current_period_end;
insert into public.company_members(company_id,user_id,role,status)
select company_a,owner_a,'owner'::public.zt_role,'active'::public.zt_member_status from zt_w2
union all select company_a,tech_a,'technician'::public.zt_role,'active'::public.zt_member_status from zt_w2
union all select company_b,owner_b,'owner'::public.zt_role,'active'::public.zt_member_status from zt_w2;
insert into public.clients(id,company_id,name,phone,address)
select mauro,company_a,'Mauro Silva','1130000001','Rua A, 1' from zt_w2
union all select ana,company_a,'Ana Lima','1130000002','Rua A, 2' from zt_w2
union all select bruno,company_b,'Bruno Outra Empresa','1130000003','Rua B, 3' from zt_w2;
insert into public.products(id,company_id,name,brand,model,unit,cost,price,active)
select cam,company_a,'Câmera Wi-Fi Intelbras','Intelbras','IM5','unidade',120,250,true from zt_w2
union all select dome,company_a,'Câmera Dome Hikvision','Hikvision','DS2','unidade',140,300,true from zt_w2
union all select lock_p,company_a,'Fechadura Digital',null,null,'unidade',90,200,true from zt_w2;
insert into public.services(id,company_id,name,unit,price,cost,active)
select svc,company_a,'Instalação de câmera','serviço',150,50,true from zt_w2;

-- ------------------------------------------------------------------ catálogo/ACL
do $$
declare v_proc pg_proc%rowtype;
begin
  select * into strict v_proc from pg_proc where oid=to_regprocedure('public.zt_assistant_reference(uuid,text,uuid)');
  perform pg_temp.record_result('00_acl_reference', v_proc.prosecdef
    and exists(select 1 from unnest(coalesce(v_proc.proconfig,array[]::text[])) s where s in ('search_path=','search_path=""'))
    and not has_function_privilege('anon',v_proc.oid,'EXECUTE') and has_function_privilege('authenticated',v_proc.oid,'EXECUTE'));
  perform pg_temp.record_result('00_helpers_privados',
    not has_function_privilege('authenticated','zt_private.assistant_quote_apply(uuid,text,uuid,uuid,jsonb)','EXECUTE')
    and not has_function_privilege('authenticated','zt_private.assistant_quote_change(uuid,text,jsonb)','EXECUTE')
    and not has_function_privilege('authenticated','zt_private.assistant_wo_change(uuid,text,jsonb)','EXECUTE')
    and not (select prosecdef from pg_proc where oid=to_regprocedure('zt_private.assistant_quote_apply(uuid,text,uuid,uuid,jsonb)')));
end $$;

-- ------------------------------------------------------------------ dono A: referência e edição
set local role authenticated;
do $$
declare t zt_w2%rowtype; r jsonb; n integer; d date:=(now() at time zone 'America/Sao_Paulo')::date;
begin
  select * into t from zt_w2;
  r:=pg_temp.run(t.company_a,'create_quote_draft',jsonb_build_object('client','Mauro Silva','items',jsonb_build_array(
    jsonb_build_object('kind','product','name','câmera intelbras','quantity',2),jsonb_build_object('kind','service','name','instalação','quantity',1))));
  update zt_w2 set q1=(r#>>'{exec,result,id}')::uuid, q1_number=r#>>'{exec,result,number}';
  perform pg_temp.record_result('01_orcamento_base', r#>>'{exec,result,entityType}'='quote', r::text);
  r:=pg_temp.run(t.company_a,'create_quote_draft',jsonb_build_object('client','Ana Lima','items',jsonb_build_array(
    jsonb_build_object('kind','product','name','fechadura','quantity',1))));
  update zt_w2 set q2=(r#>>'{exec,result,id}')::uuid, q2_number=r#>>'{exec,result,number}';
  -- OS para a agenda.
  update zt_w2 set
    wo_sched=public.zt_save_work_order_idempotent(t.company_a,null,gen_random_uuid(),jsonb_build_object('client_id',t.mauro,'request','__W2_SCHED__',
      'status','scheduled','scheduled_date',d+1,'scheduled_time','10:00'),'[]'),
    wo_open=public.zt_save_work_order_idempotent(t.company_a,null,gen_random_uuid(),jsonb_build_object('client_id',t.ana,'request','__W2_OPEN__',
      'status','unscheduled'),'[]'),
    wo_ana=public.zt_save_work_order_idempotent(t.company_a,null,gen_random_uuid(),jsonb_build_object('client_id',t.ana,'request','__W2_ANA__',
      'status','scheduled','scheduled_date',d+3,'scheduled_time','09:00'),'[]'),
    wo_done=public.zt_save_work_order_idempotent(t.company_a,null,gen_random_uuid(),jsonb_build_object('client_id',t.mauro,'request','__W2_DONE__',
      'status','scheduled','scheduled_date',d+5,'scheduled_time','08:00'),'[]'),
    wo_tech=public.zt_save_work_order_idempotent(t.company_a,null,gen_random_uuid(),jsonb_build_object('client_id',t.mauro,'request','__W2_TECH__',
      'assigned_to',t.tech_a,'status','scheduled','scheduled_date',d+2,'scheduled_time','15:00'),'[]'),
    wo_other=public.zt_save_work_order_idempotent(t.company_a,null,gen_random_uuid(),jsonb_build_object('client_id',t.ana,'request','__W2_OTHER__',
      'status','unscheduled'),'[]');
end $$;
reset role;
update public.work_orders set status='done',completed_at=now() where id=(select wo_done from zt_w2);
set local role authenticated;

do $$
declare t zt_w2%rowtype; r jsonb; e jsonb;
begin
  select * into t from zt_w2;
  r:=public.zt_assistant_reference(t.company_a,'quote',t.q1);
  perform pg_temp.record_result('02_ref_orcamento_contexto', r->>'type'='quote' and r#>>'{context,number}'=t.q1_number
    and r#>>'{context,client}'='Mauro Silva' and jsonb_array_length(r#>'{context,items}')=2 and r#>>'{context,editable}'='true'
    and (r#>>'{context,total}')::numeric=650 and r->>'label' like t.q1_number||'%', r::text);
  perform pg_temp.record_result('03_ref_sem_uuid_nem_custo', r::text !~ '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-' and r::text not like '%cost%'
    and r::text not like '%120%', r::text);
  r:=public.zt_assistant_reference(t.company_a,'client',t.mauro);
  e:=public.zt_assistant_reference(t.company_a,'product',t.cam);
  perform pg_temp.record_result('04_ref_cliente_produto_servico', r#>>'{context,name}'='Mauro Silva' and e#>>'{context,name}'='Câmera Wi-Fi Intelbras'
    and (e#>>'{context,unitPrice}')::numeric=250 and public.zt_assistant_reference(t.company_a,'service',t.svc)#>>'{context,name}'='Instalação de câmera'
    and (r::text||e::text) !~ '[0-9a-f]{8}-[0-9a-f]{4}-', r::text||e::text);
  r:=public.zt_assistant_reference(t.company_a,'client',t.bruno);
  perform pg_temp.record_result('05_ref_de_outro_tenant_negada', r->>'code'='ACCESS_DENIED' and not r ? 'context', r::text);
  r:=public.zt_assistant_reference(t.company_a,'quote',gen_random_uuid());
  perform pg_temp.record_result('06_ref_inexistente_negada', r ? 'error' and not r ? 'context', r::text);
end $$;

do $$
declare t zt_w2%rowtype; r jsonb; before jsonb; v_req uuid:=gen_random_uuid();
begin
  select * into t from zt_w2;
  before:=pg_temp.items_of(t.q1);
  r:=public.zt_assistant_plan(t.company_a,'owner_update_quote',jsonb_build_object('quote',t.q1_number,'items',jsonb_build_array(
    jsonb_build_object('name','câmera','quantity',3),jsonb_build_object('name','instalação','quantity',1))),v_req);
  perform pg_temp.record_result('07_update_previa_mesmo_valor', r->>'confirmationRequired'='true'
    and r#>>'{input,items,0,origin}'='snapshot' and (r#>>'{input,items,0,unitPrice}')::numeric=250 and (r#>>'{input,items,0,quantity}')::numeric=3
    and (r#>>'{input,total}')::numeric=900 and r->'preview' @> '[{"label":"Total anterior","value":"R$ 650,00"}]'::jsonb
    and r::text like '%mesmo valor do '||t.q1_number||'%', r::text);
  perform pg_temp.record_result('08_update_previa_sem_escrita', pg_temp.items_of(t.q1)=before, pg_temp.items_of(t.q1)::text);
  update zt_w2 set req=v_req, plan=r;
end $$;

do $$
declare t zt_w2%rowtype; r jsonb; again jsonb; n integer;
begin
  select * into t from zt_w2;
  n:=(select count(*) from public.quotes where company_id=t.company_a);
  r:=public.zt_assistant_execute(t.company_a,t.req,t.plan->>'previewHash');
  again:=public.zt_assistant_execute(t.company_a,t.req,t.plan->>'previewHash');
  perform pg_temp.record_result('09_update_confirma_uma_vez', (r#>>'{result,id}')::uuid=t.q1 and r#>>'{result,number}'=t.q1_number and r=again
    and (select count(*) from public.quotes where company_id=t.company_a)=n, r::text);
  perform pg_temp.record_result('10_update_snapshot_e_custo_preservados', pg_temp.items_of(t.q1) @> jsonb_build_array(
    jsonb_build_object('product',t.cam,'qty',3,'price',250,'cost',120),jsonb_build_object('service',t.svc,'qty',1,'price',150,'cost',50))
    and jsonb_array_length(pg_temp.items_of(t.q1))=2, pg_temp.items_of(t.q1)::text);
  r:=pg_temp.run(t.company_a,'owner_update_quote',jsonb_build_object('quote',t.q1_number,'items',jsonb_build_array(
    jsonb_build_object('name','câmera','quantity',3),jsonb_build_object('name','instalação','quantity',1),
    jsonb_build_object('kind','product','name','fechadura','quantity',2))));
  perform pg_temp.record_result('11_update_adiciona_item_do_catalogo', r#>>'{exec,result,entityType}'='quote'
    and pg_temp.items_of(t.q1) @> jsonb_build_array(jsonb_build_object('product',t.lock_p,'qty',2,'price',200,'cost',90))
    and jsonb_array_length(pg_temp.items_of(t.q1))=3, r::text);
  r:=pg_temp.run(t.company_a,'owner_update_quote',jsonb_build_object('quote',t.q1_number,'items',jsonb_build_array(
    jsonb_build_object('name','câmera wi-fi intelbras','quantity',3))));
  perform pg_temp.record_result('12_update_remove_itens', r#>'{plan,preview}' @> '[{"label":"Removido","value":"Instalação de câmera"},{"label":"Removido","value":"Fechadura Digital"}]'::jsonb
    and pg_temp.items_of(t.q1)=jsonb_build_array(jsonb_build_object('name','Câmera Wi-Fi Intelbras','product',t.cam,'service',null,'qty',3,'price',250,'cost',120)), r::text);
  r:=pg_temp.run(t.company_a,'owner_update_quote',jsonb_build_object('quote',t.q1_number,'discount',50));
  perform pg_temp.record_result('13_update_desconto_informado', (r#>>'{plan,input,total}')::numeric=700
    and (select discount from public.quotes where id=t.q1)=50 and jsonb_array_length(pg_temp.items_of(t.q1))=1, r::text);
  r:=public.zt_assistant_plan(t.company_a,'owner_update_quote',jsonb_build_object('quote',t.q1_number,'items',jsonb_build_array(
    jsonb_build_object('kind','free','name','Visita técnica','quantity',1))),gen_random_uuid());
  perform pg_temp.record_result('14_nao_inventa_valor', r->>'question' like 'Qual é o preço de "Visita técnica"%' and not r ? 'previewHash', r::text);
end $$;

-- Versão: o documento mudou entre prévia e confirmação; nada é gravado.
do $$
declare t zt_w2%rowtype; v_req uuid:=gen_random_uuid(); r jsonb;
begin
  select * into t from zt_w2;
  r:=public.zt_assistant_plan(t.company_a,'owner_update_quote',jsonb_build_object('quote',t.q1_number,'discount',60),v_req);
  update zt_w2 set req=v_req, plan=r;
end $$;
reset role;
update public.quotes set notes='__W2_EDITED_ELSEWHERE__',updated_at=clock_timestamp() where id=(select q1 from zt_w2);
set local role authenticated;
do $$
declare t zt_w2%rowtype; r jsonb;
begin
  select * into t from zt_w2;
  r:=public.zt_assistant_execute(t.company_a,t.req,t.plan->>'previewHash');
  perform pg_temp.record_result('15_versao_mudou_nao_grava', r ? 'error' and (select discount from public.quotes where id=t.q1)=50, r::text);
end $$;

-- Concorrência otimista: a versão é o fingerprint do cabeçalho e dos itens, então detecta mudança
-- na mesma transação e com timestamps iguais. Mudou entre a prévia e a confirmação: nada é gravado.
do $$
declare t zt_w2%rowtype; r jsonb; v_req uuid:=gen_random_uuid();
begin
  select * into t from zt_w2;
  r:=pg_temp.run(t.company_a,'create_quote_draft',jsonb_build_object('client','Ana Lima','items',jsonb_build_array(
    jsonb_build_object('kind','product','name','fechadura','quantity',1),jsonb_build_object('kind','service','name','instalação','quantity',1))));
  update zt_w2 set q4=(r#>>'{exec,result,id}')::uuid, q4_number=r#>>'{exec,result,number}';
  r:=public.zt_assistant_plan(t.company_a,'owner_update_quote',jsonb_build_object('quote',r#>>'{exec,result,number}','discount',10),v_req);
  update zt_w2 set req=v_req, plan=r;
end $$;
reset role;
update public.quote_items set quantity=5 where quote_id=(select q4 from zt_w2) and product_id=(select lock_p from zt_w2);
set local role authenticated;
do $$
declare t zt_w2%rowtype; r jsonb; v_req uuid:=gen_random_uuid();
begin
  select * into t from zt_w2;
  r:=public.zt_assistant_execute(t.company_a,t.req,t.plan->>'previewHash');
  perform pg_temp.record_result('15b_item_quantidade_mudou_nao_grava', r ? 'error' and (select discount from public.quotes where id=t.q4)=0
    and exists(select 1 from public.quote_items where quote_id=t.q4 and product_id=t.lock_p and quantity=5), r::text);
  r:=public.zt_assistant_plan(t.company_a,'owner_update_quote',jsonb_build_object('quote',t.q4_number,'discount',10),v_req);
  update zt_w2 set req=v_req, plan=r;
end $$;
reset role;
update public.quote_items set unit_price=199 where quote_id=(select q4 from zt_w2) and product_id=(select lock_p from zt_w2);
set local role authenticated;
do $$
declare t zt_w2%rowtype; r jsonb; v_req uuid:=gen_random_uuid();
begin
  select * into t from zt_w2;
  r:=public.zt_assistant_execute(t.company_a,t.req,t.plan->>'previewHash');
  perform pg_temp.record_result('15c_item_preco_mudou_nao_grava', r ? 'error' and (select discount from public.quotes where id=t.q4)=0
    and exists(select 1 from public.quote_items where quote_id=t.q4 and product_id=t.lock_p and unit_price=199), r::text);
  r:=public.zt_assistant_plan(t.company_a,'owner_update_quote',jsonb_build_object('quote',t.q4_number,'discount',10),v_req);
  update zt_w2 set req=v_req, plan=r;
end $$;
reset role;
delete from public.quote_items where quote_id=(select q4 from zt_w2) and service_id=(select svc from zt_w2);
set local role authenticated;
do $$
declare t zt_w2%rowtype; r jsonb; v_req uuid:=gen_random_uuid();
begin
  select * into t from zt_w2;
  r:=public.zt_assistant_execute(t.company_a,t.req,t.plan->>'previewHash');
  perform pg_temp.record_result('15d_item_removido_nao_grava', r ? 'error' and (select discount from public.quotes where id=t.q4)=0
    and (select count(*) from public.quote_items where quote_id=t.q4)=1, r::text);
  r:=public.zt_assistant_plan(t.company_a,'owner_update_quote',jsonb_build_object('quote',t.q4_number,'discount',10),v_req);
  update zt_w2 set req=v_req, plan=r;
end $$;
reset role;
insert into public.quote_items(quote_id,company_id,kind,name,unit,quantity,unit_price,unit_cost,position)
select q4,company_a,'free','Item avulso','unidade',1,10,0,9 from zt_w2;
set local role authenticated;
do $$
declare t zt_w2%rowtype; r jsonb; e jsonb; again jsonb; ctx jsonb; ref jsonb; n integer; v_req uuid:=gen_random_uuid();
begin
  select * into t from zt_w2;
  r:=public.zt_assistant_execute(t.company_a,t.req,t.plan->>'previewHash');
  perform pg_temp.record_result('15e_item_adicionado_nao_grava', r ? 'error' and (select discount from public.quotes where id=t.q4)=0
    and (select count(*) from public.quote_items where quote_id=t.q4)=2, r::text);
  -- Sem mudança entre prévia e confirmação: grava uma vez; a nova tentativa devolve o mesmo resultado.
  n:=(select count(*) from public.quotes where company_id=t.company_a);
  r:=public.zt_assistant_plan(t.company_a,'owner_update_quote',jsonb_build_object('quote',t.q4_number,'discount',10),v_req);
  ctx:=public.zt_assistant_plan_context(t.company_a,v_req);
  ref:=public.zt_assistant_reference(t.company_a,'quote',t.q4);
  perform pg_temp.record_result('15g_versao_somente_no_backend', r#>>'{input,version}' ~ '^[0-9a-f]{64}$'
    and not (ctx->'input') ? 'version' and ctx::text not like '%'||(r#>>'{input,version}')||'%'
    and ref::text not like '%'||(r#>>'{input,version}')||'%' and ctx::text !~ '[0-9a-f]{8}-[0-9a-f]{4}-', ctx::text);
  e:=public.zt_assistant_execute(t.company_a,v_req,r->>'previewHash');
  again:=public.zt_assistant_execute(t.company_a,v_req,r->>'previewHash');
  perform pg_temp.record_result('15f_sem_mudanca_confirma_uma_vez', e#>>'{result,entityType}'='quote' and e=again
    and (select discount from public.quotes where id=t.q4)=10 and (select count(*) from public.quotes where company_id=t.company_a)=n
    and (select count(*) from public.quote_items where quote_id=t.q4)=2, e::text);
  -- Duplicação: a origem também é conferida pelo fingerprint.
  v_req:=gen_random_uuid();
  r:=public.zt_assistant_plan(t.company_a,'owner_duplicate_quote',jsonb_build_object('quote',t.q4_number),v_req);
  update zt_w2 set req=v_req, plan=r;
end $$;
reset role;
update public.quotes set notes='__W2_SOURCE_EDITED__' where id=(select q4 from zt_w2);
set local role authenticated;
do $$
declare t zt_w2%rowtype; r jsonb; n integer;
begin
  select * into t from zt_w2;
  n:=(select count(*) from public.quotes where company_id=t.company_a);
  r:=public.zt_assistant_execute(t.company_a,t.req,t.plan->>'previewHash');
  perform pg_temp.record_result('15h_duplicacao_com_origem_alterada_nao_grava', t.plan->>'confirmationRequired'='true' and r ? 'error'
    and (select count(*) from public.quotes where company_id=t.company_a)=n, r::text||t.plan::text);
end $$;

-- Aprovado e com OS: não altera nem arquiva; duplicar continua possível.
reset role;
update public.quotes set status='approved' where id=(select q2 from zt_w2);
update public.products set price=260 where id=(select cam from zt_w2);
set local role authenticated;
do $$
declare t zt_w2%rowtype; r jsonb; e jsonb; v_new uuid;
begin
  select * into t from zt_w2;
  r:=public.zt_assistant_plan(t.company_a,'owner_update_quote',jsonb_build_object('quote',t.q2_number,'discount',10),gen_random_uuid());
  perform pg_temp.record_result('16_aprovado_nao_edita', r->>'question' like '%está aprovado e não pode ser alterado%' and not r ? 'previewHash', r::text);
  perform public.zt_create_work_order_from_quote(t.q2);
  r:=public.zt_assistant_plan(t.company_a,'owner_archive_quote',jsonb_build_object('quote',t.q2_number),gen_random_uuid());
  e:=public.zt_assistant_plan(t.company_a,'owner_update_quote',jsonb_build_object('quote',t.q2_number,'discount',10),gen_random_uuid());
  perform pg_temp.record_result('17_os_vinculada_bloqueia', r->>'question' like '%já originou a OS-%' and e->>'question' like '%já originou a OS-%'
    and not r ? 'previewHash' and (select deleted_at from public.quotes where id=t.q2) is null, r::text||e::text);

  r:=pg_temp.run(t.company_a,'owner_duplicate_quote',jsonb_build_object('quote',t.q1_number));
  v_new:=(r#>>'{exec,result,id}')::uuid;
  perform pg_temp.record_result('18_duplica_mesmos_valores', v_new is not null and v_new<>t.q1 and r#>>'{plan,input,items,0,origin}'='snapshot'
    and pg_temp.items_of(v_new)=jsonb_build_array(jsonb_build_object('name','Câmera Wi-Fi Intelbras','product',t.cam,'service',null,'qty',3,'price',250,'cost',120))
    and (select client_id from public.quotes where id=v_new)=t.mauro and (select discount from public.quotes where id=v_new)=50
    and (select status from public.quotes where id=v_new)='draft' and r#>'{plan,preview}' @> jsonb_build_array(jsonb_build_object('label','Valores','value','mesmos valores do '||t.q1_number))
    and (select discount from public.quotes where id=t.q1)=50, r::text);
  update zt_w2 set q3=v_new, q3_number=r#>>'{exec,result,number}';
  r:=pg_temp.run(t.company_a,'owner_duplicate_quote',jsonb_build_object('quote',t.q1_number,'prices','current'));
  perform pg_temp.record_result('19_duplica_preco_atual', r#>>'{plan,input,items,0,origin}'='catalog'
    and pg_temp.items_of((r#>>'{exec,result,id}')::uuid) @> jsonb_build_array(jsonb_build_object('product',t.cam,'price',260,'cost',120)), r::text);
  r:=pg_temp.run(t.company_a,'owner_duplicate_quote',jsonb_build_object('quote',t.q1_number,'client','Ana Lima','items',jsonb_build_array(
    jsonb_build_object('name','câmera','quantity',4))));
  perform pg_temp.record_result('20_duplica_outro_cliente_quatro', (select client_id from public.quotes where id=(r#>>'{exec,result,id}')::uuid)=t.ana
    and pg_temp.items_of((r#>>'{exec,result,id}')::uuid) @> jsonb_build_array(jsonb_build_object('product',t.cam,'qty',4,'price',250)), r::text);
  r:=public.zt_assistant_plan(t.company_a,'owner_duplicate_quote',jsonb_build_object('quote',t.q2_number),gen_random_uuid());
  perform pg_temp.record_result('21_duplica_aprovado_permitido', r->>'confirmationRequired'='true', r::text);
end $$;

do $$
declare t zt_w2%rowtype; r jsonb;
begin
  select * into t from zt_w2;
  r:=pg_temp.run(t.company_a,'owner_archive_quote',jsonb_build_object('quote',t.q3_number));
  perform pg_temp.record_result('22_arquiva_sem_apagar', r#>>'{exec,result,entityType}'='quote' and r->'exec'=r->'again'
    and (select deleted_at from public.quotes where id=t.q3) is not null and exists(select 1 from public.quote_items where quote_id=t.q3)
    and r#>'{plan,preview}' @> '[{"label":"Ação"}]'::jsonb, r::text);
  perform pg_temp.record_result('23_arquivado_sai_da_referencia', public.zt_assistant_reference(t.company_a,'quote',t.q3) ? 'error'
    and public.zt_assistant_plan(t.company_a,'owner_update_quote',jsonb_build_object('quote',t.q3_number,'discount',5),gen_random_uuid())->>'question' like 'Não encontrei o orçamento%');
end $$;

-- ------------------------------------------------------------------ agenda
do $$
declare t zt_w2%rowtype; r jsonb; v_num text; d date:=(now() at time zone 'America/Sao_Paulo')::date;
begin
  select * into t from zt_w2;
  select number into v_num from public.work_orders where id=t.wo_sched;
  r:=pg_temp.run(t.company_a,'schedule_work_order',jsonb_build_object('workOrder',v_num,'date',(d+2)::text,'time','14:00'));
  perform pg_temp.record_result('24_reagenda_existente', exists(select 1 from public.work_orders where id=t.wo_sched and scheduled_date=d+2
    and scheduled_time='14:00' and status='scheduled'), r::text);
  r:=pg_temp.run(t.company_a,'owner_unschedule_work_order',jsonb_build_object('workOrder',v_num));
  perform pg_temp.record_result('25_tira_da_agenda_sem_apagar', r->'exec'=r->'again' and r#>'{plan,preview}' @> '[{"label":"Ação","value":"Tirar da agenda: a OS continua aberta, sem data."}]'::jsonb
    and exists(select 1 from public.work_orders where id=t.wo_sched and status='unscheduled' and scheduled_date is null and scheduled_time is null and deleted_at is null), r::text);
  r:=public.zt_assistant_plan(t.company_a,'owner_unschedule_work_order',jsonb_build_object('workOrder',v_num),gen_random_uuid());
  perform pg_temp.record_result('26_tirar_da_agenda_nao_cancela', r->>'question' like '%não está agendada%cancelar a OS%' and not r ? 'previewHash'
    and (select status from public.work_orders where id=t.wo_sched)='unscheduled', r::text);
  select number into v_num from public.work_orders where id=t.wo_open;
  r:=pg_temp.run(t.company_a,'owner_cancel_work_order',jsonb_build_object('workOrder',v_num));
  perform pg_temp.record_result('27_cancela_os', r#>'{plan,preview}' @> '[{"label":"Ação","value":"Cancelar a OS: o serviço não será feito; o histórico é preservado."}]'::jsonb
    and exists(select 1 from public.work_orders where id=t.wo_open and status='canceled' and deleted_at is null), r::text);
  select number into v_num from public.work_orders where id=t.wo_done;
  r:=public.zt_assistant_plan(t.company_a,'owner_cancel_work_order',jsonb_build_object('workOrder',v_num),gen_random_uuid());
  perform pg_temp.record_result('28_concluida_nao_cancela', r->>'question' like '%já está concluída%' and (select status from public.work_orders where id=t.wo_done)='done', r::text);
  r:=pg_temp.run(t.company_a,'owner_unschedule_work_order',jsonb_build_object('client','Ana Lima','date',(d+3)::text));
  perform pg_temp.record_result('29_tira_da_agenda_por_cliente_e_data', (r#>>'{exec,result,id}')::uuid=t.wo_ana
    and (select status from public.work_orders where id=t.wo_ana)='unscheduled', r::text);
end $$;

-- ------------------------------------------------------------------ catálogo
do $$
declare t zt_w2%rowtype; r jsonb; e jsonb;
begin
  select * into t from zt_w2;
  r:=pg_temp.run(t.company_a,'create_service',jsonb_build_object('name','Instalação de fechadura','price',180));
  perform pg_temp.record_result('30_cadastra_servico', r#>>'{exec,result,entityType}'='service' and exists(select 1 from public.services
    where id=(r#>>'{exec,result,id}')::uuid and company_id=t.company_a and name='Instalação de fechadura' and price=180 and active and cost=0), r::text);
  r:=public.zt_assistant_plan(t.company_a,'owner_find_product','{"query":"câmeras"}',gen_random_uuid());
  e:=public.zt_assistant_plan(t.company_a,'owner_find_service','{"query":"instalação"}',gen_random_uuid());
  perform pg_temp.record_result('31_busca_catalogo_sem_custo', jsonb_array_length(r#>'{result,items}')=2 and r#>>'{result,items,0,entityType}'='product'
    and jsonb_array_length(e#>'{result,items}')=2 and r::text not like '%cost%', r::text||e::text);
end $$;
reset role;

-- ------------------------------------------------------------------ técnico, outro tenant, assinatura
select set_config('request.jwt.claim.sub',(select tech_a::text from zt_w2),true);
set local role authenticated;
do $$
declare t zt_w2%rowtype; r jsonb;
begin
  select * into t from zt_w2;
  perform pg_temp.record_result('32_tecnico_negado_nas_acoes_owner',
    public.zt_assistant_plan(t.company_a,'owner_update_quote',jsonb_build_object('quote',t.q1_number,'discount',1),gen_random_uuid())->>'code'='ACCESS_DENIED'
    and public.zt_assistant_plan(t.company_a,'owner_unschedule_work_order',jsonb_build_object('client','Mauro Silva'),gen_random_uuid())->>'code'='ACCESS_DENIED'
    and public.zt_assistant_plan(t.company_a,'owner_cancel_work_order',jsonb_build_object('client','Mauro Silva'),gen_random_uuid())->>'code'='ACCESS_DENIED'
    and public.zt_assistant_plan(t.company_a,'create_service',jsonb_build_object('name','x','price',1),gen_random_uuid())->>'code'='ACCESS_DENIED'
    and public.zt_assistant_plan(t.company_a,'owner_find_product','{"query":"câmera"}',gen_random_uuid())->>'code'='ACCESS_DENIED'
    and public.zt_assistant_reference(t.company_a,'quote',t.q1)->>'code'='ACCESS_DENIED');
  r:=public.zt_assistant_reference(t.company_a,'work_order',t.wo_tech);
  perform pg_temp.record_result('33_tecnico_ref_somente_os_atribuida', r->>'type'='work_order' and r#>>'{context,client}'='Mauro Silva'
    and public.zt_assistant_reference(t.company_a,'work_order',t.wo_other)->>'code'='ACCESS_DENIED' and r::text !~ '[0-9a-f]{8}-[0-9a-f]{4}-', r::text);
end $$;
reset role;

select set_config('request.jwt.claim.sub',(select owner_b::text from zt_w2),true);
set local role authenticated;
do $$
declare t zt_w2%rowtype;
begin
  select * into t from zt_w2;
  perform pg_temp.record_result('34_outro_tenant_negado',
    public.zt_assistant_plan(t.company_a,'owner_update_quote',jsonb_build_object('quote',t.q1_number,'discount',1),gen_random_uuid())->>'code'='ACCESS_DENIED'
    and public.zt_assistant_reference(t.company_a,'quote',t.q1)->>'code'='ACCESS_DENIED'
    and public.zt_assistant_reference(t.company_b,'quote',t.q1) ? 'error'
    and public.zt_assistant_plan(t.company_b,'owner_archive_quote',jsonb_build_object('quote',t.q1_number),gen_random_uuid())->>'question' like 'Não encontrei o orçamento%');
end $$;
reset role;

-- Auditoria das mutações novas (antes de invalidar a assinatura).
do $$
begin
  perform pg_temp.record_result('35_auditoria_das_acoes', (select count(distinct a.action) from public.assistant_action_audit a
    where a.company_id=(select company_a from zt_w2) and a.status='succeeded'
      and a.action in ('owner_update_quote','owner_duplicate_quote','owner_archive_quote','owner_unschedule_work_order','owner_cancel_work_order','create_service'))=6);
end $$;

update public.subscriptions set status='canceled' where company_id=(select company_a from zt_w2);
select set_config('request.jwt.claim.sub',(select owner_a::text from zt_w2),true);
set local role authenticated;
do $$
declare t zt_w2%rowtype;
begin
  select * into t from zt_w2;
  perform pg_temp.record_result('36_assinatura_invalida_negada',
    public.zt_assistant_plan(t.company_a,'owner_update_quote',jsonb_build_object('quote',t.q1_number,'discount',1),gen_random_uuid())->>'code'='ACCESS_DENIED'
    and public.zt_assistant_reference(t.company_a,'quote',t.q1)->>'code'='ACCESS_DENIED');
end $$;
reset role;

do $$
declare failures text;
begin
  select string_agg(name||': '||coalesce(detail,''),E'\n' order by name) into failures from zt_w2_results where not ok;
  if failures is not null then raise exception 'ASSISTANT_0095_FAILED: %',failures; end if;
  if (select count(*) from zt_w2_results)<>45 then raise exception 'ASSISTANT_0095_INCOMPLETE: % checks',(select count(*) from zt_w2_results); end if;
end $$;
select 'ASSISTANT_0095_WAVE2' as test,count(*) as checks,bool_and(ok) as all_ok from zt_w2_results;
rollback;
