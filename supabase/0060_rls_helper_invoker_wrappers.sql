-- ZiisTec: reduz superfície de SECURITY DEFINER no schema público.
-- Os helpers abaixo são usados por policies RLS. O wrapper público não precisa possuir
-- privilégio elevado: ele roda como INVOKER e chama apenas um helper booleano específico
-- em zt_private, que continua SECURITY DEFINER para evitar recursão de RLS.
-- zt_private não é schema exposto da Data API. authenticated recebe somente USAGE do
-- schema e EXECUTE nos helpers booleanos explicitamente allowlisted abaixo.

-- Sela primeiro todo o schema privado. Algumas funções legadas tinham EXECUTE herdado
-- por PUBLIC; sem este revoke, conceder USAGE ao schema tornaria essas rotas chamáveis.
revoke usage, create on schema zt_private from public, anon;
revoke create on schema zt_private from authenticated;
revoke execute on all functions in schema zt_private from public, anon, authenticated;

-- Evita que uma função privada criada futuramente por postgres volte a nascer executável
-- por PUBLIC por causa do privilégio padrão do PostgreSQL.
alter default privileges for role postgres in schema zt_private
  revoke execute on functions from public;

grant usage on schema zt_private to authenticated;

-- Allowlist estrita: somente helpers booleanos usados pelas policies RLS.
grant execute on function zt_private.client_visible(uuid,uuid) to authenticated, service_role;
grant execute on function zt_private.compartilha_empresa(uuid) to authenticated, service_role;
grant execute on function zt_private.is_member(uuid) to authenticated, service_role;
grant execute on function zt_private.is_owner(uuid) to authenticated, service_role;
grant execute on function zt_private.is_platform_admin() to authenticated, service_role;
grant execute on function zt_private.subscription_can_write(uuid) to authenticated, service_role;
grant execute on function zt_private.wo_is_mine(uuid) to authenticated, service_role;
grant execute on function zt_private.wo_is_owned(uuid) to authenticated, service_role;
grant execute on function zt_private.wo_open(uuid) to authenticated, service_role;

create or replace function public.zt_client_visible(c_id uuid, comp uuid)
returns boolean language sql stable security invoker set search_path=''
as $$ select zt_private.client_visible(c_id,comp); $$;

create or replace function public.zt_compartilha_empresa(outro uuid)
returns boolean language sql stable security invoker set search_path=''
as $$ select zt_private.compartilha_empresa(outro); $$;

create or replace function public.zt_is_member(target uuid)
returns boolean language sql stable security invoker set search_path=''
as $$ select zt_private.is_member(target); $$;

create or replace function public.zt_is_owner(target uuid)
returns boolean language sql stable security invoker set search_path=''
as $$ select zt_private.is_owner(target); $$;

create or replace function public.zt_is_platform_admin()
returns boolean language sql stable security invoker set search_path=''
as $$ select zt_private.is_platform_admin(); $$;

create or replace function public.zt_subscription_can_write(target uuid)
returns boolean language sql stable security invoker set search_path=''
as $$ select zt_private.subscription_can_write(target); $$;

create or replace function public.zt_wo_is_mine(w_id uuid)
returns boolean language sql stable security invoker set search_path=''
as $$ select zt_private.wo_is_mine(w_id); $$;

create or replace function public.zt_wo_is_owned(w_id uuid)
returns boolean language sql stable security invoker set search_path=''
as $$ select zt_private.wo_is_owned(w_id); $$;

create or replace function public.zt_wo_open(w_id uuid)
returns boolean language sql stable security invoker set search_path=''
as $$ select zt_private.wo_open(w_id); $$;

revoke all on function public.zt_client_visible(uuid,uuid) from public, anon;
revoke all on function public.zt_compartilha_empresa(uuid) from public, anon;
revoke all on function public.zt_is_member(uuid) from public, anon;
revoke all on function public.zt_is_owner(uuid) from public, anon;
revoke all on function public.zt_is_platform_admin() from public, anon;
revoke all on function public.zt_subscription_can_write(uuid) from public, anon;
revoke all on function public.zt_wo_is_mine(uuid) from public, anon;
revoke all on function public.zt_wo_is_owned(uuid) from public, anon;
revoke all on function public.zt_wo_open(uuid) from public, anon;

grant execute on function public.zt_client_visible(uuid,uuid) to authenticated, service_role;
grant execute on function public.zt_compartilha_empresa(uuid) to authenticated, service_role;
grant execute on function public.zt_is_member(uuid) to authenticated, service_role;
grant execute on function public.zt_is_owner(uuid) to authenticated, service_role;
grant execute on function public.zt_is_platform_admin() to authenticated, service_role;
grant execute on function public.zt_subscription_can_write(uuid) to authenticated, service_role;
grant execute on function public.zt_wo_is_mine(uuid) to authenticated, service_role;
grant execute on function public.zt_wo_is_owned(uuid) to authenticated, service_role;
grant execute on function public.zt_wo_open(uuid) to authenticated, service_role;

comment on schema zt_private is
  'Schema interno da ZiisTec; authenticated possui apenas USAGE e EXECUTE em helpers booleanos allowlisted para RLS. Funções privadas de escrita permanecem inacessíveis.';
