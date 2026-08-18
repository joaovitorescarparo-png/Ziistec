revoke insert, delete on table public.companies from authenticated;
revoke insert, delete on table public.company_members from authenticated;
revoke insert, update, delete on table public.warranties from authenticated;
grant select, update on table public.companies to authenticated;
grant select, update on table public.company_members to authenticated;
grant select on table public.warranties to authenticated;
