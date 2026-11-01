-- ZiisTec Product V2: ciclos idempotentes de contrato recorrente.

alter table public.work_orders
  add column if not exists maintenance_contract_id uuid,
  add column if not exists contract_cycle date;
alter table public.financial_entries
  add column if not exists maintenance_contract_id uuid,
  add column if not exists contract_cycle date;

alter table public.work_orders drop constraint if exists work_orders_maintenance_contract_fk;
alter table public.work_orders add constraint work_orders_maintenance_contract_fk
  foreign key (company_id,maintenance_contract_id)
  references public.maintenance_contracts(company_id,id);
alter table public.financial_entries drop constraint if exists financial_entries_maintenance_contract_fk;
alter table public.financial_entries add constraint financial_entries_maintenance_contract_fk
  foreign key (company_id,maintenance_contract_id)
  references public.maintenance_contracts(company_id,id);

create unique index if not exists ux_work_orders_contract_cycle
  on public.work_orders(company_id,maintenance_contract_id,contract_cycle)
  where maintenance_contract_id is not null and contract_cycle is not null;
create unique index if not exists ux_financial_contract_cycle
  on public.financial_entries(company_id,maintenance_contract_id,contract_cycle)
  where maintenance_contract_id is not null and contract_cycle is not null;
create index if not exists idx_financial_contract_due
  on public.financial_entries(company_id,maintenance_contract_id,due_date)
  where maintenance_contract_id is not null;

create or replace function public.zt_generate_maintenance_contract_cycle(
  p_contract uuid,
  p_cycle date,
  p_service_on date default null,
  p_due_on date default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, zt_private
as $$
declare
  v_user uuid := auth.uid();
  v_contract public.maintenance_contracts%rowtype;
  v_client public.clients%rowtype;
  v_service_on date;
  v_due_on date;
  v_wo uuid;
  v_entry uuid;
  v_number text;
  v_next_service date;
  v_next_billing date;
begin
  if v_user is null then raise exception 'Não autenticado' using errcode='28000'; end if;
  if p_cycle is null then raise exception 'Informe o ciclo do contrato' using errcode='22023'; end if;

  select * into v_contract from public.maintenance_contracts where id=p_contract for update;
  if not found then raise exception 'Contrato não encontrado' using errcode='P0002'; end if;
  if not public.zt_is_owner(v_contract.company_id) then raise exception 'Sem permissão' using errcode='42501'; end if;
  if v_contract.status <> 'active' then raise exception 'Contrato não está ativo' using errcode='23514'; end if;

  select * into v_client from public.clients
   where id=v_contract.client_id and company_id=v_contract.company_id;
  if not found then raise exception 'Cliente do contrato não encontrado' using errcode='P0002'; end if;

  -- Retry do mesmo ciclo devolve os registros existentes e não avança datas novamente.
  select id into v_wo from public.work_orders
   where company_id=v_contract.company_id and maintenance_contract_id=p_contract and contract_cycle=p_cycle;
  select id into v_entry from public.financial_entries
   where company_id=v_contract.company_id and maintenance_contract_id=p_contract and contract_cycle=p_cycle;
  if v_wo is not null or v_entry is not null then
    return jsonb_build_object('work_order_id',v_wo,'financial_entry_id',v_entry,'cycle',p_cycle,'reused',true);
  end if;

  v_service_on := coalesce(p_service_on,v_contract.next_service_on,p_cycle);
  v_due_on := coalesce(p_due_on,v_contract.next_billing_on,p_cycle);
  v_number := zt_private.zt_next_number(v_contract.company_id,'work_order','OS');

  insert into public.work_orders(
    company_id,number,client_id,assigned_to,status,scheduled_date,address,request,pre_notes,created_by,
    maintenance_contract_id,contract_cycle
  ) values(
    v_contract.company_id,v_number,v_contract.client_id,v_contract.assigned_to,'scheduled',v_service_on,v_client.address,
    'Manutenção preventiva · '||v_contract.name,v_contract.coverage,v_user,p_contract,p_cycle
  ) returning id into v_wo;

  if v_contract.amount > 0 then
    insert into public.financial_entries(
      company_id,kind,description,amount,due_date,paid,category,client_id,maintenance_contract_id,contract_cycle
    ) values(
      v_contract.company_id,'income','Contrato · '||v_contract.name,v_contract.amount,v_due_on,false,'Contratos',
      v_contract.client_id,p_contract,p_cycle
    ) returning id into v_entry;
  end if;

  v_next_service := (v_service_on + make_interval(months => v_contract.interval_months))::date;
  v_next_billing := (v_due_on + make_interval(months => v_contract.interval_months))::date;
  update public.maintenance_contracts
     set next_service_on=v_next_service,
         next_billing_on=v_next_billing,
         updated_at=now()
   where id=p_contract;

  return jsonb_build_object(
    'work_order_id',v_wo,
    'financial_entry_id',v_entry,
    'cycle',p_cycle,
    'next_service_on',v_next_service,
    'next_billing_on',v_next_billing,
    'reused',false
  );
end;
$$;
revoke all on function public.zt_generate_maintenance_contract_cycle(uuid,date,date,date) from public,anon;
grant execute on function public.zt_generate_maintenance_contract_cycle(uuid,date,date,date) to authenticated,service_role;
