import { readFileSync, writeFileSync } from 'node:fs';

function apply(file, mark, transform, label) {
  let src = readFileSync(file, 'utf8');
  if (src.includes(mark)) {
    console.log(`${label} already applied`);
    return;
  }
  const before = src;
  src = transform(src);
  if (src === before) throw new Error(`${label}: no changes applied`);
  src += `\n/* ${mark} */\n`;
  writeFileSync(file, src, 'utf8');
  console.log(`Applied ${label}`);
}

function once(src, needle, replacement, label) {
  const count = src.split(needle).length - 1;
  if (count !== 1) throw new Error(`${label}: expected 1 marker, got ${count}`);
  return src.replace(needle, replacement);
}

function countReplace(src, needle, replacement, expected, label) {
  const count = src.split(needle).length - 1;
  if (count !== expected) throw new Error(`${label}: expected ${expected} markers, got ${count}`);
  return src.split(needle).join(replacement);
}

function oneOf(src, variants, replacement, label) {
  for (const needle of variants) {
    if (src.includes(needle)) return src.replace(needle, replacement);
  }
  throw new Error(`${label}: none of the accepted pipeline variants was found`);
}

function insertBeforeInSection(src, sectionStart, anchor, insertion, label) {
  const start = src.indexOf(sectionStart);
  if (start < 0) throw new Error(`${label}: section not found`);
  const at = src.indexOf(anchor, start);
  if (at < 0) throw new Error(`${label}: anchor not found inside section`);
  return src.slice(0, at) + insertion + src.slice(at);
}

apply(
  'src/legacy/ZiisTecApp.jsx',
  'MOBILE HOMOLOGATION · history/warranty · wave 6',
  (input) => {
    let src = input;
    src = insertBeforeInSection(
      src,
      'function Clientes(p) {',
      '  if (clienteAberto) {',
      '  const [localCliente, setLocalCliente] = useState("");\n  useEffect(() => setLocalCliente(""), [clienteAberto]);\n\n',
      'wave6 client local filter state',
    );
    src = once(
      src,
      '    const locais = [...new Set(oss.map((o) => o.localServico).filter(Boolean))];',
      '    const locais = [...new Set(oss.map((o) => o.localServico).filter(Boolean))];\n    const ossVisiveis = localCliente ? oss.filter((o) => o.localServico === localCliente) : oss;',
      'wave6 client local filtered work orders',
    );
    src = once(
      src,
      '                <Panel className="p-5 flex flex-wrap gap-2">\n                  {locais.map((l) => <Pill key={l} tone="neutro">{l}</Pill>)}\n                </Panel>',
      '                <Panel className="p-4 sm:p-5 flex flex-wrap gap-2">\n                  <button type="button" onClick={() => setLocalCliente("")} aria-pressed={!localCliente} className={cx("min-h-11 rounded-xl px-3 py-2 text-[13px] font-medium", !localCliente ? "bg-teal-700 text-white" : "bg-slate-100 text-slate-700", ring)}>Todos os locais</button>\n                  {locais.map((l) => <button type="button" key={l} onClick={() => setLocalCliente(l)} aria-pressed={localCliente === l} className={cx("min-h-11 rounded-xl px-3 py-2 text-[13px] font-medium text-left break-words", localCliente === l ? "bg-teal-700 text-white" : "bg-slate-100 text-slate-700", ring)}>{l}</button>)}\n                </Panel>',
      'wave6 client local touch filter',
    );
    src = once(
      src,
      '              <Rotulo>Histórico de serviços</Rotulo>',
      '              <Rotulo>{localCliente ? `Histórico em ${localCliente}` : "Histórico de serviços"}</Rotulo>',
      'wave6 history local context',
    );
    src = once(
      src,
      '{oss.length === 0 ? <Empty icon={ClipboardList} title="Nenhuma OS ainda" /> : oss.map((o) => (',
      '{ossVisiveis.length === 0 ? <Empty icon={ClipboardList} title={localCliente ? "Nenhuma OS neste local" : "Nenhuma OS ainda"} /> : ossVisiveis.map((o) => (',
      'wave6 history filtered rows',
    );
    src = once(
      src,
      '                  <div className="flex items-center gap-2 shrink-0">\n                    <Pill tone={r.data < HOJE ? "erro" : r.data === HOJE ? "atencao" : "neutro"}>',
      '                  <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0">\n                    <Pill tone={r.data < HOJE ? "erro" : r.data === HOJE ? "atencao" : "neutro"}>',
      'wave6 post-sale action wrapping',
    );
    src = once(
      src,
      '<Btn size="sm" variant="soft" icon={Check} onClick={()=>mudarRevisao(r,"done")}>Concluir</Btn>',
      '<Btn size="sm" variant="soft" icon={Check} className="min-h-11 flex-1 sm:flex-none" onClick={()=>mudarRevisao(r,"done")}>Concluir</Btn>',
      'wave6 post-sale complete target',
    );
    src = once(
      src,
      '<Btn size="sm" variant="ghost" onClick={()=>mudarRevisao(r,"dismissed")}>Dispensar</Btn>',
      '<Btn size="sm" variant="ghost" className="min-h-11 flex-1 sm:flex-none" onClick={()=>mudarRevisao(r,"dismissed")}>Dispensar</Btn>',
      'wave6 post-sale dismiss target',
    );
    return src;
  },
  'Mobile homologation wave 6 client history and post-sale fixes',
);

apply(
  'src/screens/v2/WorkOrderMemoryV2.jsx',
  'MOBILE HOMOLOGATION · history lookup · wave 6',
  (input) => {
    let src = input;
    src = once(src, 'grid grid-cols-3 gap-2 lg:w-[360px]', 'grid grid-cols-1 gap-2 min-[360px]:grid-cols-3 lg:w-[360px]', 'wave6 history KPI narrow stacking');
    src = once(src, '<span className="truncate">{w.service_place}</span>', '<span className="line-clamp-2 break-words">{w.service_place}</span>', 'wave6 service place visibility');
    src = once(src, '<span className="truncate">{w.request}</span>', '<span className="line-clamp-2 break-words">{w.request}</span>', 'wave6 request visibility');
    src = countReplace(
      src,
      'className="flex items-center justify-between gap-3 rounded-2xl bg-black/15 px-4 py-3"',
      'className="flex flex-col items-start gap-2 rounded-2xl bg-black/15 px-4 py-3 min-[390px]:flex-row min-[390px]:items-center min-[390px]:justify-between"',
      2,
      'wave6 items and materials narrow layout',
    );
    src = once(src, 'className="mt-4 grid grid-cols-2 gap-3"', 'className="mt-4 grid grid-cols-1 gap-3 min-[390px]:grid-cols-2"', 'wave6 evidence gallery narrow layout');
    return src;
  },
  'Mobile homologation wave 6 work-order memory lookup fixes',
);

apply(
  'src/screens/v2/ClientLocationsV2.jsx',
  'MOBILE HOMOLOGATION · client location detail · wave 6',
  (input) => {
    let src = input;
    src = once(
      src,
      '<section className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 sm:p-6"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[.15em] text-sky-300">Cliente</p>',
      '<section className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 sm:p-6"><div className="flex flex-col gap-3 min-[390px]:flex-row min-[390px]:items-start min-[390px]:justify-between"><div className="min-w-0"><p className="text-xs font-bold uppercase tracking-[.15em] text-sky-300">Cliente</p>',
      'wave6 client location header stacking',
    );
    src = oneOf(
      src,
      [
        'className="flex min-h-11 items-center gap-2 rounded-xl border border-sky-400/20 bg-sky-400/10 px-3 py-2 text-xs font-bold text-sky-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"',
        'className="flex items-center gap-2 rounded-xl border border-sky-400/20 bg-sky-400/10 px-3 py-2 text-xs font-bold text-sky-300"',
      ],
      'className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-sky-400/20 bg-sky-400/10 px-3 py-2 text-xs font-bold text-sky-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 min-[390px]:w-auto"',
      'wave6 maps button narrow width',
    );
    return src;
  },
  'Mobile homologation wave 6 client-location detail fixes',
);

apply(
  'src/screens/v2/ManualWarrantyV2.jsx',
  'MOBILE HOMOLOGATION · warranties · wave 6',
  (input) => {
    let src = input;
    src = once(src, 'inline-flex items-center justify-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition', 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition', 'wave6 warranty button targets');
    src = once(src, '<div className="min-h-screen bg-slate-50 text-slate-900">', '<div className="min-h-[100dvh] overflow-x-hidden bg-slate-50 text-slate-900">', 'wave6 warranty dynamic viewport');
    src = once(src, 'className="rounded-xl border border-slate-200 p-2.5 text-slate-600 hover:bg-slate-50"', 'className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-slate-200 p-2.5 text-slate-600 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"', 'wave6 warranty back target');
    src = once(src, '<button onClick={()=>setError(\'\')}><X size={17}/></button>', '<button onClick={()=>setError(\'\')} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400" aria-label="Fechar erro"><X size={17}/></button>', 'wave6 warranty error target');
    src = once(src, '<button onClick={()=>setSuccess(\'\')}><X size={17}/></button>', '<button onClick={()=>setSuccess(\'\')} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500" aria-label="Fechar confirmação"><X size={17}/></button>', 'wave6 warranty success target');
    return src;
  },
  'Mobile homologation wave 6 warranty fixes',
);
