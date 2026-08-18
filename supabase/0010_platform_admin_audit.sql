create table if not exists public.platform_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.profiles(id) on delete restrict,
  company_id uuid references public.companies(id) on delete set null,
  action text not null,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_platform_audit_actor on public.platform_audit_logs(actor_id, created_at desc);
create index if not exists idx_platform_audit_company on public.platform_audit_logs(company_id, created_at desc);
alter table public.platform_audit_logs enable row level security;
create policy p_platform_audit_select on public.platform_audit_logs for select to authenticated using (public.zt_is_platform_admin());
create policy p_platform_audit_insert on public.platform_audit_logs for insert to authenticated with check (public.zt_is_platform_admin() and actor_id=(select auth.uid()));
revoke all on public.platform_audit_logs from anon;
grant select, insert on public.platform_audit_logs to authenticated;

create or replace function public.zt_platform_set_subscription_status(p_company uuid, p_status public.zt_sub_status)
returns public.zt_sub_status
language plpgsql
security definer
set search_path=public
as $$
declare v_before public.zt_sub_status; v_after public.zt_sub_status;
begin
  if auth.uid() is null then raise exception 'Não autenticado' using errcode='28000'; end if;
  if not public.zt_is_platform_admin() then raise exception 'Acesso administrativo necessário' using errcode='42501'; end if;
  if p_status not in ('active','suspended','canceled') then raise exception 'Status administrativo inválido'; end if;
  select status into v_before from public.subscriptions where company_id=p_company for update;
  if v_before is null then raise exception 'Assinatura não encontrada' using errcode='P0002'; end if;
  update public.subscriptions set status=p_status, canceled_at=case when p_status='canceled' then now() else null end where company_id=p_company returning status into v_after;
  insert into public.platform_audit_logs(actor_id,company_id,action,before_data,after_data)
  values(auth.uid(),p_company,'subscription_status_changed',jsonb_build_object('status',v_before),jsonb_build_object('status',v_after));
  return v_after;
end $$;
revoke all on function public.zt_platform_set_subscription_status(uuid,public.zt_sub_status) from public,anon;
grant execute on function public.zt_platform_set_subscription_status(uuid,public.zt_sub_status) to authenticated;
