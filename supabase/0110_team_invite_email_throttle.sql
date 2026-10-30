-- ZiisTec · Segurança V1.1 (SEC-05) — limite de reenvio do e-mail de convite, decidido no banco.
--
-- Problema: a função team-invite-email só exigia dono ativo. Um dono (ou um script com a sessão dele) podia pedir
-- o envio do mesmo convite em laço, gastando a cota de e-mail do Auth/SMTP e a reputação do remetente.
--
-- Correção: cada envio passa antes por public.zt_claim_team_invite_email(p_invite), que reserva o envio ou recusa:
--   * 60 s de intervalo por convite e por destinatário dentro da empresa (recriar o convite não zera o intervalo);
--   * no máximo 5 envios por hora para o mesmo destinatário e 30 por hora para a empresa.
-- O registro (team_invite_email_sends) guarda só o hash do e-mail, não aceita leitura nem escrita direta do navegador
-- e não depende do convite existir: apagar e recriar o convite não apaga o histórico de envios. Tudo é isolado por
-- empresa, então nada revela que um e-mail foi convidado por outra empresa. Linhas com mais de um dia são podadas.
--
-- Concorrência: um lock consultivo por empresa serializa as reservas; duas chamadas simultâneas não passam juntas.
-- Ordem de publicação: esta migration antes da função team-invite-email nova (sem ela a função recusa o envio).

create table if not exists public.team_invite_email_sends (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  invite_id uuid not null,
  email_hash text not null check (email_hash ~ '^[0-9a-f]{64}$'),
  sent_by uuid,
  sent_at timestamptz not null default clock_timestamp()
);

create index if not exists idx_team_invite_sends_invite on public.team_invite_email_sends(company_id, invite_id, sent_at desc);
create index if not exists idx_team_invite_sends_recipient on public.team_invite_email_sends(company_id, email_hash, sent_at desc);
create index if not exists idx_team_invite_sends_company on public.team_invite_email_sends(company_id, sent_at desc);

alter table public.team_invite_email_sends enable row level security;
-- Sem policy e sem privilégio: somente a função abaixo (definer) lê e grava.
revoke all on table public.team_invite_email_sends from public, anon, authenticated;

create or replace function public.zt_claim_team_invite_email(p_invite uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_cooldown constant interval := interval '60 seconds';
  c_window constant interval := interval '1 hour';
  c_per_recipient constant integer := 5;
  c_per_company constant integer := 30;
  v_uid uuid := auth.uid();
  v_company uuid;
  v_email text;
  v_hash text;
  v_now timestamptz := clock_timestamp();
  v_last_invite timestamptz;
  v_last_recipient timestamptz;
  v_recipient_count integer;
  v_recipient_oldest timestamptz;
  v_company_count integer;
  v_company_oldest timestamptz;
  v_wait_cooldown numeric;
  v_wait_recipient numeric;
  v_wait_company numeric;
  v_wait numeric;
  v_reason text;
begin
  if v_uid is null then raise exception 'Não autenticado' using errcode = '28000'; end if;

  select i.company_id, i.email into v_company, v_email
  from public.company_invites i
  where i.id = p_invite;
  -- Mesmo erro para convite inexistente e para quem não é dono da empresa do convite: nada revela convites alheios.
  if v_company is null or not public.zt_is_owner(v_company) then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('zt_invite_email:' || v_company::text, 0));
  delete from public.team_invite_email_sends where company_id = v_company and sent_at < v_now - interval '1 day';

  v_hash := encode(sha256(convert_to(lower(btrim(v_email)), 'utf8')), 'hex');

  select max(s.sent_at) into v_last_invite
  from public.team_invite_email_sends s
  where s.company_id = v_company and s.invite_id = p_invite;

  select max(s.sent_at),
         count(*) filter (where s.sent_at > v_now - c_window),
         min(s.sent_at) filter (where s.sent_at > v_now - c_window)
    into v_last_recipient, v_recipient_count, v_recipient_oldest
  from public.team_invite_email_sends s
  where s.company_id = v_company and s.email_hash = v_hash;

  select count(*), min(s.sent_at) into v_company_count, v_company_oldest
  from public.team_invite_email_sends s
  where s.company_id = v_company and s.sent_at > v_now - c_window;

  v_wait_cooldown := greatest(
    case when v_last_invite is not null and v_now - v_last_invite < c_cooldown
         then extract(epoch from (v_last_invite + c_cooldown - v_now)) end,
    case when v_last_recipient is not null and v_now - v_last_recipient < c_cooldown
         then extract(epoch from (v_last_recipient + c_cooldown - v_now)) end);
  v_wait_recipient := case when v_recipient_count >= c_per_recipient
         then extract(epoch from (v_recipient_oldest + c_window - v_now)) end;
  v_wait_company := case when v_company_count >= c_per_company
         then extract(epoch from (v_company_oldest + c_window - v_now)) end;
  v_wait := greatest(v_wait_cooldown, v_wait_recipient, v_wait_company);

  if v_wait is not null then
    v_reason := case when v_wait = v_wait_company then 'company_hourly'
                     when v_wait = v_wait_recipient then 'recipient_hourly'
                     else 'cooldown' end;
    return jsonb_build_object('allowed', false, 'reason', v_reason, 'retryAfterSeconds', greatest(1, ceil(v_wait))::integer);
  end if;

  insert into public.team_invite_email_sends(company_id, invite_id, email_hash, sent_by, sent_at)
  values (v_company, p_invite, v_hash, v_uid, v_now);
  return jsonb_build_object('allowed', true);
end;
$$;

revoke all on function public.zt_claim_team_invite_email(uuid) from public, anon;
grant execute on function public.zt_claim_team_invite_email(uuid) to authenticated;

notify pgrst, 'reload schema';
