-- ZiisTec F11 — convite só pode ser aceito por identidade de e-mail confirmada.
-- Mantém a API e o fluxo existentes; endurece somente a autoridade privada.

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
  if v_uid is null then
    raise exception 'Não autenticado' using errcode='28000';
  end if;

  select u.email
    into v_email
    from auth.users u
   where u.id = v_uid
     and u.email_confirmed_at is not null;

  if v_email is null then return 0; end if;

  for r in
    select *
      from public.company_invites
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
