revoke all on function public.zt_save_quote(uuid,uuid,jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.zt_save_work_order(uuid,uuid,jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.zt_finalize_pending_work_order_pricing(uuid,integer) from public, anon, authenticated;
grant execute on function public.zt_save_quote(uuid,uuid,jsonb,jsonb) to service_role;
grant execute on function public.zt_save_work_order(uuid,uuid,jsonb,jsonb) to service_role;
grant execute on function public.zt_finalize_pending_work_order_pricing(uuid,integer) to service_role;
