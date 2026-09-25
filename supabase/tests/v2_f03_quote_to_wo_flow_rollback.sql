-- ZiisTec blocker regression F03 — fluxo canônico Orçamento → OS.
-- Destino: SOMENTE staging/homologação. Tudo termina em ROLLBACK.
-- Deve passar tanto antes quanto depois da troca do frontend, pois prova o contrato da RPC autoritativa.

begin;

create temp table zt_f03_quote_to_wo_test (
  owner_id uuid,
  company_id uuid,
  client_id uuid,
  quote_id uuid,
  draft_blocked boolean default false,
  declined_blocked boolean default false,
  first_wo uuid,
  retry_wo uuid
) on commit drop;
grant select, update on zt_f03_quote_to_wo_test to authenticated;

insert into zt_f03_quote_to_wo_test(owner_id,company_id,client_id,quote_id)
select m.user_id,gen_random_uuid(),gen_random_uuid(),gen_random_uuid()
from public.company_members m
where m.role='owner' and m.status='active'
limit 1;

do $$
begin
  if not exists (select 1 from zt_f03_quote_to_wo_test) then
    raise exception 'F03_NEEDS_ACTIVE_OWNER';
  end if;
end $$;

select set_config('request.jwt.claim.sub',(select owner_id::text from zt_f03_quote_to_wo_test),true);

insert into public.companies(id,name)
select company_id,'__F03_QUOTE_TO_WO__' from zt_f03_quote_to_wo_test;
insert into public.subscriptions(company_id,status,current_period_start,current_period_end)
select company_id,'trial'::public.zt_sub_status,current_date,current_date+14 from zt_f03_quote_to_wo_test;
insert into public.company_members(company_id,user_id,role,status)
select company_id,owner_id,'owner'::public.zt_role,'active'::public.zt_member_status from zt_f03_quote_to_wo_test;
insert into public.clients(id,company_id,name,address)
select client_id,company_id,'__F03_CLIENT__','Rua Cliente F03' from zt_f03_quote_to_wo_test;
insert into public.quotes(
  id,company_id,number,client_id,status,issue_date,discount,surcharge,payment_terms,notes,address,service_place,created_by
)
select quote_id,company_id,'__F03-ORC__',client_id,'draft'::public.zt_quote_status,current_date,10,5,'Pix','Observação aprovada','Rua F03, 123','Sala 4',owner_id
from zt_f03_quote_to_wo_test;
insert into public.quote_items(
  quote_id,company_id,kind,name,unit,quantity,unit_price,unit_cost,notes,position
)
select quote_id,company_id,'free'::public.zt_item_kind,'Instalação F03','serviço',2,150,0,'Item preservado',0
from zt_f03_quote_to_wo_test;

set local role authenticated;
do $$
declare t zt_f03_quote_to_wo_test%rowtype;
begin
  select * into t from zt_f03_quote_to_wo_test;
  begin
    perform public.zt_create_work_order_from_quote(t.quote_id,t.owner_id,null,null);
  exception when sqlstate '23514' then
    update zt_f03_quote_to_wo_test set draft_blocked=true;
  end;
end $$;
reset role;

update public.quotes q set status='declined'::public.zt_quote_status
from zt_f03_quote_to_wo_test t where q.id=t.quote_id;

set local role authenticated;
do $$
declare t zt_f03_quote_to_wo_test%rowtype;
begin
  select * into t from zt_f03_quote_to_wo_test;
  begin
    perform public.zt_create_work_order_from_quote(t.quote_id,t.owner_id,null,null);
  exception when sqlstate '23514' then
    update zt_f03_quote_to_wo_test set declined_blocked=true;
  end;
end $$;
reset role;

update public.quotes q set status='approved'::public.zt_quote_status
from zt_f03_quote_to_wo_test t where q.id=t.quote_id;

set local role authenticated;
update zt_f03_quote_to_wo_test t
set first_wo=public.zt_create_work_order_from_quote(t.quote_id,t.owner_id,null,null);
update zt_f03_quote_to_wo_test t
set retry_wo=public.zt_create_work_order_from_quote(t.quote_id,t.owner_id,null,null);
reset role;

select
  'F03_QUOTE_TO_WORK_ORDER_CONTRACT' as test,
  t.draft_blocked,
  t.declined_blocked,
  t.first_wo is not null as approved_created,
  t.retry_wo=t.first_wo as retry_same_wo,
  (select count(*) from public.work_orders w where w.company_id=t.company_id and w.quote_id=t.quote_id)=1 as exactly_one_wo,
  (
    select w.client_id=q.client_id
       and w.quote_id=q.id
       and w.assigned_to=t.owner_id
       and w.status='unscheduled'::public.zt_wo_status
       and w.address=q.address
       and w.service_place=q.service_place
       and w.pre_notes=q.notes
    from public.work_orders w
    join public.quotes q on q.id=t.quote_id
    where w.id=t.first_wo
  ) as header_preserved,
  (
    select count(*)=1
       and bool_and(wi.kind=qi.kind)
       and bool_and(wi.name=qi.name)
       and bool_and(wi.unit=qi.unit)
       and bool_and(wi.quantity=qi.quantity)
       and bool_and(wi.unit_price=qi.unit_price)
       and bool_and(coalesce(wi.notes,'')=coalesce(qi.notes,''))
    from public.work_order_items wi
    join public.quote_items qi
      on qi.quote_id=t.quote_id
     and qi.company_id=t.company_id
     and qi.position=0
    where wi.work_order_id=t.first_wo
      and wi.company_id=t.company_id
  ) as item_preserved,
  (
    t.draft_blocked
    and t.declined_blocked
    and t.first_wo is not null
    and t.retry_wo=t.first_wo
    and (select count(*) from public.work_orders w where w.company_id=t.company_id and w.quote_id=t.quote_id)=1
    and (
      select w.client_id=q.client_id and w.address=q.address and w.service_place=q.service_place and w.pre_notes=q.notes
      from public.work_orders w join public.quotes q on q.id=t.quote_id where w.id=t.first_wo
    )
    and (
      select count(*)=1 and bool_and(wi.name=qi.name) and bool_and(wi.quantity=qi.quantity) and bool_and(wi.unit_price=qi.unit_price)
      from public.work_order_items wi
      join public.quote_items qi on qi.quote_id=t.quote_id and qi.position=0
      where wi.work_order_id=t.first_wo
    )
  ) as passed
from zt_f03_quote_to_wo_test t;

rollback;
