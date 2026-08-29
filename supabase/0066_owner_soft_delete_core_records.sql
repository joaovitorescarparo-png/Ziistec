-- ZiisTec migration 0066
-- Exclusão lógica (soft delete) dos registros operacionais principais.
-- Objetivo: permitir que o proprietário remova registros da interface sem
-- destruir histórico referenciado por orçamento, OS, financeiro ou garantia.
-- STAGING FIRST: aplicar em produção somente após homologação.

alter table public.clients            add column if not exists deleted_at timestamptz;
alter table public.services           add column if not exists deleted_at timestamptz;
alter table public.products           add column if not exists deleted_at timestamptz;
alter table public.quotes             add column if not exists deleted_at timestamptz;
alter table public.work_orders        add column if not exists deleted_at timestamptz;
alter table public.purchases          add column if not exists deleted_at timestamptz;
alter table public.financial_entries  add column if not exists deleted_at timestamptz;
alter table public.warranties         add column if not exists deleted_at timestamptz;

create index if not exists idx_clients_company_visible
  on public.clients(company_id, created_at desc) where deleted_at is null;
create index if not exists idx_services_company_visible
  on public.services(company_id, created_at desc) where deleted_at is null;
create index if not exists idx_products_company_visible
  on public.products(company_id, created_at desc) where deleted_at is null;
create index if not exists idx_quotes_company_visible
  on public.quotes(company_id, created_at desc) where deleted_at is null;
create index if not exists idx_work_orders_company_visible
  on public.work_orders(company_id, created_at desc) where deleted_at is null;
create index if not exists idx_purchases_company_visible
  on public.purchases(company_id, created_at desc) where deleted_at is null;
create index if not exists idx_financial_entries_company_visible
  on public.financial_entries(company_id, created_at desc) where deleted_at is null;
create index if not exists idx_warranties_company_visible
  on public.warranties(company_id, created_at desc) where deleted_at is null;

create or replace function public.zt_guard_owner_soft_delete()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.deleted_at is distinct from old.deleted_at then
    if not public.zt_is_owner(old.company_id) then
      raise exception 'Somente o proprietário pode excluir ou restaurar este registro.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.zt_guard_owner_soft_delete() from public;
grant execute on function public.zt_guard_owner_soft_delete() to authenticated;

DO $$
declare
  t text;
begin
  foreach t in array array[
    'clients','services','products','quotes','work_orders','purchases','financial_entries','warranties'
  ] loop
    execute format('drop trigger if exists trg_%I_owner_soft_delete on public.%I', t, t);
    execute format(
      'create trigger trg_%I_owner_soft_delete before update of deleted_at on public.%I for each row execute function public.zt_guard_owner_soft_delete()',
      t, t
    );
  end loop;
end $$;

comment on function public.zt_guard_owner_soft_delete() is
  'Impede técnico ou outro membro não-owner de alterar deleted_at, mesmo quando possui UPDATE operacional na tabela.';

notify pgrst, 'reload schema';
