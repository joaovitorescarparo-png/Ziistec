-- ZiisTec Field Workflow V1 — Wave 1
-- Campos comerciais de orçamento/produto + bucket dedicado para fotos de produto.
-- Aditiva, tenant-safe e sem alterar preço/estoque/financeiro.

alter table public.quotes
  add column if not exists customer_message text,
  add column if not exists execution_forecast_date date,
  add column if not exists show_product_images boolean not null default false;

alter table public.quotes drop constraint if exists quotes_customer_message_len;
alter table public.quotes add constraint quotes_customer_message_len
  check (customer_message is null or char_length(customer_message) <= 5000);

comment on column public.quotes.customer_message is
  'Texto comercial exibido ao cliente antes dos itens; separado de notes/observação interna.';
comment on column public.quotes.execution_forecast_date is
  'Previsão opcional de execução/instalação; não substitui valid_until.';
comment on column public.quotes.show_product_images is
  'Quando true, o PDF pode exibir miniaturas dos produtos com imagem disponível.';

alter table public.products
  add column if not exists sku text,
  add column if not exists barcode text;

alter table public.products drop constraint if exists products_sku_len;
alter table public.products add constraint products_sku_len
  check (sku is null or char_length(sku) between 1 and 120);

alter table public.products drop constraint if exists products_barcode_format;
alter table public.products add constraint products_barcode_format
  check (barcode is null or barcode ~ '^(?:[0-9]{8}|[0-9]{12}|[0-9]{13}|[0-9]{14})$');

create unique index if not exists uq_products_company_sku_live
  on public.products(company_id, lower(sku))
  where sku is not null and deleted_at is null;

create unique index if not exists uq_products_company_barcode_live
  on public.products(company_id, barcode)
  where barcode is not null and deleted_at is null;

comment on column public.products.sku is
  'Código interno/SKU da empresa. Unicidade por empresa entre produtos não excluídos.';
comment on column public.products.barcode is
  'EAN/UPC/GTIN em texto para preservar zeros à esquerda; aceita 8, 12, 13 ou 14 dígitos.';

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values(
  'zt-product-images',
  'zt-product-images',
  false,
  2097152,
  array['image/jpeg','image/png','image/webp']::text[]
)
on conflict(id) do update
  set public=false,
      file_size_limit=excluded.file_size_limit,
      allowed_mime_types=excluded.allowed_mime_types;

create or replace function public.zt_path_product(path text)
returns uuid
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v text := pg_catalog.split_part(coalesce(path,''),'/',3);
begin
  if v ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return v::uuid;
  end if;
  return null;
end;
$$;

revoke all on function public.zt_path_product(text) from public,anon;
grant execute on function public.zt_path_product(text) to authenticated,service_role;

-- Owner lê qualquer foto da própria empresa. Membro ativo não-owner só lê
-- imagem de produto ativo e liberado para venda, preservando o catálogo seguro.
drop policy if exists zt_product_images_read on storage.objects;
create policy zt_product_images_read on storage.objects
for select to authenticated
using (
  bucket_id='zt-product-images'
  and (
    public.zt_is_owner(public.zt_path_company(name))
    or (
      public.zt_is_member(public.zt_path_company(name))
      and exists(
        select 1
          from public.products p
         where p.id=public.zt_path_product(storage.objects.name)
           and p.company_id=public.zt_path_company(storage.objects.name)
           and p.deleted_at is null
           and p.active=true
           and p.sale_enabled=true
      )
    )
  )
);

-- Escrita continua administrativa e exige assinatura operacionalmente ativa.
drop policy if exists zt_product_images_write on storage.objects;
create policy zt_product_images_write on storage.objects
for all to authenticated
using (
  bucket_id='zt-product-images'
  and public.zt_is_owner(public.zt_path_company(name))
  and public.zt_subscription_can_write(public.zt_path_company(name))
  and exists(
    select 1
      from public.products p
     where p.id=public.zt_path_product(storage.objects.name)
       and p.company_id=public.zt_path_company(storage.objects.name)
  )
)
with check (
  bucket_id='zt-product-images'
  and public.zt_is_owner(public.zt_path_company(name))
  and public.zt_subscription_can_write(public.zt_path_company(name))
  and exists(
    select 1
      from public.products p
     where p.id=public.zt_path_product(storage.objects.name)
       and p.company_id=public.zt_path_company(storage.objects.name)
  )
);
