-- ZiisTec: menor privilégio no Data API e proteção dos contadores.
-- Usuários não autenticados não precisam acessar tabelas de negócio.
revoke all privileges on all tables in schema public from anon;
revoke all privileges on all sequences in schema public from anon;

-- O frontend autenticado usa DML normal; RLS continua sendo a autorização por linha.
revoke all privileges on all tables in schema public from authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;

-- Contadores só podem ser alterados por owner. A numeração oficial continua via zt_next_number.
drop policy if exists p_counters_all on public.document_counters;
create policy p_counters_owner on public.document_counters
for all to authenticated
using (public.zt_is_owner(company_id))
with check (public.zt_is_owner(company_id));

-- A view de catálogo é somente leitura.
revoke insert, update, delete on public.materials_catalog from authenticated;
grant select on public.materials_catalog to authenticated;
