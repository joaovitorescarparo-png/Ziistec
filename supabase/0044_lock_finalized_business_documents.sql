create or replace function public.zt_guard_locked_document_parent()
returns trigger
language plpgsql
set search_path = 'public'
as $$
begin
  if current_user <> 'authenticated' then return new; end if;

  if tg_table_name = 'work_orders' and old.status = 'done' then
    if new.client_id is distinct from old.client_id
       or new.quote_id is distinct from old.quote_id
       or new.assigned_to is distinct from old.assigned_to
       or new.scheduled_date is distinct from old.scheduled_date
       or new.scheduled_time is distinct from old.scheduled_time
       or new.address is distinct from old.address
       or new.service_place is distinct from old.service_place
       or new.request is distinct from old.request
       or new.pre_notes is distinct from old.pre_notes
       or new.extra_cost is distinct from old.extra_cost
       or new.needs_return is distinct from old.needs_return
       or new.warranty_id is distinct from old.warranty_id
       or new.origin_wo_id is distinct from old.origin_wo_id
       or new.is_warranty_visit is distinct from old.is_warranty_visit
       or new.problem_report is distinct from old.problem_report
       or new.billing_entry_id is distinct from old.billing_entry_id
       or new.completed_at is distinct from old.completed_at
       or new.pending_pricing is distinct from old.pending_pricing then
      raise exception 'OS concluída é histórica e não pode ter seus dados centrais alterados' using errcode='42501';
    end if;
  elsif tg_table_name = 'quotes' and old.status = 'approved' then
    if new.client_id is distinct from old.client_id
       or new.status is distinct from old.status
       or new.issue_date is distinct from old.issue_date
       or new.valid_until is distinct from old.valid_until
       or new.discount is distinct from old.discount
       or new.surcharge is distinct from old.surcharge
       or new.payment_terms is distinct from old.payment_terms
       or new.notes is distinct from old.notes
       or new.address is distinct from old.address
       or new.service_place is distinct from old.service_place then
      raise exception 'Orçamento aprovado é histórico e não pode ser alterado; duplique para criar uma nova versão' using errcode='42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_lock_finalized_work_order on public.work_orders;
create trigger trg_lock_finalized_work_order
before update on public.work_orders
for each row execute function public.zt_guard_locked_document_parent();

drop trigger if exists trg_lock_approved_quote on public.quotes;
create trigger trg_lock_approved_quote
before update on public.quotes
for each row execute function public.zt_guard_locked_document_parent();

create or replace function public.zt_guard_locked_document_child()
returns trigger
language plpgsql
set search_path = 'public'
as $$
declare
  v_parent uuid;
  v_locked boolean := false;
begin
  if current_user <> 'authenticated' then
    return coalesce(new, old);
  end if;

  if tg_table_name = 'quote_items' then
    v_parent := coalesce(new.quote_id, old.quote_id);
    select exists(select 1 from public.quotes q where q.id=v_parent and q.status='approved') into v_locked;
    if v_locked then
      raise exception 'Itens de orçamento aprovado não podem ser alterados' using errcode='42501';
    end if;
  elsif tg_table_name = 'work_order_items' then
    v_parent := coalesce(new.work_order_id, old.work_order_id);
    select exists(select 1 from public.work_orders w where w.id=v_parent and w.status='done') into v_locked;
    if v_locked then
      raise exception 'Itens de OS concluída não podem ser alterados diretamente' using errcode='42501';
    end if;
  elsif tg_table_name = 'work_order_materials' then
    v_parent := coalesce(new.work_order_id, old.work_order_id);
    select exists(select 1 from public.work_orders w where w.id=v_parent and w.status='done') into v_locked;
    if v_locked then
      raise exception 'Materiais de OS concluída não podem ser alterados diretamente' using errcode='42501';
    end if;
  elsif tg_table_name = 'work_order_checklists' then
    v_parent := coalesce(new.work_order_id, old.work_order_id);
    select exists(select 1 from public.work_orders w where w.id=v_parent and w.status='done') into v_locked;
    if v_locked then
      raise exception 'Checklist de OS concluída não pode ser alterado diretamente' using errcode='42501';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_lock_approved_quote_items on public.quote_items;
create trigger trg_lock_approved_quote_items
before insert or update or delete on public.quote_items
for each row execute function public.zt_guard_locked_document_child();

drop trigger if exists trg_lock_completed_wo_items on public.work_order_items;
create trigger trg_lock_completed_wo_items
before insert or update or delete on public.work_order_items
for each row execute function public.zt_guard_locked_document_child();

drop trigger if exists trg_lock_completed_wo_materials on public.work_order_materials;
create trigger trg_lock_completed_wo_materials
before insert or update or delete on public.work_order_materials
for each row execute function public.zt_guard_locked_document_child();

drop trigger if exists trg_lock_completed_wo_checklists on public.work_order_checklists;
create trigger trg_lock_completed_wo_checklists
before insert or update or delete on public.work_order_checklists
for each row execute function public.zt_guard_locked_document_child();