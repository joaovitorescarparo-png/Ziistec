import { supabase, mensagemErro } from './supabase';

const check = (r) => { if (r?.error) throw r.error; return r?.data; };
const n = (v) => Number(v || 0);

const V2_MISSING_CODES = new Set(['PGRST202', 'PGRST204', 'PGRST205', '42P01', '42703', '42883']);
export function recursoV2AindaNaoMigrado(error) {
  const code = String(error?.code || '');
  const msg = String(error?.message || '');
  return V2_MISSING_CODES.has(code)
    || /(inventory_movements|maintenance_contracts|zt_technician_catalog|zt_adjust_product_stock|zt_sell_product_on_work_order|stock_qty|track_stock|low_stock_threshold|sale_enabled|image_path)/i.test(msg)
      && /(schema cache|does not exist|not find|could not find|column|function|relation|não existe|não foi encontr)/i.test(msg);
}

const fromOwnerProduct = (p) => ({
  id:p.id,
  empresaId:p.company_id,
  nome:p.name,
  marca:p.brand||'',
  modelo:p.model||'',
  descricao:p.description||'',
  unidade:p.unit||'unidade',
  custo:n(p.cost),
  preco:n(p.price),
  garantiaMeses:Number(p.warranty_months||0),
  ativo:p.active!==false,
  imagemPath:p.image_path||null,
  vendaHabilitada:p.sale_enabled!==false,
  controlaEstoque:Boolean(p.track_stock),
  estoque:n(p.stock_qty),
  estoqueMinimo:n(p.low_stock_threshold),
});

export async function carregarProdutosEstoqueDB(companyId) {
  const r = await supabase
    .from('products')
    .select('id,company_id,name,brand,model,description,unit,cost,price,warranty_months,active,image_path,sale_enabled,track_stock,stock_qty,low_stock_threshold')
    .eq('company_id', companyId)
    .order('name', { ascending:true });
  return (check(r) || []).map(fromOwnerProduct);
}

export async function verificarProdutoV2DisponivelDB(companyId) {
  try {
    await carregarProdutosEstoqueDB(companyId);
    return { disponivel:true, motivo:null };
  } catch (error) {
    if (recursoV2AindaNaoMigrado(error)) return { disponivel:false, motivo:'migration_pending' };
    throw error;
  }
}

export async function carregarCatalogoTecnicoDB(companyId) {
  const data = check(await supabase.rpc('zt_technician_catalog', { p_company: companyId }));
  return (data || []).map((p) => ({
    id:p.id, nome:p.name, marca:p.brand||'', modelo:p.model||'', descricao:p.description||'', unidade:p.unit||'unidade',
    preco:n(p.price), garantiaMeses:Number(p.warranty_months||0), imagemPath:p.image_path||null,
    estoque:n(p.stock_qty), controlaEstoque:Boolean(p.track_stock),
  }));
}

export async function ajustarEstoqueDB(companyId, productId, delta, notes='') {
  return n(check(await supabase.rpc('zt_adjust_product_stock',{p_company:companyId,p_product:productId,p_delta:n(delta),p_notes:notes||null})));
}

export async function venderProdutoNaOSDB(workOrderId, productId, quantidade=1, notes='') {
  return check(await supabase.rpc('zt_sell_product_on_work_order',{
    p_wo:workOrderId,p_product:productId,p_quantity:n(quantidade),p_notes:notes||null,
  }));
}

export async function criarGarantiaManualDB(x, companyId) {
  return check(await supabase.rpc('zt_create_manual_warranty',{
    p_company:companyId,
    p_client:x.clienteId,
    p_kind:x.tipo==='produto'?'product':'service',
    p_description:x.descricao?.trim(),
    p_starts_on:x.inicio,
    p_ends_on:x.ate,
    p_service_place:x.local||null,
    p_service:x.tipo==='servico'?(x.servicoId||null):null,
    p_product:x.tipo==='produto'?(x.produtoId||null):null,
    p_serial:x.serie||null,
    p_notes:x.obs||null,
  }));
}

export const fromMaintenanceContract = (x) => ({
  id:x.id, empresaId:x.company_id, clienteId:x.client_id, nome:x.name, status:x.status,
  valor:n(x.amount), periodicidadeMeses:Number(x.interval_months||1), diaCobranca:x.billing_day||null,
  proximaVisita:x.next_service_on||'', proximaCobranca:x.next_billing_on||'', responsavelId:x.assigned_to||null,
  cobertura:x.coverage||'', obs:x.notes||'', criadoEm:x.created_at,
});

const toMaintenanceContract = (x, companyId, userId) => ({
  company_id:companyId, client_id:x.clienteId, name:x.nome?.trim(), status:x.status||'active', amount:n(x.valor),
  interval_months:Math.max(1, Number(x.periodicidadeMeses||1)), billing_day:x.diaCobranca?Number(x.diaCobranca):null,
  next_service_on:x.proximaVisita||null, next_billing_on:x.proximaCobranca||null, assigned_to:x.responsavelId||null,
  coverage:x.cobertura||null, notes:x.obs||null, created_by:userId||null, updated_at:new Date().toISOString(),
});

export async function carregarContratosDB(companyId) {
  const data = check(await supabase.from('maintenance_contracts').select('*').eq('company_id',companyId).order('created_at',{ascending:false}));
  return (data || []).map(fromMaintenanceContract);
}

export async function salvarContratoDB(x, companyId, userId) {
  const row = toMaintenanceContract(x, companyId, userId);
  const payload = x.id ? { ...row, id:x.id } : row;
  const data = check(await supabase.from('maintenance_contracts').upsert(payload).select().single());
  return fromMaintenanceContract(data);
}

export async function excluirContratoDB(id) {
  const r = await supabase.from('maintenance_contracts').delete().eq('id',id);
  check(r); return true;
}

export async function gerarCicloContratoDB(contractId, cycleDate, { serviceOn=null, dueOn=null }={}) {
  return check(await supabase.rpc('zt_generate_maintenance_contract_cycle',{
    p_contract:contractId,p_cycle:cycleDate,p_service_on:serviceOn,p_due_on:dueOn,
  }));
}

export async function carregarMovimentosEstoqueDB(companyId, productId=null) {
  let q = supabase.from('inventory_movements').select('*').eq('company_id',companyId).order('created_at',{ascending:false});
  if (productId) q = q.eq('product_id',productId);
  const data = check(await q);
  return (data || []).map((x)=>({ id:x.id,empresaId:x.company_id,produtoId:x.product_id,tipo:x.kind,quantidade:n(x.quantity_delta),custoUnitario:x.unit_cost==null?null:n(x.unit_cost),osId:x.work_order_id||null,compraId:x.purchase_id||null,obs:x.notes||'',criadoEm:x.created_at }));
}

export async function v2Seguro(fn) {
  try { return { data:await fn(), error:null }; }
  catch (e) { return { data:null, error:mensagemErro(e) }; }
}
