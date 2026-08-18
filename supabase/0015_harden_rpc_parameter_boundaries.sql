-- Endurece parâmetros de RPCs expostas sem mudar os fluxos normais do app.

create or replace function public.zt_complete_work_order(
  p_wo uuid,
  p_report text default null,
  p_pending text default null,
  p_extra_cost numeric default 0,
  p_due_days integer default 7
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wo public.work_orders;
  v_total numeric(12,2);
  v_entry uuid;
  v_uid uuid := auth.uid();
  v_is_owner boolean;
  v_assigned boolean;
  v_pendente boolean;
  r record;
begin
  if v_uid is null then raise exception 'Não autenticado' using errcode = '28000'; end if;

  select * into v_wo from public.work_orders where id = p_wo for update;
  if v_wo.id is null then raise exception 'Ordem de serviço não encontrada' using errcode = '42501'; end if;

  select public.zt_is_owner(v_wo.company_id) into v_is_owner;
  v_assigned := (v_wo.assigned_to = v_uid) and exists (
    select 1 from public.company_members m
    where m.company_id = v_wo.company_id and m.user_id = v_uid and m.status = 'active'
  );
  if not (v_is_owner or v_assigned) then
    raise exception 'Sem permissão para finalizar esta ordem de serviço' using errcode = '42501';
  end if;

  if exists (select 1 from public.subscriptions s
             where s.company_id = v_wo.company_id and s.status in ('suspended','canceled','past_due')) then
    raise exception 'Assinatura inativa' using errcode = '42501';
  end if;

  if v_wo.status = 'done' or v_wo.billing_entry_id is not null then
    return v_wo.billing_entry_id;
  end if;

  if not v_is_owner then
    p_extra_cost := v_wo.extra_cost;
    p_due_days := 7;
  end if;

  p_due_days := greatest(0, least(coalesce(p_due_days, 7), 365));
  p_extra_cost := greatest(coalesce(p_extra_cost, 0), 0);
  if p_report is not null and length(p_report) > 10000 then raise exception 'Relato muito longo'; end if;
  if p_pending is not null and length(p_pending) > 5000 then raise exception 'Pendência muito longa'; end if;

  select coalesce(sum(quantity * unit_price), 0) into v_total
    from public.work_order_items where work_order_id = p_wo;

  select exists (select 1 from public.work_order_items
                 where work_order_id = p_wo and price_pending) into v_pendente;

  update public.work_orders
     set status = 'done', completed_at = now(), pending_note = coalesce(p_pending, pending_note),
         extra_cost = p_extra_cost, updated_at = now()
   where id = p_wo;

  if p_report is not null and length(trim(p_report)) > 0 then
    insert into public.work_order_reports(work_order_id, company_id, entry_type, body, author_id)
    values (p_wo, v_wo.company_id, 'report', p_report, auth.uid());
  end if;

  insert into public.work_order_reports(work_order_id, company_id, entry_type, body, author_id)
  values (p_wo, v_wo.company_id, 'history', 'Serviço concluído', auth.uid());

  for r in
    select i.service_id, i.product_id, i.name, s.warranty_days, p.warranty_months
      from public.work_order_items i
      left join public.services s on s.id = i.service_id
      left join public.products p on p.id = i.product_id
     where i.work_order_id = p_wo
  loop
    if r.service_id is not null and coalesce(r.warranty_days,0) > 0 then
      insert into public.warranties(company_id, client_id, work_order_id, kind, service_id,
                                    description, service_place, starts_on, ends_on)
      values (v_wo.company_id, v_wo.client_id, p_wo, 'service', r.service_id,
              left(r.name,500), v_wo.service_place, current_date, current_date + least(r.warranty_days,3650));
    end if;
    if r.product_id is not null and coalesce(r.warranty_months,0) > 0 then
      insert into public.warranties(company_id, client_id, work_order_id, kind, product_id,
                                    description, service_place, starts_on, ends_on)
      values (v_wo.company_id, v_wo.client_id, p_wo, 'product', r.product_id,
              left(r.name,500), v_wo.service_place, current_date,
              (current_date + (least(r.warranty_months,120) || ' months')::interval)::date);
    end if;
  end loop;

  update public.work_orders set pending_pricing = v_pendente where id = p_wo;

  if v_pendente then
    insert into public.work_order_reports(work_order_id, company_id, entry_type, body, author_id)
    values (p_wo, v_wo.company_id, 'history',
            'Execução concluída. Há adicional aguardando precificação do proprietário — cobrança não gerada.', auth.uid());
    return null;
  end if;

  if v_total > 0 and not v_wo.is_warranty_visit then
    insert into public.financial_entries(company_id, kind, description, amount, due_date,
                                         client_id, work_order_id, category)
    values (v_wo.company_id, 'income', left(v_wo.number || ' · atendimento',500), v_total,
            current_date + p_due_days, v_wo.client_id, p_wo, 'Serviços')
    on conflict (work_order_id) where work_order_id is not null do nothing
    returning id into v_entry;

    if v_entry is null then
      select id into v_entry from public.financial_entries where work_order_id = p_wo;
    end if;

    update public.work_orders set billing_entry_id = v_entry where id = p_wo;
    insert into public.work_order_reports(work_order_id, company_id, entry_type, body, author_id)
    values (p_wo, v_wo.company_id, 'history', 'Cobrança gerada em contas a receber', auth.uid());
  end if;

  return v_entry;
end $$;

create or replace function public.zt_bill_work_order(p_wo uuid, p_due_days integer default 7)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_wo public.work_orders; v_total numeric(12,2); v_entry uuid;
begin
  if auth.uid() is null then raise exception 'Não autenticado' using errcode = '28000'; end if;
  select * into v_wo from public.work_orders where id = p_wo for update;
  if v_wo.id is null then raise exception 'Ordem de serviço não encontrada' using errcode = '42501'; end if;
  if not public.zt_is_owner(v_wo.company_id) then raise exception 'Somente o proprietário consolida a cobrança' using errcode = '42501'; end if;
  if v_wo.billing_entry_id is not null then return v_wo.billing_entry_id; end if;
  if v_wo.status <> 'done' then raise exception 'Atendimento ainda não foi concluído' using errcode = '42501'; end if;
  if exists (select 1 from public.work_order_items where work_order_id = p_wo and price_pending) then raise exception 'Ainda há adicional sem preço definido' using errcode = '42501'; end if;
  if v_wo.is_warranty_visit then update public.work_orders set pending_pricing = false where id = p_wo; return null; end if;
  p_due_days := greatest(0, least(coalesce(p_due_days,7),365));
  select coalesce(sum(quantity * unit_price), 0) into v_total from public.work_order_items where work_order_id = p_wo;
  if v_total <= 0 then update public.work_orders set pending_pricing = false where id = p_wo; return null; end if;
  insert into public.financial_entries(company_id, kind, description, amount, due_date, client_id, work_order_id, category)
  values (v_wo.company_id, 'income', left(v_wo.number || ' · atendimento',500), v_total,
          current_date + p_due_days, v_wo.client_id, p_wo, 'Serviços')
  on conflict (work_order_id) where work_order_id is not null do nothing returning id into v_entry;
  if v_entry is null then select id into v_entry from public.financial_entries where work_order_id = p_wo; end if;
  update public.work_orders set billing_entry_id = v_entry, pending_pricing = false where id = p_wo;
  insert into public.work_order_reports(work_order_id, company_id, entry_type, body, author_id)
  values (p_wo, v_wo.company_id, 'history', 'Cobrança gerada em contas a receber', auth.uid());
  return v_entry;
end $$;

create or replace function public.zt_next_number(comp uuid, doc text, prefix text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare n int; expected_prefix text;
begin
  if auth.uid() is null then raise exception 'Não autenticado' using errcode = '28000'; end if;
  if not public.zt_is_owner(comp) then raise exception 'Sem permissão para gerar numeração nesta empresa' using errcode = '42501'; end if;
  expected_prefix := case doc when 'quote' then 'ORC' when 'work_order' then 'OS' when 'purchase' then 'CMP' else null end;
  if expected_prefix is null then raise exception 'Tipo de documento inválido'; end if;
  if prefix is distinct from expected_prefix then raise exception 'Prefixo inválido'; end if;
  insert into public.document_counters(company_id, doc_type, last_value)
  values (comp, doc, 1)
  on conflict (company_id, doc_type) do update set last_value = public.document_counters.last_value + 1
  returning last_value into n;
  return expected_prefix || '-' || lpad(n::text, 4, '0');
end $$;

create or replace function public.zt_update_team_member(p_company uuid, p_user uuid, p_name text default null, p_phone text default null, p_job_title text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Não autenticado' using errcode = '28000'; end if;
  if not public.zt_is_owner(p_company) then raise exception 'Somente o proprietário pode editar a equipe' using errcode = '42501'; end if;
  if not exists (select 1 from public.company_members where company_id=p_company and user_id=p_user and role='technician') then
    raise exception 'Colaborador não encontrado nesta empresa' using errcode='42501';
  end if;
  if p_name is not null and length(p_name)>200 then raise exception 'Nome muito longo'; end if;
  if p_phone is not null and length(p_phone)>40 then raise exception 'Telefone muito longo'; end if;
  if p_job_title is not null and length(p_job_title)>120 then raise exception 'Função muito longa'; end if;
  update public.profiles set full_name=coalesce(nullif(trim(p_name),''),full_name), phone=case when p_phone is null then phone else nullif(trim(p_phone),'') end where id=p_user;
  update public.company_members set job_title=nullif(trim(p_job_title),'') where company_id=p_company and user_id=p_user;
end $$;

revoke execute on function public.zt_complete_work_order(uuid,text,text,numeric,integer) from public, anon;
revoke execute on function public.zt_bill_work_order(uuid,integer) from public, anon;
revoke execute on function public.zt_next_number(uuid,text,text) from public, anon;
revoke execute on function public.zt_update_team_member(uuid,uuid,text,text,text) from public, anon;
grant execute on function public.zt_complete_work_order(uuid,text,text,numeric,integer) to authenticated, service_role;
grant execute on function public.zt_bill_work_order(uuid,integer) to authenticated, service_role;
grant execute on function public.zt_next_number(uuid,text,text) to authenticated, service_role;
grant execute on function public.zt_update_team_member(uuid,uuid,text,text,text) to authenticated, service_role;
