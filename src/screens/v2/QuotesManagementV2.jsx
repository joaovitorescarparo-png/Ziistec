import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, CalendarDays, Check, CheckCircle2, ChevronDown, CircleDollarSign,
  Clock3, Copy, FileText, Loader2, Plus, RefreshCcw, Search, Send, UserRound, Wrench, X, XCircle,
} from 'lucide-react';
import {
  alterarStatusOrcamentoV2DB, carregarEquipeParaOrcamentoV2DB, carregarOrcamentosV2DB,
  criarOSDoOrcamentoV2DB, duplicarOrcamentoSeguroV2DB,
} from '../../lib/quotesV2Api';
import { mensagemErro } from '../../lib/supabase';

const brl = (v) => Number(v || 0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const dateBR = (v) => v ? String(v).slice(0,10).split('-').reverse().join('/') : '—';
const statusMeta = {
  rascunho:{label:'Rascunho',cls:'bg-slate-100 text-slate-700'},
  enviado:{label:'Enviado',cls:'bg-sky-50 text-sky-700'},
  aprovado:{label:'Aprovado',cls:'bg-emerald-50 text-emerald-700'},
  recusado:{label:'Recusado',cls:'bg-rose-50 text-rose-700'},
  vencido:{label:'Vencido',cls:'bg-amber-50 text-amber-700'},
};
const inputClass='w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100';

function Button({children,onClick,disabled=false,variant='primary',className='',type='button'}){
  const style=variant==='primary'?'bg-emerald-700 text-white hover:bg-emerald-800':variant==='danger'?'bg-rose-50 text-rose-700 hover:bg-rose-100':variant==='soft'?'bg-emerald-50 text-emerald-800 hover:bg-emerald-100':'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50';
  return <button type={type} onClick={onClick} disabled={disabled} className={`inline-flex items-center justify-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${style} ${className}`}>{children}</button>;
}

function StatusBadge({status}){
  const meta=statusMeta[status]||statusMeta.rascunho;
  return <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${meta.cls}`}>{meta.label}</span>;
}

function Stat({label,value,detail,tone='default'}){
  const cls=tone==='good'?'text-emerald-700':tone==='warn'?'text-amber-700':'text-slate-900';
  return <div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p><p className={`mt-1 text-xl font-bold ${cls}`}>{value}</p>{detail&&<p className="mt-1 text-[11px] text-slate-500">{detail}</p>}</div>;
}

function QuoteDetail({quote,onClose,onStatus,onDuplicate,onGenerate,busy}){
  const [openActions,setOpenActions]=useState(false);
  return <div className="fixed inset-0 z-[14000] flex items-end justify-center bg-slate-950/50 sm:items-center sm:p-5" onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)onClose();}}>
    <div className="max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-white shadow-2xl sm:max-w-3xl sm:rounded-3xl">
      <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-slate-200 bg-white/95 p-5 backdrop-blur">
        <div><div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-bold text-slate-900">{quote.numero}</h2><StatusBadge status={quote.status}/>{quote.os&&<span className="rounded-full bg-violet-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-violet-700">OS {quote.os.number}</span>}</div><p className="mt-1 text-sm text-slate-500">{quote.cliente?.nome||'Cliente não localizado'} · {dateBR(quote.data)}</p></div>
        <button onClick={onClose} disabled={busy} className="rounded-xl p-2 text-slate-500 hover:bg-slate-100"><X size={19}/></button>
      </div>
      <div className="space-y-5 p-5 sm:p-6">
        <div className="grid gap-3 sm:grid-cols-3"><Stat label="Total" value={brl(quote.total)}/><Stat label="Custo" value={brl(quote.custo)}/><Stat label="Margem" value={brl(quote.margem)} detail={`${quote.margemPct.toFixed(1)}%`} tone={quote.margem>=0?'good':'warn'}/></div>

        <section className="rounded-2xl border border-slate-200"><div className="border-b border-slate-200 px-4 py-3"><h3 className="text-sm font-bold text-slate-900">Itens do orçamento</h3></div><div className="divide-y divide-slate-100">{quote.itens.map((item,index)=><div key={item.id||index} className="grid gap-2 px-4 py-3 sm:grid-cols-[1fr_auto_auto]"><div><p className="text-sm font-semibold text-slate-800">{item.nome}</p><p className="mt-0.5 text-xs text-slate-500">{item.qtd} {item.unidade} · {item.tipo}</p>{item.obs&&<p className="mt-1 text-xs text-slate-500">{item.obs}</p>}</div><div className="text-left sm:text-right"><p className="text-[10px] font-bold uppercase text-slate-400">Unitário</p><p className="text-sm font-semibold">{brl(item.preco)}</p></div><div className="text-left sm:min-w-[105px] sm:text-right"><p className="text-[10px] font-bold uppercase text-slate-400">Subtotal</p><p className="text-sm font-bold">{brl(item.qtd*item.preco)}</p></div></div>)}</div></section>

        <div className="grid gap-3 sm:grid-cols-2"><div className="rounded-2xl bg-slate-50 p-4"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Validade</p><p className="mt-1 text-sm font-semibold text-slate-800">{dateBR(quote.validade)}</p></div><div className="rounded-2xl bg-slate-50 p-4"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Pagamento</p><p className="mt-1 text-sm font-semibold text-slate-800">{quote.condicao||'Não informado'}</p></div></div>
        {quote.obs&&<div className="rounded-2xl bg-slate-50 p-4"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Observações</p><p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{quote.obs}</p></div>}

        <div className="flex flex-col gap-2 border-t border-slate-200 pt-5 sm:flex-row sm:flex-wrap">
          {quote.status==='rascunho'&&<Button onClick={()=>onStatus(quote,'enviado')} disabled={busy}><Send size={16}/>Marcar como enviado</Button>}
          {quote.status==='enviado'&&<><Button onClick={()=>onStatus(quote,'aprovado')} disabled={busy}><CheckCircle2 size={16}/>Aprovar</Button><Button variant="danger" onClick={()=>onStatus(quote,'recusado')} disabled={busy}><XCircle size={16}/>Recusar</Button></>}
          {quote.status==='recusado'&&<Button variant="secondary" onClick={()=>onStatus(quote,'rascunho')} disabled={busy}><RefreshCcw size={16}/>Voltar a rascunho</Button>}
          {quote.status==='aprovado'&&!quote.os&&<Button onClick={()=>onGenerate(quote)} disabled={busy}><Wrench size={16}/>Gerar OS</Button>}
          {quote.status==='aprovado'&&quote.os&&<div className="inline-flex items-center gap-2 rounded-xl bg-emerald-50 px-3.5 py-2.5 text-sm font-semibold text-emerald-800"><Check size={16}/>OS {quote.os.number} já vinculada</div>}
          <Button variant="secondary" onClick={()=>onDuplicate(quote)} disabled={busy}><Copy size={16}/>Duplicar</Button>
          <div className="relative sm:ml-auto"><Button variant="secondary" onClick={()=>setOpenActions(v=>!v)} disabled={busy}>Mais<ChevronDown size={15}/></Button>{openActions&&<div className="absolute bottom-full right-0 z-20 mb-2 w-48 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-xl">{quote.status!=='vencido'&&quote.status!=='aprovado'&&<button className="w-full rounded-xl px-3 py-2 text-left text-xs font-semibold text-amber-700 hover:bg-amber-50" onClick={()=>{setOpenActions(false);onStatus(quote,'vencido');}}>Marcar como vencido</button>}{quote.status==='vencido'&&<button className="w-full rounded-xl px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50" onClick={()=>{setOpenActions(false);onStatus(quote,'rascunho');}}>Reabrir como rascunho</button>}</div>}</div>
        </div>
      </div>
    </div>
  </div>;
}

function GenerateModal({quote,equipe,onClose,onConfirm,busy}){
  const [assignedTo,setAssignedTo]=useState('');
  const [date,setDate]=useState('');
  const [time,setTime]=useState('');
  const invalid=Boolean(time&&!date);
  return <div className="fixed inset-0 z-[15000] flex items-end justify-center bg-slate-950/55 sm:items-center sm:p-5" onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)onClose();}}><form onSubmit={e=>{e.preventDefault();if(!invalid)onConfirm({quoteId:quote.id,assignedTo:assignedTo||null,scheduledDate:date||null,scheduledTime:time||null});}} className="w-full rounded-t-3xl bg-white p-5 shadow-2xl sm:max-w-lg sm:rounded-3xl"><div className="mb-5 flex items-start justify-between"><div><h3 className="font-bold text-slate-900">Gerar OS de {quote.numero}</h3><p className="mt-1 text-xs leading-relaxed text-slate-500">A conversão é idempotente: repetir a ação retorna a mesma OS, sem duplicar atendimento.</p></div><button type="button" onClick={onClose} disabled={busy} className="rounded-xl p-2 text-slate-500 hover:bg-slate-100"><X size={18}/></button></div>
    <div className="space-y-4"><label className="block"><span className="mb-1.5 block text-xs font-semibold text-slate-600">Responsável</span><select className={inputClass} value={assignedTo} onChange={e=>setAssignedTo(e.target.value)}><option value="">Eu / proprietário atual</option>{equipe.map(p=><option key={p.id} value={p.id}>{p.nome} · {p.papel==='proprietario'?'proprietário':'técnico'}</option>)}</select></label><div className="grid gap-3 sm:grid-cols-2"><label className="block"><span className="mb-1.5 block text-xs font-semibold text-slate-600">Data opcional</span><input type="date" className={inputClass} value={date} onChange={e=>{setDate(e.target.value);if(!e.target.value)setTime('');}}/></label><label className="block"><span className="mb-1.5 block text-xs font-semibold text-slate-600">Horário opcional</span><input type="time" className={inputClass} value={time} onChange={e=>setTime(e.target.value)}/></label></div>{invalid&&<p className="text-xs font-medium text-rose-700">Para informar um horário, selecione também a data.</p>}<div className="rounded-2xl bg-slate-50 p-4 text-xs leading-relaxed text-slate-600">Sem data, a OS nasce como <strong>aguardando agendamento</strong>. Com data, ela já entra como <strong>agendada</strong>.</div></div>
    <div className="mt-5 flex justify-end gap-2"><Button variant="secondary" onClick={onClose} disabled={busy}>Cancelar</Button><Button type="submit" disabled={busy||invalid}>{busy?<Loader2 className="animate-spin" size={16}/>:<Wrench size={16}/>}Gerar OS</Button></div></form></div>;
}

export default function QuotesManagementV2({companyId,companyName='Sua empresa',userId,onClose,onNew}){
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [quotes,setQuotes]=useState([]);
  const [equipe,setEquipe]=useState([]);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [query,setQuery]=useState('');
  const [status,setStatus]=useState('todos');
  const [selected,setSelected]=useState(null);
  const [generate,setGenerate]=useState(null);

  const load=async()=>{
    setLoading(true);setError('');
    try{
      const [q,e]=await Promise.all([carregarOrcamentosV2DB(companyId),carregarEquipeParaOrcamentoV2DB(companyId)]);
      setQuotes(q);setEquipe(e);
      setSelected(current=>current?q.find(x=>x.id===current.id)||null:null);
    }catch(e){setError(mensagemErro(e));}
    finally{setLoading(false);}
  };
  useEffect(()=>{load();},[companyId]);

  const filtered=useMemo(()=>{
    const term=query.trim().toLowerCase();
    return quotes.filter(q=>(status==='todos'||q.status===status)&&(!term||`${q.numero} ${q.cliente?.nome||''} ${q.itens.map(i=>i.nome).join(' ')}`.toLowerCase().includes(term)));
  },[quotes,query,status]);

  const stats=useMemo(()=>{
    const active=quotes.filter(q=>!['recusado','vencido'].includes(q.status));
    return {
      total:quotes.length,
      pipeline:active.reduce((s,q)=>s+q.total,0),
      approved:quotes.filter(q=>q.status==='aprovado').reduce((s,q)=>s+q.total,0),
      pending:quotes.filter(q=>q.status==='enviado').length,
    };
  },[quotes]);

  const mutate=async(fn,success)=>{
    setBusy(true);setError('');setNotice('');
    try{await fn();setNotice(success);await load();}
    catch(e){setError(mensagemErro(e));}
    finally{setBusy(false);}
  };

  const changeStatus=(quote,next)=>mutate(()=>alterarStatusOrcamentoV2DB(quote.id,next),`${quote.numero} atualizado para ${statusMeta[next]?.label||next}.`);
  const duplicate=(quote)=>mutate(()=>duplicarOrcamentoSeguroV2DB(quote,companyId,userId),`${quote.numero} duplicado como novo rascunho.`);
  const confirmGenerate=(payload)=>mutate(async()=>{const id=await criarOSDoOrcamentoV2DB(payload);setGenerate(null);setSelected(null);return id;},'OS criada com segurança e vinculada ao orçamento.');

  if(loading&&quotes.length===0)return <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500"><Loader2 className="mr-2 animate-spin" size={20}/>Carregando orçamentos V2...</div>;

  return <div className="min-h-screen bg-slate-50 text-slate-900">
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur"><div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6"><div className="flex min-w-0 items-center gap-3"><button onClick={onClose} className="rounded-xl border border-slate-200 p-2.5 text-slate-600 hover:bg-slate-50" aria-label="Voltar"><ArrowLeft size={19}/></button><div className="min-w-0"><div className="flex items-center gap-2"><h1 className="truncate text-base font-bold">Gestão de orçamentos</h1><span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">V2</span></div><p className="truncate text-xs text-slate-500">{companyName}</p></div></div><div className="flex gap-2"><Button variant="secondary" onClick={load} disabled={loading||busy}><RefreshCcw className={loading?'animate-spin':''} size={15}/><span className="hidden sm:inline">Atualizar</span></Button><Button onClick={onNew} disabled={busy}><Plus size={16}/><span className="hidden sm:inline">Novo com IA</span></Button></div></div></header>

    <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-7">
      {error&&<div className="mb-4 flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"><AlertTriangle className="mt-0.5 shrink-0" size={18}/><span className="flex-1">{error}</span><button onClick={()=>setError('')}><X size={17}/></button></div>}
      {notice&&<div className="mb-4 flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800"><CheckCircle2 className="mt-0.5 shrink-0" size={18}/><span className="flex-1">{notice}</span><button onClick={()=>setNotice('')}><X size={17}/></button></div>}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Stat label="Orçamentos" value={stats.total}/><Stat label="Pipeline" value={brl(stats.pipeline)} detail="exclui recusados/vencidos"/><Stat label="Aprovado" value={brl(stats.approved)} tone="good"/><Stat label="Aguardando resposta" value={stats.pending} detail="status enviado"/></section>

      <section className="mt-5 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"><div className="flex flex-col gap-3 lg:flex-row lg:items-center"><div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar número, cliente ou item..." className={`${inputClass} pl-10`}/></div><select value={status} onChange={e=>setStatus(e.target.value)} className={`${inputClass} lg:w-52`}><option value="todos">Todos os status</option>{Object.entries(statusMeta).map(([id,m])=><option key={id} value={id}>{m.label}</option>)}</select></div></section>

      <section className="mt-4 space-y-3">{filtered.length===0?<div className="rounded-3xl border border-dashed border-slate-300 bg-white px-5 py-12 text-center"><FileText className="mx-auto text-slate-300" size={32}/><p className="mt-3 text-sm font-semibold text-slate-700">Nenhum orçamento encontrado</p><p className="mt-1 text-xs text-slate-500">Ajuste os filtros ou crie um novo orçamento por voz/IA.</p><Button onClick={onNew} className="mt-4"><Plus size={16}/>Novo orçamento</Button></div>:filtered.map(q=><button key={q.id} onClick={()=>setSelected(q)} className="block w-full rounded-3xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-emerald-300 hover:shadow-md sm:p-5"><div className="flex flex-col gap-4 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-bold text-slate-900">{q.numero}</span><StatusBadge status={q.status}/>{q.os&&<span className="rounded-full bg-violet-50 px-2 py-0.5 text-[9px] font-bold uppercase text-violet-700">OS {q.os.number}</span>}</div><p className="mt-1 truncate text-sm text-slate-700">{q.cliente?.nome||'Cliente não localizado'}</p><p className="mt-1 line-clamp-1 text-xs text-slate-500">{q.itens.map(i=>i.nome).join(' · ')||'Sem itens'}</p></div><div className="grid grid-cols-2 gap-4 sm:min-w-[280px] sm:grid-cols-3 sm:text-right"><div><p className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Total</p><p className="mt-1 text-sm font-bold text-slate-900">{brl(q.total)}</p></div><div><p className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Margem</p><p className={`mt-1 text-sm font-bold ${q.margem>=0?'text-emerald-700':'text-rose-700'}`}>{q.margemPct.toFixed(1)}%</p></div><div className="col-span-2 sm:col-span-1"><p className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Validade</p><p className="mt-1 text-xs font-semibold text-slate-700">{dateBR(q.validade)}</p></div></div></div></button>)}</section>
    </main>

    {selected&&<QuoteDetail quote={selected} onClose={()=>setSelected(null)} onStatus={changeStatus} onDuplicate={duplicate} onGenerate={q=>setGenerate(q)} busy={busy}/>} 
    {generate&&<GenerateModal quote={generate} equipe={equipe} onClose={()=>setGenerate(null)} onConfirm={confirmGenerate} busy={busy}/>} 
  </div>;
}
