from pathlib import Path

ROOT=Path('.')
legacy_path=ROOT/'src/legacy/ZiisTecApp.jsx'
legacy=legacy_path.read_text()

def replace_once(text, old, new, label):
    count=text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 anchor, found {count}")
    return text.replace(old,new,1)

legacy=replace_once(legacy, 'import { beginEdgeSwipe, classifyHorizontalSwipe, isKeyboardViewportOpen } from "../lib/mobileNavigation";\n', 'import { beginEdgeSwipe, classifyHorizontalSwipe, isKeyboardViewportOpen } from "../lib/mobileNavigation";\nimport { filterOwnerAgenda, groupAgendaOrders, technicianDayAgenda } from "../lib/agendaMobile";\n', 'agenda import')
legacy=replace_once(legacy, '  tecnico: ["inicio", "ordens", "registrarMateriais", "vendaCampo"],', '  tecnico: ["inicio", "agenda", "ordens", "registrarMateriais", "vendaCampo"],', 'technician agenda permission')
start=legacy.find('function Agenda({')
end=legacy.find('function AgendarModal(', start)
if start < 0 or end < 0 or end <= start:
    raise SystemExit('agenda canonical block markers not found')
if legacy.find('function Agenda({', start+1) != -1:
    raise SystemExit('agenda canonical block is not unique')
agenda_block='''function Agenda({ ordens, nomeCliente, abrirOS, agendarOS, desagendarOS, empresa, equipe, clientes, servicos, produtos, salvarOS, salvarCliente, usuarioAtual, papel, pedirConfirmacao }) {
  const tecnico = papel === "tecnico";
  const [dia, setDia] = useState(HOJE);
  const [visao, setVisao] = useState(() => (typeof window !== "undefined" && window.innerWidth < 768 ? "lista" : "semana"));
  const [filtro, setFiltro] = useState("proximos");
  const [tecnicoId, setTecnicoId] = useState("");
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
  const bateBusca = (o) => !termo || semAcento([o.numero, nomeCliente(o.clienteId), o.local, o.localServico, resumoOS(o), o.responsavel].filter(Boolean).join(" ")).includes(termo);
  const baseBusca = ordens.filter(bateBusca);
  const ownerLista = filterOwnerAgenda(baseBusca, { filter: filtro, today: HOJE, technicianId: tecnicoId });
  const ownerGrupos = groupAgendaOrders(ownerLista, filtro);
  const meuDia = technicianDayAgenda(baseBusca, { userId: usuarioAtual?.id, day: dia, today: HOJE });
  const tecnicos = equipe.filter((m) => m.papel === "tecnico" && m.ativo !== false);
  const nomeTecnico = (os) => equipe.find((m) => m.usuarioId === os.responsavelId)?.usuario?.nome || os.responsavel || "Sem técnico";
  const semAgenda = filterOwnerAgenda(baseBusca, { filter: "semdata", today: HOJE, technicianId: tecnicoId });

  const rotuloGrupo = (data) => {
    if (data === "sem-data") return "Sem data";
    if (data === HOJE) return "Hoje";
    if (data === addDays(HOJE, 1)) return "Amanhã";
    return `${diaSemana(data).replace("-feira", "")}, ${dataBR(data)}`;
  };
  const rotuloFiltro = { hoje: "Hoje", proximos: "Próximos", semdata: "Sem data", concluidos: "Concluídos" }[filtro] || "Agenda";
  const abrirHoje = () => { setDia(HOJE); setVisao("lista"); if (!tecnico) setFiltro("hoje"); };
  const selecionarFiltro = (id) => { setFiltro(id); setVisao("lista"); if (id === "hoje") setDia(HOJE); };

  const CardAgenda = ({ os, atraso = false }) => {
    const st = ST_OS[os.status] || { label: os.status || "Status", tone: "neutro" };
    return <Linha onClick={() => abrirOS(os.id)} className="py-3.5 sm:py-4">
      <div className="flex gap-3 sm:gap-4 items-start">
        <div className="w-14 sm:w-16 shrink-0">
          <p className={cx("text-[16px] font-semibold tabular-nums", atraso ? "text-rose-700" : "text-slate-900")}>{os.hora || "—"}</p>
          <p className="text-[11px] text-slate-400 mt-1 truncate">{os.numero}</p>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="font-medium text-slate-900 truncate">{nomeCliente(os.clienteId)}</p>
            <Pill tone={st.tone}>{st.label}</Pill>
          </div>
          <p className="text-[13px] text-slate-600 mt-1 line-clamp-2">{resumoOS(os)}</p>
          <div className="mt-2 flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-4 text-[12px] min-w-0">
            <Endereco valor={os.local} local={os.localServico} compacto className="max-w-full" />
            {empresa.temEquipe && <span className="flex items-center gap-1.5 text-slate-400 truncate"><User className="w-3.5 h-3.5 shrink-0" />{nomeTecnico(os)}</span>}
          </div>
          {atraso && <p className="mt-2 text-[11px] font-medium text-rose-700">Atrasado desde {dataBR(os.data)}</p>}
          {!tecnico && os.data && os.status !== "concluida" && <button onClick={(e) => { e.stopPropagation(); pedirConfirmacao({ titulo: "Remover da agenda?", texto: `${os.numero} continuará existindo como OS, mas ficará sem data e horário.`, confirmar: "Remover agendamento", perigo: true, acao: () => desagendarOS(os.id) }); }} className="mt-2 min-h-11 px-1 text-[12px] font-medium text-rose-600 hover:underline">Remover da agenda</button>}
        </div>
      </div>
    </Linha>;
  };

  return (
    <>
      <PageHead title={tecnico ? "Meu dia" : "Agenda"} sub={tecnico ? "Seus atendimentos atribuídos, em ordem de execução." : "Planejamento da operação e próximos atendimentos."}
        action={!tecnico && <Btn icon={Plus} onClick={() => setNovaOS(true)}>Novo agendamento</Btn>} />

      {tecnico ? <Panel className="p-3 sm:p-4 mb-5">
        <div className="flex items-center justify-between gap-2">
          <button onClick={() => setDia(addDays(dia, -1))} aria-label="Dia anterior" className={cx("min-h-11 min-w-11 p-3 rounded-xl text-slate-500 hover:bg-slate-50", ring)}><ArrowLeft className="w-4 h-4" /></button>
          <div className="text-center min-w-0">
            <p className="font-semibold text-slate-900 truncate">{dia === HOJE ? "Hoje" : `${diaSemana(dia)}, ${dataBR(dia)}`}</p>
            {dia !== HOJE && <button onClick={() => setDia(HOJE)} className="min-h-11 text-[12px] text-teal-700 hover:underline">Voltar para hoje</button>}
          </div>
          <button onClick={() => setDia(addDays(dia, 1))} aria-label="Próximo dia" className={cx("min-h-11 min-w-11 p-3 rounded-xl text-slate-500 hover:bg-slate-50", ring)}><ArrowRight className="w-4 h-4" /></button>
        </div>
        <div className="relative mt-3">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Cliente, OS ou endereço" className="pl-9" />
        </div>
      </Panel> : <Panel className="p-3 sm:p-4 mb-5">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2 items-center">
            {[["lista", "Lista"], ["semana", "Semana"], ["mes", "Mês"]].map(([id, label]) => <button key={id} onClick={() => setVisao(id)} className={cx("min-h-11 px-4 py-2 rounded-xl text-[13px] font-medium", ring, visao === id ? "bg-slate-900 text-white" : "bg-slate-50 text-slate-600 hover:bg-slate-100")}>{label}</button>)}
          </div>
          <div className="flex flex-wrap gap-2">
            {[["hoje", "Hoje"], ["proximos", "Próximos"], ["semdata", "Sem data"], ["concluidos", "Concluídos"]].map(([id, label]) => <button key={id} onClick={() => selecionarFiltro(id)} className={cx("min-h-11 px-3 py-2 rounded-xl text-[13px] font-medium", ring, filtro === id ? "bg-teal-50 text-teal-800 ring-1 ring-teal-200" : "text-slate-500 hover:bg-slate-50")}>{label}</button>)}
          </div>
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
            <div className="relative min-w-0">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Cliente, OS, prédio ou endereço" className="pl-9" />
            </div>
            {empresa.temEquipe && <Select value={tecnicoId} onChange={(e) => setTecnicoId(e.target.value)} aria-label="Filtrar por técnico">
              <option value="">Todos os técnicos</option>
              {tecnicos.map((m) => <option key={m.usuarioId} value={m.usuarioId}>{m.usuario?.nome || "Técnico"}</option>)}
            </Select>}
          </div>
        </div>
      </Panel>}

      {!tecnico && visao === "semana" && <div className="flex items-center gap-1 sm:gap-2 mb-6">
        <button onClick={() => setDia(addDays(dia, -7))} aria-label="Semana anterior" className={cx("min-h-11 min-w-11 p-3 rounded-xl text-slate-400 hover:bg-white hover:text-slate-700 shrink-0", ring)}><ArrowLeft className="w-4 h-4" /></button>
        <div className="grid grid-cols-7 gap-1.5 sm:gap-2 flex-1 min-w-0">
          {semana.map((d) => {
            const qtd = ordens.filter((o) => o.data === d && o.status !== "cancelada").length;
            const sel = d === dia;
            return <button key={d} onClick={() => setDia(d)} className={cx("min-w-0 rounded-2xl py-3 text-center transition-colors", ring, sel ? "bg-slate-900 text-white" : "bg-white border border-slate-200 hover:border-slate-300")}>
              <p className={cx("text-[10px] uppercase font-semibold", sel ? "text-slate-300" : "text-slate-400")}>{diaSemana(d).slice(0, 3)}</p>
              <p className="text-lg font-semibold leading-tight mt-0.5">{d.slice(8)}</p>
              <p className={cx("text-[10px] mt-1", sel ? "text-teal-300" : "text-slate-400")}>{qtd || "·"}</p>
            </button>;
          })}
        </div>
        <button onClick={() => setDia(addDays(dia, 7))} aria-label="Próxima semana" className={cx("min-h-11 min-w-11 p-3 rounded-xl text-slate-400 hover:bg-white hover:text-slate-700 shrink-0", ring)}><ArrowRight className="w-4 h-4" /></button>
      </div>}

      {!tecnico && visao === "mes" && <Panel className="p-3 sm:p-4 mb-6">
        <div className="flex items-center justify-between gap-3 mb-3">
          <button onClick={() => setDia(moverMes(dia, -1))} aria-label="Mês anterior" className={cx("min-h-11 min-w-11 p-3 rounded-xl hover:bg-slate-50", ring)}><ArrowLeft className="w-4 h-4" /></button>
          <button onClick={abrirHoje} className={cx("min-h-11 px-3 text-sm font-semibold text-slate-800", ring)}>{new Date(primeiroMes + "T12:00:00").toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}</button>
          <button onClick={() => setDia(moverMes(dia, 1))} aria-label="Próximo mês" className={cx("min-h-11 min-w-11 p-3 rounded-xl hover:bg-slate-50", ring)}><ArrowRight className="w-4 h-4" /></button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-[10px] uppercase font-semibold text-slate-400 mb-1">{["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"].map((x) => <span key={x}>{x}</span>)}</div>
        <div className="grid grid-cols-7 gap-1">
          {diasMes.map((d) => { const qtd = ordens.filter((o) => o.data === d && o.status !== "cancelada").length; const fora = !d.startsWith(mesAtual); return <button key={d} onClick={() => { setDia(d); setFiltro("hoje"); setVisao("lista"); }} className={cx("min-h-11 rounded-xl text-sm flex flex-col items-center justify-center", ring, d === HOJE ? "ring-1 ring-teal-300" : "", fora ? "text-slate-300" : "text-slate-700", qtd ? "bg-slate-50" : "hover:bg-slate-50")}><span>{Number(d.slice(8))}</span>{qtd > 0 && <span className="text-[9px] text-teal-700 font-semibold">{qtd}</span>}</button>; })}
        </div>
      </Panel>}

      {tecnico ? <>
        {meuDia.overdue.length > 0 && <section className="mb-6"><Rotulo>Atrasados · {meuDia.overdue.length}</Rotulo><Panel className="divide-y divide-slate-100 overflow-hidden">{meuDia.overdue.map((os) => <CardAgenda key={os.id} os={os} atraso />)}</Panel></section>}
        <section><Rotulo>{dia === HOJE ? "Hoje" : `${diaSemana(dia)}, ${dataBR(dia)}`} · {meuDia.scheduled.length}</Rotulo>{meuDia.scheduled.length ? <Panel className="divide-y divide-slate-100 overflow-hidden">{meuDia.scheduled.map((os) => <CardAgenda key={os.id} os={os} />)}</Panel> : <Empty icon={CalendarClock} title="Nenhum atendimento atribuído" text="Não há OS autorizadas para você neste dia." />}</section>
      </> : <>
        {ownerLista.length === 0 ? <Empty icon={CalendarClock} title={`Nenhum item em ${rotuloFiltro.toLowerCase()}`} text="Altere o filtro ou escolha outro período." />
        : <div className="space-y-5 mb-8">{ownerGrupos.map((grupo) => <section key={grupo.date}><Rotulo>{rotuloGrupo(grupo.date)} · {grupo.orders.length}</Rotulo><Panel className="divide-y divide-slate-100 overflow-hidden">{grupo.orders.map((os) => <CardAgenda key={os.id} os={os} />)}</Panel></section>)}</div>}

        {filtro !== "semdata" && filtro !== "concluidos" && semAgenda.length > 0 && <section>
          <Rotulo>Aguardando agendamento · {semAgenda.length}</Rotulo>
          <Panel className="divide-y divide-slate-100 overflow-hidden">{semAgenda.map((os) => <Linha key={os.id}><div className="flex items-center justify-between gap-3"><button onClick={() => abrirOS(os.id)} className={cx("min-w-0 text-left min-h-11", ring)}><p className="font-medium text-slate-900 truncate">{nomeCliente(os.clienteId)}</p><p className="text-[13px] text-slate-500 truncate">{os.numero} · {resumoOS(os)}</p></button><Btn size="sm" variant="soft" icon={CalendarClock} onClick={() => setAgendando(os)}>Agendar</Btn></div></Linha>)}</Panel>
        </section>}
      </>}

      {!tecnico && <AgendarModal os={agendando} onClose={() => setAgendando(null)} onSalvar={agendarOS} empresa={empresa} diaSugerido={dia} equipe={equipe} />}
      {!tecnico && novaOS && <NovaOS onClose={() => setNovaOS(false)} clientes={clientes} servicos={servicos} produtos={produtos} empresa={empresa} salvarOS={salvarOS} salvarCliente={salvarCliente} equipe={equipe} usuarioAtual={usuarioAtual} dataInicial={dia} />}
    </>
  );
}

'''
legacy=legacy[:start]+agenda_block+legacy[end:]
legacy_path.write_text(legacy)
(ROOT/'src/lib/agendaMobile.js').write_text('''const isCancelled = (order) => order?.status === "cancelada";
const isCompleted = (order) => order?.status === "concluida";
const scheduledDate = (order) => order?.data || "";
const completedDate = (order) => (order?.concluidaEm || order?.data || "").slice(0, 10);

export function agendaRoleScope(orders = [], { role, userId } = {}) {
  const visible = orders.filter((order) => !isCancelled(order));
  if (role !== "tecnico") return visible;
  if (!userId) return [];
  return visible.filter((order) => order?.responsavelId === userId);
}

export function filterOwnerAgenda(orders = [], {
  filter = "proximos",
  today,
  technicianId = "",
} = {}) {
  let visible = agendaRoleScope(orders, { role: "proprietario" });
  if (technicianId) visible = visible.filter((order) => order?.responsavelId === technicianId);

  if (filter === "hoje") return visible.filter((order) => scheduledDate(order) === today);
  if (filter === "semdata") return visible.filter((order) => !scheduledDate(order) && !isCompleted(order));
  if (filter === "concluidos") return visible.filter(isCompleted);
  return visible.filter((order) => !isCompleted(order) && Boolean(scheduledDate(order)) && scheduledDate(order) >= today);
}

export function agendaOrderDate(order, filter = "proximos") {
  if (filter === "concluidos") return completedDate(order);
  return scheduledDate(order);
}

export function sortAgendaOrders(orders = [], filter = "proximos") {
  return [...orders].sort((a, b) => {
    const ad = agendaOrderDate(a, filter) || "9999-12-31";
    const bd = agendaOrderDate(b, filter) || "9999-12-31";
    if (ad !== bd) return ad.localeCompare(bd);
    return (a?.hora || "99:99").localeCompare(b?.hora || "99:99") || String(a?.numero || "").localeCompare(String(b?.numero || ""));
  });
}

export function groupAgendaOrders(orders = [], filter = "proximos") {
  const groups = [];
  for (const order of sortAgendaOrders(orders, filter)) {
    const date = agendaOrderDate(order, filter) || "sem-data";
    let group = groups.at(-1);
    if (!group || group.date !== date) {
      group = { date, orders: [] };
      groups.push(group);
    }
    group.orders.push(order);
  }
  return groups;
}

export function technicianDayAgenda(orders = [], { userId, day, today } = {}) {
  const scoped = agendaRoleScope(orders, { role: "tecnico", userId });
  const overdue = day === today
    ? scoped.filter((order) => !isCompleted(order) && Boolean(scheduledDate(order)) && scheduledDate(order) < today)
    : [];
  const scheduled = scoped.filter((order) => scheduledDate(order) === day);
  return {
    overdue: sortAgendaOrders(overdue, "proximos"),
    scheduled: [...scheduled].sort((a, b) => (a?.hora || "99:99").localeCompare(b?.hora || "99:99") || String(a?.numero || "").localeCompare(String(b?.numero || ""))),
  };
}
''')
(ROOT/'tests/blockers/rc1c_agenda_mobile.test.mjs').write_text('''import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { filterOwnerAgenda, groupAgendaOrders, technicianDayAgenda } from '../../src/lib/agendaMobile.js';

const TODAY = '2026-09-14';
const orders = [
  { id: 'today-open', numero: 'OS-1', status: 'agendada', data: TODAY, hora: '10:00', responsavelId: 'tech-1' },
  { id: 'today-done', numero: 'OS-2', status: 'concluida', data: TODAY, concluidaEm: TODAY, hora: '09:00', responsavelId: 'tech-1' },
  { id: 'tomorrow', numero: 'OS-3', status: 'agendada', data: '2026-09-15', hora: '08:00', responsavelId: 'tech-1' },
  { id: 'later', numero: 'OS-4', status: 'agendada', data: '2026-09-16', hora: '14:00', responsavelId: 'tech-2' },
  { id: 'undated', numero: 'OS-5', status: 'aguardando', data: '', hora: '', responsavelId: 'tech-1' },
  { id: 'overdue', numero: 'OS-6', status: 'agendada', data: '2026-09-13', hora: '16:00', responsavelId: 'tech-1' },
  { id: 'other-tech', numero: 'OS-7', status: 'agendada', data: TODAY, hora: '07:00', responsavelId: 'tech-2' },
  { id: 'cancelled', numero: 'OS-8', status: 'cancelada', data: TODAY, hora: '11:00', responsavelId: 'tech-1' },
];
const ids = (items) => items.map((item) => item.id);

test('owner Hoje, Sem data and Concluídos filters are explicit', () => {
  assert.deepEqual(ids(filterOwnerAgenda(orders, { filter: 'hoje', today: TODAY })), ['today-open', 'today-done', 'other-tech']);
  assert.deepEqual(ids(filterOwnerAgenda(orders, { filter: 'semdata', today: TODAY })), ['undated']);
  assert.deepEqual(ids(filterOwnerAgenda(orders, { filter: 'concluidos', today: TODAY })), ['today-done']);
});

test('owner Próximos returns every future authorized service, not only one selected day', () => {
  assert.deepEqual(ids(filterOwnerAgenda(orders, { filter: 'proximos', today: TODAY })), ['today-open', 'tomorrow', 'later', 'other-tech']);
  const groups = groupAgendaOrders(filterOwnerAgenda(orders, { filter: 'proximos', today: TODAY }), 'proximos');
  assert.deepEqual(groups.map((group) => group.date), [TODAY, '2026-09-15', '2026-09-16']);
  assert.deepEqual(ids(groups[0].orders), ['other-tech', 'today-open']);
});

test('owner technician filter narrows only the authorized owner projection', () => {
  assert.deepEqual(ids(filterOwnerAgenda(orders, { filter: 'proximos', today: TODAY, technicianId: 'tech-1' })), ['today-open', 'tomorrow']);
});

test('technician Meu dia keeps assigned-only scope and overdue first', () => {
  const result = technicianDayAgenda(orders, { userId: 'tech-1', day: TODAY, today: TODAY });
  assert.deepEqual(ids(result.overdue), ['overdue']);
  assert.deepEqual(ids(result.scheduled), ['today-done', 'today-open']);
  assert.equal([...result.overdue, ...result.scheduled].some((order) => order.responsavelId !== 'tech-1'), false);
});

test('technician can change day without seeing another technician work', () => {
  const result = technicianDayAgenda(orders, { userId: 'tech-1', day: '2026-09-16', today: TODAY });
  assert.deepEqual(result.overdue, []);
  assert.deepEqual(result.scheduled, []);
});

test('UI exposes owner Lista/Semana/Mês and technician Meu dia without granting owner actions', () => {
  const source = fs.readFileSync(new URL('../../src/legacy/ZiisTecApp.jsx', import.meta.url), 'utf8');
  assert.match(source, /\[\["lista", "Lista"\], \["semana", "Semana"\], \["mes", "Mês"\]\]/);
  assert.match(source, /\[\["hoje", "Hoje"\], \["proximos", "Próximos"\], \["semdata", "Sem data"\], \["concluidos", "Concluídos"\]\]/);
  assert.match(source, /PageHead title=\{tecnico \? "Meu dia" : "Agenda"\}/);
  assert.match(source, /action=\{!tecnico && <Btn icon=\{Plus\}/);
  assert.match(source, /tecnico: \["inicio", "agenda", "ordens", "registrarMateriais", "vendaCampo"\]/);
});

test('frontend defense and database RLS preserve assigned-only and cross-tenant boundaries', () => {
  const source = fs.readFileSync(new URL('../../src/legacy/ZiisTecApp.jsx', import.meta.url), 'utf8');
  const rls = fs.readFileSync(new URL('../../supabase/0028_optimize_rls_auth_initplans.sql', import.meta.url), 'utf8');
  assert.match(source, /const ordensEmp = doTenant\(ordens\)\.filter\(\(o\) => permitido\("todasOS"\) \|\| o\.responsavelId === usuarioAtual\?\.id\)/);
  assert.match(rls, /alter policy p_wo_select on public\.work_orders/);
  assert.match(rls, /public\.zt_is_owner\(company_id\) or \(public\.zt_is_member\(company_id\) and assigned_to=\(select auth\.uid\(\)\)\)/);
});
''')
package_path=ROOT/'package.json'
pkg=package_path.read_text()
needle='tests/blockers/rc1c_voice_state_machine.test.mjs tests/blockers/rc1c_mobile_navigation.test.mjs'
replacement=needle+' tests/blockers/rc1c_agenda_mobile.test.mjs'
pkg=replace_once(pkg,needle,replacement,'verify:v2 agenda test registration')
package_path.write_text(pkg)
final=legacy_path.read_text()
for marker in ['Meu dia','Próximos','Sem data','Concluídos','filterOwnerAgenda','technicianDayAgenda']:
    if marker not in final:
        raise SystemExit('postcondition failed: '+marker)
print('RC1C_WAVE3_DIRECT=PASS')
