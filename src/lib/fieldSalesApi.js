import { supabase } from './supabase';

const check = (r) => { if (r?.error) throw r.error; return r?.data; };
const n = (v) => Number(v || 0);

export const FIELD_SALE_PAYMENT_LABELS = {
  pix:'Pix', cash:'Dinheiro', card:'Cartão', transfer:'Transferência', other:'Outro',
};
export const labelFormaRecebimento = (value) => FIELD_SALE_PAYMENT_LABELS[String(value || '').toLowerCase()] || value || '—';

export async function venderProdutoDiretoDB({
  companyId,
  productId,
  quantity = 1,
  paymentMethod = 'pix',
  notes = '',
  requestId = null,
  clientId = null,
  servicePlace = null,
}) {
  const req = requestId || crypto.randomUUID();
  const id = check(await supabase.rpc('zt_sell_product_direct', {
    p_company: companyId,
    p_product: productId,
    p_quantity: Number(quantity || 0),
    p_payment_method: paymentMethod,
    p_notes: notes || null,
    p_request: req,
    p_client: clientId || null,
    p_service_place: servicePlace || null,
  }));
  return { id, requestId:req };
}

export async function venderProdutoNaOSCampoDB({ workOrderId, productId, quantity=1, notes='', requestId=null }) {
  const req = requestId || crypto.randomUUID();
  const itemId = check(await supabase.rpc('zt_sell_product_on_work_order', {
    p_wo:workOrderId,
    p_product:productId,
    p_quantity:Number(quantity || 0),
    p_notes:notes || null,
    p_request:req,
  }));
  return { itemId, requestId:req };
}

export async function carregarContextosVendaCampoDB(companyId) {
  const rows = check(await supabase.rpc('zt_field_sale_client_contexts', { p_company:companyId }));
  return (rows || []).map((x) => ({
    clientId:x.client_id,
    cliente:x.client_name || 'Cliente',
    workOrderId:x.work_order_id,
    osNumero:x.work_order_number || '',
    local:x.service_place || '',
  }));
}

export async function carregarConfiguracaoVendaCampoDB(companyId) {
  const row = check(await supabase.from('companies')
    .select('id,pix_key,pix_receiver_name,pix_receiver_city,field_sales_allow_pix,field_sales_allow_cash,field_sales_allow_card,field_sales_allow_transfer,field_sales_allow_other')
    .eq('id',companyId).single());
  return {
    pixKey:row?.pix_key || '',
    pixReceiverName:row?.pix_receiver_name || '',
    pixReceiverCity:row?.pix_receiver_city || '',
    allowPix:row?.field_sales_allow_pix !== false,
    allowCash:row?.field_sales_allow_cash !== false,
    allowCard:row?.field_sales_allow_card !== false,
    allowTransfer:Boolean(row?.field_sales_allow_transfer),
    allowOther:Boolean(row?.field_sales_allow_other),
  };
}

export async function salvarConfiguracaoVendaCampoDB(companyId, x) {
  const row = check(await supabase.from('companies').update({
    pix_key:String(x.pixKey || '').trim().slice(0,140) || null,
    pix_receiver_name:String(x.pixReceiverName || '').trim().slice(0,25) || null,
    pix_receiver_city:String(x.pixReceiverCity || '').trim().slice(0,15) || null,
    field_sales_allow_pix:Boolean(x.allowPix),
    field_sales_allow_cash:Boolean(x.allowCash),
    field_sales_allow_card:Boolean(x.allowCard),
    field_sales_allow_transfer:Boolean(x.allowTransfer),
    field_sales_allow_other:Boolean(x.allowOther),
  }).eq('id',companyId)
    .select('id,pix_key,pix_receiver_name,pix_receiver_city,field_sales_allow_pix,field_sales_allow_cash,field_sales_allow_card,field_sales_allow_transfer,field_sales_allow_other')
    .single());
  return {
    pixKey:row.pix_key || '',
    pixReceiverName:row.pix_receiver_name || '',
    pixReceiverCity:row.pix_receiver_city || '',
    allowPix:row.field_sales_allow_pix !== false,
    allowCash:row.field_sales_allow_cash !== false,
    allowCard:row.field_sales_allow_card !== false,
    allowTransfer:Boolean(row.field_sales_allow_transfer),
    allowOther:Boolean(row.field_sales_allow_other),
  };
}

export async function carregarVendasCampoDB(companyId) {
  const rows = check(await supabase.from('field_sales')
    .select('id,company_id,sold_by,product_id,quantity,unit_price,total,payment_method,notes,client_id,service_place,origin,work_order_id,work_order_item_id,financial_entry_id,created_at,products(name,brand,model),clients(name,trade_name)')
    .eq('company_id',companyId).order('created_at',{ascending:false}).limit(150));

  const sellerIds = [...new Set((rows || []).map((x) => x.sold_by).filter(Boolean))];
  const workOrderIds = [...new Set((rows || []).map((x) => x.work_order_id).filter(Boolean))];
  const [profilesResult, workOrdersResult] = await Promise.all([
    sellerIds.length ? supabase.from('profiles').select('id,full_name,email').in('id',sellerIds) : Promise.resolve({ data:[], error:null }),
    workOrderIds.length ? supabase.from('work_orders').select('id,number,billing_entry_id').in('id',workOrderIds) : Promise.resolve({ data:[], error:null }),
  ]);
  if (profilesResult.error) throw profilesResult.error;
  if (workOrdersResult.error) throw workOrdersResult.error;
  const profiles = profilesResult.data || [];
  const workOrders = workOrdersResult.data || [];
  const profileById = Object.fromEntries(profiles.map((p) => [p.id,p]));
  const workOrderById = Object.fromEntries(workOrders.map((w) => [w.id,w]));

  const financialIds = [...new Set([
    ...(rows || []).map((x) => x.financial_entry_id),
    ...workOrders.map((x) => x.billing_entry_id),
  ].filter(Boolean))];
  let financial = [];
  if (financialIds.length) {
    const r = await supabase.from('financial_entries').select('id,paid,paid_at,payment_method,deleted_at').in('id',financialIds);
    if (r.error) throw r.error;
    financial = r.data || [];
  }
  const financialById = Object.fromEntries(financial.map((f) => [f.id,f]));

  return (rows || []).map((x) => {
    const os = x.work_order_id ? workOrderById[x.work_order_id] : null;
    const entryId = x.origin === 'work_order' ? os?.billing_entry_id : x.financial_entry_id;
    const entry = entryId ? financialById[entryId] : null;
    const recebido = x.origin === 'quick' ? Boolean(entry?.paid ?? true) : Boolean(entry?.paid);
    const statusRecebimento = x.origin === 'quick'
      ? (recebido ? 'Recebido' : 'A receber')
      : !os?.billing_entry_id ? 'A faturar pela OS' : recebido ? 'Recebido' : 'A receber';
    const statusFinanceiro = x.origin === 'quick'
      ? (entry ? 'Lançado no financeiro' : 'Lançamento não encontrado')
      : !os?.billing_entry_id ? 'Aguardando cobrança da OS' : 'Cobrança da OS lançada';
    return {
      id:x.id,
      soldBy:x.sold_by,
      productId:x.product_id,
      produto:x.products?.name || 'Produto',
      marca:x.products?.brand || '',
      modelo:x.products?.model || '',
      quantidade:n(x.quantity),
      preco:n(x.unit_price),
      total:n(x.total),
      pagamento:x.payment_method || entry?.payment_method || '',
      pagamentoLabel:labelFormaRecebimento(x.payment_method || entry?.payment_method),
      obs:x.notes || '',
      clienteId:x.client_id || null,
      cliente:x.clients?.trade_name || x.clients?.name || '',
      local:x.service_place || '',
      tecnico:profileById[x.sold_by]?.full_name || profileById[x.sold_by]?.email || 'Técnico',
      criadoEm:x.created_at,
      origem:x.origin || 'quick',
      origemLabel:x.origin === 'work_order' ? 'Venda em OS' : 'Venda rápida',
      workOrderId:x.work_order_id || null,
      osNumero:os?.number || '',
      financialEntryId:entryId || null,
      statusRecebimento,
      statusFinanceiro,
      recebido,
    };
  });
}

export async function carregarClientesHistoricoDB(companyId) {
  const rows = check(await supabase.from('clients').select('id,name,trade_name,address,person_type').eq('company_id',companyId).is('deleted_at',null).order('name'));
  return rows || [];
}

export async function carregarHistoricoClienteDB(companyId, clientId) {
  const [os,sales,warranties] = await Promise.all([
    supabase.from('work_orders').select('id,number,status,request,service_place,address,scheduled_date,completed_at,created_at').eq('company_id',companyId).eq('client_id',clientId).is('deleted_at',null).order('created_at',{ascending:false}),
    supabase.from('field_sales').select('id,sold_by,quantity,total,payment_method,service_place,origin,work_order_id,created_at,products(name)').eq('company_id',companyId).eq('client_id',clientId).order('created_at',{ascending:false}),
    supabase.from('warranties').select('id,kind,description,service_place,starts_on,ends_on,created_at').eq('company_id',companyId).eq('client_id',clientId).is('deleted_at',null).order('created_at',{ascending:false}),
  ]);
  const err = [os,sales,warranties].find((x) => x.error)?.error;
  if (err) throw err;

  const sellerIds = [...new Set((sales.data || []).map((x) => x.sold_by).filter(Boolean))];
  const osIds = [...new Set((sales.data || []).map((x) => x.work_order_id).filter(Boolean))];
  const [profilesResult, linkedOsResult] = await Promise.all([
    sellerIds.length ? supabase.from('profiles').select('id,full_name,email').in('id',sellerIds) : Promise.resolve({ data:[], error:null }),
    osIds.length ? supabase.from('work_orders').select('id,number').in('id',osIds) : Promise.resolve({ data:[], error:null }),
  ]);
  if (profilesResult.error) throw profilesResult.error;
  if (linkedOsResult.error) throw linkedOsResult.error;
  const profileById = Object.fromEntries((profilesResult.data || []).map((p) => [p.id,p]));
  const osById = Object.fromEntries((linkedOsResult.data || []).map((w) => [w.id,w]));

  return [
    ...(os.data || []).map((x) => ({
      id:`os:${x.id}`,tipo:'OS',titulo:`OS #${x.number}`,descricao:x.request || 'Atendimento técnico',
      local:x.service_place || x.address || '',data:x.completed_at || x.created_at,status:x.status,
    })),
    ...(sales.data || []).map((x) => {
      const tech = profileById[x.sold_by]?.full_name || profileById[x.sold_by]?.email || 'Técnico';
      const osNumber = x.work_order_id ? osById[x.work_order_id]?.number : '';
      return {
        id:`sale:${x.id}`,tipo:'Venda',titulo:x.products?.name || 'Venda em campo',
        descricao:`${n(x.quantity)} un · ${n(x.total).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})} · ${x.origin === 'work_order' ? `OS #${osNumber || '—'}` : labelFormaRecebimento(x.payment_method)} · Técnico: ${tech}`,
        local:x.service_place || '',data:x.created_at,
      };
    }),
    ...(warranties.data || []).map((x) => ({
      id:`war:${x.id}`,tipo:'Garantia',titulo:x.description || 'Garantia',
      descricao:`${x.starts_on || ''}${x.ends_on ? ` até ${x.ends_on}` : ''}`,local:x.service_place || '',data:x.created_at,
    })),
  ].sort((a,b) => new Date(b.data || 0) - new Date(a.data || 0));
}
