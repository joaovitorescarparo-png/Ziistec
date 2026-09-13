-- ZiisTec Product V2: isola o custo extra da OS do registro visível ao técnico.
-- O técnico pode ler sua work_order, então work_orders.extra_cost precisa permanecer zerado.
-- O valor real fica neste ledger privado, consultável somente pelo proprietário.

create table if not exists public.work_order_private_costs (
  work_order_id uuid primary key,
  company_id uuid not null,
  extra_cost numeric(12,2) not null default 0 check (extra_cost >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_order_private_costs_wo_company_fk
    foreign key (work_order_id, company_id)
    references public.work_orders(id, company_id)
    on delete cascade
    deferrable initially deferred
);

create index if not exists idx_work_order_private_costs_company
  on public.work_order_private_costs(company_id, work_order_id);

alter table public.work_order_private_costs enable row level security;
revoke all on table public.work_order_private_costs from public, anon, authenticated;
grant select on table public.work_order_private_costs to authenticated;
grant select, insert, update, delete on table public.work_order_private_costs to service_role;

drop policy if exists p_work_order_private_costs_owner_select on public.work_order_private_costs;
create policy p_work_order_private_costs_owner_select on public.work_order_private_costs
  for select to authenticated
  using (public.zt_is_owner(company_id));

-- Backfill antes de zerar a coluna pública.
insert into public.work_order_private_costs(work_order_id, company_id, extra_cost)
select id, company_id, greatest(coalesce(extra_cost,0),0)
from public.work_orders
on conflict (work_order_id) do update
set extra_cost=excluded.extra_cost, updated_at=now();

-- A limpeza é uma operação administrativa da migration. Triggers USER são suspensos
-- somente durante este UPDATE para não bloquear OS já finalizadas; a transação da
-- migration restaura tudo em caso de falha.
alter table public.work_orders disable trigger user;
update public.work_orders set extra_cost=0 where extra_cost <> 0;
alter table public.work_orders enable trigger user;

-- Escritas futuras: chamadas autenticadas diretas nunca podem gravar custo interno.
-- RPCs confiáveis SECURITY DEFINER (salvar/finalizar OS) capturam o valor no ledger.
create or replace function zt_private.capture_work_order_extra_cost()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if coalesce(new.extra_cost,0) < 0 then
    raise exception 'Custo extra inválido' using errcode='22023';
  end if;

  if current_user = 'authenticated' then
    if coalesce(new.extra_cost,0) <> 0 then
      raise exception 'Custo interno não pode ser gravado diretamente na OS' using errcode='42501';
    end if;
    new.extra_cost := 0;
    return new;
  end if;

  insert into public.work_order_private_costs(work_order_id, company_id, extra_cost)
  values(new.id, new.company_id, greatest(coalesce(new.extra_cost,0),0))
  on conflict (work_order_id) do update
    set company_id=excluded.company_id,
        extra_cost=excluded.extra_cost,
        updated_at=now();

  new.extra_cost := 0;
  return new;
end;
$$;

revoke all on function zt_private.capture_work_order_extra_cost() from public, anon, authenticated;

drop trigger if exists trg_capture_work_order_extra_cost on public.work_orders;
create trigger trg_capture_work_order_extra_cost
before insert or update of extra_cost on public.work_orders
for each row execute function zt_private.capture_work_order_extra_cost();
