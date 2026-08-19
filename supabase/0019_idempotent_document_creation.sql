-- ZiisTec · idempotência para criação de ORC/OS/CMP
-- A mesma tentativa reenviada após timeout/reconexão retorna o mesmo documento.

alter table public.quotes add column if not exists client_request_id uuid;
alter table public.work_orders add column if not exists client_request_id uuid;
alter table public.purchases add column if not exists client_request_id uuid;

create unique index if not exists ux_quotes_company_request
  on public.quotes(company_id,client_request_id) where client_request_id is not null;
create unique index if not exists ux_work_orders_company_request
  on public.work_orders(company_id,client_request_id) where client_request_id is not null;
create unique index if not exists ux_purchases_company_request
  on public.purchases(company_id,client_request_id) where client_request_id is not null;

create or replace function zt_private.zt_save_quote_idempotent(
  p_company uuid,p_quote uuid,p_request uuid,p_row jsonb,p_items jsonb default '[]'::jsonb
) returns uuid
language plpgsql security definer set search_path=public
as $$
declare v_id uuid;
begin
  if p_quote is not null then
    return zt_private.zt_save_quote(p_company,p_quote,p_row,p_items);
  end if;
  if p_request is null then raise exception 'Identificador da tentativa é obrigatório'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company::text||':quote:'||p_request::text,0));
  select id into v_id from public.quotes where company_id=p_company and client_request_id=p_request;
  if v_id is not null then return v_id; end if;
  v_id:=zt_private.zt_save_quote(p_company,null,p_row,p_items);
  update public.quotes set client_request_id=p_request where id=v_id and company_id=p_company;
  return v_id;
end $$;

create or replace function zt_private.zt_save_work_order_idempotent(
  p_company uuid,p_wo uuid,p_request uuid,p_row jsonb,p_items jsonb default '[]'::jsonb
) returns uuid
language plpgsql security definer set search_path=public
as $$
declare v_id uuid;
begin
  if p_wo is not null then
    return zt_private.zt_save_work_order(p_company,p_wo,p_row,p_items);
  end if;
  if p_request is null then raise exception 'Identificador da tentativa é obrigatório'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company::text||':work_order:'||p_request::text,0));
  select id into v_id from public.work_orders where company_id=p_company and client_request_id=p_request;
  if v_id is not null then return v_id; end if;
  v_id:=zt_private.zt_save_work_order(p_company,null,p_row,p_items);
  update public.work_orders set client_request_id=p_request where id=v_id and company_id=p_company;
  return v_id;
end $$;

create or replace function zt_private.zt_save_purchase_idempotent(
  p_company uuid,p_purchase uuid,p_request uuid,p_row jsonb,p_items jsonb default '[]'::jsonb
) returns uuid
language plpgsql security definer set search_path=public
as $$
declare v_id uuid;
begin
  if p_purchase is not null then
    return zt_private.zt_save_purchase(p_company,p_purchase,p_row,p_items);
  end if;
  if p_request is null then raise exception 'Identificador da tentativa é obrigatório'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company::text||':purchase:'||p_request::text,0));
  select id into v_id from public.purchases where company_id=p_company and client_request_id=p_request;
  if v_id is not null then return v_id; end if;
  v_id:=zt_private.zt_save_purchase(p_company,null,p_row,p_items);
  update public.purchases set client_request_id=p_request where id=v_id and company_id=p_company;
  return v_id;
end $$;

create or replace function public.zt_save_quote_idempotent(
  p_company uuid,p_quote uuid,p_request uuid,p_row jsonb,p_items jsonb default '[]'::jsonb
) returns uuid language sql security definer set search_path=zt_private
as $$ select zt_private.zt_save_quote_idempotent(p_company,p_quote,p_request,p_row,p_items); $$;

create or replace function public.zt_save_work_order_idempotent(
  p_company uuid,p_wo uuid,p_request uuid,p_row jsonb,p_items jsonb default '[]'::jsonb
) returns uuid language sql security definer set search_path=zt_private
as $$ select zt_private.zt_save_work_order_idempotent(p_company,p_wo,p_request,p_row,p_items); $$;

create or replace function public.zt_save_purchase_idempotent(
  p_company uuid,p_purchase uuid,p_request uuid,p_row jsonb,p_items jsonb default '[]'::jsonb
) returns uuid language sql security definer set search_path=zt_private
as $$ select zt_private.zt_save_purchase_idempotent(p_company,p_purchase,p_request,p_row,p_items); $$;

revoke all on function public.zt_save_quote_idempotent(uuid,uuid,uuid,jsonb,jsonb) from public,anon;
revoke all on function public.zt_save_work_order_idempotent(uuid,uuid,uuid,jsonb,jsonb) from public,anon;
revoke all on function public.zt_save_purchase_idempotent(uuid,uuid,uuid,jsonb,jsonb) from public,anon;
grant execute on function public.zt_save_quote_idempotent(uuid,uuid,uuid,jsonb,jsonb) to authenticated;
grant execute on function public.zt_save_work_order_idempotent(uuid,uuid,uuid,jsonb,jsonb) to authenticated;
grant execute on function public.zt_save_purchase_idempotent(uuid,uuid,uuid,jsonb,jsonb) to authenticated;

revoke all on function zt_private.zt_save_quote_idempotent(uuid,uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
revoke all on function zt_private.zt_save_work_order_idempotent(uuid,uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
revoke all on function zt_private.zt_save_purchase_idempotent(uuid,uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
