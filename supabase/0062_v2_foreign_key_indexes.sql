-- ZiisTec V2: índices de cobertura para FKs introduzidas/expandidas no backend V2.
-- Aditivo e idempotente. Evita scans completos em validações/cascatas de FK conforme o volume cresce.

-- inventory_movements
create index if not exists idx_inventory_movements_product_company
  on public.inventory_movements(product_id, company_id);

create index if not exists idx_inventory_movements_work_order_company
  on public.inventory_movements(work_order_id, company_id)
  where work_order_id is not null;

create index if not exists idx_inventory_movements_purchase_company
  on public.inventory_movements(purchase_id, company_id)
  where purchase_id is not null;

create index if not exists idx_inventory_movements_created_by
  on public.inventory_movements(created_by)
  where created_by is not null;

-- maintenance_contracts
create index if not exists idx_maintenance_contracts_client_company
  on public.maintenance_contracts(client_id, company_id);

create index if not exists idx_maintenance_contracts_assigned_member
  on public.maintenance_contracts(company_id, assigned_to)
  where assigned_to is not null;

create index if not exists idx_maintenance_contracts_assigned_to
  on public.maintenance_contracts(assigned_to)
  where assigned_to is not null;

create index if not exists idx_maintenance_contracts_created_by
  on public.maintenance_contracts(created_by)
  where created_by is not null;

-- owner-only cost ledgers
create index if not exists idx_work_order_item_costs_wo_company
  on public.work_order_item_costs(work_order_id, company_id);

create index if not exists idx_work_order_material_costs_wo_company
  on public.work_order_material_costs(work_order_id, company_id);

create index if not exists idx_work_order_private_costs_wo_company
  on public.work_order_private_costs(work_order_id, company_id);

-- private purchase reconciliation
create index if not exists idx_purchase_inventory_sync_product_company
  on zt_private.purchase_inventory_sync(product_id, company_id);

create index if not exists idx_purchase_inventory_sync_purchase_company
  on zt_private.purchase_inventory_sync(purchase_id, company_id);
