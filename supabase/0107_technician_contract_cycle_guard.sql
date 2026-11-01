-- ZiisTec · Auditoria de segurança V1 (SEC-01) — o técnico não reescreve o vínculo de contrato da OS.
--
-- Problema: o guard de UPDATE do técnico (0012, vigente desde a 0031) lista os campos administrativos e
-- financeiros da OS que o técnico não pode mudar (cliente, orçamento, responsável, extra_cost, garantia,
-- billing_entry_id etc.), mas foi escrito antes da 0052 e não cobre maintenance_contract_id nem
-- contract_cycle. Como o técnico atribuído tem UPDATE na própria OS e enxerga esses dois campos nas OS de
-- contrato que recebe, ele podia, pela Data API, gravar na sua OS o contrato e o ciclo FUTURO. Quando o
-- proprietário gerava esse ciclo, zt_generate_maintenance_contract_cycle encontrava uma OS com o mesmo
-- (contrato, ciclo), respondia "reused" e não criava a cobrança: faturamento do ciclo suprimido sem
-- nenhum erro visível.
--
-- Correção: o corpo é idêntico ao da 0031 e só acrescenta os dois campos à lista. O proprietário, as
-- funções SECURITY DEFINER confiáveis (zt_generate_maintenance_contract_cycle, zt_save_work_order, a
-- finalização) e qualquer chamada sem papel authenticated continuam livres, como antes. Nenhuma tabela,
-- policy, grant ou assinatura de função muda; o trigger trg_guard_work_order_technician_update (0012) já
-- chama esta função pelo nome.

create or replace function public.zt_guard_work_order_technician_update()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  -- Chamadas internas via funções SECURITY DEFINER confiáveis executam com papel
  -- privilegiado e já fazem suas próprias validações de auth.uid()/membership.
  if current_user not in ('authenticated','anon') then
    return new;
  end if;

  if auth.uid() is null then
    return new;
  end if;

  if public.zt_is_owner(old.company_id) then
    return new;
  end if;

  if not public.zt_wo_is_mine(old.id) then
    raise exception 'Sem permissão para alterar esta ordem de serviço' using errcode='42501';
  end if;

  if new.id is distinct from old.id
     or new.company_id is distinct from old.company_id
     or new.number is distinct from old.number
     or new.client_id is distinct from old.client_id
     or new.quote_id is distinct from old.quote_id
     or new.assigned_to is distinct from old.assigned_to
     or new.extra_cost is distinct from old.extra_cost
     or new.pending_pricing is distinct from old.pending_pricing
     or new.warranty_id is distinct from old.warranty_id
     or new.origin_wo_id is distinct from old.origin_wo_id
     or new.is_warranty_visit is distinct from old.is_warranty_visit
     or new.billing_entry_id is distinct from old.billing_entry_id
     or new.maintenance_contract_id is distinct from old.maintenance_contract_id
     or new.contract_cycle is distinct from old.contract_cycle
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'Técnicos não podem alterar campos administrativos ou financeiros da OS' using errcode='42501';
  end if;

  return new;
end;
$$;

-- Mesmas permissões da 0031: a função só roda como trigger, nunca por RPC.
revoke execute on function public.zt_guard_work_order_technician_update() from public, anon, authenticated;

-- Higiene de ACL (auditoria V1): as duas funções de trava de documento finalizado (0044) são de trigger e ficaram
-- com EXECUTE para PUBLIC, ao contrário das demais funções do aplicativo. Trigger não precisa de EXECUTE para disparar
-- (a permissão é conferida só na criação do trigger), e a chamada direta já falha por ser função de trigger; o ajuste
-- apenas alinha o inventário: nenhuma função do aplicativo fica executável por anon/PUBLIC.
revoke execute on function public.zt_guard_locked_document_parent() from public, anon, authenticated;
revoke execute on function public.zt_guard_locked_document_child() from public, anon, authenticated;
