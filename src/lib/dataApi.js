import { supabase, mensagemErro } from './supabase';
import { ensureRequestId, idempotentWrite } from './reliability';

const n = (v) => Number(v || 0);
const qStatusToDb = { rascunho:'draft', enviado:'sent', aprovado:'approved', recusado:'declined', vencido:'expired' };
const qStatusFromDb = { draft:'rascunho', sent:'enviado', approved:'aprovado', declined:'recusado', expired:'vencido' };
const woStatusToDb = { aguardando:'unscheduled', agendada:'scheduled', andamento:'in_progress', concluida:'done', cancelada:'canceled' };
const woStatusFromDb = { unscheduled:'aguardando', scheduled:'agendada', in_progress:'andamento', done:'concluida', canceled:'cancelada' };
const itemKindToDb = { servico:'service', produto:'product', livre:'free' };
const itemKindFromDb = { service:'servico', product:'produto', free:'livre' };
const check = (r) => { if (r?.error) throw r.error; return r?.data; };

export const fromClient = (x) => ({ id:x.id, empresaId:x.company_id, tipo:x.person_type, nome:x.name, fantasia:x.trade_name||'', documento:x.tax_id||'', responsavel:x.contact_name||'', telefone:x.phone||'', whatsapp:x.whatsapp||'', endereco:x.address||'', obs:x.notes||'' });
export const toClient = (x, companyId) => ({ company_id:companyId, person_type:x.tipo||'PF', name:x.nome?.trim(), trade_name:x.fantasia||null, tax_id:x.documento||null, contact_name:x.responsavel||null, phone:x.telefone||null, whatsapp:x.whatsapp||null, address:x.endereco||null, notes:x.obs||null });
export const fromService = (x) => ({ id:x.id, empresaId:x.company_id, nome:x.name, categoria:x.category||'', descricao:x.description||'', unidade:x.unit, preco:n(x.price), custo:n(x.cost), ativo:x.active, garantiaDias:x.warranty_days||0, retornoDias:x.followup_days||0 });
const toService = (x, companyId) => ({ company_id:companyId, name:x.nome?.trim(), category:x.categoria||null, description:x.descricao||null, unit:x.unidade||'unidade', price:n(x.preco), cost:n(x.custo), active:x.ativo!==false, warranty_days:Number(x.garantiaDias||0), followup_days:Number(x.retornoDias||0) });
export const fromProduct = (x) => ({ id:x.id, empresaId:x.company_id, nome:x.name, marca:x.brand||'', modelo:x.model||'', descricao:x.description||'', unidade:x.unit, custo:n(x.cost), preco:n(x.price), garantiaMeses:x.warranty_months||0, ativo:x.active, fornecedor:'' });
const toProduct = (x, companyId) => ({ company_id:companyId, name:x.nome?.trim(), brand:x.marca||null, model:x.modelo||null, description:x.descricao||null, unit:x.unidade||'unidade', cost:n(x.custo), price:n(x.preco), warranty_months:Number(x.garantiaMeses||0), active:x.ativo!==false });

const fromItem = (x) => ({ id:x.id, tipo:itemKindFromDb[x.kind]||'livre', catalogoId:x.service_id||x.product_id||null, nome:x.name, unidade:x.unit||'unidade', qtd:n(x.quantity)||1, preco:n(x.unit_price), custo:n(x.unit_cost), obs:x.notes||'', aguardandoValor:Boolean(x.price_pending) });
const toItem = (x, companyId, parentKey, parentId, pos=0, workOrder=false) => ({
  [parentKey]:parentId, company_id:companyId, kind:itemKindToDb[x.tipo]||'free', service_id:x.tipo==='servico'?x.catalogoId||null:null, product_id:x.tipo==='produto'?x.catalogoId||null:null,
  name:x.nome||'Item', unit:x.unidade||'unidade', quantity:n(x.qtd)||1, unit_price:n(x.preco), unit_cost:n(x.custo), notes:x.obs||null,
  ...(workOrder?{is_extra:Boolean(x.adicional||x.isExtra),price_pending:Boolean(x.aguardandoValor)}:{position:pos}),
});

const fromQuote = (x) => ({ id:x.id, requestId:x.client_request_id||null, empresaId:x.company_id, numero:x.number, clienteId:x.client_id, status:qStatusFromDb[x.status]||'rascunho', data:x.issue_date, validade:x.valid_until||'', desconto:n(x.discount), acrescimo:n(x.surcharge), condicao:x.payment_terms||'', obs:x.notes||'', local:x.address||'', localServico:x.service_place||'', itens:(x.quote_items||[]).sort((a,b)=>(a.position||0)-(b.position||0)).map(fromItem), osId:null });
const quoteRow = (x, companyId, userId, number) => ({ company_id:companyId, number, client_id:x.clienteId, status:qStatusToDb[x.status]||'draft', issue_date:x.data||new Date().toISOString().slice(0,10), valid_until:x.validade||null, discount:n(x.desconto), surcharge:n(x.acrescimo), payment_terms:x.condicao||null, notes:x.obs||null, address:x.local||null, service_place:x.localServico||null, created_by:userId||null });
const fromWorkOrder = (x) => ({ id:x.id, requestId:x.client_request_id||null, empresaId:x.company_id, numero:x.number, clienteId:x.client_id, orcamentoId:x.quote_id, responsavelId:x.assigned_to, status:woStatusFromDb[x.status]||'aguardando', data:x.scheduled_date||'', hora:(x.scheduled_time||'').slice(0,5), local:x.address||'', localServico:x.service_place||'', descricaoLivre:x.request||'', obs:x.pre_notes||'', pendencia:x.pending_note||'', valorAdicional:n(x.extra_cost), emGarantia:Boolean(x.is_warranty_visit), garantiaId:x.warranty_id, osOrigemId:x.origin_wo_id, relatoProblema:x.problem_report||'', cobrancaId:x.billing_entry_id, itens:(x.work_order_items||[]).map(fromItem), checklist:[], historico:[], fotos:[], adicionais:[], custosExtras:0, relato:'' });
const woRow = (x, companyId, userId, number) => ({ company_id:companyId, number, client_id:x.clienteId, quote_id:x.orcamentoId||null, assigned_to:x.responsavelId||userId||null, status:woStatusToDb[x.status]||'unscheduled', scheduled_date:x.data||null, scheduled_time:x.hora||null, address:x.local||null, service_place:x.localServico||null, request:x.descricaoLivre||x.solicitacao||null, pre_notes:x.obs||null, pending_note:x.pendencia||null, extra_cost:n(x.valorAdicional||x.custosExtras), needs_return:Boolean(x.precisaRetorno), warranty_id:x.garantiaId||null, origin_wo_id:x.osOrigemId||null, is_warranty_visit:Boolean(x.emGarantia), problem_report:x.relatoProblema||null, created_by:userId||null });
const fromFinancial = (x) => ({ id:x.id, empresaId:x.company_id, tipo:x.kind==='income'?'receita':'despesa', descricao:x.description, valor:n(x.amount), vencimento:x.due_date, pago:x.paid, pagoEm:x.paid_at, forma:x.payment_method||null, categoria:x.category||'', clienteId:x.client_id, origemTipo:x.work_order_id?'os':x.purchase_id?'compra':null, origemId:x.work_order_id||x.purchase_id||null });
const fromWarranty = (x) => ({ id:x.id, empresaId:x.company_id, clienteId:x.client_id, osId:x.work_order_id, tipo:x.kind==='service'?'servico':'produto', servicoId:x.service_id, produtoId:x.product_id, descricao:x.description, local:x.service_place||'', inicio:x.starts_on, ate:x.ends_on, serie:x.serial_number||'' });
const fromPurchase = (x) => ({ id:x.id, requestId:x.client_request_id||null, empresaId:x.company_id, numero:x.number, fornecedor:x.supplier_name, data:x.purchase_date, forma:x.payment_method||'', vencimento:x.due_date||'', obs:x.notes||'', lancamentoId:x.entry_id, itens:(x.purchase_items||[]).map(i=>({id:i.id,catalogoId:i.product_id,nome:i.name,qtd:n(i.quantity),custo:n(i.unit_cost)})) });

export async function carregarDadosEmpresa(companyId) {
  const reqs = await Promise.all([
    supabase.from('clients').select('*').eq('company_id',companyId).order('created_at',{ascending:false}),
    supabase.from('services').select('*').eq('company_id',companyId).order('created_at',{ascending:false}),
    supabase.from('products').select('*').eq('company_id',companyId).order('created_at',{ascending:false}),
    supabase.from('quotes').select('*, quote_items(*)').eq('company_id',companyId).order('created_at',{ascending:false}),
    supabase.from('work_orders').select('*, work_order_items(*)').eq('company_id',companyId).order('created_at',{ascending:false}),
    supabase.from('financial_entries').select('*').eq('company_id',companyId).order('created_at',{ascending:false}),
    supabase.from('purchases').select('*, purchase_items(*)').eq('company_id',companyId).order('created_at',{ascending:false}),
    supabase.from('warranties').select('*').eq('company_id',companyId).order('created_at',{ascending:false}),
  ]);
  const firstError=reqs.find(r=>r.error)?.error; if(firstError) throw firstError;
  const ordens=reqs[4].data.map(fromWorkOrder);
  const orcamentos=reqs[3].data.map(fromQuote).map(q=>({...q,osId:ordens.find(o=>o.orcamentoId===q.id)?.id||null}));
  return { clientes:reqs[0].data.map(fromClient), servicos:reqs[1].data.map(fromService), produtos:reqs[2].data.map(fromProduct), orcamentos, ordens, lancamentos:reqs[5].data.map(fromFinancial), compras:reqs[6].data.map(fromPurchase), garantias:reqs[7].data.map(fromWarranty) };
}

async function upsertOne(table,row,id){ const payload=id?{...row,id}:row; const r=await supabase.from(table).upsert(payload).select().single(); return check(r); }
export async function salvarClienteDB(x, companyId){ return fromClient(await upsertOne('clients',toClient(x,companyId),x.id)); }
export async function salvarServicoDB(x, companyId){ return fromService(await upsertOne('services',toService(x,companyId),x.id)); }
export async function salvarProdutoDB(x, companyId){ return fromProduct(await upsertOne('products',toProduct(x,companyId),x.id)); }

export async function salvarOrcamentoDB(x, companyId, userId){
  const row=quoteRow(x,companyId,userId,x.numero||null);
  const items=(x.itens||[]).map((i,idx)=>toItem(i,companyId,'quote_id',null,idx,false));
  const req=ensureRequestId(x);
  const response=await idempotentWrite(()=>supabase.rpc('zt_save_quote_idempotent',{p_company:companyId,p_quote:x.id||null,p_request:req,p_row:row,p_items:items}));
  const id=check(response);
  const full=check(await supabase.from('quotes').select('*, quote_items(*)').eq('id',id).single());
  return fromQuote(full);
}

export async function salvarOSDB(x, companyId, userId){
  const row=woRow(x,companyId,userId,x.numero||null);
  const items=(x.itens||[]).map(i=>toItem(i,companyId,'work_order_id',null,0,true));
  const req=ensureRequestId(x);
  const response=await idempotentWrite(()=>supabase.rpc('zt_save_work_order_idempotent',{p_company:companyId,p_wo:x.id||null,p_request:req,p_row:row,p_items:items}));
  const id=check(response);
  const full=check(await supabase.from('work_orders').select('*, work_order_items(*)').eq('id',id).single());
  return fromWorkOrder(full);
}

export async function atualizarOSDB(id, patch){ const r=await supabase.from('work_orders').update(patch).eq('id',id).select('*, work_order_items(*)').single(); return fromWorkOrder(check(r)); }
export async function finalizarOSDB(id, extras={}){ const r=await supabase.rpc('zt_complete_work_order',{p_wo:id,p_report:extras.relato||extras.relatorio||null,p_pending:extras.pendencia||null,p_extra_cost:n(extras.valorAdicional||extras.custosExtras),p_due_days:7}); check(r); return true; }
export async function atualizarStatusOrcamentoDB(id,status){ const r=await supabase.from('quotes').update({status:qStatusToDb[status]||'draft'}).eq('id',id).select('*, quote_items(*)').single(); return fromQuote(check(r)); }
export async function salvarLancamentoDB(x,companyId){
  const row={company_id:companyId,kind:x.tipo==='receita'?'income':'expense',description:x.descricao?.trim(),amount:n(x.valor),due_date:x.vencimento||new Date().toISOString().slice(0,10),paid:Boolean(x.pago),paid_at:x.pago?(x.pagoEm||new Date().toISOString().slice(0,10)):null,payment_method:x.pago?(x.forma||null):null,category:x.categoria||null,client_id:x.tipo==='receita'?(x.clienteId||null):null};
  const r=x.id?await supabase.from('financial_entries').update(row).eq('id',x.id).select().single():await supabase.from('financial_entries').insert(row).select().single();
  return fromFinancial(check(r));
}
export async function baixarLancamentoDB(x, forma){ const r=await supabase.from('financial_entries').update({paid:!x.pago,paid_at:x.pago?null:new Date().toISOString().slice(0,10),payment_method:x.pago?null:forma}).eq('id',x.id).select().single(); return fromFinancial(check(r)); }
export async function recarregarSeguro(companyId){ try{return {data:await carregarDadosEmpresa(companyId),error:null};}catch(e){return {data:null,error:mensagemErro(e)};} }
