create or replace function public.zt_guard_work_order_assignment()
returns trigger language plpgsql security invoker set search_path=public
as $$
begin
  if current_user <> 'authenticated' then return new; end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    if new.status = 'done' then raise exception 'Conclusão deve usar o fluxo de finalização' using errcode='42501'; end if;
  else
    new.company_id := old.company_id;
    new.number := old.number;
    new.created_by := old.created_by;
    new.billing_entry_id := old.billing_entry_id;
    new.completed_at := old.completed_at;
    new.pending_pricing := old.pending_pricing;
    if old.status = 'done' and new.status is distinct from old.status then raise exception 'OS concluída não pode ser reaberta por edição direta' using errcode='42501'; end if;
    if new.status = 'done' and old.status is distinct from 'done' then raise exception 'Conclusão deve usar o fluxo de finalização' using errcode='42501'; end if;
  end if;
  if new.assigned_to is not null and not exists (
    select 1 from public.company_members m
    where m.company_id=new.company_id and m.user_id=new.assigned_to and m.status='active'
  ) then
    raise exception 'Responsável precisa ser membro ativo da empresa' using errcode='23503';
  end if;
  return new;
end $$;
revoke execute on function public.zt_guard_work_order_assignment() from public, anon, authenticated;
