-- ZiisTec · 0071 — leitura histórica de zt-documents independente de escrita
--
-- Política aprovada:
-- * owner ativo da empresa pode SELECT em documentos privados próprios mesmo se a
--   assinatura estiver canceled, suspended ou com período expirado;
-- * technician continua sem acesso ao bucket zt-documents;
-- * outra empresa nunca acessa o caminho da empresa dona;
-- * INSERT/UPDATE/DELETE continuam exigindo owner + assinatura com escrita habilitada.

-- A policy antiga usava ALL e, por isso, aplicava subscription_can_write também ao SELECT.
drop policy if exists zt_docs_all on storage.objects;
drop policy if exists zt_docs_select_history on storage.objects;
drop policy if exists zt_docs_insert_active on storage.objects;
drop policy if exists zt_docs_update_active on storage.objects;
drop policy if exists zt_docs_delete_active on storage.objects;

create policy zt_docs_select_history
on storage.objects
for select
to authenticated
using (
  bucket_id = 'zt-documents'
  and public.zt_is_owner(public.zt_path_company(name))
);

create policy zt_docs_insert_active
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'zt-documents'
  and public.zt_is_owner(public.zt_path_company(name))
  and public.zt_subscription_can_write(public.zt_path_company(name))
);

create policy zt_docs_update_active
on storage.objects
for update
to authenticated
using (
  bucket_id = 'zt-documents'
  and public.zt_is_owner(public.zt_path_company(name))
  and public.zt_subscription_can_write(public.zt_path_company(name))
)
with check (
  bucket_id = 'zt-documents'
  and public.zt_is_owner(public.zt_path_company(name))
  and public.zt_subscription_can_write(public.zt_path_company(name))
);

create policy zt_docs_delete_active
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'zt-documents'
  and public.zt_is_owner(public.zt_path_company(name))
  and public.zt_subscription_can_write(public.zt_path_company(name))
);
