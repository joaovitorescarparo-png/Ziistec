create index if not exists idx_post_sale_followups_client_id on public.post_sale_followups(client_id);
create index if not exists idx_post_sale_followups_service_id on public.post_sale_followups(service_id);
create index if not exists idx_post_sale_followups_work_order_id on public.post_sale_followups(work_order_id);
create index if not exists idx_document_usage_events_company_id on public.document_usage_events(company_id);
