create or replace function public.zt_guard_work_order_technician_update()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  -- Chamadas internas via funções SECURITY DEFINER confiáveis executam com papel
  -- privilegiado e já fazem suas próprias validações de auth.uid()/membership.
  if current_user not in ('authenticated','anon') then
    return new;
  end if;

  if auth.uid() is null then
    return new;
  end if;

  if public.zt_is_owner(old.company_id) then
    return new;
  end if;

  if not public.zt_wo_is_mine(old.id) then
    raise exception 'Sem permissão para alterar esta ordem de serviço' using errcode='42501';
  end if;

  if new.id is distinct from old.id
     or new.company_id is distinct from old.company_id
     or new.number is distinct from old.number
     or new.client_id is distinct from old.client_id
     or new.quote_id is distinct from old.quote_id
     or new.assigned_to is distinct from old.assigned_to
     or new.extra_cost is distinct from old.extra_cost
     or new.pending_pricing is distinct from old.pending_pricing
     or new.warranty_id is distinct from old.warranty_id
     or new.origin_wo_id is distinct from old.origin_wo_id
     or new.is_warranty_visit is distinct from old.is_warranty_visit
     or new.billing_entry_id is distinct from old.billing_entry_id
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'Técnicos não podem alterar campos administrativos ou financeiros da OS' using errcode='42501';
  end if;

  return new;
end;
$$;
