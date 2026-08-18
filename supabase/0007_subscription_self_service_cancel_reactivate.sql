alter table public.subscriptions add column if not exists canceled_at timestamptz;

create or replace function public.zt_cancel_subscription(p_company uuid)
returns public.zt_sub_status
language plpgsql
security definer
set search_path = public
as $$
declare v_status public.zt_sub_status;
begin
  if auth.uid() is null then raise exception 'Não autenticado' using errcode='28000'; end if;
  if not public.zt_is_owner(p_company) then raise exception 'Somente o proprietário pode cancelar a assinatura' using errcode='42501'; end if;
  update public.subscriptions set status='canceled', canceled_at=now() where company_id=p_company returning status into v_status;
  if v_status is null then raise exception 'Assinatura não encontrada' using errcode='P0002'; end if;
  return v_status;
end $$;
revoke all on function public.zt_cancel_subscription(uuid) from public, anon;
grant execute on function public.zt_cancel_subscription(uuid) to authenticated;

create or replace function public.zt_reactivate_subscription(p_company uuid)
returns public.zt_sub_status
language plpgsql
security definer
set search_path = public
as $$
declare v_sub public.subscriptions; v_new public.zt_sub_status;
begin
  if auth.uid() is null then raise exception 'Não autenticado' using errcode='28000'; end if;
  if not public.zt_is_owner(p_company) then raise exception 'Somente o proprietário pode reativar a assinatura' using errcode='42501'; end if;
  select * into v_sub from public.subscriptions where company_id=p_company for update;
  if v_sub.id is null then raise exception 'Assinatura não encontrada' using errcode='P0002'; end if;
  if v_sub.status <> 'canceled' then return v_sub.status; end if;
  if v_sub.current_period_end is null or v_sub.current_period_end < current_date then
    raise exception 'Seu período terminou. A reativação agora depende de uma nova cobrança.' using errcode='42501';
  end if;
  v_new := case when v_sub.provider_subscription_id is null then 'trial'::public.zt_sub_status else 'active'::public.zt_sub_status end;
  update public.subscriptions set status=v_new, canceled_at=null where id=v_sub.id;
  return v_new;
end $$;
revoke all on function public.zt_reactivate_subscription(uuid) from public, anon;
grant execute on function public.zt_reactivate_subscription(uuid) to authenticated;
