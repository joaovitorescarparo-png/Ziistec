alter table public.company_invites add column if not exists name text;
alter table public.company_invites add column if not exists phone text;

create or replace function public.zt_accept_invites()
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
  if v_uid is null then raise exception 'Não autenticado' using errcode = '28000'; end if;
  select email into v_email from public.profiles where id = v_uid;
  if v_email is null then return 0; end if;

  for r in select * from public.company_invites
           where lower(email) = lower(v_email) and accepted_at is null loop
    insert into public.company_members(company_id, user_id, role, status, job_title)
    values (r.company_id, v_uid, r.role, 'active', r.job_title)
    on conflict (company_id, user_id) do update
      set status = 'active', role = excluded.role, job_title = excluded.job_title;

    update public.profiles
       set full_name = coalesce(nullif(full_name,''), r.name),
           phone = coalesce(nullif(phone,''), r.phone)
     where id = v_uid;

    update public.company_invites set accepted_at = now() where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;

revoke execute on function public.zt_accept_invites() from public, anon;
grant execute on function public.zt_accept_invites() to authenticated, service_role;
