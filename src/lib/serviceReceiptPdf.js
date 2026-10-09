import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import {
  A4, MARGIN, clean, wrap, money, date, dateTime, safeName, paymentLabel, loadStorageImage, embedImage,
} from './serviceReportPdf';

// Comprovante de Serviço: documento não fiscal gerado sempre a partir do snapshot congelado da
// emissão (0097). O PDF não é armazenado; reemitir cria nova versão no banco.
export const AVISO_NAO_FISCAL='Documento não fiscal';

const numeroComprovante=(receipt)=>{
  const doc=receipt?.snapshot?.document||{};
  const number=doc.number||receipt?.number||'CS';
  const version=Number(doc.version||receipt?.version||1);
  return version>1?`${number} v${version}`:number;
};

export async function montarComprovanteServicoPDF(receipt){
  const snapshot=receipt?.snapshot||{};
  if(snapshot?.document?.kind!=='service_receipt'||!snapshot?.work_order?.id) throw new Error('Comprovante de Serviço inválido.');

  const pdf=await PDFDocument.create();
  const regular=await pdf.embedFont(StandardFonts.Helvetica);
  const bold=await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink=rgb(.06,.11,.18);
  const muted=rgb(.36,.42,.49);
  const line=rgb(.86,.89,.92);
  const accent=rgb(.03,.48,.45);
  const soft=rgb(.95,.98,.98);
  const width=A4[0]-MARGIN*2;

  let page;
  let y;
  const newPage=()=>{page=pdf.addPage(A4);y=A4[1]-MARGIN;return page;};
  newPage();

  const ensure=(height=24)=>{if(y-height<70)newPage();};
  const divider=()=>{ensure(16);page.drawLine({start:{x:MARGIN,y},end:{x:A4[0]-MARGIN,y},thickness:.7,color:line});y-=16;};
  const text=(value,{size=9,font=regular,color=ink,x=MARGIN,w=width,lineHeight=size+3}={})=>{
    for(const item of wrap(value||'—',font,size,w)){ensure(lineHeight+2);page.drawText(item||' ',{x,y,size,font,color});y-=lineHeight;}
  };
  const heading=(value)=>{ensure(30);page.drawText(clean(value),{x:MARGIN,y,size:10,font:bold,color:accent});y-=17;};
  const labelValue=(label,value)=>{
    if(value==null||String(value).trim()==='') return;
    ensure(18);
    const tag=clean(label.toUpperCase());
    page.drawText(tag,{x:MARGIN,y,size:7.5,font:bold,color:muted});
    const labelWidth=Math.min(135,bold.widthOfTextAtSize(tag,7.5)+12);
    let first=true;
    for(const item of wrap(value,regular,9,width-labelWidth)){
      if(!first){ensure(12);y-=1;}
      page.drawText(item||' ',{x:MARGIN+labelWidth,y,size:9,font:regular,color:ink});
      y-=12;first=false;
    }
  };
  const amountRow=(label,value,{strong=false}={})=>{
    ensure(16);
    const font=strong?bold:regular;
    const size=strong?11:9.5;
    page.drawText(clean(label),{x:A4[0]-MARGIN-230,y,size,font,color:strong?ink:muted});
    const shown=clean(value);
    page.drawText(shown,{x:A4[0]-MARGIN-font.widthOfTextAtSize(shown,size),y,size,font,color:ink});
    y-=strong?17:14;
  };

  const doc=snapshot.document||{};
  const company=snapshot.company||{};
  const client=snapshot.client||{};
  const location=snapshot.location||{};
  const wo=snapshot.work_order||{};
  const technician=snapshot.technician||{};
  const financial=snapshot.financial||{};
  const numero=numeroComprovante(receipt);

  let logo=null;
  if(company.logo_path) logo=await embedImage(pdf,await loadStorageImage('zt-branding',company.logo_path,700));
  if(logo){
    const dims=logo.scale(1);
    const scale=Math.min(82/dims.width,42/dims.height,1);
    page.drawImage(logo,{x:MARGIN,y:y-38,width:dims.width*scale,height:dims.height*scale});
  }
  const headerX=MARGIN+(logo?100:0);
  page.drawText(clean(company.trade_name||company.name||'Empresa'),{x:headerX,y:y-3,size:14,font:bold,color:ink});
  page.drawText('COMPROVANTE DE SERVIÇO',{x:A4[0]-MARGIN-bold.widthOfTextAtSize('COMPROVANTE DE SERVIÇO',13),y:y-3,size:13,font:bold,color:ink});
  y-=19;
  if(company.tax_id) page.drawText(clean(`CNPJ/CPF: ${company.tax_id}`),{x:headerX,y,size:8.5,font:regular,color:muted});
  const numeroLabel=clean(`Nº ${numero}`);
  page.drawText(numeroLabel,{x:A4[0]-MARGIN-bold.widthOfTextAtSize(numeroLabel,10),y,size:10,font:bold,color:accent});
  y-=12;
  const companyContact=[company.phone,company.email].filter(Boolean).join(' · ');
  if(companyContact){page.drawText(clean(companyContact),{x:headerX,y,size:8.5,font:regular,color:muted});y-=11;}
  if(company.address) text(company.address,{x:headerX,size:8,w:A4[0]-MARGIN-headerX-150,color:muted,lineHeight:10});
  y-=5;divider();

  page.drawRectangle({x:MARGIN,y:y-27,width,height:32,color:soft});
  page.drawText(clean(AVISO_NAO_FISCAL.toUpperCase()),{x:MARGIN+10,y:y-8,size:8.5,font:bold,color:accent});
  page.drawText('Comprova o serviço executado e a situação financeira na data de emissão.',{x:MARGIN+10,y:y-20,size:8,font:regular,color:muted});
  y-=42;

  heading('EMISSÃO');
  labelValue('Emitido em',dateTime(doc.issued_at||receipt?.issued_at));
  labelValue('Emitido por',doc.issued_by?.name);
  if(Number(doc.version||1)>1) labelValue('Reemissão',`Versão ${doc.version} · ${doc.reissue_reason||'motivo não informado'}`);
  divider();

  heading('CLIENTE E LOCAL');
  labelValue('Cliente',client.trade_name||client.name||'—');
  labelValue('CPF/CNPJ',client.tax_id);
  labelValue('Contato',[client.phone,client.whatsapp].filter(Boolean).join(' · '));
  labelValue('Local',location.service_place);
  labelValue('Endereço',location.address||location.client_address||client.address);
  divider();

  heading('SERVIÇO EXECUTADO');
  labelValue('Ordem de serviço',wo.number);
  labelValue('Concluído em',dateTime(wo.completed_at||snapshot.finalized_at));
  labelValue('Técnico',[technician.name,technician.job_title].filter(Boolean).join(' · ')||'Não informado');
  labelValue('Descrição',wo.request);
  if(snapshot.technical_report?.body){
    ensure(30);
    page.drawText('RELATO TÉCNICO',{x:MARGIN,y,size:7.5,font:bold,color:muted});y-=12;
    text(snapshot.technical_report.body,{size:9,lineHeight:12});
  }
  divider();

  const items=Array.isArray(snapshot.items)?snapshot.items:[];
  heading('ITENS');
  if(!items.length) text('Nenhum item registrado.',{color:muted});
  for(const item of items){
    ensure(30);
    const qty=`${Number(item.quantity||0).toLocaleString('pt-BR')} ${item.unit||'un'} × ${money(item.unit_price)}`;
    const total=money(Number(item.quantity||0)*Number(item.unit_price||0));
    text(item.name||'Item',{size:9.5,font:bold,w:width-120,lineHeight:12});
    page.drawText(clean(qty),{x:MARGIN,y,size:8,font:regular,color:muted});
    page.drawText(total,{x:A4[0]-MARGIN-regular.widthOfTextAtSize(total,9),y,size:9,font:regular,color:ink});
    y-=15;
  }
  y-=2;
  amountRow('Subtotal',money(financial.subtotal));
  if(Number(financial.discount||0)>0) amountRow('Desconto',`- ${money(financial.discount)}`);
  if(Number(financial.surcharge||0)>0) amountRow('Acréscimo',`+ ${money(financial.surcharge)}`);
  amountRow('Total',money(financial.total),{strong:true});
  divider();

  heading('PAGAMENTO');
  labelValue('Situação',financial.status_label||'Não informado');
  if(financial.payment_method) labelValue('Forma',paymentLabel(financial.payment_method));
  if(financial.status==='paid'&&financial.paid_at) labelValue('Pago em',date(financial.paid_at));
  if(financial.status==='receivable'&&financial.due_date) labelValue('Vencimento',date(financial.due_date));
  divider();

  const warranties=Array.isArray(snapshot.warranties)?snapshot.warranties:[];
  if(warranties.length){
    heading('GARANTIAS');
    for(const warranty of warranties){
      ensure(28);
      text(warranty.description||'Garantia',{size:9.5,font:bold,lineHeight:11});
      text(`${warranty.kind==='product'?'Produto':'Serviço'} · ${date(warranty.starts_on)} a ${date(warranty.ends_on)}${warranty.serial_number?` · S/N ${warranty.serial_number}`:''}`,{size:8,color:muted,lineHeight:10});
      y-=3;
    }
    divider();
  }

  if(snapshot.notes){
    heading('OBSERVAÇÕES');
    text(snapshot.notes,{size:9,lineHeight:12});
    divider();
  }

  for(const p of pdf.getPages()){
    const idx=pdf.getPages().indexOf(p)+1;
    p.drawLine({start:{x:MARGIN,y:58},end:{x:A4[0]-MARGIN,y:58},thickness:.6,color:line});
    p.drawText(clean(`${AVISO_NAO_FISCAL} · Comprovante ${numero} gerado pela ZiisTec a partir da OS ${wo.number||''}.`),{x:MARGIN,y:42,size:7.5,font:regular,color:muted});
    const pageLabel=`Página ${idx}/${pdf.getPageCount()}`;
    p.drawText(pageLabel,{x:A4[0]-MARGIN-regular.widthOfTextAtSize(pageLabel,7.5),y:42,size:7.5,font:regular,color:muted});
  }

  return pdf.save();
}

const nomeArquivo=(receipt)=>`${safeName(`Comprovante-Servico-${numeroComprovante(receipt)}`)}.pdf`;

export async function baixarComprovanteServicoPDF(receipt){
  const bytes=await montarComprovanteServicoPDF(receipt);
  const url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));
  const a=document.createElement('a');
  a.href=url;
  a.download=nomeArquivo(receipt);
  a.rel='noopener';
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
  return true;
}

export async function compartilharComprovanteServicoPDF(receipt){
  if(typeof navigator==='undefined'||typeof navigator.share!=='function'||typeof navigator.canShare!=='function'||typeof File==='undefined'){
    return {shared:false,unsupported:true};
  }
  const bytes=await montarComprovanteServicoPDF(receipt);
  const file=new File([bytes],nomeArquivo(receipt),{type:'application/pdf'});
  if(!navigator.canShare({files:[file]})) return {shared:false,unsupported:true};
  try{
    await navigator.share({title:'Comprovante de Serviço',text:`Comprovante de Serviço ${numeroComprovante(receipt)}`,files:[file]});
    return {shared:true};
  }catch(error){
    if(error?.name==='AbortError') return {shared:false,cancelled:true};
    throw error;
  }
}

// Texto curto para WhatsApp quando o aparelho não compartilha arquivo: o PDF é baixado e anexado pelo usuário.
export function mensagemWhatsAppComprovante(receipt){
  const s=receipt?.snapshot||{};
  const cliente=s.client?.trade_name||s.client?.name||'';
  return [
    `Olá${cliente?`, ${cliente}`:''}! Segue o Comprovante de Serviço ${numeroComprovante(receipt)} referente à OS ${s.work_order?.number||''}.`,
    `Total: ${money(s.financial?.total)} · ${s.financial?.status_label||'Situação não informada'}.`,
    `${AVISO_NAO_FISCAL}.`,
  ].join('\n');
}

export function linkWhatsAppComprovante(receipt,telefone=''){
  const digits=String(telefone||'').replace(/\D/g,'');
  const destino=digits?(digits.length<=11?`55${digits}`:digits):'';
  return `https://wa.me/${destino}?text=${encodeURIComponent(mensagemWhatsAppComprovante(receipt))}`;
}
