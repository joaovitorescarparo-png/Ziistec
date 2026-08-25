-- ZiisTec Product V2: catálogo comercial, estoque leve e contratos de manutenção.
-- Migração aditiva; a produção só deve receber após homologação da branch V2.

alter table public.products
  add column if not exists image_path text,
  add column if not exists sale_enabled boolean not null default true,
  add column if not exists track_stock boolean not null default false,
  add column if not exists stock_qty numeric(14,3) not null default 0,
  add column if not exists low_stock_threshold numeric(14,3) not null default 0;

alter table public.products drop constraint if exists products_stock_nonnegative;
alter table public.products add constraint products_stock_nonnegative check (stock_qty >= 0);
alter table public.products drop constraint if exists products_low_stock_nonnegative;
alter table public.products add constraint products_low_stock_nonnegative check (low_stock_threshold >= 0);
alter table public.products drop constraint if exists products_image_path_len;
alter table public.products add constraint products_image_path_len check (image_path is null or char_length(image_path) <= 1500);

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  kind text not null check (kind in ('purchase','sale','usage','adjustment','return')),
  quantity_delta numeric(14,3) not null check (quantity_delta <> 0),
  unit_cost numeric(12,2) check (unit_cost is null or unit_cost >= 0),
  work_order_id uuid references public.work_orders(id) on delete set null,
  purchase_id uuid references public.purchases(id) on delete set null,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint inventory_product_company_fk foreign key (company_id,product_id)
    references public.products(company_id,id),
  constraint inventory_notes_len check (notes is null or char_length(notes) <= 1000)
);

create index if not exists idx_inventory_movements_product_date
  on public.inventory_movements(company_id,product_id,created_at desc);
create index if not exists idx_inventory_movements_work_order
  on public.inventory_movements(work_order_id) where work_order_id is not null;
create index if not exists idx_inventory_movements_purchase
  on public.inventory_movements(purchase_id) where purchase_id is not null;

alter table public.inventory_movements enable row level security;
drop policy if exists inventory_movements_owner_select on public.inventory_movements;
create policy inventory_movements_owner_select on public.inventory_movements
  for select to authenticated using (public.zt_is_owner(company_id));
revoke all on public.inventory_movements from anon;
revoke insert,update,delete on public.inventory_movements from authenticated;
grant select on public.inventory_movements to authenticated;

drop trigger if exists trg_subscription_write_guard on public.inventory_movements;
create trigger trg_subscription_write_guard
before insert or update or delete on public.inventory_movements
for each row execute function public.zt_guard_subscription_write();

create table if not exists public.maintenance_contracts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null,
  status text not null default 'active' check (status in ('active','paused','canceled')),
  amount numeric(12,2) not null default 0 check (amount >= 0),
  interval_months integer not null default 1 check (interval_months between 1 and 60),
  billing_day integer check (billing_day is null or billing_day between 1 and 28),
  next_service_on date,
  next_billing_on date,
  assigned_to uuid references auth.users(id) on delete set null,
  coverage text,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint maintenance_contract_client_company_fk foreign key (company_id,client_id)
    references public.clients(company_id,id),
  constraint maintenance_contract_name_len check (char_length(name) between 1 and 300),
  constraint maintenance_contract_coverage_len check (coverage is null or char_length(coverage) <= 5000),
  constraint maintenance_contract_notes_len check (notes is null or char_length(notes) <= 5000),
  unique(company_id,id)
);

create index if not exists idx_maintenance_contracts_company_status
  on public.maintenance_contracts(company_id,status,next_service_on);
create index if not exists idx_maintenance_contracts_client
  on public.maintenance_contracts(company_id,client_id,status);

alter table public.maintenance_contracts enable row level security;
drop policy if exists maintenance_contracts_owner_select on public.maintenance_contracts;
drop policy if exists maintenance_contracts_owner_insert on public.maintenance_contracts;
drop policy if exists maintenance_contracts_owner_update on public.maintenance_contracts;
drop policy if exists maintenance_contracts_owner_delete on public.maintenance_contracts;
create policy maintenance_contracts_owner_select on public.maintenance_contracts
  for select to authenticated using (public.zt_is_owner(company_id));
create policy maintenance_contracts_owner_insert on public.maintenance_contracts
  for insert to authenticated with check (public.zt_is_owner(company_id));
create policy maintenance_contracts_owner_update on public.maintenance_contracts
  for update to authenticated using (public.zt_is_owner(company_id)) with check (public.zt_is_owner(company_id));
create policy maintenance_contracts_owner_delete on public.maintenance_contracts
  for delete to authenticated using (public.zt_is_owner(company_id));
revoke all on public.maintenance_contracts from anon;
grant select,insert,update,delete on public.maintenance_contracts to authenticated;

drop trigger if exists trg_subscription_write_guard on public.maintenance_contracts;
create trigger trg_subscription_write_guard
before insert or update or delete on public.maintenance_contracts
for each row execute function public.zt_guard_subscription_write();

alter table public.warranties
  add column if not exists source text not null default 'work_order',
  add column if not exists notes text;
alter table public.warranties drop constraint if exists warranties_source_check;
alter table public.warranties add constraint warranties_source_check check (source in ('work_order','manual'));
alter table public.warranties drop constraint if exists warranties_notes_len;
alter table public.warranties add constraint warranties_notes_len check (notes is null or char_length(notes) <= 5000);

-- Catálogo seguro para técnico: jamais retorna custo, fornecedor ou margem.
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
  stock_qty numeric,
  track_stock boolean
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null then
    raise exception 'Não autenticado' using errcode='28000';
  end if;
  if not exists (
    select 1 from public.company_members m
     where m.company_id=p_company and m.user_id=auth.uid() and m.status='active'
  ) then
    raise exception 'Sem permissão' using errcode='42501';
  end if;

  return query
  select p.id,p.name,p.brand,p.model,p.description,p.unit,p.price,p.warranty_months,
         p.image_path,p.stock_qty,p.track_stock
    from public.products p
   where p.company_id=p_company
     and p.active=true
     and p.sale_enabled=true
   order by p.name;
end;
$$;
revoke all on function public.zt_technician_catalog(uuid) from public, anon;
grant execute on function public.zt_technician_catalog(uuid) to authenticated, service_role;
