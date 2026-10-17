import { readFileSync, writeFileSync } from 'node:fs';

const file='src/legacy/ZiisTecApp.jsx';
let src=readFileSync(file,'utf8');
const MARK='ROUND 3.9 · vendas, recebimentos e histórico';
if(src.includes(MARK)){console.log('Round 3.9 already applied');process.exit(0);}

const once=(needle,replacement,label)=>{
  const count=src.split(needle).length-1;
  if(count!==1)throw new Error(`Round 3.9 ${label}: expected 1 marker, got ${count}`);
  src=src.replace(needle,replacement);
};

once(
  '{aba === "produtos" && (\n        <Panel className="divide-y divide-slate-100 overflow-hidden">',
  '{aba === "produtos" && (\n        <Panel className="divide-y divide-slate-100 overflow-hidden">\n          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-5">\n            <div><p className="font-medium text-slate-900">Vendas, recebimentos e histórico</p><p className="text-[13px] text-slate-500 mt-1">Veja o que cada técnico vendeu, configure Pix/dinheiro/cartão e consulte o histórico por cliente ou condomínio.</p></div>\n            <Btn icon={ShoppingCart} onClick={() => { const url = new URL(window.location.href); url.searchParams.set("v2", "venda-os"); window.location.assign(`${url.pathname}${url.search}${url.hash}`); }}>Abrir gestão</Btn>\n          </div>',
  'owner field sales admin entry',
);

src += `\n/* ${MARK} */\n`;
writeFileSync(file,src,'utf8');
console.log('Applied Round 3.9 sales administration entry');
