import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, CheckCircle2, ChevronRight, Loader2, MapPin, Package, RefreshCcw,
  Search, ShieldCheck, ShoppingCart, TriangleAlert, X,
} from 'lucide-react';
import {
  carregarCatalogoTecnicoDB,
  carregarOSVendaDB,
  recursoV2AindaNaoMigrado,
  venderProdutoNaOSDB,
} from '../../lib/v2Api';
import { resolverImagemProdutoDB } from '../../lib/storageExtras';
import { mensagemErro } from '../../lib/supabase';

const brl = (n) => Number(n || 0).toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
const n = (v) => Number(String(v ?? '').replace(',', '.')) || 0;
const dataBR = (v) => v ? String(v).split('-').reverse().join('/') : 'Sem data';
const statusLabel = { unscheduled:'Aguardando', scheduled:'Agendada', in_progress:'Em andamento' };

function Btn({ children, onClick, disabled=false, variant='primary', type='button', className='' }) {
  const cls = variant === 'primary'
    ? 'bg-emerald-700 text-white hover:bg-emerald-800'
    : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50';
  return <button type={type} onClick={onClick} disabled={disabled} className={`inline-flex items-center justify-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${cls} ${className}`}>{children}</button>;
}

export default function WorkOrderSaleV2({ companyId, companyName='Sua empresa', onClose }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [available, setAvailable] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [orders, setOrders] = useState([]);
  const [products, setProducts] = useState([]);
  const [images, setImages] = useState({});
  const [orderId, setOrderId] = useState('');
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');
  const [search, setSearch] = useState('');

  const load = async ({ keepSelection=true }={}) => {
    setLoading(true); setError('');
    try {
      const [catalog, os] = await Promise.all([
        carregarCatalogoTecnicoDB(companyId),
        carregarOSVendaDB(companyId),
      ]);
      setAvailable(true);
      setProducts(catalog);
      setOrders(os);
      if (!keepSelection || !os.some(x=>x.id===orderId)) setOrderId(os[0]?.id || '');
      if (!keepSelection || !catalog.some(x=>x.id===productId)) setProductId('');
      const paths = [...new Set(catalog.map(p=>p.imagemPath).filter(Boolean))];
      const entries = await Promise.all(paths.map(async path => [path, await resolverImagemProdutoDB(path)]));
      setImages(Object.fromEntries(entries));
    } catch (e) {
      if (recursoV2AindaNaoMigrado(e)) { setAvailable(false); setOrders([]); setProducts([]); }
      else setError(mensagemErro(e));
    } finally { setLoading(false); }
  };

  useEffect(() => { load({ keepSelection:false }); }, [companyId]);

  const selectedOrder = orders.find(x=>x.id===orderId) || null;
  const selectedProduct = products.find(x=>x.id===productId) || null;
  const qty = Math.max(0, n(quantity));
  const insufficient = Boolean(selectedProduct?.controlaEstoque && qty > selectedProduct.estoque);
  const total = (selectedProduct?.preco || 0) * qty;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter(p => !q || `${p.nome} ${p.marca} ${p.modelo}`.toLowerCase().includes(q));
  }, [products, search]);

  const submit = async (e) => {
    e.preventDefault(); setError(''); setSuccess('');
    if (!selectedOrder) { setError('Selecione uma OS aberta.'); return; }
    if (!selectedProduct) { setError('Selecione um produto.'); return; }
    if (qty <= 0) { setError('Informe uma quantidade maior que zero.'); return; }
    if (insufficient) { setError(`Estoque insuficiente. Disponível: ${selectedProduct.estoque}.`); return; }
    setSaving(true);
    try {
      await venderProdutoNaOSDB(selectedOrder.id, selectedProduct.id, qty, notes);
      setSuccess(`${selectedProduct.nome} adicionado à OS #${selectedOrder.numero}. O estoque foi baixado automaticamente quando controlado.`);
      setProductId(''); setQuantity(1); setNotes(''); setSearch('');
      await load({ keepSelection:true });
    } catch (e2) { setError(mensagemErro(e2)); }
    finally { setSaving(false); }
  };

  return <div className="min-h-screen bg-slate-50 text-slate-900">
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <button onClick={onClose} className="rounded-xl border border-slate-200 p-2.5 text-slate-600 hover:bg-slate-50" aria-label="Voltar"><ArrowLeft size={19}/></button>
          <div className="min-w-0"><div className="flex items-center gap-2"><h1 className="truncate text-base font-bold">Venda na ordem de serviço</h1><span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">V2</span></div><p className="truncate text-xs text-slate-500">{companyName}</p></div>
        </div>
        <Btn variant="secondary" onClick={()=>load({keepSelection:true})} disabled={loading}><RefreshCcw size={16}/><span className="hidden sm:inline">Atualizar</span></Btn>
      </div>
    </header>

    <main className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-7">
      <div className="mb-5 rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4">
        <div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 shrink-0 text-emerald-700" size={20}/><div><p className="text-sm font-bold text-emerald-950">Catálogo seguro para campo</p><p className="mt-1 text-xs leading-relaxed text-emerald-800">Esta tela recebe somente preço de venda, estoque e dados comerciais. Custo, margem e fornecedor não são enviados ao técnico.</p></div></div>
      </div>

      {error && <div className="mb-5 flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"><TriangleAlert className="mt-0.5 shrink-0" size={18}/><div className="flex-1">{error}</div><button onClick={()=>setError('')}><X size={17}/></button></div>}
      {success && <div className="mb-5 flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800"><CheckCircle2 className="mt-0.5 shrink-0" size={18}/><div className="flex-1">{success}</div><button onClick={()=>setSuccess('')}><X size={17}/></button></div>}

      {loading ? <div className="flex min-h-[45vh] items-center justify-center text-slate-500"><Loader2 className="mr-2 animate-spin" size={20}/>Carregando catálogo e OS...</div>
      : available === false ? <div className="mx-auto max-w-xl rounded-3xl border border-amber-200 bg-white p-7 text-center shadow-sm"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 text-amber-700"><ShoppingCart size={24}/></div><h2 className="mt-4 text-lg font-bold">Fluxo de venda pronto para homologação</h2><p className="mt-2 text-sm leading-relaxed text-slate-600">A função segura de venda e baixa automática de estoque está na branch, mas as migrations V2 ainda não foram aplicadas à produção. O preview fica bloqueado para não misturar código novo com o banco atual.</p><p className="mt-3 text-xs text-slate-500">Nenhuma venda ou alteração de estoque é feita enquanto esse bloqueio estiver ativo.</p></div>
      : <form onSubmit={submit} className="grid gap-5 lg:grid-cols-[0.9fr_1.35fr]">
        <section className="space-y-4">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">1. Ordem de serviço</p>
            {orders.length===0 ? <div className="mt-4 rounded-2xl bg-slate-50 p-5 text-center text-sm text-slate-500">Nenhuma OS aberta disponível para este usuário.</div> : <div className="mt-4 space-y-2">{orders.map(os=><button type="button" key={os.id} onClick={()=>setOrderId(os.id)} className={`w-full rounded-2xl border p-4 text-left transition ${orderId===os.id?'border-emerald-300 bg-emerald-50/60 ring-2 ring-emerald-100':'border-slate-200 hover:bg-slate-50'}`}><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-bold">OS #{os.numero}</p><p className="mt-1 text-xs text-slate-500">{statusLabel[os.status] || os.status} · {dataBR(os.data)}{os.hora?` às ${os.hora}`:''}</p></div><ChevronRight size={17} className={orderId===os.id?'text-emerald-700':'text-slate-300'}/></div>{os.solicitacao && <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-slate-600">{os.solicitacao}</p>}{os.endereco && <div className="mt-2 flex items-start gap-1.5 text-xs text-slate-500"><MapPin size={13} className="mt-0.5 shrink-0"/><span>{os.endereco}</span></div>}</button>)}</div>}
          </div>

          {selectedOrder && <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-bold uppercase tracking-wide text-slate-400">Resumo da venda</p><div className="mt-4 space-y-3"><div className="flex justify-between gap-4 text-sm"><span className="text-slate-500">OS</span><strong>#{selectedOrder.numero}</strong></div><div className="flex justify-between gap-4 text-sm"><span className="text-slate-500">Produto</span><strong className="text-right">{selectedProduct?.nome || 'Selecione ao lado'}</strong></div><div className="flex justify-between gap-4 text-sm"><span className="text-slate-500">Quantidade</span><strong>{qty || 0}</strong></div><div className="border-t border-slate-100 pt-3 flex justify-between gap-4"><span className="text-sm font-semibold text-slate-600">Valor na OS</span><strong className="text-lg text-emerald-700">{brl(total)}</strong></div></div></div>}
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 p-5"><p className="text-xs font-bold uppercase tracking-wide text-slate-400">2. Produto vendido</p><div className="relative mt-3"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={17}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar produto, marca ou modelo" className="w-full rounded-xl border border-slate-200 py-2.5 pl-10 pr-3 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"/></div></div>

          <div className="max-h-[430px] divide-y divide-slate-100 overflow-y-auto">{filtered.length===0 ? <div className="p-10 text-center text-sm text-slate-500">Nenhum produto disponível para venda.</div> : filtered.map(p=>{ const selected=productId===p.id; const out=p.controlaEstoque && p.estoque<=0; return <button type="button" disabled={out} key={p.id} onClick={()=>setProductId(p.id)} className={`flex w-full items-center gap-3 p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-45 ${selected?'bg-emerald-50/70':'hover:bg-slate-50'}`}><div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50">{p.imagemPath && images[p.imagemPath] ? <img src={images[p.imagemPath]} alt="" className="h-full w-full object-cover"/> : <Package size={19} className="text-slate-300"/>}</div><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{p.nome}</p><p className="mt-0.5 truncate text-xs text-slate-500">{[p.marca,p.modelo].filter(Boolean).join(' · ') || 'Produto'}</p><div className="mt-1.5 flex flex-wrap gap-2"><span className="text-xs font-bold text-emerald-700">{brl(p.preco)}</span>{p.controlaEstoque && <span className={`text-xs font-semibold ${p.estoque<=0?'text-rose-600':p.estoque<=2?'text-amber-700':'text-slate-500'}`}>Estoque: {p.estoque}</span>}</div></div>{selected && <CheckCircle2 className="shrink-0 text-emerald-700" size={19}/>}</button>; })}</div>

          <div className="space-y-4 border-t border-slate-100 p-5">
            <label className="block"><span className="mb-1.5 block text-xs font-semibold text-slate-600">Quantidade</span><input type="number" min="0.01" step="0.01" value={quantity} onChange={e=>setQuantity(e.target.value)} className={`w-full rounded-xl border px-3 py-2.5 text-sm outline-none focus:ring-2 ${insufficient?'border-rose-300 focus:ring-rose-100':'border-slate-200 focus:border-emerald-500 focus:ring-emerald-100'}`}/>{insufficient && <p className="mt-1.5 text-xs font-medium text-rose-700">Quantidade maior que o estoque disponível ({selectedProduct?.estoque}).</p>}</label>
            <label className="block"><span className="mb-1.5 block text-xs font-semibold text-slate-600">Observação para a OS</span><textarea rows="3" maxLength="1000" value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Ex.: vendido durante a visita, número de série será registrado no fechamento..." className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"/></label>
            <Btn type="submit" disabled={saving || !selectedOrder || !selectedProduct || qty<=0 || insufficient} className="w-full py-3">{saving ? <Loader2 className="animate-spin" size={17}/> : <ShoppingCart size={17}/>}Adicionar produto à OS</Btn>
            <p className="text-center text-[11px] leading-relaxed text-slate-400">A ação é validada novamente no banco. Técnico só consegue vender na própria OS aberta; proprietário pode operar nas OS da empresa.</p>
          </div>
        </section>
      </form>}
    </main>
  </div>;
}
