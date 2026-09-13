import {supabase,mensagemErro} from './supabase';

export async function listarPosVendaV2DB(companyId,{scope='open',limit=60,offset=0}={}){
  const {data,error}=await supabase.rpc('zt_list_post_sale_followups',{
    p_company:companyId,p_scope:scope,p_limit:Math.min(Math.max(Number(limit)||60,1),100),p_offset:Math.max(Number(offset)||0,0),
  });
  if(error)throw new Error(mensagemErro(error));
  return {items:Array.isArray(data?.items)?data.items:[],hasMore:Boolean(data?.has_more),nextOffset:data?.next_offset==null?null:Number(data.next_offset)};
}

export async function listarPoliticasPosVendaV2DB(companyId){
  const {data,error}=await supabase.rpc('zt_list_post_sale_policies',{p_company:companyId});
  if(error)throw new Error(mensagemErro(error));
  return data||[];
}

export async function salvarPoliticaPosVendaV2DB(companyId,policy){
  const {data,error}=await supabase.rpc('zt_save_post_sale_policy',{
    p_company:companyId,p_policy:policy?.id||null,p_name:String(policy?.name||'').trim(),p_kind:policy?.kind||'check_in',
    p_days_offset:Number(policy?.days_offset)||0,p_enabled:policy?.enabled!==false,
  });
  if(error)throw new Error(mensagemErro(error));
  return data;
}

export async function atualizarPosVendaV2DB(id,{status=null,scheduledFor=null,note=null}={}){
  const {data,error}=await supabase.rpc('zt_update_post_sale_followup',{
    p_followup:id,p_status:status,p_scheduled_for:scheduledFor,p_note:note==null?null:String(note).slice(0,5000),
  });
  if(error)throw new Error(mensagemErro(error));
  return data;
}
