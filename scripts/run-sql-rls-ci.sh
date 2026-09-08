#!/usr/bin/env bash
set -euo pipefail

DB_URL="${DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
BASELINE_MANIFEST="supabase/staging/production_baseline_manifest.csv"

node scripts/reassemble.mjs

apply_sql() {
  local sql="$1"
  echo "CI_SQL_RLS migration: $sql"
  psql -X -v ON_ERROR_STOP=1 "$DB_URL" -f "$sql" >/dev/null
}

[[ -f "$BASELINE_MANIFEST" ]] || {
  echo "CI_SQL_RLS: missing baseline manifest: $BASELINE_MANIFEST" >&2
  exit 1
}

declare -A baseline_alias=(
  ["0001_ziistec_fundacao_final"]="supabase/0001_ziistec_fundacao_FINAL.sql"
  ["0002_ziistec_storage_final"]="supabase/0002_ziistec_storage_FINAL.sql"
  ["remove_non_rls_table_privileges"]="supabase/0023_table_privilege_hardening.sql"
  ["consolidate_rls_policies_and_revoke_direct_sensitive_writes"]="supabase/0029_consolidate_rls_and_sensitive_writes.sql"
  ["document_counters_explicit_no_direct_access"]="supabase/0030_document_counters_no_direct_access.sql"
  ["bound_text_inputs_and_optimize_company_lists"]="__RECONCILE_AFTER_BASELINE__"
  ["atomic_quote_and_work_order_saves"]="supabase/0035_atomic_document_saves.sql"
  ["atomic_purchase_save"]="supabase/0035_atomic_document_saves.sql"
  ["financial_guard_invoker_mode"]="supabase/0025_financial_integrity_and_payment_rpc.sql"
  ["fix_locked_document_guard_enum_branching"]="supabase/0044_lock_finalized_business_documents.sql"
  ["0049_client_google_location"]="supabase/0049_client_google_location.sql"
)

declare -A applied_baseline_files=()
bootstrap_applied=0

resolve_baseline_file() {
  local name="$1"
  if [[ -n "${baseline_alias[$name]:-}" ]]; then
    printf '%s\n' "${baseline_alias[$name]}"
    return 0
  fi
  local matches=()
  mapfile -t matches < <(find supabase -maxdepth 1 -type f -name "[0-9][0-9][0-9][0-9]_${name}.sql" | sort)
  if [[ ${#matches[@]} -ne 1 ]]; then
    echo "CI_SQL_RLS: baseline migration '$name' resolved to ${#matches[@]} canonical files" >&2
    if [[ ${#matches[@]} -gt 0 ]]; then printf '  %s\n' "${matches[@]}" >&2; fi
    return 1
  fi
  printf '%s\n' "${matches[0]}"
}

while IFS=',' read -r version name statements_md5; do
  if [[ "$version" == "version" ]]; then continue; fi
  [[ -n "$version" && -n "$name" ]] || { echo "CI_SQL_RLS: malformed baseline manifest row" >&2; exit 1; }
  sql="$(resolve_baseline_file "$name")"
  if [[ "$sql" == "__RECONCILE_AFTER_BASELINE__" ]]; then
    echo "CI_SQL_RLS baseline: $name -> deferred reconciliation"
    continue
  fi
  [[ -f "$sql" ]] || { echo "CI_SQL_RLS: resolved file does not exist for '$name': $sql" >&2; exit 1; }
  if [[ -n "${applied_baseline_files[$sql]:-}" ]]; then
    echo "CI_SQL_RLS baseline: $name -> consolidated in already applied $sql"
    continue
  fi
  apply_sql "$sql"
  applied_baseline_files[$sql]="$name"
  if [[ "$name" == "0001_ziistec_fundacao_final" ]]; then
    apply_sql supabase/tests/ci_local_bootstrap.sql
    bootstrap_applied=1
  fi
done < "$BASELINE_MANIFEST"

if [[ "$bootstrap_applied" -ne 1 ]]; then
  echo 'CI_SQL_RLS: local bootstrap was not applied after 0001' >&2
  exit 1
fi

apply_sql supabase/staging/production_baseline_reconciliation.sql

mapfile -t v2_migrations < <(find supabase -maxdepth 1 -type f -name '[0-9][0-9][0-9][0-9]*.sql' | sort)
for sql in "${v2_migrations[@]}"; do
  base="$(basename "$sql")"
  prefix="${base%%_*}"
  num=$((10#$prefix))
  if (( num >= 50 )); then apply_sql "$sql"; fi
done

apply_sql supabase/tests/ci_local_seed.sql

regressions=(
  supabase/tests/v2_ci_cross_tenant_rls_canary.sql
  supabase/tests/v2_access_subscription_rollback_smoke.sql
  supabase/tests/v2_f01_quote_financial_snapshot_rollback.sql
  supabase/tests/v2_f01_quote_financial_snapshot_matrix_rollback.sql
  supabase/tests/v2_f03_quote_to_wo_flow_rollback.sql
  supabase/tests/v2_f04_assigned_to_guard_rollback.sql
  supabase/tests/v2_f05_soft_delete_reference_guard_rollback.sql
  supabase/tests/v2_f06_warranty_retry_rollback.sql
  supabase/tests/v2_f07_documents_history_after_subscription_rollback.sql
  supabase/tests/v2_f11_invite_confirmed_email_rollback.sql
  supabase/tests/v2_technician_sale_rollback_smoke.sql
  supabase/tests/v2_field_sale_rollback_smoke.sql
  supabase/tests/v2_field_sales_consistency_rollback.sql
)

for sql in "${regressions[@]}"; do
  echo "CI_SQL_RLS regression: $sql"
  psql -X -v ON_ERROR_STOP=1 "$DB_URL" -f "$sql"
done

node --test tests/blockers/f03_quote_to_wo_authority.test.mjs

echo 'CI_SQL_RLS: OK'
