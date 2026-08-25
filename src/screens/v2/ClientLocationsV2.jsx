import React,{useCallback,useEffect,useMemo,useState} from 'react';
import {AlertTriangle,ArrowLeft,Crosshair,ExternalLink,MapPin,RefreshCw,Save,Search,Trash2,X} from 'lucide-react';
import {buildGoogleMapsUrl,carregarClientesLocaisV2DB,limparLocalClienteV2DB,salvarLocalClienteV2DB} from '../../lib/clientLocationsV2Api';

const coord=(v)=>v==null||v===''?'':String(Number(v));

export default function ClientLocationsV2({companyId,companyName='Sua empresa',onClose}){
  const [rows,setRows]=useState([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [query,setQuery]=useState('');
  const [selectedId,setSelectedId]=useState(null);
  const [form,setForm]=useState({address:'',mapsUrl:'',latitude:'',longitude:'',googlePlaceId:''});
  const [saving,setSaving]=useState(false);
  const [locating,setLocating]=useState(false);

  const load=useCallback(async()=>{
    setLoading(true);setError('');
    try{setRows(await carregarClientesLocaisV2DB(companyId));}
    catch(e){setError(e?.message||'Não consegui carregar os clientes.');}
    finally{setLoading(false);}
  },[companyId]);
  useEffect(()=>{load();},[load]);

  const filtered=useMemo(()=>{
    const q=query.trim().toLowerCase();
    if(!q)return rows;
    return rows.filter(c=>[c.name,c.trade_name,c.contact_name,c.address,c.phone,c.whatsapp].filter(Boolean).join(' ').toLowerCase().includes(q));
  },[rows,query]);
  const selected=rows.find(c=>c.id===selectedId)||null;
  const withLocation=rows.filter(c=>c.maps_url||c.address||(c.latitude!=null&&c.longitude!=null)).length;

  const select=(client)=>{
    setSelectedId(client.id);
    setForm({address:client.address||'',mapsUrl:client.maps_url||'',latitude:coord(client.latitude),longitude:coord(client.longitude),googlePlaceId:client.google_place_id||''});
    setError('');
  };

  const currentMap=useMemo(()=>buildGoogleMapsUrl({address:form.address,placeId:form.googlePlaceId,latitude:form.latitude,longitude:form.longitude})||form.mapsUrl||null,[form]);

  const useGps=()=>{
    setError('');
    if(!navigator?.geolocation){setError('Este navegador não disponibiliza localização GPS.');return;}
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      ({coords})=>{setForm(f=>({...f,latitude:String(coords.latitude),longitude:String(coords.longitude),mapsUrl:''}));setLocating(false);},
      (e)=>{setLocating(false);setError(e?.code===1?'Permita o acesso à localização para usar o GPS.':'Não consegui obter a localização atual.');},
      {enableHighAccuracy:true,timeout:12000,maximumAge:30000},
    );
  };

  const save=async()=>{
    if(!selected)return;
    setSaving(true);setError('');
    try{
      const updated=await salvarLocalClienteV2DB(selected,form);
      setRows(list=>list.map(c=>c.id===selected.id?{...c,...updated}:c));
      setForm(f=>({...f,mapsUrl:updated.maps_url||'',latitude:coord(updated.latitude),longitude:coord(updated.longitude),googlePlaceId:updated.google_place_id||''}));
    }catch(e){setError(e?.message||'Não consegui salvar o local do cliente.');}
    finally{setSaving(false);}
  };

  const clear=async()=>{
    if(!selected)return;
    setSaving(true);setError('');
    try{
      const updated=await limparLocalClienteV2DB(selected);
      setRows(list=>list.map(c=>c.id===selected.id?{...c,...updated}:c));
      setForm({address:'',mapsUrl:'',latitude:'',longitude:'',googlePlaceId:''});
    }catch(e){setError(e?.message||'Não consegui limpar o local.');}
    finally{setSaving(false);}
  };

  const openMap=()=>{
    const url=form.mapsUrl||currentMap;
    if(url)window.open(url,'_blank','noopener,noreferrer');
  };

  return <div className="min-h-screen bg-slate-950 text-white">
    <header className="sticky top-0 z-30 border-b border-white/10 bg-slate-950/95 backdrop-blur"><div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-4 sm:px-6"><div className="flex min-w-0 items-center gap-3"><button onClick={selectedId?()=>setSelectedId(null):onClose} className="rounded-xl border border-white/10 bg-white/5 p-2.5 text-slate-300 hover:bg-white/10" aria-label="Voltar"><ArrowLeft size={19}/></button><div className="min-w-0"><h1 className="truncate text-base font-bold">Clientes e locais</h1><p className="truncate text-xs text-slate-500">{selected?.name||companyName}</p></div></div><button onClick={load} className="rounded-xl border border-white/10 bg-white/5 p-2.5 text-slate-300 hover:bg-white/10" aria-label="Atualizar"><RefreshCw size={18}/></button></div></header>

    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      {error&&<div className="mb-4 flex items-start gap-3 rounded-2xl border border-rose-400/20 bg-rose-400/10 p-4 text-sm text-rose-200"><AlertTriangle className="mt-0.5 shrink-0" size={17}/><span>{error}</span><button onClick={()=>setError('')} className="ml-auto"><X size={16}/></button></div>}

      {!selectedId&&<>
        <section className="rounded-[28px] border border-white/10 bg-gradient-to-br from-sky-400/10 via-white/[0.035] to-transparent p-5 sm:p-7"><div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between"><div><div className="flex items-center gap-2 text-sky-300"><MapPin size={18}/><span className="text-xs font-bold uppercase tracking-[.16em]">Local do atendimento</span></div><h2 className="mt-3 text-2xl font-bold">Endereço pronto para abrir no Maps.</h2><p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">Salve endereço, coordenadas e link do Google Maps uma vez. A OS herda o local e o técnico abre a rota sem procurar o cliente de novo.</p></div><div className="rounded-2xl border border-white/10 bg-black/15 p-4"><p className="text-[10px] uppercase tracking-wide text-slate-500">Com local salvo</p><p className="mt-1 text-2xl font-bold">{withLocation}<span className="text-sm font-medium text-slate-600"> / {rows.length}</span></p></div></div></section>

        <div className="relative mt-5"><Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-600" size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar cliente, telefone ou endereço..." className="w-full rounded-2xl border border-white/10 bg-white/[0.045] py-3 pl-10 pr-4 text-sm outline-none placeholder:text-slate-600 focus:border-sky-400/30"/></div>

        <section className="mt-5 grid gap-3 md:grid-cols-2">{loading?<div className="md:col-span-2 rounded-3xl border border-dashed border-white/10 p-10 text-center text-sm text-slate-500">Carregando clientes...</div>:filtered.length===0?<div className="md:col-span-2 rounded-3xl border border-dashed border-white/10 p-10 text-center text-sm text-slate-500">Nenhum cliente encontrado.</div>:filtered.map(c=><button key={c.id} onClick={()=>select(c)} className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 text-left transition hover:border-sky-400/25 hover:bg-sky-400/[0.055]"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-bold">{c.name}</p>{c.trade_name&&<p className="mt-0.5 truncate text-xs text-slate-500">{c.trade_name}</p>}</div><span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase ${c.maps_url||c.address?'bg-emerald-400/10 text-emerald-300':'bg-amber-400/10 text-amber-300'}`}>{c.maps_url||c.address?'Local salvo':'Sem local'}</span></div><div className="mt-4 flex items-start gap-2 text-xs text-slate-500"><MapPin className="mt-0.5 shrink-0" size={14}/><span className="line-clamp-2">{c.address||'Endereço ainda não informado'}</span></div></button>)}</section>
      </>}

      {selectedId&&selected&&<div className="mx-auto max-w-3xl space-y-5">
        <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 sm:p-6"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[.15em] text-sky-300">Cliente</p><h2 className="mt-1 text-xl font-bold">{selected.name}</h2>{selected.whatsapp&&<p className="mt-1 text-xs text-slate-500">WhatsApp {selected.whatsapp}</p>}</div>{(form.mapsUrl||currentMap)&&<button onClick={openMap} className="flex items-center gap-2 rounded-xl border border-sky-400/20 bg-sky-400/10 px-3 py-2 text-xs font-bold text-sky-300"><ExternalLink size={14}/>Abrir Maps</button>}</div>

          <div className="mt-6"><label className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Endereço completo</label><textarea rows={3} value={form.address} onChange={e=>setForm(f=>({...f,address:e.target.value.slice(0,1000),mapsUrl:''}))} placeholder="Rua, número, complemento, bairro, cidade..." className="mt-2 w-full resize-none rounded-2xl border border-white/10 bg-black/15 p-4 text-sm outline-none placeholder:text-slate-600 focus:border-sky-400/30"/></div>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row"><button onClick={useGps} disabled={locating} className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] py-3 text-xs font-bold text-slate-300 hover:bg-white/[0.08] disabled:opacity-50"><Crosshair size={15}/>{locating?'Obtendo GPS...':'Usar localização atual'}</button><button onClick={openMap} disabled={!(form.mapsUrl||currentMap)} className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] py-3 text-xs font-bold text-slate-300 disabled:opacity-40"><MapPin size={15}/>Conferir no Google Maps</button></div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2"><div><label className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Latitude</label><input inputMode="decimal" value={form.latitude} onChange={e=>setForm(f=>({...f,latitude:e.target.value,mapsUrl:''}))} placeholder="-27.123456" className="mt-2 w-full rounded-xl border border-white/10 bg-black/15 px-3.5 py-3 text-sm outline-none focus:border-sky-400/30"/></div><div><label className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Longitude</label><input inputMode="decimal" value={form.longitude} onChange={e=>setForm(f=>({...f,longitude:e.target.value,mapsUrl:''}))} placeholder="-48.123456" className="mt-2 w-full rounded-xl border border-white/10 bg-black/15 px-3.5 py-3 text-sm outline-none focus:border-sky-400/30"/></div></div>

          <details className="mt-5 rounded-2xl border border-white/10 bg-black/10"><summary className="cursor-pointer px-4 py-3 text-xs font-bold text-slate-400">Dados avançados do Google Maps</summary><div className="space-y-4 border-t border-white/10 p-4"><div><label className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Link do Google Maps</label><input value={form.mapsUrl} onChange={e=>setForm(f=>({...f,mapsUrl:e.target.value.slice(0,2000)}))} placeholder="https://www.google.com/maps/..." className="mt-2 w-full rounded-xl border border-white/10 bg-black/15 px-3.5 py-3 text-sm outline-none focus:border-sky-400/30"/></div><div><label className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Google Place ID</label><input value={form.googlePlaceId} onChange={e=>setForm(f=>({...f,googlePlaceId:e.target.value.slice(0,500),mapsUrl:''}))} placeholder="Opcional — preparado para autocomplete Places" className="mt-2 w-full rounded-xl border border-white/10 bg-black/15 px-3.5 py-3 text-sm outline-none focus:border-sky-400/30"/></div><p className="text-[11px] leading-relaxed text-slate-600">A estrutura já está pronta para Google Places. O autocomplete visual depende de uma chave Google Maps/Places configurada no ambiente; até lá, endereço, GPS e link Maps funcionam sem inventar uma integração.</p></div></details>

          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between"><button onClick={clear} disabled={saving} className="flex items-center justify-center gap-2 rounded-xl border border-rose-400/15 bg-rose-400/5 px-4 py-3 text-xs font-bold text-rose-300 disabled:opacity-50"><Trash2 size={15}/>Limpar local</button><button onClick={save} disabled={saving} className="flex items-center justify-center gap-2 rounded-xl bg-sky-400 px-5 py-3 text-xs font-bold text-slate-950 disabled:opacity-50"><Save size={15}/>{saving?'Salvando...':'Salvar local'}</button></div>
        </section>

        <section className="rounded-3xl border border-emerald-400/15 bg-emerald-400/[0.05] p-5 text-xs leading-relaxed text-emerald-100/65"><strong className="text-emerald-200">Segurança:</strong> esta área é exclusiva do proprietário. O técnico não recebe uma lista geral de clientes; na memória/OS, o RLS libera apenas o cliente vinculado ao atendimento atribuído.</section>
      </div>}
    </main>
  </div>;
}
