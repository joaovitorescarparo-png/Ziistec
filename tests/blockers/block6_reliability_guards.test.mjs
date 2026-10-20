import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformSync } from 'esbuild';
import { createServer } from 'vite';
import * as unsaved from '../../src/lib/unsavedChanges.js';

// Bloco 6: confiabilidade operacional — formulário sujo não some ao tocar fora/fechar/navegar,
// sem alerta quando nada mudou e sem bloquear o salvar; lançamento manual não duplica com duplo toque;
// relato da memória não migra para outra OS; leitura de GPS atrasada não cai no cliente errado.

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const legacy = read('src/legacy/ZiisTecApp.jsx');

// ------------------------------------------------------------------ hooks reais com React simulado
function loadHooks() {
  const slots = []; const effects = []; let cursor = 0;
  const listeners = new Map();
  const window = {
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type, fn) { if (listeners.get(type) === fn) listeners.delete(type); },
  };
  const hookReact = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial;
      return [slots[i], (value) => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; },
    useEffect(fn, deps) { const i = cursor++; effects.push({ i, fn, deps }); },
  };
  const module = { exports: {} };
  const source = read('src/hooks/useUnsavedChanges.js');
  vm.runInNewContext(transformSync(source, { loader: 'js', format: 'cjs' }).code, {
    module, exports: module.exports, window,
    require(name) {
      if (name === 'react') return hookReact;
      if (name === '../lib/unsavedChanges') return unsaved;
      throw new Error(`import inesperado ${name}`);
    },
  });
  // Executa efeitos cujas dependências mudaram, como o React faria depois do commit.
  const cleanups = new Map(); const lastDeps = new Map();
  const commit = () => {
    for (const { i, fn, deps } of effects) {
      const prev = lastDeps.get(i);
      if (prev && deps && deps.length === prev.length && deps.every((d, k) => Object.is(d, prev[k]))) continue;
      cleanups.get(i)?.(); cleanups.set(i, fn()); lastDeps.set(i, deps);
    }
  };
  const render = (hook, ...args) => { cursor = 0; effects.length = 0; const out = module.exports[hook](...args); commit(); return out; };
  const unmount = () => { for (const c of cleanups.values()) c?.(); cleanups.clear(); };
  return { render, unmount, listeners };
}

test('retrato do formulário: sem alteração não é sujo; voltar ao valor original limpa; arquivo entra por nome/tamanho', () => {
  const base = unsaved.formSnapshot({ nome: 'Ana', itens: [] });
  assert.equal(unsaved.isDirty(base, { nome: 'Ana', itens: [] }), false);
  assert.equal(unsaved.isDirty(base, { nome: 'Ana Maria', itens: [] }), true);
  assert.equal(unsaved.isDirty(null, { nome: 'x' }), false, 'sem retrato não acusa alteração');
  const foto = new Blob(['abc'], { type: 'image/jpeg' });
  assert.notEqual(unsaved.formSnapshot({ fotos: [] }), unsaved.formSnapshot({ fotos: [{ arquivo: foto }] }));
});

test('useFormDirty: inativo nunca é sujo; edição suja; desfazer limpa; markClean rebaseia depois de salvar', () => {
  const h = loadHooks();
  assert.equal(h.render('useFormDirty', null, false).dirty, false);
  assert.equal(h.render('useFormDirty', { nome: '' }, true).dirty, false, 'abrir o formulário não é alteração');
  assert.equal(h.render('useFormDirty', { nome: 'Ana' }, true).dirty, true);
  assert.equal(h.render('useFormDirty', { nome: '' }, true).dirty, false, 'voltar ao valor original');
  const edited = h.render('useFormDirty', { nome: 'Ana' }, true);
  edited.markClean();
  assert.equal(h.render('useFormDirty', { nome: 'Ana' }, true).dirty, false, 'salvo e a tela continua aberta');
  assert.equal(h.render('useFormDirty', { nome: 'Ana' }, false).dirty, false);
  assert.equal(h.render('useFormDirty', { nome: 'Outra' }, true).dirty, false, 'reabrir tira novo retrato');
});

test('useDiscardGuard: sem alteração fecha direto; com alteração pergunta; continuar mantém; descartar fecha', () => {
  unsaved.resetUnsavedChangesForTests();
  let closed = 0;
  const onClose = () => { closed += 1; };
  const h = loadHooks();
  let g = h.render('useDiscardGuard', { dirty: false, onClose });
  g.requestClose();
  assert.equal(closed, 1, 'nada mudou: sem alerta');
  assert.equal(h.listeners.has('beforeunload'), false);
  assert.equal(unsaved.hasUnsavedChanges(), false);

  g = h.render('useDiscardGuard', { dirty: true, onClose });
  assert.ok(h.listeners.has('beforeunload'), 'recarregar/fechar a aba pede confirmação');
  assert.equal(unsaved.hasUnsavedChanges(), true, 'navegação do app sabe do formulário');
  const event = { returnValue: undefined, preventDefault() { this.prevented = true; } };
  h.listeners.get('beforeunload')(event);
  assert.equal(event.prevented, true);
  g.requestClose();
  g = h.render('useDiscardGuard', { dirty: true, onClose });
  assert.equal(g.confirming, true);
  assert.equal(closed, 1, 'fundo/X com alteração não fecha sozinho');
  g.keepEditing();
  g = h.render('useDiscardGuard', { dirty: true, onClose });
  assert.equal(g.confirming, false);
  g.requestClose(); g = h.render('useDiscardGuard', { dirty: true, onClose });
  g.discard();
  assert.equal(closed, 2);
  h.unmount();
  assert.equal(h.listeners.has('beforeunload'), false, 'fechou: sem alerta residual');
  assert.equal(unsaved.hasUnsavedChanges(), false);
});

test('navegação que troca a tela pergunta só quando há alteração e respeita a resposta', () => {
  unsaved.resetUnsavedChangesForTests();
  let asked = 0;
  assert.equal(unsaved.confirmDiscardNavigation(() => { asked += 1; return false; }), true);
  assert.equal(asked, 0, 'sem formulário sujo: segue sem perguntar');
  const token = {};
  unsaved.markUnsaved(token, true);
  assert.equal(unsaved.confirmDiscardNavigation(() => { asked += 1; return false; }), false);
  assert.equal(unsaved.confirmDiscardNavigation(() => true), true);
  assert.equal(asked, 1);
  unsaved.markUnsaved(token, false);
  assert.equal(unsaved.hasUnsavedChanges(), false);
});

test('aviso de descarte: texto, "Continuar editando" em foco e toque fora mantém a edição', () => {
  const module = { exports: {} };
  vm.runInNewContext(transformSync(read('src/components/DiscardChangesPrompt.jsx'), { loader: 'jsx', format: 'cjs', jsx: 'transform' }).code, {
    module, exports: module.exports,
    require(name) { if (name === 'react') return React; if (name === '../lib/unsavedChanges') return unsaved; throw new Error(name); },
  });
  const Prompt = module.exports.default;
  assert.equal(renderToStaticMarkup(React.createElement(Prompt, { open: false })), '');
  const html = renderToStaticMarkup(React.createElement(Prompt, { open: true }));
  assert.match(html, /role="alertdialog"/);
  assert.match(html, /Descartar alterações\?/);
  assert.match(html, /Continuar editando/);
  const calls = [];
  const tree = Prompt({ open: true, onKeepEditing: () => calls.push('keep'), onDiscard: () => calls.push('discard') });
  const flatten = (n) => !n || typeof n !== 'object' ? [] : Array.isArray(n) ? n.flatMap(flatten) : [n, ...flatten(n.props?.children)];
  const buttons = flatten(tree).filter((n) => n.type === 'button');
  buttons.find((b) => flatten(b.props.children).length === 0 && b.props.children === 'Descartar').props.onClick();
  buttons.find((b) => b.props.children === 'Continuar editando').props.onClick();
  const backdrop = {}; tree.props.onClick({ target: backdrop, currentTarget: backdrop });
  tree.props.onClick({ target: {}, currentTarget: backdrop });
  assert.deepEqual(calls, ['discard', 'keep', 'keep'], 'clique dentro do cartão não fecha');
});

// ------------------------------------------------------------------ lançamento: mesmo requestId no retry
const fakeCalls = [];
globalThis.__ztFakeSupabaseB6 = {
  rpc: async (name, args) => { fakeCalls.push({ name, args }); return { data: 'fe-1', error: null }; },
  from: () => { const q = new Proxy({}, { get: (_, p) => p === 'then' ? (res) => res({ data: { id: 'fe-1', kind: 'expense', description: 'Peça', amount: 10 }, error: null }) : () => q }); return q; },
};
const fakePlugin = {
  name: 'zt-fake-supabase-b6', enforce: 'pre',
  resolveId(source, importer) { return importer && /[\\/]src[\\/]lib[\\/]/.test(importer) && /^\.\/supabase(\.js)?$/.test(source) ? '\0zt-fake-supabase-b6' : null; },
  load(id) { return id === '\0zt-fake-supabase-b6' ? 'export const supabase = globalThis.__ztFakeSupabaseB6; export const configurado = true; export const ambienteSupabase = "test"; export function mensagemErro(e){ return e?.message || String(e || ""); } export function sessaoExpirou(){ return false; }' : null; },
};
let vite; let dataApi;
before(async () => {
  if (globalThis.navigator) Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true });
  vite = await createServer({ plugins: [fakePlugin], server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom', logLevel: 'error' });
  dataApi = await vite.ssrLoadModule('/src/lib/dataApi.js');
});
after(async () => { await vite?.close(); });

test('lançamento manual: duplo toque/retry com o requestId do formulário envia a mesma chave ao banco', async () => {
  fakeCalls.length = 0;
  const form = { tipo: 'despesa', descricao: 'Peça', valor: 10, vencimento: '2026-10-17', requestId: 'req-lanc-1' };
  await dataApi.salvarLancamentoDB({ ...form, pagoEm: null }, 'c1');
  await dataApi.salvarLancamentoDB({ ...form, pagoEm: null }, 'c1');
  assert.deepEqual(fakeCalls.map((c) => [c.name, c.args.p_request]), [['zt_save_manual_financial_entry', 'req-lanc-1'], ['zt_save_manual_financial_entry', 'req-lanc-1']]);
});

test('legado: lançamento bloqueia envio duplicado e guarda o requestId no formulário', () => {
  assert.match(legacy, /const \[salvandoLancamento, setSalvandoLancamento\] = useState\(false\);/);
  assert.match(legacy, /<Btn disabled=\{!form\.descricao \|\| !form\.valor \|\| salvandoLancamento\}/);
  assert.match(legacy, /if \(salvandoLancamento\) return;/);
  assert.match(legacy, /let requestId = form\.requestId;[\s\S]{0,260}requestId = globalThis\.crypto\.randomUUID\(\);\s*setForm\(\(f\) => \(f \? \{ \.\.\.f, requestId \} : f\)\);/);
  assert.match(legacy, /await salvarLancamentoDB\(\{ \.\.\.form, requestId, pagoEm: form\.pago \? HOJE : null \}, empresaId\)/);
  assert.match(legacy, /finally \{ setSalvandoLancamento\(false\); \}/);
});

// ------------------------------------------------------------------ fiação nas telas
test('legado: Modal guarda fundo e X; formulários críticos informam alteração; salvar segue fechando direto', () => {
  // Bloco 7: o mesmo guard agora também atende Esc/Voltar (useModalDismiss usa useDiscardGuard).
  assert.match(legacy, /function Modal\(\{ open, onClose, title, sub, children, footer, wide, dirty = false, busy = false \}\) \{\s*const \{ overlay, scroller \} = useModalViewport\(open\);\s*const guard = useModalDismiss\(\{ open, dirty, busy, onClose, overlayRef: overlay \}\);\s*if \(!open\) return null;/);
  assert.match(read('src/hooks/useModalDismiss.js'), /const guard = useDiscardGuard\(\{ dirty: Boolean\(open && dirty\), onClose \}\);/);
  assert.match(legacy, /<div className="absolute inset-0 bg-slate-900\/40" onClick=\{guard\.requestClose\} \/>/);
  assert.match(legacy, /<button onClick=\{guard\.requestClose\} aria-label="Fechar"/);
  assert.match(legacy, /<DiscardChangesPrompt open=\{guard\.confirming\} onKeepEditing=\{guard\.keepEditing\} onDiscard=\{guard\.discard\} \/>/);
  for (const marker of [
    '<Modal open onClose={onClose} dirty={dirty} busy={salvando} wide title="Cadastrar cliente"',
    '<Modal open onClose={() => setForm(null)} dirty={dirty} busy={salvandoCliente} title={form.id ? "Editar cliente" : "Novo cliente"}',
    '<Modal open onClose={onClose} dirty={dirty} busy={criando} wide title="Nova ordem de serviço"',
    '<Modal open onClose={onClose} dirty={registroAlterado} busy={concluindo} wide title="Editar registro do atendimento"',
    '<Modal open onClose={onClose} dirty={registroAlterado} busy={concluindo} wide title={atual.titulo}',
    '<Modal open onClose={() => setForm(null)} dirty={lancamentoAlterado} busy={salvandoLancamento} title="Novo lançamento"',
    '<Modal open onClose={() => setForm(null)} dirty={dirty} busy={salvandoCompra} wide title={form.id ? `Editar ${form.numero}` : "Nova compra"}',
  ]) assert.ok(legacy.includes(marker), `formulário ligado ao guard: ${marker}`);
  // Formulário com retrato tirado na abertura (cadastro rápido zera ao fechar).
  assert.match(legacy, /else setF\(null\); \}, \[aberto\]\);\s*const \{ dirty \} = useFormDirty\(f, Boolean\(aberto && f\)\);/);
  assert.match(legacy, /useFormDirty\(\{ relato, materiais, temAdicional, adicionais, custosExtras, temPendencia, pendencia, resultado,/);
  // Salvar continua fechando pelo próprio fluxo (sem passar pela pergunta).
  assert.match(legacy, /const id = await onSave\(form\); if \(!id\) return; setForm\(null\); onSaved\?\.\(id\);/);
  assert.match(legacy, /await onSave\(\{ \.\.\.f, whatsapp: f\.whatsapp \|\| f\.telefone \}\); if \(id\) onClose\(\);/);
});

test('legado: Voltar do editor de orçamento pergunta com alteração; depois de salvar não pergunta; menu também', () => {
  assert.match(legacy, /const \{ dirty: orcamentoAlterado, markClean: orcamentoSalvo \} = useFormDirty\(d\);\s*const saidaOrcamento = useDiscardGuard\(\{ dirty: orcamentoAlterado, onClose: onFechar \}\);/);
  assert.match(legacy, /if \(!id\) return; +\/\/ erro já foi avisado por salvarOrcamento\s*orcamentoSalvo\(\);\s*if \(edicao\) \{ onFechar\(\); return; \}/);
  assert.match(legacy, /<button onClick=\{saidaOrcamento\.requestClose\} className=\{cx\("flex items-center gap-2 text-\[14px\] text-slate-500 mb-5/);
  assert.match(legacy, /const irPara = \(t\) => \{\s*if \(!confirmDiscardNavigation\(\)\) return;/);
});

test('app: Assistente e troca de workspace não descartam formulário sem perguntar', () => {
  const app = read('src/App.jsx');
  assert.match(app, /const abrirWorkspaceV2 = \(valor\) => \{\s*if \(!confirmDiscardNavigation\(\)\) return;/);
  assert.match(app, /abrirRecursoV2: \(chave\) => \{ if \(confirmDiscardNavigation\(\)\) navegarV2\(chave\); \},/);
  assert.match(app, /record\.entityType !== 'work_order' && s\.membresiaAtual\?\.role !== 'owner'\)\) return;\s*\/\/[^\n]*\s*if \(!confirmDiscardNavigation\(\)\) return;\s*const url = new URL/);
});

test('memória da OS: relato não salvo não segue para outra OS; voltar/trocar pergunta e limpa ao descartar', () => {
  const memory = read('src/screens/v2/WorkOrderMemoryBaseV2.jsx');
  assert.match(memory, /useDiscardGuard\(\{dirty:Boolean\(report\.trim\(\)\)&&!savingReport,onClose:\(\)=>\{\s*const go=pendingNavigation\.current;pendingNavigation\.current=null;\s*setReport\(''\);setInterim\(''\);reportRequestRef\.current=null;go\?\.\(\);/);
  assert.match(memory, /<button onClick=\{\(\)=>navigateFromWorkOrder\(selected\?\(\)=>setSelected\(null\):onClose\)\}/);
  assert.match(memory, /onNavigateWorkOrder=\{\(id\)=>navigateFromWorkOrder\(\(\)=>setSelected\(id\)\)\}/);
  assert.doesNotMatch(memory, /onNavigateWorkOrder=\{setSelected\}/);
  assert.match(memory, /<DiscardChangesPrompt open=\{leaveWorkOrder\.confirming\}/);
});

test('local do cliente: leitura de GPS que chega depois de trocar de cliente é descartada', () => {
  const locations = read('src/screens/v2/ClientLocationsV2.jsx');
  assert.match(locations, /const select=\(client\)=>\{\s*gpsRequest\.current=null;setLocating\(false\);/);
  assert.match(locations, /const request=\{clientId:selectedId\};\s*gpsRequest\.current=request;/);
  assert.match(locations, /\(\{coords\}\)=>\{if\(gpsRequest\.current!==request\)return;/);
  assert.match(locations, /\(e\)=>\{if\(gpsRequest\.current!==request\)return;/);
});
