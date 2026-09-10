import React,{useEffect,useMemo,useRef,useState} from 'react';
import {Search,X,UserRound,MapPin,ClipboardList,FileText,Package,Wrench,ShieldCheck,Loader2,ChevronRight} from 'lucide-react';
import {buscarGlobalV2DB} from '../lib/globalSearchV2Api';

const groups=[
  ['client','CLIENTES',UserRound],['location','LOCAIS',MapPin],['work_order','ORDENS DE SERVIÇO',ClipboardList],
  ['quote','ORÇAMENTOS',FileText],['equipment','EQUIPAMENTOS INSTALADOS',Wrench],['warranty','GARANTIAS',ShieldCheck],['product','PRODUTOS',Package],
];
const norm=v=>String(v||'').replace(/\D/g,'');

export default function GlobalSearchModal({companyId,onClose,onClient,onWorkOrder,onQuote,onWarranty,onProduct,onLocation}){
  const [query,setQuery]=useState('');
  const [items,setItems]=useState([]);
  const [loading,setLoading]=useState(false);
  const [loadingMore,setLoadingMore]=useState(false);
  const [error,setError]=useState('');
  const [hasMore,setHasMore]=useState(false);
  const [nextOffset,setNextOffset]=useState(null);
  const requestRef=useRef(0);
  const inputRef=useRef(null);

  useEffect(()=>{inputRef.current?.focus();},[]);
  useEffect(()=>{
    const text=query.trim();
    const digits=norm(text);
    const valid=text.length>=2||digits.length>=3;
    if(!valid){setItems([]);setHasMore(false);setNextOffset(null);setError('');setLoading(false);return;}
    const seq=++requestRef.current;
    const timer=setTimeout(async()=>{
      setLoading(true);setError('');
      try{
        const data=await buscarGlobalV2DB(companyId,text,{limit:30,offset:0});
        if(seq!==requestRef.current)return;
        setItems(data.items);setHasMore(data.hasMore);setNextOffset(data.nextOffset);
      }catch(e){if(seq===requestRef.current){setItems([]);setHasMore(false);setError(e?.message||'Não foi possível buscar agora.');}}
      finally{if(seq===requestRef.current)setLoading(false);}
    },250);
    return()=>clearTimeout(timer);
  },[companyId,query]);

  const grouped=useMemo(()=>Object.fromEntries(groups.map(([type])=>[type,items.filter(x=>x.type===type)])),[items]);
  const open=item=>{
    if(item.type==='client')return onClient?.(item.client_id||item.id);
    if(item.type==='location')return onLocation?.(item)??onClient?.(item.client_id);
    if(item.type==='work_order')return onWorkOrder?.(item.work_order_id||item.id);
    if(item.type==='quote')return onQuote?.(item.id);
    if(item.type==='equipment')return onWorkOrder?.(item.work_order_id);
    if(item.type==='warranty')return onWarranty?.(item.warranty_id||item.id);
    if(item.type==='product')return onProduct?.(item.product_id||item.id);
  };
  const loadMore=async()=>{
    if(loadingMore||!hasMore||nextOffset==null)return;
    setLoadingMore(true);setError('');
    try{
      const data=await buscarGlobalV2DB(companyId,query,{limit:30,offset:nextOffset});
      setItems(prev=>[...prev,...data.items]);setHasMore(data.hasMore);setNextOffset(data.nextOffset);
    }catch(e){setError(e?.message||'Não foi possível carregar mais resultados.');}
    finally{setLoadingMore(false);}
  };

  return <div className="fixed inset-0 z-[12000] flex items-end justify-center bg-slate-950/60 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Busca global" onMouseDown={e=>{if(e.target===e.currentTarget)onClose?.();}}>
    <div className="flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl">
      <header className="flex min-h-16 items-center gap-3 border-b border-slate-100 p-3 sm:p-4">
        <div className="relative min-w-0 flex-1"><Search className="absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" aria-hidden="true"/><input ref={inputRef} value={query} onChange={e=>setQuery(e.target.value.slice(0,120))} placeholder="Buscar cliente, OS, produto, serial..." className="min-h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-11 pr-4 text-base text-slate-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"/></div>
        <button onClick={onClose} className="min-h-12 min-w-12 rounded-2xl border border-slate-200 text-slate-600 hover:bg-slate-50" aria-label="Fechar busca"><X className="mx-auto h-5 w-5"/></button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-5">
        {!query.trim()&&<div className="py-12 text-center"><Search className="mx-auto h-8 w-8 text-slate-300"/><p className="mt-3 text-sm font-semibold text-slate-700">Encontre qualquer informação operacional</p><p className="mt-1 text-sm text-slate-500">Cliente, telefone, documento, local, OS, orçamento, produto, código ou serial.</p></div>}
        {query.trim()&&!loading&&!error&&!items.length&&<p className="py-12 text-center text-sm text-slate-500">Nenhum resultado encontrado.</p>}
        {loading&&<div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500"><Loader2 className="h-5 w-5 animate-spin"/>Buscando…</div>}
        {error&&<div className="mb-4 break-words rounded-2xl bg-rose-50 p-4 text-sm text-rose-700">{error}</div>}

        {!loading&&groups.map(([type,label,Icon])=>grouped[type]?.length?<section key={type} className="mb-5"><div className="mb-2 flex items-center gap-2 px-1 text-[11px] font-bold tracking-[.12em] text-slate-400"><Icon className="h-4 w-4"/>{label}</div><div className="overflow-hidden rounded-2xl border border-slate-200 bg-white divide-y divide-slate-100">{grouped[type].map(item=><button key={`${type}:${item.id}`} onClick={()=>open(item)} className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500"><div className="min-w-0 flex-1"><p className="break-words text-sm font-semibold text-slate-900">{item.title}</p>{item.subtitle&&<p className="mt-0.5 break-words text-xs leading-relaxed text-slate-500">{item.subtitle}</p>}</div><ChevronRight className="h-5 w-5 shrink-0 text-slate-300"/></button>)}</div></section>:null)}

        {hasMore&&!loading&&<button onClick={loadMore} disabled={loadingMore} className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 disabled:opacity-50">{loadingMore?'Carregando…':'Carregar mais resultados'}</button>}
      </div>
    </div>
  </div>;
}
