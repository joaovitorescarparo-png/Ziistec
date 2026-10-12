import { supabase } from './supabase';
import { EVIDENCE_STAGE_LABEL, inferEvidenceStage, persistWorkOrderEvidence } from './workOrderEvidence';

const STAGE_LABEL=EVIDENCE_STAGE_LABEL;
const STATUS_LABEL={unscheduled:'Aguardando',scheduled:'Agendada',in_progress:'Em andamento',done:'Concluída',canceled:'Cancelada'};

const check=(r)=>{if(r?.error) throw r.error;return r?.data;};
const migrationPending=(e)=>['42703','PGRST204','PGRST205'].includes(String(e?.code||''))||/(content_sha256|media_kind|media_stage|caption|include_in_service_report|snapshot|report_version|zt_register_work_order_evidence).*(does not exist|schema cache|not find|could not find)/i.test(String(e?.message||''));
const signed=async(bucket,path)=>{
  const r=await supabase.storage.from(bucket).createSignedUrl(path,3600);
  return r.error?null:r.data?.signedUrl||null;
};

const REPORT_SELECT='id,work_order_id,company_id,entry_type,body,author_id,created_at,report_version,is_active,snapshot,client_id,finalized_at';

export async function carregarMemoriasOSV2DB(companyId){
  const [woR,clientsR,reportsR]=await Promise.all([
    supabase.from('work_orders').select('id,company_id,number,client_id,assigned_to,status,scheduled_date,scheduled_time,address,service_place,request,pre_notes,pending_note,needs_return,is_warranty_visit,problem_report,completed_at,created_at,updated_at').eq('company_id',companyId).order('created_at',{ascending:false}),
    supabase.from('clients').select('id,name,address,phone,whatsapp').eq('company_id',companyId),
    supabase.from('work_order_reports').select(REPORT_SELECT).eq('company_id',companyId).order('created_at',{ascending:false}),
  ]);
  const workOrders=check(woR)||[];
  const clients=check(clientsR)||[];
  const reports=check(reportsR)||[];
  const clientMap=new Map(clients.map(c=>[c.id,c]));
  const reportsBy=new Map();
  for(const r of reports){const list=reportsBy.get(r.work_order_id)||[];list.push(r);reportsBy.set(r.work_order_id,list);}
  return workOrders.map(w=>{
    const client=clientMap.get(w.client_id)||null;
    const rel=reportsBy.get(w.id)||[];
    const serviceReport=rel.find(x=>x.entry_type==='service_report'&&x.is_active)||null;
    const searchable=rel.filter(x=>x.entry_type!=='service_report').map(x=>x.body);
    return {...w,client,status_label:STATUS_LABEL[w.status]||w.status,reports:rel,serviceReport,search_text:[w.number,client?.name,w.request,w.service_place,w.address,w.problem_report,...searchable].filter(Boolean).join(' ').toLowerCase()};
  });
}

async function carregarAttachments(woId,companyId){
  let migrated=true;
  let r=await supabase.from('attachments').select('id,company_id,bucket,path,file_name,content_type,size_bytes,category,work_order_id,uploaded_by,created_at,content_sha256,media_kind,media_stage,caption,include_in_service_report').eq('company_id',companyId).eq('work_order_id',woId).order('created_at',{ascending:true});
  if(r.error&&migrationPending(r.error)){
    migrated=false;
    r=await supabase.from('attachments').select('id,company_id,bucket,path,file_name,content_type,size_bytes,category,work_order_id,uploaded_by,created_at,media_kind,media_stage,caption').eq('company_id',companyId).eq('work_order_id',woId).order('created_at',{ascending:true});
    if(r.error&&migrationPending(r.error)){
      r=await supabase.from('attachments').select('id,company_id,bucket,path,file_name,content_type,size_bytes,category,work_order_id,uploaded_by,created_at').eq('company_id',companyId).eq('work_order_id',woId).order('created_at',{ascending:true});
    }
  }
  const rows=check(r)||[];
  const media=await Promise.all(rows.map(async a=>({
    ...a,
    media_kind:a.media_kind||(String(a.content_type||'').startsWith('video/')?'video':String(a.content_type||'')==='application/pdf'?'document':'photo'),
    media_stage:a.media_stage||inferEvidenceStage(a.category),
    caption:a.caption||'',
    include_in_service_report:Boolean(a.include_in_service_report),
    url:await signed(a.bucket,a.path),
  })));
  return {migrated,media};
}

export async function carregarDetalheMemoriaOSV2DB(companyId,woId){
  const [woR,itemsR,materialsR,reportsR,attachments]=await Promise.all([
    supabase.from('work_orders').select('id,company_id,number,client_id,assigned_to,status,scheduled_date,scheduled_time,address,service_place,request,pre_notes,pending_note,needs_return,is_warranty_visit,problem_report,completed_at,created_at,updated_at').eq('company_id',companyId).eq('id',woId).single(),
    supabase.from('work_order_items').select('id,work_order_id,kind,service_id,product_id,name,unit,quantity,unit_price,notes,is_extra,price_pending').eq('company_id',companyId).eq('work_order_id',woId),
    supabase.from('work_order_materials').select('id,work_order_id,product_id,name,quantity,serial_number,created_at').eq('company_id',companyId).eq('work_order_id',woId).order('created_at',{ascending:true}),
    supabase.from('work_order_reports').select(REPORT_SELECT).eq('company_id',companyId).eq('work_order_id',woId).order('created_at',{ascending:true}),
    carregarAttachments(woId,companyId),
  ]);
  const wo=check(woR);
  const client=check(await supabase.from('clients').select('id,name,address,phone,whatsapp').eq('company_id',companyId).eq('id',wo.client_id).maybeSingle())||null;
  const reports=check(reportsR)||[];
  const serviceReport=reports.find(r=>r.entry_type==='service_report'&&r.is_active)||null;
  return {workOrder:{...wo,client,status_label:STATUS_LABEL[wo.status]||wo.status},items:check(itemsR)||[],materials:check(materialsR)||[],reports,serviceReport,media:attachments.media,mediaMigrationReady:attachments.migrated};
}

export async function salvarRelatoTecnicoV2DB({workOrder,body,userId}){
  const text=String(body||'').trim();
  if(!workOrder?.id||!workOrder?.company_id) throw new Error('OS inválida.');
  if(!text) throw new Error('Escreva ou dite o relato técnico.');
  if(text.length>10000) throw new Error('O relato técnico deve ter no máximo 10.000 caracteres.');
  return check(await supabase.from('work_order_reports').insert({work_order_id:workOrder.id,company_id:workOrder.company_id,entry_type:'report',body:text,author_id:userId||null}).select(REPORT_SELECT).single());
}

export async function definirEvidenciaRelatorioV2DB(attachmentId,include){
  if(!attachmentId) throw new Error('Evidência inválida.');
  return Boolean(check(await supabase.rpc('zt_set_service_report_evidence',{p_attachment:attachmentId,p_include:Boolean(include)})));
}

export async function enviarEvidenciaOSV2DB({workOrder,file,companyId,userId,stage='other',caption=''}){
  if(!workOrder?.id||workOrder.company_id!==companyId) throw new Error('OS inválida para esta empresa.');
  const probe=await supabase.from('attachments').select('content_sha256,media_kind,include_in_service_report').eq('company_id',companyId).limit(1);
  if(probe.error&&migrationPending(probe.error)){
    const e=new Error('A memória técnica desta branch depende da migration RC-1B de evidências homologada no Staging.');
    e.code='V2_MIGRATION_PENDING';
    throw e;
  }
  if(probe.error) throw probe.error;
  return persistWorkOrderEvidence({companyId,workOrderId:workOrder.id,file,stage,caption,category:STAGE_LABEL[stage]});
}

export { STAGE_LABEL, STATUS_LABEL };
