import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { PDFPage } from 'pdf-lib';

// A rota resolve o Supabase na importação: staging em development, com toda a rede simulada abaixo.
process.env.VERCEL_ENV = 'development';
process.env.SUPABASE_URL = 'https://xadoktssibuuebzzjrhv.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_AIJvagsmB3vknIW9ykFERQ_T7aCkl5e';
const { default: handler } = await import('../../api/quote-pdf.js');

const COMPANY = '11111111-1111-4111-8111-111111111111';
const QUOTE = '22222222-2222-4222-8222-222222222222';
const CLIENT = '33333333-3333-4333-8333-333333333333';
let quoteRow;

const fetchOriginal = globalThis.fetch;
globalThis.fetch = async (url) => {
  const u = String(url);
  const json = (data) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
  if (u.endsWith('/auth/v1/user')) return json({ id: '44444444-4444-4444-8444-444444444444' });
  if (u.includes('/rest/v1/rpc/zt_is_owner')) return json(true);
  if (u.includes('/rest/v1/rpc/zt_consume_quote_pdf_quota')) return json(COMPANY);
  if (u.includes('/rest/v1/companies?')) return json([{ id: COMPANY, name: 'Empresa Teste', trade_name: null, tax_id: null, phone: null, whatsapp: null, email: null, address: null, logo_path: null, owner_name: 'Dono Teste' }]);
  if (u.includes('/rest/v1/quotes?')) return json([quoteRow]);
  if (u.includes('/rest/v1/quote_items?')) return json([{ id: 'item-1', kind: 'free', service_id: null, product_id: null, name: 'Serviço de teste', unit: 'unidade', quantity: 3, unit_price: 100, notes: null, position: 1 }]);
  if (u.includes('/rest/v1/clients?')) return json([{ id: CLIENT, name: 'Cliente Teste', trade_name: null, tax_id: null, contact_name: null, phone: '11900000000', whatsapp: null, address: 'Rua Teste, 1' }]);
  throw new Error(`fetch inesperado: ${u}`);
};

const desenhos = [];
const drawText = PDFPage.prototype.drawText;
const drawRectangle = PDFPage.prototype.drawRectangle;
PDFPage.prototype.drawText = function (text, options = {}) {
  desenhos.push({ tipo: 'texto', text, y: options.y });
  return drawText.call(this, text, options);
};
PDFPage.prototype.drawRectangle = function (options = {}) {
  desenhos.push({ tipo: 'retangulo', y: options.y, width: options.width, height: options.height });
  return drawRectangle.call(this, options);
};
after(() => {
  globalThis.fetch = fetchOriginal;
  PDFPage.prototype.drawText = drawText;
  PDFPage.prototype.drawRectangle = drawRectangle;
});

async function gerarPdf(ajustes) {
  quoteRow = {
    id: QUOTE, company_id: COMPANY, number: 'ORC-0001', client_id: CLIENT, status: 'draft',
    issue_date: '2026-10-02', valid_until: '2026-10-17', payment_terms: null, notes: null, customer_message: null,
    execution_forecast_date: null, address: null, service_place: null, show_product_images: false,
    discount: 0, surcharge: 0, ...ajustes,
  };
  desenhos.length = 0;
  const res = {
    statusCode: 0, headers: {}, body: null,
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    send(body) { this.body = body; return this; },
  };
  await handler({
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer teste' },
    body: { quoteId: QUOTE, companyId: COMPANY },
  }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.headers['Content-Type'], 'application/pdf');
  assert.equal(Buffer.from(res.body).subarray(0, 5).toString(), '%PDF-');
  return [...desenhos];
}

// Faixa escura do TOTAL: 38pt de altura e 240pt de largura, ancorada na margem direita.
const faixaTotal = (d) => d.find((x) => x.tipo === 'retangulo' && x.height === 38 && Math.round(x.width) === 240);
const texto = (d, valor) => d.find((x) => x.tipo === 'texto' && x.text === valor);
const visivelAcimaDoTotal = (d, valor) => {
  const faixa = faixaTotal(d);
  const linha = texto(d, valor);
  assert.ok(faixa, 'faixa do TOTAL desenhada');
  assert.ok(linha, `${valor} desenhado`);
  assert.ok(linha.y - 3 > faixa.y + faixa.height, `${valor} (y=${linha.y}) fica sob a faixa do TOTAL (topo=${faixa.y + faixa.height})`);
};

test('PDF do orçamento mantém subtotal, desconto e acréscimo visíveis acima do TOTAL', async (t) => {
  await t.test('desconto e acréscimo', async () => {
    const d = await gerarPdf({ discount: 10, surcharge: 5 });
    for (const valor of ['Subtotal', 'R$ 300,00', 'Desconto', '- R$ 10,00', 'Acréscimo', '+ R$ 5,00']) visivelAcimaDoTotal(d, valor);
    assert.ok(texto(d, 'R$ 295,00'), 'total final desenhado');
  });

  await t.test('somente desconto', async () => {
    const d = await gerarPdf({ discount: 10 });
    for (const valor of ['Subtotal', 'Desconto', '- R$ 10,00']) visivelAcimaDoTotal(d, valor);
    assert.equal(texto(d, 'Acréscimo'), undefined);
  });

  await t.test('somente acréscimo', async () => {
    const d = await gerarPdf({ surcharge: 5 });
    for (const valor of ['Subtotal', 'Acréscimo', '+ R$ 5,00']) visivelAcimaDoTotal(d, valor);
    assert.equal(texto(d, 'Desconto'), undefined);
  });

  await t.test('sem ajustes não desenha linhas de ajuste', async () => {
    const d = await gerarPdf({});
    assert.ok(faixaTotal(d), 'faixa do TOTAL desenhada');
    assert.equal(texto(d, 'Subtotal'), undefined);
    assert.ok(texto(d, 'R$ 300,00'), 'total final desenhado');
  });

  await t.test('espaço entre o TOTAL e as condições não muda com ajustes', async () => {
    const espaco = (d) => faixaTotal(d).y - texto(d, 'CONDIÇÕES DE PAGAMENTO').y;
    assert.equal(espaco(await gerarPdf({ discount: 10, surcharge: 5 })), espaco(await gerarPdf({})));
  });
});
