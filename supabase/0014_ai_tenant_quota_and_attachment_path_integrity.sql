-- ZiisTec · IA vinculada ao tenant ativo + integridade de anexos

create or replace function zt_private.zt_consume_ai_quota(p_company uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_status public.zt_sub_status;
  v_end date;
  v_minute int;
  v_day int;
begin
  if v_uid is null then raise exception 'Não autenticado' using errcode='28000'; end if;
  if p_company is null then raise exception 'Empresa não informada' using errcode='22023'; end if;

  if not exists (
    select 1 from public.company_members m
    where m.company_id=p_company and m.user_id=v_uid and m.status='active'
  ) then
    raise exception 'Sem acesso a esta empresa' using errcode='42501';
  end if;

  select s.status, s.current_period_end into v_status, v_end
  from public.subscriptions s where s.company_id=p_company;

  if v_status not in ('trial','active') or (v_end is not null and v_end < current_date) then
    raise exception 'Assinatura sem acesso à IA' using errcode='42501';
  end if;

  select count(*) into v_minute from public.ai_usage_events
   where user_id=v_uid and company_id=p_company and created_at > now() - interval '1 minute';
  if v_minute >= 10 then raise exception 'Limite temporário de IA atingido. Tente novamente em instantes' using errcode='P0001'; end if;

  select count(*) into v_day from public.ai_usage_events
   where user_id=v_uid and company_id=p_company and created_at > now() - interval '24 hours';
  if v_day >= 100 then raise exception 'Limite diário de IA atingido' using errcode='P0001'; end if;

  insert into public.ai_usage_events(user_id,company_id) values(v_uid,p_company);
  delete from public.ai_usage_events where created_at < now() - interval '30 days';
  return p_company;
end $$;

create or replace function public.zt_consume_ai_quota(p_company uuid)
returns uuid
language sql
set search_path = zt_private
as $$ select zt_private.zt_consume_ai_quota(p_company); $$;

revoke all on function public.zt_consume_ai_quota(uuid) from public, anon;
grant execute on function public.zt_consume_ai_quota(uuid) to authenticated;

do $$ begin
  alter table public.attachments add constraint attachments_bucket_allowed
    check (bucket in ('zt-work-orders','zt-documents'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.attachments add constraint attachments_path_matches_company
    check (split_part(path,'/',1) = company_id::text);
exception when duplicate_object then null; end $$;
