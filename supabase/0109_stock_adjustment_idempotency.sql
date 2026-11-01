-- ZiisTec · Segurança V1.1 (SEC-04) — ajuste manual de estoque idempotente.
--
-- Problema: zt_adjust_product_stock(p_company, p_product, p_delta, p_notes) soma o delta a cada chamada. Retry depois
-- de timeout, duplo clique ou reenvio de formulário aplicava o mesmo ajuste duas vezes, sem erro visível. O caminho
-- do Assistente já era protegido pelo próprio pedido (requestId + hash); o caminho direto da tela de estoque não era.
--
-- Correção, no padrão de field_sales (client_request_id único por empresa):
--   * novo overload zt_adjust_product_stock(..., p_request uuid): o mesmo pedido altera o estoque uma única vez;
--     a repetição devolve o saldo gravado no primeiro ajuste, sem reaplicar o delta;
--   * o mesmo p_request com outro produto ou outro delta é recusado (23505), sem alterar nada;
--   * a linha do produto é travada antes de conferir e gravar, então duas chamadas simultâneas serializam;
--   * o overload antigo (4 argumentos) deixa de ser executável pelo navegador. Ele continua existindo porque a execução
--     do Assistente o chama por dentro (função definer, já idempotente pelo ledger do Assistente).
--
-- Compatibilidade: a coluna nova é opcional e as linhas antigas ficam com NULL. O frontend novo usa o overload com
-- p_request e, num banco ainda sem esta migration, cai para o antigo (comportamento de hoje).

alter table public.inventory_movements
  add column if not exists client_request_id uuid,
  add column if not exists balance_after numeric(14,3);

create unique index if not exists uq_inventory_movements_client_request
  on public.inventory_movements(company_id, client_request_id)
  where client_request_id is not null;

create or replace function public.zt_adjust_product_stock(
  p_company uuid,
  p_product uuid,
  p_delta numeric,
  p_notes text,
  p_request uuid
)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current numeric;
  v_next numeric;
  v_move public.inventory_movements%rowtype;
begin
  if auth.uid() is null then raise exception 'Não autenticado' using errcode = '28000'; end if;
  if not public.zt_is_owner(p_company) then raise exception 'Sem permissão' using errcode = '42501'; end if;
  if p_request is null then raise exception 'Identificador do pedido obrigatório' using errcode = '22023'; end if;
  if p_delta is null or p_delta = 0 then raise exception 'Ajuste deve ser diferente de zero' using errcode = '22023'; end if;

  -- Repetição: devolve o saldo do primeiro ajuste. Outro produto ou outro delta com o mesmo pedido é recusado.
  select * into v_move from public.inventory_movements where company_id = p_company and client_request_id = p_request;
  if found then
    if v_move.product_id <> p_product or v_move.kind <> 'adjustment' or v_move.quantity_delta <> p_delta then
      raise exception 'client_request_id já utilizado por outro ajuste' using errcode = '23505';
    end if;
    return v_move.balance_after;
  end if;

  select stock_qty into v_current
  from public.products
  where id = p_product and company_id = p_company and deleted_at is null
  for update;
  if not found then raise exception 'Produto não encontrado' using errcode = 'P0002'; end if;

  -- Depois do lock: uma chamada concorrente com o mesmo pedido pode ter gravado enquanto esta esperava.
  select * into v_move from public.inventory_movements where company_id = p_company and client_request_id = p_request;
  if found then
    if v_move.product_id <> p_product or v_move.kind <> 'adjustment' or v_move.quantity_delta <> p_delta then
      raise exception 'client_request_id já utilizado por outro ajuste' using errcode = '23505';
    end if;
    return v_move.balance_after;
  end if;

  if v_current + p_delta < 0 then raise exception 'Estoque insuficiente' using errcode = '23514'; end if;

  begin
    update public.products
    set stock_qty = v_current + p_delta, track_stock = true
    where id = p_product and company_id = p_company
    returning stock_qty into v_next;

    insert into public.inventory_movements(company_id, product_id, kind, quantity_delta, notes, created_by, client_request_id, balance_after)
    values (p_company, p_product, 'adjustment', p_delta, left(nullif(trim(p_notes), ''), 1000), auth.uid(), p_request, v_next);
  exception when unique_violation then
    -- Mesmo pedido gravado por outra transação em outro produto: o ajuste desta (linha do produto) é desfeito.
    raise exception 'client_request_id já utilizado por outro ajuste' using errcode = '23505';
  end;
  return v_next;
end;
$$;

revoke all on function public.zt_adjust_product_stock(uuid, uuid, numeric, text, uuid) from public, anon;
grant execute on function public.zt_adjust_product_stock(uuid, uuid, numeric, text, uuid) to authenticated, service_role;

-- O overload sem pedido não é mais chamado pelo navegador (a execução do Assistente roda como definer e o chama por dentro).
revoke all on function public.zt_adjust_product_stock(uuid, uuid, numeric, text) from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
