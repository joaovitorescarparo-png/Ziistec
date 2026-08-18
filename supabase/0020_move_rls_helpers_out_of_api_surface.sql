create schema if not exists zt_private;
revoke all on schema zt_private from public, anon;
grant usage on schema zt_private to authenticated, service_role;

create or replace function zt_private.is_member(target uuid)
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.company_members m where m.company_id=target and m.user_id=auth.uid() and m.status='active'); $$;
create or replace function zt_private.is_owner(target uuid)
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.company_members m where m.company_id=target and m.user_id=auth.uid() and m.status='active' and m.role='owner'); $$;
create or replace function zt_private.is_platform_admin()
returns boolean language sql stable security definer set search_path=public
as $$ select coalesce((select p.is_platform_admin from public.profiles p where p.id=auth.uid()),false) and coalesce(auth.jwt()->>'aal','aal1')='aal2'; $$;
create or replace function zt_private.wo_is_mine(w_id uuid)
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.work_orders w join public.company_members m on m.company_id=w.company_id where w.id=w_id and w.assigned_to=auth.uid() and m.user_id=auth.uid() and m.status='active'); $$;
create or replace function zt_private.wo_is_owned(w_id uuid)
returns boolean language sql stable security definer set search_path=public,zt_private
as $$ select exists(select 1 from public.work_orders w where w.id=w_id and zt_private.is_owner(w.company_id)); $$;
create or replace function zt_private.wo_open(w_id uuid)
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.work_orders w where w.id=w_id and w.status not in ('done','canceled')); $$;
create or replace function zt_private.client_visible(c_id uuid, comp uuid)
returns boolean language sql stable security definer set search_path=public,zt_private
as $$ select zt_private.is_owner(comp) or (zt_private.is_member(comp) and exists(select 1 from public.work_orders w where w.client_id=c_id and w.company_id=comp and w.assigned_to=auth.uid())); $$;
create or replace function zt_private.compartilha_empresa(outro uuid)
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.company_members me join public.company_members outra on outra.company_id=me.company_id where me.user_id=auth.uid() and me.status='active' and me.role='owner' and outra.user_id=outro); $$;

revoke execute on all functions in schema zt_private from public, anon;
grant execute on all functions in schema zt_private to authenticated, service_role;

create or replace function public.zt_is_member(target uuid)
returns boolean language sql stable security invoker set search_path=zt_private
as $$ select zt_private.is_member(target); $$;
create or replace function public.zt_is_owner(target uuid)
returns boolean language sql stable security invoker set search_path=zt_private
as $$ select zt_private.is_owner(target); $$;
create or replace function public.zt_is_platform_admin()
returns boolean language sql stable security invoker set search_path=zt_private
as $$ select zt_private.is_platform_admin(); $$;
create or replace function public.zt_wo_is_mine(w_id uuid)
returns boolean language sql stable security invoker set search_path=zt_private
as $$ select zt_private.wo_is_mine(w_id); $$;
create or replace function public.zt_wo_is_owned(w_id uuid)
returns boolean language sql stable security invoker set search_path=zt_private
as $$ select zt_private.wo_is_owned(w_id); $$;
create or replace function public.zt_wo_open(w_id uuid)
returns boolean language sql stable security invoker set search_path=zt_private
as $$ select zt_private.wo_open(w_id); $$;
create or replace function public.zt_client_visible(c_id uuid, comp uuid)
returns boolean language sql stable security invoker set search_path=zt_private
as $$ select zt_private.client_visible(c_id,comp); $$;
create or replace function public.zt_compartilha_empresa(outro uuid)
returns boolean language sql stable security invoker set search_path=zt_private
as $$ select zt_private.compartilha_empresa(outro); $$;

revoke execute on function public.zt_is_member(uuid) from public, anon;
revoke execute on function public.zt_is_owner(uuid) from public, anon;
revoke execute on function public.zt_is_platform_admin() from public, anon;
revoke execute on function public.zt_wo_is_mine(uuid) from public, anon;
revoke execute on function public.zt_wo_is_owned(uuid) from public, anon;
revoke execute on function public.zt_wo_open(uuid) from public, anon;
revoke execute on function public.zt_client_visible(uuid,uuid) from public, anon;
revoke execute on function public.zt_compartilha_empresa(uuid) from public, anon;
grant execute on function public.zt_is_member(uuid) to authenticated, service_role;
grant execute on function public.zt_is_owner(uuid) to authenticated, service_role;
grant execute on function public.zt_is_platform_admin() to authenticated, service_role;
grant execute on function public.zt_wo_is_mine(uuid) to authenticated, service_role;
grant execute on function public.zt_wo_is_owned(uuid) to authenticated, service_role;
grant execute on function public.zt_wo_open(uuid) to authenticated, service_role;
grant execute on function public.zt_client_visible(uuid,uuid) to authenticated, service_role;
grant execute on function public.zt_compartilha_empresa(uuid) to authenticated, service_role;
