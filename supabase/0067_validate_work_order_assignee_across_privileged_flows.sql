-- ZiisTec · 0067 — valida assigned_to também dentro de SECURITY DEFINER.
--
-- O guard histórico protegia a Data API direta, mas retornava cedo quando
-- current_user <> 'authenticated'. Dentro das RPCs SECURITY DEFINER isso fazia a
-- validação de membership/estado do responsável ser pulada.
--
-- Mantemos os bloqueios de identidade da Data API exatamente como estavam e
-- tornamos a validação de assigned_to independente de current_user. auth.uid()
-- continua representando o usuário real mesmo dentro de SECURITY DEFINER.

create or replace function public.zt_guard_work_order_assignment()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  -- Preserva o hardening já existente para escritas diretas pela Data API.
  if current_user = 'authenticated' then
    if tg_op = 'INSERT' then
      new.created_by := v_uid;
      if new.status = 'done' then
        raise exception 'Conclusão deve usar o fluxo de finalização' using errcode='42501';
      end if;
    else
      new.company_id := old.company_id;
      new.number := old.number;
      new.created_by := old.created_by;
      new.billing_entry_id := old.billing_entry_id;
      new.completed_at := old.completed_at;
      new.pending_pricing := old.pending_pricing;
      if old.status = 'done' and new.status is distinct from old.status then
        raise exception 'OS concluída não pode ser reaberta por edição direta' using errcode='42501';
      end if;
      if new.status = 'done' and old.status is distinct from 'done' then
        raise exception 'Conclusão deve usar o fluxo de finalização' using errcode='42501';
      end if;
    end if;
  end if;

  -- Sem identidade JWT (migration/service administrative path), não introduzimos
  -- uma nova restrição operacional. Para qualquer chamada de usuário autenticado,
  -- inclusive RPC SECURITY DEFINER, uma nova atribuição precisa apontar para um
  -- membro ativo da MESMA empresa.
  if v_uid is not null
     and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to)
     and new.assigned_to is not null
     and not exists (
       select 1
         from public.company_members m
         join public.profiles p on p.id = m.user_id
        where m.company_id = new.company_id
          and m.user_id = new.assigned_to
          and m.status = 'active'
          and m.role in ('owner','technician')
     ) then
    raise exception 'Responsável precisa ser membro ativo da empresa' using errcode='23503';
  end if;

  return new;
end;
$$;

revoke all on function public.zt_guard_work_order_assignment() from public, anon, authenticated;

comment on function public.zt_guard_work_order_assignment() is
  'Protege identidade da OS na Data API e valida assigned_to em todos os fluxos autenticados, inclusive SECURITY DEFINER.';
