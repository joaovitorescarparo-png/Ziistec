import { supabase } from './supabase';

const IMAGE_MIMES=new Set(['image/jpeg','image/png','image/webp','image/heic','image/heif']);
const VIDEO_MIMES=new Set(['video/mp4','video/quicktime','video/webm']);
const STAGES=new Set(['before','during','after','equipment','video','other']);
const STAGE_LABEL={before:'Antes',during:'Durante',after:'Depois',equipment:'Equipamento',video:'Vídeo',other:'Outro'};
const STATUS_LABEL={unscheduled:'Aguardando',scheduled:'Agendada',in_progress:'Em andamento',done:'Concluída',canceled:'Cancelada'};

const safe=(name)=>String(name||'arquivo').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/-+/g,'-').slice(-120);
const check=(r)=>{if(r?.error) throw r.error;return r?.data;};
const migrationPending=(e)=>['42703','PGRST204','PGRST205'].includes(String(e?.code||''))||/(media_kind|media_stage|caption).*(does not exist|schema cache|not find|could not find)/i.test(String(e?.message||''));
const ext=(name)=>String(name||'').split('.').pop()?.toLowerCase()||'';
const mimeFromFile=(file)=>{
  if(file?.type) return file.type;
  const e=ext(file?.name);
  if(e==='heic') return 'image/heic';
  if(e==='heif') return 'image/heif';
  if(e==='jpg'||e==='jpeg') return 'image/jpeg';
  if(e==='png') return 'image/png';
  if(e==='webp') return 'image/webp';
  if(e==='mov') return 'video/quicktime';
  if(e==='mp4') return 'video/mp4';
  if(e==='webm') return 'video/webm';
  return '';
};
const inferStage=(category)=>{
  const c=String(category||'').toLowerCase();
  if(c.includes('antes')) return 'before';
  if(c.includes('durante')) return 'during';
  if(c.includes('depois')) return 'after';
  if(c.includes('equip')) return 'equipment';
  if(c.includes('vídeo')||c.includes('video')) return 'video';
  return 'other';
};
const signed=async(bucket,path)=>{
  const r=await supabase.storage.from(bucket).createSignedUrl(path,3600);
  return r.error?null:r.data?.signedUrl||null;
};

export async function carregarMemoriasOSV2DB(companyId){
  const [woR,clientsR,reportsR]=await Promise.all([
    supabase.from('work_orders').select('id,company_id,number,client_id,assigned_to,status,scheduled_date,scheduled_time,address,service_place,request,pre_notes,pending_note,needs_return,is_warranty_visit,problem_report,completed_at,created_at,updated_at').eq('company_id',companyId).order('created_at',{ascending:false}),
    supabase.from('clients').select('id,name,address,phone,whatsapp').eq('company_id',companyId),
    supabase.from('work_order_reports').select('id,work_order_id,entry_type,body,author_id,created_at').eq('company_id',companyId).order('created_at',{ascending:false}),
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
    return {...w,client,status_label:STATUS_LABEL[w.status]||w.status,reports:rel,search_text:[w.number,client?.name,w.request,w.service_place,w.address,w.problem_report,...rel.map(x=>x.body)].filter(Boolean).join(' ').toLowerCase()};
  });
}

async function carregarAttachments(woId,companyId){
  let migrated=true;
  let r=await supabase.from('attachments').select('id,company_id,bucket,path,file_name,content_type,size_bytes,category,work_order_id,uploaded_by,created_at,media_kind,media_stage,caption').eq('company_id',companyId).eq('work_order_id',woId).order('created_at',{ascending:true});
  if(r.error&&migrationPending(r.error)){
    migrated=false;
    r=await supabase.from('attachments').select('id,company_id,bucket,path,file_name,content_type,size_bytes,category,work_order_id,uploaded_by,created_at').eq('company_id',companyId).eq('work_order_id',woId).order('created_at',{ascending:true});
  }
  const rows=check(r)||[];
  const media=await Promise.all(rows.map(async a=>({
    ...a,
    media_kind:a.media_kind||(String(a.content_type||'').startsWith('video/')?'video':'photo'),
    media_stage:a.media_stage||inferStage(a.category),
    caption:a.caption||'',
    url:await signed(a.bucket,a.path),
  })));
  return {migrated,media};
}

export async function carregarDetalheMemoriaOSV2DB(companyId,woId){
  const [woR,itemsR,materialsR,reportsR,attachments]=await Promise.all([
    supabase.from('work_orders').select('id,company_id,number,client_id,assigned_to,status,scheduled_date,scheduled_time,address,service_place,request,pre_notes,pending_note,needs_return,is_warranty_visit,problem_report,completed_at,created_at,updated_at').eq('company_id',companyId).eq('id',woId).single(),
    supabase.from('work_order_items').select('id,work_order_id,kind,service_id,product_id,name,unit,quantity,unit_price,notes,is_extra,price_pending').eq('company_id',companyId).eq('work_order_id',woId),
    supabase.from('work_order_materials').select('id,work_order_id,product_id,name,quantity,serial_number,created_at').eq('company_id',companyId).eq('work_order_id',woId).order('created_at',{ascending:true}),
    supabase.from('work_order_reports').select('id,work_order_id,entry_type,body,author_id,created_at').eq('company_id',companyId).eq('work_order_id',woId).order('created_at',{ascending:true}),
    carregarAttachments(woId,companyId),
  ]);
  const wo=check(woR);
  const client=check(await supabase.from('clients').select('id,name,address,phone,whatsapp').eq('company_id',companyId).eq('id',wo.client_id).maybeSingle())||null;
  return {workOrder:{...wo,client,status_label:STATUS_LABEL[wo.status]||wo.status},items:check(itemsR)||[],materials:check(materialsR)||[],reports:check(reportsR)||[],media:attachments.media,mediaMigrationReady:attachments.migrated};
}

export async function salvarRelatoTecnicoV2DB({workOrder,body,userId}){
  const text=String(body||'').trim();
  if(!workOrder?.id||!workOrder?.company_id) throw new Error('OS inválida.');
  if(!text) throw new Error('Escreva ou dite o relato técnico.');
  if(text.length>10000) throw new Error('O relato técnico deve ter no máximo 10.000 caracteres.');
  return check(await supabase.from('work_order_reports').insert({work_order_id:workOrder.id,company_id:workOrder.company_id,entry_type:'report',body:text,author_id:userId||null}).select('id,work_order_id,entry_type,body,author_id,created_at').single());
}

export async function enviarEvidenciaOSV2DB({workOrder,file,companyId,userId,stage='other',caption=''}){
  if(!workOrder?.id||workOrder.company_id!==companyId) throw new Error('OS inválida para esta empresa.');
  if(!file||typeof file!=='object') throw new Error('Selecione uma foto ou vídeo.');
  if(!STAGES.has(stage)) throw new Error('Categoria de evidência inválida.');

  const probe=await supabase.from('attachments').select('media_kind').eq('company_id',companyId).limit(1);
  if(probe.error&&migrationPending(probe.error)){
    const e=new Error('A memória técnica com vídeo está pronta na branch, mas a migration 0061 ainda não foi homologada no banco.');
    e.code='V2_MIGRATION_PENDING';
    throw e;
  }
  if(probe.error) throw probe.error;

  const mime=mimeFromFile(file);
  const isImage=IMAGE_MIMES.has(mime);
  const isVideo=VIDEO_MIMES.has(mime);
  if(!isImage&&!isVideo) throw new Error('Use JPG, PNG, WEBP, HEIC/HEIF, MP4, MOV ou WEBM.');
  if(isImage&&Number(file.size||0)>15*1024*1024) throw new Error('A foto deve ter no máximo 15 MB.');
  if(isVideo&&Number(file.size||0)>30*1024*1024) throw new Error('O vídeo deve ter no máximo 30 MB.');
  if(stage==='video'&&!isVideo) throw new Error('Na categoria Vídeo, selecione um arquivo de vídeo.');
  const text=String(caption||'').trim();
  if(text.length>1000) throw new Error('A legenda deve ter no máximo 1.000 caracteres.');

  const path=`${companyId}/work-orders/${workOrder.id}/${crypto.randomUUID()}-${safe(file.name)}`;
  const upload=await supabase.storage.from('zt-work-orders').upload(path,file,{contentType:mime,upsert:false});
  if(upload.error) throw upload.error;

  const row={company_id:companyId,bucket:'zt-work-orders',path,file_name:file.name||'arquivo',content_type:mime,size_bytes:file.size||null,category:STAGE_LABEL[stage]||'Outro',work_order_id:workOrder.id,uploaded_by:userId||null,media_kind:isVideo?'video':'photo',media_stage:stage,caption:text||null};
  const ins=await supabase.from('attachments').insert(row).select('id,company_id,bucket,path,file_name,content_type,size_bytes,category,work_order_id,uploaded_by,created_at,media_kind,media_stage,caption').single();
  if(ins.error){await supabase.storage.from('zt-work-orders').remove([path]);throw ins.error;}
  return {...ins.data,url:await signed('zt-work-orders',path)};
}

export { STAGE_LABEL, STATUS_LABEL };
