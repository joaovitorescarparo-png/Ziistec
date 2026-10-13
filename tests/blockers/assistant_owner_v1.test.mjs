import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import React from 'react';
import { transformSync } from 'esbuild';
import * as toolRegistry from '../../src/lib/assistantTools.js';

// Assistant Universal Owner V1 — voz no painel, esclarecimento monetário, histórico do cliente,
// leituras do proprietário e escritas canônicas. Provedor e banco simulados; a autoridade
// (empresa, papel, assinatura, estado) é provada no SQL v2_assistant_owner_v1_rollback.sql.
const companyId = '10000000-0000-4000-8000-000000000001';

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
