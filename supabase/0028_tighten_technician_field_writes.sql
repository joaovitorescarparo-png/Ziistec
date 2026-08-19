drop policy if exists p_wo_mat_update on public.work_order_materials;
create policy p_wo_mat_update on public.work_order_materials
for update to authenticated
using (
  public.zt_wo_is_owned(work_order_id)
  or (
    public.zt_wo_is_mine(work_order_id)
    and public.zt_wo_open(work_order_id)
    and created_by = (select auth.uid())
  )
)
with check (
  public.zt_wo_is_owned(work_order_id)
  or (
    public.zt_wo_is_mine(work_order_id)
    and public.zt_wo_open(work_order_id)
    and created_by = (select auth.uid())
    and unit_cost = 0
  )
);

drop policy if exists p_wo_rep_update on public.work_order_reports;
create policy p_wo_rep_update on public.work_order_reports
for update to authenticated
using (
  entry_type = 'report'
  and author_id = (select auth.uid())
  and public.zt_wo_open(work_order_id)
  and (public.zt_wo_is_owned(work_order_id) or public.zt_wo_is_mine(work_order_id))
)
with check (
  entry_type = 'report'
  and author_id = (select auth.uid())
  and public.zt_wo_open(work_order_id)
  and (public.zt_wo_is_owned(work_order_id) or public.zt_wo_is_mine(work_order_id))
);
