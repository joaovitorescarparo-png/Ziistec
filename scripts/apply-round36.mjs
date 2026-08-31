import { readFileSync, writeFileSync } from 'node:fs';

const file = 'src/legacy/ZiisTecApp.jsx';
let src = readFileSync(file, 'utf8');

if (src.includes('APROVACAO RAPIDA ORCAMENTO')) {
  console.log('Round 3.6 quick quote approval already applied');
  process.exit(0);
}

const requireOnce = (needle, replacement, label) => {
  const count = src.split(needle).length - 1;
  if (count !== 1) throw new Error(`Round 3.6 ${label}: expected 1 marker, got ${count}`);
  src = src.replace(needle, replacement);
};

requireOnce(
`            <Linha key={o.id} onClick={() => setOrcamentoAberto(o.id)}>
              <div className="flex items-start justify-between gap-4">`,
`            <div key={o.id} className="px-4 sm:px-5 py-4 transition-colors hover:bg-slate-50/80">
              <div className="flex items-stretch gap-2 sm:gap-3">
                <button type="button" onClick={() => setOrcamentoAberto(o.id)} className="min-w-0 flex-1 text-left">
                  <div className="flex items-start justify-between gap-4">`,
'quote list row opening',
);

requireOnce(
`                <div className="text-right shrink-0">
                  <p className="text-[17px] font-semibold text-slate-900 tabular-nums">{brl(totalDoc(o))}</p>
                  <Pill tone={ST_ORC[o.status].tone} className="mt-1.5">{ST_ORC[o.status].label}</Pill>
                </div>
              </div>
            </Linha>`,
`                    <div className="text-right shrink-0">
                      <p className="text-[17px] font-semibold text-slate-900 tabular-nums">{brl(totalDoc(o))}</p>
                      <Pill tone={ST_ORC[o.status].tone} className="mt-1.5">{ST_ORC[o.status].label}</Pill>
                    </div>
                  </div>
                </button>
                {/* APROVACAO RAPIDA ORCAMENTO — pode aprovar rascunho ou enviado sem obrigar envio pelo app. */}
                {["rascunho", "enviado"].includes(o.status) && (
                  <button
                    type="button"
                    aria-label={\`Aprovar ${o.numero}\`}
                    title="Aprovar orçamento"
                    onClick={() => mudarStatusOrc(o.id, "aprovado")}
                    className="self-center shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-emerald-50 px-3 py-2 text-[12px] font-semibold text-emerald-800 ring-1 ring-emerald-200 transition hover:bg-emerald-100 active:scale-[0.98]"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Aprovar</span>
                  </button>
                )}
              </div>
            </div>`,
'quote list quick approval action',
);

writeFileSync(file, src, 'utf8');
console.log('Applied Round 3.6 quick quote approval from list');
