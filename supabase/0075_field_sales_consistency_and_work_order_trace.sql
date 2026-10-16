-- ZiisTec V2 — venda em campo: contrato de recebimento, Pix dinâmico e rastreio em OS.
-- Mantém histórico derivado das relações existentes; não cria tabela paralela de CRM/histórico.

-- -------------------------------------------------------- recebimentos da empresa
alter table public.companies
  add column if not exists pix_receiver_name text,
  add column if not exists pix_receiver_city text,
  add column if not exists field_sales_allow_transfer boolean not null default false,
  add column if not exists field_sales_allow_other boolean not null default false;

alter table public.companies
  drop constraint if exists companies_field_sales_pix_receiver_bounds_ck;
alter table public.companies
  add constraint companies_field_sales_pix_receiver_bounds_ck check (
    (pix_key is null or char_length(pix_key) between 1 and 140)
    and (pix_receiver_name is null or char_length(pix_receiver_name) between 1 and 25)
    and (pix_receiver_city is null or char_length(pix_receiver_city) between 1 and 15)
  );

-- -------------------------------------------------------- livro de eventos de venda
alter table public.field_sales
  add column if not exists origin text not null default 'quick',
  add column if not exists work_order_id uuid,
  add column if not exists work_order_item_id uuid;

-- Migra somente o contrato persistido desta tabela. Entradas financeiras ligadas a ela
-- recebem o mesmo valor canônico para evitar Pix/PIX/pix etc.
update public.field_sales
set payment_method = case lower(trim(payment_method))
  when 'pix' then 'pix'
  when 'dinheiro' then 'cash'
  when 'cash' then 'cash'
  when 'cartão' then 'card'
  when 'cartao' then 'card'
  when 'card' then 'card'
  when 'crédito' then 'card'
  when 'credito' then 'card'
  when 'débito' then 'card'
  when 'debito' then 'card'
  when 'transferência' then 'transfer'
  when 'transferencia' then 'transfer'
  when 'transfer' then 'transfer'
  when 'outro' then 'other'
  when 'other' then 'other'
  else 'other'
end;

-- O guard de assinatura é obrigatório no runtime, mas uma migration privilegiada não
-- possui auth.uid(). Suspende somente este trigger durante o backfill e reativa logo após.
alter table public.financial_entries disable trigger trg_subscription_write_guard;
update public.financial_entries f
set payment_method = s.payment_method
from public.field_sales s
where s.financial_entry_id=f.id
  and f.payment_method is distinct from s.payment_method;
alter table public.financial_entries enable trigger trg_subscription_write_guard;

alter table public.field_sales alter column payment_method drop not null;

alter table public.field_sales drop constraint if exists field_sales_payment_method_check;
alter table public.field_sales drop constraint if exists field_sales_origin_ck;
alter table public.field_sales drop constraint if exists field_sales_origin_consistency_ck;

alter table public.field_sales
  add constraint field_sales_payment_method_check check (
    payment_method is null or payment_method in ('pix','cash','card','transfer','other')
  ),
  add constraint field_sales_origin_ck check (origin in ('quick','work_order')),
  add constraint field_sales_origin_consistency_ck check (
    (
      origin='quick'
      and payment_method is not null
      and financial_entry_id is not null
      and work_order_id is null
      and work_order_item_id is null
    )
    or
    (
      origin='work_order'
      and payment_method is null
      and financial_entry_id is null
      and work_order_id is not null
      and work_order_item_id is not null
    )
  );

alter table public.field_sales drop constraint if exists field_sales_work_order_company_fk;
alter table public.field_sales
  add constraint field_sales_work_order_company_fk
  foreign key (work_order_id,company_id)
  references public.work_orders(id,company_id)
  on delete restrict;

create unique index if not exists work_order_items_id_wo_company_uidx
  on public.work_order_items(id,work_order_id,company_id);

alter table public.field_sales drop constraint if exists field_sales_work_order_item_context_fk;
alter table public.field_sales
  add constraint field_sales_work_order_item_context_fk
  foreign key (work_order_item_id,work_order_id,company_id)
  references public.work_order_items(id,work_order_id,company_id)
  on delete restrict;

create index if not exists idx_field_sales_company_client_created
  on public.field_sales(company_id,client_id,created_at desc)
  where client_id is not null;
create index if not exists idx_field_sales_company_work_order_created
  on public.field_sales(company_id,work_order_id,created_at desc)
  where work_order_id is not null;
create index if not exists idx_field_sales_company_sold_by_created
  on public.field_sales(company_id,sold_by,created_at desc);

-- -------------------------------------------------------- método canônico
create or replace function public.zt_normalize_field_sale_payment_method(p_method text)
returns text
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v text := lower(trim(coalesce(p_method,'')));
begin
  case v
    when 'pix' then return 'pix';
    when 'cash' then return 'cash';
    when 'dinheiro' then return 'cash';
    when 'card' then return 'card';
    when 'cartao' then return 'card';
    when 'cartão' then return 'card';
    when 'credito' then return 'card';
    when 'crédito' then return 'card';
    when 'debito' then return 'card';
    when 'débito' then return 'card';
    when 'transfer' then return 'transfer';
    when 'transferencia' then return 'transfer';
    when 'transferência' then return 'transfer';
    when 'other' then return 'other';
    when 'outro' then return 'other';
    else raise exception 'Forma de recebimento inválida' using errcode='22023';
  end case;
end;
$$;
revoke all on function public.zt_normalize_field_sale_payment_method(text) from public,anon;
grant execute on function public.zt_normalize_field_sale_payment_method(text) to authenticated,service_role;

-- -------------------------------------------------------- contextos seguros do técnico
-- Retorna somente cliente/local de OS aberta que o usuário pode usar para contexto de
-- venda rápida. O técnico nunca recebe a carteira geral de clientes por esta função.
create or replace function public.zt_field_sale_client_contexts(p_company uuid)
returns table(
  client_id uuid,
  client_name text,
  work_order_id uuid,
  work_order_number text,
  service_place text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    c.id,
    c.name,
    w.id,
    w.number,
    left(coalesce(nullif(trim(w.service_place),''),nullif(trim(w.address),''),''),500)
  from public.work_orders w
  join public.clients c on c.id=w.client_id and c.company_id=w.company_id
  where w.company_id=p_company
    and w.deleted_at is null
    and c.deleted_at is null
    and w.status not in ('done','canceled')
    and (
      public.zt_is_owner(p_company)
      or (
        w.assigned_to=(select auth.uid())
        and exists(
          select 1 from public.company_members m
          where m.company_id=p_company
            and m.user_id=(select auth.uid())
            and m.role='technician'
            and m.status='active'
        )
      )
    )
  order by w.scheduled_date nulls last,w.created_at desc,w.number;
$$;
revoke all on function public.zt_field_sale_client_contexts(uuid) from public,anon;
grant execute on function public.zt_field_sale_client_contexts(uuid) to authenticated,service_role;

-- -------------------------------------------------------- venda rápida confirmada
-- A aplicação mantém a intenção local até o técnico confirmar o recebimento. Esta RPC
-- é o único ponto que cria venda + financeiro pago + baixa de estoque.
create or replace function public.zt_sell_product_direct(
  p_company uuid,
  p_product uuid,
  p_quantity numeric,
  p_payment_method text,
  p_notes text,
  p_request uuid,
  p_client uuid,
  p_service_place text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_product public.products%rowtype;
  v_sale public.field_sales%rowtype;
  v_sale_id uuid;
  v_financial uuid;
  v_total numeric(12,2);
  v_method text;
  v_allow_pix boolean;
  v_allow_cash boolean;
  v_allow_card boolean;
  v_allow_transfer boolean;
  v_allow_other boolean;
  v_pix_key text;
  v_pix_name text;
  v_pix_city text;
begin
  if v_user is null then raise exception 'Não autenticado' using errcode='28000'; end if;
  if p_company is null or p_product is null or p_request is null then raise exception 'Parâmetros obrigatórios ausentes' using errcode='22023'; end if;
  if p_quantity is null or p_quantity<=0 then raise exception 'Quantidade inválida' using errcode='22023'; end if;

  v_method := public.zt_normalize_field_sale_payment_method(p_payment_method);
  perform public.zt_assert_subscription_write(p_company);

  if not public.zt_is_owner(p_company) and not exists(
    select 1 from public.company_members m
    where m.company_id=p_company
      and m.user_id=v_user
      and m.role='technician'
      and m.status='active'
  ) then
    raise exception 'Sem permissão para vender nesta empresa' using errcode='42501';
  end if;

  select
    c.field_sales_allow_pix,c.field_sales_allow_cash,c.field_sales_allow_card,
    c.field_sales_allow_transfer,c.field_sales_allow_other,
    nullif(trim(c.pix_key),''),nullif(trim(c.pix_receiver_name),''),nullif(trim(c.pix_receiver_city),'')
  into v_allow_pix,v_allow_cash,v_allow_card,v_allow_transfer,v_allow_other,v_pix_key,v_pix_name,v_pix_city
  from public.companies c
  where c.id=p_company;
  if not found then raise exception 'Empresa não encontrada' using errcode='P0002'; end if;

  if (v_method='pix' and not v_allow_pix)
    or (v_method='cash' and not v_allow_cash)
    or (v_method='card' and not v_allow_card)
    or (v_method='transfer' and not v_allow_transfer)
    or (v_method='other' and not v_allow_other) then
    raise exception 'Forma de recebimento não habilitada pela empresa' using errcode='42501';
  end if;
  if v_method='pix' and (v_pix_key is null or v_pix_name is null or v_pix_city is null) then
    raise exception 'Configure chave, recebedor e cidade do Pix antes de vender' using errcode='23514';
  end if;

  if p_client is not null then
    if not exists(
      select 1 from public.clients c
      where c.id=p_client and c.company_id=p_company and c.deleted_at is null
    ) then
      raise exception 'Cliente indisponível' using errcode='P0002';
    end if;
    if not public.zt_is_owner(p_company) and not public.zt_client_visible(p_client,p_company) then
      raise exception 'Cliente fora do escopo do técnico' using errcode='42501';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_company::text||':'||p_request::text,0));

  select * into v_sale
  from public.field_sales s
  where s.company_id=p_company and s.client_request_id=p_request;
  if found then
    if v_sale.origin<>'quick'
      or v_sale.product_id<>p_product
      or v_sale.quantity<>p_quantity
      or v_sale.payment_method<>v_method
      or v_sale.client_id is distinct from p_client then
      raise exception 'client_request_id já utilizado por outra venda' using errcode='23505';
    end if;
    return v_sale.id;
  end if;

  select * into v_product
  from public.products p
  where p.id=p_product
    and p.company_id=p_company
    and p.active=true
    and p.sale_enabled=true
    and p.deleted_at is null
  for update;
  if not found then raise exception 'Produto indisponível para venda' using errcode='P0002'; end if;
  if v_product.track_stock and v_product.stock_qty<p_quantity then
    raise exception 'Estoque insuficiente: disponível %',v_product.stock_qty using errcode='23514';
  end if;

  v_total := round(v_product.price*p_quantity,2);

  insert into public.financial_entries(
    company_id,kind,description,amount,due_date,paid,paid_at,payment_method,category,client_id,client_request_id
  ) values(
    p_company,'income',left('Venda em campo · '||v_product.name,500),v_total,current_date,true,current_date,
    v_method,'Venda em campo',p_client,p_request
  ) returning id into v_financial;

  insert into public.field_sales(
    company_id,sold_by,product_id,quantity,unit_price,total,payment_method,notes,
    financial_entry_id,client_request_id,client_id,service_place,origin
  ) values(
    p_company,v_user,v_product.id,p_quantity,v_product.price,v_total,v_method,
    left(nullif(trim(p_notes),''),1000),v_financial,p_request,p_client,
    left(nullif(trim(p_service_place),''),500),'quick'
  ) returning id into v_sale_id;

  if v_product.track_stock then
    update public.products set stock_qty=stock_qty-p_quantity where id=v_product.id;
    insert into public.inventory_movements(
      company_id,product_id,kind,quantity_delta,unit_cost,notes,created_by
    ) values(
      p_company,v_product.id,'sale',-p_quantity,v_product.cost,
      left('Venda em campo · '||coalesce(nullif(trim(p_notes),''),'recebimento confirmado'),1000),v_user
    );
  end if;

  return v_sale_id;
end;
$$;
revoke all on function public.zt_sell_product_direct(uuid,uuid,numeric,text,text,uuid,uuid,text) from public,anon;
grant execute on function public.zt_sell_product_direct(uuid,uuid,numeric,text,text,uuid,uuid,text) to authenticated,service_role;

-- Compatibilidade: o contrato antigo continua existindo, mas persiste método canônico.
create or replace function public.zt_sell_product_direct(
  p_company uuid,
  p_product uuid,
  p_quantity numeric,
  p_payment_method text,
  p_notes text,
  p_request uuid
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.zt_sell_product_direct(
    p_company,p_product,p_quantity,p_payment_method,p_notes,p_request,null,null
  );
end;
$$;
revoke all on function public.zt_sell_product_direct(uuid,uuid,numeric,text,text,uuid) from public,anon;
grant execute on function public.zt_sell_product_direct(uuid,uuid,numeric,text,text,uuid) to authenticated,service_role;

-- -------------------------------------------------------- venda ligada à OS
-- Diferente de material interno: cria work_order_item cobrável + field_sales para
-- rastreabilidade. Não cria receita imediata; a cobrança permanece no financeiro da OS.
create or replace function public.zt_sell_product_on_work_order(
  p_wo uuid,
  p_product uuid,
  p_quantity numeric,
  p_notes text,
  p_request uuid
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_wo public.work_orders%rowtype;
  v_product public.products%rowtype;
  v_existing public.field_sales%rowtype;
  v_is_owner boolean;
  v_item uuid;
  v_total numeric(12,2);
begin
  if v_user is null then raise exception 'Não autenticado' using errcode='28000'; end if;
  if p_wo is null or p_product is null or p_request is null then raise exception 'Parâmetros obrigatórios ausentes' using errcode='22023'; end if;
  if p_quantity is null or p_quantity<=0 then raise exception 'Quantidade inválida' using errcode='22023'; end if;

  select * into v_wo
  from public.work_orders w
  where w.id=p_wo and w.deleted_at is null
  for update;
  if not found then raise exception 'OS não encontrada' using errcode='P0002'; end if;
  if v_wo.status in ('done','canceled') then raise exception 'A OS precisa estar aberta para vender produto' using errcode='23514'; end if;

  perform public.zt_assert_subscription_write(v_wo.company_id);
  v_is_owner := public.zt_is_owner(v_wo.company_id);
  if not v_is_owner and (
    v_wo.assigned_to is distinct from v_user
    or not exists(
      select 1 from public.company_members m
      where m.company_id=v_wo.company_id
        and m.user_id=v_user
        and m.role='technician'
        and m.status='active'
    )
  ) then
    raise exception 'Sem permissão para esta OS' using errcode='42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_wo.company_id::text||':'||p_request::text,0));

  select * into v_existing
  from public.field_sales s
  where s.company_id=v_wo.company_id and s.client_request_id=p_request;
  if found then
    if v_existing.origin<>'work_order'
      or v_existing.work_order_id<>p_wo
      or v_existing.product_id<>p_product
      or v_existing.quantity<>p_quantity then
      raise exception 'client_request_id já utilizado por outra venda' using errcode='23505';
    end if;
    return v_existing.work_order_item_id;
  end if;

  select * into v_product
  from public.products p
  where p.id=p_product
    and p.company_id=v_wo.company_id
    and p.active=true
    and p.sale_enabled=true
    and p.deleted_at is null
  for update;
  if not found then raise exception 'Produto indisponível para venda' using errcode='P0002'; end if;
  if v_product.track_stock and v_product.stock_qty<p_quantity then
    raise exception 'Estoque insuficiente: disponível %',v_product.stock_qty using errcode='23514';
  end if;

  v_total := round(v_product.price*p_quantity,2);

  insert into public.work_order_items(
    work_order_id,company_id,kind,product_id,name,unit,quantity,unit_price,unit_cost,
    is_extra,price_pending,notes
  ) values(
    p_wo,v_wo.company_id,'product',v_product.id,v_product.name,v_product.unit,p_quantity,
    v_product.price,v_product.cost,true,false,left(nullif(trim(p_notes),''),1000)
  ) returning id into v_item;

  insert into public.field_sales(
    company_id,sold_by,product_id,quantity,unit_price,total,payment_method,notes,
    financial_entry_id,client_request_id,client_id,service_place,origin,work_order_id,work_order_item_id
  ) values(
    v_wo.company_id,v_user,v_product.id,p_quantity,v_product.price,v_total,null,
    left(nullif(trim(p_notes),''),1000),null,p_request,v_wo.client_id,
    left(coalesce(nullif(trim(v_wo.service_place),''),nullif(trim(v_wo.address),'')),500),
    'work_order',p_wo,v_item
  );

  if v_product.track_stock then
    update public.products set stock_qty=stock_qty-p_quantity where id=v_product.id;
    insert into public.inventory_movements(
      company_id,product_id,kind,quantity_delta,unit_cost,work_order_id,notes,created_by
    ) values(
      v_wo.company_id,v_product.id,'sale',-p_quantity,v_product.cost,p_wo,
      left(nullif(trim(p_notes),''),1000),v_user
    );
  end if;

  return v_item;
end;
$$;
revoke all on function public.zt_sell_product_on_work_order(uuid,uuid,numeric,text,uuid) from public,anon;
grant execute on function public.zt_sell_product_on_work_order(uuid,uuid,numeric,text,uuid) to authenticated,service_role;
