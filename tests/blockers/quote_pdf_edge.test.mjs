import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import * as pdfLib from 'pdf-lib';
import { FunctionsClient } from '@supabase/functions-js';

/*
  PDF do orçamento na Hostinger: Edge Function `quote-pdf`.

  Prova que:
  - a Edge Function gera o MESMO PDF da rota da Vercel (bytes idênticos, relógio congelado),
    com as mesmas consultas, o mesmo desenho e os mesmos helpers (cópias idênticas);
  - a autorização é a de hoje: sessão obrigatória, só proprietário, empresa confirmada no
    banco, orçamento de outra empresa nunca sai, cota no banco, erro sanitizado;
  - CORS só para as origens exatas de Production; OPTIONS seguro; sem service role;
  - o cliente usa /api/quote-pdf na Vercel, a Edge Function só em ziistec.com/www,
    nada em host desconhecido, e nenhum erro vira download de arquivo falso.
*/

const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const FN = 'supabase/functions/quote-pdf';

// A rota da Vercel resolve o Supabase na importação (staging em development); a rede é simulada abaixo.
process.env.VERCEL_ENV = 'development';
process.env.SUPABASE_URL = 'https://xadoktssibuuebzzjrhv.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_AIJvagsmB3vknIW9ykFERQ_T7aCkl5e';
const { default: handlerVercel } = await import('../../api/quote-pdf.js');
const { criarHandlerPdfOrcamento, ORIGENS_PERMITIDAS } = await import(`../../${FN}/handler.js`);
const { PROD_SUPABASE_HOSTS, STAGING_SUPABASE_HOSTS } = await import('../../src/lib/supabaseConfig.js');

// ─────────────────────────── banco falso multiempresa (RLS simulada)

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const U = { donoA: 'a0000000-0000-4000-8000-0000000000a1', tecA: 'a0000000-0000-4000-8000-0000000000a2', donoB: 'b0000000-0000-4000-8000-0000000000b1' };
const TOKENS = { 'tok-donoA': U.donoA, 'tok-tecA': U.tecA, 'tok-donoB': U.donoB };
const MEMBROS = [[U.donoA, A, 'owner'], [U.tecA, A, 'technician'], [U.donoB, B, 'owner']];
const QA = 'a1111111-1111-4111-8111-111111111111';
const QB = 'b2222222-2222-4222-8222-222222222222';
const CLA = 'a3333333-3333-4333-8333-333333333333';
const CLB = 'b3333333-3333-4333-8333-333333333333';
const PRODUTO = 'a4444444-4444-4444-8444-444444444444';
const PRODUTO_WEBP = 'a5555555-5555-4555-8555-555555555555';
const SERVICO = 'a6666666-6666-4666-8666-666666666666';

function png(largura, altura, cor) {
  const crc = (buf) => zlib.crc32(buf) >>> 0;
  const bloco = (tipo, dados) => {
    const t = Buffer.from(tipo, 'ascii');
    const tam = Buffer.alloc(4); tam.writeUInt32BE(dados.length);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, dados])));
    return Buffer.concat([tam, t, dados, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0); ihdr.writeUInt32BE(altura, 4); ihdr[8] = 8; ihdr[9] = 2;
  const linhas = Buffer.alloc((largura * 3 + 1) * altura);
  for (let y = 0; y < altura; y++) for (let x = 0; x < largura; x++) linhas.set(cor, y * (largura * 3 + 1) + 1 + x * 3);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), bloco('IHDR', ihdr), bloco('IDAT', zlib.deflateSync(linhas)), bloco('IEND', Buffer.alloc(0))]);
}
const LOGO = png(40, 16, [9, 120, 110]);
const FOTO = png(8, 8, [200, 60, 20]);

const empresas = {
  [A]: { id: A, name: 'Js Connect Climatização', trade_name: null, tax_id: '12.345.678/0001-90', phone: '11 4000-0000', whatsapp: '11 90000-0000', email: 'contato@exemplo.invalid', address: 'Rua A, 1', logo_path: null, owner_name: 'Dono da Empresa A' },
  [B]: { id: B, name: 'Empresa B', trade_name: 'B Serviços', tax_id: null, phone: null, whatsapp: null, email: null, address: null, logo_path: null, owner_name: 'Dono B' },
};
const clientes = {
  [CLA]: { id: CLA, company_id: A, name: 'Condomínio Aurora', trade_name: null, tax_id: '98.765.432/0001-10', contact_name: 'Síndica Ana', phone: '11 3000-0000', whatsapp: '11 98888-7777', address: 'Av. Brasil, 1000 · Bloco C' },
  [CLB]: { id: CLB, company_id: B, name: 'Cliente da B', trade_name: null, tax_id: null, contact_name: null, phone: null, whatsapp: null, address: null },
};
const base = (id, company, client, extra = {}) => ({
  id, company_id: company, number: company === A ? 'ORC-0042' : 'ORC-0900', client_id: client, status: 'sent',
  issue_date: '2026-11-20', valid_until: '2026-12-05', payment_terms: null, notes: null, customer_message: null,
  execution_forecast_date: null, address: null, service_place: null, show_product_images: false,
  discount: 0, surcharge: 0, deleted_at: null, ...extra,
});
const banco = { quotes: {}, items: {}, produtos: {}, servicos: {}, objetos: {} };
function cenario({ quote, itens, logo = false, produtos = {}, servicos = {} }) {
  empresas[A].logo_path = logo ? `${A}/logo.png` : null;
  banco.quotes = { [QA]: quote, [QB]: base(QB, B, CLB) };
  banco.items = { [QA]: itens, [QB]: [{ id: 'ib1', kind: 'free', service_id: null, product_id: null, name: 'Item da B', unit: 'un', quantity: 1, unit_price: 999, unit_cost: 500, notes: null, position: 1 }] };
  banco.produtos = produtos;
  banco.servicos = servicos;
  banco.objetos = { [`zt-branding/${A}/logo.png`]: ['image/png', LOGO], [`zt-product-images/${A}/p.png`]: ['image/png', FOTO], [`zt-product-images/${A}/p.webp`]: ['image/webp', Buffer.from('RIFF0000WEBPVP8 ')] };
}

const membro = (u, c) => MEMBROS.some(([mu, mc]) => mu === u && mc === c);
const dono = (u, c) => MEMBROS.some(([mu, mc, r]) => mu === u && mc === c && r === 'owner');
let pedidos = [];
let cota = { status: 200, corpo: null };

async function fetchFalso(entrada, init = {}) {
  const url = new URL(String(entrada));
  const headers = new Headers(init.headers || {});
  const auth = headers.get('authorization') || '';
  const usuario = TOKENS[auth.replace(/^Bearer /, '')];
  const metodo = (init.method || 'GET').toUpperCase();
  pedidos.push({ metodo, caminho: url.pathname, busca: url.search, auth, apikey: headers.get('apikey') });
  const json = (dados, status = 200) => new Response(JSON.stringify(dados), { status, headers: { 'content-type': 'application/json' } });
  const p = url.searchParams;
  const eq = (k) => (p.get(k) || '').replace(/^eq\./, '');
  if (url.pathname === '/auth/v1/user') return usuario ? json({ id: usuario }) : json({ msg: 'invalid JWT: token is malformed' }, 401);
  if (!usuario) return json({ code: 'PGRST301', message: 'JWT expired' }, 401);
  if (url.pathname === '/rest/v1/rpc/zt_is_owner') return json(dono(usuario, JSON.parse(init.body).target));
  if (url.pathname === '/rest/v1/rpc/zt_consume_quote_pdf_quota') {
    const empresa = JSON.parse(init.body).p_company;
    if (!dono(usuario, empresa)) return json({ code: '42501', message: 'Somente o proprietário gera PDF de orçamento' }, 403);
    return cota.corpo ? json(cota.corpo, cota.status) : json(empresa);
  }
  if (url.pathname === '/rest/v1/companies') return json(membro(usuario, eq('id')) ? [empresas[eq('id')]] : []);
  if (url.pathname === '/rest/v1/quotes') {
    const q = banco.quotes[eq('id')];
    return json(q && q.company_id === eq('company_id') && dono(usuario, q.company_id) && !q.deleted_at ? [q] : []);
  }
  if (url.pathname === '/rest/v1/quote_items') {
    const q = banco.quotes[eq('quote_id')];
    if (cota.falharItens) return json({ code: 'XX000', message: 'relation "private.cost_rows" leaked detail' }, 500);
    const select = (p.get('select') || '').split(',');
    return json(q && q.company_id === eq('company_id') && dono(usuario, q.company_id)
      ? banco.items[q.id].map((item) => Object.fromEntries(select.map((k) => [k, item[k]]))) : []);
  }
  if (url.pathname === '/rest/v1/clients') {
    const c = clientes[eq('id')];
    return json(c && c.company_id === eq('company_id') && membro(usuario, c.company_id) ? [c] : []);
  }
  if (url.pathname === '/rest/v1/products') {
    const ids = (p.get('id') || '').replace(/^in\.\(|\)$/g, '').split(',');
    return json(ids.map((id) => banco.produtos[id]).filter(Boolean));
  }
  if (url.pathname === '/rest/v1/services') {
    const ids = (p.get('id') || '').replace(/^in\.\(|\)$/g, '').split(',');
    return json(ids.map((id) => banco.servicos[id]).filter(Boolean));
  }
  const objeto = url.pathname.match(/^\/storage\/v1\/object\/authenticated\/(.+)$/);
  if (objeto) {
    const achado = banco.objetos[decodeURIComponent(objeto[1])];
    return achado ? new Response(achado[1], { status: 200, headers: { 'content-type': achado[0] } }) : json({ error: 'not_found' }, 400);
  }
  throw new Error(`fetch inesperado: ${metodo} ${url.pathname}`);
}

const logs = [];
const edge = criarHandlerPdfOrcamento({
  pdfLib, supabaseUrl: process.env.SUPABASE_URL, apiKey: process.env.SUPABASE_PUBLISHABLE_KEY,
  fetchImpl: fetchFalso, registrarErro: (m) => logs.push(m),
});

const fetchOriginal = globalThis.fetch;
const DataReal = Date;
after(() => { globalThis.fetch = fetchOriginal; globalThis.Date = DataReal; });

// Relógio congelado: o pdf-lib grava data de criação/modificação; com o mesmo instante, os bytes batem.
const congelado = async (fn) => {
  const instante = DataReal.UTC(2026, 10, 25, 12, 0, 0);
  globalThis.Date = class extends DataReal {
    constructor(...a) { if (a.length) super(...a); else super(instante); }
    static now() { return instante; }
  };
  try { return await fn(); } finally { globalThis.Date = DataReal; }
};

async function viaVercel({ token = 'tok-donoA', quoteId = QA, companyId = A } = {}) {
  globalThis.fetch = fetchFalso;
  const res = {
    statusCode: 0, headers: {}, body: null,
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    send(body) { this.body = body; return this; },
  };
  try {
    await handlerVercel({ method: 'POST', headers: { 'content-type': 'application/json', authorization: token ? `Bearer ${token}` : '' }, body: { quoteId, companyId } }, res);
  } finally { globalThis.fetch = fetchOriginal; }
  return { status: res.statusCode, tipo: res.headers['Content-Type'], disposicao: res.headers['Content-Disposition'], corpo: res.body };
}

const pedido = ({ token = 'tok-donoA', quoteId = QA, companyId = A, origin = 'https://ziistec.com', metodo = 'POST', corpo, tipo = 'application/json', extra = {} } = {}) => new Request('https://projeto.supabase.co/functions/v1/quote-pdf', {
  method: metodo,
  headers: { ...(origin ? { origin } : {}), ...(tipo ? { 'content-type': tipo } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra },
  body: metodo === 'POST' || metodo === 'PUT' ? (corpo ?? JSON.stringify({ quoteId, companyId })) : undefined,
});
async function viaEdge(opcoes) {
  const r = await edge(pedido(opcoes));
  const tipo = r.headers.get('content-type') || '';
  const bytes = Buffer.from(await r.arrayBuffer());
  return { status: r.status, tipo, disposicao: r.headers.get('content-disposition'), acao: r.headers.get('access-control-allow-origin'), headers: r.headers, bytes, corpo: tipo.includes('json') ? JSON.parse(bytes.toString('utf8')) : null };
}

const textosDesenhados = [];
const drawText = pdfLib.PDFPage.prototype.drawText;
pdfLib.PDFPage.prototype.drawText = function (t, o) { textosDesenhados.push(t); return drawText.call(this, t, o); };
after(() => { pdfLib.PDFPage.prototype.drawText = drawText; });

// ─────────────────────────── 1. mesma regra, mesmo código

test('Edge Function usa cópias idênticas dos helpers da Vercel e o mesmo desenho', () => {
  assert.equal(read(`${FN}/quotePdfLayout.js`), read('api/quotePdfLayout.js'));
  assert.equal(read(`${FN}/pdfLogoBox.js`), read('src/lib/pdfLogoBox.js'));
  assert.equal(read(`${FN}/apiErrors.js`), read('api/_apiErrors.js'));
  const linhas = (txt) => txt.split('\n').map((l) => l.trim()).filter(Boolean);
  const trecho = (txt, de, ate) => { const l = linhas(txt); const i = l.findIndex((x) => x.includes(de)); const j = l.findIndex((x, k) => k > i && x.includes(ate)); assert.ok(i >= 0 && j > i, `${de}…${ate}`); return l.slice(i, j); };
  const vercel = read('api/quote-pdf.js');
  const fn = read(`${FN}/handler.js`);
  // Consultas, autorização, cota e desenho: do Auth até antes de salvar, linha a linha.
  // A sessão é conferida antes (única diferença: sessão inválida → 401); dali em diante, igual.
  assert.match(fn, /sbFetch\('\/auth\/v1\/user', auth\)/);
  const t1 = trecho(vercel, "const ownerResp = await sbFetch('/rest/v1/rpc/zt_is_owner', auth, {", 'const bytes = await pdf.save();');
  const t2 = trecho(fn, "const ownerResp = await sbFetch('/rest/v1/rpc/zt_is_owner', auth, {", 'const bytes = await pdf.save();');
  const normal = (l) => l.replace(/return res\.status\((\w+)\)\.json\((.*)\);$/, 'return json($1, $2, origin);').replace('await fetch(`${SUPABASE_URL}', 'await fetchImpl(`${SUPABASE_URL}');
  assert.deepEqual(t2, t1.map(normal));
  assert.ok(t1.length > 250, 'o trecho comparado cobre a rota inteira');
  for (const [de, ate] of [['const clean =', 'async function carregarImagemProduto'], ['async function carregarImagemProduto', 'export default async function handler']]) {
    const v = trecho(vercel, de, ate);
    const f = trecho(fn, de, de === 'const clean =' ? 'const limparLog' : 'return async function handler');
    assert.deepEqual(f.slice(0, v.length), v, de);
  }
  assert.match(read(`${FN}/index.ts`), /from "npm:pdf-lib@1\.17\.1"/);
  assert.equal(JSON.parse(read('package-lock.json')).packages['node_modules/pdf-lib'].version, '1.17.1', 'mesma versão do pdf-lib nos dois lados');
});

test('PDF da Edge Function é idêntico byte a byte ao da Vercel, com o conteúdo certo', async () => {
  const cenarios = {
    simples: { quote: base(QA, A, CLA), itens: [{ id: 'i1', kind: 'free', service_id: null, product_id: null, name: 'Limpeza de split 12.000 BTU', unit: 'un', quantity: 3, unit_price: 100, unit_cost: 40, notes: null, position: 1 }] },
    descontoTaxaTextos: {
      quote: base(QA, A, CLA, { discount: 50, surcharge: 20, payment_terms: 'Pix na aprovação ou 2x no cartão.', notes: 'Material incluso conforme proposta.', customer_message: 'Proposta para manutenção preventiva. '.repeat(30), execution_forecast_date: '2026-12-01', service_place: 'Casa de máquinas', address: 'Av. Brasil, 1000' }),
      itens: [
        { id: 'i1', kind: 'service', service_id: SERVICO, product_id: null, name: 'Instalação', unit: 'serviço', quantity: 1, unit_price: 450.5, unit_cost: 100, notes: 'Inclui suporte', position: 1 },
        { id: 'i2', kind: 'free', service_id: null, product_id: null, name: 'Tubulação de cobre', unit: 'm', quantity: 2.5, unit_price: 89.9, unit_cost: 30, notes: null, position: 2 },
      ],
      servicos: { [SERVICO]: { id: SERVICO, warranty_days: 90 } },
    },
    variasPaginas: { quote: base(QA, A, CLA, { notes: 'Observação final.' }), itens: Array.from({ length: 18 }, (_, i) => ({ id: `i${i}`, kind: 'free', service_id: null, product_id: null, name: `Item ${i + 1} com descrição um pouco mais longa para quebrar linha no PDF`, unit: 'un', quantity: i + 1, unit_price: 10 + i, unit_cost: 1, notes: i % 3 ? null : 'Nota do item', position: i })) },
    logoImagensGarantia: {
      quote: base(QA, A, CLA, { show_product_images: true }), logo: true,
      itens: [
        { id: 'i1', kind: 'product', service_id: null, product_id: PRODUTO, name: 'Ar-condicionado 9.000 BTU', unit: 'un', quantity: 1, unit_price: 2199, unit_cost: 1500, notes: null, position: 1 },
        { id: 'i2', kind: 'product', service_id: null, product_id: PRODUTO_WEBP, name: 'Controle remoto', unit: 'un', quantity: 2, unit_price: 59.9, unit_cost: 20, notes: null, position: 2 },
      ],
      produtos: { [PRODUTO]: { id: PRODUTO, image_path: `${A}/p.png`, warranty_months: 12 }, [PRODUTO_WEBP]: { id: PRODUTO_WEBP, image_path: `${A}/p.webp`, warranty_months: 0 } },
    },
  };
  for (const [nome, c] of Object.entries(cenarios)) {
    cenario(c);
    textosDesenhados.length = 0;
    const v = await congelado(() => viaVercel());
    const textosVercel = [...textosDesenhados];
    textosDesenhados.length = 0;
    const e = await congelado(() => viaEdge());
    assert.equal(v.status, 200, `${nome}: Vercel ${JSON.stringify(v.corpo)}`);
    assert.equal(e.status, 200, `${nome}: Edge ${JSON.stringify(e.corpo)}`);
    assert.equal(e.tipo, 'application/pdf');
    assert.equal(e.disposicao, v.disposicao, `${nome}: mesmo nome de arquivo`);
    assert.ok(e.bytes.length > 1000);
    assert.equal(e.bytes.subarray(0, 5).toString('latin1'), '%PDF-');
    assert.equal(Buffer.compare(e.bytes, Buffer.from(v.corpo)), 0, `${nome}: bytes idênticos`);
    assert.deepEqual(textosDesenhados, textosVercel, `${nome}: mesmo texto, na mesma ordem`);
    const doc = await pdfLib.PDFDocument.load(e.bytes);
    assert.ok(doc.getPageCount() >= 1);
    if (nome === 'variasPaginas') assert.ok(doc.getPageCount() >= 2, 'quebra de página preservada');
    const t = textosDesenhados.join('\n');
    assert.match(t, /ORC-0042/);
    assert.match(t, /Condomínio Aurora/);
    assert.match(t, /Js Connect Climatização/);
    assert.equal(/Empresa B|ORC-0900|Cliente da B/.test(t), false, `${nome}: nada de outra empresa`);
  }
  const t = (await (async () => { cenario(cenarios.descontoTaxaTextos); textosDesenhados.length = 0; await congelado(() => viaEdge()); return textosDesenhados.join('\n'); })());
  // 450,50 + 2,5 × 89,90 = 675,25; − 50 + 20 = 645,25
  for (const esperado of ['R$ 675,25', '- R$ 50,00', '+ R$ 20,00', 'R$ 645,25', 'Desconto', 'Acréscimo', 'TOTAL', 'GARANTIA']) assert.ok(t.includes(esperado), esperado);
  assert.equal(t.includes('R$ 100,00') && t.includes('R$ 30,00'), false, 'custo interno nunca aparece');
  // Nome do arquivo igual ao da Vercel (número + cliente, sem acento).
  cenario(cenarios.simples);
  assert.equal((await viaEdge()).disposicao, 'attachment; filename="ORC-0042 - Condominio-Aurora.pdf"');
});

test('A geração só lê: nenhuma escrita além do evento de cota, sempre com o token do usuário', async () => {
  cenario({ quote: base(QA, A, CLA, { show_product_images: true }), logo: true, itens: [{ id: 'i1', kind: 'product', service_id: null, product_id: PRODUTO, name: 'Produto', unit: 'un', quantity: 1, unit_price: 10, unit_cost: 5, notes: null, position: 1 }], produtos: { [PRODUTO]: { id: PRODUTO, image_path: `${A}/p.png`, warranty_months: 0 } } });
  pedidos = [];
  const r = await viaEdge();
  assert.equal(r.status, 200);
  const escritas = pedidos.filter((p) => p.metodo !== 'GET');
  assert.deepEqual(escritas.map((p) => p.caminho), ['/rest/v1/rpc/zt_is_owner', '/rest/v1/rpc/zt_consume_quote_pdf_quota'], 'só as duas RPCs; nenhum POST/PATCH/DELETE em tabela');
  for (const p of pedidos) {
    assert.equal(p.auth, 'Bearer tok-donoA', `${p.caminho} com o token do próprio usuário`);
    assert.equal(p.apikey, process.env.SUPABASE_PUBLISHABLE_KEY, 'apikey pública');
  }
  const itens = pedidos.find((p) => p.caminho === '/rest/v1/quote_items');
  assert.equal(new URLSearchParams(itens.busca).get('select').split(',').includes('unit_cost'), false, 'custo nunca é lido');
  const fonte = ['index.ts', 'handler.js'].map((f) => read(`${FN}/${f}`)).join('\n');
  assert.equal(/SERVICE_ROLE|service_role|SUPABASE_SECRET|sb_secret_|SUPABASE_DB_URL/.test(fonte), false, 'sem service role nem segredo');
  assert.match(read('supabase/config.toml'), /\[functions\.quote-pdf\]\s*\nverify_jwt = true/);
});

// ─────────────────────────── 2. autorização

test('Autorização igual à da Vercel: dono A gera A; nunca B; técnico não gera; sem sessão 401', async () => {
  cenario({ quote: base(QA, A, CLA), itens: [{ id: 'i1', kind: 'free', service_id: null, product_id: null, name: 'Item', unit: 'un', quantity: 1, unit_price: 10, unit_cost: 1, notes: null, position: 1 }] });
  const casos = [
    ['dono A, orçamento A', { token: 'tok-donoA', quoteId: QA, companyId: A }, 200, null],
    ['dono A pede orçamento B dizendo empresa A', { token: 'tok-donoA', quoteId: QB, companyId: A }, 404, 'Orçamento não encontrado.'],
    ['dono A pede orçamento B dizendo empresa B', { token: 'tok-donoA', quoteId: QB, companyId: B }, 403, 'Somente o proprietário pode gerar este PDF.'],
    ['técnico da A', { token: 'tok-tecA', quoteId: QA, companyId: A }, 403, 'Somente o proprietário pode gerar este PDF.'],
    ['dono B pede orçamento A', { token: 'tok-donoB', quoteId: QA, companyId: A }, 403, 'Somente o proprietário pode gerar este PDF.'],
    ['orçamento inexistente', { token: 'tok-donoA', quoteId: 'c9999999-9999-4999-8999-999999999999', companyId: A }, 404, 'Orçamento não encontrado.'],
    ['sem JWT', { token: '' }, 401, 'Sessão necessária.'],
  ];
  for (const [nome, opcoes, status, erro] of casos) {
    const e = await viaEdge(opcoes);
    const v = await viaVercel(opcoes);
    assert.equal(e.status, status, `${nome}: Edge`);
    assert.equal(v.status, status, `${nome}: mesma resposta da Vercel`);
    if (erro) {
      assert.deepEqual(e.corpo, { error: erro }, `${nome}: erro sanitizado`);
      assert.deepEqual(v.corpo, e.corpo, `${nome}: mesma mensagem da Vercel`);
      assert.equal(e.tipo, 'application/json; charset=utf-8');
      assert.equal(e.bytes.subarray(0, 5).toString('latin1') === '%PDF-', false);
    } else {
      assert.equal(e.tipo, 'application/pdf');
    }
  }
  // JWT inválido: 401 na Edge Function (a Vercel também devolve 401 quando o Auth diz 401).
  const forjado = await viaEdge({ token: 'tok-forjado' });
  assert.equal(forjado.status, 401);
  assert.deepEqual(forjado.corpo, { error: 'Sessão inválida ou expirada.' });
  assert.equal((await viaVercel({ token: 'tok-forjado' })).status, 401);
  // O token nunca vai para o log.
  logs.length = 0;
  cota = { status: 200, corpo: null, falharItens: true };
  try { await viaEdge({ token: 'tok-donoA' }); } finally { cota = { status: 200, corpo: null }; }
  assert.ok(logs.length >= 1, 'falha inesperada é registrada');
  assert.equal(logs.some((l) => l.includes('tok-donoA')), false, 'log sem token');
  assert.equal(logs.some((l) => /eyJhbGci|Bearer\s+\S{8,}/.test(l)), false, 'log sem token');
});

test('Cota e falhas do banco: mensagem fixa, nunca o detalhe técnico', async () => {
  cenario({ quote: base(QA, A, CLA), itens: [{ id: 'i1', kind: 'free', service_id: null, product_id: null, name: 'Item', unit: 'un', quantity: 1, unit_price: 10, unit_cost: 1, notes: null, position: 1 }] });
  try {
    cota = { status: 400, corpo: { code: 'P0001', message: 'Muitos PDFs em pouco tempo. Aguarde um minuto' } };
    assert.deepEqual((await viaEdge()).corpo, { error: 'Muitos PDFs em pouco tempo. Aguarde um minuto' });
    assert.equal((await viaEdge()).status, 429);
    cota = { status: 400, corpo: { code: 'P0001', message: 'Assinatura inativa' } };
    assert.deepEqual((await viaEdge()).corpo, { error: 'Assinatura inativa' });
    cota = { status: 404, corpo: { code: 'PGRST202', message: 'Could not find the function public.zt_consume_quote_pdf_quota in the schema cache' } };
    const r = await viaEdge();
    assert.deepEqual(r.corpo, { error: 'Limite de geração de PDF atingido.' }, 'texto do PostgREST não vaza');
    cota = { status: 200, corpo: null, falharItens: true };
    const falha = await viaEdge();
    assert.equal(falha.status, 500);
    assert.deepEqual(falha.corpo, { error: 'Não foi possível gerar o PDF.' });
    assert.equal(JSON.stringify(falha.corpo).includes('private'), false);
  } finally { cota = { status: 200, corpo: null }; }
});

// ─────────────────────────── 3. CORS, método, corpo

test('CORS: só as origens exatas de Production; OPTIONS seguro; nunca *', async () => {
  assert.deepEqual([...ORIGENS_PERMITIDAS], PROD_SUPABASE_HOSTS.map((h) => `https://${h}`), 'mesma lista do app');
  cenario({ quote: base(QA, A, CLA), itens: [{ id: 'i1', kind: 'free', service_id: null, product_id: null, name: 'Item', unit: 'un', quantity: 1, unit_price: 10, unit_cost: 1, notes: null, position: 1 }] });
  for (const origin of ORIGENS_PERMITIDAS) {
    const r = await viaEdge({ origin });
    assert.equal(r.status, 200, origin);
    assert.equal(r.acao, origin, `${origin}: ecoa a própria origem`);
    assert.equal(r.headers.get('vary'), 'Origin');
    const pre = await edge(pedido({ origin, metodo: 'OPTIONS', token: '', tipo: '' }));
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('access-control-allow-origin'), origin);
    assert.equal(pre.headers.get('access-control-allow-methods'), 'POST, OPTIONS');
    assert.match(pre.headers.get('access-control-allow-headers'), /^authorization, x-client-info, apikey, content-type$/);
  }
  for (const origin of ['https://evil.example', 'https://ziistec.com.evil.com', 'http://ziistec.com', 'https://app.ziistec.com', 'https://beta.ziistec.com',
    `https://${STAGING_SUPABASE_HOSTS[0]}`, 'null', 'https://ziistec.com:8443']) {
    pedidos = [];
    const r = await viaEdge({ origin });
    assert.equal(r.status, 403, origin);
    assert.equal(r.acao, null, `${origin}: sem Access-Control-Allow-Origin`);
    assert.deepEqual(pedidos, [], `${origin}: recusado antes de qualquer consulta`);
    const pre = await edge(pedido({ origin, metodo: 'OPTIONS', token: '', tipo: '' }));
    assert.equal(pre.status, 403);
    assert.equal(pre.headers.get('access-control-allow-origin'), null);
  }
  assert.equal(/['"]\*['"]/.test(read(`${FN}/handler.js`)), false);
  // Sem Origin (chamada de servidor, curl): CORS não se aplica; o JWT continua obrigatório.
  assert.equal((await viaEdge({ origin: '' })).status, 200);
  assert.equal((await viaEdge({ origin: '', token: '' })).status, 401);
});

test('Método, tipo, tamanho e corpo inválidos são recusados com erro JSON', async () => {
  const casos = [
    [{ metodo: 'GET' }, 405], [{ metodo: 'PUT' }, 405], [{ tipo: 'text/plain' }, 415],
    [{ corpo: JSON.stringify({ quoteId: QA, companyId: A, x: 'y'.repeat(9000) }) }, 413],
    [{ corpo: 'não é json' }, 400], [{ corpo: '[]' }, 400], [{ corpo: 'null' }, 400],
    [{ quoteId: 'abc' }, 400], [{ companyId: "' or 1=1 --" }, 400], [{ corpo: JSON.stringify({ quoteId: 1, companyId: A }) }, 400],
  ];
  for (const [opcoes, status] of casos) {
    pedidos = [];
    const r = await viaEdge(opcoes);
    assert.equal(r.status, status, JSON.stringify(opcoes).slice(0, 80));
    assert.equal(r.tipo, 'application/json; charset=utf-8');
    assert.equal(typeof r.corpo.error, 'string');
    assert.deepEqual(pedidos, [], 'nada chega ao banco');
  }
  const semConfig = criarHandlerPdfOrcamento({ pdfLib, supabaseUrl: '', apiKey: '', fetchImpl: fetchFalso });
  assert.equal((await semConfig(pedido())).status, 503);
});

// ─────────────────────────── 4. cliente

const STUB = 'globalThis.__ztPdfSupabase';
const fonteCliente = read('src/lib/quotePdf.js')
  .replace("import { supabase } from './supabase';", `const supabase = new Proxy({}, { get: (_, k) => ${STUB}?.[k] });`)
  .replace("from './supabaseConfig.js'", `from '${new URL('../../src/lib/supabaseConfig.js', import.meta.url).href}'`);
const cliente = await import(`data:text/javascript;base64,${Buffer.from(fonteCliente).toString('base64')}`);

function ambienteCliente(hostname, respostaEdge, respostaVercel) {
  const chamadas = { invoke: [], edgeHttp: 0, vercel: 0, downloads: [] };
  const functions = new FunctionsClient('https://diztevlpbcfqleizswxr.supabase.co/functions/v1', {
    customFetch: async (url, init) => { chamadas.edgeHttp += 1; chamadas.ultimaUrl = url; chamadas.ultimoInit = init; return respostaEdge(init); },
  });
  const invoke = functions.invoke.bind(functions);
  globalThis.__ztPdfSupabase = {
    auth: { getSession: async () => ({ data: { session: { access_token: 'tok-da-sessao' } }, error: null }) },
    functions: { invoke: (nome, opcoes) => { chamadas.invoke.push([nome, opcoes]); return invoke(nome, opcoes); } },
  };
  globalThis.window = { location: { hostname } };
  globalThis.document = { createElement: () => ({ click() { chamadas.downloads.push(this.download); }, remove() {} }), body: { appendChild() {} } };
  globalThis.fetch = async (url, init) => { chamadas.vercel += 1; chamadas.vercelUrl = url; return respostaVercel(init); };
  return chamadas;
}
after(() => { delete globalThis.__ztPdfSupabase; delete globalThis.window; delete globalThis.document; globalThis.fetch = fetchOriginal; });

const pdfOk = () => new Response(Buffer.from('%PDF-1.7\n%conteúdo de teste\n'), { status: 200, headers: { 'content-type': 'application/pdf' } });
const jsonResp = (status, corpo) => new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });

test('Cliente: Vercel usa /api/quote-pdf; ziistec.com/www usam a Edge Function; host desconhecido não chama nada', () => {
  for (const host of ['ziistec.com', 'www.ziistec.com', 'ZIISTEC.COM']) assert.equal(cliente.rotaPdfOrcamento(host), 'edge', host);
  for (const host of [...PROD_SUPABASE_HOSTS.filter((h) => !h.endsWith('ziistec.com')), ...STAGING_SUPABASE_HOSTS, 'localhost', '127.0.0.1']) {
    assert.equal(cliente.rotaPdfOrcamento(host), 'vercel', host);
  }
  for (const host of ['app.ziistec.com', 'ziistec.com.br', 'ziistec.com.evil.com', 'evil.example', 'ziistec.hostingersite.com', '']) {
    assert.equal(cliente.rotaPdfOrcamento(host), '', host || '(vazio)');
  }
});

test('Cliente na Hostinger: chama a Edge Function com o JWT da sessão e baixa só PDF válido', async () => {
  const c = ambienteCliente('ziistec.com', () => pdfOk(), () => { throw new Error('não pode chamar a Vercel'); });
  assert.equal(await cliente.baixarOrcamentoPDF(QA, A, 'ORC-0042.pdf'), true);
  assert.deepEqual(c.invoke.map(([n, o]) => [n, o.body, o.headers, o.timeout]), [['quote-pdf', { quoteId: QA, companyId: A }, { Authorization: 'Bearer tok-da-sessao' }, 20000]]);
  assert.equal(c.ultimaUrl, 'https://diztevlpbcfqleizswxr.supabase.co/functions/v1/quote-pdf');
  assert.equal(new Headers(c.ultimoInit.headers).get('authorization'), 'Bearer tok-da-sessao');
  assert.equal(/service_role|sb_secret_/.test(JSON.stringify(c.ultimoInit)), false);
  assert.equal(c.vercel, 0, 'nunca tenta a Vercel');
  assert.deepEqual(c.downloads, ['ORC-0042.pdf']);
});

test('Cliente na Hostinger: 401, 403, 404, 429, 500, timeout, rede e resposta não-PDF nunca baixam arquivo', async () => {
  const casos = [
    ['401 do gateway', () => jsonResp(401, { code: 401, message: 'Invalid JWT' }), /Sua sessão expirou/],
    ['403 da função', () => jsonResp(403, { error: 'Somente o proprietário pode gerar este PDF.' }), /^Somente o proprietário pode gerar este PDF\.$/],
    ['404 função não publicada', () => jsonResp(404, { code: 'NOT_FOUND', message: 'Requested function was not found' }), /ainda não está disponível neste endereço/],
    ['404 orçamento', () => jsonResp(404, { error: 'Orçamento não encontrado.' }), /^Orçamento não encontrado\.$/],
    ['429 cota', () => jsonResp(429, { error: 'Muitos PDFs em pouco tempo. Aguarde um minuto' }), /Muitos PDFs/],
    ['500 com detalhe técnico', () => jsonResp(500, { error: 'relation "zt_private.x" does not exist' }), /^Não foi possível gerar o PDF\.$/],
    ['502 em HTML', () => new Response('<html>Bad gateway</html>', { status: 502, headers: { 'content-type': 'text/html' } }), /^Não foi possível gerar o PDF\.$/],
    ['timeout', () => { throw new DOMException('The operation was aborted.', 'AbortError'); }, /demorou demais/],
    ['sem rede', () => { throw new TypeError('Failed to fetch'); }, /Sem conexão/],
    ['200 com JSON', () => jsonResp(200, { ok: true }), /^Não foi possível gerar o PDF\.$/],
    ['200 com HTML', () => new Response('<!doctype html><title>ZiisTec</title>', { status: 200, headers: { 'content-type': 'text/html' } }), /^Não foi possível gerar o PDF\.$/],
    ['200 "pdf" com HTML dentro', () => new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'application/pdf' } }), /^Não foi possível gerar o PDF\.$/],
    ['200 pdf vazio', () => new Response(new Uint8Array(0), { status: 200, headers: { 'content-type': 'application/pdf' } }), /^Não foi possível gerar o PDF\.$/],
  ];
  for (const [nome, resposta, erro] of casos) {
    const c = ambienteCliente('www.ziistec.com', resposta, () => { throw new Error('não pode chamar a Vercel'); });
    await assert.rejects(cliente.baixarOrcamentoPDF(QA, A, 'x.pdf'), (e) => { assert.match(e.message, erro, nome); return true; });
    assert.deepEqual(c.downloads, [], `${nome}: nenhum arquivo baixado`);
    assert.equal(c.vercel, 0, `${nome}: sem segundo backend`);
    assert.equal(c.edgeHttp, 1, `${nome}: uma tentativa só`);
  }
});

test('Cliente: host desconhecido falha fechado sem rede; Vercel continua em /api/quote-pdf', async () => {
  const c = ambienteCliente('app.ziistec.com', () => pdfOk(), () => pdfOk());
  await assert.rejects(cliente.baixarOrcamentoPDF(QA, A, 'x.pdf'), /ainda não está disponível neste endereço/);
  assert.equal(c.edgeHttp + c.vercel, 0, 'nenhuma chamada');
  assert.deepEqual(c.downloads, []);

  const v = ambienteCliente('ziistec.vercel.app', () => { throw new Error('não pode chamar a Edge Function'); }, () => pdfOk());
  assert.equal(await cliente.baixarOrcamentoPDF(QA, A, 'v.pdf'), true);
  assert.equal(v.vercelUrl, '/api/quote-pdf');
  assert.equal(v.invoke.length, 0);
  assert.deepEqual(v.downloads, ['v.pdf']);
  // Na Vercel o mesmo endurecimento: HTML com 200 ou "PDF" sem assinatura não baixa.
  for (const r of [() => new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    () => new Response('{"a":1}', { status: 200, headers: { 'content-type': 'application/pdf' } })]) {
    const x = ambienteCliente('ziistec.vercel.app', () => pdfOk(), r);
    await assert.rejects(cliente.baixarOrcamentoPDF(QA, A, 'v.pdf'));
    assert.deepEqual(x.downloads, []);
  }
});

test('Cliente: toque duplo gera um pedido só; depois de terminar, tentar de novo funciona', async () => {
  let liberar;
  const c = ambienteCliente('ziistec.com', () => new Promise((r) => { liberar = () => r(pdfOk()); }), () => pdfOk());
  const p1 = cliente.baixarOrcamentoPDF(QA, A, 'a.pdf');
  const p2 = cliente.baixarOrcamentoPDF(QA, A, 'a.pdf');
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(c.edgeHttp, 1, 'segundo toque reaproveita o pedido em andamento');
  liberar();
  assert.deepEqual(await Promise.all([p1, p2]), [true, true]);
  const c2 = ambienteCliente('ziistec.com', () => jsonResp(500, {}), () => pdfOk());
  await assert.rejects(cliente.baixarOrcamentoPDF(QA, A, 'a.pdf'));
  const c3 = ambienteCliente('ziistec.com', () => pdfOk(), () => pdfOk());
  assert.equal(await cliente.baixarOrcamentoPDF(QA, A, 'a.pdf'), true, 'retry depois do erro é um pedido novo');
  assert.equal(c2.edgeHttp + c3.edgeHttp, 2);
});
