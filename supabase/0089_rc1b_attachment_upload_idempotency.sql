-- ZiisTec RC-1B — evidências de OS idempotentes por conteúdo/contexto.
-- Forward-only. Não altera dados históricos e não preenche hashes retroativamente.

create unique index if not exists uq_attachments_wo_stage_content
  on public.attachments(company_id, work_order_id, media_stage, content_sha256)
  where work_order_id is not null
    and media_stage is not null
    and content_sha256 is not null;

create or replace function public.zt_register_work_order_evidence(
  p_company uuid,
  p_work_order uuid,
  p_path text,
  p_file_name text,
  p_content_type text,
  p_size_bytes bigint,
  p_media_stage text,
  p_caption text,
  p_category text,
  p_content_sha256 text
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_extension text;
  v_media_kind text;
  v_expected_path text;
  v_row public.attachments%rowtype;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode='42501';
  end if;
  if p_company is null or p_work_order is null then
    raise exception 'INVALID_WORK_ORDER_CONTEXT' using errcode='22023';
  end if;
  if p_media_stage not in ('before','during','after','equipment','video','other') then
    raise exception 'INVALID_MEDIA_STAGE' using errcode='22023';
  end if;
  if p_content_sha256 is null or p_content_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_CONTENT_SHA256' using errcode='22023';
  end if;
  if length(coalesce(p_file_name,'')) < 1 or length(p_file_name) > 255 then
    raise exception 'INVALID_FILE_NAME' using errcode='22023';
  end if;
  if length(coalesce(p_caption,'')) > 1000 then
    raise exception 'CAPTION_TOO_LONG' using errcode='22023';
  end if;
  if length(coalesce(p_category,'')) > 120 then
    raise exception 'CATEGORY_TOO_LONG' using errcode='22023';
  end if;

  select x.extension, x.media_kind
    into v_extension, v_media_kind
  from (values
    ('image/jpeg','jpg','photo'),
    ('image/png','png','photo'),
    ('image/webp','webp','photo'),
    ('image/heic','heic','photo'),
    ('image/heif','heif','photo'),
    ('video/mp4','mp4','video'),
    ('video/quicktime','mov','video'),
    ('video/webm','webm','video'),
    ('application/pdf','pdf','document')
  ) as x(content_type,extension,media_kind)
  where x.content_type=p_content_type;

  if v_extension is null then
    raise exception 'UNSUPPORTED_CONTENT_TYPE' using errcode='22023';
  end if;
  if coalesce(p_size_bytes,-1) < 0 then
    raise exception 'INVALID_FILE_SIZE' using errcode='22023';
  end if;
  if (v_media_kind='photo' and p_size_bytes > 15*1024*1024)
     or (v_media_kind='video' and p_size_bytes > 30*1024*1024)
     or (v_media_kind='document' and p_size_bytes > 20*1024*1024) then
    raise exception 'FILE_TOO_LARGE' using errcode='22023';
  end if;
  if p_media_stage='video' and v_media_kind<>'video' then
    raise exception 'VIDEO_STAGE_REQUIRES_VIDEO' using errcode='22023';
  end if;
  if v_media_kind='document' and p_media_stage<>'other' then
    raise exception 'DOCUMENT_STAGE_MUST_BE_OTHER' using errcode='22023';
  end if;

  -- A consulta é SECURITY INVOKER: RLS decide se o chamador pode sequer ver a OS.
  if not exists (
    select 1 from public.work_orders w
    where w.id=p_work_order and w.company_id=p_company
  ) then
    raise exception 'WORK_ORDER_NOT_ACCESSIBLE' using errcode='42501';
  end if;

  v_expected_path := p_company::text||'/work-orders/'||p_work_order::text||'/'||
    p_media_stage||'/'||p_content_sha256||'.'||v_extension;
  if p_path is distinct from v_expected_path then
    raise exception 'INVALID_EVIDENCE_PATH' using errcode='22023';
  end if;

  insert into public.attachments(
    company_id,bucket,path,file_name,content_type,size_bytes,category,
    work_order_id,uploaded_by,content_sha256,media_kind,media_stage,caption,
    include_in_service_report
  ) values (
    p_company,'zt-work-orders',p_path,p_file_name,p_content_type,p_size_bytes,
    coalesce(nullif(btrim(p_category),''),case p_media_stage
      when 'before' then 'Antes' when 'during' then 'Durante' when 'after' then 'Depois'
      when 'equipment' then 'Equipamento' when 'video' then 'Vídeo' else 'Outro / documento' end),
    p_work_order,v_uid,p_content_sha256,v_media_kind,p_media_stage,nullif(btrim(p_caption),''),false
  )
  on conflict (company_id,work_order_id,media_stage,content_sha256)
    where work_order_id is not null and media_stage is not null and content_sha256 is not null
  do nothing
  returning * into v_row;

  if v_row.id is null then
    select a.* into v_row
    from public.attachments a
    where a.company_id=p_company
      and a.work_order_id=p_work_order
      and a.media_stage=p_media_stage
      and a.content_sha256=p_content_sha256
    limit 1;
  end if;

  if v_row.id is null then
    raise exception 'EVIDENCE_IDEMPOTENCY_CONFLICT_NOT_VISIBLE' using errcode='42501';
  end if;

  return to_jsonb(v_row);
end;
$$;

revoke all on function public.zt_register_work_order_evidence(uuid,uuid,text,text,text,bigint,text,text,text,text) from public;
revoke all on function public.zt_register_work_order_evidence(uuid,uuid,text,text,text,bigint,text,text,text,text) from anon;
grant execute on function public.zt_register_work_order_evidence(uuid,uuid,text,text,text,bigint,text,text,text,text) to authenticated;
grant execute on function public.zt_register_work_order_evidence(uuid,uuid,text,text,text,bigint,text,text,text,text) to service_role;

comment on function public.zt_register_work_order_evidence(uuid,uuid,text,text,text,bigint,text,text,text,text)
  is 'RC-1B: registra/reutiliza evidência por company+OS+stage+SHA-256; SECURITY INVOKER preserva RLS e subscription guards.';
