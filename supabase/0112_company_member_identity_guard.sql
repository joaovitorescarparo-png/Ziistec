-- ZiisTec · Hardening adversarial V1.2 (SEC-V12-02) — o vínculo da equipe não troca de usuário nem de empresa.
--
-- Problema: company_members concede UPDATE ao proprietário (0034) com USING/WITH CHECK zt_is_owner(company_id).
-- A policy só exige que a empresa da linha seja do proprietário; ela não impede que o proprietário reescreva a
-- coluna user_id. Com um UUID de usuário conhecido (por exemplo o de um colaborador de outra empresa, de um
-- convite recusado ou de um usuário sem empresa), o proprietário podia fazer
--     update company_members set user_id = '<vítima>' where id = '<vínculo de técnico da própria empresa>'
-- e, sem convite nem aceite, (a) colocar a vítima na própria empresa como técnico ativo, (b) passar a ler o
-- perfil dela (nome e telefone) pela política de perfis por empresa compartilhada e (c) editar o nome e o
-- telefone dela por zt_update_team_member, que só confere "role = technician" na linha reescrita.
-- Nenhum dado da empresa vítima era exposto, mas o consentimento do convite e a F11 (e-mail confirmado)
-- eram contornados.
--
-- Correção: identidade da linha é imutável. Um trigger recusa qualquer mudança de id, company_id ou user_id
-- (para todos os papéis: nenhum fluxo do aplicativo as altera; troca de empresa é convite novo). Status,
-- função e cargo continuam editáveis pelo proprietário, como antes. Nenhuma tabela, policy, grant ou assinatura
-- de função pública muda; a função é de trigger e nunca é chamada por RPC.

create or replace function public.zt_guard_company_member_identity()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.id is distinct from old.id
     or new.company_id is distinct from old.company_id
     or new.user_id is distinct from old.user_id then
    raise exception 'O vínculo da equipe não pode trocar de usuário nem de empresa' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.zt_guard_company_member_identity() from public, anon, authenticated;

drop trigger if exists trg_guard_company_member_identity on public.company_members;
create trigger trg_guard_company_member_identity
  before update on public.company_members
  for each row execute function public.zt_guard_company_member_identity();

comment on function public.zt_guard_company_member_identity() is
  'Trigger: id, company_id e user_id de company_members são imutáveis (V1.2 SEC-V12-02). Troca de usuário ou de empresa exige novo convite.';
