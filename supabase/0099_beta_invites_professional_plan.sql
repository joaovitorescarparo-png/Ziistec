-- ZiisTec · Beta — acesso por convite e plano Profissional.
--
-- 1. Plano comercial: toda assinatura nova nasce "Profissional", R$ 79,90/mês. Os registros
--    existentes não são alterados (histórico e homologação continuam com o valor gravado).
-- 2. Beta fechado: só cria empresa nova (owner + trial) quem tem convite beta válido para o
--    e-mail confirmado no Auth. Convite de equipe (company_invites / zt_accept_invites) não muda:
--    técnico convidado por uma empresa existente não precisa de convite beta.
-- 3. Convites beta: um ativo por e-mail normalizado; expira; revogável; criação, uso e revogação
--    rastreáveis. A tabela não tem privilégio nem policy para anon/authenticated: só as RPCs abaixo
--    leem ou gravam. Listar, criar e revogar exigem administrador da plataforma com MFA (aal2).
-- 4. zt_create_company valida e consome o convite na mesma transação que cria empresa, membresia e
--    trial. Sem convite nada é criado e o trial não é consumido; falha desfaz tudo (o convite
--    continua pendente); repetir a chamada devolve a mesma empresa.
-- Sem checkout, sem cobrança e sem envio de e-mail.

alter table public.subscriptions alter column plan set default 'Profissional';
alter table public.subscriptions alter column amount set default 79.90;

create table if not exists public.beta_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  status text not null default 'pending',
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  created_by uuid,
  used_at timestamptz,
  used_by uuid,
  company_id uuid references public.companies(id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid,
  constraint beta_invites_email_normalized check (
    email = lower(btrim(email)) and char_length(email) between 6 and 320
    and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint beta_invites_status check (status in ('pending','used','revoked','expired')),
  constraint beta_invites_expiry check (expires_at > created_at),
  constraint beta_invites_used_shape check (status <> 'used' or (used_at is not null and used_by is not null)),
  constraint beta_invites_revoked_shape check (status <> 'revoked' or revoked_at is not null)
);

create unique index if not exists uq_beta_invites_pending_email on public.beta_invites(email) where status = 'pending';

alter table public.beta_invites enable row level security;
revoke all on table public.beta_invites from public, anon, authenticated;

comment on table public.beta_invites is
  'Convites do beta fechado para novos proprietários. Sem acesso direto: zt_beta_invite_status (próprio e-mail) e RPCs zt_platform_* (admin + MFA).';

-- O usuário autenticado consulta somente o próprio e-mail confirmado.
create or replace function public.zt_beta_invite_status()
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();
  v_email text;
  v_expires timestamptz;
begin
  if v_uid is null then raise exception 'Não autenticado' using errcode='28000'; end if;
  select lower(btrim(u.email)) into v_email from auth.users u where u.id=v_uid and u.email_confirmed_at is not null;
  if v_email is null then return jsonb_build_object('invited',false,'email_confirmed',false); end if;
  select i.expires_at into v_expires from public.beta_invites i
   where i.email=v_email and i.status='pending' and i.expires_at>now()
   order by i.created_at desc limit 1;
  return jsonb_build_object('invited',v_expires is not null,'email_confirmed',true,'expires_at',v_expires);
end;
$$;

create or replace function public.zt_platform_list_beta_invites()
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
begin
  if auth.uid() is null then raise exception 'Não autenticado' using errcode='28000'; end if;
  if not public.zt_is_platform_admin() then
    raise exception 'Acesso administrativo necessário' using errcode='42501';
  end if;
  return coalesce((
    select jsonb_agg(x.item order by x.created_at desc)
      from (
        select i.created_at, jsonb_build_object(
          'id',i.id,'email',i.email,
          'status',case when i.status='pending' and i.expires_at<=now() then 'expired' else i.status end,
          'expires_at',i.expires_at,'created_at',i.created_at,'used_at',i.used_at,'revoked_at',i.revoked_at,
          'company_id',i.company_id,'company_name',coalesce(nullif(c.trade_name,''),c.name),
          'subscription_status',s.status,'period_start',s.current_period_start,'period_end',s.current_period_end,
          'plan',s.plan,'amount',s.amount) as item
          from public.beta_invites i
          left join public.companies c on c.id=i.company_id
          left join public.subscriptions s on s.company_id=i.company_id
         order by i.created_at desc
         limit 500
      ) x
  ),'[]'::jsonb);
end;
$$;

create or replace function public.zt_platform_create_beta_invite(p_email text, p_valid_days integer default 7)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();
  v_email text:=lower(btrim(coalesce(p_email,'')));
  v_days integer:=coalesce(p_valid_days,7);
  v_admin_email text;
  v_row public.beta_invites%rowtype;
begin
  if v_uid is null then raise exception 'Não autenticado' using errcode='28000'; end if;
  if not public.zt_is_platform_admin() then
    raise exception 'Acesso administrativo necessário' using errcode='42501';
  end if;
  if char_length(v_email) not between 6 and 320 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Informe um e-mail válido' using errcode='22023';
  end if;
  if v_days<1 or v_days>90 then
    raise exception 'A validade do convite deve ficar entre 1 e 90 dias' using errcode='22023';
  end if;
  select lower(btrim(u.email)) into v_admin_email from auth.users u where u.id=v_uid;
  if v_admin_email=v_email then
    raise exception 'O administrador não pode convidar o próprio e-mail' using errcode='42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('zt_beta_invite:'||v_email));
  update public.beta_invites set status='expired' where email=v_email and status='pending' and expires_at<=now();

  -- Um convite ativo por e-mail: repetir devolve o mesmo convite, sem duplicar nem prorrogar.
  select * into v_row from public.beta_invites where email=v_email and status='pending';
  if found then
    return jsonb_build_object('id',v_row.id,'email',v_row.email,'status',v_row.status,'expires_at',v_row.expires_at,'created',false);
  end if;

  insert into public.beta_invites(email,status,expires_at,created_by)
  values(v_email,'pending',now()+make_interval(days=>v_days),v_uid)
  returning * into v_row;

  insert into public.platform_audit_logs(actor_id,company_id,action,before_data,after_data)
  values(v_uid,null,'beta_invite_created',null,
    jsonb_build_object('invite_id',v_row.id,'email',v_row.email,'expires_at',v_row.expires_at));

  return jsonb_build_object('id',v_row.id,'email',v_row.email,'status',v_row.status,'expires_at',v_row.expires_at,'created',true);
end;
$$;

create or replace function public.zt_platform_revoke_beta_invite(p_invite uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();
  v_before public.beta_invites%rowtype;
  v_after public.beta_invites%rowtype;
begin
  if v_uid is null then raise exception 'Não autenticado' using errcode='28000'; end if;
  if not public.zt_is_platform_admin() then
    raise exception 'Acesso administrativo necessário' using errcode='42501';
  end if;
  if p_invite is null then raise exception 'Convite obrigatório' using errcode='22023'; end if;

  select * into v_before from public.beta_invites where id=p_invite for update;
  if not found then raise exception 'Convite não encontrado' using errcode='P0002'; end if;
  if v_before.status='revoked' then
    return jsonb_build_object('id',v_before.id,'status',v_before.status,'changed',false);
  end if;
  if v_before.status='used' then
    raise exception 'Convite já utilizado não pode ser revogado' using errcode='22023';
  end if;

  update public.beta_invites set status='revoked', revoked_at=now(), revoked_by=v_uid
   where id=p_invite
  returning * into v_after;

  insert into public.platform_audit_logs(actor_id,company_id,action,before_data,after_data)
  values(v_uid,null,'beta_invite_revoked',
    jsonb_build_object('invite_id',v_before.id,'email',v_before.email,'status',v_before.status,'expires_at',v_before.expires_at),
    jsonb_build_object('invite_id',v_after.id,'status',v_after.status));

  return jsonb_build_object('id',v_after.id,'status',v_after.status,'changed',true);
end;
$$;

-- Criação de empresa: e-mail confirmado + convite beta válido; convite consumido junto com a empresa.
create or replace function zt_private.zt_create_company(
  p_name text, p_activity text default null, p_has_team boolean default false,
  p_owner_name text default null, p_phone text default null
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_company uuid;
  v_existing uuid;
  v_invite uuid;
begin
  if v_uid is null then raise exception 'Não autenticado' using errcode = '28000'; end if;
  if p_name is null or length(trim(p_name)) = 0 then raise exception 'Informe o nome da empresa'; end if;

  select lower(btrim(u.email)) into v_email
    from auth.users u
   where u.id = v_uid and u.email_confirmed_at is not null;
  if v_email is null then
    raise exception 'Confirme seu e-mail antes de criar a empresa' using errcode = '42501', hint = 'email_not_confirmed';
  end if;

  insert into public.profiles(id, email)
  values (v_uid, (select u.email from auth.users u where u.id = v_uid))
  on conflict (id) do nothing;

  perform pg_advisory_xact_lock(hashtext(v_uid::text));

  -- Retry seguro: quem já é proprietário recebe a mesma empresa, sem novo convite nem novo trial.
  select m.company_id into v_existing
    from public.company_members m
    where m.user_id = v_uid and m.role = 'owner'
    order by m.created_at asc
    limit 1;

  if v_existing is not null then
    return v_existing;
  end if;

  select i.id into v_invite
    from public.beta_invites i
   where i.email = v_email and i.status = 'pending' and i.expires_at > now()
   order by i.created_at desc
   limit 1
   for update;

  if v_invite is null then
    raise exception 'O ZiisTec está em beta fechado. Este e-mail ainda não possui um convite.'
      using errcode = '42501', hint = 'beta_invite_required';
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
    coalesce(nullif(trim(coalesce(p_owner_name,'')),''), (select p.full_name from public.profiles p where p.id = v_uid)),
    nullif(trim(coalesce(p_phone,'')),'')
  ) returning id into v_company;

  insert into public.company_members(company_id, user_id, role, status)
  values (v_company, v_uid, 'owner', 'active');

  -- Plano e valor vêm do default da tabela (Profissional, 79.90).
  insert into public.subscriptions(company_id, status, current_period_start, current_period_end)
  values (v_company, 'trial', current_date, current_date + 14)
  on conflict (company_id) do nothing;

  update public.beta_invites
     set status = 'used', used_at = now(), used_by = v_uid, company_id = v_company
   where id = v_invite;

  update public.profiles
     set onboarding_company_created_at = coalesce(onboarding_company_created_at, now())
   where id = v_uid;

  return v_company;
end;
$$;

revoke all on function zt_private.zt_create_company(text,text,boolean,text,text) from public, anon, authenticated;

revoke all on function public.zt_beta_invite_status() from public, anon;
revoke all on function public.zt_platform_list_beta_invites() from public, anon;
revoke all on function public.zt_platform_create_beta_invite(text,integer) from public, anon;
revoke all on function public.zt_platform_revoke_beta_invite(uuid) from public, anon;
grant execute on function public.zt_beta_invite_status() to authenticated;
grant execute on function public.zt_platform_list_beta_invites() to authenticated;
grant execute on function public.zt_platform_create_beta_invite(text,integer) to authenticated;
grant execute on function public.zt_platform_revoke_beta_invite(uuid) to authenticated;

comment on function public.zt_beta_invite_status() is
  'Usuário autenticado: informa se o próprio e-mail confirmado tem convite beta pendente e vigente.';
comment on function public.zt_platform_list_beta_invites() is
  'Administrador da plataforma (MFA): convites beta com status efetivo, empresa criada e período da assinatura.';
comment on function public.zt_platform_create_beta_invite(text,integer) is
  'Administrador da plataforma (MFA): cria convite beta (um ativo por e-mail, 1 a 90 dias) com auditoria.';
comment on function public.zt_platform_revoke_beta_invite(uuid) is
  'Administrador da plataforma (MFA): revoga convite beta não utilizado, com auditoria.';
