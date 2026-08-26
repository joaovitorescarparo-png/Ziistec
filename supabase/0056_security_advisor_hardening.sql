-- ZiisTec V2: hardening orientado pelo Security Advisor.
-- document_usage_events é um ledger interno consumido por RPCs confiáveis de quota.
-- Clientes web/mobile nunca devem consultar nem gravar esta tabela diretamente.

alter table public.document_usage_events enable row level security;

revoke all on table public.document_usage_events from public, anon, authenticated;
grant select, insert, update, delete on table public.document_usage_events to service_role;

drop policy if exists p_document_usage_events_no_client_access on public.document_usage_events;
create policy p_document_usage_events_no_client_access
on public.document_usage_events
for all
to anon, authenticated
using (false)
with check (false);

comment on table public.document_usage_events is
  'Ledger interno de consumo de documentos/quota. Acesso direto de anon/authenticated é proibido; operações passam por RPC confiável.';
