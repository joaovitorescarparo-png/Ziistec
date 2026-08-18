-- ZiisTec · sela o schema privado atrás dos gateways públicos

drop function if exists public.zt_consume_ai_quota();
drop function if exists zt_private.zt_consume_ai_quota();

alter function public.zt_accept_invites() security definer;
alter function public.zt_bill_work_order(uuid,integer) security definer;
alter function public.zt_cancel_subscription(uuid) security definer;
alter function public.zt_client_visible(uuid,uuid) security definer;
alter function public.zt_compartilha_empresa(uuid) security definer;
alter function public.zt_complete_work_order(uuid,text,text,numeric,integer) security definer;
alter function public.zt_consume_ai_quota(uuid) security definer;
alter function public.zt_create_company(text,text,boolean,text,text) security definer;
alter function public.zt_is_member(uuid) security definer;
alter function public.zt_is_owner(uuid) security definer;
alter function public.zt_is_platform_admin() security definer;
alter function public.zt_next_number(uuid,text,text) security definer;
alter function public.zt_platform_set_subscription_status(uuid,public.zt_sub_status) security definer;
alter function public.zt_reactivate_subscription(uuid) security definer;
alter function public.zt_refresh_subscription_status(uuid) security definer;
alter function public.zt_update_team_member(uuid,uuid,text,text,text) security definer;
alter function public.zt_wo_is_mine(uuid) security definer;
alter function public.zt_wo_is_owned(uuid) security definer;
alter function public.zt_wo_open(uuid) security definer;

revoke usage on schema zt_private from public, anon, authenticated;
revoke execute on all functions in schema zt_private from public, anon, authenticated;
grant usage on schema zt_private to service_role;
grant execute on all functions in schema zt_private to service_role;
alter default privileges in schema zt_private revoke execute on functions from public;

grant execute on function public.zt_accept_invites() to authenticated;
grant execute on function public.zt_bill_work_order(uuid,integer) to authenticated;
grant execute on function public.zt_cancel_subscription(uuid) to authenticated;
grant execute on function public.zt_client_visible(uuid,uuid) to authenticated;
grant execute on function public.zt_compartilha_empresa(uuid) to authenticated;
grant execute on function public.zt_complete_work_order(uuid,text,text,numeric,integer) to authenticated;
grant execute on function public.zt_consume_ai_quota(uuid) to authenticated;
grant execute on function public.zt_create_company(text,text,boolean,text,text) to authenticated;
grant execute on function public.zt_is_member(uuid) to authenticated;
grant execute on function public.zt_is_owner(uuid) to authenticated;
grant execute on function public.zt_is_platform_admin() to authenticated;
grant execute on function public.zt_next_number(uuid,text,text) to authenticated;
grant execute on function public.zt_platform_set_subscription_status(uuid,public.zt_sub_status) to authenticated;
grant execute on function public.zt_reactivate_subscription(uuid) to authenticated;
grant execute on function public.zt_refresh_subscription_status(uuid) to authenticated;
grant execute on function public.zt_update_team_member(uuid,uuid,text,text,text) to authenticated;
grant execute on function public.zt_wo_is_mine(uuid) to authenticated;
grant execute on function public.zt_wo_is_owned(uuid) to authenticated;
grant execute on function public.zt_wo_open(uuid) to authenticated;
