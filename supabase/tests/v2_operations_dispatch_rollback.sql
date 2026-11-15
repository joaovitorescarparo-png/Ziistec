-- ZiisTec OPERATIONS DISPATCH V1 (0116) — distribuição, agenda e isolamento.
-- Sem responsável -> técnico A -> técnico A2 -> proprietário -> sem responsável;
-- técnico desativado, outra empresa, OS inexistente, OS concluída e pedido
-- repetido ficam negados ou não reaplicam; conflito de horário AVISA sem travar;
-- o técnico não distribui nem recebe o quadro, e o quadro não traz financeiro.
-- Usa as identidades de ci_local_seed.sql. Destino: SOMENTE CI descartável.
-- Tudo termina em ROLLBACK.

begin;

create temp table zt_ops_results (name text primary key, ok boolean not null, detail text) on commit drop;
grant select, insert, update on zt_ops_results to authenticated, anon;

create function pg_temp.ops_check(p_name text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into zt_ops_results(name,ok,detail) values(p_name,coalesce(p_ok,false),left(p_detail,500));
$$;

create function pg_temp.ops_state(p_sql text)
returns text language plpgsql as $$
begin
  execute p_sql; return 'ok';
exception when others then return sqlstate; end $$;

create function pg_temp.ops_count(p_sql text)
returns bigint language plpgsql as $$
declare n bigint;
begin
  execute 'select count(*) from ('||p_sql||') q' into n; return n;
exception when others then return -1; end $$;

create function pg_temp.ops_as(p_uid uuid)
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claim.sub',p_uid::text,true);
  perform set_config('request.jwt.claims',json_build_object('sub',p_uid,'role','authenticated','aal','aal1')::text,true);
  set local role authenticated;
end $$;

create function pg_temp.ops_anon()
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims','',true);
  set local role anon;
end $$;

grant execute on function pg_temp.ops_check(text,boolean,text), pg_temp.ops_state(text),
  pg_temp.ops_count(text), pg_temp.ops_as(uuid), pg_temp.ops_anon() to authenticated, anon;

-- ---------------------------------------------------------------- fixtures
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal1"}',true);

-- Segundo técnico da Empresa A e um técnico desativado, para a matriz completa.
insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
  ('00000000-0000-0000-0000-000000000000','10000000-0000-4000-8000-0000000000a2','authenticated','authenticated','ci-tech-a2@example.invalid','',now(),'{}'::jsonb,'{}'::jsonb,now(),now()),
  ('00000000-0000-0000-0000-000000000000','10000000-0000-4000-8000-0000000000d1','authenticated','authenticated','ci-tech-off@example.invalid','',now(),'{}'::jsonb,'{}'::jsonb,now(),now())
on conflict (id) do nothing;
insert into public.profiles(id,full_name,email) values
  ('10000000-0000-4000-8000-0000000000a2','CI Technician A2','ci-tech-a2@example.invalid'),
  ('10000000-0000-4000-8000-0000000000d1','CI Technician Off','ci-tech-off@example.invalid')
on conflict (id) do nothing;
insert into public.company_members(company_id,user_id,role,status,job_title) values
  ('20000000-0000-0000-0000-000000000001','10000000-0000-4000-8000-0000000000a2','technician','active','CI Tech A2'),
  ('20000000-0000-0000-0000-000000000001','10000000-0000-4000-8000-0000000000d1','technician','disabled','CI Tech Off')
on conflict (company_id,user_id) do update set role=excluded.role,status=excluded.status;

insert into public.clients(id,company_id,person_type,name,phone,address,tax_id)
values ('a1000000-0000-4000-8000-000000000001','20000000-0000-0000-0000-000000000001','PJ',
        'Edifício Plaza Demo','11999990000','Rua Reservada 10','12345678000199');
insert into public.client_locations(id,company_id,client_id,name,location_key)
values ('a1000000-0000-4000-8000-00000000d001','20000000-0000-0000-0000-000000000001',
        'a1000000-0000-4000-8000-000000000001','Garagem / Rampa','garagem / rampa');

-- OS sem responsável, com valor aprovado (para provar que valor não vaza no quadro).
insert into public.work_orders(id,company_id,number,client_id,client_location_id,status,request,
  scheduled_date,scheduled_time,approved_total,extra_cost)
values ('a1000000-0000-4000-8000-00000000b001','20000000-0000-0000-0000-000000000001','CI-OPS-001',
        'a1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-00000000d001','unscheduled',
        'Portão da rampa não está abrindo',current_date+1,'09:00',1234.56,99.90);
-- Segunda OS no MESMO horário, para o conflito de agenda.
insert into public.work_orders(id,company_id,number,client_id,status,request,scheduled_date,scheduled_time,assigned_to)
values ('a1000000-0000-4000-8000-00000000b002','20000000-0000-0000-0000-000000000001','CI-OPS-002',
        'a1000000-0000-4000-8000-000000000001','scheduled','Revisão da portaria',current_date+1,'09:00',
        '10000000-0000-0000-0000-000000000003');
-- OS atrasada e OS concluída.
insert into public.work_orders(id,company_id,number,client_id,status,request,scheduled_date,scheduled_time,assigned_to)
values ('a1000000-0000-4000-8000-00000000b003','20000000-0000-0000-0000-000000000001','CI-OPS-003',
        'a1000000-0000-4000-8000-000000000001','scheduled','Atrasada de ontem',current_date-3,'08:00',
        '10000000-0000-0000-0000-000000000003');

-- OS da Empresa B, para o teste cruzado.
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal1"}',true);
insert into public.clients(id,company_id,person_type,name)
values ('a1000000-0000-4000-8000-000000000002','20000000-0000-0000-0000-000000000002','PF','Cliente B Ops');
insert into public.work_orders(id,company_id,number,client_id,status,request)
values ('a1000000-0000-4000-8000-00000000b009','20000000-0000-0000-0000-000000000002','CI-OPS-009',
        'a1000000-0000-4000-8000-000000000002','unscheduled','Portão da empresa B');

select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal1"}',true);

-- ============================================================= ANÔNIMO = 0
do $$
begin
  perform pg_temp.ops_anon();
  perform pg_temp.ops_check('anon_nao_distribui',
    pg_temp.ops_state($q$select public.zt_assign_work_order('a1000000-0000-4000-8000-00000000b001','10000000-0000-0000-0000-000000000003',gen_random_uuid())$q$)<>'ok',null);
  perform pg_temp.ops_check('anon_nao_le_quadro',
    pg_temp.ops_state($q$select public.zt_operations_board('20000000-0000-0000-0000-000000000001',current_date,current_date+7)$q$)<>'ok',null);
  perform pg_temp.ops_check('anon_nao_le_auditoria',
    pg_temp.ops_count('select 1 from public.work_order_dispatch_events')=-1,null);
end $$;
reset role;

-- =================================================== matriz de distribuição
do $$
declare
  v jsonb;
  v_wo uuid := 'a1000000-0000-4000-8000-00000000b001';
begin
  perform pg_temp.ops_as('10000000-0000-0000-0000-000000000001');

  -- sem responsável -> técnico A
  v := public.zt_assign_work_order(v_wo,'10000000-0000-0000-0000-000000000003','a1000000-0000-4000-8000-00000000f001');
  perform pg_temp.ops_check('sem_responsavel_para_tecnico_a', v->>'action'='assign', v::text);
  perform pg_temp.ops_check('conflito_apenas_avisa_sem_travar', (v->>'conflicts')::int>=1, v::text);

  -- pedido repetido não reaplica
  v := public.zt_assign_work_order(v_wo,'10000000-0000-0000-0000-000000000003','a1000000-0000-4000-8000-00000000f001');
  perform pg_temp.ops_check('pedido_repetido_nao_reaplica', (v->>'replayed')::boolean, v::text);
  perform pg_temp.ops_check('pedido_repetido_nao_duplica_evento',
    pg_temp.ops_count($q$select 1 from public.work_order_dispatch_events where client_request_id='a1000000-0000-4000-8000-00000000f001'$q$)=1,null);

  -- mesmo pedido com outro alvo é recusado
  perform pg_temp.ops_check('mesmo_pedido_com_outro_alvo_recusado',
    pg_temp.ops_state(format($q$select public.zt_assign_work_order(%L,%L,'a1000000-0000-4000-8000-00000000f001')$q$,
      v_wo,'10000000-0000-4000-8000-0000000000a2'))='23505',null);

  -- técnico A -> técnico A2
  v := public.zt_assign_work_order(v_wo,'10000000-0000-4000-8000-0000000000a2','a1000000-0000-4000-8000-00000000f002');
  perform pg_temp.ops_check('tecnico_a_para_tecnico_a2', v->>'action'='reassign', v::text);

  -- técnico A2 -> proprietário (o dono pode ser executor)
  v := public.zt_assign_work_order(v_wo,'10000000-0000-0000-0000-000000000001','a1000000-0000-4000-8000-00000000f003');
  perform pg_temp.ops_check('tecnico_a2_para_proprietario', v->>'action'='reassign', v::text);
  perform pg_temp.ops_check('proprietario_e_executor_valido',
    (select assigned_to from public.work_orders where id=v_wo)='10000000-0000-0000-0000-000000000001',null);

  -- proprietário -> sem responsável
  v := public.zt_assign_work_order(v_wo,null,'a1000000-0000-4000-8000-00000000f004');
  perform pg_temp.ops_check('proprietario_para_sem_responsavel', v->>'action'='unassign', v::text);
  perform pg_temp.ops_check('sem_responsavel_gravado',
    (select assigned_to is null from public.work_orders where id=v_wo),null);

  -- técnico desativado não recebe
  perform pg_temp.ops_check('tecnico_desativado_nao_recebe',
    pg_temp.ops_state(format($q$select public.zt_assign_work_order(%L,'10000000-0000-4000-8000-0000000000d1',gen_random_uuid())$q$,v_wo))='23503',null);

  -- quem não é membro não recebe
  perform pg_temp.ops_check('nao_membro_nao_recebe',
    pg_temp.ops_state(format($q$select public.zt_assign_work_order(%L,'10000000-0000-0000-0000-000000000002',gen_random_uuid())$q$,v_wo))='23503',null);

  -- OS inexistente
  perform pg_temp.ops_check('os_inexistente_recusada',
    pg_temp.ops_state($q$select public.zt_assign_work_order(gen_random_uuid(),'10000000-0000-0000-0000-000000000003',gen_random_uuid())$q$)='P0002',null);

  -- OS de outra empresa
  perform pg_temp.ops_check('os_de_outra_empresa_recusada',
    pg_temp.ops_state($q$select public.zt_assign_work_order('a1000000-0000-4000-8000-00000000b009','10000000-0000-0000-0000-000000000003',gen_random_uuid())$q$)='42501',null);

  -- origem inválida
  perform pg_temp.ops_check('origem_invalida_recusada',
    pg_temp.ops_state(format($q$select public.zt_assign_work_order(%L,'10000000-0000-0000-0000-000000000003',gen_random_uuid(),'telepatia')$q$,v_wo))='22023',null);

  -- pedido obrigatório
  perform pg_temp.ops_check('pedido_obrigatorio',
    pg_temp.ops_state(format($q$select public.zt_assign_work_order(%L,'10000000-0000-0000-0000-000000000003',null)$q$,v_wo))='22023',null);
end $$;
reset role;

-- ============================================================ agendamento
do $$
declare
  v jsonb;
  v_wo uuid := 'a1000000-0000-4000-8000-00000000b001';
begin
  perform pg_temp.ops_as('10000000-0000-0000-0000-000000000001');

  v := public.zt_schedule_work_order(v_wo,current_date,'14:00','a1000000-0000-4000-8000-00000000f010');
  perform pg_temp.ops_check('agenda_para_hoje', v->>'action'='schedule' and (v->>'scheduled_date')::date=current_date, v::text);
  perform pg_temp.ops_check('status_vai_para_agendada',
    (select status='scheduled' from public.work_orders where id=v_wo),null);

  v := public.zt_schedule_work_order(v_wo,current_date+1,'09:00','a1000000-0000-4000-8000-00000000f011');
  perform pg_temp.ops_check('agenda_para_amanha', (v->>'scheduled_date')::date=current_date+1, v::text);

  v := public.zt_schedule_work_order(v_wo,null,null,'a1000000-0000-4000-8000-00000000f012');
  perform pg_temp.ops_check('remove_agendamento', v->>'action'='unschedule', v::text);
  perform pg_temp.ops_check('status_volta_para_sem_agendamento',
    (select status='unscheduled' and scheduled_date is null from public.work_orders where id=v_wo),null);

  perform pg_temp.ops_check('hora_sem_data_recusada',
    pg_temp.ops_state(format($q$select public.zt_schedule_work_order(%L,null,'09:00',gen_random_uuid())$q$,v_wo))='22023',null);

  -- conflito é contado, não bloqueado
  perform pg_temp.ops_check('conflito_contado_para_o_mesmo_horario',
    public.zt_work_order_schedule_conflicts('a1000000-0000-4000-8000-00000000b001',
      '10000000-0000-0000-0000-000000000003',current_date+1,'09:00')>=1,null);
  perform pg_temp.ops_check('sem_conflito_em_horario_livre',
    public.zt_work_order_schedule_conflicts('a1000000-0000-4000-8000-00000000b001',
      '10000000-0000-0000-0000-000000000003',current_date+1,'23:00')=0,null);

  -- prioridade
  perform pg_temp.ops_check('prioridade_urgente',
    (public.zt_set_work_order_priority(v_wo,'urgent','a1000000-0000-4000-8000-00000000f013')->>'priority')='urgent',null);
  perform pg_temp.ops_check('prioridade_invalida_recusada',
    pg_temp.ops_state(format($q$select public.zt_set_work_order_priority(%L,'altissima',gen_random_uuid())$q$,v_wo))='22023',null);
end $$;
reset role;

-- ====================================== OS concluída sai da distribuição
do $$
begin
  update public.work_orders set status='done', completed_at=now()
   where id='a1000000-0000-4000-8000-00000000b003';
  perform pg_temp.ops_as('10000000-0000-0000-0000-000000000001');
  perform pg_temp.ops_check('os_concluida_nao_entra_na_distribuicao',
    pg_temp.ops_state($q$select public.zt_assign_work_order('a1000000-0000-4000-8000-00000000b003','10000000-0000-0000-0000-000000000003',gen_random_uuid())$q$)='23514',null);
end $$;
reset role;

-- ============================ técnico não distribui e não recebe o quadro
do $$
begin
  perform pg_temp.ops_as('10000000-0000-0000-0000-000000000003');

  perform pg_temp.ops_check('tecnico_nao_distribui',
    pg_temp.ops_state($q$select public.zt_assign_work_order('a1000000-0000-4000-8000-00000000b001','10000000-0000-0000-0000-000000000003',gen_random_uuid())$q$)='42501',null);
  perform pg_temp.ops_check('tecnico_nao_agenda_pelo_despacho',
    pg_temp.ops_state($q$select public.zt_schedule_work_order('a1000000-0000-4000-8000-00000000b001',current_date,'10:00',gen_random_uuid())$q$)='42501',null);
  perform pg_temp.ops_check('tecnico_nao_muda_prioridade',
    pg_temp.ops_state($q$select public.zt_set_work_order_priority('a1000000-0000-4000-8000-00000000b001','urgent',gen_random_uuid())$q$)='42501',null);
  perform pg_temp.ops_check('tecnico_nao_recebe_quadro',
    pg_temp.ops_state($q$select public.zt_operations_board('20000000-0000-0000-0000-000000000001',current_date,current_date+7)$q$)='42501',null);
  perform pg_temp.ops_check('tecnico_nao_le_auditoria_de_despacho',
    pg_temp.ops_count('select 1 from public.work_order_dispatch_events')=0,null);

  -- O técnico também não muda a prioridade por UPDATE direto: o guard da 0116
  -- recusa a própria instrução, mesmo na OS atribuída a ele.
  perform pg_temp.ops_check('tecnico_nao_muda_prioridade_por_update_direto',
    pg_temp.ops_state($q$update public.work_orders set priority='urgent' where id='a1000000-0000-4000-8000-00000000b002'$q$)='42501',null);
  reset role;
  perform pg_temp.ops_check('prioridade_permanece_normal_apos_tentativa',
    (select priority='normal' from public.work_orders where id='a1000000-0000-4000-8000-00000000b002'),null);
end $$;
reset role;

-- ============================== Empresa B não alcança a distribuição da A
do $$
begin
  perform pg_temp.ops_as('10000000-0000-0000-0000-000000000002');
  perform pg_temp.ops_check('owner_b_nao_distribui_os_da_a',
    pg_temp.ops_state($q$select public.zt_assign_work_order('a1000000-0000-4000-8000-00000000b001','10000000-0000-0000-0000-000000000003',gen_random_uuid())$q$)='42501',null);
  perform pg_temp.ops_check('owner_b_nao_le_quadro_da_a',
    pg_temp.ops_state($q$select public.zt_operations_board('20000000-0000-0000-0000-000000000001',current_date,current_date+7)$q$)='42501',null);
  perform pg_temp.ops_check('owner_b_nao_le_auditoria_da_a',
    pg_temp.ops_count($q$select 1 from public.work_order_dispatch_events where company_id='20000000-0000-0000-0000-000000000001'$q$)=0,null);
  perform pg_temp.ops_check('owner_b_nao_consulta_conflito_da_a',
    pg_temp.ops_state($q$select public.zt_work_order_schedule_conflicts('a1000000-0000-4000-8000-00000000b001','10000000-0000-0000-0000-000000000003',current_date,'09:00')$q$)='42501',null);
end $$;
reset role;

-- ================================= o quadro não carrega nada financeiro
do $$
declare
  v_board jsonb;
  v_texto text;
begin
  perform pg_temp.ops_as('10000000-0000-0000-0000-000000000001');
  v_board := public.zt_operations_board('20000000-0000-0000-0000-000000000001',current_date,current_date+7);
  v_texto := v_board::text;

  perform pg_temp.ops_check('quadro_traz_elenco_com_proprietario',
    exists(select 1 from jsonb_array_elements(v_board->'members') m where m->>'role'='owner'),null);
  perform pg_temp.ops_check('quadro_traz_cartoes',
    jsonb_array_length(v_board->'cards')>=1, v_texto);
  perform pg_temp.ops_check('cartao_traz_local_do_cliente',
    exists(select 1 from jsonb_array_elements(v_board->'cards') c where c->>'location_name'='Garagem / Rampa'),null);

  -- valor aprovado e custo existem na OS, mas não saem no quadro
  perform pg_temp.ops_check('quadro_sem_valor_aprovado', position('1234.56' in v_texto)=0, null);
  perform pg_temp.ops_check('quadro_sem_custo_extra', position('99.90' in v_texto)=0, null);
  perform pg_temp.ops_check('quadro_sem_chave_financeira',
    v_texto !~* '(approved_|extra_cost|billing_entry|pending_pricing|price|cost|margin)', null);
  -- nem dado pessoal do cliente além do nome operacional
  perform pg_temp.ops_check('quadro_sem_telefone_do_cliente', position('11999990000' in v_texto)=0, null);
  perform pg_temp.ops_check('quadro_sem_documento_do_cliente', position('12345678000199' in v_texto)=0, null);

  perform pg_temp.ops_check('concluidas_fora_do_quadro_por_padrao',
    not exists(select 1 from jsonb_array_elements(v_board->'cards') c where c->>'status'='done'),null);
  perform pg_temp.ops_check('concluidas_entram_quando_a_tela_pede',
    exists(select 1 from jsonb_array_elements(
      public.zt_operations_board('20000000-0000-0000-0000-000000000001',current_date-7,current_date+7,400,true)->'cards') c
      where c->>'status'='done'),null);
  perform pg_temp.ops_check('atrasada_aparece_mesmo_fora_da_janela',
    jsonb_array_length(public.zt_operations_board('20000000-0000-0000-0000-000000000001',current_date,current_date+1)->'cards')>=1,null);
end $$;
reset role;

-- ====================================== auditoria registra a cadeia inteira
do $$
declare v_acoes text;
begin
  perform pg_temp.ops_as('10000000-0000-0000-0000-000000000001');
  select string_agg(action,',' order by created_at) into v_acoes
    from public.work_order_dispatch_events
   where work_order_id='a1000000-0000-4000-8000-00000000b001';
  perform pg_temp.ops_check('auditoria_registra_a_cadeia',
    v_acoes like 'assign,reassign,reassign,unassign%', v_acoes);
  perform pg_temp.ops_check('auditoria_guarda_de_quem_para_quem',
    exists(select 1 from public.work_order_dispatch_events
            where work_order_id='a1000000-0000-4000-8000-00000000b001'
              and action='reassign'
              and from_assignee='10000000-0000-0000-0000-000000000003'
              and to_assignee='10000000-0000-4000-8000-0000000000a2'),null);
  perform pg_temp.ops_check('auditoria_guarda_autor_e_origem',
    exists(select 1 from public.work_order_dispatch_events
            where work_order_id='a1000000-0000-4000-8000-00000000b001'
              and actor_id='10000000-0000-0000-0000-000000000001' and source='web'),null);
  perform pg_temp.ops_check('auditoria_aceita_origem_do_agente',
    (public.zt_assign_work_order('a1000000-0000-4000-8000-00000000b001',
       '10000000-0000-0000-0000-000000000003',gen_random_uuid(),'whatsapp')->>'action') is not null,null);
  perform pg_temp.ops_check('auditoria_nao_e_gravavel_pelo_navegador',
    pg_temp.ops_state($q$insert into public.work_order_dispatch_events(company_id,work_order_id,action,source)
      values ('20000000-0000-0000-0000-000000000001','a1000000-0000-4000-8000-00000000b001','assign','web')$q$)<>'ok',null);
end $$;
reset role;

-- ================================================ contratos estruturais
do $$
declare v_bad text;
begin
  perform pg_temp.ops_check('tabela_de_auditoria_com_rls',
    (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname='work_order_dispatch_events'),null);

  select string_agg(p.proname,', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public'
     and p.proname in ('zt_assign_work_order','zt_schedule_work_order','zt_set_work_order_priority',
                       'zt_operations_board','zt_work_order_schedule_conflicts')
     and not (p.prosecdef and coalesce(array_to_string(p.proconfig,','),'') like '%search_path=%');
  perform pg_temp.ops_check('rpcs_de_despacho_definer_com_search_path',v_bad is null,v_bad);

  select string_agg(p.proname,', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public'
     and p.proname in ('zt_assign_work_order','zt_schedule_work_order','zt_set_work_order_priority',
                       'zt_operations_board','zt_work_order_schedule_conflicts')
     and has_function_privilege('anon',p.oid,'execute');
  perform pg_temp.ops_check('rpcs_de_despacho_sem_execute_para_anon',v_bad is null,v_bad);

  perform pg_temp.ops_check('auditoria_sem_privilegio_de_escrita_para_authenticated',
    not exists(select 1 from information_schema.role_table_grants
                where grantee='authenticated' and table_name='work_order_dispatch_events'
                  and privilege_type in ('INSERT','UPDATE','DELETE')),null);
  perform pg_temp.ops_check('auditoria_sem_privilegio_para_anon',
    not exists(select 1 from information_schema.role_table_grants
                where grantee='anon' and table_name='work_order_dispatch_events'),null);

  -- nenhuma tabela paralela de escalação foi criada
  perform pg_temp.ops_check('despacho_nao_duplica_a_os',
    not exists(select 1 from information_schema.tables
                where table_schema='public'
                  and table_name in ('work_order_assignments','dispatch_assignments','operations_work_orders')),null);
  perform pg_temp.ops_check('prioridade_na_propria_os',
    exists(select 1 from information_schema.columns
            where table_schema='public' and table_name='work_orders' and column_name='priority'),null);
end $$;

do $$
declare v_failures text;
begin
  select string_agg(name||' => '||coalesce(detail,''),' ; ' order by name) into v_failures
    from zt_ops_results where not ok;
  if v_failures is not null then raise exception 'OPERATIONS_DISPATCH_FAILED: %', v_failures; end if;
  if (select count(*) from zt_ops_results) < 50 then
    raise exception 'OPERATIONS_DISPATCH_INCOMPLETE: % checks',(select count(*) from zt_ops_results);
  end if;
end $$;

select 'OPERATIONS_DISPATCH' as test, count(*) as checks, bool_and(ok) as all_ok from zt_ops_results;

rollback;
