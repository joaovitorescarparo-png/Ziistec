import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import zlib from 'node:zlib';
import React from 'react';
import { transformSync } from 'esbuild';
import { createServer } from 'vite';
import * as unsavedChanges from '../../src/lib/unsavedChanges.js';
import * as formDrafts from '../../src/lib/formDrafts.js';
import * as recursosV2 from '../../src/lib/recursosV2.js';
import { LOGO_BOX, encaixarNaCaixa, ajustarTextoNaLargura } from '../../src/lib/pdfLogoBox.js';
import { estoqueBaixo } from '../../src/lib/estoque.js';
import { concluidasRecentemente, produtosComEstoqueBaixo } from '../../src/lib/dashboardInicio.js';

// Onda 1 da consolidação V2 (A1–A4): entradas V2 no app principal, textos de produto, caixa da logo nos PDFs
// e Início. Nada aqui toca banco: Supabase é falso e os PDFs são gerados em memória.

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const companyId = '10000000-0000-4000-8000-000000000001';
const userId = '20000000-0000-4000-8000-000000000002';
const clientId = '40000000-0000-4000-8000-000000000005';

// ------------------------------------------------------------------ A1 · harness do App (histórico simulado)
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
function app(start, role = 'owner') {
  const nav = browser(start);
  const session = { sessaoAuth: { user: { id: userId } }, perfil: { id: userId }, empresaId: companyId, empresa: { id: companyId },
    membresiaAtual: { role, status: 'active' }, membresias: [], recarregar() {} };
  const render = harness('src/App.jsx', { './lib/useSessao': { useSessao: () => session }, './lib/supabase': { configurado: true },
    './components/AssistantPanel': { __esModule: true, default: () => null }, './lib/unsavedChanges': unsavedChanges, './lib/formDrafts': formDrafts,
    './lib/recursosV2': recursosV2 }, { window: nav.window });
  const lazyNode = (tree, name) => nodes(tree).find(n => typeof n.type === 'function' && n.type.source?.includes(name));
  const contexto = () => lazyNode(render(), 'legacy/ZiisTecApp').props.contexto;
  return { nav, render, lazyNode, contexto };
}

test('A1 · cada aba mostra só as entradas V2 do proprietário; técnico e papel desconhecido não recebem nenhuma', () => {
  const chaves = (aba, papel) => recursosV2.recursosV2DaAba(aba, papel).map(r => r.chave);
  assert.deepEqual(chaves('catalogo', 'proprietario'), ['produtos']);
  assert.deepEqual(chaves('clientes', 'proprietario'), ['clientes-locais']);
  assert.deepEqual(chaves('garantias', 'proprietario'), ['garantias', 'pos-venda', 'contratos']);
  assert.deepEqual(chaves('financeiro', 'proprietario'), ['financeiro']);
  for (const aba of ['inicio', 'catalogo', 'clientes', 'garantias', 'financeiro', 'ordens', 'agenda', 'compras', 'config']) {
    for (const papel of ['tecnico', 'technician', undefined, null, '']) assert.deepEqual(chaves(aba, papel), [], `${aba}/${papel}`);
  }
  assert.deepEqual(recursosV2.recursosV2DaAba('compras', 'proprietario'), [], 'a aba Compras principal não ganha entrada V2');
  assert.deepEqual(recursosV2.recursosV2DaAba('config', 'proprietario'), [], 'a aba Configurações principal não ganha entrada V2');
});

test('A1 · toda entrada V2 mantém o owner gate da rota e as rotas ?v2= continuam registradas', () => {
  const appSource = read('src/App.jsx');
  for (const chave of Object.keys(recursosV2.RECURSOS_V2_OWNER)) {
    assert.match(appSource, new RegExp(`workspaceV2 === "${chave}" && owner`), `rota ${chave} sem owner gate`);
    assert.equal(recursosV2.recursoV2ExigeOwner(chave), true);
  }
  for (const chave of ['compras', 'configuracoes']) assert.match(appSource, new RegExp(`workspaceV2 === "${chave}" && owner`), `rota técnica ${chave} segue registrada`);
  assert.equal(recursosV2.recursoV2ExigeOwner('venda-os'), false, 'venda na OS continua aberta ao campo');
  assert.equal(recursosV2.recursoV2ExigeOwner('memoria-os'), false);
});

test('A1 · as abas usam as entradas sem duplicar Compras/Configurações e o técnico não ganha atalho administrativo', () => {
  const legacy = read('src/legacy/ZiisTecApp.jsx');
  for (const aba of ['clientes', 'catalogo', 'financeiro', 'garantias']) assert.match(legacy, new RegExp(`<RecursosV2 aba="${aba}" papel=\\{papel\\} abrirV2=\\{abrirV2\\} />`), `aba ${aba}`);
  assert.match(legacy, /papel === "proprietario" && abrirV2 && <Btn variant="soft" size="sm" icon=\{MapPin\} onClick=\{\(\) => abrirV2\("clientes-locais", \{ client: c\.id \}\)\}>Locais no mapa<\/Btn>/);
  assert.match(legacy, /recursosV2DaAba\(aba, papel\)\.map\(/);
  assert.doesNotMatch(legacy, /abrirV2\("(compras|configuracoes)"/);
  assert.doesNotMatch(legacy, /abrirRecursoV2\("(compras|configuracoes)"/);
  // o NAV do técnico continua curto e só abre a venda de campo
  assert.match(legacy, /tecnico: \["inicio", "agenda", "ordens", "registrarMateriais", "vendaCampo"\]/);
  assert.match(legacy, /onClick=\{\(\) => n\.id === "vendaCampo" \? contexto\?\.abrirRecursoV2\?\.\("venda-os"\) : irPara\(n\.id\)\}/);
});

test('A1 · Fechar numa tela V2 aberta pelo app principal volta à aba de origem, não ao hub escondido', () => {
  const a = app('https://app.example/');
  const ctx = a.contexto();
  assert.equal(ctx.abrirRecursoV2('financeiro', { origem: 'financeiro' }), true);
  assert.equal(a.nav.entries.length, 2, 'uma entrada nova de histórico');
  assert.equal(a.nav.window.location.search, '?v2=financeiro');
  assert.equal(recursosV2.abaDeOrigemV2(a.nav.entries[0].state), 'financeiro', 'a origem fica na entrada do app principal');
  assert.equal(recursosV2.voltaPeloHistorico(a.nav.entries[1].state), true);
  const screen = a.lazyNode(a.render(), 'FinanceV2');
  assert.ok(screen, 'FinanceV2 aberta');
  screen.props.onClose();
  assert.equal(a.nav.index(), 0);
  assert.equal(a.nav.window.location.search, '', 'URL volta limpa, sem ?v2=home');
  assert.equal(a.lazyNode(a.render(), 'FinanceV2'), undefined);
  assert.ok(a.lazyNode(a.render(), 'legacy/ZiisTecApp'), 'o app principal volta');
  assert.equal(recursosV2.abaDeOrigemV2(a.nav.window.history.state), 'financeiro', 'o app principal lê a aba de origem ao montar');
});

test('A1 · Voltar do navegador faz o mesmo e a troca entre telas V2 preserva a marca de origem', () => {
  const a = app('https://app.example/');
  a.contexto().abrirRecursoV2('garantias', { origem: 'garantias' });
  assert.ok(a.lazyNode(a.render(), 'ManualWarrantyV2'));
  a.nav.window.history.back();
  assert.ok(a.lazyNode(a.render(), 'legacy/ZiisTecApp'));
  assert.equal(recursosV2.abaDeOrigemV2(a.nav.window.history.state), 'garantias');

  const b = app('https://app.example/');
  b.contexto().abrirRecursoV2('garantias', { origem: 'garantias' });
  const warranty = b.lazyNode(b.render(), 'ManualWarrantyV2');
  warranty.props.onQuoteFromWarranty('Cobertura vencida');
  assert.ok(b.lazyNode(b.render(), 'QuoteAIV2'), 'garantia → orçamento com IA');
  assert.equal(recursosV2.voltaPeloHistorico(b.nav.window.history.state), true, 'a marca sobrevive a navegarV2');
  b.lazyNode(b.render(), 'QuoteAIV2').props.onClose();
  assert.ok(b.lazyNode(b.render(), 'QuotesManagementV2'));
  b.lazyNode(b.render(), 'QuotesManagementV2').props.onClose();
  assert.equal(b.nav.index(), 0, 'sair da cadeia devolve ao app principal');
  assert.ok(b.lazyNode(b.render(), 'legacy/ZiisTecApp'));
});

test('A1 · Pós-venda e Locais no mapa também voltam à origem; o cliente chega pelo parâmetro conhecido', () => {
  const a = app('https://app.example/');
  a.contexto().abrirRecursoV2('pos-venda', { origem: 'garantias' });
  a.lazyNode(a.render(), 'PostSaleV2').props.onClose();
  assert.equal(a.nav.index(), 0);
  assert.ok(a.lazyNode(a.render(), 'legacy/ZiisTecApp'));

  const b = app('https://app.example/');
  b.contexto().abrirRecursoV2('clientes-locais', { origem: 'clientes', params: { client: clientId, evil: 'x' } });
  const screen = b.lazyNode(b.render(), 'ClientLocationsV2');
  assert.equal(screen.props.initialClientId, clientId);
  const search = new URL(b.nav.window.location.href).searchParams;
  assert.equal(search.get('client'), clientId);
  assert.equal(search.get('evil'), null, 'só client/product/wo passam');
});

test('A1 · técnico não abre tela administrativa pelo abridor; a venda de campo continua disponível', () => {
  const a = app('https://app.example/', 'technician');
  const ctx = a.contexto();
  for (const chave of Object.keys(recursosV2.RECURSOS_V2_OWNER)) {
    assert.equal(ctx.abrirRecursoV2(chave, { origem: 'financeiro' }), false, chave);
    assert.equal(a.nav.entries.length, 1, `${chave}: histórico intocado`);
  }
  assert.equal(a.lazyNode(a.render(), 'FinanceV2'), undefined);
  assert.equal(ctx.abrirRecursoV2('venda-os'), true);
  assert.ok(a.lazyNode(a.render(), 'WorkOrderSaleV2'));
  // mesmo por URL direta o gate de rota continua fechando as telas do proprietário
  const direct = app('https://app.example/?v2=financeiro', 'technician');
  assert.equal(direct.lazyNode(direct.render(), 'FinanceV2'), undefined);
  assert.ok(direct.lazyNode(direct.render(), 'legacy/ZiisTecApp'));
});

test('A1 · tela aberta por URL direta mantém o fechamento antigo e a origem inválida é ignorada', () => {
  const direct = app(`https://app.example/?v2=clientes-locais&client=${clientId}`);
  direct.lazyNode(direct.render(), 'ClientLocationsV2').props.onClose();
  assert.equal(direct.nav.entries.length, 1);
  assert.equal(new URL(direct.nav.window.location.href).searchParams.get('v2'), 'home');
  assert.equal(recursosV2.abaDeOrigemV2({ ziistecShellOrigin: 'equipe' }), null);
  assert.equal(recursosV2.abaDeOrigemV2({ ziistecShellOrigin: '__proto__' }), null);
  assert.equal(recursosV2.abaDeOrigemV2(null), null);
  const { origemState } = recursosV2.estadosDeAberturaV2({ ziistecModais: ['m1'] }, 'compras');
  assert.deepEqual(origemState, { ziistecModais: ['m1'] }, 'origem desconhecida não é gravada e o resto do estado é preservado');
  assert.deepEqual(recursosV2.semOrigemV2({ ziistecShellOrigin: 'clientes', outro: 1 }), { outro: 1 });
  assert.equal(recursosV2.semOrigemV2({ outro: 1 }), null);
});

test('A1 · o app principal começa na aba de origem uma única vez', () => {
  const legacy = read('src/legacy/ZiisTecApp.jsx');
  assert.match(legacy, /const \[tela, setTela\] = useState\(\(\) => \(typeof window !== "undefined" \? abaDeOrigemV2\(window\.history\.state\) : null\) \|\| "inicio"\);/);
  assert.match(legacy, /const limpo = semOrigemV2\(window\.history\.state\);\s*if \(limpo\) window\.history\.replaceState\(limpo, "", window\.location\.href\);/);
});

// ------------------------------------------------------------------ A2 · textos de produto e falha segura sem as RPCs novas
const EXPOSTAS = [
  'src/screens/v2/ProductStockV2.jsx', 'src/screens/v2/FinanceV2.jsx', 'src/screens/v2/ManualWarrantyV2.jsx', 'src/screens/v2/MaintenanceContractsV2.jsx',
  'src/screens/v2/ClientLocationsV2.jsx', 'src/screens/v2/PostSaleV2.jsx', 'src/screens/v2/PurchasesV2.jsx', 'src/screens/v2/SettingsV2.jsx',
  'src/screens/v2/WorkOrderMemoryBaseV2.jsx', 'src/components/ServiceReceiptPanel.jsx', 'src/components/LocationHistoryPanel.jsx',
];
const INTERNO = [/Aguardando 0053/, /Margem bloqueada no preview/, /ainda não migrado/, /Nenhum dado de produção/, /prontos? para homologação/i, /banco protegido/i,
  /neste ambiente/i, /desta branch/i, /migrations? ?\d{4}/i, /\b0053\b|\b0054\b|\b0055\b|\b0057\b/, /\bledgers?\b/i, /no Staging/i, /\bRPCs?\b/, /\bRLS\b/, /unit_cost|extra_cost/,
  />V2<\/span>/];

test('A2 · as telas V2 expostas não mostram texto de homologação, migration, RLS/RPC ou ledger', () => {
  for (const file of EXPOSTAS) {
    // comentários de código podem citar RLS/RPC; o que importa é o texto que o usuário lê
    const source = read(file).replace(/\/\*[^]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[^]*?\*\/\}/g, '');
    for (const pattern of INTERNO) assert.doesNotMatch(source, pattern, `${file}: ${pattern}`);
  }
  for (const file of ['src/lib/serviceReceiptApi.js', 'src/lib/workOrderMemoryV2Api.js', 'src/lib/quotesV2Api.js']) {
    const messages = [...read(file).matchAll(/new Error\('([^']+)'\)/g)].map(m => m[1]);
    assert.ok(messages.length > 0, file);
    for (const message of messages) assert.doesNotMatch(message, /migration|branch|Staging|RC-1B|neste (ambiente|banco)/i, `${file}: ${message}`);
  }
  assert.match(read('src/lib/supabase.js'), /return "Este recurso ainda não está disponível na sua conta\.";/);
});

test('A2 · recurso que depende de objeto ausente mostra texto de produto e continua falhando fechado', () => {
  for (const file of ['src/screens/v2/ProductStockV2.jsx', 'src/screens/v2/ManualWarrantyV2.jsx', 'src/screens/v2/MaintenanceContractsV2.jsx', 'src/screens/v2/PurchasesV2.jsx']) {
    const source = read(file);
    assert.match(source, /Este recurso está sendo liberado e ainda não está ativo na sua conta\./, file);
    assert.match(source, /available ?=== ?false/, `${file}: o bloqueio por disponibilidade continua`);
  }
  const finance = read('src/screens/v2/FinanceV2.jsx');
  assert.match(finance, /!data\.custosProntos\?<div[^>]*>[^]*?Margem por OS indisponível/);
  assert.match(finance, /rentabilidade por OS aparece quando o controle privado de custos estiver ativo/i);
});

// Supabase falso: tabelas/RPCs configuráveis, storage com URL assinada, sem rede.
function createFakeSupabase() {
  const calls = [];
  const rpcResults = new Map();
  const tableResults = new Map();
  const query = (table) => {
    const ops = [];
    const settle = () => { const configured = tableResults.get(table); const value = typeof configured === 'function' ? configured(ops) : configured; return value ?? { data: [], error: null }; };
    const proxy = new Proxy({}, { get(_, prop) {
      if (prop === 'then') return (resolve, reject) => Promise.resolve(settle()).then(resolve, reject);
      return (...args) => { ops.push([prop, ...args]); calls.push({ kind: 'from', table, op: prop, args }); return proxy; };
    } });
    return proxy;
  };
  const client = {
    from: (table) => query(table),
    rpc: async (name, args) => { calls.push({ kind: 'rpc', name, args }); const configured = rpcResults.get(name); return (typeof configured === 'function' ? configured(args) : configured) ?? { data: null, error: null }; },
    storage: { from: (bucket) => ({ createSignedUrl: async (path) => ({ data: { signedUrl: `https://files.test/${bucket}/${path}` }, error: null }) }) },
  };
  return { client, calls, rpcResults, tableResults, reset() { calls.length = 0; rpcResults.clear(); tableResults.clear(); } };
}
const fake = createFakeSupabase();
globalThis.__ztFakeSupabase = fake.client;
if (globalThis.navigator) Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true });

const fakeSupabasePlugin = {
  name: 'zt-fake-supabase', enforce: 'pre',
  resolveId(source, importer) { if (importer && /[\\/]src[\\/]lib[\\/]/.test(importer) && /^\.\/supabase(\.js)?$/.test(source)) return '\0zt-fake-supabase'; return null; },
  load(id) {
    if (id !== '\0zt-fake-supabase') return null;
    return 'export const supabase = globalThis.__ztFakeSupabase; export const configurado = true; export const ambienteSupabase = "test"; export function mensagemErro(e){ return e?.message || String(e || ""); } export function sessaoExpirou(){ return false; }';
  },
};

let vite;
let apis;
before(async () => {
  vite = await createServer({ plugins: [fakeSupabasePlugin], server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom', logLevel: 'error' });
  apis = {
    receipts: await vite.ssrLoadModule('/src/lib/serviceReceiptApi.js'),
    history: await vite.ssrLoadModule('/src/lib/locationHistoryApi.js'),
    data: await vite.ssrLoadModule('/src/lib/dataApi.js'),
    receiptPdf: await vite.ssrLoadModule('/src/lib/serviceReceiptPdf.js'),
    reportPdf: await vite.ssrLoadModule('/src/lib/serviceReportPdf.js'),
    reciboPdf: await vite.ssrLoadModule('/src/lib/reciboPdf.js'),
  };
});
after(async () => { await vite?.close(); });

const missingRpc = (name) => ({ data: null, error: { code: 'PGRST202', message: `Could not find the function public.${name} in the schema cache` } });

test('A2 · frontend novo com banco 0099: RPCs e tabelas de 0100–0105 ausentes degradam sem erro técnico', async () => {
  fake.reset();
  fake.tableResults.set('service_receipts', { data: null, error: { code: '42P01', message: 'relation "public.service_receipts" does not exist' } });
  fake.rpcResults.set('zt_issue_service_receipt', missingRpc('zt_issue_service_receipt'));
  fake.rpcResults.set('zt_client_service_history', missingRpc('zt_client_service_history'));
  fake.rpcResults.set('zt_field_work_order_items', missingRpc('zt_field_work_order_items'));

  const receipts = await apis.receipts.carregarComprovantesOSDB('wo1');
  assert.deepEqual({ disponivel: receipts.disponivel, ativo: receipts.ativo, versoes: receipts.versoes }, { disponivel: false, ativo: null, versoes: [] });
  await assert.rejects(() => apis.receipts.emitirComprovanteServicoDB({ workOrderId: 'wo1', requestId: 'r1' }), (error) => {
    assert.equal(error.code, 'V2_MIGRATION_PENDING');
    assert.match(error.message, /ainda não está disponível na sua conta/);
    assert.doesNotMatch(error.message, /migration|RPC|schema|PGRST|42P01|zt_/i);
    return true;
  });
  assert.deepEqual(await apis.history.carregarHistoricoAtendimentosDB({ clientId: 'c1' }), { disponivel: false, itens: [] });

  const dados = await apis.data.carregarDadosEmpresa(companyId);
  assert.deepEqual(dados.ordens, [], 'a carga do app principal não depende das RPCs novas');
  const woSelect = fake.calls.find(c => c.kind === 'from' && c.table === 'work_orders' && c.op === 'select');
  assert.ok(woSelect, 'OS carregadas');
  assert.doesNotMatch(String(woSelect.args[0]), /started_at|started_by|completed_by|approved_|select \*|^\*/, 'sem colunas de 0101–0105 nem select *');
  assert.match(String(woSelect.args[0]), /client_location_id/, 'client_location_id existe desde a 0086');
});

// ------------------------------------------------------------------ A3 · caixa da logo
function pngBytes(width, height) {
  const crc = (buf) => { const out = Buffer.alloc(4); out.writeUInt32BE(zlib.crc32(buf) >>> 0); return out; };
  const chunk = (type, data) => { const t = Buffer.from(type, 'latin1'); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); return Buffer.concat([len, t, data, crc(Buffer.concat([t, data]))]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6; // RGBA, com canal alfa
  const row = Buffer.alloc(1 + width * 4);
  for (let x = 0; x < width; x++) { row[1 + x * 4] = 200; row[2 + x * 4] = 30; row[3 + x * 4] = 30; row[4 + x * 4] = x % 2 ? 255 : 0; }
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
const FORMAS = { horizontal: [400, 100], vertical: [100, 400], quadrada: [200, 200] };

function contentStreams(bytes) {
  const buf = Buffer.from(bytes); const raw = buf.toString('latin1'); const out = []; const marker = /(?<!end)stream\r?\n/g; let match;
  while ((match = marker.exec(raw))) {
    const start = match.index + match[0].length; const end = raw.indexOf('endstream', start); if (end < 0) break;
    let chunk = buf.subarray(start, end);
    if (chunk.length && chunk[chunk.length - 1] === 0x0a) chunk = chunk.subarray(0, chunk.length - 1);
    if (chunk.length && chunk[chunk.length - 1] === 0x0d) chunk = chunk.subarray(0, chunk.length - 1);
    try { out.push(zlib.inflateSync(chunk).toString('latin1')); } catch { /* imagem ou stream sem Flate */ }
    marker.lastIndex = end;
  }
  return out;
}
function imagePlacements(bytes) {
  const found = [];
  for (const content of contentStreams(bytes)) {
    const matrices = [];
    for (const line of content.split(/\r?\n/)) {
      const cm = line.match(/^(-?[\d.e+-]+) (-?[\d.e+-]+) (-?[\d.e+-]+) (-?[\d.e+-]+) (-?[\d.e+-]+) (-?[\d.e+-]+) cm$/);
      if (cm) { matrices.push(cm.slice(1).map(Number)); continue; }
      if (/^\/\S+ Do$/.test(line) && matrices.length >= 4) {
        // pdf-lib: translate, rotate, scale e uma matriz identidade logo antes do Do
        const [translate, , scale] = matrices.slice(-4);
        found.push({ x: translate[4], y: translate[5], width: scale[0], height: scale[3] });
      }
    }
  }
  return found;
}
const near = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

test('A3 · encaixe contain: horizontal, vertical e quadrada mantêm proporção, cabem na caixa e ficam centralizadas', () => {
  assert.equal(LOGO_BOX.width, 136); assert.equal(LOGO_BOX.height, 51);
  assert.ok(Math.abs(LOGO_BOX.width / 72 * 25.4 - 48) < 0.2 && Math.abs(LOGO_BOX.height / 72 * 25.4 - 18) < 0.2, '≈ 48 × 18 mm');
  for (const [nome, [w, h]] of Object.entries(FORMAS)) {
    const fit = encaixarNaCaixa(w, h);
    assert.ok(fit.width <= 136 + 1e-9 && fit.height <= 51 + 1e-9, `${nome}: cabe na caixa`);
    near(fit.width / fit.height, w / h, 1e-9);
    near(fit.offsetX * 2 + fit.width, 136); near(fit.offsetY * 2 + fit.height, 51);
    assert.ok(Math.abs(fit.width - 136) < 1e-9 || Math.abs(fit.height - 51) < 1e-9, `${nome}: usa a caixa inteira em um dos eixos (contain)`);
  }
  assert.deepEqual(encaixarNaCaixa(400, 100), { width: 136, height: 34, offsetX: 0, offsetY: 8.5 });
  assert.equal(encaixarNaCaixa(0, 10), null); assert.equal(encaixarNaCaixa(NaN, 10), null);
  assert.equal(LOGO_BOX.textoX, LOGO_BOX.width + LOGO_BOX.gap, 'o texto começa depois da caixa inteira');
});

test('A3 · nome da empresa longo é reduzido e depois cortado, nunca invade o título do documento', () => {
  const font = { widthOfTextAtSize: (text, size) => text.length * size * 0.6 };
  const curto = ajustarTextoNaLargura(font, 'ZiisTec', 14, 200);
  assert.deepEqual(curto, { texto: 'ZiisTec', tamanho: 14 });
  const longo = ajustarTextoNaLargura(font, 'Condomínio Aurora Serviços Técnicos e Manutenção Ltda', 14, 190);
  assert.ok(longo.tamanho >= 9 && longo.tamanho < 14);
  assert.ok(font.widthOfTextAtSize(longo.texto, longo.tamanho) <= 190);
  assert.match(longo.texto, /\.\.\.$/);
});

test('A3 · recibo: logo horizontal, vertical e quadrada ficam na caixa de 136×51 pt, proporcionais e centralizadas', async () => {
  for (const [nome, [w, h]] of Object.entries(FORMAS)) {
    const bytes = await apis.reciboPdf.montarReciboPDF({ empresa: { nome: 'Empresa Teste' }, cliente: { nome: 'Cliente' }, titulo: 'RECIBO', valor: 100, itens: [], logoBytes: pngBytes(w, h), logoTipo: 'image/png' });
    const [image] = imagePlacements(bytes);
    assert.ok(image, `${nome}: imagem desenhada`);
    assert.ok(image.width <= 136.01 && image.height <= 51.01, `${nome}: dentro da caixa`);
    near(image.width / image.height, w / h, 1e-4);
    near(image.x + image.width / 2, 48 + 68); near(image.y + image.height / 2, (841.89 - 48 - 51) + 25.5);
  }
  const semLogo = await apis.reciboPdf.montarReciboPDF({ empresa: { nome: 'Empresa' }, cliente: { nome: 'Cliente' }, titulo: 'RECIBO', valor: 1, itens: [] });
  assert.deepEqual(imagePlacements(semLogo), []);
  const invalida = await apis.reciboPdf.montarReciboPDF({ empresa: { nome: 'Empresa' }, cliente: { nome: 'Cliente' }, titulo: 'RECIBO', valor: 1, itens: [], logoBytes: new Uint8Array([1, 2, 3]), logoTipo: 'image/png' });
  assert.deepEqual(imagePlacements(invalida), [], 'logo inválida não impede o documento');
});

const receiptFixture = (logoPath) => ({
  id: 'r1', number: 'CS-0001', version: 1, is_active: true, issued_at: '2026-10-09T13:00:00Z',
  snapshot: { receipt_schema_version: 1,
    document: { kind: 'service_receipt', title: 'Comprovante de Serviço', notice: 'Documento não fiscal', number: 'CS-0001', version: 1, issued_at: '2026-10-09T13:00:00Z', issued_by: { id: 'u1', name: 'Ana' } },
    company: { name: 'Empresa Teste', tax_id: '12.345.678/0001-90', logo_path: logoPath }, client: { name: 'Cliente' }, location: {},
    work_order: { id: 'wo1', number: 'OS-0042', completed_at: '2026-10-08T18:00:00Z' }, technician: { name: 'Carlos' }, items: [],
    financial: { quote_based: true, total: 0, status: 'receivable', status_label: 'A receber' } },
});
const reportFixture = (logoPath) => ({ snapshot: { schema_version: 1, company: { name: 'Empresa Teste', logo_path: logoPath }, client: { name: 'Cliente' }, location: {}, work_order: { id: 'wo1', number: 'OS-0042' }, technician: { name: 'Carlos' }, payment: { status: 'receivable' } } });

async function withLogoDownload(shape, run) {
  const [w, h] = FORMAS[shape]; const png = pngBytes(w, h);
  const previous = globalThis.fetch; const requestedTypes = [];
  globalThis.fetch = async () => ({ ok: true, blob: async () => new Blob([png], { type: 'image/png' }) });
  try { return await run({ requestedTypes, png, w, h }); } finally { globalThis.fetch = previous; }
}

test('A3 · relatório e comprovante usam a mesma caixa de logo (horizontal, vertical e quadrada)', async () => {
  for (const shape of Object.keys(FORMAS)) {
    await withLogoDownload(shape, async ({ w, h }) => {
      for (const make of [() => apis.reportPdf.montarRelatorioAtendimentoPDF(reportFixture('c/branding/logo-clean-1.png')), () => apis.receiptPdf.montarComprovanteServicoPDF(receiptFixture('c/branding/logo-clean-1.png'))]) {
        const [image] = imagePlacements(await make());
        assert.ok(image, `${shape}: imagem desenhada`);
        assert.ok(image.width <= 136.01 && image.height <= 51.01, `${shape}: dentro da caixa`);
        near(image.width / image.height, w / h, 1e-4);
        near(image.x + image.width / 2, 42 + 68); near(image.y + image.height / 2, (841.89 - 42 - 41) + 25.5);
      }
    });
  }
});

test('A3 · logo transparente continua PNG no relatório e no comprovante (JPEG daria fundo preto no Chromium)', async () => {
  const requested = [];
  const canvas = { width: 0, height: 0, getContext: () => ({ drawImage() {} }), toBlob(cb, type) { requested.push(type); cb(new Blob([pngBytes(400, 100)], { type })); } };
  const globals = { document: { createElement: () => canvas }, createImageBitmap: async () => ({ width: 400, height: 100, close() {} }) };
  const previousDocument = globalThis.document; const previousBitmap = globalThis.createImageBitmap;
  globalThis.document = globals.document; globalThis.createImageBitmap = globals.createImageBitmap;
  try {
    await withLogoDownload('horizontal', async () => {
      const report = await apis.reportPdf.montarRelatorioAtendimentoPDF(reportFixture('c/branding/logo-clean-1.png'));
      const receipt = await apis.receiptPdf.montarComprovanteServicoPDF(receiptFixture('c/branding/logo-clean-1.png'));
      for (const bytes of [report, receipt]) assert.match(Buffer.from(bytes).toString('latin1'), /\/SMask/, 'o canal alfa chegou ao PDF');
    });
  } finally { globalThis.document = previousDocument; globalThis.createImageBitmap = previousBitmap; }
  assert.equal(requested.length, 2);
  assert.deepEqual([...new Set(requested)], ['image/png'], 'logo nunca vira JPEG');

  const source = read('src/lib/serviceReportPdf.js');
  assert.equal((source.match(/loadStorageImage\('zt-branding',company\.logo_path,700,\{logo:true\}\)/g) || []).length, 1);
  assert.match(read('src/lib/serviceReceiptPdf.js'), /loadStorageImage\('zt-branding',company\.logo_path,700,\{logo:true\}\)/);
  assert.match(source, /const type=logo\?'image\/png':'image\/jpeg';/, 'evidências continuam em JPEG');
  assert.match(source, /loadStorageImage\(evidence\.bucket,evidence\.path,1200\)/, 'pipeline das evidências não mudou');
});

test('A3 · orçamento (servidor) e módulos de logo existentes seguem o mesmo contrato', () => {
  const quote = read('api/quote-pdf.js');
  assert.match(quote, /import \{ LOGO_BOX, desenharLogoNaCaixa \} from '\.\.\/src\/lib\/pdfLogoBox\.js';/);
  assert.match(quote, /const companyTextX = logo \? margin \+ LOGO_BOX\.textoX : margin;/);
  assert.match(quote, /desenharLogoNaCaixa\(page, logo, \{ x: margin, yBase: A4\[1\] - headerH \/ 2 - LOGO_BOX\.height \/ 2 \}\)/);
  assert.doesNotMatch(quote, /drawLogoFit\(page, logo, margin, A4\[1\] - 100, 128, 68, 1\)/);
  assert.match(read('src/lib/reciboPdf.js'), /desenharLogoNaCaixa\(pagina, img, \{ x: margem, yBase \}\)/);
  const logoImage = read('src/lib/logoImage.js');
  assert.match(logoImage, /export async function prepararLogoTransparente/);
  assert.match(logoImage, /image\/png/);
  assert.match(read('src/lib/storageExtras.js'), /prepararLogoTransparente/);
});

// ------------------------------------------------------------------ A4 · Início
const os = (id, extra = {}) => ({ id, numero: `OS-${id}`, clienteId: 'c1', status: 'concluida', concluidaEm: '2026-10-20', itens: [], ...extra });

test('A4 · concluídos recentemente: últimos 30 dias, mais recentes primeiro, no máximo 5, só OS concluídas', () => {
  const hoje = '2026-10-26';
  const lista = [
    os('a', { concluidaEm: '2026-10-26' }), os('b', { concluidaEm: '2026-10-25' }), os('c', { concluidaEm: '2026-09-26' }), os('limite-fora', { concluidaEm: '2026-09-25' }),
    os('futura', { concluidaEm: '2026-10-27' }), os('andamento', { status: 'andamento', concluidaEm: '2026-10-25' }), os('sem-data', { concluidaEm: '' }),
    os('d', { concluidaEm: '2026-10-10' }), os('e', { concluidaEm: '2026-10-11' }), os('f', { concluidaEm: '2026-10-12' }), os('g', { concluidaEm: '2026-10-13' }),
  ];
  const recentes = concluidasRecentemente(lista, hoje);
  assert.deepEqual(recentes.map(x => x.id), ['a', 'b', 'g', 'f', 'e'], 'ordem e limite de 5');
  assert.deepEqual(concluidasRecentemente(lista, hoje, { limite: 20 }).map(x => x.id), ['a', 'b', 'g', 'f', 'e', 'd', 'c'], 'inclui o 30º dia e exclui o 31º, o futuro e o que não está concluído');
  assert.deepEqual(concluidasRecentemente(null, hoje), []);
  assert.deepEqual(concluidasRecentemente(lista, 'ontem'), []);
});

test('A4 · o bloco do Início não mostra valores financeiros e vale para proprietário e técnico', () => {
  const legacy = read('src/legacy/ZiisTecApp.jsx');
  const start = legacy.indexOf('Serviços concluídos recentemente\n');
  assert.ok(start > 0);
  const section = legacy.slice(legacy.lastIndexOf('<section>', start), legacy.indexOf('</section>', start));
  assert.match(section, /recentes\.map\(\(os\) =>/);
  assert.match(section, /abrirOS\(os\.id\)/);
  assert.doesNotMatch(section, /brl\(|\.valor|total|preco|preço|custo|margem|R\$/i);
  assert.doesNotMatch(section, /papel === "proprietario"|verFinanceiro/, 'sem filtro de papel: a lista já segue o RLS de cada papel');
  assert.match(legacy, /const recentes = concluidasRecentemente\(ordens, HOJE\);/);
});

test('A4 · estoque baixo usa a regra única da tela de estoque e só alerta o proprietário', () => {
  const original = (p) => Boolean(p.controlaEstoque && p.estoque <= p.estoqueMinimo); // regra anterior da ProductStockV2
  const matriz = [];
  for (const controlaEstoque of [true, false]) for (const estoque of [-1, 0, 1, 2, 5]) for (const estoqueMinimo of [0, 1, 2, 5]) matriz.push({ id: `${controlaEstoque}-${estoque}-${estoqueMinimo}`, nome: 'P', controlaEstoque, estoque, estoqueMinimo });
  for (const p of matriz) assert.equal(estoqueBaixo(p), original(p), p.id);
  assert.deepEqual(produtosComEstoqueBaixo(matriz).map(p => p.id).sort(), matriz.filter(original).map(p => p.id).sort());
  assert.deepEqual(produtosComEstoqueBaixo([{ id: 'x', nome: 'B', controlaEstoque: true, estoque: 3, estoqueMinimo: 3 }, { id: 'y', nome: 'A', controlaEstoque: true, estoque: 0, estoqueMinimo: 3 }]).map(p => p.id), ['y', 'x'], 'menor saldo primeiro');
  assert.deepEqual(produtosComEstoqueBaixo(undefined), []);

  const stock = read('src/screens/v2/ProductStockV2.jsx');
  assert.match(stock, /import \{ estoqueBaixo \} from '\.\.\/\.\.\/lib\/estoque';/);
  assert.doesNotMatch(stock, /p\.estoque\s*(<=|>)\s*p\.estoqueMinimo/, 'a comparação deixou de ser repetida na tela');
  assert.equal((stock.match(/estoqueBaixo/g) || []).length, 4);

  const legacy = read('src/legacy/ZiisTecApp.jsx');
  assert.match(legacy, /const semEstoque = papel === "proprietario" \? produtosComEstoqueBaixo\(produtos\) : \[\];/);
  const blocoOwner = legacy.slice(legacy.indexOf('  if (papel === "proprietario") {\n    const revisoesPendentes'), legacy.indexOf('  if (verFinanceiro) {\n  const vencidas'));
  assert.match(blocoOwner, /id:"estoque-baixo"/, 'o alerta nasce dentro do bloco do proprietário');
  assert.match(blocoOwner, /abrirV2 \? abrirV2\("produtos"\) : irPara\("catalogo"\)/);
  assert.equal((legacy.match(/id:"estoque-baixo"/g) || []).length, 1);
});
