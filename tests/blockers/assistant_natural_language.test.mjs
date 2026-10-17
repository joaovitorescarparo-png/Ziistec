import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import React from 'react';
import { transformSync } from 'esbuild';
import * as toolRegistry from '../../src/lib/assistantTools.js';
import * as unsavedChanges from '../../src/lib/unsavedChanges.js';
import { createAssistantHandler } from '../../api/assistant.js';
import { PROVIDER_ID_QUESTION, inferAssistantPlan } from '../../api/_assistantPlanner.js';
import { GEMINI_API_BASE } from '../../api/_aiGateway.js';

// Bloco 2 · linguagem natural. Propostas do provedor são fixtures: provam fronteiras da API/UI,
// não a precisão do modelo. Catálogo, preços, tenant e confirmação única são provados no SQL 0094.
const companyId = '10000000-0000-4000-8000-000000000001';
const userId = '20000000-0000-4000-8000-000000000002';
const requestId = '30000000-0000-4000-8000-000000000003';
const nextRequestId = '30000000-0000-4000-8000-000000000004';
const clientA = '40000000-0000-4000-8000-000000000005';
const clientB = '40000000-0000-4000-8000-000000000006';
const workOrderId = '50000000-0000-4000-8000-000000000007';
const paidEnv = { ENABLE_EXTERNAL_AI: 'true', AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'test-placeholder' };
const read = path => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
const quoteItems = [{ kind: 'product', name: 'câmera', quantity: 2 }, { kind: 'service', name: 'instalação', quantity: 1 }];
const preview = (id, extra = {}) => ({ requestId: id, action: 'create_quote_draft', previewHash: 'a'.repeat(64), previewVersion: 1, confirmationRequired: true,
  preview: [{ label: 'Cliente', value: 'Mauro Silva' }, { label: 'Total', value: 'R$ 650,00' }], ...extra });

function api({ role = 'owner', proposal, rpc = {}, paid = true } = {}) {
  const calls = [], inference = [];
  const handler = createAssistantHandler({ env: paid ? paidEnv : {},
    resolveConfig: () => ({ configurado: true, url: 'https://example.invalid', publishableKey: 'test-placeholder' }),
    infer: async args => { inference.push(args); return typeof proposal === 'function' ? proposal(args) : proposal; },
    fetchImpl: async (url, options) => {
      const name = url.split('/').at(-1), args = options.body && JSON.parse(options.body);
      calls.push({ url, name, args });
      const data = url.endsWith('/auth/v1/user') ? { id: userId } : url.includes('/company_members?') ? [{ role }]
        : name in rpc ? (typeof rpc[name] === 'function' ? rpc[name](args) : rpc[name]) : {};
      return { ok: true, json: async () => data };
    } });
  const run = async body => {
    let status, result;
    await handler({ method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer test-placeholder' }, body: { companyId, requestId, ...body } },
      { setHeader() {}, status(value) { status = value; return this; }, json(value) { result = value; } });
    return { status, body: result };
  };
  return { calls, inference, run, rpcs: () => calls.filter(c => c.url.includes('/rpc/')).map(c => c.name) };
}

// Hooks determinísticos com efeitos de verdade (deps comparadas), sem navegador nem backend.
function harness(path, mocks = {}, globals = {}) {
  const slots = []; let cursor = 0; const queue = [];
  const same = (a, b) => a && b && a.length === b.length && a.every((d, k) => Object.is(d, b[k]));
  const hookReact = { ...React,
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; },
    useMemo(fn, deps) { const i = cursor++; if (slots[i] && same(deps, slots[i].deps)) return slots[i].value; slots[i] = { deps, value: fn() }; return slots[i].value; },
    useCallback(fn, deps) { return hookReact.useMemo(() => fn, deps); },
    useEffect(fn, deps) { const i = cursor++; const prev = slots[i]; if (prev && same(deps, prev.deps)) return;
      const entry = slots[i] = { deps }; queue.push(() => { prev?.cleanup?.(); const cleanup = fn(); entry.cleanup = typeof cleanup === 'function' ? cleanup : undefined; }); },
    lazy(loader) { const Lazy = () => null; Lazy.source = String(loader); return Lazy; },
  };
  const module = { exports: {} };
  vm.runInNewContext(transformSync(read(path), { loader: 'jsx', format: 'cjs' }).code, { module, exports: module.exports, AbortController, URL, URLSearchParams, ...globals,
    require(name) { if (name === 'react') return hookReact; if (name in mocks) return mocks[name]; return { __esModule: true, default: () => null }; } });
  return props => { cursor = 0; const tree = module.exports.default(props); queue.splice(0).forEach(run => run()); return tree; };
}
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
function content(tree) {
  if (tree == null || typeof tree === 'boolean') return '';
  if (typeof tree !== 'object') return String(tree);
  if (Array.isArray(tree)) return tree.map(content).join('');
  return content(tree.props?.children);
}
const find = (tree, type, text) => nodes(tree).find(n => n.type === type && (text === undefined || content(n).includes(text)));
const browserGlobals = (extra = {}) => ({
  document: { querySelector: () => null, body: { style: {} }, activeElement: null, addEventListener() {}, removeEventListener() {} },
  MutationObserver: class { observe() {} disconnect() {} }, ...extra,
});

function panel(request, { role = 'owner', props = {}, globals = {} } = {}) {
  let ids = 0;
  const render = harness('src/components/AssistantPanel.jsx', {
    '../lib/assistantTools': toolRegistry,
    '../lib/assistantApi': { requestAssistant: request, createAssistantRequestId: () => `30000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`, assistantFormInput: (_, values) => values },
    '../hooks/useSpeechInput': { __esModule: true, default: () => ({ supported: true, cancel() {}, start() {}, stop() {} }) },
    'lucide-react': { Sparkles: 'span', Mic: 'span', X: 'span' },
  }, browserGlobals(globals));
  const state = { companyId, role, ...props };
  const view = () => render(state);
  view();
  find(view(), 'button').props.onClick();
  view.set = changes => Object.assign(state, changes);
  return view;
}
const typeText = (view, text) => find(view(), 'textarea').props.onChange({ target: { value: text } });
const submit = view => find(view(), 'form').props.onSubmit({ preventDefault() {} });
async function say(view, text) { typeText(view, text); submit(view); await tick(); }

test('fala natural de orçamento vira itens por nome; a API só prepara a prévia e não executa', async () => {
  const phrase = 'Faz um orçamento pro Mauro com duas câmeras e instalação.';
  const h = api({ proposal: { action: 'create_quote_draft', input: { client: 'Mauro', items: quoteItems } }, rpc: { zt_assistant_plan: preview(requestId) } });
  const r = await h.run({ operation: 'plan', text: phrase });
  assert.equal(r.status, 200); assert.equal(r.body.confirmationRequired, true);
  assert.equal(h.inference[0].text, phrase);
  assert.deepEqual(h.rpcs(), ['zt_assistant_consume_ai_quota', 'zt_assistant_plan']);
  assert.deepEqual(h.calls.at(-1).args.p_input, { client: 'Mauro', items: quoteItems });
  // O provedor recebe o contrato de itens sem campos de ID e a regra de preço explícito.
  let request;
  await inferAssistantPlan({ text: phrase, role: 'owner', env: paidEnv, fetchImpl: async (url, options) => {
    assert.equal(url, `${GEMINI_API_BASE}gemini-3.5-flash-lite:generateContent`); request = JSON.parse(options.body);
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"question":"ok"}' }] } }] }) };
  } });
  const system = request.systemInstruction.parts[0].text;
  const quoteTool = JSON.parse(system.split('Ferramentas: ')[1]).find(t => t.name === 'create_quote_draft');
  assert.deepEqual(Object.keys(quoteTool.inputSchema.properties.items.items.properties).sort(), ['kind', 'name', 'quantity', 'unit', 'unitPrice']);
  assert.doesNotMatch(JSON.stringify(quoteTool), /Ref|"ref"|Id"/);
  assert.match(system, /unitPrice somente se o usuário disse o valor/);
  assert.match(system, /Nunca escolha entre registros ambíguos/);
});

test('cliente ambíguo e item inexistente voltam como pergunta; opções são do tenant e o rascunho volta sem prévia', async () => {
  const draft = { client: 'Mauro', items: quoteItems };
  const h = api({ proposal: { action: 'create_quote_draft', input: draft }, rpc: { zt_assistant_plan: { question: 'Encontrei mais de um cliente para "Mauro". Qual deles?', action: 'create_quote_draft', draft,
    options: [{ label: 'Mauro Silva · 1130000001', slot: 'client', ref: clientA }, { label: 'Mauro Souza', slot: 'client', ref: clientB }, { label: 'injeção', slot: 'drop', ref: 'x' }] } } });
  const r = await h.run({ operation: 'plan', text: 'Orçamento pro Mauro com duas câmeras e instalação' });
  assert.equal(r.status, 200); assert.equal(r.body.previewHash, undefined);
  assert.deepEqual(r.body.options.map(o => o.ref), [clientA, clientB], 'opção malformada é descartada');
  assert.deepEqual(r.body.draft, draft);
  // Escolha tocada pelo usuário: mesmo rascunho + referência; sem provedor e sem quota.
  const choice = api({ rpc: { zt_assistant_plan: preview(nextRequestId) } });
  const chosen = await choice.run({ operation: 'preview', requestId: nextRequestId, action: 'create_quote_draft', input: { ...draft, clientRef: clientB } });
  assert.equal(chosen.body.confirmationRequired, true);
  assert.deepEqual(choice.rpcs(), ['zt_assistant_plan']);
  assert.equal(choice.calls.at(-1).args.p_input.clientRef, clientB);
  assert.equal(choice.inference.length, 0);
  const missing = api({ proposal: { action: 'create_quote_draft', input: { client: 'Ana', items: [{ kind: 'product', name: 'drone', quantity: 1 }] } },
    rpc: { zt_assistant_plan: { question: 'Não encontrei "drone" no catálogo de produtos. Quer usar um item livre informando o preço ou cadastrar primeiro?' } } });
  const none = await missing.run({ operation: 'plan', text: 'Orçamento para a Ana com um drone' });
  assert.deepEqual(none.body, { question: 'Não encontrei "drone" no catálogo de produtos. Quer usar um item livre informando o preço ou cadastrar primeiro?' });
});

test('provedor não consegue fornecer IDs nem campos fora do contrato; técnico não usa orçamento', async () => {
  for (const input of [{ client: 'Mauro', clientRef: clientA, items: quoteItems }, { client: 'Mauro', items: [{ name: 'câmera', quantity: 1, ref: clientA }] }]) {
    const h = api({ proposal: { action: 'create_quote_draft', input } });
    const r = await h.run({ operation: 'plan', text: 'Orçamento pro Mauro' });
    assert.deepEqual(r.body, { question: PROVIDER_ID_QUESTION });
    assert.equal(h.rpcs().includes('zt_assistant_plan'), false);
  }
  const uuidClient = api({ proposal: { action: 'create_work_order', input: { client: clientA, description: 'Instalar câmera' } } });
  assert.deepEqual((await uuidClient.run({ operation: 'plan', text: 'Cria uma OS' })).body, { question: PROVIDER_ID_QUESTION });
  for (const item of [{ name: 'câmera', quantity: 1, productId: 'abc' }, { name: 'câmera', quantity: 1, unitPrice: 10.005 }]) {
    const h = api({ proposal: { action: 'create_quote_draft', input: { client: 'Mauro', items: [item] } } });
    // O valor aparece no texto (não é inventado), mas fora do contrato: a validação rejeita.
    assert.equal((await h.run({ operation: 'plan', text: 'Orçamento pro Mauro, câmera a 10,005 reais' })).status, 422);
    assert.equal(h.rpcs().includes('zt_assistant_plan'), false);
  }
  const tech = api({ role: 'technician', proposal: { action: 'create_quote_draft', input: { client: 'Mauro', items: quoteItems } } });
  assert.equal((await tech.run({ operation: 'plan', text: 'Orçamento pro Mauro' })).status, 403);
  assert.equal(tech.rpcs().includes('zt_assistant_plan'), false);
  // "Esta OS" chega ao provedor como marcador; o servidor devolve a OS aberta na tela.
  const own = api({ role: 'technician', proposal: { action: 'finalize_assigned_work_order', input: { workOrder: 'OS_ATUAL' } }, rpc: { zt_assistant_plan: { confirmationRequired: true } } });
  await own.run({ operation: 'plan', text: 'Finaliza esta OS', currentWorkOrder: workOrderId });
  assert.equal(own.calls.at(-1).args.p_input.workOrder, workOrderId);
});

test('ajuste ("troca para três") usa contexto sem IDs e revisa para nova solicitação; nunca reaproveita a anterior', async () => {
  const context = { action: 'create_quote_draft', input: { client: 'Mauro Silva', items: [{ kind: 'product', name: 'Câmera Wi-Fi Intelbras', quantity: 2, unit: 'unidade' }, { kind: 'service', name: 'Instalação de câmera', quantity: 1, unit: 'serviço' }] } };
  const revised = { client: 'Mauro Silva', items: [{ ...context.input.items[0], quantity: 3 }, context.input.items[1]] };
  const h = api({ proposal: args => { assert.deepEqual(args.context, context); return { action: 'create_quote_draft', input: revised }; },
    rpc: { zt_assistant_plan_context: context, zt_assistant_revise: preview(nextRequestId, { previewHash: 'b'.repeat(64) }) } });
  const r = await h.run({ operation: 'plan', requestId: nextRequestId, contextRequestId: requestId, text: 'Na verdade coloca três câmeras' });
  assert.equal(r.status, 200); assert.equal(r.body.previewHash, 'b'.repeat(64));
  assert.deepEqual(h.rpcs(), ['zt_assistant_plan_context', 'zt_assistant_consume_ai_quota', 'zt_assistant_revise']);
  assert.deepEqual(h.calls.at(-1).args, { p_company: companyId, p_previous: requestId, p_action: 'create_quote_draft', p_input: revised, p_request_id: nextRequestId });
  // Contexto com identificador desconhecido não vai ao provedor.
  const leaky = api({ proposal: args => { assert.equal(args.context, null); return { question: 'O que deseja ajustar?' }; },
    rpc: { zt_assistant_plan_context: { action: 'schedule_work_order', input: { workOrder: workOrderId, date: '2026-10-12', time: '09:00' } } } });
  await leaky.run({ operation: 'plan', requestId: nextRequestId, contextRequestId: requestId, text: 'muda para as dez' });
  for (const body of [{ operation: 'plan', contextRequestId: requestId, text: 'x' }, { operation: 'execute', requestId: nextRequestId, contextRequestId: requestId, previewHash: 'a'.repeat(64) }]) {
    const bad = api({ proposal: { question: 'x' } });
    assert.equal((await bad.run(body)).status, 400);
    assert.equal(bad.rpcs().length, 0);
  }
  const expired = api({ proposal: { action: 'create_quote_draft', input: revised }, rpc: { zt_assistant_plan_context: context,
    zt_assistant_revise: { error: 'A prévia anterior não está mais pendente. Faça um novo pedido.', code: 'PLAN_EXPIRED' } } });
  const gone = await expired.run({ operation: 'plan', requestId: nextRequestId, contextRequestId: requestId, text: 'tira a instalação' });
  assert.equal(gone.status, 422); assert.equal(gone.body.code, 'PLAN_EXPIRED');
  assert.equal(expired.rpcs().includes('zt_assistant_execute'), false);
});

test('pedido composto coerente gera uma prévia; composto ambíguo pergunta antes de qualquer prévia', async () => {
  const coherent = api({ proposal: { action: 'create_work_order', input: { client: 'Mauro', description: 'Instalar câmera', date: '2026-10-12', time: '14:00' } }, rpc: { zt_assistant_plan: { confirmationRequired: true } } });
  await coherent.run({ operation: 'plan', text: 'Cria uma OS pro Mauro amanhã às 14h para instalar câmera' });
  assert.deepEqual(coherent.rpcs(), ['zt_assistant_consume_ai_quota', 'zt_assistant_plan']);
  const mixed = api({ proposal: { actions: [{ action: 'create_quote_draft', input: { client: 'Mauro', items: quoteItems } }, { action: 'schedule_work_order', input: { client: 'Mauro', date: '2026-10-12', time: '09:00' } }] } });
  const r = await mixed.run({ operation: 'plan', text: 'Faz um orçamento pro Mauro e agenda para amanhã' });
  assert.match(r.body.question, /Crie um orçamento; Agende uma visita/);
  assert.equal(mixed.rpcs().includes('zt_assistant_plan'), false);
});

test('correção com prévia pendente envia contexto e só a nova prévia pode ser confirmada', async () => {
  const calls = [];
  const view = panel(async payload => {
    calls.push(payload);
    if (payload.operation === 'execute') return { result: { entityType: 'quote', id: clientA, number: 'ORC-0007', message: 'Ação concluída.' } };
    return preview(payload.requestId, { preview: [{ label: 'Item 1', value: calls.length === 1 ? '2 × Câmera' : '3 × Câmera' }] });
  });
  await say(view, 'Faz um orçamento pro Mauro com duas câmeras e instalação.');
  assert.match(content(view()), /2 × Câmera/);
  assert.ok(find(view(), 'textarea'), 'a conversa continua disponível com a prévia aberta');
  await say(view, 'Na verdade coloca três câmeras');
  assert.equal(calls[1].operation, 'plan');
  assert.equal(calls[1].contextRequestId, calls[0].requestId);
  assert.notEqual(calls[1].requestId, calls[0].requestId);
  assert.match(content(view()), /3 × Câmera/);
  assert.match(content(view()), /a prévia anterior não vale mais/);
  find(view(), 'button', 'Confirmar').props.onClick(); await tick();
  assert.deepEqual(calls.filter(c => c.operation === 'execute').map(c => c.requestId), [calls[1].requestId]);
  assert.match(content(view()), /ORC-0007/);
});

test('"Pode criar" confirma a prévia vigente uma vez; "cancela" descarta sem chamada; ação sensível exige a marcação', async () => {
  const calls = [];
  const view = panel(async payload => { calls.push(payload); return payload.operation === 'execute' ? { result: { entityType: 'quote', id: clientA, message: 'Ação concluída.' } } : preview(payload.requestId); });
  await say(view, 'Orçamento pro Mauro com uma câmera');
  await say(view, 'Pode criar.');
  assert.deepEqual(calls.map(c => [c.operation, c.requestId]), [['plan', calls[0].requestId], ['execute', calls[0].requestId]]);
  assert.equal(find(view(), 'button', 'Confirmar'), undefined);
  const cancel = []; const other = panel(async payload => { cancel.push(payload); return preview(payload.requestId); });
  await say(other, 'Orçamento pro Mauro com uma câmera');
  await say(other, 'Cancela');
  assert.equal(cancel.length, 1);
  assert.equal(find(other(), 'button', 'Confirmar'), undefined);
  assert.match(content(other()), /Nada foi gravado/);
  const sensitive = []; const tech = panel(async payload => { sensitive.push(payload); return { action: 'finalize_assigned_work_order', confirmationRequired: true, preview: [] }; }, { role: 'technician' });
  await say(tech, 'Finalizar esta OS');
  await say(tech, 'pode confirmar');
  assert.equal(sensitive.length, 1);
  assert.match(content(tech()), /confirmação reforçada/);
});

test('opções do banco viram botões; tocar envia o rascunho com a referência escolhida, sem texto nem execução', async () => {
  const calls = [];
  const draft = { client: 'Mauro', items: quoteItems };
  const view = panel(async payload => { calls.push(payload); return calls.length === 1
    ? { question: 'Encontrei mais de um cliente para "Mauro". Qual deles?', action: 'create_quote_draft', draft, options: [{ label: 'Mauro Silva · 1130000001', slot: 'client', ref: clientA }, { label: 'Mauro Souza', slot: 'client', ref: clientB }] }
    : preview(payload.requestId); });
  await say(view, 'Orçamento pro Mauro com duas câmeras e instalação');
  assert.ok(find(view(), 'button', 'Mauro Silva · 1130000001'));
  find(view(), 'button', 'Mauro Souza').props.onClick(); await tick();
  assert.deepEqual(JSON.parse(JSON.stringify({ ...calls[1], requestId: null })), { operation: 'preview', companyId, requestId: null, action: 'create_quote_draft', input: { ...draft, clientRef: clientB } });
  assert.notEqual(calls[1].requestId, calls[0].requestId);
  assert.ok(find(view(), 'button', 'Confirmar'));
  assert.equal(calls.some(c => c.operation === 'execute'), false);
});

test('telefone aparece no assistente com copiar, WhatsApp e abrir cliente, sem navegação automática', async () => {
  const opened = [], copied = [];
  const record = { id: clientA, entityType: 'client', title: 'Mauro Silva', phone: '(11) 3000-0001', whatsapp: '11 99000-0001', detail: '(11) 3000-0001 · Rua A' };
  const view = panel(async () => ({ action: 'owner_find_client', confirmationRequired: false, result: { message: 'Consulta concluída.', items: [record] } }),
    { props: { onOpenRecord: r => opened.push(r) }, globals: { navigator: { clipboard: { writeText: async value => { copied.push(value); } } } } });
  await say(view, 'Telefone do Mauro Silva');
  const text = content(view());
  assert.match(text, /Mauro Silva/); assert.match(text, /\(11\) 3000-0001/); assert.match(text, /11 99000-0001/);
  assert.equal(find(view(), 'a', 'Abrir WhatsApp').props.href, 'https://wa.me/5511990000001');
  assert.equal(find(view(), 'a', 'Abrir WhatsApp').props.rel, 'noopener noreferrer');
  assert.equal(opened.length, 0, 'consulta não navega sozinha');
  await find(view(), 'button', 'Copiar telefone').props.onClick(); await tick();
  assert.deepEqual(copied, ['(11) 3000-0001']); assert.match(content(view()), /Telefone copiado/);
  find(view(), 'button', 'Abrir cliente').props.onClick();
  assert.deepEqual(opened, [record]);
  assert.equal(find(view(), 'textarea'), undefined, 'painel fecha ao abrir o cliente');
});

test('a conversa sobrevive a abrir registro, trocar a OS da tela e voltar; trocar de empresa reinicia', async () => {
  const view = panel(async () => ({ action: 'owner_find_client', confirmationRequired: false, result: { message: 'Consulta concluída.', items: [{ id: clientA, entityType: 'client', title: 'Mauro Silva' }] } }));
  await say(view, 'Telefone do Mauro Silva');
  find(view(), 'button', 'Abrir registro').props.onClick();
  view.set({ currentWorkOrder: workOrderId }); view();
  find(view(), 'button').props.onClick();
  assert.match(content(view()), /Telefone do Mauro Silva/);
  assert.match(content(view()), /Consulta concluída/);
  view.set({ companyId: '10000000-0000-4000-8000-000000000009' }); view();
  find(view(), 'button').props.onClick();
  assert.doesNotMatch(content(view()), /Telefone do Mauro Silva/);
});

// Histórico do navegador simulado: pushState/replaceState/back com popstate síncrono.
function browser(start) {
  const entries = [{ url: start, state: null }]; let index = 0; const listeners = {};
  const location = {}; const sync = () => { const u = new URL(entries[index].url); Object.assign(location, { href: u.href, search: u.search, pathname: u.pathname, hash: u.hash }); };
  const window = { location, history: {
    get state() { return entries[index].state; },
    pushState(state, _, url) { entries.splice(index + 1); entries.push({ state, url: new URL(url, location.href).href }); index += 1; sync(); },
    replaceState(state, _, url) { entries[index] = { state, url: new URL(url, location.href).href }; sync(); },
    back() { if (index === 0) return; index -= 1; sync(); (listeners.popstate || []).forEach(fn => fn({ state: entries[index].state })); },
  }, addEventListener(type, fn) { (listeners[type] ||= []).push(fn); }, removeEventListener(type, fn) { listeners[type] = (listeners[type] || []).filter(x => x !== fn); } };
  sync();
  return { window, entries, index: () => index };
}
function app(start) {
  const nav = browser(start);
  const session = { sessaoAuth: { user: { id: userId } }, perfil: { id: userId }, empresaId: companyId, empresa: { id: companyId },
    membresiaAtual: { role: 'owner', status: 'active' }, membresias: [], recarregar() {} };
  const Assistant = () => null;
  const render = harness('src/App.jsx', { './lib/useSessao': { useSessao: () => session }, './lib/supabase': { configurado: true },
    './components/AssistantPanel': { __esModule: true, default: Assistant }, './lib/unsavedChanges': unsavedChanges }, { window: nav.window });
  const lazyNode = (tree, name) => nodes(tree).find(n => typeof n.type === 'function' && n.type.source?.includes(name));
  return { nav, render, assistant: () => find(render(), Assistant), lazyNode };
}

test('abrir cliente pelo Assistente cria entrada de histórico; Voltar do Android e o Voltar da tela retornam à origem', () => {
  const a = app('https://app.example/');
  a.assistant().props.onOpenRecord({ id: clientA, entityType: 'client', title: 'Mauro Silva' });
  let screen = a.lazyNode(a.render(), 'ClientLocationsV2');
  assert.equal(screen.props.initialClientId, clientA);
  assert.equal(a.nav.entries.length, 2, 'pushState, não replaceState');
  a.nav.window.history.back();
  assert.equal(a.lazyNode(a.render(), 'ClientLocationsV2'), undefined);
  assert.ok(a.lazyNode(a.render(), 'legacy/ZiisTecApp'), 'Voltar do navegador volta ao app principal');
  assert.equal(a.nav.window.location.search, '');
  a.assistant().props.onOpenRecord({ id: clientA, entityType: 'client', title: 'Mauro Silva' });
  screen = a.lazyNode(a.render(), 'ClientLocationsV2');
  screen.props.onClose();
  assert.equal(a.nav.index(), 0, 'o Voltar da tela consome a entrada criada pelo Assistente');
  assert.ok(a.lazyNode(a.render(), 'legacy/ZiisTecApp'));
});

test('rotas ?v2= continuam: abrir pelo hub e voltar preserva ?v2=home; tela aberta direto mantém o fechamento antigo', () => {
  const fromHub = app('https://app.example/?v2=home');
  assert.ok(fromHub.lazyNode(fromHub.render(), 'WorkspaceV2Home'));
  fromHub.assistant().props.onOpenRecord({ id: clientA, entityType: 'client', title: 'Mauro Silva' });
  assert.ok(fromHub.lazyNode(fromHub.render(), 'ClientLocationsV2'));
  fromHub.nav.window.history.back();
  assert.equal(fromHub.nav.window.location.search, '?v2=home');
  assert.ok(fromHub.lazyNode(fromHub.render(), 'WorkspaceV2Home'));
  const direct = app(`https://app.example/?v2=clientes-locais&client=${clientA}`);
  direct.lazyNode(direct.render(), 'ClientLocationsV2').props.onClose();
  assert.equal(direct.nav.entries.length, 1);
  assert.equal(new URL(direct.nav.window.location.href).searchParams.get('v2'), 'home');
});

test('ClientLocationsV2 aplica initialClientId uma vez por valor; voltar para a lista não reabre o cliente', async () => {
  const rows = [{ id: clientA, name: 'Mauro Silva' }, { id: clientB, name: 'Mauro Souza' }];
  const closed = [];
  const render = harness('src/screens/v2/ClientLocationsV2.jsx', {
    'lucide-react': new Proxy({}, { get: () => 'span' }),
    '../../lib/clientLocationsV2Api': { buildGoogleMapsUrl: () => '', carregarClientesLocaisV2DB: async () => rows, salvarLocalClienteV2DB: async () => ({}), limparLocalClienteV2DB: async () => ({}) },
  }, browserGlobals());
  const props = { companyId, onClose: () => closed.push(1), initialClientId: clientA };
  const back = () => nodes(render(props)).find(n => n.type === 'button' && n.props['aria-label'] === 'Voltar');
  render(props); await tick(); render(props);
  assert.match(content(render(props)), /Mauro Silva/);
  assert.notEqual(back().props.onClick, props.onClose, 'cliente da URL aberto');
  back().props.onClick(); render(props); render(props);
  assert.equal(back().props.onClick, props.onClose, 'voltou para a lista e não reabriu o cliente');
  back().props.onClick();
  assert.equal(closed.length, 1);
  props.initialClientId = clientB; render(props); render(props);
  assert.notEqual(back().props.onClick, props.onClose, 'um novo cliente pedido abre normalmente');
});

test('Bloco 6: com formulário não salvo, abrir registro pelo Assistente pergunta; "Cancelar" mantém a tela e o histórico', () => {
  const a = app('https://app.example/');
  const token = {};
  const asked = [];
  const originalConfirm = globalThis.confirm;
  unsavedChanges.markUnsaved(token, true);
  try {
    globalThis.confirm = (message) => { asked.push(message); return false; };
    a.assistant().props.onOpenRecord({ id: clientA, entityType: 'client', title: 'Mauro Silva' });
    assert.equal(asked.length, 1);
    assert.equal(a.nav.entries.length, 1, 'sem nova entrada de histórico');
    assert.equal(a.lazyNode(a.render(), 'ClientLocationsV2'), undefined);
    assert.ok(a.lazyNode(a.render(), 'legacy/ZiisTecApp'), 'a tela com o formulário continua aberta');
    globalThis.confirm = (message) => { asked.push(message); return true; };
    a.assistant().props.onOpenRecord({ id: clientA, entityType: 'client', title: 'Mauro Silva' });
    assert.ok(a.lazyNode(a.render(), 'ClientLocationsV2'), 'descartar abre o registro');
    assert.equal(asked.length, 2);
  } finally {
    globalThis.confirm = originalConfirm;
    unsavedChanges.markUnsaved(token, false);
  }
});
