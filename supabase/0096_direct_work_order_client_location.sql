-- ZiisTec · Bloco 4 — OS direta aceita local cadastrado do cliente.
--
-- Até aqui só a conversão de orçamento (zt_create_work_order_from_quote) gravava
-- client_location_id; a Nova OS ignorava o campo. A regra da 0086 continua: client_locations é a
-- autoridade do local, a FK composta prova empresa + cliente + local, service_place/address seguem
-- como texto histórico e nenhum vínculo é inferido por similaridade textual.
--
-- Corpo idêntico ao vigente (0035) exceto pelo local:
--   * insert grava client_location_id quando informado;
--   * update só troca o local quando a chave vem no payload; se o cliente mudar sem novo local,
--     o vínculo antigo é limpo para não apontar para local de outro cliente;
--   * local informado precisa pertencer à mesma empresa e ao mesmo cliente da OS.

create or replace function zt_private.zt_save_work_order(p_company uuid, p_wo uuid, p_row jsonb, p_items jsonb default '[]'::jsonb)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare v_uid uuid:=auth.uid(); v_id uuid; v_number text; item jsonb;
  v_client uuid:=nullif(p_row->>'client_id','')::uuid;
  v_location uuid:=nullif(p_row->>'client_location_id','')::uuid;
begin
  if v_uid is null then raise exception 'Não autenticado' using errcode='28000'; end if;
  if not public.zt_is_owner(p_company) then raise exception 'Somente o proprietário salva ordens de serviço por este fluxo' using errcode='42501'; end if;
  if jsonb_typeof(coalesce(p_items,'[]'::jsonb)) <> 'array' then raise exception 'Itens inválidos'; end if;
  if jsonb_array_length(coalesce(p_items,'[]'::jsonb)) > 500 then raise exception 'Itens demais na OS'; end if;
  if v_location is not null and not exists(
    select 1 from public.client_locations l
     where l.id=v_location and l.company_id=p_company and l.client_id=v_client
  ) then
    raise exception 'Local não pertence ao cliente desta OS' using errcode='23503';
  end if;
  if p_wo is null then
    v_number:=zt_private.zt_next_number(p_company,'work_order','OS');
    insert into public.work_orders(company_id,number,client_id,quote_id,assigned_to,status,scheduled_date,scheduled_time,address,service_place,request,pre_notes,pending_note,extra_cost,needs_return,warranty_id,origin_wo_id,is_warranty_visit,problem_report,created_by,client_location_id)
    values(p_company,v_number,v_client,nullif(p_row->>'quote_id','')::uuid,coalesce(nullif(p_row->>'assigned_to','')::uuid,v_uid),coalesce(nullif(p_row->>'status','')::public.zt_wo_status,'unscheduled'),nullif(p_row->>'scheduled_date','')::date,nullif(p_row->>'scheduled_time','')::time,nullif(p_row->>'address',''),nullif(p_row->>'service_place',''),nullif(p_row->>'request',''),nullif(p_row->>'pre_notes',''),nullif(p_row->>'pending_note',''),coalesce((p_row->>'extra_cost')::numeric,0),coalesce((p_row->>'needs_return')::boolean,false),nullif(p_row->>'warranty_id','')::uuid,nullif(p_row->>'origin_wo_id','')::uuid,coalesce((p_row->>'is_warranty_visit')::boolean,false),nullif(p_row->>'problem_report',''),v_uid,v_location) returning id into v_id;
  else
    select id into v_id from public.work_orders where id=p_wo and company_id=p_company for update;
    if v_id is null then raise exception 'Ordem de serviço não encontrada' using errcode='42501'; end if;
    if exists(select 1 from public.work_orders where id=v_id and status='done') then raise exception 'OS concluída não pode ser regravada por este fluxo' using errcode='42501'; end if;
    update public.work_orders set client_id=v_client,quote_id=nullif(p_row->>'quote_id','')::uuid,assigned_to=coalesce(nullif(p_row->>'assigned_to','')::uuid,assigned_to),status=coalesce(nullif(p_row->>'status','')::public.zt_wo_status,status),scheduled_date=nullif(p_row->>'scheduled_date','')::date,scheduled_time=nullif(p_row->>'scheduled_time','')::time,address=nullif(p_row->>'address',''),service_place=nullif(p_row->>'service_place',''),request=nullif(p_row->>'request',''),pre_notes=nullif(p_row->>'pre_notes',''),pending_note=nullif(p_row->>'pending_note',''),extra_cost=coalesce((p_row->>'extra_cost')::numeric,0),needs_return=coalesce((p_row->>'needs_return')::boolean,false),warranty_id=nullif(p_row->>'warranty_id','')::uuid,origin_wo_id=nullif(p_row->>'origin_wo_id','')::uuid,is_warranty_visit=coalesce((p_row->>'is_warranty_visit')::boolean,false),problem_report=nullif(p_row->>'problem_report',''),
      client_location_id=case
        when p_row ? 'client_location_id' then v_location
        when v_client is distinct from client_id then null
        else client_location_id
      end,
      updated_at=now() where id=v_id;
    delete from public.work_order_items where work_order_id=v_id;
  end if;
  for item in select value from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) loop
    insert into public.work_order_items(work_order_id,company_id,kind,service_id,product_id,name,unit,quantity,unit_price,unit_cost,notes,is_extra,price_pending)
    values(v_id,p_company,coalesce(nullif(item->>'kind','')::public.zt_item_kind,'free'),nullif(item->>'service_id','')::uuid,nullif(item->>'product_id','')::uuid,left(coalesce(nullif(item->>'name',''),'Item'),500),left(coalesce(nullif(item->>'unit',''),'unidade'),50),coalesce((item->>'quantity')::numeric,1),coalesce((item->>'unit_price')::numeric,0),coalesce((item->>'unit_cost')::numeric,0),nullif(item->>'notes',''),coalesce((item->>'is_extra')::boolean,false),coalesce((item->>'price_pending')::boolean,false));
  end loop;
  return v_id;
end
$$;
