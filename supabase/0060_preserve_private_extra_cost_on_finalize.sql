-- ZiisTec V2: preserva custo extra privado durante a finalização da OS.
-- Depende de 0054 (work_order_private_costs).
--
-- Regras:
--   * técnico nunca cria/altera/zera custo extra privado, mesmo via RPC SECURITY DEFINER;
--   * owner com p_extra_cost NULL preserva o custo já registrado;
--   * owner com p_extra_cost = 0 zera explicitamente;
--   * owner com valor > 0 atualiza explicitamente;
--   * a coluna pública work_orders.extra_cost permanece sempre 0.

-- Defesa em profundidade: o schema privado continua completamente fechado para
-- clientes. Wrappers públicos SECURITY DEFINER executam como o owner da função e não
-- dependem de USAGE/EXECUTE concedido a authenticated no schema privado.
revoke usage, create on schema zt_private from public, anon, authenticated;
revoke execute on all functions in schema zt_private from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Trigger de custo extra: além de bloquear escrita direta authenticated, também usa
-- auth.uid() para distinguir owner de técnico dentro de uma RPC SECURITY DEFINER.
create or replace function zt_private.capture_work_order_extra_cost()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_is_owner boolean := false;
begin
  if coalesce(new.extra_cost,0) < 0 then
    raise exception 'Custo extra inválido' using errcode='22023';
  end if;

  -- Escrita direta pela Data API nunca grava custo privado.
  if current_user = 'authenticated' then
    if coalesce(new.extra_cost,0) <> 0 then
      raise exception 'Custo interno não pode ser gravado diretamente na OS' using errcode='42501';
    end if;
    new.extra_cost := 0;
    return new;
  end if;

  -- Em uma RPC SECURITY DEFINER, current_user é privilegiado, mas auth.uid() continua
  -- sendo o usuário real. Um técnico jamais pode modificar o ledger privado.
  if v_uid is not null then
    v_is_owner := zt_private.is_owner(new.company_id);
    if not v_is_owner then
      new.extra_cost := 0;
      if tg_op = 'INSERT' then
        insert into public.work_order_private_costs(work_order_id, company_id, extra_cost)
        values(new.id, new.company_id, 0)
        on conflict (work_order_id) do nothing;
      end if;
      return new;
    end if;
  end if;

  -- Owner autenticado via RPC, service_role ou migration administrativa.
  insert into public.work_order_private_costs(work_order_id, company_id, extra_cost)
  values(new.id, new.company_id, greatest(coalesce(new.extra_cost,0),0))
  on conflict (work_order_id) do update
    set company_id=excluded.company_id,
        extra_cost=excluded.extra_cost,
        updated_at=now();

  new.extra_cost := 0;
  return new;
end;
$$;

revoke all on function zt_private.capture_work_order_extra_cost() from public, anon, authenticated;
grant execute on function zt_private.capture_work_order_extra_cost() to service_role;

-- -----------------------------------------------------------------------------
-- Finalização central. NULL significa "não altere o custo privado existente".
create or replace function zt_private.zt_complete_work_order(
  p_wo uuid,
  p_report text default null,
  p_pending text default null,
  p_extra_cost numeric default null,
  p_due_days integer default 7
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wo public.work_orders%rowtype;
  v_total numeric(12,2);
  v_entry uuid;
  v_uid uuid := auth.uid();
  v_is_owner boolean;
  v_assigned boolean;
  v_pendente boolean;
  v_existing_extra numeric(12,2) := 0;
  v_effective_extra numeric(12,2) := 0;
  r record;
begin
  if v_uid is null then
    raise exception 'Não autenticado' using errcode='28000';
  end if;

  select * into v_wo
    from public.work_orders
   where id=p_wo
   for update;
  if v_wo.id is null then
    raise exception 'Ordem de serviço não encontrada' using errcode='42501';
  end if;

  v_is_owner := zt_private.is_owner(v_wo.company_id);
  v_assigned := (v_wo.assigned_to=v_uid) and exists (
    select 1 from public.company_members m
     where m.company_id=v_wo.company_id
       and m.user_id=v_uid
       and m.status='active'
  );
  if not (v_is_owner or v_assigned) then
    raise exception 'Sem permissão para finalizar esta ordem de serviço' using errcode='42501';
  end if;

  if exists (
    select 1 from public.subscriptions s
     where s.company_id=v_wo.company_id
       and s.status in ('suspended','canceled','past_due')
  ) then
    raise exception 'Assinatura inativa' using errcode='42501';
  end if;

  if v_wo.status='done' or v_wo.billing_entry_id is not null then
    return v_wo.billing_entry_id;
  end if;

  select c.extra_cost into v_existing_extra
    from public.work_order_private_costs c
   where c.work_order_id=p_wo
     and c.company_id=v_wo.company_id;
  v_existing_extra := coalesce(v_existing_extra,0);

  if v_is_owner then
    v_effective_extra := case
      when p_extra_cost is null then v_existing_extra
      else greatest(p_extra_cost,0)
    end;
  else
    -- Qualquer valor enviado pelo técnico é deliberadamente ignorado.
    v_effective_extra := v_existing_extra;
    p_due_days := 7;
  end if;

  p_due_days := greatest(0,least(coalesce(p_due_days,7),365));
  if p_report is not null and length(p_report)>10000 then raise exception 'Relato muito longo'; end if;
  if p_pending is not null and length(p_pending)>5000 then raise exception 'Pendência muito longa'; end if;

  select coalesce(sum(i.quantity*i.unit_price),0)
    into v_total
    from public.work_order_items i
   where i.work_order_id=p_wo;

  select exists(
    select 1 from public.work_order_items i
     where i.work_order_id=p_wo and i.price_pending
  ) into v_pendente;

  update public.work_orders
     set status='done',
         completed_at=now(),
         pending_note=coalesce(p_pending,pending_note),
         extra_cost=v_effective_extra,
         updated_at=now()
   where id=p_wo;

  if p_report is not null and length(trim(p_report))>0 then
    insert into public.work_order_reports(work_order_id,company_id,entry_type,body,author_id)
    values(p_wo,v_wo.company_id,'report',p_report,v_uid);
  end if;

  insert into public.work_order_reports(work_order_id,company_id,entry_type,body,author_id)
  values(p_wo,v_wo.company_id,'history','Serviço concluído',v_uid);

  for r in
    select i.service_id,i.product_id,i.name,s.warranty_days,p.warranty_months
      from public.work_order_items i
      left join public.services s on s.id=i.service_id
      left join public.products p on p.id=i.product_id
     where i.work_order_id=p_wo
  loop
    if r.service_id is not null and coalesce(r.warranty_days,0)>0 then
      insert into public.warranties(
        company_id,client_id,work_order_id,kind,service_id,
        description,service_place,starts_on,ends_on
      ) values(
        v_wo.company_id,v_wo.client_id,p_wo,'service',r.service_id,
        left(r.name,500),v_wo.service_place,current_date,
        current_date+least(r.warranty_days,3650)
      );
    end if;

    if r.product_id is not null and coalesce(r.warranty_months,0)>0 then
      insert into public.warranties(
        company_id,client_id,work_order_id,kind,product_id,
        description,service_place,starts_on,ends_on
      ) values(
        v_wo.company_id,v_wo.client_id,p_wo,'product',r.product_id,
        left(r.name,500),v_wo.service_place,current_date,
        (current_date+(least(r.warranty_months,120)||' months')::interval)::date
      );
    end if;
  end loop;

  update public.work_orders
     set pending_pricing=v_pendente
   where id=p_wo;

  if v_pendente then
    insert into public.work_order_reports(work_order_id,company_id,entry_type,body,author_id)
    values(
      p_wo,v_wo.company_id,'history',
      'Execução concluída. Há adicional aguardando precificação do proprietário — cobrança não gerada.',
      v_uid
    );
    return null;
  end if;

  if v_total>0 and not v_wo.is_warranty_visit then
    insert into public.financial_entries(
      company_id,kind,description,amount,due_date,
      client_id,work_order_id,category
    ) values(
      v_wo.company_id,'income',left(v_wo.number||' · atendimento',500),v_total,
      current_date+p_due_days,v_wo.client_id,p_wo,'Serviços'
    )
    on conflict (work_order_id) where work_order_id is not null do nothing
    returning id into v_entry;

    if v_entry is null then
      select f.id into v_entry
        from public.financial_entries f
       where f.work_order_id=p_wo;
    end if;

    update public.work_orders
       set billing_entry_id=v_entry
     where id=p_wo;

    insert into public.work_order_reports(work_order_id,company_id,entry_type,body,author_id)
    values(p_wo,v_wo.company_id,'history','Cobrança gerada em contas a receber',v_uid);
  end if;

  return v_entry;
end;
$$;

revoke all on function zt_private.zt_complete_work_order(uuid,text,text,numeric,integer)
  from public, anon, authenticated;
grant execute on function zt_private.zt_complete_work_order(uuid,text,text,numeric,integer)
  to service_role;

-- Wrapper legado é service-only; preservamos essa superfície.
create or replace function public.zt_complete_work_order(
  p_wo uuid,
  p_report text default null,
  p_pending text default null,
  p_extra_cost numeric default null,
  p_due_days integer default 7
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select zt_private.zt_complete_work_order(p_wo,p_report,p_pending,p_extra_cost,p_due_days);
$$;
revoke all on function public.zt_complete_work_order(uuid,text,text,numeric,integer)
  from public, anon, authenticated;
grant execute on function public.zt_complete_work_order(uuid,text,text,numeric,integer)
  to service_role;

-- -----------------------------------------------------------------------------
-- Finalização atômica usada pelo app. O papel real é novamente validado dentro de
-- zt_complete_work_order; técnico não consegue influenciar custo nem vencimento.
create or replace function zt_private.zt_finalize_work_order_atomic(
  p_wo uuid,
  p_report text default null,
  p_pending text default null,
  p_extra_cost numeric default null,
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
   where id=p_wo
   for update;
  if not found then raise exception 'Ordem de serviço não encontrada'; end if;

  v_is_owner := zt_private.is_owner(v_wo.company_id);
  v_assigned := (v_wo.assigned_to=v_uid) and exists (
    select 1 from public.company_members m
     where m.company_id=v_wo.company_id
       and m.user_id=v_uid
       and m.status='active'
  );
  if not (v_is_owner or v_assigned) then
    raise exception 'Sem permissão para finalizar esta ordem de serviço' using errcode='42501';
  end if;

  if v_wo.status='done' or v_wo.billing_entry_id is not null then
    return v_wo.billing_entry_id;
  end if;

  if jsonb_typeof(coalesce(p_materials,'[]'::jsonb))<>'array'
     or jsonb_typeof(coalesce(p_additions,'[]'::jsonb))<>'array' then
    raise exception 'Materiais e adicionais precisam ser listas';
  end if;
  if jsonb_array_length(coalesce(p_materials,'[]'::jsonb))>100
     or jsonb_array_length(coalesce(p_additions,'[]'::jsonb))>100 then
    raise exception 'Quantidade de itens excede o limite por atendimento';
  end if;

  for r in select value from jsonb_array_elements(coalesce(p_materials,'[]'::jsonb)) loop
    v_product := null;
    if coalesce(r->>'product_id','')<>'' then
      begin
        v_product := (r->>'product_id')::uuid;
      exception when invalid_text_representation then
        raise exception 'Produto inválido no material';
      end;
      if not exists(
        select 1 from public.products p
         where p.id=v_product and p.company_id=v_wo.company_id
      ) then
        raise exception 'Produto do material não pertence à empresa' using errcode='23503';
      end if;
    end if;

    v_qty := greatest(coalesce((r->>'quantity')::numeric,1),0.001);
    v_cost := case when v_is_owner then greatest(coalesce((r->>'unit_cost')::numeric,0),0) else 0 end;

    insert into public.work_order_materials(
      work_order_id,company_id,product_id,name,quantity,unit_cost,serial_number,created_by
    ) values(
      p_wo,v_wo.company_id,v_product,left(coalesce(nullif(trim(r->>'name'),''),'Material'),500),
      v_qty,v_cost,nullif(left(coalesce(r->>'serial_number',''),200),''),v_uid
    );
  end loop;

  for r in select value from jsonb_array_elements(coalesce(p_additions,'[]'::jsonb)) loop
    v_qty := greatest(coalesce((r->>'quantity')::numeric,1),0.001);
    v_price := case when v_is_owner then greatest(coalesce((r->>'unit_price')::numeric,0),0) else 0 end;

    insert into public.work_order_items(
      work_order_id,company_id,kind,name,unit,quantity,unit_price,unit_cost,
      is_extra,price_pending,notes
    ) values(
      p_wo,v_wo.company_id,'free',left(coalesce(nullif(trim(r->>'name'),''),'Adicional'),500),
      left(coalesce(nullif(trim(r->>'unit'),''),'unidade'),100),v_qty,v_price,0,
      true,not v_is_owner,nullif(left(coalesce(r->>'notes',''),2000),'')
    );
  end loop;

  return zt_private.zt_complete_work_order(
    p_wo,p_report,p_pending,p_extra_cost,p_due_days
  );
end;
$$;

revoke all on function zt_private.zt_finalize_work_order_atomic(uuid,text,text,numeric,integer,jsonb,jsonb)
  from public, anon, authenticated;
grant execute on function zt_private.zt_finalize_work_order_atomic(uuid,text,text,numeric,integer,jsonb,jsonb)
  to service_role;

create or replace function public.zt_finalize_work_order_atomic(
  p_wo uuid,
  p_report text default null,
  p_pending text default null,
  p_extra_cost numeric default null,
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
revoke all on function public.zt_finalize_work_order_atomic(uuid,text,text,numeric,integer,jsonb,jsonb)
  from public, anon;
grant execute on function public.zt_finalize_work_order_atomic(uuid,text,text,numeric,integer,jsonb,jsonb)
  to authenticated, service_role;

comment on function public.zt_finalize_work_order_atomic(uuid,text,text,numeric,integer,jsonb,jsonb) is
  'Finaliza OS de forma atômica. Técnico nunca altera custo extra privado; NULL preserva custo existente do owner.';
