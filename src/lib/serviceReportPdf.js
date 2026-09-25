import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { supabase } from './supabase';

const A4=[595.28,841.89];
const MARGIN=42;
const MAX_REPORT_PHOTOS=6;

const clean=(value='')=>String(value??'')
  .replace(/[\u2018\u2019]/g,"'")
  .replace(/[\u201C\u201D]/g,'"')
  .replace(/[\u2013\u2014]/g,'-')
  .replace(/[\u2022]/g,'-')
  .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g,'?');

const money=(value)=>`R$ ${Number(value||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const date=(value)=>{
  if(!value) return '—';
  const raw=String(value);
  const only=raw.slice(0,10);
  const [y,m,d]=only.split('-');
  return y&&m&&d?`${d}/${m}/${y}`:clean(raw);
};
const dateTime=(value)=>{
  if(!value) return '—';
  try{return new Date(value).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'});}catch{return clean(value);}
};
const safeName=(value)=>clean(value||'relatorio-atendimento').replace(/[^A-Za-z0-9._-]+/g,'-').replace(/-+/g,'-').slice(0,90)||'relatorio-atendimento';
const paymentLabel=(value)=>({pix:'Pix',cash:'Dinheiro',card:'Cartão',transfer:'Transferência',other:'Outro'}[String(value||'').toLowerCase()]||clean(value||''));

function wrap(text,font,size,width){
  const lines=[];
  for(const paragraph of clean(text).split(/\r?\n/)){
    const words=paragraph.split(/\s+/).filter(Boolean);
    if(!words.length){lines.push('');continue;}
    let line='';
    for(const word of words){
      const candidate=line?`${line} ${word}`:word;
      if(font.widthOfTextAtSize(candidate,size)<=width) line=candidate;
      else{
        if(line) lines.push(line);
        if(font.widthOfTextAtSize(word,size)<=width){line=word;continue;}
        let chunk='';
        for(const char of word){
          const next=chunk+char;
          if(font.widthOfTextAtSize(next,size)<=width) chunk=next;
          else{if(chunk) lines.push(chunk);chunk=char;}
        }
        line=chunk;
      }
    }
    if(line) lines.push(line);
  }
  return lines;
}

async function signedUrl(bucket,path){
  if(!bucket||!path) return null;
  const r=await supabase.storage.from(bucket).createSignedUrl(path,900);
  return r.error?null:r.data?.signedUrl||null;
}

const canvasBlob=(canvas,type='image/jpeg',quality=.8)=>new Promise((resolve,reject)=>{
  canvas.toBlob((blob)=>blob?resolve(blob):reject(new Error('Falha ao preparar imagem.')),type,quality);
});

async function rasterizeBlob(blob,maxSide=1400){
  if(typeof document!=='undefined'&&typeof createImageBitmap==='function'){
    try{
      const image=await createImageBitmap(blob);
      const scale=Math.min(1,maxSide/Math.max(image.width,image.height));
      const width=Math.max(1,Math.round(image.width*scale));
      const height=Math.max(1,Math.round(image.height*scale));
      const canvas=document.createElement('canvas');
      canvas.width=width;canvas.height=height;
      const ctx=canvas.getContext('2d');
      if(!ctx) throw new Error('Canvas indisponível.');
      ctx.drawImage(image,0,0,width,height);
      if(typeof image.close==='function') image.close();
      const out=await canvasBlob(canvas,'image/jpeg',.78);
      return {bytes:new Uint8Array(await out.arrayBuffer()),type:'image/jpeg'};
    }catch{/* tenta formato original abaixo */}
  }
  if(blob.type==='image/jpeg'||blob.type==='image/jpg'||blob.type==='image/png'){
    return {bytes:new Uint8Array(await blob.arrayBuffer()),type:blob.type};
  }
  return null;
}

async function loadStorageImage(bucket,path,maxSide){
  const url=await signedUrl(bucket,path);
  if(!url) return null;
  try{
    const response=await fetch(url,{cache:'no-store'});
    if(!response.ok) return null;
    const blob=await response.blob();
    if(blob.size>20*1024*1024) return null;
    return rasterizeBlob(blob,maxSide);
  }catch{return null;}
}

async function embedImage(pdf,image){
  if(!image?.bytes) return null;
  try{
    return String(image.type).includes('png')?await pdf.embedPng(image.bytes):await pdf.embedJpg(image.bytes);
  }catch{return null;}
}

export async function montarRelatorioAtendimentoPDF(report){
  const snapshot=report?.snapshot||{};
  if(!snapshot?.work_order?.id) throw new Error('Relatório de Atendimento inválido.');

  const pdf=await PDFDocument.create();
  const regular=await pdf.embedFont(StandardFonts.Helvetica);
  const bold=await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink=rgb(.06,.11,.18);
  const muted=rgb(.36,.42,.49);
  const line=rgb(.86,.89,.92);
  const accent=rgb(.03,.48,.45);
  const soft=rgb(.95,.98,.98);

  let page;
  let y;
  const newPage=()=>{page=pdf.addPage(A4);y=A4[1]-MARGIN;return page;};
  newPage();

  const ensure=(height=24)=>{if(y-height<70)newPage();};
  const divider=()=>{ensure(16);page.drawLine({start:{x:MARGIN,y},end:{x:A4[0]-MARGIN,y},thickness:.7,color:line});y-=16;};
  const text=(value,{size=9,font=regular,color=ink,x=MARGIN,width=A4[0]-MARGIN*2,lineHeight=size+3}={})=>{
    const lines=wrap(value||'—',font,size,width);
    for(const item of lines){ensure(lineHeight+2);page.drawText(item||' ',{x,y,size,font,color});y-=lineHeight;}
    return lines.length;
  };
  const heading=(value)=>{ensure(30);page.drawText(clean(value),{x:MARGIN,y,size:10,font:bold,color:accent});y-=17;};
  const labelValue=(label,value)=>{
    if(value==null||String(value).trim()==='') return;
    ensure(18);
    page.drawText(clean(label.toUpperCase()),{x:MARGIN,y,size:7.5,font:bold,color:muted});
    const labelWidth=Math.min(135,bold.widthOfTextAtSize(clean(label.toUpperCase()),7.5)+12);
    const lines=wrap(value,regular,9,A4[0]-MARGIN*2-labelWidth);
    let first=true;
    for(const item of lines){
      if(!first){ensure(12);y-=1;}
      page.drawText(item||' ',{x:MARGIN+labelWidth,y,size:9,font:regular,color:ink});
      y-=12;first=false;
    }
  };

  const company=snapshot.company||{};
  const client=snapshot.client||{};
  const location=snapshot.location||{};
  const wo=snapshot.work_order||{};
  const technician=snapshot.technician||{};
  const payment=snapshot.payment||{};

  let logo=null;
  if(company.logo_path) logo=await embedImage(pdf,await loadStorageImage('zt-branding',company.logo_path,700));
  if(logo){
    const dims=logo.scale(1);
    const scale=Math.min(82/dims.width,42/dims.height,1);
    page.drawImage(logo,{x:MARGIN,y:y-38,width:dims.width*scale,height:dims.height*scale});
  }
  const headerX=MARGIN+(logo?100:0);
  page.drawText(clean(company.trade_name||company.name||'Empresa'),{x:headerX,y:y-3,size:14,font:bold,color:ink});
  page.drawText('RELATÓRIO DE ATENDIMENTO',{x:A4[0]-MARGIN-bold.widthOfTextAtSize('RELATÓRIO DE ATENDIMENTO',13),y:y-3,size:13,font:bold,color:ink});
  y-=19;
  if(company.tax_id) page.drawText(clean(`CNPJ/CPF: ${company.tax_id}`),{x:headerX,y,size:8.5,font:regular,color:muted});
  page.drawText(clean(`OS ${wo.number||'—'}`),{x:A4[0]-MARGIN-bold.widthOfTextAtSize(clean(`OS ${wo.number||'—'}`),9),y,size:9,font:bold,color:accent});
  y-=12;
  const companyContact=[company.phone,company.email].filter(Boolean).join(' · ');
  if(companyContact){page.drawText(clean(companyContact),{x:headerX,y,size:8.5,font:regular,color:muted});y-=11;}
  if(company.address){text(company.address,{x:headerX,size:8,width:A4[0]-MARGIN-headerX-150,color:muted,lineHeight:10});}
  y-=5;divider();

  page.drawRectangle({x:MARGIN,y:y-27,width:A4[0]-MARGIN*2,height:32,color:soft});
  page.drawText('REGISTRO OPERACIONAL DO ATENDIMENTO',{x:MARGIN+10,y:y-8,size:8.5,font:bold,color:accent});
  page.drawText('Snapshot gerado na conclusão da ordem de serviço; sem finalidade fiscal.',{x:MARGIN+10,y:y-20,size:8,font:regular,color:muted});
  y-=42;

  heading('CLIENTE E LOCAL');
  labelValue('Cliente',client.trade_name||client.name||'—');
  labelValue('CPF/CNPJ',client.tax_id);
  labelValue('Responsável',client.contact_name);
  labelValue('Contato',[client.phone,client.whatsapp].filter(Boolean).join(' · '));
  labelValue('Condomínio / unidade / local',location.service_place);
  labelValue('Endereço do atendimento',location.address||location.client_address||client.address);
  divider();

  heading('ATENDIMENTO');
  labelValue('Data / hora',dateTime(wo.completed_at||snapshot.finalized_at||report?.finalized_at));
  labelValue('Técnico',[technician.name,technician.job_title].filter(Boolean).join(' · ')||'Não informado');
  labelValue('Descrição',wo.request);
  labelValue('Observações iniciais',wo.pre_notes);
  labelValue('Problema relatado',wo.problem_report);
  labelValue('Pendência',wo.pending_note);
  divider();

  heading('RELATO TÉCNICO');
  text(snapshot.technical_report?.body||'Nenhum relato técnico informado no momento da conclusão.',{size:9.5,lineHeight:13});
  divider();

  const items=Array.isArray(snapshot.items)?snapshot.items:[];
  heading('PRODUTOS / SERVIÇOS');
  if(!items.length) text('Nenhum item cobrável registrado.',{color:muted});
  for(const item of items){
    ensure(34);
    const qty=`${Number(item.quantity||0).toLocaleString('pt-BR')} ${item.unit||'un'}`;
    page.drawText(clean(item.name||'Item'),{x:MARGIN,y,size:9.5,font:bold,color:ink});
    page.drawText(clean(qty),{x:A4[0]-MARGIN-150,y,size:8.5,font:regular,color:muted});
    if(payment.show_values&&!item.price_pending){
      const total=Number(item.quantity||0)*Number(item.unit_price||0);
      const value=money(total);
      page.drawText(value,{x:A4[0]-MARGIN-regular.widthOfTextAtSize(value,9),y,size:9,font:regular,color:ink});
    }else if(item.price_pending){
      const pending='Valor pendente';
      page.drawText(pending,{x:A4[0]-MARGIN-regular.widthOfTextAtSize(pending,8),y,size:8,font:regular,color:muted});
    }
    y-=12;
    if(item.notes) text(item.notes,{x:MARGIN+10,size:8,color:muted,width:A4[0]-MARGIN*2-10,lineHeight:10});
    y-=3;
  }
  divider();

  const materials=Array.isArray(snapshot.materials)?snapshot.materials:[];
  heading('MATERIAIS UTILIZADOS');
  if(!materials.length) text('Nenhum material operacional registrado.',{color:muted});
  for(const item of materials){
    ensure(22);
    const detail=[`Qtd. ${Number(item.quantity||0).toLocaleString('pt-BR')}`,item.serial_number?`S/N ${item.serial_number}`:''].filter(Boolean).join(' · ');
    text(item.name||'Material',{size:9.5,font:bold,lineHeight:11});
    if(detail) text(detail,{size:8,color:muted,lineHeight:10});
    y-=3;
  }
  divider();

  const warranties=Array.isArray(snapshot.warranties)?snapshot.warranties:[];
  heading('GARANTIAS REGISTRADAS');
  if(!warranties.length) text('Nenhuma garantia vinculada a esta conclusão.',{color:muted});
  for(const warranty of warranties){
    ensure(28);
    text(warranty.description||'Garantia',{size:9.5,font:bold,lineHeight:11});
    text(`${warranty.kind==='product'?'Produto':'Serviço'} · ${date(warranty.starts_on)} a ${date(warranty.ends_on)}${warranty.serial_number?` · S/N ${warranty.serial_number}`:''}`,{size:8,color:muted,lineHeight:10});
    y-=3;
  }
  divider();

  heading('SITUAÇÃO DO ATENDIMENTO');
  labelValue('Pagamento',payment.status_label||'Não informado');
  if(payment.payment_method) labelValue('Forma',paymentLabel(payment.payment_method));
  if(payment.show_values&&payment.billable_total!=null) labelValue('Valor exibível',money(payment.billable_total));
  if(wo.needs_return) labelValue('Retorno','Atendimento marcado como precisa retornar');
  divider();

  const evidences=(Array.isArray(snapshot.evidence)?snapshot.evidence:[]).filter(x=>x.media_kind==='photo').slice(0,MAX_REPORT_PHOTOS);
  heading('EVIDÊNCIAS SELECIONADAS');
  if(!evidences.length) text('Nenhuma foto foi selecionada para este relatório.',{color:muted});
  for(let i=0;i<evidences.length;i++){
    const evidence=evidences[i];
    const prepared=await loadStorageImage(evidence.bucket,evidence.path,1200);
    const image=await embedImage(pdf,prepared);
    ensure(image?250:40);
    text(`${i+1}. ${evidence.category||evidence.media_stage||'Evidência'}${evidence.caption?` · ${evidence.caption}`:''}`,{size:8.5,font:bold,lineHeight:11});
    if(image){
      const dims=image.scale(1);
      const maxW=A4[0]-MARGIN*2;
      const maxH=225;
      const scale=Math.min(maxW/dims.width,maxH/dims.height,1);
      const width=dims.width*scale;
      const height=dims.height*scale;
      ensure(height+12);
      page.drawImage(image,{x:MARGIN+(maxW-width)/2,y:y-height,width,height});
      y-=height+14;
    }else{
      text(`Arquivo: ${evidence.file_name||'imagem'} (pré-visualização indisponível neste aparelho)`,{size:8,color:muted,lineHeight:10});
      y-=5;
    }
  }

  for(const p of pdf.getPages()){
    const idx=pdf.getPages().indexOf(p)+1;
    p.drawLine({start:{x:MARGIN,y:58},end:{x:A4[0]-MARGIN,y:58},thickness:.6,color:line});
    p.drawText('Relatório operacional gerado pela ZiisTec a partir do snapshot da conclusão da OS.',{x:MARGIN,y:42,size:7.5,font:regular,color:muted});
    const pageLabel=`Página ${idx}/${pdf.getPageCount()}`;
    p.drawText(pageLabel,{x:A4[0]-MARGIN-regular.widthOfTextAtSize(pageLabel,7.5),y:42,size:7.5,font:regular,color:muted});
  }

  return pdf.save();
}

export async function baixarRelatorioAtendimentoPDF(report){
  const bytes=await montarRelatorioAtendimentoPDF(report);
  const blob=new Blob([bytes],{type:'application/pdf'});
  const url=URL.createObjectURL(blob);
  const number=report?.snapshot?.work_order?.number||'OS';
  const a=document.createElement('a');
  a.href=url;
  a.download=`${safeName(`Relatorio-Atendimento-${number}`)}.pdf`;
  a.rel='noopener';
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
  return true;
}

export function suportaCompartilharRelatorioAtendimento(){
  return typeof navigator!=='undefined'&&typeof navigator.share==='function'&&typeof navigator.canShare==='function'&&typeof File!=='undefined';
}

export async function compartilharRelatorioAtendimentoPDF(report){
  if(!suportaCompartilharRelatorioAtendimento()) return {shared:false,unsupported:true};
  const bytes=await montarRelatorioAtendimentoPDF(report);
  const number=report?.snapshot?.work_order?.number||'OS';
  const file=new File([bytes],`${safeName(`Relatorio-Atendimento-${number}`)}.pdf`,{type:'application/pdf'});
  if(!navigator.canShare({files:[file]})) return {shared:false,unsupported:true};
  try{
    await navigator.share({title:'Relatório de Atendimento',text:`Relatório de Atendimento · ${number}`,files:[file]});
    return {shared:true};
  }catch(error){
    if(error?.name==='AbortError') return {shared:false,cancelled:true};
    throw error;
  }
}
