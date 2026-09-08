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
  'MOBILE HOMOLOGATION · team/finance · wave 5',
  [
    [
      '<div className="flex items-start justify-between gap-4 mb-7">',
      '<div className="flex flex-col gap-4 mb-7 min-[390px]:flex-row min-[390px]:items-start min-[390px]:justify-between">',
      1,
      'page header stacking',
    ],
  ],
  'Mobile homologation wave 5 team header fix',
);

patch(
  'src/screens/v2/FinanceV2.jsx',
  'MOBILE HOMOLOGATION · finance · wave 5',
  [
    [
      'mt-1 truncate text-xl font-bold',
      'mt-1 break-words text-lg font-bold min-[390px]:text-xl',
      1,
      'KPI amount visibility',
    ],
    [
      'grid grid-cols-2 gap-3 lg:grid-cols-4',
      'grid grid-cols-1 gap-3 min-[390px]:grid-cols-2 lg:grid-cols-4',
      2,
      'KPI narrow-screen stacking',
    ],
    [
      'mt-3 grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-3 text-xs',
      'mt-3 grid grid-cols-1 gap-2 rounded-xl bg-slate-50 p-3 text-xs sm:grid-cols-3',
      1,
      'OS profitability stacking',
    ],
    [
      'flex items-center justify-between border-b border-slate-100 p-5',
      'flex flex-col items-start gap-3 border-b border-slate-100 p-5 min-[390px]:flex-row min-[390px]:items-center min-[390px]:justify-between',
      1,
      'profitability header stacking',
    ],
    [
      'flex items-center gap-3 p-4 sm:px-5',
      'grid grid-cols-[auto_minmax(0,1fr)] gap-3 p-4 min-[390px]:grid-cols-[auto_minmax(0,1fr)_auto] min-[390px]:items-center sm:px-5',
      1,
      'movement row layout',
    ],
    [
      '<p className="truncate text-sm font-semibold">{x.descricao}</p>',
      '<p className="break-words text-sm font-semibold">{x.descricao}</p>',
      1,
      'movement description visibility',
    ],
    [
      '<p className="mt-0.5 truncate text-[11px] text-slate-500">',
      '<p className="mt-0.5 break-words text-[11px] text-slate-500">',
      1,
      'movement metadata visibility',
    ],
    [
      '<strong className={`shrink-0 text-sm ${x.tipo===\'receita\'?\'text-emerald-700\':\'text-rose-700\'}`}>',
      '<strong className={`col-span-2 justify-self-end text-sm min-[390px]:col-span-1 min-[390px]:justify-self-auto ${x.tipo===\'receita\'?\'text-emerald-700\':\'text-rose-700\'}`}>',
      1,
      'movement amount placement',
    ],
  ],
  'Mobile homologation wave 5 finance fixes',
);
