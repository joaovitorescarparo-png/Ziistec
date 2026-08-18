revoke insert, update, delete on table public.subscriptions from authenticated;
revoke select, insert, update, delete on table public.document_counters from authenticated;
drop policy if exists p_subs_write on public.subscriptions;
drop policy if exists p_counters_owner on public.document_counters;

drop policy if exists p_clients_select on public.clients;
drop policy if exists p_clients_write on public.clients;
create policy p_clients_select on public.clients for select to authenticated using (public.zt_client_visible(id,company_id));
create policy p_clients_insert on public.clients for insert to authenticated with check (public.zt_is_owner(company_id));
create policy p_clients_update on public.clients for update to authenticated using (public.zt_is_owner(company_id)) with check (public.zt_is_owner(company_id));
create policy p_clients_delete on public.clients for delete to authenticated using (public.zt_is_owner(company_id));

drop policy if exists p_invites_owner on public.company_invites;
drop policy if exists p_invites_self on public.company_invites;
create policy p_invites_select on public.company_invites for select to authenticated using (public.zt_is_owner(company_id) or lower(email)=lower(coalesce((select p.email from public.profiles p where p.id=(select auth.uid())),'')));
create policy p_invites_insert on public.company_invites for insert to authenticated with check (public.zt_is_owner(company_id));
create policy p_invites_update on public.company_invites for update to authenticated using (public.zt_is_owner(company_id)) with check (public.zt_is_owner(company_id));
create policy p_invites_delete on public.company_invites for delete to authenticated using (public.zt_is_owner(company_id));

drop policy if exists p_products_select on public.products;
drop policy if exists p_products_write on public.products;
create policy p_products_select on public.products for select to authenticated using (public.zt_is_owner(company_id));
create policy p_products_insert on public.products for insert to authenticated with check (public.zt_is_owner(company_id));
create policy p_products_update on public.products for update to authenticated using (public.zt_is_owner(company_id)) with check (public.zt_is_owner(company_id));
create policy p_products_delete on public.products for delete to authenticated using (public.zt_is_owner(company_id));

drop policy if exists p_services_select on public.services;
drop policy if exists p_services_write on public.services;
create policy p_services_select on public.services for select to authenticated using (public.zt_is_owner(company_id));
create policy p_services_insert on public.services for insert to authenticated with check (public.zt_is_owner(company_id));
create policy p_services_update on public.services for update to authenticated using (public.zt_is_owner(company_id)) with check (public.zt_is_owner(company_id));
create policy p_services_delete on public.services for delete to authenticated using (public.zt_is_owner(company_id));

drop policy if exists p_subs_select on public.subscriptions;
create policy p_subs_select on public.subscriptions for select to authenticated using (public.zt_is_member(company_id) or public.zt_is_platform_admin());

drop policy if exists p_warranties_select on public.warranties;
drop policy if exists p_warranties_write on public.warranties;
create policy p_warranties_select on public.warranties for select to authenticated using (public.zt_is_owner(company_id) or (public.zt_is_member(company_id) and public.zt_wo_is_mine(work_order_id)));
create policy p_warranties_insert on public.warranties for insert to authenticated with check (public.zt_is_owner(company_id));
create policy p_warranties_update on public.warranties for update to authenticated using (public.zt_is_owner(company_id)) with check (public.zt_is_owner(company_id));
create policy p_warranties_delete on public.warranties for delete to authenticated using (public.zt_is_owner(company_id));

drop policy if exists p_wo_items_owner on public.work_order_items;
drop policy if exists p_wo_items_select on public.work_order_items;
drop policy if exists p_wo_items_tech_insert on public.work_order_items;
create policy p_wo_items_select on public.work_order_items for select to authenticated using (public.zt_wo_is_owned(work_order_id) or public.zt_wo_is_mine(work_order_id));
create policy p_wo_items_insert on public.work_order_items for insert to authenticated with check (public.zt_wo_is_owned(work_order_id) or (public.zt_wo_is_mine(work_order_id) and public.zt_wo_open(work_order_id) and is_extra=true and price_pending=true and unit_price=0 and unit_cost=0));
create policy p_wo_items_update on public.work_order_items for update to authenticated using (public.zt_wo_is_owned(work_order_id)) with check (public.zt_wo_is_owned(work_order_id));
create policy p_wo_items_delete on public.work_order_items for delete to authenticated using (public.zt_wo_is_owned(work_order_id));

drop policy if exists p_wo_mat_owner on public.work_order_materials;
drop policy if exists p_wo_mat_select on public.work_order_materials;
drop policy if exists p_wo_mat_tech_insert on public.work_order_materials;
drop policy if exists p_wo_mat_tech_del on public.work_order_materials;
drop policy if exists p_wo_mat_tech_fix on public.work_order_materials;
create policy p_wo_mat_select on public.work_order_materials for select to authenticated using (public.zt_wo_is_owned(work_order_id) or public.zt_wo_is_mine(work_order_id));
create policy p_wo_mat_insert on public.work_order_materials for insert to authenticated with check (public.zt_wo_is_owned(work_order_id) or (public.zt_wo_is_mine(work_order_id) and public.zt_wo_open(work_order_id) and created_by=(select auth.uid()) and unit_cost=0));
create policy p_wo_mat_update on public.work_order_materials for update to authenticated using (public.zt_wo_is_owned(work_order_id) or (public.zt_wo_is_mine(work_order_id) and public.zt_wo_open(work_order_id) and created_by=(select auth.uid()))) with check (public.zt_wo_is_owned(work_order_id) or (public.zt_wo_is_mine(work_order_id) and public.zt_wo_open(work_order_id) and created_by=(select auth.uid())));
create policy p_wo_mat_delete on public.work_order_materials for delete to authenticated using (public.zt_wo_is_owned(work_order_id) or (public.zt_wo_is_mine(work_order_id) and public.zt_wo_open(work_order_id) and created_by=(select auth.uid())));
