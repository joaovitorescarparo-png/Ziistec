-- Local Supabase CI only. Synthetic identities; no cloud credentials or production data.
-- This file is applied only to the disposable Postgres started by Supabase CLI.

insert into auth.users (
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values
  ('00000000-0000-0000-0000-000000000000','10000000-0000-0000-0000-000000000001','authenticated','authenticated','ci-owner-a@example.invalid','',now(),'{}'::jsonb,'{}'::jsonb,now(),now()),
  ('00000000-0000-0000-0000-000000000000','10000000-0000-0000-0000-000000000002','authenticated','authenticated','ci-owner-b@example.invalid','',now(),'{}'::jsonb,'{}'::jsonb,now(),now()),
  ('00000000-0000-0000-0000-000000000000','10000000-0000-0000-0000-000000000003','authenticated','authenticated','ci-tech-a@example.invalid','',now(),'{}'::jsonb,'{}'::jsonb,now(),now()),
  ('00000000-0000-0000-0000-000000000000','10000000-0000-0000-0000-000000000004','authenticated','authenticated','ci-external@example.invalid','',now(),'{}'::jsonb,'{}'::jsonb,now(),now())
on conflict (id) do nothing;

insert into public.profiles(id,full_name,email)
values
  ('10000000-0000-0000-0000-000000000001','CI Owner A','ci-owner-a@example.invalid'),
  ('10000000-0000-0000-0000-000000000002','CI Owner B','ci-owner-b@example.invalid'),
  ('10000000-0000-0000-0000-000000000003','CI Technician A','ci-tech-a@example.invalid'),
  ('10000000-0000-0000-0000-000000000004','CI External User','ci-external@example.invalid')
on conflict (id) do nothing;

insert into public.companies(id,name,has_team)
values
  ('20000000-0000-0000-0000-000000000001','CI Company A',true),
  ('20000000-0000-0000-0000-000000000002','CI Company B',true)
on conflict (id) do nothing;

insert into public.subscriptions(company_id,status,current_period_start,current_period_end)
values
  ('20000000-0000-0000-0000-000000000001','active',current_date,current_date+30),
  ('20000000-0000-0000-0000-000000000002','active',current_date,current_date+30)
on conflict (company_id) do update set status='active',current_period_start=current_date,current_period_end=current_date+30;

insert into public.company_members(company_id,user_id,role,status,job_title)
values
  ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','owner','active','CI Owner'),
  ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000003','technician','active','CI Technician'),
  ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','owner','active','CI Owner')
on conflict (company_id,user_id) do update set role=excluded.role,status=excluded.status,job_title=excluded.job_title;
