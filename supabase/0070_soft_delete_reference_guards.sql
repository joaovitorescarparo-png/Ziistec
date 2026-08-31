-- ZiisTec · 0070 — soft delete sem quebrar histórico
--
-- Regras:
-- * registros arquivados continuam legíveis conforme as RLS existentes;
-- * novos documentos/vínculos não podem apontar para cliente/serviço/produto/orçamento arquivado;
-- * regravação interna de um documento criado ANTES do arquivamento pode preservar
--   um item histórico já representado pelo snapshot do documento;
-- * Data API direta nunca pode criar um novo vínculo para catálogo arquivado;
-- * deleted_at continua protegido pelo guard owner-only da 0066.

create or replace function zt_private.zt_reference_deleted_at(
  p_kind text,
  p_company uuid,
  p_id uuid
)
returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_deleted timestamptz;
begin
  if p_id is null then return null; end if;

  case p_kind
    when 'client' then
      select c.deleted_at into v_deleted
      from public.clients c
      where c.id=p_id and c.company_id=p_company;
    when 'service' then
      select s.deleted_at into v_deleted
      from public.services s
      where s.id=p_id and s.company_id=p_company;
    when 'product' then
      select p.deleted_at into v_deleted
      from public.products p
      where p.id=p_id and p.company_id=p_company;
    when 'quote' then
      select q.deleted_at into v_deleted
      from public.quotes q
      where q.id=p_id and q.company_id=p_company;
    else
      raise exception 'Tipo de referência inválido' using errcode='22023';
  end case;

  if not found then
    raise exception 'Referência não pertence à empresa' using errcode='23503';
  end if;

  return v_deleted;
end;
$$;

revoke all on function zt_private.zt_reference_deleted_at(text,uuid,uuid) from public, anon, authenticated;

create or replace function zt_private.zt_assert_unarchived_reference(
  p_kind text,
  p_company uuid,
  p_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_id is null then return; end if;
  if zt_private.zt_reference_deleted_at(p_kind,p_company,p_id) is not null then
    raise exception 'Registro arquivado não pode ser usado em novo documento'
      using errcode='23514';
  end if;
end;
$$;

revoke all on function zt_private.zt_assert_unarchived_reference(text,uuid,uuid) from public, anon, authenticated;

-- Guarda referências no cabeçalho dos documentos. Em UPDATE, uma referência histórica
-- que não mudou é preservada; trocar para um registro arquivado é bloqueado.
create or replace function zt_private.zt_guard_unarchived_document_references()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_new jsonb := to_jsonb(new);
  v_old jsonb := case when tg_op='UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  v_company uuid := nullif(v_new->>'company_id','')::uuid;
  v_ref uuid;
  v_old_ref uuid;
begin
  if v_company is null then return new; end if;

  if v_new ? 'client_id' then
    v_ref := nullif(v_new->>'client_id','')::uuid;
    v_old_ref := nullif(v_old->>'client_id','')::uuid;
    if v_ref is not null and (tg_op='INSERT' or v_ref is distinct from v_old_ref) then
      perform zt_private.zt_assert_unarchived_reference('client',v_company,v_ref);
    end if;
  end if;

  if v_new ? 'quote_id' then
    v_ref := nullif(v_new->>'quote_id','')::uuid;
    v_old_ref := nullif(v_old->>'quote_id','')::uuid;
    if v_ref is not null and (tg_op='INSERT' or v_ref is distinct from v_old_ref) then
      perform zt_private.zt_assert_unarchived_reference('quote',v_company,v_ref);
    end if;
  end if;

  if v_new ? 'service_id' then
    v_ref := nullif(v_new->>'service_id','')::uuid;
    v_old_ref := nullif(v_old->>'service_id','')::uuid;
    if v_ref is not null and (tg_op='INSERT' or v_ref is distinct from v_old_ref) then
      perform zt_private.zt_assert_unarchived_reference('service',v_company,v_ref);
    end if;
  end if;

  if v_new ? 'product_id' then
    v_ref := nullif(v_new->>'product_id','')::uuid;
    v_old_ref := nullif(v_old->>'product_id','')::uuid;
    if v_ref is not null and (tg_op='INSERT' or v_ref is distinct from v_old_ref) then
      perform zt_private.zt_assert_unarchived_reference('product',v_company,v_ref);
    end if;
  end if;

  return new;
end;
$$;

revoke all on function zt_private.zt_guard_unarchived_document_references() from public, anon, authenticated;

-- Itens são regravados por algumas RPCs legadas. Para não quebrar histórico, uma
-- regravação privilegiada de documento criado antes do arquivamento pode manter o
-- snapshot antigo. INSERT direto via authenticated continua fail-closed.
create or replace function zt_private.zt_guard_unarchived_catalog_item_references()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_new jsonb := to_jsonb(new);
  v_old jsonb := case when tg_op='UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  v_company uuid := nullif(v_new->>'company_id','')::uuid;
  v_parent uuid;
  v_parent_created timestamptz;
  v_parent_deleted timestamptz;
  v_ref uuid;
  v_old_ref uuid;
  v_deleted timestamptz;
begin
  if v_company is null then return new; end if;

  if tg_table_name='quote_items' then
    v_parent := nullif(v_new->>'quote_id','')::uuid;
    select q.created_at,q.deleted_at into v_parent_created,v_parent_deleted
    from public.quotes q where q.id=v_parent and q.company_id=v_company;
  elsif tg_table_name='work_order_items' then
    v_parent := nullif(v_new->>'work_order_id','')::uuid;
    select w.created_at,w.deleted_at into v_parent_created,v_parent_deleted
    from public.work_orders w where w.id=v_parent and w.company_id=v_company;
  elsif tg_table_name='purchase_items' then
    v_parent := nullif(v_new->>'purchase_id','')::uuid;
    select p.created_at,p.deleted_at into v_parent_created,v_parent_deleted
    from public.purchases p where p.id=v_parent and p.company_id=v_company;
  else
    return new;
  end if;

  if v_parent is null or v_parent_created is null then
    raise exception 'Documento pai inválido' using errcode='23503';
  end if;
  if v_parent_deleted is not null then
    raise exception 'Documento arquivado não aceita novos vínculos' using errcode='23514';
  end if;

  if v_new ? 'service_id' then
    v_ref := nullif(v_new->>'service_id','')::uuid;
    v_old_ref := nullif(v_old->>'service_id','')::uuid;
    if v_ref is not null and (tg_op='INSERT' or v_ref is distinct from v_old_ref) then
      v_deleted := zt_private.zt_reference_deleted_at('service',v_company,v_ref);
      if v_deleted is not null
         and (current_user='authenticated' or v_parent_created >= v_deleted) then
        raise exception 'Serviço arquivado não pode ser usado em novo vínculo' using errcode='23514';
      end if;
    end if;
  end if;

  if v_new ? 'product_id' then
    v_ref := nullif(v_new->>'product_id','')::uuid;
    v_old_ref := nullif(v_old->>'product_id','')::uuid;
    if v_ref is not null and (tg_op='INSERT' or v_ref is distinct from v_old_ref) then
      v_deleted := zt_private.zt_reference_deleted_at('product',v_company,v_ref);
      if v_deleted is not null
         and (current_user='authenticated' or v_parent_created >= v_deleted) then
        raise exception 'Produto arquivado não pode ser usado em novo vínculo' using errcode='23514';
      end if;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function zt_private.zt_guard_unarchived_catalog_item_references() from public, anon, authenticated;

-- Cabeçalhos que podem receber referências de cadastro.
do $$
declare t text;
begin
  foreach t in array array['quotes','work_orders','financial_entries','warranties','maintenance_contracts'] loop
    execute format('drop trigger if exists trg_%I_unarchived_refs on public.%I',t,t);
    execute format(
      'create trigger trg_%I_unarchived_refs before insert or update on public.%I for each row execute function zt_private.zt_guard_unarchived_document_references()',
      t,t
    );
  end loop;
end $$;

-- Linhas de catálogo dos documentos.
do $$
declare t text;
begin
  foreach t in array array['quote_items','work_order_items','purchase_items'] loop
    execute format('drop trigger if exists trg_%I_unarchived_refs on public.%I',t,t);
    execute format(
      'create trigger trg_%I_unarchived_refs before insert or update on public.%I for each row execute function zt_private.zt_guard_unarchived_catalog_item_references()',
      t,t
    );
  end loop;
end $$;

-- Catálogo do técnico não oferece produto arquivado.
create or replace function public.zt_technician_catalog(p_company uuid)
returns table(id uuid, name text, brand text, model text, description text, unit text, price numeric, warranty_months integer, image_path text, stock_qty numeric, track_stock boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Não autenticado' using errcode='28000'; end if;
  if not exists (
    select 1 from public.company_members m
    where m.company_id=p_company and m.user_id=auth.uid() and m.status='active'
  ) then
    raise exception 'Sem permissão' using errcode='42501';
  end if;

  return query
  select p.id,p.name,p.brand,p.model,p.description,p.unit,p.price,p.warranty_months,
         p.image_path,p.stock_qty,p.track_stock
  from public.products p
  where p.company_id=p_company
    and p.active=true
    and p.sale_enabled=true
    and p.deleted_at is null
  order by p.name;
end;
$$;

revoke all on function public.zt_technician_catalog(uuid) from public, anon;
grant execute on function public.zt_technician_catalog(uuid) to authenticated, service_role;

-- Venda em OS é uma nova operação: produto arquivado nunca pode entrar, mesmo em OS antiga.
create or replace function public.zt_sell_product_on_work_order(p_wo uuid, p_product uuid, p_quantity numeric, p_notes text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_company uuid;
  v_assigned uuid;
  v_status public.zt_wo_status;
  v_is_owner boolean;
  v_product public.products%rowtype;
  v_item uuid;
begin
  if v_user is null then raise exception 'Não autenticado' using errcode='28000'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Quantidade inválida' using errcode='22023'; end if;

  select company_id,assigned_to,status into v_company,v_assigned,v_status
  from public.work_orders where id=p_wo and deleted_at is null for update;
  if not found then raise exception 'OS não encontrada' using errcode='P0002'; end if;
  if v_status in ('done','canceled') then raise exception 'A OS precisa estar aberta para vender produto' using errcode='23514'; end if;

  v_is_owner := public.zt_is_owner(v_company);
  if not v_is_owner then
    if v_assigned is distinct from v_user or not exists (
      select 1 from public.company_members m
      where m.company_id=v_company and m.user_id=v_user and m.role='technician' and m.status='active'
    ) then
      raise exception 'Sem permissão para esta OS' using errcode='42501';
    end if;
  end if;

  select * into v_product from public.products
  where id=p_product and company_id=v_company and active=true and sale_enabled=true and deleted_at is null
  for update;
  if not found then raise exception 'Produto indisponível para venda' using errcode='P0002'; end if;

  if v_product.track_stock and v_product.stock_qty < p_quantity then
    raise exception 'Estoque insuficiente: disponível %',v_product.stock_qty using errcode='23514';
  end if;

  insert into public.work_order_items(
    work_order_id,company_id,kind,product_id,name,unit,quantity,unit_price,unit_cost,is_extra,price_pending,notes
  ) values(
    p_wo,v_company,'product',v_product.id,v_product.name,v_product.unit,p_quantity,v_product.price,v_product.cost,true,false,left(nullif(trim(p_notes),''),1000)
  ) returning id into v_item;

  if v_product.track_stock then
    update public.products set stock_qty=stock_qty-p_quantity where id=v_product.id;
    insert into public.inventory_movements(company_id,product_id,kind,quantity_delta,unit_cost,work_order_id,notes,created_by)
    values(v_company,v_product.id,'sale',-p_quantity,v_product.cost,p_wo,left(nullif(trim(p_notes),''),1000),v_user);
  end if;

  return v_item;
end;
$$;

revoke all on function public.zt_sell_product_on_work_order(uuid,uuid,numeric,text) from public, anon;
grant execute on function public.zt_sell_product_on_work_order(uuid,uuid,numeric,text) to authenticated, service_role;

-- Ajuste de estoque também é operação nova sobre catálogo e não deve reativar produto arquivado.
create or replace function public.zt_adjust_product_stock(p_company uuid, p_product uuid, p_delta numeric, p_notes text default null)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current numeric;
  v_next numeric;
begin
  if auth.uid() is null then raise exception 'Não autenticado' using errcode='28000'; end if;
  if not public.zt_is_owner(p_company) then raise exception 'Sem permissão' using errcode='42501'; end if;
  if p_delta is null or p_delta = 0 then raise exception 'Ajuste deve ser diferente de zero' using errcode='22023'; end if;

  select stock_qty into v_current
  from public.products
  where id=p_product and company_id=p_company and deleted_at is null
  for update;
  if not found then raise exception 'Produto não encontrado' using errcode='P0002'; end if;

  v_next := v_current + p_delta;
  if v_next < 0 then raise exception 'Estoque insuficiente' using errcode='23514'; end if;

  update public.products set stock_qty=v_next, track_stock=true where id=p_product and company_id=p_company;
  insert into public.inventory_movements(company_id,product_id,kind,quantity_delta,notes,created_by)
  values(p_company,p_product,'adjustment',p_delta,left(nullif(trim(p_notes),''),1000),auth.uid());
  return v_next;
end;
$$;

revoke all on function public.zt_adjust_product_stock(uuid,uuid,numeric,text) from public, anon;
grant execute on function public.zt_adjust_product_stock(uuid,uuid,numeric,text) to authenticated, service_role;

notify pgrst, 'reload schema';
