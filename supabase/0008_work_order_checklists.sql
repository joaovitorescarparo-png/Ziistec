create table if not exists public.work_order_checklists (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  text text not null,
  done boolean not null default false,
  position integer not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_wo_checklists_work_order on public.work_order_checklists(work_order_id, position);
alter table public.work_order_checklists enable row level security;

create policy p_wo_checklist_select on public.work_order_checklists for select to authenticated
using (public.zt_wo_is_owned(work_order_id) or public.zt_wo_is_mine(work_order_id));
create policy p_wo_checklist_owner on public.work_order_checklists for all to authenticated
using (public.zt_wo_is_owned(work_order_id)) with check (public.zt_wo_is_owned(work_order_id));
create policy p_wo_checklist_tech_insert on public.work_order_checklists for insert to authenticated
with check (public.zt_wo_is_mine(work_order_id) and public.zt_wo_open(work_order_id) and created_by = auth.uid());
create policy p_wo_checklist_tech_update on public.work_order_checklists for update to authenticated
using (public.zt_wo_is_mine(work_order_id) and public.zt_wo_open(work_order_id))
with check (public.zt_wo_is_mine(work_order_id) and public.zt_wo_open(work_order_id));
create policy p_wo_checklist_tech_delete on public.work_order_checklists for delete to authenticated
using (public.zt_wo_is_mine(work_order_id) and public.zt_wo_open(work_order_id));

grant select, insert, update, delete on public.work_order_checklists to authenticated;
revoke all on public.work_order_checklists from anon;
