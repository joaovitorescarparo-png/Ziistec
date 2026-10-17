-- ZiisTec Bloco 5 (0105) — exposição do técnico e isolamento entre empresas e técnicos.
-- Proprietário vê valores. O técnico atribuído trabalha na própria OS (itens, relato, relatório, arquivos)
-- sem preço, custo, margem, financeiro, relatório bruto, comprovante, histórico do cliente, OS de outro
-- técnico ou arquivo de outra OS; UUID conhecido não fura RLS; outra empresa, anon e técnico desativado
-- ficam bloqueados; convite de equipe não depende do convite beta e convite beta não vira vínculo de técnico.
-- Destino: SOMENTE CI descartável ou banco local. Tudo termina em ROLLBACK.

begin;

create temp table zt_b5 (
  owner_a uuid, tech_a uuid, owner_b uuid, tech_b uuid,
  company_a uuid, company_b uuid, client_a uuid, client_a2 uuid, client_b uuid,
  quote_a uuid, wo_a uuid, wo_b uuid, wo_cb uuid,
  obj_wo_a uuid, obj_wo_b uuid, obj_doc_a uuid, beta_invite uuid
) on commit drop;
create temp table zt_b5_results (name text primary key, ok boolean not null, detail text) on commit drop;
create temp table zt_b5_obs (name text primary key, val jsonb) on commit drop;
grant select, insert, update on zt_b5, zt_b5_results, zt_b5_obs to authenticated, anon;

create function pg_temp.b5_check(p_name text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into zt_b5_results(name,ok,detail) values(p_name,coalesce(p_ok,false),left(p_detail,500));
$$;

-- Executa no papel atual; devolve 'ok' ou o SQLSTATE.
create function pg_temp.b5_state(p_sql text)
returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate;
end $$;

-- Linhas visíveis no papel atual; erro vira -1 (o detalhe do check mostra o número).
create function pg_temp.b5_count(p_sql text)
returns bigint language plpgsql as $$
declare n bigint;
begin
  execute 'select count(*) from ('||p_sql||') q' into n;
  return n;
exception when others then
  return -1;
end $$;

create function pg_temp.b5_obs(p_name text, p_val jsonb)
returns void language sql as $$
  insert into zt_b5_obs(name,val) values(p_name,p_val) on conflict (name) do update set val=excluded.val;
$$;

create function pg_temp.b5_val(p_name text)
returns jsonb language sql as $$
  select val from zt_b5_obs where name=p_name;
$$;

-- Todos os valores do objeto iguais ao esperado (contagens 0, SQLSTATE 42501...).
create function pg_temp.b5_all(p_obj jsonb, p_expected text)
returns boolean language sql as $$
  select not exists(select 1 from jsonb_each_text(p_obj) e where e.value is distinct from p_expected);
$$;

-- ---------------------------------------------------------------- catálogo, policies e grants
do $$
declare v_sig text; v_proc pg_proc%rowtype; v_bad text;
begin
  foreach v_sig in array array['public.zt_get_service_report(uuid)','public.zt_field_work_order_items(uuid,uuid)'] loop
    select * into strict v_proc from pg_proc where oid=to_regprocedure(v_sig);
    perform pg_temp.b5_check('catalogo_'||v_proc.proname,v_proc.prosecdef
      and exists(select 1 from unnest(coalesce(v_proc.proconfig,array[]::text[])) s where s in ('search_path=','search_path=""'))
      and not exists(select 1 from aclexplode(coalesce(v_proc.proacl,acldefault('f',v_proc.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE')
      and not has_function_privilege('anon',v_proc.oid,'EXECUTE')
      and has_function_privilege('authenticated',v_proc.oid,'EXECUTE'),v_sig);
  end loop;

  perform pg_temp.b5_check('policy_itens_select_so_proprietario',exists(select 1 from pg_policies
    where schemaname='public' and tablename='work_order_items' and policyname='p_wo_items_select'
      and cmd='SELECT' and qual ~ 'zt_wo_is_owned' and qual !~ 'zt_wo_is_mine'),
    (select qual from pg_policies where schemaname='public' and tablename='work_order_items' and policyname='p_wo_items_select'));
  perform pg_temp.b5_check('policy_itens_insert_tecnico_inalterada',exists(select 1 from pg_policies
    where schemaname='public' and tablename='work_order_items' and policyname='p_wo_items_insert'
      and with_check ~ 'zt_wo_is_mine' and with_check ~ 'price_pending'),null);
  perform pg_temp.b5_check('policy_relatorio_sem_service_report_para_tecnico',exists(select 1 from pg_policies
    where schemaname='public' and tablename='work_order_reports' and policyname='p_wo_rep_select'
      and qual ~ 'zt_wo_is_owned' and qual ~ 'service_report'),
    (select qual from pg_policies where schemaname='public' and tablename='work_order_reports' and policyname='p_wo_rep_select'));

  -- SELECT por coluna: todas as colunas, menos approved_*, continuam legíveis (coluna nova sem grant falha aqui).
  select string_agg(a.attname||'='||has_column_privilege('authenticated','public.work_orders',a.attname,'SELECT'),',' order by a.attnum)
    into v_bad
    from pg_attribute a
   where a.attrelid='public.work_orders'::regclass and a.attnum>0 and not a.attisdropped
     and has_column_privilege('authenticated','public.work_orders',a.attname,'SELECT')
         = (a.attname in ('approved_subtotal','approved_discount','approved_surcharge','approved_total'));
  perform pg_temp.b5_check('work_orders_select_por_coluna',v_bad is null
    and not has_table_privilege('authenticated','public.work_orders','SELECT')
    and has_table_privilege('authenticated','public.work_orders','UPDATE')
    and has_table_privilege('authenticated','public.work_orders','INSERT')
    and not has_column_privilege('anon','public.work_orders','id','SELECT'),coalesce(v_bad,'ok'));
end $$;

-- ---------------------------------------------------------------- fixtures portáveis
with candidates as (
  select u.id, row_number() over (order by u.id) as rn
  from auth.users u join public.profiles p on p.id=u.id
  where not coalesce(p.is_platform_admin,false) and u.email_confirmed_at is not null
)
insert into zt_b5(owner_a,tech_a,owner_b,tech_b,company_a,company_b,client_a,client_a2,client_b,quote_a,obj_wo_a,obj_wo_b,obj_doc_a)
select (select id from candidates where rn=1),(select id from candidates where rn=2),
       (select id from candidates where rn=3),(select id from candidates where rn=4),
       gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),
       gen_random_uuid(),gen_random_uuid(),gen_random_uuid();

do $$
begin
  if exists(select 1 from zt_b5 where owner_a is null or tech_a is null or owner_b is null or tech_b is null) then
    raise exception 'B5_NEEDS_FOUR_CONFIRMED_AUTH_USERS';
  end if;
end $$;

select set_config('request.jwt.claim.sub',(select owner_a::text from zt_b5),true);
insert into public.companies(id,name,has_team)
select company_a,'__B5_A__',true from zt_b5
union all select company_b,'__B5_B__',true from zt_b5;
insert into public.subscriptions(company_id,status,current_period_start,current_period_end)
select company_a,'trial'::public.zt_sub_status,current_date,current_date+14 from zt_b5
union all select company_b,'trial'::public.zt_sub_status,current_date,current_date+14 from zt_b5
on conflict (company_id) do update set status=excluded.status,
  current_period_start=excluded.current_period_start,current_period_end=excluded.current_period_end;
insert into public.company_members(company_id,user_id,role,status)
select company_a,owner_a,'owner'::public.zt_role,'active'::public.zt_member_status from zt_b5
union all select company_a,tech_a,'technician'::public.zt_role,'active'::public.zt_member_status from zt_b5
union all select company_b,owner_b,'owner'::public.zt_role,'active'::public.zt_member_status from zt_b5;
insert into public.clients(id,company_id,name,address)
select client_a,company_a,'__B5_CLIENTE_A__','Rua A, 1' from zt_b5
union all select client_a2,company_a,'__B5_CLIENTE_A2__','Rua A2, 2' from zt_b5
union all select client_b,company_b,'__B5_CLIENTE_B__','Rua B, 3' from zt_b5;

-- Orçamento aprovado de A: subtotal 1000, desconto 50, snapshot aprovado 950.
insert into public.quotes(id,company_id,number,client_id,status,issue_date,discount,surcharge,created_by)
select quote_a,company_a,'__B5-ORC-1',client_a,'approved'::public.zt_quote_status,current_date,50,0,owner_a from zt_b5;
insert into public.quote_items(quote_id,company_id,kind,name,unit,quantity,unit_price,unit_cost,position)
select quote_a,company_a,'free'::public.zt_item_kind,'Instalação split B5','unidade',1,900,0,0 from zt_b5
union all select quote_a,company_a,'free'::public.zt_item_kind,'Suporte B5','unidade',2,50,0,1 from zt_b5;

-- Convite de equipe para o técnico B (sem convite beta) e convite beta para o proprietário B.
insert into public.company_invites(company_id,email,role,job_title,name)
select t.company_a,lower(u.email),'technician','Técnico B5','Técnico B' from zt_b5 t join auth.users u on u.id=t.tech_b;
with ins as (
  insert into public.beta_invites(email,status,expires_at)
  select lower(btrim(u.email)),'pending',now()+interval '7 days' from zt_b5 t join auth.users u on u.id=t.owner_b
  returning id
)
update zt_b5 set beta_invite=(select id from ins);

select set_config('request.jwt.claim.sub',(select tech_b::text from zt_b5),true);
set local role authenticated;
select pg_temp.b5_obs('team_accept',to_jsonb(public.zt_accept_invites()));
reset role;

select set_config('request.jwt.claim.sub',(select owner_b::text from zt_b5),true);
set local role authenticated;
select pg_temp.b5_obs('beta_only_accept',to_jsonb(public.zt_accept_invites()));
select pg_temp.b5_obs('beta_status',public.zt_beta_invite_status());
update zt_b5 set wo_cb=public.zt_save_work_order_idempotent(company_b,null,gen_random_uuid(),
  jsonb_build_object('client_id',client_b,'assigned_to',owner_b,'status','scheduled','scheduled_date',current_date,'request','__B5_WO_CB__'),
  jsonb_build_array(jsonb_build_object('kind','free','name','Serviço empresa B','quantity',1,'unit_price',777)));
reset role;

-- OS de A pelo fluxo real: do orçamento aprovado (técnico A) e direta (técnico B).
select set_config('request.jwt.claim.sub',(select owner_a::text from zt_b5),true);
set local role authenticated;
update zt_b5 set
  wo_a=public.zt_create_work_order_from_quote(quote_a,tech_a,current_date,'09:00'::time),
  wo_b=public.zt_save_work_order_idempotent(company_a,null,gen_random_uuid(),
    jsonb_build_object('client_id',client_a2,'assigned_to',tech_b,'status','scheduled','scheduled_date',current_date,'request','__B5_WO_B__'),
    jsonb_build_array(jsonb_build_object('kind','free','name','Serviço técnico B','quantity',1,'unit_price',300)));
reset role;

insert into public.attachments(company_id,bucket,path,file_name,content_type,size_bytes,category,work_order_id,uploaded_by,media_kind,media_stage,caption)
select company_a,'zt-work-orders',company_a::text||'/work-orders/'||wo_a::text||'/before/b5-a.jpg','b5-a.jpg',
  'image/jpeg',2048,'Antes',wo_a,tech_a,'photo','before','Antes A' from zt_b5
union all
select company_a,'zt-work-orders',company_a::text||'/work-orders/'||wo_b::text||'/before/b5-b.jpg','b5-b.jpg',
  'image/jpeg',2048,'Antes',wo_b,tech_b,'photo','before','Antes B' from zt_b5;
insert into storage.objects(id,bucket_id,name,metadata)
select obj_wo_a,'zt-work-orders',company_a::text||'/work-orders/'||wo_a::text||'/before/b5-a.jpg','{}'::jsonb from zt_b5
union all select obj_wo_b,'zt-work-orders',company_a::text||'/work-orders/'||wo_b::text||'/before/b5-b.jpg','{}'::jsonb from zt_b5
union all select obj_doc_a,'zt-documents',company_a::text||'/quotes/b5-orcamento.pdf','{}'::jsonb from zt_b5;

-- Técnico B registra adicional sem preço na própria OS (a policy de insert não mudou).
select set_config('request.jwt.claim.sub',(select tech_b::text from zt_b5),true);
set local role authenticated;
do $$
declare t zt_b5%rowtype; s text;
begin
  select * into t from zt_b5;
  s:=pg_temp.b5_state(format($q$insert into public.work_order_items(work_order_id,company_id,kind,name,unit,quantity,unit_price,unit_cost,is_extra,price_pending)
    values(%L,%L,'free','Adicional campo B5','unidade',1,0,0,true,true)$q$,t.wo_b,t.company_a));
  perform pg_temp.b5_check('tecnico_ainda_insere_adicional_sem_preco',s='ok',s);
end $$;
reset role;

-- Técnico A inicia e conclui a própria OS com relato; o relatório nasce agora.
select set_config('request.jwt.claim.sub',(select tech_a::text from zt_b5),true);
set local role authenticated;
update public.work_orders set status='in_progress' where id=(select wo_a from zt_b5);
select public.zt_finalize_work_order_with_warranty_overrides((select wo_a from zt_b5),
  'Relato B5: split instalado e testado.',null,null,7,'[]'::jsonb,'[]'::jsonb,null);
set constraints zt_service_report_after_done immediate;
reset role;

select set_config('request.jwt.claim.sub',(select owner_a::text from zt_b5),true);
set local role authenticated;
select pg_temp.b5_obs('receipt',public.zt_issue_service_receipt((select wo_a from zt_b5),gen_random_uuid()));
reset role;

-- A fixture tem de fato o que o técnico não pode ver (os checks negativos não são vazios).
do $$
declare t zt_b5%rowtype;
begin
  select * into t from zt_b5;
  perform pg_temp.b5_check('fixture_nao_vazia',
    (select approved_total from public.work_orders where id=t.wo_a)=950
    and (select count(*) from public.work_order_items where work_order_id=t.wo_a and unit_price>0)=2
    and exists(select 1 from public.financial_entries f where f.work_order_id=t.wo_a)
    and exists(select 1 from public.work_order_reports r where r.work_order_id=t.wo_a and r.entry_type='service_report' and r.is_active)
    and exists(select 1 from public.service_receipts s where s.work_order_id=t.wo_a)
    and exists(select 1 from public.work_order_items i where i.work_order_id=t.wo_b and i.price_pending),
    (select row(w.status,w.approved_total,w.billing_entry_id)::text from public.work_orders w where w.id=t.wo_a));
end $$;

-- ---------------------------------------------------------------- proprietário A
select set_config('request.jwt.claim.sub',(select owner_a::text from zt_b5),true);
set local role authenticated;
do $$
declare t zt_b5%rowtype; r jsonb; s text; n bigint;
begin
  select * into t from zt_b5;
  n:=pg_temp.b5_count(format('select 1 from public.work_order_items where work_order_id=%L and unit_price>0',t.wo_a));
  perform pg_temp.b5_check('owner_le_itens_com_preco',n=2,n::text);
  n:=pg_temp.b5_count(format('select 1 from public.zt_field_work_order_items(%L,null)',t.company_a));
  perform pg_temp.b5_check('owner_sem_projecao_de_campo',n=0,n::text);
  r:=public.zt_get_service_report(t.wo_a);
  perform pg_temp.b5_check('owner_relatorio_completo',r->>'viewer_role'='owner'
    and (r#>>'{snapshot,payment,approved_total}')::numeric=950
    and r#>'{snapshot,items}' @> '[{"unit_price":900}]'
    and not (r->'snapshot') ? 'financial_redacted',left(r::text,300));
  n:=pg_temp.b5_count(format('select id,number,status,assigned_to,client_location_id,started_by,completed_by from public.work_orders where id=%L',t.wo_a));
  perform pg_temp.b5_check('owner_le_os_por_colunas',n=1,n::text);
  s:=pg_temp.b5_state('select approved_total from public.work_orders limit 1');
  perform pg_temp.b5_check('approved_sem_leitura_direta_owner',s='42501',s);
  s:=pg_temp.b5_state('select * from public.work_orders limit 1');
  perform pg_temp.b5_check('select_estrela_bloqueado',s='42501',s);
  r:=public.zt_work_order_history_detail(t.wo_a);
  perform pg_temp.b5_check('owner_historico_com_financeiro',r ? 'financial',left(r::text,300));
  n:=pg_temp.b5_count(format('select 1 from public.service_receipts where work_order_id=%L',t.wo_a));
  perform pg_temp.b5_check('owner_le_comprovante',n=1,n::text);
end $$;
reset role;

-- ---------------------------------------------------------------- técnico A (atribuído à wo_a)
select set_config('request.jwt.claim.sub',(select tech_a::text from zt_b5),true);
set local role authenticated;
do $$
declare t zt_b5%rowtype; r jsonb; s text; n bigint; v_items jsonb; v_ref jsonb;
begin
  select * into t from zt_b5;
  -- Operacional: a própria OS, os itens sem preço, o próprio relato e o relatório sem financeiro.
  n:=pg_temp.b5_count(format('select id,number,status,request,address,scheduled_date from public.work_orders where id=%L',t.wo_a));
  perform pg_temp.b5_check('tecnico_le_propria_os',n=1,n::text);
  select coalesce(jsonb_agg(to_jsonb(i) order by i.name),'[]'::jsonb) into v_items
    from public.zt_field_work_order_items(t.company_a,null) i;
  perform pg_temp.b5_check('tecnico_itens_da_propria_os_sem_preco',
    jsonb_array_length(v_items)=2
    and not exists(select 1 from jsonb_array_elements(v_items) e where e->>'work_order_id'<>t.wo_a::text)
    and v_items @> '[{"name":"Instalação split B5","quantity":1},{"name":"Suporte B5","quantity":2}]'
    and v_items::text !~ '"unit_(price|cost)"',left(v_items::text,400));
  n:=pg_temp.b5_count(format('select 1 from public.work_order_reports where work_order_id=%L and entry_type=''report''',t.wo_a));
  perform pg_temp.b5_check('tecnico_le_proprio_relato',n>=1,n::text);
  r:=public.zt_get_service_report(t.wo_a);
  perform pg_temp.b5_check('tecnico_relatorio_projetado',r->>'viewer_role'='technician'
    and coalesce((r#>>'{snapshot,financial_redacted}')::boolean,false)
    and not (r->'snapshot') ? 'payment'
    and (r->'snapshot')::text !~* 'unit_price|price_pending|billable_total|approved_|payment_method|unit_cost|extra_cost'
    and r#>>'{snapshot,technical_report,body}' like 'Relato B5:%'
    and jsonb_array_length(r#>'{snapshot,items}')=2,left(r::text,400));

  -- Valores e financeiro: nada pela Data API.
  s:=pg_temp.b5_state(format('select approved_total from public.work_orders where id=%L',t.wo_a));
  perform pg_temp.b5_check('tecnico_sem_approved',s='42501',s);
  s:=pg_temp.b5_state('select * from public.work_orders limit 1');
  perform pg_temp.b5_check('tecnico_sem_select_estrela',s='42501',s);
  n:=pg_temp.b5_count(format('select 1 from public.work_order_items where company_id=%L',t.company_a));
  perform pg_temp.b5_check('tecnico_sem_itens_diretos',n=0,n::text);
  n:=pg_temp.b5_count(format('select 1 from public.work_order_reports where work_order_id=%L and entry_type=''service_report''',t.wo_a));
  perform pg_temp.b5_check('tecnico_sem_relatorio_bruto',n=0,n::text);
  r:=jsonb_build_object(
    'financial_entries',pg_temp.b5_count(format('select 1 from public.financial_entries where company_id=%L',t.company_a)),
    'quotes',pg_temp.b5_count(format('select 1 from public.quotes where company_id=%L',t.company_a)),
    'quote_items',pg_temp.b5_count(format('select 1 from public.quote_items where company_id=%L',t.company_a)),
    'item_costs',pg_temp.b5_count(format('select 1 from public.work_order_item_costs where company_id=%L',t.company_a)),
    'private_costs',pg_temp.b5_count(format('select 1 from public.work_order_private_costs where company_id=%L',t.company_a)),
    'receipts',pg_temp.b5_count(format('select 1 from public.service_receipts where company_id=%L',t.company_a)));
  perform pg_temp.b5_check('tecnico_sem_financeiro_orcamento_custos',pg_temp.b5_all(r,'0'),r::text);

  -- RPCs administrativas e o Assistente não escalam o papel.
  r:=jsonb_build_object(
    'receipt',pg_temp.b5_state(format('select public.zt_issue_service_receipt(%L,gen_random_uuid())',t.wo_a)),
    'client_history',pg_temp.b5_state(format('select public.zt_client_service_history(%L,null)',t.client_a)),
    'global_search',pg_temp.b5_state(format('select public.zt_global_operational_search(%L,''B5'',10,0)',t.company_a)));
  -- A referência do Assistente não lança: devolve {error, code} sem o contexto do orçamento.
  v_ref:=public.zt_assistant_reference(t.company_a,'quote',t.quote_a);
  perform pg_temp.b5_check('tecnico_rpcs_administrativas_negadas',pg_temp.b5_all(r,'42501')
    and v_ref ? 'error' and not v_ref ? 'context' and v_ref::text !~ '"(unitPrice|total|items)"',
    r::text||' referencia='||v_ref::text);
  r:=public.zt_assistant_read(t.company_a,'owner_finance_summary','{}'::jsonb,gen_random_uuid());
  perform pg_temp.b5_check('tecnico_assistente_sem_consulta_do_proprietario',r ? 'error' and not r ? 'result',left(r::text,300));
  r:=public.zt_assistant_plan(t.company_a,'technician_open_assigned_order',jsonb_build_object('workOrder',t.wo_b::text),gen_random_uuid());
  perform pg_temp.b5_check('tecnico_assistente_nao_abre_os_de_outro_tecnico',r ? 'error' and not r ? 'result',left(r::text,300));
  r:=public.zt_work_order_history_detail(t.wo_a);
  perform pg_temp.b5_check('tecnico_detalhe_proprio_sem_valores',not r ? 'financial'
    and r::text !~ '"(unit_price|billed_amount|approved_total|payment_method|unit_cost|extra_cost)"',left(r::text,300));

  -- OS do técnico B: nem pela Data API nem por UUID conhecido.
  r:=jsonb_build_object(
    'os',pg_temp.b5_count(format('select id from public.work_orders where id=%L',t.wo_b)),
    'os_outra_empresa',pg_temp.b5_count(format('select id from public.work_orders where id=%L',t.wo_cb)),
    'itens_projecao',pg_temp.b5_count(format('select 1 from public.zt_field_work_order_items(%L,%L)',t.company_a,t.wo_b)),
    'anexos',pg_temp.b5_count(format('select 1 from public.attachments where work_order_id=%L',t.wo_b)),
    'storage_os',pg_temp.b5_count(format('select 1 from storage.objects where id=%L',t.obj_wo_b)),
    'storage_documentos',pg_temp.b5_count(format('select 1 from storage.objects where id=%L',t.obj_doc_a)),
    'cliente',pg_temp.b5_count(format('select 1 from public.clients where id=%L',t.client_a2)),
    'relatos',pg_temp.b5_count(format('select 1 from public.work_order_reports where work_order_id=%L',t.wo_b)));
  perform pg_temp.b5_check('tecnico_nao_alcanca_os_de_outro_tecnico',pg_temp.b5_all(r,'0'),r::text);
  r:=jsonb_build_object(
    'relatorio_outro',pg_temp.b5_state(format('select public.zt_get_service_report(%L)',t.wo_b)),
    'relatorio_outra_empresa',pg_temp.b5_state(format('select public.zt_get_service_report(%L)',t.wo_cb)),
    'detalhe_outro',pg_temp.b5_state(format('select public.zt_work_order_history_detail(%L)',t.wo_b)),
    'projecao_outra_empresa',pg_temp.b5_state(format('select * from public.zt_field_work_order_items(%L,null)',t.company_b)));
  perform pg_temp.b5_check('tecnico_uuid_conhecido_negado',pg_temp.b5_all(r,'42501'),r::text);

  -- O mínimo operacional segue disponível: anexo e arquivo da própria OS, o cliente dela, o próprio vínculo.
  r:=jsonb_build_object(
    'anexos',pg_temp.b5_count(format('select 1 from public.attachments where work_order_id=%L',t.wo_a)),
    'storage',pg_temp.b5_count(format('select 1 from storage.objects where id=%L',t.obj_wo_a)),
    'cliente',pg_temp.b5_count(format('select 1 from public.clients where id=%L',t.client_a)),
    'vinculos',pg_temp.b5_count(format('select 1 from public.company_members where company_id=%L',t.company_a)),
    'perfis_de_outros',pg_temp.b5_count(format('select 1 from public.profiles where id in (%L,%L)',t.owner_a,t.tech_b)));
  perform pg_temp.b5_check('tecnico_operacional_minimo',
    r='{"anexos":1,"storage":1,"cliente":1,"vinculos":1,"perfis_de_outros":0}'::jsonb,r::text);
end $$;
reset role;

-- ---------------------------------------------------------------- técnico B (atribuído à wo_b)
select set_config('request.jwt.claim.sub',(select tech_b::text from zt_b5),true);
set local role authenticated;
do $$
declare t zt_b5%rowtype; r jsonb; v_items jsonb; s text;
begin
  select * into t from zt_b5;
  select coalesce(jsonb_agg(to_jsonb(i) order by i.name),'[]'::jsonb) into v_items
    from public.zt_field_work_order_items(t.company_a,t.wo_b) i;
  perform pg_temp.b5_check('tecnico_b_ve_adicional_pendente_sem_preco',
    jsonb_array_length(v_items)=2
    and v_items @> '[{"name":"Adicional campo B5","price_pending":true,"is_extra":true},{"name":"Serviço técnico B","price_pending":false}]'
    and v_items::text !~ '"unit_(price|cost)"',left(v_items::text,400));
  r:=jsonb_build_object(
    'os_a',pg_temp.b5_count(format('select id from public.work_orders where id=%L',t.wo_a)),
    'itens_a',pg_temp.b5_count(format('select 1 from public.zt_field_work_order_items(%L,%L)',t.company_a,t.wo_a)),
    'anexos_a',pg_temp.b5_count(format('select 1 from public.attachments where work_order_id=%L',t.wo_a)),
    'storage_a',pg_temp.b5_count(format('select 1 from storage.objects where id=%L',t.obj_wo_a)),
    'relatos_a',pg_temp.b5_count(format('select 1 from public.work_order_reports where work_order_id=%L',t.wo_a)));
  s:=pg_temp.b5_state(format('select public.zt_get_service_report(%L)',t.wo_a));
  perform pg_temp.b5_check('tecnico_b_nao_alcanca_os_do_tecnico_a',pg_temp.b5_all(r,'0') and s='42501',r::text||' relatorio='||s);
end $$;
reset role;

-- ---------------------------------------------------------------- outra empresa / sem vínculo em A
select set_config('request.jwt.claim.sub',(select owner_b::text from zt_b5),true);
set local role authenticated;
do $$
declare t zt_b5%rowtype; r jsonb; n bigint;
begin
  select * into t from zt_b5;
  r:=jsonb_build_object(
    'os',pg_temp.b5_count(format('select id from public.work_orders where company_id=%L',t.company_a)),
    'itens',pg_temp.b5_count(format('select 1 from public.work_order_items where company_id=%L',t.company_a)),
    'relatos',pg_temp.b5_count(format('select 1 from public.work_order_reports where company_id=%L',t.company_a)),
    'anexos',pg_temp.b5_count(format('select 1 from public.attachments where company_id=%L',t.company_a)),
    'storage',pg_temp.b5_count(format('select 1 from storage.objects where id in (%L,%L,%L)',t.obj_wo_a,t.obj_wo_b,t.obj_doc_a)),
    'clientes',pg_temp.b5_count(format('select 1 from public.clients where company_id=%L',t.company_a)),
    'comprovantes',pg_temp.b5_count(format('select 1 from public.service_receipts where company_id=%L',t.company_a)));
  perform pg_temp.b5_check('outra_empresa_nao_le_dados_de_a',pg_temp.b5_all(r,'0'),r::text);
  r:=jsonb_build_object(
    'projecao',pg_temp.b5_state(format('select * from public.zt_field_work_order_items(%L,null)',t.company_a)),
    'relatorio',pg_temp.b5_state(format('select public.zt_get_service_report(%L)',t.wo_a)),
    'detalhe',pg_temp.b5_state(format('select public.zt_work_order_history_detail(%L)',t.wo_a)));
  perform pg_temp.b5_check('sem_vinculo_rpcs_negadas',pg_temp.b5_all(r,'42501'),r::text);
  n:=pg_temp.b5_count(format('select 1 from public.work_order_items where work_order_id=%L and unit_price=777',t.wo_cb));
  perform pg_temp.b5_check('owner_b_le_propria_empresa',n=1,n::text);
end $$;
reset role;

-- ---------------------------------------------------------------- anon
select set_config('request.jwt.claim.sub','',true);
set local role anon;
do $$
declare t zt_b5%rowtype; r jsonb;
begin
  select * into t from zt_b5;
  r:=jsonb_build_object(
    'os',pg_temp.b5_state(format('select id from public.work_orders where id=%L',t.wo_a)),
    'itens',pg_temp.b5_state(format('select id from public.work_order_items where work_order_id=%L',t.wo_a)),
    'relatorio',pg_temp.b5_state(format('select public.zt_get_service_report(%L)',t.wo_a)),
    'projecao',pg_temp.b5_state(format('select * from public.zt_field_work_order_items(%L,null)',t.company_a)));
  perform pg_temp.b5_check('anon_bloqueado',pg_temp.b5_all(r,'42501'),r::text);
end $$;
reset role;

-- ---------------------------------------------------------------- técnico desativado
select set_config('request.jwt.claim.sub',(select owner_a::text from zt_b5),true);
update public.company_members m set status='disabled' from zt_b5 t where m.company_id=t.company_a and m.user_id=t.tech_a;
select set_config('request.jwt.claim.sub',(select tech_a::text from zt_b5),true);
set local role authenticated;
do $$
declare t zt_b5%rowtype; r jsonb;
begin
  select * into t from zt_b5;
  r:=jsonb_build_object(
    'os',pg_temp.b5_count(format('select id from public.work_orders where id=%L',t.wo_a)),
    'anexos',pg_temp.b5_count(format('select 1 from public.attachments where work_order_id=%L',t.wo_a)),
    'storage',pg_temp.b5_count(format('select 1 from storage.objects where id=%L',t.obj_wo_a)),
    'relatos',pg_temp.b5_count(format('select 1 from public.work_order_reports where work_order_id=%L',t.wo_a)),
    'projecao',pg_temp.b5_state(format('select * from public.zt_field_work_order_items(%L,null)',t.company_a)),
    'relatorio',pg_temp.b5_state(format('select public.zt_get_service_report(%L)',t.wo_a)));
  perform pg_temp.b5_check('tecnico_desativado_perde_acesso',
    r='{"os":0,"anexos":0,"storage":0,"relatos":0,"projecao":"42501","relatorio":"42501"}'::jsonb,r::text);
end $$;
reset role;

-- ---------------------------------------------------------------- convite de equipe x convite beta
do $$
declare t zt_b5%rowtype;
begin
  select * into t from zt_b5;
  perform pg_temp.b5_check('convite_equipe_sem_convite_beta',
    pg_temp.b5_val('team_accept')='1'::jsonb
    and exists(select 1 from public.company_members m where m.company_id=t.company_a and m.user_id=t.tech_b
      and m.role='technician' and m.status='active')
    and not exists(select 1 from public.company_members m where m.user_id=t.tech_b and m.role='owner')
    and not exists(select 1 from public.beta_invites b join auth.users u on lower(btrim(u.email))=b.email where u.id=t.tech_b),
    pg_temp.b5_val('team_accept')::text);
  perform pg_temp.b5_check('convite_beta_nao_e_convite_de_tecnico',
    pg_temp.b5_val('beta_only_accept')='0'::jsonb
    and coalesce((pg_temp.b5_val('beta_status')->>'invited')::boolean,false)
    and not exists(select 1 from public.company_members m where m.company_id=t.company_a and m.user_id=t.owner_b)
    and exists(select 1 from public.beta_invites b where b.id=t.beta_invite and b.status='pending' and b.used_at is null),
    concat_ws(' ',pg_temp.b5_val('beta_only_accept')::text,pg_temp.b5_val('beta_status')::text));
  perform pg_temp.b5_check('aceite_de_equipe_nao_consulta_convite_beta',
    pg_get_functiondef('zt_private.zt_accept_invites()'::regprocedure) !~ 'beta_invites'
    and pg_get_functiondef('zt_private.zt_accept_invites()'::regprocedure) ~ 'company_invites',null);
end $$;

do $$
declare failures text; n int;
begin
  select string_agg(name||': '||coalesce(detail,''),E'\n' order by name) into failures from zt_b5_results where not ok;
  if failures is not null then raise exception 'BLOCK5_TECHNICIAN_EXPOSURE_FAILED: %',failures; end if;
  select count(*) into n from zt_b5_results;
  if n<>42 then raise exception 'BLOCK5_TECHNICIAN_EXPOSURE_INCOMPLETE: % checks',n; end if;
end $$;
select 'BLOCK5_TECHNICIAN_EXPOSURE' as test,count(*) as checks,bool_and(ok) as all_ok from zt_b5_results;
rollback;
