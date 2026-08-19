alter table public.financial_entries
  drop constraint if exists financial_single_origin,
  drop constraint if exists financial_origin_kind;

alter table public.financial_entries
  add constraint financial_single_origin check (not (work_order_id is not null and purchase_id is not null)),
  add constraint financial_origin_kind check (
    (work_order_id is null or kind = 'income'::public.zt_entry_kind)
    and (purchase_id is null or kind = 'expense'::public.zt_entry_kind)
  );

create or replace function public.zt_guard_financial_entry()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if current_user in ('postgres','service_role','supabase_admin') then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.work_order_id is not null or new.purchase_id is not null then
      raise exception 'Lançamentos automáticos só podem ser criados pelo fluxo oficial';
    end if;
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
before insert or update or delete on public.financial_entries
for each row execute function public.zt_guard_financial_entry();
