#!/usr/bin/env bash
# ZiisTec 0111 — duas gerações de relatório com IA simultâneas na MESMA OS com duas vagas já usadas: exatamente uma passa.
# Somente na stack Supabase descartável da CI (conexões paralelas reais; a massa é removida no fim).
# Uma terceira sessão segura o lock da linha da OS por 2 s para garantir que as chamadas se sobreponham.
set -euo pipefail
DB_URL="${DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
COMPANY=20000000-0000-0000-0000-000000000001
TECH=10000000-0000-0000-0000-000000000003
CLIENT=d5000000-0000-4000-8000-0000000000c1
WO=d5000000-0000-4000-8000-0000000000a1
OUT_A="$(mktemp)"; OUT_B="$(mktemp)"

cleanup(){
  psql -X -v ON_ERROR_STOP=1 "$DB_URL" <<SQL >/dev/null || true
set session_replication_role = replica;
delete from public.work_order_ai_reports where work_order_id='$WO';
delete from public.work_orders where id='$WO';
delete from public.clients where id='$CLIENT';
delete from public.ai_usage_events where user_id='$TECH' and company_id='$COMPANY';
set session_replication_role = origin;
SQL
  rm -f "$OUT_A" "$OUT_B"
}
trap cleanup EXIT

psql -X -v ON_ERROR_STOP=1 "$DB_URL" >/dev/null <<SQL
set session_replication_role = replica;
insert into public.clients(id,company_id,name) values ('$CLIENT','$COMPANY','CI Concorrência IA');
insert into public.work_orders(id,company_id,number,client_id,assigned_to,status,request)
values ('$WO','$COMPANY','CI-IA-CONC','$CLIENT','$TECH','in_progress','OS da concorrência de IA');
insert into public.work_order_ai_reports(company_id,work_order_id,requested_by,request_id,status,output_text,finished_at) values
  ('$COMPANY','$WO','$TECH','d5000000-0000-4000-8000-000000000001','completed','Texto 1',now()),
  ('$COMPANY','$WO','$TECH','d5000000-0000-4000-8000-000000000002','completed','Texto 2',now());
set session_replication_role = origin;
SQL

hold_lock(){
  psql -X -Atq -v ON_ERROR_STOP=1 "$DB_URL" >/dev/null <<SQL
begin;
select 1 from public.work_orders where id='$WO' for update;
select pg_sleep(2);
commit;
SQL
}

claim(){ # saída, identificador do pedido
  psql -X -Atq -v ON_ERROR_STOP=1 "$DB_URL" >"$1" <<SQL
begin;
select set_config('request.jwt.claim.sub','$TECH',true);
set local role authenticated;
select public.zt_claim_work_order_ai_report('$WO','$2')->>'allowed';
commit;
SQL
}

hold_lock & ph=$!
sleep 0.5
claim "$OUT_A" d5000000-0000-4000-8000-000000000011 & p1=$!
claim "$OUT_B" d5000000-0000-4000-8000-000000000012 & p2=$!
wait "$p1" || { echo "AI_REPORT_CONCURRENCY: first claim failed" >&2; exit 1; }
wait "$p2" || { echo "AI_REPORT_CONCURRENCY: second claim failed" >&2; exit 1; }
wait "$ph"
# O psql também imprime o retorno do set_config (primeira linha): a decisão é sempre a última.
a="$(tail -n1 "$OUT_A" | tr -d '[:space:]')"; b="$(tail -n1 "$OUT_B" | tr -d '[:space:]')"
allowed=0
if [[ "$a" == "true" ]]; then allowed=$((allowed + 1)); fi
if [[ "$b" == "true" ]]; then allowed=$((allowed + 1)); fi
[[ "$allowed" == "1" ]] || { echo "AI_REPORT_CONCURRENCY: expected exactly one allowed claim, got '$a' / '$b'" >&2; exit 1; }
rows="$(psql -X -At "$DB_URL" -c "select count(*) from public.work_order_ai_reports where work_order_id='$WO'")"
[[ "$rows" == "3" ]] || { echo "AI_REPORT_CONCURRENCY: expected three registered generations (2 completed + 1 pending), found $rows" >&2; exit 1; }
echo "AI_REPORT_CONCURRENCY: PASS — two simultaneous claims on the last slot, one allowed ($a/$b), three registered generations"
