-- ZiisTec Blocos 3/4 (0094–0096) — quem iniciou/concluiu a OS, relato técnico sem duplicação
-- e local cadastrado (client_locations) na OS direta.
-- Destino: SOMENTE CI descartável ou staging/homologação. Tudo termina em ROLLBACK.

begin;

create temp table zt_lc (
  owner_a uuid, tech_a uuid, owner_b uuid, tech_x uuid,
  company_a uuid, company_b uuid, client_a uuid, client_a2 uuid, client_b uuid,
  loc_a1 uuid, loc_a2 uuid, loc_b uuid,
  wo_loc uuid, wo_life uuid, wo_report uuid, wo_forged uuid,
  report_1 uuid, req_1 uuid
) on commit drop;
create temp table zt_lc_results (name text primary key, ok boolean not null, detail text) on commit drop;
grant select, insert, update on zt_lc, zt_lc_results to authenticated, anon;

create function pg_temp.lc_check(p_name text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into zt_lc_results(name,ok,detail) values(p_name,coalesce(p_ok,false),left(p_detail,500));
$$;

create function pg_temp.lc_save_wo_state(p_company uuid, p_wo uuid, p_row jsonb)
returns text language plpgsql as $$
begin
  perform public.zt_save_work_order_idempotent(p_company,p_wo,gen_random_uuid(),p_row,'[]'::jsonb);
  return 'ok';
exception when others then
  return sqlstate;
end $$;

create function pg_temp.lc_report_state(p_wo uuid, p_body text, p_request uuid)
returns text language plpgsql as $$
begin
  perform public.zt_save_work_order_report(p_wo,p_body,p_request);
  return 'ok';
exception when others then
  return sqlstate;
end $$;

create function pg_temp.lc_report_count(p_wo uuid)
returns integer language sql as $$
  select count(*)::integer from public.work_order_reports where work_order_id=p_wo and entry_type='report';
$$;

-- ---------------------------------------------------------------- catálogo/ACL
do $$
declare v_proc pg_proc%rowtype;
begin
  select * into strict v_proc from pg_proc where oid=to_regprocedure('public.zt_save_work_order_report(uuid,text,uuid)');
  perform pg_temp.lc_check('catalogo_relato_definer_path_vazio',v_proc.prosecdef and exists(
    select 1 from unnest(coalesce(v_proc.proconfig,array[]::text[])) s where s in ('search_path=','search_path=""')),null);
  perform pg_temp.lc_check('catalogo_relato_acl',
    not exists(select 1 from aclexplode(coalesce(v_proc.proacl,acldefault('f',v_proc.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE')
    and not has_function_privilege('anon',v_proc.oid,'EXECUTE')
    and has_function_privilege('authenticated',v_proc.oid,'EXECUTE'),null);

  select * into strict v_proc from pg_proc where oid=to_regprocedure('zt_private.zt_track_work_order_actors()');
  perform pg_temp.lc_check('catalogo_trigger_atores_privado',not v_proc.prosecdef
    and not has_function_privilege('authenticated',v_proc.oid,'EXECUTE')
    and not has_function_privilege('anon',v_proc.oid,'EXECUTE'),null);
  select * into strict v_proc from pg_proc where oid=to_regprocedure('zt_private.zt_skip_duplicate_work_order_report()');
  perform pg_temp.lc_check('catalogo_trigger_relato_privado',not v_proc.prosecdef
    and not has_function_privilege('authenticated',v_proc.oid,'EXECUTE')
    and not has_function_privilege('anon',v_proc.oid,'EXECUTE'),null);

  -- 0096 substitui o corpo sem mudar assinatura, default, modo, search_path nem ACL.
  select * into strict v_proc from pg_proc where oid=to_regprocedure('zt_private.zt_save_work_order(uuid,uuid,jsonb,jsonb)');
  perform pg_temp.lc_check('catalogo_save_os_preservado',v_proc.prosecdef and v_proc.pronargdefaults=1
    and v_proc.proconfig @> array['search_path=public']::text[]
    and not has_function_privilege('authenticated',v_proc.oid,'EXECUTE'),array_to_string(v_proc.proconfig,','));

  perform pg_temp.lc_check('catalogo_triggers_instalados',
    exists(select 1 from pg_trigger where tgname='zt_track_work_order_actors' and tgrelid='public.work_orders'::regclass and tgenabled<>'D')
    and exists(select 1 from pg_trigger where tgname='zt_skip_duplicate_work_order_report' and tgrelid='public.work_order_reports'::regclass and tgenabled<>'D')
    and to_regclass('public.uq_work_order_reports_request') is not null,null);
end $$;

-- ---------------------------------------------------------------- fixtures portáveis
with candidates as (
  select u.id, row_number() over (order by u.id) as rn
  from auth.users u join public.profiles p on p.id=u.id
  where not coalesce(p.is_platform_admin,false)
)
insert into zt_lc(owner_a,tech_a,owner_b,tech_x,company_a,company_b,client_a,client_a2,client_b,req_1)
select (select id from candidates where rn=1),(select id from candidates where rn=2),
       (select id from candidates where rn=3),(select id from candidates where rn=4),
       gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid();

do $$
begin
  if exists(select 1 from zt_lc where owner_a is null or tech_a is null or owner_b is null or tech_x is null) then
    raise exception 'LC_NEEDS_FOUR_AUTH_USERS';
  end if;
end $$;

select set_config('request.jwt.claim.sub',(select owner_a::text from zt_lc),true);
insert into public.companies(id,name,has_team)
select company_a,'__LC_A__',true from zt_lc
union all select company_b,'__LC_B__',true from zt_lc;
insert into public.subscriptions(company_id,status,current_period_start,current_period_end)
select company_a,'trial'::public.zt_sub_status,current_date,current_date+14 from zt_lc
union all select company_b,'trial'::public.zt_sub_status,current_date,current_date+14 from zt_lc
on conflict (company_id) do update set status=excluded.status,
  current_period_start=excluded.current_period_start,current_period_end=excluded.current_period_end;
insert into public.company_members(company_id,user_id,role,status)
select company_a,owner_a,'owner'::public.zt_role,'active'::public.zt_member_status from zt_lc
union all select company_a,tech_a,'technician'::public.zt_role,'active'::public.zt_member_status from zt_lc
union all select company_a,tech_x,'technician'::public.zt_role,'active'::public.zt_member_status from zt_lc
union all select company_b,owner_b,'owner'::public.zt_role,'active'::public.zt_member_status from zt_lc;
insert into public.clients(id,company_id,name,address)
select client_a,company_a,'__LC_CLIENT_A__','Rua A, 1' from zt_lc
union all select client_a2,company_a,'__LC_CLIENT_A2__','Rua A2, 2' from zt_lc
union all select client_b,company_b,'__LC_CLIENT_B__','Rua B, 3' from zt_lc;

set local role authenticated;
do $$
declare t zt_lc%rowtype;
begin
  select * into t from zt_lc;
  update zt_lc set
    loc_a1=(public.zt_create_client_location_for_quote(t.client_a,'Bloco A','Rua A, 1 · Bloco A')->>'id')::uuid,
    loc_a2=(public.zt_create_client_location_for_quote(t.client_a2,'Casa',null)->>'id')::uuid;
end $$;
reset role;
select set_config('request.jwt.claim.sub',(select owner_b::text from zt_lc),true);
set local role authenticated;
update zt_lc set loc_b=(public.zt_create_client_location_for_quote(client_b,'Sede B',null)->>'id')::uuid;
reset role;

-- ---------------------------------------------------------------- 0096: local na OS direta
select set_config('request.jwt.claim.sub',(select owner_a::text from zt_lc),true);
set local role authenticated;
do $$
declare t zt_lc%rowtype; s text; v uuid;
begin
  select * into t from zt_lc;
  v:=public.zt_save_work_order_idempotent(t.company_a,null,gen_random_uuid(),
    jsonb_build_object('client_id',t.client_a,'client_location_id',t.loc_a1,'assigned_to',t.tech_a,'status','scheduled',
      'scheduled_date',current_date,'service_place','Bloco A','request','__LC_WO_LOC__'),'[]'::jsonb);
  update zt_lc set wo_loc=v;
  perform pg_temp.lc_check('os_direta_grava_local',(select client_location_id from public.work_orders where id=v)=t.loc_a1,null);

  s:=pg_temp.lc_save_wo_state(t.company_a,null,jsonb_build_object('client_id',t.client_a,'client_location_id',t.loc_a2));
  perform pg_temp.lc_check('local_de_outro_cliente_rejeitado',s='23503',s);
  s:=pg_temp.lc_save_wo_state(t.company_a,null,jsonb_build_object('client_id',t.client_a,'client_location_id',t.loc_b));
  perform pg_temp.lc_check('local_de_outra_empresa_rejeitado',s='23503',s);

  perform public.zt_save_work_order_idempotent(t.company_a,v,gen_random_uuid(),
    jsonb_build_object('client_id',t.client_a,'assigned_to',t.tech_a,'status','scheduled','scheduled_date',current_date,'request','__LC_WO_LOC__'),'[]'::jsonb);
  perform pg_temp.lc_check('edicao_sem_chave_preserva_local',(select client_location_id from public.work_orders where id=v)=t.loc_a1,null);

  perform public.zt_save_work_order_idempotent(t.company_a,v,gen_random_uuid(),
    jsonb_build_object('client_id',t.client_a,'client_location_id','','assigned_to',t.tech_a,'status','scheduled','scheduled_date',current_date),'[]'::jsonb);
  perform pg_temp.lc_check('edicao_com_chave_vazia_limpa',(select client_location_id from public.work_orders where id=v) is null,null);

  perform public.zt_save_work_order_idempotent(t.company_a,v,gen_random_uuid(),
    jsonb_build_object('client_id',t.client_a,'client_location_id',t.loc_a1,'assigned_to',t.tech_a,'status','scheduled','scheduled_date',current_date),'[]'::jsonb);
  perform pg_temp.lc_check('edicao_com_chave_define_local',(select client_location_id from public.work_orders where id=v)=t.loc_a1,null);

  s:=pg_temp.lc_save_wo_state(t.company_a,v,jsonb_build_object('client_id',t.client_a2,'client_location_id',t.loc_a1,'assigned_to',t.tech_a));
  perform pg_temp.lc_check('troca_cliente_com_local_antigo_rejeitada',s='23503'
    and (select client_location_id from public.work_orders where id=v)=t.loc_a1,s);

  perform public.zt_save_work_order_idempotent(t.company_a,v,gen_random_uuid(),
    jsonb_build_object('client_id',t.client_a2,'assigned_to',t.tech_a,'status','scheduled','scheduled_date',current_date),'[]'::jsonb);
  perform pg_temp.lc_check('troca_cliente_sem_chave_limpa_local',(select client_location_id from public.work_orders where id=v) is null,null);

  perform public.zt_save_work_order_idempotent(t.company_a,v,gen_random_uuid(),
    jsonb_build_object('client_id',t.client_a,'client_location_id',t.loc_a1,'assigned_to',t.tech_a,'status','scheduled','scheduled_date',current_date),'[]'::jsonb);
end $$;
reset role;

select set_config('request.jwt.claim.sub',(select tech_a::text from zt_lc),true);
set local role authenticated;
do $$
declare t zt_lc%rowtype; s text;
begin
  select * into t from zt_lc;
  s:=pg_temp.lc_save_wo_state(t.company_a,null,jsonb_build_object('client_id',t.client_a,'client_location_id',t.loc_a1));
  perform pg_temp.lc_check('tecnico_nao_cria_os_direta',s='42501',s);
end $$;
reset role;

-- ---------------------------------------------------------------- 0094: atores do ciclo de vida
select set_config('request.jwt.claim.sub',(select owner_a::text from zt_lc),true);
set local role authenticated;
do $$
declare t zt_lc%rowtype; w public.work_orders%rowtype; v_id uuid:=gen_random_uuid();
begin
  select * into t from zt_lc;
  update zt_lc set
    wo_life=public.zt_save_work_order_idempotent(t.company_a,null,gen_random_uuid(),
      jsonb_build_object('client_id',t.client_a,'assigned_to',t.tech_a,'status','scheduled','scheduled_date',current_date,'request','__LC_WO_LIFE__'),
      jsonb_build_array(jsonb_build_object('kind','free','name','Serviço ciclo','quantity',1,'unit_price',80))),
    wo_report=public.zt_save_work_order_idempotent(t.company_a,null,gen_random_uuid(),
      jsonb_build_object('client_id',t.client_a,'assigned_to',t.tech_a,'status','in_progress','request','__LC_WO_REPORT__'),'[]'::jsonb);
  select * into w from public.work_orders where id=(select wo_life from zt_lc);
  perform pg_temp.lc_check('atores_nulos_na_criacao',w.started_at is null and w.started_by is null and w.completed_by is null,null);

  insert into public.work_orders(id,company_id,number,client_id,assigned_to,status,started_at,started_by,completed_by)
  values(v_id,t.company_a,'__LC-FORGED-'||left(v_id::text,8),t.client_a,t.tech_a,'scheduled',now()-interval '3 days',t.tech_a,t.tech_a);
  update zt_lc set wo_forged=v_id;
  select * into w from public.work_orders where id=v_id;
  perform pg_temp.lc_check('insert_direto_nao_forja_atores',w.started_at is null and w.started_by is null and w.completed_by is null,
    row(w.started_at,w.started_by,w.completed_by)::text);
end $$;
reset role;

select set_config('request.jwt.claim.sub',(select tech_a::text from zt_lc),true);
set local role authenticated;
do $$
declare t zt_lc%rowtype; w public.work_orders%rowtype;
begin
  select * into t from zt_lc;
  update public.work_orders set started_by=t.owner_a,completed_by=t.owner_a,started_at=now()-interval '2 days' where id=t.wo_life;
  select * into w from public.work_orders where id=t.wo_life;
  perform pg_temp.lc_check('tecnico_nao_forja_atores',w.started_at is null and w.started_by is null and w.completed_by is null,
    row(w.started_at,w.started_by,w.completed_by)::text);

  update public.work_orders set status='in_progress' where id=t.wo_life;
  select * into w from public.work_orders where id=t.wo_life;
  perform pg_temp.lc_check('inicio_registra_tecnico',w.started_by=t.tech_a and w.started_at is not null and w.completed_by is null,
    row(w.started_at,w.started_by)::text);
end $$;
reset role;

select set_config('request.jwt.claim.sub',(select owner_a::text from zt_lc),true);
set local role authenticated;
do $$
declare t zt_lc%rowtype; w0 public.work_orders%rowtype; w public.work_orders%rowtype;
begin
  select * into t from zt_lc;
  select * into w0 from public.work_orders where id=t.wo_life;
  update public.work_orders set status='scheduled' where id=t.wo_life;
  update public.work_orders set status='in_progress' where id=t.wo_life;
  select * into w from public.work_orders where id=t.wo_life;
  perform pg_temp.lc_check('reinicio_preserva_primeiro_inicio',w.started_by=t.tech_a and w.started_at=w0.started_at,null);

  perform public.zt_finalize_work_order_with_warranty_overrides(t.wo_life,null,null,null,7,'[]'::jsonb,'[]'::jsonb,null);
  select * into w from public.work_orders where id=t.wo_life;
  perform pg_temp.lc_check('conclusao_registra_proprietario',w.status='done' and w.completed_by=t.owner_a and w.started_by=t.tech_a,
    row(w.status,w.completed_by)::text);

  update public.work_orders set completed_by=t.tech_a,started_by=t.owner_a where id=t.wo_life;
  select * into w from public.work_orders where id=t.wo_life;
  perform pg_temp.lc_check('proprietario_nao_forja_atores',w.completed_by=t.owner_a and w.started_by=t.tech_a,null);
end $$;
reset role;

-- ---------------------------------------------------------------- 0095: relato sem duplicação
select set_config('request.jwt.claim.sub',(select tech_a::text from zt_lc),true);
set local role authenticated;
do $$
declare t zt_lc%rowtype; r jsonb; s text; v_id uuid;
begin
  select * into t from zt_lc;
  r:=public.zt_save_work_order_report(t.wo_report,'  Relato A: troca do sensor  ',t.req_1);
  update zt_lc set report_1=(r->>'id')::uuid;
  perform pg_temp.lc_check('relato_salvo_aparado',r->>'body'='Relato A: troca do sensor' and (r->>'author_id')::uuid=t.tech_a
    and (r->>'request_id')::uuid=t.req_1 and r->>'entry_type'='report',r::text);

  r:=public.zt_save_work_order_report(t.wo_report,'Relato A: troca do sensor',t.req_1);
  perform pg_temp.lc_check('retry_mesmo_request_mesma_linha',(r->>'id')::uuid=(select report_1 from zt_lc)
    and pg_temp.lc_report_count(t.wo_report)=1,r->>'id');
  s:=pg_temp.lc_report_state(t.wo_report,'Outro texto',t.req_1);
  perform pg_temp.lc_check('request_reusado_com_outro_texto',s='23505',s);

  r:=public.zt_save_work_order_report(t.wo_report,'Relato A: troca do sensor',gen_random_uuid());
  perform pg_temp.lc_check('texto_identico_nao_duplica',(r->>'id')::uuid=(select report_1 from zt_lc)
    and pg_temp.lc_report_count(t.wo_report)=1,r->>'id');

  r:=public.zt_save_work_order_report(t.wo_report,'Relato B: teste final',gen_random_uuid());
  perform pg_temp.lc_check('novo_texto_cria_linha',(r->>'id')::uuid<>(select report_1 from zt_lc)
    and pg_temp.lc_report_count(t.wo_report)=2,null);

  -- Caminho legado (insert direto): duplicata consecutiva é descartada; texto diferente entra.
  insert into public.work_order_reports(work_order_id,company_id,entry_type,body,author_id)
  values(t.wo_report,t.company_a,'report','Relato B: teste final',t.tech_a);
  perform pg_temp.lc_check('insert_direto_identico_ignorado',pg_temp.lc_report_count(t.wo_report)=2,null);
  insert into public.work_order_reports(work_order_id,company_id,entry_type,body,author_id)
  values(t.wo_report,t.company_a,'report','Relato C: ajuste',t.tech_a);
  perform pg_temp.lc_check('insert_direto_diferente_aceito',pg_temp.lc_report_count(t.wo_report)=3,null);

  s:=pg_temp.lc_report_state(t.wo_report,'   ',gen_random_uuid());
  perform pg_temp.lc_check('relato_vazio_rejeitado',s='22023',s);
  s:=pg_temp.lc_report_state(t.wo_report,repeat('r',10001),gen_random_uuid());
  perform pg_temp.lc_check('relato_longo_rejeitado',s='22023',s);
  s:=pg_temp.lc_report_state(t.wo_report,'Sem request',null);
  perform pg_temp.lc_check('relato_sem_request_rejeitado',s='22023',s);
end $$;
reset role;

select set_config('request.jwt.claim.sub',(select tech_x::text from zt_lc),true);
set local role authenticated;
do $$
declare t zt_lc%rowtype; s text;
begin
  select * into t from zt_lc;
  s:=pg_temp.lc_report_state(t.wo_report,'Relato intruso',gen_random_uuid());
  perform pg_temp.lc_check('tecnico_nao_atribuido_negado',s='42501',s);
end $$;
reset role;
select set_config('request.jwt.claim.sub',(select owner_b::text from zt_lc),true);
set local role authenticated;
do $$
declare t zt_lc%rowtype; s text;
begin
  select * into t from zt_lc;
  s:=pg_temp.lc_report_state(t.wo_report,'Relato de outra empresa',gen_random_uuid());
  perform pg_temp.lc_check('outra_empresa_negada',s='42501',s);
end $$;
reset role;

-- Finalização com o mesmo texto do último relato não duplica; conclusão registra o técnico.
select set_config('request.jwt.claim.sub',(select tech_a::text from zt_lc),true);
set local role authenticated;
do $$
declare t zt_lc%rowtype; s text; w public.work_orders%rowtype;
begin
  select * into t from zt_lc;
  perform public.zt_finalize_work_order_with_warranty_overrides(t.wo_report,'Relato C: ajuste',null,null,7,'[]'::jsonb,'[]'::jsonb,null);
  select * into w from public.work_orders where id=t.wo_report;
  perform pg_temp.lc_check('finalizacao_nao_duplica_relato',w.status='done' and pg_temp.lc_report_count(t.wo_report)=3,
    pg_temp.lc_report_count(t.wo_report)::text);
  perform pg_temp.lc_check('conclusao_registra_tecnico',w.completed_by=t.tech_a,w.completed_by::text);
  s:=pg_temp.lc_report_state(t.wo_report,'Relato depois de concluir',gen_random_uuid());
  perform pg_temp.lc_check('tecnico_os_concluida_negado',s='42501',s);
end $$;
reset role;

select set_config('request.jwt.claim.sub',(select owner_a::text from zt_lc),true);
set local role authenticated;
do $$
declare t zt_lc%rowtype; s text;
begin
  select * into t from zt_lc;
  s:=pg_temp.lc_report_state(t.wo_report,'Observação do proprietário após conclusão',gen_random_uuid());
  perform pg_temp.lc_check('proprietario_registra_apos_conclusao',s='ok' and pg_temp.lc_report_count(t.wo_report)=4,s);
  update public.company_members set status='disabled' where company_id=t.company_a and user_id=t.tech_a;
end $$;
reset role;

-- Técnico desativado perde a escrita imediatamente.
select set_config('request.jwt.claim.sub',(select tech_a::text from zt_lc),true);
set local role authenticated;
do $$
declare t zt_lc%rowtype; s text;
begin
  select * into t from zt_lc;
  s:=pg_temp.lc_report_state(t.wo_loc,'Relato após desativação',gen_random_uuid());
  perform pg_temp.lc_check('tecnico_desativado_negado',s='42501',s);
end $$;
reset role;

set local role anon;
do $$
declare s text;
begin
  s:=pg_temp.lc_report_state(gen_random_uuid(),'Anônimo',gen_random_uuid());
  perform pg_temp.lc_check('anon_nao_executa',s='42501',s);
end $$;
reset role;

do $$
declare v_failures text;
begin
  select string_agg(name||' => '||coalesce(detail,''),E'\n' order by name) into v_failures
  from zt_lc_results where not ok;
  if v_failures is not null then raise exception 'WORK_ORDER_LIFECYCLE_REGRESSION_FAILED%', E'\n'||v_failures; end if;
  if (select count(*) from zt_lc_results)<>40 then
    raise exception 'WORK_ORDER_LIFECYCLE_REGRESSION_INCOMPLETE: % checks', (select count(*) from zt_lc_results);
  end if;
end $$;

select 'BLOCKS34_0094_0096_WORK_ORDER_LIFECYCLE' as test, count(*) as checks, bool_and(ok) as all_ok from zt_lc_results;

rollback;
