-- Índices para FKs usadas em joins, cascades e filtros do ZiisTec.
create index if not exists idx_attachments_company_id on public.attachments(company_id);
create index if not exists idx_attachments_uploaded_by on public.attachments(uploaded_by);
create index if not exists idx_company_invites_invited_by on public.company_invites(invited_by);
create index if not exists idx_financial_entries_client_id on public.financial_entries(client_id);
create index if not exists idx_products_supplier_id on public.products(supplier_id);
create index if not exists idx_purchase_items_company_id on public.purchase_items(company_id);
create index if not exists idx_purchase_items_product_id on public.purchase_items(product_id);
create index if not exists idx_purchases_created_by on public.purchases(created_by);
create index if not exists idx_purchases_supplier_id on public.purchases(supplier_id);
create index if not exists idx_quote_items_company_id on public.quote_items(company_id);
create index if not exists idx_quote_items_product_id on public.quote_items(product_id);
create index if not exists idx_quote_items_service_id on public.quote_items(service_id);
create index if not exists idx_quotes_created_by on public.quotes(created_by);
create index if not exists idx_warranties_product_id on public.warranties(product_id);
create index if not exists idx_warranties_service_id on public.warranties(service_id);
create index if not exists idx_warranties_work_order_id on public.warranties(work_order_id);
create index if not exists idx_wo_checklists_company_id on public.work_order_checklists(company_id);
create index if not exists idx_wo_checklists_created_by on public.work_order_checklists(created_by);
create index if not exists idx_wo_items_company_id on public.work_order_items(company_id);
create index if not exists idx_wo_items_product_id on public.work_order_items(product_id);
create index if not exists idx_wo_items_service_id on public.work_order_items(service_id);
create index if not exists idx_wo_materials_company_id on public.work_order_materials(company_id);
create index if not exists idx_wo_materials_created_by on public.work_order_materials(created_by);
create index if not exists idx_wo_materials_product_id on public.work_order_materials(product_id);
create index if not exists idx_wo_reports_author_id on public.work_order_reports(author_id);
create index if not exists idx_wo_reports_company_id on public.work_order_reports(company_id);
create index if not exists idx_work_orders_created_by on public.work_orders(created_by);
create index if not exists idx_work_orders_origin_wo_id on public.work_orders(origin_wo_id);
create index if not exists idx_work_orders_quote_id on public.work_orders(quote_id);

-- Uma policy por ação no checklist evita policies permissivas duplicadas.
drop policy if exists p_wo_checklist_select on public.work_order_checklists;
drop policy if exists p_wo_checklist_owner on public.work_order_checklists;
drop policy if exists p_wo_checklist_tech_insert on public.work_order_checklists;
drop policy if exists p_wo_checklist_tech_update on public.work_order_checklists;
drop policy if exists p_wo_checklist_tech_delete on public.work_order_checklists;

create policy p_wo_checklist_select on public.work_order_checklists
for select to authenticated
using (public.zt_wo_is_owned(work_order_id) or public.zt_wo_is_mine(work_order_id));
create policy p_wo_checklist_insert on public.work_order_checklists
for insert to authenticated
with check (public.zt_wo_is_owned(work_order_id) or (public.zt_wo_is_mine(work_order_id) and public.zt_wo_open(work_order_id) and created_by = (select auth.uid())));
create policy p_wo_checklist_update on public.work_order_checklists
for update to authenticated
using (public.zt_wo_is_owned(work_order_id) or (public.zt_wo_is_mine(work_order_id) and public.zt_wo_open(work_order_id)))
with check (public.zt_wo_is_owned(work_order_id) or (public.zt_wo_is_mine(work_order_id) and public.zt_wo_open(work_order_id)));
create policy p_wo_checklist_delete on public.work_order_checklists
for delete to authenticated
using (public.zt_wo_is_owned(work_order_id) or (public.zt_wo_is_mine(work_order_id) and public.zt_wo_open(work_order_id)));
