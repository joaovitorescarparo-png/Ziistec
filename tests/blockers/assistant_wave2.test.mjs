import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import React from 'react';
import { transformSync } from 'esbuild';
import * as toolRegistry from '../../src/lib/assistantTools.js';
import { GEMINI_API_BASE } from '../../api/_aiGateway.js';
import { PROVIDER_ID_QUESTION, priceQuestion } from '../../api/_assistantPlanner.js';
import { createAssistantHandler, REFERENCE_TYPES } from '../../api/assistant.js';

// Wave 2: contexto ativo + orçamentos + agenda + catálogo. Provedor e banco simulados; a autoridade
// (empresa, estado, vínculos, snapshot, idempotência) é provada no SQL v2_assistant_wave2_rollback.sql.
const companyId = '10000000-0000-4000-8000-000000000001';
const otherCompany = '10000000-0000-4000-8000-000000000009';
const userId = '20000000-0000-4000-8000-000000000002';
const requestId = '30000000-0000-4000-8000-000000000003';
const quoteId = '40000000-0000-4000-8000-000000000005';
const foreignId = '40000000-0000-4000-8000-000000000006';
const UUID_ANY = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const env = { ENABLE_EXTERNAL_AI: 'true', AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'test-placeholder' };
const PROVIDER_HOST = new URL(GEMINI_API_BASE).hostname;
const geminiReply = (value) => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }] }) });
const quoteReference = { type: 'quote', label: 'ORC-0003 · Mauro Silva', context: { type: 'quote', number: 'ORC-0003', client: 'Mauro Silva', status: 'rascunho', editable: true,
  items: [{ kind: 'product', name: 'Câmera Wi-Fi Intelbras', quantity: 2, unit: 'unidade', unitPrice: 250 }, { kind: 'service', name: 'Instalação de câmera', quantity: 1, unit: 'serviço', unitPrice: 150 }],
  discount: 0, surcharge: 0, total: 650 } };
const preview = { requestId, previewHash: 'a'.repeat(64), previewVersion: 1, confirmationRequired: true, preview: [] };

function api({ role = 'owner', member = true, gemini, rpc = {} } = {}) {
  const calls = [], provider = [];
  const handler = createAssistantHandler({ env,
    resolveConfig: () => ({ configurado: true, url: 'https://example.invalid', publishableKey: 'test-placeholder' }),
    fetchImpl: async (url, options) => {
      if (new URL(url).hostname === PROVIDER_HOST) { provider.push(JSON.parse(options.body)); return geminiReply(typeof gemini === 'function' ? gemini() : gemini); }
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

test('registro: ferramentas da Wave 2 só para o proprietário, mutações com confirmação, sem redundância com reagendar', () => {
  const expected = { owner_update_quote: true, owner_duplicate_quote: true, owner_archive_quote: true, owner_unschedule_work_order: true,
    owner_cancel_work_order: true, create_service: true, owner_find_product: false, owner_find_service: false };
  for (const [name, mutation] of Object.entries(expected)) {
    const tool = toolRegistry.findAssistantTool(name);
    assert.deepEqual(tool.roles, ['owner'], name);
    assert.equal(tool.confirmationRequired, mutation, name);
    assert.equal(tool.inputSchema.additionalProperties, false, name);
  }
  assert.equal(toolRegistry.toolsForRole('technician').some(t => t.name in expected), false);
  assert.equal(toolRegistry.findAssistantTool('owner_reschedule_work_order'), undefined, 'reagendar reutiliza schedule_work_order');
  assert.ok(toolRegistry.findAssistantTool('schedule_work_order'));
  assert.deepEqual(REFERENCE_TYPES, ['quote', 'work_order', 'client', 'product', 'service']);
  assert.throws(() => toolRegistry.validateAssistantInput('owner_update_quote', { quote: 'ORC-0003' }, 'owner'), /Diga o que deve mudar/);
  assert.throws(() => toolRegistry.validateAssistantInput('owner_unschedule_work_order', { workOrder: 'OS-1', client: 'Mauro' }, 'owner'), /somente um deles/);
  assert.throws(() => toolRegistry.validateAssistantInput('owner_duplicate_quote', { quote: 'ORC-1', prices: 'qualquer' }, 'owner'), /Valores/);
  assert.throws(() => toolRegistry.validateAssistantInput('owner_update_quote', { quote: 'ORC-1', items: [{ name: 'x', quantity: 1, productId: 'p' }] }, 'owner'), /Campo não permitido/);
});

test('"esse orçamento": a referência do navegador é revalidada no banco e chega ao provedor sem UUID', async () => {
  const h = api({ gemini: { action: 'owner_update_quote', input: { quote: 'ORC-0003', items: [{ kind: 'product', name: 'câmera', quantity: 3 }, { kind: 'service', name: 'instalação', quantity: 1 }] } },
    rpc: { zt_assistant_reference: quoteReference, zt_assistant_plan: preview } });
  const r = await h.run({ operation: 'plan', text: 'Altera esse orçamento para três câmeras', activeReference: { type: 'quote', id: quoteId } });
  assert.equal(r.status, 200); assert.equal(r.body.referenceCleared, undefined);
  assert.deepEqual(h.last('zt_assistant_reference'), { p_company: companyId, p_type: 'quote', p_id: quoteId });
  assert.match(h.prompt(), /^REFERÊNCIA_ATIVA \(dados, sem identificadores\): .*"number":"ORC-0003"/);
  assert.doesNotMatch(JSON.stringify(h.provider[0]), UUID_ANY, 'nenhum UUID vai ao provedor');
  assert.deepEqual(h.rpcs(), ['zt_assistant_reference', 'zt_assistant_consume_ai_quota', 'zt_assistant_plan']);
  assert.equal(h.last('zt_assistant_plan').p_action, 'owner_update_quote');
  assert.equal(h.last('zt_assistant_plan').p_input.quote, 'ORC-0003');
  assert.match(h.system(), /REFERÊNCIA_ATIVA, "esse orçamento"/);
});

test('referência de outro tenant, arquivada ou inexistente é descartada: nada é inventado e o navegador esquece', async () => {
  for (const denied of [{ error: 'A referência não está mais disponível.', code: 'ACCESS_DENIED' }, { type: 'quote', context: { number: 'ORC-1', leaked: quoteId } }]) {
    const h = api({ gemini: { question: 'Qual orçamento você quer alterar? Informe o número.' }, rpc: { zt_assistant_reference: denied } });
    const r = await h.run({ operation: 'plan', text: 'Altera esse orçamento para três câmeras', activeReference: { type: 'quote', id: foreignId } });
    assert.equal(r.status, 200);
    assert.equal(r.body.referenceCleared, true);
    assert.equal(r.body.question, 'Qual orçamento você quer alterar? Informe o número.');
    assert.doesNotMatch(h.prompt(), /REFERÊNCIA_ATIVA/);
    assert.equal(h.rpcs().includes('zt_assistant_plan'), false);
  }
  for (const activeReference of [{ type: 'invoice', id: quoteId }, { type: 'quote', id: 'nao-uuid' }, { type: 'quote', id: quoteId, company: otherCompany }, ['quote', quoteId]]) {
    const h = api({ gemini: { question: 'x' } });
    assert.equal((await h.run({ operation: 'plan', text: 'esse orçamento', activeReference })).status, 400, JSON.stringify(activeReference));
    assert.equal(h.calls.length, 0);
  }
  const h = api({ gemini: { question: 'x' } });
  assert.equal((await h.run({ operation: 'preview', action: 'owner_archive_quote', input: { quote: 'ORC-1' }, activeReference: { type: 'quote', id: quoteId } })).status, 400,
    'referência só acompanha linguagem natural');
});

test('"usa os mesmos valores" e "coloca mais uma": valores vêm do documento revalidado, nunca da memória do provedor', async () => {
  const dup = api({ gemini: { action: 'owner_duplicate_quote', input: { quote: 'ORC-0003', prices: 'same', items: [{ kind: 'product', name: 'câmera', quantity: 4, unitPrice: 250 }] } },
    rpc: { zt_assistant_reference: quoteReference, zt_assistant_plan: preview } });
  await dup.run({ operation: 'plan', text: 'Refaz esse orçamento com quatro câmeras usando os mesmos valores', activeReference: { type: 'quote', id: quoteId } });
  assert.deepEqual(dup.last('zt_assistant_plan').p_input, { quote: 'ORC-0003', prices: 'same', items: [{ kind: 'product', name: 'câmera', quantity: 4, unitPrice: 250 }] },
    '250 vem do snapshot revalidado da referência');
  const invented = api({ gemini: { action: 'owner_duplicate_quote', input: { quote: 'ORC-0003', items: [{ kind: 'product', name: 'câmera', quantity: 4, unitPrice: 199 }], discount: 30 } },
    rpc: { zt_assistant_reference: quoteReference, zt_assistant_plan: preview } });
  await invented.run({ operation: 'plan', text: 'Refaz esse com 4 câmeras', activeReference: { type: 'quote', id: quoteId } });
  assert.deepEqual(invented.last('zt_assistant_plan').p_input, { quote: 'ORC-0003', items: [{ kind: 'product', name: 'câmera', quantity: 4 }] }, 'valor e desconto inventados saem');
  const noRef = api({ gemini: { action: 'owner_duplicate_quote', input: { quote: 'ORC-0003', prices: 'same', items: [{ name: 'câmera', quantity: 1, unitPrice: 250 }] } }, rpc: { zt_assistant_plan: preview } });
  await noRef.run({ operation: 'plan', text: 'faz outro orçamento com os mesmos valores' });
  assert.equal(noRef.last('zt_assistant_plan').p_input.items[0].unitPrice, undefined, 'sem referência, 250 não tem origem autorizada');
  assert.match(noRef.system(), /De qual orçamento você quer reutilizar os valores\?/);
  const more = api({ gemini: { action: 'owner_update_quote', input: { quote: 'ORC-0003', items: [{ kind: 'product', name: 'câmera', quantity: 3, unitPrice: 3 }, { kind: 'service', name: 'instalação', quantity: 1 }] } },
    rpc: { zt_assistant_reference: quoteReference, zt_assistant_plan: preview } });
  await more.run({ operation: 'plan', text: 'coloca mais uma câmera, ficam 3', activeReference: { type: 'quote', id: quoteId } });
  assert.deepEqual(more.last('zt_assistant_plan').p_input.items[0], { kind: 'product', name: 'câmera', quantity: 3 }, 'quantidade não vira preço');
});

test('orçamento: editar, desconto dito, arquivar e IDs do provedor seguem só pelo contrato; nada executa sem confirmação', async () => {
  const discount = api({ gemini: { action: 'owner_update_quote', input: { quote: 'ORC-0003', discount: 50 } }, rpc: { zt_assistant_plan: preview } });
  await discount.run({ operation: 'plan', text: 'dá 50 reais de desconto no ORC-0003' });
  assert.deepEqual(discount.last('zt_assistant_plan').p_input, { quote: 'ORC-0003', discount: 50 });
  const archive = api({ gemini: { action: 'owner_archive_quote', input: { quote: 'ORC-0003' } }, rpc: { zt_assistant_plan: { ...preview, action: 'owner_archive_quote' } } });
  const r = await archive.run({ operation: 'plan', text: 'exclui o ORC-0003' });
  assert.equal(r.body.confirmationRequired, true);
  assert.equal(archive.rpcs().includes('zt_assistant_execute'), false);
  const blocked = api({ gemini: { action: 'owner_update_quote', input: { quote: 'ORC-0002', discount: 10 } },
    rpc: { zt_assistant_plan: { question: 'O ORC-0002 está aprovado e não pode ser alterado. Posso duplicar como um novo orçamento.', action: 'owner_update_quote' } } });
  assert.deepEqual((await blocked.run({ operation: 'plan', text: 'dá 10 reais de desconto no ORC-0002' })).body,
    { question: 'O ORC-0002 está aprovado e não pode ser alterado. Posso duplicar como um novo orçamento.' });
  for (const input of [{ quote: quoteId, discount: 10 }, { quote: 'ORC-0003', items: [{ name: 'câmera', quantity: 1, ref: quoteId }] }]) {
    const h = api({ gemini: { action: 'owner_update_quote', input } });
    assert.deepEqual((await h.run({ operation: 'plan', text: 'dá 10 reais de desconto' })).body, { question: PROVIDER_ID_QUESTION });
    assert.equal(h.rpcs().includes('zt_assistant_plan'), false);
  }
});

test('agenda: reagendar, tirar da agenda e cancelar são ações distintas; técnico e outra empresa não chegam ao banco', async () => {
  const system = api({ gemini: { question: 'x' } });
  await system.run({ operation: 'plan', text: 'tira o Mauro da agenda' });
  assert.match(system.system(), /"Tira da agenda".*owner_unschedule_work_order.*"Cancela a OS\/o serviço" usa owner_cancel_work_order\. Nunca troque um pelo outro/);
  for (const [text, proposal] of [
    ['passa esse atendimento para amanhã às 14h', { action: 'schedule_work_order', input: { workOrder: 'OS-0007', date: '2026-10-13', time: '14:00' } }],
    ['tira o atendimento do Mauro de amanhã', { action: 'owner_unschedule_work_order', input: { client: 'Mauro', date: '2026-10-13' } }],
    ['cancela a OS-0007', { action: 'owner_cancel_work_order', input: { workOrder: 'OS-0007' } }],
  ]) {
    const h = api({ gemini: proposal, rpc: { zt_assistant_plan: preview } });
    await h.run({ operation: 'plan', text });
    assert.equal(h.last('zt_assistant_plan').p_action, proposal.action, text);
    assert.deepEqual(h.last('zt_assistant_plan').p_input, proposal.input, text);
  }
  const tech = api({ role: 'technician', gemini: { action: 'owner_unschedule_work_order', input: { workOrder: 'OS-0007' } } });
  assert.equal((await tech.run({ operation: 'plan', text: 'tira a OS-0007 da agenda' })).status, 403);
  assert.equal(tech.rpcs().includes('zt_assistant_plan'), false);
  const outsider = api({ member: false, gemini: { action: 'owner_cancel_work_order', input: { workOrder: 'OS-0007' } } });
  assert.equal((await outsider.run({ operation: 'plan', text: 'cancela a OS-0007' })).status, 403);
  assert.equal(outsider.provider.length, 0); assert.equal(outsider.rpcs().length, 0);
});

test('catálogo: produto e serviço por linguagem natural, preço só quando dito, sempre na empresa do pedido', async () => {
  for (const [text, proposal] of [
    ['cadastre uma câmera Dome a 150 reais', { action: 'create_product', input: { name: 'Câmera Dome', price: 150 } }],
    ['cadastre instalação de câmera por 180 reais', { action: 'create_service', input: { name: 'Instalação de câmera', price: 180 } }],
  ]) {
    const h = api({ gemini: proposal, rpc: { zt_assistant_plan: preview } });
    await h.run({ operation: 'plan', text });
    assert.deepEqual(h.last('zt_assistant_plan'), { p_company: companyId, p_action: proposal.action, p_input: proposal.input, p_request_id: requestId });
  }
  const invented = api({ gemini: { action: 'create_service', input: { name: 'Instalação de câmera', price: 180 } } });
  assert.deepEqual((await invented.run({ operation: 'plan', text: 'cadastre instalação de câmera' })).body, { question: priceQuestion('create_service', 'Instalação de câmera') });
  const find = api({ gemini: { action: 'owner_find_service', input: { query: 'instalação' } }, rpc: { zt_assistant_plan: { confirmationRequired: false, result: { items: [] } } } });
  await find.run({ operation: 'plan', text: 'tem serviço de instalação cadastrado?' });
  assert.equal(find.last('zt_assistant_plan').p_action, 'owner_find_service');
  assert.match(find.system(), /cadastrar serviço \(instalação, manutenção, visita, mão de obra\) usa create_service/);
});

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
function panel(request, props = {}) {
  let ids = 0;
  const render = harness('src/components/AssistantPanel.jsx', {
    '../lib/assistantTools': toolRegistry,
    '../lib/assistantApi': { requestAssistant: request, createAssistantRequestId: () => `30000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`, assistantFormInput: (_, values) => values },
    '../hooks/useSpeechInput': { __esModule: true, default: () => ({ supported: true, cancel() {}, start() {}, stop() {} }) },
    'lucide-react': { Sparkles: 'span', Mic: 'span', X: 'span' },
  }, { document: { querySelector: () => null, body: { style: {} }, activeElement: null, addEventListener() {}, removeEventListener() {} }, MutationObserver: class { observe() {} disconnect() {} } });
  const state = { companyId, role: 'owner', ...props };
  const view = () => render(state);
  view(); find(view(), 'button').props.onClick();
  view.set = changes => Object.assign(state, changes);
  return view;
}
async function say(view, text) { find(view(), 'textarea').props.onChange({ target: { value: text } }); find(view(), 'form').props.onSubmit({ preventDefault() {} }); await tick(); }

test('painel: orçamento criado vira referência ativa, "esse orçamento" a envia, e troca de empresa ou "Esquecer" limpa', async () => {
  const calls = [];
  const view = panel(async payload => { calls.push(payload);
    if (payload.operation === 'execute') return { result: { entityType: 'quote', id: quoteId, number: 'ORC-0003', message: 'Ação concluída.' } };
    return calls.length === 1 ? { ...preview, requestId: payload.requestId, action: 'create_quote_draft' } : { question: 'Qual item?' }; });
  await say(view, 'Faz um orçamento pro Mauro com duas câmeras');
  find(view(), 'button', 'Confirmar').props.onClick(); await tick();
  assert.match(content(view()), /Falando sobre: ORC-0003/);
  await say(view, 'altera esse orçamento para três câmeras');
  assert.deepEqual({ ...calls.at(-1).activeReference }, { type: 'quote', id: quoteId });
  find(view(), 'button', 'Esquecer').props.onClick();
  await say(view, 'altera esse orçamento');
  assert.equal(calls.at(-1).activeReference, undefined);
  // Troca de empresa reinicia a conversa e a referência.
  const other = panel(async payload => { calls.push(payload); return payload.operation === 'execute'
    ? { result: { entityType: 'quote', id: quoteId, number: 'ORC-0003', message: 'Ação concluída.' } } : { ...preview, requestId: payload.requestId, action: 'create_quote_draft' }; });
  await say(other, 'Faz um orçamento pro Mauro');
  find(other(), 'button', 'Confirmar').props.onClick(); await tick();
  assert.match(content(other()), /Falando sobre: ORC-0003/);
  other.set({ companyId: otherCompany }); other();
  find(other(), 'button').props.onClick();
  assert.doesNotMatch(content(other()), /Falando sobre/);
  await say(other, 'altera esse orçamento');
  assert.equal(calls.at(-1).activeReference, undefined);
});

test('painel: referência descartada pela API some; consulta com um registro vira referência; arquivar exige confirmação reforçada', async () => {
  const calls = [];
  const view = panel(async payload => { calls.push(payload);
    if (calls.length === 1) return { action: 'owner_find_quote', confirmationRequired: false, result: { message: 'Consulta concluída.', items: [{ id: quoteId, entityType: 'quote', number: 'ORC-0003', title: 'ORC-0003' }] } };
    if (calls.length === 2) return { question: 'Qual orçamento?', referenceCleared: true };
    if (payload.operation === 'execute') return { result: { entityType: 'quote', id: quoteId, number: 'ORC-0003', message: 'Ação concluída.' } };
    return { ...preview, requestId: payload.requestId, action: 'owner_archive_quote', preview: [{ label: 'Ação', value: 'Arquivar' }] }; });
  await say(view, 'Procura o orçamento ORC-0003');
  assert.match(content(view()), /Falando sobre: ORC-0003/);
  await say(view, 'exclui esse orçamento');
  assert.deepEqual({ ...calls[1].activeReference }, { type: 'quote', id: quoteId });
  assert.doesNotMatch(content(view()), /Falando sobre/);
  await say(view, 'ORC-0003');
  find(view(), 'button', 'Confirmar').props.onClick(); await tick();
  assert.equal(calls.filter(c => c.operation === 'execute').length, 0, 'arquivar exige a marcação reforçada');
  find(view(), 'input').props.onChange({ target: { checked: true } });
  find(view(), 'button', 'Confirmar').props.onClick(); await tick();
  assert.equal(calls.filter(c => c.operation === 'execute').length, 1);
  assert.doesNotMatch(content(view()), /Falando sobre/, 'orçamento arquivado não continua como assunto');
  assert.match(read('src/components/AssistantPanel.jsx'), /const SENSITIVE = \[[^\]]*'owner_archive_quote', 'owner_cancel_work_order'\]/);
});
