-- ZiisTec · Beta — renovação/reativação de assinatura pelo administrador da plataforma.
--
-- zt_platform_set_subscription_status (0010) só troca o status, mas o acesso também exige
-- current_period_end >= hoje (0011/0044). Sem esta RPC, estender o trial de um beta ou reativar
-- uma empresa exigia UPDATE manual sem auditoria.
--
-- Regras:
--   * somente administrador da plataforma com MFA (zt_is_platform_admin: perfil + aal2);
--     proprietário, técnico, outro usuário e anon são recusados;
--   * altera apenas status, período e canceled_at; empresa, plano, valor, provedor e dados
--     operacionais ficam intactos;
--   * novo fim entre hoje e hoje + 400 dias (mesmo current_date dos guards de assinatura);
--     status final trial ou active;
--   * período vencido ou assinatura parada (suspended, past_due, canceled) recomeça hoje
--     (reativação); período vigente só é estendido, mantendo o início;
--   * motivo obrigatório; cada mudança efetiva grava uma linha em platform_audit_logs;
--   * repetir a mesma renovação não muda nada nem duplica a auditoria (retry seguro).
-- Sem checkout e sem provedor de pagamento.

create or replace function public.zt_platform_renew_subscription(
  p_company uuid,
  p_period_end date,
  p_status public.zt_sub_status default 'active',
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();
  v_today date:=current_date;
  v_reason text:=nullif(btrim(coalesce(p_reason,'')),'');
  v_before public.subscriptions%rowtype;
  v_after public.subscriptions%rowtype;
  v_start date;
begin
  if v_uid is null then raise exception 'Não autenticado' using errcode='28000'; end if;
  if not public.zt_is_platform_admin() then
    raise exception 'Acesso administrativo necessário' using errcode='42501';
  end if;
  if p_company is null then raise exception 'Empresa obrigatória' using errcode='22023'; end if;
  if p_status is null or p_status not in ('trial','active') then
    raise exception 'Renovação aceita somente trial ou active' using errcode='22023';
  end if;
  if p_period_end is null or p_period_end<v_today or p_period_end>v_today+400 then
    raise exception 'O novo fim do período deve estar entre hoje e 400 dias' using errcode='22023';
  end if;
  if v_reason is null or char_length(v_reason)<3 or char_length(v_reason)>500 then
    raise exception 'Informe o motivo da renovação (3 a 500 caracteres)' using errcode='22023';
  end if;

  select s.* into v_before from public.subscriptions s where s.company_id=p_company for update;
  if not found then raise exception 'Assinatura não encontrada' using errcode='P0002'; end if;

  -- Período vigente é estendido; vencido ou parado recomeça hoje.
  v_start:=case
    when v_before.status in ('trial','active') and v_before.current_period_start is not null
     and v_before.current_period_end is not null and v_before.current_period_end>=v_today
     and v_before.current_period_start<=p_period_end
      then v_before.current_period_start
    else v_today
  end;

  if v_before.status=p_status and v_before.current_period_start is not distinct from v_start
     and v_before.current_period_end is not distinct from p_period_end and v_before.canceled_at is null then
    return jsonb_build_object('company_id',p_company,'status',v_before.status,
      'current_period_start',v_before.current_period_start,'current_period_end',v_before.current_period_end,'changed',false);
  end if;

  update public.subscriptions
     set status=p_status, current_period_start=v_start, current_period_end=p_period_end, canceled_at=null
   where company_id=p_company
  returning * into v_after;

  insert into public.platform_audit_logs(actor_id,company_id,action,before_data,after_data)
  values(v_uid,p_company,'subscription_renewed',
    jsonb_build_object('status',v_before.status,'current_period_start',v_before.current_period_start,
      'current_period_end',v_before.current_period_end,'canceled_at',v_before.canceled_at),
    jsonb_build_object('status',v_after.status,'current_period_start',v_after.current_period_start,
      'current_period_end',v_after.current_period_end,'reason',v_reason));

  return jsonb_build_object('company_id',p_company,'status',v_after.status,
    'current_period_start',v_after.current_period_start,'current_period_end',v_after.current_period_end,'changed',true);
end;
$$;

revoke all on function public.zt_platform_renew_subscription(uuid,date,public.zt_sub_status,text) from public, anon;
grant execute on function public.zt_platform_renew_subscription(uuid,date,public.zt_sub_status,text) to authenticated;

comment on function public.zt_platform_renew_subscription(uuid,date,public.zt_sub_status,text) is
  'Administrador da plataforma (MFA) estende ou reativa a assinatura: novo fim do período, status trial/active, motivo e auditoria.';
