create or replace function zt_private.zt_finalize_work_order_atomic(
  p_wo uuid,
  p_report text default null,
  p_pending text default null,
  p_extra_cost numeric default 0,
  p_due_days integer default 7,
  p_materials jsonb default '[]'::jsonb,
  p_additions jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wo public.work_orders%rowtype;
  v_uid uuid := auth.uid();
  v_is_owner boolean;
  v_assigned boolean;
  r jsonb;
  v_product uuid;
  v_qty numeric;
  v_cost numeric;
  v_price numeric;
begin
  if v_uid is null then
    raise exception 'Não autenticado' using errcode='28000';
  end if;

  select * into v_wo
    from public.work_orders
   where id = p_wo
   for update;

  if not found then
    raise exception 'Ordem de serviço não encontrada';
  end if;

  v_is_owner := zt_private.is_owner(v_wo.company_id);
  v_assigned := (v_wo.assigned_to = v_uid) and exists (
    select 1
      from public.company_members m
     where m.company_id = v_wo.company_id
       and m.user_id = v_uid
       and m.status = 'active'
  );

  if not (v_is_owner or v_assigned) then
    raise exception 'Sem permissão para finalizar esta ordem de serviço' using errcode='42501';
  end if;

  if v_wo.status = 'done' or v_wo.billing_entry_id is not null then
    return v_wo.billing_entry_id;
  end if;

  if jsonb_typeof(coalesce(p_materials,'[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_additions,'[]'::jsonb)) <> 'array' then
    raise exception 'Materiais e adicionais precisam ser listas';
  end if;

  if jsonb_array_length(coalesce(p_materials,'[]'::jsonb)) > 100
     or jsonb_array_length(coalesce(p_additions,'[]'::jsonb)) > 100 then
    raise exception 'Quantidade de itens excede o limite por atendimento';
  end if;

  for r in select value from jsonb_array_elements(coalesce(p_materials,'[]'::jsonb))
  loop
    v_product := null;
    if coalesce(r->>'product_id','') <> '' then
      begin
        v_product := (r->>'product_id')::uuid;
      exception when invalid_text_representation then
        raise exception 'Produto inválido no material';
      end;
      if not exists(select 1 from public.products p where p.id=v_product and p.company_id=v_wo.company_id) then
        raise exception 'Produto do material não pertence à empresa' using errcode='23503';
      end if;
    end if;

    v_qty := greatest(coalesce((r->>'quantity')::numeric,1),0.001);
    v_cost := case when v_is_owner then greatest(coalesce((r->>'unit_cost')::numeric,0),0) else 0 end;

    insert into public.work_order_materials(
      work_order_id, company_id, product_id, name, quantity, unit_cost, serial_number, created_by
    ) values (
      p_wo, v_wo.company_id, v_product, left(coalesce(nullif(trim(r->>'name'),''),'Material'),500),
      v_qty, v_cost, nullif(left(coalesce(r->>'serial_number',''),200),''), v_uid
    );
  end loop;

  for r in select value from jsonb_array_elements(coalesce(p_additions,'[]'::jsonb))
  loop
    v_qty := greatest(coalesce((r->>'quantity')::numeric,1),0.001);
    v_price := case when v_is_owner then greatest(coalesce((r->>'unit_price')::numeric,0),0) else 0 end;

    insert into public.work_order_items(
      work_order_id, company_id, kind, name, unit, quantity, unit_price, unit_cost,
      is_extra, price_pending, notes
    ) values (
      p_wo, v_wo.company_id, 'free', left(coalesce(nullif(trim(r->>'name'),''),'Adicional'),500),
      left(coalesce(nullif(trim(r->>'unit'),''),'unidade'),100), v_qty, v_price, 0,
      true, not v_is_owner, nullif(left(coalesce(r->>'notes',''),2000),'')
    );
  end loop;

  return zt_private.zt_complete_work_order(
    p_wo,
    p_report,
    p_pending,
    case when v_is_owner then greatest(coalesce(p_extra_cost,0),0) else v_wo.extra_cost end,
    case when v_is_owner then p_due_days else 7 end
  );
end;
$$;

create or replace function public.zt_finalize_work_order_atomic(
  p_wo uuid,
  p_report text default null,
  p_pending text default null,
  p_extra_cost numeric default 0,
  p_due_days integer default 7,
  p_materials jsonb default '[]'::jsonb,
  p_additions jsonb default '[]'::jsonb
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select zt_private.zt_finalize_work_order_atomic(
    p_wo,p_report,p_pending,p_extra_cost,p_due_days,p_materials,p_additions
  );
$$;

revoke all on function public.zt_finalize_work_order_atomic(uuid,text,text,numeric,integer,jsonb,jsonb) from public, anon;
grant execute on function public.zt_finalize_work_order_atomic(uuid,text,text,numeric,integer,jsonb,jsonb) to authenticated;
