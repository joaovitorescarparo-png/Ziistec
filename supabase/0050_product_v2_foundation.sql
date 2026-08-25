-- ZiisTec Product V2 — fundação segura para catálogo, estoque e manutenção recorrente
-- Esta migration é preparada na branch product-v2-review e não deve ser aplicada
-- à produção antes da homologação completa da V2.

-- ---------------------------------------------------------------------------
-- Produtos: foto, estoque e venda por técnico
-- ---------------------------------------------------------------------------
alter table public.products
  add column if not exists image_path text,
  add column if not exists stock_on_hand numeric(14,3) not null default 0,
  add column if not exists minimum_stock numeric(14,3) not null default 0,
  add column if not exists track_stock boolean not null default false,
  add column if not exists allow_technician_sale boolean not null default false,
  add column if not exists updated_at timestamptz not null default now();

alter table public.products drop constraint if exists products_stock_nonnegative;
alter table public.products add constraint products_stock_nonnegative
  check (stock_on_hand >= 0 and minimum_stock >= 0);

alter table public.products drop constraint if exists products_image_path_bounds;
alter table public.products add constraint products_image_path_bounds
  check (image_path is null or length(image_path) <= 2000);

create index if not exists idx_products_company_active_sale
  on public.products(company_id, active, allow_technician_sale);

-- ---------------------------------------------------------------------------
-- Movimentos de estoque: owner enxerga custo; técnico nunca consulta esta tabela.
-- ---------------------------------------------------------------------------
create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  product_id uuid not null,
  work_order_id uuid,
  purchase_id uuid,
  movement_type text not null,
  quantity numeric(14,3) not null,
  unit_cost numeric(14,2),
  unit_price numeric(14,2),
  note text,
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint inventory_movements_quantity_positive check (quantity > 0),
  constraint inventory_movements_type_valid check (movement_type in ('purchase','sale','use','adjustment_in','adjustment_out','return_in','return_out')),
  constraint inventory_movements_money_nonnegative check (
    (unit_cost is null or unit_cost >= 0) and (unit_price is null or unit_price >= 0)
  ),
  constraint inventory_movements_product_tenant_fk
    foreign key (product_id, company_id) references public.products(id, company_id),
  constraint inventory_movements_work_order_tenant_fk
    foreign key (work_order_id, company_id) references public.work_orders(id, company_id),
  constraint inventory_movements_purchase_tenant_fk
    foreign key (purchase_id, company_id) references public.purchases(id, company_id)
);

create index if not exists idx_inventory_movements_company_created
  on public.inventory_movements(company_id, created_at desc);
create index if not exists idx_inventory_movements_product_created
  on public.inventory_movements(product_id, created_at desc);
create index if not exists idx_inventory_movements_work_order
  on public.inventory_movements(work_order_id) where work_order_id is not null;

alter table public.inventory_movements enable row level security;
revoke all on table public.inventory_movements from anon;
grant select, insert, update, delete on table public.inventory_movements to authenticated;

drop policy if exists p_inventory_owner_select on public.inventory_movements;
drop policy if exists p_inventory_owner_insert on public.inventory_movements;
drop policy if exists p_inventory_owner_update on public.inventory_movements;
drop policy if exists p_inventory_owner_delete on public.inventory_movements;
create policy p_inventory_owner_select on public.inventory_movements
  for select to authenticated using (public.zt_is_owner(company_id));
create policy p_inventory_owner_insert on public.inventory_movements
  for insert to authenticated with check (public.zt_is_owner(company_id));
create policy p_inventory_owner_update on public.inventory_movements
  for update to authenticated using (public.zt_is_owner(company_id)) with check (public.zt_is_owner(company_id));
create policy p_inventory_owner_delete on public.inventory_movements
  for delete to authenticated using (public.zt_is_owner(company_id));

-- ---------------------------------------------------------------------------
-- Contratos recorrentes: financeiros visíveis somente ao proprietário.
-- ---------------------------------------------------------------------------
create table if not exists public.maintenance_contracts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  client_id uuid not null,
  name text not null,
  status text not null default 'active',
  recurring_amount numeric(14,2) not null default 0,
  frequency_months integer not null default 1,
  billing_day integer,
  preferred_visit_day integer,
  assigned_to uuid,
  starts_on date not null default current_date,
  ends_on date,
  next_visit_on date,
  service_place text,
  description text,
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint maintenance_contracts_id_company_key unique (id, company_id),
  constraint maintenance_contracts_status_valid check (status in ('active','paused','canceled','ended')),
  constraint maintenance_contracts_amount_nonnegative check (recurring_amount >= 0),
  constraint maintenance_contracts_frequency_valid check (frequency_months between 1 and 60),
  constraint maintenance_contracts_billing_day_valid check (billing_day is null or billing_day between 1 and 28),
  constraint maintenance_contracts_visit_day_valid check (preferred_visit_day is null or preferred_visit_day between 1 and 28),
  constraint maintenance_contracts_period_valid check (ends_on is null or ends_on >= starts_on),
  constraint maintenance_contracts_client_tenant_fk
    foreign key (client_id, company_id) references public.clients(id, company_id),
  constraint maintenance_contracts_assigned_member_fk
    foreign key (company_id, assigned_to) references public.company_members(company_id, user_id)
);

create index if not exists idx_maintenance_contracts_company_status
  on public.maintenance_contracts(company_id, status);
create index if not exists idx_maintenance_contracts_next_visit
  on public.maintenance_contracts(company_id, next_visit_on) where status='active';

alter table public.maintenance_contracts enable row level security;
revoke all on table public.maintenance_contracts from anon;
grant select, insert, update, delete on table public.maintenance_contracts to authenticated;

drop policy if exists p_maintenance_contracts_owner_select on public.maintenance_contracts;
drop policy if exists p_maintenance_contracts_owner_insert on public.maintenance_contracts;
drop policy if exists p_maintenance_contracts_owner_update on public.maintenance_contracts;
drop policy if exists p_maintenance_contracts_owner_delete on public.maintenance_contracts;
create policy p_maintenance_contracts_owner_select on public.maintenance_contracts
  for select to authenticated using (public.zt_is_owner(company_id));
create policy p_maintenance_contracts_owner_insert on public.maintenance_contracts
  for insert to authenticated with check (public.zt_is_owner(company_id));
create policy p_maintenance_contracts_owner_update on public.maintenance_contracts
  for update to authenticated using (public.zt_is_owner(company_id)) with check (public.zt_is_owner(company_id));
create policy p_maintenance_contracts_owner_delete on public.maintenance_contracts
  for delete to authenticated using (public.zt_is_owner(company_id));

-- ---------------------------------------------------------------------------
-- Visitas preventivas: não contém valor do contrato; técnico vê somente as suas.
-- ---------------------------------------------------------------------------
create table if not exists public.maintenance_visits (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  contract_id uuid,
  client_id uuid not null,
  assigned_to uuid,
  due_on date not null,
  scheduled_time time,
  status text not null default 'scheduled',
  work_order_id uuid,
  title text not null default 'Manutenção preventiva',
  note text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint maintenance_visits_status_valid check (status in ('scheduled','done','canceled','needs_quote')),
  constraint maintenance_visits_completion_valid check ((status='done') = (completed_at is not null)),
  constraint maintenance_visits_contract_tenant_fk
    foreign key (contract_id, company_id) references public.maintenance_contracts(id, company_id),
  constraint maintenance_visits_client_tenant_fk
    foreign key (client_id, company_id) references public.clients(id, company_id),
  constraint maintenance_visits_assigned_member_fk
    foreign key (company_id, assigned_to) references public.company_members(company_id, user_id),
  constraint maintenance_visits_work_order_tenant_fk
    foreign key (work_order_id, company_id) references public.work_orders(id, company_id)
);

create index if not exists idx_maintenance_visits_company_due
  on public.maintenance_visits(company_id, due_on, status);
create index if not exists idx_maintenance_visits_assigned_due
  on public.maintenance_visits(assigned_to, due_on) where status='scheduled';

alter table public.maintenance_visits enable row level security;
revoke all on table public.maintenance_visits from anon;
grant select, insert, update, delete on table public.maintenance_visits to authenticated;

drop policy if exists p_maintenance_visits_select on public.maintenance_visits;
drop policy if exists p_maintenance_visits_owner_insert on public.maintenance_visits;
drop policy if exists p_maintenance_visits_owner_update on public.maintenance_visits;
drop policy if exists p_maintenance_visits_owner_delete on public.maintenance_visits;
create policy p_maintenance_visits_select on public.maintenance_visits
  for select to authenticated using (
    public.zt_is_owner(company_id)
    or (assigned_to = (select auth.uid()) and public.zt_is_member(company_id))
  );
create policy p_maintenance_visits_owner_insert on public.maintenance_visits
  for insert to authenticated with check (public.zt_is_owner(company_id));
create policy p_maintenance_visits_owner_update on public.maintenance_visits
  for update to authenticated using (public.zt_is_owner(company_id)) with check (public.zt_is_owner(company_id));
create policy p_maintenance_visits_owner_delete on public.maintenance_visits
  for delete to authenticated using (public.zt_is_owner(company_id));

-- ---------------------------------------------------------------------------
-- Catálogo técnico seguro: nunca retorna custo, margem, fornecedor ou compras.
-- Wrapper público SECURITY INVOKER; leitura privilegiada fica em zt_private.
-- ---------------------------------------------------------------------------
create or replace function zt_private.technician_catalog(p_company uuid)
returns table(
  id uuid,
  name text,
  brand text,
  model text,
  description text,
  unit text,
  price numeric,
  warranty_months integer,
  image_path text,
  stock_on_hand numeric,
  track_stock boolean
)
language sql
stable
security definer
set search_path = public, zt_private
as $$
  select p.id, p.name, p.brand, p.model, p.description, p.unit, p.price,
         p.warranty_months, p.image_path, p.stock_on_hand, p.track_stock
    from public.products p
   where p.company_id = p_company
     and p.active = true
     and p.allow_technician_sale = true
     and zt_private.is_member(p_company)
   order by p.name;
$$;

revoke all on function zt_private.technician_catalog(uuid) from public, anon;
grant execute on function zt_private.technician_catalog(uuid) to authenticated, service_role;

create or replace function public.zt_technician_catalog(p_company uuid)
returns table(
  id uuid,
  name text,
  brand text,
  model text,
  description text,
  unit text,
  price numeric,
  warranty_months integer,
  image_path text,
  stock_on_hand numeric,
  track_stock boolean
)
language sql
stable
security invoker
set search_path = zt_private
as $$
  select * from zt_private.technician_catalog(p_company);
$$;

revoke all on function public.zt_technician_catalog(uuid) from public, anon;
grant execute on function public.zt_technician_catalog(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Guard de assinatura também protege as novas tabelas operacionais.
-- ---------------------------------------------------------------------------
drop trigger if exists trg_subscription_write_guard on public.inventory_movements;
create trigger trg_subscription_write_guard
before insert or update or delete on public.inventory_movements
for each row execute function public.zt_guard_subscription_write();

drop trigger if exists trg_subscription_write_guard on public.maintenance_contracts;
create trigger trg_subscription_write_guard
before insert or update or delete on public.maintenance_contracts
for each row execute function public.zt_guard_subscription_write();

drop trigger if exists trg_subscription_write_guard on public.maintenance_visits;
create trigger trg_subscription_write_guard
before insert or update or delete on public.maintenance_visits
for each row execute function public.zt_guard_subscription_write();
