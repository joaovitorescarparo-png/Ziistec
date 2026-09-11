import React,{useEffect,useState} from 'react';
import {Boxes,FileStack,Settings2,Sparkles} from 'lucide-react';
import QuoteAIBaseV2 from './QuoteAIBaseV2';
import QuoteReuseEditorV2 from './QuoteReuseEditorV2';
import QuoteReusePicker from '../../components/QuoteReusePicker';
import QuoteReuseAdmin from '../../components/QuoteReuseAdmin';
import {appendKitSeed,applyTemplateSeed,emptyReuseSeed,seedFromWorkOrder} from '../../lib/quoteReuseMerge';
import {resolverAtendimentoAnteriorV2DB,resolverKitOrcamentoV2DB,resolverModeloOrcamentoV2DB} from '../../lib/quoteReuseV2Api';

export default function QuoteAIV2(props){
  const [mode,setMode]=useState('ai');const [seed,setSeed]=useState(()=>emptyReuseSeed());const [picker,setPicker]=useState(null);const [admin,setAdmin]=useState(false);const [error,setError]=useState('');
  const openQuick=()=>{setMode('quick');setSeed(s=>s||emptyReuseSeed());};
  useEffect(()=>{const params=new URLSearchParams(window.location.search);const source=params.get('source_wo');if(!source)return;let live=true;(async()=>{try{const resolved=await resolverAtendimentoAnteriorV2DB(source);if(!live)return;setSeed(seedFromWorkOrder(resolved));setMode('quick');const url=new URL(window.location.href);url.searchParams.delete('source_wo');window.history.replaceState({},'',`${url.pathname}${url.search}${url.hash}`);}catch(e){if(live)setError(e.message||'Não foi possível reutilizar o atendimento.');}})();return()=>{live=false};},[]);
  const selectReuse=async row=>{try{setError('');if(picker==='template'){const r=await resolverModeloOrcamentoV2DB(row.id);setSeed(s=>applyTemplateSeed(s,r));}else{const r=await resolverKitOrcamentoV2DB(row.id);setSeed(s=>appendKitSeed(s,r));}setMode('quick');setPicker(null);}catch(e){setError(e.message||'Não foi possível aplicar.');}};
  return <div className="relative min-h-0">
    {mode==='ai'?<><div className="sticky top-0 z-30 border-b bg-white/95 px-3 py-2 backdrop-blur"><div className="mx-auto flex max-w-5xl flex-wrap gap-2"><button onClick={()=>setPicker('template')} className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-slate-900 px-3 text-sm font-semibold text-white"><FileStack className="h-4 w-4"/>Usar modelo</button><button onClick={()=>setPicker('kit')} className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-semibold"><Boxes className="h-4 w-4"/>Adicionar kit</button><button onClick={openQuick} className="flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-semibold"><Sparkles className="h-4 w-4"/>Novo rápido</button><button onClick={()=>setAdmin(true)} className="min-h-11 min-w-11 rounded-xl border" aria-label="Gerenciar modelos e kits"><Settings2 className="mx-auto h-4 w-4"/></button></div>{error&&<p className="mx-auto mt-2 max-w-5xl break-words rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p>}</div><QuoteAIBaseV2 {...props}/></>:<QuoteReuseEditorV2 companyId={props.companyId} seed={seed} setSeed={setSeed} onClose={()=>setMode('ai')} onUseTemplate={()=>setPicker('template')} onAddKit={()=>setPicker('kit')} onManage={()=>setAdmin(true)}/>}
    {picker&&<QuoteReusePicker companyId={props.companyId} kind={picker} onClose={()=>setPicker(null)} onSelect={selectReuse}/>} {admin&&<QuoteReuseAdmin companyId={props.companyId} onClose={()=>setAdmin(false)}/>}
  </div>;
}

/* MOBILE HOMOLOGATION · quote authoring · wave 2 */
/* FIELD WORKFLOW V1 · wave 1 · quote mobile commercial */
/* FIELD WORKFLOW V1 · wave 4a · quote reuse wrappers */
