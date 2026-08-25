import { readFileSync, writeFileSync } from 'node:fs';

const path='src/legacy/ZiisTecApp.jsx';
let src=readFileSync(path,'utf8');
const start='/* =================================================================== Agenda */';
const end='function AgendarModal';
const a=src.indexOf(start);
const b=src.indexOf(end,a);
if(a<0||b<0) throw new Error('Agenda markers not found');

const agenda=`/* =================================================================== Agenda */
function Agenda({ ordens, nomeCliente, abrirOS, agendarOS, empresa, equipe, clientes, servicos, produtos, salvarOS, salvarCliente, usuarioAtual }) {
  const [dia, setDia] = useState(HOJE);
  const [visao, setVisao] = useState("semana");
  const [filtro, setFiltro] = useState("proximos");
  const [busca, setBusca] = useState("");
  const [agendando, setAgendando] = useState(null);
  const [novaOS, setNovaOS] = useState(false);

  const inicioSemana = (d) => {
    const x = new Date(d + "T12:00:00");
    const dow = x.getDay();
    x.setDate(x.getDate() - ((dow + 6) % 7));
    return iso(x);
  };
  const moverMes = (d, n) => {
    const x = new Date(d + "T12:00:00");
    x.setDate(1); x.setMonth(x.getMonth() + n);
    return iso(x);
  };
  const mesAtual = dia.slice(0, 7);
  const inicio = inicioSemana(dia);
  const semana = Array.from({ length: 7 }, (_, i) => addDays(inicio, i));
  const primeiroMes = mesAtual + "-01";
  const gradeInicio = inicioSemana(primeiroMes);
  const diasMes = Array.from({ length: 42 }, (_, i) => addDays(gradeInicio, i));
  const termo = semAcento(busca.trim());
  const bateBusca = (o) => !termo || semAcento([o.numero,nomeCliente(o.clienteId),o.local,o.localServico,resumoOS(o)].filter(Boolean).join(" ")).includes(termo);
  const bateFiltro = (o) => filtro === "concluidos" ? o.status === "concluida"
    : filtro === "proximos" ? o.status !== "concluida" && (!o.data || o.data >= HOJE)
    : true;
  const base = ordens.filter((o) => o.status !== "cancelada" && bateFiltro(o) && bateBusca(o));
  const doDia = base.filter((o) => o.data === dia).sort((a,b)=>(a.hora||"").localeCompare(b.hora||""));
  const semAgenda = base.filter((o) => !o.data && o.status !== "concluida");
  const concluidosMes = ordens.filter((o)=>o.status==="concluida" && (o.concluidaEm||o.data||"").slice(0,7)===mesAtual && bateBusca(o));

  const abrirHoje = () => { setDia(HOJE); setVisao("dia"); };
  const tituloLista = visao === "mes" && filtro === "concluidos"
    ? \`Serviços feitos em \${nomeMes(mesAtual)} · \${concluidosMes.length}\`
    : \`\${diaSemana(dia)}, \${dataBR(dia)}\${dia===HOJE?" · hoje":""}\`;
  const lista = visao === "mes" && filtro === "concluidos"
    ? [...concluidosMes].sort((a,b)=>((b.concluidaEm||b.data||"")+" "+(b.hora||"")).localeCompare((a.concluidaEm||a.data||"")+" "+(a.hora||"")))
    : doDia;

  return (
    <>
      <PageHead title="Agenda" sub="Próximos atendimentos e histórico completo do que já foi feito."
        action={<Btn icon={Plus} onClick={() => setNovaOS(true)}>Novo agendamento</Btn>} />

      <Panel className="p-3 sm:p-4 mb-5">
        <div className="flex flex-col lg:flex-row lg:items-center gap-3 justify-between">
          <div className="flex flex-wrap gap-2">
            {[['dia','Hoje'],['semana','Semana'],['mes','Mês']].map(([id,label])=>(
              <button key={id} onClick={()=>id==='dia'?abrirHoje():setVisao(id)}
                className={cx("px-4 py-2 rounded-xl text-[13px] font-medium",ring,visao===id?"bg-slate-900 text-white":"bg-slate-50 text-slate-600 hover:bg-slate-100")}>{label}</button>
            ))}
            <span className="w-px bg-slate-200 mx-1 hidden sm:block" />
            {[['proximos','Próximos'],['concluidos','Concluídos'],['todos','Todos']].map(([id,label])=>(
              <button key={id} onClick={()=>setFiltro(id)}
                className={cx("px-3 py-2 rounded-xl text-[13px] font-medium",ring,filtro===id?"bg-teal-50 text-teal-800 ring-1 ring-teal-200":"text-slate-500 hover:bg-slate-50")}>{label}</button>
            ))}
          </div>
          <div className="relative min-w-0 lg:w-72">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input value={busca} onChange={(e)=>setBusca(e.target.value)} placeholder="Cliente, OS, prédio ou endereço" className="pl-9" />
          </div>
        </div>
      </Panel>

      {visao === "semana" && <div className="flex items-center gap-1 sm:gap-2 mb-6">
        <button onClick={()=>setDia(addDays(dia,-7))} aria-label="Semana anterior" className={cx("p-3 rounded-xl text-slate-400 hover:bg-white hover:text-slate-700 shrink-0",ring)}><ArrowLeft className="w-4 h-4" /></button>
        <div className="grid grid-cols-7 gap-1.5 sm:gap-2 flex-1">
          {semana.map((d)=>{
            const qtd=ordens.filter((o)=>o.data===d&&o.status!=="cancelada").length;
            const feitos=ordens.filter((o)=>(o.concluidaEm||o.data)===d&&o.status==="concluida").length;
            const sel=d===dia;
            return <button key={d} onClick={()=>setDia(d)} className={cx("rounded-2xl py-3 text-center transition-colors",ring,sel?"bg-slate-900 text-white":"bg-white ring-1 ring-slate-200/70 text-slate-600 hover:ring-slate-300")}>
              <p className={cx("text-[11px] uppercase tracking-wide",sel?"text-slate-300":d===HOJE?"text-teal-700 font-semibold":"text-slate-400")}>{diaCurto(d)}</p>
              <p className={cx("text-[19px] font-semibold leading-tight mt-0.5 tabular-nums",d===HOJE&&!sel&&"text-teal-800")}>{d.slice(8)}</p>
              <div className="h-2 flex justify-center items-center gap-1">{qtd>0&&<span className={cx("w-1.5 h-1.5 rounded-full",sel?"bg-teal-400":"bg-teal-600")} />}{feitos>0&&<span className={cx("w-1.5 h-1.5 rounded-full",sel?"bg-emerald-300":"bg-emerald-500")} />}</div>
            </button>;
          })}
        </div>
        <button onClick={()=>setDia(addDays(dia,7))} aria-label="Próxima semana" className={cx("p-3 rounded-xl text-slate-400 hover:bg-white hover:text-slate-700 shrink-0",ring)}><ArrowRight className="w-4 h-4" /></button>
      </div>}

      {visao === "mes" && <Panel className="p-3 sm:p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <button onClick={()=>setDia(moverMes(dia,-1))} className={cx("p-2 rounded-xl hover:bg-slate-50 text-slate-500",ring)}><ArrowLeft className="w-4 h-4" /></button>
          <div className="text-center"><p className="font-semibold text-slate-900">{nomeMes(mesAtual)}</p><button onClick={abrirHoje} className="text-[12px] text-teal-700 mt-0.5 hover:underline">Voltar para hoje</button></div>
          <button onClick={()=>setDia(moverMes(dia,1))} className={cx("p-2 rounded-xl hover:bg-slate-50 text-slate-500",ring)}><ArrowRight className="w-4 h-4" /></button>
        </div>
        <div className="grid grid-cols-7 text-center text-[11px] uppercase tracking-wide text-slate-400 mb-1">{['seg','ter','qua','qui','sex','sáb','dom'].map(x=><span key={x} className="py-1">{x}</span>)}</div>
        <div className="grid grid-cols-7 gap-1 sm:gap-2">
          {diasMes.map((d)=>{
            const doMes=d.slice(0,7)===mesAtual;
            const qtd=ordens.filter((o)=>o.data===d&&o.status!=="cancelada"&&o.status!=="concluida").length;
            const feitos=ordens.filter((o)=>(o.concluidaEm||o.data)===d&&o.status==="concluida").length;
            const sel=d===dia;
            return <button key={d} onClick={()=>setDia(d)} className={cx("min-h-[58px] sm:min-h-[72px] rounded-xl p-1.5 sm:p-2 text-left border transition-colors",ring,sel?"border-slate-900 bg-slate-900 text-white":doMes?"border-slate-200 bg-white hover:border-slate-300":"border-transparent bg-slate-50/40 text-slate-300")}>
              <span className={cx("text-[13px] font-medium tabular-nums",d===HOJE&&!sel&&"text-teal-700")}>{Number(d.slice(8))}</span>
              <div className="mt-2 space-y-1">{qtd>0&&<span className={cx("block text-[10px] sm:text-[11px] truncate",sel?"text-teal-300":"text-teal-700")}>{qtd} próximo{qtd>1?'s':''}</span>}{feitos>0&&<span className={cx("block text-[10px] sm:text-[11px] truncate",sel?"text-emerald-300":"text-emerald-700")}>{feitos} feito{feitos>1?'s':''}</span>}</div>
            </button>;
          })}
        </div>
      </Panel>}

      <Rotulo>{tituloLista}</Rotulo>
      <Panel className="divide-y divide-slate-100 overflow-hidden mb-8">
        {lista.length===0 ? <Empty icon={CalendarDays} title={filtro==='concluidos'?"Nenhum serviço encontrado":"Nenhum atendimento neste período"} sub={busca?"Tente outro cliente, número de OS ou endereço.":"Use Novo agendamento para marcar um atendimento."} />
        : lista.map((os)=><Linha key={os.id} onClick={()=>abrirOS(os.id)}>
          <div className="flex gap-4 items-start">
            <div className="w-16 shrink-0"><p className="text-[16px] font-semibold text-slate-900 tabular-nums">{os.hora||"—"}</p><p className="text-[11px] text-slate-400 mt-1">{os.status==='concluida'?dataCurta(os.concluidaEm||os.data):os.numero}</p></div>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-3"><p className="font-medium text-slate-900 truncate">{nomeCliente(os.clienteId)}</p><Pill tone={ST_OS[os.status].tone}>{ST_OS[os.status].label}</Pill></div>
              <p className="text-[13px] text-slate-600 mt-1 line-clamp-2">{os.itens.length?os.itens.map((i)=>\`\${i.qtd}× \${i.nome}\`).join(" · "):resumoOS(os)}</p>
              <div className="flex items-center gap-4 mt-2 text-[12px] flex-wrap"><Endereco valor={os.local} local={os.localServico} compacto className="max-w-full" />{empresa.temEquipe&&<span className="flex items-center gap-1.5 text-slate-400"><User className="w-3.5 h-3.5" />{os.responsavel}</span>}</div>
            </div>
          </div>
        </Linha>)}
      </Panel>

      {filtro!=="concluidos" && semAgenda.length>0 && <section>
        <Rotulo>Aguardando agendamento · {semAgenda.length}</Rotulo>
        <Panel className="divide-y divide-slate-100 overflow-hidden">{semAgenda.map((os)=><Linha key={os.id}><div className="flex items-center justify-between gap-3"><button onClick={()=>abrirOS(os.id)} className={cx("min-w-0 text-left",ring)}><p className="font-medium text-slate-900 truncate">{nomeCliente(os.clienteId)}</p><p className="text-[13px] text-slate-500 truncate">{os.numero} · {resumoOS(os)}</p></button><Btn size="sm" variant="soft" icon={CalendarClock} onClick={()=>setAgendando(os)}>Agendar</Btn></div></Linha>)}</Panel>
      </section>}

      <AgendarModal os={agendando} onClose={()=>setAgendando(null)} onSalvar={agendarOS} empresa={empresa} diaSugerido={dia} equipe={equipe} />
      {novaOS && <NovaOS onClose={()=>setNovaOS(false)} clientes={clientes} servicos={servicos} produtos={produtos} empresa={empresa} salvarOS={salvarOS} salvarCliente={salvarCliente} equipe={equipe} usuarioAtual={usuarioAtual} dataInicial={dia} />}
    </>
  );
}

`;

src=src.slice(0,a)+agenda+src.slice(b);
const oldSig='function NovaOS({ onClose, clientes, servicos, produtos, empresa, salvarOS, salvarCliente, equipe = [], usuarioAtual }) {';
const newSig='function NovaOS({ onClose, clientes, servicos, produtos, empresa, salvarOS, salvarCliente, equipe = [], usuarioAtual, dataInicial = "" }) {';
if(!src.includes(oldSig)) throw new Error('NovaOS signature not found');
src=src.replace(oldSig,newSig);
const oldData='itens: [], data: "", hora: "09:00", responsavel: empresa.responsavel, responsavelId: usuarioAtual?.id || null, obs: "",';
const newData='itens: [], data: dataInicial || "", hora: "09:00", responsavel: empresa.responsavel, responsavelId: usuarioAtual?.id || null, obs: "",';
if(!src.includes(oldData)) throw new Error('NovaOS initial date not found');
src=src.replace(oldData,newData);
writeFileSync(path,src,'utf8');
console.log('Agenda V2 source refactor applied');
