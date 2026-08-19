-- ZiisTec: integridade de garantia/pós-venda.
-- 1) visita em garantia só pode apontar para garantia válida da mesma empresa/cliente
-- 2) atendimento em garantia nunca renova a garantia automaticamente

create or replace function zt_private.zt_validate_warranty_visit_linkage()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_w public.warranties;
  v_link_changed boolean := true;
begin
  if tg_op = 'UPDATE' then
    v_link_changed :=
      new.is_warranty_visit is distinct from old.is_warranty_visit or
      new.warranty_id is distinct from old.warranty_id or
      new.origin_wo_id is distinct from old.origin_wo_id or
      new.company_id is distinct from old.company_id or
      new.client_id is distinct from old.client_id;
  end if;

  if coalesce(new.is_warranty_visit,false) then
    if new.warranty_id is null then
      raise exception 'Visita em garantia precisa informar a garantia' using errcode='23514';
    end if;

    select * into v_w
      from public.warranties
     where id=new.warranty_id
       and company_id=new.company_id;

    if v_w.id is null then
      raise exception 'Garantia inválida para esta empresa' using errcode='23503';
    end if;

    if v_w.client_id is distinct from new.client_id then
      raise exception 'Garantia não pertence a este cliente' using errcode='23503';
    end if;

    if v_w.work_order_id is null or new.origin_wo_id is distinct from v_w.work_order_id then
      raise exception 'OS de origem não corresponde à garantia' using errcode='23503';
    end if;

    -- Valida prazo ao criar/revincular. Uma visita aberta dentro do prazo pode ser
    -- concluída depois do vencimento sem travar a operação de campo.
    if tg_op='INSERT' or v_link_changed then
      if current_date < v_w.starts_on or current_date > v_w.ends_on then
        raise exception 'Garantia fora do período de cobertura' using errcode='23514';
      end if;
    end if;
  else
    if new.warranty_id is not null or new.origin_wo_id is not null then
      raise exception 'Vínculo de garantia exige visita em garantia' using errcode='23514';
    end if;
  end if;

  return new;
end $$;

revoke all on function zt_private.zt_validate_warranty_visit_linkage() from public,anon,authenticated;
grant execute on function zt_private.zt_validate_warranty_visit_linkage() to service_role;

drop trigger if exists trg_validate_warranty_visit_linkage on public.work_orders;
create trigger trg_validate_warranty_visit_linkage
before insert or update of is_warranty_visit,warranty_id,origin_wo_id,company_id,client_id
on public.work_orders
for each row execute function zt_private.zt_validate_warranty_visit_linkage();

create or replace function zt_private.zt_prevent_warranty_renewal_from_warranty_visit()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if new.work_order_id is not null and exists (
    select 1
      from public.work_orders w
     where w.id=new.work_order_id
       and w.company_id=new.company_id
       and w.is_warranty_visit=true
  ) then
    -- A conclusão de uma visita em garantia não abre/renova outra cobertura.
    return null;
  end if;
  return new;
end $$;

revoke all on function zt_private.zt_prevent_warranty_renewal_from_warranty_visit() from public,anon,authenticated;
grant execute on function zt_private.zt_prevent_warranty_renewal_from_warranty_visit() to service_role;

drop trigger if exists trg_prevent_warranty_renewal_from_warranty_visit on public.warranties;
create trigger trg_prevent_warranty_renewal_from_warranty_visit
before insert on public.warranties
for each row execute function zt_private.zt_prevent_warranty_renewal_from_warranty_visit();
