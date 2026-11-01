-- ZiisTec · FIELD WORKFLOW V1 · Wave 2 — Relatório de Atendimento.
--
-- Reutiliza work_order_reports + attachments. Não cria sistema paralelo de histórico.
-- O snapshot é um efeito operacional da conclusão da OS e não movimenta estoque,
-- não cria financial_entries e não altera field_sales/preços.

-- -----------------------------------------------------------------------------
-- Evidências selecionadas para o relatório. Opt-in evita PDFs pesados e mantém
-- anexos antigos válidos sem incluí-los automaticamente em documentos novos.
alter table public.attachments
  add column if not exists include_in_service_report boolean not null default false;

comment on column public.attachments.include_in_service_report is
  'Foto/evidência selecionada explicitamente para o Relatório de Atendimento da OS.';

-- A categoria Outro também pode receber PDF/documento operacional.
update storage.buckets
   set allowed_mime_types = array[
     'image/jpeg','image/png','image/webp','image/heic','image/heif',
     'video/mp4','video/quicktime','video/webm','application/pdf'
   ]::text[]
 where id='zt-work-orders';

-- -----------------------------------------------------------------------------
-- work_order_reports continua sendo a única tabela de relato/histórico/relatório.
alter table public.work_order_reports
  add column if not exists report_version integer,
  add column if not exists is_active boolean not null default true,
  add column if not exists snapshot jsonb,
  add column if not exists client_id uuid,
  add column if not exists finalized_at timestamptz;

alter table public.work_order_reports drop constraint if exists work_order_reports_entry_type_check;
alter table public.work_order_reports drop constraint if exists wo_reports_text_bounds;
alter table public.work_order_reports
  add constraint work_order_reports_entry_type_check
  check (entry_type in ('report','history','service_report'));
alter table public.work_order_reports
  add constraint wo_reports_text_bounds
  check (entry_type in ('report','history','service_report') and length(body) <= 10000);

alter table public.work_order_reports drop constraint if exists work_order_reports_service_snapshot_ck;
alter table public.work_order_reports
  add constraint work_order_reports_service_snapshot_ck check (
    (entry_type <> 'service_report' and report_version is null and snapshot is null)
    or
    (
      entry_type='service_report'
      and report_version is not null and report_version >= 1
      and snapshot is not null and jsonb_typeof(snapshot)='object'
      and octet_length(snapshot::text) <= 750000
      and client_id is not null
      and finalized_at is not null
    )
  );

create unique index if not exists uq_work_order_service_report_version
  on public.work_order_reports(work_order_id,report_version)
  where entry_type='service_report';

create unique index if not exists uq_work_order_service_report_active
  on public.work_order_reports(work_order_id)
  where entry_type='service_report' and is_active;

create index if not exists idx_work_order_reports_client_service
  on public.work_order_reports(company_id,client_id,finalized_at desc)
  where entry_type='service_report' and is_active;

-- -----------------------------------------------------------------------------
-- Seleção explícita de até 6 evidências por OS. O lock da OS serializa a seleção
-- com a finalização: depois de concluída, o snapshot não muda.
create or replace function public.zt_set_service_report_evidence(
  p_attachment uuid,
  p_include boolean
) returns boolean
language plpgsql
security definer
set search_path=''
as $$
declare
  v_attachment public.attachments%rowtype;
  v_wo public.work_orders%rowtype;
  v_uid uuid := auth.uid();
  v_allowed boolean := false;
  v_selected integer := 0;
begin
  if v_uid is null then raise exception 'Não autenticado' using errcode='28000'; end if;
  if p_attachment is null then raise exception 'Anexo obrigatório' using errcode='22023'; end if;

  select a.* into v_attachment
    from public.attachments a
   where a.id=p_attachment and a.work_order_id is not null;
  if not found then raise exception 'Evidência não encontrada' using errcode='P0002'; end if;

  select w.* into v_wo
    from public.work_orders w
   where w.id=v_attachment.work_order_id
     and w.company_id=v_attachment.company_id
     and w.deleted_at is null
   for update;
  if not found then raise exception 'OS não encontrada' using errcode='P0002'; end if;
  if v_wo.status in ('done','canceled') then
    raise exception 'A seleção de evidências fecha junto com a OS' using errcode='42501';
  end if;

  v_allowed := public.zt_is_owner(v_wo.company_id) or (
    v_wo.assigned_to=v_uid and exists(
      select 1 from public.company_members m
       where m.company_id=v_wo.company_id
         and m.user_id=v_uid
         and m.role='technician'
         and m.status='active'
    )
  );
  if not v_allowed then raise exception 'Sem permissão para esta OS' using errcode='42501'; end if;

  if coalesce(p_include,false) and not coalesce(v_attachment.include_in_service_report,false) then
    select count(*) into v_selected
      from public.attachments a
     where a.work_order_id=v_wo.id
       and a.company_id=v_wo.company_id
       and a.include_in_service_report;
    if v_selected >= 6 then
      raise exception 'Selecione no máximo 6 evidências para o relatório' using errcode='23514';
    end if;
  end if;

  update public.attachments
     set include_in_service_report=coalesce(p_include,false)
   where id=v_attachment.id;
  return coalesce(p_include,false);
end;
$$;
revoke all on function public.zt_set_service_report_evidence(uuid,boolean) from public,anon;
grant execute on function public.zt_set_service_report_evidence(uuid,boolean) to authenticated,service_role;

-- -----------------------------------------------------------------------------
-- Snapshot inicial imutável. É chamado somente pelo trigger diferido da OS.
-- Deliberadamente não seleciona unit_cost, custo privado, margem ou fornecedor.
create or replace function zt_private.zt_create_initial_service_report(p_wo uuid)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_wo public.work_orders%rowtype;
  v_company public.companies%rowtype;
  v_client public.clients%rowtype;
  v_tech public.profiles%rowtype;
  v_job_title text;
  v_entry public.financial_entries%rowtype;
  v_items jsonb := '[]'::jsonb;
  v_materials jsonb := '[]'::jsonb;
  v_warranties jsonb := '[]'::jsonb;
  v_evidence jsonb := '[]'::jsonb;
  v_technical jsonb := null;
  v_snapshot jsonb;
  v_report_id uuid;
  v_billable_total numeric(12,2) := 0;
  v_payment_status text;
  v_payment_label text;
begin
  select w.* into v_wo from public.work_orders w where w.id=p_wo;
  if not found or v_wo.status <> 'done' then return null; end if;

  select r.id into v_report_id
    from public.work_order_reports r
   where r.work_order_id=p_wo
     and r.entry_type='service_report'
     and r.report_version=1
   limit 1;
  if found then return v_report_id; end if;

  select c.* into v_company from public.companies c where c.id=v_wo.company_id;
  select c.* into v_client from public.clients c where c.id=v_wo.client_id and c.company_id=v_wo.company_id;
  if v_wo.assigned_to is not null then
    select p.* into v_tech from public.profiles p where p.id=v_wo.assigned_to;
    select m.job_title into v_job_title
      from public.company_members m
     where m.company_id=v_wo.company_id and m.user_id=v_wo.assigned_to
     order by m.created_at desc limit 1;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',i.id,
    'kind',i.kind,
    'service_id',i.service_id,
    'product_id',i.product_id,
    'name',i.name,
    'unit',i.unit,
    'quantity',i.quantity,
    'unit_price',i.unit_price,
    'is_extra',i.is_extra,
    'price_pending',i.price_pending,
    'notes',i.notes,
    'warranty_policy',i.warranty_policy,
    'warranty_override_days',i.warranty_override_days,
    'warranty_override_months',i.warranty_override_months
  ) order by i.id),'[]'::jsonb)
    into v_items
    from public.work_order_items i
   where i.work_order_id=p_wo and i.company_id=v_wo.company_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',m.id,
    'product_id',m.product_id,
    'name',m.name,
    'quantity',m.quantity,
    'serial_number',m.serial_number,
    'warranty_policy',m.warranty_policy,
    'warranty_override_months',m.warranty_override_months,
    'created_at',m.created_at
  ) order by m.created_at,m.id),'[]'::jsonb)
    into v_materials
    from public.work_order_materials m
   where m.work_order_id=p_wo and m.company_id=v_wo.company_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',g.id,
    'kind',g.kind,
    'service_id',g.service_id,
    'product_id',g.product_id,
    'description',g.description,
    'service_place',g.service_place,
    'starts_on',g.starts_on,
    'ends_on',g.ends_on,
    'serial_number',g.serial_number,
    'source',g.source
  ) order by g.ends_on,g.id),'[]'::jsonb)
    into v_warranties
    from public.warranties g
   where g.work_order_id=p_wo
     and g.company_id=v_wo.company_id
     and g.deleted_at is null;

  select jsonb_build_object(
    'id',r.id,
    'body',r.body,
    'author_id',r.author_id,
    'created_at',r.created_at
  ) into v_technical
    from public.work_order_reports r
   where r.work_order_id=p_wo
     and r.company_id=v_wo.company_id
     and r.entry_type='report'
   order by r.created_at desc,r.id desc
   limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',a.id,
    'bucket',a.bucket,
    'path',a.path,
    'file_name',a.file_name,
    'content_type',a.content_type,
    'size_bytes',a.size_bytes,
    'category',a.category,
    'media_kind',a.media_kind,
    'media_stage',a.media_stage,
    'caption',a.caption,
    'created_at',a.created_at
  ) order by a.created_at,a.id),'[]'::jsonb)
    into v_evidence
    from public.attachments a
   where a.work_order_id=p_wo
     and a.company_id=v_wo.company_id
     and a.include_in_service_report;

  begin
    v_billable_total := zt_private.zt_work_order_billable_total(p_wo);
  exception when others then
    v_billable_total := null;
  end;

  if v_wo.billing_entry_id is not null then
    select f.* into v_entry
      from public.financial_entries f
     where f.id=v_wo.billing_entry_id and f.company_id=v_wo.company_id;
  end if;

  if v_wo.pending_pricing then
    v_payment_status := 'pending_pricing';
    v_payment_label := 'Aguardando precificação';
  elsif v_wo.is_warranty_visit then
    v_payment_status := 'warranty';
    v_payment_label := 'Atendimento em garantia';
  elsif v_wo.billing_entry_id is null and coalesce(v_billable_total,0)<=0 then
    v_payment_status := 'no_charge';
    v_payment_label := 'Sem cobrança gerada';
  elsif v_wo.billing_entry_id is null then
    v_payment_status := 'not_billed';
    v_payment_label := 'Cobrança ainda não gerada';
  elsif coalesce(v_entry.paid,false) then
    v_payment_status := 'paid';
    v_payment_label := 'Recebido';
  else
    v_payment_status := 'receivable';
    v_payment_label := 'A receber';
  end if;

  v_snapshot := jsonb_build_object(
    'schema_version',1,
    'company',jsonb_build_object(
      'id',v_company.id,
      'name',v_company.name,
      'trade_name',v_company.trade_name,
      'tax_id',v_company.tax_id,
      'activity',v_company.activity,
      'phone',v_company.phone,
      'whatsapp',v_company.whatsapp,
      'email',v_company.email,
      'address',v_company.address,
      'logo_path',v_company.logo_path
    ),
    'client',jsonb_build_object(
      'id',v_client.id,
      'person_type',v_client.person_type,
      'name',v_client.name,
      'trade_name',v_client.trade_name,
      'tax_id',v_client.tax_id,
      'contact_name',v_client.contact_name,
      'phone',v_client.phone,
      'whatsapp',v_client.whatsapp,
      'address',v_client.address
    ),
    'location',jsonb_build_object(
      'service_place',v_wo.service_place,
      'address',v_wo.address,
      'client_address',v_client.address
    ),
    'work_order',jsonb_build_object(
      'id',v_wo.id,
      'number',v_wo.number,
      'quote_id',v_wo.quote_id,
      'status',v_wo.status,
      'scheduled_date',v_wo.scheduled_date,
      'scheduled_time',v_wo.scheduled_time,
      'request',v_wo.request,
      'pre_notes',v_wo.pre_notes,
      'pending_note',v_wo.pending_note,
      'problem_report',v_wo.problem_report,
      'needs_return',v_wo.needs_return,
      'is_warranty_visit',v_wo.is_warranty_visit,
      'completed_at',v_wo.completed_at
    ),
    'technician',jsonb_build_object(
      'id',v_wo.assigned_to,
      'name',v_tech.full_name,
      'job_title',v_job_title
    ),
    'technical_report',v_technical,
    'items',v_items,
    'materials',v_materials,
    'warranties',v_warranties,
    'evidence',v_evidence,
    'payment',jsonb_build_object(
      'show_values',not v_wo.pending_pricing,
      'billable_total',v_billable_total,
      'approved_subtotal',v_wo.approved_subtotal,
      'approved_discount',v_wo.approved_discount,
      'approved_surcharge',v_wo.approved_surcharge,
      'approved_total',v_wo.approved_total,
      'status',v_payment_status,
      'status_label',v_payment_label,
      'payment_method',v_entry.payment_method
    ),
    'finalized_at',v_wo.completed_at
  );

  insert into public.work_order_reports(
    work_order_id,company_id,entry_type,body,author_id,
    report_version,is_active,snapshot,client_id,finalized_at
  ) values(
    p_wo,v_wo.company_id,'service_report','Relatório operacional do atendimento',auth.uid(),
    1,true,v_snapshot,v_wo.client_id,v_wo.completed_at
  )
  on conflict do nothing
  returning id into v_report_id;

  if v_report_id is null then
    select r.id into v_report_id
      from public.work_order_reports r
     where r.work_order_id=p_wo
       and r.entry_type='service_report'
       and r.report_version=1;
  end if;
  return v_report_id;
end;
$$;
revoke all on function zt_private.zt_create_initial_service_report(uuid) from public,anon,authenticated;
grant execute on function zt_private.zt_create_initial_service_report(uuid) to service_role;

create or replace function zt_private.zt_service_report_after_done()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if new.status='done' and old.status is distinct from new.status then
    perform zt_private.zt_create_initial_service_report(new.id);
  end if;
  return new;
end;
$$;
revoke all on function zt_private.zt_service_report_after_done() from public,anon,authenticated;
grant execute on function zt_private.zt_service_report_after_done() to service_role;

drop trigger if exists zt_service_report_after_done on public.work_orders;
create constraint trigger zt_service_report_after_done
  after update on public.work_orders
  deferrable initially deferred
  for each row
  when (new.status='done' and old.status is distinct from new.status)
  execute function zt_private.zt_service_report_after_done();
