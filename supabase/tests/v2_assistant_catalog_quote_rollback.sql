-- ZiisTec Assistant (0094) — orçamento com itens resolvidos no catálogo do tenant, perguntas em
-- ambiguidade, prévia sem escrita, confirmação única e revisão que invalida a confirmação antiga.
-- Destino: SOMENTE CI descartável ou staging/homologação. Tudo termina em ROLLBACK.

begin;

create temp table zt_cq (
  owner_a uuid, tech_a uuid, owner_b uuid, external_user uuid,
  company_a uuid, company_b uuid,
  mauro_silva uuid, mauro_souza uuid, ana uuid, client_b uuid,
  cam_intelbras uuid, cam_dome uuid, cam_old uuid, fonte uuid, prod_b uuid,
  svc_install uuid, svc_maint uuid,
  p1 jsonb, p2 jsonb, req1 uuid, req2 uuid
) on commit drop;
create temp table zt_cq_results (name text primary key, ok boolean not null, detail text) on commit drop;
grant select, insert, update on zt_cq, zt_cq_results to authenticated, anon;

create function pg_temp.record_result(p_name text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into zt_cq_results(name,ok,detail) values(p_name,coalesce(p_ok,false),left(p_detail,500));
$$;

create function pg_temp.quotes_of(p_company uuid) returns integer language sql as $$
  select count(*)::integer from public.quotes where company_id=p_company;
$$;

with candidates as (
  select u.id, row_number() over (order by u.id) as rn
  from auth.users u left join public.profiles p on p.id=u.id
  where not coalesce(p.is_platform_admin,false)
)
insert into zt_cq(owner_a,tech_a,owner_b,external_user,company_a,company_b,mauro_silva,mauro_souza,ana,client_b,
  cam_intelbras,cam_dome,cam_old,fonte,prod_b,svc_install,svc_maint)
select (select id from candidates where rn=1),(select id from candidates where rn=2),
       (select id from candidates where rn=3),(select id from candidates where rn=4),
       gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),
       gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid();

do $$
begin
  if exists(select 1 from zt_cq where owner_a is null or tech_a is null or owner_b is null or external_user is null) then
    raise exception 'CATALOG_QUOTE_NEEDS_FOUR_AUTH_USERS';
  end if;
end $$;

select set_config('request.jwt.claim.sub',(select owner_a::text from zt_cq),true);
insert into public.companies(id,name,has_team)
select company_a,'__CQ_A__',true from zt_cq union all select company_b,'__CQ_B__',true from zt_cq;
insert into public.subscriptions(company_id,status,current_period_start,current_period_end)
select company_a,'trial'::public.zt_sub_status,current_date,current_date+14 from zt_cq
union all select company_b,'trial'::public.zt_sub_status,current_date,current_date+14 from zt_cq
on conflict (company_id) do update set status=excluded.status,
  current_period_start=excluded.current_period_start,current_period_end=excluded.current_period_end;
insert into public.company_members(company_id,user_id,role,status)
select company_a,owner_a,'owner'::public.zt_role,'active'::public.zt_member_status from zt_cq
union all select company_a,tech_a,'technician'::public.zt_role,'active'::public.zt_member_status from zt_cq
union all select company_b,owner_b,'owner'::public.zt_role,'active'::public.zt_member_status from zt_cq;
insert into public.clients(id,company_id,name,phone,whatsapp,address)
select mauro_silva,company_a,'Mauro Silva','1130000001','11990000001','Rua A, 1' from zt_cq
union all select mauro_souza,company_a,'Mauro Souza','1130000002',null,'Rua A, 2' from zt_cq
union all select ana,company_a,'Ana Lima','1130000003',null,'Rua A, 3' from zt_cq
union all select client_b,company_b,'Bruno Outra Empresa','1130000004',null,'Rua B, 4' from zt_cq;
insert into public.products(id,company_id,name,brand,model,unit,cost,price,active)
select cam_intelbras,company_a,'Câmera Wi-Fi Intelbras','Intelbras','IM5','unidade',120,250,true from zt_cq
union all select cam_dome,company_a,'Câmera Dome Hikvision','Hikvision','DS2','unidade',140,300,true from zt_cq
union all select cam_old,company_a,'Câmera Antiga Descontinuada',null,null,'unidade',50,99,false from zt_cq
union all select fonte,company_a,'Fonte 12V',null,null,'unidade',15,40,true from zt_cq
union all select prod_b,company_b,'Câmera Wi-Fi Intelbras',null,null,'unidade',100,200,true from zt_cq;
insert into public.services(id,company_id,name,unit,price,cost,active)
select svc_install,company_a,'Instalação de câmera','serviço',150,50,true from zt_cq
union all select svc_maint,company_a,'Manutenção preventiva','serviço',90,30,true from zt_cq;

-- ------------------------------------------------------------------ catálogo/ACL
do $$
declare v_sig text; v_proc pg_proc%rowtype;
begin
  foreach v_sig in array array['public.zt_assistant_plan_context(uuid,uuid)','public.zt_assistant_revise(uuid,uuid,text,jsonb,uuid)'] loop
    select * into strict v_proc from pg_proc where oid=to_regprocedure(v_sig);
    perform pg_temp.record_result('00_acl_'||v_proc.proname, v_proc.prosecdef
      and exists(select 1 from unnest(coalesce(v_proc.proconfig,array[]::text[])) s where s in ('search_path=','search_path=""'))
      and not has_function_privilege('anon',v_proc.oid,'EXECUTE') and has_function_privilege('authenticated',v_proc.oid,'EXECUTE'),v_sig);
  end loop;
  perform pg_temp.record_result('00_helpers_privados', not has_function_privilege('authenticated','zt_private.assistant_quote_resolve(uuid,jsonb)','EXECUTE')
    and not has_function_privilege('authenticated','zt_private.assistant_match(uuid,text,text,uuid)','EXECUTE')
    and not (select prosecdef from pg_proc where oid=to_regprocedure('zt_private.assistant_quote_resolve(uuid,jsonb)')));
end $$;

set local role authenticated;
do $$
declare t zt_cq%rowtype; r jsonb; e jsonb; n integer; d jsonb;
begin
  select * into t from zt_cq;
  n:=pg_temp.quotes_of(t.company_a);

  -- Cliente ambíguo pergunta com opções da própria empresa; nada é preparado.
  r:=public.zt_assistant_plan(t.company_a,'create_quote_draft',jsonb_build_object('client','Mauro',
    'items',jsonb_build_array(jsonb_build_object('kind','product','name','câmera intelbras','quantity',2))),gen_random_uuid());
  perform pg_temp.record_result('01_cliente_ambiguo_pergunta', r->>'question' like 'Encontrei mais de um cliente%'
    and jsonb_array_length(r->'options')=2 and r#>>'{options,0,slot}'='client' and not r ? 'previewHash'
    and r#>'{draft,items,0}'->>'name'='câmera intelbras', r::text);
  perform pg_temp.record_result('02_opcoes_sao_da_empresa', (select bool_and((o->>'ref')::uuid in (t.mauro_silva,t.mauro_souza)) from jsonb_array_elements(r->'options') o), r::text);

  -- Escolha do usuário (ref) resolve o cliente; vários produtos compatíveis viram pergunta.
  d:=jsonb_set(r->'draft','{clientRef}',to_jsonb(t.mauro_souza::text));
  d:=jsonb_set(d,'{items,0,name}','"câmeras"');
  r:=public.zt_assistant_plan(t.company_a,'create_quote_draft',d,gen_random_uuid());
  perform pg_temp.record_result('03_varios_produtos_pergunta', r->>'question' like 'Encontrei mais de uma opção para "câmeras"%'
    and jsonb_array_length(r->'options')=2 and r#>>'{options,0,slot}'='item:0' and r::text like '%R$ 250,00%' and r::text not like '%Antiga%', r::text);

  d:=jsonb_set(r->'draft','{items,0,ref}',to_jsonb(t.cam_dome::text));
  r:=public.zt_assistant_plan(t.company_a,'create_quote_draft',d,gen_random_uuid());
  perform pg_temp.record_result('04_escolha_de_produto_por_ref', r->>'confirmationRequired'='true'
    and (r#>>'{input,items,0,productId}')::uuid=t.cam_dome and (r#>>'{input,items,0,unitPrice}')::numeric=300
    and (r#>>'{input,clientId}')::uuid=t.mauro_souza, r::text);

  -- Caso de homologação: Mauro Silva, duas câmeras Intelbras e instalação, preços do catálogo.
  r:=public.zt_assistant_plan(t.company_a,'create_quote_draft',jsonb_build_object('client','mauro silva','items',jsonb_build_array(
    jsonb_build_object('kind','product','name','câmeras intelbras','quantity',2),
    jsonb_build_object('kind','service','name','instalação','quantity',1))),gen_random_uuid());
  perform pg_temp.record_result('05_produto_e_servico_do_catalogo', r->>'confirmationRequired'='true'
    and (r#>>'{input,items,0,productId}')::uuid=t.cam_intelbras and (r#>>'{input,items,0,quantity}')::numeric=2
    and (r#>>'{input,items,0,unitPrice}')::numeric=250 and r#>>'{input,items,0,origin}'='catalog'
    and (r#>>'{input,items,1,serviceId}')::uuid=t.svc_install and (r#>>'{input,items,1,unitPrice}')::numeric=150
    and (r#>>'{input,subtotal}')::numeric=650 and (r#>>'{input,total}')::numeric=650, r::text);
  perform pg_temp.record_result('06_previa_mostra_itens_totais_e_origem',
    r->'preview' @> '[{"label":"Cliente","value":"Mauro Silva"},{"label":"Item 1","value":"2 × Câmera Wi-Fi Intelbras — R$ 250,00 cada = R$ 500,00 · preço do catálogo"},{"label":"Total","value":"R$ 650,00"}]'::jsonb
    and r::text not like '%cost%', r::text);
  perform pg_temp.record_result('07_previa_sem_escrita', pg_temp.quotes_of(t.company_a)=n, n::text);
  update zt_cq set p1=r;

  -- Inexistentes e item livre sem preço perguntam; nada é inventado.
  r:=public.zt_assistant_plan(t.company_a,'create_quote_draft',jsonb_build_object('client','Ana Lima','items',jsonb_build_array(
    jsonb_build_object('kind','product','name','drone','quantity',1))),gen_random_uuid());
  perform pg_temp.record_result('08_produto_inexistente', r->>'question' like 'Não encontrei "drone" no catálogo de produtos%item livre%' and not r ? 'previewHash', r::text);
  r:=public.zt_assistant_plan(t.company_a,'create_quote_draft',jsonb_build_object('client','Ana Lima','items',jsonb_build_array(
    jsonb_build_object('kind','service','name','pintura','quantity',1))),gen_random_uuid());
  perform pg_temp.record_result('09_servico_inexistente', r->>'question' like 'Não encontrei "pintura" no catálogo de serviços%', r::text);
  r:=public.zt_assistant_plan(t.company_a,'create_quote_draft',jsonb_build_object('client','Ana Lima','items',jsonb_build_array(
    jsonb_build_object('kind','free','name','Visita técnica','quantity',1))),gen_random_uuid());
  perform pg_temp.record_result('10_item_livre_exige_preco', r->>'question' like 'Qual é o preço de "Visita técnica"%', r::text);
  r:=public.zt_assistant_plan(t.company_a,'create_quote_draft',jsonb_build_object('client','Pedro Inexistente','items',jsonb_build_array(
    jsonb_build_object('kind','product','name','fonte','quantity',1))),gen_random_uuid());
  perform pg_temp.record_result('11_cliente_inexistente', r->>'question' like 'Não encontrei o cliente "Pedro Inexistente"%', r::text);

  -- Override só quando informado; aparece a origem na prévia.
  r:=public.zt_assistant_plan(t.company_a,'create_quote_draft',jsonb_build_object('client','Ana Lima','items',jsonb_build_array(
    jsonb_build_object('kind','product','name','fonte 12v','quantity',3,'unitPrice',35))),gen_random_uuid());
  perform pg_temp.record_result('12_override_explicito', r->>'confirmationRequired'='true' and r#>>'{input,items,0,origin}'='informed'
    and (r#>>'{input,items,0,unitPrice}')::numeric=35 and r::text like '%preço informado (catálogo: R$ 40,00)%', r::text);

  -- Referências arbitrárias (outra empresa ou inventadas) não resolvem nada.
  r:=public.zt_assistant_plan(t.company_a,'create_quote_draft',jsonb_build_object('client','Ana Lima','items',jsonb_build_array(
    jsonb_build_object('kind','product','name','câmera','quantity',1,'ref',t.prod_b::text))),gen_random_uuid());
  perform pg_temp.record_result('13_ref_de_outra_empresa_nao_resolve', r->>'question' like 'Não encontrei%' and not r ? 'previewHash', r::text);
  r:=public.zt_assistant_plan(t.company_a,'create_quote_draft',jsonb_build_object('client','Ana Lima','clientRef',t.client_b::text,'items',jsonb_build_array(
    jsonb_build_object('kind','product','name','fonte','quantity',1))),gen_random_uuid());
  perform pg_temp.record_result('14_cliente_de_outra_empresa_nao_resolve', r->>'question' like 'Não encontrei o cliente%', r::text);
  r:=public.zt_assistant_plan(t.company_a,'create_quote_draft',jsonb_build_object('client','Ana Lima','items',jsonb_build_array(
    jsonb_build_object('kind','product','name','fonte','quantity',1,'productId',t.fonte::text))),gen_random_uuid());
  perform pg_temp.record_result('15_campo_de_id_do_provedor_rejeitado', r->>'code'='INVALID_INPUT', r::text);

  -- Formato antigo (um item) continua aceito como item livre com preço informado.
  r:=public.zt_assistant_plan(t.company_a,'create_quote_draft',jsonb_build_object('client','Ana Lima','description','Serviço avulso','quantity',1,'unitPrice',80),gen_random_uuid());
  perform pg_temp.record_result('16_formato_antigo_vira_item_livre', r->>'confirmationRequired'='true' and r#>>'{input,items,0,kind}'='free'
    and (r#>>'{input,total}')::numeric=80, r::text);

  -- Desconto, acréscimo, observações e local entram no total e na prévia.
  r:=public.zt_assistant_plan(t.company_a,'create_quote_draft',jsonb_build_object('client','Ana Lima','discount',10,'surcharge',5.5,
    'notes','Garantia de 90 dias','servicePlace','Portaria','items',jsonb_build_array(jsonb_build_object('kind','product','name','fonte','quantity',2))),gen_random_uuid());
  perform pg_temp.record_result('17_desconto_acrescimo', (r#>>'{input,subtotal}')::numeric=80 and (r#>>'{input,total}')::numeric=75.5
    and r->'preview' @> '[{"label":"Desconto","value":"R$ 10,00"},{"label":"Observações","value":"Garantia de 90 dias"}]'::jsonb, r::text);

  -- Telefone e WhatsApp disponíveis na própria consulta de cliente.
  r:=public.zt_assistant_plan(t.company_a,'owner_find_client','{"query":"Mauro Silva"}',gen_random_uuid());
  perform pg_temp.record_result('18_telefone_e_whatsapp', r#>>'{result,items,0,phone}'='1130000001' and r#>>'{result,items,0,whatsapp}'='11990000001', r::text);
end $$;

-- Confirmação grava exatamente um orçamento, com IDs, preços e custo do catálogo.
do $$
declare t zt_cq%rowtype; r jsonb; again jsonb; v_req uuid; n integer;
begin
  select * into t from zt_cq;
  v_req:=(t.p1->>'requestId')::uuid; n:=pg_temp.quotes_of(t.company_a);
  r:=public.zt_assistant_execute(t.company_a,v_req,t.p1->>'previewHash');
  again:=public.zt_assistant_execute(t.company_a,v_req,t.p1->>'previewHash');
  perform pg_temp.record_result('19_confirmacao_grava_uma_vez', r#>>'{result,entityType}'='quote' and r=again and pg_temp.quotes_of(t.company_a)=n+1, r::text);
  perform pg_temp.record_result('20_itens_com_ids_precos_e_custos', exists(
    select 1 from public.quote_items i where i.quote_id=(r#>>'{result,id}')::uuid and i.product_id=t.cam_intelbras and i.quantity=2 and i.unit_price=250 and i.unit_cost=120)
    and exists(select 1 from public.quote_items i where i.quote_id=(r#>>'{result,id}')::uuid and i.service_id=t.svc_install and i.unit_price=150 and i.unit_cost=50)
    and (select client_id from public.quotes where id=(r#>>'{result,id}')::uuid)=t.mauro_silva, r::text);
end $$;

-- Ajuste de prévia: "troca para três" gera nova prévia e invalida a confirmação antiga.
do $$
declare t zt_cq%rowtype; p1 jsonb; ctx jsonb; p2 jsonb; old jsonb; n integer; v_req1 uuid:=gen_random_uuid(); v_req2 uuid:=gen_random_uuid();
begin
  select * into t from zt_cq;
  p1:=public.zt_assistant_plan(t.company_a,'create_quote_draft',jsonb_build_object('client','Mauro Silva','items',jsonb_build_array(
    jsonb_build_object('kind','product','name','câmera intelbras','quantity',2),jsonb_build_object('kind','service','name','instalação','quantity',1))),v_req1);
  ctx:=public.zt_assistant_plan_context(t.company_a,v_req1);
  perform pg_temp.record_result('21_contexto_sem_ids', ctx->>'action'='create_quote_draft' and ctx#>>'{input,items,0,name}'='Câmera Wi-Fi Intelbras'
    and ctx::text not like '%'||t.cam_intelbras::text||'%' and ctx::text not like '%'||t.mauro_silva::text||'%' and ctx::text not like '%Id%', ctx::text);
  p2:=public.zt_assistant_revise(t.company_a,v_req1,'create_quote_draft',jsonb_set(ctx->'input','{items,0,quantity}','3'),v_req2);
  perform pg_temp.record_result('22_revisao_nova_previa', p2->>'confirmationRequired'='true' and p2->>'previewHash'<>p1->>'previewHash'
    and (p2#>>'{input,items,0,quantity}')::numeric=3 and (p2#>>'{input,total}')::numeric=900, p2::text);
  n:=pg_temp.quotes_of(t.company_a);
  old:=public.zt_assistant_execute(t.company_a,v_req1,p1->>'previewHash');
  perform pg_temp.record_result('23_confirmacao_antiga_invalida', old->>'code'='PLAN_EXPIRED' and pg_temp.quotes_of(t.company_a)=n, old::text);
  perform pg_temp.record_result('24_revisao_de_prevenda_expirada', public.zt_assistant_revise(t.company_a,v_req1,'create_quote_draft',ctx->'input',gen_random_uuid())->>'code'='PLAN_EXPIRED');
  -- "Tira a instalação": nova revisão sobre a prévia vigente; pergunta não derruba a prévia.
  p1:=public.zt_assistant_revise(t.company_a,v_req2,'create_quote_draft',jsonb_build_object('client','Mauro Silva','items',jsonb_build_array(
    jsonb_build_object('kind','product','name','câmera','quantity',3))),gen_random_uuid());
  perform pg_temp.record_result('25_pergunta_mantem_previa_vigente', p1 ? 'question'
    and (public.zt_assistant_plan_context(t.company_a,v_req2)->>'action')='create_quote_draft', p1::text);
  p1:=public.zt_assistant_revise(t.company_a,v_req2,'create_quote_draft',jsonb_build_object('client','Mauro Silva','items',jsonb_build_array(
    jsonb_build_object('kind','product','name','Câmera Wi-Fi Intelbras','quantity',3))),v_req1);
  perform pg_temp.record_result('26_revisao_nao_reusa_request_antigo', p1->>'code' is not null and not p1 ? 'previewHash', p1::text);
  p1:=public.zt_assistant_revise(t.company_a,v_req2,'create_quote_draft',jsonb_build_object('client','Mauro Silva','items',jsonb_build_array(
    jsonb_build_object('kind','product','name','Câmera Wi-Fi Intelbras','quantity',3))),gen_random_uuid());
  old:=public.zt_assistant_execute(t.company_a,(p1->>'requestId')::uuid,p1->>'previewHash');
  perform pg_temp.record_result('27_confirma_so_a_ultima_previa', old#>>'{result,entityType}'='quote' and pg_temp.quotes_of(t.company_a)=n+1
    and (select count(*) from public.quote_items where quote_id=(old#>>'{result,id}')::uuid)=1
    and (public.zt_assistant_execute(t.company_a,v_req2,p2->>'previewHash'))->>'code'='PLAN_EXPIRED', old::text);
end $$;

-- Preço do catálogo mudou entre prévia e confirmação: nada é gravado.
do $$
declare t zt_cq%rowtype; p jsonb; r jsonb; n integer; v_req uuid:=gen_random_uuid();
begin
  select * into t from zt_cq;
  p:=public.zt_assistant_plan(t.company_a,'create_quote_draft',jsonb_build_object('client','Ana Lima','items',jsonb_build_array(
    jsonb_build_object('kind','product','name','fonte','quantity',1))),v_req);
  update zt_cq set req1=v_req, p2=p;
end $$;
reset role;
update public.products set price=45 where id=(select fonte from zt_cq);
set local role authenticated;
do $$
declare t zt_cq%rowtype; r jsonb; n integer;
begin
  select * into t from zt_cq;
  n:=pg_temp.quotes_of(t.company_a);
  r:=public.zt_assistant_execute(t.company_a,t.req1,t.p2->>'previewHash');
  perform pg_temp.record_result('28_preco_mudou_nao_grava', r ? 'error' and pg_temp.quotes_of(t.company_a)=n, r::text);
end $$;
reset role;

-- Técnico não usa orçamento nem lê contexto de prévia do proprietário.
select set_config('request.jwt.claim.sub',(select tech_a::text from zt_cq),true);
set local role authenticated;
do $$
declare t zt_cq%rowtype; r jsonb;
begin
  select * into t from zt_cq;
  r:=public.zt_assistant_plan(t.company_a,'create_quote_draft',jsonb_build_object('client','Ana Lima','items',jsonb_build_array(
    jsonb_build_object('kind','product','name','fonte','quantity',1))),gen_random_uuid());
  perform pg_temp.record_result('29_tecnico_sem_orcamento', r->>'code'='ACCESS_DENIED', r::text);
  perform pg_temp.record_result('30_tecnico_sem_contexto_alheio', public.zt_assistant_plan_context(t.company_a,t.req1)->>'code'='PLAN_EXPIRED');
end $$;
reset role;

-- Outra empresa não vê clientes nem catálogo da empresa A.
select set_config('request.jwt.claim.sub',(select owner_b::text from zt_cq),true);
set local role authenticated;
do $$
declare t zt_cq%rowtype; r jsonb;
begin
  select * into t from zt_cq;
  r:=public.zt_assistant_plan(t.company_a,'create_quote_draft',jsonb_build_object('client','Mauro Silva','items',jsonb_build_array(
    jsonb_build_object('kind','product','name','fonte','quantity',1))),gen_random_uuid());
  perform pg_temp.record_result('31_cross_tenant_negado', r->>'code'='ACCESS_DENIED', r::text);
  r:=public.zt_assistant_plan(t.company_b,'create_quote_draft',jsonb_build_object('client','Mauro Silva','items',jsonb_build_array(
    jsonb_build_object('kind','product','name','fonte','quantity',1))),gen_random_uuid());
  perform pg_temp.record_result('32_cliente_de_outra_empresa_invisivel', r->>'question' like 'Não encontrei o cliente%', r::text);
end $$;
reset role;

-- Assinatura inválida bloqueia o plano.
update public.subscriptions set status='canceled' where company_id=(select company_a from zt_cq);
select set_config('request.jwt.claim.sub',(select owner_a::text from zt_cq),true);
set local role authenticated;
do $$
declare t zt_cq%rowtype; r jsonb;
begin
  select * into t from zt_cq;
  r:=public.zt_assistant_plan(t.company_a,'create_quote_draft',jsonb_build_object('client','Ana Lima','items',jsonb_build_array(
    jsonb_build_object('kind','product','name','fonte','quantity',1))),gen_random_uuid());
  perform pg_temp.record_result('33_assinatura_invalida', r->>'code'='ACCESS_DENIED', r::text);
end $$;
reset role;

do $$
declare failures text;
begin
  select string_agg(name||': '||coalesce(detail,''),E'\n' order by name) into failures from zt_cq_results where not ok;
  if failures is not null then raise exception 'ASSISTANT_0094_FAILED: %',failures; end if;
  if (select count(*) from zt_cq_results)<>36 then raise exception 'ASSISTANT_0094_INCOMPLETE: % checks',(select count(*) from zt_cq_results); end if;
end $$;
select 'ASSISTANT_0094_CATALOG_QUOTE' as test,count(*) as checks,bool_and(ok) as all_ok from zt_cq_results;
rollback;
