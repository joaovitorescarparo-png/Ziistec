import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, CalendarDays, CheckCircle2, Loader2, RefreshCcw, ShieldCheck,
  TriangleAlert, Wrench, X,
} from 'lucide-react';
import {
  carregarGarantiasManuaisDB,
  carregarOpcoesGarantiaManualDB,
  criarGarantiaManualDB,
  recursoV2AindaNaoMigrado,
  verificarProdutoV2DisponivelDB,
} from '../../lib/v2Api';
import { mensagemErro } from '../../lib/supabase';

const hoje = () => new Date().toISOString().slice(0,10);
const addDays = (base, days) => { const d=new Date(`${base}T12:00:00`); d.setDate(d.getDate()+Number(days||0)); return d.toISOString().slice(0,10); };
const addMonths = (base, months) => { const d=new Date(`${base}T12:00:00`); d.setMonth(d.getMonth()+Number(months||0)); return d.toISOString().slice(0,10); };
const dataBR = (v) => v ? v.split('-').reverse().join('/') : '—';

const VAZIO = { clienteId:'', tipo:'produto', produtoId:'', servicoId:'', descricao:'', inicio:hoje(), ate:addMonths(hoje(),12), serie:'', local:'', obs:'' };

function Btn({ children, onClick, disabled=false, variant='primary', type='button', className='' }) {
  const cls=variant==='primary'?'bg-emerald-700 text-white hover:bg-emerald-800':'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50';
  return <button type={type} onClick={onClick} disabled={disabled} className={`inline-flex items-center justify-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${cls} ${className}`}>{children}</button>;
}

function Field({ label, children }) { return <label className="block"><span className="mb-1.5 block text-xs font-semibold text-slate-600">{label}</span>{children}</label>; }
const control='w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100';

export default function ManualWarrantyV2({ companyId, companyName='Sua empresa', onClose }) {
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [available,setAvailable]=useState(null);
  const [error,setError]=useState('');
  const [success,setSuccess]=useState('');
  const [options,setOptions]=useState({clientes:[],servicos:[],produtos:[]});
  const [warranties,setWarranties]=useState([]);
  const [form,setForm]=useState({...VAZIO});

  const load=async()=>{
    setLoading(true); setError('');
    try{
      const support=await verificarProdutoV2DisponivelDB(companyId);
      if(!support.disponivel){setAvailable(false);setOptions({clientes:[],servicos:[],produtos:[]});setWarranties([]);return;}
      const [opts,rows]=await Promise.all([carregarOpcoesGarantiaManualDB(companyId),carregarGarantiasManuaisDB(companyId)]);
      setOptions(opts);setWarranties(rows);setAvailable(true);
      setForm(f=>({...f,clienteId:opts.clientes.some(x=>x.id===f.clienteId)?f.clienteId:(opts.clientes[0]?.id||'')}));
    }catch(e){if(recursoV2AindaNaoMigrado(e))setAvailable(false);else setError(mensagemErro(e));}
    finally{setLoading(false);}
  };
  useEffect(()=>{load();},[companyId]);

  const clientMap=useMemo(()=>new Map(options.clientes.map(x=>[x.id,x])),[options.clientes]);
  const productMap=useMemo(()=>new Map(options.produtos.map(x=>[x.id,x])),[options.produtos]);
  const serviceMap=useMemo(()=>new Map(options.servicos.map(x=>[x.id,x])),[options.servicos]);

  const chooseClient=(id)=>{const c=clientMap.get(id);setForm(f=>({...f,clienteId:id,local:f.local||c?.endereco||''}));};
  const chooseProduct=(id)=>{const p=productMap.get(id);setForm(f=>({...f,produtoId:id,descricao:f.descricao||([p?.nome,p?.marca,p?.modelo].filter(Boolean).join(' · ')),ate:p?.garantiaMeses?addMonths(f.inicio,p.garantiaMeses):f.ate}));};
  const chooseService=(id)=>{const s=serviceMap.get(id);setForm(f=>({...f,servicoId:id,descricao:f.descricao||s?.nome||'',ate:s?.garantiaDias?addDays(f.inicio,s.garantiaDias):f.ate}));};
  const changeStart=(date)=>{setForm(f=>{const p=productMap.get(f.produtoId);const s=serviceMap.get(f.servicoId);const ate=f.tipo==='produto'&&p?.garantiaMeses?addMonths(date,p.garantiaMeses):f.tipo==='servico'&&s?.garantiaDias?addDays(date,s.garantiaDias):f.ate;return {...f,inicio:date,ate};});};

  const submit=async(e)=>{
    e.preventDefault();setError('');setSuccess('');
    if(!form.clienteId){setError('Selecione um cliente.');return;}
    if(!form.descricao.trim()){setError('Informe a descrição da garantia.');return;}
    if(!form.inicio||!form.ate||form.ate<form.inicio){setError('Confira o período da garantia.');return;}
    setSaving(true);
    try{
      await criarGarantiaManualDB(form,companyId);
      setSuccess('Garantia manual criada e registrada no histórico do cliente.');
      setForm({...VAZIO,clienteId:form.clienteId,local:clientMap.get(form.clienteId)?.endereco||''});
      await load();
    }catch(e2){if(recursoV2AindaNaoMigrado(e2))setAvailable(false);setError(mensagemErro(e2));}
    finally{setSaving(false);}
  };

  return <div className="min-h-screen bg-slate-50 text-slate-900">
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur"><div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6"><div className="flex min-w-0 items-center gap-3"><button onClick={onClose} className="rounded-xl border border-slate-200 p-2.5 text-slate-600 hover:bg-slate-50" aria-label="Voltar"><ArrowLeft size={19}/></button><div className="min-w-0"><div className="flex items-center gap-2"><h1 className="truncate text-base font-bold">Garantias manuais</h1><span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">V2</span></div><p className="truncate text-xs text-slate-500">{companyName}</p></div></div><Btn variant="secondary" onClick={load} disabled={loading}><RefreshCcw size={16}/><span className="hidden sm:inline">Atualizar</span></Btn></div></header>

    <main className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-7">
      <div className="mb-5 rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4"><div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 shrink-0 text-emerald-700" size={20}/><div><p className="text-sm font-bold text-emerald-950">Registro do proprietário</p><p className="mt-1 text-xs leading-relaxed text-emerald-800">A criação manual exige permissão de proprietário no próprio RPC do banco. Cliente, produto e serviço também precisam pertencer à mesma empresa.</p></div></div></div>
      {error&&<div className="mb-5 flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"><TriangleAlert className="mt-0.5 shrink-0" size={18}/><div className="flex-1">{error}</div><button onClick={()=>setError('')}><X size={17}/></button></div>}
      {success&&<div className="mb-5 flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800"><CheckCircle2 className="mt-0.5 shrink-0" size={18}/><div className="flex-1">{success}</div><button onClick={()=>setSuccess('')}><X size={17}/></button></div>}

      {loading?<div className="flex min-h-[45vh] items-center justify-center text-slate-500"><Loader2 className="mr-2 animate-spin" size={20}/>Carregando garantias...</div>:available===false?<div className="mx-auto max-w-xl rounded-3xl border border-amber-200 bg-white p-7 text-center shadow-sm"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 text-amber-700"><ShieldCheck size={24}/></div><h2 className="mt-4 text-lg font-bold">Garantia V2 pronta; banco protegido</h2><p className="mt-2 text-sm leading-relaxed text-slate-600">A interface está pronta, mas a migration que adiciona garantia manual ainda não foi aplicada à produção. O preview permanece bloqueado para não gravar em um contrato de banco incompleto.</p></div>:<div className="grid gap-5 lg:grid-cols-[1fr_0.9fr]">
        <form onSubmit={submit} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"><div className="mb-5"><p className="text-xs font-bold uppercase tracking-wide text-slate-400">Nova garantia</p><h2 className="mt-1 text-lg font-bold">Registrar cobertura existente</h2><p className="mt-1 text-xs text-slate-500">Útil para equipamentos ou serviços que já existem e não nasceram de uma OS do ZiisTec.</p></div>
          <div className="grid gap-4 sm:grid-cols-2"><div className="sm:col-span-2"><Field label="Cliente *"><select className={control} value={form.clienteId} onChange={e=>chooseClient(e.target.value)}><option value="">Selecione...</option>{options.clientes.map(c=><option key={c.id} value={c.id}>{c.nome}</option>)}</select></Field></div><Field label="Tipo"><select className={control} value={form.tipo} onChange={e=>setForm({...form,tipo:e.target.value,produtoId:'',servicoId:'',descricao:''})}><option value="produto">Produto</option><option value="servico">Serviço</option></select></Field>{form.tipo==='produto'?<Field label="Produto relacionado"><select className={control} value={form.produtoId} onChange={e=>chooseProduct(e.target.value)}><option value="">Sem vínculo específico</option>{options.produtos.map(p=><option key={p.id} value={p.id}>{p.nome}{p.modelo?` · ${p.modelo}`:''}</option>)}</select></Field>:<Field label="Serviço relacionado"><select className={control} value={form.servicoId} onChange={e=>chooseService(e.target.value)}><option value="">Sem vínculo específico</option>{options.servicos.map(s=><option key={s.id} value={s.id}>{s.nome}</option>)}</select></Field>}
            <div className="sm:col-span-2"><Field label="Descrição da garantia *"><input className={control} value={form.descricao} onChange={e=>setForm({...form,descricao:e.target.value})} placeholder="Ex.: Fechadura Intelbras FR 320 instalada na porta principal"/></Field></div><Field label="Início"><input type="date" className={control} value={form.inicio} onChange={e=>changeStart(e.target.value)}/></Field><Field label="Fim"><input type="date" className={control} value={form.ate} onChange={e=>setForm({...form,ate:e.target.value})}/></Field>{form.tipo==='produto'&&<Field label="Número de série"><input className={control} value={form.serie} onChange={e=>setForm({...form,serie:e.target.value})} placeholder="Opcional"/></Field>}<div className={form.tipo==='produto'?'':'sm:col-span-2'}><Field label="Local"><input className={control} value={form.local} onChange={e=>setForm({...form,local:e.target.value})} placeholder="Apartamento, bloco, endereço..."/></Field></div><div className="sm:col-span-2"><Field label="Observações"><textarea rows="4" maxLength="5000" className={`${control} resize-none`} value={form.obs} onChange={e=>setForm({...form,obs:e.target.value})} placeholder="Condições, exceções, origem da garantia, detalhes técnicos..."/></Field></div></div>
          <div className="mt-5 flex justify-end border-t border-slate-100 pt-5"><Btn type="submit" disabled={saving||!options.clientes.length} className="w-full sm:w-auto">{saving?<Loader2 className="animate-spin" size={16}/>:<ShieldCheck size={16}/>}Registrar garantia</Btn></div>
        </form>

        <section className="rounded-3xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-100 p-5"><p className="text-xs font-bold uppercase tracking-wide text-slate-400">Histórico manual</p><p className="mt-1 text-sm text-slate-600">{warranties.length} registro{warranties.length===1?'':'s'}</p></div>{warranties.length===0?<div className="p-10 text-center text-sm text-slate-500">Nenhuma garantia manual cadastrada.</div>:<div className="divide-y divide-slate-100">{warranties.map(g=>{const client=clientMap.get(g.clienteId);const active=!g.ate||g.ate>=hoje();return <article key={g.id} className="p-5"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${active?'bg-emerald-50 text-emerald-700':'bg-slate-100 text-slate-500'}`}>{active?'Ativa':'Expirada'}</span><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">{g.tipo==='produto'?'Produto':'Serviço'}</span></div><h3 className="mt-2 text-sm font-bold">{g.descricao}</h3><p className="mt-1 text-xs text-slate-500">{client?.nome||'Cliente'} · {dataBR(g.inicio)} até {dataBR(g.ate)}</p></div>{g.tipo==='produto'?<ShieldCheck className="shrink-0 text-emerald-600" size={19}/>:<Wrench className="shrink-0 text-slate-400" size={19}/>}</div>{g.local&&<p className="mt-3 text-xs text-slate-500">Local: {g.local}</p>}{g.serie&&<p className="mt-1 text-xs text-slate-500">Série: {g.serie}</p>}<div className="mt-3 flex items-center gap-1.5 text-[11px] font-medium text-slate-400"><CalendarDays size={13}/>{dataBR(g.inicio)} — {dataBR(g.ate)}</div></article>;})}</div>}</section>
      </div>}
    </main>
  </div>;
}
