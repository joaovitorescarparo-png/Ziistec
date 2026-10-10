import React,{useEffect,useMemo,useState} from 'react';
import {Search,X} from 'lucide-react';
import {listarKitsOrcamentoV2DB,listarModelosOrcamentoV2DB} from '../lib/quoteReuseV2Api';

export default function QuoteReusePicker({companyId,kind='template',onClose,onSelect}){
  const [rows,setRows]=useState([]);const [query,setQuery]=useState('');const [loading,setLoading]=useState(true);const [error,setError]=useState('');
  useEffect(()=>{let live=true;(async()=>{try{const data=kind==='kit'?await listarKitsOrcamentoV2DB(companyId):await listarModelosOrcamentoV2DB(companyId);if(live)setRows((data||[]).filter(x=>x.active));}catch(e){if(live)setError(e.message||'Falha ao carregar.');}finally{if(live)setLoading(false);}})();return()=>{live=false};},[companyId,kind]);
  const filtered=useMemo(()=>{const q=query.trim().toLowerCase();return rows.filter(r=>!q||`${r.name||''} ${r.description||''} ${r.quote_title||''}`.toLowerCase().includes(q));},[rows,query]);
  const title=kind==='kit'?'Adicionar kit':'Usar modelo';
  return <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/55 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
    <div className="flex w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl max-h-[min(92dvh,760px)]">
      <header className="flex min-h-14 items-center justify-between gap-3 border-b px-4 py-3"><div><h2 className="text-lg font-bold text-slate-900">{title}</h2><p className="text-sm text-slate-500">Selecione e revise antes de salvar.</p></div><button onClick={onClose} className="min-h-11 min-w-11 rounded-xl border p-2" aria-label="Fechar"><X className="mx-auto h-5 w-5"/></button></header>
      <div className="border-b p-4"><label className="relative block"><Search className="absolute left-3 top-3.5 h-5 w-5 text-slate-400"/><input autoFocus value={query} onChange={e=>setQuery(e.target.value)} placeholder={`Buscar ${kind==='kit'?'kit':'modelo'}`} className="min-h-12 w-full rounded-xl border border-slate-300 pl-10 pr-3 text-base outline-none focus:border-emerald-500"/></label></div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {loading&&<p className="py-8 text-center text-slate-500">Carregando…</p>}{error&&<p className="break-words rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {!loading&&!error&&!filtered.length&&<p className="py-8 text-center text-slate-500">Nenhum {kind==='kit'?'kit':'modelo'} ativo encontrado.</p>}
        <div className="grid gap-3">{filtered.map(row=><button key={row.id} onClick={()=>onSelect(row)} className="min-h-14 w-full rounded-2xl border border-slate-200 p-4 text-left transition hover:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500">
          <span className="block break-words font-semibold text-slate-900">{row.name}</span>{(row.quote_title||row.description)&&<span className="mt-1 block break-words text-sm text-slate-600">{row.quote_title||row.description}</span>}
          <span className="mt-2 block text-xs text-slate-500">{(row.items||[]).length} item(ns){row.checklist_name?` · Checklist: ${row.checklist_name}`:''}</span>
        </button>)}</div>
      </div>
    </div>
  </div>;
}
