import fs from 'node:fs';

const file='src/legacy/ZiisTecApp.jsx';
let s=fs.readFileSync(file,'utf8');
const once=(oldText,newText,label)=>{
  const i=s.indexOf(oldText); if(i<0) throw new Error(`phase10: não encontrei ${label}`);
  if(s.indexOf(oldText,i+1)>=0) throw new Error(`phase10: ${label} apareceu mais de uma vez`);
  s=s.slice(0,i)+newText+s.slice(i+oldText.length);
};

once(
  'import { baixarOrcamentoPDF, compartilharOrcamentoPDF, suportaCompartilharArquivo } from "../lib/quotePdf";\n',
  'import { baixarOrcamentoPDF, compartilharOrcamentoPDF, suportaCompartilharArquivo } from "../lib/quotePdf";\nimport { carregarRevisoesDB, atualizarRevisaoDB } from "../lib/followupApi";\n',
  'import pós-venda'
);

once(
  '    usuarioAtual, papel, permitido, empresaId, assinatura, equipe, usuarios,\n',
  '    usuarioAtual, papel, permitido, empresaId, assinatura, equipe, usuarios, real,\n',
  'contexto real nos props'
);

once(
  'function Clientes(p) {\n  const { clientes, orcamentos, ordens, lancamentos, garantias, salvarCliente, clienteAberto, setClienteAberto, abrirOrc, abrirOS, abrirGarantia, setTela, setOrcamentoAberto } = p;\n',
  `function Clientes(p) {
  const { clientes, orcamentos, ordens, lancamentos, garantias, salvarCliente, clienteAberto, setClienteAberto, abrirOrc, abrirOS, abrirGarantia, setTela, setOrcamentoAberto, empresaId, real, aviso } = p;
  const [revisoesCliente, setRevisoesCliente] = useState([]);
  useEffect(() => {
    if (!real || !empresaId) return;
    let ativo=true;
    carregarRevisoesDB(empresaId).then((r)=>{ if(ativo) setRevisoesCliente(r); }).catch((e)=>aviso?.(e?.message || "Não foi possível carregar os retornos."));
    return ()=>{ ativo=false; };
  }, [real, empresaId]);
`,
  'pós-venda na ficha do cliente'
);

once(
  '    const retornos = oss.filter((o) => o.retorno).map((o) => o.retorno);',
  '    const retornos = real ? revisoesCliente.filter((r)=>r.clienteId===c.id && r.status==="pending").map((r)=>({ data:r.data, servico:r.descricao })) : oss.filter((o) => o.retorno).map((o) => o.retorno);',
  'retornos persistentes do cliente'
);

once(
  'function Garantias({ garantias, ordens, clientes, nomeCliente, garantiaAberta, setGarantiaAberta, abrirOS, abrirCliente, abrirAtendimentoGarantia, produtos }) {',
  'function Garantias({ garantias, ordens, clientes, nomeCliente, garantiaAberta, setGarantiaAberta, abrirOS, abrirCliente, abrirAtendimentoGarantia, produtos, empresaId, real, aviso }) {',
  'assinatura Garantias'
);

once(
  '  const [relatoProblema, setRelatoProblema] = useState("");\n',
  `  const [relatoProblema, setRelatoProblema] = useState("");
  const [revisoes, setRevisoes] = useState([]);
  const carregarRevisoes = async () => {
    if (!real || !empresaId) return;
    try { setRevisoes(await carregarRevisoesDB(empresaId)); }
    catch (e) { aviso?.(e?.message || "Não foi possível carregar o pós-venda."); }
  };
  useEffect(() => { carregarRevisoes(); }, [real, empresaId]);
  const mudarRevisao = async (r, status) => {
    try {
      const salva = await atualizarRevisaoDB(r.id,status);
      setRevisoes((ls)=>ls.map((x)=>x.id===salva.id?salva:x));
      aviso?.(status === "done" ? "Revisão marcada como concluída." : "Revisão dispensada.");
    } catch (e) { aviso?.(e?.message || "Não foi possível atualizar o pós-venda."); }
  };
`,
  'estado pós-venda'
);

const marker='      <PageHead title="Garantias" sub={`${ativas} ativa${ativas === 1 ? "" : "s"} agora. Cada uma nasceu de uma ordem de serviço concluída.`} />\n';
const block=`      {revisoes.filter((r)=>r.status === "pending").length > 0 && (
        <section className="mb-7">
          <Rotulo>Pós-venda programado · {revisoes.filter((r)=>r.status === "pending").length}</Rotulo>
          <Panel className="divide-y divide-slate-100 overflow-hidden">
            {revisoes.filter((r)=>r.status === "pending").sort((a,b)=>a.data.localeCompare(b.data)).map((r)=>(
              <Linha key={r.id}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <button onClick={()=>abrirOS(r.osId)} className={cx("min-w-0 text-left",ring)}>
                    <p className="font-medium text-slate-900 truncate">{r.descricao}</p>
                    <p className="text-[13px] text-slate-500 truncate">{nomeCliente(r.clienteId)} · retorno em {dataBR(r.data)}</p>
                  </button>
                  <div className="flex items-center gap-2 shrink-0">
                    <Pill tone={r.data < HOJE ? "erro" : r.data === HOJE ? "atencao" : "neutro"}>{r.data < HOJE ? "Atrasado" : r.data === HOJE ? "Hoje" : dataBR(r.data)}</Pill>
                    <Btn size="sm" variant="soft" icon={Check} onClick={()=>mudarRevisao(r,"done")}>Concluir</Btn>
                    <Btn size="sm" variant="ghost" onClick={()=>mudarRevisao(r,"dismissed")}>Dispensar</Btn>
                  </div>
                </div>
              </Linha>
            ))}
          </Panel>
        </section>
      )}
`;
once(marker,marker+block,'bloco pós-venda na tela Garantias');

fs.writeFileSync(file,s);
console.log('Applied ZiisTec phase 10 post-sale followup patch (7 changes)');
