import { readFileSync, writeFileSync } from 'node:fs';

function patchFile(file, mark, changes, label) {
  let src=readFileSync(file,'utf8');
  if(src.includes(mark)){console.log(`${label} already applied`);return;}
  const replaceCount=(needle,replacement,expected,changeLabel)=>{
    const count=src.split(needle).length-1;
    if(count!==expected)throw new Error(`${label} ${changeLabel}: expected ${expected} markers, got ${count}`);
    src=src.split(needle).join(replacement);
  };
  for(const change of changes) replaceCount(...change);
  src += `\n/* ${mark} */\n`;
  writeFileSync(file,src,'utf8');
  console.log(`Applied ${label}`);
}

patchFile(
  'src/legacy/ZiisTecApp.jsx',
  'MOBILE HOMOLOGATION · shell/nav/dashboard · wave 1',
  [
    ['relative bg-white w-full rounded-t-3xl sm:rounded-3xl shadow-xl flex flex-col max-h-[92vh] sm:max-h-[88vh]','relative bg-white w-full rounded-t-3xl sm:rounded-3xl shadow-xl flex flex-col max-h-[92dvh] sm:max-h-[88dvh]',1,'visual viewport modal height'],
    ['relative w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] transition-colors','relative w-full min-h-11 flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] transition-colors',1,'tablet sidebar touch target'],
    ['onClick={() => setBusca(true)} aria-label="Buscar" className="p-2.5 text-slate-300"','onClick={() => setBusca(true)} aria-label="Buscar" className="min-h-11 min-w-11 p-2.5 text-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"',1,'mobile search touch target'],
    ['onClick={() => setDrawer(true)} aria-label="Abrir menu" className="p-2.5 -mr-2 text-slate-300"','onClick={() => setDrawer(true)} aria-label="Abrir menu" className="min-h-11 min-w-11 p-2.5 -mr-2 text-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"',1,'mobile menu touch target'],
    ['onClick={() => setDrawer(false)} aria-label="Fechar menu" className="p-2.5 text-slate-400"','onClick={() => setDrawer(false)} aria-label="Fechar menu" className="min-h-11 min-w-11 p-2.5 text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"',1,'drawer close touch target'],
    ['<nav className="zt-nao-imprime md:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-slate-200 flex" aria-label="Navegação rápida">','<nav className="zt-nao-imprime md:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-slate-200 flex pb-[env(safe-area-inset-bottom)]" aria-label="Navegação rápida">',1,'bottom navigation safe area'],
    ['className={cx("flex-1 flex flex-col items-center gap-1 py-2.5", ativo ? "text-teal-800" : "text-slate-400")}','className={cx("flex-1 min-h-14 flex flex-col items-center justify-center gap-1 py-2.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-600", ativo ? "text-teal-800" : "text-slate-400")}',1,'bottom navigation item target'],
    ['className="flex-1 flex flex-col items-center gap-1 py-2.5 text-slate-400" aria-label="Mais seções"','className="flex-1 min-h-14 flex flex-col items-center justify-center gap-1 py-2.5 text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-600" aria-label="Mais seções"',1,'bottom more target'],
    ['<div className="min-h-screen bg-slate-50 text-slate-800 font-sans antialiased">','<div className="min-h-[100dvh] overflow-x-hidden bg-slate-50 text-slate-800 font-sans antialiased">',1,'shell dynamic viewport'],
  ],
  'Mobile homologation wave 1 shell/nav/dashboard fixes',
);

patchFile(
  'src/screens/v2/ClientLocationsV2.jsx',
  'MOBILE HOMOLOGATION · clients · wave 2',
  [
    ['<div className="min-h-screen bg-slate-950 text-white">','<div className="min-h-[100dvh] overflow-x-hidden bg-slate-950 text-white">',1,'dynamic viewport'],
    ['className="rounded-xl border border-white/10 bg-white/5 p-2.5 text-slate-300 hover:bg-white/10"','className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-white/10 bg-white/5 p-2.5 text-slate-300 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"',2,'header icon targets'],
    ['className="ml-auto"><X size={16}/></button>','className="ml-auto inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"><X size={16}/></button>',1,'error dismiss target'],
    ['className="flex items-center gap-2 rounded-xl border border-sky-400/20 bg-sky-400/10 px-3 py-2 text-xs font-bold text-sky-300"','className="flex min-h-11 items-center gap-2 rounded-xl border border-sky-400/20 bg-sky-400/10 px-3 py-2 text-xs font-bold text-sky-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"',1,'open maps target'],
    ['className="flex flex-1 items-center justify-center gap-2 rounded-xl','className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl',2,'location action targets'],
    ['<summary className="cursor-pointer px-4 py-3 text-xs font-bold text-slate-400">','<summary className="flex min-h-11 cursor-pointer items-center px-4 py-3 text-xs font-bold text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-300">',1,'advanced summary target'],
    ['className="flex items-center justify-center gap-2 rounded-xl border border-rose-400/15','className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-rose-400/15',1,'clear target'],
    ['className="flex items-center justify-center gap-2 rounded-xl bg-sky-400','className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-sky-400',1,'save target'],
  ],
  'Mobile homologation wave 2 client/location fixes',
);

patchFile(
  'src/screens/v2/QuoteAIV2.jsx',
  'MOBILE HOMOLOGATION · quote authoring · wave 2',
  [
    ['inline-flex items-center justify-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition','inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition',1,'button targets'],
    ["const inputClass='w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm", "const inputClass='w-full min-h-11 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm",1,'input targets'],
    ['className="w-full rounded-t-3xl bg-white p-5 shadow-2xl sm:max-w-lg sm:rounded-3xl"','className="max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:max-w-lg sm:rounded-3xl"',1,'new client modal viewport'],
    ['className="rounded-xl p-2 text-slate-500 hover:bg-slate-100"','className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl p-2 text-slate-500 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"',1,'new client close target'],
    ['min-h-screen','min-h-[100dvh]',2,'screen viewport'],
    ['className="rounded-xl border border-slate-200 p-2.5 text-slate-600 hover:bg-slate-50"','className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-slate-200 p-2.5 text-slate-600 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"',1,'header back target'],
    ["<button onClick={()=>setError('')}><X size={17}/></button>","<button onClick={()=>setError('')} className=\"inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400\" aria-label=\"Fechar erro\"><X size={17}/></button>",1,'error dismiss target'],
  ],
  'Mobile homologation wave 2 quote authoring fixes',
);

patchFile(
  'src/screens/v2/QuotesManagementV2.jsx',
  'MOBILE HOMOLOGATION · quote management · wave 2',
  [
    ['inline-flex items-center justify-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition','inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition',1,'button targets'],
    ["const inputClass='w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm", "const inputClass='w-full min-h-11 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm",1,'input targets'],
    ['max-h-[92vh] w-full overflow-y-auto','max-h-[92dvh] w-full overflow-y-auto',1,'detail visual viewport'],
    ['className="rounded-xl p-2 text-slate-500 hover:bg-slate-100"','className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl p-2 text-slate-500 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"',2,'modal close targets'],
    ['className="w-full rounded-t-3xl bg-white p-5 shadow-2xl sm:max-w-lg sm:rounded-3xl"','className="max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:max-w-lg sm:rounded-3xl"',1,'generate modal viewport'],
    ['min-h-screen','min-h-[100dvh]',2,'screen viewport'],
    ['className="rounded-xl border border-slate-200 p-2.5 text-slate-600 hover:bg-slate-50"','className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-slate-200 p-2.5 text-slate-600 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"',1,'header back target'],
    ["<button onClick={()=>setError('')}><X size={17}/></button>","<button onClick={()=>setError('')} className=\"inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400\" aria-label=\"Fechar erro\"><X size={17}/></button>",1,'error dismiss target'],
    ["<button onClick={()=>setNotice('')}><X size={17}/></button>","<button onClick={()=>setNotice('')} className=\"inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500\" aria-label=\"Fechar aviso\"><X size={17}/></button>",1,'notice dismiss target'],
    ['className="w-full rounded-xl px-3 py-2 text-left text-xs font-semibold','className="w-full min-h-11 rounded-xl px-3 py-2 text-left text-xs font-semibold',2,'more-menu targets'],
  ],
  'Mobile homologation wave 2 quote management fixes',
);
