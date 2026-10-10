-- ZiisTec blocker regression F01 — matriz do snapshot comercial aprovado.
-- SOMENTE staging/homologação. Tudo termina em ROLLBACK.
-- Cobre: desconto, acréscimo, ambos, nenhum, item grátis, adicional owner,
-- adicional pendente + precificação, OS direta e visita de garantia.

begin;

create temp table zt_f01_ctx (
  owner_id uuid,
  tech_id uuid,
  company_id uuid,
  client_id uuid,
  service_id uuid,
  origin_wo_id uuid,
  warranty_id uuid
) on commit drop;

create temp table zt_f01_matrix (
  case_name text primary key,
  quote_id uuid not null,
  discount numeric(12,2) not null,
  surcharge numeric(12,2) not null,
  add_free_item boolean not null default false,
  extra_mode text not null default 'none',
  expected_snapshot numeric(12,2) not null,
  expected_billed numeric(12,2) not null,
  wo_id uuid,
  first_entry uuid,
  final_entry uuid,
  pending_before_resolve boolean default false,
  no_charge_before_resolve boolean default false
) on commit drop;

grant select,update on zt_f01_ctx,zt_f01_matrix to authenticated;

insert into zt_f01_ctx(owner_id,tech_id,company_id,client_id,service_id,origin_wo_id,warranty_id)
select
  m.user_id,
  (select u.id from auth.users u where u.id<>m.user_id order by u.id limit 1),
  gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()
from public.company_members m
where m.role='owner' and m.status='active'
limit 1;

do $$
begin
  if not exists(select 1 from zt_f01_ctx where owner_id is not null and tech_id is not null) then
    raise exception 'F01_MATRIX_NEEDS_OWNER_AND_SECOND_AUTH_USER';
  end if;
end $$;

insert into zt_f01_matrix(case_name,quote_id,discount,surcharge,add_free_item,extra_mode,expected_snapshot,expected_billed) values
  ('discount_only',gen_random_uuid(),100,0,false,'none',900,900),
  ('surcharge_only',gen_random_uuid(),0,100,false,'none',1100,1100),
  ('discount_and_surcharge',gen_random_uuid(),100,50,false,'none',950,950),
  ('no_adjustment',gen_random_uuid(),0,0,false,'none',1000,1000),
  ('free_item',gen_random_uuid(),0,0,true,'none',1000,1000),
  ('owner_extra',gen_random_uuid(),100,0,false,'owner_extra',900,1100),
  ('pending_extra',gen_random_uuid(),100,0,false,'pending_extra',900,1100);

select set_config('request.jwt.claim.sub',(select owner_id::text from zt_f01_ctx),true);

insert into public.companies(id,name,has_team)
select company_id,'__F01_MATRIX__',true from zt_f01_ctx;
insert into public.subscriptions(company_id,status,current_period_start,current_period_end)
select company_id,'trial'::public.zt_sub_status,current_date,current_date+14 from zt_f01_ctx;
insert into public.company_members(company_id,user_id,role,status)
select company_id,owner_id,'owner'::public.zt_role,'active'::public.zt_member_status from zt_f01_ctx;
insert into public.company_members(company_id,user_id,role,status)
select company_id,tech_id,'technician'::public.zt_role,'active'::public.zt_member_status from zt_f01_ctx;
insert into public.clients(id,company_id,name)
select client_id,company_id,'__F01_CLIENT__' from zt_f01_ctx;
insert into public.services(id,company_id,name,unit,price,cost,warranty_days,active)
select service_id,company_id,'__F01_WARRANTY_SERVICE__','unidade',500,0,30,true from zt_f01_ctx;

insert into public.quotes(id,company_id,number,client_id,status,issue_date,discount,surcharge,created_by)
select m.quote_id,c.company_id,left('__F01_'||m.case_name,50),c.client_id,'approved'::public.zt_quote_status,current_date,m.discount,m.surcharge,c.owner_id
from zt_f01_matrix m cross join zt_f01_ctx c;

insert into public.quote_items(quote_id,company_id,kind,name,unit,quantity,unit_price,unit_cost,position)
select m.quote_id,c.company_id,'free'::public.zt_item_kind,'Base aprovada','unidade',1,1000,0,0
from zt_f01_matrix m cross join zt_f01_ctx c;
insert into public.quote_items(quote_id,company_id,kind,name,unit,quantity,unit_price,unit_cost,position)
select m.quote_id,c.company_id,'free'::public.zt_item_kind,'Item gratuito','unidade',1,0,0,1
from zt_f01_matrix m cross join zt_f01_ctx c
where m.add_free_item;

-- Converte todas as quotes usando a autoridade canônica. O caso pendente fica atribuído ao técnico.
set local role authenticated;
do $$
declare r record; c zt_f01_ctx%rowtype; v_wo uuid;
begin
  select * into c from zt_f01_ctx;
  for r in select * from zt_f01_matrix order by case_name loop
    v_wo:=public.zt_create_work_order_from_quote(
      r.quote_id,
      case when r.extra_mode='pending_extra' then c.tech_id else c.owner_id end,
      null,null
    );
    update zt_f01_matrix set wo_id=v_wo where case_name=r.case_name;
  end loop;
end $$;

-- Tenta adulterar snapshot pela Data API: deve permanecer imutável.
update public.work_orders w
set approved_total=1
from zt_f01_matrix m
where m.case_name='discount_only' and w.id=m.wo_id;

-- Finaliza casos normais e adicional já precificado pelo owner.
do $$
declare r record; v_entry uuid; v_additions jsonb;
begin
  for r in select * from zt_f01_matrix where extra_mode in ('none','owner_extra') order by case_name loop
    v_additions:=case when r.extra_mode='owner_extra'
      then jsonb_build_array(jsonb_build_object('name','Adicional aprovado','unit','unidade','quantity',1,'unit_price',200))
      else '[]'::jsonb end;
    v_entry:=public.zt_finalize_work_order_atomic(r.wo_id,'__F01_MATRIX__',null,null,7,'[]'::jsonb,v_additions);
    update zt_f01_matrix set first_entry=v_entry,final_entry=v_entry where case_name=r.case_name;
  end loop;
end $$;

-- Técnico inclui adicional sem preço. Deve concluir execução, mas bloquear cobrança.
select set_config('request.jwt.claim.sub',(select tech_id::text from zt_f01_ctx),true);
do $$
declare r zt_f01_matrix%rowtype; v_entry uuid; v_pending boolean; v_count int;
begin
  select * into r from zt_f01_matrix where case_name='pending_extra';
  v_entry:=public.zt_finalize_work_order_atomic(
    r.wo_id,'__F01_PENDING__',null,null,7,'[]'::jsonb,
    jsonb_build_array(jsonb_build_object('name','Adicional pendente','unit','unidade','quantity',1))
  );
  select pending_pricing into v_pending from public.work_orders where id=r.wo_id;
  select count(*) into v_count from public.financial_entries where work_order_id=r.wo_id;
  update zt_f01_matrix
     set first_entry=v_entry,
         pending_before_resolve=coalesce(v_pending,false),
         no_charge_before_resolve=(v_count=0)
   where case_name='pending_extra';
end $$;

-- Owner precifica o adicional pendente em R$ 200; somente então cobrança deve nascer.
select set_config('request.jwt.claim.sub',(select owner_id::text from zt_f01_ctx),true);
do $$
declare r zt_f01_matrix%rowtype; v_item uuid; v_entry uuid;
begin
  select * into r from zt_f01_matrix where case_name='pending_extra';
  select id into v_item from public.work_order_items where work_order_id=r.wo_id and price_pending limit 1;
  if v_item is null then raise exception 'F01_PENDING_ITEM_NOT_CREATED'; end if;
  v_entry:=public.zt_resolve_work_order_pricing(r.wo_id,jsonb_build_array(jsonb_build_object('id',v_item,'price',200)),7);
  update zt_f01_matrix set final_entry=v_entry where case_name='pending_extra';
end $$;

-- OS direta: sem quote/snapshot, preserva soma tradicional dos itens = R$ 500.
create temp table zt_f01_direct_result(wo_id uuid,entry_id uuid,billed numeric(12,2)) on commit drop;
grant select,insert,update on zt_f01_direct_result to authenticated;
do $$
declare c zt_f01_ctx%rowtype; v_wo uuid; v_entry uuid;
begin
  select * into c from zt_f01_ctx;
  v_wo:=public.zt_save_work_order_idempotent(
    c.company_id,null,gen_random_uuid(),
    jsonb_build_object('client_id',c.client_id,'assigned_to',c.owner_id,'status','unscheduled','request','__F01_DIRECT__'),
    jsonb_build_array(jsonb_build_object('kind','free','name','Direta','unit','unidade','quantity',2,'unit_price',250,'unit_cost',0))
  );
  v_entry:=public.zt_finalize_work_order_atomic(v_wo,'__F01_DIRECT__',null,null,7,'[]'::jsonb,'[]'::jsonb);
  insert into zt_f01_direct_result values(v_wo,v_entry,(select amount from public.financial_entries where id=v_entry));
end $$;
reset role;

-- Prepara uma garantia válida e cria uma visita em garantia pelo fluxo real.
insert into public.work_orders(id,company_id,number,client_id,assigned_to,status,created_by)
select origin_wo_id,company_id,'__F01-ORIGIN__',client_id,owner_id,'done'::public.zt_wo_status,owner_id from zt_f01_ctx;
insert into public.work_order_items(work_order_id,company_id,kind,service_id,name,unit,quantity,unit_price,unit_cost)
select origin_wo_id,company_id,'service'::public.zt_item_kind,service_id,'Serviço origem','unidade',1,500,0 from zt_f01_ctx;
insert into public.warranties(id,company_id,client_id,work_order_id,kind,service_id,description,starts_on,ends_on)
select warranty_id,company_id,client_id,origin_wo_id,'service'::public.zt_warranty_kind,service_id,'Garantia F01',current_date-1,current_date+30 from zt_f01_ctx;

set local role authenticated;
create temp table zt_f01_warranty_result(wo_id uuid,entry_id uuid,financial_count int) on commit drop;
grant select,insert on zt_f01_warranty_result to authenticated;
do $$
declare c zt_f01_ctx%rowtype; v_wo uuid; v_entry uuid; v_count int;
begin
  select * into c from zt_f01_ctx;
  v_wo:=public.zt_save_work_order_idempotent(
    c.company_id,null,gen_random_uuid(),
    jsonb_build_object(
      'client_id',c.client_id,'assigned_to',c.owner_id,'status','unscheduled','request','__F01_WARRANTY__',
      'is_warranty_visit',true,'warranty_id',c.warranty_id,'origin_wo_id',c.origin_wo_id
    ),
    jsonb_build_array(jsonb_build_object('kind','free','name','Visita garantia','unit','unidade','quantity',1,'unit_price',500,'unit_cost',0))
  );
  v_entry:=public.zt_finalize_work_order_atomic(v_wo,'__F01_WARRANTY__',null,null,7,'[]'::jsonb,'[]'::jsonb);
  select count(*) into v_count from public.financial_entries where work_order_id=v_wo;
  insert into zt_f01_warranty_result values(v_wo,v_entry,v_count);
end $$;
reset role;

-- Resultado por caso de orçamento.
select
  m.case_name,
  w.approved_subtotal,
  w.approved_discount,
  w.approved_surcharge,
  w.approved_total,
  m.expected_snapshot,
  f.amount as billed_amount,
  m.expected_billed,
  m.pending_before_resolve,
  m.no_charge_before_resolve,
  (
    w.approved_subtotal=1000
    and w.approved_discount=m.discount
    and w.approved_surcharge=m.surcharge
    and w.approved_total=m.expected_snapshot
    and f.amount=m.expected_billed
    and (m.extra_mode<>'pending_extra' or (m.first_entry is null and m.pending_before_resolve and m.no_charge_before_resolve))
  ) as passed
from zt_f01_matrix m
join public.work_orders w on w.id=m.wo_id
left join public.financial_entries f on f.id=m.final_entry
order by m.case_name;

select
  'direct_work_order' as case_name,
  d.billed as billed_amount,
  500::numeric as expected_billed,
  (d.billed=500 and w.approved_total is null) as passed
from zt_f01_direct_result d join public.work_orders w on w.id=d.wo_id;

select
  'warranty_visit' as case_name,
  r.entry_id,
  r.financial_count,
  (r.entry_id is null and r.financial_count=0) as passed
from zt_f01_warranty_result r;

rollback;
