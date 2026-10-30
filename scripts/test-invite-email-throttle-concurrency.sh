#!/usr/bin/env bash
# ZiisTec 0110 — duas reservas simultâneas de envio do MESMO convite: exatamente uma passa.
# Somente na stack Supabase descartável da CI (conexões paralelas reais; a massa é removida no fim).
# Uma terceira sessão segura o lock consultivo da empresa por 2 s para garantir que as chamadas se sobreponham.
set -euo pipefail
DB_URL="${DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
COMPANY=20000000-0000-0000-0000-000000000001
OWNER=10000000-0000-0000-0000-000000000001
INVITE=d4000000-0000-4000-8000-0000000000c1
OUT_A="$(mktemp)"; OUT_B="$(mktemp)"

cleanup(){
  psql -X -v ON_ERROR_STOP=1 "$DB_URL" <<SQL >/dev/null || true
set session_replication_role = replica;
delete from public.team_invite_email_sends where invite_id='$INVITE';
delete from public.company_invites where id='$INVITE';
set session_replication_role = origin;
SQL
  rm -f "$OUT_A" "$OUT_B"
}
trap cleanup EXIT

psql -X -v ON_ERROR_STOP=1 "$DB_URL" >/dev/null <<SQL
set session_replication_role = replica;
insert into public.company_invites(id,company_id,email,role,name)
values ('$INVITE','$COMPANY','ci-concorrencia@example.test','technician','CI Concorrência');
set session_replication_role = origin;
SQL

hold_lock(){
  psql -X -Atq -v ON_ERROR_STOP=1 "$DB_URL" >/dev/null <<SQL
begin;
select pg_advisory_xact_lock(hashtextextended('zt_invite_email:' || '$COMPANY', 0));
select pg_sleep(2);
commit;
SQL
}

claim(){ # saída
  psql -X -Atq -v ON_ERROR_STOP=1 "$DB_URL" >"$1" <<SQL
begin;
select set_config('request.jwt.claim.sub','$OWNER',true);
set local role authenticated;
select public.zt_claim_team_invite_email('$INVITE')->>'allowed';
commit;
SQL
}

hold_lock & ph=$!
sleep 0.5
claim "$OUT_A" & p1=$!
claim "$OUT_B" & p2=$!
wait "$p1" || { echo "INVITE_THROTTLE_CONCURRENCY: first claim failed" >&2; exit 1; }
wait "$p2" || { echo "INVITE_THROTTLE_CONCURRENCY: second claim failed" >&2; exit 1; }
wait "$ph"
# O psql também imprime o retorno do set_config (primeira linha): a decisão é sempre a última.
a="$(tail -n1 "$OUT_A" | tr -d '[:space:]')"; b="$(tail -n1 "$OUT_B" | tr -d '[:space:]')"
allowed=0
if [[ "$a" == "true" ]]; then allowed=$((allowed + 1)); fi
if [[ "$b" == "true" ]]; then allowed=$((allowed + 1)); fi
[[ "$allowed" == "1" ]] || { echo "INVITE_THROTTLE_CONCURRENCY: expected exactly one allowed claim, got '$a' / '$b'" >&2; exit 1; }
rows="$(psql -X -At "$DB_URL" -c "select count(*) from public.team_invite_email_sends where invite_id='$INVITE'")"
[[ "$rows" == "1" ]] || { echo "INVITE_THROTTLE_CONCURRENCY: expected one reserved send, found $rows" >&2; exit 1; }
echo "INVITE_THROTTLE_CONCURRENCY: PASS — two simultaneous claims, one allowed ($a/$b), one reserved send"
