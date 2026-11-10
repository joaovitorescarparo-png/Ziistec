#!/usr/bin/env bash
# =====================================================================
# ZiisTec · roda a cadeia completa de migrations + testes da Central
# Técnica em um banco DESCARTÁVEL. Nunca aponte para Production/Beta.
#
# Uso:
#   PGHOST=... PGPORT=... PGUSER=postgres scripts/ct-test/run.sh
# O banco "ziistec_ct_test" é derrubado e recriado a cada execução.
# =====================================================================
set -euo pipefail
cd "$(dirname "$0")/../.."

: "${PGHOST:?Defina PGHOST apontando para um Postgres descartável}"
: "${PGPORT:=5432}"
: "${PGUSER:=postgres}"
export PGHOST PGPORT PGUSER
DB=ziistec_ct_test

guard=$(psql -At -d postgres -c "select current_setting('server_version_num')")
echo "Postgres $guard em $PGHOST:$PGPORT — recriando banco $DB"

psql -d postgres -v ON_ERROR_STOP=1 -q -c "drop database if exists $DB;" -c "create database $DB;"

echo "— stub Supabase (somente banco de teste)"
psql -d "$DB" -v ON_ERROR_STOP=1 -q -f scripts/ct-test/00_supabase_stub.sql

node scripts/reassemble.mjs >/dev/null

echo "— aplicando migrations na ordem oficial"
while IFS= read -r m; do
  [ -z "$m" ] && continue
  printf '  %s\n' "$m"
  psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "supabase/$m"
done < scripts/ct-test/migration-order.txt

echo "— testes RLS Central Técnica"
psql -d "$DB" -v ON_ERROR_STOP=1 -q -f scripts/ct-test/10_central_tecnica_rls.sql

echo "— golden path Central Técnica"
psql -d "$DB" -v ON_ERROR_STOP=1 -q -f scripts/ct-test/20_central_tecnica_golden_path.sql

echo "OK: migrations + RLS + golden path verdes no banco descartável."
