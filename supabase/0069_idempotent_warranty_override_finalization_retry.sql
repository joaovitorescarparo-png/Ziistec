-- ZiisTec · 0069 — retry idempotente da finalização com override de garantia.
--
-- Se a primeira chamada foi commitada e a resposta se perdeu, a segunda chamada
-- não pode reaplicar override em uma OS já done. O fluxo atômico já possui o guard
-- de autorização + early-return idempotente; reutilizamos essa autoridade.

create or replace function zt_private.zt_finalize_work_order_with_warranty_overrides(
  p_wo uuid,
  p_report text default null,
  p_pending text default null,
  p_extra_cost numeric default null,
  p_due_days integer default 7,
  p_materials jsonb default '[]'::jsonb,
  p_additions jsonb default '[]'::jsonb,
  p_warranty_overrides jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.zt_wo_status;
  v_billing uuid;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado' using errcode='28000';
  end if;

  select w.status,w.billing_entry_id
    into v_status,v_billing
    from public.work_orders w
   where w.id=p_wo
   for update;
  if not found then
    raise exception 'Ordem de serviço não encontrada' using errcode='P0002';
  end if;

  -- Retry após commit: não toca novamente em garantia, material ou adicional.
  -- zt_finalize_work_order_atomic valida owner/técnico atribuído antes de retornar
  -- o billing_entry_id existente (ou NULL para garantia/sem cobrança/pending pricing).
  if v_status='done' or v_billing is not null then
    return zt_private.zt_finalize_work_order_atomic(
      p_wo,p_report,p_pending,p_extra_cost,p_due_days,p_materials,p_additions
    );
  end if;

  if p_warranty_overrides is not null then
    perform zt_private.zt_apply_work_order_warranty_overrides(p_wo,p_warranty_overrides);
  end if;

  return zt_private.zt_finalize_work_order_atomic(
    p_wo,p_report,p_pending,p_extra_cost,p_due_days,p_materials,p_additions
  );
end;
$$;

revoke all on function zt_private.zt_finalize_work_order_with_warranty_overrides(uuid,text,text,numeric,integer,jsonb,jsonb,jsonb)
  from public,anon,authenticated;
grant execute on function zt_private.zt_finalize_work_order_with_warranty_overrides(uuid,text,text,numeric,integer,jsonb,jsonb,jsonb)
  to service_role;
