import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownRight, ArrowLeft, ArrowUpRight, Banknote, CalendarDays, ChevronLeft,
  ChevronRight, CircleDollarSign, Clock3, Loader2, RefreshCcw, ShieldCheck,
  TrendingUp, TriangleAlert, Wallet, X,
} from 'lucide-react';
import { carregarFinanceiroV2DB } from '../../lib/financeV2Api';
import { mensagemErro } from '../../lib/supabase';

const brl=(v)=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const hoje=()=>new Date().toISOString().slice(0,10);
const mesAtual=()=>hoje().slice(0,7);
const dataBR=(v)=>v?v.split('-').reverse().join('/'):'—';
const mesNome=(m)=>{const [a,n]=m.split('-');return `${['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'][Number(n)-1]} de ${a}`;};
const mudarMes=(m,delta)=>{const [a,n]=m.split('-').map(Number);const d=new Date(a,n-1+delta,1,12);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;};
const noMes=(date,month)=>String(date||'').slice(0,7)===month;
const addDays=(base,days)=>{const d=new Date(`${base}T12:00:00`);d.setDate(d.getDate()+days);return d.toISOString().slice(0,10);};

function Btn({children,onClick,disabled=false,variant='secondary'}){const cls=variant==='primary'?'bg-emerald-700 text-white hover:bg-emerald-800':'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50';return <button type="button" onClick={onClick} disabled={disabled} className={`inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold transition disabled:opacity-50 ${cls}`}>{children}</button>;}
function Kpi({label,value,detail,icon:Icon,tone='normal'}){const toneClass=tone==='good'?'text-emerald-700':tone==='bad'?'text-rose-700':'text-slate-900';return <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p><p className={`mt-1 truncate text-xl font-bold ${toneClass}`}>{value}</p>{detail&&<p className="mt-1 text-[11px] leading-relaxed text-slate-500">{detail}</p>}</div><div className="rounded-xl bg-slate-50 p-2.5 text-slate-500"><Icon size={18}/></div></div></div>;}

export default function FinanceV2({companyId,companyName='Sua empresa',onClose}){
  const [month,setMonth]=useState(mesAtual());
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [data,setData]=useState({clientes:[],ordens:[],lancamentos:[],custosProntos:false});

  const load=async()=>{setLoading(true);setError('');try{setData(await carregarFinanceiroV2DB(companyId));}catch(e){setError(mensagemErro(e));}finally{setLoading(false);}};
  useEffect(()=>{load();},[companyId]);

  const clientMap=useMemo(()=>new Map(data.clientes.map(c=>[c.id,c.nome])),[data.clientes]);
  const metrics=useMemo(()=>{
    const due=data.lancamentos.filter(x=>noMes(x.vencimento,month));
    const receitas=due.filter(x=>x.tipo==='receita');
    const despesas=due.filter(x=>x.tipo==='despesa');
    const faturado=receitas.reduce((t,x)=>t+x.valor,0);
    const recebido=data.lancamentos.filter(x=>x.tipo==='receita'&&x.pago&&noMes(x.pagoEm||x.vencimento,month)).reduce((t,x)=>t+x.valor,0);
    const receber=receitas.filter(x=>!x.pago).reduce((t,x)=>t+x.valor,0);
    const despesaCompetencia=despesas.reduce((t,x)=>t+x.valor,0);
    const despesaPaga=data.lancamentos.filter(x=>x.tipo==='despesa'&&x.pago&&noMes(x.pagoEm||x.vencimento,month)).reduce((t,x)=>t+x.valor,0);
    const vencidos=data.lancamentos.filter(x=>!x.pago&&x.vencimento&&x.vencimento<hoje());
    const vencidoReceber=vencidos.filter(x=>x.tipo==='receita').reduce((t,x)=>t+x.valor,0);
    const vencidoPagar=vencidos.filter(x=>x.tipo==='despesa').reduce((t,x)=>t+x.valor,0);
    const caixa=recebido-despesaPaga;
    const origem={os:0,manual:0,compra:0};receitas.forEach(x=>{origem[x.origem]=(origem[x.origem]||0)+x.valor;});
    const proj=(days)=>data.lancamentos.filter(x=>!x.pago&&x.vencimento>=hoje()&&x.vencimento<=addDays(hoje(),days)).reduce((t,x)=>t+(x.tipo==='receita'?x.valor:-x.valor),0);
    return {faturado,recebido,receber,despesaCompetencia,despesaPaga,caixa,vencidoReceber,vencidoPagar,origem,proj7:proj(7),proj30:proj(30),proj60:proj(60)};
  },[data.lancamentos,month]);

  const osProfit=useMemo(()=>{
    const revenue=new Map();data.lancamentos.filter(x=>x.tipo==='receita'&&x.osId).forEach(x=>revenue.set(x.osId,(revenue.get(x.osId)||0)+x.valor));
    return data.ordens.map(os=>{const receita=revenue.get(os.id)||0;const custo=data.custosProntos?Number(os.custoTotal||0):null;const resultado=custo==null?null:receita-custo;const margem=resultado==null||receita<=0?null:(resultado/receita)*100;return {...os,receita,custo,resultado,margem,cliente:clientMap.get(os.clienteId)||'Cliente'};}).filter(os=>noMes(os.concluidaEm||os.data,month)||os.receita>0).sort((a,b)=>(b.receita||0)-(a.receita||0));
  },[data.ordens,data.lancamentos,data.custosProntos,clientMap,month]);

  const recent=useMemo(()=>data.lancamentos.filter(x=>noMes(x.vencimento,month)).sort((a,b)=>String(b.vencimento).localeCompare(String(a.vencimento))).slice(0,12),[data.lancamentos,month]);

  return <div className="min-h-screen bg-slate-50 text-slate-900">
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur"><div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6"><div className="flex min-w-0 items-center gap-3"><button onClick={onClose} className="rounded-xl border border-slate-200 p-2.5 text-slate-600 hover:bg-slate-50"><ArrowLeft size={19}/></button><div><div className="flex items-center gap-2"><h1 className="text-base font-bold">Financeiro</h1><span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">V2</span></div><p className="text-xs text-slate-500">{companyName}</p></div></div><Btn onClick={load} disabled={loading}><RefreshCcw size={16}/><span className="hidden sm:inline">Atualizar</span></Btn></div></header>

    <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-7">
      <div className="mb-5 rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4"><div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 shrink-0 text-emerald-700" size={20}/><div><p className="text-sm font-bold text-emerald-950">Financeiro exclusivo do proprietário</p><p className="mt-1 text-xs leading-relaxed text-emerald-800">Lançamentos financeiros já são protegidos por RLS owner-only. A margem por OS só usa os ledgers privados de custo das migrations 0053–0054; nenhum custo é lido da parte pública da OS.</p></div></div></div>
      {error&&<div className="mb-5 flex gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"><TriangleAlert size={18}/><div className="flex-1">{error}</div><button onClick={()=>setError('')}><X size={17}/></button></div>}

      <div className="mb-5 flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-2 shadow-sm sm:inline-flex"><button onClick={()=>setMonth(mudarMes(month,-1))} className="rounded-xl p-2.5 text-slate-500 hover:bg-slate-50"><ChevronLeft size={18}/></button><div className="min-w-[170px] px-3 text-center"><p className="text-xs font-bold text-slate-900">{mesNome(month)}</p><input type="month" value={month} onChange={e=>e.target.value&&setMonth(e.target.value)} className="mt-0.5 bg-transparent text-[10px] text-slate-400 outline-none"/></div><button onClick={()=>setMonth(mudarMes(month,1))} className="rounded-xl p-2.5 text-slate-500 hover:bg-slate-50"><ChevronRight size={18}/></button></div>

      {loading?<div className="flex min-h-[45vh] items-center justify-center text-slate-500"><Loader2 className="mr-2 animate-spin" size={20}/>Carregando financeiro...</div>:<>
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Kpi icon={CircleDollarSign} label="Faturado" value={brl(metrics.faturado)} detail="receitas com vencimento no mês"/><Kpi icon={ArrowDownRight} label="Recebido" value={brl(metrics.recebido)} detail="entrada efetiva no mês" tone="good"/><Kpi icon={Clock3} label="A receber" value={brl(metrics.receber)} detail="ainda em aberto neste mês"/><Kpi icon={ArrowUpRight} label="Despesas" value={brl(metrics.despesaCompetencia)} detail={`${brl(metrics.despesaPaga)} já pago`} tone={metrics.despesaCompetencia>0?'bad':'normal'}/></section>

        <section className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4"><Kpi icon={Wallet} label="Resultado de caixa" value={brl(metrics.caixa)} detail="recebido menos despesas pagas" tone={metrics.caixa>=0?'good':'bad'}/><Kpi icon={TriangleAlert} label="Clientes vencidos" value={brl(metrics.vencidoReceber)} detail="total em atraso até hoje" tone={metrics.vencidoReceber>0?'bad':'normal'}/><Kpi icon={Banknote} label="Contas vencidas" value={brl(metrics.vencidoPagar)} detail="despesas em atraso" tone={metrics.vencidoPagar>0?'bad':'normal'}/><Kpi icon={TrendingUp} label="Origem OS" value={brl(metrics.origem.os||0)} detail="receita do mês ligada a ordens"/></section>

        <div className="mt-5 grid gap-5 xl:grid-cols-[0.75fr_1.25fr]">
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-bold uppercase tracking-wide text-slate-400">Projeção de caixa</p><div className="mt-4 space-y-3">{[[7,metrics.proj7],[30,metrics.proj30],[60,metrics.proj60]].map(([days,val])=><div key={days} className="flex items-center justify-between rounded-2xl bg-slate-50 p-4"><div className="flex items-center gap-3"><div className="rounded-xl bg-white p-2 text-slate-500"><CalendarDays size={17}/></div><div><p className="text-sm font-bold">Próximos {days} dias</p><p className="text-[11px] text-slate-500">recebíveis menos pagamentos em aberto</p></div></div><strong className={`text-sm ${val>=0?'text-emerald-700':'text-rose-700'}`}>{brl(val)}</strong></div>)}</div><div className="mt-5 border-t border-slate-100 pt-4"><p className="text-xs font-bold uppercase tracking-wide text-slate-400">Receita por origem</p><div className="mt-3 space-y-2 text-sm"><div className="flex justify-between"><span className="text-slate-500">Ordens de serviço</span><strong>{brl(metrics.origem.os||0)}</strong></div><div className="flex justify-between"><span className="text-slate-500">Manual / outros</span><strong>{brl(metrics.origem.manual||0)}</strong></div></div></div></section>

          <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"><div className="flex items-center justify-between border-b border-slate-100 p-5"><div><p className="text-xs font-bold uppercase tracking-wide text-slate-400">Rentabilidade por OS</p><p className="mt-1 text-xs text-slate-500">Receita lançada × custo privado real</p></div>{data.custosProntos?<span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700">Custos protegidos ativos</span>:<span className="rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-bold text-amber-700">Aguardando 0053–0054</span>}</div>
            {!data.custosProntos?<div className="m-5 rounded-2xl border border-amber-200 bg-amber-50 p-4"><p className="text-sm font-bold text-amber-900">Margem bloqueada no preview atual</p><p className="mt-1 text-xs leading-relaxed text-amber-800">Isso é proposital: enquanto os ledgers privados não estiverem homologados no banco, esta tela não usa `unit_cost` nem `extra_cost` das tabelas que o técnico pode consultar.</p></div>:osProfit.length===0?<div className="p-12 text-center text-sm text-slate-500">Nenhuma OS com movimento neste mês.</div>:<div className="divide-y divide-slate-100">{osProfit.slice(0,10).map(os=><div key={os.id} className="p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-bold">OS #{os.numero}</p><p className="mt-1 text-xs text-slate-500">{os.cliente} · {dataBR(os.concluidaEm||os.data)}</p></div><div className="text-right"><p className={`text-sm font-bold ${(os.resultado||0)>=0?'text-emerald-700':'text-rose-700'}`}>{brl(os.resultado)}</p><p className="text-[10px] text-slate-400">{os.margem==null?'sem receita':`${os.margem.toFixed(1)}% margem`}</p></div></div><div className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-3 text-xs"><div><p className="text-[9px] font-bold uppercase text-slate-400">Receita</p><p className="mt-0.5 font-semibold">{brl(os.receita)}</p></div><div><p className="text-[9px] font-bold uppercase text-slate-400">Custo</p><p className="mt-0.5 font-semibold">{brl(os.custo)}</p></div><div><p className="text-[9px] font-bold uppercase text-slate-400">Resultado</p><p className="mt-0.5 font-semibold">{brl(os.resultado)}</p></div></div></div>)}</div>}
          </section>
        </div>

        <section className="mt-5 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-100 p-5"><p className="text-xs font-bold uppercase tracking-wide text-slate-400">Movimentos do mês</p><p className="mt-1 text-xs text-slate-500">Contas a receber e a pagar por vencimento</p></div>{recent.length===0?<div className="p-12 text-center text-sm text-slate-500">Nenhum lançamento neste mês.</div>:<div className="divide-y divide-slate-100">{recent.map(x=><div key={x.id} className="flex items-center gap-3 p-4 sm:px-5"><div className={`rounded-xl p-2 ${x.tipo==='receita'?'bg-emerald-50 text-emerald-700':'bg-rose-50 text-rose-700'}`}>{x.tipo==='receita'?<ArrowDownRight size={17}/>:<ArrowUpRight size={17}/>}</div><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{x.descricao}</p><p className="mt-0.5 truncate text-[11px] text-slate-500">{clientMap.get(x.clienteId)||x.categoria||'Sem categoria'} · vence {dataBR(x.vencimento)} · {x.pago?'pago':'em aberto'}</p></div><strong className={`shrink-0 text-sm ${x.tipo==='receita'?'text-emerald-700':'text-rose-700'}`}>{x.tipo==='receita'?'+':'−'} {brl(x.valor)}</strong></div>)}</div>}</section>
      </>}
    </main>
  </div>;
}
