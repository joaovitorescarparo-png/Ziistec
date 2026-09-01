import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, CheckCircle2, ChevronRight, Copy, Loader2, MapPin, Package,
  RefreshCcw, Search, ShieldCheck, ShoppingCart, TriangleAlert, X,
} from 'lucide-react';
import {
  carregarCatalogoTecnicoDB,
  carregarOSVendaDB,
  venderProdutoNaOSDB,
} from '../../lib/v2Api';
import { carregarConfiguracaoVendaCampoDB, venderProdutoDiretoDB } from '../../lib/fieldSalesApi';
import { resolverImagemProdutoDB } from '../../lib/storageExtras';
import { resolverQrPixEmpresaDB } from '../../lib/fieldSalesStorage';
import { mensagemErro } from '../../lib/supabase';

const brl = (n) => Number(n || 0).toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
const n = (v) => Number(String(v ?? '').replace(',', '.')) || 0;
const dataBR = (v) => v ? String(v).split('-').reverse().join('/') : 'Sem data';
const statusLabel = { unscheduled:'Aguardando', scheduled:'Agendada', in_progress:'Em andamento' };

function Btn({ children, onClick, disabled=false, variant='primary', type='button', className='' }) {
  const cls = variant === 'primary'
    ? 'bg-teal-700 text-white hover:bg-teal-800'
    : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50';
  return <button type={type} onClick={onClick} disabled={disabled}
    className={`inline-flex items-center justify-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${cls} ${className}`}>{children}</button>;
}

export default function TechnicianSalesV2({ companyId, companyName='Sua empresa', onClose }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [mode, setMode] = useState('quick');
  const [orders, setOrders] = useState([]);
  const [products, setProducts] = useState([]);
  const [images, setImages] = useState({});
  const [orderId, setOrderId] = useState('');
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [paymentMethod, setPaymentMethod] = useState('Pix');
  const [notes, setNotes] = useState('');
  const [search, setSearch] = useState('');
  const [paymentConfig,setPaymentConfig]=useState({pixKey:'',pixQrPath:null,allowPix:true,allowCash:true,allowCard:true});
  const [pixQrUrl,setPixQrUrl]=useState(null);
  const requestId = useRef(crypto.randomUUID());

  const load = async ({ keepSelection=true }={}) => {
    setLoading(true); setError('');
    try {
      const [catalog, os, cfg] = await Promise.all([
        carregarCatalogoTecnicoDB(companyId),
        carregarOSVendaDB(companyId),
        carregarConfiguracaoVendaCampoDB(companyId),
      ]);
      setProducts(catalog); setOrders(os); setPaymentConfig(cfg);
      const formas=[cfg.allowPix?'Pix':null,cfg.allowCash?'Dinheiro':null,cfg.allowCard?'Cartão':null].filter(Boolean);
      if(!formas.includes(paymentMethod))setPaymentMethod(formas[0]||'');
      setPixQrUrl(cfg.pixQrPath?await resolverQrPixEmpresaDB(cfg.pixQrPath):null);
      if (!keepSelection || !os.some(x=>x.id===orderId)) setOrderId(os[0]?.id || '');
      if (!keepSelection || !catalog.some(x=>x.id===productId)) setProductId('');
      const paths=[...new Set(catalog.map(p=>p.imagemPath).filter(Boolean))];
      const entries=await Promise.all(paths.map(async path=>[path,await resolverImagemProdutoDB(path)]));
      setImages(Object.fromEntries(entries));
    } catch (e) { setError(mensagemErro(e)); }
    finally { setLoading(false); }
  };

  useEffect(()=>{ load({keepSelection:false}); },[companyId]);

  const selectedOrder=orders.find(x=>x.id===orderId)||null;
  const selectedProduct=products.find(x=>x.id===productId)||null;
  const qty=Math.max(0,n(quantity));
  const insufficient=Boolean(selectedProduct?.controlaEstoque && qty>selectedProduct.estoque);
  const total=(selectedProduct?.preco||0)*qty;
  const formas=useMemo(()=>[
    paymentConfig.allowPix?'Pix':null,paymentConfig.allowCash?'Dinheiro':null,paymentConfig.allowCard?'Cartão':null,
  ].filter(Boolean),[paymentConfig]);
  const filtered=useMemo(()=>{
    const q=search.trim().toLowerCase();
    return products.filter(p=>!q || `${p.nome} ${p.marca} ${p.modelo}`.toLowerCase().includes(q));
  },[products,search]);

  const resetSale=()=>{
    setProductId(''); setQuantity(1); setNotes(''); setSearch('');
    requestId.current=crypto.randomUUID();
  };

  const copyPix=async()=>{
    try{await navigator.clipboard.writeText(paymentConfig.pixKey||'');setSuccess('Chave Pix copiada.');}
    catch{setError('Não consegui copiar a chave Pix neste aparelho.');}
  };

  const submit=async(e)=>{
    e.preventDefault(); setError(''); setSuccess('');
    if(!selectedProduct){setError('Selecione um produto.');return;}
    if(qty<=0){setError('Informe uma quantidade maior que zero.');return;}
    if(insufficient){setError(`Estoque insuficiente. Disponível: ${selectedProduct.estoque}.`);return;}
    if(mode==='os' && !selectedOrder){setError('Selecione uma OS aberta.');return;}
    if(mode==='quick'&&!paymentMethod){setError('A empresa não habilitou uma forma de recebimento.');return;}
    setSaving(true);
    try{
      if(mode==='quick'){
        await venderProdutoDiretoDB({
          companyId,productId:selectedProduct.id,quantity:qty,paymentMethod,notes,
          requestId:requestId.current,
        });
        setSuccess(`Venda confirmada: ${selectedProduct.nome} · ${brl(total)} · ${paymentMethod}. O proprietário já consegue ver no Financeiro e em Vendas realizadas.`);
      }else{
        await venderProdutoNaOSDB(selectedOrder.id,selectedProduct.id,qty,notes);
        setSuccess(`${selectedProduct.nome} adicionado à OS #${selectedOrder.numero}. O item passa a fazer parte do histórico desse atendimento.`);
      }
      resetSale(); await load({keepSelection:true});
    }catch(e2){setError(mensagemErro(e2));}
    finally{setSaving(false);}
  };

  return <div className="min-h-screen bg-slate-50 text-slate-900">
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur"><div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6"><div className="flex min-w-0 items-center gap-3"><button onClick={onClose} className="rounded-xl border border-slate-200 p-2.5 text-slate-600 hover:bg-slate-50" aria-label="Voltar"><ArrowLeft size={19}/></button><div className="min-w-0"><h1 className="truncate text-base font-bold">Produtos para venda em campo</h1><p className="truncate text-xs text-slate-500">{companyName}</p></div></div><Btn variant="secondary" onClick={()=>load({keepSelection:true})} disabled={loading}><RefreshCcw size={16}/><span className="hidden sm:inline">Atualizar</span></Btn></div></header>

    <main className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-7">
      <div className="mb-5 rounded-2xl border border-teal-100 bg-teal-50/70 p-4"><div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 shrink-0 text-teal-700" size={20}/><div><p className="text-sm font-bold text-teal-950">Catálogo seguro para campo</p><p className="mt-1 text-xs leading-relaxed text-teal-800">Você vê somente produtos liberados e preço final. Custo, margem e fornecedor não são enviados. A venda só deve ser confirmada depois que o pagamento realmente foi recebido.</p></div></div></div>

      <div className="mb-5 grid grid-cols-2 rounded-2xl bg-slate-200/70 p-1"><button type="button" onClick={()=>setMode('quick')} className={`rounded-xl px-3 py-3 text-sm font-semibold transition ${mode==='quick'?'bg-white text-slate-900 shadow-sm':'text-slate-500'}`}>Venda rápida</button><button type="button" onClick={()=>setMode('os')} className={`rounded-xl px-3 py-3 text-sm font-semibold transition ${mode==='os'?'bg-white text-slate-900 shadow-sm':'text-slate-500'}`}>Venda em uma OS</button></div>

      {error && <div className="mb-5 flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"><TriangleAlert className="mt-0.5 shrink-0" size={18}/><div className="flex-1">{error}</div><button onClick={()=>setError('')}><X size={17}/></button></div>}
      {success && <div className="mb-5 flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800"><CheckCircle2 className="mt-0.5 shrink-0" size={18}/><div className="flex-1">{success}</div><button onClick={()=>setSuccess('')}><X size={17}/></button></div>}

      {loading ? <div className="flex min-h-[45vh] items-center justify-center text-slate-500"><Loader2 className="mr-2 animate-spin" size={20}/>Carregando produtos...</div>
      : <form onSubmit={submit} className="grid gap-5 lg:grid-cols-[0.85fr_1.3fr]">
        <section className="space-y-4">
          {mode==='os' && <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-bold uppercase tracking-wide text-slate-400">Ordem de serviço</p>{orders.length===0 ? <div className="mt-4 rounded-2xl bg-slate-50 p-5 text-center text-sm text-slate-500">Nenhuma OS aberta disponível para este usuário.</div>:<div className="mt-4 space-y-2">{orders.map(os=><button type="button" key={os.id} onClick={()=>setOrderId(os.id)} className={`w-full rounded-2xl border p-4 text-left transition ${orderId===os.id?'border-teal-300 bg-teal-50/60 ring-2 ring-teal-100':'border-slate-200 hover:bg-slate-50'}`}><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-bold">OS #{os.numero}</p><p className="mt-1 text-xs text-slate-500">{statusLabel[os.status]||os.status} · {dataBR(os.data)}{os.hora?` às ${os.hora}`:''}</p></div><ChevronRight size={17} className={orderId===os.id?'text-teal-700':'text-slate-300'}/></div>{os.solicitacao&&<p className="mt-2 line-clamp-2 text-xs leading-relaxed text-slate-600">{os.solicitacao}</p>}{os.endereco&&<div className="mt-2 flex items-start gap-1.5 text-xs text-slate-500"><MapPin size={13} className="mt-0.5 shrink-0"/><span>{os.endereco}</span></div>}</button>)}</div>}</div>}

          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-bold uppercase tracking-wide text-slate-400">Resumo</p><div className="mt-4 space-y-3"><div className="flex justify-between gap-4 text-sm"><span className="text-slate-500">Tipo</span><strong>{mode==='quick'?'Venda rápida':'Venda na OS'}</strong></div>{mode==='os'&&<div className="flex justify-between gap-4 text-sm"><span className="text-slate-500">OS</span><strong>{selectedOrder?`#${selectedOrder.numero}`:'Selecione'}</strong></div>}<div className="flex justify-between gap-4 text-sm"><span className="text-slate-500">Produto</span><strong className="text-right">{selectedProduct?.nome||'Selecione'}</strong></div><div className="flex justify-between gap-4 text-sm"><span className="text-slate-500">Quantidade</span><strong>{qty||0}</strong></div>{mode==='quick'&&<div className="flex justify-between gap-4 text-sm"><span className="text-slate-500">Recebimento</span><strong>{paymentMethod||'Não configurado'}</strong></div>}<div className="border-t border-slate-100 pt-3 flex justify-between gap-4"><span className="text-sm font-semibold text-slate-600">Total</span><strong className="text-xl text-teal-700">{brl(total)}</strong></div></div></div>

          {mode==='quick'&&paymentMethod==='Pix'&&<div className="rounded-3xl border border-emerald-200 bg-white p-5 text-center shadow-sm"><p className="text-xs font-bold uppercase tracking-wide text-emerald-700">Pix da empresa</p>{pixQrUrl?<img src={pixQrUrl} alt="QR Code Pix" className="mx-auto mt-4 h-56 w-56 rounded-2xl border border-slate-200 bg-white object-contain p-2"/>:<div className="mt-4 rounded-2xl bg-amber-50 p-4 text-xs text-amber-800">O proprietário ainda não cadastrou uma imagem de QR Code Pix.</div>}{paymentConfig.pixKey&&<><p className="mt-4 break-all text-xs text-slate-600">{paymentConfig.pixKey}</p><Btn variant="secondary" onClick={copyPix} className="mt-3"><Copy size={15}/>Copiar chave Pix</Btn></>}<p className="mt-4 text-[11px] leading-relaxed text-slate-500">Mostre este QR ao cliente e só confirme a venda depois de conferir o pagamento.</p></div>}
        </section>

        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-100 p-5"><p className="text-xs font-bold uppercase tracking-wide text-slate-400">Produto</p><div className="relative mt-3"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={17}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar produto, marca ou modelo" className="w-full rounded-xl border border-slate-200 py-2.5 pl-10 pr-3 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100"/></div></div>
          <div className="max-h-[420px] divide-y divide-slate-100 overflow-y-auto">{filtered.length===0?<div className="p-10 text-center text-sm text-slate-500">Nenhum produto liberado para venda.</div>:filtered.map(p=>{const selected=productId===p.id;const out=p.controlaEstoque&&p.estoque<=0;return <button type="button" disabled={out} key={p.id} onClick={()=>setProductId(p.id)} className={`flex w-full items-center gap-3 p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-45 ${selected?'bg-teal-50/70':'hover:bg-slate-50'}`}><div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50">{p.imagemPath&&images[p.imagemPath]?<img src={images[p.imagemPath]} alt="" className="h-full w-full object-cover"/>:<Package size={19} className="text-slate-300"/>}</div><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{p.nome}</p><p className="mt-0.5 truncate text-xs text-slate-500">{[p.marca,p.modelo].filter(Boolean).join(' · ')||'Produto'}</p><div className="mt-1.5 flex flex-wrap gap-2"><span className="text-xs font-bold text-teal-700">{brl(p.preco)}</span>{p.controlaEstoque&&<span className={`text-xs font-semibold ${p.estoque<=0?'text-rose-600':p.estoque<=2?'text-amber-700':'text-slate-500'}`}>Estoque: {p.estoque}</span>}</div></div>{selected&&<CheckCircle2 className="shrink-0 text-teal-700" size={19}/>}</button>;})}</div>
          <div className="space-y-4 border-t border-slate-100 p-5"><label className="block"><span className="mb-1.5 block text-xs font-semibold text-slate-600">Quantidade</span><input type="number" min="0.01" step="0.01" value={quantity} onChange={e=>setQuantity(e.target.value)} className={`w-full rounded-xl border px-3 py-2.5 text-sm outline-none focus:ring-2 ${insufficient?'border-rose-300 focus:ring-rose-100':'border-slate-200 focus:border-teal-500 focus:ring-teal-100'}`}/>{insufficient&&<p className="mt-1.5 text-xs font-medium text-rose-700">Quantidade maior que o estoque disponível ({selectedProduct?.estoque}).</p>}</label>
            {mode==='quick'&&<div><span className="mb-1.5 block text-xs font-semibold text-slate-600">Como recebeu</span>{formas.length===0?<div className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800">Peça ao proprietário para habilitar Pix, dinheiro ou cartão.</div>:<div className="grid grid-cols-3 gap-2">{formas.map(f=><button key={f} type="button" onClick={()=>setPaymentMethod(f)} className={`rounded-xl border px-3 py-2.5 text-sm font-medium ${paymentMethod===f?'border-teal-500 bg-teal-50 text-teal-800':'border-slate-200 text-slate-600'}`}>{f}</button>)}</div>}<p className="mt-2 text-[11px] leading-relaxed text-slate-400">Cartão significa pagamento confirmado na maquininha do técnico. Dinheiro significa valor já recebido. Pix deve ser confirmado após o cliente pagar.</p></div>}
            <label className="block"><span className="mb-1.5 block text-xs font-semibold text-slate-600">Observação</span><textarea rows="3" maxLength="1000" value={notes} onChange={e=>setNotes(e.target.value)} placeholder={mode==='quick'?'Ex.: vendido na portaria durante a visita':'Ex.: vendido durante o atendimento'} className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100"/></label>
            <Btn type="submit" disabled={saving||!selectedProduct||qty<=0||insufficient||(mode==='os'&&!selectedOrder)||(mode==='quick'&&!paymentMethod)} className="w-full py-3">{saving?<Loader2 className="animate-spin" size={17}/>:<ShoppingCart size={17}/>} {mode==='quick'?`Confirmar ${paymentMethod||'pagamento'} e registrar ${brl(total)}`:'Adicionar produto à OS'}</Btn>
          </div>
        </section>
      </form>}
    </main>
  </div>;
}
