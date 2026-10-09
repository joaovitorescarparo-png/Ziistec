import React,{useCallback,useEffect,useRef,useState} from 'react';
import {Download,FileText,Loader2,RefreshCw,Share2} from 'lucide-react';
import {carregarComprovantesOSDB,emitirComprovanteServicoDB,novoRequestIdComprovante} from '../lib/serviceReceiptApi';
import {AVISO_NAO_FISCAL,baixarComprovanteServicoPDF,compartilharComprovanteServicoPDF,linkWhatsAppComprovante} from '../lib/serviceReceiptPdf';

const brl=(v)=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const dataHora=(v)=>v?new Date(v).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'}):'—';
const btn='inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-3.5 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 disabled:opacity-50';
const campo='w-full rounded-xl bg-white px-3 py-2.5 text-[14px] ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500';

// Comprovante de Serviço da OS concluída. Somente proprietário: o banco recusa técnico e a RLS
// não devolve comprovante a ele; esta tela só organiza emissão, reemissão e compartilhamento.
export default function ServiceReceiptPanel({workOrderId,telefoneCliente='',onAviso}){
  const [estado,setEstado]=useState({carregando:true,ativo:null,versoes:[],disponivel:true});
  const [erro,setErro]=useState('');
  const [obs,setObs]=useState('');
  const [motivo,setMotivo]=useState('');
  const [reemitindo,setReemitindo]=useState(false);
  const [emitindo,setEmitindo]=useState(false);
  const [gerando,setGerando]=useState('');
  // Mesmo pedido (mesmos dados) reaproveita o requestId em retry/duplo toque.
  const pedido=useRef(null);

  const carregar=useCallback(async()=>{
    setEstado(s=>({...s,carregando:true}));setErro('');
    try{setEstado({carregando:false,...await carregarComprovantesOSDB(workOrderId)});}
    catch(e){setEstado(s=>({...s,carregando:false}));setErro(e?.message||'Não foi possível carregar o comprovante.');}
  },[workOrderId]);
  useEffect(()=>{carregar();},[carregar]);

  const emitir=async()=>{
    if(emitindo) return;
    const ativo=estado.ativo;
    const motivoLimpo=motivo.trim();
    if(ativo&&!motivoLimpo){setErro('Informe o motivo da reemissão.');return;}
    setEmitindo(true);setErro('');
    try{
      const chave=JSON.stringify([workOrderId,ativo?.id||null,obs.trim(),ativo?motivoLimpo:'']);
      if(pedido.current?.chave!==chave) pedido.current={chave,id:novoRequestIdComprovante()};
      const emitido=await emitirComprovanteServicoDB({workOrderId,requestId:pedido.current.id,notes:obs,reissueReason:ativo?motivoLimpo:''});
      pedido.current=null;
      setReemitindo(false);setMotivo('');setObs('');
      onAviso?.(ativo?`Comprovante ${emitido.number} reemitido (versão ${emitido.version}).`:`Comprovante ${emitido.number} emitido.`);
      await carregar();
    }catch(e){setErro(e?.message||'Não foi possível emitir o comprovante.');}
    finally{setEmitindo(false);}
  };

  const baixar=async()=>{
    if(!estado.ativo||gerando) return;
    setGerando('pdf');setErro('');
    try{await baixarComprovanteServicoPDF(estado.ativo);}
    catch(e){setErro(e?.message||'Não foi possível gerar o PDF.');}
    finally{setGerando('');}
  };

  const compartilhar=async()=>{
    if(!estado.ativo||gerando) return;
    setGerando('share');setErro('');
    try{
      const r=await compartilharComprovanteServicoPDF(estado.ativo);
      if(r?.unsupported){
        // Sem compartilhamento de arquivo: baixa o PDF e abre o WhatsApp com o texto para anexar.
        await baixarComprovanteServicoPDF(estado.ativo);
        window.open(linkWhatsAppComprovante(estado.ativo,telefoneCliente),'_blank','noopener,noreferrer');
      }
    }catch(e){setErro(e?.message||'Não foi possível compartilhar o comprovante.');}
    finally{setGerando('');}
  };

  const ativo=estado.ativo;
  const financeiro=ativo?.snapshot?.financial||{};
  const anteriores=estado.versoes.filter(v=>!v.is_active);

  return <div className="space-y-4">
    <p className="rounded-xl bg-slate-50 px-3.5 py-3 text-[13px] leading-relaxed text-slate-600 ring-1 ring-slate-200/70">
      <strong className="text-slate-800">{AVISO_NAO_FISCAL}.</strong> Gerado a partir do relatório congelado da OS concluída, com a situação financeira do momento da emissão.
    </p>

    {erro&&<div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800">{erro}</div>}

    {estado.carregando?<p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin"/>Carregando comprovante…</p>
    :!estado.disponivel?<p className="rounded-xl bg-amber-50 px-3.5 py-3 text-sm text-amber-900 ring-1 ring-amber-200/70">O Comprovante de Serviço ainda não está disponível neste ambiente.</p>
    :!ativo?<div className="space-y-3">
      <label className="grid gap-1.5 text-sm font-medium text-slate-700">Observações (opcional)
        <textarea rows={3} maxLength={2000} value={obs} onChange={e=>setObs(e.target.value)} className={campo} placeholder="Ex.: garantia de 90 dias para o serviço executado."/>
      </label>
      <button type="button" onClick={emitir} disabled={emitindo} className={`${btn} w-full bg-slate-900 text-white hover:bg-slate-800`}>
        {emitindo?<Loader2 className="h-4 w-4 animate-spin"/>:<FileText className="h-4 w-4"/>}{emitindo?'Emitindo…':'Emitir comprovante'}
      </button>
    </div>
    :<div className="space-y-4">
      <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-lg font-semibold tabular-nums text-slate-900">{ativo.number}{ativo.version>1?<span className="ml-2 text-sm font-medium text-slate-500">versão {ativo.version}</span>:null}</p>
            <p className="text-[12.5px] text-slate-500">Emitido em {dataHora(ativo.issued_at)}{ativo.snapshot?.document?.issued_by?.name?` por ${ativo.snapshot.document.issued_by.name}`:''}</p>
            {ativo.reissue_reason&&<p className="mt-1 break-words text-[12.5px] text-slate-500">Motivo: {ativo.reissue_reason}</p>}
          </div>
          <div className="text-right">
            <p className="text-lg font-semibold tabular-nums text-slate-900">{brl(financeiro.total)}</p>
            <p className="text-[12.5px] text-slate-500">{financeiro.status_label||'—'}</p>
          </div>
        </div>
        {ativo.notes&&<p className="mt-3 whitespace-pre-line break-words border-t border-slate-100 pt-3 text-[13px] text-slate-600">{ativo.notes}</p>}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <button type="button" onClick={baixar} disabled={Boolean(gerando)} className={`${btn} bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50`}>
          {gerando==='pdf'?<Loader2 className="h-4 w-4 animate-spin"/>:<Download className="h-4 w-4"/>}Baixar PDF
        </button>
        <button type="button" onClick={compartilhar} disabled={Boolean(gerando)} className={`${btn} bg-teal-700 text-white hover:bg-teal-800`}>
          {gerando==='share'?<Loader2 className="h-4 w-4 animate-spin"/>:<Share2 className="h-4 w-4"/>}Compartilhar
        </button>
      </div>

      {!reemitindo?<button type="button" onClick={()=>{setReemitindo(true);setErro('');}} className={`${btn} w-full text-slate-600 hover:bg-slate-50`}>
        <RefreshCw className="h-4 w-4"/>Reemitir comprovante
      </button>
      :<div className="space-y-3 rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
        <p className="text-[13px] text-slate-600">A reemissão mantém o número, cria a versão {ativo.version+1} com a situação financeira atual e guarda a versão anterior.</p>
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">Motivo da reemissão *
          <textarea rows={2} maxLength={500} value={motivo} onChange={e=>setMotivo(e.target.value)} className={campo} placeholder="Ex.: pagamento recebido após a primeira emissão."/>
        </label>
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">Observações (opcional)
          <textarea rows={2} maxLength={2000} value={obs} onChange={e=>setObs(e.target.value)} className={campo}/>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={()=>{setReemitindo(false);setMotivo('');setErro('');}} className={`${btn} bg-white text-slate-700 ring-1 ring-slate-200`}>Cancelar</button>
          <button type="button" onClick={emitir} disabled={emitindo||!motivo.trim()} className={`${btn} bg-slate-900 text-white hover:bg-slate-800`}>
            {emitindo?<Loader2 className="h-4 w-4 animate-spin"/>:null}{emitindo?'Reemitindo…':'Confirmar reemissão'}
          </button>
        </div>
      </div>}

      {anteriores.length>0&&<div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">Versões anteriores</p>
        <ul className="mt-2 space-y-1.5">
          {anteriores.map(v=><li key={v.id} className="text-[12.5px] text-slate-500">{v.number} · versão {v.version} · emitida em {dataHora(v.issued_at)} · substituída em {dataHora(v.superseded_at)}</li>)}
        </ul>
      </div>}
    </div>}
  </div>;
}
