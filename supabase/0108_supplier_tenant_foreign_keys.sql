-- ZiisTec · Segurança V1.1 (SEC-03) — o fornecedor de um produto ou compra pertence à mesma empresa, garantido no banco.
--
-- Problema: products.supplier_id e purchases.supplier_id tinham FK simples para suppliers(id). O dono da empresa A
-- conseguia gravar o id de um fornecedor da empresa B no próprio produto ou compra (reproduzido no laboratório). O
-- fornecedor de B seguia ilegível por RLS, mas a gravação confirmava que o id existe e o vínculo era anulado se B
-- apagasse o fornecedor.
--
-- Correção: FK composta por empresa, no padrão das demais FKs de tenant (0024/0025/0053):
--   products(supplier_id, company_id)  -> suppliers(id, company_id)
--   purchases(supplier_id, company_id) -> suppliers(id, company_id)
-- Com MATCH SIMPLE, supplier_id nulo continua permitido (produto/compra sem fornecedor). ON DELETE SET NULL
-- (supplier_id) limita o efeito ao vínculo: company_id (not null) nunca é anulado.
--
-- Falha fechada: se já existir produto ou compra apontando para fornecedor de OUTRA empresa, a migration aborta sem
-- alterar nada e a mensagem traz a contagem. Esta migration NUNCA corrige ou apaga dados. Para tratar um ambiente
-- que falhar, rodar antes (somente leitura) e decidir caso a caso com o dono do dado:
--   select 'products' t, p.id, p.company_id, p.supplier_id, s.company_id as supplier_company
--     from public.products p join public.suppliers s on s.id = p.supplier_id where s.company_id <> p.company_id
--   union all
--   select 'purchases', p.id, p.company_id, p.supplier_id, s.company_id
--     from public.purchases p join public.suppliers s on s.id = p.supplier_id where s.company_id <> p.company_id;
-- Depois de revisar, o vínculo inválido é anulado manualmente (update ... set supplier_id = null where id = ...) e a
-- migration é reaplicada. O ADD CONSTRAINT valida a tabela inteira e segura um lock curto em products/purchases.
--
-- Não aplicada em nenhum ambiente real. Independente das demais; vale para todo o pacote 0100–0110.

do $$
declare
  v_products integer;
  v_purchases integer;
begin
  select count(*) into v_products
  from public.products p join public.suppliers s on s.id = p.supplier_id
  where s.company_id <> p.company_id;

  select count(*) into v_purchases
  from public.purchases p join public.suppliers s on s.id = p.supplier_id
  where s.company_id <> p.company_id;

  if v_products + v_purchases > 0 then
    raise exception 'SEC03_CROSS_TENANT_SUPPLIER_REFERENCES products=% purchases=%', v_products, v_purchases
      using errcode = '23503',
            hint = 'Nada foi alterado. Liste os registros com a consulta de somente leitura no cabeçalho da migration 0108, revise com o dono do dado, anule o vínculo inválido manualmente e reaplique.';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.suppliers'::regclass and conname = 'suppliers_id_company_key'
  ) then
    alter table public.suppliers add constraint suppliers_id_company_key unique (id, company_id);
  end if;
end $$;

alter table public.products drop constraint if exists products_supplier_id_fkey;
alter table public.products drop constraint if exists products_supplier_company_fk;
alter table public.products
  add constraint products_supplier_company_fk
  foreign key (supplier_id, company_id)
  references public.suppliers (id, company_id)
  on delete set null (supplier_id);

alter table public.purchases drop constraint if exists purchases_supplier_id_fkey;
alter table public.purchases drop constraint if exists purchases_supplier_company_fk;
alter table public.purchases
  add constraint purchases_supplier_company_fk
  foreign key (supplier_id, company_id)
  references public.suppliers (id, company_id)
  on delete set null (supplier_id);

notify pgrst, 'reload schema';
