import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import React from 'react';
import { transformSync } from 'esbuild';
import * as toolRegistry from '../../src/lib/assistantTools.js';
import { createAssistantHandler } from '../../api/assistant.js';

const companyId = '10000000-0000-4000-8000-000000000001';
const userId = '20000000-0000-4000-8000-000000000002';
const requestId = '30000000-0000-4000-8000-000000000003';
const read = path => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));

// Execute actual component handlers with deterministic hooks, without a browser or live backend.
function componentHarness(path, mocks = {}, browser) {
  const slots = []; let cursor = 0;
  const hookReact = { ...React,
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; },
    useEffect() {}, useMemo(fn) { return fn(); }, lazy() { return () => null; },
  };
  const module = { exports: {} };
  const code = transformSync(read(path), { loader: 'jsx', format: 'cjs' }).code;
  vm.runInNewContext(code, { module, exports: module.exports, AbortController, URL, URLSearchParams, window: browser,
    require(name) { if (name === 'react') return hookReact; if (name in mocks) return mocks[name]; return { __esModule: true, default: () => null }; },
  });
  return props => { cursor = 0; return module.exports.default(props); };
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
function panel(request, options = {}) {
  let speechCallbacks;
  const speech = { supported: true, cancel() {}, start() {}, stop() {}, ...options.speech };
  const render = componentHarness('src/components/AssistantPanel.jsx', {
    '../lib/assistantTools': toolRegistry,
    '../lib/assistantApi': { requestAssistant: request, createAssistantRequestId: () => requestId, assistantFormInput: (_, values) => values },
    '../hooks/useSpeechInput': { __esModule: true, default: callbacks => { speechCallbacks = callbacks; return speech; } },
    'lucide-react': { Sparkles: 'span', Mic: 'span', X: 'span' },
  });
  const props = { companyId, role: options.role || 'owner' };
  let tree = render(props);
  find(tree, 'button').props.onClick();
  const rerender = () => render(props);
  rerender.speech = speech;
  rerender.completeSpeech = text => speechCallbacks.onComplete(text);
  return rerender;
}
const typeText = (render, text) => find(render(), 'textarea').props.onChange({ target: { value: text } });
const submit = render => find(render(), 'form').props.onSubmit({ preventDefault() {} });

test('App mounts exactly one assistant across authenticated shell and V2, never on login or tenant switch', () => {
  const session = { sessaoAuth: { user: { id: userId } }, perfil: { id: userId }, empresaId: companyId,
    empresa: { id: companyId }, membresiaAtual: { role: 'owner', status: 'active' }, membresias: [], recarregar() {} };
  const Assistant = () => null;
  const render = componentHarness('src/App.jsx', {
    './lib/useSessao': { useSessao: () => session }, './lib/supabase': { configurado: true },
    './components/AssistantPanel': { __esModule: true, default: Assistant },
  });
  assert.equal(nodes(render()).filter(n => n.type === Assistant).length, 1);
  session.sessaoAuth = null;
  assert.equal(nodes(render()).filter(n => n.type === Assistant).length, 0);
  session.sessaoAuth = { user: { id: userId } }; session.trocandoEmpresa = true;
  assert.equal(nodes(render()).filter(n => n.type === Assistant).length, 0);
  session.trocandoEmpresa = false; session.membresiaAtual.role = 'technician';
  assert.equal(nodes(render()).filter(n => n.type === Assistant).length, 1);
  const renderV2 = componentHarness('src/App.jsx', {
    './lib/useSessao': { useSessao: () => session }, './lib/supabase': { configurado: true },
    './components/AssistantPanel': { __esModule: true, default: Assistant },
  }, { location: { search: '?v2=home' } });
  assert.equal(nodes(renderV2()).filter(n => n.type === Assistant).length, 1);
});

test('clarification is visible and reply retains minimal request context without execution', async () => {
  const calls = [];
  const render = panel(async payload => { calls.push(payload); return calls.length === 1 ? { question: 'Qual o nome do cliente?' } :
    { action: 'create_client', input: { name: 'João' }, preview: [{ label: 'Nome', value: 'João' }], confirmationRequired: true }; });
  typeText(render, 'Cadastre um cliente'); submit(render); await tick();
  assert.match(content(render()), /Qual o nome do cliente\?/);
  assert.match(content(render()), /Sua resposta/);
  typeText(render, 'João'); submit(render); await tick();
  assert.match(calls[1].text, /Cadastre um cliente\nPergunta: Qual o nome do cliente\?\nResposta: João/);
  assert.deepEqual(calls.map(c => c.operation), ['plan', 'plan']);
  assert.match(content(render()), /Aguardando sua confirmação/);
  assert.ok(find(render(), 'button', 'Confirmar'));
});

test('mutation waits for explicit confirmation; double tap and retry preserve requestId', async () => {
  const calls = []; let attempts = 0; let release;
  const render = panel(async payload => {
    calls.push(payload);
    if (payload.operation === 'plan') return { action: 'create_client', input: { name: 'João' }, confirmationRequired: true, preview: [] };
    attempts++;
    if (attempts === 1) { await new Promise(resolve => { release = resolve; }); throw new Error('Conexão interrompida'); }
    return { result: { id: userId, entityType: 'client', message: 'Ação concluída.' } };
  });
  typeText(render, 'Cadastre João'); submit(render); await tick();
  assert.equal(calls.length, 1);
  const confirm = find(render(), 'button', 'Confirmar');
  confirm.props.onClick(); confirm.props.onClick();
  assert.equal(calls.length, 2);
  release(); await tick();
  assert.match(content(render()), /O resultado pode já ter sido salvo/);
  find(render(), 'button', 'Consultar / tentar novamente').props.onClick(); await tick();
  assert.equal(calls[1].requestId, calls[2].requestId);
  assert.equal(calls[0].requestId, calls[1].requestId);
  assert.match(content(render()), /Ação concluída/);
  assert.equal(find(render(), 'button', 'Confirmar'), undefined);
});

test('API and authentication errors remain visible without breaking the panel', async () => {
  for (const [kind, expected] of [['api', /Falha na solicitação/], ['auth', /Sessão expirada/]]) {
    const render = panel(async () => { throw Object.assign(new Error('Falha simulada'), { kind }); });
    typeText(render, 'Pedido'); submit(render); await tick();
    assert.match(content(render()), expected);
    assert.ok(find(render(), 'textarea'));
    assert.equal(find(render(), 'button', 'Confirmar'), undefined);
  }
});

test('API clarification returns without a plan/execute RPC; mutation plan only calls preview RPC', async () => {
  const paths = [];
  let proposal = { question: 'Qual cliente?' };
  const handler = createAssistantHandler({ env: { ENABLE_PAID_AI: 'true', ANTHROPIC_API_KEY: 'test-placeholder' },
    resolveConfig: () => ({ configurado: true, url: 'https://example.invalid', publishableKey: 'test-placeholder' }),
    infer: async () => proposal,
    fetchImpl: async (url) => {
      paths.push(url);
      const data = url.endsWith('/auth/v1/user') ? { id: userId } : url.includes('/company_members?') ? [{ role: 'owner' }] : url.endsWith('zt_assistant_plan') ? { confirmationRequired: true } : companyId;
      return { ok: true, json: async () => data };
    },
  });
  const run = async () => {
    let status, result;
    await handler({ method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer test-placeholder' },
      body: { operation: 'plan', companyId, requestId, text: 'Cadastre um cliente' } },
    { setHeader() {}, status(value) { status = value; return this; }, json(value) { result = value; } });
    return { status, result };
  };
  assert.equal((await run()).result.question, 'Qual cliente?');
  assert.equal(paths.some(p => /zt_assistant_(plan|execute)$/.test(p)), false);
  proposal = { action: 'create_client', input: { name: 'João' } };
  assert.equal((await run()).result.confirmationRequired, true);
  assert.equal(paths.some(p => p.endsWith('zt_assistant_plan')), true);
  assert.equal(paths.some(p => p.endsWith('zt_assistant_execute')), false);
});

test('conversation opens with text and optional examples; manual tools are secondary and no interpretation step is required', () => {
  const render = panel(async () => ({}));
  const tree = render();
  assert.ok(find(tree, 'textarea'));
  assert.ok(find(tree, 'button', 'Enviar'));
  assert.equal(find(tree, 'button', 'Interpretar'), undefined);
  const manual = find(tree, 'details', 'Preencher ação manualmente');
  assert.ok(manual && !manual.props.open);
  assert.ok(find(manual, 'select'));
});

test('voice completion automatically plans once, never executes, and cancel/edit suppresses late completion', async () => {
  const calls = [];
  const render = panel(async p => { calls.push(p); return { action: 'create_client', confirmationRequired: true, preview: [] }; });
  find(render(), 'button', 'Ditar').props.onClick(); render();
  render.completeSpeech('Cria um cliente chamado TESTE ASSISTANT');
  render.completeSpeech('Cria um cliente chamado TESTE ASSISTANT');
  await tick();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].operation, 'plan');
  assert.match(calls[0].text, /TESTE ASSISTANT/);
  assert.ok(find(render(), 'button', 'Confirmar'));
  find(render(), 'button', 'Editar').props.onClick();
  find(render(), 'button', 'Ditar').props.onClick(); render();
  typeText(render, 'Texto corrigido'); render();
  render.completeSpeech('Texto antigo'); await tick();
  assert.equal(calls.length, 1);
  assert.equal(find(render(), 'textarea').props.value, 'Texto corrigido');
});

test('unsupported voice and listening/transcribing/processing states retain usable text fallback', async () => {
  const fallback = panel(async () => ({}), { speech: { supported: false } });
  assert.match(content(fallback()), /não oferece reconhecimento de voz/);
  typeText(fallback, 'O que tenho hoje?');
  assert.equal(find(fallback(), 'button', 'Enviar').props.disabled, false);
  let finish;
  const render = panel(() => new Promise(resolve => { finish = resolve; }));
  render.speech.listening = true; render.speech.busy = true;
  assert.match(content(render()), /Ouvindo/);
  render.speech.listening = false; render.speech.processing = true;
  assert.match(content(render()), /Transcrevendo/);
  assert.ok(find(render(), 'button', 'Cancelar ditado'));
  render.speech.processing = false; render.speech.busy = false;
  typeText(render, 'O que tenho hoje?'); submit(render);
  assert.match(content(render()), /Processando/);
  finish({ result: { items: [], message: 'Sem atendimentos.' } }); await tick();
  assert.ok(find(render(), 'textarea'), 'can continue in the same panel after a read');
});

test('technician tools exclude administrative data and sensitive completion requires reinforced confirmation', async () => {
  const calls = [];
  const render = panel(async p => { calls.push(p); return { action: 'finalize_assigned_work_order', confirmationRequired: true, preview: [] }; }, { role: 'technician' });
  const offered = nodes(render()).filter(n => n.type === 'option').map(n => n.props.value);
  assert.ok(!offered.includes('create_financial_entry') && !offered.includes('owner_find_client'));
  typeText(render, 'Finalizar esta OS'); submit(render); await tick();
  find(render(), 'button', 'Confirmar').props.onClick();
  assert.equal(calls.length, 1);
  find(render(), 'input').props.onChange({ target: { checked: true } });
  find(render(), 'button', 'Confirmar').props.onClick(); await tick();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].operation, 'execute');
});

test('spoken clarification preserves the original request instead of starting a new action', async () => {
  const calls = [];
  const render = panel(async p => { calls.push(p); return calls.length === 1 ? { question: 'Qual horário?' } : { confirmationRequired: true, preview: [] }; });
  typeText(render, 'Agenda OS-0002 amanhã'); submit(render); await tick();
  find(render(), 'button', 'Ditar').props.onClick(); render();
  render.completeSpeech('às 14h'); await tick();
  assert.match(calls[1].text, /Agenda OS-0002 amanhã\nPergunta: Qual horário\?\nResposta: às 14h/);
  assert.deepEqual(calls.map(p => p.operation), ['plan', 'plan']);
});
