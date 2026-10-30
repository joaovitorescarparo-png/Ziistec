-- ZiisTec Assistant Universal Owner V1 (0097) — escritas do proprietário pelas RPCs canônicas:
-- gerar OS de orçamento aprovado, ajustar estoque, garantia manual e pós-venda. Prévia sem escrita,
-- confirmação única, revalidação do estado, papéis, tenant, assinatura e auditoria.
-- Destino: SOMENTE CI descartável ou staging/homologação. Tudo termina em ROLLBACK.

begin;

create temp table zt_w4 (
  owner_a uuid, tech_a uuid, owner_b uuid, company_a uuid, company_b uuid,
  carmelo uuid, carmelo2 uuid, mauro uuid, cam uuid, dome uuid, svc uuid,
  q1 uuid, q1_number text, q2 uuid, q2_number text, q3 uuid, q3_number text, wo uuid, f1 uuid, f2 uuid, f3 uuid,
  req uuid, plan jsonb
) on commit drop;
create temp table zt_w4_results (name text primary key, ok boolean not null, detail text) on commit drop;
grant select, insert, update on zt_w4, zt_w4_results to authenticated, anon;

create function pg_temp.record_result(p_name text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into zt_w4_results(name,ok,detail) values(p_name,coalesce(p_ok,false),left(p_detail,600));
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

with candidates as (
  select u.id, row_number() over (order by u.id) as rn
  from auth.users u left join public.profiles p on p.id=u.id
  where not coalesce(p.is_platform_admin,false)
)
insert into zt_w4(owner_a,tech_a,owner_b,company_a,company_b,carmelo,carmelo2,mauro,cam,dome,svc,f1,f2,f3)
select (select id from candidates where rn=1),(select id from candidates where rn=2),(select id from candidates where rn=3),
       gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),
       gen_random_uuid(),gen_random_uuid(),gen_random_uuid();

do $$
begin
  if exists(select 1 from zt_w4 where owner_a is null or tech_a is null or owner_b is null) then
    raise exception 'OWNER_V1_WRITES_NEEDS_THREE_AUTH_USERS';
  end if;
end $$;

select set_config('request.jwt.claim.sub',(select owner_a::text from zt_w4),true);
insert into public.companies(id,name,has_team)
select company_a,'__W4_A__',true from zt_w4 union all select company_b,'__W4_B__',true from zt_w4;
insert into public.subscriptions(company_id,status,current_period_start,current_period_end)
select company_a,'trial'::public.zt_sub_status,current_date,current_date+14 from zt_w4
union all select company_b,'trial'::public.zt_sub_status,current_date,current_date+14 from zt_w4
on conflict (company_id) do update set status=excluded.status,
  current_period_start=excluded.current_period_start,current_period_end=excluded.current_period_end;
insert into public.company_members(company_id,user_id,role,status)
select company_a,owner_a,'owner'::public.zt_role,'active'::public.zt_member_status from zt_w4
union all select company_a,tech_a,'technician'::public.zt_role,'active'::public.zt_member_status from zt_w4
union all select company_b,owner_b,'owner'::public.zt_role,'active'::public.zt_member_status from zt_w4;
insert into public.clients(id,company_id,name,phone,address)
select carmelo,company_a,'Residencial Carmelo','1130000201','Rua do Carmelo, 1' from zt_w4
union all select carmelo2,company_a,'Residencial Carmelo II','1130000202','Rua do Carmelo, 2' from zt_w4
union all select mauro,company_a,'Mauro Silva','1130000203','Rua A, 3' from zt_w4;
insert into public.products(id,company_id,name,brand,model,unit,cost,price,active,track_stock,stock_qty,low_stock_threshold)
select cam,company_a,'Câmera Wi-Fi Intelbras','Intelbras','IM5','unidade',120,250,true,true,4,2 from zt_w4
union all select dome,company_a,'Câmera Dome Hikvision','Hikvision','DS2','unidade',140,300,true,true,10,3 from zt_w4;
insert into public.services(id,company_id,name,unit,price,cost,active)
select svc,company_a,'Instalação de câmera','serviço',150,50,true from zt_w4;
insert into public.post_sale_followups(id,company_id,client_id,description,due_on,status,kind,source_key)
select f1,company_a,carmelo,'Conferir as câmeras W4',current_date+2,'pending','check_in','w4-f1' from zt_w4
union all select f2,company_a,mauro,'Ligar para o Mauro W4',current_date+1,'pending','check_in','w4-f2' from zt_w4
union all select f3,company_a,mauro,'Pesquisa de satisfação W4',current_date+5,'pending','satisfaction','w4-f3' from zt_w4;

-- Orçamentos pelo caminho do próprio Assistente; aprovação ajustada fora do comportamento testado.
set local role authenticated;
do $$
declare t zt_w4%rowtype; r jsonb;
begin
  select * into t from zt_w4;
  for i in 1..3 loop
    r:=pg_temp.run(t.company_a,'create_quote_draft',jsonb_build_object('client','Residencial Carmelo','items',jsonb_build_array(
      jsonb_build_object('kind','product','name','câmera intelbras','quantity',2),jsonb_build_object('kind','service','name','instalação','quantity',1))));
    if i=1 then update zt_w4 set q1=(r#>>'{exec,result,id}')::uuid, q1_number=r#>>'{exec,result,number}';
    elsif i=2 then update zt_w4 set q2=(r#>>'{exec,result,id}')::uuid, q2_number=r#>>'{exec,result,number}';
    else update zt_w4 set q3=(r#>>'{exec,result,id}')::uuid, q3_number=r#>>'{exec,result,number}'; end if;
  end loop;
end $$;
reset role;
update public.quotes set status='approved' where id in ((select q1 from zt_w4),(select q2 from zt_w4));

-- ------------------------------------------------------------------ catálogo/ACL
do $$
begin
  perform pg_temp.record_result('00_helpers_privados',
    not has_function_privilege('authenticated','zt_private.assistant_owner_write_apply(uuid,text,jsonb)','EXECUTE')
    and not has_function_privilege('authenticated','zt_private.assistant_owner_write_plan(uuid,text,jsonb)','EXECUTE')
    and not has_function_privilege('authenticated','zt_private.assistant_validate_owner_write(text,jsonb)','EXECUTE')
    and not (select prosecdef from pg_proc where oid=to_regprocedure('zt_private.assistant_owner_write_apply(uuid,text,jsonb)'))
    and lower((select prosrc from pg_proc where oid=to_regprocedure('public.zt_assistant_execute(uuid,uuid,text)'))) like '%assistant_owner_write_apply%');
end $$;

-- ------------------------------------------------------------------ OS do orçamento aprovado
set local role authenticated;
do $$
declare t zt_w4%rowtype; r jsonb; n integer; v_req uuid:=gen_random_uuid(); d date:=(now() at time zone 'America/Sao_Paulo')::date;
begin
  select * into t from zt_w4;
  n:=(select count(*) from public.work_orders where company_id=t.company_a);
  r:=public.zt_assistant_plan(t.company_a,'owner_convert_quote_to_work_order',jsonb_build_object('quote',t.q1_number),v_req);
  perform pg_temp.record_result('01_gerar_os_previa_sem_escrita', r->>'confirmationRequired'='true'
    and r->'preview' @> jsonb_build_array(jsonb_build_object('label','Orçamento','value',t.q1_number),jsonb_build_object('label','Total aprovado','value','R$ 650,00'))
    and (select count(*) from public.work_orders where company_id=t.company_a)=n
    and (r->'preview')::text not like '%'||t.q1::text||'%', r::text);
  update zt_w4 set req=v_req, plan=r;
end $$;

do $$
declare t zt_w4%rowtype; r jsonb; again jsonb; n integer;
begin
  select * into t from zt_w4;
  n:=(select count(*) from public.work_orders where company_id=t.company_a);
  r:=public.zt_assistant_execute(t.company_a,t.req,t.plan->>'previewHash');
  again:=public.zt_assistant_execute(t.company_a,t.req,t.plan->>'previewHash');
  update zt_w4 set wo=(r#>>'{result,id}')::uuid;
  perform pg_temp.record_result('02_gerar_os_uma_vez', r#>>'{result,entityType}'='work_order' and r=again
    and (select count(*) from public.work_orders where company_id=t.company_a)=n+1
    and exists(select 1 from public.work_orders w where w.id=(r#>>'{result,id}')::uuid and w.quote_id=t.q1 and w.status='unscheduled'), r::text);
  r:=public.zt_assistant_plan(t.company_a,'owner_convert_quote_to_work_order',jsonb_build_object('quote',t.q1_number),gen_random_uuid());
  perform pg_temp.record_result('03_orcamento_ja_convertido_pergunta', r->>'question' like '%já originou a OS-%' and not r ? 'previewHash', r::text);
  r:=public.zt_assistant_plan(t.company_a,'owner_convert_quote_to_work_order',jsonb_build_object('quote',t.q3_number),gen_random_uuid());
  perform pg_temp.record_result('04_orcamento_nao_aprovado_pergunta', r->>'question' like '%A OS só é gerada de orçamento aprovado%' and not r ? 'previewHash', r::text);
  r:=pg_temp.run(t.company_a,'owner_convert_quote_to_work_order',jsonb_build_object('quote',t.q2_number,'date',((now() at time zone 'America/Sao_Paulo')::date+3)::text,'time','09:30'));
  perform pg_temp.record_result('05_gerar_os_agendada', exists(select 1 from public.work_orders w where w.id=(r#>>'{exec,result,id}')::uuid
    and w.status='scheduled' and w.scheduled_date=(now() at time zone 'America/Sao_Paulo')::date+3 and w.scheduled_time='09:30'), r::text);
end $$;

-- ------------------------------------------------------------------ estoque
do $$
declare t zt_w4%rowtype; r jsonb; v_req uuid:=gen_random_uuid();
begin
  select * into t from zt_w4;
  r:=pg_temp.run(t.company_a,'owner_adjust_stock',jsonb_build_object('product','câmera dome','quantity',3,'direction','out','notes','Perda W4'));
  perform pg_temp.record_result('06_ajuste_de_estoque_uma_vez', r#>'{plan,preview}' @> '[{"label":"Estoque atual","value":"10 unidade"},{"label":"Estoque após o ajuste","value":"7 unidade"}]'::jsonb
    and r->'exec'=r->'again' and (select stock_qty from public.products where id=t.dome)=7
    and (select count(*) from public.inventory_movements where company_id=t.company_a and product_id=t.dome and kind='adjustment' and quantity_delta=-3)=1, r::text);
  r:=public.zt_assistant_plan(t.company_a,'owner_adjust_stock',jsonb_build_object('product','câmera dome','quantity',100,'direction','out'),gen_random_uuid());
  perform pg_temp.record_result('07_estoque_insuficiente_pergunta', r->>'question' like 'Estoque insuficiente: Câmera Dome Hikvision tem 7 unidade%', r::text);
  r:=public.zt_assistant_plan(t.company_a,'owner_adjust_stock',jsonb_build_object('product','câmera intelbras','quantity',5,'direction','in'),v_req);
  update zt_w4 set req=v_req, plan=r;
end $$;
reset role;
update public.products set stock_qty=stock_qty+1 where id=(select cam from zt_w4);
set local role authenticated;
do $$
declare t zt_w4%rowtype; r jsonb;
begin
  select * into t from zt_w4;
  r:=public.zt_assistant_execute(t.company_a,t.req,t.plan->>'previewHash');
  perform pg_temp.record_result('08_estoque_mudou_depois_da_previa_nao_grava', r ? 'error' and (select stock_qty from public.products where id=t.cam)=5
    and not exists(select 1 from public.inventory_movements where company_id=t.company_a and product_id=t.cam), r::text);
end $$;

-- ------------------------------------------------------------------ garantia manual e pós-venda
do $$
declare t zt_w4%rowtype; r jsonb; d date:=(now() at time zone 'America/Sao_Paulo')::date;
begin
  select * into t from zt_w4;
  r:=pg_temp.run(t.company_a,'owner_create_warranty',jsonb_build_object('client','Residencial Carmelo','kind','service','description','Garantia da instalação de câmeras W4','months',12));
  perform pg_temp.record_result('09_garantia_manual_12_meses', r#>>'{exec,result,entityType}'='client' and r->'exec'=r->'again'
    and (select count(*) from public.warranties where company_id=t.company_a and client_id=t.carmelo and description='Garantia da instalação de câmeras W4'
      and starts_on=d and ends_on=(d+interval '12 months')::date and source='manual' and deleted_at is null)=1, r::text);
  r:=public.zt_assistant_plan(t.company_a,'owner_create_warranty',jsonb_build_object('client','Carmelo','kind','product','description','x','months',6),gen_random_uuid());
  perform pg_temp.record_result('10_garantia_cliente_ambiguo_opcoes', jsonb_array_length(r->'options')=2 and r->>'action'='owner_create_warranty'
    and r#>>'{draft,client}'='Carmelo' and not r ? 'previewHash', r::text);
  r:=pg_temp.run(t.company_a,'owner_update_post_sale',jsonb_build_object('client','Residencial Carmelo','status','done','note','Tudo certo W4'));
  perform pg_temp.record_result('11_pos_venda_concluido_uma_vez', r#>>'{exec,result,entityType}'='client' and r->'exec'=r->'again'
    and exists(select 1 from public.post_sale_followups where id=t.f1 and status='done' and completed_at is not null and note='Tudo certo W4'), r::text);
  r:=public.zt_assistant_plan(t.company_a,'owner_update_post_sale',jsonb_build_object('client','Mauro Silva','status','dismissed'),gen_random_uuid());
  perform pg_temp.record_result('12_pos_venda_varios_pergunta_data', r->>'question' like 'Mauro Silva tem mais de um pós-venda pendente%Informe a data.' and not r ? 'previewHash', r::text);
  r:=pg_temp.run(t.company_a,'owner_update_post_sale',jsonb_build_object('client','Mauro Silva','status','dismissed','date',(current_date+5)::text));
  perform pg_temp.record_result('13_pos_venda_pela_data', exists(select 1 from public.post_sale_followups where id=t.f3 and status='dismissed')
    and exists(select 1 from public.post_sale_followups where id=t.f2 and status='pending'), r::text);
end $$;
reset role;

-- ------------------------------------------------------------------ técnico, outro tenant, assinatura
select set_config('request.jwt.claim.sub',(select tech_a::text from zt_w4),true);
set local role authenticated;
do $$
declare t zt_w4%rowtype;
begin
  select * into t from zt_w4;
  perform pg_temp.record_result('14_tecnico_negado_nas_escritas',
    public.zt_assistant_plan(t.company_a,'owner_convert_quote_to_work_order',jsonb_build_object('quote',t.q3_number),gen_random_uuid())->>'code'='ACCESS_DENIED'
    and public.zt_assistant_plan(t.company_a,'owner_adjust_stock',jsonb_build_object('product','câmera dome','quantity',1,'direction','in'),gen_random_uuid())->>'code'='ACCESS_DENIED'
    and public.zt_assistant_plan(t.company_a,'owner_create_warranty',jsonb_build_object('client','Mauro Silva','kind','service','description','x','months',1),gen_random_uuid())->>'code'='ACCESS_DENIED'
    and public.zt_assistant_plan(t.company_a,'owner_update_post_sale',jsonb_build_object('client','Mauro Silva','status','done'),gen_random_uuid())->>'code'='ACCESS_DENIED');
end $$;
reset role;

select set_config('request.jwt.claim.sub',(select owner_b::text from zt_w4),true);
set local role authenticated;
do $$
declare t zt_w4%rowtype; r jsonb;
begin
  select * into t from zt_w4;
  r:=public.zt_assistant_plan(t.company_b,'owner_convert_quote_to_work_order',jsonb_build_object('quote',t.q3_number),gen_random_uuid());
  perform pg_temp.record_result('15_outro_tenant_negado',
    public.zt_assistant_plan(t.company_a,'owner_adjust_stock',jsonb_build_object('product','câmera dome','quantity',1,'direction','in'),gen_random_uuid())->>'code'='ACCESS_DENIED'
    and r->>'question' like 'Não encontrei o orçamento%'
    and public.zt_assistant_plan(t.company_b,'owner_create_warranty',jsonb_build_object('client','Residencial Carmelo','kind','service','description','x','months',1),gen_random_uuid())->>'question' like 'Não encontrei o cliente%', r::text);
end $$;
reset role;

do $$
begin
  perform pg_temp.record_result('16_auditoria_das_escritas', (select count(distinct a.action) from public.assistant_action_audit a
    where a.company_id=(select company_a from zt_w4) and a.status='succeeded'
      and a.action in ('owner_convert_quote_to_work_order','owner_adjust_stock','owner_create_warranty','owner_update_post_sale'))=4);
end $$;

update public.subscriptions set status='canceled' where company_id=(select company_a from zt_w4);
select set_config('request.jwt.claim.sub',(select owner_a::text from zt_w4),true);
set local role authenticated;
do $$
declare t zt_w4%rowtype;
begin
  select * into t from zt_w4;
  perform pg_temp.record_result('17_assinatura_invalida_negada',
    public.zt_assistant_plan(t.company_a,'owner_adjust_stock',jsonb_build_object('product','câmera dome','quantity',1,'direction','in'),gen_random_uuid())->>'code'='ACCESS_DENIED');
end $$;
reset role;

do $$
declare failures text;
begin
  select string_agg(name||': '||coalesce(detail,''),E'\n' order by name) into failures from zt_w4_results where not ok;
  if failures is not null then raise exception 'ASSISTANT_0097_FAILED: %',failures; end if;
  if (select count(*) from zt_w4_results)<>18 then raise exception 'ASSISTANT_0097_INCOMPLETE: % checks',(select count(*) from zt_w4_results); end if;
end $$;
select 'ASSISTANT_0097_OWNER_WRITES' as test,count(*) as checks,bool_and(ok) as all_ok from zt_w4_results;
rollback;
