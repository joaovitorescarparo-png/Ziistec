import { supabase } from './supabase';
import { idempotentWrite } from './reliability';

const check=(r)=>{if(r?.error) throw r.error;return r?.data;};
const uuid=()=>{
  if(!globalThis.crypto?.randomUUID) throw new Error('Seu navegador precisa ser atualizado para registrar o retorno com segurança.');
  return globalThis.crypto.randomUUID();
};

export async function carregarChecklistTemplatesV2DB(companyId){
  const r=await supabase.from('checklist_templates')
    .select('id,company_id,name,description,active,created_at,updated_at,checklist_template_items(id,position,text,required)')
    .eq('company_id',companyId).order('name',{ascending:true});
  const rows=check(r)||[];
  return rows.map(t=>({...t,items:[...(t.checklist_template_items||[])].sort((a,b)=>a.position-b.position)}));
}

export async function salvarChecklistTemplateV2DB({companyId,templateId=null,name,description='',active=true,items=[]}){
  const payload=(items||[]).map((x,index)=>({text:String(x.text||'').trim(),required:Boolean(x.required),position:index}));
  const r=await idempotentWrite(()=>supabase.rpc('zt_save_checklist_template',{
    p_company:companyId,
    p_template:templateId||null,
    p_name:String(name||'').trim(),
    p_description:String(description||'').trim()||null,
    p_active:Boolean(active),
    p_items:payload,
  }));
  return check(r);
}

export async function aplicarChecklistTemplateV2DB(workOrderId,templateId){
  const r=await idempotentWrite(()=>supabase.rpc('zt_apply_checklist_template',{p_wo:workOrderId,p_template:templateId}));
  return Number(check(r)||0);
}

export async function carregarChecklistOSV2DB(workOrderId){
  const r=await supabase.from('work_order_checklists')
    .select('id,work_order_id,text,done,position,required,source_template_id')
    .eq('work_order_id',workOrderId).order('position',{ascending:true});
  return check(r)||[];
}

export async function marcarChecklistItemV2DB(id,done){
  const r=await idempotentWrite(()=>supabase.from('work_order_checklists').update({done:Boolean(done),updated_at:new Date().toISOString()}).eq('id',id).select('id,done').single());
  return check(r);
}

export function novoReturnRequestId(){return uuid();}

export async function marcarRetornoOSV2DB({workOrderId,reason,materialNeeded='',notes='',priority='normal',expectedReturnDate=null,requestId}){
  const operationId=requestId||uuid();
  const r=await idempotentWrite(()=>supabase.rpc('zt_mark_work_order_needs_return',{
    p_wo:workOrderId,
    p_reason:String(reason||'').trim(),
    p_material_needed:String(materialNeeded||'').trim()||null,
    p_notes:String(notes||'').trim()||null,
    p_priority:priority||'normal',
    p_expected_return_date:expectedReturnDate||null,
    p_request_id:operationId,
  }));
  return {id:check(r),requestId:operationId};
}

export async function carregarRetornosOSV2DB(workOrderId){
  const r=await supabase.from('work_order_returns')
    .select('id,work_order_id,reason,material_needed,notes,priority,expected_return_date,returned_at,resolved_at,created_at,created_by')
    .eq('work_order_id',workOrderId).order('created_at',{ascending:true});
  return check(r)||[];
}
