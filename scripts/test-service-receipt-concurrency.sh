#!/usr/bin/env bash
# ZiisTec 0100 — duas emissões simultâneas do Comprovante de Serviço para a mesma OS concluída.
# Somente na stack Supabase descartável da CI (conexões paralelas reais; a massa é removida no fim).
set -euo pipefail
DB_URL="${DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
COMPANY=20000000-0000-0000-0000-000000000001
OWNER=10000000-0000-0000-0000-000000000001
CLIENT=36000000-0000-0000-0000-000000000001
OUT1="$(mktemp)"; OUT2="$(mktemp)"; WO_FILE="$(mktemp)"

cleanup(){
  local wo; wo="$(cat "$WO_FILE" 2>/dev/null || true)"
  psql -X -v ON_ERROR_STOP=1 "$DB_URL" <<SQL >/dev/null || true
set session_replication_role = replica;
do \$\$
declare r record; v_wo uuid:=nullif('$wo','')::uuid; v_entry uuid;
begin
  if v_wo is not null then
    select billing_entry_id into v_entry from public.work_orders where id=v_wo;
    for r in select c.table_name from information_schema.columns c join information_schema.tables t
               on t.table_schema=c.table_schema and t.table_name=c.table_name and t.table_type='BASE TABLE'
              where c.table_schema='public' and c.column_name='work_order_id' and c.table_name<>'work_orders' loop
      execute format('delete from public.%I where work_order_id=%L', r.table_name, v_wo);
    end loop;
    delete from public.financial_entries where id=v_entry;
    delete from public.work_orders where id=v_wo;
  end if;
  delete from public.clients where id='$CLIENT';
  delete from public.document_counters where company_id='$COMPANY' and doc_type='service_receipt';
end \$\$;
set session_replication_role = origin;
SQL
  rm -f "$OUT1" "$OUT2" "$WO_FILE"
}
trap cleanup EXIT

# Fixture pelas RPCs reais do proprietário: OS direta concluída (o relatório nasce no commit).
psql -X -v ON_ERROR_STOP=1 "$DB_URL" <<SQL >/dev/null
update public.subscriptions set status='active',current_period_start=current_date,current_period_end=current_date+30 where company_id='$COMPANY';
insert into public.clients(id,company_id,name,address) values('$CLIENT','$COMPANY','CI Comprovante Concorrente','Rua Paralela, 1');
SQL
psql -X -Atq -v ON_ERROR_STOP=1 "$DB_URL" >"$WO_FILE" <<SQL
begin;
select set_config('request.jwt.claim.sub','$OWNER',true);
set local role authenticated;
select public.zt_save_work_order_idempotent('$COMPANY',null,gen_random_uuid(),
  jsonb_build_object('client_id','$CLIENT','assigned_to','$OWNER','status','in_progress','request','CI comprovante concorrente'),
  jsonb_build_array(jsonb_build_object('kind','free','name','Serviço concorrente','quantity',1,'unit_price',120)));
commit;
SQL
WO="$(grep -E '^[0-9a-fA-F-]{36}$' "$WO_FILE" | tail -n1)"
[[ -n "$WO" ]] || { echo "SERVICE_RECEIPT_CONCURRENCY: fixture OS was not created" >&2; exit 1; }
printf '%s' "$WO" >"$WO_FILE"
psql -X -Atq -v ON_ERROR_STOP=1 "$DB_URL" >/dev/null <<SQL
begin;
select set_config('request.jwt.claim.sub','$OWNER',true);
set local role authenticated;
select public.zt_finalize_work_order_with_warranty_overrides('$WO','CI relato concorrente',null,null,7,'[]'::jsonb,'[]'::jsonb,null);
commit;
SQL

issue(){
  psql -X -Atq -v ON_ERROR_STOP=1 "$DB_URL" >"$1" <<SQL
begin;
select set_config('request.jwt.claim.sub','$OWNER',true);
set local role authenticated;
select public.zt_issue_service_receipt('$WO',gen_random_uuid())->>'id';
commit;
SQL
}

issue "$OUT1" & p1=$!
issue "$OUT2" & p2=$!
wait "$p1"
wait "$p2"

id1="$(grep -E '^[0-9a-fA-F-]{36}$' "$OUT1" | tail -n1)"
id2="$(grep -E '^[0-9a-fA-F-]{36}$' "$OUT2" | tail -n1)"
[[ -n "$id1" && "$id1" == "$id2" ]] || { echo "SERVICE_RECEIPT_CONCURRENCY: simultaneous issues returned different receipts ($id1/$id2)" >&2; cat "$OUT1" "$OUT2" >&2; exit 1; }

summary="$(psql -X -At "$DB_URL" -c "select (select count(*) from public.service_receipts where work_order_id='$WO')||'|'||(select count(*) from public.service_receipts where work_order_id='$WO' and is_active)||'|'||(select last_value from public.document_counters where company_id='$COMPANY' and doc_type='service_receipt')")"
[[ "$summary" == "1|1|1" ]] || { echo "SERVICE_RECEIPT_CONCURRENCY: expected receipts|active|counter = 1|1|1, got $summary" >&2; exit 1; }
echo "SERVICE_RECEIPT_CONCURRENCY: PASS — two simultaneous issues resolved receipt=$id1; receipts|active|counter=$summary"
