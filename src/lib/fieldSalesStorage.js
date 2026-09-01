import { supabase } from './supabase';

async function signed(path){
  if(!path)return null;
  const r=await supabase.storage.from('zt-branding').createSignedUrl(path,3600);
  return r.error?null:r.data?.signedUrl||null;
}

export async function resolverQrPixEmpresaDB(path){return signed(path);}

export async function salvarQrPixEmpresaDB(companyId,file,oldPath=null){
  if(!(file instanceof File))throw new Error('Selecione a imagem do QR Code Pix.');
  if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('Use JPG, PNG ou WEBP.');
  if(file.size>2*1024*1024)throw new Error('O QR Code deve ter no máximo 2 MB.');
  const ext=file.type==='image/png'?'png':file.type==='image/webp'?'webp':'jpg';
  const path=`${companyId}/branding/pix-qr-${crypto.randomUUID()}.${ext}`;
  const up=await supabase.storage.from('zt-branding').upload(path,file,{contentType:file.type,upsert:false});
  if(up.error)throw up.error;
  const row=await supabase.from('companies').update({pix_qr_path:path}).eq('id',companyId).select('id,pix_qr_path').single();
  if(row.error){await supabase.storage.from('zt-branding').remove([path]);throw row.error;}
  if(oldPath&&oldPath!==path)await supabase.storage.from('zt-branding').remove([oldPath]);
  return {path,url:await signed(path)};
}

export async function removerQrPixEmpresaDB(companyId,path){
  if(path){const r=await supabase.storage.from('zt-branding').remove([path]);if(r.error)throw r.error;}
  const r=await supabase.from('companies').update({pix_qr_path:null}).eq('id',companyId);
  if(r.error)throw r.error;
  return true;
}
