import { supabase } from './supabase';

export const IMAGE_MIMES=new Set(['image/jpeg','image/png','image/webp','image/heic','image/heif']);
export const VIDEO_MIMES=new Set(['video/mp4','video/quicktime','video/webm']);
export const DOCUMENT_MIMES=new Set(['application/pdf']);
export const EVIDENCE_STAGES=new Set(['before','during','after','equipment','video','other']);
export const EVIDENCE_STAGE_LABEL={before:'Antes',during:'Durante',after:'Depois',equipment:'Equipamento',video:'Vídeo',other:'Outro / documento'};

const MIME_EXTENSION={
  'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/heic':'heic','image/heif':'heif',
  'video/mp4':'mp4','video/quicktime':'mov','video/webm':'webm','application/pdf':'pdf',
};
const ATTACHMENT_SELECT='id,company_id,bucket,path,file_name,content_type,size_bytes,category,work_order_id,uploaded_by,created_at,content_sha256,media_kind,media_stage,caption,include_in_service_report';

const ext=(name)=>String(name||'').split('.').pop()?.toLowerCase()||'';
export function mimeFromEvidenceFile(file){
  if(file?.type&&MIME_EXTENSION[file.type]) return file.type;
  const e=ext(file?.name);
  if(e==='jpg'||e==='jpeg') return 'image/jpeg';
  if(e==='png') return 'image/png';
  if(e==='webp') return 'image/webp';
  if(e==='heic') return 'image/heic';
  if(e==='heif') return 'image/heif';
  if(e==='mp4') return 'video/mp4';
  if(e==='mov') return 'video/quicktime';
  if(e==='webm') return 'video/webm';
  if(e==='pdf') return 'application/pdf';
  return '';
}

export function inferEvidenceStage(category){
  const c=String(category||'').toLowerCase();
  if(c.includes('antes')) return 'before';
  if(c.includes('durante')) return 'during';
  if(c.includes('depois')) return 'after';
  if(c.includes('equip')) return 'equipment';
  if(c.includes('vídeo')||c.includes('video')) return 'video';
  return 'other';
}

export async function sha256File(file){
  if(!file||typeof file.arrayBuffer!=='function') throw new Error('Arquivo inválido para cálculo de integridade.');
  if(!globalThis.crypto?.subtle) throw new Error('Este navegador não oferece SHA-256 seguro para evidências.');
  const bytes=await file.arrayBuffer();
  const digest=await globalThis.crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
}

export function validateEvidenceFile(file,stage='other'){
  if(!file||typeof file!=='object') throw new Error('Selecione uma foto, vídeo ou documento.');
  if(!EVIDENCE_STAGES.has(stage)) throw new Error('Categoria de evidência inválida.');
  const mime=mimeFromEvidenceFile(file);
  const isImage=IMAGE_MIMES.has(mime);
  const isVideo=VIDEO_MIMES.has(mime);
  const isDocument=DOCUMENT_MIMES.has(mime);
  if(!isImage&&!isVideo&&!isDocument) throw new Error('Use JPG, PNG, WEBP, HEIC/HEIF, MP4, MOV, WEBM ou PDF.');
  if(isImage&&Number(file.size||0)>15*1024*1024) throw new Error('A foto deve ter no máximo 15 MB.');
  if(isVideo&&Number(file.size||0)>30*1024*1024) throw new Error('O vídeo deve ter no máximo 30 MB.');
  if(isDocument&&Number(file.size||0)>20*1024*1024) throw new Error('O documento deve ter no máximo 20 MB.');
  if(stage==='video'&&!isVideo) throw new Error('Na categoria Vídeo, selecione um arquivo de vídeo.');
  if(isDocument&&stage!=='other') throw new Error('Documentos devem usar a categoria Outro / documento.');
  return {mime,mediaKind:isVideo?'video':isDocument?'document':'photo'};
}

export function workOrderEvidencePath(companyId,workOrderId,stage,sha256,mime){
  const extension=MIME_EXTENSION[mime];
  if(!extension||!/^[0-9a-f]{64}$/.test(String(sha256||''))) throw new Error('Identidade da evidência inválida.');
  return `${companyId}/work-orders/${workOrderId}/${stage}/${sha256}.${extension}`;
}

const signed=async(path)=>{
  const r=await supabase.storage.from('zt-work-orders').createSignedUrl(path,3600);
  return r.error?null:r.data?.signedUrl||null;
};
const isAlreadyStored=(error)=>String(error?.statusCode||error?.status||'')==='409'||/(already exists|resource already exists|duplicate)/i.test(String(error?.message||''));
const isAmbiguousNetwork=(error)=>/(failed to fetch|networkerror|network request|timeout|timed out|connection)/i.test(String(error?.message||''))||String(error?.status||error?.statusCode||'')==='0';

async function findExisting(companyId,workOrderId,stage,hash){
  const r=await supabase.from('attachments').select(ATTACHMENT_SELECT)
    .eq('company_id',companyId).eq('work_order_id',workOrderId).eq('media_stage',stage).eq('content_sha256',hash).maybeSingle();
  if(r.error) return {row:null,error:r.error};
  return {row:r.data||null,error:null};
}

async function cleanupIfUnreferenced(path){
  const ref=await supabase.from('attachments').select('id').eq('bucket','zt-work-orders').eq('path',path).limit(1).maybeSingle();
  if(ref.error||ref.data) return false;
  const rm=await supabase.storage.from('zt-work-orders').remove([path]);
  return !rm.error;
}

export async function persistWorkOrderEvidence({companyId,workOrderId,file,stage='other',caption='',category=null}){
  if(!companyId||!workOrderId) throw new Error('OS inválida para esta empresa.');
  const {mime}=validateEvidenceFile(file,stage);
  const text=String(caption||'').trim();
  if(text.length>1000) throw new Error('A legenda deve ter no máximo 1.000 caracteres.');
  const hash=await sha256File(file);
  const path=workOrderEvidencePath(companyId,workOrderId,stage,hash,mime);

  let uploadedNow=false;
  const upload=await supabase.storage.from('zt-work-orders').upload(path,file,{contentType:mime,upsert:false});
  if(upload.error&&!isAlreadyStored(upload.error)) throw upload.error;
  if(!upload.error) uploadedNow=true;

  const args={
    p_company:companyId,
    p_work_order:workOrderId,
    p_path:path,
    p_file_name:file.name||'arquivo',
    p_content_type:mime,
    p_size_bytes:Number.isFinite(Number(file.size))?Number(file.size):null,
    p_media_stage:stage,
    p_caption:text||null,
    p_category:String(category||EVIDENCE_STAGE_LABEL[stage]||'Outro / documento').trim()||null,
    p_content_sha256:hash,
  };
  const rpc=await supabase.rpc('zt_register_work_order_evidence',args);
  let row=rpc.data||null;
  if(rpc.error){
    const existing=await findExisting(companyId,workOrderId,stage,hash);
    if(existing.row) row=existing.row;
    else {
      // Resposta perdida/timeout é ambígua: nunca apagamos o objeto determinístico,
      // pois outra tentativa pode ter concluído a metadata. Retry usa o mesmo path/hash.
      if(uploadedNow&&!isAmbiguousNetwork(rpc.error)&&!existing.error) await cleanupIfUnreferenced(path);
      throw rpc.error;
    }
  }

  // Mesmo conteúdo pode chegar com outro filename/MIME declarado em um retry.
  // A unicidade do banco vence; se o objeto desta tentativa não é o canônico,
  // removemos apenas quando nenhum attachment o referencia.
  if(uploadedNow&&row?.path&&row.path!==path) await cleanupIfUnreferenced(path);
  return {...row,url:row?.path?await signed(row.path):null};
}
