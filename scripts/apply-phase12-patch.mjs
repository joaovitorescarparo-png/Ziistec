import fs from 'node:fs';

const file='src/legacy/ZiisTecApp.jsx';
let s=fs.readFileSync(file,'utf8');
const once=(oldText,newText,label)=>{
  const i=s.indexOf(oldText); if(i<0) throw new Error(`phase12: não encontrei ${label}`);
  if(s.indexOf(oldText,i+1)>=0) throw new Error(`phase12: ${label} apareceu mais de uma vez`);
  s=s.slice(0,i)+newText+s.slice(i+oldText.length);
};

once(
  '  salvarOSDB, atualizarOSDB, finalizarOSDB, baixarLancamentoDB, salvarLancamentoDB, atualizarStatusOrcamentoDB,',
  '  salvarOSDB, atualizarOSDB, finalizarOSDB, resolverPrecificacaoOSDB, baixarLancamentoDB, salvarLancamentoDB, atualizarStatusOrcamentoDB,',
  'import resolver precificação'
);

once(
  '  /* acionamento de garantia: nova OS ligada à garantia e à OS de origem */',
  `  const resolverPrecificacao = async (osId, itens) => {
    if (!real) return;
    try {
      await resolverPrecificacaoOSDB(osId, itens, 7);
      await recarregarDados();
      aviso("Valores definidos e cobrança liberada no financeiro.");
      return true;
    } catch (e) {
      aviso(mensagemErro(e));
      return false;
    }
  };

  /* acionamento de garantia: nova OS ligada à garantia e à OS de origem */`,
  'ação resolver precificação'
);

once(
  '    mudarStatusOrc, duplicarOrcamento, gerarOS, salvarOS, mudarStatusOS, agendarOS, desagendarOS, finalizarOS, baixar,',
  '    mudarStatusOrc, duplicarOrcamento, gerarOS, salvarOS, mudarStatusOS, agendarOS, desagendarOS, finalizarOS, resolverPrecificacao, baixar,',
  'prop resolver precificação'
);

once(
  '    permitido, equipe, usuarioAtual, real, empresaId, aviso, papel } = p;\n  const verValores = permitido("verValores");',
  `    permitido, equipe, usuarioAtual, real, empresaId, aviso, papel, resolverPrecificacao } = p;
  const verValores = permitido("verValores");
  const [precosPendentes, setPrecosPendentes] = useState({});
  const [liberandoCobranca, setLiberandoCobranca] = useState(false);
  useEffect(() => {
    const prox = {};
    (os.itens || []).filter((i) => i.aguardandoValor).forEach((i) => { prox[i.id] = Number(i.preco || 0); });
    setPrecosPendentes(prox);
  }, [os.id, os.pendentePrecificacao, os.itens]);`,
  'estado de precificação na OS'
);

const anchor=`            </Panel>
          </section>

          <section>
            <Rotulo>O que precisa ser feito</Rotulo>`;
const block=`            </Panel>
            {verValores && os.pendentePrecificacao && (
              <div className="mt-4 rounded-2xl bg-amber-50 ring-1 ring-amber-200/70 p-4 sm:p-5">
                <div className="flex items-start gap-3 mb-4">
                  <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[14px] font-semibold text-amber-950">Há adicionais aguardando valor</p>
                    <p className="text-[12.5px] text-amber-900/80 mt-1">O técnico concluiu o atendimento sem definir preço. Informe os valores abaixo para liberar a cobrança.</p>
                  </div>
                </div>
                <div className="space-y-3">
                  {(os.itens || []).filter((i) => i.aguardandoValor).map((i) => (
                    <div key={i.id} className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 rounded-xl bg-white/80 px-3.5 py-3 ring-1 ring-amber-200/70">
                      <div className="min-w-0 flex-1">
                        <p className="text-[14px] font-medium text-slate-800 truncate">{i.nome}</p>
                        <p className="text-[12px] text-slate-500">{i.qtd} {unidadeLabel(i.unidade)} · informado pelo técnico</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[12px] text-slate-500">R$</span>
                        <input type="number" min="0" step="0.01" value={precosPendentes[i.id] ?? 0}
                          onChange={(e) => setPrecosPendentes((v) => ({ ...v, [i.id]: Number(e.target.value) }))}
                          aria-label={\`Valor de \${i.nome}\`}
                          className="w-28 rounded-lg bg-white ring-1 ring-slate-200 px-3 py-2 text-right text-[14px] tabular-nums focus:outline-none focus:ring-2 focus:ring-teal-500" />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex justify-end mt-4">
                  <Btn disabled={liberandoCobranca || (os.itens || []).filter((i)=>i.aguardandoValor).some((i)=>Number(precosPendentes[i.id]) < 0)}
                    icon={liberandoCobranca ? Loader2 : Receipt}
                    onClick={async () => {
                      setLiberandoCobranca(true);
                      const itens = (os.itens || []).map((i) => i.aguardandoValor ? { ...i, preco: Number(precosPendentes[i.id] || 0) } : i);
                      await resolverPrecificacao?.(os.id, itens);
                      setLiberandoCobranca(false);
                    }}>
                    {liberandoCobranca ? "Liberando…" : "Definir valores e gerar cobrança"}
                  </Btn>
                </div>
              </div>
            )}
          </section>

          <section>
            <Rotulo>O que precisa ser feito</Rotulo>`;
once(anchor,block,'bloco de precificação pendente');

fs.writeFileSync(file,s);
console.log('Applied ZiisTec phase 12 pending pricing UI patch (5 changes)');
