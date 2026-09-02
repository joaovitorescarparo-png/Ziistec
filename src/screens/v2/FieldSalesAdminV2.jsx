import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, Building2, CheckCircle2, Clock3, CreditCard, History,
  Loader2, RefreshCcw, Save, ShoppingCart, WalletCards, X,
} from 'lucide-react';
import {
  carregarClientesHistoricoDB,
  carregarConfiguracaoVendaCampoDB,
  carregarHistoricoClienteDB,
  carregarVendasCampoDB,
  salvarConfiguracaoVendaCampoDB,
} from '../../lib/fieldSalesApi';

const brl = (value) => Number(value || 0).toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
const dt = (value) => value ? new Date(value).toLocaleString('pt-BR') : '—';

const paymentOptions = [
  ['allowPix', 'Pix'],
  ['allowCash', 'Dinheiro'],
  ['allowCard', 'Cartão'],
  ['allowTransfer', 'Transferência'],
  ['allowOther', 'Outro'],
];

function StatusPill({ children, tone='slate' }) {
  const cls = tone === 'green'
    ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
    : tone === 'amber'
      ? 'bg-amber-50 text-amber-700 ring-amber-200'
      : 'bg-slate-100 text-slate-600 ring-slate-200';
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ring-inset ${cls}`}>{children}</span>;
}

export default function FieldSalesAdminV2({ companyId, companyName='Sua empresa', onClose }) {
  const [tab, setTab] = useState('vendas');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [sales, setSales] = useState([]);
  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState('');
  const [history, setHistory] = useState([]);
  const [cfg, setCfg] = useState({
    pixKey:'', pixReceiverName:'', pixReceiverCity:'',
    allowPix:true, allowCash:true, allowCard:true, allowTransfer:false, allowOther:false,
  });

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [config, saleRows, clientRows] = await Promise.all([
        carregarConfiguracaoVendaCampoDB(companyId),
        carregarVendasCampoDB(companyId),
        carregarClientesHistoricoDB(companyId),
      ]);
      setCfg(config);
      setSales(saleRows);
      setClients(clientRows);
    } catch (e) {
      setError(e?.message || 'Não consegui carregar esta área.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [companyId]);

  useEffect(() => {
    if (!clientId) {
      setHistory([]);
      return;
    }
    carregarHistoricoClienteDB(companyId, clientId)
      .then(setHistory)
      .catch((e) => setError(e?.message || 'Não consegui carregar o histórico.'));
  }, [clientId, companyId]);

  const totalHoje = useMemo(() => {
    const hoje = new Date().toDateString();
    return sales
      .filter((x) => x.recebido && new Date(x.criadoEm).toDateString() === hoje)
      .reduce((sum, row) => sum + row.total, 0);
  }, [sales]);

  const aguardandoOs = useMemo(
    () => sales.filter((x) => x.origem === 'work_order' && !x.financialEntryId).length,
    [sales],
  );

  const historyByLocal = useMemo(() => {
    const groups = new Map();
    for (const item of history) {
      const local = String(item.local || '').trim() || 'Sem local específico';
      if (!groups.has(local)) groups.set(local, []);
      groups.get(local).push(item);
    }
    return [...groups.entries()].map(([local, items]) => ({ local, items }));
  }, [history]);

  const saveCfg = async () => {
    setSaving(true);
    setError('');
    setOk('');
    try {
      if (cfg.allowPix) {
        if (!String(cfg.pixKey || '').trim()) throw new Error('Informe a chave Pix para manter Pix habilitado.');
        if (!String(cfg.pixReceiverName || '').trim()) throw new Error('Informe o nome/recebedor do Pix.');
        if (!String(cfg.pixReceiverCity || '').trim()) throw new Error('Informe a cidade do recebedor do Pix.');
      }
      setCfg(await salvarConfiguracaoVendaCampoDB(companyId, cfg));
      setOk('Configuração de recebimentos salva. O QR Pix será gerado localmente no celular do técnico com o valor exato de cada venda.');
    } catch (e) {
      setError(e?.message || 'Não consegui salvar.');
    } finally {
      setSaving(false);
    }
  };

  return <div className="min-h-screen bg-slate-50 text-slate-900">
    {/* F09_FIELD_SALES_ADMIN_COMPLETE: protegido pelos testes de contrato após reassemble/codemods. */}
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="rounded-xl border border-slate-200 p-2.5" aria-label="Voltar"><ArrowLeft size={18}/></button>
          <div><h1 className="text-base font-bold">Vendas e recebimentos</h1><p className="text-xs text-slate-500">{companyName}</p></div>
        </div>
        <button onClick={load} disabled={loading} className="rounded-xl border border-slate-200 p-2.5 disabled:opacity-50" aria-label="Atualizar"><RefreshCcw size={17}/></button>
      </div>
    </header>

    <main className="mx-auto max-w-6xl px-4 py-5 sm:px-6">
      <div className="grid grid-cols-3 rounded-2xl bg-slate-200/70 p-1">
        {[['vendas','Vendas'],['recebimentos','Recebimentos'],['historico','Histórico']].map(([id,label]) =>
          <button key={id} onClick={() => setTab(id)} className={`rounded-xl px-2 py-3 text-sm font-semibold ${tab === id ? 'bg-white shadow-sm' : 'text-slate-500'}`}>{label}</button>)}
      </div>

      {error && <div className="mt-4 flex gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"><span className="flex-1">{error}</span><button onClick={() => setError('')}><X size={16}/></button></div>}
      {ok && <div className="mt-4 flex gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800"><CheckCircle2 size={17}/><span className="flex-1">{ok}</span><button onClick={() => setOk('')}><X size={16}/></button></div>}

      {loading ? <div className="flex min-h-[40vh] items-center justify-center text-slate-500"><Loader2 className="mr-2 animate-spin" size={18}/>Carregando...</div> : <>
        {tab === 'vendas' && <section className="mt-5 space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-3xl border border-slate-200 bg-white p-5"><p className="text-xs font-bold uppercase text-slate-400">Vendas registradas</p><p className="mt-2 text-3xl font-bold">{sales.length}</p></div>
            <div className="rounded-3xl border border-slate-200 bg-white p-5"><p className="text-xs font-bold uppercase text-slate-400">Recebido hoje</p><p className="mt-2 text-3xl font-bold text-teal-700">{brl(totalHoje)}</p></div>
            <div className="rounded-3xl border border-slate-200 bg-white p-5"><p className="text-xs font-bold uppercase text-slate-400">A faturar pela OS</p><p className="mt-2 text-3xl font-bold">{aguardandoOs}</p></div>
          </div>

          <div className="space-y-3">
            {sales.length === 0 ? <div className="rounded-3xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">Nenhuma venda em campo registrada.</div>
              : sales.map((sale) => <article key={sale.id} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <ShoppingCart size={17} className="text-teal-700"/>
                      <h2 className="font-bold">{sale.produto}</h2>
                      <StatusPill>{sale.origemLabel}</StatusPill>
                      <StatusPill tone={sale.recebido ? 'green' : sale.origem === 'work_order' && !sale.financialEntryId ? 'amber' : 'slate'}>{sale.statusRecebimento}</StatusPill>
                    </div>
                    {(sale.marca || sale.modelo) && <p className="mt-1 text-xs text-slate-500">{[sale.marca,sale.modelo].filter(Boolean).join(' · ')}</p>}
                  </div>
                  <strong className="text-xl text-teal-700">{brl(sale.total)}</strong>
                </div>

                <dl className="mt-5 grid gap-x-6 gap-y-4 border-t border-slate-100 pt-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div><dt className="text-[11px] font-bold uppercase text-slate-400">Quantidade</dt><dd className="mt-1 text-sm font-semibold">{sale.quantidade}</dd></div>
                  <div><dt className="text-[11px] font-bold uppercase text-slate-400">Preço unitário</dt><dd className="mt-1 text-sm font-semibold">{brl(sale.preco)}</dd></div>
                  <div><dt className="text-[11px] font-bold uppercase text-slate-400">Técnico</dt><dd className="mt-1 text-sm font-semibold">{sale.tecnico}</dd></div>
                  <div><dt className="text-[11px] font-bold uppercase text-slate-400">Data / hora</dt><dd className="mt-1 text-sm font-semibold">{dt(sale.criadoEm)}</dd></div>
                  <div><dt className="text-[11px] font-bold uppercase text-slate-400">Origem / OS</dt><dd className="mt-1 text-sm font-semibold">{sale.origem === 'work_order' ? `Venda em OS #${sale.osNumero || '—'}` : 'Venda rápida'}</dd></div>
                  <div><dt className="text-[11px] font-bold uppercase text-slate-400">Cliente / condomínio</dt><dd className="mt-1 text-sm font-semibold">{sale.cliente || 'Sem vínculo'}</dd></div>
                  <div><dt className="text-[11px] font-bold uppercase text-slate-400">Local</dt><dd className="mt-1 text-sm font-semibold">{sale.local || 'Sem local informado'}</dd></div>
                  <div><dt className="text-[11px] font-bold uppercase text-slate-400">Forma de pagamento</dt><dd className="mt-1 text-sm font-semibold">{sale.pagamentoLabel || '—'}</dd></div>
                </dl>

                <div className="mt-4 grid gap-3 rounded-2xl bg-slate-50 p-4 sm:grid-cols-2">
                  <div><p className="text-[11px] font-bold uppercase text-slate-400">Situação do recebimento</p><p className="mt-1 text-sm font-semibold">{sale.statusRecebimento}</p></div>
                  <div><p className="text-[11px] font-bold uppercase text-slate-400">Vínculo financeiro</p><p className="mt-1 text-sm font-semibold">{sale.statusFinanceiro}</p>{sale.financialEntryId && <p className="mt-1 text-[11px] text-slate-400">Lançamento {sale.financialEntryId.slice(0,8)}…</p>}</div>
                </div>
                {sale.obs && <p className="mt-3 text-xs leading-relaxed text-slate-500">Observação: {sale.obs}</p>}
              </article>)}
          </div>
        </section>}

        {tab === 'recebimentos' && <section className="mt-5 grid gap-5 lg:grid-cols-[1fr_.9fr]">
          <div className="rounded-3xl border border-slate-200 bg-white p-5">
            <div className="flex items-center gap-2"><WalletCards className="text-teal-700" size={20}/><h2 className="font-bold">Formas liberadas para o técnico</h2></div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {paymentOptions.map(([key,label]) => <label key={key} className="flex items-center justify-between rounded-2xl border border-slate-200 p-4"><span className="font-medium">{label}</span><input type="checkbox" checked={!!cfg[key]} onChange={(e) => setCfg((x) => ({ ...x, [key]:e.target.checked }))} className="h-5 w-5"/></label>)}
            </div>

            <div className="mt-6 border-t border-slate-100 pt-5">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Configuração Pix da empresa</p>
              <div className="mt-4 space-y-4">
                <label className="block"><span className="text-xs font-semibold text-slate-600">Chave Pix</span><input maxLength={140} value={cfg.pixKey} onChange={(e) => setCfg((x) => ({ ...x, pixKey:e.target.value }))} placeholder="CPF/CNPJ, telefone, e-mail ou chave aleatória" className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm"/></label>
                <label className="block"><span className="text-xs font-semibold text-slate-600">Nome / recebedor</span><input maxLength={25} value={cfg.pixReceiverName} onChange={(e) => setCfg((x) => ({ ...x, pixReceiverName:e.target.value }))} placeholder="Nome que aparecerá no Pix" className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm"/></label>
                <label className="block"><span className="text-xs font-semibold text-slate-600">Cidade</span><input maxLength={15} value={cfg.pixReceiverCity} onChange={(e) => setCfg((x) => ({ ...x, pixReceiverCity:e.target.value }))} placeholder="Ex.: Itapema" className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm"/></label>
              </div>
            </div>

            <button onClick={saveCfg} disabled={saving} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 py-3 text-sm font-bold text-white disabled:opacity-50"><Save size={16}/>{saving ? 'Salvando...' : 'Salvar recebimentos'}</button>
          </div>

          <div className="rounded-3xl border border-teal-100 bg-teal-50/60 p-5">
            <div className="flex items-center gap-2"><CreditCard className="text-teal-700" size={20}/><h2 className="font-bold text-teal-950">QR Pix dinâmico</h2></div>
            <p className="mt-3 text-sm leading-relaxed text-teal-900">A ZiisTec não armazena mais uma imagem fixa de QR Code. O técnico escolhe o produto e a quantidade; o navegador monta localmente o Pix copia e cola e o QR com o <strong>valor exato daquela venda</strong>.</p>
            <div className="mt-5 rounded-2xl border border-teal-100 bg-white p-4 text-sm text-slate-700">
              <p><strong>1.</strong> Owner configura chave, recebedor e cidade.</p>
              <p className="mt-2"><strong>2.</strong> Técnico seleciona Pix na venda rápida.</p>
              <p className="mt-2"><strong>3.</strong> QR é gerado no aparelho, sem serviço externo.</p>
              <p className="mt-2"><strong>4.</strong> Venda, estoque e financeiro só são gravados após “Confirmar pagamento recebido”.</p>
            </div>
          </div>
        </section>}

        {tab === 'historico' && <section className="mt-5 grid gap-5 lg:grid-cols-[.8fr_1.2fr]">
          <div className="rounded-3xl border border-slate-200 bg-white p-5">
            <div className="flex items-center gap-2"><Building2 className="text-teal-700" size={19}/><h2 className="font-bold">Cliente ou condomínio</h2></div>
            <select value={clientId} onChange={(e) => setClientId(e.target.value)} className="mt-4 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm"><option value="">Selecione...</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.trade_name || c.name}</option>)}</select>
            <p className="mt-3 text-xs leading-relaxed text-slate-500">O histórico é derivado dos registros reais da ZiisTec: cliente/condomínio → local → OS/atendimento → produtos vendidos → garantias. Não existe uma tabela paralela de “histórico”.</p>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5">
            <div className="flex items-center gap-2"><History className="text-teal-700" size={19}/><h2 className="font-bold">Histórico de prestação</h2></div>
            {!clientId ? <div className="mt-5 rounded-2xl bg-slate-50 p-8 text-center text-sm text-slate-500">Escolha um cliente ou condomínio.</div>
              : history.length === 0 ? <div className="mt-5 rounded-2xl bg-slate-50 p-8 text-center text-sm text-slate-500">Ainda não há histórico para este cadastro.</div>
                : <div className="mt-5 space-y-5">{historyByLocal.map((group) => <section key={group.local} className="rounded-2xl border border-slate-200 p-4"><div className="flex items-center justify-between gap-3"><h3 className="font-bold">{group.local}</h3><span className="text-[11px] text-slate-400">{group.items.length} registro(s)</span></div><div className="mt-3 space-y-3">{group.items.map((item) => <div key={item.id} className="rounded-2xl bg-slate-50 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><span className="rounded-full bg-white px-2 py-1 text-[10px] font-bold uppercase text-slate-600 ring-1 ring-slate-200">{item.tipo}</span><span className="flex items-center gap-1 text-[11px] text-slate-400"><Clock3 size={12}/>{dt(item.data)}</span></div><p className="mt-2 font-bold">{item.titulo}</p><p className="mt-1 text-sm text-slate-600">{item.descricao}</p></div>)}</div></section>)}</div>}
          </div>
        </section>}
      </>}
    </main>
  </div>;
}
