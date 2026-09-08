import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, Boxes, CircleDollarSign, History, ImagePlus, Loader2, Minus, Package,
  Pencil, Plus, RefreshCcw, Search, ShieldCheck, TrendingUp, TriangleAlert, X,
} from 'lucide-react';
import { salvarProdutoDB } from '../../lib/dataApi';
import {
  ajustarEstoqueDB,
  carregarMovimentosEstoqueDB,
  carregarProdutosEstoqueDB,
  recursoV2AindaNaoMigrado,
  verificarProdutoV2DisponivelDB,
} from '../../lib/v2Api';
import {
  removerImagemProdutoDB,
  resolverImagemProdutoDB,
  salvarImagemProdutoDB,
} from '../../lib/storageExtras';
import { mensagemErro } from '../../lib/supabase';

const brl = (n) => Number(n || 0).toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
const n = (v) => Number(String(v ?? '').replace(',', '.')) || 0;
const hojeHora = (v) => v ? new Date(v).toLocaleString('pt-BR', { dateStyle:'short', timeStyle:'short' }) : '—';

const VAZIO = {
  nome:'', marca:'', modelo:'', descricao:'', unidade:'unidade', custo:'', preco:'', garantiaMeses:12,
  ativo:true, vendaHabilitada:true, controlaEstoque:true, estoqueMinimo:1, estoqueInicial:0,
  imagemPath:null,
};

function Btn({ children, onClick, disabled=false, variant='primary', type='button', className='' }) {
  const cls = variant === 'primary'
    ? 'bg-emerald-700 text-white hover:bg-emerald-800'
    : variant === 'danger'
      ? 'bg-rose-50 text-rose-700 hover:bg-rose-100'
      : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50';
  return <button type={type} onClick={onClick} disabled={disabled} className={`inline-flex items-center justify-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${cls} ${className}`}>{children}</button>;
}

function Input({ label, ...props }) {
  return <label className="block"><span className="mb-1.5 block text-xs font-semibold text-slate-600">{label}</span><input {...props} className={`w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 ${props.className || ''}`} /></label>;
}

function Modal({ title, children, onClose, wide=false }) {
  return <div className="fixed inset-0 z-[12000] flex items-end justify-center bg-slate-950/45 p-0 sm:items-center sm:p-5" onMouseDown={(e)=>{ if(e.target===e.currentTarget) onClose?.(); }}>
    <div className={`max-h-[94vh] w-full overflow-y-auto rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl ${wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'}`}>
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white/95 px-5 py-4 backdrop-blur">
        <h2 className="text-base font-bold text-slate-900">{title}</h2>
        <button onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Fechar"><X size={18}/></button>
      </div>
      {children}
    </div>
  </div>;
}

function Kpi({ icon:Icon, label, value, detail }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
    <div className="flex items-start justify-between gap-3">
      <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p><p className="mt-1 text-xl font-bold text-slate-900">{value}</p>{detail && <p className="mt-1 text-xs text-slate-500">{detail}</p>}</div>
      <div className="rounded-xl bg-emerald-50 p-2.5 text-emerald-700"><Icon size={19}/></div>
    </div>
  </div>;
}

export default function ProductStockV2({ companyId, companyName='Sua empresa', onClose }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [available, setAvailable] = useState(null);
  const [error, setError] = useState('');
  const [products, setProducts] = useState([]);
  const [images, setImages] = useState({});
  const [search, setSearch] = useState('');
  const [onlyLow, setOnlyLow] = useState(false);
  const [form, setForm] = useState(null);
  const [imageFile, setImageFile] = useState(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [stock, setStock] = useState(null);
  const [movementProduct, setMovementProduct] = useState(null);
  const [movements, setMovements] = useState([]);
  const [movementsLoading, setMovementsLoading] = useState(false);

  const load = async () => {
    setLoading(true); setError('');
    try {
      const support = await verificarProdutoV2DisponivelDB(companyId);
      setAvailable(support.disponivel);
      if (!support.disponivel) { setProducts([]); return; }
      const rows = await carregarProdutosEstoqueDB(companyId);
      setProducts(rows);
      const paths = [...new Set(rows.map(p=>p.imagemPath).filter(Boolean))];
      const entries = await Promise.all(paths.map(async path => [path, await resolverImagemProdutoDB(path)]));
      setImages(Object.fromEntries(entries));
    } catch (e) {
      setError(mensagemErro(e));
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [companyId]);

  const metrics = useMemo(() => {
    const tracked = products.filter(p=>p.controlaEstoque);
    const low = tracked.filter(p=>p.estoque <= p.estoqueMinimo);
    const cost = tracked.reduce((t,p)=>t + p.estoque * p.custo, 0);
    const sale = tracked.reduce((t,p)=>t + p.estoque * p.preco, 0);
    return { total:products.length, low:low.length, cost, sale };
  }, [products]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter(p => {
      const hay = `${p.nome} ${p.marca} ${p.modelo}`.toLowerCase();
      const low = !p.controlaEstoque || p.estoque > p.estoqueMinimo;
      return (!q || hay.includes(q)) && (!onlyLow || !low);
    });
  }, [products, search, onlyLow]);

  const openNew = () => { setForm({ ...VAZIO }); setImageFile(null); setRemoveImage(false); };
  const openEdit = (p) => { setForm({ ...p, estoqueInicial:0 }); setImageFile(null); setRemoveImage(false); };

  const saveProduct = async (e) => {
    e.preventDefault();
    if (!form?.nome?.trim()) { setError('Informe o nome do produto.'); return; }
    if (n(form.custo) < 0 || n(form.preco) < 0) { setError('Custo e preço não podem ser negativos.'); return; }
    setSaving(true); setError('');
    try {
      const editing = Boolean(form.id);
      const oldPath = form.imagemPath || null;
      const payload = {
        ...form,
        custo:n(form.custo), preco:n(form.preco), garantiaMeses:Math.max(0, n(form.garantiaMeses)),
        estoqueMinimo:Math.max(0, n(form.estoqueMinimo)), estoque:editing ? form.estoque : 0,
      };
      let saved = await salvarProdutoDB(payload, companyId);
      if (removeImage && oldPath) {
        await removerImagemProdutoDB(saved.id, companyId, oldPath);
        saved = { ...saved, imagemPath:null };
      }
      if (imageFile) {
        const uploaded = await salvarImagemProdutoDB(saved.id, imageFile, companyId, removeImage ? null : oldPath);
        saved = { ...saved, imagemPath:uploaded.path };
      }
      const initial = Math.max(0, n(form.estoqueInicial));
      if (!editing && saved.controlaEstoque && initial > 0) {
        await ajustarEstoqueDB(companyId, saved.id, initial, 'Estoque inicial do cadastro');
      }
      setForm(null);
      await load();
    } catch (e2) {
      if (recursoV2AindaNaoMigrado(e2)) setAvailable(false);
      setError(mensagemErro(e2));
    } finally { setSaving(false); }
  };

  const applyStock = async (e) => {
    e.preventDefault();
    const qty = Math.max(0, n(stock?.quantidade));
    if (!qty) { setError('Informe uma quantidade maior que zero.'); return; }
    const delta = stock.tipo === 'saida' ? -qty : qty;
    if (delta < 0 && qty > stock.produto.estoque) { setError('A saída é maior que o estoque atual.'); return; }
    setSaving(true); setError('');
    try {
      await ajustarEstoqueDB(companyId, stock.produto.id, delta, stock.obs || (delta > 0 ? 'Entrada manual de estoque' : 'Saída manual de estoque'));
      setStock(null);
      await load();
    } catch (e2) { setError(mensagemErro(e2)); }
    finally { setSaving(false); }
  };

  const openMovements = async (p) => {
    setMovementProduct(p); setMovements([]); setMovementsLoading(true); setError('');
    try { setMovements(await carregarMovimentosEstoqueDB(companyId, p.id)); }
    catch (e) { setError(mensagemErro(e)); }
    finally { setMovementsLoading(false); }
  };

  return <div className="min-h-screen bg-slate-50 text-slate-900">
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <button onClick={onClose} className="rounded-xl border border-slate-200 p-2.5 text-slate-600 hover:bg-slate-50" aria-label="Voltar"><ArrowLeft size={19}/></button>
          <div className="min-w-0"><div className="flex items-center gap-2"><h1 className="truncate text-base font-bold">Produtos e estoque</h1><span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">V2</span></div><p className="truncate text-xs text-slate-500">{companyName}</p></div>
        </div>
        <div className="flex gap-2"><Btn variant="secondary" onClick={load} disabled={loading}><RefreshCcw size={16}/><span className="hidden sm:inline">Atualizar</span></Btn><Btn onClick={openNew} disabled={!available}><Plus size={16}/>Produto</Btn></div>
      </div>
    </header>

    <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-7">
      <div className="mb-5 rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4">
        <div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 shrink-0 text-emerald-700" size={20}/><div><p className="text-sm font-bold text-emerald-950">Custos protegidos no banco</p><p className="mt-1 text-xs leading-relaxed text-emerald-800">Esta área é do proprietário. O técnico usa um catálogo comercial separado e não recebe custo, margem ou fornecedor pela API.</p></div></div>
      </div>

      {error && <div className="mb-5 flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"><TriangleAlert className="mt-0.5 shrink-0" size={18}/><div className="flex-1">{error}</div><button onClick={()=>setError('')}><X size={17}/></button></div>}

      {loading ? <div className="flex min-h-[45vh] items-center justify-center text-slate-500"><Loader2 className="mr-2 animate-spin" size={20}/>Carregando produtos...</div>
      : available === false ? <div className="mx-auto max-w-xl rounded-3xl border border-amber-200 bg-white p-7 text-center shadow-sm"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 text-amber-700"><Boxes size={24}/></div><h2 className="mt-4 text-lg font-bold">Tela V2 pronta; banco ainda não migrado</h2><p className="mt-2 text-sm leading-relaxed text-slate-600">A página já está conectada ao contrato novo, mas as migrations 0050–0053 continuam fora da produção por segurança. Por isso ela fica bloqueada no preview até a homologação do banco.</p><p className="mt-3 text-xs text-slate-500">Nenhum dado de produção foi alterado.</p></div>
      : <>
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi icon={Package} label="Produtos" value={metrics.total} detail="ativos e inativos"/>
          <Kpi icon={TriangleAlert} label="Estoque baixo" value={metrics.low} detail="no mínimo ou abaixo"/>
          <Kpi icon={CircleDollarSign} label="Custo em estoque" value={brl(metrics.cost)} detail="visível só ao proprietário"/>
          <Kpi icon={TrendingUp} label="Venda potencial" value={brl(metrics.sale)} detail="pelo preço cadastrado"/>
        </section>

        <section className="mt-5 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative flex-1 sm:max-w-md"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={17}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar produto, marca ou modelo" className="w-full rounded-xl border border-slate-200 py-2.5 pl-10 pr-3 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"/></div>
            <button onClick={()=>setOnlyLow(v=>!v)} className={`rounded-xl border px-3 py-2.5 text-xs font-semibold ${onlyLow ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>Somente estoque baixo</button>
          </div>

          {filtered.length === 0 ? <div className="px-5 py-16 text-center text-sm text-slate-500">Nenhum produto encontrado.</div>
          : <div className="divide-y divide-slate-100">{filtered.map(p => {
            const low = p.controlaEstoque && p.estoque <= p.estoqueMinimo;
            const margin = p.preco > 0 ? ((p.preco-p.custo)/p.preco)*100 : 0;
            return <article key={p.id} className="p-4 sm:p-5">
              <div className="flex gap-4">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                  {p.imagemPath && images[p.imagemPath] ? <img src={images[p.imagemPath]} alt="" className="h-full w-full object-cover"/> : <Package size={23} className="text-slate-300"/>}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="truncate text-sm font-bold text-slate-900">{p.nome}</h3>{!p.ativo && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">Inativo</span>}{low && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">Estoque baixo</span>}</div><p className="mt-1 text-xs text-slate-500">{[p.marca,p.modelo].filter(Boolean).join(' · ') || 'Sem marca/modelo'}</p></div><div className="flex shrink-0 gap-2"><button onClick={()=>openMovements(p)} className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50" title="Histórico"><History size={16}/></button><button onClick={()=>openEdit(p)} className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50" title="Editar"><Pencil size={16}/></button></div></div>

                  <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-5">
                    <div><p className="text-[10px] font-semibold uppercase text-slate-400">Venda</p><p className="text-sm font-bold">{brl(p.preco)}</p></div>
                    <div><p className="text-[10px] font-semibold uppercase text-slate-400">Custo</p><p className="text-sm font-semibold text-slate-700">{brl(p.custo)}</p></div>
                    <div><p className="text-[10px] font-semibold uppercase text-slate-400">Margem</p><p className={`text-sm font-semibold ${margin < 15 ? 'text-amber-700':'text-emerald-700'}`}>{margin.toFixed(0)}%</p></div>
                    <div><p className="text-[10px] font-semibold uppercase text-slate-400">Estoque</p><p className={`text-sm font-bold ${low ? 'text-amber-700':''}`}>{p.controlaEstoque ? `${p.estoque} ${p.unidade}` : 'Não controlado'}</p></div>
                    <div className="col-span-2 sm:col-span-1"><p className="text-[10px] font-semibold uppercase text-slate-400">Mínimo</p><p className="text-sm font-semibold text-slate-700">{p.controlaEstoque ? p.estoqueMinimo : '—'}</p></div>
                  </div>

                  {p.controlaEstoque && <div className="mt-4 flex flex-wrap gap-2"><Btn variant="secondary" onClick={()=>setStock({ produto:p, tipo:'entrada', quantidade:1, obs:'' })}><Plus size={15}/>Entrada</Btn><Btn variant="secondary" onClick={()=>setStock({ produto:p, tipo:'saida', quantidade:1, obs:'' })} disabled={p.estoque<=0}><Minus size={15}/>Saída</Btn></div>}
                </div>
              </div>
            </article>;
          })}</div>}
        </section>
      </>}
    </main>

    {form && <Modal title={form.id ? 'Editar produto' : 'Novo produto'} onClose={()=>!saving&&setForm(null)} wide>
      <form onSubmit={saveProduct} className="space-y-5 p-5">
        <div className="grid gap-4 sm:grid-cols-2"><div className="sm:col-span-2"><Input label="Nome do produto *" value={form.nome} onChange={e=>setForm({...form,nome:e.target.value})} autoFocus/></div><Input label="Marca" value={form.marca} onChange={e=>setForm({...form,marca:e.target.value})}/><Input label="Modelo" value={form.modelo} onChange={e=>setForm({...form,modelo:e.target.value})}/><Input label="Preço de venda" inputMode="decimal" value={form.preco} onChange={e=>setForm({...form,preco:e.target.value})}/><Input label="Custo" inputMode="decimal" value={form.custo} onChange={e=>setForm({...form,custo:e.target.value})}/><Input label="Garantia (meses)" type="number" min="0" value={form.garantiaMeses} onChange={e=>setForm({...form,garantiaMeses:e.target.value})}/><Input label="Unidade" value={form.unidade} onChange={e=>setForm({...form,unidade:e.target.value})}/></div>

        <label className="block"><span className="mb-1.5 block text-xs font-semibold text-slate-600">Descrição</span><textarea rows="3" value={form.descricao} onChange={e=>setForm({...form,descricao:e.target.value})} className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"/></label>

        <div className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2">
          <label className="flex items-center gap-3 text-sm font-medium text-slate-700"><input type="checkbox" checked={form.vendaHabilitada} onChange={e=>setForm({...form,vendaHabilitada:e.target.checked})} className="h-4 w-4 accent-emerald-700"/>Disponível para venda na OS</label>
          <label className="flex items-center gap-3 text-sm font-medium text-slate-700"><input type="checkbox" checked={form.controlaEstoque} onChange={e=>setForm({...form,controlaEstoque:e.target.checked})} className="h-4 w-4 accent-emerald-700"/>Controlar estoque</label>
          <label className="flex items-center gap-3 text-sm font-medium text-slate-700"><input type="checkbox" checked={form.ativo} onChange={e=>setForm({...form,ativo:e.target.checked})} className="h-4 w-4 accent-emerald-700"/>Produto ativo</label>
          {form.controlaEstoque && <Input label="Estoque mínimo" type="number" min="0" value={form.estoqueMinimo} onChange={e=>setForm({...form,estoqueMinimo:e.target.value})}/>} 
          {!form.id && form.controlaEstoque && <div className="sm:col-span-2"><Input label="Estoque inicial" type="number" min="0" value={form.estoqueInicial} onChange={e=>setForm({...form,estoqueInicial:e.target.value})}/><p className="mt-1 text-[11px] text-slate-500">A quantidade inicial será registrada como movimento de estoque, mantendo o histórico auditável.</p></div>}
        </div>

        <div className="rounded-2xl border border-slate-200 p-4"><p className="text-xs font-semibold text-slate-600">Foto do produto</p><div className="mt-3 flex flex-wrap items-center gap-3"><label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"><ImagePlus size={16}/>Escolher foto<input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={e=>setImageFile(e.target.files?.[0]||null)}/></label>{imageFile && <span className="max-w-[260px] truncate text-xs text-slate-500">{imageFile.name}</span>}{form.imagemPath && !imageFile && <label className="flex items-center gap-2 text-xs text-rose-700"><input type="checkbox" checked={removeImage} onChange={e=>setRemoveImage(e.target.checked)} className="accent-rose-600"/>Remover foto atual</label>}</div><p className="mt-2 text-[11px] text-slate-400">JPG, PNG ou WEBP, até 2 MB.</p></div>

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4"><Btn variant="secondary" onClick={()=>setForm(null)} disabled={saving}>Cancelar</Btn><Btn type="submit" disabled={saving}>{saving ? <Loader2 className="animate-spin" size={16}/> : <ShieldCheck size={16}/>}Salvar produto</Btn></div>
      </form>
    </Modal>}

    {stock && <Modal title={`${stock.tipo==='saida'?'Saída':'Entrada'} de estoque`} onClose={()=>!saving&&setStock(null)}>
      <form onSubmit={applyStock} className="space-y-4 p-5"><div className="rounded-2xl bg-slate-50 p-4"><p className="text-sm font-bold">{stock.produto.nome}</p><p className="mt-1 text-xs text-slate-500">Estoque atual: {stock.produto.estoque} {stock.produto.unidade}</p></div><Input label="Quantidade" type="number" min="0.01" step="0.01" value={stock.quantidade} onChange={e=>setStock({...stock,quantidade:e.target.value})} autoFocus/><label className="block"><span className="mb-1.5 block text-xs font-semibold text-slate-600">Observação</span><textarea rows="3" value={stock.obs} onChange={e=>setStock({...stock,obs:e.target.value})} placeholder="Ex.: compra do fornecedor, ajuste de contagem..." className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"/></label><div className="flex justify-end gap-2 pt-2"><Btn variant="secondary" onClick={()=>setStock(null)} disabled={saving}>Cancelar</Btn><Btn type="submit" disabled={saving}>{saving && <Loader2 className="animate-spin" size={16}/>}Confirmar</Btn></div></form>
    </Modal>}

    {movementProduct && <Modal title="Histórico de estoque" onClose={()=>setMovementProduct(null)} wide>
      <div className="p-5"><div className="mb-4 rounded-2xl bg-slate-50 p-4"><p className="text-sm font-bold">{movementProduct.nome}</p><p className="mt-1 text-xs text-slate-500">Saldo atual: {movementProduct.estoque} {movementProduct.unidade}</p></div>{movementsLoading ? <div className="py-10 text-center text-sm text-slate-500"><Loader2 className="mx-auto mb-2 animate-spin" size={20}/>Carregando histórico...</div> : movements.length===0 ? <div className="py-10 text-center text-sm text-slate-500">Ainda não há movimentos registrados.</div> : <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200">{movements.map(m=><div key={m.id} className="flex items-start justify-between gap-4 p-4"><div><p className="text-sm font-semibold text-slate-800">{m.tipo==='purchase'?'Compra':m.tipo==='sale'?'Venda na OS':m.tipo==='usage'?'Uso em serviço':m.tipo==='return'?'Devolução':'Ajuste'}</p><p className="mt-1 text-xs text-slate-500">{m.obs || 'Sem observação'} · {hojeHora(m.criadoEm)}</p></div><div className={`shrink-0 text-sm font-bold ${m.quantidade>=0?'text-emerald-700':'text-rose-700'}`}>{m.quantidade>=0?'+':''}{m.quantidade}</div></div>)}</div>}</div>
    </Modal>}
  </div>;
}
