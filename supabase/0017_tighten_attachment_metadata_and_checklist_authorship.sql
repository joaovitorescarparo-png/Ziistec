-- ZiisTec · metadata de anexos e autoria de checklist

drop policy if exists p_attachments_all on public.attachments;

drop policy if exists p_attachments_select on public.attachments;
create policy p_attachments_select on public.attachments
for select to authenticated
using (
  public.zt_is_owner(company_id)
  or (work_order_id is not null and public.zt_wo_is_mine(work_order_id))
);

drop policy if exists p_attachments_insert on public.attachments;
create policy p_attachments_insert on public.attachments
for insert to authenticated
with check (
  public.zt_is_owner(company_id)
  or (
    bucket='zt-work-orders'
    and work_order_id is not null
    and purchase_id is null
    and uploaded_by=(select auth.uid())
    and public.zt_wo_is_mine(work_order_id)
    and public.zt_wo_open(work_order_id)
  )
);

drop policy if exists p_attachments_update on public.attachments;
create policy p_attachments_update on public.attachments
for update to authenticated
using (public.zt_is_owner(company_id))
with check (public.zt_is_owner(company_id));

drop policy if exists p_attachments_delete on public.attachments;
create policy p_attachments_delete on public.attachments
for delete to authenticated
using (public.zt_is_owner(company_id));

create or replace function public.zt_guard_checklist_identity()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if current_user='authenticated' then
    new.company_id := old.company_id;
    new.work_order_id := old.work_order_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  return new;
end $$;

drop trigger if exists zt_guard_checklist_identity on public.work_order_checklists;
create trigger zt_guard_checklist_identity
before update on public.work_order_checklists
for each row execute function public.zt_guard_checklist_identity();

revoke all on function public.zt_guard_checklist_identity() from public,anon,authenticated;
