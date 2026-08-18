create policy document_counters_no_direct_access on public.document_counters
as restrictive for all to authenticated
using (false)
with check (false);
