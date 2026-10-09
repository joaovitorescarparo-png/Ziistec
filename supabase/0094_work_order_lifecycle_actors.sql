-- ZiisTec · Bloco 4 — quem iniciou e quem concluiu a OS.
--
-- started_at/started_by e completed_by são preenchidos pelo próprio banco a partir de auth.uid()
-- na transição de status. A finalização atômica (zt_complete_work_order) não muda: o trigger
-- registra o usuário que fez a conclusão, seja proprietário ou técnico atribuído. Chamadas do
-- app (authenticated/anon) não conseguem forjar nem apagar esses campos.
-- OS concluídas antes desta migration ficam com completed_by nulo; o histórico usa a entrada
-- "Serviço concluído" de work_order_reports como fallback, sem reescrever linhas antigas.

alter table public.work_orders
  add column if not exists started_at timestamptz,
  add column if not exists started_by uuid references public.profiles(id) on delete set null,
  add column if not exists completed_by uuid references public.profiles(id) on delete set null;

create or replace function zt_private.zt_track_work_order_actors()
returns trigger
language plpgsql
security invoker
set search_path=''
as $$
begin
  if current_user in ('authenticated','anon') then
    if tg_op='INSERT' then
      new.started_at:=null;
      new.started_by:=null;
      new.completed_by:=null;
    else
      new.started_at:=old.started_at;
      new.started_by:=old.started_by;
      new.completed_by:=old.completed_by;
    end if;
  end if;

  if new.status='in_progress' and new.started_at is null
     and (tg_op='INSERT' or old.status is distinct from new.status) then
    new.started_at:=now();
    new.started_by:=auth.uid();
  end if;

  if new.status='done' and new.completed_by is null
     and (tg_op='INSERT' or old.status is distinct from new.status) then
    new.completed_by:=auth.uid();
  end if;

  return new;
end;
$$;

revoke all on function zt_private.zt_track_work_order_actors() from public, anon, authenticated;

drop trigger if exists zt_track_work_order_actors on public.work_orders;
create trigger zt_track_work_order_actors
  before insert or update on public.work_orders
  for each row execute function zt_private.zt_track_work_order_actors();

comment on column public.work_orders.started_by is
  'Usuário que colocou a OS em andamento pela primeira vez (definido pelo banco).';
comment on column public.work_orders.completed_by is
  'Usuário que concluiu a OS pela finalização atômica (definido pelo banco).';
