-- ZiisTec · Bloco 3 — Comprovante de Serviço (Documento não fiscal), somente proprietário.
--
-- A origem é a OS concluída. O comprovante reaproveita o snapshot imutável do Relatório de
-- Atendimento (0082) e acrescenta o bloco financeiro vigente na emissão, número próprio
-- (CS-0001), emissor e observações. A OS não é duplicada: o snapshot guarda só a projeção do
-- documento e as evidências entram por referência.
--
-- Emissão idempotente: o mesmo request_id devolve a mesma emissão e, sem motivo de reemissão,
-- uma OS mantém um único comprovante ativo. Reemissão exige motivo, cria a versão seguinte com o
-- mesmo número e desativa a anterior. Técnico não lê nem emite comprovante.

create table if not exists public.service_receipts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  work_order_id uuid not null,
  client_id uuid not null,
  number text not null,
  version integer not null,
  is_active boolean not null default true,
  snapshot jsonb not null,
  notes text,
  reissue_reason text,
  request_id uuid not null,
  issued_by uuid not null references public.profiles(id),
  issued_at timestamptz not null default now(),
  superseded_at timestamptz,
  constraint service_receipts_work_order_company_fk
    foreign key (work_order_id, company_id) references public.work_orders(id, company_id),
  constraint service_receipts_client_company_fk
    foreign key (client_id, company_id) references public.clients(id, company_id),
  constraint service_receipts_number_len check (char_length(number) between 1 and 50),
  constraint service_receipts_version_ck check (version >= 1),
  constraint service_receipts_snapshot_ck check (jsonb_typeof(snapshot)='object' and octet_length(snapshot::text) <= 750000),
  constraint service_receipts_notes_len check (notes is null or char_length(notes) <= 2000),
  constraint service_receipts_reissue_ck check (
    (version = 1 and reissue_reason is null)
    or (version > 1 and reissue_reason is not null and char_length(reissue_reason) between 1 and 500)
  ),
  constraint service_receipts_superseded_ck check (is_active = (superseded_at is null))
);

create unique index if not exists uq_service_receipts_request on public.service_receipts(company_id, request_id);
create unique index if not exists uq_service_receipts_version on public.service_receipts(work_order_id, version);
create unique index if not exists uq_service_receipts_active on public.service_receipts(work_order_id) where is_active;
create unique index if not exists uq_service_receipts_number_version on public.service_receipts(company_id, number, version);
create index if not exists idx_service_receipts_client on public.service_receipts(company_id, client_id, issued_at desc);

alter table public.service_receipts enable row level security;
revoke all on public.service_receipts from public, anon, authenticated;
grant select on public.service_receipts to authenticated;
drop policy if exists service_receipts_owner_select on public.service_receipts;
create policy service_receipts_owner_select on public.service_receipts
  for select to authenticated
  using (public.zt_is_owner(company_id));

-- Mantém o mesmo guard de assinatura dos demais dados operacionais.
drop trigger if exists trg_subscription_write_guard on public.service_receipts;
create trigger trg_subscription_write_guard
before insert or update or delete on public.service_receipts
for each row execute function public.zt_guard_subscription_write();

create or replace function public.zt_issue_service_receipt(
  p_wo uuid,
  p_request uuid,
  p_notes text default null,
  p_reissue_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();
  v_wo public.work_orders%rowtype;
  v_existing public.service_receipts%rowtype;
  v_active public.service_receipts%rowtype;
  v_has_active boolean:=false;
  v_report public.work_order_reports%rowtype;
  v_entry public.financial_entries%rowtype;
  v_notes text:=nullif(btrim(coalesce(p_notes,'')),'');
  v_reason text:=nullif(btrim(coalesce(p_reissue_reason,'')),'');
  v_total numeric(12,2);
  v_quote_based boolean;
  v_extras numeric(12,2):=0;
  v_subtotal numeric(12,2);
  v_discount numeric(12,2):=0;
  v_surcharge numeric(12,2):=0;
  v_status text;
  v_label text;
  v_number text;
  v_version integer;
  v_counter integer;
  v_issuer text;
  v_now timestamptz:=now();
  v_snapshot jsonb;
  v_row public.service_receipts%rowtype;
begin
  if v_uid is null then raise exception 'Não autenticado' using errcode='28000'; end if;
  if p_request is null then raise exception 'Identificador da emissão obrigatório' using errcode='22023'; end if;
  if v_notes is not null and char_length(v_notes)>2000 then
    raise exception 'Observações do comprovante devem ter no máximo 2.000 caracteres' using errcode='22023';
  end if;
  if v_reason is not null and char_length(v_reason)>500 then
    raise exception 'Motivo da reemissão deve ter no máximo 500 caracteres' using errcode='22023';
  end if;

  select w.* into v_wo from public.work_orders w where w.id=p_wo and w.deleted_at is null for update;
  if not found then raise exception 'OS não encontrada' using errcode='P0002'; end if;
  if not public.zt_is_owner(v_wo.company_id) then
    raise exception 'Somente o proprietário emite o Comprovante de Serviço' using errcode='42501';
  end if;
  perform zt_private.assert_operational_write_allowed(v_wo.company_id);
  if v_wo.status<>'done' then
    raise exception 'O comprovante só pode ser emitido para OS concluída' using errcode='23514';
  end if;
  if v_wo.pending_pricing then
    raise exception 'Defina os valores pendentes da OS antes de emitir o comprovante' using errcode='23514';
  end if;

  -- Retry do mesmo pedido devolve a mesma emissão.
  select r.* into v_existing from public.service_receipts r
   where r.company_id=v_wo.company_id and r.request_id=p_request;
  if found then
    if v_existing.work_order_id<>v_wo.id then
      raise exception 'Identificador já usado em outro comprovante' using errcode='23505';
    end if;
    return to_jsonb(v_existing);
  end if;

  select r.* into v_active from public.service_receipts r
   where r.work_order_id=v_wo.id and r.is_active
   for update;
  v_has_active:=found;
  if v_has_active and v_reason is null then
    return to_jsonb(v_active);
  end if;
  if not v_has_active and v_reason is not null then
    raise exception 'Não há comprovante anterior para reemitir' using errcode='22023';
  end if;

  -- OS concluída antes da 0082 não tem relatório: ele é criado sob demanda a partir da OS já
  -- travada (mesma função idempotente do trigger de conclusão), sem backfill em massa.
  select r.* into v_report from public.work_order_reports r
   where r.work_order_id=v_wo.id and r.company_id=v_wo.company_id
     and r.entry_type='service_report' and r.is_active;
  if not found then
    perform zt_private.zt_create_initial_service_report(v_wo.id);
    select r.* into v_report from public.work_order_reports r
     where r.work_order_id=v_wo.id and r.company_id=v_wo.company_id
       and r.entry_type='service_report' and r.is_active;
  end if;
  if v_report.id is null then
    raise exception 'Relatório de atendimento indisponível para esta OS' using errcode='P0002';
  end if;

  -- Mesma regra da cobrança (0068): orçamento usa o snapshot aprovado + extras precificados;
  -- OS direta soma os itens; visita de garantia não tem cobrança.
  v_total:=zt_private.zt_work_order_billable_total(v_wo.id);
  v_quote_based:=v_wo.quote_id is not null and v_wo.approved_total is not null and not v_wo.is_warranty_visit;
  if v_quote_based then
    select round(coalesce(sum(i.quantity*i.unit_price),0),2)::numeric(12,2) into v_extras
      from public.work_order_items i
     where i.work_order_id=v_wo.id and i.company_id=v_wo.company_id and i.is_extra and not i.price_pending;
    v_subtotal:=round(v_wo.approved_subtotal+v_extras,2);
    v_discount:=v_wo.approved_discount;
    v_surcharge:=v_wo.approved_surcharge;
  else
    v_subtotal:=v_total;
  end if;

  if v_wo.billing_entry_id is not null then
    select f.* into v_entry from public.financial_entries f
     where f.id=v_wo.billing_entry_id and f.company_id=v_wo.company_id and f.deleted_at is null;
  end if;
  if v_wo.is_warranty_visit then v_status:='warranty'; v_label:='Atendimento em garantia';
  elsif v_entry.id is null and coalesce(v_total,0)<=0 then v_status:='no_charge'; v_label:='Sem cobrança';
  elsif v_entry.id is null then v_status:='not_billed'; v_label:='Cobrança ainda não gerada';
  elsif coalesce(v_entry.paid,false) then v_status:='paid'; v_label:='Recebido';
  else v_status:='receivable'; v_label:='A receber';
  end if;

  if v_has_active then
    v_number:=v_active.number;
    v_version:=v_active.version+1;
    update public.service_receipts set is_active=false, superseded_at=v_now where id=v_active.id;
  else
    insert into public.document_counters(company_id,doc_type,last_value)
    values(v_wo.company_id,'service_receipt',1)
    on conflict (company_id,doc_type) do update set last_value=public.document_counters.last_value+1
    returning last_value into v_counter;
    v_number:='CS-'||lpad(v_counter::text,4,'0');
    v_version:=1;
  end if;

  select p.full_name into v_issuer from public.profiles p where p.id=v_uid;

  v_snapshot:=(v_report.snapshot - 'payment' - 'schema_version')
    || jsonb_build_object(
      'receipt_schema_version',1,
      'document',jsonb_build_object(
        'kind','service_receipt',
        'title','Comprovante de Serviço',
        'notice','Documento não fiscal',
        'number',v_number,
        'version',v_version,
        'issued_at',v_now,
        'issued_by',jsonb_build_object('id',v_uid,'name',v_issuer),
        'reissue_reason',v_reason
      ),
      'financial',jsonb_build_object(
        'quote_based',v_quote_based,
        'subtotal',v_subtotal,
        'discount',v_discount,
        'surcharge',v_surcharge,
        'total',v_total,
        'status',v_status,
        'status_label',v_label,
        'payment_method',v_entry.payment_method,
        'paid_at',v_entry.paid_at,
        'due_date',v_entry.due_date,
        'financial_entry_id',v_entry.id
      ),
      'notes',v_notes,
      'source_service_report',jsonb_build_object('id',v_report.id,'report_version',v_report.report_version)
    );

  insert into public.service_receipts(
    company_id,work_order_id,client_id,number,version,is_active,snapshot,notes,reissue_reason,request_id,issued_by,issued_at
  ) values (
    v_wo.company_id,v_wo.id,v_wo.client_id,v_number,v_version,true,v_snapshot,v_notes,v_reason,p_request,v_uid,v_now
  ) returning * into v_row;

  return to_jsonb(v_row);
end;
$$;

revoke all on function public.zt_issue_service_receipt(uuid,uuid,text,text) from public, anon;
grant execute on function public.zt_issue_service_receipt(uuid,uuid,text,text) to authenticated;

comment on table public.service_receipts is
  'Comprovante de Serviço (Documento não fiscal) emitido pelo proprietário a partir de OS concluída.';
