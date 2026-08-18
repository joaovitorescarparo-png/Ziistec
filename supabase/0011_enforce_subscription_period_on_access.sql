create or replace function public.zt_refresh_subscription_status(p_company uuid)
returns public.zt_sub_status
language plpgsql
security definer
set search_path=public
as $$
declare v_sub public.subscriptions; v_status public.zt_sub_status;
begin
  if auth.uid() is null then raise exception 'Não autenticado' using errcode='28000'; end if;
  if not (public.zt_is_member(p_company) or public.zt_is_platform_admin()) then raise exception 'Sem acesso à assinatura desta empresa' using errcode='42501'; end if;
  select * into v_sub from public.subscriptions where company_id=p_company for update;
  if v_sub.id is null then return null; end if;
  v_status := v_sub.status;
  if v_sub.current_period_end is not null and v_sub.current_period_end < current_date then
    if v_sub.status='trial' then v_status:='suspended';
    elsif v_sub.status='active' then v_status:='past_due';
    end if;
  end if;
  if v_status is distinct from v_sub.status then update public.subscriptions set status=v_status where id=v_sub.id; end if;
  return v_status;
end $$;
revoke all on function public.zt_refresh_subscription_status(uuid) from public,anon;
grant execute on function public.zt_refresh_subscription_status(uuid) to authenticated;
