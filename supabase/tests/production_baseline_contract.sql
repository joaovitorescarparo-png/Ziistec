-- ZiisTec — contrato read-only do baseline que precede a Product V2.
-- Executar no staging DEPOIS do baseline até 0049 + staging/production_baseline_reconciliation.sql
-- e ANTES de 0050→0061. Não altera dados nem schema.

do $$
declare
  r record;
  v_def text;
begin
  -- Constraints de limites de texto existentes na produção em 2026-08-26.
  for r in
    select * from (values
      ('profiles','profiles_text_bounds'),
      ('companies','companies_text_bounds'),
      ('company_members','member_job_title_bound'),
      ('company_invites','invite_text_bounds'),
      ('clients','clients_text_bounds'),
      ('services','services_text_bounds'),
      ('products','products_text_bounds'),
      ('quotes','quotes_text_bounds'),
      ('quote_items','quote_items_text_bounds'),
      ('work_orders','work_orders_text_bounds'),
      ('work_order_items','wo_items_text_bounds'),
      ('work_order_materials','wo_materials_text_bounds'),
      ('work_order_reports','wo_reports_text_bounds'),
      ('work_order_checklists','wo_checklists_text_bound'),
      ('purchases','purchases_text_bounds'),
      ('purchase_items','purchase_items_name_bound'),
      ('financial_entries','financial_text_bounds'),
      ('warranties','warranties_text_bounds')
    ) as x(table_name,constraint_name)
  loop
    if not exists (
      select 1
      from pg_constraint c
      join pg_class t on t.oid=c.conrelid
      join pg_namespace n on n.oid=t.relnamespace
      where n.nspname='public'
        and t.relname=r.table_name
        and c.conname=r.constraint_name
        and c.contype='c'
    ) then
      raise exception 'BASELINE_CONSTRAINT_MISSING %.%', r.table_name, r.constraint_name;
    end if;
  end loop;

  -- Os checks não podem existir só de nome: validamos limites centrais observados em produção.
  select pg_get_constraintdef(c.oid) into v_def
  from pg_constraint c where c.conrelid='public.companies'::regclass and c.conname='companies_text_bounds';
  if v_def not ilike '%length(name) <= 200%'
     or v_def not ilike '%length(email)%320%'
     or v_def not ilike '%length(default_notes)%10000%' then
    raise exception 'BASELINE_COMPANIES_TEXT_BOUNDS_DRIFT';
  end if;

  select pg_get_constraintdef(c.oid) into v_def
  from pg_constraint c where c.conrelid='public.clients'::regclass and c.conname='clients_text_bounds';
  if v_def not ilike '%length(name) <= 200%'
     or v_def not ilike '%length(address)%1000%'
     or v_def not ilike '%length(notes)%10000%' then
    raise exception 'BASELINE_CLIENTS_TEXT_BOUNDS_DRIFT';
  end if;

  select pg_get_constraintdef(c.oid) into v_def
  from pg_constraint c where c.conrelid='public.work_orders'::regclass and c.conname='work_orders_text_bounds';
  if v_def not ilike '%length(number) <= 50%'
     or v_def not ilike '%length(request)%10000%'
     or v_def not ilike '%length(problem_report)%10000%' then
    raise exception 'BASELINE_WORK_ORDERS_TEXT_BOUNDS_DRIFT';
  end if;

  -- Baseline 0049: localização Google/Maps.
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='clients' and column_name='google_place_id'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='clients' and column_name='latitude'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='clients' and column_name='longitude'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='clients' and column_name='maps_url'
  ) then
    raise exception 'BASELINE_CLIENT_LOCATION_COLUMNS_MISSING';
  end if;

  for r in
    select unnest(array[
      'clients_latitude_range',
      'clients_longitude_range',
      'clients_maps_url_bounds',
      'clients_google_place_id_bounds'
    ]) as constraint_name
  loop
    if not exists (
      select 1 from pg_constraint
      where conrelid='public.clients'::regclass and conname=r.constraint_name and contype='c'
    ) then
      raise exception 'BASELINE_CLIENT_LOCATION_CONSTRAINT_MISSING %', r.constraint_name;
    end if;
  end loop;

  -- Índices básicos da listagem de empresas/membresia observados em produção.
  if to_regclass('public.idx_members_company') is null then
    raise exception 'BASELINE_INDEX_MISSING idx_members_company';
  end if;
  if to_regclass('public.idx_members_user') is null then
    raise exception 'BASELINE_INDEX_MISSING idx_members_user';
  end if;
  if to_regclass('public.company_members_company_id_user_id_key') is null then
    raise exception 'BASELINE_INDEX_MISSING company_members_company_id_user_id_key';
  end if;
  if to_regclass('public.subscriptions_company_id_key') is null then
    raise exception 'BASELINE_INDEX_MISSING subscriptions_company_id_key';
  end if;
end
$$;

select 'PRODUCTION_BASELINE_CONTRACT_OK' as result;
