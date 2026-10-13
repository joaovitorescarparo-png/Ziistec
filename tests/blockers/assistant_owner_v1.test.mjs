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
