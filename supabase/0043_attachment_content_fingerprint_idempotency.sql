alter table public.attachments
  add column if not exists content_sha256 text;

alter table public.attachments
  drop constraint if exists attachments_content_sha256_format;
alter table public.attachments
  add constraint attachments_content_sha256_format
  check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$');

create unique index if not exists uq_attachments_wo_content
  on public.attachments(work_order_id, coalesce(category,''), content_sha256)
  where work_order_id is not null and content_sha256 is not null;

create unique index if not exists uq_attachments_purchase_content
  on public.attachments(purchase_id, coalesce(category,''), content_sha256)
  where purchase_id is not null and content_sha256 is not null;
