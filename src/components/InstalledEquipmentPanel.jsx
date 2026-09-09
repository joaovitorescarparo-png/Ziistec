import React,{useEffect,useMemo,useState} from 'react';
import {Camera,Check,Clipboard,MapPin,PackagePlus,ScanLine,ShieldCheck,Wrench} from 'lucide-react';
import BarcodeScanner from './BarcodeScanner';
import {carregarEquipamentosInstaladosV2DB,registrarEquipamentoInstaladoV2DB} from '../lib/installedEquipmentV2Api';

const date=(v)=>v?new Date(v).toLocaleDateString('pt-BR'):'—';
const sourceKey=(kind,id)=>`${kind}:${id}`;

async function copyText(value){
  const text=String(value||'');
  if(!text) return false;
  if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(text);return true;}
  const el=document.createElement('textarea');el.value=text;el.setAttribute('readonly','');el.style.position='fixed';el.style.opacity='0';document.body.appendChild(el);el.select();
  const ok=document.execCommand?.('copy');document.body.removeChild(el);return Boolean(ok);
}

export default function InstalledEquipmentPanel({detail,owner=false,onNavigateWorkOrder}){
  const workOrder=detail?.workOrder;
  const clientId=workOrder?.client_id;
  const [rows,setRows]=useState([]);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const [open,setOpen]=useState(false);
  const [busy,setBusy]=useState(false);
  const [scanner,setScanner]=useState(null);
  const [copied,setCopied]=useState('');
  const [form,setForm]=useState({source:'',location:'',serial:'',barcode:'',notes:'',image:''});

  const sources=useMemo(()=>[
    ...(detail?.materials||[]).map(x=>({kind:'material',id:x.id,name:x.name,quantity:x.quantity,serial:x.serial_number||'',productId:x.product_id})),
    ...(detail?.items||[]).filter(x=>x.product_id).map(x=>({kind:'item',id:x.id,name:x.name,quantity:x.quantity,serial:'',productId:x.product_id})),
  ],[detail]);
  const equipmentPhotos=useMemo(()=>(detail?.media||[]).filter(x=>x.media_kind==='photo'&&x.media_stage==='equipment'),[detail]);
  const grouped=useMemo(()=>{
    const map=new Map();
    for(const row of rows){const key=row.client_location_id||row.location_name||'local';const group=map.get(key)||{name:row.location_name||'Local',rows:[]};group.rows.push(row);map.set(key,group);}
    return [...map.values()];
  },[rows]);

  const load=async()=>{
    if(!clientId){setRows([]);return;}
    setLoading(true);setError('');
    try{setRows(await carregarEquipamentosInstaladosV2DB(clientId));}
    catch(e){setError(e?.message||'Não consegui carregar os equipamentos instalados.');}
    finally{setLoading(false);}
  };
  useEffect(()=>{load();},[clientId]);
  useEffect(()=>{
    if(!open) return;
    setForm(v=>({...v,location:v.location||workOrder?.service_place||workOrder?.address||'Local do atendimento'}));
  },[open,workOrder?.service_place,workOrder?.address]);

  const chooseSource=(value)=>{
    const src=sources.find(x=>sourceKey(x.kind,x.id)===value);
    setForm(v=>({...v,source:value,serial:src?.serial||v.serial}));
  };
  const save=async()=>{
    const [kind,id]=form.source.split(':');
    if(!id){setError('Selecione o produto/equipamento usado na OS.');return;}
    setBusy(true);setError('');
    try{
      await registrarEquipamentoInstaladoV2DB({
        workOrder,sourceType:kind,sourceId:id,locationName:form.location,serial:form.serial,barcode:form.barcode,notes:form.notes,imageAttachmentId:form.image||null,
      });
      setOpen(false);setForm({source:'',location:workOrder?.service_place||workOrder?.address||'Local do atendimento',serial:'',barcode:'',notes:'',image:''});
      await load();
    }catch(e){setError(e?.message||'Não consegui registrar o equipamento instalado.');}
    finally{setBusy(false);}
  };
  const copy=async(id,value)=>{try{if(await copyText(value)){setCopied(id);setTimeout(()=>setCopied(''),1500);}}catch{setError('Não consegui copiar este valor.');}};

  return <section className="min-w-0 overflow-hidden rounded-3xl border border-emerald-400/20 bg-emerald-400/[0.045] p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><div className="flex items-center gap-2"><Wrench className="shrink-0 text-emerald-300" size={18}/><h3 className="text-sm font-bold">Equipamentos instalados</h3></div><p className="mt-1 text-xs leading-relaxed text-slate-500">Cliente → Local → equipamento. Sem custo, margem, fornecedor ou financeiro privado.</p></div>
      {workOrder?.status==='done'&&sources.length>0&&<button type="button" onClick={()=>setOpen(v=>!v)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-400 px-3.5 text-xs font-bold text-slate-950"><PackagePlus size={16}/>{open?'Fechar':'Registrar equipamento'}</button>}
    </div>

    {error&&<div className="mt-4 rounded-2xl border border-rose-400/20 bg-rose-400/10 p-3 text-xs leading-relaxed text-rose-200">{error}</div>}

    {open&&<div className="mt-4 min-w-0 space-y-3 rounded-2xl border border-white/10 bg-black/15 p-4">
      <label className="block text-xs font-bold text-slate-400">Produto/equipamento usado
        <select value={form.source} onChange={e=>chooseSource(e.target.value)} className="mt-2 min-h-11 w-full min-w-0 rounded-xl border border-white/10 bg-slate-900 px-3 text-sm text-white outline-none focus:border-emerald-400/40">
          <option value="">Selecione</option>{sources.map(s=><option key={sourceKey(s.kind,s.id)} value={sourceKey(s.kind,s.id)}>{s.name} · qtd. {Number(s.quantity||0)}</option>)}
        </select>
      </label>
      <label className="block text-xs font-bold text-slate-400">Local
        <input value={form.location} maxLength={300} onChange={e=>setForm(v=>({...v,location:e.target.value}))} className="mt-2 min-h-11 w-full min-w-0 rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white outline-none focus:border-emerald-400/40" placeholder="Ex.: Porta social"/>
      </label>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <label className="min-w-0 text-xs font-bold text-slate-400">Serial
          <div className="mt-2 flex min-w-0 gap-2"><input value={form.serial} maxLength={240} onChange={e=>setForm(v=>({...v,serial:e.target.value}))} className="min-h-11 min-w-0 flex-1 rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white outline-none focus:border-emerald-400/40" placeholder="ABC123456"/><button type="button" onClick={()=>setScanner('serial')} className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.05] text-emerald-300" aria-label="Ler serial pela câmera"><ScanLine size={18}/></button></div>
        </label>
        <label className="min-w-0 text-xs font-bold text-slate-400">Barcode físico
          <div className="mt-2 flex min-w-0 gap-2"><input value={form.barcode} maxLength={240} onChange={e=>setForm(v=>({...v,barcode:e.target.value}))} className="min-h-11 min-w-0 flex-1 rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white outline-none focus:border-emerald-400/40" placeholder="Opcional"/><button type="button" onClick={()=>setScanner('barcode')} className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.05] text-emerald-300" aria-label="Ler barcode pela câmera"><Camera size={18}/></button></div>
        </label>
      </div>
      <label className="block text-xs font-bold text-slate-400">Foto do equipamento
        <select value={form.image} onChange={e=>setForm(v=>({...v,image:e.target.value}))} className="mt-2 min-h-11 w-full min-w-0 rounded-xl border border-white/10 bg-slate-900 px-3 text-sm text-white outline-none focus:border-emerald-400/40">
          <option value="">Sem foto vinculada</option>{equipmentPhotos.map(x=><option key={x.id} value={x.id}>{x.caption||x.file_name||'Foto do equipamento'}</option>)}
        </select>
      </label>
      <p className="text-[11px] leading-relaxed text-slate-500">A foto precisa ser evidência da etapa “Equipamento” desta mesma OS. O técnico mantém o guard atual: capture a evidência antes de finalizar; o owner pode complementar depois.</p>
      <label className="block text-xs font-bold text-slate-400">Observações
        <textarea rows={3} value={form.notes} maxLength={5000} onChange={e=>setForm(v=>({...v,notes:e.target.value}))} className="mt-2 w-full min-w-0 resize-y rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-white outline-none focus:border-emerald-400/40" placeholder="Posição, particularidades, identificação..."/>
      </label>
      <button type="button" onClick={save} disabled={busy||!form.source} className="min-h-11 w-full rounded-xl bg-emerald-400 px-4 text-xs font-bold text-slate-950 disabled:opacity-40">{busy?'Registrando...':'Registrar como equipamento instalado'}</button>
    </div>}

    {scanner&&<BarcodeScanner mode={scanner} onDetected={value=>{setForm(v=>({...v,[scanner]:value}));setScanner(null);}} onClose={()=>setScanner(null)}/>} 

    <div className="mt-4 space-y-4">{loading?<p className="text-sm text-slate-500">Carregando equipamentos...</p>:grouped.length===0?<div className="rounded-2xl border border-dashed border-white/10 p-5 text-center text-sm text-slate-500">Nenhum equipamento durável registrado para este cliente no contexto permitido.</div>:grouped.map(group=><div key={group.name} className="min-w-0"><div className="mb-2 flex items-center gap-2 text-xs font-bold text-slate-400"><MapPin size={14}/><span className="break-words">{group.name}</span></div><div className="space-y-2">{group.rows.map(e=><article key={e.id} className="min-w-0 rounded-2xl border border-white/10 bg-black/15 p-4"><div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><p className="break-words text-sm font-bold text-white">{e.name}</p><p className="mt-1 break-words text-xs text-slate-400">{[e.brand,e.model].filter(Boolean).join(' · ')||'Marca/modelo não informado'}</p></div><span className="shrink-0 text-[11px] text-slate-500">Instalado {date(e.installed_at)}</span></div>
          <div className="mt-3 grid min-w-0 gap-2 sm:grid-cols-2">{e.serial_number&&<div className="min-w-0 rounded-xl bg-white/[0.035] p-3"><p className="text-[10px] font-bold uppercase text-slate-500">Serial</p><div className="mt-1 flex min-w-0 items-center gap-2"><code className="min-w-0 flex-1 break-all text-xs text-slate-200">{e.serial_number}</code><button type="button" onClick={()=>copy(`s-${e.id}`,e.serial_number)} className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-slate-400" aria-label="Copiar serial">{copied===`s-${e.id}`?<Check size={15}/>:<Clipboard size={15}/>}</button></div></div>}{e.barcode&&<div className="min-w-0 rounded-xl bg-white/[0.035] p-3"><p className="text-[10px] font-bold uppercase text-slate-500">Barcode</p><div className="mt-1 flex min-w-0 items-center gap-2"><code className="min-w-0 flex-1 break-all text-xs text-slate-200">{e.barcode}</code><button type="button" onClick={()=>copy(`b-${e.id}`,e.barcode)} className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-slate-400" aria-label="Copiar barcode">{copied===`b-${e.id}`?<Check size={15}/>:<Clipboard size={15}/>}</button></div></div>}</div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-500"><span>OS {e.work_order_number||'—'}</span>{e.warranty_id&&<span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/10 px-2 py-1 text-emerald-300"><ShieldCheck size={12}/>Garantia até {date(e.warranty_ends_on)}</span>}</div>
          {e.notes&&<p className="mt-3 whitespace-pre-wrap break-words text-xs leading-relaxed text-slate-400">{e.notes}</p>}
          {e.image_url&&<a href={e.image_url} target="_blank" rel="noreferrer" className="mt-3 block overflow-hidden rounded-xl border border-white/10"><img src={e.image_url} alt={`Equipamento ${e.name}`} className="max-h-52 w-full object-cover"/></a>}
          <button type="button" onClick={()=>onNavigateWorkOrder?.(e.work_order_id)} className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-xs font-bold text-slate-300">Abrir OS / relatório</button>
        </article>)}</div></div>)}</div>
  </section>;
}
