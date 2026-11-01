-- ZiisTec F11 — aceite de convite exige e-mail confirmado no Supabase Auth.
-- Executado somente na stack Supabase descartável da CI após ci_local_seed.sql.
begin;

create temp table zt_f11 (
  unconfirmed_result integer,
  unconfirmed_member_count integer,
  unconfirmed_accepted boolean,
  confirmed_result integer,
  confirmed_member_count integer,
  confirmed_accepted boolean,
  google_result integer,
  google_member_count integer,
  google_accepted boolean,
  google_provider boolean
) on commit drop;
insert into zt_f11 default values;
grant select,update on zt_f11 to authenticated;

-- O usuário externo da seed não pertence às empresas A/B.
update auth.users
   set email='ci-f11-invite@example.invalid',
       email_confirmed_at=null,
       raw_app_meta_data='{"provider":"email","providers":["email"]}'::jsonb,
       updated_at=now()
 where id='10000000-0000-0000-0000-000000000004';

insert into public.company_invites(company_id,email,role,job_title,name)
values(
  '20000000-0000-0000-0000-000000000001',
  'ci-f11-invite@example.invalid',
  'technician',
  'F11 Email',
  'F11 Invite User'
);

select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000004',true);
set local role authenticated;
update zt_f11 set unconfirmed_result=public.zt_accept_invites();
reset role;

update zt_f11 set
  unconfirmed_member_count=(
    select count(*) from public.company_members
     where company_id='20000000-0000-0000-0000-000000000001'
       and user_id='10000000-0000-0000-0000-000000000004'
  ),
  unconfirmed_accepted=exists(
    select 1 from public.company_invites
     where company_id='20000000-0000-0000-0000-000000000001'
       and lower(email)=lower('ci-f11-invite@example.invalid')
       and accepted_at is not null
  );

-- A mesma identidade passa a ser aceita somente depois da confirmação do e-mail.
update auth.users
   set email_confirmed_at=now(), updated_at=now()
 where id='10000000-0000-0000-0000-000000000004';

set local role authenticated;
update zt_f11 set confirmed_result=public.zt_accept_invites();
reset role;

update zt_f11 set
  confirmed_member_count=(
    select count(*) from public.company_members
     where company_id='20000000-0000-0000-0000-000000000001'
       and user_id='10000000-0000-0000-0000-000000000004'
       and role='technician' and status='active'
  ),
  confirmed_accepted=exists(
    select 1 from public.company_invites
     where company_id='20000000-0000-0000-0000-000000000001'
       and lower(email)=lower('ci-f11-invite@example.invalid')
       and accepted_at is not null
  );

-- OAuth Google confirmado continua compatível: F11 não deve bloquear provedores legítimos.
update auth.users
   set raw_app_meta_data='{"provider":"google","providers":["google"]}'::jsonb,
       email_confirmed_at=coalesce(email_confirmed_at,now()),
       updated_at=now()
 where id='10000000-0000-0000-0000-000000000004';

insert into public.company_invites(company_id,email,role,job_title,name)
values(
  '20000000-0000-0000-0000-000000000002',
  'ci-f11-invite@example.invalid',
  'technician',
  'F11 Google',
  'F11 Google User'
);

set local role authenticated;
update zt_f11 set google_result=public.zt_accept_invites();
reset role;

update zt_f11 set
  google_member_count=(
    select count(*) from public.company_members
     where company_id='20000000-0000-0000-0000-000000000002'
       and user_id='10000000-0000-0000-0000-000000000004'
       and role='technician' and status='active'
  ),
  google_accepted=exists(
    select 1 from public.company_invites
     where company_id='20000000-0000-0000-0000-000000000002'
       and lower(email)=lower('ci-f11-invite@example.invalid')
       and accepted_at is not null
  ),
  google_provider=(
    select email_confirmed_at is not null
       and raw_app_meta_data->>'provider'='google'
      from auth.users
     where id='10000000-0000-0000-0000-000000000004'
  );

select
  'F11_INVITE_CONFIRMED_EMAIL_OK' as result,
  unconfirmed_result,
  unconfirmed_member_count,
  unconfirmed_accepted,
  confirmed_result,
  confirmed_member_count,
  confirmed_accepted,
  google_result,
  google_member_count,
  google_accepted,
  google_provider,
  (
    unconfirmed_result=0
    and unconfirmed_member_count=0
    and not unconfirmed_accepted
    and confirmed_result=1
    and confirmed_member_count=1
    and confirmed_accepted
    and google_result=1
    and google_member_count=1
    and google_accepted
    and google_provider
  ) as passed
from zt_f11;

do $$
declare ok boolean;
begin
  select (
    unconfirmed_result=0
    and unconfirmed_member_count=0
    and not unconfirmed_accepted
    and confirmed_result=1
    and confirmed_member_count=1
    and confirmed_accepted
    and google_result=1
    and google_member_count=1
    and google_accepted
    and google_provider
  ) into ok from zt_f11;
  if ok is distinct from true then
    raise exception 'F11 invite confirmed-email regression failed';
  end if;
end $$;

rollback;
