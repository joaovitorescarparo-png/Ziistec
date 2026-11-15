import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, CalendarClock, ChevronRight, Clock, Loader2, MapPin,
  RefreshCw, UserPlus, Users, X,
} from 'lucide-react';
import {
  FILTROS, PRIORIDADES, PRIORIDADE_LABEL, SEM_RESPONSAVEL, STATUS_LABEL,
  aplicarMovimentoLocal, cartaoAtrasado, conflitosLocais, destinoParaAssignee,
  montarColunas, movimentoValido,
} from '../lib/operationsBoard';
import {
  atribuirOSDB, carregarQuadroOperacoes, conflitosAgendaDB,
  definirPrioridadeOSDB,
} from '../lib/operationsApi';
import { hojeISO as diaLocalISO } from '../lib/dates';
import OperationsCommandSimulator from './OperationsCommandSimulator';

/*
  Central de Operações — quadro de despacho do proprietário.

  Uma coluna por executor (o proprietário entra como executor; técnico sem
  serviço mantém a coluna, que é a informação de que está livre) e a coluna
  "Sem responsável".

  O arraste NÃO é só visual: ao soltar, a RPC oficial decide. A tela aplica o
  movimento na hora para não travar o despacho, e se o banco recusar ela volta
  ao estado anterior. No celular o arraste não é obrigatório: cada cartão tem
  "Atribuir".

  O cartão vem sanitizado do banco (0116): não há valor, custo nem margem aqui.
*/

const ring = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500';
const cx = (...c) => c.filter(Boolean).join(' ');
const hora = (v) => (v ? String(v).slice(0, 5) : '');
const dataBR = (v) => (v ? new Date(`${String(v).slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR') : '');

const TOM_PRIORIDADE = {
  urgent: 'bg-rose-50 text-rose-800 ring-rose-200/70',
  high: 'bg-amber-50 text-amber-800 ring-amber-200/70',
  normal: 'bg-slate-100 text-slate-600 ring-transparent',
};

function Pill({ children, className }) {
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ring-1', className)}>
      {children}
    </span>
  );
}

export default function OperationsBoard({
  empresaId, usuarioAtual, real, aviso, abrirOS, hoje,
}) {
  // Nunca o corte do toISOString(): esse é o dia em UTC e, no Brasil, vira
  // "amanhã" entre 21h e meia-noite — o quadro mostraria o dia errado à noite.
  const hojeISO = hoje || diaLocalISO();
  const [filtro, setFiltro] = useState('semana');
  const [extras, setExtras] = useState({ tecnicoId: '', prioridade: '', local: '' });
  const [board, setBoard] = useState(null);
  const [erro, setErro] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [movendo, setMovendo] = useState(null);
  const [arrastando, setArrastando] = useState(null);
  const [alvo, setAlvo] = useState(null);
  const [atribuindo, setAtribuindo] = useState(null);
  const [confirmacao, setConfirmacao] = useState(null);
  const vivo = useRef(true);
  useEffect(() => () => { vivo.current = false; }, []);

  const carregar = useCallback(async (silencioso = false) => {
    if (!real || !empresaId) return;
    if (!silencioso) setCarregando(true);
    try {
      const dados = await carregarQuadroOperacoes(empresaId, { filtro, hoje: hojeISO });
      if (vivo.current) { setBoard(dados); setErro(null); }
    } catch (e) {
      if (vivo.current) setErro(e?.message || 'Não consegui carregar a Central de Operações.');
    } finally {
      if (vivo.current && !silencioso) setCarregando(false);
    }
  }, [real, empresaId, filtro, hojeISO]);

  useEffect(() => { carregar(); }, [carregar]);

  const colunas = useMemo(
    () => montarColunas(board, { hoje: hojeISO, ...extras }),
    [board, hojeISO, extras],
  );
  const totalCartoes = useMemo(
    () => colunas.reduce((t, c) => t + c.carga, 0),
    [colunas],
  );

  if (!real) {
    return (
      <>
        <Cabecalho />
        <div className="rounded-2xl bg-white p-6 ring-1 ring-slate-200/70">
          <p className="text-[14px] text-slate-500">
            A Central de Operações distribui as ordens reais da sua empresa. Entre com a sua conta para usá-la.
          </p>
        </div>
      </>
    );
  }

  /* Move de verdade: aplica local, chama a RPC, e volta atrás se o banco recusar. */
  const mover = async (card, destinoId, { confirmado = false } = {}) => {
    if (!movimentoValido(card, destinoId)) return;
    const assignee = destinoParaAssignee(destinoId);

    // Aviso de conflito antes de concluir: quem despacha decide, nada é bloqueado.
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
        const nome = colunas.find((c) => c.id === destinoId)?.nome || 'o responsável';
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
      aviso?.(assignee ? `${card.number} para ${destino}.` : `${card.number} voltou para Sem responsável.`);
      if (Number(r?.conflicts) > 0) aviso?.('Possível conflito de agenda nesse horário.');
      carregar(true);
    } catch (e) {
      if (vivo.current) setBoard(anterior); // estado otimista nunca fica inconsistente
      aviso?.(e?.message || 'Não consegui mover esta ordem de serviço.');
    } finally {
      if (vivo.current) setMovendo(null);
    }
  };

  const mudarPrioridade = async (card, prioridade) => {
    setMovendo(card.work_order_id);
    try {
      await definirPrioridadeOSDB(card.work_order_id, prioridade, { origem: 'web' });
      aviso?.(`${card.number} · prioridade ${PRIORIDADE_LABEL[prioridade]?.toLowerCase() || prioridade}.`);
      carregar(true);
    } catch (e) {
      aviso?.(e?.message || 'Não consegui mudar a prioridade.');
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

  return (
    <>
      <Cabecalho
        acao={(
          <button onClick={() => carregar()} disabled={carregando}
            className={cx('inline-flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-[13px] font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-50', ring)}>
            <RefreshCw className={cx('h-4 w-4', carregando && 'animate-spin')} aria-hidden="true" />
            Atualizar
          </button>
        )}
      />

      <div className="mb-4 -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {FILTROS.map((f) => (
          <button key={f.id} onClick={() => setFiltro(f.id)} aria-pressed={filtro === f.id}
            className={cx('whitespace-nowrap rounded-xl px-3.5 py-2 text-[13px] font-medium transition-colors', ring,
              filtro === f.id ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50')}>
            {f.label}
          </button>
        ))}
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <select value={extras.tecnicoId} onChange={(e) => setExtras((v) => ({ ...v, tecnicoId: e.target.value }))}
          aria-label="Filtrar por responsável"
          className={cx('rounded-xl bg-white px-3 py-2 text-[13px] text-slate-700 ring-1 ring-slate-200', ring)}>
          <option value="">Todos os responsáveis</option>
          <option value={SEM_RESPONSAVEL}>Sem responsável</option>
          {(board?.members || []).map((m) => <option key={m.user_id} value={m.user_id}>{m.name}</option>)}
        </select>
        <select value={extras.prioridade} onChange={(e) => setExtras((v) => ({ ...v, prioridade: e.target.value }))}
          aria-label="Filtrar por prioridade"
          className={cx('rounded-xl bg-white px-3 py-2 text-[13px] text-slate-700 ring-1 ring-slate-200', ring)}>
          <option value="">Qualquer prioridade</option>
          {PRIORIDADES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        <input value={extras.local} onChange={(e) => setExtras((v) => ({ ...v, local: e.target.value }))}
          placeholder="Filtrar por local" aria-label="Filtrar por local"
          className={cx('min-w-[160px] flex-1 rounded-xl bg-white px-3 py-2 text-[13px] text-slate-700 ring-1 ring-slate-200 placeholder:text-slate-300', ring)} />
        <span className="text-[12px] text-slate-400">{totalCartoes} serviço(s)</span>
      </div>

      {erro ? (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl bg-white p-5 ring-1 ring-slate-200/70">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
          <span className="min-w-0 flex-1 text-[14px] text-slate-600">{erro}</span>
          <button onClick={() => carregar()} className={cx('rounded-xl bg-white px-3 py-2 text-[13px] font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50', ring)}>
            Tentar de novo
          </button>
        </div>
      ) : null}

      {!board && carregando ? (
        <div className="rounded-2xl bg-white p-6 text-[14px] text-slate-400 ring-1 ring-slate-200/70">Carregando…</div>
      ) : (
        <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-4">
          {colunas.map((coluna) => (
            <Coluna key={coluna.id} coluna={coluna} hoje={hojeISO}
              ehAlvo={alvo === coluna.id} arrastando={arrastando} movendo={movendo}
              onDragOver={(e) => { if (arrastando && movimentoValido(arrastando, coluna.id)) { e.preventDefault(); setAlvo(coluna.id); } }}
              onDragLeave={() => setAlvo((a) => (a === coluna.id ? null : a))}
              onDrop={(e) => { e.preventDefault(); soltarEm(coluna.id); }}
              onArrastarCartao={setArrastando}
              onSoltarCartao={() => { setArrastando(null); setAlvo(null); }}
              onAtribuir={setAtribuindo}
              onAbrir={abrirOS}
              onPrioridade={mudarPrioridade} />
          ))}
        </div>
      )}

      {/* O simulador fica aqui, no mesmo lugar de quem despacha, e usa a mesma
          operação oficial — não é um caminho paralelo. */}
      <OperationsCommandSimulator empresaId={empresaId} usuarioAtual={usuarioAtual}
        hoje={hojeISO} aviso={aviso} onExecutado={() => carregar(true)} />

      {atribuindo ? (
        <ModalAtribuir card={atribuindo} colunas={colunas} usuarioAtual={usuarioAtual}
          onClose={() => setAtribuindo(null)}
          onEscolher={(destinoId) => { const c = atribuindo; setAtribuindo(null); mover(c, destinoId); }} />
      ) : null}

      {confirmacao ? (
        <ModalConflito info={confirmacao}
          onClose={() => setConfirmacao(null)}
          onConfirmar={() => { const c = confirmacao; setConfirmacao(null); mover(c.card, c.destinoId, { confirmado: true }); }} />
      ) : null}
    </>
  );
}

const Cabecalho = ({ acao }) => (
  <div className="mb-5 flex items-start justify-between gap-4">
    <div className="min-w-0">
      <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-slate-900 sm:text-3xl">Central de Operações</h1>
      <p className="mt-1.5 text-[15px] text-slate-500">Distribua os serviços entre a equipe e acompanhe a carga do dia.</p>
    </div>
    {acao ? <div className="shrink-0">{acao}</div> : null}
  </div>
);

function Coluna({
  coluna, hoje, ehAlvo, arrastando, movendo,
  onDragOver, onDragLeave, onDrop, onArrastarCartao, onSoltarCartao, onAtribuir, onAbrir, onPrioridade,
}) {
  const semResponsavel = coluna.id === SEM_RESPONSAVEL;
  return (
    <section
      onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
      aria-label={`Coluna ${coluna.nome}`}
      className={cx('flex w-[272px] shrink-0 flex-col rounded-2xl p-3 transition-colors sm:w-[300px]',
        ehAlvo ? 'bg-teal-50 ring-2 ring-teal-400' : semResponsavel ? 'bg-amber-50/60 ring-1 ring-amber-200/60' : 'bg-slate-100/70 ring-1 ring-slate-200/70')}>
      <header className="mb-2.5 flex items-baseline justify-between gap-2 px-1">
        <div className="min-w-0">
          <p className="truncate text-[14px] font-semibold text-slate-800">{coluna.nome}</p>
          <p className="text-[12px] text-slate-500">
            {coluna.carga} serviço{coluna.carga === 1 ? '' : 's'}
            {coluna.atrasados > 0 ? <span className="text-rose-700"> · {coluna.atrasados} atrasado{coluna.atrasados === 1 ? '' : 's'}</span> : null}
          </p>
        </div>
        {coluna.papel === 'owner' ? <Pill className="bg-teal-50 text-teal-800 ring-teal-200/70">Você</Pill> : null}
      </header>

      <div className="flex min-h-[72px] flex-col gap-2">
        {coluna.cartoes.map((card) => (
          <Cartao key={card.work_order_id} card={card} hoje={hoje}
            movendo={movendo === card.work_order_id}
            onArrastar={onArrastarCartao} onSoltar={onSoltarCartao}
            onAtribuir={onAtribuir} onAbrir={onAbrir} onPrioridade={onPrioridade} />
        ))}
        {coluna.cartoes.length === 0 ? (
          <p className="px-1 py-6 text-center text-[12.5px] text-slate-400">
            {arrastando ? 'Solte aqui' : semResponsavel ? 'Nada aguardando distribuição' : 'Sem serviço nesta seleção'}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function Cartao({ card, hoje, movendo, onArrastar, onSoltar, onAtribuir, onAbrir, onPrioridade }) {
  const atrasado = cartaoAtrasado(card, hoje);
  return (
    <article
      draggable={card.status !== 'done' && card.status !== 'canceled'}
      onDragStart={() => onArrastar(card)}
      onDragEnd={onSoltar}
      className={cx('rounded-xl bg-white p-3 ring-1 transition-shadow',
        movendo ? 'opacity-60' : 'hover:shadow-sm',
        atrasado ? 'ring-rose-200' : 'ring-slate-200/80')}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="font-mono text-[12px] font-semibold text-slate-500">{card.number}</span>
        <div className="flex items-center gap-1">
          {card.priority && card.priority !== 'normal'
            ? <Pill className={TOM_PRIORIDADE[card.priority]}>{PRIORIDADE_LABEL[card.priority]}</Pill>
            : null}
          {atrasado ? <Pill className="bg-rose-50 text-rose-800 ring-rose-200/70">Atrasada</Pill> : null}
        </div>
      </div>

      <p className="truncate text-[14.5px] font-medium text-slate-900">{card.client_name}</p>
      {card.location_name ? (
        <p className="mt-0.5 flex items-center gap-1 truncate text-[12.5px] text-slate-500">
          <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{card.location_name}</span>
        </p>
      ) : null}
      {card.summary ? <p className="mt-1 line-clamp-2 text-[12.5px] leading-snug text-slate-500">{card.summary}</p> : null}

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className={cx('inline-flex items-center gap-1 text-[13px] font-semibold', atrasado ? 'text-rose-700' : 'text-slate-800')}>
          {card.scheduled_time ? <Clock className="h-3.5 w-3.5" aria-hidden="true" /> : <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />}
          {card.scheduled_date
            ? `${dataBR(card.scheduled_date)}${card.scheduled_time ? ` · ${hora(card.scheduled_time)}` : ''}`
            : 'Sem data'}
        </span>
        <span className="text-[12px] text-slate-400">{STATUS_LABEL[card.status] || card.status}</span>
      </div>

      <div className="mt-2.5 flex items-center gap-1.5">
        {/* No celular o arraste não é obrigatório: este botão é o caminho principal. */}
        <button onClick={() => onAtribuir(card)} disabled={movendo}
          className={cx('inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-2.5 py-1.5 text-[12px] font-medium text-white hover:bg-slate-800 disabled:opacity-50', ring)}>
          {movendo ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />}
          Atribuir
        </button>
        <select value={card.priority || 'normal'} onChange={(e) => onPrioridade(card, e.target.value)}
          aria-label={`Prioridade da ${card.number}`} disabled={movendo}
          className={cx('rounded-lg bg-white px-2 py-1.5 text-[12px] text-slate-600 ring-1 ring-slate-200 disabled:opacity-50', ring)}>
          {PRIORIDADES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        <button onClick={() => onAbrir?.(card.work_order_id)}
          className={cx('ml-auto inline-flex items-center gap-0.5 rounded-lg px-2 py-1.5 text-[12px] font-medium text-teal-800 hover:bg-teal-50', ring)}>
          Abrir <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    </article>
  );
}

function ModalAtribuir({ card, colunas, usuarioAtual, onClose, onEscolher }) {
  const atual = card.assignee_id || SEM_RESPONSAVEL;
  const opcoes = colunas.filter((c) => c.cartoes || true);
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label="Atribuir ordem de serviço">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="relative flex max-h-[85vh] w-full flex-col rounded-t-3xl bg-white shadow-xl sm:max-h-[80vh] sm:max-w-sm sm:rounded-3xl">
        <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-6">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold tracking-tight text-slate-900">Atribuir {card.number}</h3>
            <p className="mt-0.5 truncate text-[13.5px] text-slate-500">{card.client_name}</p>
          </div>
          <button onClick={onClose} aria-label="Fechar" className={cx('-mr-1 rounded-lg p-2 text-slate-400 hover:bg-slate-100', ring)}>
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <div className="space-y-2 overflow-y-auto px-5 pb-6">
          {opcoes.map((c) => {
            const ehAtual = c.id === atual;
            const euMesmo = c.id === usuarioAtual?.id;
            return (
              <button key={c.id} disabled={ehAtual} onClick={() => onEscolher(c.id)}
                className={cx('flex w-full items-center gap-3 rounded-xl p-3.5 text-left ring-1 transition-colors',
                  ehAtual ? 'bg-slate-50 ring-slate-200 opacity-60' : 'bg-white ring-slate-200 hover:bg-slate-50', ring)}>
                <span className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
                  c.id === SEM_RESPONSAVEL ? 'bg-amber-50 text-amber-700' : 'bg-teal-50 text-teal-800')}>
                  <Users className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14.5px] font-medium text-slate-900">
                    {euMesmo ? 'Eu' : c.nome}
                  </span>
                  <span className="block text-[12px] text-slate-500">
                    {ehAtual ? 'Responsável atual' : `${c.carga} serviço${c.carga === 1 ? '' : 's'}`}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ModalConflito({ info, onClose, onConfirmar }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label="Possível conflito de agenda">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="relative w-full rounded-t-3xl bg-white p-6 shadow-xl sm:max-w-md sm:rounded-3xl">
        <div className="mb-3 flex items-center gap-2.5">
          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
          <h3 className="text-lg font-semibold tracking-tight text-slate-900">Possível conflito de agenda</h3>
        </div>
        <p className="text-[14.5px] leading-relaxed text-slate-600">
          {info.nome} já tem {info.total} serviço{info.total === 1 ? '' : 's'} em {dataBR(info.card.scheduled_date)} às {hora(info.card.scheduled_time)}.
          Você pode confirmar e ajustar o horário depois.
        </p>
        <div className="mt-5 flex justify-end gap-3">
          <button onClick={onClose} className={cx('rounded-xl px-4 py-2.5 text-[14px] font-medium text-slate-600 hover:bg-slate-100', ring)}>
            Cancelar
          </button>
          <button onClick={onConfirmar} className={cx('rounded-xl bg-teal-700 px-4 py-2.5 text-[14px] font-medium text-white hover:bg-teal-800', ring)}>
            Atribuir mesmo assim
          </button>
        </div>
      </div>
    </div>
  );
}
