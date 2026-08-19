-- ZiisTec · lançamentos financeiros manuais idempotentes
-- Impede duplicação por reenvio e não deixa o editor manual alterar lançamentos automáticos de OS/compra.

alter table public.financial_entries add column if not exists client_request_id uuid;
create unique index if not exists ux_financial_entries_company_request
  on public.financial_entries(company_id,client_request_id)
  where client_request_id is not null;

create or replace function zt_private.zt_save_manual_financial_entry(
  p_company uuid,
  p_entry uuid,
  p_request uuid,
  p_row jsonb
) returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_id uuid;
  v_client uuid;
  v_kind public.zt_entry_kind;
  v_description text;
  v_amount numeric(12,2);
  v_due date;
  v_paid boolean;
  v_paid_at date;
  v_method text;
  v_category text;
begin
  if auth.uid() is null then raise exception 'Não autenticado' using errcode='28000'; end if;
  if not public.zt_is_owner(p_company) then raise exception 'Somente o proprietário altera o financeiro' using errcode='42501'; end if;

  v_kind:=coalesce(nullif(p_row->>'kind','')::public.zt_entry_kind,'expense');
  v_description:=left(trim(coalesce(p_row->>'description','')),500);
  if v_description='' then raise exception 'Descrição obrigatória'; end if;
  v_amount:=coalesce((p_row->>'amount')::numeric,0);
  if v_amount <= 0 or v_amount > 999999999.99 then raise exception 'Valor inválido'; end if;
  v_due:=coalesce(nullif(p_row->>'due_date','')::date,current_date);
  v_paid:=coalesce((p_row->>'paid')::boolean,false);
  v_paid_at:=case when v_paid then coalesce(nullif(p_row->>'paid_at','')::date,current_date) else null end;
  v_method:=case when v_paid then nullif(left(coalesce(p_row->>'payment_method',''),100),'') else null end;
  v_category:=nullif(left(coalesce(p_row->>'category',''),120),'');
  v_client:=nullif(p_row->>'client_id','')::uuid;

  if v_client is not null and not exists(select 1 from public.clients c where c.id=v_client and c.company_id=p_company) then
    raise exception 'Cliente não pertence à empresa' using errcode='42501';
  end if;

  if p_entry is null then
    if p_request is null then raise exception 'Identificador da tentativa é obrigatório'; end if;
    perform pg_advisory_xact_lock(hashtextextended(p_company::text||':financial:'||p_request::text,0));
    select id into v_id from public.financial_entries
      where company_id=p_company and client_request_id=p_request;
    if v_id is not null then return v_id; end if;

    insert into public.financial_entries(
      company_id,kind,description,amount,due_date,paid,paid_at,payment_method,category,client_id,client_request_id
    ) values (
      p_company,v_kind,v_description,v_amount,v_due,v_paid,v_paid_at,v_method,v_category,v_client,p_request
    ) returning id into v_id;
    return v_id;
  end if;

  select id into v_id from public.financial_entries
    where id=p_entry and company_id=p_company
      and work_order_id is null and purchase_id is null
    for update;
  if v_id is null then
    raise exception 'Lançamento automático não pode ser editado como lançamento manual' using errcode='42501';
  end if;

  update public.financial_entries set
    kind=v_kind,description=v_description,amount=v_amount,due_date=v_due,
    paid=v_paid,paid_at=v_paid_at,payment_method=v_method,category=v_category,client_id=v_client
  where id=v_id;

  return v_id;
end $$;

create or replace function public.zt_save_manual_financial_entry(
  p_company uuid,p_entry uuid,p_request uuid,p_row jsonb
) returns uuid
language sql
security definer
set search_path=zt_private
as $$ select zt_private.zt_save_manual_financial_entry(p_company,p_entry,p_request,p_row); $$;

revoke all on function public.zt_save_manual_financial_entry(uuid,uuid,uuid,jsonb) from public,anon;
grant execute on function public.zt_save_manual_financial_entry(uuid,uuid,uuid,jsonb) to authenticated;
revoke all on function zt_private.zt_save_manual_financial_entry(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
