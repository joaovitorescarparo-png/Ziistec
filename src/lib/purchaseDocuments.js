import { supabase } from './supabase';

const BUCKET='zt-documents';
const safe=(name)=>String(name||'arquivo').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/-+/g,'-').slice(-120);
const allowed=new Set(['application/pdf','image/jpeg','image/png','image/webp']);
const check=(r)=>{if(r?.error) throw r.error; return r?.data;};
async function signed(path){const r=await supabase.storage.from(BUCKET).createSignedUrl(path,3600);return r.error?null:r.data?.signedUrl||null;}

export async function carregarDocumentosCompraDB(purchaseId){
  if(!purchaseId) return [];
  const rows=check(await supabase.from('attachments').select('*').eq('purchase_id',purchaseId).order('created_at',{ascending:true}))||[];
  return Promise.all(rows.map(async a=>({id:a.id,nome:a.file_name,categoria:a.category||'Documento de compra',url:await signed(a.path),path:a.path,bucket:a.bucket,persistido:true})));
}

export async function persistirDocumentosCompraDB(purchaseId,anexos,companyId,userId){
  for(const a of (anexos||[]).filter(x=>x?.arquivo instanceof File)){
    const f=a.arquivo;
    if(!allowed.has(f.type)) throw new Error('Formato não permitido. Use PDF, JPG, PNG ou WEBP.');
    if(f.size>20*1024*1024) throw new Error('Cada documento pode ter no máximo 20 MB.');
    const path=`${companyId}/purchases/${purchaseId}/${crypto.randomUUID()}-${safe(f.name)}`;
    const up=await supabase.storage.from(BUCKET).upload(path,f,{contentType:f.type,upsert:false});
    if(up.error) throw up.error;
    const ins=await supabase.from('attachments').insert({company_id:companyId,bucket:BUCKET,path,file_name:f.name,content_type:f.type,size_bytes:f.size||null,category:a.categoria||'Documento de compra',purchase_id:purchaseId,work_order_id:null,uploaded_by:userId||null}).select().single();
    if(ins.error){await supabase.storage.from(BUCKET).remove([path]);throw ins.error;}
  }
  return carregarDocumentosCompraDB(purchaseId);
}

export async function removerDocumentoCompraDB(doc){
  if(!doc?.id||!doc?.path) return;
  const del=await supabase.from('attachments').delete().eq('id',doc.id);
  if(del.error) throw del.error;
  const rm=await supabase.storage.from(BUCKET).remove([doc.path]);
  if(rm.error) throw rm.error;
}
