alter table public.profiles
  add column if not exists onboarding_company_created_at timestamptz;

create or replace function public.zt_create_company(
  p_name text,
  p_activity text default null,
  p_has_team boolean default false,
  p_owner_name text default null,
  p_phone text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_company uuid;
  v_existing uuid;
begin
  if v_uid is null then raise exception 'Não autenticado' using errcode = '28000'; end if;
  if p_name is null or length(trim(p_name)) = 0 then raise exception 'Informe o nome da empresa'; end if;

  insert into public.profiles(id, email)
  values (v_uid, (select email from auth.users where id = v_uid))
  on conflict (id) do nothing;

  perform pg_advisory_xact_lock(hashtext(v_uid::text));

  select m.company_id into v_existing
    from public.company_members m
    where m.user_id = v_uid and m.role = 'owner'
    order by m.created_at asc
    limit 1;

  if v_existing is not null then
    return v_existing;
  end if;

  if exists (
    select 1 from public.profiles p
    where p.id = v_uid and p.onboarding_company_created_at is not null
  ) then
    raise exception 'O período de teste inicial desta conta já foi utilizado' using errcode = '42501';
  end if;

  insert into public.companies(name, activity, has_team, owner_name, phone)
  values (
    trim(p_name), nullif(trim(coalesce(p_activity,'')),''), coalesce(p_has_team,false),
    coalesce(nullif(trim(coalesce(p_owner_name,'')),''), (select full_name from public.profiles where id = v_uid)),
    nullif(trim(coalesce(p_phone,'')),'')
  ) returning id into v_company;

  insert into public.company_members(company_id, user_id, role, status)
  values (v_company, v_uid, 'owner', 'active');

  insert into public.subscriptions(company_id, status, current_period_start, current_period_end)
  values (v_company, 'trial', current_date, current_date + 14)
  on conflict (company_id) do nothing;

  update public.profiles
     set onboarding_company_created_at = coalesce(onboarding_company_created_at, now())
   where id = v_uid;

  return v_company;
end
$$;
