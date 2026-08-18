-- Funções de trigger/guarda não são APIs de cliente.
revoke execute on function public.zt_guard_work_order_technician_update() from public, anon, authenticated;
revoke execute on function public.zt_material_guard() from public, anon, authenticated;
revoke execute on function public.zt_touch() from public, anon, authenticated;
revoke execute on function public.zt_wo_guard() from public, anon, authenticated;

-- Helper de path é necessário durante policies de Storage apenas para sessão autenticada.
revoke execute on function public.zt_path_company(text) from public, anon;
grant execute on function public.zt_path_company(text) to authenticated, service_role;

-- Segurança por padrão para futuras migrations: toda nova função pública começa
-- sem acesso de anon/authenticated e precisa de GRANT explícito se for uma RPC.
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon;
alter default privileges in schema public revoke execute on functions from authenticated;
alter default privileges in schema public grant execute on functions to service_role;

alter default privileges in schema zt_private revoke execute on functions from public;
alter default privileges in schema zt_private revoke execute on functions from anon;
alter default privileges in schema zt_private grant execute on functions to service_role;
