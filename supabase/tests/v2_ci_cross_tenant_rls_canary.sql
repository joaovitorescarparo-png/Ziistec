-- Disposable/local CI canary. If client RLS becomes permissive across companies, this test fails.
begin;

-- Create each tenant fixture through the same authenticated owner path used by the app.
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
set local role authenticated;
insert into public.clients(id,company_id,name)
values ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','CI Client A');
reset role;

select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
set local role authenticated;
insert into public.clients(id,company_id,name)
values ('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','CI Client B');
reset role;

select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
set local role authenticated;

do $$
declare
  v_own boolean;
  v_other boolean;
begin
  select exists(select 1 from public.clients where id='30000000-0000-0000-0000-000000000001') into v_own;
  select exists(select 1 from public.clients where id='30000000-0000-0000-0000-000000000002') into v_other;
  if not v_own then raise exception 'CI_RLS_CANARY_OWNER_LOST_OWN_CLIENT'; end if;
  if v_other then raise exception 'CI_RLS_CANARY_CROSS_TENANT_READ'; end if;
end $$;

reset role;

-- A disabled membership must immediately lose tenant visibility.
update public.company_members
set status='disabled'
where company_id='20000000-0000-0000-0000-000000000001'
  and user_id='10000000-0000-0000-0000-000000000003';
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
set local role authenticated;

do $$
begin
  if exists(select 1 from public.clients where id='30000000-0000-0000-0000-000000000001') then
    raise exception 'CI_RLS_CANARY_DISABLED_TECH_READ';
  end if;
end $$;

reset role;
rollback;
