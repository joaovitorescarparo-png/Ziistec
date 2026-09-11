import { supabase, mensagemErro } from './supabase';

export async function buscarGlobalV2DB(companyId,query,{limit=30,offset=0}={}){
  const text=String(query||'').trim().slice(0,120);
  const {data,error}=await supabase.rpc('zt_global_operational_search',{
    p_company:companyId,
    p_query:text,
    p_limit:Math.min(Math.max(Number(limit)||30,1),50),
    p_offset:Math.max(Number(offset)||0,0),
  });
  if(error)throw new Error(mensagemErro(error));
  return {
    items:Array.isArray(data?.items)?data.items:[],
    hasMore:Boolean(data?.has_more),
    nextOffset:data?.next_offset==null?null:Number(data.next_offset),
  };
}
