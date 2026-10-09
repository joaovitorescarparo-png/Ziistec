-- ZiisTec Blocos 3/4 (0098) — histórico técnico do cliente e por local (client_locations).
-- Proprietário vê tudo com valores; técnico só vê o local onde tem OS aberta atribuída, sem
-- valores/pagamento/preço e sem arquivos de OS de outros técnicos.
-- Destino: SOMENTE CI descartável ou staging/homologação. Tudo termina em ROLLBACK.

begin;

create temp table zt_lh (
  owner_a uuid, tech_a uuid, owner_b uuid, tech_x uuid,
  company_a uuid, company_b uuid, client_a uuid, client_b uuid,
  loc_1 uuid, loc_2 uuid, loc_b uuid,
  wo_past_1 uuid, wo_past_2 uuid, wo_canceled uuid, wo_deleted uuid, wo_open_tech uuid, wo_no_loc uuid
) on commit drop;
create temp table zt_lh_results (name text primary key, ok boolean not null, detail text) on commit drop;
grant select, insert, update on zt_lh, zt_lh_results to authenticated, anon;

create function pg_temp.lh_check(p_name text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into zt_lh_results(name,ok,detail) values(p_name,coalesce(p_ok,false),left(p_detail,500));
$$;

create function pg_temp.lh_history_state(p_client uuid, p_location uuid)
returns text language plpgsql as $$
begin
  perform public.zt_client_service_history(p_client,p_location);
  return 'ok';
exception when others then
  return sqlstate;
end $$;

create function pg_temp.lh_detail_state(p_wo uuid)
returns text language plpgsql as $$
begin
  perform public.zt_work_order_history_detail(p_wo);
  return 'ok';
exception when others then
  return sqlstate;
end $$;

-- Conjunto ordenado de OS presentes num histórico.
create function pg_temp.lh_ids(p_history jsonb)
returns text language sql as $$
  select coalesce(string_agg(e->>'work_order_id',',' order by e->>'work_order_id'),'')
    from jsonb_array_elements(p_history) e;
$$;

create function pg_temp.lh_set(p_ids uuid[])
returns text language sql as $$
  select coalesce(string_agg(x::text,',' order by x::text),'') from unnest(p_ids) x;
$$;

-- ---------------------------------------------------------------- catálogo/ACL
do $$
declare v_sig text; v_proc pg_proc%rowtype;
begin
  foreach v_sig in array array['public.zt_client_service_history(uuid,uuid,integer)','public.zt_work_order_history_detail(uuid)'] loop
    select * into strict v_proc from pg_proc where oid=to_regprocedure(v_sig);
    perform pg_temp.lh_check('catalogo_'||v_proc.proname,v_proc.prosecdef
      and exists(select 1 from unnest(coalesce(v_proc.proconfig,array[]::text[])) s where s in ('search_path=','search_path=""'))
      and not exists(select 1 from aclexplode(coalesce(v_proc.proacl,acldefault('f',v_proc.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE')
      and not has_function_privilege('anon',v_proc.oid,'EXECUTE')
      and has_function_privilege('authenticated',v_proc.oid,'EXECUTE'),v_sig);
  end loop;
  perform pg_temp.lh_check('policy_local_inclui_os_atribuida',exists(select 1 from pg_policies
    where schemaname='public' and tablename='client_locations' and policyname='client_locations_visible'
      and qual ~ 'work_orders' and qual ~ 'installed_equipment'),null);
end $$;

-- ---------------------------------------------------------------- fixtures portáveis
with candidates as (
  select u.id, row_number() over (order by u.id) as rn
  from auth.users u join public.profiles p on p.id=u.id
  where not coalesce(p.is_platform_admin,false)
)
insert into zt_lh(owner_a,tech_a,owner_b,tech_x,company_a,company_b,client_a,client_b)
select (select id from candidates where rn=1),(select id from candidates where rn=2),
       (select id from candidates where rn=3),(select id from candidates where rn=4),
       gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid();

do $$
begin
  if exists(select 1 from zt_lh where owner_a is null or tech_a is null or owner_b is null or tech_x is null) then
    raise exception 'LH_NEEDS_FOUR_AUTH_USERS';
  end if;
end $$;

select set_config('request.jwt.claim.sub',(select owner_a::text from zt_lh),true);
insert into public.companies(id,name,has_team)
select company_a,'__LH_A__',true from zt_lh
union all select company_b,'__LH_B__',true from zt_lh;
insert into public.subscriptions(company_id,status,current_period_start,current_period_end)
select company_a,'trial'::public.zt_sub_status,current_date,current_date+14 from zt_lh
union all select company_b,'trial'::public.zt_sub_status,current_date,current_date+14 from zt_lh
on conflict (company_id) do update set status=excluded.status,
  current_period_start=excluded.current_period_start,current_period_end=excluded.current_period_end;
insert into public.company_members(company_id,user_id,role,status)
select company_a,owner_a,'owner'::public.zt_role,'active'::public.zt_member_status from zt_lh
union all select company_a,tech_a,'technician'::public.zt_role,'active'::public.zt_member_status from zt_lh
union all select company_a,tech_x,'technician'::public.zt_role,'active'::public.zt_member_status from zt_lh
union all select company_b,owner_b,'owner'::public.zt_role,'active'::public.zt_member_status from zt_lh;
insert into public.clients(id,company_id,name,address)
select client_a,company_a,'__LH_CONDOMINIO__','Av. Histórico, 100' from zt_lh
union all select client_b,company_b,'__LH_CLIENT_B__','Rua B, 2' from zt_lh;

-- Locais e OS da empresa A (proprietário pelo fluxo real de OS direta com local).
set local role authenticated;
update zt_lh set
  loc_1=(public.zt_create_client_location_for_quote(client_a,'Bloco 1','Av. Histórico, 100 · Bloco 1')->>'id')::uuid,
  loc_2=(public.zt_create_client_location_for_quote(client_a,'Bloco 2',null)->>'id')::uuid;
update zt_lh set
  wo_past_1=public.zt_save_work_order_idempotent(company_a,null,gen_random_uuid(),
    jsonb_build_object('client_id',client_a,'client_location_id',loc_1,'assigned_to',tech_x,'status','in_progress',
      'service_place','Bloco 1 · Casa de máquinas','request','__LH_PAST_1__'),
    jsonb_build_array(jsonb_build_object('kind','free','name','Troca de contator','quantity',1,'unit_price',200))),
  wo_past_2=public.zt_save_work_order_idempotent(company_a,null,gen_random_uuid(),
    jsonb_build_object('client_id',client_a,'client_location_id',loc_2,'assigned_to',tech_x,'status','in_progress','request','__LH_PAST_2__'),
    jsonb_build_array(jsonb_build_object('kind','free','name','Revisão Bloco 2','quantity',1,'unit_price',120))),
  wo_canceled=public.zt_save_work_order_idempotent(company_a,null,gen_random_uuid(),
    jsonb_build_object('client_id',client_a,'client_location_id',loc_1,'assigned_to',tech_x,'status','scheduled',
      'scheduled_date',current_date,'request','__LH_CANCELED__'),'[]'::jsonb),
  wo_deleted=public.zt_save_work_order_idempotent(company_a,null,gen_random_uuid(),
    jsonb_build_object('client_id',client_a,'client_location_id',loc_1,'assigned_to',tech_x,'status','scheduled',
      'scheduled_date',current_date,'request','__LH_DELETED__'),'[]'::jsonb),
  wo_open_tech=public.zt_save_work_order_idempotent(company_a,null,gen_random_uuid(),
    jsonb_build_object('client_id',client_a,'client_location_id',loc_1,'assigned_to',tech_a,'status','scheduled',
      'scheduled_date',current_date,'request','__LH_OPEN_TECH__'),'[]'::jsonb),
  wo_no_loc=public.zt_save_work_order_idempotent(company_a,null,gen_random_uuid(),
    jsonb_build_object('client_id',client_a,'assigned_to',owner_a,'status','in_progress','request','__LH_NO_LOCATION__'),
    jsonb_build_array(jsonb_build_object('kind','free','name','Visita sem local','quantity',1,'unit_price',60)));
insert into public.attachments(company_id,bucket,path,file_name,content_type,size_bytes,category,work_order_id,uploaded_by,media_kind,media_stage,caption)
select company_a,'zt-work-orders',company_a::text||'/work-orders/'||wo_past_1::text||'/before/lh-fake.jpg','lh-fake.jpg',
  'image/jpeg',2048,'Antes',wo_past_1,owner_a,'photo','before','Painel antes da troca'
from zt_lh;
update public.work_orders w set status='canceled' from zt_lh t where w.id=t.wo_canceled;
select public.zt_finalize_work_order_with_warranty_overrides((select wo_no_loc from zt_lh),null,null,null,7,'[]'::jsonb,'[]'::jsonb,null);
reset role;

-- OS excluída (soft delete) não entra em histórico.
update public.work_orders w set deleted_at=now() from zt_lh t where w.id=t.wo_deleted;

select set_config('request.jwt.claim.sub',(select owner_b::text from zt_lh),true);
set local role authenticated;
update zt_lh set loc_b=(public.zt_create_client_location_for_quote(client_b,'Sede B',null)->>'id')::uuid;
reset role;

-- Técnico X conclui os atendimentos anteriores dos dois blocos, com relato.
select set_config('request.jwt.claim.sub',(select tech_x::text from zt_lh),true);
set local role authenticated;
select public.zt_finalize_work_order_with_warranty_overrides((select wo_past_1 from zt_lh),
  '__LH_RELATO_1__ contator trocado, painel testado',null,null,7,'[]'::jsonb,'[]'::jsonb,null);
select public.zt_finalize_work_order_with_warranty_overrides((select wo_past_2 from zt_lh),
  '__LH_RELATO_2__ revisão sem pendências',null,null,7,'[]'::jsonb,'[]'::jsonb,null);
reset role;

do $$
declare t zt_lh%rowtype;
begin
  select * into t from zt_lh;
  if t.loc_1 is null or t.loc_2 is null or t.loc_b is null
     or (select count(*) from public.work_orders where id in (t.wo_past_1,t.wo_past_2,t.wo_no_loc) and status='done')<>3
     or (select status::text from public.work_orders where id=t.wo_canceled)<>'canceled'
     or (select billing_entry_id from public.work_orders where id=t.wo_past_1) is null then
    raise exception 'LH_FIXTURE_FAILED';
  end if;
end $$;

-- ---------------------------------------------------------------- proprietário
select set_config('request.jwt.claim.sub',(select owner_a::text from zt_lh),true);
set local role authenticated;
do $$
declare t zt_lh%rowtype; h jsonb; d jsonb; s text; e jsonb;
begin
  select * into t from zt_lh;
  h:=public.zt_client_service_history(t.client_a);
  perform pg_temp.lh_check('owner_historico_cliente_sem_cancelada_excluida',
    pg_temp.lh_ids(h)=pg_temp.lh_set(array[t.wo_past_1,t.wo_past_2,t.wo_open_tech,t.wo_no_loc]),pg_temp.lh_ids(h));
  select x into e from jsonb_array_elements(h) x where x->>'work_order_id'=t.wo_past_1::text;
  perform pg_temp.lh_check('owner_historico_com_valores',(e->>'billed_amount')::numeric=200 and e->>'paid'='false'
    and e#>>'{location,name}'='Bloco 1' and (e->>'is_mine') is not null,e::text);

  h:=public.zt_client_service_history(t.client_a,t.loc_1);
  perform pg_temp.lh_check('owner_filtro_por_local',pg_temp.lh_ids(h)=pg_temp.lh_set(array[t.wo_past_1,t.wo_open_tech]),pg_temp.lh_ids(h));
  h:=public.zt_client_service_history(t.client_a,null,1);
  perform pg_temp.lh_check('owner_limite_respeitado',jsonb_array_length(h)=1,jsonb_array_length(h)::text);

  s:=pg_temp.lh_history_state(t.client_a,t.loc_b);
  perform pg_temp.lh_check('local_de_outro_cliente_rejeitado',s='22023',s);

  d:=public.zt_work_order_history_detail(t.wo_past_1);
  perform pg_temp.lh_check('owner_detalhe_completo',d#>>'{viewer,role}'='owner'
    and (d#>>'{financial,billed_amount}')::numeric=200
    and jsonb_array_length(d->'evidence')=1 and (d->>'evidence_count')::int=1
    and (d#>>'{items,0,unit_price}')::numeric=200
    and d#>>'{reports,0,body}' like '__LH_RELATO_1__%'
    and (d#>>'{completed_by,id}')::uuid=t.tech_x
    and d#>>'{location,name}'='Bloco 1',d::text);
end $$;
reset role;

-- ---------------------------------------------------------------- técnico com OS aberta no Bloco 1
select set_config('request.jwt.claim.sub',(select tech_a::text from zt_lh),true);
set local role authenticated;
do $$
declare t zt_lh%rowtype; h jsonb; d jsonb; s text;
begin
  select * into t from zt_lh;
  h:=public.zt_client_service_history(t.client_a,t.loc_1);
  perform pg_temp.lh_check('tecnico_historico_do_local',pg_temp.lh_ids(h)=pg_temp.lh_set(array[t.wo_past_1,t.wo_open_tech]),pg_temp.lh_ids(h));
  perform pg_temp.lh_check('tecnico_historico_sem_valores',h::text !~ '"(billed_amount|paid|amount|unit_price|price)"',h::text);

  s:=pg_temp.lh_history_state(t.client_a,null);
  perform pg_temp.lh_check('tecnico_historico_cliente_inteiro_negado',s='42501',s);
  s:=pg_temp.lh_history_state(t.client_a,t.loc_2);
  perform pg_temp.lh_check('tecnico_outro_local_negado',s='42501',s);

  d:=public.zt_work_order_history_detail(t.wo_past_1);
  perform pg_temp.lh_check('tecnico_detalhe_pelo_local',d#>>'{viewer,context}'='location'
    and not d ? 'financial' and not d ? 'evidence' and (d->>'evidence_count')::int=1
    and not (d->'items'->0) ? 'unit_price' and d#>>'{reports,0,body}' like '__LH_RELATO_1__%'
    and d::text !~ '"(billed_amount|approved_total|payment_method|unit_cost|extra_cost)"',d::text);
  s:=pg_temp.lh_detail_state(t.wo_past_2);
  perform pg_temp.lh_check('tecnico_detalhe_outro_local_negado',s='42501',s);

  perform pg_temp.lh_check('tecnico_ve_somente_local_do_atendimento',
    (select count(*) from public.client_locations where id=t.loc_1)=1
    and (select count(*) from public.client_locations where id=t.loc_2)=0,null);
end $$;
reset role;

-- Técnico sem OS aberta no local não recebe o histórico, mas vê o detalhe da própria OS.
select set_config('request.jwt.claim.sub',(select tech_x::text from zt_lh),true);
set local role authenticated;
do $$
declare t zt_lh%rowtype; d jsonb; s text;
begin
  select * into t from zt_lh;
  s:=pg_temp.lh_history_state(t.client_a,t.loc_1);
  perform pg_temp.lh_check('tecnico_sem_os_aberta_negado',s='42501',s);
  d:=public.zt_work_order_history_detail(t.wo_past_1);
  perform pg_temp.lh_check('tecnico_responsavel_ve_proprias_evidencias',d#>>'{viewer,context}'='assigned'
    and jsonb_array_length(d->'evidence')=1 and not d ? 'financial',d::text);
end $$;
reset role;

-- Outra empresa não acessa.
select set_config('request.jwt.claim.sub',(select owner_b::text from zt_lh),true);
set local role authenticated;
do $$
declare t zt_lh%rowtype; s text;
begin
  select * into t from zt_lh;
  s:=pg_temp.lh_history_state(t.client_a,null);
  perform pg_temp.lh_check('outra_empresa_historico_negado',s='42501',s);
  s:=pg_temp.lh_detail_state(t.wo_past_1);
  perform pg_temp.lh_check('outra_empresa_detalhe_negado',s='42501',s);
end $$;
reset role;

-- Desativação corta o acesso na hora (fixture ajusta o vínculo direto e depois o restaura).
update public.company_members m set status='disabled' from zt_lh t where m.company_id=t.company_a and m.user_id=t.tech_a;
select set_config('request.jwt.claim.sub',(select tech_a::text from zt_lh),true);
set local role authenticated;
do $$
declare t zt_lh%rowtype; s text;
begin
  select * into t from zt_lh;
  s:=pg_temp.lh_history_state(t.client_a,t.loc_1);
  perform pg_temp.lh_check('tecnico_desativado_negado',s='42501'
    and pg_temp.lh_detail_state(t.wo_past_1)='42501',s);
end $$;
reset role;
update public.company_members m set status='active' from zt_lh t where m.company_id=t.company_a and m.user_id=t.tech_a;

-- Ao concluir a própria OS, o técnico perde o contexto do local (D5), mas mantém a própria OS.
select set_config('request.jwt.claim.sub',(select tech_a::text from zt_lh),true);
set local role authenticated;
select public.zt_finalize_work_order_with_warranty_overrides((select wo_open_tech from zt_lh),
  '__LH_RELATO_3__ inspeção concluída',null,null,7,'[]'::jsonb,'[]'::jsonb,null);
do $$
declare t zt_lh%rowtype; d jsonb;
begin
  select * into t from zt_lh;
  perform pg_temp.lh_check('tecnico_perde_contexto_apos_concluir',
    pg_temp.lh_history_state(t.client_a,t.loc_1)='42501' and pg_temp.lh_detail_state(t.wo_past_1)='42501',null);
  d:=public.zt_work_order_history_detail(t.wo_open_tech);
  perform pg_temp.lh_check('tecnico_mantem_detalhe_da_propria_os',d#>>'{viewer,context}'='assigned'
    and (d#>>'{completed_by,id}')::uuid=t.tech_a,d::text);
end $$;
reset role;

set local role anon;
do $$
begin
  perform pg_temp.lh_check('anon_nao_executa',
    pg_temp.lh_history_state(gen_random_uuid(),null)='42501' and pg_temp.lh_detail_state(gen_random_uuid())='42501',null);
end $$;
reset role;

do $$
declare v_failures text;
begin
  select string_agg(name||' => '||coalesce(detail,''),E'\n' order by name) into v_failures
  from zt_lh_results where not ok;
  if v_failures is not null then raise exception 'LOCATION_HISTORY_REGRESSION_FAILED%', E'\n'||v_failures; end if;
  if (select count(*) from zt_lh_results)<>24 then
    raise exception 'LOCATION_HISTORY_REGRESSION_INCOMPLETE: % checks', (select count(*) from zt_lh_results);
  end if;
end $$;

select 'BLOCKS34_0098_LOCATION_HISTORY' as test, count(*) as checks, bool_and(ok) as all_ok from zt_lh_results;

rollback;
