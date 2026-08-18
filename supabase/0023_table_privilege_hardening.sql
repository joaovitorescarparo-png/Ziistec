revoke truncate, trigger, references on all tables in schema public from anon, authenticated;
revoke insert, update, delete on table public.platform_audit_logs from authenticated;
grant select on table public.platform_audit_logs to authenticated;
alter default privileges in schema public revoke truncate, trigger, references on tables from anon;
alter default privileges in schema public revoke truncate, trigger, references on tables from authenticated;
