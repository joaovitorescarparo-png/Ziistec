import { supabase } from './supabase';
import { salvarCompraDB } from './dataApiExtras';

const n = (v) => Number(v || 0);
const missingCodes = new Set(['PGRST204','PGRST205','42P01','42703']);

export function comprasV2AindaNaoMigradas(error) {
  const code = String(error?.code || '');
  const msg = String(error?.message || '');
  return missingCodes.has(code)
    || (/(stock_qty|track_stock|purchases\.updated_at|updated_at.*purchases|inventory_movements)/i.test(msg)
      && /(schema cache|does not exist|not find|could not find|column|relation|não existe|não foi encontr)/i.test(msg));
}

const check = (r) => { if (r?.error) throw r.error; return r?.data || []; };

const mapProduct = (x) => ({
  id:x.id,
  nome:x.name,
  marca:x.brand || '',
  modelo:x.model || '',
  unidade:x.unit || 'unidade',
  custo:n(x.cost),
  estoque:n(x.stock_qty),
  controlaEstoque:Boolean(x.track_stock),
  ativo:x.active !== false,
});

const mapPurchase = (x, paidByEntry) => ({
  id:x.id,
  requestId:x.client_request_id || null,
  numero:x.number,
  fornecedor:x.supplier_name || 'Fornecedor',
  data:x.purchase_date,
  forma:x.payment_method || '',
  vencimento:x.due_date || '',
  obs:x.notes || '',
  lancamentoId:x.entry_id || null,
  atualizadoEm:x.updated_at || x.created_at,
  pago:Boolean(paidByEntry.get(x.entry_id)),
  itens:(x.purchase_items || []).map(i => ({
    id:i.id,
    produtoId:i.product_id || null,
    nome:i.name || 'Item',
    qtd:n(i.quantity),
    custo:n(i.unit_cost),
  })),
});

export async function verificarComprasV2DisponiveisDB(companyId) {
  try {
    const [products, purchases] = await Promise.all([
      supabase.from('products').select('id,stock_qty,track_stock').eq('company_id',companyId).limit(1),
      supabase.from('purchases').select('id,updated_at').eq('company_id',companyId).limit(1),
    ]);
    const error = products.error || purchases.error;
    if (error) throw error;
    return { disponivel:true, motivo:null };
  } catch (error) {
    if (comprasV2AindaNaoMigradas(error)) return { disponivel:false, motivo:'migration_pending' };
    throw error;
  }
}

export async function carregarComprasV2DB(companyId) {
  const [productsRes, purchasesRes, entriesRes] = await Promise.all([
    supabase
      .from('products')
      .select('id,name,brand,model,unit,cost,active,stock_qty,track_stock')
      .eq('company_id',companyId)
      .order('name',{ascending:true}),
    supabase
      .from('purchases')
      .select('id,company_id,number,supplier_name,purchase_date,payment_method,due_date,notes,entry_id,created_at,updated_at,client_request_id,purchase_items(id,product_id,name,quantity,unit_cost)')
      .eq('company_id',companyId)
      .order('purchase_date',{ascending:false})
      .order('created_at',{ascending:false}),
    supabase
      .from('financial_entries')
      .select('id,paid')
      .eq('company_id',companyId)
      .eq('kind','expense'),
  ]);

  const products = check(productsRes).map(mapProduct);
  const paidByEntry = new Map(check(entriesRes).map(x => [x.id, Boolean(x.paid)]));
  const purchases = check(purchasesRes).map(x => mapPurchase(x, paidByEntry));
  return { produtos:products, compras:purchases };
}

export async function salvarCompraV2DB(compra, companyId, userId) {
  const itens = (compra.itens || []).map((item) => ({
    id:item.id || null,
    catalogoId:item.produtoId || null,
    nome:item.nome?.trim() || 'Item',
    qtd:n(item.qtd),
    custo:n(item.custo),
  }));

  return salvarCompraDB({
    id:compra.id || null,
    requestId:compra.requestId || null,
    fornecedor:compra.fornecedor?.trim(),
    data:compra.data,
    forma:compra.forma || '',
    vencimento:compra.vencimento || '',
    obs:compra.obs || '',
    jaPago:Boolean(compra.pago),
    itens,
  }, companyId, userId);
}
