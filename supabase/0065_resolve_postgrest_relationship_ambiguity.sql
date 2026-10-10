-- ZiisTec V2: remove FKs simples redundantes que deixam o PostgREST
-- sem saber qual relacionamento usar nos embeds pai -> itens.
--
-- Segurança preservada: as FKs compostas (parent_id, company_id) continuam
-- obrigatórias e validam que o item pertence ao mesmo tenant do documento.
-- Todas usam o mesmo ON DELETE CASCADE das FKs simples removidas.

begin;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname='quote_items_quote_company_fkey'
       and conrelid='public.quote_items'::regclass
       and contype='f'
  ) then
    raise exception 'Prerequisito ausente: quote_items_quote_company_fkey';
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname='wo_items_work_order_company_fkey'
       and conrelid='public.work_order_items'::regclass
       and contype='f'
  ) then
    raise exception 'Prerequisito ausente: wo_items_work_order_company_fkey';
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname='wo_materials_work_order_company_fkey'
       and conrelid='public.work_order_materials'::regclass
       and contype='f'
  ) then
    raise exception 'Prerequisito ausente: wo_materials_work_order_company_fkey';
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname='purchase_items_purchase_company_fkey'
       and conrelid='public.purchase_items'::regclass
       and contype='f'
  ) then
    raise exception 'Prerequisito ausente: purchase_items_purchase_company_fkey';
  end if;
end $$;

alter table public.quote_items
  drop constraint if exists quote_items_quote_id_fkey;

alter table public.work_order_items
  drop constraint if exists work_order_items_work_order_id_fkey;

alter table public.work_order_materials
  drop constraint if exists work_order_materials_work_order_id_fkey;

alter table public.purchase_items
  drop constraint if exists purchase_items_purchase_id_fkey;

commit;

-- Atualiza o cache de relacionamentos da API REST após a mudança de constraints.
notify pgrst, 'reload schema';
