-- ZiisTec Blocos 3/4 (0097) — Comprovante de Serviço: somente proprietário, OS concluída,
-- "Documento não fiscal", emissão idempotente, reemissão versionada e snapshot congelado.
-- Destino: SOMENTE CI descartável ou staging/homologação. Tudo termina em ROLLBACK.

begin;

-- O relatório de atendimento nasce no fim da transação da conclusão; aqui ele precisa existir já.
set constraints zt_service_report_after_done immediate;

create temp table zt_sr (
  owner_a uuid, tech_a uuid, owner_b uuid, tech_x uuid,
  company_a uuid, company_b uuid, client_a uuid,
  wo_done uuid, wo_open uuid, wo_pending uuid, wo_warranty uuid,
  req_1 uuid, req_reissue uuid,
  receipt_1 jsonb, receipt_2 jsonb, receipt_warranty jsonb,
  finance_before integer
) on commit drop;
create temp table zt_sr_results (name text primary key, ok boolean not null, detail text) on commit drop;
grant select, insert, update on zt_sr, zt_sr_results to authenticated, anon;

create function pg_temp.sr_check(p_name text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into zt_sr_results(name,ok,detail) values(p_name,coalesce(p_ok,false),left(p_detail,500));
$$;

-- Devolve o SQLSTATE de uma emissão negada (ou 'ok').
create function pg_temp.sr_issue_state(p_wo uuid, p_request uuid, p_notes text default null, p_reason text default null)
returns text language plpgsql as $$
begin
  perform public.zt_issue_service_receipt(p_wo,p_request,p_notes,p_reason);
  return 'ok';
exception when others then
  return sqlstate;
end $$;

-- ---------------------------------------------------------------- catálogo/ACL
do $$
declare v_oid oid:=to_regprocedure('public.zt_issue_service_receipt(uuid,uuid,text,text)'); v_proc pg_proc%rowtype;
begin
  if v_oid is null then raise exception 'SR_FUNCTION_MISSING'; end if;
  select * into strict v_proc from pg_proc where oid=v_oid;
  perform pg_temp.sr_check('catalogo_security_definer',v_proc.prosecdef,null);
  perform pg_temp.sr_check('catalogo_search_path_vazio',exists(select 1 from unnest(coalesce(v_proc.proconfig,array[]::text[])) s
    where s in ('search_path=','search_path=""')),array_to_string(v_proc.proconfig,','));
  perform pg_temp.sr_check('catalogo_sem_execute_public',not exists(select 1 from aclexplode(coalesce(v_proc.proacl,acldefault('f',v_proc.proowner))) a
    where a.grantee=0 and a.privilege_type='EXECUTE'),null);
  perform pg_temp.sr_check('catalogo_anon_sem_execute',not has_function_privilege('anon',v_oid,'EXECUTE'),null);
  perform pg_temp.sr_check('catalogo_authenticated_execute',has_function_privilege('authenticated',v_oid,'EXECUTE'),null);
  perform pg_temp.sr_check('tabela_rls_ativa',(select c.relrowsecurity from pg_class c where c.oid='public.service_receipts'::regclass),null);
  perform pg_temp.sr_check('tabela_sem_escrita_direta',
    not has_table_privilege('authenticated','public.service_receipts','INSERT')
    and not has_table_privilege('authenticated','public.service_receipts','UPDATE')
    and not has_table_privilege('authenticated','public.service_receipts','DELETE')
    and not has_table_privilege('anon','public.service_receipts','SELECT'),null);
end $$;

-- ---------------------------------------------------------------- fixtures portáveis
with candidates as (
  select u.id, row_number() over (order by u.id) as rn
  from auth.users u join public.profiles p on p.id=u.id
  where not coalesce(p.is_platform_admin,false)
)
insert into zt_sr(owner_a,tech_a,owner_b,tech_x,company_a,company_b,client_a,req_1,req_reissue)
select (select id from candidates where rn=1),(select id from candidates where rn=2),
       (select id from candidates where rn=3),(select id from candidates where rn=4),
       gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid();

do $$
begin
  if exists(select 1 from zt_sr where owner_a is null or tech_a is null or owner_b is null or tech_x is null) then
    raise exception 'SR_NEEDS_FOUR_AUTH_USERS';
  end if;
end $$;

-- O guard de assinatura das tabelas operacionais exige uma identidade autenticada.
select set_config('request.jwt.claim.sub',(select owner_a::text from zt_sr),true);

insert into public.companies(id,name,has_team)
select company_a,'__SR_A__',true from zt_sr
union all select company_b,'__SR_B__',true from zt_sr;
insert into public.subscriptions(company_id,status,current_period_start,current_period_end)
select company_a,'trial'::public.zt_sub_status,current_date,current_date+14 from zt_sr
union all select company_b,'trial'::public.zt_sub_status,current_date,current_date+14 from zt_sr
on conflict (company_id) do update set status=excluded.status,
  current_period_start=excluded.current_period_start,current_period_end=excluded.current_period_end;
insert into public.company_members(company_id,user_id,role,status)
select company_a,owner_a,'owner'::public.zt_role,'active'::public.zt_member_status from zt_sr
union all select company_a,tech_a,'technician'::public.zt_role,'active'::public.zt_member_status from zt_sr
union all select company_a,tech_x,'technician'::public.zt_role,'active'::public.zt_member_status from zt_sr
union all select company_b,owner_b,'owner'::public.zt_role,'active'::public.zt_member_status from zt_sr;
insert into public.clients(id,company_id,name,address)
select client_a,company_a,'__SR_CLIENT_ORIGINAL__','Rua Comprovante, 10' from zt_sr;

set local role authenticated;
do $$
declare t zt_sr%rowtype;
begin
  select * into t from zt_sr;
  update zt_sr set
    wo_done=public.zt_save_work_order_idempotent(t.company_a,null,gen_random_uuid(),
      jsonb_build_object('client_id',t.client_a,'assigned_to',t.tech_a,'status','in_progress',
        'request','__SR_WO_DONE__','service_place','Bloco A · Apto 12'),
      jsonb_build_array(jsonb_build_object('kind','free','name','Serviço comprovante','quantity',2,'unit_price',150))),
    wo_open=public.zt_save_work_order_idempotent(t.company_a,null,gen_random_uuid(),
      jsonb_build_object('client_id',t.client_a,'assigned_to',t.tech_a,'status','in_progress','request','__SR_WO_OPEN__'),
      jsonb_build_array(jsonb_build_object('kind','free','name','Serviço aberto','quantity',1,'unit_price',90))),
    wo_pending=public.zt_save_work_order_idempotent(t.company_a,null,gen_random_uuid(),
      jsonb_build_object('client_id',t.client_a,'assigned_to',t.owner_a,'status','in_progress','request','__SR_WO_PENDING__'),
      jsonb_build_array(jsonb_build_object('kind','free','name','Serviço base','quantity',1,'unit_price',50),
        jsonb_build_object('kind','free','name','Adicional sem preço','quantity',1,'unit_price',0,'is_extra',true,'price_pending',true))),
    wo_warranty=public.zt_save_work_order_idempotent(t.company_a,null,gen_random_uuid(),
      jsonb_build_object('client_id',t.client_a,'assigned_to',t.owner_a,'status','in_progress','request','__SR_WO_WARRANTY__',
        'is_warranty_visit',true),
      jsonb_build_array(jsonb_build_object('kind','free','name','Revisão em garantia','quantity',1,'unit_price',100)));
end $$;
reset role;

-- Técnico atribuído conclui com relato; proprietário conclui as demais.
select set_config('request.jwt.claim.sub',(select tech_a::text from zt_sr),true);
set local role authenticated;
select public.zt_finalize_work_order_with_warranty_overrides((select wo_done from zt_sr),
  '__SR_RELATO__ troca concluída e testada',null,null,7,'[]'::jsonb,'[]'::jsonb,null);
reset role;
select set_config('request.jwt.claim.sub',(select owner_a::text from zt_sr),true);
set local role authenticated;
select public.zt_finalize_work_order_with_warranty_overrides((select wo_pending from zt_sr),null,null,null,7,'[]'::jsonb,'[]'::jsonb,null);
select public.zt_finalize_work_order_with_warranty_overrides((select wo_warranty from zt_sr),null,null,null,7,'[]'::jsonb,'[]'::jsonb,null);
reset role;

update zt_sr t set finance_before=(select count(*) from public.financial_entries f where f.company_id=t.company_a);

do $$
declare t zt_sr%rowtype;
begin
  select * into t from zt_sr;
  if (select status::text from public.work_orders where id=t.wo_done)<>'done'
     or (select status::text from public.work_orders where id=t.wo_pending)<>'done'
     or not (select pending_pricing from public.work_orders where id=t.wo_pending)
     or (select status::text from public.work_orders where id=t.wo_warranty)<>'done' then
    raise exception 'SR_FIXTURE_FINALIZATION_FAILED';
  end if;
end $$;

-- ---------------------------------------------------------------- negações antes da emissão
-- Técnico atribuído não emite; técnico não atribuído também não.
select set_config('request.jwt.claim.sub',(select tech_a::text from zt_sr),true);
set local role authenticated;
do $$
declare t zt_sr%rowtype; s text;
begin
  select * into t from zt_sr;
  s:=pg_temp.sr_issue_state(t.wo_done,gen_random_uuid());
  perform pg_temp.sr_check('tecnico_atribuido_nao_emite',s='42501',s);
end $$;
reset role;
select set_config('request.jwt.claim.sub',(select tech_x::text from zt_sr),true);
set local role authenticated;
do $$
declare t zt_sr%rowtype; s text;
begin
  select * into t from zt_sr;
  s:=pg_temp.sr_issue_state(t.wo_done,gen_random_uuid());
  perform pg_temp.sr_check('tecnico_nao_atribuido_nao_emite',s='42501',s);
end $$;
reset role;

-- Proprietário de outra empresa não emite.
select set_config('request.jwt.claim.sub',(select owner_b::text from zt_sr),true);
set local role authenticated;
do $$
declare t zt_sr%rowtype; s text;
begin
  select * into t from zt_sr;
  s:=pg_temp.sr_issue_state(t.wo_done,gen_random_uuid());
  perform pg_temp.sr_check('owner_outra_empresa_nao_emite',s='42501',s);
end $$;
reset role;

-- ---------------------------------------------------------------- proprietário
select set_config('request.jwt.claim.sub',(select owner_a::text from zt_sr),true);
set local role authenticated;
do $$
declare t zt_sr%rowtype; s text; r jsonb; v jsonb; v_report uuid;
begin
  select * into t from zt_sr;

  s:=pg_temp.sr_issue_state(t.wo_open,gen_random_uuid());
  perform pg_temp.sr_check('os_aberta_bloqueada',s='23514',s);
  s:=pg_temp.sr_issue_state(t.wo_pending,gen_random_uuid());
  perform pg_temp.sr_check('precificacao_pendente_bloqueada',s='23514',s);
  s:=pg_temp.sr_issue_state(t.wo_done,null);
  perform pg_temp.sr_check('request_obrigatorio',s='22023',s);
  s:=pg_temp.sr_issue_state(t.wo_done,gen_random_uuid(),repeat('x',2001));
  perform pg_temp.sr_check('observacao_longa_bloqueada',s='22023',s);
  s:=pg_temp.sr_issue_state(t.wo_warranty,gen_random_uuid(),null,'Reemitir sem existir');
  perform pg_temp.sr_check('motivo_sem_comprovante_anterior',s='22023',s);

  r:=public.zt_issue_service_receipt(t.wo_done,t.req_1,'Garantia de 90 dias no serviço');
  update zt_sr set receipt_1=r;
  v:=r->'snapshot';
  select id into v_report from public.work_order_reports
   where work_order_id=t.wo_done and entry_type='service_report' and is_active;

  perform pg_temp.sr_check('emissao_versao_1_ativa',(r->>'version')::int=1 and (r->>'is_active')::boolean
    and r->>'reissue_reason' is null and (r->>'issued_by')::uuid=t.owner_a,r::text);
  perform pg_temp.sr_check('emissao_numero_cs',r->>'number' ~ '^CS-[0-9]{4,}$',r->>'number');
  perform pg_temp.sr_check('documento_nao_fiscal',v#>>'{document,notice}'='Documento não fiscal'
    and v#>>'{document,title}'='Comprovante de Serviço' and v#>>'{document,kind}'='service_receipt',v->>'document');
  perform pg_temp.sr_check('snapshot_vem_do_relatorio',(v#>>'{source_service_report,id}')::uuid=v_report
    and v#>>'{client,name}'='__SR_CLIENT_ORIGINAL__'
    and v#>>'{location,service_place}'='Bloco A · Apto 12'
    and v#>>'{technical_report,body}' like '__SR_RELATO__%'
    and jsonb_array_length(v->'items')=1,v::text);
  perform pg_temp.sr_check('financeiro_os_direta',(v#>>'{financial,total}')::numeric=300
    and (v#>>'{financial,subtotal}')::numeric=300 and (v#>>'{financial,discount}')::numeric=0
    and (v#>>'{financial,surcharge}')::numeric=0 and not (v#>>'{financial,quote_based}')::boolean
    and v#>>'{financial,status}'='receivable',v->>'financial');
  perform pg_temp.sr_check('sem_bloco_payment_do_relatorio',not v ? 'payment' and not v ? 'schema_version'
    and (v->>'receipt_schema_version')::int=1,null);
  perform pg_temp.sr_check('sem_custo_no_comprovante',v::text !~* 'unit_cost|extra_cost|margin|supplier|fornecedor',null);
  perform pg_temp.sr_check('observacoes_gravadas',r->>'notes'='Garantia de 90 dias no serviço'
    and v->>'notes'='Garantia de 90 dias no serviço',null);

  r:=public.zt_issue_service_receipt(t.wo_done,t.req_1,'Garantia de 90 dias no serviço');
  perform pg_temp.sr_check('retry_mesmo_request_mesma_emissao',r->>'id'=(select receipt_1->>'id' from zt_sr),r->>'id');
  r:=public.zt_issue_service_receipt(t.wo_done,gen_random_uuid());
  perform pg_temp.sr_check('novo_request_sem_motivo_reusa_ativo',r->>'id'=(select receipt_1->>'id' from zt_sr),r->>'id');
  perform pg_temp.sr_check('um_unico_comprovante',(select count(*) from public.service_receipts where work_order_id=t.wo_done)=1,null);

  s:=pg_temp.sr_issue_state(t.wo_warranty,t.req_1);
  perform pg_temp.sr_check('request_de_outra_os_rejeitado',s='23505',s);
  perform pg_temp.sr_check('emissao_sem_efeito_financeiro',
    (select count(*) from public.financial_entries f where f.company_id=t.company_a)=t.finance_before,null);
end $$;
reset role;

-- Técnico não lê comprovante emitido nem pela tabela.
select set_config('request.jwt.claim.sub',(select tech_a::text from zt_sr),true);
set local role authenticated;
do $$
declare t zt_sr%rowtype; v int;
begin
  select * into t from zt_sr;
  select count(*) into v from public.service_receipts where company_id=t.company_a;
  perform pg_temp.sr_check('tecnico_nao_le_comprovantes',v=0,v::text);
end $$;
reset role;
select set_config('request.jwt.claim.sub',(select owner_b::text from zt_sr),true);
set local role authenticated;
do $$
declare t zt_sr%rowtype; v int;
begin
  select * into t from zt_sr;
  select count(*) into v from public.service_receipts where company_id=t.company_a;
  perform pg_temp.sr_check('outra_empresa_nao_le_comprovantes',v=0,v::text);
end $$;
reset role;

-- Alterações posteriores não mudam a emissão; a reemissão registra o pagamento.
select set_config('request.jwt.claim.sub',(select owner_a::text from zt_sr),true);
set local role authenticated;
update public.clients c set name='__SR_CLIENT_ALTERADO__' from zt_sr t where c.id=t.client_a;
select public.zt_set_financial_paid((select billing_entry_id from public.work_orders where id=(select wo_done from zt_sr)),true,'pix');
do $$
declare t zt_sr%rowtype; s text; r jsonb; v_old public.service_receipts%rowtype; d text;
begin
  select * into t from zt_sr;
  select * into v_old from public.service_receipts where id=(t.receipt_1->>'id')::uuid;
  perform pg_temp.sr_check('snapshot_congelado_apos_edicoes',v_old.snapshot#>>'{financial,status}'='receivable'
    and v_old.snapshot#>>'{client,name}'='__SR_CLIENT_ORIGINAL__',v_old.snapshot->>'financial');

  begin
    insert into public.service_receipts(company_id,work_order_id,client_id,number,version,snapshot,request_id,issued_by)
    values(t.company_a,t.wo_done,t.client_a,'CS-9999',1,'{}'::jsonb,gen_random_uuid(),t.owner_a);
    d:='inserido';
  exception when insufficient_privilege then d:='42501';
  end;
  perform pg_temp.sr_check('insert_direto_negado',d='42501',d);
  begin
    update public.service_receipts set snapshot='{}'::jsonb where id=v_old.id;
    d:='atualizado';
  exception when insufficient_privilege then d:='42501';
  end;
  perform pg_temp.sr_check('update_direto_negado',d='42501',d);

  s:=pg_temp.sr_issue_state(t.wo_done,gen_random_uuid(),null,repeat('m',501));
  perform pg_temp.sr_check('motivo_longo_bloqueado',s='22023',s);

  r:=public.zt_issue_service_receipt(t.wo_done,t.req_reissue,'Pagamento confirmado','Pagamento recebido via PIX');
  update zt_sr set receipt_2=r;
  perform pg_temp.sr_check('reemissao_versao_2_mesmo_numero',(r->>'version')::int=2
    and r->>'number'=t.receipt_1->>'number' and r->>'reissue_reason'='Pagamento recebido via PIX'
    and r#>>'{snapshot,document,reissue_reason}'='Pagamento recebido via PIX',r::text);
  perform pg_temp.sr_check('reemissao_registra_pagamento',r#>>'{snapshot,financial,status}'='paid'
    and r#>>'{snapshot,financial,payment_method}'='pix',r#>>'{snapshot,financial}');
  select * into v_old from public.service_receipts where id=(t.receipt_1->>'id')::uuid;
  perform pg_temp.sr_check('versao_anterior_desativada',not v_old.is_active and v_old.superseded_at is not null
    and v_old.snapshot#>>'{financial,status}'='receivable',null);
  perform pg_temp.sr_check('um_ativo_por_os',(select count(*) from public.service_receipts
    where work_order_id=t.wo_done and is_active)=1,null);

  r:=public.zt_issue_service_receipt(t.wo_done,t.req_reissue,'Pagamento confirmado','Pagamento recebido via PIX');
  perform pg_temp.sr_check('retry_da_reemissao_idempotente',r->>'id'=(select receipt_2->>'id' from zt_sr)
    and (select count(*) from public.service_receipts where work_order_id=t.wo_done)=2,r->>'id');

  r:=public.zt_issue_service_receipt(t.wo_warranty,gen_random_uuid());
  update zt_sr set receipt_warranty=r;
  perform pg_temp.sr_check('garantia_sem_cobranca',r#>>'{snapshot,financial,status}'='warranty'
    and (r#>>'{snapshot,financial,total}')::numeric=0 and (r#>>'{snapshot,financial,subtotal}')::numeric=0,
    r#>>'{snapshot,financial}');
  perform pg_temp.sr_check('numeracao_sequencial_por_empresa',
    substring(r->>'number' from 4)::int=substring(t.receipt_1->>'number' from 4)::int+1,
    (r->>'number')||' / '||(t.receipt_1->>'number'));
  perform pg_temp.sr_check('owner_le_proprios_comprovantes',
    (select count(*) from public.service_receipts where company_id=t.company_a)=3,null);
end $$;
reset role;

-- Assinatura inativa bloqueia nova emissão/reemissão.
update public.subscriptions set status='canceled' where company_id=(select company_a from zt_sr);
select set_config('request.jwt.claim.sub',(select owner_a::text from zt_sr),true);
set local role authenticated;
do $$
declare t zt_sr%rowtype; s text;
begin
  select * into t from zt_sr;
  s:=pg_temp.sr_issue_state(t.wo_warranty,gen_random_uuid(),null,'Correção de observação');
  perform pg_temp.sr_check('assinatura_inativa_bloqueia',s='42501',s);
end $$;
reset role;

-- Anônimo não executa.
set local role anon;
do $$
declare s text;
begin
  s:=pg_temp.sr_issue_state(gen_random_uuid(),gen_random_uuid());
  perform pg_temp.sr_check('anon_nao_executa',s='42501',s);
end $$;
reset role;

do $$
declare v_failures text;
begin
  select string_agg(name||' => '||coalesce(detail,''),E'\n' order by name) into v_failures
  from zt_sr_results where not ok;
  if v_failures is not null then raise exception 'SERVICE_RECEIPT_REGRESSION_FAILED%', E'\n'||v_failures; end if;
  if (select count(*) from zt_sr_results)<>44 then
    raise exception 'SERVICE_RECEIPT_REGRESSION_INCOMPLETE: % checks', (select count(*) from zt_sr_results);
  end if;
end $$;

select 'BLOCKS34_0097_SERVICE_RECEIPTS' as test, count(*) as checks, bool_and(ok) as all_ok from zt_sr_results;

rollback;
