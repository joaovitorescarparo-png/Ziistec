import React,{useEffect,useState} from 'react';
import {MapPin,Plus} from 'lucide-react';
import {criarLocalClienteOrcamentoV2DB,listarLocaisClienteOrcamentoV2DB} from '../lib/quoteReuseV2Api';

export default function QuoteClientLocationField({clientId,value,required=false,legacyServicePlace='',onSelect}){
  const [locations,setLocations]=useState([]);const [loading,setLoading]=useState(false);const [error,setError]=useState('');
  const [creating,setCreating]=useState(false);const [name,setName]=useState('');const [address,setAddress]=useState('');const [saving,setSaving]=useState(false);
  const input='min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-base outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100';

  const load=async()=>{if(!clientId){setLocations([]);return;}setLoading(true);setError('');try{const rows=await listarLocaisClienteOrcamentoV2DB(clientId);setLocations(rows||[]);if(value&&!(rows||[]).some(x=>x.id===value)) onSelect?.(null);}catch(e){setError(e.message||'Não foi possível carregar os locais.');}finally{setLoading(false);}};
  useEffect(()=>{load();},[clientId]);

  const choose=(id)=>{const row=locations.find(x=>x.id===id)||null;onSelect?.(row);};
  const create=async()=>{if(!name.trim()){setError('Informe o nome do local.');return;}setSaving(true);setError('');try{const row=await criarLocalClienteOrcamentoV2DB({clientId,name,address});setCreating(false);setName('');setAddress('');await load();onSelect?.(row);}catch(e){setError(e.message||'Não foi possível cadastrar o local.');}finally{setSaving(false);}};
  const selected=locations.find(x=>x.id===value)||null;

  if(!clientId)return <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500">Selecione o cliente para escolher um local cadastrado.</p>;
  return <div className="grid min-w-0 gap-2">
    {legacyServicePlace&&<div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><strong>Local registrado no atendimento anterior:</strong><br/><span className="break-words">{legacyServicePlace}</span><br/><span className="text-xs">Referência histórica apenas; confirme um local atual abaixo.</span></div>}
    <label className="grid gap-1 text-sm font-medium">Local cadastrado{required?' *':''}<select className={input} value={value||''} onChange={e=>choose(e.target.value)} disabled={loading}><option value="">{loading?'Carregando…':required?'Confirme o local deste novo orçamento':'Sem vínculo cadastrado'}</option>{locations.map(l=><option key={l.id} value={l.id}>{l.name}{l.address?` · ${l.address}`:''}</option>)}</select></label>
    {selected?<div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900"><div className="flex items-start gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0"/><div className="min-w-0"><strong>Local reutilizado:</strong><p className="break-words">{selected.name}</p>{selected.address&&<p className="break-words text-xs">{selected.address}</p>}</div></div></div>:required?<p className="rounded-xl bg-amber-50 p-3 text-sm font-medium text-amber-900">Confirme o local deste novo orçamento antes de salvar.</p>:null}
    {error&&<p className="break-words rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {!creating?<button type="button" onClick={()=>setCreating(true)} className="flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-semibold"><Plus className="h-4 w-4"/>Cadastrar local</button>:<div className="grid gap-2 rounded-xl border bg-slate-50 p-3"><label className="grid gap-1 text-xs font-medium">Nome do local<input className={input} value={name} onChange={e=>setName(e.target.value)} placeholder="Ex.: Porta social, apartamento 402"/></label><label className="grid gap-1 text-xs font-medium">Endereço do local<input className={input} value={address} onChange={e=>setAddress(e.target.value)} placeholder="Endereço opcional"/></label><div className="grid grid-cols-2 gap-2"><button type="button" onClick={()=>setCreating(false)} className="min-h-11 rounded-xl border bg-white px-3 text-sm font-semibold">Cancelar</button><button type="button" disabled={saving} onClick={create} className="min-h-11 rounded-xl bg-emerald-600 px-3 text-sm font-semibold text-white disabled:opacity-50">{saving?'Salvando…':'Salvar local'}</button></div></div>}
  </div>;
}
