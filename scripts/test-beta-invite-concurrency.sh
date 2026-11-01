#!/usr/bin/env bash
# ZiisTec 0099 — duas criações de empresa simultâneas com o mesmo convite beta.
# Somente na stack Supabase descartável da CI (usa conexões paralelas reais e limpa a massa no fim).
set -euo pipefail
DB_URL="${DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
USER_ID=10000000-0000-0000-0000-000000000099
EMAIL=ci-beta-race@example.invalid
OUT1="$(mktemp)"; OUT2="$(mktemp)"

cleanup(){
  psql -X -v ON_ERROR_STOP=1 "$DB_URL" <<SQL >/dev/null || true
set session_replication_role = replica;
create temp table zt_race_companies as select company_id from public.company_members where user_id='$USER_ID';
delete from public.company_members where company_id in (select company_id from zt_race_companies);
delete from public.subscriptions where company_id in (select company_id from zt_race_companies);
delete from public.beta_invites where email='$EMAIL';
delete from public.companies where id in (select company_id from zt_race_companies);
delete from public.profiles where id='$USER_ID';
delete from auth.users where id='$USER_ID';
set session_replication_role = origin;
SQL
  rm -f "$OUT1" "$OUT2"
}
trap cleanup EXIT
cleanup

psql -X -v ON_ERROR_STOP=1 "$DB_URL" <<SQL >/dev/null
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('00000000-0000-0000-0000-000000000000','$USER_ID','authenticated','authenticated','$EMAIL','',now(),'{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now());
insert into public.profiles(id,full_name,email) values('$USER_ID','CI Beta Race','$EMAIL') on conflict (id) do nothing;
insert into public.beta_invites(email,status,expires_at) values('$EMAIL','pending',now()+interval '1 day');
SQL

call_create(){
  psql -X -Atq -v ON_ERROR_STOP=1 "$DB_URL" >"$1" <<SQL
begin;
select set_config('request.jwt.claim.sub','$USER_ID',true);
set local role authenticated;
select public.zt_create_company('CI Beta Race','Teste',false,null,null);
commit;
SQL
}

call_create "$OUT1" & p1=$!
call_create "$OUT2" & p2=$!
wait "$p1"
wait "$p2"

id1="$(grep -E '^[0-9a-fA-F-]{36}$' "$OUT1" | tail -n1)"
id2="$(grep -E '^[0-9a-fA-F-]{36}$' "$OUT2" | tail -n1)"
[[ -n "$id1" && "$id1" == "$id2" ]] || { echo "BETA_INVITE_CONCURRENCY: attempts returned different companies ($id1/$id2)" >&2; cat "$OUT1" "$OUT2" >&2; exit 1; }

summary="$(psql -X -At "$DB_URL" -c "select (select count(*) from public.company_members where user_id='$USER_ID' and role='owner')||'|'||(select count(*) from public.subscriptions where company_id='$id1')||'|'||(select count(*) from public.beta_invites where email='$EMAIL' and status='used' and company_id='$id1' and used_by='$USER_ID')||'|'||(select count(*) from public.beta_invites where email='$EMAIL' and status='pending')")"
[[ "$summary" == "1|1|1|0" ]] || { echo "BETA_INVITE_CONCURRENCY: expected owner|subscription|used|pending = 1|1|1|0, got $summary" >&2; exit 1; }
echo "BETA_INVITE_CONCURRENCY: PASS — two simultaneous onboardings resolved company=$id1; owner|subscription|used|pending=$summary"
