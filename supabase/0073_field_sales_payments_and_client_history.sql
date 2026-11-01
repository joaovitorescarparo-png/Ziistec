-- ZiisTec · 0073 — recebimentos de venda em campo + histórico por cliente/condomínio

alter table public.companies
  add column if not exists pix_key text,
  add column if not exists pix_qr_path text,
  add column if not exists field_sales_allow_pix boolean not null default true,
  add column if not exists field_sales_allow_cash boolean not null default true,
  add column if not exists field_sales_allow_card boolean not null default true;

alter table public.field_sales
  add column if not exists client_id uuid references public.clients(id) on delete set null,
  add column if not exists service_place text;

create index if not exists field_sales_company_client_created_idx
  on public.field_sales(company_id, client_id, created_at desc);

create or replace function public.zt_sell_product_direct(
  p_company uuid,
  p_product uuid,
  p_quantity numeric,
  p_payment_method text,
  p_notes text,
  p_request uuid,
  p_client uuid default null,
  p_service_place text default null
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_user uuid := auth.uid();
  v_product public.products%rowtype;
  v_company public.companies%rowtype;
  v_sale uuid;
  v_entry uuid;
  v_total numeric;
  v_method text := initcap(lower(left(nullif(trim(p_payment_method), ''), 40)));
  v_place text := left(nullif(trim(p_service_place), ''), 1000);
begin
  if v_user is null then raise exception 'Não autenticado' using errcode='28000'; end if;
  if p_company is null or p_product is null or p_request is null then raise exception 'Dados obrigatórios ausentes' using errcode='22023'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Quantidade inválida' using errcode='22023'; end if;
  if v_method not in ('Pix','Dinheiro','Cartão') then raise exception 'Forma de pagamento inválida' using errcode='22023'; end if;
  if not public.zt_subscription_can_write(p_company) then raise exception 'Assinatura sem permissão de escrita' using errcode='42501'; end if;

  if not (
    public.zt_is_owner(p_company)
    or exists (
      select 1 from public.company_members m
      where m.company_id=p_company and m.user_id=v_user
        and m.role='technician'::public.zt_role and m.status='active'::public.zt_member_status
    )
  ) then raise exception 'Sem permissão para vender nesta empresa' using errcode='42501'; end if;

  select * into v_company from public.companies where id=p_company;
  if v_method='Pix' and not coalesce(v_company.field_sales_allow_pix,false) then raise exception 'Pix não habilitado pela empresa' using errcode='42501'; end if;
  if v_method='Dinheiro' and not coalesce(v_company.field_sales_allow_cash,false) then raise exception 'Dinheiro não habilitado pela empresa' using errcode='42501'; end if;
  if v_method='Cartão' and not coalesce(v_company.field_sales_allow_card,false) then raise exception 'Cartão não habilitado pela empresa' using errcode='42501'; end if;

  if p_client is not null then
    if not exists (select 1 from public.clients c where c.id=p_client and c.company_id=p_company and c.deleted_at is null) then
      raise exception 'Cliente inválido para esta empresa' using errcode='42501';
    end if;
    if not public.zt_is_owner(p_company) and not public.zt_client_visible(p_client,p_company) then
      raise exception 'Cliente fora dos atendimentos permitidos ao técnico' using errcode='42501';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_company::text || ':' || p_request::text, 0));
  select id into v_sale from public.field_sales where company_id=p_company and client_request_id=p_request;
  if found then return v_sale; end if;

  select * into v_product from public.products
   where id=p_product and company_id=p_company and active=true and sale_enabled=true and deleted_at is null
   for update;
  if not found then raise exception 'Produto indisponível para venda' using errcode='P0002'; end if;
  if v_product.track_stock and v_product.stock_qty < p_quantity then
    raise exception 'Estoque insuficiente: disponível %', v_product.stock_qty using errcode='23514';
  end if;

  v_total := round(v_product.price * p_quantity, 2);

  insert into public.financial_entries(
    company_id, kind, description, amount, due_date, paid, paid_at,
    payment_method, category, client_id
  ) values (
    p_company, 'income'::public.zt_entry_kind,
    'Venda em campo · ' || v_product.name,
    v_total, current_date, true, current_date,
    v_method, 'Venda em campo', p_client
  ) returning id into v_entry;

  insert into public.field_sales(
    company_id, sold_by, product_id, quantity, unit_price, total,
    payment_method, notes, financial_entry_id, client_request_id,
    client_id, service_place
  ) values (
    p_company, v_user, v_product.id, p_quantity, v_product.price, v_total,
    v_method, left(nullif(trim(p_notes), ''), 1000), v_entry, p_request,
    p_client, v_place
  ) returning id into v_sale;

  if v_product.track_stock then
    update public.products set stock_qty = stock_qty - p_quantity
     where id=v_product.id and company_id=p_company;
    insert into public.inventory_movements(
      company_id, product_id, kind, quantity_delta, unit_cost, notes, created_by
    ) values (
      p_company, v_product.id, 'sale', -p_quantity, v_product.cost,
      left('Venda em campo · ' || coalesce(nullif(trim(p_notes), ''), v_product.name), 1000), v_user
    );
  end if;
  return v_sale;
end
$$;

revoke all on function public.zt_sell_product_direct(uuid,uuid,numeric,text,text,uuid,uuid,text) from public, anon;
grant execute on function public.zt_sell_product_direct(uuid,uuid,numeric,text,text,uuid,uuid,text) to authenticated;
