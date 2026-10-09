import { supabase } from './supabase';

// Histórico técnico por cliente/local (0098). O banco aplica o papel: proprietário recebe valores;
// técnico só recebe o local onde tem OS aberta atribuída, sem valores, pagamento ou preço.
const check=(r)=>{if(r?.error) throw r.error;return r?.data;};
const rpcMissing=(e)=>String(e?.code||'')==='PGRST202'
  ||/(zt_client_service_history|zt_work_order_history_detail).*(schema cache|does not exist|could not find)/i.test(String(e?.message||''));

export async function carregarHistoricoAtendimentosDB({clientId,locationId=null,limit=50}){
  if(!clientId) return {disponivel:true,itens:[]};
  const r=await supabase.rpc('zt_client_service_history',{p_client:clientId,p_location:locationId||null,p_limit:limit});
  if(r.error&&rpcMissing(r.error)) return {disponivel:false,itens:[]};
  return {disponivel:true,itens:check(r)||[]};
}

export async function carregarDetalheHistoricoOSDB(workOrderId){
  if(!workOrderId) throw new Error('OS inválida.');
  return check(await supabase.rpc('zt_work_order_history_detail',{p_wo:workOrderId}));
}
