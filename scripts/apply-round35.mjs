import { readFileSync, writeFileSync } from 'node:fs';

const file = 'src/legacy/ZiisTecApp.jsx';
let src = readFileSync(file, 'utf8');

if (src.includes('CALCULADORA RAPIDA DE MARGEM')) {
  console.log('Round 3.5 product margin calculator already applied');
  process.exit(0);
}

const requireOnce = (needle, replacement, label) => {
  const count = src.split(needle).length - 1;
  if (count !== 1) throw new Error(`Round 3.5 ${label}: expected 1 marker, got ${count}`);
  src = src.replace(needle, replacement);
};

requireOnce(
`const num = (v) => { const n = parseFloat(String(v).replace(",", ".")); return Number.isFinite(n) ? n : 0; };`,
`const num = (v) => { const n = parseFloat(String(v).replace(",", ".")); return Number.isFinite(n) ? n : 0; };
const precoComAcrescimo = (custo, percentual) => Number((Math.max(0, num(custo)) * (1 + Math.max(0, num(percentual)) / 100)).toFixed(2));
const acrescimoSobreCusto = (custo, preco) => {
  const c = Math.max(0, num(custo));
  return c > 0 ? Number((((Math.max(0, num(preco)) / c) - 1) * 100).toFixed(2)) : 0;
};`,
'pricing helpers',
);

requireOnce(
`          : <Btn icon={Plus} onClick={() => setFormP({ unidade: "unidade", ativo: true, preco: 0, custo: 0, garantiaMeses: 0 })}>Novo produto</Btn>} />`,
`          : <Btn icon={Plus} onClick={() => setFormP({ unidade: "unidade", ativo: true, preco: 0, custo: 0, margemPct: "", garantiaMeses: 0 })}>Novo produto</Btn>} />`,
'new product defaults',
);

requireOnce(
`    <Linha onClick={() => setFormP(p)} className={apagado ? "opacity-55" : ""}>`,
`    <Linha onClick={() => setFormP({ ...p, margemPct: p.custo > 0 ? acrescimoSobreCusto(p.custo, p.preco) : "" })} className={apagado ? "opacity-55" : ""}>`,
'edit product margin hydration',
);

requireOnce(
`          <div className="grid sm:grid-cols-2 gap-5">
            <Field label="Custo de compra"><Input type="number" min="0" value={formP.custo} onChange={(e) => setFormP({ ...formP, custo: Number(e.target.value) })} /></Field>
            <Field label="Preço de venda"><Input type="number" min="0" value={formP.preco} onChange={(e) => setFormP({ ...formP, preco: Number(e.target.value) })} /></Field>
          </div>`,
`          {/* CALCULADORA DE MARGEM SOBRE CUSTO — ferramenta local; só custo e preço são persistidos. */}
          <div className="grid sm:grid-cols-3 gap-5">
            <Field label="Custo de compra">
              <Input type="number" min="0" step="0.01" value={formP.custo} onChange={(e) => {
                const custo = Number(e.target.value);
                const pct = formP.margemPct;
                setFormP({ ...formP, custo, ...(pct !== "" && Number.isFinite(Number(pct)) ? { preco: precoComAcrescimo(custo, pct) } : {}) });
              }} />
            </Field>
            <Field label="Acréscimo sobre custo (%)" hint="Ex.: R$ 80 + 45% = R$ 116">
              <Input type="number" min="0" step="0.01" value={formP.margemPct ?? ""} placeholder="45" onChange={(e) => {
                const raw = e.target.value;
                const margemPct = raw === "" ? "" : Number(raw);
                setFormP({ ...formP, margemPct, ...(raw !== "" ? { preco: precoComAcrescimo(formP.custo, margemPct) } : {}) });
              }} />
            </Field>
            <Field label="Preço de venda">
              <Input type="number" min="0" step="0.01" value={formP.preco} onChange={(e) => {
                const preco = Number(e.target.value);
                setFormP({ ...formP, preco, margemPct: formP.custo > 0 ? acrescimoSobreCusto(formP.custo, preco) : formP.margemPct });
              }} />
            </Field>
          </div>
          <div className="rounded-2xl bg-emerald-50 ring-1 ring-emerald-200 px-4 py-3 grid sm:grid-cols-3 gap-3 text-[13px]">
            <div><span className="text-emerald-700">Custo</span><p className="font-semibold text-slate-900 tabular-nums">{brl(formP.custo)}</p></div>
            <div><span className="text-emerald-700">Lucro bruto por unidade</span><p className="font-semibold text-slate-900 tabular-nums">{brl(Math.max(0, num(formP.preco) - num(formP.custo)))}</p></div>
            <div><span className="text-emerald-700">Preço calculado</span><p className="font-semibold text-emerald-800 tabular-nums">{brl(formP.preco)}</p></div>
          </div>`,
'full product margin calculator',
);

requireOnce(
`  const vazio = { nome: "", categoria: "", marca: "", modelo: "", unidade: "unidade", preco: 0, custo: 0, descricao: "", temGarantia: false, prazo: 0 };`,
`  const vazio = { nome: "", categoria: "", marca: "", modelo: "", unidade: "unidade", preco: 0, custo: 0, margemPct: "", descricao: "", temGarantia: false, prazo: 0 };`,
'quick catalog defaults',
);

// No cadastro rápido preservamos os campos atuais de custo/preço e adicionamos
// um card independente. Digitar o percentual já atualiza f.preco automaticamente.
requireOnce(
`      {/* garantia definida já no cadastro rápido: é o prazo padrão do catálogo,`,
`      {/* CALCULADORA RAPIDA DE MARGEM */}
      {!serv && verCusto && (
        <div className="rounded-2xl bg-emerald-50 ring-1 ring-emerald-200 p-4 space-y-3">
          <div className="grid sm:grid-cols-2 gap-4 items-end">
            <Field label="Acréscimo sobre custo (%)" hint="Ex.: R$ 80 + 45% = R$ 116">
              <Input type="number" min="0" step="0.01" value={f.margemPct ?? ""} placeholder="45" onChange={(e) => {
                const raw = e.target.value;
                const margemPct = raw === "" ? "" : num(raw);
                setF((s) => ({ ...s, margemPct, ...(raw !== "" ? { preco: precoComAcrescimo(s.custo, margemPct) } : {}) }));
              }} />
            </Field>
            <div className="pb-1">
              <p className="text-[12px] text-emerald-700">Preço calculado</p>
              <p className="text-[20px] font-semibold text-emerald-900 tabular-nums">{brl(f.preco)}</p>
              <p className="text-[12px] text-emerald-700">Lucro bruto/un.: {brl(Math.max(0, num(f.preco) - num(f.custo)))}</p>
            </div>
          </div>
        </div>
      )}

      {/* garantia definida já no cadastro rápido: é o prazo padrão do catálogo,`,
'quick calculator card',
);

writeFileSync(file, src, 'utf8');
console.log('Applied Round 3.5 product margin calculator');
