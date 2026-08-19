import { supabase } from './supabase';

async function token(){
  const { data, error } = await supabase.auth.getSession();
  if(error) throw error;
  const t=data?.session?.access_token;
  if(!t) throw new Error('Sua sessão expirou. Entre novamente.');
  return t;
}

async function fetchPdf(quoteId,companyId){
  const access=await token();
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),20000);
  try{
    const r=await fetch('/api/quote-pdf',{
      method:'POST',
      headers:{Authorization:`Bearer ${access}`,'content-type':'application/json'},
      body:JSON.stringify({quoteId,companyId}),
      signal:controller.signal,
    });
    if(!r.ok){const body=await r.json().catch(()=>({}));throw new Error(body?.error||'Não foi possível gerar o PDF.');}
    return await r.blob();
  }catch(e){
    if(e?.name==='AbortError') throw new Error('A geração do PDF demorou demais. Tente novamente.');
    throw e;
  }finally{clearTimeout(timer);}
}

export async function baixarOrcamentoPDF(quoteId,companyId,filename='orcamento.pdf'){
  const blob=await fetchPdf(quoteId,companyId);
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download=filename; a.rel='noopener';
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),30000);
  return true;
}

export function suportaCompartilharArquivo(){
  return typeof navigator!=='undefined' && typeof navigator.share==='function' && typeof navigator.canShare==='function' && typeof File!=='undefined';
}

export async function compartilharOrcamentoPDF({quoteId,companyId,filename='orcamento.pdf',text=''}){
  if(!suportaCompartilharArquivo()) return {shared:false,unsupported:true};
  const blob=await fetchPdf(quoteId,companyId);
  const file=new File([blob],filename,{type:'application/pdf'});
  if(!navigator.canShare({files:[file]})) return {shared:false,unsupported:true};
  try{
    await navigator.share({title:filename.replace(/\.pdf$/i,''),text,files:[file]});
    return {shared:true};
  }catch(e){
    if(e?.name==='AbortError') return {shared:false,cancelled:true};
    throw e;
  }
}
