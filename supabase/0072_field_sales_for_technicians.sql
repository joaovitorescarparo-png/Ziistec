-- ZiisTec · 0072 — venda rápida em campo para técnico/owner
--
-- Objetivos:
-- * técnico vende somente produto ativo, não arquivado e explicitamente liberado (sale_enabled);
-- * preço vem sempre do banco; técnico não envia nem lê custo/margem/fornecedor;
-- * venda rápida registra receita recebida, movimento de estoque e trilha auditável;
-- * retry usa client_request_id e devolve a mesma venda;
-- * writes diretos ficam bloqueados: a RPC é a autoridade.

create table if not exists public.field_sales (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  sold_by uuid not null references auth.users(id) on delete restrict,
  product_id uuid not null,
  quantity numeric not null check (quantity > 0),
  unit_price numeric not null check (unit_price >= 0),
  total numeric not null check (total >= 0),
  payment_method text not null check (char_length(payment_method) between 1 and 40),
  notes text check (notes is null or char_length(notes) <= 1000),
  financial_entry_id uuid unique references public.financial_entries(id) on delete set null,
  client_request_id uuid not null,
  created_at timestamptz not null default now(),
  constraint field_sales_product_company_fk foreign key (product_id, company_id)
    references public.products(id, company_id),
  constraint field_sales_company_request_key unique (company_id, client_request_id)
);

create index if not exists field_sales_company_created_idx
  on public.field_sales(company_id, created_at desc);
create index if not exists field_sales_sold_by_created_idx
  on public.field_sales(sold_by, created_at desc);

alter table public.field_sales enable row level security;

revoke all on public.field_sales from anon, authenticated;
grant select on public.field_sales to authenticated;

-- Owner vê todas as vendas da empresa. Técnico vê somente as próprias vendas,
-- sem custo porque a tabela não contém custo/margem.
drop policy if exists field_sales_select on public.field_sales;
create policy field_sales_select
on public.field_sales
for select
to authenticated
using (
  public.zt_is_owner(company_id)
  or (
    sold_by = auth.uid()
    and exists (
      select 1
      from public.company_members m
      where m.company_id = field_sales.company_id
        and m.user_id = auth.uid()
        and m.role = 'technician'::public.zt_role
        and m.status = 'active'::public.zt_member_status
    )
  )
);

create or replace function public.zt_sell_product_direct(
  p_company uuid,
  p_product uuid,
  p_quantity numeric,
  p_payment_method text,
  p_notes text,
  p_request uuid
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_user uuid := auth.uid();
  v_product public.products%rowtype;
  v_sale uuid;
  v_entry uuid;
  v_total numeric;
  v_method text := left(nullif(trim(p_payment_method), ''), 40);
begin
  if v_user is null then
    raise exception 'Não autenticado' using errcode='28000';
  end if;
  if p_company is null or p_product is null or p_request is null then
    raise exception 'Dados obrigatórios ausentes' using errcode='22023';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantidade inválida' using errcode='22023';
  end if;
  if v_method is null then
    raise exception 'Informe a forma de pagamento' using errcode='22023';
  end if;
  if not public.zt_subscription_can_write(p_company) then
    raise exception 'Assinatura sem permissão de escrita' using errcode='42501';
  end if;
  if not (
    public.zt_is_owner(p_company)
    or exists (
      select 1
      from public.company_members m
      where m.company_id=p_company
        and m.user_id=v_user
        and m.role='technician'::public.zt_role
        and m.status='active'::public.zt_member_status
    )
  ) then
    raise exception 'Sem permissão para vender nesta empresa' using errcode='42501';
  end if;

  -- Serializa retries do mesmo request para evitar duplicidade financeira/estoque.
  perform pg_advisory_xact_lock(hashtextextended(p_company::text || ':' || p_request::text, 0));

  select id into v_sale
  from public.field_sales
  where company_id=p_company and client_request_id=p_request;
  if found then return v_sale; end if;

  select * into v_product
  from public.products
  where id=p_product
    and company_id=p_company
    and active=true
    and sale_enabled=true
    and deleted_at is null
  for update;
  if not found then
    raise exception 'Produto indisponível para venda' using errcode='P0002';
  end if;

  if v_product.track_stock and v_product.stock_qty < p_quantity then
    raise exception 'Estoque insuficiente: disponível %', v_product.stock_qty using errcode='23514';
  end if;

  v_total := round(v_product.price * p_quantity, 2);

  insert into public.financial_entries(
    company_id, kind, description, amount, due_date,
    paid, paid_at, payment_method, category
  ) values (
    p_company,
    'income'::public.zt_entry_kind,
    'Venda em campo · ' || v_product.name,
    v_total,
    current_date,
    true,
    current_date,
    v_method,
    'Venda em campo'
  ) returning id into v_entry;

  insert into public.field_sales(
    company_id, sold_by, product_id, quantity, unit_price, total,
    payment_method, notes, financial_entry_id, client_request_id
  ) values (
    p_company, v_user, v_product.id, p_quantity, v_product.price, v_total,
    v_method, left(nullif(trim(p_notes), ''), 1000), v_entry, p_request
  ) returning id into v_sale;

  if v_product.track_stock then
    update public.products
       set stock_qty = stock_qty - p_quantity
     where id=v_product.id and company_id=p_company;

    insert into public.inventory_movements(
      company_id, product_id, kind, quantity_delta, unit_cost,
      notes, created_by
    ) values (
      p_company, v_product.id, 'sale', -p_quantity, v_product.cost,
      left('Venda em campo · ' || coalesce(nullif(trim(p_notes), ''), v_product.name), 1000),
      v_user
    );
  end if;

  return v_sale;
end
$$;

revoke all on function public.zt_sell_product_direct(uuid,uuid,numeric,text,text,uuid) from public, anon;
grant execute on function public.zt_sell_product_direct(uuid,uuid,numeric,text,text,uuid) to authenticated;
