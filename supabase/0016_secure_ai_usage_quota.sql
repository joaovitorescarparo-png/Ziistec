create table if not exists public.ai_usage_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists idx_ai_usage_user_created on public.ai_usage_events(user_id, created_at desc);
create index if not exists idx_ai_usage_company_created on public.ai_usage_events(company_id, created_at desc);

alter table public.ai_usage_events enable row level security;
revoke all on table public.ai_usage_events from public, anon, authenticated;
revoke all on sequence public.ai_usage_events_id_seq from public, anon, authenticated;

drop function if exists public.zt_consume_ai_quota();
create function public.zt_consume_ai_quota()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_company uuid;
  v_minute int;
  v_day int;
begin
  if v_uid is null then raise exception 'Não autenticado' using errcode='28000'; end if;

  select m.company_id into v_company
  from public.company_members m
  join public.subscriptions s on s.company_id=m.company_id
  where m.user_id=v_uid and m.status='active'
    and s.status in ('trial','active')
    and (s.current_period_end is null or s.current_period_end >= current_date)
  order by case when m.role='owner' then 0 else 1 end, m.created_at
  limit 1;

  if v_company is null then
    raise exception 'Empresa ou assinatura sem acesso à IA' using errcode='42501';
  end if;

  select count(*) into v_minute from public.ai_usage_events
   where user_id=v_uid and created_at > now() - interval '1 minute';
  if v_minute >= 10 then raise exception 'Limite temporário de IA atingido. Tente novamente em instantes' using errcode='P0001'; end if;

  select count(*) into v_day from public.ai_usage_events
   where user_id=v_uid and created_at > now() - interval '24 hours';
  if v_day >= 100 then raise exception 'Limite diário de IA atingido' using errcode='P0001'; end if;

  insert into public.ai_usage_events(user_id,company_id) values(v_uid,v_company);
  delete from public.ai_usage_events where created_at < now() - interval '30 days';
  return v_company;
end $$;

revoke execute on function public.zt_consume_ai_quota() from public, anon;
grant execute on function public.zt_consume_ai_quota() to authenticated, service_role;
