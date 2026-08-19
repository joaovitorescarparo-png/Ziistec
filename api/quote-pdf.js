import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://diztevlpbcfqleizswxr.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_SGA5FVYLYicO1piUDRb-Rw_wNSxgqyw';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const commonHeaders = {
  'Cache-Control': 'private, no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

const clean = (v='') => String(v ?? '')
  .replace(/[\u2018\u2019]/g,"'")
  .replace(/[\u201C\u201D]/g,'"')
  .replace(/[\u2022]/g,'-')
  .replace(/[\u2013\u2014]/g,'-')
  .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g,'?');
const money = (n) => `R$ ${Number(n||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const dateBR = (s) => s ? String(s).split('-').reverse().join('/') : '-';
const safeFile = (s) => clean(s).replace(/[^A-Za-z0-9._-]+/g,'-').replace(/-+/g,'-').slice(0,80) || 'orcamento';

async function sbFetch(path, auth, init={}) {
  const headers = { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: auth, ...(init.headers||{}) };
  const r = await fetch(`${SUPABASE_URL}${path}`, { ...init, headers });
  if (!r.ok) {
    const detail = await r.text().catch(()=> '');
    const e = new Error(detail || `Supabase ${r.status}`); e.status=r.status; throw e;
  }
  return r;
}
async function sbJson(path, auth) { return (await sbFetch(path,auth)).json(); }

function wrapText(text, font, size, maxWidth) {
  const paragraphs=clean(text).split(/\r?\n/); const out=[];
  for (const p of paragraphs) {
    const words=p.split(/\s+/).filter(Boolean); let line='';
    if(!words.length){out.push('');continue;}
    for(const w of words){ const test=line?`${line} ${w}`:w; if(font.widthOfTextAtSize(test,size)<=maxWidth){line=test;} else {if(line)out.push(line); line=w;} }
    if(line)out.push(line);
  }
  return out;
}

export default async function handler(req,res){
  Object.entries(commonHeaders).forEach(([k,v])=>res.setHeader(k,v));
  if(req.method!=='POST') return res.status(405).json({error:'Método não permitido.'});
  if(!String(req.headers['content-type']||'').toLowerCase().includes('application/json')) return res.status(415).json({error:'Conteúdo inválido.'});
  const auth=req.headers.authorization||'';
  if(!auth.startsWith('Bearer ')) return res.status(401).json({error:'Sessão necessária.'});
  const quoteId=String(req.body?.quoteId||''); const companyId=String(req.body?.companyId||'');
  if(!UUID_RE.test(quoteId)||!UUID_RE.test(companyId)) return res.status(400).json({error:'Orçamento ou empresa inválidos.'});

  try {
    await sbFetch('/auth/v1/user',auth);
    const ownerResp=await sbFetch('/rest/v1/rpc/zt_is_owner',auth,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({target:companyId})});
    const isOwner=await ownerResp.json();
    if(isOwner!==true) return res.status(403).json({error:'Somente o proprietário pode gerar este PDF.'});

    const [companies,quotes,items]=await Promise.all([
      sbJson(`/rest/v1/companies?id=eq.${companyId}&select=id,name,trade_name,tax_id,phone,whatsapp,email,address,logo_path,owner_name`,auth),
      sbJson(`/rest/v1/quotes?id=eq.${quoteId}&company_id=eq.${companyId}&select=*`,auth),
      sbJson(`/rest/v1/quote_items?quote_id=eq.${quoteId}&company_id=eq.${companyId}&select=id,name,unit,quantity,unit_price,notes,position&order=position.asc`,auth),
    ]);
    const company=companies?.[0], quote=quotes?.[0];
    if(!company||!quote) return res.status(404).json({error:'Orçamento não encontrado.'});
    const clients=quote.client_id?await sbJson(`/rest/v1/clients?id=eq.${quote.client_id}&company_id=eq.${companyId}&select=id,name,trade_name,tax_id,contact_name,phone,whatsapp,address`,auth):[];
    const client=clients?.[0]||{};

    const pdf=await PDFDocument.create();
    pdf.setTitle(`Orçamento ${quote.number}`); pdf.setAuthor(company.trade_name||company.name||'ZiisTec');
    pdf.setSubject('Orçamento comercial'); pdf.setCreator('ZiisTec');
    const normal=await pdf.embedFont(StandardFonts.Helvetica); const bold=await pdf.embedFont(StandardFonts.HelveticaBold);
    const A4=[595.28,841.89], margin=42, width=A4[0]-margin*2;
    let page=pdf.addPage(A4), y=A4[1]-44;
    const teal=rgb(0.04,0.45,0.42), dark=rgb(0.08,0.12,0.16), muted=rgb(0.36,0.40,0.44), light=rgb(0.94,0.96,0.96);
    const addPage=()=>{page=pdf.addPage(A4); y=A4[1]-44;};
    const ensure=(h)=>{if(y-h<50)addPage();};
    const text=(t,x,yy,size=10,font=normal,color=dark)=>page.drawText(clean(t),{x,y:yy,size,font,color});
    const wrapped=(t,x,maxW,size=10,font=normal,color=dark,lineH=14)=>{const lines=wrapText(t,font,size,maxW); ensure(lines.length*lineH+4); for(const line of lines){text(line,x,y,size,font,color);y-=lineH;} return lines.length;};

    if(company.logo_path){
      try{
        const encoded=String(company.logo_path).split('/').map(encodeURIComponent).join('/');
        const logoResp=await sbFetch(`/storage/v1/object/authenticated/zt-branding/${encoded}`,auth);
        const bytes=new Uint8Array(await logoResp.arrayBuffer()); const ct=logoResp.headers.get('content-type')||'';
        let img=null; if(ct.includes('png')) img=await pdf.embedPng(bytes); else if(ct.includes('jpeg')||ct.includes('jpg')) img=await pdf.embedJpg(bytes);
        if(img){const scale=Math.min(110/img.width,48/img.height,1); page.drawImage(img,{x:margin,y:y-38,width:img.width*scale,height:img.height*scale});}
      }catch{}
    }
    text(company.trade_name||company.name||'Empresa',margin+125,y-4,18,bold,dark);
    text('ORÇAMENTO',A4[0]-margin-120,y-4,13,bold,teal);
    y-=24; text(`Nº ${quote.number}`,A4[0]-margin-120,y,10,bold,dark);
    text(`Emissão: ${dateBR(quote.issue_date)}`,A4[0]-margin-120,y-15,9,normal,muted);
    if(quote.valid_until) text(`Validade: ${dateBR(quote.valid_until)}`,A4[0]-margin-120,y-29,9,normal,muted);
    const compInfo=[company.tax_id&&`CNPJ/CPF: ${company.tax_id}`,company.phone&&`Tel.: ${company.phone}`,company.whatsapp&&`WhatsApp: ${company.whatsapp}`,company.email,company.address].filter(Boolean).join('  |  ');
    y-=22; wrapped(compInfo,margin,width-145,8.5,normal,muted,12); y-=10;
    page.drawLine({start:{x:margin,y},end:{x:A4[0]-margin,y},thickness:1,color:teal}); y-=22;

    text('CLIENTE',margin,y,9,bold,teal); y-=15;
    wrapped(client.trade_name||client.name||'Cliente não informado',margin,width,12,bold,dark,15);
    const clientInfo=[client.tax_id&&`Documento: ${client.tax_id}`,client.contact_name&&`Contato: ${client.contact_name}`,client.phone&&`Tel.: ${client.phone}`,client.whatsapp&&`WhatsApp: ${client.whatsapp}`,client.address].filter(Boolean).join('  |  ');
    if(clientInfo) wrapped(clientInfo,margin,width,8.5,normal,muted,12);
    if(quote.service_place||quote.address){const loc=[quote.service_place&&`Local: ${quote.service_place}`,quote.address].filter(Boolean).join(' - ');wrapped(loc,margin,width,8.5,normal,muted,12);} y-=12;

    ensure(40); page.drawRectangle({x:margin,y:y-18,width,height:22,color:light});
    text('Descrição',margin+6,y-12,8,bold,dark); text('Qtd.',margin+315,y-12,8,bold,dark); text('Unitário',margin+365,y-12,8,bold,dark); text('Total',margin+445,y-12,8,bold,dark); y-=30;
    let subtotal=0;
    for(const item of items||[]){
      const qty=Number(item.quantity||0), unit=Number(item.unit_price||0), total=qty*unit; subtotal+=total;
      const descLines=wrapText(item.name||'Item',normal,9,300); const noteLines=item.notes?wrapText(item.notes,normal,7.5,300):[]; const rowH=Math.max(28,descLines.length*12+noteLines.length*10+8);
      ensure(rowH+6);
      let yy=y; for(const line of descLines){text(line,margin+6,yy,9,normal,dark);yy-=12;} for(const line of noteLines){text(line,margin+6,yy,7.5,normal,muted);yy-=10;}
      text(`${qty.toLocaleString('pt-BR')} ${clean(item.unit||'')}`,margin+315,y,8.5,normal,dark);
      text(money(unit),margin+365,y,8.5,normal,dark); text(money(total),margin+445,y,8.5,bold,dark);
      y-=rowH; page.drawLine({start:{x:margin,y:y+4},end:{x:A4[0]-margin,y:y+4},thickness:.5,color:light});
    }
    y-=8; ensure(100);
    const discount=Number(quote.discount||0), surcharge=Number(quote.surcharge||0), grand=Math.max(0,subtotal-discount+surcharge);
    const lx=A4[0]-margin-210, vx=A4[0]-margin-95;
    text('Subtotal',lx,y,9,normal,muted); text(money(subtotal),vx,y,9,normal,dark); y-=15;
    if(discount>0){text('Desconto',lx,y,9,normal,muted);text(`- ${money(discount)}`,vx,y,9,normal,dark);y-=15;}
    if(surcharge>0){text('Acréscimo',lx,y,9,normal,muted);text(`+ ${money(surcharge)}`,vx,y,9,normal,dark);y-=15;}
    text('TOTAL',lx,y,12,bold,dark); text(money(grand),vx,y,12,bold,teal); y-=30;

    if(quote.payment_terms){text('CONDIÇÕES DE PAGAMENTO',margin,y,8,bold,teal);y-=14;wrapped(quote.payment_terms,margin,width,9,normal,dark,13);y-=7;}
    if(quote.notes){text('OBSERVAÇÕES',margin,y,8,bold,teal);y-=14;wrapped(quote.notes,margin,width,9,normal,dark,13);y-=7;}
    ensure(50); page.drawLine({start:{x:margin,y:y-4},end:{x:A4[0]-margin,y:y-4},thickness:.5,color:light}); y-=18;
    wrapped(`Orçamento emitido por ${company.trade_name||company.name||'empresa'}${company.owner_name?` · Responsável: ${company.owner_name}`:''}.`,margin,width,7.5,normal,muted,11);

    const bytes=await pdf.save(); const filename=`Orcamento-${safeFile(quote.number)}.pdf`;
    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition',`attachment; filename="${filename}"`);
    res.setHeader('Content-Length',String(bytes.length));
    return res.status(200).send(Buffer.from(bytes));
  }catch(error){
    console.error('quote-pdf',error instanceof Error?error.message:'unknown');
    const status=error?.status===401?401:error?.status===403?403:500;
    return res.status(status).json({error:status===500?'Não foi possível gerar o PDF.': 'Sem permissão para gerar o PDF.'});
  }
}
