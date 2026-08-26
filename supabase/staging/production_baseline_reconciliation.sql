-- ZiisTec · STAGING ONLY — reconciliação do baseline atual de produção
--
-- Objetivo: reproduzir em um projeto Supabase NOVO de homologação os invariantes
-- que existem hoje em produção, mas cuja migration histórica não está mais
-- representada como arquivo canônico no repositório.
--
-- NÃO aplicar em produção. NÃO é uma migration V2. NÃO contém dados reais.
-- Deve ser executado depois do baseline versionado até 0049 e antes de 0050→0061.

begin;

-- A migration histórica `bound_text_inputs_and_optimize_company_lists` está
-- registrada no histórico real do Supabase, mas seus limites de texto não
-- aparecem nos arquivos atuais do repositório. Estes CHECKs foram extraídos
-- do catálogo de produção em 2026-08-26 e são adicionados de forma idempotente.

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid='public.profiles'::regclass and conname='profiles_text_bounds') then
    alter table public.profiles add constraint profiles_text_bounds check (
      coalesce(length(full_name),0) <= 200
      and coalesce(length(email),0) <= 320
      and coalesce(length(phone),0) <= 40
    );
  end if;

  if not exists (select 1 from pg_constraint where conrelid='public.companies'::regclass and conname='companies_text_bounds') then
    alter table public.companies add constraint companies_text_bounds check (
      length(name) <= 200
      and coalesce(length(trade_name),0) <= 200
      and coalesce(length(tax_id),0) <= 50
      and coalesce(length(activity),0) <= 300
      and coalesce(length(phone),0) <= 40
      and coalesce(length(whatsapp),0) <= 40
      and coalesce(length(email),0) <= 320
      and coalesce(length(address),0) <= 1000
      and coalesce(length(logo_path),0) <= 1000
      and coalesce(length(owner_name),0) <= 200
      and coalesce(length(default_payment_terms),0) <= 2000
      and coalesce(length(default_notes),0) <= 10000
    );
  end if;

  if not exists (select 1 from pg_constraint where conrelid='public.company_members'::regclass and conname='member_job_title_bound') then
    alter table public.company_members add constraint member_job_title_bound
      check (coalesce(length(job_title),0) <= 120);
  end if;

  if not exists (select 1 from pg_constraint where conrelid='public.company_invites'::regclass and conname='invite_text_bounds') then
    alter table public.company_invites add constraint invite_text_bounds check (
      length(email) <= 320
      and coalesce(length(job_title),0) <= 120
      and coalesce(length(name),0) <= 200
      and coalesce(length(phone),0) <= 40
    );
  end if;

  if not exists (select 1 from pg_constraint where conrelid='public.clients'::regclass and conname='clients_text_bounds') then
    alter table public.clients add constraint clients_text_bounds check (
      person_type = any(array['PF'::text,'PJ'::text])
      and length(name) <= 200
      and coalesce(length(trade_name),0) <= 200
      and coalesce(length(tax_id),0) <= 50
      and coalesce(length(contact_name),0) <= 200
      and coalesce(length(phone),0) <= 40
      and coalesce(length(whatsapp),0) <= 40
      and coalesce(length(address),0) <= 1000
      and coalesce(length(notes),0) <= 10000
    );
  end if;

  if not exists (select 1 from pg_constraint where conrelid='public.services'::regclass and conname='services_text_bounds') then
    alter table public.services add constraint services_text_bounds check (
      length(name) <= 300
      and coalesce(length(category),0) <= 200
      and coalesce(length(description),0) <= 5000
      and length(unit) <= 50
    );
  end if;

  if not exists (select 1 from pg_constraint where conrelid='public.products'::regclass and conname='products_text_bounds') then
    alter table public.products add constraint products_text_bounds check (
      length(name) <= 300
      and coalesce(length(brand),0) <= 200
      and coalesce(length(model),0) <= 200
      and coalesce(length(description),0) <= 5000
      and length(unit) <= 50
    );
  end if;

  if not exists (select 1 from pg_constraint where conrelid='public.quotes'::regclass and conname='quotes_text_bounds') then
    alter table public.quotes add constraint quotes_text_bounds check (
      length(number) <= 50
      and coalesce(length(payment_terms),0) <= 2000
      and coalesce(length(notes),0) <= 10000
      and coalesce(length(address),0) <= 1000
      and coalesce(length(service_place),0) <= 1000
    );
  end if;

  if not exists (select 1 from pg_constraint where conrelid='public.quote_items'::regclass and conname='quote_items_text_bounds') then
    alter table public.quote_items add constraint quote_items_text_bounds check (
      length(name) <= 500
      and length(unit) <= 50
      and coalesce(length(notes),0) <= 5000
    );
  end if;

  if not exists (select 1 from pg_constraint where conrelid='public.work_orders'::regclass and conname='work_orders_text_bounds') then
    alter table public.work_orders add constraint work_orders_text_bounds check (
      length(number) <= 50
      and coalesce(length(address),0) <= 1000
      and coalesce(length(service_place),0) <= 1000
      and coalesce(length(request),0) <= 10000
      and coalesce(length(pre_notes),0) <= 10000
      and coalesce(length(pending_note),0) <= 5000
      and coalesce(length(problem_report),0) <= 10000
    );
  end if;

  if not exists (select 1 from pg_constraint where conrelid='public.work_order_items'::regclass and conname='wo_items_text_bounds') then
    alter table public.work_order_items add constraint wo_items_text_bounds check (
      length(name) <= 500
      and length(unit) <= 50
      and coalesce(length(notes),0) <= 5000
    );
  end if;

  if not exists (select 1 from pg_constraint where conrelid='public.work_order_materials'::regclass and conname='wo_materials_text_bounds') then
    alter table public.work_order_materials add constraint wo_materials_text_bounds check (
      length(name) <= 500
      and coalesce(length(serial_number),0) <= 200
    );
  end if;

  if not exists (select 1 from pg_constraint where conrelid='public.work_order_reports'::regclass and conname='wo_reports_text_bounds') then
    alter table public.work_order_reports add constraint wo_reports_text_bounds check (
      entry_type = any(array['report'::text,'history'::text])
      and length(body) <= 10000
    );
  end if;

  if not exists (select 1 from pg_constraint where conrelid='public.work_order_checklists'::regclass and conname='wo_checklists_text_bound') then
    alter table public.work_order_checklists add constraint wo_checklists_text_bound
      check (length(text) <= 1000);
  end if;

  if not exists (select 1 from pg_constraint where conrelid='public.purchases'::regclass and conname='purchases_text_bounds') then
    alter table public.purchases add constraint purchases_text_bounds check (
      length(number) <= 50
      and length(supplier_name) <= 300
      and coalesce(length(payment_method),0) <= 100
      and coalesce(length(notes),0) <= 10000
    );
  end if;

  if not exists (select 1 from pg_constraint where conrelid='public.purchase_items'::regclass and conname='purchase_items_name_bound') then
    alter table public.purchase_items add constraint purchase_items_name_bound
      check (length(name) <= 500);
  end if;

  if not exists (select 1 from pg_constraint where conrelid='public.financial_entries'::regclass and conname='financial_text_bounds') then
    alter table public.financial_entries add constraint financial_text_bounds check (
      length(description) <= 500
      and coalesce(length(payment_method),0) <= 100
      and coalesce(length(category),0) <= 200
    );
  end if;

  if not exists (select 1 from pg_constraint where conrelid='public.warranties'::regclass and conname='warranties_text_bounds') then
    alter table public.warranties add constraint warranties_text_bounds check (
      length(description) <= 500
      and coalesce(length(service_place),0) <= 1000
      and coalesce(length(serial_number),0) <= 200
    );
  end if;
end
$$;

commit;
