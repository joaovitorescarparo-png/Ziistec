import { supabase } from './supabase';
import { idempotentWrite } from './reliability';

const check=(r)=>{if(r?.error) throw r.error;return r?.data;};
const newId=()=>{if(!globalThis.crypto?.randomUUID) throw new Error('Atualize o navegador para salvar com segurança.');return globalThis.crypto.randomUUID();};

export async function listarModelosOrcamentoV2DB(companyId){return check(await supabase.rpc('zt_list_quote_templates',{p_company:companyId}))||[];}
export async function listarKitsOrcamentoV2DB(companyId){return check(await supabase.rpc('zt_list_quote_kits',{p_company:companyId}))||[];}
export async function resolverModeloOrcamentoV2DB(templateId){return check(await supabase.rpc('zt_resolve_quote_template',{p_template:templateId}));}
export async function resolverKitOrcamentoV2DB(kitId){return check(await supabase.rpc('zt_resolve_quote_kit',{p_kit:kitId}));}
export async function listarAtendimentosReutilizaveisV2DB(companyId){return check(await supabase.rpc('zt_list_reusable_work_orders',{p_company:companyId}))||[];}
export async function resolverAtendimentoAnteriorV2DB(workOrderId){return check(await supabase.rpc('zt_quote_seed_from_work_order',{p_work_order:workOrderId}));}

const adminItems=(items=[])=>items.map(x=>({service_id:x.serviceId||x.service_id||null,product_id:x.productId||x.product_id||null,quantity:Number(x.quantity||1),notes:String(x.notes||'').trim()||null}));
export async function salvarModeloOrcamentoV2DB({companyId,id=null,payload,items=[]}){
  return check(await idempotentWrite(()=>supabase.rpc('zt_save_quote_template',{p_company:companyId,p_template:id,p_payload:payload,p_items:adminItems(items)})));
}
export async function salvarKitOrcamentoV2DB({companyId,id=null,payload,items=[]}){
  return check(await idempotentWrite(()=>supabase.rpc('zt_save_quote_kit',{p_company:companyId,p_kit:id,p_payload:payload,p_items:adminItems(items)})));
}

export function novoQuoteReuseRequestId(){return newId();}
export async function salvarOrcamentoReutilizavelV2DB({companyId,quoteId=null,requestId,row,items}){
  const payload=(items||[]).map((item,index)=>({
    kind:item.kind||'free',service_id:item.serviceId||null,product_id:item.productId||null,name:String(item.name||'Item').slice(0,500),
    unit:String(item.unit||'unidade').slice(0,50),quantity:Number(item.quantity||1),unit_price:Number(item.unitPrice||0),unit_cost:Number(item.unitCost||0),notes:String(item.notes||'').trim()||null,position:index,
  }));
  const id=check(await idempotentWrite(()=>supabase.rpc('zt_save_reuse_quote_idempotent',{p_company:companyId,p_quote:quoteId,p_request:requestId,p_row:row,p_items:payload})));
  const q=await supabase.from('quotes').select('id,number').eq('id',id).eq('company_id',companyId).single();
  if(q.error) throw q.error;
  return q.data;
}
