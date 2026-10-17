-- ZiisTec · Bloco 5 (0105) — o técnico executa a OS sem receber valores comerciais.
--
-- Regra já aprovada (AGENTS.md, PROJECT_MEMORY, PERMISSOES do legado sem verValores): o técnico vê a OS
-- atribuída para trabalhar e só vê preço final na venda em campo de produto liberado
-- (zt_technician_catalog / field_sales). Custo e margem já estavam isolados (0053/0054).
-- Até aqui o RLS ainda entregava ao técnico atribuído, pela Data API:
--   * a linha bruta service_report (0082), com bloco payment e preço por item;
--   * work_order_items.unit_price de cada serviço/produto da OS;
--   * work_orders.approved_subtotal/discount/surcharge/total (snapshot comercial do orçamento, 0068).
-- Esta migration porta a antiga 0093 (branch blocks-3-4-os-history-receipt) e aplica o mesmo padrão
-- (o técnico não lê o dado bruto; recebe uma projeção que o banco monta pelo papel) aos itens e ao snapshot.
-- Nenhuma escrita, cobrança, snapshot ou regra de preço muda. Owner continua lendo tudo como antes.
--
-- Ordem de deploy: work_orders deixa de aceitar "select *" pela Data API (SELECT por coluna). O frontend
-- desta versão já lista as colunas; o frontend antigo (Beta Live) quebraria com esta migration.

-- ---------------------------------------------------------------- 1. Relatório de Atendimento
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

-- ---------------------------------------------------------------- 2. Itens da OS
-- Leitura direta só do proprietário. O técnico continua inserindo adicional sem preço (p_wo_items_insert,
-- inalterada) e recebe os itens das OS atribuídas a ele pela projeção abaixo: o que fazer, quantidade e
-- se o valor está pendente com o proprietário ("valor a definir"), nunca unit_price/unit_cost.
alter policy p_wo_items_select on public.work_order_items
  using (public.zt_wo_is_owned(work_order_id));

create or replace function public.zt_field_work_order_items(p_company uuid, p_wo uuid default null)
returns table(
  id uuid,
  work_order_id uuid,
  company_id uuid,
  kind public.zt_item_kind,
  service_id uuid,
  product_id uuid,
  name text,
  unit text,
  quantity numeric,
  is_extra boolean,
  price_pending boolean,
  notes text,
  warranty_policy text,
  warranty_override_days integer,
  warranty_override_months integer
)
language plpgsql
stable
security definer
set search_path=''
as $$
#variable_conflict use_column
begin
  if auth.uid() is null then raise exception 'Não autenticado' using errcode='28000'; end if;
  if p_company is null or not zt_private.is_member(p_company) then
    raise exception 'Sem acesso ativo à empresa' using errcode='42501';
  end if;
  -- O proprietário lê work_order_items direto (com preço); a projeção de campo não se aplica a ele.
  if zt_private.is_owner(p_company) then return; end if;

  return query
    select i.id,i.work_order_id,i.company_id,i.kind,i.service_id,i.product_id,i.name,i.unit,i.quantity,
           i.is_extra,i.price_pending,i.notes,i.warranty_policy,i.warranty_override_days,i.warranty_override_months
      from public.work_order_items i
      join public.work_orders w on w.id=i.work_order_id and w.company_id=i.company_id
     where i.company_id=p_company
       and w.assigned_to=auth.uid()
       and (p_wo is null or w.id=p_wo)
     order by i.work_order_id,i.id;
end;
$$;

revoke all on function public.zt_field_work_order_items(uuid,uuid) from public, anon;
grant execute on function public.zt_field_work_order_items(uuid,uuid) to authenticated;

-- ---------------------------------------------------------------- 3. Snapshot comercial na OS
-- Nenhum caminho do app lê approved_* direto: os leitores são SECURITY DEFINER (0068 cobrança, 0082
-- relatório, 0100 comprovante, 0104 histórico) e seguem lendo como dono da tabela. authenticated passa
-- a ter SELECT por coluna em todas as colunas exceto estas quatro; UPDATE/INSERT/DELETE não mudam e o
-- snapshot continua imutável pelos triggers da 0068. Coluna nova em work_orders precisa de grant de
-- SELECT explícito (o teste do Bloco 5 falha se faltar).
revoke select on table public.work_orders from authenticated;
do $$
declare v_cols text;
begin
  select string_agg(quote_ident(a.attname),', ' order by a.attnum) into strict v_cols
    from pg_attribute a
   where a.attrelid='public.work_orders'::regclass and a.attnum>0 and not a.attisdropped
     and a.attname not in ('approved_subtotal','approved_discount','approved_surcharge','approved_total');
  execute format('grant select (%s) on table public.work_orders to authenticated',v_cols);
end $$;

comment on function public.zt_get_service_report(uuid) is
  'Relatório de Atendimento ativo: snapshot completo ao proprietário; ao técnico atribuído, sem pagamento nem preço por item.';
comment on function public.zt_field_work_order_items(uuid,uuid) is
  'Itens das OS atribuídas ao técnico, sem unit_price/unit_cost. Proprietário lê work_order_items direto.';
