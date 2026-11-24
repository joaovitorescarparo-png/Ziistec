import { supabase } from './supabase';
import { reportarErro } from './observabilidade';
import { comprimirImagemParaUpload, DOCUMENTO_IMAGEM_OPCOES } from './imageCompression';
import { salvarOSDB, atualizarOSDB } from './dataApi';
import { lerTodas, lerTodasPorIds } from './paginacao';
import { addDiasISO, hojeISO } from './dates';

const check=(r)=>{if(r?.error) throw r.error; return r?.data;};
const isUuid=(v)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v||''));
const safe=(name)=>String(name||'arquivo').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/-+/g,'-').slice(-120);
const purchaseDocTypes=new Set(['application/pdf','image/jpeg','image/png','image/webp']);
const workOrderPhotoTypes=new Set(['image/jpeg','image/png','image/webp','image/heic','image/heif']);
const brandingTypes=new Set(['image/jpeg','image/png','image/webp']);
const osWriteQueues=new Map();

function enqueueOsWrite(osId,task){
  const previous=osWriteQueues.get(osId)||Promise.resolve();
  const current=previous.then(task,task);
  const guard=current.then(()=>undefined,()=>undefined);
  osWriteQueues.set(osId,guard);
  guard.finally(()=>{if(osWriteQueues.get(osId)===guard) osWriteQueues.delete(osId);});
  return current;
}
async function signed(bucket,path){const r=await supabase.storage.from(bucket).createSignedUrl(path,3600);return r.error?null:r.data?.signedUrl||null;}
async function sha256File(file){
  const bytes=await file.arrayBuffer();
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
}
async function findAttachment({companyId,bucket,category,workOrderId,purchaseId,fingerprint}){
  let q=supabase.from('attachments').select('*').eq('company_id',companyId).eq('bucket',bucket).eq('content_sha256',fingerprint);
  q=category==null?q.is('category',null):q.eq('category',category);
  if(workOrderId) q=q.eq('work_order_id',workOrderId);
  if(purchaseId) q=q.eq('purchase_id',purchaseId);
  const r=await q.limit(1).maybeSingle();
  if(r.error) throw r.error;
  return r.data||null;
}

/* Complementos da OS (relatos, fotos, materiais, checklist, retornos, início).
 *
 * Antes: uma consulta por tabela para a EMPRESA INTEIRA no login, cortada em 1000 linhas
 * pela Data API, e uma URL assinada por anexo. Com mais de 1000 itens de checklist na
 * empresa, cada OS aparecia incompleta e salvar o checklist apagava do banco o item que
 * não tinha chegado à tela.
 *
 * Agora:
 * - o login hidrata só as OS em andamento e as concluídas nos últimos dias (o que as
 *   telas de lista usam), com leitura completa por bloco de OS;
 * - a tela da OS e a garantia relêem os complementos daquela OS por inteiro
 *   (`carregarComplementosOSDB`), qualquer que seja a idade dela;
 * - URLs assinadas saem em lote (`createSignedUrls`), não uma por arquivo.
 */
const STATUS_ABERTOS=new Set(['aguardando','agendada','andamento']);
export const DIAS_COMPLEMENTOS_RECENTES=30;
const ASSINATURA_LOTE=100;

async function assinarEmLote(rows){
  const porBucket=new Map();
  for(const a of rows||[]){ if(!a?.bucket||!a?.path) continue; const l=porBucket.get(a.bucket)||[]; l.push(a.path); porBucket.set(a.bucket,l); }
  const urls=new Map();
  for(const [bucket,paths] of porBucket){
    for(let i=0;i<paths.length;i+=ASSINATURA_LOTE){
      const lote=paths.slice(i,i+ASSINATURA_LOTE);
      const r=await supabase.storage.from(bucket).createSignedUrls(lote,3600);
      if(r.error) continue; // sem URL a miniatura some, mas o registro continua (mesmo comportamento de antes)
      for(const item of r.data||[]) if(item?.signedUrl&&!item.error) urls.set(`${bucket}/${item.path}`,item.signedUrl);
    }
  }
  return (rows||[]).map(a=>({...a,url:urls.get(`${a.bucket}/${a.path}`)||null}));
}

function concluidaRecente(o,hoje){
  if(o?.status!=='concluida') return false;
  const ref=String(o.concluidaEm||o.data||'').slice(0,10);
  return Boolean(ref)&&ref>=addDiasISO(hoje,-DIAS_COMPLEMENTOS_RECENTES);
}

/* OS que o login hidrata: as que estão em trabalho e as concluídas há pouco. */
export function ordensParaHidratarNoLogin(ordens,hoje=hojeISO()){
  return (ordens||[]).filter(o=>STATUS_ABERTOS.has(o?.status)||concluidaRecente(o,hoje)).map(o=>o.id);
}

async function lerComplementosBrutos(companyId,osIds){
  if(!osIds.length) return {reports:[],attachments:[],materials:[],checklists:[],returns:[],iniciadas:[]};
  const bloco=(table,select,order)=>lerTodasPorIds(osIds,(ids)=>supabase.from(table).select(select).eq('company_id',companyId).in('work_order_id',ids).order(order,{ascending:true}).order('id',{ascending:true}));
  const [rr,aa,mm,cc,rt]=await Promise.all([
    bloco('work_order_reports','*','created_at'),
    bloco('attachments','*','created_at'),
    bloco('work_order_materials','*','created_at'),
    bloco('work_order_checklists','*','position'),
    bloco('work_order_returns','*','created_at'),
  ]);
  check(rr);check(aa);check(mm);check(cc);check(rt);
  // 0101: started_at só existe depois da migration: leitura tolerante, nunca derruba a lista.
  const st=await lerTodasPorIds(osIds,(ids)=>supabase.from('work_orders').select('id,started_at').eq('company_id',companyId).in('id',ids).eq('status','in_progress').is('deleted_at',null).order('id',{ascending:true})).catch(()=>null);
  return {reports:rr.data,attachments:await assinarEmLote(aa.data),materials:mm.data,checklists:cc.data,returns:rt.data,iniciadas:st&&!st.error?st.data:[]};
}

const textoRetorno=(r)=>[`Precisa retornar · ${r.reason}`,r.material_needed?`Material necessário: ${r.material_needed}`:null,`Prioridade: ${{low:'baixa',normal:'normal',high:'alta',urgent:'urgente'}[r.priority]||r.priority}`,r.expected_return_date?`Previsão: ${String(r.expected_return_date).split('-').reverse().join('/')}`:null,r.returned_at?`Retorno realizado: ${new Date(r.returned_at).toLocaleDateString('pt-BR')}`:null,r.notes?`Observação: ${r.notes}`:null].filter(Boolean).join(' · ');

/* Aplica a uma OS os complementos lidos POR INTEIRO para ela. Idempotente: materiais já
   registrados não se acumulam em `itens` quando a OS é relida. */
export function aplicarComplementosOS(o,brutos){
  const doId=(rows)=>(rows||[]).filter(r=>r.work_order_id===o.id);
  const reps=doId(brutos.reports);
  const reports=reps.filter(r=>r.entry_type==='report');
  const hist=reps.filter(r=>r.entry_type==='history').map(r=>({id:r.id,quando:(r.created_at||'').slice(0,10),texto:r.body}));
  const mats=doId(brutos.materials).map(m=>({id:m.id,tipo:'produto',catalogoId:m.product_id,nome:m.name,unidade:'unidade',qtd:Number(m.quantity||1),preco:0,custo:Number(m.unit_cost||0),materialRegistrado:true,serie:m.serial_number||'',garantiaPolitica:m.warranty_policy||'catalog',garantiaMesesOverride:m.warranty_override_months==null?null:Number(m.warranty_override_months)}));
  const checklist=doId(brutos.checklists).sort((a,b)=>(a.position??0)-(b.position??0)).map(mapearItemChecklist);
  const retornos=doId(brutos.returns);
  const retornoHist=retornos.map(r=>({id:`return-${r.id}`,quando:(r.created_at||'').slice(0,10),texto:textoRetorno(r)}));
  const fotos=(brutos.attachments||[]).filter(a=>a.work_order_id===o.id).map(a=>({id:a.id,nome:a.file_name,categoria:a.category||'Foto',url:a.url,path:a.path,bucket:a.bucket,persistido:true}));
  const ultimoRelato=reports.at(-1)||null;
  lembrarRelato(o.id,ultimoRelato);
  const iniciada=(brutos.iniciadas||[]).find(x=>x.id===o.id)?.started_at||null;
  const historicoBase=(o.historico||[]).filter(h=>!String(h?.id||'').startsWith('return-'));
  return {...o,complementosCarregados:true,iniciadaEm:iniciada||(o.status==='andamento'?o.iniciadaEm||null:null),relato:ultimoRelato?.body||'',
    historico:[...(hist.length?hist:historicoBase),...retornoHist].sort((a,b)=>(a.quando||'').localeCompare(b.quando||'')),
    retornos,checklist,fotos,itens:[...(o.itens||[]).filter(i=>!i.materialRegistrado),...mats],custosExtras:Number(o.valorAdicional||o.custosExtras||0),valorAdicional:0};
}

export async function hidratarComplementosDB(data,companyId){
  const ids=ordensParaHidratarNoLogin(data.ordens);
  const brutos=await lerComplementosBrutos(companyId,ids);
  const alvo=new Set(ids);
  const ordens=(data.ordens||[]).map(o=>alvo.has(o.id)?aplicarComplementosOS(o,brutos):{...o,complementosCarregados:false});
  // Documentos de compra: só anexos de compra, lidos por inteiro.
  const compraIds=(data.compras||[]).map(c=>c.id);
  const docs=await lerTodasPorIds(compraIds,(bloco)=>supabase.from('attachments').select('*').eq('company_id',companyId).in('purchase_id',bloco).order('created_at',{ascending:true}).order('id',{ascending:true}));
  const anexosCompra=await assinarEmLote(check(docs)||[]);
  const compras=(data.compras||[]).map(c=>({...c,anexos:anexosCompra.filter(a=>a.purchase_id===c.id).map(a=>({id:a.id,nome:a.file_name,url:a.url,path:a.path,bucket:a.bucket,persistido:true}))}));
  return {...data,ordens,compras};
}

/* Relê os complementos de UMA OS, completos. Usado ao abrir a OS e a garantia. */
export async function carregarComplementosOSDB(os,companyId){
  if(!os?.id||!companyId) return os;
  const brutos=await lerComplementosBrutos(companyId,[os.id]);
  return aplicarComplementosOS(os,brutos);
}

async function uploadAttachment(args){
  try{ return await uploadAttachmentNow(args); }
  catch(e){ reportarErro('upload',{code:e?.code||e?.statusCode||e?.name,message:e?.message}); throw e; }
}

async function uploadAttachmentNow({file,companyId,bucket,folder,category,workOrderId,purchaseId,userId}){
  if(!(file instanceof File)) return null;
  const fingerprint=await sha256File(file);
  const lookup={companyId,bucket,category:category||null,workOrderId,purchaseId,fingerprint};
  const existing=await findAttachment(lookup);
  if(existing) return {...existing,url:await signed(existing.bucket,existing.path),deduplicated:true};

  const path=`${companyId}/${folder}/${crypto.randomUUID()}-${safe(file.name)}`;
  const up=await supabase.storage.from(bucket).upload(path,file,{contentType:file.type||undefined,upsert:false});
  if(up.error) throw up.error;
  const row={company_id:companyId,bucket,path,file_name:file.name,content_type:file.type||null,size_bytes:file.size||null,category:category||null,work_order_id:workOrderId||null,purchase_id:purchaseId||null,uploaded_by:userId||null,content_sha256:fingerprint};
  const ins=await supabase.from('attachments').insert(row).select().single();
  if(ins.error){
    await supabase.storage.from(bucket).remove([path]);
    if(ins.error.code==='23505'){
      const winner=await findAttachment(lookup);
      if(winner) return {...winner,url:await signed(winner.bucket,winner.path),deduplicated:true};
    }
    throw ins.error;
  }
  return {...ins.data,url:await signed(bucket,path),deduplicated:false};
}

export async function uploadFotosOSDB(osId,fotos,companyId,userId){
  const novos=(fotos||[]).filter(f=>f?.arquivo instanceof File);
  const enviados=[];
  for(const f of novos){
    if(!workOrderPhotoTypes.has(f.arquivo.type)) throw new Error('Formato de foto não permitido. Use JPG, PNG, WEBP ou HEIC.');
    const file=await comprimirImagemParaUpload(f.arquivo);
    if(file.size>15*1024*1024) throw new Error('Cada foto da OS pode ter no máximo 15 MB.');
    enviados.push(await uploadAttachment({file,companyId,bucket:'zt-work-orders',folder:`work-orders/${osId}`,category:f.categoria||'Foto',workOrderId:osId,userId}));
  }
  return enviados;
}

export async function uploadDocumentosCompraDB(purchaseId,anexos,companyId,userId){
  const novos=(anexos||[]).filter(a=>a?.arquivo instanceof File);
  const enviados=[];
  for(const a of novos){
    if(!purchaseDocTypes.has(a.arquivo.type)) throw new Error('Formato não permitido. Use PDF, JPG, PNG ou WEBP.');
    // Foto de nota/recibo: reduzida com resolução maior que a da OS, para continuar legível. PDF segue intacto.
    const file=await comprimirImagemParaUpload(a.arquivo,DOCUMENTO_IMAGEM_OPCOES);
    if(file.size>20*1024*1024) throw new Error('Cada documento pode ter no máximo 20 MB.');
    enviados.push(await uploadAttachment({file,companyId,bucket:'zt-documents',folder:`purchases/${purchaseId}`,category:'purchase_document',purchaseId,userId}));
  }
  return enviados;
}

export async function uploadLogoEmpresaDB(file,companyId){
  if(!(file instanceof File)) throw new Error('Selecione uma imagem.');
  if(!brandingTypes.has(file.type)) throw new Error('Formato de logo não permitido. Use JPG, PNG ou WEBP.');
  if(file.size>2*1024*1024) throw new Error('A logo pode ter no máximo 2 MB.');

  const atual=check(await supabase.from('companies').select('logo_path').eq('id',companyId).single());
  const ext=(file.name.split('.').pop()||'png').toLowerCase();
  const path=`${companyId}/branding/logo-${Date.now()}.${safe(ext)}`;
  const up=await supabase.storage.from('zt-branding').upload(path,file,{contentType:file.type||undefined,upsert:false});
  if(up.error) throw up.error;

  const saved=await supabase.from('companies').update({logo_path:path}).eq('id',companyId).select('id').single();
  if(saved.error){
    await supabase.storage.from('zt-branding').remove([path]);
    throw saved.error;
  }

  if(atual?.logo_path && atual.logo_path!==path && String(atual.logo_path).startsWith(`${companyId}/`)){
    await supabase.storage.from('zt-branding').remove([atual.logo_path]);
  }
  return {path,url:await signed('zt-branding',path)};
}

/* Checklist — nenhuma linha do banco some porque não chegou à tela.
 *
 * A tela só marca/desmarca e adiciona itens (não existe "remover item"). Então:
 * - item com id do banco: atualiza texto/feito SÓ daquela linha, daquela OS;
 * - item novo da tela: ganha um id estável (OS + id local) e é inserido com
 *   "ignore duplicates", então reenvio/timeout não duplica;
 * - linha do banco ausente da lista da tela fica como está: ausência NUNCA é exclusão;
 * - nada é casado por posição nem por texto (antes, um item novo podia sobrescrever
 *   um item oculto na mesma posição). */
const mapearItemChecklist=(c)=>({id:c.id,texto:c.text,feito:Boolean(c.done),obrigatorio:Boolean(c.required),templateId:c.source_template_id||null});

export async function uuidEstavel(...partes){
  const bytes=new TextEncoder().encode(partes.map(String).join(':'));
  const h=new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',bytes)).slice(0,16);
  h[6]=(h[6]&0x0f)|0x50; h[8]=(h[8]&0x3f)|0x80;
  const x=Array.from(h,b=>b.toString(16).padStart(2,'0')).join('');
  return `${x.slice(0,8)}-${x.slice(8,12)}-${x.slice(12,16)}-${x.slice(16,20)}-${x.slice(20,32)}`;
}

async function lerChecklistOS(osId){
  return check(await lerTodas(()=>supabase.from('work_order_checklists').select('*').eq('work_order_id',osId).order('position',{ascending:true}).order('id',{ascending:true})))||[];
}

async function persistirChecklist(os,checklist,companyId,userId){
  const incoming=Array.isArray(checklist)?checklist:[];
  const current=await lerChecklistOS(os.id);
  const porId=new Map(current.map(row=>[row.id,row]));
  let proximaPosicao=current.reduce((max,row)=>Math.max(max,Number(row.position)||0),-1)+1;
  const agora=()=>new Date().toISOString();
  for(let i=0;i<incoming.length;i++){
    const item=incoming[i]||{};
    const text=String(item.texto||'Item');
    const done=Boolean(item.feito);
    const id=isUuid(item.id)?item.id:await uuidEstavel('zt-checklist',os.id,item.id??`pos-${i}`);
    const row=porId.get(id);
    if(row){
      if(row.text===text&&Boolean(row.done)===done) continue;
      check(await supabase.from('work_order_checklists').update({text,done,updated_at:agora()}).eq('id',id).eq('work_order_id',os.id));
      continue;
    }
    // id do banco que não existe mais nesta OS: não ressuscita nem cria duplicata.
    if(isUuid(item.id)) continue;
    check(await supabase.from('work_order_checklists').upsert({
      id,work_order_id:os.id,company_id:companyId,text,done,position:proximaPosicao++,created_by:userId||null,
    },{onConflict:'id',ignoreDuplicates:true}));
  }
  return (await lerChecklistOS(os.id)).map(mapearItemChecklist);
}

/* Relato — nunca sobrescreve texto que a tela não mostrou e nunca perde o que foi digitado.
 * - Guarda, por OS, qual linha de relato a tela recebeu (ou criou).
 * - Só atualiza essa linha. Se o último relato do banco é outro (chegou depois do login,
 *   ou a tela não o carregou), o texto vira um relato novo e o anterior continua no banco.
 * - A policy só deixa o AUTOR editar o próprio relato, com a OS aberta. Antes, editar o
 *   relato de outra pessoa gravava 0 linhas sem erro e o texto sumia; agora vira relato novo.
 * - OS concluída/cancelada: o relato não é alterado e a tela recebe um aviso claro. */
const relatoConhecido=new Map();
const OS_FECHADA=new Set(['concluida','cancelada']);
function lembrarRelato(osId,row){ if(osId) relatoConhecido.set(osId,row?.id||null); }

async function persistirRelato(os,texto,companyId,userId){
  if(OS_FECHADA.has(os?.status)) throw new Error('Esta OS já foi encerrada: o relato não pode mais ser alterado por aqui.');
  const q=await supabase.from('work_order_reports').select('id').eq('work_order_id',os.id).eq('entry_type','report').order('created_at',{ascending:false}).order('id',{ascending:false}).limit(1).maybeSingle();
  if(q.error) throw q.error;
  const ultimo=q.data?.id||null;
  if(ultimo&&relatoConhecido.get(os.id)===ultimo){
    const atualizado=check(await supabase.from('work_order_reports').update({body:texto}).eq('id',ultimo).select('id'));
    if(Array.isArray(atualizado)&&atualizado.length) return;
    // 0 linhas: o relato é de outra pessoa (só o autor edita). Segue para gravar como relato novo.
  }
  if(!texto.trim()) return;
  const criado=check(await supabase.from('work_order_reports').insert({work_order_id:os.id,company_id:companyId,entry_type:'report',body:texto,author_id:userId||null}).select('id').single());
  lembrarRelato(os.id,criado);
}

async function persistirEdicaoOSDBNow(os,patch,companyId,userId,papel){
  // Um patch pode juntar várias edições (a tela agrupa o que mudou no intervalo do
  // salvamento): cada parte é gravada, nenhuma descarta a outra.
  const resultado={};
  if('checklist' in patch) resultado.checklist=await persistirChecklist(os,patch.checklist,companyId,userId);
  if('itens' in patch&&papel==='proprietario'){
    // salvarOSDB grava a linha inteira da OS (endereço, observações, pendência...) junto com os itens.
    const limpos=(os.itens||[]).filter(i=>!i.materialRegistrado);
    await salvarOSDB({...os,itens:limpos},companyId,userId);
  }else{
    const db={};
    if('local' in patch) db.address=patch.local||null;
    if('localServico' in patch) db.service_place=patch.localServico||null;
    if('descricaoLivre' in patch) db.request=patch.descricaoLivre||null;
    if('obs' in patch) db.pre_notes=patch.obs||null;
    if('relatoProblema' in patch) db.problem_report=patch.relatoProblema||null;
    if('pendencia' in patch) db.pending_note=patch.pendencia||null;
    if(Object.keys(db).length) await atualizarOSDB(os.id,db);
  }
  if('relato' in patch) await persistirRelato(os,String(patch.relato||''),companyId,userId);
  return resultado.checklist?resultado:null;
}

export function persistirEdicaoOSDB(os,patch,companyId,userId,papel){
  return enqueueOsWrite(os.id,()=>persistirEdicaoOSDBNow(os,patch,companyId,userId,papel));
}

export async function prepararFinalizacaoOSDB(os,extras,companyId,userId,papel){
  await uploadFotosOSDB(os.id,extras.fotos||[],companyId,userId);
  const baseIds=new Set((os.itens||[]).map(i=>i.id));
  const materiais=(extras.itens||[]).filter(i=>!baseIds.has(i.id) && !i.adicional && !i.isExtra).map(m=>{
    const politica=papel==='proprietario'?(m.garantiaPolitica||'catalog'):'catalog';
    return {
      product_id:isUuid(m.catalogoId)?m.catalogoId:null,
      name:m.nome||'Material',
      quantity:Number(m.qtd||1),
      unit_cost:papel==='proprietario'?Number(m.custo||0):0,
      serial_number:m.serie||null,
      warranty_policy:politica,
      warranty_override_months:papel==='proprietario'&&politica==='custom'?Math.max(1,Math.min(120,Number(m.garantiaMesesOverride||1))):null,
    };
  });
  const adicionais=(extras.adicionais||[]).map(a=>({
    name:a.nome||'Adicional',
    unit:a.unidade||'unidade',
    quantity:Number(a.qtd||1),
    unit_price:papel==='proprietario'?Number(a.preco||0):0,
    notes:a.obs||null,
  }));
  return {materiaisDB:materiais,adicionaisDB:adicionais};
}

/* FIELD WORKFLOW V1 · wave 3b · checklist and return hydration */

// Início do atendimento gravado pelo banco (0101). Sem a migration a coluna não existe: devolve null e a tela segue sem cronômetro.
export async function lerInicioAtendimentoDB(osId){
  try{
    const r=await supabase.from('work_orders').select('started_at').eq('id',osId).maybeSingle();
    return !r?.error&&r?.data?.started_at?String(r.data.started_at):null;
  }catch{return null;}
}

/* Junta, na OS que está na tela, os complementos relidos do banco sem desfazer o que o
   usuário já mudou localmente enquanto a leitura corria (itens adicionados, relato digitado). */
export function mesclarComplementosOS(atual,completa,{preservarRelato=false}={}){
  if(!atual||!completa||atual.id!==completa.id) return atual;
  const materiais=(completa.itens||[]).filter(i=>i.materialRegistrado);
  return {
    ...atual,
    complementosCarregados:true,
    iniciadaEm:completa.iniciadaEm??atual.iniciadaEm??null,
    relato:preservarRelato?atual.relato:completa.relato,
    historico:completa.historico,
    retornos:completa.retornos,
    checklist:completa.checklist,
    fotos:completa.fotos,
    itens:[...(atual.itens||[]).filter(i=>!i.materialRegistrado),...materiais],
  };
}
