import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attendanceCta, attendanceTimerLabel, buildLocalReportFacts, buildStandardReportText, confirmationFromRow, createContentRequestIds,
  createReportRequestIds, DIFFICULTY_OPTIONS, difficultyLabel, elapsedMs, emptyTechnicalBase, evidenceCountLabel, formatElapsed,
  isFeatureUnavailable, isStaleAttendance, mergeDictation, normalizeConfirmation, normalizeTechnicalBase, REPORT_PROVENANCE_LABEL,
  reportFallbackMessage, reportProvenance, reportUsageLabel, sortTechnicianDay, STALE_ATTENDANCE_HOURS, STALE_ATTENDANCE_MESSAGE,
  technicalBaseChanged, technicalBaseFromRow, technicalBaseHasContent, technicalBaseTooLong, technicianCardModel, telefoneHref,
  TECHNICAL_BASE_MAX,
} from '../../src/lib/fieldExecution.js';

const T0 = '2026-10-28T10:00:00.000Z';
const at = (minutes) => new Date(Date.parse(T0) + minutes * 60000);

test('tempo de atendimento: duração é derivada dos carimbos, sem contador no banco', () => {
  assert.equal(elapsedMs(T0, at(84)), 84 * 60000);
  assert.equal(attendanceTimerLabel(T0, at(84)), 'Em atendimento · 1h 24min');
  assert.equal(attendanceTimerLabel(T0, at(35)), 'Em atendimento · 35min');
  assert.equal(attendanceTimerLabel(T0, at(60)), 'Em atendimento · 1h 00min');
  assert.equal(attendanceTimerLabel(T0, at(0)), 'Em atendimento · menos de 1min');
  assert.equal(formatElapsed(5 * 3600000 + 7 * 60000), '5h 07min');
  // Relógio do aparelho atrás do servidor nunca vira duração negativa.
  assert.equal(elapsedMs(T0, at(-5)), 0);
  // A tela passa Date.now() (número), não Date: os dois formatos valem.
  assert.equal(attendanceTimerLabel(T0, Date.parse(T0) + 84 * 60000), 'Em atendimento · 1h 24min');
  assert.equal(elapsedMs(new Date(Date.parse(T0)), Date.parse(T0) + 1000), 1000);
  // Banco sem a 0101 (ou carimbo inválido): sem número inventado.
  assert.equal(attendanceTimerLabel(null, at(10)), 'Em atendimento');
  assert.equal(attendanceTimerLabel('não é data', at(10)), 'Em atendimento');
  assert.equal(elapsedMs(undefined, at(10)), null);
});

test('atendimento esquecido: só avisa, nunca fecha nem altera carimbos', () => {
  assert.equal(STALE_ATTENDANCE_MESSAGE, 'Este atendimento está em andamento há bastante tempo. Confira se ele ainda está aberto.');
  assert.equal(isStaleAttendance(T0, at(STALE_ATTENDANCE_HOURS * 60 - 1)), false);
  assert.equal(isStaleAttendance(T0, at(STALE_ATTENDANCE_HOURS * 60)), true);
  assert.equal(isStaleAttendance(null, at(9999)), false, 'sem started_at não há como saber: não avisa');
  const os = Object.freeze({ id: 'os-1', status: 'andamento', iniciadaEm: T0, concluidaEm: '' });
  const antes = JSON.stringify(os);
  isStaleAttendance(os.iniciadaEm, at(9999));
  attendanceTimerLabel(os.iniciadaEm, at(9999));
  assert.equal(JSON.stringify(os), antes, 'funções puras: a OS não é tocada');
  assert.equal(os.status, 'andamento');
});

test('Meu dia: 1 em andamento, 2 horário marcado, 3 demais atribuídas; concluídas e canceladas ficam fora', () => {
  const ordens = Object.freeze([
    { id: 'sem-hora', status: 'agendada', hora: '', data: '2026-10-28', numero: 'OS-0005' },
    { id: 'tarde', status: 'agendada', hora: '15:00', data: '2026-10-28', numero: 'OS-0003' },
    { id: 'andamento-tarde', status: 'andamento', hora: '16:00', data: '2026-10-28', numero: 'OS-0001' },
    { id: 'manha', status: 'agendada', hora: '08:30', data: '2026-10-28', numero: 'OS-0004' },
    { id: 'pronta', status: 'concluida', hora: '07:00', data: '2026-10-28', numero: 'OS-0002' },
    { id: 'cancelada', status: 'cancelada', hora: '07:10', data: '2026-10-28', numero: 'OS-0006' },
    { id: 'sem-hora-b', status: 'aguardando', hora: '', data: '2026-10-29', numero: 'OS-0007' },
  ]);
  assert.deepEqual(sortTechnicianDay(ordens).map((o) => o.id), ['andamento-tarde', 'manha', 'tarde', 'sem-hora', 'sem-hora-b']);
  assert.equal(ordens.length, 7, 'não altera o array recebido');
  assert.deepEqual(sortTechnicianDay(null), []);
});

test('CTA do cartão: iniciar quando não começou, continuar quando em andamento, nada quando encerrada', () => {
  assert.deepEqual(attendanceCta({ status: 'agendada' }), { kind: 'start', label: 'Iniciar atendimento' });
  assert.deepEqual(attendanceCta({ status: 'andamento' }), { kind: 'continue', label: 'Continuar atendimento' });
  assert.equal(attendanceCta({ status: 'concluida' }), null);
  assert.equal(attendanceCta({ status: 'cancelada' }), null);
  assert.equal(attendanceCta(null), null);
});

test('cartão do técnico: tem o que ajuda a executar e nenhum valor financeiro nem prioridade inventada', () => {
  const os = {
    id: 'os-1', numero: 'OS-0009', status: 'agendada', hora: '09:30', local: 'Rua das Flores, 100', localServico: 'Portaria',
    descricaoLivre: 'Trocar fechadura', iniciadaEm: null,
    itens: [{ nome: 'Fechadura', preco: 450, custo: 210, qtd: 1 }], custosExtras: 30, cobrancaId: 'c1', prioridade: 'alta',
  };
  const modelo = technicianCardModel(os, { clienteNome: 'Condomínio Aurora', telefone: '(11) 98888-7777', resumo: 'Trocar fechadura' });
  assert.deepEqual(Object.keys(modelo).sort(), ['cliente', 'cta', 'emAndamento', 'endereco', 'hora', 'id', 'iniciadaEm', 'local', 'numero', 'resumo', 'status', 'telefone', 'telefoneHref'].sort());
  assert.equal(modelo.telefoneHref, 'tel:11988887777');
  assert.equal(modelo.cta.label, 'Iniciar atendimento');
  const texto = JSON.stringify(modelo);
  assert.doesNotMatch(texto, /450|210|custo|preco|valor|cobranca|prioridade/i);
  assert.equal(telefoneHref('12'), null);
  assert.equal(telefoneHref('+55 (11) 3333-4444'), 'tel:+551133334444');
});

test('Base Técnica: campos fixos, dificuldade interna e limites iguais aos do banco', () => {
  assert.deepEqual(DIFFICULTY_OPTIONS.map((o) => [o.value, o.label]), [['easy', 'Fácil'], ['medium', 'Média'], ['hard', 'Difícil']]);
  assert.equal(difficultyLabel('hard'), 'Difícil');
  assert.equal(difficultyLabel('impossible'), '');
  assert.deepEqual(emptyTechnicalBase(), { cause: '', solution: '', difficulty: '', learning: '' });
  assert.deepEqual(normalizeTechnicalBase({ cause: '  fonte queimada ', solution: 'x', difficulty: 'IMPOSSIVEL', learning: ' ', extra: 'ignorado', needsReturn: true }),
    { cause: 'fonte queimada', solution: 'x', difficulty: '', learning: '' });
  assert.deepEqual(Object.keys(normalizeTechnicalBase({})), ['cause', 'solution', 'difficulty', 'learning'], 'sem segundo boolean de retorno: needs_return segue sendo o da OS');
  assert.deepEqual(technicalBaseFromRow({ cause: 'a', solution: null, difficulty: 'medium', learning: 'c', revision: 3 }), { cause: 'a', solution: '', difficulty: 'medium', learning: 'c' });
  assert.deepEqual(technicalBaseFromRow(null), emptyTechnicalBase());
  assert.equal(technicalBaseHasContent(emptyTechnicalBase()), false);
  assert.equal(technicalBaseHasContent({ ...emptyTechnicalBase(), difficulty: 'easy' }), true);
  assert.equal(technicalBaseChanged({ cause: 'a ' }, { cause: 'a' }), false, 'espaços nas pontas não contam como alteração');
  assert.equal(technicalBaseChanged({ cause: 'a' }, { cause: 'b' }), true);
  assert.equal(TECHNICAL_BASE_MAX, 3000);
  assert.equal(technicalBaseTooLong({ cause: 'x'.repeat(3001) }), true);
  assert.equal(technicalBaseTooLong({ cause: 'x'.repeat(3000), solution: 'y' }), false);
});

test('confirmação de recebimento: nome (2 a 120) ou responsável ausente', () => {
  assert.deepEqual(normalizeConfirmation({ name: '  Maria   Souza ', absent: false }), { ok: true, name: 'Maria Souza', absent: false });
  assert.deepEqual(normalizeConfirmation({ name: 'qualquer coisa', absent: true }), { ok: true, name: '', absent: true });
  assert.equal(normalizeConfirmation({ name: '', absent: false }).ok, false);
  assert.equal(normalizeConfirmation({ name: 'A', absent: false }).ok, false);
  assert.equal(normalizeConfirmation({ name: 'x'.repeat(121), absent: false }).ok, false);
  assert.match(normalizeConfirmation({}).error, /Responsável ausente/);
  assert.deepEqual(confirmationFromRow({ received_by_name: 'João', receiver_absent: false }), { name: 'João', absent: false });
  assert.deepEqual(confirmationFromRow(null), { name: '', absent: false });
});

test('ditado: só acrescenta; falha ou transcrição vazia nunca apaga o texto', () => {
  assert.equal(mergeDictation('Troquei a fonte. ', 'testei a abertura'), 'Troquei a fonte. testei a abertura');
  assert.equal(mergeDictation('', 'primeira frase  '), 'primeira frase');
  assert.equal(mergeDictation('Texto já escrito', ''), 'Texto já escrito');
  assert.equal(mergeDictation('Texto já escrito', '   '), 'Texto já escrito');
  assert.equal(mergeDictation('Texto já escrito', undefined), 'Texto já escrito');
  assert.equal(mergeDictation(undefined, undefined), '');
});

test('retry do mesmo conteúdo reaproveita o identificador; conteúdo novo ganha identificador novo', () => {
  let n = 0;
  const ids = createContentRequestIds(() => `id-${++n}`);
  const a = ids.idFor({ cause: 'a' });
  assert.equal(ids.idFor({ cause: 'a' }), a, 'falha de rede + novo toque = mesma operação');
  const b = ids.idFor({ cause: 'b' });
  assert.notEqual(b, a);
  assert.equal(ids.idFor({ cause: 'b' }), b);
  const reports = createReportRequestIds(() => `rep-${++n}`);
  const first = reports.current();
  assert.equal(reports.current(), first, 'sem resposta do servidor o retry repete o pedido (o servidor devolve a geração já feita)');
  reports.settle();
  assert.notEqual(reports.current(), first, 'resposta do servidor encerra o pedido: a próxima geração é outro pedido');
});

test('banco sem a 0111: erros de recurso ausente são reconhecidos, o resto não', () => {
  for (const code of ['PGRST202', 'PGRST205', '42883', '42P01']) assert.equal(isFeatureUnavailable({ code }), true, code);
  assert.equal(isFeatureUnavailable({ code: '', status: 404 }), true);
  assert.equal(isFeatureUnavailable({ code: '42501' }), false);
  assert.equal(isFeatureUnavailable({ code: '', message: 'Failed to fetch' }), false);
  assert.equal(isFeatureUnavailable(null), false);
});

test('procedência do relatório: discreta, e mostra quando o técnico editou o texto da IA', () => {
  assert.deepEqual(reportProvenance({}), { origin: 'manual', label: '', edited: false });
  assert.deepEqual(reportProvenance({ source: 'standard', generatedText: 'texto padrão', finalText: 'texto padrão' }), { origin: 'manual', label: '', edited: false });
  const gerado = 'Foi realizado atendimento referente a troca de fechadura.';
  assert.deepEqual(reportProvenance({ source: 'ai', generatedText: gerado, finalText: gerado }), { origin: 'ai', label: REPORT_PROVENANCE_LABEL, edited: false });
  assert.equal(REPORT_PROVENANCE_LABEL, 'Gerado com auxílio de IA');
  assert.equal(reportProvenance({ source: 'ai', generatedText: gerado, finalText: `${gerado} Cliente satisfeito.` }).label, 'Gerado com auxílio de IA · editado');
  assert.equal(reportProvenance({ source: 'ai', generatedText: gerado, finalText: `  ${gerado}\n` }).edited, false, 'espaço não é edição');
});

test('limite e quota: mensagens claras e contagem sem inventar vaga', () => {
  assert.equal(reportUsageLabel({ used: 1, limit: 3, remaining: 2 }), '2 de 3 gerações com IA restantes');
  assert.equal(reportUsageLabel({ used: 3, limit: 3, remaining: 0 }), 'Gerações com IA usadas: 3 de 3');
  assert.equal(reportUsageLabel(null), '3 de 3 gerações com IA restantes');
  for (const reason of ['ai_disabled', 'ai_not_configured', 'quota', 'limit_reached', 'provider_error', 'unsafe_output', 'network']) {
    assert.ok(reportFallbackMessage(reason).length > 40, reason);
  }
  assert.match(reportFallbackMessage('limit_reached'), /3 gerações/);
  assert.equal(evidenceCountLabel(0), 'Nenhuma evidência anexada');
  assert.equal(evidenceCountLabel(1), '1 evidência anexada');
  assert.equal(evidenceCountLabel(4), '4 evidências anexadas');
});

test('texto padrão sem IA: só fatos confirmados na OS, nunca custo, preço ou causa inventada', () => {
  const os = {
    numero: 'OS-0042', descricaoLivre: 'Trocar fechadura da porta principal',
    itens: [
      { tipo: 'servico', nome: 'Troca de fechadura', preco: 180, custo: 40, qtd: 1 },
      { tipo: 'produto', nome: 'Fechadura digital', preco: 1290.9, custo: 777.77, qtd: 1 },
    ],
  };
  const texto = buildStandardReportText(os, { base: { cause: '', solution: 'Substituí a fechadura e testei a abertura', difficulty: 'hard', learning: 'Segredo interno' }, extraMaterials: [{ nome: 'Parafuso', qtd: 4, custo: 3.33, preco: 9 }] });
  assert.match(texto, /^Foi realizado atendimento referente a trocar fechadura da porta principal\./);
  assert.match(texto, /A solução aplicada foi: substituí a fechadura e testei a abertura\./);
  assert.match(texto, /Materiais utilizados: Fechadura digital \(1\), Parafuso \(4\)\./);
  assert.doesNotMatch(texto, /causa/i, 'causa vazia não é inventada');
  assert.doesNotMatch(texto, /1290|777|180|40|3,33|3\.33|R\$|custo|preço|margem|difícil|Segredo interno/i);
  assert.doesNotMatch(texto, /retorno/i);
  // Sem solução, sem material e sem causa: só a frase de serviço.
  assert.equal(buildStandardReportText({ numero: 'OS-1', descricaoLivre: 'Revisão', itens: [] }, {}), 'Foi realizado atendimento referente a revisão.');
  // Retorno só aparece quando o técnico o marcou.
  assert.match(buildStandardReportText(os, { returnNeeded: true, returnReason: 'falta peça de acabamento' }), /Será necessário um retorno para concluir o serviço\. Motivo: falta peça de acabamento\./);
  const fatos = buildLocalReportFacts(os, { base: { cause: 'c', solution: 's', difficulty: 'easy', learning: 'l' }, extraMaterials: [] });
  assert.deepEqual(Object.keys(fatos).sort(), ['cause', 'materials', 'returnNeeded', 'returnReason', 'serviceRequested', 'services', 'solution', 'workOrderNumber']);
  assert.ok(fatos.materials.every((m) => Object.keys(m).sort().join() === 'name,quantity'));
});
