import { supabase } from './supabase';

// Histórico técnico por cliente/local (0104). Nesta linha beta o histórico é exclusivo do proprietário;
// o detalhe de uma OS vale para o proprietário ou para o técnico atribuído, sem preço para o técnico.
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
