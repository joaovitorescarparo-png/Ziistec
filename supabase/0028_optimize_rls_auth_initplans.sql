alter policy p_invites_self on public.company_invites
using (lower(email)=lower(coalesce((select p.email from public.profiles p where p.id=(select auth.uid())),'')));
alter policy p_profiles_insert on public.profiles with check (id=(select auth.uid()));
alter policy p_profiles_self on public.profiles
using (id=(select auth.uid()) or public.zt_is_platform_admin() or public.zt_compartilha_empresa(id));
alter policy p_profiles_update on public.profiles
using (id=(select auth.uid())) with check (id=(select auth.uid()));
alter policy p_members_select on public.company_members
using (user_id=(select auth.uid()) or public.zt_is_owner(company_id) or public.zt_is_platform_admin());
alter policy p_wo_select on public.work_orders
using (public.zt_is_owner(company_id) or (public.zt_is_member(company_id) and assigned_to=(select auth.uid())));
alter policy p_wo_update on public.work_orders
using (public.zt_is_owner(company_id) or (public.zt_is_member(company_id) and assigned_to=(select auth.uid())))
with check (public.zt_is_owner(company_id) or (public.zt_is_member(company_id) and assigned_to=(select auth.uid())));
alter policy p_wo_mat_tech_insert on public.work_order_materials
with check (public.zt_wo_is_mine(work_order_id) and public.zt_wo_open(work_order_id) and created_by=(select auth.uid()) and unit_cost=0);
alter policy p_wo_mat_tech_del on public.work_order_materials
using (public.zt_wo_is_mine(work_order_id) and public.zt_wo_open(work_order_id) and created_by=(select auth.uid()));
alter policy p_wo_mat_tech_fix on public.work_order_materials
using (public.zt_wo_is_mine(work_order_id) and public.zt_wo_open(work_order_id) and created_by=(select auth.uid()))
with check (public.zt_wo_is_mine(work_order_id) and public.zt_wo_open(work_order_id) and created_by=(select auth.uid()));
alter policy p_wo_rep_owner_write on public.work_order_reports
with check (entry_type='report' and (public.zt_wo_is_owned(work_order_id) or (public.zt_wo_is_mine(work_order_id) and public.zt_wo_open(work_order_id))) and author_id=(select auth.uid()));
alter policy p_wo_rep_update on public.work_order_reports
using (entry_type='report' and author_id=(select auth.uid()) and public.zt_wo_open(work_order_id) and (public.zt_wo_is_owned(work_order_id) or public.zt_wo_is_mine(work_order_id)))
with check (entry_type='report' and author_id=(select auth.uid()) and public.zt_wo_open(work_order_id));
