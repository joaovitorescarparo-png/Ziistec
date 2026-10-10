import test from 'node:test';
import assert from 'node:assert/strict';
import { localReadIntent, inferAssistantPlan, saoPauloDate } from '../../api/_assistantPlanner.js';
import { createAssistantHandler } from '../../api/assistant.js';
import { validateAssistantInput, toolsForRole } from '../../src/lib/assistantTools.js';

const companyId = '10000000-0000-4000-8000-000000000001';
const userId = '20000000-0000-4000-8000-000000000002';
const requestId = '30000000-0000-4000-8000-000000000003';
function harness({ role = 'owner', proposal, authenticated = true, member = true, paid = true } = {}) {
  const calls = [], inference = [];
  const handler = createAssistantHandler({
    env: paid ? { ENABLE_PAID_AI: 'true', ANTHROPIC_API_KEY: 'test-placeholder' } : {},
    resolveConfig: () => ({ configurado: true, url: 'https://example.invalid', publishableKey: 'test-placeholder' }),
    infer: async args => { inference.push(args); return proposal; },
    fetchImpl: async (url, options) => {
      calls.push({ url, args: options.body && JSON.parse(options.body) });
      return { ok: true, json: async () => url.endsWith('/auth/v1/user') ? { id: userId } :
        url.includes('/company_members?') ? (member ? [{ role }] : []) :
        url.endsWith('/zt_assistant_plan') ? { confirmationRequired: !calls.at(-1).args.p_action.startsWith('owner_') && !calls.at(-1).args.p_action.startsWith('technician_'), previewHash: 'a'.repeat(64) } : {} };
    },
  });
  return { calls, inference, async run(text) {
    let status, body;
    await handler({ method: 'POST', headers: { 'content-type': 'application/json', ...(authenticated ? { authorization: 'Bearer test-placeholder' } : {}) },
      body: { operation: 'plan', companyId, requestId, text } },
    { setHeader() {}, status(value) { status = value; return this; }, json(value) { body = value; } });
    return { status, body };
  } };
}

test('today, next appointment and phone natural reads use the authorized role without paid inference', async () => {
  for (const [role, phrase, action, input] of [
    ['owner', 'O que tenho hoje?', 'owner_today_schedule', {}],
    ['technician', 'O que tenho hoje?', 'technician_today_orders', {}],
    ['owner', 'Qual é meu próximo atendimento?', 'owner_next_appointment', {}],
    ['technician', 'Qual é meu próximo atendimento?', 'technician_next_appointment', {}],
    ['owner', 'Procura o telefone do cliente Mauro.', 'owner_find_client', { query: 'Mauro' }],
  ]) {
    const h = harness({ role, paid: false });
    const result = await h.run(phrase);
    assert.equal(result.status, 200); assert.equal(result.body.confirmationRequired, false);
    assert.equal(h.inference.length, 0);
    assert.deepEqual(h.calls.find(c => c.url.endsWith('/zt_assistant_plan')).args,
      { p_company: companyId, p_action: action, p_input: input, p_request_id: requestId });
    assert.equal(h.calls.some(c => /execute|quota/.test(c.url)), false);
  }
});

test('unsupported weekly receivables clearly says unavailable without financial calls', async () => {
  const h = harness({ paid: false });
  const r = await h.run('Quanto tenho para receber esta semana?');
  assert.equal(r.status, 200); assert.match(r.body.question, /ainda não está disponível/);
  assert.equal(h.calls.some(c => c.url.includes('/rpc/')), false);
  assert.equal(localReadIntent('Procura o telefone do cliente Mauro.', 'technician'), null);
});

test('follow-up without reliable context asks for a reference without guessing or calling paid inference', async () => {
  const h = harness({ paid: false });
  const r = await h.run('E depois desse?');
  assert.equal(r.status, 200);
  assert.match(r.body.question, /Informe a OS e a data/);
  assert.equal(h.inference.length, 0);
  assert.equal(h.calls.some(c => c.url.includes('/rpc/')), false);
});

test('natural write proposals consume quota and prepare only; confirmation is a separate operation', async () => {
  // Provider proposals are fixtures: this proves API boundaries, not model accuracy.
  for (const [phrase, proposal] of [
    ['Cria um cliente chamado TESTE ASSISTANT.', { action: 'create_client', input: { name: 'TESTE ASSISTANT' } }],
    ['Cria uma OS para o Mauro amanhã às 14h para instalar uma câmera.', { action: 'create_work_order', input: { client: 'Mauro', description: 'instalar uma câmera', date: '2026-10-11', time: '14:00' } }],
    ['Agenda o João sexta às 9h.', { action: 'schedule_work_order', input: { client: 'João', date: '2026-10-16', time: '09:00' } }],
  ]) {
    const h = harness({ proposal }); const r = await h.run(phrase);
    assert.equal(r.status, 200); assert.equal(r.body.confirmationRequired, true);
    assert.equal(h.inference[0].text, phrase);
    assert.deepEqual(h.calls.filter(c => c.url.includes('/rpc/')).map(c => c.url.split('/').at(-1)), ['zt_assistant_consume_ai_quota', 'zt_assistant_plan']);
    assert.deepEqual(h.calls.at(-1).args.p_input, proposal.input);
  }
});

test('missing quote price and ambiguous conversational context ask instead of preparing writes', async () => {
  for (const [phrase, question] of [['Cria um orçamento para Mauro com instalação de câmera.', 'Qual é o preço da instalação?'], ['E depois desse?', 'Qual atendimento você quer usar como referência? Informe a OS e a data para eu conferir.']]) {
    const h = harness({ proposal: { question } }); const r = await h.run(phrase);
    assert.equal(r.status, 200); assert.equal(r.body.question, question);
    assert.equal(h.calls.some(c => c.url.endsWith('/zt_assistant_plan') || c.url.endsWith('/zt_assistant_execute')), false);
  }
  assert.throws(() => validateAssistantInput('create_quote_draft', { client: 'Mauro', description: 'Instalação', quantity: 1 }, 'owner'), /Preço unitário/);
});

test('new scheduling input rejects partial dates, invalid civil dates and ambiguous references', () => {
  for (const input of [{ client: 'Mauro', description: 'x', date: '2026-10-10' }, { client: 'Mauro', description: 'x', date: '2026-02-30', time: '14:00' }]) {
    assert.throws(() => validateAssistantInput('create_work_order', input, 'owner'));
  }
  for (const refs of [{}, { client: 'Mauro', workOrder: 'OS-0001' }]) assert.throws(() => validateAssistantInput('schedule_work_order', { ...refs, date: '2026-10-10', time: '09:00' }, 'owner'), /somente um/);
  assert.deepEqual(validateAssistantInput('schedule_work_order', { workOrder: 'OS-0001', date: '2026-10-10', time: '09:00' }, 'owner'), { workOrder: 'OS-0001', date: '2026-10-10', time: '09:00' });
});

test('unauthenticated, missing membership and model-proposed owner tools for technicians fail closed', async () => {
  for (const [options, status] of [[{ authenticated: false }, 401], [{ member: false }, 403], [{ role: 'technician', proposal: { action: 'owner_find_client', input: { query: 'Mauro' } } }, 403]]) {
    const h = harness(options); assert.equal((await h.run('Busque um cliente')).status, status);
    assert.equal(h.calls.some(c => /zt_assistant_(plan|execute)$/.test(c.url)), false);
  }
  assert.ok(toolsForRole('technician').every(t => !t.name.startsWith('owner_') && !t.name.includes('financial')));
});

test('paid inference remains opt-in with clear fallback and no provider or quota call', async () => {
  const h = harness({ paid: false }); const r = await h.run('Cria um cliente chamado TESTE ASSISTANT.');
  assert.equal(r.status, 503); assert.match(r.body.error, /indisponível neste ambiente/);
  assert.equal(h.inference.length, 0); assert.equal(h.calls.some(c => c.url.includes('/rpc/')), false);
});

test('provider prompt uses São Paulo civil date and only current-role tools; invalid response cannot execute', async () => {
  const now = new Date('2026-10-11T01:00:00Z'); assert.equal(saoPauloDate(now), '2026-10-10');
  let request;
  await inferAssistantPlan({ text: 'E depois desse?', role: 'technician', now, env: {}, fetchImpl: async (_, options) => {
    request = JSON.parse(options.body); return { ok: true, json: async () => ({ content: [{ type: 'text', text: '{"question":"Qual OS?"}' }] }) };
  } });
  assert.match(request.system, /hoje 2026-10-10/); assert.match(request.system, /não invente contexto/);
  const registry = JSON.parse(request.system.split('Ferramentas: ')[1]);
  assert.ok(registry.some(t => t.name === 'technician_next_appointment'));
  assert.ok(registry.every(t => !t.name.startsWith('owner_')));
  await assert.rejects(inferAssistantPlan({ text: 'x', role: 'owner', env: {}, fetchImpl: async () => ({ ok: true, json: async () => ({ content: [{ type: 'text', text: 'not json' }] }) }) }), /Nada foi executado/);
});
