-- =====================================================================
-- ZiisTec · migration 0052 — Central Técnica (vínculo com OS e casos reais)
--
-- 1) work_order_equipment: liga o modelo de equipamento à OS. É a porta
--    da "Ajuda técnica" durante o atendimento e a ponte que transforma a
--    Base Técnica (relato da OS) em caso consultável.
-- 2) zt_equipment_cases: casos resolvidos pela PRÓPRIA empresa para um
--    modelo. SECURITY DEFINER com sanitização explícita: devolve somente
--    conhecimento técnico (sintoma, relato, pendência, retorno, data).
--    NUNCA devolve cliente, endereço, telefone, preço ou financeiro.
--    A Base Técnica continua sendo a fonte — nada é duplicado.
-- =====================================================================

create table if not exists public.work_order_equipment (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  model_id      uuid not null references public.equipment_models(id) on delete restrict,
  notes         text check (notes is null or length(notes) <= 500),
  created_by    uuid references public.profiles(id) default auth.uid(),
  created_at    timestamptz not null default now(),
  unique (work_order_id, model_id)
);
create index if not exists idx_wo_equipment_wo    on public.work_order_equipment (work_order_id);
create index if not exists idx_wo_equipment_model on public.work_order_equipment (company_id, model_id);
create index if not exists idx_wo_equipment_created_by on public.work_order_equipment (created_by);

-- integridade de tenant: OS da mesma empresa; modelo global ou da empresa
create or replace function public.zt_eq_guard_wo_link()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_wo_company uuid; v_model_company uuid;
begin
  select w.company_id into v_wo_company from public.work_orders w where w.id = new.work_order_id;
  if v_wo_company is null or v_wo_company <> new.company_id then
    raise exception 'OS pertence a outra empresa' using errcode='42501';
  end if;
  select m.company_id into v_model_company from public.equipment_models m where m.id = new.model_id;
  if v_model_company is not null and v_model_company <> new.company_id then
    raise exception 'Modelo pertence a outra empresa' using errcode='42501';
  end if;
  return new;
end $$;
revoke all on function public.zt_eq_guard_wo_link() from public, anon, authenticated;
drop trigger if exists trg_eq_guard_wo_link on public.work_order_equipment;
create trigger trg_eq_guard_wo_link
  before insert or update on public.work_order_equipment
  for each row execute function public.zt_eq_guard_wo_link();

drop trigger if exists trg_subscription_write_guard on public.work_order_equipment;
create trigger trg_subscription_write_guard
  before insert or update or delete on public.work_order_equipment
  for each row
  when (pg_trigger_depth() = 0)
  execute function public.zt_guard_subscription_write_if_tenant();

alter table public.work_order_equipment enable row level security;

-- mesmo recorte das demais tabelas de OS: owner vê tudo da empresa;
-- técnico vê e edita apenas nas suas OS em aberto.
drop policy if exists p_wo_equipment_select on public.work_order_equipment;
create policy p_wo_equipment_select on public.work_order_equipment for select to authenticated
  using (public.zt_wo_is_owned(work_order_id) or public.zt_wo_is_mine(work_order_id));

drop policy if exists p_wo_equipment_insert on public.work_order_equipment;
create policy p_wo_equipment_insert on public.work_order_equipment for insert to authenticated
  with check (
    public.zt_wo_is_owned(work_order_id)
    or (public.zt_wo_is_mine(work_order_id) and public.zt_wo_open(work_order_id)
        and created_by = (select auth.uid()))
  );

drop policy if exists p_wo_equipment_delete on public.work_order_equipment;
create policy p_wo_equipment_delete on public.work_order_equipment for delete to authenticated
  using (
    public.zt_wo_is_owned(work_order_id)
    or (public.zt_wo_is_mine(work_order_id) and public.zt_wo_open(work_order_id)
        and created_by = (select auth.uid()))
  );
-- sem UPDATE: vínculo troca-se removendo e recriando (notes curtas)

revoke all on table public.work_order_equipment from public, anon;
grant select, insert, delete on table public.work_order_equipment to authenticated;
grant all on table public.work_order_equipment to service_role;

-- =====================================================================
-- Casos resolvidos (Base Técnica → Central Técnica)
-- =====================================================================
-- Técnico comum não enxerga OS dos colegas via RLS; o caso técnico é
-- conhecimento da empresa, então a RPC (definer) faz a mediação com
-- sanitização de campos. Colunas financeiras nem são selecionadas.
create or replace function public.zt_equipment_cases(
  p_company uuid,
  p_model   uuid,
  p_limit   int default 10,
  p_offset  int default 0
)
returns table (
  case_id      uuid,
  wo_number    text,
  completed_on date,
  symptom      text,
  report       text,
  pending_note text,
  needs_return boolean,
  linked_notes text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.zt_is_member(p_company) then
    raise exception 'Você não tem permissão para esta ação nesta empresa.' using errcode='42501';
  end if;

  return query
  select w.id,
         w.number,
         (w.completed_at at time zone 'UTC')::date,
         left(coalesce(nullif(btrim(w.problem_report),''), nullif(btrim(w.request),''), ''), 2000),
         left(coalesce((
           select r.body from public.work_order_reports r
            where r.work_order_id = w.id and r.entry_type = 'report'
            order by r.created_at desc limit 1
         ), ''), 8000),
         left(coalesce(nullif(btrim(w.pending_note),''), ''), 1000),
         w.needs_return,
         left(coalesce(nullif(btrim(e.notes),''), ''), 500)
    from public.work_order_equipment e
    join public.work_orders w on w.id = e.work_order_id
   where e.company_id = p_company
     and e.model_id = p_model
     and w.company_id = p_company          -- cinto e suspensório com o guard
     and w.status = 'done'
   order by w.completed_at desc nulls last
   limit least(greatest(coalesce(p_limit,10),1),30)
  offset greatest(coalesce(p_offset,0),0);
end $$;

revoke all on function public.zt_equipment_cases(uuid, uuid, int, int) from public, anon;
grant execute on function public.zt_equipment_cases(uuid, uuid, int, int) to authenticated, service_role;

-- contagem leve para a aba "Casos" (badge), mesma mediação
create or replace function public.zt_equipment_cases_count(p_company uuid, p_model uuid)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare v int;
begin
  if not public.zt_is_member(p_company) then
    raise exception 'Você não tem permissão para esta ação nesta empresa.' using errcode='42501';
  end if;
  select count(*)::int into v
    from public.work_order_equipment e
    join public.work_orders w on w.id = e.work_order_id
   where e.company_id = p_company and e.model_id = p_model
     and w.company_id = p_company and w.status = 'done';
  return v;
end $$;

revoke all on function public.zt_equipment_cases_count(uuid, uuid) from public, anon;
grant execute on function public.zt_equipment_cases_count(uuid, uuid) to authenticated, service_role;
