import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  INTENTS, STATUS, hojeEmSaoPaulo, montarProposta, origemAuditoria,
  origemComandoValida, podeExecutar, resolverCandidato, resolverDataRelativa,
  resolverHora,
} from '../../src/lib/operationsCommands.js';
import { rascunhoDeFrase } from '../../src/lib/operationsCommandDraft.js';

const HOJE = '2026-11-15'; // domingo
const CTX = {
  companyId: 'empresa-a',
  usuarioAtual: { id: 'owner' },
  hoje: HOJE,
  clientes: [
    { id: 'cli-1', nome: 'Edifício Plaza Norte', fantasia: '' },
    { id: 'cli-2', nome: 'Edifício Plaza Sul', fantasia: '' },
    { id: 'cli-3', nome: 'Residencial Mar Azul', fantasia: '' },
  ],
  locais: [
    { id: 'loc-1', nome: 'Garagem / Rampa', clienteId: 'cli-3' },
    { id: 'loc-2', nome: 'Portaria', clienteId: 'cli-3' },
  ],
  membros: [
    { id: 'owner', nome: 'Dona Ana', funcao: 'Proprietária' },
    { id: 'joao-1', nome: 'João Silva', funcao: 'Técnico' },
    { id: 'joao-2', nome: 'João Pereira', funcao: 'Técnico' },
    { id: 'carlos', nome: 'Carlos Prado', funcao: 'Técnico' },
  ],
  ordens: [{ id: 'wo-1', numero: 'OS-0001' }, { id: 'wo-2', numero: 'OS-0002' }],
};

test('as 6 intents da V1 estão declaradas e nada além', () => {
  assert.deepEqual(INTENTS, ['create_work_order', 'schedule_work_order', 'assign_work_order',
    'add_work_order_note', 'get_schedule', 'get_work_order']);
});

test('cliente ambíguo pede desambiguação e não cria nada', () => {
  const p = montarProposta({ intent: 'create_work_order', client_query: 'Plaza', description: 'portão' }, CTX);
  assert.equal(p.status, STATUS.AMBIGUO);
  assert.equal(p.campo, 'client');
  assert.equal(p.opcoes.length, 2);
  assert.ok(!p.alvo, 'proposta ambígua não carrega alvo executável');
});

test('técnico ambíguo pede desambiguação', () => {
  const p = montarProposta({ intent: 'assign_work_order', work_order_query: 'OS-0001', assignee_query: 'João' }, CTX);
  assert.equal(p.status, STATUS.AMBIGUO);
  assert.equal(p.campo, 'assignee');
  assert.deepEqual(p.opcoes.map((o) => o.id).sort(), ['joao-1', 'joao-2']);
});

test('nome exato vence o parcial, então não vira ambiguidade', () => {
  const r = resolverCandidato('João Silva', CTX.membros, { campos: ['nome'] });
  assert.equal(r.status, 'unico');
  assert.equal(r.escolhido.id, 'joao-1');
});

test('cliente inexistente é recusado, sem inventar cadastro', () => {
  const p = montarProposta({ intent: 'create_work_order', client_query: 'Cliente Fantasma', description: 'x' }, CTX);
  assert.equal(p.status, STATUS.INVALIDO);
  assert.match(p.motivo, /não encontrei o cliente/i);
});

test('"amanhã às 9" vira data e hora absolutas antes da confirmação', () => {
  const p = montarProposta({
    intent: 'create_work_order', client_query: 'Mar Azul',
    description: 'Portão da rampa não abre', date_query: 'amanhã', time_query: '9',
  }, CTX);
  assert.equal(p.status, STATUS.PROPOSTA);
  assert.equal(p.alvo.data, '2026-11-16');
  assert.equal(p.alvo.horario, '09:00');
  // a proposta mostra a data absoluta, nunca o advérbio
  const dataMostrada = p.resumo.find((l) => l.rotulo === 'Data').valor;
  assert.match(dataMostrada, /16\/11\/2026 às 09:00/);
  assert.doesNotMatch(dataMostrada, /amanh/i);
});

test('datas relativas e períodos resolvem no fuso de São Paulo', () => {
  assert.equal(resolverDataRelativa('hoje', { hoje: HOJE }), HOJE);
  assert.equal(resolverDataRelativa('amanhã', { hoje: HOJE }), '2026-11-16');
  assert.equal(resolverDataRelativa('depois de amanhã', { hoje: HOJE }), '2026-11-17');
  assert.equal(resolverDataRelativa('segunda', { hoje: HOJE }), '2026-11-16');
  assert.equal(resolverDataRelativa('16/11', { hoje: HOJE }), '2026-11-16');
  assert.equal(resolverDataRelativa('2026-12-01', { hoje: HOJE }), '2026-12-01');
  assert.equal(resolverDataRelativa('qualquer coisa', { hoje: HOJE }), '', 'não adivinha');
  assert.equal(resolverHora('9'), '09:00');
  assert.equal(resolverHora('9:30'), '09:30');
  assert.equal(resolverHora('manhã'), '09:00');
  assert.equal(resolverHora('tarde'), '14:00');
  assert.equal(resolverHora('99'), '');
  assert.match(hojeEmSaoPaulo(new Date('2026-11-16T01:30:00Z')), /^\d{4}-\d{2}-\d{2}$/);
});

test('data que o engine não entende recusa em vez de chutar', () => {
  const p = montarProposta({ intent: 'create_work_order', client_query: 'Mar Azul', description: 'x', date_query: 'semana que vem talvez' }, CTX);
  assert.equal(p.status, STATUS.INVALIDO);
  assert.match(p.motivo, /não entendi a data/i);
});

test('empresa vem da sessão: company_id do payload é recusado', () => {
  const p = montarProposta({ intent: 'create_work_order', company_id: 'empresa-b', client_query: 'Mar Azul', description: 'x' }, CTX);
  assert.equal(p.status, STATUS.NEGADO);
  assert.match(p.motivo, /empresa vem da sessão/i);
});

test('sem empresa na sessão nada é proposto', () => {
  const p = montarProposta({ intent: 'create_work_order', client_query: 'Mar Azul', description: 'x' }, { ...CTX, companyId: null });
  assert.equal(p.status, STATUS.NEGADO);
});

test('intent desconhecida é recusada', () => {
  const p = montarProposta({ intent: 'apagar_empresa' }, CTX);
  assert.equal(p.status, STATUS.INVALIDO);
});

test('faltando informação o engine pergunta, não assume', () => {
  const semCliente = montarProposta({ intent: 'create_work_order', description: 'x' }, CTX);
  assert.equal(semCliente.status, STATUS.AMBIGUO);
  assert.equal(semCliente.campo, 'client');

  const semDescricao = montarProposta({ intent: 'create_work_order', client_query: 'Mar Azul' }, CTX);
  assert.equal(semDescricao.status, STATUS.AMBIGUO);
  assert.equal(semDescricao.campo, 'description');

  const semResponsavel = montarProposta({ intent: 'assign_work_order', work_order_query: 'OS-0001' }, CTX);
  assert.equal(semResponsavel.status, STATUS.AMBIGUO);
  assert.equal(semResponsavel.campo, 'assignee');
});

test('"eu" resolve para o usuário da sessão', () => {
  const p = montarProposta({ intent: 'assign_work_order', work_order_query: 'OS-0001', assignee_query: 'eu' }, CTX);
  assert.equal(p.status, STATUS.PROPOSTA);
  assert.equal(p.alvo.responsavelId, 'owner');
});

test('"sem responsável" devolve a OS ao quadro', () => {
  const p = montarProposta({ intent: 'assign_work_order', work_order_query: 'OS-0001', assignee_query: 'sem responsável' }, CTX);
  assert.equal(p.status, STATUS.PROPOSTA);
  assert.equal(p.alvo.removerResponsavel, true);
  assert.equal(p.alvo.responsavelId, null);
});

test('execução exige confirmação explícita; consulta não escreve e dispensa', () => {
  const escrita = montarProposta({
    intent: 'create_work_order', client_query: 'Mar Azul', description: 'x', date_query: 'amanhã',
  }, CTX);
  assert.equal(escrita.status, STATUS.PROPOSTA);
  assert.equal(podeExecutar(escrita, { confirmado: false }).ok, false);
  assert.equal(podeExecutar(escrita, { confirmado: true }).ok, true);

  const leitura = montarProposta({ intent: 'get_schedule', date_query: 'hoje' }, CTX);
  assert.equal(leitura.status, STATUS.PRONTO);
  assert.equal(podeExecutar(leitura, { confirmado: false }).ok, true);

  const ambigua = montarProposta({ intent: 'create_work_order', client_query: 'Plaza', description: 'x' }, CTX);
  assert.equal(podeExecutar(ambigua, { confirmado: true }).ok, false, 'confirmar não executa proposta ambígua');
  assert.equal(podeExecutar(null, { confirmado: true }).ok, false);
});

test('origem do comando: validada e mapeada para a auditoria do despacho', () => {
  for (const o of ['text', 'voice_transcript', 'assistant', 'whatsapp', 'mobile']) {
    assert.equal(origemComandoValida(o), true);
  }
  assert.equal(origemComandoValida('telepatia'), false);
  assert.equal(origemAuditoria('whatsapp'), 'whatsapp');
  assert.equal(origemAuditoria('voice_transcript'), 'whatsapp');
  assert.equal(origemAuditoria('assistant'), 'assistant');
  assert.equal(origemAuditoria('mobile'), 'mobile');
  assert.equal(origemAuditoria('text'), 'web');
});

test('o rascunho do simulador vira o mesmo payload estruturado do engine', () => {
  const p = rascunhoDeFrase('Cria uma OS para o Residencial Mar Azul amanhã às 9 porque o portão da rampa não está abrindo');
  assert.equal(p.intent, 'create_work_order');
  assert.equal(p.source, 'whatsapp');
  assert.match(p.client_query, /mar azul/i);
  assert.equal(p.date_query, 'amanha');
  assert.equal(p.time_query, '9');
  assert.match(p.description, /portão da rampa/i);

  // e o engine aceita esse payload direto, resolvendo para absoluto
  const proposta = montarProposta(p, CTX);
  assert.equal(proposta.status, STATUS.PROPOSTA);
  assert.equal(proposta.alvo.data, '2026-11-16');
  assert.equal(proposta.alvo.horario, '09:00');
  assert.equal(proposta.alvo.clienteId, 'cli-3');
});

test('o engine executa só pelas operações oficiais, nunca escrevendo em tabela', () => {
  const engine = readFileSync('src/lib/operationsCommandEngine.js', 'utf8');
  for (const rpc of ['zt_save_work_order_idempotent', 'zt_save_work_order_report',
    'zt_operations_board', 'zt_work_order_history_detail']) {
    assert.ok(engine.includes(rpc), `o engine precisa usar ${rpc}`);
  }
  assert.match(engine, /atribuirOSDB|agendarOSOperacoesDB/);
  // nenhuma escrita direta em tabela a partir do agente
  assert.doesNotMatch(engine, /\.update\(|\.insert\(|\.upsert\(|\.delete\(/,
    'o agente não escreve em tabela: só RPC oficial');
  // a empresa nunca sai do payload
  assert.match(engine, /p_company: proposta\.companyId/);
});

test('o contexto do agente é só o que a sessão enxerga', () => {
  const engine = readFileSync('src/lib/operationsCommandEngine.js', 'utf8');
  const ctx = engine.slice(engine.indexOf('carregarContextoComandos'), engine.indexOf('export async function proporComando'));
  for (const tabela of ['clients', 'client_locations', 'company_members', 'work_orders']) {
    assert.ok(ctx.includes(`'${tabela}'`), `contexto precisa ler ${tabela} pela sessão`);
  }
  assert.ok(ctx.includes("eq('company_id', companyId)"), 'o contexto é sempre filtrado pela empresa da sessão');
  // e nada financeiro entra no contexto do agente
  assert.doesNotMatch(ctx, /approved_|extra_cost|price|cost/);
});
