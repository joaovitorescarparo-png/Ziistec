drop policy if exists p_members_select on public.company_members;
create policy p_members_select on public.company_members
for select to authenticated
using (
  user_id = auth.uid()
  or public.zt_is_owner(company_id)
  or public.zt_is_platform_admin()
);

create or replace function public.zt_compartilha_empresa(outro uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.company_members me
    join public.company_members outra on outra.company_id = me.company_id
    where me.user_id = auth.uid()
      and me.status = 'active'
      and me.role = 'owner'
      and outra.user_id = outro
  );
$$;

revoke execute on function public.zt_compartilha_empresa(uuid) from public, anon;
grant execute on function public.zt_compartilha_empresa(uuid) to authenticated, service_role;
