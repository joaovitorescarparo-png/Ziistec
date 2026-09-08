import { readFileSync, writeFileSync } from 'node:fs';

const file='src/legacy/ZiisTecApp.jsx';
let src=readFileSync(file,'utf8');
const MARK='ROUND 3.8 · modo técnico de campo';
if(src.includes(MARK)){
  console.log('Round 3.8 already applied');
  process.exit(0);
}

const replaceOnce=(needle,replacement,label)=>{
  const count=src.split(needle).length-1;
  if(count!==1) throw new Error(`Round 3.8 ${label}: expected 1 marker, got ${count}`);
  src=src.replace(needle,replacement);
};

replaceOnce(
  '  tecnico: ["inicio", "agenda", "ordens", "registrarMateriais"],',
  '  tecnico: ["inicio", "ordens", "registrarMateriais", "vendaCampo"],',
  'technician permissions',
);

replaceOnce(
  '    pedirConfirmacao: setConfirmar,\n  };',
  '    pedirConfirmacao: setConfirmar,\n    abrirRecursoV2: contexto?.abrirRecursoV2,\n  };',
  'expose V2 resource opener',
);

replaceOnce(
  '    { id: "ordens", label: "Ordens de serviço", icon: ClipboardList },\n    { id: "garantias", label: "Garantias", icon: ShieldCheck },',
  '    { id: "ordens", label: "Ordens de serviço", icon: ClipboardList },\n    { id: "vendaCampo", label: "Produtos", icon: ShoppingCart },\n    { id: "garantias", label: "Garantias", icon: ShieldCheck },',
  'field products nav item',
);

replaceOnce(
  '  const NAV_MOBILE = ["inicio", "agenda", "orcamentos", "ordens"];',
  '  const NAV_MOBILE = ["inicio", "agenda", "orcamentos", "ordens", "vendaCampo"];',
  'mobile nav products',
);

// Existem exatamente dois cliques de navegação por id: sidebar e barra móvel.
{
  const needle='onClick={() => irPara(n.id)}';
  const count=src.split(needle).length-1;
  if(count!==2) throw new Error(`Round 3.8 nav clicks: expected 2 markers, got ${count}`);
  src=src.split(needle).join('onClick={() => n.id === "vendaCampo" ? contexto?.abrirRecursoV2?.("venda-os") : irPara(n.id)}');
}

replaceOnce(
  'function Inicio({ ordens, orcamentos, lancamentos, nomeCliente, irPara, abrirOS, abrirOrc, setTela, setOrcamentoAberto, empresa, permitido, usuarioAtual, papel, empresaId, real, aviso }) {',
  'function Inicio({ ordens, orcamentos, lancamentos, nomeCliente, irPara, abrirOS, abrirOrc, setTela, setOrcamentoAberto, empresa, permitido, usuarioAtual, papel, empresaId, real, aviso, abrirRecursoV2 }) {',
  'Inicio signature',
);

replaceOnce(
  '  ] : [\n    { label: "Minhas ordens", icon: ClipboardList, ir: () => irPara("ordens") },\n    { label: "Agenda", icon: CalendarDays, ir: () => irPara("agenda") },\n  ];',
  '  ] : [\n    { label: "Meus serviços", icon: ClipboardList, ir: () => irPara("ordens") },\n    { label: "Produtos", icon: ShoppingCart, ir: () => abrirRecursoV2?.("venda-os") },\n  ];',
  'technician shortcuts',
);

replaceOnce(
  '<Rotulo acao={<button onClick={() => irPara("agenda")} className="text-[13px] font-medium text-teal-800 hover:underline">Ver agenda</button>}>\n              {verFinanceiro ? "O que tenho para hoje" : "Meus atendimentos de hoje"}',
  '<Rotulo acao={<button onClick={() => irPara(verFinanceiro ? "agenda" : "ordens")} className="text-[13px] font-medium text-teal-800 hover:underline">{verFinanceiro ? "Ver agenda" : "Ver serviços"}</button>}>\n              {verFinanceiro ? "O que tenho para hoje" : "Meus atendimentos de hoje"}',
  'technician day action',
);

replaceOnce(
  '  const acoes = [];\n  if (os.status === "aguardando") acoes.push({ label: "Agendar", icon: CalendarClock, fn: () => setAgendando(true), principal: true });\n  if (os.status === "agendada") {\n    acoes.push({ label: "Iniciar atendimento", fn: () => mudarStatusOS(os, "andamento"), principal: true });\n    acoes.push({ label: "Reagendar", icon: CalendarClock, fn: () => setAgendando(true) });\n  }\n  if (os.status === "andamento") acoes.push({ label: "Finalizar atendimento", icon: Check, fn: () => setFinalizando(true), principal: true });',
  '  const podeAdministrarOS = permitido("todasOS");\n  const acoes = [];\n  if (podeAdministrarOS && os.status === "aguardando") acoes.push({ label: "Agendar", icon: CalendarClock, fn: () => setAgendando(true), principal: true });\n  if (os.status === "agendada") {\n    acoes.push({ label: "Iniciar atendimento", fn: () => mudarStatusOS(os, "andamento"), principal: true });\n    if (podeAdministrarOS) acoes.push({ label: "Reagendar", icon: CalendarClock, fn: () => setAgendando(true) });\n  }\n  if (os.status === "andamento") acoes.push({ label: "Finalizar atendimento", icon: Check, fn: () => setFinalizando(true), principal: true });',
  'owner scheduling actions',
);

replaceOnce(
  '{os.status !== "concluida" && os.status !== "cancelada" && (\n            <Btn size="sm" variant="danger"',
  '{podeAdministrarOS && os.status !== "concluida" && os.status !== "cancelada" && (\n            <Btn size="sm" variant="danger"',
  'owner cancellation action',
);

replaceOnce(
  '<Rotulo acao={os.data ? (\n              <button onClick={() => pedirConfirmacao({ titulo: "Remover agendamento?"',
  '<Rotulo acao={podeAdministrarOS && os.data ? (\n              <button onClick={() => pedirConfirmacao({ titulo: "Remover agendamento?"',
  'owner remove schedule action',
);

replaceOnce(
  'function Equipe({ equipe, usuarioAtual, empresa, salvarColaborador, atualizarColaborador, reenviarAcesso, alternarColaborador, ordens, pedirConfirmacao, aviso }) {\n  const [form, setForm] = useState(null);',
  'function Equipe({ equipe, usuarioAtual, empresa, salvarColaborador, atualizarColaborador, reenviarAcesso, alternarColaborador, ordens, pedirConfirmacao, aviso, produtos, salvarProduto }) {\n  const [aba, setAba] = useState("tecnicos");\n  const [form, setForm] = useState(null);',
  'Equipe signature and tab state',
);

replaceOnce(
  '      <PageHead title="Equipe" sub="Quem tem acesso à sua empresa e o que cada um enxerga."\n        action={<Btn icon={Plus} onClick={() => setForm({ nome: "", email: "", telefone: "", funcao: "", papel: "tecnico" })}>Adicionar colaborador</Btn>} />\n\n      <Panel className="divide-y divide-slate-100 overflow-hidden">\n        {equipe.map((m) => {',
  '      <PageHead title="Equipe" sub="Acessos da equipe e produtos liberados para venda em campo."\n        action={aba === "tecnicos" ? <Btn icon={Plus} onClick={() => setForm({ nome: "", email: "", telefone: "", funcao: "", papel: "tecnico" })}>Adicionar colaborador</Btn> : null} />\n\n      <Tabs valor={aba} onChange={setAba} className="mb-5" opcoes={[\n        { id: "tecnicos", label: `Técnicos · ${equipe.filter((m) => m.papel !== "proprietario").length}` },\n        { id: "produtos", label: `Produtos para venda · ${(produtos || []).filter((p) => p.ativo && p.vendaHabilitada).length}` },\n      ]} />\n\n      {aba === "produtos" && (\n        <Panel className="divide-y divide-slate-100 overflow-hidden">\n          {(produtos || []).filter((p) => p.ativo).length === 0 ? <Empty icon={Package} title="Nenhum produto ativo" sub="Cadastre produtos no catálogo antes de liberá-los para a equipe." /> : (produtos || []).filter((p) => p.ativo).map((p) => (\n            <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-5">\n              <div className="min-w-0 flex-1">\n                <p className="font-medium text-slate-900 truncate">{p.nome}</p>\n                <p className="text-[13px] text-slate-500 truncate">{[p.marca, p.modelo].filter(Boolean).join(" · ") || "Produto"}</p>\n                <p className="text-[15px] font-semibold text-teal-800 mt-1 tabular-nums">{brl(p.preco)}</p>\n              </div>\n              <button type="button" onClick={async () => { await salvarProduto({ ...p, vendaHabilitada: !p.vendaHabilitada }); }} aria-pressed={!!p.vendaHabilitada}\n                className={cx("rounded-xl px-3.5 py-2.5 text-[13px] font-medium ring-1 transition-colors", ring, p.vendaHabilitada ? "bg-teal-50 text-teal-800 ring-teal-200" : "bg-white text-slate-500 ring-slate-200")}>\n                {p.vendaHabilitada ? "Liberado para técnico" : "Não liberado"}\n              </button>\n            </div>\n          ))}\n        </Panel>\n      )}\n\n      {aba === "tecnicos" && <Panel className="divide-y divide-slate-100 overflow-hidden">\n        {equipe.map((m) => {',
  'Equipe tabs and product selector',
);

// Fecha a condicional da lista de técnicos no primeiro Panel posterior ao map da equipe.
{
  const start=src.indexOf('{aba === "tecnicos" && <Panel className="divide-y divide-slate-100 overflow-hidden">');
  if(start<0) throw new Error('Round 3.8 Equipe technician panel start not found');
  const marker='\n      </Panel>\n\n      <Panel className="p-5 mt-6">';
  const end=src.indexOf(marker,start);
  if(end<0) throw new Error('Round 3.8 Equipe technician panel end not found');
  src=src.slice(0,end)+'\n      </Panel>}\n\n      <Panel className="p-5 mt-6">'+src.slice(end+marker.length);
}

replaceOnce(
  '<span className="font-medium text-slate-800">O que o técnico enxerga:</span> início, agenda e as ordens atribuídas a ele —\n          com cliente, endereço, rota, o que precisa ser feito, relato por voz, fotos, materiais e pendências.\n          A carteira de clientes, orçamentos, garantias, financeiro, compras, equipe e configurações ficam fora do acesso dele.',
  '<span className="font-medium text-slate-800">O que o técnico enxerga:</span> início com a lista dos serviços do dia, suas ordens atribuídas e os produtos que você liberou para venda.\n          Ele não cria agendamento nem OS. Dentro do atendimento continua com rota, relato por voz, fotos, materiais e pendências.\n          Custos, margem, carteira de clientes, orçamentos, garantias administrativas, financeiro, compras, equipe e configurações ficam fora do acesso dele.',
  'Equipe technician visibility copy',
);

src += `\n/* ${MARK} */\n`;
writeFileSync(file,src,'utf8');
console.log('Applied Round 3.8 technician field mode');
