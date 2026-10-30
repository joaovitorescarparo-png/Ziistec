import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import * as unsaved from '../../src/lib/unsavedChanges.js';
import * as modalStackModule from '../../src/lib/modalStack.js';
import * as drafts from '../../src/lib/formDrafts.js';

// Bloco 7: resiliência mobile. Esc e Voltar (Android/navegador) no modal passam pelo mesmo guard do
// Bloco 6; salvando, nada fecha; rascunho mínimo isolado por usuário/empresa; OS relida do banco não
// perde relato/checklist/fotos/histórico depois de trocar status ou agenda.

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const legacy = read('src/legacy/ZiisTecApp.jsx');

// ------------------------------------------------------------------ runtime de hooks reais
function createRuntime() {
  const slots = []; let cursor = 0; let effects = [];
  const cleanups = new Map(); const lastDeps = new Map();
  const hookReact = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], (value) => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; },
    useEffect(fn, deps) { const i = cursor++; effects.push({ i, fn, deps }); },
  };
  const load = (path, mocks = {}) => {
    const module = { exports: {} };
    vm.runInNewContext(transformSync(read(path), { loader: 'js', format: 'cjs' }).code, {
      module, exports: module.exports,
      require(name) { if (name === 'react') return hookReact; if (name in mocks) return mocks[name]; throw new Error(`import inesperado ${name}`); },
    });
    return module.exports;
  };
  const commit = () => {
    for (const { i, fn, deps } of effects) {
      const prev = lastDeps.get(i);
      if (prev && deps && deps.length === prev.length && deps.every((d, k) => Object.is(d, prev[k]))) continue;
      cleanups.get(i)?.(); const cleanup = fn(); cleanups.set(i, typeof cleanup === 'function' ? cleanup : undefined); lastDeps.set(i, deps);
    }
  };
  const render = (fn) => { cursor = 0; effects = []; const out = fn(); commit(); return out; };
  const unmount = () => { for (const c of cleanups.values()) c?.(); cleanups.clear(); lastDeps.clear(); };
  return { load, render, unmount };
}

function loadModalDismiss(rt) {
  const hooks = rt.load('src/hooks/useUnsavedChanges.js', { '../lib/unsavedChanges': unsaved });
  return rt.load('src/hooks/useModalDismiss.js', { './useUnsavedChanges': hooks, '../lib/modalStack': modalStackModule }).useModalDismiss;
}

// Navegador simulado: histórico com pushState/back (popstate) e teclado.
function fakeBrowser() {
  const entries = [{ state: null, url: 'https://app.test/' }]; let index = 0; const listeners = {};
  let pushes = 0; let backs = 0;
  const win = {
    location: { get href() { return entries[index].url; } },
    history: {
      get state() { return entries[index].state; },
      pushState(state, _title, url) { entries.splice(index + 1); entries.push({ state, url }); index += 1; pushes += 1; },
      back() { if (!index) return; backs += 1; index -= 1; (listeners.popstate || []).forEach((fn) => fn({ state: entries[index].state })); },
    },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    removeEventListener(type, fn) { listeners[type] = (listeners[type] || []).filter((x) => x !== fn); },
  };
  const key = (k, target) => { const ev = { key: k, target, prevented: false, preventDefault() { this.prevented = true; } };
    (listeners.keydown || []).forEach((fn) => fn(ev)); return ev; };
  return { win, back: () => win.history.back(), key, depth: () => index, counts: () => ({ pushes, backs }) };
}

const inside = { inside: true, ownerDocument: {} };
const outside = { inside: false, ownerDocument: {} };
const overlayRef = { current: { contains: (t) => t?.inside === true } };

function modalHarness({ dirty = false, busy = false, browser = fakeBrowser() } = {}) {
  const rt = createRuntime();
  const useModalDismiss = loadModalDismiss(rt);
  const state = { closed: 0, props: null };
  state.props = { open: true, dirty, busy, onClose: () => { state.closed += 1; }, overlayRef, win: browser.win };
  const view = () => rt.render(() => useModalDismiss(state.props));
  return { rt, view, browser, state, set: (patch) => { state.props = { ...state.props, ...patch }; } };
}

beforeEach(() => { unsaved.resetUnsavedChangesForTests(); });

// Execute the actual footer JSX so a direct onClose bypass cannot hide behind hook-only tests.
function formFooter(name, values, requestClose) {
  const source = legacy.slice(legacy.indexOf(`function ${name}(`));
  const expression = source.match(/footer=\{(\(requestClose\) => <>[\s\S]*?<\/>)\}/)?.[1];
  assert.ok(expression, `${name} supplies its footer through the modal close guard`);
  const nodes = [];
  const React = { Fragment: 'fragment', createElement(type, props, ...children) {
    const node = { type, props: props || {}, children }; nodes.push(node); return node;
  } };
  const context = { React, Btn: 'Btn', ...values, requestClose };
  vm.runInNewContext(transformSync(`(${expression})(requestClose)`, { loader: 'jsx', jsx: 'transform' }).code, context);
  return nodes.filter((n) => n.type === 'Btn');
}

test('actual form Cancel buttons honor busy, dirty, keep editing and discard', () => {
  const cases = [
    ['ClienteRapido', { salvando: true, pronto: true }],
    ['ClienteForm', { salvandoCliente: true, form: { nome: 'Teste' }, onSave() {} }],
    ['NovaOS', { criando: true, pronto: true, criar() {} }],
    ['CompraForm', { salvandoCompra: true, form: { fornecedor: 'Teste', itens: [{}] }, brl: String, total: 1 }],
    ['Financeiro', { salvandoLancamento: true, form: { descricao: 'Teste', valor: 1 } }],
  ];
  for (const [name, values] of cases) {
    const h = modalHarness({ busy: true, dirty: true });
    const cancel = (guard, props) => formFooter(name, props, guard.requestClose).find((n) => n.children.includes('Cancelar'));
    let guard = h.view();
    let button = cancel(guard, values);
    assert.equal(button.props.disabled, true, name);
    button.props.onClick();
    assert.equal(h.state.closed, 0, 'save pending: cannot close even by direct callback');
    h.set({ busy: false }); guard = h.view();
    const idle = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, typeof v === 'boolean' ? false : v]));
    cancel(guard, idle).props.onClick(); guard = h.view();
    assert.equal(guard.confirming, true, name);
    guard.keepEditing(); guard = h.view();
    assert.equal(h.state.closed, 0);
    cancel(guard, idle).props.onClick(); guard = h.view(); guard.discard();
    assert.equal(h.state.closed, 1);
    h.rt.unmount();
  }
});

test('client save failure retains form; retry closes only after success', async () => {
  let closed = 0; let saved = 0; let busy = false; let result = null;
  const values = { salvandoCliente: false, form: { nome: 'Teste' },
    setSalvandoCliente: (v) => { busy = v; }, onSave: async () => result,
    setForm: () => { closed += 1; }, onSaved: () => { saved += 1; } };
  const save = () => formFooter('ClienteForm', values, () => {}).find((n) => !n.children.includes('Cancelar')).props.onClick();
  await save();
  assert.equal(closed, 0); assert.equal(saved, 0); assert.equal(busy, false);
  result = 'client-id'; await save();
  assert.equal(closed, 1); assert.equal(saved, 1); assert.equal(busy, false);
});

test('quick client waits for save, blocks duplicate submit and retains data on failure', async () => {
  let closed = 0; let calls = 0; let resolve;
  const values = { salvando: false, pronto: true, f: { nome: 'Teste', telefone: '123' },
    salvandoRef: { current: false }, setSalvando() {}, onClose: () => { closed += 1; },
    onSave: () => { calls += 1; return new Promise((r) => { resolve = r; }); } };
  const save = formFooter('ClienteRapido', values, () => {}).find((n) => !n.children.includes('Cancelar')).props.onClick;
  const pending = save(); await save();
  assert.equal(calls, 1); assert.equal(closed, 0);
  resolve(null); await pending; assert.equal(closed, 0);
  const retry = save(); resolve('client-id'); await retry;
  assert.equal(calls, 2); assert.equal(closed, 1);
});

test('purchase save failure retains form and successful retry closes it', async () => {
  let closed = 0; let result = false;
  const values = { salvandoCompra: false, form: { fornecedor: 'Teste', itens: [{}] }, total: 1, brl: String,
    setSalvandoCompra() {}, onSave: async () => result, setForm: () => { closed += 1; } };
  const save = () => formFooter('CompraForm', values, () => {}).find((n) => !n.children.includes('Cancelar')).props.onClick();
  await save(); assert.equal(closed, 0);
  result = true; await save(); assert.equal(closed, 1);
});

test('purchase persisted before upload failure retains identity and later edits for retry', async () => {
  let current = { fornecedor: 'Edited while waiting', itens: [{}] };
  const values = { salvandoCompra: false, form: { fornecedor: 'Original', itens: [{}] }, total: 1, brl: String,
    setSalvandoCompra() {}, onSave: async () => ({ ok: false, id: 'purchase-id', requestId: 'request-id' }),
    setForm: (next) => { current = typeof next === 'function' ? next(current) : next; } };
  await formFooter('CompraForm', values, () => {}).find((n) => !n.children.includes('Cancelar')).props.onClick();
  assert.equal(current.id, 'purchase-id'); assert.equal(current.requestId, 'request-id');
  assert.equal(current.fornecedor, 'Edited while waiting');
});

test('purchase callback reports partial persistence when document upload fails', async () => {
  const start = legacy.indexOf('  const salvarCompra = async (c) => {');
  const source = legacy.slice(start, legacy.indexOf('\n  const props =', start));
  let failUpload = true; let savedId = null;
  const callback = vm.runInNewContext(`${source}\nsalvarCompra`, {
    real: true, empresaId: 'company', usuarioAtual: { id: 'owner' },
    salvarCompraDB: async () => ({ id: 'purchase-id', requestId: 'request-id' }),
    uploadDocumentosCompraDB: async () => { if (failUpload) throw new Error('upload failed'); },
    recarregarDados: async () => {}, aviso() {}, mensagemErro: (e) => e.message,
    setCompraAberta: (id) => { savedId = id; },
  });
  const failed = await callback({ anexos: [] });
  assert.equal(failed.ok, false); assert.equal(failed.id, 'purchase-id'); assert.equal(savedId, null);
  failUpload = false;
  assert.equal(await callback({ id: failed.id, requestId: failed.requestId, anexos: [] }), true);
  assert.equal(savedId, 'purchase-id');
});

// ------------------------------------------------------------------ Esc
test('Esc: modal limpo fecha; foco em outro painel não fecha o modal', () => {
  const h = modalHarness();
  h.view();
  h.browser.key('Escape', outside);
  assert.equal(h.state.closed, 0, 'Esc dentro do Assistente/outro painel não é do modal');
  const ev = h.browser.key('Escape', inside);
  assert.equal(h.state.closed, 1);
  assert.equal(ev.prevented, true);
  h.rt.unmount();
  assert.equal(h.browser.depth(), 0, 'fechar devolve a entrada de histórico do modal');
});

test('Esc: com alteração pergunta; Esc no aviso = continuar editando; descartar fecha; salvando não fecha', () => {
  const h = modalHarness({ dirty: true });
  let g = h.view();
  h.browser.key('Escape', inside); g = h.view();
  assert.equal(g.confirming, true);
  assert.equal(h.state.closed, 0);
  h.browser.key('Escape', inside); g = h.view();
  assert.equal(g.confirming, false, 'Esc no aviso mantém os dados');
  assert.equal(h.state.closed, 0);
  h.browser.key('Escape', inside); g = h.view();
  g.discard();
  assert.equal(h.state.closed, 1);

  const busy = modalHarness({ dirty: true, busy: true });
  g = busy.view();
  busy.browser.key('Escape', inside); g = busy.view();
  g.requestClose(); g = busy.view();
  assert.equal(g.confirming, false);
  assert.equal(busy.state.closed, 0, 'salvando: Esc, fundo e X não fecham');
});

// ------------------------------------------------------------------ Voltar do Android / navegador
test('Voltar com modal limpo fecha o modal e não abandona a tela', () => {
  const h = modalHarness();
  h.view();
  assert.equal(h.browser.depth(), 1, 'abrir o modal cria UMA entrada na mesma URL');
  h.browser.back();
  assert.equal(h.state.closed, 1);
  h.rt.unmount();
  assert.equal(h.browser.depth(), 0);
  assert.deepEqual(h.browser.counts(), { pushes: 1, backs: 1 }, 'sem back extra nem pushState em loop');
});

test('Voltar com alteração pergunta; continuar editando preserva; descartar fecha e consome a entrada', () => {
  const h = modalHarness({ dirty: true });
  let g = h.view();
  h.browser.back(); g = h.view();
  assert.equal(g.confirming, true);
  assert.equal(h.state.closed, 0);
  assert.equal(h.browser.depth(), 1, 'continua na tela com a entrada do modal');
  g.keepEditing(); g = h.view();
  assert.equal(g.confirming, false);
  assert.equal(h.state.closed, 0, 'dados mantidos');
  h.browser.back(); g = h.view();
  assert.equal(g.confirming, true);
  h.browser.back(); g = h.view();
  assert.equal(g.confirming, false, 'Voltar com o aviso aberto = continuar editando');
  assert.equal(h.browser.depth(), 1);
  h.browser.back(); g = h.view();
  g.discard();
  assert.equal(h.state.closed, 1);
  h.rt.unmount();
  assert.equal(h.browser.depth(), 0);
  const { pushes } = h.browser.counts();
  assert.equal(pushes, 5, 'abrir + um pushState por Voltar que manteve o modal (4), nunca em loop');
});

test('Voltar salvando mantém o modal; salvar fecha sem perguntar e sem Voltar extra', () => {
  const busy = modalHarness({ dirty: true, busy: true });
  busy.view();
  busy.browser.back(); const g = busy.view();
  assert.equal(g.confirming, false);
  assert.equal(busy.state.closed, 0);
  assert.equal(busy.browser.depth(), 1);

  const saved = modalHarness({ dirty: true });
  saved.view();
  saved.rt.unmount(); // salvar fecha o modal pelo próprio fluxo
  assert.equal(saved.state.closed, 0);
  assert.equal(saved.browser.depth(), 0);
  assert.deepEqual(saved.browser.counts(), { pushes: 1, backs: 1 });
});

test('modais aninhados: Esc e Voltar tratam só o do topo; reabrir rápido (StrictMode) não fecha o novo', () => {
  const browser = fakeBrowser();
  const outer = modalHarness({ browser });
  const inner = modalHarness({ browser });
  outer.view(); inner.view();
  browser.key('Escape', inside);
  assert.deepEqual([outer.state.closed, inner.state.closed], [0, 1]);
  inner.rt.unmount();
  browser.back();
  assert.deepEqual([outer.state.closed, inner.state.closed], [1, 1]);
  outer.rt.unmount();

  const again = modalHarness();
  again.view(); again.rt.unmount(); again.view();
  assert.equal(again.state.closed, 0, 'popstate do fechamento anterior é ignorado');
  again.browser.back();
  assert.equal(again.state.closed, 1);
});

test('pilha: fechar quando outra navegação empilhou depois não chama history.back', () => {
  const b = fakeBrowser();
  const stack = modalStackModule.createModalStack(b.win);
  const entry = stack.open({ onBack() {}, onEscape() {} });
  b.win.history.pushState({ assistant: true }, '', 'https://app.test/?v2=clientes-locais');
  entry.close();
  assert.equal(b.depth(), 2);
  assert.equal(b.counts().backs, 0);
});

// ------------------------------------------------------------------ rascunho
const USER_A = '10000000-0000-4000-8000-00000000000a';
const USER_B = '10000000-0000-4000-8000-00000000000b';
const COMPANY_A = '20000000-0000-4000-8000-00000000000a';
const COMPANY_B = '20000000-0000-4000-8000-00000000000b';
const REQUEST = '30000000-0000-4000-8000-000000000001';
const CLIENT = '40000000-0000-4000-8000-000000000001';

function fakeStorage({ fail = false } = {}) {
  const map = new Map();
  return { map, get length() { return map.size; }, key: (i) => [...map.keys()][i] ?? null,
    getItem(k) { if (fail) throw new Error('bloqueado'); return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { if (fail) throw new Error('quota'); map.set(k, String(v)); },
    removeItem(k) { map.delete(k); } };
}

test('rascunho: só texto operacional; fora CPF/CNPJ, itens com preço/custo, ids inválidos e campos desconhecidos', () => {
  const data = drafts.sanitizeDraft('cliente-novo', { tipo: 'PJ', nome: 'Condomínio Aurora', documento: '11.222.333/0001-44',
    telefone: '11 3000-0001', latitude: '-23.5', token: 'x', id: CLIENT, obs: 'a'.repeat(6000) });
  assert.deepEqual(Object.keys(data).sort(), ['nome', 'obs', 'telefone', 'tipo']);
  assert.equal(data.obs.length, 5000);
  const os = drafts.sanitizeDraft('os-nova', { clienteId: CLIENT, descricaoLivre: 'Trocar sensor', requestId: REQUEST, responsavelId: 'u1',
    itens: [{ nome: 'Sensor', preco: 250, custo: 120 }], custosExtras: 50, unit_price: 9 });
  assert.deepEqual(os, { clienteId: CLIENT, descricaoLivre: 'Trocar sensor', requestId: REQUEST });
  assert.equal(drafts.sanitizeDraft('cliente-novo', { requestId: REQUEST }).requestId, undefined, 'requestId de OS não vai para outro formulário');
  assert.equal(drafts.sanitizeDraft('lancamento', { descricao: 'x' }), null, 'formulário fora da lista não tem rascunho');
});

test('rascunho isolado: outra empresa e outro usuário nunca restauram; conteúdo adulterado é rejeitado', () => {
  const s = fakeStorage();
  drafts.setDraftScope({ userId: USER_A, companyId: COMPANY_A }, s);
  assert.equal(drafts.writeDraft('cliente-novo', { nome: 'Cliente A' }, { storage: s }), true);
  assert.equal(drafts.readDraft('cliente-novo', { storage: s }).data.nome, 'Cliente A');

  drafts.setDraftScope({ userId: USER_A, companyId: COMPANY_B }, s);
  assert.equal(drafts.readDraft('cliente-novo', { storage: s }), null, 'empresa B não vê o rascunho da A');
  assert.equal(s.map.size, 0, 'trocar de empresa apaga o rascunho de outro escopo');

  drafts.setDraftScope({ userId: USER_A, companyId: COMPANY_A }, s);
  drafts.writeDraft('cliente-novo', { nome: 'Cliente A' }, { storage: s });
  drafts.setDraftScope({ userId: USER_B, companyId: COMPANY_A }, s);
  assert.equal(drafts.readDraft('cliente-novo', { storage: s }), null, 'usuário B não vê o rascunho do A');

  const forgedKey = `zt:draft:v1:${COMPANY_A}:${USER_B}:cliente-novo`;
  s.setItem(forgedKey, JSON.stringify({ v: 1, formType: 'cliente-novo', userId: USER_A, companyId: COMPANY_A, savedAt: Date.now(), data: { nome: 'x' } }));
  assert.equal(drafts.readDraft('cliente-novo', { storage: s }), null);
  assert.equal(s.getItem(forgedKey), null, 'payload de outro usuário na chave atual é apagado');

  drafts.setDraftScope(null, s);
  assert.equal(drafts.writeDraft('cliente-novo', { nome: 'x' }, { storage: s }), false, 'sem sessão não grava');
});

test('rascunho expirado, de versão antiga ou com storage bloqueado não restaura nem quebra', () => {
  const s = fakeStorage();
  drafts.setDraftScope({ userId: USER_A, companyId: COMPANY_A }, s);
  const t0 = 1_000_000;
  drafts.writeDraft('os-nova', { descricaoLivre: 'Revisão' }, { storage: s, now: t0 });
  assert.equal(drafts.readDraft('os-nova', { storage: s, now: t0 + drafts.DRAFT_TTL_MS + 1 }), null);
  assert.equal(s.map.size, 0, 'expirado é apagado');
  s.setItem(`zt:draft:v1:${COMPANY_A}:${USER_A}:os-nova`, JSON.stringify({ v: 0, formType: 'os-nova', userId: USER_A, companyId: COMPANY_A, savedAt: t0, data: { descricaoLivre: 'x' } }));
  assert.equal(drafts.readDraft('os-nova', { storage: s, now: t0 }), null, 'formato antigo/incompatível é descartado');
  s.setItem(`zt:draft:v1:${COMPANY_A}:${USER_A}:os-nova`, '{json quebrado');
  assert.equal(drafts.readDraft('os-nova', { storage: s, now: t0 }), null);
  const blocked = fakeStorage({ fail: true });
  assert.equal(drafts.writeDraft('os-nova', { descricaoLivre: 'x' }, { storage: blocked }), false);
  assert.equal(drafts.readDraft('os-nova', { storage: blocked }), null);
  drafts.writeDraft('os-nova', { descricaoLivre: 'x' }, { storage: s });
  drafts.purgeDrafts(s);
  assert.equal(s.map.size, 0, 'sair da conta apaga todos os rascunhos');
});

test('useFormDraft: restaura ao abrir, grava com alteração, grava em pagehide/segundo plano e apaga ao fechar', () => {
  const s = fakeStorage();
  globalThis.sessionStorage = s;
  drafts.setDraftScope({ userId: USER_A, companyId: COMPANY_A }, s);
  drafts.writeDraft('os-nova', { descricaoLivre: 'Trocar sensor', requestId: REQUEST });
  const target = () => { const l = {}; return { l, addEventListener(t, fn) { (l[t] ||= []).push(fn); }, removeEventListener(t, fn) { l[t] = (l[t] || []).filter((x) => x !== fn); }, fire(t) { (l[t] || []).forEach((fn) => fn()); } }; };
  const win = target(); const doc = Object.assign(target(), { visibilityState: 'visible' });
  const rt = createRuntime();
  const { useFormDraft } = rt.load('src/hooks/useFormDraft.js', { '../lib/formDrafts': drafts });
  let value = { descricaoLivre: '', requestId: null }; let dirty = false; const restored = [];
  const view = () => rt.render(() => useFormDraft({ formType: 'os-nova', enabled: true, value, dirty, win, doc,
    onRestore: (data) => { restored.push(data); value = { ...value, ...data }; dirty = true; } }));
  view();
  assert.deepEqual(restored, [{ descricaoLivre: 'Trocar sensor', requestId: REQUEST }], 'mesmo requestId: salvar de novo não duplica a OS');
  let r = view();
  assert.ok(r.restoredAt);
  assert.match(drafts.readDraft('os-nova').data.descricaoLivre, /Trocar sensor/);

  value = { ...value, descricaoLivre: 'Trocar sensor e cabo' }; view();
  assert.equal(drafts.readDraft('os-nova').data.descricaoLivre, 'Trocar sensor e cabo');
  s.map.clear();
  win.fire('pagehide');
  assert.equal(drafts.readDraft('os-nova').data.descricaoLivre, 'Trocar sensor e cabo', 'pagehide grava (iOS não deixa impedir o fechamento)');
  s.map.clear();
  doc.visibilityState = 'hidden'; doc.fire('visibilitychange');
  assert.ok(drafts.readDraft('os-nova'), 'segundo plano grava');

  dirty = false; view();
  assert.equal(drafts.readDraft('os-nova'), null, 'sem alteração não fica rascunho');
  dirty = true; value = { ...value, descricaoLivre: 'Outra' }; r = view();
  const initial = r.discardDraft();
  assert.deepEqual(initial, { descricaoLivre: '', requestId: null }, 'descartar devolve o formulário como abriu');
  assert.equal(drafts.readDraft('os-nova'), null, 'descartar apaga');
  view();
  rt.unmount();
  assert.equal(drafts.readDraft('os-nova'), null, 'fechar/salvar apaga');
  delete globalThis.sessionStorage;
});

// ------------------------------------------------------------------ estado da OS depois de trocar status/agenda
test('OS relida do banco mantém relato, checklist, fotos, histórico e materiais (antes sumiam até recarregar)', () => {
  const start = legacy.indexOf('function mesclarOSRelida(');
  const mesclar = vm.runInNewContext(`${legacy.slice(start, legacy.indexOf('\nfunction aplicarOSSalvaNoEstado', start))}\nmesclarOSRelida;`);
  const anterior = { id: 'os1', status: 'agendada', relato: 'Visita técnica', checklist: [{ id: 'c1', texto: 'Testar', feito: true }],
    fotos: [{ id: 'f1' }], historico: [{ id: 'h1', texto: 'Criada' }], retornos: [{ id: 'r1' }],
    itens: [{ id: 'i1', nome: 'Serviço' }, { id: 'm1', nome: 'Cabo', materialRegistrado: true }] };
  // fromWorkOrder: complementos vazios, itens só da tabela de itens.
  const salvo = { id: 'os1', status: 'andamento', relato: '', checklist: [], fotos: [], historico: [], itens: [{ id: 'i1', nome: 'Serviço' }] };
  const out = mesclar(anterior, salvo);
  assert.equal(out.status, 'andamento');
  assert.equal(out.relato, 'Visita técnica');
  assert.deepEqual(out.checklist, anterior.checklist);
  assert.deepEqual(out.fotos, anterior.fotos);
  assert.deepEqual(out.historico, anterior.historico);
  assert.deepEqual(out.retornos, anterior.retornos);
  assert.deepEqual(Array.from(out.itens, (i) => i.id), ['i1', 'm1']); // array criado no contexto vm
  const novo = mesclar(anterior, { ...salvo, checklist: [{ id: 'c2' }], relato: 'Novo relato' });
  assert.deepEqual(novo.checklist, [{ id: 'c2' }], 'dado novo do banco prevalece');
  assert.equal(novo.relato, 'Novo relato');
  assert.equal(mesclar(null, salvo), salvo);
});

// ------------------------------------------------------------------ fiação nas telas
test('legado: Modal usa useModalDismiss; save em andamento trava o fechamento nos formulários', () => {
  assert.match(legacy, /const guard = useModalDismiss\(\{ open, dirty, busy, onClose, overlayRef: overlay \}\);/);
  for (const marker of ['busy={salvandoCliente}', 'busy={criando}', 'busy={salvando} title="Agendar atendimento"',
    'busy={concluindo} wide title="Editar registro do atendimento"', 'busy={concluindo || gerando} wide title={atual.titulo}',
    'busy={salvandoLancamento}', 'busy={salvandoCompra}']) assert.ok(legacy.includes(marker), marker);
});

test('legado: rascunho só em Novo cliente e Nova OS (real); aviso permite descartar; status/agenda preservam a OS', () => {
  assert.match(legacy, /useFormDraft\(\{ formType: "cliente-novo", enabled: Boolean\(form && !form\.id\), value: form, dirty,/);
  assert.match(legacy, /useFormDraft\(\{ formType: "os-nova", enabled: real, value: \{ \.\.\.f, requestId: requestIdRef\.current \}, dirty,/);
  // Field Execution V1: a finalização passa a guardar só a Base Técnica (texto) e o relatório; orçamento e lançamento seguem sem rascunho.
  assert.equal((legacy.match(/useFormDraft\(\{/g) || []).length, 3, 'só Novo cliente, Nova OS e a Base Técnica da finalização guardam rascunho');
  assert.match(legacy, /useFormDraft\(\{ formType: "base-tecnica", enabled: real && !jaConcluida,/);
  assert.match(legacy, /<DraftRestoredNotice savedAt=\{rascunho\.restoredAt\} onDiscard=\{\(\) => setForm\(rascunho\.discardDraft\(\) \|\| \{ tipo: "PF" \}\)\} \/>/);
  assert.match(legacy, /<DraftRestoredNotice savedAt=\{rascunho\.restoredAt\} onDiscard=\{descartarRascunho\}/);
  assert.match(legacy, /x\.id===osId\?\{\.\.\.mesclarOSRelida\(x,salvo\),responsavel\}:x/);
  assert.match(legacy, /status:'unscheduled'\}\); setOrdens\(\(l\)=>l\.map\(\(x\)=>x\.id===osId\?mesclarOSRelida\(x,salvo\):x\)\);/);
  assert.match(legacy, /setOrdens\(\(l\)=>l\.map\(\(x\)=>x\.id===os\.id\?mesclarOSRelida\(x,inicio\?\{\.\.\.salvo,iniciadaEm:inicio\}:salvo\):x\)\);/);
  assert.match(legacy, /lista\.map\(\(x\) => x\.id === salvo\.id \? mesclarOSRelida\(x, salvo\) : x\)/);
});

test('sessão: escopo do rascunho = usuário + empresa; sair da conta apaga os rascunhos', () => {
  const app = read('src/App.jsx');
  assert.match(app, /setDraftScope\(draftUserId && s\.empresaId \? \{ userId: draftUserId, companyId: s\.empresaId \} : null\);/);
  const sessao = read('src/lib/useSessao.js');
  assert.equal((sessao.match(/localStorage\.removeItem\("ziistec_empresa_id"\);\s*purgeDrafts\(\);/g) || []).length, 2);
});

test('Bloco 5 intacto: 0105, projeções e regras de preço do técnico não mudaram neste bloco', () => {
  const migration = read('supabase/0105_technician_financial_projection.sql');
  assert.match(migration, /alter policy p_wo_items_select on public\.work_order_items\s+using \(public\.zt_wo_is_owned\(work_order_id\)\);/);
  assert.match(migration, /a\.attname not in \('approved_subtotal','approved_discount','approved_surcharge','approved_total'\)/);
  // O Bloco 7 não criou migration. A única posterior prevista é a preferência de rota da Onda 2 (0106), documentada à parte.
  const posteriores = fs.readdirSync(new URL('../../supabase/', import.meta.url)).filter((f) => /^01(0[6-9]|[1-9]\d)_/.test(f));
  assert.deepEqual(posteriores, ['0106_user_route_preferences.sql', '0107_technician_contract_cycle_guard.sql', '0108_supplier_tenant_foreign_keys.sql', '0109_stock_adjustment_idempotency.sql', '0110_team_invite_email_throttle.sql', '0111_field_execution_intelligence.sql', '0112_company_member_identity_guard.sql'], 'só a preferência de rota (Onda 2) e as migrations das auditorias de segurança V1, V1.1 e V1.2 (0112)');
});
