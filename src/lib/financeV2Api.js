import { supabase } from './supabase';

const check = (r) => { if (r?.error) throw r.error; return r?.data || []; };
const n = (v) => Number(v || 0);

function ledgerPendente(error) {
  const code = String(error?.code || '');
  const msg = String(error?.message || '');
  return code === '42P01' || code === 'PGRST205'
    || (/work_order_(item|material|private)_costs/i.test(msg)
      && /(schema cache|does not exist|not find|could not find|relation|não existe|não foi encontr)/i.test(msg));
}

async function carregarLedgerSeguro(table, select, companyId) {
  const r = await supabase.from(table).select(select).eq('company_id', companyId);
  if (!r.error) return { pronto:true, data:r.data || [] };
  if (ledgerPendente(r.error)) return { pronto:false, data:[] };
  throw r.error;
}

export async function carregarFinanceiroV2DB(companyId) {
  const [entriesRes, clientsRes, ordersRes] = await Promise.all([
    supabase
      .from('financial_entries')
      .select('id,company_id,kind,description,amount,due_date,paid,paid_at,payment_method,category,client_id,work_order_id,purchase_id,created_at')
      .eq('company_id', companyId)
      .order('due_date', { ascending:false }),
    supabase
      .from('clients')
      .select('id,name,trade_name')
      .eq('company_id', companyId)
      .order('name', { ascending:true }),
    supabase
      .from('work_orders')
      .select('id,company_id,number,client_id,status,scheduled_date,completed_at,work_order_items(id,quantity,unit_price),work_order_materials(id,quantity)')
      .eq('company_id', companyId)
      .order('created_at', { ascending:false }),
  ]);

  const entries = check(entriesRes);
  const clients = check(clientsRes);
  const orders = check(ordersRes);

  const [itemLedger, materialLedger, extraLedger] = await Promise.all([
    carregarLedgerSeguro('work_order_item_costs', 'work_order_item_id,work_order_id,unit_cost', companyId),
    carregarLedgerSeguro('work_order_material_costs', 'work_order_material_id,work_order_id,unit_cost', companyId),
    carregarLedgerSeguro('work_order_private_costs', 'work_order_id,extra_cost', companyId),
  ]);

  const custosProntos = itemLedger.pronto && materialLedger.pronto && extraLedger.pronto;
  const itemCost = new Map(itemLedger.data.map(x => [x.work_order_item_id, n(x.unit_cost)]));
  const materialCost = new Map(materialLedger.data.map(x => [x.work_order_material_id, n(x.unit_cost)]));
  const extraCost = new Map(extraLedger.data.map(x => [x.work_order_id, n(x.extra_cost)]));

  const clientes = clients.map(x => ({
    id:x.id,
    nome:x.trade_name || x.name || 'Cliente',
  }));

  const ordens = orders.map(x => {
    const vendaItens = (x.work_order_items || []).reduce((t, i) => t + n(i.quantity) * n(i.unit_price), 0);
    const custoItens = custosProntos
      ? (x.work_order_items || []).reduce((t, i) => t + n(i.quantity) * n(itemCost.get(i.id)), 0)
      : null;
    const custoMateriais = custosProntos
      ? (x.work_order_materials || []).reduce((t, i) => t + n(i.quantity) * n(materialCost.get(i.id)), 0)
      : null;
    const custoExtra = custosProntos ? n(extraCost.get(x.id)) : null;
    const custoTotal = custosProntos ? n(custoItens) + n(custoMateriais) + n(custoExtra) : null;
    return {
      id:x.id,
      numero:x.number,
      clienteId:x.client_id,
      status:x.status,
      data:x.scheduled_date || (x.completed_at ? String(x.completed_at).slice(0,10) : ''),
      concluidaEm:x.completed_at ? String(x.completed_at).slice(0,10) : '',
      vendaItens,
      custoItens,
      custoMateriais,
      custoExtra,
      custoTotal,
    };
  });

  const lancamentos = entries.map(x => ({
    id:x.id,
    tipo:x.kind === 'income' ? 'receita' : 'despesa',
    descricao:x.description || '',
    valor:n(x.amount),
    vencimento:x.due_date,
    pago:Boolean(x.paid),
    pagoEm:x.paid_at || null,
    forma:x.payment_method || null,
    categoria:x.category || '',
    clienteId:x.client_id || null,
    osId:x.work_order_id || null,
    compraId:x.purchase_id || null,
    criadoEm:x.created_at,
    origem:x.work_order_id ? 'os' : x.purchase_id ? 'compra' : 'manual',
  }));

  return { clientes, ordens, lancamentos, custosProntos };
}
