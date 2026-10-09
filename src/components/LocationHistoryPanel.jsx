import React,{useEffect,useState} from 'react';
import {ChevronDown,ChevronUp,Loader2,RotateCcw,ShieldCheck} from 'lucide-react';
import {carregarDetalheHistoricoOSDB,carregarHistoricoAtendimentosDB} from '../lib/locationHistoryApi';

const STATUS={unscheduled:'Aguardando',scheduled:'Agendada',in_progress:'Em andamento',done:'Concluída'};
const brl=(v)=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const data=(v)=>v?new Date(`${String(v).slice(0,10)}T12:00:00`).toLocaleDateString('pt-BR'):'—';
const ring='focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500';

function Detalhe({d,owner,onAbrirOS}){
  const reports=d.reports||[];
  const materials=d.materials||[];
  const items=d.items||[];
  const warranties=d.warranties||[];
  const returns=d.returns||[];
  return <div className="space-y-3 border-t border-slate-100 px-4 pb-4 pt-3 text-[13px] text-slate-600">
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">O que foi feito</p>
      {reports.length===0?<p className="mt-1 text-slate-400">Sem relato técnico registrado.</p>
        :reports.map((r,i)=><p key={i} className="mt-1 whitespace-pre-line break-words">{r.body}{r.author?<span className="text-slate-400"> · {r.author}</span>:null}</p>)}
    </div>
    {(items.length>0||materials.length>0)&&<div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">Serviços e materiais</p>
      <ul className="mt-1 space-y-0.5">
        {items.map((i,k)=><li key={`i${k}`} className="break-words">{i.name} · {Number(i.quantity||0).toLocaleString('pt-BR')} {i.unit||'un'}{owner&&i.unit_price!=null?` × ${brl(i.unit_price)}`:''}</li>)}
        {materials.map((m,k)=><li key={`m${k}`} className="break-words">{m.name} · {Number(m.quantity||0).toLocaleString('pt-BR')}{m.serial_number?` · S/N ${m.serial_number}`:''}</li>)}
      </ul>
    </div>}
    {warranties.length>0&&<div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">Garantias</p>
      <ul className="mt-1 space-y-0.5">{warranties.map((g,k)=><li key={k} className="break-words">{g.description} · até {data(g.ends_on)}</li>)}</ul>
    </div>}
    {returns.length>0&&<div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">Retornos</p>
      <ul className="mt-1 space-y-0.5">{returns.map((t,k)=><li key={k} className="break-words">{t.reason}{t.resolved_at?` · resolvido em ${data(t.resolved_at)}`:' · pendente'}</li>)}</ul>
    </div>}
    <p className="text-slate-500">{Number(d.evidence_count||0)} evidência{Number(d.evidence_count||0)===1?'':'s'} registrada{Number(d.evidence_count||0)===1?'':'s'}{d.viewer?.context==='location'&&Number(d.evidence_count||0)>0?' · arquivos visíveis para o responsável da OS':''}</p>
    {owner&&onAbrirOS&&<button type="button" onClick={()=>onAbrirOS(d.work_order?.id)} className={`min-h-11 text-[13px] font-medium text-teal-800 hover:underline ${ring}`}>Abrir {d.work_order?.number||'OS'}</button>}
  </div>;
}

// Atendimentos anteriores no mesmo local cadastrado (client_locations). O conteúdo vem das RPCs
// do banco; o técnico nunca recebe valores, e o painel só é montado quando ele tem a OS aberta.
export default function LocationHistoryPanel({clientId,locationId=null,currentWorkOrderId=null,owner=false,onAbrirOS,limite=5}){
  const [estado,setEstado]=useState({carregando:true,itens:[],disponivel:true,erro:''});
  const [aberto,setAberto]=useState(null);
  const [detalhes,setDetalhes]=useState({});
  const [todos,setTodos]=useState(false);

  useEffect(()=>{
    let ativo=true;
    setEstado(s=>({...s,carregando:true,erro:''}));setAberto(null);setDetalhes({});setTodos(false);
    carregarHistoricoAtendimentosDB({clientId,locationId})
      .then(r=>{if(ativo) setEstado({carregando:false,erro:'',...r});})
      .catch(e=>{if(ativo) setEstado({carregando:false,itens:[],disponivel:true,erro:e?.message||'Não foi possível carregar o histórico deste local.'});});
    return ()=>{ativo=false;};
  },[clientId,locationId]);

  const alternar=async(id)=>{
    if(aberto===id){setAberto(null);return;}
    setAberto(id);
    if(detalhes[id]?.dados) return;
    setDetalhes(d=>({...d,[id]:{carregando:true}}));
    try{const dados=await carregarDetalheHistoricoOSDB(id);setDetalhes(d=>({...d,[id]:{dados}}));}
    catch(e){setDetalhes(d=>({...d,[id]:{erro:e?.message||'Não foi possível abrir este atendimento.'}}));}
  };

  if(estado.carregando) return <p className="flex items-center gap-2 p-4 text-[13px] text-slate-500"><Loader2 className="h-4 w-4 animate-spin"/>Carregando histórico do local…</p>;
  if(!estado.disponivel) return <p className="p-4 text-[13px] text-slate-500">Histórico por local ainda não disponível neste ambiente.</p>;
  if(estado.erro) return <p className="p-4 text-[13px] text-slate-500">{estado.erro}</p>;

  const itens=estado.itens.filter(i=>i.work_order_id!==currentWorkOrderId);
  if(!itens.length) return <p className="p-4 text-[13px] text-slate-500">Nenhum outro atendimento registrado neste local.</p>;
  const visiveis=todos?itens:itens.slice(0,limite);

  return <div className="divide-y divide-slate-100">
    {visiveis.map(i=>{
      const d=detalhes[i.work_order_id];
      const expandido=aberto===i.work_order_id;
      return <div key={i.work_order_id}>
        <button type="button" onClick={()=>alternar(i.work_order_id)} aria-expanded={expandido} className={`flex w-full min-h-11 items-start justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50 ${ring}`}>
          <div className="min-w-0">
            <p className="text-[14px] font-medium text-slate-800">{i.number} <span className="font-normal text-slate-400">· {data(i.service_date)}</span></p>
            <p className="break-words text-[12.5px] text-slate-500">{i.title}{i.location?.name?` · ${i.location.name}`:''}</p>
            <p className="text-[12px] text-slate-400">{[STATUS[i.status]||i.status,i.completed_by||i.technician].filter(Boolean).join(' · ')}</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {i.is_warranty_visit&&<span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2 py-0.5 text-[11px] font-medium text-teal-800"><ShieldCheck className="h-3 w-3"/>Garantia</span>}
              {i.needs_return&&<span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800"><RotateCcw className="h-3 w-3"/>Precisa retornar</span>}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {owner&&i.billed_amount!=null&&<span className="text-right text-[13px] tabular-nums text-slate-700">{brl(i.billed_amount)}<span className="block text-[11px] text-slate-400">{i.paid?'recebido':'a receber'}</span></span>}
            {expandido?<ChevronUp className="h-4 w-4 text-slate-400"/>:<ChevronDown className="h-4 w-4 text-slate-400"/>}
          </div>
        </button>
        {expandido&&(d?.carregando?<p className="flex items-center gap-2 px-4 pb-4 text-[13px] text-slate-500"><Loader2 className="h-4 w-4 animate-spin"/>Abrindo atendimento…</p>
          :d?.erro?<p className="px-4 pb-4 text-[13px] text-rose-700">{d.erro}</p>
          :d?.dados?<Detalhe d={d.dados} owner={owner} onAbrirOS={onAbrirOS}/>:null)}
      </div>;
    })}
    {itens.length>limite&&<button type="button" onClick={()=>setTodos(v=>!v)} className={`w-full min-h-11 px-4 py-2 text-[13px] font-medium text-teal-800 hover:bg-slate-50 ${ring}`}>{todos?'Mostrar menos':`Ver todos (${itens.length})`}</button>}
  </div>;
}
