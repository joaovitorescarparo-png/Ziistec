import { readFileSync, writeFileSync } from 'node:fs';

const file='src/screens/v2/WorkOrderMemoryV2.jsx';
let src=readFileSync(file,'utf8');
const MARK='MOBILE HOMOLOGATION · work order memory · wave 3';
if(src.includes(MARK)){console.log('Mobile homologation wave 3 already applied');process.exit(0);}

const replaceCompatible=(needles,replacement,expected,label)=>{
  const legacyCount=needles.reduce((sum,needle)=>sum+(src.split(needle).length-1),0);
  const readyCount=src.split(replacement).length-1;
  if(legacyCount===0&&readyCount===expected) return;
  if(legacyCount!==expected)throw new Error(`Mobile wave 3 ${label}: expected ${expected} compatible markers, got ${legacyCount} (ready ${readyCount})`);
  for(const needle of needles) src=src.split(needle).join(replacement);
};

replaceCompatible(
  ['<div className="min-h-screen bg-slate-950 text-white">'],
  '<div className="min-h-[100dvh] overflow-x-hidden bg-slate-950 text-white">',
  1,
  'dynamic viewport',
);
replaceCompatible(
  [
    'className="rounded-xl border border-white/10 bg-white/5 p-2.5 text-slate-300 hover:bg-white/10"',
    'className="min-h-11 min-w-11 rounded-xl border border-white/10 bg-white/5 p-2.5 text-slate-300 hover:bg-white/10"',
  ],
  'className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-white/10 bg-white/5 p-2.5 text-slate-300 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"',
  2,
  'header icon targets',
);
replaceCompatible(
  [
    'className="ml-auto"><X size={16}/></button>',
    'className="ml-auto min-h-11 min-w-11 rounded-xl p-2"><X size={16}/></button>',
  ],
  'className="ml-auto inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300" aria-label="Fechar erro"><X size={16}/></button>',
  1,
  'error dismiss target',
);
replaceCompatible(
  [
    "className={`whitespace-nowrap rounded-xl px-3.5 py-2.5 text-xs font-bold ${filter===id?'bg-emerald-500 text-slate-950':'border border-white/10 bg-white/[0.04] text-slate-400'}`}",
    "className={`min-h-11 whitespace-nowrap rounded-xl px-3.5 py-2.5 text-xs font-bold ${filter===id?'bg-emerald-500 text-slate-950':'border border-white/10 bg-white/[0.04] text-slate-400'}`}",
  ],
  "className={`min-h-11 whitespace-nowrap rounded-xl px-3.5 py-2.5 text-xs font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 ${filter===id?'bg-emerald-500 text-slate-950':'border border-white/10 bg-white/[0.04] text-slate-400'}`}",
  1,
  'filter targets',
);
replaceCompatible(
  [
    "className={`absolute right-3 top-3 rounded-xl p-2.5 ${speech.listening?'bg-rose-500 text-white':'bg-white/10 text-sky-300'}`}",
    "className={`absolute right-3 top-3 min-h-11 min-w-11 rounded-xl p-2.5 ${speech.listening?'bg-rose-500 text-white':'bg-white/10 text-sky-300'}`}",
  ],
  "className={`absolute right-3 top-3 inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl p-2.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 ${speech.listening?'bg-rose-500 text-white':'bg-white/10 text-sky-300'}`}",
  1,
  'speech target',
);
replaceCompatible(
  [
    'className="rounded-xl bg-sky-500 px-4 py-2.5 text-xs font-bold text-slate-950 disabled:opacity-40"',
    'className="min-h-11 rounded-xl bg-sky-500 px-4 py-2.5 text-xs font-bold text-slate-950 disabled:opacity-40"',
  ],
  'className="min-h-11 rounded-xl bg-sky-500 px-4 py-2.5 text-xs font-bold text-slate-950 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"',
  1,
  'save report target',
);
replaceCompatible(
  [
    "className={`rounded-xl px-3 py-2 text-[11px] font-bold ${stage===s?'bg-amber-400 text-slate-950':'border border-white/10 bg-white/[0.04] text-slate-400'}`}",
    "className={`min-h-11 rounded-xl px-3 py-2 text-[11px] font-bold ${stage===s?'bg-amber-400 text-slate-950':'border border-white/10 bg-white/[0.04] text-slate-400'}`}",
  ],
  "className={`min-h-11 rounded-xl px-3 py-2 text-[11px] font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 ${stage===s?'bg-amber-400 text-slate-950':'border border-white/10 bg-white/[0.04] text-slate-400'}`}",
  1,
  'evidence stage targets',
);
replaceCompatible(
  [
    'className="mt-3 w-full rounded-xl bg-amber-400 py-3 text-xs font-bold text-slate-950 disabled:opacity-40"',
    'className="mt-3 min-h-11 w-full rounded-xl bg-amber-400 py-3 text-xs font-bold text-slate-950 disabled:opacity-40"',
  ],
  'className="mt-3 min-h-11 w-full rounded-xl bg-amber-400 py-3 text-xs font-bold text-slate-950 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"',
  1,
  'upload target',
);

src += `\n/* ${MARK} */\n`;
writeFileSync(file,src,'utf8');
console.log('Applied mobile homologation wave 3 work-order memory fixes');
