-- Move implementações SECURITY DEFINER para schema interno e mantém no public
-- somente wrappers SECURITY INVOKER com a mesma API esperada pelo frontend.

alter function public.zt_accept_invites() set schema zt_private;
alter function public.zt_bill_work_order(uuid, integer) set schema zt_private;
alter function public.zt_cancel_subscription(uuid) set schema zt_private;
alter function public.zt_complete_work_order(uuid, text, text, numeric, integer) set schema zt_private;
alter function public.zt_consume_ai_quota() set schema zt_private;
alter function public.zt_create_company(text, text, boolean, text, text) set schema zt_private;
alter function public.zt_next_number(uuid, text, text) set schema zt_private;
alter function public.zt_platform_set_subscription_status(uuid, public.zt_sub_status) set schema zt_private;
alter function public.zt_reactivate_subscription(uuid) set schema zt_private;
alter function public.zt_refresh_subscription_status(uuid) set schema zt_private;
alter function public.zt_update_team_member(uuid, uuid, text, text, text) set schema zt_private;

revoke execute on all functions in schema zt_private from public, anon;
grant execute on all functions in schema zt_private to authenticated, service_role;

create function public.zt_accept_invites()
returns integer language sql security invoker set search_path=zt_private
as $$ select zt_private.zt_accept_invites(); $$;
create function public.zt_bill_work_order(p_wo uuid, p_due_days integer default 7)
returns uuid language sql security invoker set search_path=zt_private
as $$ select zt_private.zt_bill_work_order(p_wo,p_due_days); $$;
create function public.zt_cancel_subscription(p_company uuid)
returns public.zt_sub_status language sql security invoker set search_path=zt_private,public
as $$ select zt_private.zt_cancel_subscription(p_company); $$;
create function public.zt_complete_work_order(p_wo uuid, p_report text default null, p_pending text default null, p_extra_cost numeric default 0, p_due_days integer default 7)
returns uuid language sql security invoker set search_path=zt_private
as $$ select zt_private.zt_complete_work_order(p_wo,p_report,p_pending,p_extra_cost,p_due_days); $$;
create function public.zt_consume_ai_quota()
returns uuid language sql security invoker set search_path=zt_private
as $$ select zt_private.zt_consume_ai_quota(); $$;
create function public.zt_create_company(p_name text, p_activity text default null, p_has_team boolean default false, p_owner_name text default null, p_phone text default null)
returns uuid language sql security invoker set search_path=zt_private
as $$ select zt_private.zt_create_company(p_name,p_activity,p_has_team,p_owner_name,p_phone); $$;
create function public.zt_next_number(comp uuid, doc text, prefix text)
returns text language sql security invoker set search_path=zt_private
as $$ select zt_private.zt_next_number(comp,doc,prefix); $$;
create function public.zt_platform_set_subscription_status(p_company uuid, p_status public.zt_sub_status)
returns public.zt_sub_status language sql security invoker set search_path=zt_private,public
as $$ select zt_private.zt_platform_set_subscription_status(p_company,p_status); $$;
create function public.zt_reactivate_subscription(p_company uuid)
returns public.zt_sub_status language sql security invoker set search_path=zt_private,public
as $$ select zt_private.zt_reactivate_subscription(p_company); $$;
create function public.zt_refresh_subscription_status(p_company uuid)
returns public.zt_sub_status language sql security invoker set search_path=zt_private,public
as $$ select zt_private.zt_refresh_subscription_status(p_company); $$;
create function public.zt_update_team_member(p_company uuid, p_user uuid, p_name text default null, p_phone text default null, p_job_title text default null)
returns void language sql security invoker set search_path=zt_private
as $$ select zt_private.zt_update_team_member(p_company,p_user,p_name,p_phone,p_job_title); $$;

revoke execute on function public.zt_accept_invites() from public, anon;
revoke execute on function public.zt_bill_work_order(uuid,integer) from public, anon;
revoke execute on function public.zt_cancel_subscription(uuid) from public, anon;
revoke execute on function public.zt_complete_work_order(uuid,text,text,numeric,integer) from public, anon;
revoke execute on function public.zt_consume_ai_quota() from public, anon;
revoke execute on function public.zt_create_company(text,text,boolean,text,text) from public, anon;
revoke execute on function public.zt_next_number(uuid,text,text) from public, anon;
revoke execute on function public.zt_platform_set_subscription_status(uuid,public.zt_sub_status) from public, anon;
revoke execute on function public.zt_reactivate_subscription(uuid) from public, anon;
revoke execute on function public.zt_refresh_subscription_status(uuid) from public, anon;
revoke execute on function public.zt_update_team_member(uuid,uuid,text,text,text) from public, anon;

grant execute on function public.zt_accept_invites() to authenticated, service_role;
grant execute on function public.zt_bill_work_order(uuid,integer) to authenticated, service_role;
grant execute on function public.zt_cancel_subscription(uuid) to authenticated, service_role;
grant execute on function public.zt_complete_work_order(uuid,text,text,numeric,integer) to authenticated, service_role;
grant execute on function public.zt_consume_ai_quota() to authenticated, service_role;
grant execute on function public.zt_create_company(text,text,boolean,text,text) to authenticated, service_role;
grant execute on function public.zt_next_number(uuid,text,text) to authenticated, service_role;
grant execute on function public.zt_platform_set_subscription_status(uuid,public.zt_sub_status) to authenticated, service_role;
grant execute on function public.zt_reactivate_subscription(uuid) to authenticated, service_role;
grant execute on function public.zt_refresh_subscription_status(uuid) to authenticated, service_role;
grant execute on function public.zt_update_team_member(uuid,uuid,text,text,text) to authenticated, service_role;

drop policy if exists ai_usage_no_direct_access on public.ai_usage_events;
create policy ai_usage_no_direct_access on public.ai_usage_events
as restrictive for all to authenticated
using (false)
with check (false);
