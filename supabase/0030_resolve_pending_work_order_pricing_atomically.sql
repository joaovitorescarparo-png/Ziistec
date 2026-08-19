create or replace function public.zt_resolve_work_order_pricing(p_wo uuid, p_prices jsonb, p_due_days integer default 7)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_wo public.work_orders%rowtype;
  v_total numeric(12,2);
  v_entry uuid;
  r jsonb;
  v_item uuid;
  v_price numeric;
begin
  if auth.uid() is null then raise exception 'Não autenticado' using errcode='28000'; end if;
  select * into v_wo from public.work_orders where id=p_wo for update;
  if not found then raise exception 'Ordem de serviço não encontrada'; end if;
  if not public.zt_is_owner(v_wo.company_id) then raise exception 'Somente o proprietário pode definir os valores'; end if;
  if v_wo.status <> 'done' then raise exception 'A OS ainda não foi concluída'; end if;
  if v_wo.billing_entry_id is not null then return v_wo.billing_entry_id; end if;
  if not v_wo.pending_pricing then raise exception 'A OS não está aguardando precificação'; end if;

  if jsonb_typeof(coalesce(p_prices,'[]'::jsonb)) <> 'array' then raise exception 'Lista de valores inválida'; end if;

  for r in select value from jsonb_array_elements(coalesce(p_prices,'[]'::jsonb))
  loop
    begin v_item := (r->>'id')::uuid; exception when others then raise exception 'Item de precificação inválido'; end;
    v_price := coalesce((r->>'price')::numeric,0);
    if v_price < 0 then raise exception 'Valor não pode ser negativo'; end if;
    update public.work_order_items
       set unit_price=v_price, price_pending=false
     where id=v_item and work_order_id=p_wo and company_id=v_wo.company_id and price_pending=true;
    if not found then raise exception 'Item pendente não pertence a esta OS'; end if;
  end loop;

  if exists(select 1 from public.work_order_items where work_order_id=p_wo and price_pending) then
    raise exception 'Ainda existem itens aguardando valor';
  end if;

  p_due_days := greatest(0,least(coalesce(p_due_days,7),365));
  select coalesce(sum(quantity*unit_price),0) into v_total from public.work_order_items where work_order_id=p_wo;

  if v_wo.is_warranty_visit or v_total <= 0 then
    update public.work_orders set pending_pricing=false,updated_at=now() where id=p_wo;
    insert into public.work_order_reports(work_order_id,company_id,entry_type,body,author_id)
    values(p_wo,v_wo.company_id,'history','Precificação concluída sem geração de cobrança',auth.uid());
    return null;
  end if;

  insert into public.financial_entries(company_id,kind,description,amount,due_date,client_id,work_order_id,category)
  values(v_wo.company_id,'income',left(v_wo.number||' · atendimento',500),v_total,current_date+p_due_days,v_wo.client_id,p_wo,'Serviços')
  on conflict (work_order_id) where work_order_id is not null do nothing
  returning id into v_entry;
  if v_entry is null then select id into v_entry from public.financial_entries where work_order_id=p_wo; end if;

  update public.work_orders set billing_entry_id=v_entry,pending_pricing=false,updated_at=now() where id=p_wo;
  insert into public.work_order_reports(work_order_id,company_id,entry_type,body,author_id)
  values(p_wo,v_wo.company_id,'history','Valores adicionais definidos e cobrança liberada',auth.uid());
  return v_entry;
end;
$$;

revoke all on function public.zt_resolve_work_order_pricing(uuid,jsonb,integer) from public,anon;
grant execute on function public.zt_resolve_work_order_pricing(uuid,jsonb,integer) to authenticated,service_role;
