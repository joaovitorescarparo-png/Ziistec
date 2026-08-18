-- ZiisTec · convite só usa identidade verificada do Supabase Auth.

create or replace function zt_private.zt_accept_invites()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_uid uuid := auth.uid();
  n int := 0;
  r record;
begin
  if v_uid is null then raise exception 'Não autenticado' using errcode='28000'; end if;

  select u.email into v_email from auth.users u where u.id=v_uid;
  if v_email is null then return 0; end if;

  for r in
    select * from public.company_invites
    where lower(email)=lower(v_email)
      and accepted_at is null
      and coalesce(expires_at, created_at + interval '7 days') > now()
  loop
    insert into public.company_members(company_id,user_id,role,status,job_title)
    values(r.company_id,v_uid,r.role,'active',r.job_title)
    on conflict(company_id,user_id) do update
      set status='active', role=excluded.role, job_title=excluded.job_title;

    update public.profiles
       set full_name=coalesce(nullif(full_name,''),r.name),
           phone=coalesce(nullif(phone,''),r.phone)
     where id=v_uid;

    update public.company_invites set accepted_at=now() where id=r.id;
    n:=n+1;
  end loop;
  return n;
end $$;

create or replace function public.zt_guard_profile_email()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if current_user='authenticated' and new.email is distinct from old.email then
    raise exception 'O e-mail do perfil é controlado pela autenticação' using errcode='42501';
  end if;
  return new;
end $$;

drop trigger if exists zt_guard_profile_email on public.profiles;
create trigger zt_guard_profile_email
before update of email on public.profiles
for each row execute function public.zt_guard_profile_email();

create or replace function public.zt_sync_profile_auth_email()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email=new.email where id=new.id;
  end if;
  return new;
end $$;

drop trigger if exists zt_on_auth_email_changed on auth.users;
create trigger zt_on_auth_email_changed
after update of email on auth.users
for each row execute function public.zt_sync_profile_auth_email();

revoke all on function public.zt_sync_profile_auth_email() from public,anon,authenticated;
revoke all on function public.zt_guard_profile_email() from public,anon,authenticated;
