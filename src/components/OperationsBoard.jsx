import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, CalendarClock, ChevronRight, Clock, Loader2, MapPin,
  Plus, RefreshCw, SlidersHorizontal, User, UserPlus, X,
} from 'lucide-react';
import {
  ATALHOS, FILTROS, PRIORIDADES, SEM_RESPONSAVEL,
  aplicarMovimentoLocal, cartaoAtrasado, conflitosLocais, destinoParaAssignee,
  estadoDoTecnico, montarColunas, movimentoValido, nomeDoResponsavel,
  pessoasParaEscolher, resumoDoDia, textoDoAtraso, textoDoQuando,
} from '../lib/operationsBoard';
import {
  agendarOSOperacoesDB, atribuirOSDB, carregarQuadroOperacoes, conflitosAgendaDB,
  definirPrioridadeOSDB,
} from '../lib/operationsApi';
import { hojeISO as diaLocalISO } from '../lib/dates';
import OperationsCommandSimulator from './OperationsCommandSimulator';

/*
  Serviços — a tela onde o prestador organiza o dia.

  Uma tela só. O topo responde "o que precisa de atenção?" com quatro atalhos
  que apenas filtram esta mesma tela. Depois vem o que está sem responsável,
  porque serviço sem técnico é o que trava o dia. Depois o dia de cada pessoa.

  Nada aqui depende de arraste nem de mouse: toda ação tem botão com o nome do
  que faz. O arraste continua no computador como atalho, nunca como obrigação.

  O cartão vem sanitizado do banco (0116): não há valor, custo nem margem aqui,
  e esta tela não pergunta nada disso — a pergunta é quem vai fazer e quando.
*/

const ring = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500';
const cx = (...c) => c.filter(Boolean).join(' ');
const hora = (v) => (v ? String(v).slice(0, 5) : '');
const dataBR = (v) => (v ? new Date(`${String(v).slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR') : '');
const dataLonga = (v) => (v
  ? new Date(`${String(v).slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' })
  : '');
const agoraHHMM = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/* Normal quase não aparece: só o que exige atenção ganha cor. */
const TOM_PRIORIDADE = {
  urgent: 'bg-rose-600 text-white ring-rose-600',
  high: 'bg-amber-100 text-amber-900 ring-amber-300',
};
const ROTULO_PRIORIDADE = { urgent: 'URGENTE', high: 'ALTA' };

function Pill({ children, className }) {
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ring-1', className)}>
      {children}
    </span>
  );
}

/* Botão de ação do cartão: alvo de toque confortável, texto dizendo o que faz. */
function Acao({ children, onClick, disabled, tom = 'claro', icone: Icone }) {
  const tons = {
    escuro: 'bg-slate-900 text-white hover:bg-slate-800',
    claro: 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50',
    destaque: 'bg-teal-700 text-white hover:bg-teal-800',
  };
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={cx('inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-3.5 text-[13.5px] font-medium disabled:opacity-50', tons[tom], ring)}>
      {Icone ? <Icone className="h-4 w-4 shrink-0" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

export default function OperationsBoard({
  empresaId, usuarioAtual, real, aviso, abrirOS, hoje,
  clientes = [], salvarOS, salvarCliente, CampoVoz,
}) {
  // Nunca o corte do toISOString(): esse é o dia em UTC e, no Brasil, vira
  // "amanhã" entre 21h e meia-noite — a tela mostraria o dia errado à noite.
  const hojeISO = hoje || diaLocalISO();
  const [filtro, setFiltro] = useState('semana');
  const [extras, setExtras] = useState({ tecnicoId: '', prioridade: '', local: '' });
  const [maisFiltros, setMaisFiltros] = useState(false);
  const [board, setBoard] = useState(null);
  const [erro, setErro] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [movendo, setMovendo] = useState(null);
  const [arrastando, setArrastando] = useState(null);
  const [alvo, setAlvo] = useState(null);
  const [escolhendo, setEscolhendo] = useState(null);
  const [alterando, setAlterando] = useState(null);
  const [criando, setCriando] = useState(false);
  const [confirmacao, setConfirmacao] = useState(null);
  const [agora, setAgora] = useState(agoraHHMM);
  const vivo = useRef(true);
  useEffect(() => () => { vivo.current = false; }, []);

  // "Próximo atendimento" tem que continuar verdadeiro com o passar do tempo.
  useEffect(() => {
    const t = setInterval(() => { if (vivo.current) setAgora(agoraHHMM()); }, 60000);
    return () => clearInterval(t);
  }, []);

  const carregar = useCallback(async (silencioso = false) => {
    if (!real || !empresaId) return;
    if (!silencioso) setCarregando(true);
    try {
      const dados = await carregarQuadroOperacoes(empresaId, { filtro, hoje: hojeISO });
      if (vivo.current) { setBoard(dados); setErro(null); }
    } catch (e) {
      if (vivo.current) setErro(e?.message || 'Não consegui carregar os serviços.');
    } finally {
      if (vivo.current && !silencioso) setCarregando(false);
    }
  }, [real, empresaId, filtro, hojeISO]);

  useEffect(() => { carregar(); }, [carregar]);

  const colunas = useMemo(
    () => montarColunas(board, { hoje: hojeISO, ...extras }),
    [board, hojeISO, extras],
  );
  // Contagens do topo: derivadas do que o banco já devolveu, sem consulta nova.
  const resumo = useMemo(() => resumoDoDia(board, hojeISO), [board, hojeISO]);
  const semResponsavel = useMemo(
    () => colunas.find((c) => c.id === SEM_RESPONSAVEL)?.cartoes || [],
    [colunas],
  );
  const pessoas = useMemo(() => colunas.filter((c) => c.id !== SEM_RESPONSAVEL), [colunas]);
  const totalCartoes = useMemo(() => colunas.reduce((t, c) => t + c.carga, 0), [colunas]);

  if (!real) {
    return (
      <>
        <Cabecalho hojeISO={hojeISO} />
        <div className="rounded-2xl bg-white p-6 ring-1 ring-slate-200/70">
          <p className="text-[14px] text-slate-500">
            Aqui você organiza os serviços da sua empresa. Entre com a sua conta para usar.
          </p>
        </div>
      </>
    );
  }

  /* Muda o responsável de verdade: aplica local, chama a RPC oficial, e volta
     atrás se o banco recusar. */
  const mover = async (card, destinoId, { confirmado = false } = {}) => {
    if (!movimentoValido(card, destinoId)) return;
    const assignee = destinoParaAssignee(destinoId);

    // Aviso de choque antes de concluir: quem organiza decide, nada é bloqueado.
    if (!confirmado && assignee && card.scheduled_date && card.scheduled_time) {
      const local = conflitosLocais(board?.cards || [], {
        cardId: card.work_order_id, assigneeId: assignee,
        data: card.scheduled_date, hora: card.scheduled_time,
      });
      let total = local;
      try {
        total = await conflitosAgendaDB(card.work_order_id, {
          assigneeId: assignee, data: card.scheduled_date, hora: card.scheduled_time,
        });
      } catch { /* o aviso local já basta se a checagem falhar */ }
      if (total > 0) {
        const nome = colunas.find((c) => c.id === destinoId)?.nome || 'o técnico';
        setConfirmacao({ card, destinoId, nome, total });
        return;
      }
    }

    const anterior = board;
    setMovendo(card.work_order_id);
    setBoard((b) => (b ? { ...b, cards: aplicarMovimentoLocal(b.cards, card.work_order_id, destinoId) } : b));
    try {
      const r = await atribuirOSDB(card.work_order_id, assignee, { origem: 'web' });
      const destino = colunas.find((c) => c.id === destinoId)?.nome || 'Sem responsável';
      aviso?.(assignee ? `${card.number} com ${destino}.` : `${card.number} voltou para Sem responsável.`);
      if (Number(r?.conflicts) > 0) aviso?.('Atenção: já havia serviço nesse horário.');
      carregar(true);
    } catch (e) {
      if (vivo.current) setBoard(anterior); // a tela nunca fica num estado que o banco não aceitou
      aviso?.(e?.message || 'Não consegui mudar quem vai fazer este serviço.');
    } finally {
      if (vivo.current) setMovendo(null);
    }
  };

  /* Alterar: só chama a RPC do que o proprietário realmente mudou. */
  const salvarAlteracao = async (card, { responsavelId, data, horario, prioridade }) => {
    const atualResp = card.assignee_id || '';
    const mudouResp = String(responsavelId || '') !== atualResp;
    const mudouData = String(data || '') !== String(card.scheduled_date || '').slice(0, 10)
      || hora(horario) !== hora(card.scheduled_time);
    const mudouPrio = String(prioridade || 'normal') !== String(card.priority || 'normal');
    if (!mudouResp && !mudouData && !mudouPrio) { setAlterando(null); return; }

    setMovendo(card.work_order_id);
    try {
      if (mudouData) await agendarOSOperacoesDB(card.work_order_id, { data: data || null, hora: horario || null, origem: 'web' });
      if (mudouResp) await atribuirOSDB(card.work_order_id, responsavelId || null, { origem: 'web' });
      if (mudouPrio) await definirPrioridadeOSDB(card.work_order_id, prioridade, { origem: 'web' });
      setAlterando(null);
      aviso?.(`${card.number} atualizado.`);
      carregar(true);
    } catch (e) {
      aviso?.(e?.message || 'Não consegui alterar este serviço.');
    } finally {
      if (vivo.current) setMovendo(null);
    }
  };

  const soltarEm = (destinoId) => {
    const card = arrastando;
    setArrastando(null);
    setAlvo(null);
    if (card) mover(card, destinoId);
  };

  const propsCartao = {
    hoje: hojeISO,
    board,
    usuarioAtualId: usuarioAtual?.id,
    onEscolher: setEscolhendo,
    onAlterar: setAlterando,
    onAbrir: abrirOS,
    onArrastar: setArrastando,
    onSoltar: () => { setArrastando(null); setAlvo(null); },
  };

  return (
    <>
      <Cabecalho hojeISO={hojeISO}
        acao={(
          <div className="flex items-center gap-2">
            <button onClick={() => carregar()} disabled={carregando} aria-label="Atualizar a lista"
              className={cx('inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl bg-white px-3 text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-50', ring)}>
              <RefreshCw className={cx('h-4 w-4', carregando && 'animate-spin')} aria-hidden="true" />
            </button>
            <Acao tom="escuro" icone={Plus} onClick={() => setCriando(true)}>Novo serviço</Acao>
          </div>
        )} />

      {/* Atalhos: poucos, grandes, e só filtram esta tela. */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {ATALHOS.map((a) => {
          const n = resumo[a.contador] || 0;
          const ativo = filtro === a.id;
          const alerta = a.id === 'atrasadas' && n > 0;
          const organizar = a.id === 'semresponsavel' && n > 0;
          return (
            <button key={a.id} onClick={() => setFiltro(ativo ? 'semana' : a.id)} aria-pressed={ativo}
              className={cx('flex min-h-[64px] flex-col justify-center rounded-2xl px-4 py-3 text-left transition-colors', ring,
                ativo ? 'bg-slate-900 text-white'
                  : alerta ? 'bg-rose-50 text-rose-900 ring-1 ring-rose-200'
                    : organizar ? 'bg-amber-50 text-amber-900 ring-1 ring-amber-200'
                      : 'bg-white text-slate-700 ring-1 ring-slate-200')}>
              <span className="text-[22px] font-semibold leading-none tabular-nums">{n}</span>
              <span className={cx('mt-1 text-[13px] font-medium', ativo ? 'text-white/80' : 'opacity-80')}>{a.label}</span>
            </button>
          );
        })}
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <button onClick={() => setMaisFiltros((v) => !v)} aria-expanded={maisFiltros}
          className={cx('inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-white px-3 text-[13px] font-medium text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50', ring)}>
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
          {maisFiltros ? 'Esconder filtros' : 'Mais filtros'}
        </button>
        {filtro !== 'semana' ? (
          <button onClick={() => setFiltro('semana')}
            className={cx('inline-flex min-h-11 items-center rounded-xl px-3 text-[13px] font-medium text-teal-800 hover:bg-teal-50', ring)}>
            Ver todos
          </button>
        ) : null}
        <span className="ml-auto text-[12.5px] text-slate-400">{totalCartoes} serviço{totalCartoes === 1 ? '' : 's'}</span>
      </div>

      {maisFiltros ? (
        <div className="mb-5 flex flex-wrap items-center gap-2 rounded-2xl bg-white p-3 ring-1 ring-slate-200/70">
          <select value={filtro} onChange={(e) => setFiltro(e.target.value)} aria-label="Quais serviços mostrar"
            className={cx('min-h-11 rounded-xl bg-white px-3 text-[13px] text-slate-700 ring-1 ring-slate-200', ring)}>
            {FILTROS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
          <select value={extras.tecnicoId} onChange={(e) => setExtras((v) => ({ ...v, tecnicoId: e.target.value }))}
            aria-label="Filtrar por técnico"
            className={cx('min-h-11 rounded-xl bg-white px-3 text-[13px] text-slate-700 ring-1 ring-slate-200', ring)}>
            <option value="">Todos os técnicos</option>
            <option value={SEM_RESPONSAVEL}>Sem responsável</option>
            {(board?.members || []).map((m) => <option key={m.user_id} value={m.user_id}>{m.name}</option>)}
          </select>
          <select value={extras.prioridade} onChange={(e) => setExtras((v) => ({ ...v, prioridade: e.target.value }))}
            aria-label="Filtrar por prioridade"
            className={cx('min-h-11 rounded-xl bg-white px-3 text-[13px] text-slate-700 ring-1 ring-slate-200', ring)}>
            <option value="">Qualquer prioridade</option>
            {PRIORIDADES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          <input value={extras.local} onChange={(e) => setExtras((v) => ({ ...v, local: e.target.value }))}
            placeholder="Filtrar por local" aria-label="Filtrar por local"
            className={cx('min-h-11 min-w-[160px] flex-1 rounded-xl bg-white px-3 text-[13px] text-slate-700 ring-1 ring-slate-200 placeholder:text-slate-300', ring)} />
        </div>
      ) : null}

      {erro ? (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl bg-white p-5 ring-1 ring-slate-200/70">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
          <span className="min-w-0 flex-1 text-[14px] text-slate-600">{erro}</span>
          <Acao onClick={() => carregar()}>Tentar de novo</Acao>
        </div>
      ) : null}

      {!board && carregando ? (
        <div className="rounded-2xl bg-white p-6 text-[14px] text-slate-400 ring-1 ring-slate-200/70">Carregando…</div>
      ) : (
        <>
          {/* Serviço sem técnico não pode ficar escondido: é o que trava o dia. */}
          {semResponsavel.length > 0 ? (
            <section aria-label="Precisa organizar"
              onDragOver={(e) => { if (arrastando && movimentoValido(arrastando, SEM_RESPONSAVEL)) { e.preventDefault(); setAlvo(SEM_RESPONSAVEL); } }}
              onDragLeave={() => setAlvo((a) => (a === SEM_RESPONSAVEL ? null : a))}
              onDrop={(e) => { e.preventDefault(); soltarEm(SEM_RESPONSAVEL); }}
              className={cx('mb-5 rounded-2xl p-4 ring-1', alvo === SEM_RESPONSAVEL ? 'bg-teal-50 ring-2 ring-teal-400' : 'bg-amber-50/70 ring-amber-200')}>
              <h2 className="text-[15px] font-semibold text-amber-900">Precisa organizar</h2>
              <p className="mt-0.5 text-[13px] text-amber-800">
                {semResponsavel.length} serviço{semResponsavel.length === 1 ? '' : 's'} sem responsável
              </p>
              <div className="mt-3 grid gap-2 lg:grid-cols-2 xl:grid-cols-3">
                {semResponsavel.map((card) => (
                  <Cartao key={card.work_order_id} card={card} {...propsCartao} movendo={movendo === card.work_order_id} />
                ))}
              </div>
            </section>
          ) : null}

          {/* O dia de cada pessoa. No celular uma embaixo da outra; em tela
              grande vira grade. Em nenhum caso exige rolagem para o lado. */}
          <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
            {pessoas.map((coluna) => (
              <Pessoa key={coluna.id} coluna={coluna} board={board} hoje={hojeISO} agora={agora}
                usuarioAtualId={usuarioAtual?.id}
                ehAlvo={alvo === coluna.id} arrastando={arrastando} movendo={movendo}
                onDragOver={(e) => { if (arrastando && movimentoValido(arrastando, coluna.id)) { e.preventDefault(); setAlvo(coluna.id); } }}
                onDragLeave={() => setAlvo((a) => (a === coluna.id ? null : a))}
                onDrop={(e) => { e.preventDefault(); soltarEm(coluna.id); }}
                propsCartao={propsCartao} />
            ))}
          </div>

          {totalCartoes === 0 ? (
            <div className="rounded-2xl bg-white p-8 text-center ring-1 ring-slate-200/70">
              <p className="text-[15px] font-medium text-slate-700">Nenhum serviço nesta seleção</p>
              <p className="mt-1 text-[13.5px] text-slate-500">Toque em “Novo serviço” para marcar um atendimento.</p>
            </div>
          ) : null}
        </>
      )}

      {/* O simulador fica depois do trabalho do dia, no mesmo lugar de quem
          organiza, e usa a mesma operação oficial — não é caminho paralelo. */}
      <OperationsCommandSimulator empresaId={empresaId} usuarioAtual={usuarioAtual}
        hoje={hojeISO} aviso={aviso} onExecutado={() => carregar(true)} />

      {escolhendo ? (
        <ModalQuemVaiFazer card={escolhendo} board={board} hoje={hojeISO} agora={agora}
          usuarioAtualId={usuarioAtual?.id}
          onClose={() => setEscolhendo(null)}
          onEscolher={(destinoId, choque) => {
            const c = escolhendo; setEscolhendo(null);
            mover(c, destinoId, { confirmado: choque > 0 });
          }} />
      ) : null}

      {alterando ? (
        <ModalAlterar card={alterando} board={board} hoje={hojeISO}
          usuarioAtualId={usuarioAtual?.id} salvando={movendo === alterando.work_order_id}
          onClose={() => setAlterando(null)}
          onSalvar={(dados) => salvarAlteracao(alterando, dados)} />
      ) : null}

      {criando ? (
        <ModalNovoServico board={board} hoje={hojeISO} clientes={clientes} CampoVoz={CampoVoz}
          usuarioAtualId={usuarioAtual?.id}
          onClose={() => setCriando(false)}
          onCriado={() => { setCriando(false); carregar(true); }}
          salvarOS={salvarOS} salvarCliente={salvarCliente} aviso={aviso} />
      ) : null}

      {confirmacao ? (
        <ModalChoque info={confirmacao}
          onClose={() => setConfirmacao(null)}
          onConfirmar={() => { const c = confirmacao; setConfirmacao(null); mover(c.card, c.destinoId, { confirmado: true }); }} />
      ) : null}
    </>
  );
}

const Cabecalho = ({ hojeISO, acao }) => (
  <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
    <div className="min-w-0">
      <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-slate-900 sm:text-3xl">Serviços</h1>
      <p className="mt-1 text-[15px] text-slate-500">Hoje, {dataLonga(hojeISO)}</p>
    </div>
    {acao ? <div className="shrink-0">{acao}</div> : null}
  </div>
);

/* O dia de uma pessoa. O cabeçalho responde "quem trabalha hoje?" e "qual é o
   próximo?" sem abrir nada. */
function Pessoa({
  coluna, board, hoje, agora, usuarioAtualId, ehAlvo, arrastando, movendo,
  onDragOver, onDragLeave, onDrop, propsCartao,
}) {
  const estado = useMemo(
    () => estadoDoTecnico(board?.cards || [], coluna.id, { hoje, agora }),
    [board, coluna.id, hoje, agora],
  );
  const ehVoce = coluna.id === usuarioAtualId;
  return (
    <section onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
      aria-label={`Serviços de ${coluna.nome}`}
      className={cx('flex flex-col rounded-2xl p-3.5 ring-1 transition-colors',
        ehAlvo ? 'bg-teal-50 ring-2 ring-teal-400' : 'bg-slate-100/70 ring-slate-200/70')}>
      <header className="mb-3 px-0.5">
        <div className="flex items-baseline gap-2">
          <h2 className="min-w-0 truncate text-[15px] font-semibold text-slate-900">{coluna.nome}</h2>
          {ehVoce ? <Pill className="bg-teal-50 text-teal-800 ring-teal-200/70">Você</Pill> : null}
        </div>
        <p className="mt-0.5 text-[13px] text-slate-600">
          {estado.servicosHoje} serviço{estado.servicosHoje === 1 ? '' : 's'} hoje
          <span className="text-slate-400"> · </span>
          <span className={cx(estado.emAtendimento && 'font-medium text-teal-800')}>{estado.texto}</span>
          {coluna.atrasados > 0 ? (
            <span className="font-medium text-rose-700"> · {coluna.atrasados} atrasado{coluna.atrasados === 1 ? '' : 's'}</span>
          ) : null}
        </p>
      </header>

      <div className="flex min-h-[64px] flex-col gap-2">
        {coluna.cartoes.map((card) => (
          <Cartao key={card.work_order_id} card={card} {...propsCartao} movendo={movendo === card.work_order_id} />
        ))}
        {coluna.cartoes.length === 0 ? (
          <p className="px-1 py-5 text-center text-[13px] text-slate-400">
            {arrastando ? 'Solte aqui' : 'Nenhum serviço nesta seleção'}
          </p>
        ) : null}
      </div>
    </section>
  );
}

/* O cartão responde: quem, o quê, quando, onde e quem vai fazer. Nada além. */
function Cartao({
  card, hoje, board, usuarioAtualId, movendo,
  onArrastar, onSoltar, onEscolher, onAlterar, onAbrir,
}) {
  const atrasado = cartaoAtrasado(card, hoje);
  const quem = nomeDoResponsavel(board, card.assignee_id, usuarioAtualId);
  const prioridade = card.priority && card.priority !== 'normal' ? card.priority : null;
  return (
    <article
      draggable={card.status !== 'done' && card.status !== 'canceled'}
      onDragStart={() => onArrastar(card)}
      onDragEnd={onSoltar}
      className={cx('rounded-xl bg-white p-3.5 ring-1', movendo ? 'opacity-60' : '', atrasado ? 'ring-rose-300' : 'ring-slate-200/80')}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="font-mono text-[12px] font-semibold text-slate-500">{card.number}</span>
        <div className="flex items-center gap-1">
          {prioridade ? <Pill className={TOM_PRIORIDADE[prioridade]}>{ROTULO_PRIORIDADE[prioridade]}</Pill> : null}
          {atrasado ? <Pill className="bg-rose-600 text-white ring-rose-600">ATRASADO</Pill> : null}
          {card.status === 'in_progress' ? <Pill className="bg-teal-50 text-teal-800 ring-teal-200/70">Em atendimento</Pill> : null}
        </div>
      </div>

      {/* Quem e o quê: o que o prestador lê primeiro. */}
      <p className="truncate text-[15.5px] font-semibold text-slate-900">{card.client_name}</p>
      {card.summary ? <p className="mt-0.5 line-clamp-2 text-[13.5px] leading-snug text-slate-600">{card.summary}</p> : null}

      {/* Quando. */}
      <p className={cx('mt-2 inline-flex items-center gap-1.5 text-[14px] font-semibold', atrasado ? 'text-rose-700' : 'text-slate-900')}>
        {card.scheduled_time ? <Clock className="h-4 w-4 shrink-0" aria-hidden="true" /> : <CalendarClock className="h-4 w-4 shrink-0" aria-hidden="true" />}
        {textoDoQuando(card, hoje)}
      </p>
      {atrasado ? <p className="mt-0.5 text-[12.5px] font-medium text-rose-700">{textoDoAtraso(card, hoje)}</p> : null}

      {/* Onde. */}
      {card.location_name ? (
        <p className="mt-1.5 flex items-start gap-1.5 text-[13px] text-slate-600">
          <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 break-words">{card.location_name}</span>
        </p>
      ) : null}

      {/* Quem vai fazer: nome quando já tem, ação quando não tem. */}
      {quem ? (
        <p className="mt-1.5 flex items-center gap-1.5 text-[13px] text-slate-600">
          <User className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate font-medium text-slate-800">{quem}</span>
        </p>
      ) : (
        <button type="button" onClick={() => onEscolher(card)} disabled={movendo}
          className={cx('mt-2 flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-amber-100 px-3 text-[13.5px] font-semibold text-amber-900 hover:bg-amber-200 disabled:opacity-50', ring)}>
          {movendo ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <UserPlus className="h-4 w-4" aria-hidden="true" />}
          Escolher quem vai fazer
        </button>
      )}

      {/* Ações principais à vista, nunca atrás de três pontinhos. */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Acao onClick={() => onAbrir?.(card.work_order_id)} icone={ChevronRight}>Abrir serviço</Acao>
        <Acao onClick={() => onAlterar(card)} disabled={movendo}>Alterar</Acao>
        {quem ? (
          <Acao onClick={() => onEscolher(card)} disabled={movendo} icone={UserPlus}>Escolher técnico</Acao>
        ) : null}
      </div>
    </article>
  );
}

/* Folha que sobe no celular e vira caixa no computador. */
function Folha({ titulo, sub, onClose, children, rodape }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label={titulo}>
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="relative flex max-h-[88vh] w-full flex-col rounded-t-3xl bg-white shadow-xl sm:max-h-[85vh] sm:max-w-md sm:rounded-3xl">
        <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-6">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold tracking-tight text-slate-900">{titulo}</h3>
            {sub ? <p className="mt-0.5 truncate text-[13.5px] text-slate-500">{sub}</p> : null}
          </div>
          <button onClick={onClose} aria-label="Fechar"
            className={cx('-mr-1 min-h-11 min-w-11 rounded-xl text-slate-400 hover:bg-slate-100', ring)}>
            <X className="mx-auto h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
        {rodape ? <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">{rodape}</div> : null}
      </div>
    </div>
  );
}

const Campo = ({ label, children, dica }) => (
  <label className="mt-4 block first:mt-0">
    <span className="mb-1.5 block text-[13.5px] font-medium text-slate-700">{label}</span>
    {children}
    {dica ? <span className="mt-1 block text-[12px] text-slate-400">{dica}</span> : null}
  </label>
);

const entrada = cx('min-h-12 w-full rounded-xl bg-white px-3.5 text-[15px] text-slate-800 ring-1 ring-slate-200 placeholder:text-slate-300', ring);

/* "Quem vai fazer?" — uma pessoa por linha, botão grande, sem tabela. */
function ModalQuemVaiFazer({ card, board, hoje, agora, usuarioAtualId, onClose, onEscolher }) {
  const pessoas = useMemo(
    () => pessoasParaEscolher(board, { hoje, agora, usuarioAtualId, card }),
    [board, hoje, agora, usuarioAtualId, card],
  );
  return (
    <Folha titulo="Quem vai fazer?" sub={`${card.number} · ${card.client_name}`} onClose={onClose}>
      <div className="space-y-2">
        {pessoas.map((p) => (
          <button key={p.id} disabled={p.atual} onClick={() => onEscolher(p.id, p.choque)}
            className={cx('flex w-full items-center gap-3 rounded-2xl p-4 text-left ring-1',
              p.atual ? 'bg-slate-50 ring-slate-200 opacity-60' : 'bg-white ring-slate-200 hover:bg-slate-50', ring)}>
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-800">
              <User className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-semibold text-slate-900">{p.nome}</span>
              <span className="block text-[13px] text-slate-500">
                {p.atual ? 'Já é quem vai fazer' : `${p.servicosHoje} serviço${p.servicosHoje === 1 ? '' : 's'} hoje · ${p.estado}`}
              </span>
              {p.choque > 0 && !p.atual ? (
                <span className="mt-1 block text-[12.5px] font-medium text-amber-800">⚠ Já tem serviço neste horário</span>
              ) : null}
            </span>
          </button>
        ))}
        {card.assignee_id ? (
          <button onClick={() => onEscolher(SEM_RESPONSAVEL, 0)}
            className={cx('flex min-h-12 w-full items-center justify-center rounded-2xl bg-white p-4 text-[14px] font-medium text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50', ring)}>
            Deixar sem responsável
          </button>
        ) : null}
      </div>
    </Folha>
  );
}

/* Alterar: quem, dia, hora, prioridade. Nada de abrir a OS inteira. */
function ModalAlterar({ card, board, hoje, usuarioAtualId, salvando, onClose, onSalvar }) {
  const [f, setF] = useState({
    responsavelId: card.assignee_id || '',
    data: String(card.scheduled_date || '').slice(0, 10),
    horario: hora(card.scheduled_time),
    prioridade: card.priority || 'normal',
  });
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  return (
    <Folha titulo="Alterar serviço" sub={`${card.number} · ${card.client_name}`} onClose={onClose}
      rodape={(
        <>
          <Acao onClick={onClose} disabled={salvando}>Cancelar</Acao>
          <Acao tom="destaque" onClick={() => onSalvar(f)} disabled={salvando}>
            {salvando ? 'Salvando…' : 'Salvar'}
          </Acao>
        </>
      )}>
      <Campo label="Quem vai fazer?">
        <select value={f.responsavelId} onChange={(e) => set('responsavelId', e.target.value)} className={entrada}>
          <option value="">Decidir depois</option>
          {(board?.members || []).map((m) => (
            <option key={m.user_id} value={m.user_id}>{m.user_id === usuarioAtualId ? `${m.name} — Você` : m.name}</option>
          ))}
        </select>
      </Campo>
      <Campo label="Qual dia?" dica="Deixe vazio para decidir o dia depois.">
        <input type="date" value={f.data} onChange={(e) => set('data', e.target.value)} className={entrada} />
      </Campo>
      <Campo label="Que horas?">
        <input type="time" value={f.horario} onChange={(e) => set('horario', e.target.value)} className={entrada} />
      </Campo>
      <Campo label="Prioridade">
        <select value={f.prioridade} onChange={(e) => set('prioridade', e.target.value)} className={entrada}>
          {PRIORIDADES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </Campo>
      {f.data && f.data < hoje ? (
        <p className="mt-3 text-[12.5px] text-amber-800">Esse dia já passou: o serviço vai aparecer como atrasado.</p>
      ) : null}
    </Folha>
  );
}

/* Novo serviço: o mínimo para marcar um atendimento agora. Cria uma OS normal
   pelo mesmo caminho da tela de ordens — nenhuma entidade nova. */
function ModalNovoServico({
  board, hoje, clientes, CampoVoz, usuarioAtualId, onClose, onCriado, salvarOS, salvarCliente, aviso,
}) {
  const [f, setF] = useState({
    clienteId: '', descricao: '', data: hoje, horario: '',
    responsavelId: usuarioAtualId || '', local: '', prioridade: 'normal',
  });
  const [novoCliente, setNovoCliente] = useState(null);
  const [salvandoCliente, setSalvandoCliente] = useState(false);
  const [criando, setCriando] = useState(false);
  const [erro, setErro] = useState('');
  const pedido = useRef(null);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const pronto = Boolean(f.clienteId) && f.descricao.trim().length > 0;

  const criarCliente = async () => {
    const nome = String(novoCliente?.nome || '').trim();
    if (!nome || salvandoCliente) return;
    setSalvandoCliente(true);
    try {
      const id = await salvarCliente({
        tipo: 'PF', nome, telefone: novoCliente.telefone || '', whatsapp: novoCliente.telefone || '',
        endereco: '', documento: '', fantasia: '', responsavel: '', obs: '',
      });
      if (id) { set('clienteId', id); setNovoCliente(null); }
    } finally {
      setSalvandoCliente(false);
    }
  };

  const criar = async () => {
    if (!pronto || criando) return;
    setCriando(true);
    setErro('');
    try {
      if (!pedido.current) {
        if (!globalThis.crypto?.randomUUID) throw new Error('Seu navegador precisa ser atualizado para criar o serviço com segurança.');
        pedido.current = globalThis.crypto.randomUUID();
      }
      // Mesma operação da tela de ordens: o resultado é uma OS normal.
      const id = await salvarOS({
        clienteId: f.clienteId,
        descricaoLivre: f.descricao.trim(),
        data: f.data || '',
        hora: f.data ? (f.horario || '') : '',
        local: f.local || '',
        responsavelId: f.responsavelId || null,
        status: f.data ? 'agendada' : 'aguardando',
        itens: [], checklist: [],
        requestId: pedido.current,
      }, { propagarErro: true });
      if (!id) { setErro('Não consegui criar o serviço. Tente de novo.'); return; }

      // Prioridade e "decidir depois" pelas operações oficiais, nunca por UPDATE.
      if (f.prioridade && f.prioridade !== 'normal') {
        try { await definirPrioridadeOSDB(id, f.prioridade, { origem: 'web' }); } catch { /* o serviço já existe; a prioridade pode ser ajustada em Alterar */ }
      }
      if (!f.responsavelId) {
        try { await atribuirOSDB(id, null, { origem: 'web' }); } catch { /* fica com quem criou e aparece em Alterar */ }
      }
      aviso?.('Serviço criado.');
      onCriado();
    } catch (e) {
      setErro(e?.message || 'Não consegui criar o serviço. Tente de novo.');
    } finally {
      setCriando(false);
    }
  };

  const ativos = (clientes || []).filter((c) => !c.excluidoEm);

  return (
    <Folha titulo="Novo serviço" sub="O essencial para marcar o atendimento." onClose={onClose}
      rodape={(
        <>
          <Acao onClick={onClose} disabled={criando}>Cancelar</Acao>
          <Acao tom="destaque" onClick={criar} disabled={!pronto || criando}>
            {criando ? 'Criando…' : 'Criar serviço'}
          </Acao>
        </>
      )}>
      {erro ? <p role="alert" className="mb-3 rounded-xl bg-rose-50 px-3 py-2.5 text-[13.5px] text-rose-800">{erro}</p> : null}

      <Campo label="Cliente">
        <div className="flex flex-wrap gap-2">
          <select value={f.clienteId} onChange={(e) => set('clienteId', e.target.value)}
            className={cx(entrada, 'min-w-[160px] flex-1')}>
            <option value="">Escolha o cliente</option>
            {ativos.map((c) => <option key={c.id} value={c.id}>{c.fantasia || c.nome}</option>)}
          </select>
          <Acao icone={Plus} onClick={() => setNovoCliente({ nome: '', telefone: '' })}>Novo cliente</Acao>
        </div>
      </Campo>

      {novoCliente ? (
        <div className="mt-3 rounded-2xl bg-slate-50 p-3.5 ring-1 ring-slate-200">
          <p className="text-[13.5px] font-medium text-slate-700">Cadastrar cliente</p>
          <input value={novoCliente.nome} onChange={(e) => setNovoCliente((v) => ({ ...v, nome: e.target.value }))}
            placeholder="Nome do cliente" aria-label="Nome do cliente" className={cx(entrada, 'mt-2')} />
          <input value={novoCliente.telefone} onChange={(e) => setNovoCliente((v) => ({ ...v, telefone: e.target.value }))}
            placeholder="Telefone (opcional)" aria-label="Telefone do cliente" className={cx(entrada, 'mt-2')} />
          <div className="mt-3 flex justify-end gap-2">
            <Acao onClick={() => setNovoCliente(null)} disabled={salvandoCliente}>Cancelar</Acao>
            <Acao tom="escuro" onClick={criarCliente} disabled={!String(novoCliente.nome || '').trim() || salvandoCliente}>
              {salvandoCliente ? 'Salvando…' : 'Salvar cliente'}
            </Acao>
          </div>
        </div>
      ) : null}

      <Campo label="O que precisa ser feito?" dica="Escreva com as suas palavras. Escolher serviço do catálogo é opcional e pode ficar para depois.">
        {CampoVoz ? (
          <CampoVoz rows={3} valor={f.descricao} onChange={(v) => set('descricao', v)}
            placeholder="Ex.: portão da garagem abre mas não fecha" />
        ) : (
          <textarea rows={3} value={f.descricao} onChange={(e) => set('descricao', e.target.value)}
            placeholder="Ex.: portão da garagem abre mas não fecha" aria-label="O que precisa ser feito?"
            className={cx(entrada, 'min-h-[88px] py-2.5')} />
        )}
      </Campo>

      <div className="grid grid-cols-2 gap-3">
        <Campo label="Qual dia?">
          <input type="date" value={f.data} onChange={(e) => set('data', e.target.value)} className={entrada} />
        </Campo>
        <Campo label="Que horas?">
          <input type="time" value={f.horario} onChange={(e) => set('horario', e.target.value)} className={entrada} />
        </Campo>
      </div>

      <Campo label="Quem vai fazer?">
        <select value={f.responsavelId} onChange={(e) => set('responsavelId', e.target.value)} className={entrada}>
          <option value="">Decidir depois</option>
          {(board?.members || []).map((m) => (
            <option key={m.user_id} value={m.user_id}>{m.user_id === usuarioAtualId ? `${m.name} — Você` : m.name}</option>
          ))}
        </select>
      </Campo>

      <Campo label="Local" dica="Opcional. Ex.: portaria, apartamento 304, loja 4.">
        <input value={f.local} onChange={(e) => set('local', e.target.value)} placeholder="Onde é o atendimento" className={entrada} />
      </Campo>

      <Campo label="Prioridade">
        <select value={f.prioridade} onChange={(e) => set('prioridade', e.target.value)} className={entrada}>
          {PRIORIDADES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </Campo>
    </Folha>
  );
}

function ModalChoque({ info, onClose, onConfirmar }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label="Já tem serviço neste horário">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="relative w-full rounded-t-3xl bg-white p-6 shadow-xl sm:max-w-md sm:rounded-3xl">
        <div className="mb-3 flex items-center gap-2.5">
          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
          <h3 className="text-lg font-semibold tracking-tight text-slate-900">Já tem serviço neste horário</h3>
        </div>
        <p className="text-[14.5px] leading-relaxed text-slate-600">
          {info.nome} já tem {info.total} serviço{info.total === 1 ? '' : 's'} em {dataBR(info.card.scheduled_date)} às {hora(info.card.scheduled_time)}.
          Você pode continuar e mudar o horário depois.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Acao onClick={onClose}>Cancelar</Acao>
          <Acao tom="destaque" onClick={onConfirmar}>Escolher mesmo assim</Acao>
        </div>
      </div>
    </div>
  );
}
