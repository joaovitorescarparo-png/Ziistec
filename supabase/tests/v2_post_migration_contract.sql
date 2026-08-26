-- ZiisTec Stack V2 — contrato pós-migration para HOMOLOGAÇÃO.
--
-- Uso: executar SOMENTE depois de aplicar 0050→0061 em banco de homologação.
-- Este arquivo não cria/edita dados de negócio. Ele apenas lê catálogos do PostgreSQL
-- e aborta com RAISE EXCEPTION quando um contrato estrutural crítico não estiver presente.
-- Não substitui os testes reais owner/technician descritos em docs/V2_HOMOLOGATION_RUNBOOK.md.

DO $$
DECLARE
  v_missing text[] := ARRAY[]::text[];
  v_count integer;
  v_search_path text;
  v_unreviewed_definers text[];
  v_definers_without_path text[];
  v_allowed_definer_signatures text[] := ARRAY[
    -- Superfície pública autenticada já existente e revisada antes da V2.
    'zt_accept_invites()',
    'zt_cancel_subscription(p_company uuid)',
    'zt_client_visible(c_id uuid, comp uuid)',
    'zt_compartilha_empresa(outro uuid)',
    'zt_consume_ai_quota(p_company uuid)',
    'zt_consume_quote_pdf_quota(p_company uuid)',
    'zt_create_company(p_name text, p_activity text, p_has_team boolean, p_owner_name text, p_phone text)',
    'zt_finalize_work_order_atomic(p_wo uuid, p_report text, p_pending text, p_extra_cost numeric, p_due_days integer, p_materials jsonb, p_additions jsonb)',
    'zt_is_member(target uuid)',
    'zt_is_owner(target uuid)',
    'zt_is_platform_admin()',
    'zt_platform_set_subscription_status(p_company uuid, p_status zt_sub_status)',
    'zt_reactivate_subscription(p_company uuid)',
    'zt_refresh_subscription_status(p_company uuid)',
    'zt_resolve_work_order_pricing(p_wo uuid, p_prices jsonb, p_due_days integer)',
    'zt_save_manual_financial_entry(p_company uuid, p_entry uuid, p_request uuid, p_row jsonb)',
    'zt_save_purchase_idempotent(p_company uuid, p_purchase uuid, p_request uuid, p_row jsonb, p_items jsonb)',
    'zt_save_quote_idempotent(p_company uuid, p_quote uuid, p_request uuid, p_row jsonb, p_items jsonb)',
    'zt_save_work_order_idempotent(p_company uuid, p_wo uuid, p_request uuid, p_row jsonb, p_items jsonb)',
    'zt_set_financial_paid(p_entry uuid, p_paid boolean, p_method text)',
    'zt_set_followup_status(p_followup uuid, p_status text)',
    'zt_subscription_can_write(target uuid)',
    'zt_update_team_member(p_company uuid, p_user uuid, p_name text, p_phone text, p_job_title text)',
    'zt_wo_is_mine(w_id uuid)',
    'zt_wo_is_owned(w_id uuid)',
    'zt_wo_open(w_id uuid)',
    -- RPCs públicas adicionadas/revisadas na stack Product V2.
    'zt_technician_catalog(p_company uuid)',
    'zt_adjust_product_stock(p_company uuid, p_product uuid, p_delta numeric, p_notes text)',
    'zt_sell_product_on_work_order(p_wo uuid, p_product uuid, p_quantity numeric, p_notes text)',
    'zt_create_manual_warranty(p_company uuid, p_client uuid, p_kind text, p_description text, p_starts_on date, p_ends_on date, p_service_place text, p_service uuid, p_product uuid, p_serial text, p_notes text)',
    'zt_generate_maintenance_contract_cycle(p_contract uuid, p_cycle date, p_service_on date, p_due_on date)',
    'zt_create_work_order_from_quote(p_quote uuid, p_assigned_to uuid, p_scheduled_date date, p_scheduled_time time)'
  ];
BEGIN
  -- Tabelas/ledgers que definem o isolamento financeiro e os módulos V2.
  IF to_regclass('public.inventory_movements') IS NULL THEN
    v_missing := array_append(v_missing, 'public.inventory_movements');
  END IF;
  IF to_regclass('public.maintenance_contracts') IS NULL THEN
    v_missing := array_append(v_missing, 'public.maintenance_contracts');
  END IF;
  IF to_regclass('public.maintenance_contract_cycles') IS NULL THEN
    v_missing := array_append(v_missing, 'public.maintenance_contract_cycles');
  END IF;
  IF to_regclass('public.work_order_item_costs') IS NULL THEN
    v_missing := array_append(v_missing, 'public.work_order_item_costs');
  END IF;
  IF to_regclass('public.work_order_material_costs') IS NULL THEN
    v_missing := array_append(v_missing, 'public.work_order_material_costs');
  END IF;
  IF to_regclass('public.work_order_private_costs') IS NULL THEN
    v_missing := array_append(v_missing, 'public.work_order_private_costs');
  END IF;

  IF cardinality(v_missing) > 0 THEN
    RAISE EXCEPTION 'V2_CONTRACT_MISSING_TABLES: %', array_to_string(v_missing, ', ');
  END IF;

  -- Colunas essenciais de catálogo/estoque.
  SELECT count(*) INTO v_count
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='products'
    AND column_name IN ('image_path','sale_enabled','track_stock','stock_qty','low_stock_threshold');
  IF v_count <> 5 THEN
    RAISE EXCEPTION 'V2_CONTRACT_PRODUCTS_COLUMNS: esperado 5, encontrado %', v_count;
  END IF;

  -- Colunas de localização do cliente (0049) usadas pela Stack V2.
  SELECT count(*) INTO v_count
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='clients'
    AND column_name IN ('google_place_id','latitude','longitude','maps_url');
  IF v_count <> 4 THEN
    RAISE EXCEPTION 'V2_CONTRACT_CLIENT_LOCATION_COLUMNS: esperado 4, encontrado %', v_count;
  END IF;

  -- Memória técnica estruturada da OS (0061).
  SELECT count(*) INTO v_count
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='attachments'
    AND column_name IN ('media_kind','media_stage','caption');
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'V2_CONTRACT_MEDIA_COLUMNS: esperado 3, encontrado %', v_count;
  END IF;

  -- Um orçamento nunca pode gerar duas OS.
  IF to_regclass('public.uq_work_orders_one_per_quote') IS NULL THEN
    RAISE EXCEPTION 'V2_CONTRACT_QUOTE_OS_UNIQUE_INDEX_MISSING';
  END IF;

  SELECT count(*) INTO v_count
  FROM pg_index i
  JOIN pg_class idx ON idx.oid=i.indexrelid
  JOIN pg_class tbl ON tbl.oid=i.indrelid
  JOIN pg_namespace ns ON ns.oid=tbl.relnamespace
  WHERE ns.nspname='public'
    AND tbl.relname='work_orders'
    AND idx.relname='uq_work_orders_one_per_quote'
    AND i.indisunique
    AND pg_get_expr(i.indpred, i.indrelid) IS NOT NULL;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'V2_CONTRACT_QUOTE_OS_INDEX_NOT_UNIQUE_PARTIAL';
  END IF;

  -- RPCs-chave da borda V2.
  SELECT count(*) INTO v_count
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='zt_technician_catalog';
  IF v_count < 1 THEN RAISE EXCEPTION 'V2_CONTRACT_TECH_CATALOG_RPC_MISSING'; END IF;

  SELECT count(*) INTO v_count
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='zt_create_work_order_from_quote';
  IF v_count <> 1 THEN RAISE EXCEPTION 'V2_CONTRACT_QUOTE_TO_WO_RPC_COUNT: %', v_count; END IF;

  -- Conversão orçamento→OS precisa estar com search_path vazio após hardening.
  SELECT array_to_string(p.proconfig, ',') INTO v_search_path
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='zt_create_work_order_from_quote'
  LIMIT 1;
  IF coalesce(v_search_path,'') NOT LIKE '%search_path=""%' THEN
    RAISE EXCEPTION 'V2_CONTRACT_QUOTE_TO_WO_SEARCH_PATH: %', coalesce(v_search_path,'NULL');
  END IF;

  -- Superfície SECURITY DEFINER autenticada: assinatura EXATA. Um overload inesperado
  -- sob nome já conhecido também falha e exige revisão explícita.
  SELECT array_agg(sig ORDER BY sig)
    INTO v_unreviewed_definers
  FROM (
    SELECT format('%I(%s)', p.proname, pg_get_function_identity_arguments(p.oid)) AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public'
      AND p.prosecdef
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
  ) reviewed
  WHERE NOT (sig = ANY(v_allowed_definer_signatures));

  IF cardinality(v_unreviewed_definers) > 0 THEN
    RAISE EXCEPTION 'V2_CONTRACT_UNREVIEWED_SECURITY_DEFINER: %', array_to_string(v_unreviewed_definers, ', ');
  END IF;

  -- SECURITY DEFINER sem search_path explícito é proibido na superfície autenticada.
  SELECT array_agg(format('%I(%s)', p.proname, pg_get_function_identity_arguments(p.oid)) ORDER BY p.proname)
    INTO v_definers_without_path
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public'
    AND p.prosecdef
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
    AND NOT EXISTS (
      SELECT 1 FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) cfg
      WHERE cfg LIKE 'search_path=%'
    );

  IF cardinality(v_definers_without_path) > 0 THEN
    RAISE EXCEPTION 'V2_CONTRACT_SECURITY_DEFINER_WITHOUT_SEARCH_PATH: %', array_to_string(v_definers_without_path, ', ');
  END IF;

  -- Wrapper legado zt_complete_work_order é deliberadamente service-only.
  -- Se voltar a ficar executável por authenticated, a superfície aumenta sem revisão.
  SELECT count(*) INTO v_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public'
    AND p.proname='zt_complete_work_order'
    AND pg_get_function_identity_arguments(p.oid)='p_wo uuid, p_report text, p_pending text, p_extra_cost numeric, p_due_days integer'
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE');
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'V2_CONTRACT_COMPLETE_WORK_ORDER_MUST_BE_SERVICE_ONLY';
  END IF;

  -- Ledger de quota/documentos deve negar acesso direto a anon/authenticated (0056).
  SELECT count(*) INTO v_count
  FROM pg_policies
  WHERE schemaname='public'
    AND tablename='document_usage_events'
    AND policyname='p_document_usage_events_no_client_access'
    AND cmd='ALL';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'V2_CONTRACT_DOCUMENT_LEDGER_DENY_POLICY_MISSING';
  END IF;

  IF has_table_privilege('anon','public.document_usage_events','SELECT')
     OR has_table_privilege('authenticated','public.document_usage_events','SELECT')
     OR has_table_privilege('anon','public.document_usage_events','INSERT')
     OR has_table_privilege('authenticated','public.document_usage_events','INSERT') THEN
    RAISE EXCEPTION 'V2_CONTRACT_DOCUMENT_LEDGER_CLIENT_GRANT_PRESENT';
  END IF;

  -- Bucket de campo deve existir privado e aceitar mídia curta definida pela 0061.
  SELECT count(*) INTO v_count
  FROM storage.buckets
  WHERE id='zt-work-orders'
    AND public=false
    AND file_size_limit=31457280
    AND 'video/mp4'=ANY(allowed_mime_types)
    AND 'image/jpeg'=ANY(allowed_mime_types);
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'V2_CONTRACT_WORK_ORDER_MEDIA_BUCKET_INVALID';
  END IF;

  -- Constraints que impedem estoque negativo e categorias de mídia inválidas.
  SELECT count(*) INTO v_count
  FROM pg_constraint c
  JOIN pg_class t ON t.oid=c.conrelid
  JOIN pg_namespace n ON n.oid=t.relnamespace
  WHERE n.nspname='public' AND t.relname='products'
    AND c.conname IN ('products_stock_nonnegative','products_low_stock_nonnegative');
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'V2_CONTRACT_PRODUCT_STOCK_CONSTRAINTS: %', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM pg_constraint c
  JOIN pg_class t ON t.oid=c.conrelid
  JOIN pg_namespace n ON n.oid=t.relnamespace
  WHERE n.nspname='public' AND t.relname='attachments'
    AND c.conname IN ('attachments_media_kind_check','attachments_media_stage_check','attachments_caption_len');
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'V2_CONTRACT_MEDIA_CONSTRAINTS: %', v_count;
  END IF;

  RAISE NOTICE 'V2_POST_MIGRATION_CONTRACT_OK';
END
$$;

-- Relatório final legível no SQL Editor/CI de homologação.
SELECT
  'V2_POST_MIGRATION_CONTRACT_OK' AS result,
  to_regclass('public.inventory_movements') IS NOT NULL AS inventory_ok,
  to_regclass('public.maintenance_contracts') IS NOT NULL AS contracts_ok,
  to_regclass('public.work_order_item_costs') IS NOT NULL AS item_cost_ledger_ok,
  to_regclass('public.work_order_material_costs') IS NOT NULL AS material_cost_ledger_ok,
  to_regclass('public.work_order_private_costs') IS NOT NULL AS extra_cost_ledger_ok,
  to_regclass('public.uq_work_orders_one_per_quote') IS NOT NULL AS quote_idempotency_index_ok,
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='document_usage_events'
      AND policyname='p_document_usage_events_no_client_access'
  ) AS document_ledger_denied_ok,
  NOT EXISTS (
    SELECT 1
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prosecdef
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT EXISTS (
        SELECT 1 FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) cfg
        WHERE cfg LIKE 'search_path=%'
      )
  ) AS security_definer_search_path_ok,
  NOT EXISTS (
    SELECT 1
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public'
      AND p.proname='zt_complete_work_order'
      AND has_function_privilege('authenticated',p.oid,'EXECUTE')
  ) AS legacy_complete_service_only_ok,
  EXISTS (
    SELECT 1 FROM storage.buckets
    WHERE id='zt-work-orders' AND public=false AND file_size_limit=31457280
  ) AS technical_media_bucket_ok;
