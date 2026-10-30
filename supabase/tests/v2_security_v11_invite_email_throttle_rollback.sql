-- ZiisTec Segurança V1.1 (SEC-05, 0110) — limite de reenvio do e-mail de convite, decidido no banco.
-- Primeiro envio permitido; reenvio imediato bloqueado (60 s por convite e por destinatário na empresa); outro
-- destinatário não é afetado; outra empresa é isolada (mesmo e-mail em outra empresa não é bloqueado nem revelado);
-- limite de 5 por hora por destinatário e 30 por hora por empresa; somente dono; técnico, usuário sem empresa e anon
-- negados; o registro guarda só o hash do e-mail e não é legível nem gravável pelo navegador.
-- Nenhum e-mail é enviado: a função só reserva ou recusa o envio. Usa as identidades de ci_local_seed.sql.
-- Destino: SOMENTE CI descartável ou homologação. Tudo termina em ROLLBACK.

begin;

create temp table zt_thr_results (name text primary key, ok boolean not null, detail text) on commit drop;
grant select, insert, update on zt_thr_results to authenticated, anon;

create function pg_temp.thr_check(p_name text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into zt_thr_results(name,ok,detail) values(p_name,coalesce(p_ok,false),left(p_detail,500));
$$;

create function pg_temp.thr_state(p_sql text)
returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate;
end $$;

-- Resultado da reserva: 'allowed', 'blocked:<motivo>:<segundos>' ou 'E<sqlstate>'.
create function pg_temp.thr_claim(p_invite uuid)
returns text language plpgsql as $$
declare r jsonb;
begin
  r := public.zt_claim_team_invite_email(p_invite);
  if (r->>'allowed')::boolean then return 'allowed'; end if;
  return 'blocked:' || (r->>'reason') || ':' || (r->>'retryAfterSeconds');
exception when others then
  return 'E' || sqlstate;
end $$;

-- Mensagem do erro de uma reserva negada (para comparar convite inexistente com convite de outra empresa).
create function pg_temp.thr_claim_message(p_invite uuid)
returns text language plpgsql as $$
begin
  perform public.zt_claim_team_invite_email(p_invite);
  return 'sem erro';
exception when others then
  return sqlstate || ':' || sqlerrm;
end $$;

do $$
begin
  if (select count(*) from public.company_members where role='owner' and status='active'
        and (company_id,user_id) in (('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001'),
                                     ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002')))<>2 then
    raise exception 'INVITE_THROTTLE_FIXTURE_MISSING';
  end if;
end $$;

-- ---------------------------------------------------------------- catálogo e ACL
do $$
declare v_fn oid := to_regprocedure('public.zt_claim_team_invite_email(uuid)');
begin
  perform pg_temp.thr_check('funcao_definer_com_search_path_vazio',
    v_fn is not null and (select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid=v_fn), null);
  perform pg_temp.thr_check('funcao_somente_authenticated',
    has_function_privilege('authenticated',v_fn,'EXECUTE') and not has_function_privilege('anon',v_fn,'EXECUTE')
    and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f',p.proowner))) a where p.oid=v_fn and a.grantee=0), null);
  perform pg_temp.thr_check('registro_com_rls_e_sem_policy',
    (select relrowsecurity from pg_class where oid='public.team_invite_email_sends'::regclass)
    and not exists (select 1 from pg_policies where schemaname='public' and tablename='team_invite_email_sends'), null);
  perform pg_temp.thr_check('registro_sem_privilegio_para_navegador',
    not has_table_privilege('authenticated','public.team_invite_email_sends','SELECT')
    and not has_table_privilege('authenticated','public.team_invite_email_sends','INSERT')
    and not has_table_privilege('authenticated','public.team_invite_email_sends','UPDATE')
    and not has_table_privilege('authenticated','public.team_invite_email_sends','DELETE')
    and not has_table_privilege('anon','public.team_invite_email_sends','SELECT')
    and not has_table_privilege('anon','public.team_invite_email_sends','INSERT'), null);
  perform pg_temp.thr_check('registro_nao_depende_do_convite_existir',
    not exists (select 1 from pg_constraint where conrelid='public.team_invite_email_sends'::regclass and contype='f' and confrelid='public.company_invites'::regclass),
    'apagar e recriar o convite não zera o histórico de envios');
  perform pg_temp.thr_check('registro_guarda_so_hash_do_email',
    exists (select 1 from information_schema.columns where table_schema='public' and table_name='team_invite_email_sends' and column_name='email_hash')
    and not exists (select 1 from information_schema.columns where table_schema='public' and table_name='team_invite_email_sends' and column_name in ('email','name','phone')), null);
end $$;

-- ---------------------------------------------------------------- fixtures: convites das empresas A e B
set local session_replication_role = replica;
insert into public.company_invites(id,company_id,email,role,name) values
  ('d1000000-0000-4000-8000-000000000001','20000000-0000-0000-0000-000000000001','ana@example.test','technician','Ana'),
  ('d1000000-0000-4000-8000-000000000002','20000000-0000-0000-0000-000000000001','bruno@example.test','technician','Bruno'),
  ('d1000000-0000-4000-8000-000000000003','20000000-0000-0000-0000-000000000001','ANA@Example.test ','technician','Ana de novo'),
  ('d1000000-0000-4000-8000-000000000004','20000000-0000-0000-0000-000000000001','carla@example.test','technician','Carla'),
  ('d2000000-0000-4000-8000-000000000001','20000000-0000-0000-0000-000000000002','ana@example.test','technician','Ana da empresa B');
set local session_replication_role = origin;

-- ---------------------------------------------------------------- dono da empresa A
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;

do $$
declare v text;
begin
  perform pg_temp.thr_check('primeiro_envio_permitido', pg_temp.thr_claim('d1000000-0000-4000-8000-000000000001')='allowed', null);

  v := pg_temp.thr_claim('d1000000-0000-4000-8000-000000000001');
  perform pg_temp.thr_check('reenvio_imediato_bloqueado_por_intervalo', v ~ '^blocked:cooldown:([1-9]|[1-5][0-9]|60)$', v);

  perform pg_temp.thr_check('reenvio_imediato_repetido_continua_bloqueado',
    pg_temp.thr_claim('d1000000-0000-4000-8000-000000000001') ~ '^blocked:cooldown:' and pg_temp.thr_claim('d1000000-0000-4000-8000-000000000001') ~ '^blocked:cooldown:', null);

  perform pg_temp.thr_check('outro_destinatario_da_mesma_empresa_nao_e_afetado', pg_temp.thr_claim('d1000000-0000-4000-8000-000000000002')='allowed', null);

  -- Recriar o convite (outro id, mesmo e-mail com caixa e espaço diferentes) não zera o intervalo do destinatário.
  v := pg_temp.thr_claim('d1000000-0000-4000-8000-000000000003');
  perform pg_temp.thr_check('convite_recriado_para_o_mesmo_destinatario_continua_bloqueado', v ~ '^blocked:cooldown:', v);

  -- Convite inexistente e convite de outra empresa dão exatamente o mesmo erro: nada revela convites alheios.
  perform pg_temp.thr_check('convite_de_outra_empresa_nega_com_42501', pg_temp.thr_claim('d2000000-0000-4000-8000-000000000001')='E42501', null);
  perform pg_temp.thr_check('convite_inexistente_nega_com_42501', pg_temp.thr_claim('d9999999-0000-4000-8000-000000000001')='E42501', null);
  perform pg_temp.thr_check('erro_identico_para_inexistente_e_de_outra_empresa',
    pg_temp.thr_claim_message('d2000000-0000-4000-8000-000000000001') = pg_temp.thr_claim_message('d9999999-0000-4000-8000-000000000001'),
    pg_temp.thr_claim_message('d2000000-0000-4000-8000-000000000001'));

  -- O registro não é legível nem gravável pelo navegador.
  perform pg_temp.thr_check('dono_nao_le_o_registro', pg_temp.thr_state('select * from public.team_invite_email_sends')='42501', null);
  perform pg_temp.thr_check('dono_nao_apaga_o_registro_para_burlar_o_limite', pg_temp.thr_state('delete from public.team_invite_email_sends')='42501', null);
  perform pg_temp.thr_check('dono_nao_insere_no_registro', pg_temp.thr_state($q$insert into public.team_invite_email_sends(company_id,invite_id,email_hash) values ('20000000-0000-0000-0000-000000000001','d1000000-0000-4000-8000-000000000001',repeat('a',64))$q$)='42501', null);
end $$;

-- ---------------------------------------------------------------- dono da empresa B: mesma pessoa convidada, isolado
reset role;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
do $$
declare v text;
begin
  v := pg_temp.thr_claim('d2000000-0000-4000-8000-000000000001');
  perform pg_temp.thr_check('mesmo_email_em_outra_empresa_nao_e_bloqueado_nem_revelado', v='allowed', v);
  perform pg_temp.thr_check('b_nao_reserva_envio_de_convite_da_empresa_A', pg_temp.thr_claim('d1000000-0000-4000-8000-000000000004')='E42501', null);
end $$;

-- ---------------------------------------------------------------- depois do intervalo o reenvio volta a ser permitido
reset role;
update public.team_invite_email_sends set sent_at = sent_at - interval '61 seconds' where company_id='20000000-0000-0000-0000-000000000001';
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
do $$
begin
  perform pg_temp.thr_check('reenvio_depois_de_61s_permitido', pg_temp.thr_claim('d1000000-0000-4000-8000-000000000001')='allowed', null);
  perform pg_temp.thr_check('e_bloqueia_de_novo_logo_em_seguida', pg_temp.thr_claim('d1000000-0000-4000-8000-000000000001') ~ '^blocked:cooldown:', null);
end $$;

-- ---------------------------------------------------------------- limite por hora do destinatário (5)
do $$
declare i int; v text; v_last text;
begin
  -- Já houve 2 envios para ana@: o 3º, 4º e 5º passam (envelhecendo 61 s entre eles); o 6º cai no limite por hora.
  for i in 1..3 loop
    reset role;
    update public.team_invite_email_sends set sent_at = sent_at - interval '61 seconds' where company_id='20000000-0000-0000-0000-000000000001';
    set local role authenticated;
    v := pg_temp.thr_claim('d1000000-0000-4000-8000-000000000001');
    exit when v <> 'allowed';
  end loop;
  reset role;
  perform pg_temp.thr_check('ate_cinco_envios_por_hora_para_o_mesmo_destinatario', v='allowed'
    and (select count(*) from public.team_invite_email_sends s where s.company_id='20000000-0000-0000-0000-000000000001'
         and s.email_hash=encode(sha256(convert_to('ana@example.test','utf8')),'hex'))=5, v);
  update public.team_invite_email_sends set sent_at = sent_at - interval '61 seconds' where company_id='20000000-0000-0000-0000-000000000001';
  set local role authenticated;
  v_last := pg_temp.thr_claim('d1000000-0000-4000-8000-000000000001');
  perform pg_temp.thr_check('sexto_envio_na_hora_bloqueado_pelo_limite_do_destinatario', v_last ~ '^blocked:recipient_hourly:[0-9]+$', v_last);
  perform pg_temp.thr_check('limite_do_destinatario_nao_bloqueia_outro_destinatario', pg_temp.thr_claim('d1000000-0000-4000-8000-000000000004')='allowed', null);
end $$;

-- ---------------------------------------------------------------- limite por hora da empresa (30)
reset role;
insert into public.team_invite_email_sends(company_id,invite_id,email_hash,sent_by,sent_at)
select '20000000-0000-0000-0000-000000000001', gen_random_uuid(), encode(sha256(convert_to('massa'||g||'@example.test','utf8')),'hex'),
       '10000000-0000-0000-0000-000000000001', now() - interval '10 minutes'
from generate_series(1,30) g;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
do $$
declare v text;
begin
  v := pg_temp.thr_claim('d1000000-0000-4000-8000-000000000002');
  perform pg_temp.thr_check('limite_de_30_por_hora_da_empresa', v ~ '^blocked:company_hourly:([1-9][0-9]{0,3})$', v);
end $$;

-- ---------------------------------------------------------------- empresa B continua livre apesar do limite da A
reset role;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
do $$
begin
  perform pg_temp.thr_check('empresa_B_livre_quando_A_estoura_o_limite',
    pg_temp.thr_claim('d2000000-0000-4000-8000-000000000001') ~ '^blocked:cooldown:', 'B só vê o próprio intervalo de 60 s');
end $$;

-- ---------------------------------------------------------------- técnico, sem empresa e anon
reset role;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
do $$
begin
  perform pg_temp.thr_check('tecnico_negado', pg_temp.thr_claim('d1000000-0000-4000-8000-000000000004')='E42501', null);
end $$;
reset role;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000004',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
do $$
begin
  perform pg_temp.thr_check('usuario_sem_empresa_negado', pg_temp.thr_claim('d1000000-0000-4000-8000-000000000004')='E42501', null);
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','',true);
set local role anon;
do $$
begin
  perform pg_temp.thr_check('anon_negado', pg_temp.thr_state($q$select public.zt_claim_team_invite_email('d1000000-0000-4000-8000-000000000004')$q$)='42501', null);
end $$;
reset role;

-- ---------------------------------------------------------------- privacidade e poda
do $$
begin
  perform pg_temp.thr_check('registro_nao_contem_o_email_em_texto',
    not exists (select 1 from public.team_invite_email_sends s where row_to_json(s)::text ~* 'example\.test|@'), null);
  -- Linhas com mais de um dia saem na próxima reserva da empresa.
  update public.team_invite_email_sends set sent_at = now() - interval '2 days' where company_id='20000000-0000-0000-0000-000000000001' and invite_id <> 'd1000000-0000-4000-8000-000000000001';
  perform set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
end $$;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
do $$
declare v text;
begin
  v := pg_temp.thr_claim('d1000000-0000-4000-8000-000000000004');
  reset role;
  perform pg_temp.thr_check('linhas_com_mais_de_um_dia_sao_podadas',
    not exists (select 1 from public.team_invite_email_sends where company_id='20000000-0000-0000-0000-000000000001' and sent_at < now() - interval '1 day'), v);
end $$;

reset role;
do $$
declare v_failures text;
begin
  select string_agg(name||' => '||coalesce(detail,''),' ; ' order by name) into v_failures from zt_thr_results where not ok;
  if v_failures is not null then raise exception 'INVITE_THROTTLE_FAILED: %', v_failures; end if;
  if (select count(*) from zt_thr_results)<>31 then
    raise exception 'INVITE_THROTTLE_INCOMPLETE: % checks',(select count(*) from zt_thr_results);
  end if;
end $$;

select 'INVITE_EMAIL_THROTTLE' as test, count(*) as checks, bool_and(ok) as all_ok from zt_thr_results;

rollback;
