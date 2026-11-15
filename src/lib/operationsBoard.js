/*
  Central de Operações — regras puras do quadro de despacho.

  Mesma escolha do agendaMobile.js: a decisão fica em função pura, testável sem
  navegador e sem banco. A tela só desenha o que estas funções devolvem.

  O cartão vem de zt_operations_board (migration 0116), já sanitizado no banco:
  não existe campo financeiro aqui, nem é possível derivá-lo.
*/

export const SEM_RESPONSAVEL = '__sem_responsavel__';

export const PRIORIDADES = [
  { id: 'normal', label: 'Normal' },
  { id: 'high', label: 'Alta' },
  { id: 'urgent', label: 'Urgente' },
];
export const PRIORIDADE_LABEL = Object.fromEntries(PRIORIDADES.map((p) => [p.id, p.label]));
const PRIORIDADE_PESO = { urgent: 0, high: 1, normal: 2 };

export const STATUS_LABEL = {
  unscheduled: 'Sem agendamento',
  scheduled: 'Agendada',
  in_progress: 'Em andamento',
  done: 'Concluída',
  canceled: 'Cancelada',
};

export const FILTROS = [
  { id: 'hoje', label: 'Hoje' },
  { id: 'amanha', label: 'Amanhã' },
  { id: 'semana', label: 'Esta semana' },
  { id: 'atrasadas', label: 'Atrasadas' },
  { id: 'semresponsavel', label: 'Sem responsável' },
  { id: 'aguardando', label: 'Aguardando' },
  { id: 'andamento', label: 'Em andamento' },
  { id: 'concluidas', label: 'Concluídas' },
];

// Só "Concluídas" precisa de histórico; os demais olham o que ainda vai acontecer.
export const filtroIncluiConcluidas = (filtro) => filtro === 'concluidas';

const diaISO = (v) => (v ? String(v).slice(0, 10) : '');
export function somarDias(iso, dias) {
  const base = new Date(`${diaISO(iso)}T12:00:00`);
  base.setDate(base.getDate() + Number(dias || 0));
  const y = base.getFullYear();
  const m = String(base.getMonth() + 1).padStart(2, '0');
  const d = String(base.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/* Janela que a tela pede ao banco para cada filtro. "Atrasadas" e "sem
   responsável" dependem de dados fora da semana, então a janela abre mais. */
export function janelaDoFiltro(filtro, hoje) {
  const h = diaISO(hoje);
  if (filtro === 'hoje') return { de: h, ate: h };
  if (filtro === 'amanha') return { de: somarDias(h, 1), ate: somarDias(h, 1) };
  if (filtro === 'semana') return { de: h, ate: somarDias(h, 7) };
  if (filtro === 'concluidas') return { de: somarDias(h, -30), ate: h };
  return { de: h, ate: somarDias(h, 30) };
}

export const cartaoAtrasado = (card, hoje) => Boolean(
  card?.scheduled_date
  && diaISO(card.scheduled_date) < diaISO(hoje)
  && (card.status === 'scheduled' || card.status === 'in_progress'),
);

/* Filtro operacional. Recebe os cartões como vieram do banco. */
export function filtrarCartoes(cards = [], { filtro = 'semana', hoje, tecnicoId = '', clienteId = '', local = '', prioridade = '' } = {}) {
  const h = diaISO(hoje);
  const amanha = somarDias(h, 1);
  const fimSemana = somarDias(h, 7);
  const texto = String(local || '').trim().toLowerCase();

  return (cards || []).filter((card) => {
    if (!card) return false;
    const data = diaISO(card.scheduled_date);

    if (filtro === 'hoje' && data !== h) return false;
    if (filtro === 'amanha' && data !== amanha) return false;
    if (filtro === 'semana' && !(data && data >= h && data <= fimSemana)) return false;
    if (filtro === 'atrasadas' && !cartaoAtrasado(card, h)) return false;
    if (filtro === 'semresponsavel' && card.assignee_id) return false;
    if (filtro === 'aguardando' && card.status !== 'unscheduled') return false;
    if (filtro === 'andamento' && card.status !== 'in_progress') return false;
    if (filtro === 'concluidas' && card.status !== 'done') return false;
    if (filtro !== 'concluidas' && card.status === 'done') return false;

    if (tecnicoId) {
      if (tecnicoId === SEM_RESPONSAVEL) { if (card.assignee_id) return false; }
      else if (card.assignee_id !== tecnicoId) return false;
    }
    if (clienteId && card.client_name !== clienteId) return false;
    if (prioridade && card.priority !== prioridade) return false;
    if (texto && !String(card.location_name || '').toLowerCase().includes(texto)) return false;
    return true;
  });
}

/* Ordem dentro da coluna: urgente primeiro, depois hora, depois número.
   Sem data vai para o fim — é o que ainda precisa de agendamento. */
export function ordenarCartoes(cards = []) {
  return [...(cards || [])].sort((a, b) => {
    const pa = PRIORIDADE_PESO[a?.priority] ?? 2;
    const pb = PRIORIDADE_PESO[b?.priority] ?? 2;
    if (pa !== pb) return pa - pb;
    const da = diaISO(a?.scheduled_date) || '9999-12-31';
    const db = diaISO(b?.scheduled_date) || '9999-12-31';
    if (da !== db) return da.localeCompare(db);
    const ha = String(a?.scheduled_time || '99:99').slice(0, 5);
    const hb = String(b?.scheduled_time || '99:99').slice(0, 5);
    if (ha !== hb) return ha.localeCompare(hb);
    return String(a?.number || '').localeCompare(String(b?.number || ''));
  });
}

/* Colunas do quadro: "Sem responsável" sempre primeiro, depois o proprietário
   (que pode atender) e os técnicos. Técnico sem serviço mantém coluna visível —
   é a informação de que ele está livre. */
export function montarColunas(board, { hoje, ...filtros } = {}) {
  const members = board?.members || [];
  const cards = filtrarCartoes(board?.cards || [], { hoje, ...filtros });
  const porResponsavel = new Map();
  for (const card of cards) {
    const chave = card.assignee_id || SEM_RESPONSAVEL;
    if (!porResponsavel.has(chave)) porResponsavel.set(chave, []);
    porResponsavel.get(chave).push(card);
  }

  const colunas = [{
    id: SEM_RESPONSAVEL,
    nome: 'Sem responsável',
    papel: null,
    cartoes: ordenarCartoes(porResponsavel.get(SEM_RESPONSAVEL) || []),
  }];

  for (const m of members) {
    colunas.push({
      id: m.user_id,
      nome: m.name || 'Colaborador',
      papel: m.role,
      funcao: m.job_title || '',
      cartoes: ordenarCartoes(porResponsavel.get(m.user_id) || []),
    });
  }

  // Responsável que não está mais no elenco ativo não some do quadro.
  for (const [chave, lista] of porResponsavel) {
    if (chave === SEM_RESPONSAVEL) continue;
    if (colunas.some((c) => c.id === chave)) continue;
    colunas.push({ id: chave, nome: 'Colaborador inativo', papel: null, cartoes: ordenarCartoes(lista) });
  }

  return colunas.map((coluna) => ({
    ...coluna,
    carga: coluna.cartoes.length,
    atrasados: coluna.cartoes.filter((c) => cartaoAtrasado(c, hoje)).length,
  }));
}

/* Conflito local: mesma pessoa, mesma data, mesma hora. É só o aviso imediato
   do arraste; a contagem autoritativa vem do banco (0116). */
export function conflitosLocais(cards = [], { cardId, assigneeId, data, hora } = {}) {
  if (!assigneeId || !data || !hora) return 0;
  const d = diaISO(data);
  const h = String(hora).slice(0, 5);
  return (cards || []).filter((c) => (
    c && c.work_order_id !== cardId
    && c.assignee_id === assigneeId
    && diaISO(c.scheduled_date) === d
    && String(c.scheduled_time || '').slice(0, 5) === h
    && (c.status === 'scheduled' || c.status === 'in_progress')
  )).length;
}

/* Movimento permitido? Serve ao drag-and-drop e ao botão Atribuir. */
export function movimentoValido(card, destinoId) {
  if (!card || !destinoId) return false;
  if (card.status === 'done' || card.status === 'canceled') return false;
  const atual = card.assignee_id || SEM_RESPONSAVEL;
  return atual !== destinoId;
}

/* Alvo para a RPC: a coluna "Sem responsável" vira assignee nulo. */
export const destinoParaAssignee = (destinoId) => (destinoId === SEM_RESPONSAVEL ? null : destinoId);

/* Aplica o movimento na cópia local, para a tela responder na hora.
   Se a RPC falhar, a tela volta ao estado anterior com o board original. */
export function aplicarMovimentoLocal(cards = [], cardId, destinoId) {
  const assignee = destinoParaAssignee(destinoId);
  return (cards || []).map((c) => (c && c.work_order_id === cardId ? { ...c, assignee_id: assignee } : c));
}
