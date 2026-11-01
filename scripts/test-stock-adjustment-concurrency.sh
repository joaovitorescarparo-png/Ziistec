#!/usr/bin/env bash
# ZiisTec 0109 — ajuste manual de estoque idempotente sob concorrência real.
# Somente na stack Supabase descartável da CI (conexões paralelas reais; a massa é removida no fim).
#   1. dois ajustes simultâneos com o MESMO pedido: o estoque muda uma vez e as duas respostas são iguais;
#   2. dois ajustes simultâneos com pedidos DIFERENTES: os dois entram (a trava da linha serializa);
#   3. o mesmo pedido em dois produtos ao mesmo tempo: exatamente um vence, o outro é recusado (23505).
# Uma terceira sessão segura a linha do produto por 2 s para garantir que as chamadas se sobreponham.
set -euo pipefail
DB_URL="${DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
COMPANY=20000000-0000-0000-0000-000000000001
OWNER=10000000-0000-0000-0000-000000000001
P1=a4000000-0000-4000-8000-0000000000c1
P2=a4000000-0000-4000-8000-0000000000c2
P3=a4000000-0000-4000-8000-0000000000c3
R_SAME=c4000000-0000-4000-8000-0000000000a1
R_X=c4000000-0000-4000-8000-0000000000a2
R_Y=c4000000-0000-4000-8000-0000000000a3
R_CLASH=c4000000-0000-4000-8000-0000000000a4
OUT_A="$(mktemp)"; OUT_B="$(mktemp)"; ERR_A="$(mktemp)"; ERR_B="$(mktemp)"

cleanup(){
  psql -X -v ON_ERROR_STOP=1 "$DB_URL" <<SQL >/dev/null || true
set session_replication_role = replica;
delete from public.inventory_movements where product_id in ('$P1','$P2','$P3');
delete from public.products where id in ('$P1','$P2','$P3');
set session_replication_role = origin;
SQL
  rm -f "$OUT_A" "$OUT_B" "$ERR_A" "$ERR_B"
}
trap cleanup EXIT

psql -X -v ON_ERROR_STOP=1 "$DB_URL" >/dev/null <<SQL
set session_replication_role = replica;
insert into public.products(id,company_id,name,stock_qty,track_stock) values
  ('$P1','$COMPANY','CI Estoque Concorrente 1',0,true),
  ('$P2','$COMPANY','CI Estoque Concorrente 2',0,true),
  ('$P3','$COMPANY','CI Estoque Concorrente 3',0,true);
set session_replication_role = origin;
SQL

hold_row(){
  psql -X -Atq -v ON_ERROR_STOP=1 "$DB_URL" >/dev/null <<SQL
begin;
select 1 from public.products where id='$1' for update;
select pg_sleep(2);
commit;
SQL
}

# Imprime o saldo devolvido (ou deixa o erro no arquivo de erro) de um ajuste feito como o dono da empresa.
adjust(){ # produto delta pedido saída erro
  psql -X -Atq -v ON_ERROR_STOP=1 "$DB_URL" >"$4" 2>"$5" <<SQL
begin;
select set_config('request.jwt.claim.sub','$OWNER',true);
set local role authenticated;
select public.zt_adjust_product_stock('$COMPANY','$1',$2,'CI concorrência','$3');
commit;
SQL
}

stock_of(){ psql -X -At "$DB_URL" -c "select stock_qty from public.products where id='$1'"; }
moves_of(){ psql -X -At "$DB_URL" -c "select count(*) from public.inventory_movements where $1"; }

# --- 1. mesmo pedido, duas sessões simultâneas
hold_row "$P1" & ph=$!
sleep 0.5
adjust "$P1" 5 "$R_SAME" "$OUT_A" "$ERR_A" & p1=$!
adjust "$P1" 5 "$R_SAME" "$OUT_B" "$ERR_B" & p2=$!
wait "$p1" || { echo "STOCK_CONCURRENCY: first same-request call failed" >&2; cat "$ERR_A" >&2; exit 1; }
wait "$p2" || { echo "STOCK_CONCURRENCY: second same-request call failed" >&2; cat "$ERR_B" >&2; exit 1; }
wait "$ph"
# O psql também imprime o retorno do set_config (primeira linha): o saldo é sempre a última.
a="$(tail -n1 "$OUT_A" | tr -d '[:space:]')"; b="$(tail -n1 "$OUT_B" | tr -d '[:space:]')"
[[ "$a" == "5.000" && "$b" == "5.000" ]] || { echo "STOCK_CONCURRENCY: same request returned '$a' / '$b' (expected 5.000 / 5.000)" >&2; exit 1; }
[[ "$(stock_of "$P1")" == "5.000" ]] || { echo "STOCK_CONCURRENCY: stock after the same request twice is $(stock_of "$P1"), expected 5.000" >&2; exit 1; }
[[ "$(moves_of "client_request_id='$R_SAME'")" == "1" ]] || { echo "STOCK_CONCURRENCY: expected exactly one movement for the same request" >&2; exit 1; }

# --- 2. pedidos diferentes, duas sessões simultâneas
hold_row "$P2" & ph=$!
sleep 0.5
adjust "$P2" 5 "$R_X" "$OUT_A" "$ERR_A" & p1=$!
adjust "$P2" 5 "$R_Y" "$OUT_B" "$ERR_B" & p2=$!
wait "$p1" || { echo "STOCK_CONCURRENCY: distinct request X failed" >&2; cat "$ERR_A" >&2; exit 1; }
wait "$p2" || { echo "STOCK_CONCURRENCY: distinct request Y failed" >&2; cat "$ERR_B" >&2; exit 1; }
wait "$ph"
[[ "$(stock_of "$P2")" == "10.000" ]] || { echo "STOCK_CONCURRENCY: distinct requests left stock $(stock_of "$P2"), expected 10.000" >&2; exit 1; }
[[ "$(moves_of "client_request_id in ('$R_X','$R_Y')")" == "2" ]] || { echo "STOCK_CONCURRENCY: expected two movements for two distinct requests" >&2; exit 1; }

# --- 3. mesmo pedido em dois produtos ao mesmo tempo: um vence, o outro é recusado sem alterar o estoque
set +e
adjust "$P1" 5 "$R_CLASH" "$OUT_A" "$ERR_A" & p1=$!
adjust "$P3" 5 "$R_CLASH" "$OUT_B" "$ERR_B" & p2=$!
wait "$p1"; s1=$?
wait "$p2"; s2=$?
set -e
ok=$(( (s1 == 0 ? 1 : 0) + (s2 == 0 ? 1 : 0) ))
[[ "$ok" == "1" ]] || { echo "STOCK_CONCURRENCY: expected exactly one winner for a request reused across products, got $ok" >&2; cat "$ERR_A" "$ERR_B" >&2; exit 1; }
grep -q '23505\|client_request_id' "$ERR_A" "$ERR_B" || { echo "STOCK_CONCURRENCY: the loser did not report the reused request" >&2; cat "$ERR_A" "$ERR_B" >&2; exit 1; }
[[ "$(moves_of "client_request_id='$R_CLASH'")" == "1" ]] || { echo "STOCK_CONCURRENCY: expected exactly one movement for the clashing request" >&2; exit 1; }
total="$(psql -X -At "$DB_URL" -c "select (select stock_qty from public.products where id='$P1')+(select stock_qty from public.products where id='$P3')")"
[[ "$total" == "10.000" ]] || { echo "STOCK_CONCURRENCY: the loser changed stock (P1+P3 = $total, expected 10.000)" >&2; exit 1; }

echo "STOCK_CONCURRENCY: PASS — same request applied once (5.000), distinct requests both applied (10.000), reused request had one winner"
