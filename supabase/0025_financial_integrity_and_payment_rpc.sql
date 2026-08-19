create or replace function public.zt_guard_financial_entry()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if current_user in ('postgres','service_role','supabase_admin') then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.work_order_id is not null or old.purchase_id is not null then
      raise exception 'Lançamentos automáticos não podem ser excluídos diretamente';
    end if;
    return old;
  end if;

  if old.work_order_id is not null or old.purchase_id is not null then
    if new.company_id is distinct from old.company_id
       or new.kind is distinct from old.kind
       or new.description is distinct from old.description
       or new.amount is distinct from old.amount
       or new.client_id is distinct from old.client_id
       or new.work_order_id is distinct from old.work_order_id
       or new.purchase_id is distinct from old.purchase_id
       or new.client_request_id is distinct from old.client_request_id then
      raise exception 'Campos estruturais de lançamentos automáticos são imutáveis';
    end if;
    if new.paid is distinct from old.paid
       or new.paid_at is distinct from old.paid_at
       or new.payment_method is distinct from old.payment_method then
      raise exception 'Use o fluxo de baixa/estorno do financeiro';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_financial_entry_guard on public.financial_entries;
create trigger trg_financial_entry_guard
before update or delete on public.financial_entries
for each row execute function public.zt_guard_financial_entry();

revoke all on function public.zt_guard_financial_entry() from public, anon, authenticated;

create or replace function public.zt_set_financial_paid(p_entry uuid, p_paid boolean, p_method text default null)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.financial_entries%rowtype;
begin
  select * into v_row from public.financial_entries where id = p_entry for update;
  if not found then raise exception 'Lançamento não encontrado'; end if;
  if not public.zt_is_owner(v_row.company_id) then raise exception 'Sem permissão'; end if;
  if p_paid and coalesce(trim(p_method),'') = '' then raise exception 'Informe a forma de pagamento'; end if;
  update public.financial_entries
     set paid = p_paid,
         paid_at = case when p_paid then current_date else null end,
         payment_method = case when p_paid then trim(p_method) else null end
   where id = p_entry;
  return p_entry;
end;
$$;

revoke all on function public.zt_set_financial_paid(uuid,boolean,text) from public, anon;
grant execute on function public.zt_set_financial_paid(uuid,boolean,text) to authenticated, service_role;
