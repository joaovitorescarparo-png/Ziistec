-- ZiisTec RC-1B — SECURITY DEFINER inventory invariants + role/tenant/subscription matrix.
begin;

-- Inventory invariants for application-owned schemas.
do $$
declare v_total int; v_anon int; v_missing_path int; v_private_auth int; v_dynamic int;
begin
  select count(*) into v_total from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.prosecdef and n.nspname in ('public','zt_private');
  if v_total<>116 then raise exception 'RC1B_DEFINER_INVENTORY_DRIFT expected=116 actual=%',v_total; end if;

  select count(*) into v_anon from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.prosecdef and n.nspname in ('public','zt_private') and has_function_privilege('anon',p.oid,'EXECUTE');
  if v_anon<>0 then raise exception 'RC1B_ANON_DEFINER_EXECUTE=%',v_anon; end if;

  select count(*) into v_missing_path from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.prosecdef and n.nspname in ('public','zt_private') and not exists (select 1 from unnest(coalesce(p.proconfig,array[]::text[])) c where c like 'search_path=%');
  if v_missing_path<>0 then raise exception 'RC1B_DEFINER_WITHOUT_EXPLICIT_SEARCH_PATH=%',v_missing_path; end if;

  select count(*) into v_private_auth from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.prosecdef and n.nspname='zt_private' and has_function_privilege('authenticated',p.oid,'EXECUTE');
  if v_private_auth<>0 then raise exception 'RC1B_PRIVATE_DEFINER_EXPOSED_TO_AUTH=%',v_private_auth; end if;

  if has_schema_privilege('anon','public','CREATE') or has_schema_privilege('authenticated','public','CREATE') or has_schema_privilege('service_role','public','CREATE') then
    raise exception 'RC1B_PUBLIC_SCHEMA_CREATE_EXPOSED';
  end if;
  if has_schema_privilege('anon','zt_private','USAGE') or has_schema_privilege('authenticated','zt_private','USAGE') then
    raise exception 'RC1B_PRIVATE_SCHEMA_USAGE_EXPOSED';
  end if;

  select count(*) into v_dynamic from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.prosecdef and n.nspname in ('public','zt_private') and lower(p.prosrc) ~ '\mexecute\M';
  if v_dynamic<>1 then raise exception 'RC1B_UNEXPECTED_DYNAMIC_SQL_COUNT=%',v_dynamic; end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.prosecdef and n.nspname='public' and p.proname='rls_auto_enable' and p.proconfig @> array['search_path=pg_catalog']::text[] and not has_function_privilege('authenticated',p.oid,'EXECUTE') and not has_function_privilege('anon',p.oid,'EXECUTE')) then
    raise exception 'RC1B_RLS_AUTO_ENABLE_NOT_HARDENED';
  end if;
end $$;

-- Fixture bootstrap is deliberately outside the authorization behavior being tested.
set local session_replication_role = replica;
insert into public.company_members(company_id,user_id,role,status,job_title)
values ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000004','technician','active','RC1B Tech B')
on conflict (company_id,user_id) do update set role='technician',status='active';

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('00000000-0000-0000-0000-000000000000','10000000-0000-0000-0000-000000000005','authenticated','authenticated','rc1b-no-membership@example.invalid','',now(),'{}','{}',now(),now());
insert into public.profiles(id,full_name,email) values ('10000000-0000-0000-0000-000000000005','RC1B No Membership','rc1b-no-membership@example.invalid');
set local session_replication_role = origin;

create temp table rc1b_sd_result(k text primary key, ok boolean) on commit drop;
grant select,insert on rc1b_sd_result to authenticated,anon;

-- Owner A positive.
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true); set local role authenticated;
do $$ begin
  perform public.zt_save_post_sale_policy('20000000-0000-0000-0000-000000000001',null,'RC1B Owner A','check_in',7,true);
  insert into rc1b_sd_result values ('owner_a_positive',true);
end $$; reset role;

-- Tech A cannot execute owner-only write.
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true); set local role authenticated;
do $$ declare b boolean:=false; begin
  begin perform public.zt_save_post_sale_policy('20000000-0000-0000-0000-000000000001',null,'RC1B Tech A','check_in',7,true); exception when others then b:=true; end;
  insert into rc1b_sd_result values ('tech_a_owner_only_block',b);
end $$; reset role;

-- Owner B cannot cross tenant into A.
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true); set local role authenticated;
do $$ declare b boolean:=false; begin
  begin perform public.zt_save_post_sale_policy('20000000-0000-0000-0000-000000000001',null,'RC1B Owner B Cross','check_in',7,true); exception when others then b:=true; end;
  insert into rc1b_sd_result values ('owner_b_cross_tenant_block',b);
end $$; reset role;

-- Tech B cannot execute owner-only write even in own tenant.
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000004',true); set local role authenticated;
do $$ declare b boolean:=false; begin
  begin perform public.zt_save_post_sale_policy('20000000-0000-0000-0000-000000000002',null,'RC1B Tech B','check_in',7,true); exception when others then b:=true; end;
  insert into rc1b_sd_result values ('tech_b_owner_only_block',b);
end $$; reset role;

-- No-membership user blocked.
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000005',true); set local role authenticated;
do $$ declare b boolean:=false; begin
  begin perform public.zt_save_post_sale_policy('20000000-0000-0000-0000-000000000001',null,'RC1B None','check_in',7,true); exception when others then b:=true; end;
  insert into rc1b_sd_result values ('no_membership_block',b);
end $$; reset role;

-- Disabled membership loses privileged access.
update public.company_members set status='disabled' where company_id='20000000-0000-0000-0000-000000000001' and user_id='10000000-0000-0000-0000-000000000003';
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true); set local role authenticated;
do $$ declare b boolean:=false; begin
  begin perform public.zt_save_post_sale_policy('20000000-0000-0000-0000-000000000001',null,'RC1B Disabled','check_in',7,true); exception when others then b:=true; end;
  insert into rc1b_sd_result values ('disabled_membership_block',b);
end $$; reset role;

-- Inactive subscription blocks owner write.
update public.subscriptions set status='canceled' where company_id='20000000-0000-0000-0000-000000000001';
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true); set local role authenticated;
do $$ declare b boolean:=false; begin
  begin perform public.zt_save_post_sale_policy('20000000-0000-0000-0000-000000000001',null,'RC1B Canceled','check_in',7,true); exception when others then b:=true; end;
  insert into rc1b_sd_result values ('inactive_subscription_block',b);
end $$; reset role;

-- anon has no EXECUTE on the privileged RPC.
set local role anon;
do $$ declare b boolean:=false; begin
  begin perform public.zt_save_post_sale_policy('20000000-0000-0000-0000-000000000001',null,'RC1B Anon','check_in',7,true); exception when insufficient_privilege then b:=true; when others then b:=true; end;
  insert into rc1b_sd_result values ('anon_execute_block',b);
end $$; reset role;

do $$ declare failed text; begin
  select string_agg(k,', ') into failed from rc1b_sd_result where not ok;
  if failed is not null then raise exception 'RC1B_SECURITY_DEFINER_TEST_FAILED: %',failed; end if;
  if (select count(*) from rc1b_sd_result)<>8 then raise exception 'RC1B_SECURITY_DEFINER_TEST_INCOMPLETE'; end if;
end $$;
select 'RC1B_SECURITY_DEFINER_AUDIT_OK' as test, count(*) as assertions from rc1b_sd_result where ok;
rollback;
