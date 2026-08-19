import fs from 'node:fs';

const file='src/legacy/ZiisTecApp.jsx';
let s=fs.readFileSync(file,'utf8');
const once=(oldText,newText,label)=>{
  const i=s.indexOf(oldText);
  if(i<0) throw new Error(`phase13: não encontrei ${label}`);
  if(s.indexOf(oldText,i+1)>=0) throw new Error(`phase13: ${label} apareceu mais de uma vez`);
  s=s.slice(0,i)+newText+s.slice(i+oldText.length);
};

once(
`  const recebidoMes = lancamentos.filter((l) => l.tipo === "receita" && l.pago && noMes(l));
  const aReceberMes = lancamentos.filter((l) => l.tipo === "receita" && !l.pago && noMes(l));
  const pagoMes = lancamentos.filter((l) => l.tipo === "despesa" && l.pago && noMes(l));
  const aPagarMes = lancamentos.filter((l) => l.tipo === "despesa" && !l.pago && noMes(l));
  const vencidos = lancamentos.filter((l) => !l.pago && l.vencimento < HOJE);
  const resultado = soma(recebidoMes) - soma(pagoMes);

  const futuroReceber = soma(lancamentos.filter((l) => l.tipo === "receita" && !l.pago)) - soma(aReceberMes);
  const futuroPagar = soma(lancamentos.filter((l) => l.tipo === "despesa" && !l.pago)) - soma(aPagarMes);

  /* fluxo de caixa 30 dias */
  const saldoAtual = soma(lancamentos.filter((l) => l.tipo === "receita" && l.pago)) - soma(lancamentos.filter((l) => l.tipo === "despesa" && l.pago));
  const limite = addDays(HOJE, 30);
  const entradas30 = lancamentos.filter((l) => l.tipo === "receita" && !l.pago && l.vencimento <= limite);
  const saidas30 = lancamentos.filter((l) => l.tipo === "despesa" && !l.pago && l.vencimento <= limite);
  const projetado = saldoAtual + soma(entradas30) - soma(saidas30);

  /* resultado do mês com custo dos serviços */
  const osConcluidasMes = ordens.filter((o) => o.status === "concluida" && mesRef(o.data || HOJE) === mes);
  const custoServicos = osConcluidasMes.reduce((t, o) => t + somaCustos(o.itens) + (o.custosExtras || 0), 0);
  const despesasNaoMateriais = soma(pagoMes);`,
`  const recebidoMes = lancamentos.filter((l) => l.tipo === "receita" && l.pago && noMes(l));
  const aReceberMes = lancamentos.filter((l) => l.tipo === "receita" && !l.pago && noMes(l));
  const pagoMes = lancamentos.filter((l) => l.tipo === "despesa" && l.pago && noMes(l));
  const aPagarMes = lancamentos.filter((l) => l.tipo === "despesa" && !l.pago && noMes(l));
  const vencidosReceber = lancamentos.filter((l) => l.tipo === "receita" && !l.pago && l.vencimento < HOJE);
  const vencidosPagar = lancamentos.filter((l) => l.tipo === "despesa" && !l.pago && l.vencimento < HOJE);
  const resultado = soma(recebidoMes) - soma(pagoMes);

  const futuroReceber = soma(lancamentos.filter((l) => l.tipo === "receita" && !l.pago)) - soma(aReceberMes);
  const futuroPagar = soma(lancamentos.filter((l) => l.tipo === "despesa" && !l.pago)) - soma(aPagarMes);

  /* fluxo de caixa 30 dias: atraso fica separado, previsão olha somente para frente */
  const saldoAtual = soma(lancamentos.filter((l) => l.tipo === "receita" && l.pago)) - soma(lancamentos.filter((l) => l.tipo === "despesa" && l.pago));
  const limite = addDays(HOJE, 30);
  const entradas30 = lancamentos.filter((l) => l.tipo === "receita" && !l.pago && l.vencimento >= HOJE && l.vencimento <= limite);
  const saidas30 = lancamentos.filter((l) => l.tipo === "despesa" && !l.pago && l.vencimento >= HOJE && l.vencimento <= limite);
  const projetado = saldoAtual + soma(entradas30) - soma(saidas30);

  /* margem dos serviços: usa conclusão real e cobrança efetivamente gerada para a OS */
  const osConcluidasMes = ordens.filter((o) => o.status === "concluida" && mesRef(o.concluidaEm || o.data || HOJE) === mes);
  const cobrancaDaOS = (o) => lancamentos.find((l) => l.tipo === "receita" && l.origemTipo === "os" && l.origemId === o.id);
  const custoDiretoOS = (o) => somaCustos(o.itens)
    + (o.materiais || []).reduce((t, m) => t + (Number(m.qtd) || 0) * (Number(m.custo) || 0), 0)
    + (Number(o.custosExtras) || 0);
  const osFaturadasMes = osConcluidasMes.filter((o) => !!cobrancaDaOS(o));
  const faturadoServicos = osFaturadasMes.reduce((t, o) => t + (Number(cobrancaDaOS(o)?.valor) || 0), 0);
  const custoServicos = osFaturadasMes.reduce((t, o) => t + custoDiretoOS(o), 0);
  const margemServicos = faturadoServicos - custoServicos;
  const outrasDespesas = soma(pagoMes.filter((l) => l.origemTipo !== "compra"));
  const resultadoOperacional = margemServicos - outrasDespesas;
  const pendentesPrecoMes = osConcluidasMes.filter((o) => o.pendentePrecificacao);`,
  'cálculos financeiros coerentes'
);

once(
`        <Panel className="p-4 sm:p-5"><p className="text-[12.5px] text-slate-500">Vencidos</p>
          <p className={cx("text-[20px] font-semibold mt-1 tabular-nums", soma(vencidos) > 0 ? "text-rose-700" : "text-slate-900")}>{brl(soma(vencidos))}</p></Panel>`,
`        <Panel className="p-4 sm:p-5"><p className="text-[12.5px] text-slate-500">Em atraso</p>
          <p className={cx("text-[17px] font-semibold mt-1 tabular-nums", soma(vencidosReceber) > 0 ? "text-rose-700" : "text-slate-900")}>{brl(soma(vencidosReceber))} <span className="text-[11px] font-normal text-slate-400">a receber</span></p>
          <p className="text-[12px] text-slate-500 mt-1 tabular-nums">{brl(soma(vencidosPagar))} a pagar</p></Panel>`,
  'card de atrasos separado'
);

once(
`              <div className="flex justify-between"><span className="text-slate-500">Saldo atual</span><span className="font-medium tabular-nums">{brl(saldoAtual)}</span></div>`,
`              <div className="flex justify-between"><span className="text-slate-500">Saldo registrado</span><span className="font-medium tabular-nums">{brl(saldoAtual)}</span></div>`,
  'rótulo saldo registrado'
);

once(
`              {" "}Saldo atual considera tudo que já foi efetivamente recebido e pago.`,
`              {" "}Saldo registrado considera apenas movimentações que passaram pelo ZiisTec; contas vencidas ficam fora da previsão dos próximos 30 dias.`,
  'explicação fluxo de caixa'
);

once(
`              <div className="flex justify-between"><span className="text-slate-500">Receita recebida</span><span className="font-medium tabular-nums">{brl(soma(recebidoMes))}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Custo dos serviços executados</span><span className="tabular-nums">− {brl(custoServicos)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Despesas pagas</span><span className="tabular-nums">− {brl(despesasNaoMateriais)}</span></div>
              <div className="flex justify-between items-baseline pt-4 border-t border-slate-200">
                <span className="font-medium text-slate-700">Resultado</span>
                <span className={cx("text-2xl font-semibold tabular-nums", soma(recebidoMes) - custoServicos - despesasNaoMateriais >= 0 ? "text-emerald-700" : "text-rose-700")}>
                  {brl(soma(recebidoMes) - custoServicos - despesasNaoMateriais)}
                </span>
              </div>`,
`              <div className="flex justify-between"><span className="text-slate-500">Serviços faturados no mês</span><span className="font-medium tabular-nums">{brl(faturadoServicos)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Custos diretos dessas OS</span><span className="tabular-nums">− {brl(custoServicos)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Margem bruta dos serviços</span><span className="font-medium tabular-nums">{brl(margemServicos)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Outras despesas pagas</span><span className="tabular-nums">− {brl(outrasDespesas)}</span></div>
              <div className="flex justify-between items-baseline pt-4 border-t border-slate-200">
                <span className="font-medium text-slate-700">Resultado operacional estimado</span>
                <span className={cx("text-2xl font-semibold tabular-nums", resultadoOperacional >= 0 ? "text-emerald-700" : "text-rose-700")}>
                  {brl(resultadoOperacional)}
                </span>
              </div>`,
  'resumo de margem operacional'
);

once(
`              O custo dos serviços vem dos custos cadastrados em cada item das ordens concluídas no mês, mais os custos extras informados na finalização.
              Materiais comprados aparecem também em despesas pagas quando você dá baixa na conta.`,
`              A margem usa a data real de conclusão da OS e o valor da cobrança gerada no Financeiro. Custos diretos incluem itens, materiais utilizados e custos extras registrados.
              Compras automáticas de materiais não são subtraídas novamente aqui, evitando contar o mesmo material duas vezes.${'${pendentesPrecoMes.length ? ` Há ${pendentesPrecoMes.length} OS concluída${pendentesPrecoMes.length > 1 ? "s" : ""} aguardando preço e ainda fora da margem.` : ""}'} `,
  'explicação resultado operacional'
);

once(
`            {osConcluidasMes.length === 0 ? <Empty icon={TrendingUp} title="Nenhuma ordem concluída neste mês" /> : osConcluidasMes.map((o) => {
              const cobrado = totalOS(o), custo = somaCustos(o.itens) + (o.custosExtras || 0);`,
`            {osFaturadasMes.length === 0 ? <Empty icon={TrendingUp} title="Nenhuma ordem faturada neste mês" /> : osFaturadasMes.map((o) => {
              const cobrado = Number(cobrancaDaOS(o)?.valor) || 0, custo = custoDiretoOS(o);`,
  'resultado por OS faturada'
);

fs.writeFileSync(file,s);
console.log('Applied ZiisTec phase 13 financial reporting consistency patch (7 changes)');
