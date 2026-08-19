-- ZiisTec: revisões/pós-venda persistentes.
-- Serviços com followup_days > 0 geram automaticamente um retorno ao concluir uma OS normal.

create table if not exists public.post_sale_followups (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  description text not null,
  due_on date not null,
  status text not null default 'pending' check (status in ('pending','done','dismissed')),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint post_sale_followups_unique_service_per_wo unique(company_id,work_order_id,service_id),
  constraint post_sale_followups_description_len check (char_length(description) between 1 and 500)
);

create index if not exists idx_post_sale_followups_company_due
  on public.post_sale_followups(company_id,status,due_on);
create index if not exists idx_post_sale_followups_client
  on public.post_sale_followups(company_id,client_id,due_on);

alter table public.post_sale_followups enable row level security;

drop policy if exists post_sale_followups_owner_select on public.post_sale_followups;
create policy post_sale_followups_owner_select
on public.post_sale_followups for select to authenticated
using (public.zt_is_owner(company_id));

-- Escrita apenas pelas rotinas internas/RPC controlada.
revoke all on public.post_sale_followups from anon;
revoke insert,update,delete on public.post_sale_followups from authenticated;
grant select on public.post_sale_followups to authenticated;

create or replace function zt_private.zt_generate_post_sale_followups()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if new.status <> 'done' or old.status = 'done' or coalesce(new.is_warranty_visit,false) then
    return new;
  end if;

  insert into public.post_sale_followups(company_id,client_id,work_order_id,service_id,description,due_on)
  select distinct on (s.id)
    new.company_id,
    new.client_id,
    new.id,
    s.id,
    left('Revisão de ' || s.name,500),
    coalesce(new.completed_at::date,current_date) + s.followup_days
  from public.work_order_items wi
  join public.services s
    on s.id=wi.service_id and s.company_id=new.company_id
  where wi.work_order_id=new.id
    and wi.company_id=new.company_id
    and wi.service_id is not null
    and coalesce(s.followup_days,0) > 0
  order by s.id, wi.id
  on conflict (company_id,work_order_id,service_id) do nothing;

  return new;
end $$;

revoke all on function zt_private.zt_generate_post_sale_followups() from public,anon,authenticated;
grant execute on function zt_private.zt_generate_post_sale_followups() to service_role;

drop trigger if exists trg_generate_post_sale_followups on public.work_orders;
create trigger trg_generate_post_sale_followups
after update of status on public.work_orders
for each row execute function zt_private.zt_generate_post_sale_followups();

create or replace function zt_private.zt_set_followup_status(p_followup uuid,p_status text)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_uid uuid:=auth.uid();
  v_company uuid;
begin
  if v_uid is null then raise exception 'Não autenticado' using errcode='28000'; end if;
  if p_status not in ('pending','done','dismissed') then raise exception 'Status de pós-venda inválido' using errcode='22023'; end if;

  select company_id into v_company
    from public.post_sale_followups
   where id=p_followup
   for update;
  if v_company is null then raise exception 'Revisão não encontrada' using errcode='P0002'; end if;
  if not public.zt_is_owner(v_company) then raise exception 'Somente o proprietário gerencia o pós-venda' using errcode='42501'; end if;

  update public.post_sale_followups
     set status=p_status,
         completed_at=case when p_status='done' then coalesce(completed_at,now()) else null end,
         updated_at=now()
   where id=p_followup;
  return p_followup;
end $$;

create or replace function public.zt_set_followup_status(p_followup uuid,p_status text)
returns uuid
language sql
security definer
set search_path=zt_private
as $$ select zt_private.zt_set_followup_status(p_followup,p_status); $$;
revoke all on function public.zt_set_followup_status(uuid,text) from public,anon;
grant execute on function public.zt_set_followup_status(uuid,text) to authenticated,service_role;
