import { supabase, mensagemErro } from './supabase';

const check = (r) => { if (r?.error) throw r.error; return r?.data; };
const n = (v) => Number(v || 0);

export async function carregarCatalogoTecnicoDB(companyId) {
  const data = check(await supabase.rpc('zt_technician_catalog', { p_company: companyId }));
  return (data || []).map((p) => ({
    id:p.id, nome:p.name, marca:p.brand||'', modelo:p.model||'', descricao:p.description||'', unidade:p.unit||'unidade',
    preco:n(p.price), garantiaMeses:Number(p.warranty_months||0), imagemPath:p.image_path||null,
    estoque:n(p.stock_qty), controlaEstoque:Boolean(p.track_stock),
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
