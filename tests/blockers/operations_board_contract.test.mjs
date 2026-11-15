import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  FILTROS, PRIORIDADES, SEM_RESPONSAVEL, aplicarMovimentoLocal, cartaoAtrasado,
  conflitosLocais, destinoParaAssignee, filtrarCartoes, filtroIncluiConcluidas,
  janelaDoFiltro, montarColunas, movimentoValido, ordenarCartoes, somarDias,
} from '../../src/lib/operationsBoard.js';

const HOJE = '2026-11-16';
const card = (over = {}) => ({
  work_order_id: over.id || 'wo-1', number: over.number || 'OS-0001',
  client_name: 'Edifício Plaza', location_name: 'Garagem', summary: 'Portão',
  scheduled_date: HOJE, scheduled_time: '09:00', status: 'scheduled',
  priority: 'normal', assignee_id: null, is_late: false, ...over,
});
const board = (cards, members) => ({ cards, members: members || [
  { user_id: 'owner', name: 'Dona Ana', role: 'owner' },
  { user_id: 'tecA', name: 'João', role: 'technician' },
  { user_id: 'tecB', name: 'Carlos', role: 'technician' },
] });

test('colunas: sem responsável primeiro, proprietário como executor e técnico livre mantém coluna', () => {
  const colunas = montarColunas(board([
    card({ id: 'a', assignee_id: null }),
    card({ id: 'b', assignee_id: 'tecA', number: 'OS-0002' }),
    card({ id: 'c', assignee_id: 'owner', number: 'OS-0003' }),
  ]), { hoje: HOJE, filtro: 'hoje' });

  assert.equal(colunas[0].id, SEM_RESPONSAVEL);
  assert.equal(colunas[0].carga, 1);
  // o proprietário é executor: tem coluna e carga próprias
  const owner = colunas.find((c) => c.id === 'owner');
  assert.equal(owner.papel, 'owner');
  assert.equal(owner.carga, 1);
  // técnico sem serviço continua visível (está livre), com carga zero
  const livre = colunas.find((c) => c.id === 'tecB');
  assert.ok(livre, 'técnico sem serviço precisa manter a coluna');
  assert.equal(livre.carga, 0);
});

test('responsável fora do elenco ativo não desaparece do quadro', () => {
  const colunas = montarColunas(board([card({ id: 'a', assignee_id: 'desligado' })]), { hoje: HOJE, filtro: 'hoje' });
  const orfa = colunas.find((c) => c.id === 'desligado');
  assert.ok(orfa, 'a OS precisa continuar visível para ser redistribuída');
  assert.equal(orfa.carga, 1);
});

test('filtros cobrem hoje, amanhã, semana, atrasadas, sem responsável e status', () => {
  const amanha = somarDias(HOJE, 1);
  const cards = [
    card({ id: 'hoje', scheduled_date: HOJE }),
    card({ id: 'amanha', scheduled_date: amanha }),
    card({ id: 'semana', scheduled_date: somarDias(HOJE, 5) }),
    card({ id: 'fora', scheduled_date: somarDias(HOJE, 20) }),
    card({ id: 'atrasada', scheduled_date: somarDias(HOJE, -2) }),
    card({ id: 'semdata', scheduled_date: null, status: 'unscheduled' }),
    card({ id: 'andando', status: 'in_progress' }),
    card({ id: 'feita', status: 'done' }),
    card({ id: 'comresp', assignee_id: 'tecA' }),
  ];
  const ids = (filtro) => filtrarCartoes(cards, { filtro, hoje: HOJE }).map((c) => c.work_order_id).sort();

  assert.deepEqual(ids('hoje').includes('hoje'), true);
  assert.equal(ids('hoje').includes('amanha'), false);
  assert.deepEqual(ids('amanha'), ['amanha']);
  assert.equal(ids('semana').includes('fora'), false);
  assert.deepEqual(ids('atrasadas'), ['atrasada']);
  assert.equal(ids('semresponsavel').includes('comresp'), false);
  assert.deepEqual(ids('aguardando'), ['semdata']);
  assert.deepEqual(ids('andamento'), ['andando']);
  assert.deepEqual(ids('concluidas'), ['feita']);
  // concluída nunca polui os demais filtros
  for (const f of ['hoje', 'amanha', 'semana', 'atrasadas', 'semresponsavel', 'aguardando', 'andamento']) {
    assert.equal(ids(f).includes('feita'), false, `${f} não deve trazer concluída`);
  }
});

test('filtros opcionais: responsável, prioridade e local', () => {
  const cards = [
    card({ id: 'a', assignee_id: 'tecA', priority: 'urgent', location_name: 'Garagem' }),
    card({ id: 'b', assignee_id: 'tecB', priority: 'normal', location_name: 'Portaria' }),
    card({ id: 'c', assignee_id: null, priority: 'high', location_name: 'Rampa' }),
  ];
  const ids = (extra) => filtrarCartoes(cards, { filtro: 'hoje', hoje: HOJE, ...extra }).map((c) => c.work_order_id);
  assert.deepEqual(ids({ tecnicoId: 'tecA' }), ['a']);
  assert.deepEqual(ids({ tecnicoId: SEM_RESPONSAVEL }), ['c']);
  assert.deepEqual(ids({ prioridade: 'urgent' }), ['a']);
  assert.deepEqual(ids({ local: 'ramp' }), ['c']);
});

test('ordem da coluna: urgente antes, depois hora, sem data no fim', () => {
  const ordenado = ordenarCartoes([
    card({ id: 'tarde', scheduled_time: '15:00', number: 'OS-0003' }),
    card({ id: 'semdata', scheduled_date: null, scheduled_time: null, number: 'OS-0004' }),
    card({ id: 'urgente', priority: 'urgent', scheduled_time: '17:00', number: 'OS-0002' }),
    card({ id: 'manha', scheduled_time: '08:00', number: 'OS-0001' }),
  ]).map((c) => c.work_order_id);
  assert.deepEqual(ordenado, ['urgente', 'manha', 'tarde', 'semdata']);
});

test('atraso só conta OS agendada ou em andamento com data passada', () => {
  assert.equal(cartaoAtrasado(card({ scheduled_date: somarDias(HOJE, -1) }), HOJE), true);
  assert.equal(cartaoAtrasado(card({ scheduled_date: somarDias(HOJE, -1), status: 'done' }), HOJE), false);
  assert.equal(cartaoAtrasado(card({ scheduled_date: null, status: 'unscheduled' }), HOJE), false);
  assert.equal(cartaoAtrasado(card({ scheduled_date: HOJE }), HOJE), false);
});

test('conflito de horário é contado, inclusive para quem já tem a mesma hora', () => {
  const cards = [
    card({ id: 'x', assignee_id: 'tecA', scheduled_date: HOJE, scheduled_time: '09:00' }),
    card({ id: 'y', assignee_id: 'tecA', scheduled_date: HOJE, scheduled_time: '10:00' }),
  ];
  assert.equal(conflitosLocais(cards, { cardId: 'novo', assigneeId: 'tecA', data: HOJE, hora: '09:00' }), 1);
  assert.equal(conflitosLocais(cards, { cardId: 'x', assigneeId: 'tecA', data: HOJE, hora: '09:00' }), 0, 'não conflita consigo mesma');
  assert.equal(conflitosLocais(cards, { cardId: 'novo', assigneeId: 'tecA', data: HOJE, hora: '23:00' }), 0);
});

test('movimento: OS concluída ou cancelada não se move, e não move para onde já está', () => {
  assert.equal(movimentoValido(card({ assignee_id: null }), 'tecA'), true);
  assert.equal(movimentoValido(card({ assignee_id: 'tecA' }), 'tecA'), false);
  assert.equal(movimentoValido(card({ assignee_id: null }), SEM_RESPONSAVEL), false);
  assert.equal(movimentoValido(card({ status: 'done' }), 'tecA'), false);
  assert.equal(movimentoValido(card({ status: 'canceled' }), 'tecA'), false);
});

test('coluna sem responsável vira assignee nulo na RPC', () => {
  assert.equal(destinoParaAssignee(SEM_RESPONSAVEL), null);
  assert.equal(destinoParaAssignee('tecA'), 'tecA');
});

test('movimento local troca só o cartão alvo (para o rollback devolver o estado)', () => {
  const cards = [card({ id: 'a', assignee_id: null }), card({ id: 'b', assignee_id: 'tecA' })];
  const depois = aplicarMovimentoLocal(cards, 'a', 'tecB');
  assert.equal(depois[0].assignee_id, 'tecB');
  assert.equal(depois[1].assignee_id, 'tecA');
  assert.equal(cards[0].assignee_id, null, 'o original não pode ser mutado');
});

test('janela pedida ao banco cobre o filtro e só concluídas pedem histórico', () => {
  assert.deepEqual(janelaDoFiltro('hoje', HOJE), { de: HOJE, ate: HOJE });
  assert.deepEqual(janelaDoFiltro('amanha', HOJE), { de: '2026-11-17', ate: '2026-11-17' });
  assert.deepEqual(janelaDoFiltro('semana', HOJE), { de: HOJE, ate: '2026-11-23' });
  assert.equal(filtroIncluiConcluidas('concluidas'), true);
  for (const f of ['hoje', 'amanha', 'semana', 'atrasadas', 'semresponsavel', 'aguardando', 'andamento']) {
    assert.equal(filtroIncluiConcluidas(f), false);
  }
});

test('o quadro não tem como exibir financeiro: nem a RPC seleciona, nem a tela lê', () => {
  const migration = readFileSync('supabase/0116_operations_dispatch.sql', 'utf8');
  const board_ = migration.slice(migration.indexOf('function public.zt_operations_board'));
  const corpo = board_.slice(0, board_.indexOf('revoke all on function public.zt_operations_board'));
  for (const campo of ['approved_subtotal', 'approved_discount', 'approved_surcharge', 'approved_total',
    'extra_cost', 'pending_pricing', 'billing_entry_id']) {
    assert.equal(corpo.includes(campo), false, `zt_operations_board não pode selecionar ${campo}`);
  }
  const tela = readFileSync('src/components/OperationsBoard.jsx', 'utf8');
  assert.doesNotMatch(tela, /approved_|extra_cost|billing_entry|\bbrl\b/, 'o quadro não exibe valor');
  const regras = readFileSync('src/lib/operationsBoard.js', 'utf8');
  assert.doesNotMatch(regras, /approved_|extra_cost|preco|valor|margem/i, 'as regras do quadro não tocam financeiro');
});

test('contrato de catálogo: filtros e prioridades previstos', () => {
  assert.deepEqual(FILTROS.map((f) => f.id),
    ['hoje', 'amanha', 'semana', 'atrasadas', 'semresponsavel', 'aguardando', 'andamento', 'concluidas']);
  assert.deepEqual(PRIORIDADES.map((p) => p.id), ['normal', 'high', 'urgent']);
});

test('escrita do quadro passa só pelas RPCs oficiais, com origem e pedido', () => {
  const api = readFileSync('src/lib/operationsApi.js', 'utf8');
  assert.match(api, /rpc\('zt_assign_work_order'/);
  assert.match(api, /rpc\('zt_schedule_work_order'/);
  assert.match(api, /rpc\('zt_set_work_order_priority'/);
  assert.match(api, /rpc\('zt_operations_board'/);
  // nenhum UPDATE direto em work_orders nesta camada
  assert.doesNotMatch(api, /from\('work_orders'\)[\s\S]{0,80}\.update\(/);
  assert.match(api, /p_source: origem/);
  assert.match(api, /p_request: pedido \|\| novoPedido\(\)/);
});
