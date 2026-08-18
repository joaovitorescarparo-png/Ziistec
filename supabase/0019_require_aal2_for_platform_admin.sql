create or replace function public.zt_is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce((select p.is_platform_admin from public.profiles p where p.id = auth.uid()), false)
    and coalesce(auth.jwt()->>'aal','aal1') = 'aal2';
$$;

revoke execute on function public.zt_is_platform_admin() from public, anon;
grant execute on function public.zt_is_platform_admin() to authenticated, service_role;
