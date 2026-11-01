-- ZiisTec V2: conversão idempotente de orçamento aprovado em OS.
-- Um orçamento pode originar no máximo uma OS. Retry/duplo clique retorna a OS existente.

create unique index if not exists uq_work_orders_one_per_quote
  on public.work_orders(company_id, quote_id)
  where quote_id is not null;

create or replace function public.zt_create_work_order_from_quote(
  p_quote uuid,
  p_assigned_to uuid default null,
  p_scheduled_date date default null,
  p_scheduled_time time default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_quote public.quotes%rowtype;
  v_existing uuid;
  v_wo uuid;
  v_items jsonb;
  v_status public.zt_wo_status;
begin
  if v_uid is null then
    raise exception 'Não autenticado' using errcode='28000';
  end if;

  select q.*
    into v_quote
    from public.quotes q
   where q.id=p_quote
   for update;

  if not found then
    raise exception 'Orçamento não encontrado' using errcode='P0002';
  end if;

  if not public.zt_is_owner(v_quote.company_id) then
    raise exception 'Somente o proprietário pode converter orçamento em OS' using errcode='42501';
  end if;

  if v_quote.status <> 'approved' then
    raise exception 'O orçamento precisa estar aprovado antes de gerar a OS' using errcode='23514';
  end if;

  select w.id
    into v_existing
    from public.work_orders w
   where w.company_id=v_quote.company_id
     and w.quote_id=v_quote.id
   order by w.created_at
   limit 1;

  if v_existing is not null then
    return v_existing;
  end if;

  if p_scheduled_time is not null and p_scheduled_date is null then
    raise exception 'Horário exige uma data de agendamento' using errcode='22023';
  end if;

  v_status := case when p_scheduled_date is null then 'unscheduled'::public.zt_wo_status
                   else 'scheduled'::public.zt_wo_status end;

  select coalesce(jsonb_agg(jsonb_build_object(
    'kind', qi.kind::text,
    'service_id', qi.service_id,
    'product_id', qi.product_id,
    'name', qi.name,
    'unit', qi.unit,
    'quantity', qi.quantity,
    'unit_price', qi.unit_price,
    'unit_cost', qi.unit_cost,
    'notes', qi.notes,
    'is_extra', false,
    'price_pending', false
  ) order by qi.position, qi.id), '[]'::jsonb)
    into v_items
    from public.quote_items qi
   where qi.quote_id=v_quote.id
     and qi.company_id=v_quote.company_id;

  v_wo := zt_private.zt_save_work_order(
    v_quote.company_id,
    null,
    jsonb_build_object(
      'client_id', v_quote.client_id,
      'quote_id', v_quote.id,
      'assigned_to', coalesce(p_assigned_to,v_uid),
      'status', v_status::text,
      'scheduled_date', p_scheduled_date,
      'scheduled_time', p_scheduled_time,
      'address', v_quote.address,
      'service_place', v_quote.service_place,
      'request', left('Gerada a partir do orçamento '||v_quote.number,10000),
      'pre_notes', v_quote.notes,
      'extra_cost', 0,
      'needs_return', false,
      'is_warranty_visit', false
    ),
    v_items
  );

  return v_wo;
exception
  when unique_violation then
    -- Defesa adicional para concorrência extrema; o índice único é a autoridade final.
    select w.id
      into v_existing
      from public.work_orders w
     where w.quote_id=p_quote
     order by w.created_at
     limit 1;
    if v_existing is not null then return v_existing; end if;
    raise;
end;
$$;

revoke all on function public.zt_create_work_order_from_quote(uuid,uuid,date,time) from public, anon;
grant execute on function public.zt_create_work_order_from_quote(uuid,uuid,date,time) to authenticated, service_role;

comment on function public.zt_create_work_order_from_quote(uuid,uuid,date,time) is
  'Converte orçamento aprovado em uma única OS. Owner-only e idempotente por quote_id.';
