#!/usr/bin/env bash
set -euo pipefail

DB_URL="${DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"

node scripts/reassemble.mjs

mapfile -t migrations < <(find supabase -maxdepth 1 -type f -name '[0-9][0-9][0-9][0-9]*.sql' | sort)
if [[ ${#migrations[@]} -lt 2 ]]; then
  echo 'CI_SQL_RLS: no migration chain found' >&2
  exit 1
fi

for sql in "${migrations[@]}"; do
  echo "CI_SQL_RLS migration: $sql"
  psql -X -v ON_ERROR_STOP=1 "$DB_URL" -f "$sql" >/dev/null
done

psql -X -v ON_ERROR_STOP=1 "$DB_URL" -f supabase/tests/ci_local_seed.sql >/dev/null

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
  supabase/tests/v2_technician_sale_rollback_smoke.sql
)

for sql in "${regressions[@]}"; do
  echo "CI_SQL_RLS regression: $sql"
  psql -X -v ON_ERROR_STOP=1 "$DB_URL" -f "$sql"
done

node --test tests/blockers/f03_quote_to_wo_authority.test.mjs

echo 'CI_SQL_RLS: OK'
