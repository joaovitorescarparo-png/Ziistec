-- ZiisTec V2 — F05 soft delete: referências arquivadas não podem entrar em novos documentos.
-- Staging/CI only. Todos os dados criados neste teste terminam em ROLLBACK.
--
-- Contrato:
-- 1) owner continua conseguindo LER cliente arquivado para preservar histórico;
-- 2) novo orçamento não aceita cliente/serviço/produto arquivado;
-- 3) orçamento arquivado não vira nova OS;
-- 4) produto arquivado não pode ser vendido/adicionado a uma OS;
-- 5) caminho ativo equivalente continua funcionando;
-- 6) technician não pode alterar deleted_at.

begin;

create temp table zt_f05_test(
  user_id uuid,
  company_id uuid,
  archived_client uuid,
  active_client uuid,
  archived_service uuid,
  active_service uuid,
  archived_product uuid,
  active_product uuid,
  archived_quote uuid,
  open_wo uuid,
  archived_client_visible boolean default false,
  archived_refs_blocked boolean default false,
  archived_quote_blocked boolean default false,
  archived_product_blocked boolean default false,
  active_quote_created boolean default false,
  technician_soft_delete_blocked boolean default false,
  archived_refs_error text,
  archived_quote_error text,
  archived_product_error text
) on commit drop;

grant select,update on zt_f05_test to authenticated;

insert into zt_f05_test(
  user_id,company_id,archived_client,active_client,archived_service,active_service,
  archived_product,active_product,archived_quote,open_wo
)
select m.user_id,gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()
from public.company_members m
where m.role='owner' and m.status='active'
limit 1;

do $$ begin
  if not exists(select 1 from zt_f05_test) then raise exception 'F05_NEEDS_ACTIVE_OWNER'; end if;
end $$;

select set_config('request.jwt.claim.sub',(select user_id::text from zt_f05_test),true);

insert into public.companies(id,name) select company_id,'__F05_SOFT_DELETE_TEST__' from zt_f05_test;
insert into public.subscriptions(company_id,status,current_period_start,current_period_end)
select company_id,'trial'::public.zt_sub_status,current_date,current_date+14 from zt_f05_test;
insert into public.company_members(company_id,user_id,role,status)
select company_id,user_id,'owner'::public.zt_role,'active'::public.zt_member_status from zt_f05_test;

insert into public.clients(id,company_id,name,deleted_at)
select archived_client,company_id,'__F05_ARCHIVED_CLIENT__',now() from zt_f05_test;
insert into public.clients(id,company_id,name)
select active_client,company_id,'__F05_ACTIVE_CLIENT__' from zt_f05_test;

insert into public.services(id,company_id,name,unit,price,cost,active,deleted_at)
select archived_service,company_id,'__F05_ARCHIVED_SERVICE__','unidade',100,10,true,now() from zt_f05_test;
insert into public.services(id,company_id,name,unit,price,cost,active)
select active_service,company_id,'__F05_ACTIVE_SERVICE__','unidade',100,10,true from zt_f05_test;

insert into public.products(id,company_id,name,unit,price,cost,active,sale_enabled,track_stock,stock_qty,low_stock_threshold,deleted_at)
select archived_product,company_id,'__F05_ARCHIVED_PRODUCT__','unidade',200,20,true,true,false,5,0,now() from zt_f05_test;
insert into public.products(id,company_id,name,unit,price,cost,active,sale_enabled,track_stock,stock_qty,low_stock_threshold)
select active_product,company_id,'__F05_ACTIVE_PRODUCT__','unidade',200,20,true,true,false,5,0 from zt_f05_test;

insert into public.quotes(id,company_id,number,client_id,status,issue_date,deleted_at,created_by)
select archived_quote,company_id,'__F05-ARCHIVED-QUOTE__',active_client,'approved'::public.zt_quote_status,current_date,now(),user_id from zt_f05_test;
insert into public.quote_items(quote_id,company_id,kind,service_id,name,unit,quantity,unit_price,unit_cost,position)
select archived_quote,company_id,'service'::public.zt_item_kind,active_service,'__F05_ACTIVE_SERVICE__','unidade',1,100,10,0 from zt_f05_test;

insert into public.work_orders(id,company_id,number,client_id,assigned_to,status,created_by)
select open_wo,company_id,'__F05-OPEN-WO__',active_client,user_id,'in_progress'::public.zt_wo_status,user_id from zt_f05_test;

set local role authenticated;

update zt_f05_test t
set archived_client_visible = exists(
  select 1 from public.clients c where c.id=t.archived_client and c.company_id=t.company_id and c.deleted_at is not null
);

do $$
declare v_id uuid;
begin
  begin
    select public.zt_save_quote_idempotent(
      (select company_id from zt_f05_test),null,gen_random_uuid(),
      jsonb_build_object('client_id',(select archived_client from zt_f05_test),'status','draft','issue_date',current_date),
      jsonb_build_array(
        jsonb_build_object('kind','service','service_id',(select archived_service from zt_f05_test),'name','Archived service','unit','unidade','quantity',1,'unit_price',100),
        jsonb_build_object('kind','product','product_id',(select archived_product from zt_f05_test),'name','Archived product','unit','unidade','quantity',1,'unit_price',200)
      )
    ) into v_id;
    update zt_f05_test set archived_refs_blocked=false;
  exception when others then
    update zt_f05_test set archived_refs_blocked=true,archived_refs_error=sqlstate||':'||sqlerrm;
  end;

  begin
    select public.zt_create_work_order_from_quote((select archived_quote from zt_f05_test),null,null,null) into v_id;
    update zt_f05_test set archived_quote_blocked=false;
  exception when others then
    update zt_f05_test set archived_quote_blocked=true,archived_quote_error=sqlstate||':'||sqlerrm;
  end;

  begin
    select public.zt_sell_product_on_work_order((select open_wo from zt_f05_test),(select archived_product from zt_f05_test),1,'__F05_TEST__') into v_id;
    update zt_f05_test set archived_product_blocked=false;
  exception when others then
    update zt_f05_test set archived_product_blocked=true,archived_product_error=sqlstate||':'||sqlerrm;
  end;

  begin
    select public.zt_save_quote_idempotent(
      (select company_id from zt_f05_test),null,gen_random_uuid(),
      jsonb_build_object('client_id',(select active_client from zt_f05_test),'status','draft','issue_date',current_date),
      jsonb_build_array(
        jsonb_build_object('kind','service','service_id',(select active_service from zt_f05_test),'name','Active service','unit','unidade','quantity',1,'unit_price',100),
        jsonb_build_object('kind','product','product_id',(select active_product from zt_f05_test),'name','Active product','unit','unidade','quantity',1,'unit_price',200)
      )
    ) into v_id;
    update zt_f05_test set active_quote_created=(v_id is not null);
  exception when others then
    update zt_f05_test set active_quote_created=false;
  end;
end $$;

reset role;

-- Muda apenas a membership temporária para technician e prova que deleted_at continua owner-only.
update public.company_members m set role='technician'::public.zt_role
from zt_f05_test t where m.company_id=t.company_id and m.user_id=t.user_id;

set local role authenticated;
do $$
begin
  begin
    update public.clients c set deleted_at=null
    from zt_f05_test t where c.id=t.archived_client and c.company_id=t.company_id;
    update zt_f05_test set technician_soft_delete_blocked=false;
  exception when sqlstate '42501' then
    update zt_f05_test set technician_soft_delete_blocked=true;
  end;
end $$;
reset role;

select
  'F05_SOFT_DELETE_REFERENCE_GUARD' as result,
  archived_client_visible,
  archived_refs_blocked,
  archived_quote_blocked,
  archived_product_blocked,
  active_quote_created,
  technician_soft_delete_blocked,
  archived_refs_error,
  archived_quote_error,
  archived_product_error,
  (archived_client_visible
   and archived_refs_blocked
   and archived_quote_blocked
   and archived_product_blocked
   and active_quote_created
   and technician_soft_delete_blocked) as passed
from zt_f05_test;

do $$
begin
  if not exists(
    select 1 from zt_f05_test
    where archived_client_visible
      and archived_refs_blocked
      and archived_quote_blocked
      and archived_product_blocked
      and active_quote_created
      and technician_soft_delete_blocked
  ) then
    raise exception 'F05_SOFT_DELETE_REFERENCE_GUARD_FAILED';
  end if;
end $$;

rollback;
