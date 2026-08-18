-- ZiisTec · endurecimento do acesso público
-- Mantém as RPCs necessárias para authenticated e remove execução anônima
-- de funções SECURITY DEFINER que sustentam RLS/fluxos internos.

alter view public.materials_catalog set (security_invoker = true);

alter function public.zt_touch() set search_path = public;
alter function public.zt_path_company(text) set search_path = public;

revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
revoke execute on function public.zt_handle_new_user() from public, anon, authenticated;

revoke execute on function public.zt_is_member(uuid) from public, anon;
revoke execute on function public.zt_is_owner(uuid) from public, anon;
revoke execute on function public.zt_is_platform_admin() from public, anon;
revoke execute on function public.zt_client_visible(uuid,uuid) from public, anon;
revoke execute on function public.zt_compartilha_empresa(uuid) from public, anon;
revoke execute on function public.zt_next_number(uuid,text,text) from public, anon;
revoke execute on function public.zt_wo_is_mine(uuid) from public, anon;
revoke execute on function public.zt_wo_is_owned(uuid) from public, anon;
revoke execute on function public.zt_wo_open(uuid) from public, anon;
