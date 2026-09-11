#!/usr/bin/env bash
set -euo pipefail
DB_URL="${DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
COMPANY=20000000-0000-0000-0000-000000000001
OWNER=10000000-0000-0000-0000-000000000001
CLIENT=33000000-0000-0000-0000-000000000001
WO=34000000-0000-0000-0000-000000000001
HASH=cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
PATH_VALUE="$COMPANY/work-orders/$WO/before/$HASH.jpg"

cleanup(){
  psql -X -v ON_ERROR_STOP=1 "$DB_URL" <<SQL >/dev/null || true
set session_replication_role = replica;
delete from public.attachments where work_order_id='$WO';
delete from public.work_orders where id='$WO';
delete from public.clients where id='$CLIENT';
set session_replication_role = origin;
SQL
  rm -f /tmp/rc1b-concurrency-{1,2}.out /tmp/rc1b-concurrency-{1,2}.role
}
trap cleanup EXIT
cleanup

# Fixture setup must not impersonate an application write; all behavioral calls below run with normal triggers/RLS.
psql -X -v ON_ERROR_STOP=1 "$DB_URL" <<SQL >/dev/null
set session_replication_role = replica;
insert into public.clients(id,company_id,name) values ('$CLIENT','$COMPANY','RC1B Concurrent');
insert into public.work_orders(id,company_id,number,client_id,status,assigned_to)
values ('$WO','$COMPANY','RC1B-CONCURRENT','$CLIENT','in_progress','10000000-0000-0000-0000-000000000003');
update public.subscriptions set status='active',current_period_start=current_date,current_period_end=current_date+30 where company_id='$COMPANY';
set session_replication_role = origin;
SQL

role_before="$(psql -X -At "$DB_URL" -c 'show session_replication_role')"
echo "RC1B_CONCURRENCY session_replication_role before assertions=$role_before"
[[ "$role_before" == "origin" ]] || { echo "RC1B_CONCURRENCY: assertions require origin, got $role_before" >&2; exit 1; }

call_rpc(){
  local out="$1"
  local role_out="$2"
  local role
  role="$(psql -X -At "$DB_URL" -c 'show session_replication_role')"
  printf '%s\n' "$role" >"$role_out"
  [[ "$role" == "origin" ]] || { echo "RC1B_CONCURRENCY: connection assertion requires origin, got $role" >&2; return 1; }
  psql -X -Atq -v ON_ERROR_STOP=1 "$DB_URL" >"$out" <<SQL
begin;
select set_config('request.jwt.claim.sub','$OWNER',true);
set local role authenticated;
select public.zt_register_work_order_evidence(
 '$COMPANY','$WO','$PATH_VALUE','same.jpg','image/jpeg',123,'before',null,'Antes','$HASH')->>'id';
commit;
SQL
}

call_rpc /tmp/rc1b-concurrency-1.out /tmp/rc1b-concurrency-1.role & p1=$!
call_rpc /tmp/rc1b-concurrency-2.out /tmp/rc1b-concurrency-2.role & p2=$!
wait "$p1"
wait "$p2"

id1="$(grep -E '^[0-9a-fA-F-]{36}$' /tmp/rc1b-concurrency-1.out | tail -n1)"
id2="$(grep -E '^[0-9a-fA-F-]{36}$' /tmp/rc1b-concurrency-2.out | tail -n1)"
role1="$(cat /tmp/rc1b-concurrency-1.role)"
role2="$(cat /tmp/rc1b-concurrency-2.role)"
[[ "$role1" == "origin" && "$role2" == "origin" ]] || { echo "RC1B_CONCURRENCY: parallel connections were not origin ($role1/$role2)" >&2; exit 1; }
[[ -n "$id1" && "$id1" == "$id2" ]] || { echo "RC1B_CONCURRENCY: attempts did not resolve to the same attachment id ($id1/$id2)" >&2; cat /tmp/rc1b-concurrency-*.out >&2; exit 1; }

count="$(psql -X -At "$DB_URL" -c "select count(*) from public.attachments where company_id='$COMPANY' and work_order_id='$WO' and media_stage='before' and content_sha256='$HASH'")"
[[ "$count" == "1" ]] || { echo "RC1B_CONCURRENCY: expected 1 attachment, got $count" >&2; cat /tmp/rc1b-concurrency-*.out >&2; exit 1; }

echo "RC1B_CONCURRENCY: PASS — two simultaneous registrations resolved attachment=$id1; final_count=$count; roles=$role1/$role2"
