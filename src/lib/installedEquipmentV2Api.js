import { supabase } from './supabase';

const check=(r)=>{if(r?.error) throw r.error;return r?.data;};
const signed=async(path)=>{
  if(!path) return null;
  const r=await supabase.storage.from('zt-work-orders').createSignedUrl(path,3600);
  return r.error?null:r.data?.signedUrl||null;
};

export async function carregarEquipamentosInstaladosV2DB(clientId){
  if(!clientId) return [];
  const rows=check(await supabase.rpc('zt_installed_equipment_history',{p_client:clientId}))||[];
  return Promise.all(rows.map(async row=>({...row,image_url:await signed(row.image_path)})));
}

export async function registrarEquipamentoInstaladoV2DB({
  workOrder,sourceType,sourceId,locationName,locationId=null,serial='',barcode='',notes='',imageAttachmentId=null,
}){
  if(!workOrder?.id||workOrder.status!=='done') throw new Error('A OS precisa estar finalizada.');
  if(!['material','item'].includes(sourceType)||!sourceId) throw new Error('Selecione o produto/equipamento usado na OS.');
  const serialValue=String(serial||'').trim();
  const barcodeValue=String(barcode||'').trim();
  const notesValue=String(notes||'').trim();
  const locationValue=String(locationName||'').trim();
  if(serialValue.length>240) throw new Error('O serial deve ter no máximo 240 caracteres.');
  if(barcodeValue.length>240) throw new Error('O código físico deve ter no máximo 240 caracteres.');
  if(notesValue.length>5000) throw new Error('As observações devem ter no máximo 5.000 caracteres.');
  if(locationValue.length>300) throw new Error('O local deve ter no máximo 300 caracteres.');

  return check(await supabase.rpc('zt_register_installed_equipment',{
    p_wo:workOrder.id,
    p_source_material:sourceType==='material'?sourceId:null,
    p_source_item:sourceType==='item'?sourceId:null,
    p_location_name:locationValue||null,
    p_location_id:locationId||null,
    p_serial:serialValue||null,
    p_barcode:barcodeValue||null,
    p_notes:notesValue||null,
    p_image_attachment:imageAttachmentId||null,
  }));
}
