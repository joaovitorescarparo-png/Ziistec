-- ZiisTec Product V2 — fundação de catálogo, estoque e manutenção recorrente.
-- Migration aditiva: não remove dados nem enfraquece RLS existente.

-- ---------------------------------------------------------------- products
alter table public.products
  add column if not exists image_path text,
  add column if not exists stock_on_hand numeric(12,3) not null default 0,
  add column if not exists low_stock_level numeric(12,3) not null default 0,
  add column if not exists sellable_by_technician boolean not null default true,
  add column if not exists updated_at timestamptz not null default now();

alter table public.products drop constraint if exists products_image_path_bound;
alter table public.products
  add constraint products_image_path_bound
  check (image_path is null or length(image_path) <= 1200);

alter table public.products drop constraint if exists products_stock_nonnegative;
alter table public.products
  add constraint products_stock_nonnegative check (stock_on_hand >= 0);

alter table public.products drop constraint if exists products_low_stock_nonnegative;
alter table public.products
  add constraint products_low_stock_nonnegative check (low_stock_level >= 0);

create index if not exists idx_products_company_active_sellable
  on public.products(company_id, active, sellable_by_technician);

-- O saldo de estoque muda por movimento; update direto da API é bloqueado.
create or replace function public.zt_guard_product_stock_direct_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.stock_on_hand is distinct from old.stock_on_hand
     and current_user in ('authenticated','anon') then
    raise exception 'Saldo de estoque só pode ser alterado por movimento de estoque'
      using errcode='42501';
  end if;
  return new;
end;
$$;

revoke all on function public.zt_guard_product_stock_direct_write()
  from public, anon, authenticated;

drop trigger if exists trg_guard_product_stock_direct_write on public.products;
create trigger trg_guard_product_stock_direct_write
before update on public.products
for each row execute function public.zt_guard_product_stock_direct_write();

drop trigger if exists trg_products_touch_v2 on public.products;
create trigger trg_products_touch_v2
before update on public.products
for each row execute function public.zt_touch();

-- ------------------------------------------------------- stock movements
create table if not exists public.product_stock_movements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  product_id uuid not null,
  work_order_id uuid,
  purchase_id uuid,
  movement_type text not null,
  quantity_delta numeric(12,3) not null,
  unit_cost_snapshot numeric(12,2),
  unit_price_snapshot numeric(12,2),
  note text,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  constraint stock_movements_product_company_fkey
    foreign key (product_id, company_id)
    references public.products(id, company_id) on delete restrict,
  constraint stock_movements_work_order_company_fkey
    foreign key (work_order_id, company_id)
    references public.work_orders(id, company_id) on delete restrict,
  constraint stock_movements_purchase_company_fkey
    foreign key (purchase_id, company_id)
    references public.purchases(id, company_id) on delete restrict,
  constraint stock_movements_type_check
    check (movement_type in ('purchase','sale','usage','return','adjustment')),
  constraint stock_movements_delta_nonzero
    check (quantity_delta <> 0),
  constraint stock_movements_cost_nonnegative
    check (unit_cost_snapshot is null or unit_cost_snapshot >= 0),
  constraint stock_movements_price_nonnegative
    check (unit_price_snapshot is null or unit_price_snapshot >= 0),
  constraint stock_movements_note_bound
    check (note is null or length(note) <= 1200)
);

create index if not exists idx_stock_movements_company_product_date
  on public.product_stock_movements(company_id, product_id, created_at desc);
create index if not exists idx_stock_movements_work_order
  on public.product_stock_movements(work_order_id) where work_order_id is not null;
create index if not exists idx_stock_movements_purchase
  on public.product_stock_movements(purchase_id) where purchase_id is not null;

alter table public.product_stock_movements enable row level security;

drop policy if exists p_stock_movements_select on public.product_stock_movements;
create policy p_stock_movements_select
on public.product_stock_movements for select to authenticated
using (public.zt_is_owner(company_id));

drop policy if exists p_stock_movements_insert on public.product_stock_movements;
create policy p_stock_movements_insert
on public.product_stock_movements for insert to authenticated
with check (
  public.zt_is_owner(company_id)
  and created_by = (select auth.uid())
);

-- Ledger imutável: correção de estoque é novo movimento, nunca editar/apagar histórico.
revoke update, delete on table public.product_stock_movements from authenticated;
grant select, insert on table public.product_stock_movements to authenticated;

create or replace function zt_private.apply_stock_movement()
returns trigger
language plpgsql
security definer
set search_path = public, zt_private
as $$
declare
  v_current numeric(12,3);
  v_next numeric(12,3);
begin
  perform zt_private.assert_operational_write_allowed(new.company_id);

  select p.stock_on_hand
    into v_current
    from public.products p
   where p.id = new.product_id
     and p.company_id = new.company_id
   for update;

  if not found then
    raise exception 'Produto não encontrado' using errcode='23503';
  end if;

  v_next := v_current + new.quantity_delta;
  if v_next < 0 then
    raise exception 'Estoque insuficiente'
      using errcode='23514',
            detail = format('Disponível: %s; movimento: %s', v_current, new.quantity_delta);
  end if;

  update public.products
     set stock_on_hand = v_next,
         updated_at = now()
   where id = new.product_id
     and company_id = new.company_id;

  return new;
end;
$$;

revoke all on function zt_private.apply_stock_movement()
  from public, anon, authenticated;

drop trigger if exists trg_apply_stock_movement on public.product_stock_movements;
create trigger trg_apply_stock_movement
after insert on public.product_stock_movements
for each row execute function zt_private.apply_stock_movement();

drop trigger if exists trg_subscription_write_guard on public.product_stock_movements;
create trigger trg_subscription_write_guard
before insert or update or delete on public.product_stock_movements
for each row execute function public.zt_guard_subscription_write();

-- ------------------------------------------------ maintenance contracts
create table if not exists public.maintenance_contracts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  client_id uuid not null,
  assigned_to uuid,
  title text not null,
  description text,
  recurring_amount numeric(12,2) not null default 0,
  billing_frequency text not null default 'monthly',
  visit_frequency_months integer not null default 1,
  billing_day integer,
  start_on date not null default current_date,
  end_on date,
  next_visit_on date,
  next_billing_on date,
  auto_create_work_order boolean not null default true,
  status text not null default 'active',
  notes text,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint maintenance_contracts_id_company_key unique(id, company_id),
  constraint maintenance_contracts_client_company_fkey
    foreign key (client_id, company_id)
    references public.clients(id, company_id) on delete restrict,
  constraint maintenance_contracts_assignee_company_fkey
    foreign key (company_id, assigned_to)
    references public.company_members(company_id, user_id) on delete restrict,
  constraint maintenance_contracts_amount_nonnegative
    check (recurring_amount >= 0),
  constraint maintenance_contracts_billing_frequency
    check (billing_frequency in ('monthly','quarterly','yearly')),
  constraint maintenance_contracts_visit_frequency
    check (visit_frequency_months between 1 and 24),
  constraint maintenance_contracts_billing_day
    check (billing_day is null or billing_day between 1 and 28),
  constraint maintenance_contracts_status
    check (status in ('active','paused','canceled')),
  constraint maintenance_contracts_dates
    check (end_on is null or end_on >= start_on),
  constraint maintenance_contracts_text_bounds
    check (
      length(title) between 1 and 200
      and (description is null or length(description) <= 4000)
      and (notes is null or length(notes) <= 4000)
    )
);

create index if not exists idx_maintenance_contracts_company_status
  on public.maintenance_contracts(company_id, status);
create index if not exists idx_maintenance_contracts_next_visit
  on public.maintenance_contracts(company_id, next_visit_on)
  where status='active' and next_visit_on is not null;
create index if not exists idx_maintenance_contracts_assigned
  on public.maintenance_contracts(company_id, assigned_to, next_visit_on)
  where status='active' and assigned_to is not null;

alter table public.maintenance_contracts enable row level security;

drop policy if exists p_maintenance_contracts_select on public.maintenance_contracts;
create policy p_maintenance_contracts_select
on public.maintenance_contracts for select to authenticated
using (
  public.zt_is_owner(company_id)
  or (
    assigned_to = (select auth.uid())
    and public.zt_is_member(company_id)
  )
);

drop policy if exists p_maintenance_contracts_insert on public.maintenance_contracts;
create policy p_maintenance_contracts_insert
on public.maintenance_contracts for insert to authenticated
with check (
  public.zt_is_owner(company_id)
  and created_by = (select auth.uid())
);

drop policy if exists p_maintenance_contracts_update on public.maintenance_contracts;
create policy p_maintenance_contracts_update
on public.maintenance_contracts for update to authenticated
using (public.zt_is_owner(company_id))
with check (public.zt_is_owner(company_id));

drop policy if exists p_maintenance_contracts_delete on public.maintenance_contracts;
create policy p_maintenance_contracts_delete
on public.maintenance_contracts for delete to authenticated
using (public.zt_is_owner(company_id));

grant select, insert, update, delete on table public.maintenance_contracts to authenticated;

drop trigger if exists trg_maintenance_contracts_touch on public.maintenance_contracts;
create trigger trg_maintenance_contracts_touch
before update on public.maintenance_contracts
for each row execute function public.zt_touch();

drop trigger if exists trg_subscription_write_guard on public.maintenance_contracts;
create trigger trg_subscription_write_guard
before insert or update or delete on public.maintenance_contracts
for each row execute function public.zt_guard_subscription_write();

-- Liga visitas preventivas/contratuais à OS sem alterar o fluxo de garantia existente.
alter table public.work_orders
  add column if not exists maintenance_contract_id uuid,
  add column if not exists is_preventive_visit boolean not null default false;

alter table public.work_orders
  drop constraint if exists work_orders_maintenance_contract_company_fkey;
alter table public.work_orders
  add constraint work_orders_maintenance_contract_company_fkey
  foreign key (maintenance_contract_id, company_id)
  references public.maintenance_contracts(id, company_id) on delete restrict;

create index if not exists idx_work_orders_maintenance_contract
  on public.work_orders(maintenance_contract_id)
  where maintenance_contract_id is not null;

-- ------------------------------------ catálogo seguro para colaboradores
-- Produtos base continuam owner-only. Esta função devolve SOMENTE campos comerciais.
create or replace function zt_private.catalog_products(p_company uuid)
returns table (
  id uuid,
  company_id uuid,
  name text,
  brand text,
  model text,
  description text,
  unit text,
  price numeric,
  warranty_months integer,
  image_path text,
  stock_on_hand numeric,
  low_stock boolean
)
language sql
stable
security definer
set search_path = public, zt_private
as $$
  select
    p.id,
    p.company_id,
    p.name,
    p.brand,
    p.model,
    p.description,
    p.unit,
    p.price,
    p.warranty_months,
    p.image_path,
    p.stock_on_hand,
    (p.stock_on_hand <= p.low_stock_level) as low_stock
  from public.products p
  where p.company_id = p_company
    and p.active = true
    and p.sellable_by_technician = true
    and zt_private.is_member(p_company);
$$;

revoke all on function zt_private.catalog_products(uuid) from public, anon;
grant execute on function zt_private.catalog_products(uuid) to authenticated, service_role;

create or replace function public.zt_list_sellable_products(p_company uuid)
returns table (
  id uuid,
  company_id uuid,
  name text,
  brand text,
  model text,
  description text,
  unit text,
  price numeric,
  warranty_months integer,
  image_path text,
  stock_on_hand numeric,
  low_stock boolean
)
language sql
stable
security invoker
set search_path = zt_private
as $$ select * from zt_private.catalog_products(p_company); $$;

revoke all on function public.zt_list_sellable_products(uuid) from public, anon;
grant execute on function public.zt_list_sellable_products(uuid) to authenticated, service_role;

-- public.products continua owner-only: custo/margem/fornecedor não vazam ao técnico.
