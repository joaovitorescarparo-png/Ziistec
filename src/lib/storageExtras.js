import { supabase } from './supabase';

const safe=(name)=>String(name||'arquivo').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/-+/g,'-').slice(-120);
const check=(r)=>{if(r?.error) throw r.error; return r?.data;};
async function signed(bucket,path){const r=await supabase.storage.from(bucket).createSignedUrl(path,3600);return r.error?null:r.data?.signedUrl||null;}

export async function resolverLogoEmpresaDB(path){
  if(!path) return null;
  return signed('zt-branding',path);
}

export async function resolverImagemProdutoDB(path){
  if(!path) return null;
  return signed('zt-branding',path);
}

export async function salvarImagemProdutoDB(productId,file,companyId,oldPath=null){
  if(!(file instanceof File)) throw new Error('Selecione uma imagem do produto.');
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('Use JPG, PNG ou WEBP.');
  if(file.size>2*1024*1024) throw new Error('A foto do produto deve ter no máximo 2 MB.');
  if(!productId||!companyId) throw new Error('Produto ou empresa inválidos.');

  const ext=(safe(file.name).split('.').pop()||'jpg').toLowerCase();
  const path=`${companyId}/products/${productId}/${crypto.randomUUID()}.${ext}`;
  const up=await supabase.storage.from('zt-branding').upload(path,file,{contentType:file.type,upsert:false});
  if(up.error) throw up.error;

  const row=await supabase.from('products').update({image_path:path}).eq('id',productId).eq('company_id',companyId).select('id,image_path').single();
  if(row.error){await supabase.storage.from('zt-branding').remove([path]);throw row.error;}

  if(oldPath&&oldPath!==path) await supabase.storage.from('zt-branding').remove([oldPath]);
  return {path,url:await signed('zt-branding',path)};
}

export async function removerImagemProdutoDB(productId,companyId,path){
  if(path){const r=await supabase.storage.from('zt-branding').remove([path]);if(r.error) throw r.error;}
  const row=await supabase.from('products').update({image_path:null}).eq('id',productId).eq('company_id',companyId);
  if(row.error) throw row.error;
  return true;
}

export async function persistirFotosOSDB(osId,fotos,companyId,userId){
  for(const f of (fotos||[]).filter(x=>x?.arquivo instanceof File)){
    const path=`${companyId}/work-orders/${osId}/${crypto.randomUUID()}-${safe(f.arquivo.name)}`;
    const up=await supabase.storage.from('zt-work-orders').upload(path,f.arquivo,{contentType:f.arquivo.type||undefined,upsert:false});
    if(up.error) throw up.error;
    const ins=await supabase.from('attachments').insert({company_id:companyId,bucket:'zt-work-orders',path,file_name:f.arquivo.name,content_type:f.arquivo.type||null,size_bytes:f.arquivo.size||null,category:f.categoria||'Foto',work_order_id:osId,uploaded_by:userId||null}).select().single();
    if(ins.error){await supabase.storage.from('zt-work-orders').remove([path]);throw ins.error;}
  }
  const rows=check(await supabase.from('attachments').select('*').eq('work_order_id',osId).order('created_at',{ascending:true}))||[];
  return {fotos:await Promise.all(rows.map(async a=>({id:a.id,nome:a.file_name,categoria:a.category||'Foto',url:await signed(a.bucket,a.path),path:a.path,bucket:a.bucket,persistido:true})))};
}
