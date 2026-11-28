// Gera o PDF do orçamento pela rota REAL (api/quote-pdf.js) com o banco simulado e registra cada
// operação de desenho por página: textos (com caixa medida pela fonte), imagens, retângulos e linhas.
// A Edge Function usa o mesmo código (o teste quote_pdf_edge compara byte a byte).
import zlib from 'node:zlib';
import * as pdfLib from 'pdf-lib';

process.env.VERCEL_ENV ||= 'development';
process.env.SUPABASE_URL ||= 'https://xadoktssibuuebzzjrhv.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY ||= 'sb_publishable_AIJvagsmB3vknIW9ykFERQ_T7aCkl5e';
const { default: handler } = await import('../../../api/quote-pdf.js');

export const A4 = [595.28, 841.89];
export const MARGEM = 40;
export const DIREITA = A4[0] - MARGEM;
export const TOPO = A4[1] - MARGEM;
export const LOGO_CAIXA = { width: 112, height: 52 };
export const SAFE_BOTTOM = 72;

export const COMPANY = '11111111-1111-4111-8111-111111111111';
export const QUOTE = '22222222-2222-4222-8222-222222222222';
export const CLIENT = '33333333-3333-4333-8333-333333333333';

// ── imagens de teste ────────────────────────────────────────────────────────────────────────
export function png(largura, altura, { alfa = false, cor = [9, 120, 110] } = {}) {
  const crc = (buf) => zlib.crc32(buf) >>> 0;
  const bloco = (tipo, dados) => {
    const t = Buffer.from(tipo, 'ascii');
    const tam = Buffer.alloc(4); tam.writeUInt32BE(dados.length);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, dados])));
    return Buffer.concat([tam, t, dados, c]);
  };
  const canais = alfa ? 4 : 3;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0); ihdr.writeUInt32BE(altura, 4); ihdr[8] = 8; ihdr[9] = alfa ? 6 : 2;
  const linha = largura * canais + 1;
  const dados = Buffer.alloc(linha * altura);
  for (let y = 0; y < altura; y++) {
    for (let x = 0; x < largura; x++) {
      const i = y * linha + 1 + x * canais;
      dados.set(cor, i);
      if (alfa) dados[i + 3] = (x + y) % 2 ? 255 : 0; // transparência real
    }
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), bloco('IHDR', ihdr), bloco('IDAT', zlib.deflateSync(dados)), bloco('IEND', Buffer.alloc(0))]);
}

// JPEG com o cabeçalho SOF real (o pdf-lib só lê dimensões e incorpora os bytes sem decodificar).
// `tamanho` acrescenta bytes de dados para simular arquivos pesados como a logo antiga da JS Connect.
export function jpeg(largura, altura, tamanho = 0) {
  const sof = Buffer.from([0xFF, 0xC0, 0x00, 0x11, 0x08, altura >> 8, altura & 255, largura >> 8, largura & 255, 0x03,
    0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]);
  const corpo = Buffer.concat([Buffer.from([0xFF, 0xD8]), sof]);
  const enchimento = Math.max(0, tamanho - corpo.length - 2);
  return Buffer.concat([corpo, Buffer.alloc(enchimento, 0x55), Buffer.from([0xFF, 0xD9])]);
}

// ── banco simulado ──────────────────────────────────────────────────────────────────────────
export const empresaBase = () => ({ id: COMPANY, name: 'Js Connect Climatização', trade_name: null, tax_id: '12.345.678/0001-90', phone: '11 4000-0000', whatsapp: '11 90000-0000', email: 'contato@exemplo.invalid', address: null, logo_path: null, owner_name: 'Dono da Empresa' });
export const clienteBase = () => ({ id: CLIENT, name: 'Condomínio Aurora', trade_name: null, tax_id: '98.765.432/0001-10', contact_name: 'Síndica Ana', phone: '11 3000-0000', whatsapp: null, address: 'Av. Brasil, 1000 · Bloco C' });
export const orcamentoBase = (extra = {}) => ({
  id: QUOTE, company_id: COMPANY, number: 'ORC-0042', client_id: CLIENT, status: 'sent', issue_date: '2026-11-27', valid_until: '2026-12-12',
  payment_terms: null, notes: null, customer_message: null, execution_forecast_date: null, address: null, service_place: null,
  show_product_images: false, discount: 0, surcharge: 0, deleted_at: null, ...extra,
});
export const item = (n, extra = {}) => ({ id: `i${n}`, kind: 'free', service_id: null, product_id: null, name: `Item ${n}`, unit: 'un', quantity: 1, unit_price: 100, notes: null, position: n, ...extra });

const json = (dados, status = 200) => new Response(JSON.stringify(dados), { status, headers: { 'content-type': 'application/json' } });

function fetchDoCenario({ empresa, cliente, orcamento, itens, produtos = {}, servicos = {}, objetos = {} }) {
  return async (url) => {
    const u = new URL(String(url));
    const p = u.pathname;
    if (p === '/auth/v1/user') return json({ id: 'u' });
    if (p === '/rest/v1/rpc/zt_is_owner') return json(true);
    if (p === '/rest/v1/rpc/zt_consume_quote_pdf_quota') return json(COMPANY);
    if (p === '/rest/v1/companies') return json([empresa]);
    if (p === '/rest/v1/quotes') return json([orcamento]);
    if (p === '/rest/v1/quote_items') return json(itens);
    if (p === '/rest/v1/clients') return json(cliente ? [cliente] : []);
    const ids = (u.searchParams.get('id') || '').replace(/^in\.\(|\)$/g, '').split(',');
    if (p === '/rest/v1/products') return json(ids.map((id) => produtos[id]).filter(Boolean));
    if (p === '/rest/v1/services') return json(ids.map((id) => servicos[id]).filter(Boolean));
    const objeto = p.match(/^\/storage\/v1\/object\/authenticated\/(.+)$/);
    if (objeto) {
      const achado = objetos[decodeURIComponent(objeto[1])];
      return achado ? new Response(achado[1], { status: 200, headers: { 'content-type': achado[0] } }) : json({ error: 'not_found' }, 400);
    }
    throw new Error(`fetch inesperado: ${p}`);
  };
}

// ── registro das operações de desenho ───────────────────────────────────────────────────────
let paginas = null;
const original = {
  addPage: pdfLib.PDFDocument.prototype.addPage,
  drawText: pdfLib.PDFPage.prototype.drawText,
  drawImage: pdfLib.PDFPage.prototype.drawImage,
  drawRectangle: pdfLib.PDFPage.prototype.drawRectangle,
  drawLine: pdfLib.PDFPage.prototype.drawLine,
};
const registro = (pagina) => {
  if (!paginas) return null;
  let r = paginas.find((x) => x.pagina === pagina);
  if (!r) { r = { pagina, textos: [], imagens: [], retangulos: [], linhas: [] }; paginas.push(r); }
  return r;
};
pdfLib.PDFDocument.prototype.addPage = function (...args) { const p = original.addPage.apply(this, args); registro(p); return p; };
pdfLib.PDFPage.prototype.drawText = function (text, o = {}) {
  const r = registro(this);
  if (r) {
    const largura = o.font ? o.font.widthOfTextAtSize(text, o.size) : 0;
    r.textos.push({ text, x: o.x, y: o.y, size: o.size, largura, x2: o.x + largura, baixo: o.y - o.size * 0.22, alto: o.y + o.size * 0.72 });
  }
  return original.drawText.call(this, text, o);
};
pdfLib.PDFPage.prototype.drawImage = function (img, o = {}) {
  registro(this)?.imagens.push({ x: o.x, y: o.y, width: o.width, height: o.height, opacity: o.opacity, naturalW: img.width, naturalH: img.height });
  return original.drawImage.call(this, img, o);
};
pdfLib.PDFPage.prototype.drawRectangle = function (o = {}) {
  registro(this)?.retangulos.push({ x: o.x, y: o.y, width: o.width, height: o.height, opacity: o.opacity });
  return original.drawRectangle.call(this, o);
};
pdfLib.PDFPage.prototype.drawLine = function (o = {}) {
  registro(this)?.linhas.push({ x1: o.start.x, y1: o.start.y, x2: o.end.x, y2: o.end.y, thickness: o.thickness });
  return original.drawLine.call(this, o);
};

// Relógio fixo: dois PDFs do mesmo cenário saem com os mesmos bytes.
const DataReal = Date;
const INSTANTE = DataReal.UTC(2026, 10, 27, 12, 0, 0);

export async function gerar({ empresa = empresaBase(), cliente = clienteBase(), orcamento = orcamentoBase(), itens = [item(1, { quantity: 3 })], produtos, servicos, objetos } = {}) {
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = fetchDoCenario({ empresa, cliente, orcamento, itens, produtos, servicos, objetos });
  globalThis.Date = class extends DataReal { constructor(...a) { if (a.length) super(...a); else super(INSTANTE); } static now() { return INSTANTE; } };
  paginas = [];
  const res = {
    statusCode: 0, headers: {}, body: null,
    setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }, send(b) { this.body = b; return this; },
  };
  try {
    await handler({ method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer t' }, body: { quoteId: QUOTE, companyId: COMPANY } }, res);
  } finally {
    globalThis.fetch = fetchOriginal;
    globalThis.Date = DataReal;
  }
  const resultado = { status: res.statusCode, tipo: res.headers['Content-Type'], bytes: Buffer.from(res.body ?? []), paginas };
  paginas = null;
  return resultado;
}

// ── verificações reutilizáveis ──────────────────────────────────────────────────────────────
export const textos = (r) => r.paginas.flatMap((p, i) => p.textos.map((t) => ({ ...t, pagina: i })));
export const acharTexto = (r, conteudo) => textos(r).find((t) => t.text === conteudo);
export const contemTexto = (r, trecho) => textos(r).some((t) => t.text.includes(trecho));
const cruza = (a, b, folga = 0.5) => Math.min(a.x2, b.x2) - Math.max(a.x, b.x) > folga && Math.min(a.alto, b.alto) - Math.max(a.baixo, b.baixo) > folga;

// Nenhum texto em cima de outro, nenhum fora das margens, nada no rodapé além do próprio rodapé.
export function semSobreposicao(r) {
  const problemas = [];
  r.paginas.forEach((p, i) => {
    const ts = p.textos.filter((t) => t.text.trim());
    for (let a = 0; a < ts.length; a++) {
      const t = ts[a];
      if (t.x < MARGEM - 0.5 || t.x2 > DIREITA + 0.5) problemas.push(`p${i + 1}: "${t.text}" fora das margens (${t.x.toFixed(1)}–${t.x2.toFixed(1)})`);
      if (t.alto > A4[1] - MARGEM + 1) problemas.push(`p${i + 1}: "${t.text}" acima do topo`);
      const rodape = t.y === 32 && t.size === 7;
      if (!rodape && t.baixo < SAFE_BOTTOM - 4) problemas.push(`p${i + 1}: "${t.text}" invade o rodapé (y=${t.y.toFixed(1)})`);
      for (let b = a + 1; b < ts.length; b++) if (cruza(t, ts[b])) problemas.push(`p${i + 1}: "${t.text}" sobre "${ts[b].text}"`);
    }
  });
  return problemas;
}
