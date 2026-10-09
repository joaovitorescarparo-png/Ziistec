-- ZiisTec · Bloco 4 — Relatório de Atendimento sem dados financeiros para o técnico.
--
-- O snapshot da 0082 continua imutável e completo para o proprietário. O técnico atribuído
-- deixava de ver custo, mas ainda lia na linha bruta a situação/forma de pagamento, o total
-- faturável e os preços. Agora ele não lê a linha service_report; recebe uma projeção sem
-- esses campos por uma RPC que aplica o papel no backend.

alter policy p_wo_rep_select on public.work_order_reports
  using (
    public.zt_wo_is_owned(work_order_id)
    or (public.zt_wo_is_mine(work_order_id) and entry_type <> 'service_report')
  );

create or replace function public.zt_get_service_report(p_wo uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();
  v_wo public.work_orders%rowtype;
  v_owner boolean;
  v_row public.work_order_reports%rowtype;
  v_snapshot jsonb;
begin
  if v_uid is null then raise exception 'Não autenticado' using errcode='28000'; end if;
  select w.* into v_wo from public.work_orders w where w.id=p_wo and w.deleted_at is null;
  if not found then raise exception 'OS não encontrada' using errcode='P0002'; end if;
  v_owner:=public.zt_is_owner(v_wo.company_id);
  if not v_owner and not public.zt_wo_is_mine(v_wo.id) then
    raise exception 'Sem permissão para esta OS' using errcode='42501';
  end if;

  select r.* into v_row from public.work_order_reports r
   where r.work_order_id=v_wo.id and r.company_id=v_wo.company_id
     and r.entry_type='service_report' and r.is_active;
  if not found then return null; end if;

  v_snapshot:=v_row.snapshot;
  if not v_owner then
    -- Projeção do técnico: sem bloco de pagamento e sem preço por item.
    v_snapshot:=(v_snapshot - 'payment')
      || jsonb_build_object(
        'items',coalesce((
          select jsonb_agg(e.item - 'unit_price' - 'price_pending' order by e.ord)
            from jsonb_array_elements(coalesce(v_snapshot->'items','[]'::jsonb)) with ordinality as e(item,ord)
        ),'[]'::jsonb),
        'financial_redacted',true
      );
  end if;

  return jsonb_build_object(
    'id',v_row.id,
    'work_order_id',v_row.work_order_id,
    'company_id',v_row.company_id,
    'entry_type',v_row.entry_type,
    'body',v_row.body,
    'author_id',v_row.author_id,
    'created_at',v_row.created_at,
    'report_version',v_row.report_version,
    'is_active',v_row.is_active,
    'client_id',v_row.client_id,
    'finalized_at',v_row.finalized_at,
    'snapshot',v_snapshot,
    'viewer_role',case when v_owner then 'owner' else 'technician' end
  );
end;
$$;

revoke all on function public.zt_get_service_report(uuid) from public, anon;
grant execute on function public.zt_get_service_report(uuid) to authenticated;
