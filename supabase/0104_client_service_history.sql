-- ZiisTec · Bloco 4 — histórico técnico do cliente e por local (client_locations).
--
-- Portado da branch blocks-3-4-os-history-receipt (antiga 0098) com uma restrição deliberada: nesta
-- linha beta nada pode ampliar o que o técnico enxerga. Por isso:
--   * a policy client_locations_visible NÃO é alterada (a antiga 0098 abria o local pela OS atribuída);
--   * o histórico do cliente/local é exclusivo do proprietário;
--   * o detalhe de uma OS vale para o proprietário ou para o técnico atribuído àquela OS (o que ele já
--     lê pelas tabelas), sem o "contexto de local" que mostrava OS de outros técnicos; preço só para o
--     proprietário. Liberar histórico do local ao técnico fica para a decisão do P1 de técnico.
-- client_locations continua sendo a única entidade de local (sem tabela de condomínio).

create or replace function public.zt_client_service_history(
  p_client uuid,
  p_location uuid default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();
  v_company uuid;
  v_owner boolean;
  v_limit integer:=least(greatest(coalesce(p_limit,50),1),200);
  v_items jsonb;
begin
  if v_uid is null then raise exception 'Não autenticado' using errcode='28000'; end if;
  select c.company_id into v_company from public.clients c where c.id=p_client and c.deleted_at is null;
  if v_company is null then raise exception 'Cliente não encontrado' using errcode='P0002'; end if;
  v_owner:=public.zt_is_owner(v_company);
  if not v_owner then
    raise exception 'Histórico do cliente é exclusivo do proprietário' using errcode='42501';
  end if;
  if p_location is not null and not exists(
    select 1 from public.client_locations l
     where l.id=p_location and l.company_id=v_company and l.client_id=p_client
  ) then
    raise exception 'Local não pertence ao cliente' using errcode='22023';
  end if;

  select coalesce(jsonb_agg(x.item order by x.sort_date desc, x.number desc),'[]'::jsonb) into v_items
  from (
    select coalesce((w.completed_at at time zone 'America/Sao_Paulo')::date, w.scheduled_date, (w.created_at at time zone 'America/Sao_Paulo')::date) as sort_date,
           w.number,
           jsonb_strip_nulls(jsonb_build_object(
             'work_order_id',w.id,
             'number',w.number,
             'status',w.status::text,
             'service_date',coalesce((w.completed_at at time zone 'America/Sao_Paulo')::date, w.scheduled_date, (w.created_at at time zone 'America/Sao_Paulo')::date),
             'completed_at',w.completed_at,
             'title',coalesce(
               nullif(btrim(w.request),''),
               (select string_agg(i.name,' · ' order by i.name) from public.work_order_items i
                 where i.work_order_id=w.id and i.company_id=w.company_id),
               'Atendimento'),
             'location',case when l.id is null then null else jsonb_build_object('id',l.id,'name',l.name) end,
             'service_place',w.service_place,
             'technician',(select p.full_name from public.profiles p where p.id=w.assigned_to),
             'completed_by',(select p.full_name from public.profiles p where p.id=coalesce(w.completed_by,(
               select h.author_id from public.work_order_reports h
                where h.work_order_id=w.id and h.company_id=w.company_id
                  and h.entry_type='history' and h.body='Serviço concluído'
                order by h.created_at, h.id limit 1))),
             'needs_return',w.needs_return,
             'is_warranty_visit',w.is_warranty_visit,
             'is_mine',w.assigned_to=v_uid,
             'billed_amount',case when v_owner then (
               select f.amount from public.financial_entries f
                where f.id=w.billing_entry_id and f.company_id=w.company_id and f.deleted_at is null) end,
             'paid',case when v_owner then (
               select f.paid from public.financial_entries f
                where f.id=w.billing_entry_id and f.company_id=w.company_id and f.deleted_at is null) end
           )) as item
      from public.work_orders w
      left join public.client_locations l on l.id=w.client_location_id and l.company_id=w.company_id
     where w.company_id=v_company and w.client_id=p_client and w.deleted_at is null and w.status<>'canceled'
       and (p_location is null or w.client_location_id=p_location)
     order by sort_date desc, w.number desc
     limit v_limit
  ) x;
  return v_items;
end;
$$;

revoke all on function public.zt_client_service_history(uuid,uuid,integer) from public, anon;
grant execute on function public.zt_client_service_history(uuid,uuid,integer) to authenticated;

create or replace function public.zt_work_order_history_detail(p_wo uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();
  v_wo public.work_orders%rowtype;
  v_owner boolean;
  v_assigned boolean;
  v_entry public.financial_entries%rowtype;
  v_result jsonb;
begin
  if v_uid is null then raise exception 'Não autenticado' using errcode='28000'; end if;
  select w.* into v_wo from public.work_orders w where w.id=p_wo and w.deleted_at is null;
  if not found then raise exception 'OS não encontrada' using errcode='P0002'; end if;
  v_owner:=public.zt_is_owner(v_wo.company_id);
  v_assigned:=public.zt_wo_is_mine(v_wo.id);
  if not v_owner and not v_assigned then
    raise exception 'Sem permissão para esta OS' using errcode='42501';
  end if;

  v_result:=jsonb_build_object(
    'viewer',jsonb_build_object(
      'role',case when v_owner then 'owner' else 'technician' end,
      'context',case when v_owner then 'owner' else 'assigned' end),
    'work_order',jsonb_strip_nulls(jsonb_build_object(
      'id',v_wo.id,'number',v_wo.number,'status',v_wo.status::text,
      'scheduled_date',v_wo.scheduled_date,'scheduled_time',v_wo.scheduled_time,
      'started_at',v_wo.started_at,'completed_at',v_wo.completed_at,
      'request',v_wo.request,'problem_report',v_wo.problem_report,'pending_note',v_wo.pending_note,
      'needs_return',v_wo.needs_return,'is_warranty_visit',v_wo.is_warranty_visit,
      'service_place',v_wo.service_place,'address',v_wo.address)),
    'location',(select jsonb_build_object('id',l.id,'name',l.name,'address',l.address)
                  from public.client_locations l where l.id=v_wo.client_location_id and l.company_id=v_wo.company_id),
    'technician',(select jsonb_build_object('id',p.id,'name',p.full_name) from public.profiles p where p.id=v_wo.assigned_to),
    'completed_by',(select jsonb_build_object('id',p.id,'name',p.full_name) from public.profiles p
                     where p.id=coalesce(v_wo.completed_by,(
                       select h.author_id from public.work_order_reports h
                        where h.work_order_id=v_wo.id and h.company_id=v_wo.company_id
                          and h.entry_type='history' and h.body='Serviço concluído'
                        order by h.created_at, h.id limit 1))),
    'reports',coalesce((select jsonb_agg(jsonb_build_object(
                  'body',r.body,'created_at',r.created_at,
                  'author',(select p.full_name from public.profiles p where p.id=r.author_id)) order by r.created_at, r.id)
                from public.work_order_reports r
               where r.work_order_id=v_wo.id and r.company_id=v_wo.company_id and r.entry_type='report'),'[]'::jsonb),
    'checklist',coalesce((select jsonb_agg(jsonb_build_object('text',c.text,'done',c.done,'required',c.required) order by c.position, c.id)
                from public.work_order_checklists c where c.work_order_id=v_wo.id and c.company_id=v_wo.company_id),'[]'::jsonb),
    'materials',coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('name',m.name,'quantity',m.quantity,'serial_number',m.serial_number)) order by m.created_at, m.id)
                from public.work_order_materials m where m.work_order_id=v_wo.id and m.company_id=v_wo.company_id),'[]'::jsonb),
    'items',coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                  'name',i.name,'quantity',i.quantity,'unit',i.unit,'kind',i.kind::text,'is_extra',i.is_extra,
                  'unit_price',case when v_owner then i.unit_price end)) order by i.id)
                from public.work_order_items i where i.work_order_id=v_wo.id and i.company_id=v_wo.company_id),'[]'::jsonb),
    'warranties',coalesce((select jsonb_agg(jsonb_build_object('kind',g.kind::text,'description',g.description,'starts_on',g.starts_on,'ends_on',g.ends_on) order by g.ends_on, g.id)
                from public.warranties g where g.work_order_id=v_wo.id and g.company_id=v_wo.company_id and g.deleted_at is null),'[]'::jsonb),
    'returns',coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                  'reason',t.reason,'priority',t.priority,'expected_return_date',t.expected_return_date,
                  'returned_at',t.returned_at,'resolved_at',t.resolved_at,'created_at',t.created_at)) order by t.created_at, t.id)
                from public.work_order_returns t where t.work_order_id=v_wo.id and t.company_id=v_wo.company_id),'[]'::jsonb),
    'evidence_count',(select count(*) from public.attachments a where a.work_order_id=v_wo.id and a.company_id=v_wo.company_id)
  );

  -- Arquivo só para quem o Storage também libera (proprietário ou responsável pela OS).
  if v_owner or v_assigned then
    v_result:=v_result || jsonb_build_object('evidence',coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                  'id',a.id,'bucket',a.bucket,'path',a.path,'content_type',a.content_type,
                  'media_kind',a.media_kind,'media_stage',a.media_stage,'caption',a.caption,'created_at',a.created_at)) order by a.created_at, a.id)
                from public.attachments a where a.work_order_id=v_wo.id and a.company_id=v_wo.company_id),'[]'::jsonb));
  end if;

  if v_owner then
    if v_wo.billing_entry_id is not null then
      select f.* into v_entry from public.financial_entries f
       where f.id=v_wo.billing_entry_id and f.company_id=v_wo.company_id and f.deleted_at is null;
    end if;
    v_result:=v_result || jsonb_build_object('financial',jsonb_strip_nulls(jsonb_build_object(
      'approved_subtotal',v_wo.approved_subtotal,'approved_discount',v_wo.approved_discount,
      'approved_surcharge',v_wo.approved_surcharge,'approved_total',v_wo.approved_total,
      'billed_amount',v_entry.amount,'paid',v_entry.paid,'paid_at',v_entry.paid_at,
      'payment_method',v_entry.payment_method,'due_date',v_entry.due_date)));
  end if;

  return v_result;
end;
$$;

revoke all on function public.zt_work_order_history_detail(uuid) from public, anon;
grant execute on function public.zt_work_order_history_detail(uuid) to authenticated;
