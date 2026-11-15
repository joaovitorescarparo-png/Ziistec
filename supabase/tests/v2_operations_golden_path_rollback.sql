-- ZiisTec OPERATIONS V1 — golden path do despacho.
-- Proprietário abre o quadro, arrasta a OS sem responsável para o Técnico A, o
-- técnico passa a ver a OS, o proprietário move para o Técnico A2, a auditoria
-- registra a cadeia, o comando do agente cria uma OS pela MESMA operação
-- oficial, ela aparece em "Sem responsável" e é distribuída.
-- Usa as identidades de ci_local_seed.sql. SOMENTE CI descartável; ROLLBACK.

begin;

create temp table zt_ogp (name text primary key, ok boolean not null, detail text) on commit drop;
grant select, insert, update on zt_ogp to authenticated, anon;

create function pg_temp.g_check(p_name text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into zt_ogp(name,ok,detail) values(p_name,coalesce(p_ok,false),left(p_detail,500));
$$;
create function pg_temp.g_count(p_sql text) returns bigint language plpgsql as $$
declare n bigint;
begin execute 'select count(*) from ('||p_sql||') q' into n; return n;
exception when others then return -1; end $$;
create function pg_temp.g_as(p_uid uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claim.sub',p_uid::text,true);
  perform set_config('request.jwt.claims',json_build_object('sub',p_uid,'role','authenticated','aal','aal1')::text,true);
  set local role authenticated;
end $$;
grant execute on function pg_temp.g_check(text,boolean,text), pg_temp.g_count(text), pg_temp.g_as(uuid)
  to authenticated, anon;

select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal1"}',true);

insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('00000000-0000-0000-0000-000000000000','10000000-0000-4000-8000-0000000000a2','authenticated','authenticated','ci-tech-a2@example.invalid','',now(),'{}'::jsonb,'{}'::jsonb,now(),now())
on conflict (id) do nothing;
insert into public.profiles(id,full_name,email)
values ('10000000-0000-4000-8000-0000000000a2','CI Technician A2','ci-tech-a2@example.invalid')
on conflict (id) do nothing;
insert into public.company_members(company_id,user_id,role,status,job_title)
values ('20000000-0000-0000-0000-000000000001','10000000-0000-4000-8000-0000000000a2','technician','active','CI Tech A2')
on conflict (company_id,user_id) do update set role='technician',status='active';

insert into public.clients(id,company_id,person_type,name)
values ('b2000000-0000-4000-8000-000000000001','20000000-0000-0000-0000-000000000001','PJ','Edifício Plaza Demo');
insert into public.client_locations(id,company_id,client_id,name,location_key)
values ('b2000000-0000-4000-8000-00000000d001','20000000-0000-0000-0000-000000000001',
        'b2000000-0000-4000-8000-000000000001','Garagem / Rampa','garagem / rampa');

-- 1. OS sem responsável no quadro
insert into public.work_orders(id,company_id,number,client_id,client_location_id,status,request)
values ('b2000000-0000-4000-8000-00000000b001','20000000-0000-0000-0000-000000000001','CI-OGP-001',
        'b2000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-00000000d001','unscheduled',
        'Portão da rampa não está abrindo');

do $$
declare
  v_board jsonb;
  v jsonb;
  v_nova uuid;
begin
  perform pg_temp.g_as('10000000-0000-0000-0000-000000000001');

  -- 2. o proprietário abre o quadro e vê a OS sem responsável
  v_board := public.zt_operations_board('20000000-0000-0000-0000-000000000001',current_date,current_date+7);
  perform pg_temp.g_check('2_quadro_mostra_os_sem_responsavel',
    exists(select 1 from jsonb_array_elements(v_board->'cards') c
            where c->>'number'='CI-OGP-001' and c->'assignee_id'='null'::jsonb), v_board::text);

  -- 3. arrasta para o Técnico A
  v := public.zt_assign_work_order('b2000000-0000-4000-8000-00000000b001',
        '10000000-0000-0000-0000-000000000003','b2000000-0000-4000-8000-00000000f001');
  perform pg_temp.g_check('3_arrasta_para_tecnico_a', v->>'action'='assign', v::text);
end $$;
reset role;

-- 4. o técnico passa a ver a OS atribuída a ele
do $$
begin
  perform pg_temp.g_as('10000000-0000-0000-0000-000000000003');
  perform pg_temp.g_check('4_tecnico_a_ve_a_os_atribuida',
    pg_temp.g_count($q$select 1 from public.work_orders where id='b2000000-0000-4000-8000-00000000b001'$q$)=1,null);
  -- Mais forte que "vem nulo": o técnico não tem privilégio de SELECT na coluna
  -- financeira (0105), então a própria consulta é negada. E priority, que a 0116
  -- acrescentou, precisa continuar legível — senão o app quebraria.
  perform pg_temp.g_check('4b_tecnico_nao_consegue_ler_valor_aprovado',
    pg_temp.g_count($q$select approved_total from public.work_orders where id='b2000000-0000-4000-8000-00000000b001'$q$)=-1,null);
  perform pg_temp.g_check('4c_tecnico_le_prioridade_da_propria_os',
    pg_temp.g_count($q$select priority from public.work_orders where id='b2000000-0000-4000-8000-00000000b001'$q$)=1,null);
end $$;
reset role;

-- 5. o proprietário move para o Técnico A2 e a auditoria registra a cadeia
do $$
declare v jsonb;
begin
  perform pg_temp.g_as('10000000-0000-0000-0000-000000000001');
  v := public.zt_assign_work_order('b2000000-0000-4000-8000-00000000b001',
        '10000000-0000-4000-8000-0000000000a2','b2000000-0000-4000-8000-00000000f002');
  perform pg_temp.g_check('5_move_para_tecnico_a2', v->>'action'='reassign', v::text);
  perform pg_temp.g_check('6_auditoria_registra_a_cadeia',
    (select string_agg(action,',' order by created_at) from public.work_order_dispatch_events
      where work_order_id='b2000000-0000-4000-8000-00000000b001')='assign,reassign',null);
  perform pg_temp.g_check('6b_auditoria_guarda_de_quem_para_quem',
    exists(select 1 from public.work_order_dispatch_events
            where work_order_id='b2000000-0000-4000-8000-00000000b001' and action='reassign'
              and from_assignee='10000000-0000-0000-0000-000000000003'
              and to_assignee='10000000-0000-4000-8000-0000000000a2'),null);
end $$;
reset role;

-- 7-10. o comando do agente cria a OS pela MESMA operação oficial do produto,
-- com origem do agente registrada na distribuição seguinte.
do $$
declare
  v_nova uuid;
  v jsonb;
  v_board jsonb;
begin
  perform pg_temp.g_as('10000000-0000-0000-0000-000000000001');

  v_nova := public.zt_save_work_order_idempotent(
    '20000000-0000-0000-0000-000000000001', null, 'b2000000-0000-4000-8000-00000000f010',
    jsonb_build_object(
      'company_id','20000000-0000-0000-0000-000000000001',
      'client_id','b2000000-0000-4000-8000-000000000001',
      'client_location_id','b2000000-0000-4000-8000-00000000d001',
      'status','scheduled',
      'scheduled_date',(current_date+1)::text,
      'scheduled_time','09:00',
      'request','Portão da rampa não está abrindo',
      'created_by','10000000-0000-0000-0000-000000000001'),
    '[]'::jsonb);
  perform pg_temp.g_check('7_comando_cria_os_pela_operacao_oficial', v_nova is not null, null);
  perform pg_temp.g_check('7b_criacao_idempotente_no_retry',
    public.zt_save_work_order_idempotent(
      '20000000-0000-0000-0000-000000000001', null, 'b2000000-0000-4000-8000-00000000f010',
      jsonb_build_object(
        'company_id','20000000-0000-0000-0000-000000000001',
        'client_id','b2000000-0000-4000-8000-000000000001',
        'status','scheduled','request','Portão da rampa não está abrindo',
        'created_by','10000000-0000-0000-0000-000000000001'),
      '[]'::jsonb) = v_nova, null);

  -- A RPC oficial de criação atribui a OS a quem chama; sem responsável pedido,
  -- o agente desatribui pela MESMA operação oficial (fica auditado como unassign).
  perform pg_temp.g_check('7c_criacao_oficial_atribui_a_quem_chama',
    (select assigned_to='10000000-0000-0000-0000-000000000001' from public.work_orders where id=v_nova), null);
  perform public.zt_assign_work_order(v_nova,null,'b2000000-0000-4000-8000-00000000f0aa'::uuid,'whatsapp');

  -- 8. a OS criada aparece em "Sem responsável" no quadro
  v_board := public.zt_operations_board('20000000-0000-0000-0000-000000000001',current_date,current_date+7);
  perform pg_temp.g_check('8_os_do_agente_aparece_sem_responsavel',
    exists(select 1 from jsonb_array_elements(v_board->'cards') c
            where (c->>'work_order_id')::uuid=v_nova and c->'assignee_id'='null'::jsonb), null);
  perform pg_temp.g_check('8b_cartao_do_agente_tem_data_absoluta',
    exists(select 1 from jsonb_array_elements(v_board->'cards') c
            where (c->>'work_order_id')::uuid=v_nova
              and (c->>'scheduled_date')::date=current_date+1
              and (c->>'scheduled_time') like '09:00%'), null);

  -- 9. o proprietário distribui a OS criada pelo agente, com origem registrada
  v := public.zt_assign_work_order(v_nova,'10000000-0000-0000-0000-000000000003',
        'b2000000-0000-4000-8000-00000000f011','whatsapp');
  perform pg_temp.g_check('9_os_do_agente_distribuida', v->>'action'='assign', v::text);
  perform pg_temp.g_check('9b_origem_do_agente_na_auditoria',
    exists(select 1 from public.work_order_dispatch_events
            where work_order_id=v_nova and source='whatsapp'
              and actor_id='10000000-0000-0000-0000-000000000001'), null);

  -- 10. nada financeiro trafegou pelo quadro em nenhum momento
  perform pg_temp.g_check('10_quadro_sem_chave_financeira',
    v_board::text !~* '(approved_|extra_cost|billing_entry|pending_pricing)', null);
end $$;
reset role;

do $$
declare v_failures text;
begin
  select string_agg(name||' => '||coalesce(detail,''),' ; ' order by name) into v_failures
    from zt_ogp where not ok;
  if v_failures is not null then raise exception 'OPERATIONS_GOLDEN_FAILED: %', v_failures; end if;
  if (select count(*) from zt_ogp) < 12 then
    raise exception 'OPERATIONS_GOLDEN_INCOMPLETE: % checks',(select count(*) from zt_ogp);
  end if;
end $$;

select 'OPERATIONS_GOLDEN_PATH' as test, count(*) as checks, bool_and(ok) as all_ok from zt_ogp;

rollback;
