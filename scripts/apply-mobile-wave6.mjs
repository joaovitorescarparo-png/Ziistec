import { readFileSync, writeFileSync } from 'node:fs';

function patch(file, mark, replacements, label) {
  let src = readFileSync(file, 'utf8');
  if (src.includes(mark)) {
    console.log(`${label} already applied`);
    return;
  }
  for (const [needle, replacement, expected, name] of replacements) {
    const count = src.split(needle).length - 1;
    if (count !== expected) throw new Error(`${label} ${name}: expected ${expected} markers, got ${count}`);
    src = src.split(needle).join(replacement);
  }
  src += `\n/* ${mark} */\n`;
  writeFileSync(file, src, 'utf8');
  console.log(`Applied ${label}`);
}

patch(
  'src/legacy/ZiisTecApp.jsx',
  'MOBILE HOMOLOGATION · history/warranty · wave 6',
  [
    [
      '  const [busca, setBusca] = useState("");\n  const [form, setForm] = useState(null);\n  const lista = clientes.filter((c) => semAcento(c.nome + (c.fantasia || "") + c.documento + c.telefone).includes(semAcento(busca)));',
      '  const [busca, setBusca] = useState("");\n  const [form, setForm] = useState(null);\n  const [localCliente, setLocalCliente] = useState("");\n  useEffect(() => setLocalCliente(""), [clienteAberto]);\n  const lista = clientes.filter((c) => semAcento(c.nome + (c.fantasia || "") + c.documento + c.telefone).includes(semAcento(busca)));',
      1,
      'client local filter state',
    ],
    [
      '    const locais = [...new Set(oss.map((o) => o.localServico).filter(Boolean))];\n    const retornos = real ? revisoesCliente.filter((r)=>r.clienteId===c.id && r.status==="pending").map((r)=>({ data:r.data, servico:r.descricao })) : oss.filter((o) => o.retorno).map((o) => o.retorno);',
      '    const locais = [...new Set(oss.map((o) => o.localServico).filter(Boolean))];\n    const ossVisiveis = localCliente ? oss.filter((o) => o.localServico === localCliente) : oss;\n    const retornos = real ? revisoesCliente.filter((r)=>r.clienteId===c.id && r.status==="pending").map((r)=>({ data:r.data, servico:r.descricao })) : oss.filter((o) => o.retorno).map((o) => o.retorno);',
      1,
      'client local filtered work orders',
    ],
    [
      '                <Panel className="p-5 flex flex-wrap gap-2">\n                  {locais.map((l) => <Pill key={l} tone="neutro">{l}</Pill>)}\n                </Panel>',
      '                <Panel className="p-4 sm:p-5 flex flex-wrap gap-2">\n                  <button type="button" onClick={() => setLocalCliente("")} aria-pressed={!localCliente} className={cx("min-h-11 rounded-xl px-3 py-2 text-[13px] font-medium", !localCliente ? "bg-teal-700 text-white" : "bg-slate-100 text-slate-700", ring)}>Todos os locais</button>\n                  {locais.map((l) => <button type="button" key={l} onClick={() => setLocalCliente(l)} aria-pressed={localCliente === l} className={cx("min-h-11 rounded-xl px-3 py-2 text-[13px] font-medium text-left break-words", localCliente === l ? "bg-teal-700 text-white" : "bg-slate-100 text-slate-700", ring)}>{l}</button>)}\n                </Panel>',
      1,
      'client local touch filter',
    ],
    [
      '              <Rotulo>Histórico de serviços</Rotulo>',
      '              <Rotulo>{localCliente ? `Histórico em ${localCliente}` : "Histórico de serviços"}</Rotulo>',
      1,
      'history local context',
    ],
    [
      '{oss.length === 0 ? <Empty icon={ClipboardList} title="Nenhuma OS ainda" /> : oss.map((o) => (',
      '{ossVisiveis.length === 0 ? <Empty icon={ClipboardList} title={localCliente ? "Nenhuma OS neste local" : "Nenhuma OS ainda"} /> : ossVisiveis.map((o) => (',
      1,
      'history filtered rows',
    ],
    [
      '                  <div className="flex items-center gap-2 shrink-0">\n                    <Pill tone={r.data < HOJE ? "erro" : r.data === HOJE ? "atencao" : "neutro"}>',
      '                  <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0">\n                    <Pill tone={r.data < HOJE ? "erro" : r.data === HOJE ? "atencao" : "neutro"}>',
      1,
      'post-sale action wrapping',
    ],
    [
      '<Btn size="sm" variant="soft" icon={Check} onClick={()=>mudarRevisao(r,"done")}>Concluir</Btn>',
      '<Btn size="sm" variant="soft" icon={Check} className="min-h-11 flex-1 sm:flex-none" onClick={()=>mudarRevisao(r,"done")}>Concluir</Btn>',
      1,
      'post-sale complete target',
    ],
    [
      '<Btn size="sm" variant="ghost" onClick={()=>mudarRevisao(r,"dismissed")}>Dispensar</Btn>',
      '<Btn size="sm" variant="ghost" className="min-h-11 flex-1 sm:flex-none" onClick={()=>mudarRevisao(r,"dismissed")}>Dispensar</Btn>',
      1,
      'post-sale dismiss target',
    ],
  ],
  'Mobile homologation wave 6 client history and post-sale fixes',
);

patch(
  'src/screens/v2/WorkOrderMemoryV2.jsx',
  'MOBILE HOMOLOGATION · history lookup · wave 6',
  [
    [
      'grid grid-cols-3 gap-2 lg:w-[360px]',
      'grid grid-cols-1 gap-2 min-[360px]:grid-cols-3 lg:w-[360px]',
      1,
      'history KPI narrow stacking',
    ],
    [
      '<span className="truncate">{w.service_place}</span>',
      '<span className="line-clamp-2 break-words">{w.service_place}</span>',
      1,
      'service place visibility',
    ],
    [
      '<span className="truncate">{w.request}</span>',
      '<span className="line-clamp-2 break-words">{w.request}</span>',
      1,
      'request visibility',
    ],
    [
      'className="flex items-center justify-between gap-3 rounded-2xl bg-black/15 px-4 py-3"',
      'className="flex flex-col items-start gap-2 rounded-2xl bg-black/15 px-4 py-3 min-[390px]:flex-row min-[390px]:items-center min-[390px]:justify-between"',
      2,
      'items and materials narrow layout',
    ],
    [
      'className="mt-4 grid grid-cols-2 gap-3"',
      'className="mt-4 grid grid-cols-1 gap-3 min-[390px]:grid-cols-2"',
      1,
      'evidence gallery narrow layout',
    ],
  ],
  'Mobile homologation wave 6 work-order memory lookup fixes',
);

patch(
  'src/screens/v2/ClientLocationsV2.jsx',
  'MOBILE HOMOLOGATION · client location detail · wave 6',
  [
    [
      '<section className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 sm:p-6"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[.15em] text-sky-300">Cliente</p>',
      '<section className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 sm:p-6"><div className="flex flex-col gap-3 min-[390px]:flex-row min-[390px]:items-start min-[390px]:justify-between"><div className="min-w-0"><p className="text-xs font-bold uppercase tracking-[.15em] text-sky-300">Cliente</p>',
      1,
      'client location header stacking',
    ],
    [
      'className="flex min-h-11 items-center gap-2 rounded-xl border border-sky-400/20 bg-sky-400/10 px-3 py-2 text-xs font-bold text-sky-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"',
      'className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-sky-400/20 bg-sky-400/10 px-3 py-2 text-xs font-bold text-sky-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 min-[390px]:w-auto"',
      1,
      'maps button narrow width',
    ],
  ],
  'Mobile homologation wave 6 client-location detail fixes',
);

patch(
  'src/screens/v2/ManualWarrantyV2.jsx',
  'MOBILE HOMOLOGATION · warranties · wave 6',
  [
    [
      'inline-flex items-center justify-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition',
      'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition',
      1,
      'warranty button targets',
    ],
    [
      '<div className="min-h-screen bg-slate-50 text-slate-900">',
      '<div className="min-h-[100dvh] overflow-x-hidden bg-slate-50 text-slate-900">',
      1,
      'warranty dynamic viewport',
    ],
    [
      'className="rounded-xl border border-slate-200 p-2.5 text-slate-600 hover:bg-slate-50"',
      'className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-slate-200 p-2.5 text-slate-600 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"',
      1,
      'warranty back target',
    ],
    [
      '<button onClick={()=>setError(\'\')}><X size={17}/></button>',
      '<button onClick={()=>setError(\'\')} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400" aria-label="Fechar erro"><X size={17}/></button>',
      1,
      'warranty error target',
    ],
    [
      '<button onClick={()=>setSuccess(\'\')}><X size={17}/></button>',
      '<button onClick={()=>setSuccess(\'\')} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500" aria-label="Fechar confirmação"><X size={17}/></button>',
      1,
      'warranty success target',
    ],
  ],
  'Mobile homologation wave 6 warranty fixes',
);
