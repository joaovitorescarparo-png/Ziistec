import React, { useEffect, useMemo, useState } from 'react';
import { carregarPlataformaDB, mudarStatusPlataformaDB } from '../lib/platformApi';
import { mensagemErro } from '../lib/supabase';

const brl=(v)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v||0));
const label={trial:'Trial',ativa:'Ativa',pendente:'Pendente',suspensa:'Suspensa',cancelada:'Cancelada'};
const badge={trial:'bg-sky-50 text-sky-800',ativa:'bg-emerald-50 text-emerald-800',pendente:'bg-amber-50 text-amber-800',suspensa:'bg-orange-50 text-orange-800',cancelada:'bg-slate-100 text-slate-600'};

export default function PlatformAdmin({ perfil, sair }){
  const [dados,setDados]=useState({empresas:[],auditoria:[]});
  const [busca,setBusca]=useState('');
  const [erro,setErro]=useState(null);
  const [ocupado,setOcupado]=useState(null);
  const carregar=async()=>{try{setErro(null);setDados(await carregarPlataformaDB());}catch(e){setErro(mensagemErro(e));}};
  useEffect(()=>{carregar();},[]);
  const lista=useMemo(()=>dados.empresas.filter(e=>(e.nome+' '+e.responsavel+' '+e.email).toLowerCase().includes(busca.toLowerCase())),[dados.empresas,busca]);
  const ativas=dados.empresas.filter(e=>e.assinatura?.status==='ativa').length;
  const trials=dados.empresas.filter(e=>e.assinatura?.status==='trial').length;
  const mrr=dados.empresas.filter(e=>e.assinatura?.status==='ativa').reduce((t,e)=>t+Number(e.assinatura?.valor||0),0);
  const mudar=async(e,status)=>{try{setOcupado(e.id);await mudarStatusPlataformaDB(e.id,status);await carregar();}catch(err){setErro(mensagemErro(err));}finally{setOcupado(null);}};
  return <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
    <header className="h-14 bg-slate-900 text-white px-4 sm:px-8 flex items-center justify-between"><div className="flex items-center gap-2.5"><div className="w-8 h-8 rounded-xl bg-teal-500 text-slate-900 grid place-items-center font-bold">Z</div><div><p className="font-semibold text-sm">ZiisTec · plataforma</p><p className="text-[11px] text-slate-400">{perfil?.email}</p></div></div><button onClick={sair} className="text-sm text-slate-300 hover:text-white">Sair</button></header>
    <main className="max-w-6xl mx-auto px-4 sm:px-8 py-8">
      <div className="mb-6"><h1 className="text-2xl font-semibold tracking-tight">Administração da plataforma</h1><p className="text-sm text-slate-500 mt-1">Contas e assinaturas. Este painel não consulta clientes, orçamentos, OS ou financeiro interno das empresas.</p></div>
      {erro&&<div className="mb-5 rounded-xl bg-rose-50 ring-1 ring-rose-200 text-rose-800 px-4 py-3 text-sm">{erro}</div>}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">{[['Empresas',dados.empresas.length],['Ativas',ativas],['Em trial',trials],['MRR ativo',brl(mrr)]].map(([k,v])=><div key={k} className="bg-white rounded-2xl ring-1 ring-slate-200/70 p-5"><p className="text-xs text-slate-500">{k}</p><p className="text-xl font-semibold mt-1">{v}</p></div>)}</div>
      <input value={busca} onChange={e=>setBusca(e.target.value)} placeholder="Buscar empresa, responsável ou e-mail" className="w-full max-w-md mb-5 rounded-xl bg-white ring-1 ring-slate-200 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-teal-600" />
      <div className="bg-white rounded-2xl ring-1 ring-slate-200/70 overflow-hidden divide-y divide-slate-100">
        {lista.length===0?<p className="p-6 text-sm text-slate-500">Nenhuma empresa encontrada.</p>:lista.map(e=><div key={e.id} className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4"><div className="min-w-0"><p className="font-medium truncate">{e.nome}</p><p className="text-sm text-slate-500 truncate">{e.responsavel||'Sem responsável'} · {e.email||'sem e-mail'}</p><p className="text-xs text-slate-400 mt-1">{e.usuarios} usuário{e.usuarios===1?'':'s'} · desde {e.criadaEm||'—'}{e.ultimoAcesso?` · último acesso ${e.ultimoAcesso}`:''}</p></div><div className="flex flex-wrap items-center gap-2 md:justify-end">{e.assinatura?<><span className="text-sm text-slate-500">{brl(e.assinatura.valor)}/mês</span><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${badge[e.assinatura.status]||badge.cancelada}`}>{label[e.assinatura.status]||e.assinatura.status}</span>{e.assinatura.status==='suspensa'||e.assinatura.status==='cancelada'?<button disabled={ocupado===e.id} onClick={()=>mudar(e,'ativa')} className="rounded-lg bg-teal-700 text-white px-3 py-2 text-xs font-medium disabled:opacity-50">Reativar</button>:<button disabled={ocupado===e.id} onClick={()=>mudar(e,'suspensa')} className="rounded-lg bg-slate-100 text-slate-700 px-3 py-2 text-xs font-medium disabled:opacity-50">Suspender</button>}</>:<span className="text-xs text-slate-400">Sem assinatura</span>}</div></div>)}
      </div>
      <section className="mt-8"><h2 className="text-base font-semibold mb-3">Últimas intervenções administrativas</h2><div className="bg-white rounded-2xl ring-1 ring-slate-200/70 divide-y divide-slate-100">{dados.auditoria.length===0?<p className="p-5 text-sm text-slate-500">Nenhuma intervenção registrada.</p>:dados.auditoria.slice(0,10).map(a=><div key={a.id} className="px-5 py-3 text-sm"><span className="font-medium">{a.action}</span><span className="text-slate-500"> · {new Date(a.created_at).toLocaleString('pt-BR')}</span></div>)}</div></section>
    </main>
  </div>;
}
