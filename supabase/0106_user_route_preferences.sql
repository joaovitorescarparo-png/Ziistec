-- ZiisTec · Onda 2 — preferência de aplicativo de rota, POR USUÁRIO.
--
-- A preferência (Google Maps, Waze ou Apple Maps) pertence à pessoa, não à empresa: o proprietário pode
-- preferir o Google Maps e o técnico o Waze, e uma mudança de um não alcança o outro. Por isso a tabela
-- não tem company_id e não passa por membership: cada usuário autenticado lê, cria e altera somente a
-- própria linha. Nenhuma função SECURITY DEFINER é criada (a auditoria de definers não muda) e não há
-- DELETE. Nada de dado de empresa, cliente ou financeiro vive aqui.
--
-- Compatibilidade: o frontend funciona sem esta migration (a escolha vale só na sessão). Não aplicar
-- fora de CI descartável ou homologação.

create table if not exists public.user_route_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  route_app text not null,
  updated_at timestamptz not null default now(),
  constraint user_route_preferences_app_ck check (route_app in ('google','waze','apple'))
);

comment on table public.user_route_preferences is
  'Aplicativo de rota preferido de cada usuário (google, waze ou apple). Uma linha por usuário; só o próprio usuário acessa.';

alter table public.user_route_preferences enable row level security;
revoke all on public.user_route_preferences from public, anon, authenticated;
grant select, insert, update on public.user_route_preferences to authenticated;

drop policy if exists p_user_route_preferences_select on public.user_route_preferences;
create policy p_user_route_preferences_select on public.user_route_preferences
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists p_user_route_preferences_insert on public.user_route_preferences;
create policy p_user_route_preferences_insert on public.user_route_preferences
  for insert to authenticated
  with check (user_id = (select auth.uid()));

-- USING e WITH CHECK juntos: só altera a própria linha e não consegue reatribuí-la a outro usuário.
drop policy if exists p_user_route_preferences_update on public.user_route_preferences;
create policy p_user_route_preferences_update on public.user_route_preferences
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
