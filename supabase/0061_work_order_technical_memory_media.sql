-- ZiisTec V2: memória técnica da OS com evidências estruturadas.
-- Reutiliza attachments + bucket privado zt-work-orders. Não cria armazenamento paralelo.

alter table public.attachments
  add column if not exists media_kind text,
  add column if not exists media_stage text,
  add column if not exists caption text;

alter table public.attachments
  drop constraint if exists attachments_media_kind_check;
alter table public.attachments
  add constraint attachments_media_kind_check
  check (media_kind is null or media_kind in ('photo','video','document','other'));

alter table public.attachments
  drop constraint if exists attachments_media_stage_check;
alter table public.attachments
  add constraint attachments_media_stage_check
  check (media_stage is null or media_stage in ('before','during','after','equipment','video','other'));

alter table public.attachments
  drop constraint if exists attachments_caption_len;
alter table public.attachments
  add constraint attachments_caption_len
  check (caption is null or char_length(caption) <= 1000);

-- Backfill conservador: só classifica o tipo; não inventa etapa para arquivos antigos.
update public.attachments
   set media_kind = case
     when content_type like 'video/%' then 'video'
     when content_type like 'image/%' then 'photo'
     when content_type = 'application/pdf' then 'document'
     else 'other'
   end
 where media_kind is null;

create index if not exists idx_attachments_wo_memory
  on public.attachments(company_id, work_order_id, media_stage, created_at)
  where work_order_id is not null;

-- Evidência de campo permanece privada. 30 MB atende clipes curtos de instalação sem
-- transformar o módulo em armazenamento de vídeos longos.
update storage.buckets
   set file_size_limit = 31457280,
       allowed_mime_types = array[
         'image/jpeg','image/png','image/webp','image/heic','image/heif',
         'video/mp4','video/quicktime','video/webm'
       ]::text[]
 where id = 'zt-work-orders';

comment on column public.attachments.media_kind is
  'Tipo técnico do anexo: photo, video, document ou other.';
comment on column public.attachments.media_stage is
  'Etapa da evidência da OS: before, during, after, equipment, video ou other.';
comment on column public.attachments.caption is
  'Legenda técnica curta da evidência; nunca deve armazenar custo ou informação financeira.';
