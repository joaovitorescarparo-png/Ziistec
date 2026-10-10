-- ZiisTec · FIELD WORKFLOW V1 · Wave 4B — correções forward-only.
-- Corrige apenas ordenação da listagem e impede "adiar" para data passada.

create or replace function zt_private.zt_manage_post_sale_followup(
  p_followup uuid,
  p_status text default null,
  p_scheduled_for date default null,
  p_note text default null
) returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v public.post_sale_followups%rowtype;
  v_status text;
  v_note text:=nullif(btrim(coalesce(p_note,'')),'');
  v_body text;
begin
  if auth.uid() is null then raise exception 'Não autenticado' using errcode='28000'; end if;
  select * into v from public.post_sale_followups where id=p_followup for update;
  if not found then raise exception 'Pós-venda não encontrado' using errcode='P0002'; end if;
  if not zt_private.is_owner(v.company_id) then raise exception 'Somente o proprietário gerencia o pós-venda' using errcode='42501'; end if;
  perform zt_private.assert_operational_write_allowed(v.company_id);

  v_status:=coalesce(nullif(lower(btrim(coalesce(p_status,''))),''),v.status);
  if v_status not in ('pending','done','dismissed') then raise exception 'Status de pós-venda inválido' using errcode='22023'; end if;
  if v_note is not null and char_length(v_note)>5000 then raise exception 'Observação muito longa' using errcode='22023'; end if;
  if p_scheduled_for is not null and v_status<>'pending' then raise exception 'Somente pós-venda pendente pode ser adiado' using errcode='22023'; end if;
  if p_scheduled_for is not null and p_scheduled_for<current_date then raise exception 'Nova data do pós-venda não pode estar no passado' using errcode='22023'; end if;

  -- Estado terminal é idempotente e não é reaberto silenciosamente.
  if v.status in ('done','dismissed') then
    if v_status=v.status and p_scheduled_for is null and (v_note is null or v_note is not distinct from v.note) then return v.id; end if;
    raise exception 'Pós-venda já encerrado' using errcode='42501';
  end if;

  update public.post_sale_followups
     set status=v_status,
         due_on=coalesce(p_scheduled_for,due_on),
         note=coalesce(v_note,note),
         completed_at=case when v_status='done' then now() else null end,
         completed_by=case when v_status='done' then auth.uid() else null end,
         updated_at=now()
   where id=v.id;

  if v_status='done' and v.work_order_id is not null then
    v_body:=left('Pós-venda concluído · '||v.description||case when v_note is not null then E'\nObservação: '||v_note else '' end,10000);
    insert into public.work_order_reports(work_order_id,company_id,entry_type,body,author_id)
    values(v.work_order_id,v.company_id,'history',v_body,auth.uid());
  end if;
  return v.id;
end;
$$;
revoke all on function zt_private.zt_manage_post_sale_followup(uuid,text,date,text) from public,anon,authenticated;
grant execute on function zt_private.zt_manage_post_sale_followup(uuid,text,date,text) to service_role;

create or replace function public.zt_list_post_sale_followups(
  p_company uuid,
  p_scope text default 'open',
  p_limit integer default 50,
  p_offset integer default 0
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_scope text:=lower(btrim(coalesce(p_scope,'open')));
  v_limit integer:=least(greatest(coalesce(p_limit,50),1),100);
  v_offset integer:=least(greatest(coalesce(p_offset,0),0),5000);
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'Não autenticado' using errcode='28000'; end if;
  if p_company is null or not zt_private.is_owner(p_company) then raise exception 'Somente o proprietário consulta o pós-venda' using errcode='42501'; end if;
  if v_scope not in ('open','completed','all') then raise exception 'Filtro de pós-venda inválido' using errcode='22023'; end if;

  with rows as (
    select f.id,f.kind,f.description,f.due_on,f.status,f.completed_at,f.completed_by,f.note,f.policy_snapshot,
           f.client_id,coalesce(nullif(c.trade_name,''),c.name) client_name,c.phone,c.whatsapp,
           f.work_order_id,wo.number work_order_number,wo.service_place,
           f.warranty_id,w.ends_on warranty_ends_on,
           f.policy_id,p.name policy_name,
           eq.id equipment_id,eq.name equipment_name,eq.brand equipment_brand,eq.model equipment_model
      from public.post_sale_followups f
      join public.clients c on c.id=f.client_id and c.company_id=f.company_id
      left join public.work_orders wo on wo.id=f.work_order_id and wo.company_id=f.company_id
      left join public.warranties w on w.id=f.warranty_id and w.company_id=f.company_id
      left join public.post_sale_policies p on p.id=f.policy_id and p.company_id=f.company_id
      left join lateral (
        select e.id,e.name,e.brand,e.model
          from public.installed_equipment e
         where e.company_id=f.company_id
           and ((f.warranty_id is not null and e.warranty_id=f.warranty_id)
             or (f.warranty_id is null and f.work_order_id is not null and e.work_order_id=f.work_order_id))
         order by e.installed_at desc limit 1
      ) eq on true
     where f.company_id=p_company
       and (v_scope='all' or (v_scope='open' and f.status='pending') or (v_scope='completed' and f.status in ('done','dismissed')))
     order by case when f.status='pending' then 0 else 1 end,f.due_on asc,f.created_at asc
     limit v_limit+1 offset v_offset
  ), trimmed as (
    select * from rows limit v_limit
  )
  select jsonb_build_object(
    'items',coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'id',id,'kind',kind,'description',description,'scheduled_for',due_on,'status',status,
      'completed_at',completed_at,'completed_by',completed_by,'note',note,'policy_snapshot',policy_snapshot,
      'client_id',client_id,'client_name',client_name,'phone',phone,'whatsapp',whatsapp,
      'work_order_id',work_order_id,'work_order_number',work_order_number,'service_place',service_place,
      'warranty_id',warranty_id,'warranty_ends_on',warranty_ends_on,'policy_id',policy_id,'policy_name',policy_name,
      'equipment_id',equipment_id,'equipment_name',equipment_name,'equipment_brand',equipment_brand,'equipment_model',equipment_model
    )) order by due_on,id) from trimmed),'[]'::jsonb),
    'has_more',(select count(*) from rows)>v_limit,
    'next_offset',case when (select count(*) from rows)>v_limit then v_offset+v_limit else null end
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.zt_list_post_sale_followups(uuid,text,integer,integer) from public,anon;
grant execute on function public.zt_list_post_sale_followups(uuid,text,integer,integer) to authenticated,service_role;

notify pgrst,'reload schema';
