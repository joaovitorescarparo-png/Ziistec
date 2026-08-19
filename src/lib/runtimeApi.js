import { supabase } from './supabase';
import { salvarOSDB, atualizarOSDB } from './dataApi';

const check=(r)=>{if(r?.error) throw r.error; return r?.data;};
const isUuid=(v)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v||''));
const safe=(name)=>String(name||'arquivo').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/-+/g,'-').slice(-120);
const purchaseDocTypes=new Set(['application/pdf','image/jpeg','image/png','image/webp']);

async function signed(bucket,path){const r=await supabase.storage.from(bucket).createSignedUrl(path,3600);return r.error?null:r.data?.signedUrl||null;}

export async function hidratarComplementosDB(data,companyId){
  const [rr,aa,mm,cc]=await Promise.all([
    supabase.from('work_order_reports').select('*').eq('company_id',companyId).order('created_at',{ascending:true}),
    supabase.from('attachments').select('*').eq('company_id',companyId).order('created_at',{ascending:true}),
    supabase.from('work_order_materials').select('*').eq('company_id',companyId).order('created_at',{ascending:true}),
    supabase.from('work_order_checklists').select('*').eq('company_id',companyId).order('position',{ascending:true}),
  ]);
  check(rr);check(aa);check(mm);check(cc);
  const attachments=await Promise.all((aa.data||[]).map(async a=>({...a,url:await signed(a.bucket,a.path)})));
  const ordens=(data.ordens||[]).map(o=>{
    const reps=(rr.data||[]).filter(r=>r.work_order_id===o.id);
    const reports=reps.filter(r=>r.entry_type==='report');
    const hist=reps.filter(r=>r.entry_type==='history').map(r=>({id:r.id,quando:(r.created_at||'').slice(0,10),texto:r.body}));
    const mats=(mm.data||[]).filter(m=>m.work_order_id===o.id).map(m=>({id:m.id,tipo:'produto',catalogoId:m.product_id,nome:m.name,unidade:'unidade',qtd:Number(m.quantity||1),preco:0,custo:Number(m.unit_cost||0),materialRegistrado:true,serie:m.serial_number||''}));
    const checklist=(cc.data||[]).filter(c=>c.work_order_id===o.id).map(c=>({id:c.id,texto:c.text,feito:Boolean(c.done)}));
    const fotos=attachments.filter(a=>a.work_order_id===o.id).map(a=>({id:a.id,nome:a.file_name,categoria:a.category||'Foto',url:a.url,path:a.path,bucket:a.bucket,persistido:true}));
    return {...o,relato:reports.at(-1)?.body||o.relato||'',historico:hist.length?hist:o.historico||[],checklist,fotos,itens:[...(o.itens||[]),...mats],custosExtras:Number(o.valorAdicional||o.custosExtras||0),valorAdicional:0};
  });
  const compras=(data.compras||[]).map(c=>({...c,anexos:attachments.filter(a=>a.purchase_id===c.id).map(a=>({id:a.id,nome:a.file_name,url:a.url,path:a.path,bucket:a.bucket,persistido:true}))}));
  return {...data,ordens,compras};
}

async function uploadAttachment({file,companyId,bucket,folder,category,workOrderId,purchaseId,userId}){
  if(!(file instanceof File)) return null;
  const path=`${companyId}/${folder}/${crypto.randomUUID()}-${safe(file.name)}`;
  const up=await supabase.storage.from(bucket).upload(path,file,{contentType:file.type||undefined,upsert:false});
  if(up.error) throw up.error;
  const row={company_id:companyId,bucket,path,file_name:file.name,content_type:file.type||null,size_bytes:file.size||null,category:category||null,work_order_id:workOrderId||null,purchase_id:purchaseId||null,uploaded_by:userId||null};
  const ins=await supabase.from('attachments').insert(row).select().single();
  if(ins.error){await supabase.storage.from(bucket).remove([path]);throw ins.error;}
  return {...ins.data,url:await signed(bucket,path)};
}

export async function uploadFotosOSDB(osId,fotos,companyId,userId){
  const novos=(fotos||[]).filter(f=>f?.arquivo instanceof File);
  for(const f of novos) await uploadAttachment({file:f.arquivo,companyId,bucket:'zt-work-orders',folder:`work-orders/${osId}`,category:f.categoria||'Foto',workOrderId:osId,userId});
}

export async function uploadDocumentosCompraDB(purchaseId,anexos,companyId,userId){
  const novos=(anexos||[]).filter(a=>a?.arquivo instanceof File);
  for(const a of novos){
    const file=a.arquivo;
    if(!purchaseDocTypes.has(file.type)) throw new Error('Formato não permitido. Use PDF, JPG, PNG ou WEBP.');
    if(file.size>20*1024*1024) throw new Error('Cada documento pode ter no máximo 20 MB.');
    await uploadAttachment({file,companyId,bucket:'zt-documents',folder:`purchases/${purchaseId}`,category:'purchase_document',purchaseId,userId});
  }
}

export async function uploadLogoEmpresaDB(file,companyId){
  if(!(file instanceof File)) throw new Error('Selecione uma imagem.');
  const ext=(file.name.split('.').pop()||'png').toLowerCase();
  const path=`${companyId}/branding/logo-${Date.now()}.${safe(ext)}`;
  const up=await supabase.storage.from('zt-branding').upload(path,file,{contentType:file.type||undefined,upsert:false});
  if(up.error) throw up.error;
  check(await supabase.from('companies').update({logo_path:path}).eq('id',companyId));
  return {path,url:await signed('zt-branding',path)};
}

async function persistirChecklist(os,checklist,companyId,userId){
  const current=check(await supabase.from('work_order_checklists').select('id').eq('work_order_id',os.id))||[];
  const keep=new Set((checklist||[]).map(c=>c.id).filter(isUuid));
  const apagar=current.map(c=>c.id).filter(id=>!keep.has(id));
  if(apagar.length) check(await supabase.from('work_order_checklists').delete().in('id',apagar));
  for(let i=0;i<(checklist||[]).length;i++){
    const c=checklist[i];
    if(isUuid(c.id)) check(await supabase.from('work_order_checklists').update({text:c.texto||'Item',done:Boolean(c.feito),position:i,updated_at:new Date().toISOString()}).eq('id',c.id));
    else check(await supabase.from('work_order_checklists').insert({work_order_id:os.id,company_id:companyId,text:c.texto||'Item',done:Boolean(c.feito),position:i,created_by:userId||null}));
  }
  const fresh=check(await supabase.from('work_order_checklists').select('*').eq('work_order_id',os.id).order('position',{ascending:true}))||[];
  return fresh.map(c=>({id:c.id,texto:c.text,feito:Boolean(c.done)}));
}

export async function persistirEdicaoOSDB(os,patch,companyId,userId,papel){
  if('checklist' in patch) return {checklist:await persistirChecklist(os,patch.checklist,companyId,userId)};
  if('itens' in patch){
    if(papel!=='proprietario') return null;
    const limpos=(os.itens||[]).filter(i=>!i.materialRegistrado);
    await salvarOSDB({...os,itens:limpos},companyId,userId);
    return null;
  }
  const db={};
  if('local' in patch) db.address=patch.local||null;
  if('localServico' in patch) db.service_place=patch.localServico||null;
  if('descricaoLivre' in patch) db.request=patch.descricaoLivre||null;
  if('obs' in patch) db.pre_notes=patch.obs||null;
  if('relatoProblema' in patch) db.problem_report=patch.relatoProblema||null;
  if('pendencia' in patch) db.pending_note=patch.pendencia||null;
  if(Object.keys(db).length) await atualizarOSDB(os.id,db);
  if('relato' in patch){
    const q=await supabase.from('work_order_reports').select('id').eq('work_order_id',os.id).eq('entry_type','report').order('created_at',{ascending:false}).limit(1).maybeSingle();
    if(q.error) throw q.error;
    if(q.data?.id) check(await supabase.from('work_order_reports').update({body:patch.relato||''}).eq('id',q.data.id));
    else if((patch.relato||'').trim()) check(await supabase.from('work_order_reports').insert({work_order_id:os.id,company_id:companyId,entry_type:'report',body:patch.relato,author_id:userId||null}));
  }
  return null;
}

export async function prepararFinalizacaoOSDB(os,extras,companyId,userId,papel){
  await uploadFotosOSDB(os.id,extras.fotos||[],companyId,userId);
  const baseIds=new Set((os.itens||[]).map(i=>i.id));
  const materiais=(extras.itens||[]).filter(i=>!baseIds.has(i.id) && !i.adicional && !i.isExtra).map(m=>({
    product_id:isUuid(m.catalogoId)?m.catalogoId:null,
    name:m.nome||'Material',
    quantity:Number(m.qtd||1),
    unit_cost:papel==='proprietario'?Number(m.custo||0):0,
    serial_number:m.serie||null,
  }));
  const adicionais=(extras.adicionais||[]).map(a=>({
    name:a.nome||'Adicional',
    unit:a.unidade||'unidade',
    quantity:Number(a.qtd||1),
    unit_price:papel==='proprietario'?Number(a.preco||0):0,
    notes:a.obs||null,
  }));
  return {materiaisDB:materiais,adicionaisDB:adicionais};
}
