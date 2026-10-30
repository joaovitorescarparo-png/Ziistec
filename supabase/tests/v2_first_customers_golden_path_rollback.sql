-- ZiisTec · First 10 Customers — jornada completa de um cliente real, do orçamento ao comprovante, pelas RPCs e políticas reais.
--   cliente → orçamento → edição → aprovação → OS com responsável e agendamento → "recarregar" (leitura pelas colunas do app)
--   → técnico executa (início, evidência, relato, Base Técnica, confirmação) → conclusão → financeiro → comprovante não fiscal
--   → histórico; a empresa B não enxerga nem alcança nada disso. Complementa os testes por recurso (F01, F03, Blocos 3–5, 0111).
-- Usa as identidades sintéticas de ci_local_seed.sql. Destino: SOMENTE CI descartável ou homologação. Tudo termina em ROLLBACK.

begin;

create temp table gp_results (name text primary key, ok boolean not null, detail text) on commit drop;
create temp table gp_ctx (k text primary key, v text) on commit drop;
grant select, insert, update on gp_results, gp_ctx to authenticated, anon;

create function pg_temp.gp_check(p_name text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into gp_results(name,ok,detail) values (p_name,coalesce(p_ok,false),left(p_detail,400));
$$;
create function pg_temp.gp_set(p_k text, p_v text) returns void language sql as $$
  insert into gp_ctx(k,v) values (p_k,p_v) on conflict (k) do update set v=excluded.v;
$$;
create function pg_temp.gp_get(p_k text) returns text language sql as $$ select v from gp_ctx where k=p_k; $$;
create function pg_temp.gp_state(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $$;
create function pg_temp.gp_count(p_sql text) returns bigint language plpgsql as $$
declare n bigint;
begin execute 'select count(*) from ('||p_sql||') q' into n; return n; exception when others then return -1; end $$;
create function pg_temp.gp_as(p_uid uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claim.sub',p_uid::text,true);
  perform set_config('request.jwt.claims',json_build_object('sub',p_uid,'role','authenticated','aal','aal1')::text,true);
  set local role authenticated;
end $$;

do $$
begin
  if current_setting('session_replication_role') <> 'origin' then raise exception 'GP_REQUIRES_ORIGIN'; end if;
  if (select count(*) from public.company_members where status='active'
        and (company_id,user_id,role) in (
          ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','owner'),
          ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000003','technician'),
          ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','owner')))<>3 then
    raise exception 'GP_FIXTURE_MISSING';
  end if;
end $$;

-- ---------------------------------------------------------------- 1. proprietário A: cliente, orçamento, edição, aprovação
select pg_temp.gp_as('10000000-0000-0000-0000-000000000001');
do $$
declare
  a constant uuid:='20000000-0000-0000-0000-000000000001';
  v_client uuid:='f3000000-0000-4000-8000-0000000000c1';
  v_q uuid; v_q2 uuid; v_req1 uuid:=gen_random_uuid(); v_req2 uuid:=gen_random_uuid();
begin
  insert into public.clients(id,company_id,name,phone,address)
    values (v_client,a,'__GP_CLIENTE__','11999990000','Rua do Primeiro Cliente, 10');
  perform pg_temp.gp_set('client',v_client::text);

  v_q:=public.zt_save_quote_idempotent(a,null,v_req1,
    jsonb_build_object('client_id',v_client,'status','draft','issue_date',current_date,'discount',10,'surcharge',0,'payment_terms','Pix','notes','Orçamento GP','address','Rua do Primeiro Cliente, 10'),
    jsonb_build_array(
      jsonb_build_object('kind','free','name','Instalação de split','unit','serviço','quantity',1,'unit_price',500,'position',0),
      jsonb_build_object('kind','free','name','Suporte de parede','unit','unidade','quantity',2,'unit_price',60,'position',1)));
  perform pg_temp.gp_set('quote',v_q::text);
  perform pg_temp.gp_check('orc_criado_em_rascunho_com_numero_e_itens',
    (select status::text='draft' and number is not null and discount=10 from public.quotes where id=v_q)
    and (select count(*) from public.quote_items where quote_id=v_q)=2, null);
  perform pg_temp.gp_check('orc_reenvio_do_mesmo_pedido_nao_duplica',
    public.zt_save_quote_idempotent(a,null,v_req1,
      jsonb_build_object('client_id',v_client,'status','draft','issue_date',current_date,'discount',10,'surcharge',0,'payment_terms','Pix','notes','Orçamento GP','address','Rua do Primeiro Cliente, 10'),
      jsonb_build_array(
        jsonb_build_object('kind','free','name','Instalação de split','unit','serviço','quantity',1,'unit_price',500,'position',0),
        jsonb_build_object('kind','free','name','Suporte de parede','unit','unidade','quantity',2,'unit_price',60,'position',1)))=v_q
    and (select count(*) from public.quotes where client_id=v_client)=1, null);

  -- Edição do orçamento: mesmo id, novo pedido, desconto e itens diferentes (3 itens, total 500+120+80-20 = 680).
  v_q2:=public.zt_save_quote_idempotent(a,v_q,v_req2,
    jsonb_build_object('client_id',v_client,'status','draft','issue_date',current_date,'discount',20,'surcharge',0,'payment_terms','Pix 50%','notes','Orçamento GP editado','address','Rua do Primeiro Cliente, 10'),
    jsonb_build_array(
      jsonb_build_object('kind','free','name','Instalação de split','unit','serviço','quantity',1,'unit_price',500,'position',0),
      jsonb_build_object('kind','free','name','Suporte de parede','unit','unidade','quantity',2,'unit_price',60,'position',1),
      jsonb_build_object('kind','free','name','Dreno extra','unit','unidade','quantity',1,'unit_price',80,'position',2)));
  perform pg_temp.gp_check('orc_edicao_mantem_o_id_e_grava_desconto_itens_e_condicao',
    v_q2=v_q and (select discount=20 and payment_terms='Pix 50%' and notes='Orçamento GP editado' from public.quotes where id=v_q)
    and (select count(*) from public.quote_items where quote_id=v_q)=3
    and (select sum(quantity*unit_price) from public.quote_items where quote_id=v_q)=700, null);
  -- Ordem em que o PDF do orçamento (api/quote-pdf.js) lista os itens.
  perform pg_temp.gp_check('orc_itens_voltam_na_ordem_do_orcamento',
    (select string_agg(name,'|' order by position) from public.quote_items where quote_id=v_q)='Instalação de split|Suporte de parede|Dreno extra', null);

  update public.quotes set status='approved' where id=v_q;
  perform pg_temp.gp_check('orc_aprovado', (select status::text='approved' from public.quotes where id=v_q), null);
end $$;

-- ---------------------------------------------------------------- 2. OS a partir do orçamento: responsável e agendamento persistem
do $$
declare
  v_q uuid:=pg_temp.gp_get('quote')::uuid;
  v_wo uuid; v_retry uuid; w record;
  tech constant uuid:='10000000-0000-0000-0000-000000000003';
begin
  v_wo:=public.zt_create_work_order_from_quote(v_q,tech,current_date+2,'14:30');
  perform pg_temp.gp_set('wo',v_wo::text);
  -- "recarregar a página": leitura pelas colunas que o app pede.
  select assigned_to,scheduled_date,scheduled_time,status::text st,quote_id,client_id into w from public.work_orders where id=v_wo;
  perform pg_temp.gp_check('os_responsavel_e_agendamento_persistem_apos_recarregar',
    w.assigned_to=tech and w.scheduled_date=current_date+2 and w.scheduled_time='14:30' and w.st='scheduled'
    and w.quote_id=v_q and w.client_id=pg_temp.gp_get('client')::uuid, row(w.assigned_to,w.scheduled_date,w.scheduled_time,w.st)::text);
  v_retry:=public.zt_create_work_order_from_quote(v_q,tech,current_date+2,'14:30');
  perform pg_temp.gp_check('os_segundo_toque_no_botao_devolve_a_mesma_os',
    v_retry=v_wo and (select count(*) from public.work_orders where quote_id=v_q)=1, null);
  perform pg_temp.gp_check('os_copia_os_tres_itens_do_orcamento_editado',
    (select count(*) from public.work_order_items where work_order_id=v_wo)=3, null);

  update public.work_orders set scheduled_date=current_date+3, scheduled_time='09:15' where id=v_wo;
  select assigned_to,scheduled_date,scheduled_time,status::text st into w from public.work_orders where id=v_wo;
  perform pg_temp.gp_check('os_reagendar_persiste_e_mantem_o_responsavel',
    w.assigned_to=tech and w.scheduled_date=current_date+3 and w.scheduled_time='09:15' and w.st='scheduled', row(w.assigned_to,w.scheduled_date,w.scheduled_time,w.st)::text);
end $$;

-- ---------------------------------------------------------------- 3. técnico A: vê só o que é dele, sem preço; executa e conclui
select pg_temp.gp_as('10000000-0000-0000-0000-000000000003');
do $$
declare
  a constant uuid:='20000000-0000-0000-0000-000000000001';
  v_wo uuid:=pg_temp.gp_get('wo')::uuid;
  sha constant text:=repeat('9',64);
  v_path text; v_st text;
  w record;
begin
  perform pg_temp.gp_check('tec_ve_a_propria_os_agendada_e_o_cliente',
    (select scheduled_date=current_date+3 and scheduled_time='09:15' and assigned_to='10000000-0000-0000-0000-000000000003' from public.work_orders where id=v_wo)
    and (select count(*) from public.clients where id=pg_temp.gp_get('client')::uuid)=1, null);
  perform pg_temp.gp_check('tec_nao_le_preco_nem_orcamento_nem_financeiro',
    pg_temp.gp_count($q$select 1 from public.work_order_items$q$)=0
    and pg_temp.gp_count($q$select 1 from public.quotes$q$)=0
    and pg_temp.gp_count($q$select 1 from public.financial_entries$q$)=0
    and pg_temp.gp_count($q$select 1 from public.service_receipts$q$)=0, null);

  update public.work_orders set status='in_progress' where id=v_wo;
  select status::text st,started_by,started_at into w from public.work_orders where id=v_wo;
  perform pg_temp.gp_check('tec_inicia_a_execucao_e_o_banco_registra_quem_iniciou',
    w.st='in_progress' and w.started_by='10000000-0000-0000-0000-000000000003' and w.started_at is not null, row(w.st,w.started_by)::text);

  v_path:=a::text||'/work-orders/'||v_wo::text||'/after/'||sha||'.jpg';
  v_st:=pg_temp.gp_state(format($q$select public.zt_register_work_order_evidence(%L,%L,%L,'depois.jpg','image/jpeg',204800,'after','Equipamento instalado',null,%L)$q$,a,v_wo,v_path,sha));
  perform pg_temp.gp_check('tec_registra_foto_da_propria_os',
    v_st='ok' and (select count(*) from public.attachments where work_order_id=v_wo)=1, v_st||'/'||(select count(*) from public.attachments where work_order_id=v_wo));
  perform pg_temp.gp_check('tec_salva_relato_base_tecnica_e_confirmacao',
    pg_temp.gp_state(format($q$select public.zt_save_work_order_report(%L,'Instalação concluída e testada.',%L)$q$,v_wo,gen_random_uuid()))='ok'
    and pg_temp.gp_state(format($q$select public.zt_save_work_order_technical_base(%L,'Falta de dreno','Instalado dreno novo','medium','Conferir caimento do dreno',%L)$q$,v_wo,gen_random_uuid()))='ok'
    and pg_temp.gp_state(format($q$select public.zt_save_attendance_confirmation(%L,'Dona Maria',false,%L)$q$,v_wo,gen_random_uuid()))='ok', null);

  perform pg_temp.gp_check('tec_conclui_a_os_em_uma_chamada_atomica',
    pg_temp.gp_state(format($q$select public.zt_finalize_work_order_atomic(%L,'Instalação concluída e testada.',null,null,7,'[]'::jsonb,'[]'::jsonb)$q$,v_wo))='ok', null);
  select status::text st,completed_by,completed_at into w from public.work_orders where id=v_wo;
  perform pg_temp.gp_check('os_concluida_com_quem_concluiu_e_quando',
    w.st='done' and w.completed_by='10000000-0000-0000-0000-000000000003' and w.completed_at is not null, row(w.st,w.completed_by)::text);
  perform pg_temp.gp_check('tec_nao_emite_comprovante_nem_ve_o_financeiro_depois_de_concluir',
    pg_temp.gp_state(format($q$select public.zt_issue_service_receipt(%L,%L,null,null)$q$,v_wo,gen_random_uuid()))='42501'
    and pg_temp.gp_count($q$select 1 from public.financial_entries$q$)=0, null);
end $$;

-- ---------------------------------------------------------------- 4. proprietário A: financeiro, comprovante não fiscal e histórico
select pg_temp.gp_as('10000000-0000-0000-0000-000000000001');
do $$
declare
  v_wo uuid:=pg_temp.gp_get('wo')::uuid;
  v_client uuid:=pg_temp.gp_get('client')::uuid;
  v_entry uuid; v_req uuid:=gen_random_uuid(); r jsonb; r2 jsonb; s jsonb; h jsonb; v_st text;
begin
  perform pg_temp.gp_check('fin_conclusao_gerou_um_unico_lancamento_com_o_total_aprovado',
    (select count(*) from public.financial_entries where work_order_id=v_wo and deleted_at is null)=1
    and (select amount=680 and kind::text='income' and client_id=v_client and paid=false from public.financial_entries where work_order_id=v_wo and deleted_at is null),
    (select amount::text||'/'||kind::text||'/'||paid::text from public.financial_entries where work_order_id=v_wo limit 1));
  select id into v_entry from public.financial_entries where work_order_id=v_wo and deleted_at is null;
  perform pg_temp.gp_check('fin_os_aponta_para_o_lancamento_de_origem',
    (select billing_entry_id=v_entry from public.work_orders where id=v_wo), null);
  v_st:=pg_temp.gp_state(format($q$select public.zt_set_financial_paid(%L,true,'pix')$q$,v_entry));
  perform pg_temp.gp_check('fin_dono_marca_como_pago',
    v_st='ok' and (select paid and payment_method='pix' and paid_at is not null from public.financial_entries where id=v_entry), v_st);

  r:=public.zt_issue_service_receipt(v_wo,v_req,'Garantia de 90 dias no serviço');
  perform pg_temp.gp_set('receipt',r->>'id');
  s:=r->'snapshot';
  perform pg_temp.gp_check('comprovante_emitido_com_numero_e_aviso_de_documento_nao_fiscal',
    r->>'number' ~ '^CS-[0-9]{4,}$' and (r->>'version')::int=1 and (r->>'is_active')::boolean
    and s#>>'{document,notice}'='Documento não fiscal' and s#>>'{document,kind}'='service_receipt', r::text);
  perform pg_temp.gp_check('comprovante_traz_empresa_cliente_os_tecnico_valor_e_observacao',
    coalesce(s#>>'{company,name}','')<>'' and s#>>'{client,name}'='__GP_CLIENTE__'
    and s#>>'{work_order,number}'=(select number from public.work_orders where id=v_wo)
    and coalesce(s#>>'{technician,name}','')<>'' and (s#>>'{financial,total}')::numeric=680
    and s->>'notes'='Garantia de 90 dias no serviço', left(s::text,300));
  perform pg_temp.gp_check('comprovante_traz_os_tres_itens_do_orcamento_editado',
    jsonb_array_length(s->'items')=3 and (select string_agg(i->>'name','|' order by i->>'name') from jsonb_array_elements(s->'items') i)='Dreno extra|Instalação de split|Suporte de parede', null);
  perform pg_temp.gp_check('comprovante_nao_carrega_custo_nem_margem',
    s::text !~* '(unit_cost|margin|margem|"cost")', null);
  r2:=public.zt_issue_service_receipt(v_wo,v_req,'Garantia de 90 dias no serviço');
  perform pg_temp.gp_check('comprovante_mesmo_pedido_devolve_a_mesma_emissao',
    r2->>'id'=r->>'id' and (select count(*) from public.service_receipts where work_order_id=v_wo)=1, null);

  h:=public.zt_client_service_history(v_client,null,20);
  perform pg_temp.gp_check('historico_do_cliente_lista_a_os_concluida_com_tecnico_valor_e_pagamento',
    jsonb_array_length(h)=1 and h#>>'{0,work_order_id}'=v_wo::text and h#>>'{0,status}'='done'
    and (h#>>'{0,billed_amount}')::numeric=680 and (h#>>'{0,paid}')::boolean
    and coalesce(h#>>'{0,technician}','')<>'' and h#>>'{0,number}'=(select number from public.work_orders where id=v_wo), left(h::text,300));
  perform pg_temp.gp_check('historico_detalhe_da_os_responde_ao_dono',
    pg_temp.gp_state(format($q$select public.zt_work_order_history_detail(%L)$q$,v_wo))='ok', null);
end $$;

-- ---------------------------------------------------------------- 5. empresa B: nada disso é visível nem alcançável
select pg_temp.gp_as('10000000-0000-0000-0000-000000000002');
do $$
declare
  v_wo text:=pg_temp.gp_get('wo'); v_client text:=pg_temp.gp_get('client'); v_q text:=pg_temp.gp_get('quote'); v_receipt text:=pg_temp.gp_get('receipt');
begin
  perform pg_temp.gp_check('b_nao_ve_cliente_orcamento_os_financeiro_comprovante_nem_evidencia',
    pg_temp.gp_count(format($q$select 1 from public.clients where id=%L$q$,v_client))=0
    and pg_temp.gp_count(format($q$select 1 from public.quotes where id=%L$q$,v_q))=0
    and pg_temp.gp_count(format($q$select 1 from public.work_orders where id=%L$q$,v_wo))=0
    and pg_temp.gp_count(format($q$select 1 from public.financial_entries where work_order_id=%L$q$,v_wo))=0
    and pg_temp.gp_count(format($q$select 1 from public.service_receipts where id=%L$q$,v_receipt))=0
    and pg_temp.gp_count(format($q$select 1 from public.attachments where work_order_id=%L$q$,v_wo))=0
    and pg_temp.gp_count(format($q$select 1 from public.work_order_technical_base where work_order_id=%L$q$,v_wo))=0, null);
  perform pg_temp.gp_check('b_nao_emite_nem_edita_nem_conclui_nada_da_empresa_a',
    pg_temp.gp_state(format($q$select public.zt_issue_service_receipt(%L,%L,null,null)$q$,v_wo,gen_random_uuid())) in ('42501','P0002','23514')
    and pg_temp.gp_state(format($q$select public.zt_finalize_work_order_atomic(%L,'x',null,null,7,'[]'::jsonb,'[]'::jsonb)$q$,v_wo)) <> 'ok'
    and pg_temp.gp_state(format($q$select public.zt_create_work_order_from_quote(%L,null,null,null)$q$,v_q)) <> 'ok'
    and pg_temp.gp_state(format($q$select public.zt_save_quote_idempotent(%L,%L,%L,'{"status":"draft"}'::jsonb,'[]'::jsonb)$q$,'20000000-0000-0000-0000-000000000001',v_q,gen_random_uuid())) <> 'ok'
    and pg_temp.gp_state(format($q$select public.zt_client_service_history(%L,null,20)$q$,v_client)) <> 'ok', null);
  -- Escrita direta (PostgREST) na OS e no lançamento da empresa A: a política deixa 0 linhas afetadas.
  declare n1 int; n2 int; n3 int;
  begin
    update public.work_orders set assigned_to='10000000-0000-0000-0000-000000000002', scheduled_date=current_date+30 where id=v_wo::uuid;
    get diagnostics n1 = row_count;
    update public.financial_entries set paid=false where work_order_id=v_wo::uuid;
    get diagnostics n2 = row_count;
    update public.clients set name='__INVADIDO__' where id=v_client::uuid;
    get diagnostics n3 = row_count;
    perform pg_temp.gp_check('b_escrita_direta_na_os_no_financeiro_e_no_cliente_de_a_nao_afeta_linhas', n1=0 and n2=0 and n3=0, row(n1,n2,n3)::text);
  end;
end $$;
reset role;
do $$
declare w record;
begin
  select status::text st,assigned_to,scheduled_date,approved_total,approved_discount into w from public.work_orders where id=pg_temp.gp_get('wo')::uuid;
  perform pg_temp.gp_check('b_nada_mudou_na_os_de_a_depois_dos_ataques',
    w.st='done' and w.assigned_to='10000000-0000-0000-0000-000000000003' and w.scheduled_date=current_date+3
    and (select name from public.clients where id=pg_temp.gp_get('client')::uuid)='__GP_CLIENTE__', row(w.st,w.assigned_to,w.scheduled_date)::text);
  -- Snapshot comercial: o total aprovado da OS é o do orçamento já editado (700 - 20), não o primeiro valor (700 - 10).
  perform pg_temp.gp_check('os_guarda_o_snapshot_comercial_do_orcamento_editado',
    w.approved_total=680 and w.approved_discount=20, row(w.approved_total,w.approved_discount)::text);
end $$;

do $$
declare v_failures text;
begin
  select string_agg(name||' => '||coalesce(detail,''),' ; ' order by name) into v_failures from gp_results where not ok;
  if v_failures is not null then raise exception 'FIRST_CUSTOMERS_GOLDEN_PATH_FAILED: %', v_failures; end if;
  if (select count(*) from gp_results) <> 32 then
    raise exception 'FIRST_CUSTOMERS_GOLDEN_PATH_COUNT: esperado 32 checks, houve %', (select count(*) from gp_results);
  end if;
end $$;

select 'FIRST_CUSTOMERS_GOLDEN_PATH' as test, count(*) as checks, bool_and(ok) as all_ok from gp_results;

rollback;
