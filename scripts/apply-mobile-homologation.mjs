import { readFileSync, writeFileSync } from 'node:fs';

const file='src/legacy/ZiisTecApp.jsx';
let src=readFileSync(file,'utf8');
const MARK='MOBILE HOMOLOGATION · shell/nav/dashboard · wave 1';
if(src.includes(MARK)){console.log('Mobile homologation wave 1 already applied');process.exit(0);}

const replaceCount=(needle,replacement,expected,label)=>{
  const count=src.split(needle).length-1;
  if(count!==expected)throw new Error(`Mobile wave 1 ${label}: expected ${expected} markers, got ${count}`);
  src=src.split(needle).join(replacement);
};

replaceCount(
  'relative bg-white w-full rounded-t-3xl sm:rounded-3xl shadow-xl flex flex-col max-h-[92vh] sm:max-h-[88vh]',
  'relative bg-white w-full rounded-t-3xl sm:rounded-3xl shadow-xl flex flex-col max-h-[92dvh] sm:max-h-[88dvh]',
  1,
  'visual viewport modal height',
);

replaceCount(
  'relative w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] transition-colors',
  'relative w-full min-h-11 flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] transition-colors',
  1,
  'tablet sidebar touch target',
);

replaceCount(
  'onClick={() => setBusca(true)} aria-label="Buscar" className="p-2.5 text-slate-300"',
  'onClick={() => setBusca(true)} aria-label="Buscar" className="min-h-11 min-w-11 p-2.5 text-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"',
  1,
  'mobile search touch target',
);

replaceCount(
  'onClick={() => setDrawer(true)} aria-label="Abrir menu" className="p-2.5 -mr-2 text-slate-300"',
  'onClick={() => setDrawer(true)} aria-label="Abrir menu" className="min-h-11 min-w-11 p-2.5 -mr-2 text-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"',
  1,
  'mobile menu touch target',
);

replaceCount(
  'onClick={() => setDrawer(false)} aria-label="Fechar menu" className="p-2.5 text-slate-400"',
  'onClick={() => setDrawer(false)} aria-label="Fechar menu" className="min-h-11 min-w-11 p-2.5 text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"',
  1,
  'drawer close touch target',
);

replaceCount(
  '<nav className="zt-nao-imprime md:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-slate-200 flex" aria-label="Navegação rápida">',
  '<nav className="zt-nao-imprime md:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-slate-200 flex pb-[env(safe-area-inset-bottom)]" aria-label="Navegação rápida">',
  1,
  'bottom navigation safe area',
);

replaceCount(
  'className={cx("flex-1 flex flex-col items-center gap-1 py-2.5", ativo ? "text-teal-800" : "text-slate-400")}',
  'className={cx("flex-1 min-h-14 flex flex-col items-center justify-center gap-1 py-2.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-600", ativo ? "text-teal-800" : "text-slate-400")}',
  1,
  'bottom navigation item target',
);

replaceCount(
  'className="flex-1 flex flex-col items-center gap-1 py-2.5 text-slate-400" aria-label="Mais seções"',
  'className="flex-1 min-h-14 flex flex-col items-center justify-center gap-1 py-2.5 text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-600" aria-label="Mais seções"',
  1,
  'bottom more target',
);

replaceCount(
  '<div className="min-h-screen bg-slate-50 text-slate-800 font-sans antialiased">',
  '<div className="min-h-[100dvh] overflow-x-hidden bg-slate-50 text-slate-800 font-sans antialiased">',
  1,
  'shell dynamic viewport',
);

src += `\n/* ${MARK} */\n`;
writeFileSync(file,src,'utf8');
console.log('Applied mobile homologation wave 1 shell/nav/dashboard fixes');
