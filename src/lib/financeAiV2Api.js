import { supabase } from './supabase';

const n=(v)=>Number.isFinite(Number(v))?Number(v):0;

export function montarSnapshotFinanceiroV2({month,metrics,osProfit,custosProntos}){
  return {
    month:String(month||'').slice(0,7),
    custosProntos:Boolean(custosProntos),
    metrics:{
      faturado:n(metrics?.faturado),
      recebido:n(metrics?.recebido),
      receber:n(metrics?.receber),
      despesas:n(metrics?.despesaCompetencia),
      despesasPagas:n(metrics?.despesaPaga),
      caixa:n(metrics?.caixa),
      vencidoReceber:n(metrics?.vencidoReceber),
      vencidoPagar:n(metrics?.vencidoPagar),
      proj7:n(metrics?.proj7),
      proj30:n(metrics?.proj30),
      proj60:n(metrics?.proj60),
      origemOS:n(metrics?.origem?.os),
      origemManual:n(metrics?.origem?.manual),
    },
    os:(osProfit||[]).slice(0,8).map(os=>({
      numero:String(os?.numero||'').slice(0,40),
      receita:n(os?.receita),
      ...(custosProntos?{
        custo:n(os?.custo),
        resultado:n(os?.resultado),
        margem:n(os?.margem),
      }:{}),
    })),
  };
}

export async function gerarResumoFinanceiroV2IA(companyId,snapshot){
  const {data}=await supabase.auth.getSession();
  const token=data.session?.access_token;
  if(!token) throw new Error('Sua sessão expirou. Entre novamente.');
  if(!companyId) throw new Error('Empresa ativa não encontrada.');

  const resp=await fetch('/api/finance-ai',{
    method:'POST',
    headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
    body:JSON.stringify({companyId,snapshot}),
  });
  const payload=await resp.json().catch(()=>({}));
  if(!resp.ok) throw new Error(payload.error||'Não consegui gerar a análise financeira.');
  return {
    resumo:String(payload.resumo||'').slice(0,900),
    alertas:Array.isArray(payload.alertas)?payload.alertas.slice(0,4).map(x=>String(x).slice(0,320)):[],
    acoes:Array.isArray(payload.acoes)?payload.acoes.slice(0,4).map(x=>String(x).slice(0,320)):[],
    confianca:['alta','media'].includes(payload.confianca)?payload.confianca:'media',
  };
}
