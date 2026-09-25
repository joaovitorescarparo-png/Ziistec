import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, CalendarDays, CheckCircle2, ChevronDown, CircleDollarSign, Loader2,
  PackagePlus, Pencil, Plus, ReceiptText, RefreshCcw, Search, ShoppingCart,
  TriangleAlert, X,
} from 'lucide-react';
import {
  carregarComprasV2DB,
  comprasV2AindaNaoMigradas,
  salvarCompraV2DB,
  verificarComprasV2DisponiveisDB,
} from '../../lib/purchaseV2Api';
import { mensagemErro } from '../../lib/supabase';

const brl = (value) => Number(value || 0).toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
const number = (value) => Number(String(value ?? '').replace(',', '.')) || 0;
const today = () => new Date().toISOString().slice(0,10);
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const newItem = () => ({ key:uid(), produtoId:'', nome:'', qtd:1, custo:'' });
const emptyPurchase = () => ({ fornecedor:'', data:today(), vencimento:'', forma:'', pago:false, obs:'', itens:[newItem()] });

function Button({ children, onClick, disabled=false, variant='primary', type='button', className='' }) {
  const cls = variant === 'primary'
    ? 'bg-emerald-700 text-white hover:bg-emerald-800'
    : variant === 'danger'
      ? 'border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100'
      : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50';
  return <button type={type} onClick={onClick} disabled={disabled} className={`inline-flex items-center justify-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${cls} ${className}`}>{children}</button>;
}

function Input({ label, ...props }) {
  return <label className="block"><span className="mb-1.5 block text-xs font-semibold text-slate-600">{label}</span><input {...props} className={`w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 ${props.className || ''}`}/></label>;
}

function Modal({ title, onClose, children }) {
  return <div className="fixed inset-0 z-[12000] flex items-end justify-center bg-slate-950/45 p-0 sm:items-center sm:p-5" onMouseDown={(e)=>{if(e.target===e.currentTarget) onClose?.();}}>
    <div className="max-h-[96vh] w-full overflow-y-auto rounded-t-3xl bg-white shadow-2xl sm:max-w-3xl sm:rounded-3xl">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white/95 px-5 py-4 backdrop-blur"><h2 className="text-base font-bold text-slate-900">{title}</h2><button onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Fechar"><X size={18}/></button></div>
      {children}
    </div>
  </div>;
}

function Kpi({ icon:Icon, label, value, detail, tone='emerald' }) {
  const toneClass = tone === 'amber' ? 'bg-amber-50 text-amber-700' : tone === 'rose' ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700';
  return <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p><p className="mt-1 text-xl font-bold text-slate-900">{value}</p>{detail && <p className="mt-1 text-xs text-slate-500">{detail}</p>}</div><div className={`rounded-xl p-2.5 ${toneClass}`}><Icon size={19}/></div></div></div>;
}

export default function PurchasesV2({ companyId, companyName='Sua empresa', userId, onClose }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [available, setAvailable] = useState(null);
  const [error, setError] = useState('');
  const [products, setProducts] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState(null);

  const load = async () => {
    setLoading(true); setError('');
    try {
      const support = await verificarComprasV2DisponiveisDB(companyId);
      setAvailable(support.disponivel);
      if (!support.disponivel) { setProducts([]); setPurchases([]); return; }
      const data = await carregarComprasV2DB(companyId);
      setProducts(data.produtos || []);
      setPurchases(data.compras || []);
    } catch (e) {
      if (comprasV2AindaNaoMigradas(e)) setAvailable(false);
      else setError(mensagemErro(e));
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [companyId]);

  const productMap = useMemo(() => new Map(products.map(p => [p.id,p])), [products]);
  const month = today().slice(0,7);
  const metrics = useMemo(() => {
    const current = purchases.filter(p => String(p.data || '').slice(0,7) === month);
    const totalOf = (p) => (p.itens || []).reduce((sum,i)=>sum + number(i.qtd)*number(i.custo),0);
    const spend = current.reduce((sum,p)=>sum+totalOf(p),0);
    const payable = purchases.filter(p=>!p.pago).reduce((sum,p)=>sum+totalOf(p),0);
    const overdue = purchases.filter(p=>!p.pago && p.vencimento && p.vencimento < today()).length;
    return { count:current.length, spend, payable, overdue };
  }, [purchases, month]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return purchases;
    return purchases.filter(p => `${p.numero} ${p.fornecedor} ${(p.itens||[]).map(i=>i.nome).join(' ')}`.toLowerCase().includes(q));
  }, [purchases, search]);

  const openNew = () => setForm(emptyPurchase());
  const openEdit = (purchase) => setForm({
    ...purchase,
    itens:(purchase.itens || []).map(i=>({ ...i, key:uid() })),
  });

  const setItem = (index, patch) => setForm(current => ({ ...current, itens:current.itens.map((item,i)=>i===index?{...item,...patch}:item) }));
  const addItem = () => setForm(current => ({ ...current, itens:[...current.itens,newItem()] }));
  const removeItem = (index) => setForm(current => ({ ...current, itens:current.itens.length===1?current.itens:current.itens.filter((_,i)=>i!==index) }));

  const chooseProduct = (index, productId) => {
    if (!productId) { setItem(index,{produtoId:'',nome:'',custo:''}); return; }
    const product = productMap.get(productId);
    setItem(index,{ produtoId:productId, nome:product?.nome || '', custo:product?.custo ?? '' });
  };

  const formTotal = useMemo(() => (form?.itens || []).reduce((sum,i)=>sum+number(i.qtd)*number(i.custo),0), [form]);

  const save = async (e) => {
    e.preventDefault();
    if (!form?.fornecedor?.trim()) { setError('Informe o fornecedor.'); return; }
    if (!form?.data) { setError('Informe a data da compra.'); return; }
    if (!form.itens?.length) { setError('A compra precisa ter pelo menos um item.'); return; }
    for (const item of form.itens) {
      if (!item.nome?.trim()) { setError('Informe o nome de todos os itens.'); return; }
      if (number(item.qtd) <= 0) { setError('A quantidade de cada item precisa ser maior que zero.'); return; }
      if (number(item.custo) < 0) { setError('O custo não pode ser negativo.'); return; }
    }
    if (formTotal <= 0) { setError('O total da compra precisa ser maior que zero.'); return; }

    setSaving(true); setError('');
    try {
      await salvarCompraV2DB(form, companyId, userId);
      setForm(null);
      await load();
    } catch (e2) {
      if (comprasV2AindaNaoMigradas(e2)) setAvailable(false);
      setError(mensagemErro(e2));
    } finally { setSaving(false); }
  };

  return <div className="min-h-screen bg-slate-50 text-slate-900">
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur"><div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6"><div className="flex min-w-0 items-center gap-3"><button onClick={onClose} className="rounded-xl border border-slate-200 p-2.5 text-slate-600 hover:bg-slate-50" aria-label="Voltar"><ArrowLeft size={19}/></button><div className="min-w-0"><div className="flex items-center gap-2"><h1 className="truncate text-base font-bold">Compras</h1><span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">V2</span></div><p className="truncate text-xs text-slate-500">{companyName}</p></div></div><div className="flex gap-2"><Button variant="secondary" onClick={load} disabled={loading}><RefreshCcw size={16}/><span className="hidden sm:inline">Atualizar</span></Button><Button onClick={openNew} disabled={!available}><Plus size={16}/>Compra</Button></div></div></header>

    <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-7">
      <div className="mb-5 rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4"><div className="flex items-start gap-3"><PackagePlus className="mt-0.5 shrink-0 text-emerald-700" size={20}/><div><p className="text-sm font-bold text-emerald-950">Compra e estoque na mesma operação</p><p className="mt-1 text-xs leading-relaxed text-emerald-800">Produto vinculado ao catálogo entra no estoque automaticamente. Se uma compra for editada, o banco aplica somente a diferença; retries não duplicam saldo.</p></div></div></div>

      {error && <div className="mb-5 flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"><TriangleAlert className="mt-0.5 shrink-0" size={18}/><div className="flex-1">{error}</div><button onClick={()=>setError('')}><X size={17}/></button></div>}

      {loading ? <div className="flex min-h-[45vh] items-center justify-center text-slate-500"><Loader2 className="mr-2 animate-spin" size={20}/>Carregando compras...</div>
      : available === false ? <div className="mx-auto max-w-xl rounded-3xl border border-amber-200 bg-white p-7 text-center shadow-sm"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 text-amber-700"><ShoppingCart size={24}/></div><h2 className="mt-4 text-lg font-bold">Compras V2 pronta; banco ainda não migrado</h2><p className="mt-2 text-sm leading-relaxed text-slate-600">A tela depende das migrations de estoque e da reconciliação 0055. No preview de produção ela permanece bloqueada até a homologação completa.</p><p className="mt-3 text-xs text-slate-500">Nenhum dado de produção foi alterado.</p></div>
      : <>
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Kpi icon={ReceiptText} label="Compras no mês" value={metrics.count} detail="registradas neste mês"/><Kpi icon={CircleDollarSign} label="Comprado no mês" value={brl(metrics.spend)} detail="custo total dos itens"/><Kpi icon={CalendarDays} label="A pagar" value={brl(metrics.payable)} detail="compras ainda não baixadas" tone="amber"/><Kpi icon={TriangleAlert} label="Atrasadas" value={metrics.overdue} detail="com vencimento passado" tone={metrics.overdue?'rose':'emerald'}/></section>

        <section className="mt-5 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-100 p-4"><div className="relative max-w-md"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={17}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar compra, fornecedor ou item" className="w-full rounded-xl border border-slate-200 py-2.5 pl-10 pr-3 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"/></div></div>
          {filtered.length===0 ? <div className="px-5 py-16 text-center text-sm text-slate-500">Nenhuma compra encontrada.</div> : <div className="divide-y divide-slate-100">{filtered.map(p=>{const total=(p.itens||[]).reduce((sum,i)=>sum+number(i.qtd)*number(i.custo),0);const overdue=!p.pago&&p.vencimento&&p.vencimento<today();return <article key={p.id} className="p-4 sm:p-5"><div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-bold text-slate-900">{p.numero}</h3><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${p.pago?'bg-emerald-50 text-emerald-700':overdue?'bg-rose-50 text-rose-700':'bg-amber-50 text-amber-700'}`}>{p.pago?'Paga':overdue?'Atrasada':'A pagar'}</span></div><p className="mt-1 text-sm text-slate-700">{p.fornecedor}</p><p className="mt-1 text-xs text-slate-500">{new Date(`${p.data}T12:00:00`).toLocaleDateString('pt-BR')} · {(p.itens||[]).length} item{(p.itens||[]).length===1?'':'s'}{p.vencimento?` · vence ${new Date(`${p.vencimento}T12:00:00`).toLocaleDateString('pt-BR')}`:''}</p><div className="mt-3 flex flex-wrap gap-1.5">{(p.itens||[]).slice(0,4).map(i=><span key={i.id||`${i.nome}-${i.qtd}`} className="rounded-lg bg-slate-100 px-2 py-1 text-[10px] font-medium text-slate-600">{i.qtd}× {i.nome}</span>)}{p.itens?.length>4&&<span className="rounded-lg bg-slate-100 px-2 py-1 text-[10px] font-medium text-slate-500">+{p.itens.length-4}</span>}</div></div><div className="flex items-center justify-between gap-4 sm:block sm:text-right"><div><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Total</p><p className="mt-1 text-lg font-bold text-slate-900">{brl(total)}</p></div><Button variant="secondary" onClick={()=>openEdit(p)}><Pencil size={15}/>Editar</Button></div></div></article>;})}</div>}
        </section>
      </>}
    </main>

    {form && <Modal title={form.id?`Editar ${form.numero}`:'Nova compra'} onClose={()=>!saving&&setForm(null)}><form onSubmit={save} className="p-5"><div className="grid gap-4 sm:grid-cols-2"><Input label="Fornecedor" value={form.fornecedor} onChange={e=>setForm({...form,fornecedor:e.target.value})} placeholder="Distribuidora / fornecedor"/><Input label="Data da compra" type="date" value={form.data||''} onChange={e=>setForm({...form,data:e.target.value})}/><Input label="Vencimento" type="date" value={form.vencimento||''} onChange={e=>setForm({...form,vencimento:e.target.value})}/><label className="block"><span className="mb-1.5 block text-xs font-semibold text-slate-600">Forma de pagamento</span><div className="relative"><select value={form.forma||''} onChange={e=>setForm({...form,forma:e.target.value})} className="w-full appearance-none rounded-xl border border-slate-200 bg-white px-3 py-2.5 pr-9 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"><option value="">Não informada</option><option>Pix</option><option>Dinheiro</option><option>Cartão</option><option>Boleto</option><option>Transferência</option></select><ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={16}/></div></label></div>

          <label className="mt-4 flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3"><input type="checkbox" checked={Boolean(form.pago)} onChange={e=>setForm({...form,pago:e.target.checked})} className="h-4 w-4 accent-emerald-700"/><div><p className="text-sm font-semibold text-slate-800">Compra já paga</p><p className="text-xs text-slate-500">O lançamento financeiro será criado ou atualizado como pago.</p></div></label>

          <div className="mt-6"><div className="mb-3 flex items-center justify-between"><div><p className="text-sm font-bold text-slate-900">Itens da compra</p><p className="mt-0.5 text-xs text-slate-500">Vincule ao catálogo para alimentar o estoque.</p></div><Button variant="secondary" onClick={addItem}><Plus size={15}/>Item</Button></div><div className="space-y-3">{form.itens.map((item,index)=>{const product=item.produtoId?productMap.get(item.produtoId):null;return <div key={item.key||item.id||index} className="rounded-2xl border border-slate-200 p-4"><div className="grid gap-3 sm:grid-cols-2"><label className="block sm:col-span-2"><span className="mb-1.5 block text-xs font-semibold text-slate-600">Produto do catálogo</span><div className="relative"><select value={item.produtoId||''} onChange={e=>chooseProduct(index,e.target.value)} className="w-full appearance-none rounded-xl border border-slate-200 bg-white px-3 py-2.5 pr-9 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"><option value="">Item livre / sem estoque</option>{products.filter(p=>p.ativo).map(p=><option key={p.id} value={p.id}>{p.nome}{p.marca?` · ${p.marca}`:''}{p.modelo?` ${p.modelo}`:''}</option>)}</select><ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={16}/></div></label><Input label="Nome" value={item.nome||''} onChange={e=>setItem(index,{nome:e.target.value})} disabled={Boolean(item.produtoId)} placeholder="Descrição do item"/><div className="grid grid-cols-2 gap-3"><Input label="Quantidade" type="number" min="0.001" step="0.001" value={item.qtd} onChange={e=>setItem(index,{qtd:e.target.value})}/><Input label="Custo unitário" type="number" min="0" step="0.01" value={item.custo} onChange={e=>setItem(index,{custo:e.target.value})}/></div></div>{product && <div className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{product.controlaEstoque ? <>Estoque atual: <strong>{product.estoque}</strong> {product.unidade}. Esta compra será reconciliada automaticamente.</> : <>Produto sem controle de estoque ativado; a compra será registrada sem alterar saldo.</>}</div>}<div className="mt-3 flex items-center justify-between"><span className="text-xs text-slate-500">Subtotal <strong className="text-slate-800">{brl(number(item.qtd)*number(item.custo))}</strong></span>{form.itens.length>1&&<button type="button" onClick={()=>removeItem(index)} className="rounded-lg px-2 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50">Remover</button>}</div></div>;})}</div></div>

          <label className="mt-4 block"><span className="mb-1.5 block text-xs font-semibold text-slate-600">Observações</span><textarea value={form.obs||''} onChange={e=>setForm({...form,obs:e.target.value})} rows={3} className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" placeholder="Número do boleto, referência, observações da compra..."/></label>

          {form.id && <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800"><TriangleAlert className="mr-1 inline" size={14}/>Ao reduzir ou remover um produto de uma compra antiga, o banco só permite a alteração se ainda houver estoque suficiente para devolver essa diferença.</div>}

          <div className="mt-6 flex flex-col-reverse gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Total da compra</p><p className="text-2xl font-bold text-slate-900">{brl(formTotal)}</p></div><div className="flex gap-2"><Button variant="secondary" onClick={()=>setForm(null)} disabled={saving}>Cancelar</Button><Button type="submit" disabled={saving}>{saving?<Loader2 className="animate-spin" size={16}/>:<CheckCircle2 size={16}/>}Salvar compra</Button></div></div>
        </form></Modal>}
  </div>;
}
