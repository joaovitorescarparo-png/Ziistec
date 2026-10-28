import { buildDeterministicReport } from './workOrderReport.js';

// Field Execution Intelligence V1 — regras puras do atendimento em campo (sem React e sem rede).
// Tudo aqui é derivado de dados que já existem na OS; nada é gravado e nenhum relógio roda no banco.

/* ------------------------------------------------------------------ tempo de atendimento */
// started_at/completed_at vêm do banco (0101). A duração é sempre calculada na tela, a partir desses carimbos.
export const STALE_ATTENDANCE_HOURS = 12;
export const STALE_ATTENDANCE_MESSAGE = 'Este atendimento está em andamento há bastante tempo. Confira se ele ainda está aberto.';

const toTime = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const time = typeof value === 'number' ? value : value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(time) ? time : null;
};

export function elapsedMs(startedAt, now = Date.now()) {
  const start = toTime(startedAt);
  const end = toTime(now);
  if (start === null || end === null) return null;
  return Math.max(end - start, 0);
}

export function formatElapsed(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'menos de 1min';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 1) return `${minutes}min`;
  return `${hours}h ${String(rest).padStart(2, '0')}min`;
}

export function attendanceTimerLabel(startedAt, now = Date.now()) {
  const ms = elapsedMs(startedAt, now);
  return ms === null ? 'Em atendimento' : `Em atendimento · ${formatElapsed(ms)}`;
}

// Só avisa: nunca fecha a OS nem mexe em carimbo. Sem started_at (banco sem 0101) não há como saber, então não avisa.
export function isStaleAttendance(startedAt, now = Date.now(), hours = STALE_ATTENDANCE_HOURS) {
  const ms = elapsedMs(startedAt, now);
  return ms !== null && ms >= hours * 3600000;
}

/* ------------------------------------------------------------------ painel do técnico (Meu dia) */
const onlyOpen = (os) => os && os.status !== 'concluida' && os.status !== 'cancelada';
const rankDay = (os) => (os.status === 'andamento' ? 0 : os.hora ? 1 : 2);
// Vazio vai para o fim: texto com valor sempre vem antes de texto vazio.
const compareEmptyLast = (a, b) => (a ? (b ? String(a).localeCompare(String(b)) : -1) : (b ? 1 : 0));

// 1 em andamento · 2 horário marcado · 3 demais atribuídas. Sem otimização de rota; não altera o array recebido.
export function sortTechnicianDay(orders) {
  return (orders || []).filter(onlyOpen).slice().sort((a, b) => {
    const byRank = rankDay(a) - rankDay(b);
    if (byRank) return byRank;
    return compareEmptyLast(a.hora, b.hora)
      || compareEmptyLast(a.data, b.data)
      || String(a.numero || '').localeCompare(String(b.numero || ''));
  });
}

// Prioridade da OS não existe no produto: nada é inventado aqui (decisão registrada em FIELD_EXECUTION_INTELLIGENCE.md).
export function attendanceCta(os) {
  if (!os) return null;
  if (os.status === 'andamento') return { kind: 'continue', label: 'Continuar atendimento' };
  if (os.status === 'agendada') return { kind: 'start', label: 'Iniciar atendimento' };
  return null;
}

export function telefoneHref(raw) {
  const digits = String(raw || '').replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
  return digits.replace(/\D/g, '').length >= 8 ? `tel:${digits}` : null;
}

// Modelo do cartão do técnico. Nunca carrega valores financeiros: só o que ajuda a chegar e executar.
export function technicianCardModel(os, { clienteNome = '', telefone = '', resumo = '' } = {}) {
  return {
    id: os.id,
    numero: os.numero || '',
    cliente: clienteNome || 'Cliente',
    local: os.localServico || '',
    status: os.status,
    hora: os.hora || '',
    endereco: os.local || '',
    telefone: telefone || '',
    telefoneHref: telefoneHref(telefone),
    resumo: resumo || os.descricaoLivre || '',
    cta: attendanceCta(os),
    emAndamento: os.status === 'andamento',
    iniciadaEm: os.iniciadaEm || null,
  };
}

/* ------------------------------------------------------------------ Base Técnica (interna) */
export const TECHNICAL_BASE_MAX = 3000;
export const DIFFICULTY_OPTIONS = [
  { value: 'easy', label: 'Fácil' },
  { value: 'medium', label: 'Média' },
  { value: 'hard', label: 'Difícil' },
];
export const difficultyLabel = (value) => DIFFICULTY_OPTIONS.find((option) => option.value === value)?.label || '';

export const emptyTechnicalBase = () => ({ cause: '', solution: '', difficulty: '', learning: '' });

export function technicalBaseFromRow(row) {
  if (!row || typeof row !== 'object') return emptyTechnicalBase();
  return {
    cause: String(row.cause || ''),
    solution: String(row.solution || ''),
    difficulty: DIFFICULTY_OPTIONS.some((option) => option.value === row.difficulty) ? row.difficulty : '',
    learning: String(row.learning || ''),
  };
}

export function normalizeTechnicalBase(base) {
  const source = base || {};
  return {
    cause: String(source.cause || '').trim(),
    solution: String(source.solution || '').trim(),
    difficulty: DIFFICULTY_OPTIONS.some((option) => option.value === source.difficulty) ? source.difficulty : '',
    learning: String(source.learning || '').trim(),
  };
}

export const technicalBaseHasContent = (base) => {
  const normalized = normalizeTechnicalBase(base);
  return Boolean(normalized.cause || normalized.solution || normalized.difficulty || normalized.learning);
};

export const technicalBaseChanged = (a, b) => JSON.stringify(normalizeTechnicalBase(a)) !== JSON.stringify(normalizeTechnicalBase(b));

export const technicalBaseTooLong = (base) => {
  const source = base || {};
  return ['cause', 'solution', 'learning'].some((key) => String(source[key] || '').trim().length > TECHNICAL_BASE_MAX);
};

/* ------------------------------------------------------------------ confirmação de quem recebeu */
export function normalizeConfirmation({ name = '', absent = false } = {}) {
  if (absent) return { ok: true, name: '', absent: true };
  const clean = String(name || '').trim().replace(/\s+/g, ' ');
  if (clean.length < 2) return { ok: false, name: clean, absent: false, error: 'Informe o nome de quem recebeu o serviço ou marque “Responsável ausente”.' };
  if (clean.length > 120) return { ok: false, name: clean, absent: false, error: 'O nome pode ter no máximo 120 caracteres.' };
  return { ok: true, name: clean, absent: false };
}

export const confirmationFromRow = (row) => (row && typeof row === 'object'
  ? { name: String(row.received_by_name || ''), absent: Boolean(row.receiver_absent) }
  : { name: '', absent: false });

/* ------------------------------------------------------------------ ditado */
// O texto ditado só acrescenta ao que já está no campo. Resultado vazio ou erro nunca apaga nem troca o conteúdo.
export function mergeDictation(baseText, transcript) {
  const base = String(baseText || '');
  const heard = String(transcript || '');
  if (!heard.trim()) return base;
  return (base + heard).trimEnd();
}

/* ------------------------------------------------------------------ identificadores de operação */
export function newRequestId() {
  const cryptoApi = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  const hex = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${'89ab'[Math.floor(Math.random() * 4)]}${hex(3)}-${hex(12)}`;
}

// Mesmo conteúdo = mesmo identificador (retry seguro, o banco devolve a mesma linha). Conteúdo novo = identificador novo.
export function createContentRequestIds(makeId = newRequestId) {
  let lastKey = null;
  let lastId = null;
  return {
    idFor(content) {
      const key = JSON.stringify(content);
      if (key !== lastKey || !lastId) { lastKey = key; lastId = makeId(); }
      return lastId;
    },
  };
}

// Falha de rede mantém o identificador (o servidor devolve a geração já feita); resposta do servidor troca por um novo.
export function createReportRequestIds(makeId = newRequestId) {
  let current = null;
  return {
    current() { if (!current) current = makeId(); return current; },
    settle() { current = null; },
  };
}

/* ------------------------------------------------------------------ banco sem 0111 (frontend vem antes das migrations) */
const MISSING_CODES = new Set(['PGRST202', 'PGRST205', '42883', '42P01']);
export const isFeatureUnavailable = (error) => Boolean(error) && (MISSING_CODES.has(error.code) || error.status === 404 || error.statusCode === 404);

/* ------------------------------------------------------------------ relatório do cliente */
export const REPORT_PROVENANCE_LABEL = 'Gerado com auxílio de IA';
export const REPORT_AI_LIMIT_FALLBACK = 3;

const norm = (text) => String(text || '').replace(/\s+/g, ' ').trim();

// Origem do texto que o técnico está prestes a salvar: manual, gerado pela IA ou gerado e depois editado.
export function reportProvenance({ source = null, generatedText = '', finalText = '' } = {}) {
  if (source !== 'ai' || !norm(generatedText)) return { origin: 'manual', label: '', edited: false };
  const edited = norm(generatedText) !== norm(finalText);
  return { origin: edited ? 'ai_edited' : 'ai', label: edited ? `${REPORT_PROVENANCE_LABEL} · editado` : REPORT_PROVENANCE_LABEL, edited };
}

export const REPORT_FALLBACK_MESSAGES = {
  ai_disabled: 'A IA não está habilitada neste ambiente. Montamos um texto padrão com os fatos confirmados da OS.',
  ai_not_configured: 'A IA não está habilitada neste ambiente. Montamos um texto padrão com os fatos confirmados da OS.',
  quota: 'O limite de uso de IA foi atingido por agora. Montamos um texto padrão com os fatos confirmados da OS.',
  limit_reached: 'Este atendimento já usou as 3 gerações com IA. Montamos um texto padrão com os fatos confirmados da OS.',
  provider_error: 'A IA não respondeu agora. Montamos um texto padrão com os fatos confirmados da OS.',
  unsafe_output: 'A IA devolveu algo que não bate com os fatos da OS. Montamos um texto padrão com os fatos confirmados.',
  network: 'Sem conexão para gerar com IA. Seu texto continua salvo; você pode tentar de novo ou escrever à mão.',
};
export const reportFallbackMessage = (reason) => REPORT_FALLBACK_MESSAGES[reason] || REPORT_FALLBACK_MESSAGES.provider_error;

export const reportUsageLabel = (usage) => {
  const limit = Number(usage?.limit) || REPORT_AI_LIMIT_FALLBACK;
  const remaining = Math.max(Number(usage?.remaining ?? limit - (Number(usage?.used) || 0)), 0);
  return remaining === 0 ? `Gerações com IA usadas: ${limit} de ${limit}` : `${remaining} de ${limit} gerações com IA restantes`;
};

export function evidenceCountLabel(count) {
  const n = Math.max(Number(count) || 0, 0);
  if (n === 0) return 'Nenhuma evidência anexada';
  return n === 1 ? '1 evidência anexada' : `${n} evidências anexadas`;
}

// Fatos montados no aparelho para o texto padrão (sem IA e sem rede). Mesma forma que o banco devolve ao servidor,
// mas só com o que a tela já tem: serviços e produtos da OS, os materiais escolhidos no fechamento e a Base Técnica.
export function buildLocalReportFacts(os, { base = null, extraMaterials = [], returnNeeded = false, returnReason = '' } = {}) {
  const items = Array.isArray(os?.itens) ? os.itens : [];
  const services = items.filter((item) => item?.tipo === 'servico').map((item) => item.nome);
  const materials = [...items.filter((item) => item?.tipo === 'produto'), ...(extraMaterials || [])]
    .map((item) => ({ name: item?.nome, quantity: item?.qtd }));
  const clean = normalizeTechnicalBase(base);
  return {
    workOrderNumber: os?.numero || '',
    serviceRequested: os?.descricaoLivre || services.join('; '),
    services,
    cause: clean.cause,
    solution: clean.solution,
    materials,
    returnNeeded: Boolean(returnNeeded),
    returnReason: returnNeeded ? String(returnReason || '') : '',
  };
}

export const buildStandardReportText = (os, options) => buildDeterministicReport(buildLocalReportFacts(os, options));
