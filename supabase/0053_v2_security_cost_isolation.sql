-- ZiisTec Product V2: isolamento de custos sensíveis e integridade tenant.
-- O técnico pode consultar a própria OS, mas custo/margem pertencem somente ao owner.

-- ---------------------------------------------------------------- tenant integrity
alter table public.inventory_movements
  drop constraint if exists inventory_work_order_company_fk;
alter table public.inventory_movements
  add constraint inventory_work_order_company_fk
  foreign key (work_order_id, company_id)
  references public.work_orders(id, company_id);

alter table public.inventory_movements
  drop constraint if exists inventory_purchase_company_fk;
alter table public.inventory_movements
  add constraint inventory_purchase_company_fk
  foreign key (purchase_id, company_id)
  references public.purchases(id, company_id);

alter table public.maintenance_contracts
  drop constraint if exists maintenance_contract_assigned_member_fk;
alter table public.maintenance_contracts
  add constraint maintenance_contract_assigned_member_fk
  foreign key (company_id, assigned_to)
  references public.company_members(company_id, user_id);

-- --------------------------------------------------------- owner-only cost ledgers
create table if not exists public.work_order_item_costs (
  work_order_item_id uuid primary key references public.work_order_items(id) on delete cascade,
  work_order_id uuid not null,
  company_id uuid not null,
  unit_cost numeric(12,2) not null default 0 check (unit_cost >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_order_item_costs_wo_company_fk
    foreign key (work_order_id, company_id)
    references public.work_orders(id, company_id) on delete cascade
);

create index if not exists idx_work_order_item_costs_company_wo
  on public.work_order_item_costs(company_id, work_order_id);

alter table public.work_order_item_costs enable row level security;
revoke all on table public.work_order_item_costs from public, anon, authenticated;
grant select on table public.work_order_item_costs to authenticated;
drop policy if exists p_work_order_item_costs_owner_select on public.work_order_item_costs;
create policy p_work_order_item_costs_owner_select on public.work_order_item_costs
  for select to authenticated using (public.zt_is_owner(company_id));

create table if not exists public.work_order_material_costs (
  work_order_material_id uuid primary key references public.work_order_materials(id) on delete cascade,
  work_order_id uuid not null,
  company_id uuid not null,
  unit_cost numeric(12,2) not null default 0 check (unit_cost >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_order_material_costs_wo_company_fk
    foreign key (work_order_id, company_id)
    references public.work_orders(id, company_id) on delete cascade
);

create index if not exists idx_work_order_material_costs_company_wo
  on public.work_order_material_costs(company_id, work_order_id);

alter table public.work_order_material_costs enable row level security;
revoke all on table public.work_order_material_costs from public, anon, authenticated;
grant select on table public.work_order_material_costs to authenticated;
drop policy if exists p_work_order_material_costs_owner_select on public.work_order_material_costs;
create policy p_work_order_material_costs_owner_select on public.work_order_material_costs
  for select to authenticated using (public.zt_is_owner(company_id));

-- ------------------------------------------------------------- safe backfill
-- Copia custos já existentes para os ledgers privados. A alteração das linhas-base
-- roda como migration privilegiada; o guard de assinatura é suspenso somente dentro
-- desta transação e reativado imediatamente.
insert into public.work_order_item_costs(work_order_item_id, work_order_id, company_id, unit_cost)
select id, work_order_id, company_id, greatest(coalesce(unit_cost,0),0)
from public.work_order_items
on conflict (work_order_item_id) do update
set unit_cost=excluded.unit_cost, updated_at=now();

insert into public.work_order_material_costs(work_order_material_id, work_order_id, company_id, unit_cost)
select id, work_order_id, company_id, greatest(coalesce(unit_cost,0),0)
from public.work_order_materials
on conflict (work_order_material_id) do update
set unit_cost=excluded.unit_cost, updated_at=now();

alter table public.work_order_items disable trigger trg_subscription_write_guard;
update public.work_order_items set unit_cost=0 where unit_cost <> 0;
alter table public.work_order_items enable trigger trg_subscription_write_guard;

alter table public.work_order_materials disable trigger trg_subscription_write_guard;
update public.work_order_materials set unit_cost=0 where unit_cost <> 0;
alter table public.work_order_materials enable trigger trg_subscription_write_guard;

-- ----------------------------------------------------- capture future inserts
create or replace function zt_private.capture_work_order_item_cost_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.work_order_item_costs(work_order_item_id, work_order_id, company_id, unit_cost)
  values(new.id, new.work_order_id, new.company_id, greatest(coalesce(new.unit_cost,0),0))
  on conflict (work_order_item_id) do update
    set unit_cost=excluded.unit_cost, updated_at=now();

  if coalesce(new.unit_cost,0) <> 0 then
    update public.work_order_items set unit_cost=0 where id=new.id;
  end if;
  return new;
end;
$$;
revoke all on function zt_private.capture_work_order_item_cost_insert() from public, anon, authenticated;

drop trigger if exists trg_capture_work_order_item_cost_insert on public.work_order_items;
create trigger trg_capture_work_order_item_cost_insert
after insert on public.work_order_items
for each row execute function zt_private.capture_work_order_item_cost_insert();

create or replace function zt_private.capture_work_order_material_cost_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.work_order_material_costs(work_order_material_id, work_order_id, company_id, unit_cost)
  values(new.id, new.work_order_id, new.company_id, greatest(coalesce(new.unit_cost,0),0))
  on conflict (work_order_material_id) do update
    set unit_cost=excluded.unit_cost, updated_at=now();

  if coalesce(new.unit_cost,0) <> 0 then
    update public.work_order_materials set unit_cost=0 where id=new.id;
  end if;
  return new;
end;
$$;
revoke all on function zt_private.capture_work_order_material_cost_insert() from public, anon, authenticated;

drop trigger if exists trg_capture_work_order_material_cost_insert on public.work_order_materials;
create trigger trg_capture_work_order_material_cost_insert
after insert on public.work_order_materials
for each row execute function zt_private.capture_work_order_material_cost_insert();

-- Bloqueia reintrodução de custo no registro técnico por UPDATE direto.
create or replace function public.zt_guard_work_order_visible_cost()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.unit_cost is distinct from old.unit_cost and coalesce(new.unit_cost,0) <> 0 then
    raise exception 'Custo interno não pode ser gravado no registro visível da OS' using errcode='42501';
  end if;
  new.unit_cost := 0;
  return new;
end;
$$;
revoke all on function public.zt_guard_work_order_visible_cost() from public, anon, authenticated;

drop trigger if exists trg_guard_work_order_item_visible_cost on public.work_order_items;
create trigger trg_guard_work_order_item_visible_cost
before update of unit_cost on public.work_order_items
for each row execute function public.zt_guard_work_order_visible_cost();

drop trigger if exists trg_guard_work_order_material_visible_cost on public.work_order_materials;
create trigger trg_guard_work_order_material_visible_cost
before update of unit_cost on public.work_order_materials
for each row execute function public.zt_guard_work_order_visible_cost();
