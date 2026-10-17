import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import React from 'react';
import { transformSync } from 'esbuild';
import * as toolRegistry from '../../src/lib/assistantTools.js';
import { GEMINI_API_BASE } from '../../api/_aiGateway.js';
import { AMOUNT_QUESTION, clarifiedAmount, entryAmountQuestion, missingFieldQuestion, priceQuestion, sanitizeProposal } from '../../api/_assistantPlanner.js';
import { createAssistantHandler } from '../../api/assistant.js';

// Assistant Universal Owner V1 — voz no painel, esclarecimento monetário, histórico do cliente,
// leituras do proprietário e escritas canônicas. Provedor e banco simulados; a autoridade
// (empresa, papel, assinatura, estado) é provada no SQL v2_assistant_owner_v1_rollback.sql.
const companyId = '10000000-0000-4000-8000-000000000001';
const userId = '20000000-0000-4000-8000-000000000002';
const requestId = '30000000-0000-4000-8000-000000000003';
const UUID_ANY = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const env = { ENABLE_EXTERNAL_AI: 'true', AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'test-placeholder' };
const PROVIDER_HOST = new URL(GEMINI_API_BASE).hostname;
const geminiReply = (value) => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }] }) });
const preview = { requestId, previewHash: 'a'.repeat(64), previewVersion: 1, confirmationRequired: true, preview: [] };

function api({ role = 'owner', member = true, gemini, rpc = {} } = {}) {
  const calls = [], provider = [];
  const handler = createAssistantHandler({ env,
    resolveConfig: () => ({ configurado: true, url: 'https://example.invalid', publishableKey: 'test-placeholder' }),
    fetchImpl: async (url, options) => {
      if (new URL(url).hostname === PROVIDER_HOST) { provider.push(JSON.parse(options.body)); return geminiReply(typeof gemini === 'function' ? gemini(provider.length) : gemini); }
      const name = url.split('/').at(-1), args = options.body && JSON.parse(options.body);
      calls.push({ url, name, args });
      const data = url.endsWith('/auth/v1/user') ? { id: userId } : url.includes('/company_members?') ? (member ? [{ role }] : [])
        : name in rpc ? (typeof rpc[name] === 'function' ? rpc[name](args) : rpc[name]) : {};
      return { ok: true, json: async () => data };
    } });
  const run = async (body) => {
    let status, result;
    await handler({ method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer test-placeholder' }, body: { companyId, requestId, ...body } },
      { setHeader() {}, status(value) { status = value; return this; }, json(value) { result = value; } });
    return { status, body: result };
  };
  return { calls, provider, run, rpcs: () => calls.filter(c => c.url.includes('/rpc/')).map(c => c.name),
    prompt: (i = 0) => provider[i].contents.map(c => c.parts.map(p => p.text).join('')).join('\n'), system: (i = 0) => provider[i].systemInstruction.parts[0].text,
    last: (name) => calls.filter(c => c.name === name).at(-1)?.args };
}

// ------------------------------------------------------------------ painel
const read = path => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
function harness(path, mocks = {}, globals = {}) {
  const slots = []; let cursor = 0; const queue = [];
  const same = (a, b) => a && b && a.length === b.length && a.every((d, k) => Object.is(d, b[k]));
  const hookReact = { ...React,
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; },
    useMemo(fn, deps) { const i = cursor++; if (slots[i] && same(deps, slots[i].deps)) return slots[i].value; slots[i] = { deps, value: fn() }; return slots[i].value; },
    useEffect(fn, deps) { const i = cursor++; const prev = slots[i]; if (prev && same(deps, prev.deps)) return;
      const entry = slots[i] = { deps }; queue.push(() => { prev?.cleanup?.(); const cleanup = fn(); entry.cleanup = typeof cleanup === 'function' ? cleanup : undefined; }); },
  };
  const module = { exports: {} };
  vm.runInNewContext(transformSync(read(path), { loader: 'jsx', format: 'cjs' }).code, { module, exports: module.exports, AbortController, URL, URLSearchParams, ...globals,
    require(name) { if (name === 'react') return hookReact; if (name in mocks) return mocks[name]; return { __esModule: true, default: () => null }; } });
  return props => { cursor = 0; const tree = module.exports.default(props); queue.splice(0).forEach(run => run()); return tree; };
}
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
const content = tree => tree == null || typeof tree === 'boolean' ? '' : typeof tree !== 'object' ? String(tree) : Array.isArray(tree) ? tree.map(content).join('') : content(tree.props?.children);
const find = (tree, type, text) => nodes(tree).find(n => n.type === type && (text === undefined || content(n).includes(text)));
const findAll = (tree, type, text) => nodes(tree).filter(n => n.type === type && (text === undefined || content(n).includes(text)));
function panel(request, props = {}) {
  let ids = 0;
  const speech = { options: null, starts: 0, cancels: 0, stops: 0 };
  const render = harness('src/components/AssistantPanel.jsx', {
    '../lib/assistantTools': toolRegistry,
    '../lib/assistantApi': { requestAssistant: request, createAssistantRequestId: () => `30000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`, assistantFormInput: (_, values) => values },
    '../hooks/useSpeechInput': { __esModule: true, default: options => { speech.options = options;
      return { supported: true, cancel() { speech.cancels++; }, start() { speech.starts++; return true; }, stop() { speech.stops++; } }; } },
    'lucide-react': { Sparkles: 'span', Mic: 'span', X: 'span' },
  }, { document: { querySelector: () => null, body: { style: {} }, activeElement: null, addEventListener() {}, removeEventListener() {} }, MutationObserver: class { observe() {} disconnect() {} } });
  const state = { companyId, role: 'owner', ...props };
  const view = () => render(state);
  view(); find(view(), 'button').props.onClick();
  view.speech = speech;
  view.set = changes => Object.assign(state, changes);
  return view;
}
async function say(view, text) { find(view(), 'textarea').props.onChange({ target: { value: text } }); find(view(), 'form').props.onSubmit({ preventDefault() {} }); await tick(); }
const dictate = view => find(view(), 'button', 'Ditar').props.onClick();

test('voz no painel: a transcrição final envia um único pedido, mesmo se o hook concluir de novo', async () => {
  const calls = [];
  const view = panel(async payload => { calls.push(payload); return { question: 'Qual cliente?' }; });
  dictate(view);
  assert.equal(view.speech.starts, 1);
  view.speech.options.onComplete('Faz um orçamento para o Mauro com dois interfones e instalação');
  view.speech.options.onComplete('Faz um orçamento para o Mauro com dois interfones e instalação');
  await tick(); view();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].operation, 'plan');
  assert.equal(calls[0].text, 'Faz um orçamento para o Mauro com dois interfones e instalação');
});

test('voz no painel: editar o texto ou fechar cancela o ditado e nada é enviado', async () => {
  const calls = [];
  const view = panel(async payload => { calls.push(payload); return { question: 'x' }; });
  dictate(view);
  find(view(), 'textarea').props.onChange({ target: { value: 'Faz um orçamento' } });
  view.speech.options.onComplete('Faz um orçamento para o Mauro');
  await tick();
  assert.equal(calls.length, 0, 'ditado cancelado não envia');
  assert.ok(view.speech.cancels >= 1);
  dictate(view);
  const close = nodes(view()).find(n => n.type === 'button' && n.props['aria-label'] === 'Fechar assistente');
  close.props.onClick(); view();
  view.speech.options.onComplete('Cancela a OS do Mauro');
  await tick();
  assert.equal(calls.length, 0, 'painel fechado não envia');
});

// ------------------------------------------------------------------ Fase C · esclarecimento monetário
const TDMI = priceQuestion('create_product', 'Interfone TDMI');
const conversation = (first, question, answer) => `${first}\nPergunta: ${question}\nResposta: ${answer}`;
const product = (price) => ({ action: 'create_product', input: { name: 'Interfone TDMI', ...(price === undefined ? {} : { price }) } });

test('"Cadastre um interfone TDMI" sem preço vira pergunta do servidor, nunca faixa de erro nem preço inventado', async () => {
  assert.equal(TDMI, 'Qual é o preço de venda do produto "Interfone TDMI"? Informe o valor em reais.');
  for (const proposal of [product(), product(150)]) {
    const h = api({ gemini: proposal, rpc: { zt_assistant_plan: preview } });
    const r = await h.run({ operation: 'plan', text: 'Cadastre um interfone TDMI' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { question: TDMI });
    assert.equal(h.rpcs().includes('zt_assistant_plan'), false);
  }
});

test('resposta "150" à pergunta monetária do servidor vira R$ 150 no mesmo produto, e só nele', async () => {
  for (const answer of ['150', '150.', 'R$150', 'R$ 150', '150 reais', 'por 150', 'por 150 reais', 'custa 150', 'preço 150', 'é 150']) {
    const h = api({ gemini: product(150), rpc: { zt_assistant_plan: preview } });
    const r = await h.run({ operation: 'plan', text: conversation('Cadastre um interfone TDMI', TDMI, answer) });
    assert.equal(r.status, 200, answer);
    assert.deepEqual(h.last('zt_assistant_plan')?.p_input, { name: 'Interfone TDMI', price: 150 }, answer);
  }
  const service = priceQuestion('create_service', 'Instalação de interfone');
  const h = api({ gemini: { action: 'create_service', input: { name: 'Instalação de interfone', price: 180 } }, rpc: { zt_assistant_plan: preview } });
  await h.run({ operation: 'plan', text: conversation('Cadastre o serviço instalação de interfone', service, '180') });
  assert.deepEqual(h.last('zt_assistant_plan').p_input, { name: 'Instalação de interfone', price: 180 });
  const entry = api({ gemini: { action: 'create_financial_entry', input: { description: 'Manutenção Carmelo', amount: 320, dueDate: '2026-10-12', paid: false } }, rpc: { zt_assistant_plan: preview } });
  await entry.run({ operation: 'plan', text: conversation('Lança a receita da manutenção do Carmelo', entryAmountQuestion('Manutenção Carmelo'), '320') });
  assert.equal(entry.last('zt_assistant_plan').p_input.amount, 320);
});

test('número isolado não vira dinheiro fora da pergunta do servidor, com outra palavra, outra ação, outro nome ou pergunta antiga', async () => {
  const rejected = async (text, proposal = product(150), expected = TDMI) => {
    const h = api({ gemini: proposal, rpc: { zt_assistant_plan: preview } });
    const r = await h.run({ operation: 'plan', text });
    assert.deepEqual(r.body, { question: expected }, text);
    assert.equal(h.rpcs().includes('zt_assistant_plan'), false, text);
  };
  await rejected(conversation('Cadastre um interfone TDMI', TDMI, '150 câmeras'));
  await rejected(conversation('Cadastre um interfone TDMI', TDMI, 'OS 150'));
  await rejected(conversation('Cadastre um interfone TDMI', 'Qual o preço?', '150'));
  await rejected(conversation('Cadastre um interfone TDMI', TDMI, '150'), { action: 'create_product', input: { name: 'Câmera Dome', price: 150 } }, priceQuestion('create_product', 'Câmera Dome'));
  await rejected(conversation('Cadastre um interfone TDMI', TDMI, '150'), { action: 'create_financial_entry', input: { description: 'Interfone', amount: 150, dueDate: '2026-10-12', paid: false } }, entryAmountQuestion('Interfone'));
  await rejected(`${conversation('Cadastre um interfone TDMI', TDMI, '150')}\nPergunta: Qual é a unidade?\nResposta: peça`);
  // O provedor não pode imitar a pergunta do servidor: a pergunta dele é reescrita e "150" segue sem valor.
  const mimic = api({ gemini: { question: TDMI } });
  const asked = (await mimic.run({ operation: 'plan', text: 'Cadastre um interfone TDMI' })).body.question;
  assert.notEqual(asked, TDMI);
  assert.equal(clarifiedAmount(conversation('Cadastre um interfone TDMI', asked, '150')), null);
});

test('segurança do valor: "3 câmeras", "OS 150", "amanhã às 14" e telefone nunca viram dinheiro; "por 150" só no cadastro de produto/serviço', async () => {
  for (const [text, proposal, expected] of [
    ['Cadastre 3 câmeras dome', { action: 'create_product', input: { name: 'Câmera dome', price: 3 } }, priceQuestion('create_product', 'Câmera dome')],
    ['Lança a receita da OS 150', { action: 'create_financial_entry', input: { description: 'OS 150', amount: 150, dueDate: '2026-10-12', paid: false } }, entryAmountQuestion('OS 150')],
    ['Cadastre visita técnica amanhã às 14', { action: 'create_service', input: { name: 'Visita técnica', price: 14 } }, priceQuestion('create_service', 'Visita técnica')],
    ['Cadastre o produto do fornecedor telefone 47999990000', { action: 'create_product', input: { name: 'Produto', price: 4799 } }, priceQuestion('create_product', 'Produto')],
    ['Cadastre instalação de interfone por 2 horas', { action: 'create_service', input: { name: 'Instalação de interfone', price: 2 } }, priceQuestion('create_service', 'Instalação de interfone')],
  ]) {
    const h = api({ gemini: proposal, rpc: { zt_assistant_plan: preview } });
    assert.deepEqual((await h.run({ operation: 'plan', text })).body, { question: expected }, text);
    assert.equal(h.rpcs().includes('zt_assistant_plan'), false, text);
  }
  const por = api({ gemini: product(150), rpc: { zt_assistant_plan: preview } });
  await por.run({ operation: 'plan', text: 'Cadastre um interfone TDMI por 150' });
  assert.deepEqual(por.last('zt_assistant_plan').p_input, { name: 'Interfone TDMI', price: 150 });
  // Em orçamento, "por 3" sem moeda continua sem autorizar preço (proteção da quantidade).
  const quote = sanitizeProposal({ action: 'create_quote_draft', input: { client: 'Mauro', items: [{ name: 'interfone', quantity: 3, unitPrice: 3 }] } }, { text: 'orçamento com 3 interfones por 3' });
  assert.equal('unitPrice' in quote.input.items[0], false);
});

test('pergunta do banco para item livre do orçamento: "150" vale só para aquele item', () => {
  const question = 'Qual é o preço de "Visita técnica"? Itens livres não usam preço do catálogo.';
  const text = conversation('Faz um orçamento pro Mauro com duas câmeras e visita técnica', question, '150');
  const out = sanitizeProposal({ action: 'create_quote_draft', input: { client: 'Mauro', items: [
    { kind: 'product', name: 'câmera', quantity: 2, unitPrice: 150 }, { kind: 'free', name: 'Visita técnica', quantity: 1, unitPrice: 150 }] } }, { text });
  assert.deepEqual(out.input.items, [{ kind: 'product', name: 'câmera', quantity: 2 }, { kind: 'free', name: 'Visita técnica', quantity: 1, unitPrice: 150 }]);
  assert.ok(clarifiedAmount(text).cents.has(15000));
  assert.equal(sanitizeProposal({ action: 'create_quote_draft', input: { client: 'Mauro', unitPrice: 3, description: 'Interfone', quantity: 3 } }, { text: 'orçamento de 3 interfones' }).question, AMOUNT_QUESTION);
});

test('dado obrigatório ausente na linguagem natural vira pergunta, não erro', async () => {
  for (const [proposal, expected] of [
    [{ action: 'create_client', input: {} }, 'Qual é o nome do cliente?'],
    [{ action: 'create_product', input: { price: 150 } }, 'Qual é o nome do produto?'],
    [{ action: 'schedule_work_order', input: { date: '2026-10-13', time: '14:00' } }, 'Qual atendimento? Informe o número da OS ou o nome do cliente.'],
    [{ action: 'create_work_order', input: { client: 'Mauro' } }, 'Qual serviço deve ser feito na OS?'],
    [{ action: 'create_quote_draft', input: { items: [{ name: 'câmera', quantity: 1 }] } }, 'Para qual cliente é o orçamento?'],
  ]) {
    const h = api({ gemini: proposal, rpc: { zt_assistant_plan: preview } });
    const r = await h.run({ operation: 'plan', text: 'pedido incompleto' });
    assert.equal(r.status, 200, JSON.stringify(proposal));
    assert.deepEqual(r.body, { question: expected }, JSON.stringify(proposal));
    assert.equal(h.rpcs().includes('zt_assistant_plan'), false);
  }
  assert.equal(missingFieldQuestion('owner_find_client', {}), 'Para continuar, informe: Nome do cliente.');
  // O formulário manual continua validando por erro: a pergunta é só da linguagem natural.
  const manual = api({ rpc: { zt_assistant_plan: preview } });
  assert.equal((await manual.run({ operation: 'preview', action: 'create_client', input: {} })).status, 422);
});

test('painel monta "Pergunta/Resposta" exatamente no formato que o servidor reconhece', async () => {
  const calls = [];
  const view = panel(async payload => { calls.push(payload); return calls.length === 1 ? { question: TDMI } : { ...preview, requestId: payload.requestId, action: 'create_product' }; });
  await say(view, 'Cadastre um interfone TDMI');
  await say(view, '150');
  assert.equal(calls[1].text, conversation('Cadastre um interfone TDMI', TDMI, '150'));
  assert.ok(clarifiedAmount(calls[1].text).cents.has(15000));
});

// ------------------------------------------------------------------ Fases D/E · histórico do cliente e consultas do proprietário
const carmeloId = '50000000-0000-4000-8000-000000000011';
const foreignClient = '50000000-0000-4000-8000-000000000099';
const wo41 = '60000000-0000-4000-8000-000000000041';
const clientRef = { type: 'client', id: carmeloId };
const clientContext = { type: 'client', label: 'Residencial Carmelo', context: { type: 'client', name: 'Residencial Carmelo' } };
const orderContext = { type: 'work_order', label: 'OS-0041 · Residencial Carmelo', context: { type: 'work_order', number: 'OS-0041', client: 'Residencial Carmelo', status: 'concluída' } };
const READS = ['owner_client_history', 'owner_work_order_details', 'owner_client_equipment', 'owner_client_warranties', 'owner_expiring_warranties',
  'owner_week_schedule', 'owner_day_schedule', 'owner_unscheduled_work_orders', 'owner_stock_level', 'owner_low_stock', 'owner_stock_movements',
  'owner_recent_purchases', 'owner_purchases_due', 'owner_product_purchases', 'owner_maintenance_contracts', 'owner_contracts_due',
  'owner_post_sale_due', 'owner_inactive_clients', 'owner_finance_summary', 'owner_receivables', 'owner_overdue_clients', 'owner_operational_report'];
const historyResult = (items, extra = {}) => ({ requestId, action: 'owner_client_history', confirmationRequired: false,
  result: { items, message: 'Últimos atendimentos concluídos de Residencial Carmelo.', subject: { id: carmeloId, entityType: 'client', title: 'Residencial Carmelo' }, ...extra } });
const card = (id, number, detail) => ({ id, entityType: 'work_order', number, title: `${number} · Residencial Carmelo`, detail });

test('registro: 22 consultas só do proprietário, somente leitura em zt_assistant_read, escolha do cliente oculta do provedor', async () => {
  for (const name of READS) {
    const tool = toolRegistry.findAssistantTool(name);
    assert.deepEqual(tool.roles, ['owner'], name);
    assert.equal(tool.confirmationRequired, false, name);
    assert.equal(tool.executor, 'zt_assistant_read', name);
    assert.equal(tool.inputSchema.additionalProperties, false, name);
  }
  assert.equal(toolRegistry.toolsForRole('technician').some(t => READS.includes(t.name)), false);
  assert.deepEqual(toolRegistry.validateAssistantInput('owner_client_history', { client: 'Carmelo', limit: 10 }, 'owner'), { client: 'Carmelo', limit: 10 });
  for (const input of [{ client: 'Carmelo', limit: 11 }, { client: 'Carmelo', limit: 2.5 }, { client: 'Carmelo', clientRef: 'x' }, { client: 'Carmelo', cost: 1 }]) {
    assert.throws(() => toolRegistry.validateAssistantInput('owner_client_history', input, 'owner'), undefined, JSON.stringify(input));
  }
  assert.throws(() => toolRegistry.validateAssistantInput('owner_finance_summary', { month: '2026-13' }, 'owner'), /Mês inválido/);
  assert.throws(() => toolRegistry.validateAssistantInput('owner_client_history', { client: 'Carmelo' }, 'technician'), /não permitida/);
  const h = api({ gemini: { question: 'x' } });
  await h.run({ operation: 'plan', text: 'me fala algo do Carmelo' });
  assert.doesNotMatch(h.system(), /clientRef/);
  assert.match(h.system(), /owner_client_history/);
  assert.match(h.system(), /Nunca calcule, some ou estime valores/);
});

test('"Puxe o histórico desse cliente": referência revalidada no banco e consulta sem provedor nem quota', async () => {
  const h = api({ gemini: () => assert.fail('provedor não deve ser chamado'), rpc: { zt_assistant_reference: clientContext,
    zt_assistant_read: historyResult([card(wo41, 'OS-0041', '05/10/2026 · concluída · Técnico: João'), card('60000000-0000-4000-8000-000000000032', 'OS-0032', 'x'), card('60000000-0000-4000-8000-000000000019', 'OS-0019', 'y')]) } });
  const r = await h.run({ operation: 'plan', text: 'Puxe o histórico desse cliente.', activeReference: clientRef });
  assert.equal(r.status, 200);
  assert.equal(r.body.result.items.length, 3);
  assert.deepEqual(h.rpcs(), ['zt_assistant_reference', 'zt_assistant_read']);
  assert.deepEqual(h.last('zt_assistant_read'), { p_company: companyId, p_action: 'owner_client_history',
    p_input: { client: 'Residencial Carmelo', clientRef: carmeloId, limit: 3 }, p_request_id: requestId });
  assert.equal(h.provider.length, 0);
});

test('continuidade: último atendimento, técnico, equipamento, últimos 10 e garantia ativa usam a referência real', async () => {
  const cases = [
    ['O que foi feito no último?', clientContext, 'owner_client_history', { client: 'Residencial Carmelo', clientRef: carmeloId, limit: 1 }],
    ['Quem foi o técnico?', clientContext, 'owner_client_history', { client: 'Residencial Carmelo', clientRef: carmeloId, limit: 1 }],
    ['Qual foi o último problema relatado?', clientContext, 'owner_client_history', { client: 'Residencial Carmelo', clientRef: carmeloId, limit: 1 }],
    ['Qual equipamento foi instalado?', clientContext, 'owner_client_equipment', { client: 'Residencial Carmelo', clientRef: carmeloId }],
    ['Mostra os últimos 10.', clientContext, 'owner_client_history', { client: 'Residencial Carmelo', clientRef: carmeloId, limit: 10 }],
    ['Mostra os últimos 25', clientContext, 'owner_client_history', { client: 'Residencial Carmelo', clientRef: carmeloId, limit: 10 }],
    ['Tem alguma garantia ativa?', clientContext, 'owner_client_warranties', { client: 'Residencial Carmelo', clientRef: carmeloId }],
    ['Quem foi o técnico?', orderContext, 'owner_work_order_details', { workOrder: 'OS-0041' }],
    ['Qual equipamento foi instalado?', orderContext, 'owner_work_order_details', { workOrder: 'OS-0041' }],
    ['Mostra os últimos 10', orderContext, 'owner_client_history', { client: 'Residencial Carmelo', limit: 10 }],
    ['Tem alguma garantia ativa?', orderContext, 'owner_client_warranties', { client: 'Residencial Carmelo' }],
  ];
  for (const [text, reference, action, input] of cases) {
    const h = api({ gemini: () => assert.fail('sem provedor'), rpc: { zt_assistant_reference: reference, zt_assistant_read: { confirmationRequired: false, result: { items: [], message: 'ok' } } } });
    const r = await h.run({ operation: 'plan', text, activeReference: reference.type === 'client' ? clientRef : { type: 'work_order', id: wo41 } });
    assert.equal(r.status, 200, text);
    assert.equal(h.last('zt_assistant_read')?.p_action, action, text);
    assert.deepEqual(h.last('zt_assistant_read').p_input, input, text);
  }
});

test('referência inválida, de outro tenant ou arquivada: é esquecida e o Assistente pede o contexto, sem consultar nada', async () => {
  for (const denied of [{ error: 'A referência não está mais disponível.', code: 'ACCESS_DENIED' }, { type: 'client', context: { type: 'client', name: 'X', id: foreignClient } }]) {
    const h = api({ gemini: () => assert.fail('sem provedor'), rpc: { zt_assistant_reference: denied } });
    const r = await h.run({ operation: 'plan', text: 'Puxe o histórico desse cliente', activeReference: { type: 'client', id: foreignClient } });
    assert.equal(r.status, 200);
    assert.equal(r.body.referenceCleared, true);
    assert.match(r.body.question, /Qual cliente ou OS\?/);
    assert.deepEqual(h.rpcs(), ['zt_assistant_reference']);
  }
  // Sem referência, a frase não vira consulta local: segue para o provedor, que pergunta.
  const none = api({ gemini: { question: 'De qual cliente você quer o histórico?' } });
  assert.equal((await none.run({ operation: 'plan', text: 'Puxe o histórico desse cliente' })).body.question, 'De qual cliente você quer o histórico?');
});

test('técnico, outra empresa e anon não chegam às consultas do proprietário', async () => {
  const tech = api({ role: 'technician', gemini: { action: 'owner_client_history', input: { client: 'Residencial Carmelo' } }, rpc: { zt_assistant_reference: clientContext } });
  const r = await tech.run({ operation: 'plan', text: 'Puxe o histórico desse cliente', activeReference: clientRef });
  assert.equal(r.status, 403);
  assert.equal(tech.rpcs().includes('zt_assistant_read'), false);
  const outsider = api({ member: false, gemini: { action: 'owner_finance_summary', input: {} } });
  assert.equal((await outsider.run({ operation: 'plan', text: 'resumo financeiro' })).status, 403);
  assert.equal(outsider.rpcs().length, 0);
  // Banco nega (assinatura inválida, membership desativada): falha fechada, sem resultado parcial.
  const denied = api({ gemini: { action: 'owner_finance_summary', input: {} }, rpc: { zt_assistant_read: { error: 'Não foi possível consultar agora.', code: 'ACCESS_DENIED' } } });
  const d = await denied.run({ operation: 'plan', text: 'Qual resultado deste mês?' });
  assert.equal(d.status, 403); assert.equal(d.body.result, undefined);
});

test('provedor: "Procure Residencial Carmelo" busca pelo nome; clientRef inventado sai; resultado da consulta nunca vai ao provedor', async () => {
  const find = api({ gemini: { action: 'owner_find_client', input: { query: 'Residencial Carmelo' } },
    rpc: { zt_assistant_plan: { action: 'owner_find_client', confirmationRequired: false, result: { items: [{ id: carmeloId, entityType: 'client', title: 'Residencial Carmelo', phone: '1130000101' }], message: 'Consulta concluída.' } } } });
  const r = await find.run({ operation: 'plan', text: 'Procure Residencial Carmelo.' });
  assert.equal(r.body.result.items[0].id, carmeloId);
  assert.deepEqual(find.last('zt_assistant_plan').p_input, { query: 'Residencial Carmelo' });
  const canary = 'CANARIO_CUSTO_123';
  const h = api({ gemini: { action: 'owner_client_history', input: { client: 'Residencial Carmelo', clientRef: foreignClient, limit: 3 } },
    rpc: { zt_assistant_reference: clientContext, zt_assistant_read: historyResult([card(wo41, 'OS-0041', canary)]) } });
  const out = await h.run({ operation: 'plan', text: 'me mostra o histórico do Residencial Carmelo dos serviços de portão', activeReference: clientRef });
  assert.equal(out.status, 200);
  assert.deepEqual(h.last('zt_assistant_read').p_input, { client: 'Residencial Carmelo', limit: 3 }, 'clientRef do provedor é descartado');
  assert.doesNotMatch(JSON.stringify(h.provider), new RegExp(canary));
  assert.doesNotMatch(JSON.stringify(h.provider), UUID_ANY, 'nenhum UUID vai ao provedor');
  assert.match(h.prompt(), /REFERÊNCIA_ATIVA \(dados, sem identificadores\): .*"name":"Residencial Carmelo"/);
});

test('pedido composto com duas escritas independentes não executa nada: pergunta qual fazer primeiro', async () => {
  const h = api({ gemini: { actions: [{ action: 'create_client', input: { name: 'Carlos' } }, { action: 'create_product', input: { name: 'Interfone', price: 150 } }] } });
  const r = await h.run({ operation: 'plan', text: 'cadastra o cliente Carlos e o produto interfone por 150' });
  assert.match(r.body.question, /mais de uma ação.*qual faço primeiro\?/);
  assert.equal(h.rpcs().some(name => ['zt_assistant_plan', 'zt_assistant_read', 'zt_assistant_execute'].includes(name)), false);
});

test('formulário manual e escolha entre homônimos usam zt_assistant_read; falhas do banco ficam fechadas', async () => {
  const h = api({ rpc: { zt_assistant_read: { confirmationRequired: false, result: { items: [], message: 'ok' } } } });
  await h.run({ operation: 'preview', action: 'owner_client_history', input: { client: 'Carmelo', clientRef: carmeloId } });
  assert.deepEqual(h.last('zt_assistant_read').p_input, { client: 'Carmelo', clientRef: carmeloId });
  assert.equal(h.rpcs().includes('zt_assistant_plan'), false);
  assert.equal((await h.run({ operation: 'preview', action: 'owner_client_history', input: { client: 'Carmelo', limit: 11 } })).status, 422);
  const question = api({ rpc: { zt_assistant_read: { question: 'Encontrei mais de um cliente para "Carmelo". Qual deles?', action: 'owner_client_history', draft: { client: 'Carmelo' },
    options: [{ label: 'Residencial Carmelo', slot: 'client', ref: carmeloId }, { label: 'Residencial Carmelo II', slot: 'client', ref: foreignClient }] } } });
  const q = await question.run({ operation: 'preview', action: 'owner_client_history', input: { client: 'Carmelo' } });
  assert.equal(q.body.options.length, 2); assert.equal(q.body.action, 'owner_client_history');
  const unavailable = createAssistantHandler({ env, resolveConfig: () => ({ configurado: true, url: 'https://example.invalid', publishableKey: 'test-placeholder' }),
    fetchImpl: async (url) => url.endsWith('/auth/v1/user') ? { ok: true, json: async () => ({ id: userId }) } : url.includes('/company_members?') ? { ok: true, json: async () => [{ role: 'owner' }] }
      : { ok: false, status: 404, json: async () => ({ message: 'function not found' }) } });
  let status, body;
  await unavailable({ method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer test-placeholder' }, body: { companyId, requestId, operation: 'preview', action: 'owner_low_stock', input: {} } },
    { setHeader() {}, status(value) { status = value; return this; }, json(value) { body = value; } });
  assert.equal(status, 503, 'RPC ausente (0096 não aplicada) falha fechada');
  assert.match(body.error, /ainda não habilitado/);
});

test('painel: histórico mostra os registros reais, mantém o cliente como assunto e o último atendimento vira a OS de referência', async () => {
  const calls = [];
  const view = panel(async payload => { calls.push(payload);
    if (calls.length === 1) return { action: 'owner_find_client', confirmationRequired: false, result: { items: [{ id: carmeloId, entityType: 'client', title: 'Residencial Carmelo', detail: 'Rua do Carmelo, 1' }], message: 'Consulta concluída.' } };
    if (calls.length === 2) return historyResult([card(wo41, 'OS-0041', '05/10/2026 · concluída · Técnico: João\nRelato: ajuste da central e testes'), card('60000000-0000-4000-8000-000000000032', 'OS-0032', '18/09/2026'), card('60000000-0000-4000-8000-000000000019', 'OS-0019', '02/08/2026')]);
    if (calls.length === 3) return historyResult([card(wo41, 'OS-0041', '05/10/2026 · concluída · Técnico: João')], { message: 'Último atendimento concluído de Residencial Carmelo.' });
    return { action: 'owner_finance_summary', confirmationRequired: false, result: { items: [{ title: 'Faturado', detail: 'R$ 800,00 · receitas com vencimento no mês' }], message: 'Resumo financeiro de outubro de 2026.' } };
  });
  await say(view, 'Procure Residencial Carmelo.');
  assert.match(content(view()), /Falando sobre: Residencial Carmelo/);
  await say(view, 'Puxe o histórico desse cliente.');
  assert.deepEqual({ ...calls[1].activeReference }, { type: 'client', id: carmeloId });
  assert.match(content(view()), /OS-0041.*OS-0032.*OS-0019/s);
  assert.match(content(view()), /Falando sobre: Residencial Carmelo/, 'três atendimentos: o cliente continua como assunto');
  assert.equal(findAll(view(), 'button', 'Abrir registro').length, 3, 'cada OS pode ser aberta');
  assert.ok(nodes(view()).some(n => n.type === 'p' && /whitespace-pre-line/.test(n.props.className || '') && content(n).includes('Relato: ajuste da central')));
  await say(view, 'O que foi feito no último?');
  assert.deepEqual({ ...calls[2].activeReference }, { type: 'client', id: carmeloId });
  assert.match(content(view()), /Falando sobre: OS-0041/, 'o último atendimento vira a referência para "quem foi o técnico?"');
  await say(view, 'Qual resultado deste mês?');
  assert.equal(findAll(view(), 'button', 'Abrir registro').length, 0, 'linha de relatório não tem botão de abrir');
  assert.match(content(view()), /Faturado/);
});

// ------------------------------------------------------------------ Fase F · escritas canônicas
const WRITES = ['owner_convert_quote_to_work_order', 'owner_adjust_stock', 'owner_create_warranty', 'owner_update_post_sale'];

test('escritas novas: só proprietário, sempre com prévia e confirmação, contrato fechado', () => {
  assert.deepEqual([...toolRegistry.OWNER_WRITES], WRITES);
  for (const name of WRITES) {
    const tool = toolRegistry.findAssistantTool(name);
    assert.deepEqual(tool.roles, ['owner'], name);
    assert.equal(tool.confirmationRequired, true, name);
    assert.equal(tool.executor, 'zt_assistant_plan -> zt_assistant_execute', name);
    assert.equal(tool.inputSchema.additionalProperties, false, name);
  }
  const v = (action, input) => toolRegistry.validateAssistantInput(action, input, 'owner');
  assert.deepEqual(v('owner_adjust_stock', { product: 'Câmera Dome', quantity: 2, direction: 'out', notes: '' }), { product: 'Câmera Dome', quantity: 2, direction: 'out' });
  assert.throws(() => v('owner_adjust_stock', { product: 'Câmera Dome', quantity: 2, direction: 'sideways' }), /Opção inválida/);
  assert.throws(() => v('owner_adjust_stock', { product: 'Câmera Dome', quantity: 0, direction: 'in' }), /fora do limite/);
  assert.throws(() => v('owner_convert_quote_to_work_order', { quote: 'ORC-0003', time: '09:00' }), /data junto com o horário/);
  assert.throws(() => v('owner_create_warranty', { client: 'Carmelo', kind: 'service', description: 'Instalação' }), /prazo em meses ou a data final/);
  assert.throws(() => v('owner_update_post_sale', { client: 'Carmelo', status: 'reaberto' }), /Opção inválida/);
  assert.throws(() => toolRegistry.validateAssistantInput('owner_adjust_stock', { product: 'x', quantity: 1, direction: 'in' }, 'technician'), /não permitida/);
  assert.match(read('src/components/AssistantPanel.jsx'), /const SENSITIVE = \[[^\]]*'owner_adjust_stock'/);
});

test('linguagem natural das escritas: prévia sem execução, quantidade nunca vira valor e dado ausente vira pergunta', async () => {
  for (const [text, proposal] of [
    ['Gera a OS do ORC-0003 para amanhã às 9', { action: 'owner_convert_quote_to_work_order', input: { quote: 'ORC-0003', date: '2026-10-13', time: '09:00' } }],
    ['Tira 2 câmeras dome do estoque', { action: 'owner_adjust_stock', input: { product: 'câmera dome', quantity: 2, direction: 'out' } }],
    ['Registra garantia de 12 meses da instalação no Carmelo', { action: 'owner_create_warranty', input: { client: 'Carmelo', kind: 'service', description: 'Instalação', months: 12 } }],
    ['Marca o pós-venda do Carmelo como feito', { action: 'owner_update_post_sale', input: { client: 'Carmelo', status: 'done' } }],
  ]) {
    const h = api({ gemini: proposal, rpc: { zt_assistant_plan: { ...preview, action: proposal.action } } });
    const r = await h.run({ operation: 'plan', text });
    assert.equal(r.body.confirmationRequired, true, text);
    assert.deepEqual(h.last('zt_assistant_plan').p_input, proposal.input, text);
    assert.equal(h.rpcs().includes('zt_assistant_execute'), false, text);
  }
  for (const [proposal, question] of [
    [{ action: 'owner_adjust_stock', input: { product: 'câmera dome', quantity: 2 } }, 'É entrada ou saída de estoque?'],
    [{ action: 'owner_create_warranty', input: { client: 'Carmelo', kind: 'service', description: 'Instalação' } }, 'Qual é o prazo da garantia? Informe em meses ou a data final.'],
    [{ action: 'owner_update_post_sale', input: { client: 'Carmelo' } }, 'Devo concluir ou dispensar o pós-venda?'],
  ]) {
    const h = api({ gemini: proposal, rpc: { zt_assistant_plan: preview } });
    assert.deepEqual((await h.run({ operation: 'plan', text: 'pedido incompleto' })).body, { question });
    assert.equal(h.rpcs().includes('zt_assistant_plan'), false);
  }
  const tech = api({ role: 'technician', gemini: { action: 'owner_adjust_stock', input: { product: 'câmera dome', quantity: 2, direction: 'out' } } });
  assert.equal((await tech.run({ operation: 'plan', text: 'tira 2 câmeras do estoque' })).status, 403);
  assert.equal(tech.rpcs().includes('zt_assistant_plan'), false);
  const h = api({ gemini: { question: 'x' } });
  await h.run({ operation: 'plan', text: 'muda o telefone do Carmelo' });
  assert.match(h.system(), /Editar cadastro de cliente, local, produto, serviço ou contrato, aprovar orçamento, lançar compra, dar baixa em recebimento e vender em campo ainda não são feitos pelo Assistente/);
  assert.match(h.system(), /quantity é quantidade, nunca valor/);
});

test('painel: ajuste de estoque exige a confirmação reforçada; OS gerada vira a referência ativa', async () => {
  const calls = [];
  const view = panel(async payload => { calls.push(payload);
    if (payload.operation === 'execute') return calls.filter(c => c.operation === 'execute').length === 1
      ? { result: { entityType: 'product', id: '70000000-0000-4000-8000-000000000001', message: 'Ação concluída.' } }
      : { result: { entityType: 'work_order', id: wo41, number: 'OS-0041', message: 'Ação concluída.' } };
    return calls.length === 1 ? { ...preview, requestId: payload.requestId, action: 'owner_adjust_stock', preview: [{ label: 'Estoque após o ajuste', value: '7 unidade' }] }
      : { ...preview, requestId: payload.requestId, action: 'owner_convert_quote_to_work_order', preview: [{ label: 'Orçamento', value: 'ORC-0003' }] };
  });
  await say(view, 'Tira 3 câmeras dome do estoque');
  find(view(), 'button', 'Confirmar').props.onClick(); await tick();
  assert.equal(calls.filter(c => c.operation === 'execute').length, 0, 'sem a marcação reforçada não confirma');
  find(view(), 'input').props.onChange({ target: { checked: true } });
  find(view(), 'button', 'Confirmar').props.onClick(); await tick();
  assert.equal(calls.filter(c => c.operation === 'execute').length, 1);
  find(view(), 'button', 'Nova solicitação').props.onClick();
  await say(view, 'Gera a OS do ORC-0003');
  find(view(), 'button', 'Confirmar').props.onClick(); await tick();
  assert.equal(calls.filter(c => c.operation === 'execute').length, 2, 'gerar OS usa a confirmação normal');
  assert.match(content(view()), /Falando sobre: OS-0041/);
});
