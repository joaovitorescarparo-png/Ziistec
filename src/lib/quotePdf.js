import { supabase } from './supabase';
import { PROD_SUPABASE_HOSTS, STAGING_SUPABASE_HOSTS } from './supabaseConfig.js';

/* Onde o PDF do orçamento é gerado.
 * - Vercel (hosts de Production da Vercel, previews de homologação e desenvolvimento local):
 *   /api/quote-pdf, o mesmo caminho de sempre.
 * - Hostinger (ziistec.com, www.ziistec.com): Edge Function `quote-pdf` do Supabase de
 *   Production, com o token da sessão. A CSP desse build só permite o próprio Supabase.
 * - Qualquer outro host: nenhum backend (fail-closed), sem tentar outro caminho.
 * O PDF só é entregue depois de validado: Content-Type application/pdf, tamanho > 0 e os
 * primeiros bytes "%PDF-". HTML ou JSON de erro nunca vira arquivo .pdf. */
export const HOSTS_PDF_EDGE = Object.freeze(['ziistec.com', 'www.ziistec.com']);
const HOSTS_PDF_VERCEL = new Set([
  ...PROD_SUPABASE_HOSTS.filter((host) => !HOSTS_PDF_EDGE.includes(host)),
  ...STAGING_SUPABASE_HOSTS,
  'localhost', '127.0.0.1',
]);
const TEMPO_MAXIMO_MS = 20000;
const INDISPONIVEL = 'A geração do PDF ainda não está disponível neste endereço.';
const FALHOU = 'Não foi possível gerar o PDF.';
const DEMOROU = 'A geração do PDF demorou demais. Tente novamente.';

/* Frases que a Edge Function devolve (mesmas da rota da Vercel e das RPCs de cota). Só elas
   chegam à tela; qualquer outro corpo de erro (gateway, proxy) vira frase fixa pelo status. */
const MENSAGENS_DA_FUNCAO = new Set([
  'Somente o proprietário pode gerar este PDF.',
  'Sem permissão para gerar o PDF.',
  'Orçamento não encontrado.',
  'Orçamento ou empresa inválidos.',
  'Limite de geração de PDF atingido.',
  'Somente o proprietário gera PDF de orçamento',
  'Assinatura inativa',
  'Sem acesso a esta empresa',
  'Muitos PDFs em pouco tempo. Aguarde um minuto',
  'Limite diário de PDFs atingido',
  FALHOU,
]);

export function rotaPdfOrcamento(hostname) {
  const host = String(hostname || '').trim().toLowerCase();
  if (HOSTS_PDF_EDGE.includes(host)) return 'edge';
  if (HOSTS_PDF_VERCEL.has(host)) return 'vercel';
  return '';
}

const hostAtual = () => (typeof window !== 'undefined' ? window.location?.hostname || '' : '');

async function token(){
  if(!supabase) throw new Error('Sua sessão expirou. Entre novamente.');
  const { data, error } = await supabase.auth.getSession();
  if(error) throw error;
  const t=data?.session?.access_token;
  if(!t) throw new Error('Sua sessão expirou. Entre novamente.');
  return t;
}

/* Só um PDF de verdade sai daqui. */
export async function validarPdf(blob, contentType, mensagemTipo = INDISPONIVEL){
  // Hospedagem que devolve o index.html (200) no lugar da API não pode virar "orcamento.pdf" com HTML dentro.
  if(!/application\/pdf/i.test(String(contentType || ''))) throw new Error(mensagemTipo);
  if(!blob || typeof blob.slice !== 'function' || !(blob.size > 0)) throw new Error(FALHOU);
  const inicio = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
  if(String.fromCharCode(...inicio) !== '%PDF-') throw new Error(FALHOU);
  return blob.type === 'application/pdf' ? blob : new Blob([blob], { type: 'application/pdf' });
}

async function pdfPelaVercel(quoteId,companyId,access){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),TEMPO_MAXIMO_MS);
  try{
    const r=await fetch('/api/quote-pdf',{
      method:'POST',
      headers:{Authorization:`Bearer ${access}`,'content-type':'application/json'},
      body:JSON.stringify({quoteId,companyId}),
      signal:controller.signal,
    });
    if(!r.ok){
      const body=await r.json().catch(()=>({}));
      if(body?.error) throw new Error(body.error);
      // Sem resposta da API: o site estático (Hostinger) não tem as Vercel Functions.
      if(r.status===404||r.status===405||r.status===501) throw new Error(INDISPONIVEL);
      throw new Error(FALHOU);
    }
    return await validarPdf(await r.blob(), r.headers?.get?.('content-type'));
  }catch(e){
    if(e?.name==='AbortError') throw new Error(DEMOROU);
    throw e;
  }finally{clearTimeout(timer);}
}

async function mensagemDoErroDaEdge(error){
  if(error?.name==='FunctionsFetchError'){
    if(error?.context?.name==='AbortError') return DEMOROU;
    return 'Sem conexão com o servidor. Verifique sua internet.';
  }
  const resposta=error?.name==='FunctionsHttpError'?error.context:null;
  const status=Number(resposta?.status||0);
  const corpo=resposta && typeof resposta.json==='function' ? await resposta.json().catch(()=>null) : null;
  if(typeof corpo?.error==='string' && MENSAGENS_DA_FUNCAO.has(corpo.error)) return corpo.error;
  if(status===401) return 'Sua sessão expirou. Entre novamente.';
  if(status===403) return 'Sem permissão para gerar o PDF.';
  if(status===404) return INDISPONIVEL;
  if(status===429) return 'Muitos PDFs em pouco tempo. Aguarde um minuto';
  return FALHOU;
}

async function pdfPelaEdge(quoteId,companyId,access){
  if(!supabase?.functions?.invoke) throw new Error(INDISPONIVEL);
  const { data, error, response } = await supabase.functions.invoke('quote-pdf',{
    body:{quoteId,companyId},
    headers:{Authorization:`Bearer ${access}`},
    timeout:TEMPO_MAXIMO_MS,
  });
  if(error) throw new Error(await mensagemDoErroDaEdge(error));
  return validarPdf(data, response?.headers?.get?.('content-type'), FALHOU);
}

async function fetchPdf(quoteId,companyId){
  const rota=rotaPdfOrcamento(hostAtual());
  if(!rota) throw new Error(INDISPONIVEL);
  const access=await token();
  return rota==='edge' ? pdfPelaEdge(quoteId,companyId,access) : pdfPelaVercel(quoteId,companyId,access);
}

/* Toque duplo no botão: o mesmo orçamento em geração devolve o mesmo pedido, sem
   segunda chamada (e sem gastar a cota duas vezes). A geração não altera dado nenhum. */
const emAndamento = new Map();
function obterPdf(quoteId,companyId){
  const chave=`${companyId}:${quoteId}`;
  if(emAndamento.has(chave)) return emAndamento.get(chave);
  const pedido=fetchPdf(quoteId,companyId).finally(()=>emAndamento.delete(chave));
  emAndamento.set(chave,pedido);
  return pedido;
}

export async function baixarOrcamentoPDF(quoteId,companyId,filename='orcamento.pdf'){
  const blob=await obterPdf(quoteId,companyId);
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
  const blob=await obterPdf(quoteId,companyId);
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
