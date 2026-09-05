import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {
  AlertTriangle,ArrowLeft,CalendarDays,Camera,CheckCircle2,Clock3,FileText,History,
  MapPin,Mic,MicOff,Package,RefreshCw,Search,ShieldCheck,Upload,Video,Wrench,X,
} from 'lucide-react';
import useSpeechInput from '../../hooks/useSpeechInput';
import {
  STAGE_LABEL,carregarDetalheMemoriaOSV2DB,carregarMemoriasOSV2DB,
  enviarEvidenciaOSV2DB,salvarRelatoTecnicoV2DB,
} from '../../lib/workOrderMemoryV2Api';

const money=(v)=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const date=(v)=>v?new Date(`${String(v).slice(0,10)}T12:00:00`).toLocaleDateString('pt-BR'):'—';
const dateTime=(v)=>v?new Date(v).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'}):'—';
const openStatus=new Set(['unscheduled','scheduled','in_progress']);
const statusTone={
  unscheduled:'bg-slate-400/10 text-slate-300',scheduled:'bg-sky-400/10 text-sky-300',
  in_progress:'bg-amber-400/10 text-amber-300',done:'bg-emerald-400/10 text-emerald-300',
  canceled:'bg-rose-400/10 text-rose-300',
};
const stages=['before','during','after','equipment','video'];

function Empty({children}){return <div className="rounded-3xl border border-dashed border-white/10 px-5 py-10 text-center text-sm text-slate-500">{children}</div>;}

export default function WorkOrderMemoryV2({companyId,companyName='Sua empresa',userId,owner=false,onClose}){
  const [rows,setRows]=useState([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [query,setQuery]=useState('');
  const [filter,setFilter]=useState('all');
  const [selected,setSelected]=useState(null);
  const [detail,setDetail]=useState(null);
  const [detailLoading,setDetailLoading]=useState(false);
  const [report,setReport]=useState('');
  const [interim,setInterim]=useState('');
  const [savingReport,setSavingReport]=useState(false);
  const [stage,setStage]=useState('before');
  const [caption,setCaption]=useState('');
  const [file,setFile]=useState(null);
  const [uploading,setUploading]=useState(false);
  const fileRef=useRef(null);

  const load=useCallback(async()=>{
    setLoading(true);setError('');
    try{setRows(await carregarMemoriasOSV2DB(companyId));}
    catch(e){setError(e?.message||'Não consegui carregar o histórico das OS.');}
    finally{setLoading(false);}
  },[companyId]);

  const loadDetail=useCallback(async(id)=>{
    if(!id){setDetail(null);return;}
    setDetailLoading(true);setError('');
    try{setDetail(await carregarDetalheMemoriaOSV2DB(companyId,id));}
    catch(e){setError(e?.message||'Não consegui abrir a memória técnica desta OS.');setDetail(null);}
    finally{setDetailLoading(false);}
  },[companyId]);

  useEffect(()=>{load();},[load]);
  useEffect(()=>{if(selected) loadDetail(selected);},[selected,loadDetail]);

  const speech=useSpeechInput({onText:({finalText,interimText})=>{
    setInterim(interimText||'');
    if(finalText) setReport(prev=>`${prev}${prev.trim()?' ':''}${finalText}`.slice(0,10000));
  }});

  const filtered=useMemo(()=>{
    const q=query.trim().toLowerCase();
    return rows.filter(r=>{
      if(filter==='open'&&!openStatus.has(r.status)) return false;
      if(filter==='done'&&r.status!=='done') return false;
      if(filter==='return'&&!r.needs_return) return false;
      return !q||r.search_text.includes(q);
    });
  },[rows,query,filter]);

  const counts=useMemo(()=>({
    open:rows.filter(r=>openStatus.has(r.status)).length,
    done:rows.filter(r=>r.status==='done').length,
    return:rows.filter(r=>r.needs_return).length,
  }),[rows]);

  const canWrite=detail?.workOrder&&(owner||openStatus.has(detail.workOrder.status));
  const selectedRow=rows.find(r=>r.id===selected);

  const saveReport=async()=>{
    if(!detail?.workOrder||!report.trim()) return;
    setSavingReport(true);setError('');
    try{
      const created=await salvarRelatoTecnicoV2DB({workOrder:detail.workOrder,body:report,userId});
      setDetail(d=>({...d,reports:[...(d?.reports||[]),created]}));
      setReport('');setInterim('');
      await load();
    }catch(e){setError(e?.message||'Não consegui salvar o relato técnico.');}
    finally{setSavingReport(false);}
  };

  const upload=async()=>{
    if(!detail?.workOrder||!file) return;
    setUploading(true);setError('');
    try{
      const created=await enviarEvidenciaOSV2DB({workOrder:detail.workOrder,file,companyId,userId,stage,caption});
      setDetail(d=>({...d,media:[...(d?.media||[]),created]}));
      setFile(null);setCaption('');if(fileRef.current) fileRef.current.value='';
    }catch(e){setError(e?.message||'Não consegui enviar a evidência.');}
    finally{setUploading(false);}
  };

  const maps=(address)=>{if(!address)return;window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`,'_blank','noopener,noreferrer');};

  return <div className="min-h-screen bg-slate-950 text-white">
    <header className="sticky top-0 z-30 border-b border-white/10 bg-slate-950/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <button onClick={selected?()=>setSelected(null):onClose} className="rounded-xl border border-white/10 bg-white/5 p-2.5 text-slate-300 hover:bg-white/10" aria-label="Voltar"><ArrowLeft size={19}/></button>
          <div className="min-w-0"><div className="flex items-center gap-2"><h1 className="truncate text-base font-bold">Memória técnica da OS</h1><span className="rounded-full bg-emerald-400/10 px-2 py-0.5 text-[9px] font-bold text-emerald-300">V2</span></div><p className="truncate text-xs text-slate-500">{selectedRow?`${selectedRow.number} · ${selectedRow.client?.name||'Cliente'}`:companyName}</p></div>
        </div>
        <button onClick={()=>selected?loadDetail(selected):load()} className="rounded-xl border border-white/10 bg-white/5 p-2.5 text-slate-300 hover:bg-white/10" aria-label="Atualizar"><RefreshCw size={18}/></button>
      </div>
    </header>

    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      {error&&<div className="mb-4 flex items-start gap-3 rounded-2xl border border-rose-400/20 bg-rose-400/10 p-4 text-sm text-rose-200"><AlertTriangle className="mt-0.5 shrink-0" size={17}/><span>{error}</span><button onClick={()=>setError('')} className="ml-auto"><X size={16}/></button></div>}

      {!selected&&<>
        <section className="rounded-[28px] border border-white/10 bg-gradient-to-br from-emerald-400/10 via-white/[0.035] to-transparent p-5 sm:p-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between"><div className="max-w-2xl"><div className="flex items-center gap-2 text-emerald-300"><History size={18}/><span className="text-xs font-bold uppercase tracking-[.16em]">Histórico técnico pesquisável</span></div><h2 className="mt-3 text-2xl font-bold tracking-tight">Cada OS vira memória do cliente.</h2><p className="mt-2 text-sm leading-relaxed text-slate-400">Relatos, materiais, equipamentos e evidências de campo ficam vinculados à OS. Esta área não carrega custo, margem, fornecedor ou financeiro.</p></div><div className="grid grid-cols-3 gap-2 lg:w-[360px]"><div className="rounded-2xl border border-white/10 bg-black/10 p-3"><p className="text-[10px] uppercase text-slate-500">Abertas</p><p className="mt-1 text-xl font-bold">{counts.open}</p></div><div className="rounded-2xl border border-white/10 bg-black/10 p-3"><p className="text-[10px] uppercase text-slate-500">Concluídas</p><p className="mt-1 text-xl font-bold">{counts.done}</p></div><div className="rounded-2xl border border-white/10 bg-black/10 p-3"><p className="text-[10px] uppercase text-slate-500">Retorno</p><p className="mt-1 text-xl font-bold">{counts.return}</p></div></div></div>
        </section>

        <section className="mt-5 flex flex-col gap-3 sm:flex-row"><div className="relative flex-1"><Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-600" size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar OS, cliente, endereço ou relato..." className="w-full rounded-2xl border border-white/10 bg-white/[0.045] py-3 pl-10 pr-4 text-sm outline-none placeholder:text-slate-600 focus:border-emerald-400/30"/></div><div className="flex gap-2 overflow-x-auto pb-1">{[['all','Todas'],['open','Abertas'],['done','Concluídas'],['return','Retorno']].map(([id,label])=><button key={id} onClick={()=>setFilter(id)} className={`whitespace-nowrap rounded-xl px-3.5 py-2.5 text-xs font-bold ${filter===id?'bg-emerald-500 text-slate-950':'border border-white/10 bg-white/[0.04] text-slate-400'}`}>{label}</button>)}</div></section>

        <section className="mt-5 space-y-3">{loading?<Empty>Carregando histórico técnico...</Empty>:filtered.length===0?<Empty>Nenhuma OS encontrada com esse filtro.</Empty>:filtered.map(w=><button key={w.id} onClick={()=>setSelected(w.id)} className="w-full rounded-3xl border border-white/10 bg-white/[0.04] p-5 text-left transition hover:border-emerald-400/25 hover:bg-emerald-400/[0.055]"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-bold text-white">{w.number}</span><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${statusTone[w.status]||'bg-white/5 text-slate-300'}`}>{w.status_label}</span>{w.needs_return&&<span className="rounded-full bg-amber-400/10 px-2 py-0.5 text-[10px] font-bold text-amber-300">Precisa voltar</span>}</div><p className="mt-1 text-sm text-slate-300">{w.client?.name||'Cliente'}</p></div><div className="text-right text-xs text-slate-500"><p>{w.scheduled_date?date(w.scheduled_date):date(w.created_at)}</p><p className="mt-1">{w.reports.length} relato{w.reports.length===1?'':'s'}</p></div></div><div className="mt-4 grid gap-2 text-xs text-slate-500 sm:grid-cols-2">{w.service_place&&<div className="flex items-center gap-2"><MapPin size={14}/><span className="truncate">{w.service_place}</span></div>}{w.request&&<div className="flex items-center gap-2"><Wrench size={14}/><span className="truncate">{w.request}</span></div>}</div></button>)}</section>
      </>}

      {selected&&<>{detailLoading||!detail?<Empty>Carregando memória da OS...</Empty>:<div className="grid gap-5 xl:grid-cols-[1.05fr_.95fr]">
        <div className="space-y-5">
          <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><h2 className="text-xl font-bold">{detail.workOrder.number}</h2><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${statusTone[detail.workOrder.status]}`}>{detail.workOrder.status_label}</span></div><p className="mt-1 text-sm text-slate-400">{detail.workOrder.client?.name||'Cliente'}</p></div>{detail.workOrder.status==='done'&&<div className="flex items-center gap-2 rounded-xl bg-emerald-400/10 px-3 py-2 text-xs font-bold text-emerald-300"><CheckCircle2 size={15}/>Memória concluída</div>}</div><div className="mt-5 grid gap-3 sm:grid-cols-2"><div className="rounded-2xl bg-black/15 p-4"><div className="flex items-center gap-2 text-xs font-bold text-slate-400"><CalendarDays size={14}/>Atendimento</div><p className="mt-2 text-sm">{date(detail.workOrder.scheduled_date||detail.workOrder.created_at)} {detail.workOrder.scheduled_time?`· ${String(detail.workOrder.scheduled_time).slice(0,5)}`:''}</p></div><button onClick={()=>maps(detail.workOrder.address||detail.workOrder.client?.address)} disabled={!(detail.workOrder.address||detail.workOrder.client?.address)} className="rounded-2xl bg-black/15 p-4 text-left disabled:opacity-50"><div className="flex items-center gap-2 text-xs font-bold text-slate-400"><MapPin size={14}/>Local</div><p className="mt-2 line-clamp-2 text-sm">{detail.workOrder.service_place||detail.workOrder.address||detail.workOrder.client?.address||'Não informado'}</p></button></div>{detail.workOrder.request&&<div className="mt-4 rounded-2xl border border-white/10 p-4"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Solicitação</p><p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-300">{detail.workOrder.request}</p></div>}{detail.workOrder.pre_notes&&<div className="mt-3 rounded-2xl border border-white/10 p-4"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Observações iniciais</p><p className="mt-2 whitespace-pre-wrap text-sm text-slate-400">{detail.workOrder.pre_notes}</p></div>}</section>

          <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-5"><div className="flex items-center gap-2"><Package className="text-emerald-300" size={18}/><h3 className="text-sm font-bold">Serviços, produtos e materiais</h3></div><div className="mt-4 space-y-2">{detail.items.length===0&&detail.materials.length===0?<p className="text-sm text-slate-500">Nenhum item registrado.</p>:<>{detail.items.map(i=><div key={i.id} className="flex items-center justify-between gap-3 rounded-2xl bg-black/15 px-4 py-3"><div><p className="text-sm font-semibold">{i.name}</p><p className="mt-0.5 text-[11px] text-slate-500">{Number(i.quantity||0)} {i.unit||'unidade'}{i.is_extra?' · adicional':''}</p></div><span className="text-xs text-slate-400">{i.price_pending?'Valor pendente':money(Number(i.quantity||0)*Number(i.unit_price||0))}</span></div>)}{detail.materials.map(m=><div key={m.id} className="flex items-center justify-between gap-3 rounded-2xl bg-black/15 px-4 py-3"><div><p className="text-sm font-semibold">{m.name}</p><p className="mt-0.5 text-[11px] text-slate-500">Material · qtd. {Number(m.quantity||0)}</p></div>{m.serial_number&&<span className="text-[11px] text-slate-400">S/N {m.serial_number}</span>}</div>)}</>}</div><p className="mt-4 flex items-center gap-2 text-[11px] text-emerald-300/70"><ShieldCheck size={14}/>Nenhum custo interno ou margem é carregado nesta tela.</p></section>

          <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-5"><div className="flex items-center gap-2"><FileText className="text-sky-300" size={18}/><h3 className="text-sm font-bold">Relato técnico</h3></div>{canWrite?<><div className="relative mt-4"><textarea rows={6} value={report} onChange={e=>setReport(e.target.value.slice(0,10000))} placeholder="Descreva o que foi encontrado, o que foi feito, testes realizados e pendências..." className="w-full resize-y rounded-2xl border border-white/10 bg-black/15 p-4 pr-14 text-sm leading-relaxed outline-none placeholder:text-slate-600 focus:border-sky-400/30"/><button type="button" onClick={speech.listening?speech.stop:speech.start} className={`absolute right-3 top-3 rounded-xl p-2.5 ${speech.listening?'bg-rose-500 text-white':'bg-white/10 text-sky-300'}`} title={speech.listening?'Parar ditado':'Ditar relato'}>{speech.listening?<MicOff size={18}/>:<Mic size={18}/>}</button></div>{interim&&<p className="mt-2 text-xs italic text-slate-500">Ouvindo: {interim}</p>}{speech.error&&<p className="mt-2 text-xs text-amber-300">{speech.error}</p>}<div className="mt-3 flex items-center justify-between gap-3"><span className="text-[11px] text-slate-600">{report.length}/10.000</span><button onClick={saveReport} disabled={savingReport||!report.trim()} className="rounded-xl bg-sky-500 px-4 py-2.5 text-xs font-bold text-slate-950 disabled:opacity-40">{savingReport?'Salvando...':'Salvar relato'}</button></div></>:<p className="mt-4 rounded-2xl bg-black/15 p-4 text-sm text-slate-500">OS concluída/cancelada: o técnico consulta o histórico, mas não altera o relato. O proprietário pode complementar a memória quando necessário.</p>}</section>

          <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-5"><div className="flex items-center gap-2"><History className="text-violet-300" size={18}/><h3 className="text-sm font-bold">Linha do tempo</h3></div><div className="mt-4 space-y-3">{detail.reports.length===0?<p className="text-sm text-slate-500">Nenhum relato ainda.</p>:detail.reports.map(r=><div key={r.id} className="border-l border-white/10 pl-4"><div className="flex items-center gap-2"><span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase ${r.entry_type==='report'?'bg-sky-400/10 text-sky-300':'bg-white/5 text-slate-400'}`}>{r.entry_type==='report'?'Relato':'Histórico'}</span><span className="text-[10px] text-slate-600">{dateTime(r.created_at)}</span></div><p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-400">{r.body}</p></div>)}</div></section>
        </div>

        <div className="space-y-5">
          <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-5"><div className="flex items-center gap-2"><Camera className="text-emerald-300" size={18}/><h3 className="text-sm font-bold">Evidências de campo</h3></div>{!detail.mediaMigrationReady&&<div className="mt-4 flex gap-3 rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4 text-xs leading-relaxed text-amber-200"><AlertTriangle className="shrink-0" size={16}/><span>Fotos antigas continuam visíveis. Novas categorias e vídeo dependem da migration 0061, que permanece fora da produção durante a homologação.</span></div>}{detail.media.length===0?<div className="mt-4"><Empty>Nenhuma evidência registrada nesta OS.</Empty></div>:<div className="mt-4 grid grid-cols-2 gap-3">{detail.media.map(m=><a key={m.id} href={m.url||undefined} target="_blank" rel="noreferrer" className="overflow-hidden rounded-2xl border border-white/10 bg-black/20">{m.media_kind==='video'?<video src={m.url||undefined} className="aspect-square w-full object-cover" controls preload="metadata"/>:<img src={m.url||undefined} alt={m.caption||m.file_name} className="aspect-square w-full object-cover"/>}<div className="p-3"><div className="flex items-center gap-1.5 text-[10px] font-bold uppercase text-emerald-300">{m.media_kind==='video'?<Video size={12}/>:<Camera size={12}/>} {STAGE_LABEL[m.media_stage]||m.category||'Evidência'}</div>{m.caption&&<p className="mt-1 line-clamp-2 text-xs text-slate-400">{m.caption}</p>}</div></a>)}</div>}</section>

          <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-5"><div className="flex items-center gap-2"><Upload className="text-amber-300" size={18}/><h3 className="text-sm font-bold">Adicionar evidência</h3></div>{canWrite?<><div className="mt-4 flex flex-wrap gap-2">{stages.map(s=><button key={s} onClick={()=>{setStage(s);setFile(null);if(fileRef.current)fileRef.current.value='';}} className={`rounded-xl px-3 py-2 text-[11px] font-bold ${stage===s?'bg-amber-400 text-slate-950':'border border-white/10 bg-white/[0.04] text-slate-400'}`}>{STAGE_LABEL[s]}</button>)}</div><label className="mt-4 flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-black/10 px-4 py-7 text-center hover:border-amber-400/30"><input ref={fileRef} type="file" className="hidden" accept={stage==='video'?'video/mp4,video/quicktime,video/webm':"image/jpeg,image/png,image/webp,image/heic,image/heif"} onChange={e=>setFile(e.target.files?.[0]||null)}/>{stage==='video'?<Video className="text-amber-300" size={25}/>:<Camera className="text-amber-300" size={25}/>}<p className="mt-2 text-sm font-semibold">{file?file.name:(stage==='video'?'Selecionar vídeo curto':'Selecionar foto')}</p><p className="mt-1 text-[11px] text-slate-600">{stage==='video'?'MP4, MOV ou WEBM · até 30 MB':'JPG, PNG, WEBP, HEIC/HEIF · até 15 MB'}</p></label><input value={caption} onChange={e=>setCaption(e.target.value.slice(0,1000))} placeholder="Legenda opcional: equipamento, teste, detalhe observado..." className="mt-3 w-full rounded-xl border border-white/10 bg-black/15 px-3.5 py-3 text-sm outline-none placeholder:text-slate-600 focus:border-amber-400/30"/><button onClick={upload} disabled={!file||uploading||!detail.mediaMigrationReady} className="mt-3 w-full rounded-xl bg-amber-400 py-3 text-xs font-bold text-slate-950 disabled:opacity-40">{uploading?'Enviando evidência...':'Enviar evidência'}</button></>:<p className="mt-4 rounded-2xl bg-black/15 p-4 text-sm text-slate-500">A OS está concluída ou cancelada. A evidência permanece disponível para consulta.</p>}</section>

          <section className="rounded-3xl border border-emerald-400/15 bg-emerald-400/[0.055] p-5"><div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 shrink-0 text-emerald-300" size={19}/><div><p className="text-sm font-bold text-emerald-200">Memória protegida por empresa</p><p className="mt-2 text-xs leading-relaxed text-emerald-100/60">O bucket é privado, links expiram, a FK exige a mesma empresa da OS e o técnico só lê anexos da própria OS. Exclusão de evidência continua reservada ao proprietário.</p></div></div></section>
        </div>
      </div>}</>}
    </main>
  </div>;
}
