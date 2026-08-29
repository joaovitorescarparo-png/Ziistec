import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { supabaseServidor } from './_supabaseServerConfig.js';

const { url: SUPABASE_URL, publishableKey: SUPABASE_PUBLISHABLE_KEY } = supabaseServidor;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 8 * 1024;
const commonHeaders = {
  'Cache-Control': 'private, no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

const clean = (v = '') => String(v ?? '')
  .replace(/[\u2018\u2019]/g, "'")
  .replace(/[\u201C\u201D]/g, '"')
  .replace(/[\u2022]/g, '-')
  .replace(/[\u2013\u2014]/g, '-')
  .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '?');
const money = (n) => `R$ ${Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dateBR = (s) => s ? String(s).split('-').reverse().join('/') : '-';
const safeFile = (s) => clean(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').slice(0, 80) || 'orcamento';

async function sbFetch(path, auth, init = {}) {
  const headers = { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: auth, ...(init.headers || {}) };
  const r = await fetch(`${SUPABASE_URL}${path}`, { ...init, headers, signal: init.signal || AbortSignal.timeout(8000) });
  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    const e = new Error(detail || `Supabase ${r.status}`);
    e.status = r.status;
    throw e;
  }
  return r;
}
const sbJson = async (path, auth) => (await sbFetch(path, auth)).json();

function wrapText(text, font, size, maxWidth) {
  const out = [];
  for (const paragraph of clean(text).split(/\r?\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) { out.push(''); continue; }
    let line = '';
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(test, size) <= maxWidth) line = test;
      else { if (line) out.push(line); line = word; }
    }
    if (line) out.push(line);
  }
  return out;
}

async function carregarLogo(company, auth, pdf) {
  if (!company?.logo_path) return null;
  try {
    const encoded = String(company.logo_path).split('/').map(encodeURIComponent).join('/');
    const r = await sbFetch(`/storage/v1/object/authenticated/zt-branding/${encoded}`, auth);
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (bytes.byteLength > 3 * 1024 * 1024) return null;
    const ct = String(r.headers.get('content-type') || '').toLowerCase();
    if (ct.includes('png')) return await pdf.embedPng(bytes);
    if (ct.includes('jpeg') || ct.includes('jpg')) return await pdf.embedJpg(bytes);
  } catch {}
  return null;
}

export default async function handler(req, res) {
  Object.entries(commonHeaders).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });
  if (!String(req.headers['content-type'] || '').toLowerCase().includes('application/json')) return res.status(415).json({ error: 'Conteúdo inválido.' });
  const declaredLength = Number(req.headers['content-length'] || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) return res.status(413).json({ error: 'Solicitação grande demais.' });
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return res.status(400).json({ error: 'Solicitação inválida.' });
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Sessão necessária.' });
  if (!supabaseServidor.configurado) return res.status(503).json({ error: 'Ambiente de API sem banco de homologação configurado.' });
  if (typeof req.body.quoteId !== 'string' || typeof req.body.companyId !== 'string') return res.status(400).json({ error: 'Orçamento ou empresa inválidos.' });
  const quoteId = req.body.quoteId.trim();
  const companyId = req.body.companyId.trim();
  if (!UUID_RE.test(quoteId) || !UUID_RE.test(companyId)) return res.status(400).json({ error: 'Orçamento ou empresa inválidos.' });

  try {
    await sbFetch('/auth/v1/user', auth);
    const ownerResp = await sbFetch('/rest/v1/rpc/zt_is_owner', auth, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ target: companyId }),
    });
    if (await ownerResp.json() !== true) return res.status(403).json({ error: 'Somente o proprietário pode gerar este PDF.' });

    const quota = await fetch(`${SUPABASE_URL}/rest/v1/rpc/zt_consume_quote_pdf_quota`, {
      method: 'POST',
      headers: { Authorization: auth, apikey: SUPABASE_PUBLISHABLE_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ p_company: companyId }),
      signal: AbortSignal.timeout(8000),
    }).catch(() => null);
    if (!quota?.ok) {
      const detail = quota ? await quota.json().catch(() => ({})) : {};
      const msg = detail?.message || 'Limite de geração de PDF atingido.';
      const status = quota?.status === 401 ? 401 : quota?.status === 403 ? 403 : quota ? 429 : 502;
      return res.status(status).json({ error: msg });
    }

    const [companies, quotes, items] = await Promise.all([
      sbJson(`/rest/v1/companies?id=eq.${companyId}&select=id,name,trade_name,tax_id,phone,whatsapp,email,address,logo_path,owner_name`, auth),
      sbJson(`/rest/v1/quotes?id=eq.${quoteId}&company_id=eq.${companyId}&deleted_at=is.null&select=*`, auth),
      // Sem unit_cost: o documento comercial do cliente nunca recebe custo ou margem.
      sbJson(`/rest/v1/quote_items?quote_id=eq.${quoteId}&company_id=eq.${companyId}&select=id,kind,product_id,name,unit,quantity,unit_price,notes,position&order=position.asc`, auth),
    ]);
    const company = companies?.[0];
    const quote = quotes?.[0];
    if (!company || !quote) return res.status(404).json({ error: 'Orçamento não encontrado.' });
    const clients = quote.client_id
      ? await sbJson(`/rest/v1/clients?id=eq.${quote.client_id}&company_id=eq.${companyId}&select=id,name,trade_name,tax_id,contact_name,phone,whatsapp,address`, auth)
      : [];
    const client = clients?.[0] || {};
    const nomeCliente = client.trade_name || client.name || 'Cliente não informado';
    const companyName = company.trade_name || company.name || 'Empresa';

    const pdf = await PDFDocument.create();
    pdf.setTitle(`Orçamento ${quote.number} - ${nomeCliente}`);
    pdf.setAuthor(companyName);
    pdf.setSubject('Proposta comercial');
    pdf.setCreator('ZiisTec');
    const normal = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const logo = await carregarLogo(company, auth, pdf);

    const A4 = [595.28, 841.89];
    const margin = 38;
    const contentW = A4[0] - margin * 2;
    const navy = rgb(0.035, 0.075, 0.13);
    const teal = rgb(0.04, 0.52, 0.46);
    const ink = rgb(0.10, 0.13, 0.17);
    const muted = rgb(0.38, 0.42, 0.47);
    const line = rgb(0.84, 0.86, 0.88);
    const soft = rgb(0.965, 0.972, 0.976);
    const white = rgb(1, 1, 1);

    let page;
    let y;
    let pageNo = 0;
    const drawLogoFit = (pg, img, x, yy, boxW, boxH, opacity = 1) => {
      if (!img) return;
      const scale = Math.min(boxW / img.width, boxH / img.height);
      const w = img.width * scale, h = img.height * scale;
      pg.drawImage(img, { x: x + (boxW - w) / 2, y: yy + (boxH - h) / 2, width: w, height: h, opacity });
    };
    const drawWatermark = (pg) => {
      if (!logo) return;
      const box = 310;
      drawLogoFit(pg, logo, A4[0] - box + 48, 24, box, box, 0.035);
    };
    const txt = (t, x, yy, size = 9, font = normal, color = ink) => pg().drawText(clean(t), { x, y: yy, size, font, color });
    const pg = () => page;

    const newPage = (continuacao = false) => {
      page = pdf.addPage(A4);
      pageNo += 1;
      drawWatermark(page);
      if (continuacao) {
        page.drawRectangle({ x: 0, y: A4[1] - 62, width: A4[0], height: 62, color: navy });
        txt(`${companyName} · ${quote.number}`, margin, A4[1] - 38, 10, bold, white);
        txt('ORÇAMENTO · CONTINUAÇÃO', A4[0] - margin - 170, A4[1] - 38, 9, bold, rgb(0.70, 0.95, 0.90));
        y = A4[1] - 88;
      } else y = A4[1] - 40;
    };
    const ensure = (height) => { if (y - height < 72) newPage(true); };
    const wrappedAt = (t, x, maxW, size = 9, font = normal, color = ink, lineH = 12) => {
      const lines = wrapText(t, font, size, maxW);
      ensure(lines.length * lineH + 2);
      for (const l of lines) { txt(l, x, y, size, font, color); y -= lineH; }
      return lines.length;
    };

    newPage(false);

    // Cabeçalho premium inspirado em fatura/proposta comercial.
    const headerH = 126;
    page.drawRectangle({ x: 0, y: A4[1] - headerH, width: A4[0], height: headerH, color: navy });
    if (logo) {
      page.drawRectangle({ x: margin, y: A4[1] - 101, width: 132, height: 70, color: white });
      drawLogoFit(page, logo, margin + 8, A4[1] - 94, 116, 56, 1);
    } else {
      txt(companyName, margin, A4[1] - 64, 20, bold, white);
    }
    if (logo) {
      const companyLines = wrapText(companyName, bold, 13, 180).slice(0, 2);
      let cy = A4[1] - 52;
      for (const l of companyLines) { txt(l, margin + 148, cy, 13, bold, white); cy -= 16; }
      if (company.owner_name) txt(company.owner_name, margin + 148, cy - 2, 8.5, normal, rgb(0.72, 0.78, 0.84));
    }
    txt('ORÇAMENTO', A4[0] - margin - 154, A4[1] - 58, 24, bold, white);
    txt(quote.number, A4[0] - margin - 154, A4[1] - 78, 10.5, bold, rgb(0.40, 0.95, 0.85));
    txt(`Emissão ${dateBR(quote.issue_date)}`, A4[0] - margin - 154, A4[1] - 96, 8.5, normal, rgb(0.78, 0.82, 0.86));
    if (quote.valid_until) txt(`Validade ${dateBR(quote.valid_until)}`, A4[0] - margin - 154, A4[1] - 110, 8.5, normal, rgb(0.78, 0.82, 0.86));
    y = A4[1] - headerH - 28;

    // Cliente e local em duas colunas.
    txt('CLIENTE', margin, y, 8, bold, teal);
    txt('LOCAL / REFERÊNCIA', margin + 300, y, 8, bold, teal);
    y -= 18;
    const clientY = y;
    const clientNameLines = wrapText(nomeCliente, bold, 14, 250).slice(0, 2);
    let cy = y;
    for (const l of clientNameLines) { txt(l, margin, cy, 14, bold, ink); cy -= 17; }
    const clientMeta = [client.tax_id && `Documento: ${client.tax_id}`, client.contact_name && `Contato: ${client.contact_name}`, client.phone && `Tel.: ${client.phone}`, client.whatsapp && `WhatsApp: ${client.whatsapp}`].filter(Boolean);
    for (const m of clientMeta) { txt(m, margin, cy, 8.5, normal, muted); cy -= 12; }
    const local = [quote.service_place, quote.address || client.address].filter(Boolean).join(' · ') || 'Não informado';
    let ly = clientY;
    for (const l of wrapText(local, normal, 9, 255).slice(0, 5)) { txt(l, margin + 300, ly, 9, normal, ink); ly -= 13; }
    y = Math.min(cy, ly) - 14;
    page.drawLine({ start: { x: margin, y }, end: { x: A4[0] - margin, y }, thickness: 0.7, color: line });
    y -= 22;

    // Tabela.
    const col = { desc: margin, qty: margin + 304, unit: margin + 366, total: margin + 448 };
    page.drawRectangle({ x: margin, y: y - 22, width: contentW, height: 26, color: navy });
    txt('DESCRIÇÃO', col.desc + 7, y - 14, 8.5, bold, white);
    txt('QTD', col.qty, y - 14, 8.5, bold, white);
    txt('PREÇO UNI.', col.unit, y - 14, 8.5, bold, white);
    txt('TOTAL', col.total, y - 14, 8.5, bold, white);
    y -= 34;

    let subtotal = 0;
    for (const item of items || []) {
      const qty = Number(item.quantity || 0), unit = Number(item.unit_price || 0), total = qty * unit;
      subtotal += total;
      const desc = wrapText(item.name || 'Item', normal, 9.2, 286);
      const notes = item.notes ? wrapText(item.notes, normal, 7.5, 286) : [];
      const rowH = Math.max(34, desc.length * 12 + notes.length * 9 + 10);
      ensure(rowH + 6);
      let yy = y;
      for (const l of desc) { txt(l, col.desc + 7, yy, 9.2, normal, ink); yy -= 12; }
      for (const l of notes) { txt(l, col.desc + 7, yy, 7.5, normal, muted); yy -= 9; }
      const qtdTxt = `${qty.toLocaleString('pt-BR')} ${clean(item.unit || '')}`;
      txt(qtdTxt, col.qty, y, 8.5, normal, muted);
      txt(money(unit), col.unit, y, 8.5, normal, ink);
      txt(money(total), col.total, y, 8.5, bold, ink);
      y -= rowH;
      page.drawLine({ start: { x: margin, y: y + 5 }, end: { x: A4[0] - margin, y: y + 5 }, thickness: 0.5, color: line });
    }

    y -= 8;
    ensure(120);
    const discount = Number(quote.discount || 0), surcharge = Number(quote.surcharge || 0);
    const grand = Math.max(0, subtotal - discount + surcharge);
    const totalX = A4[0] - margin - 230;
    if (discount > 0 || surcharge > 0) {
      txt('Subtotal', totalX, y, 8.5, normal, muted); txt(money(subtotal), A4[0] - margin - 90, y, 8.5, normal, ink); y -= 14;
      if (discount > 0) { txt('Desconto', totalX, y, 8.5, normal, muted); txt(`- ${money(discount)}`, A4[0] - margin - 90, y, 8.5, normal, ink); y -= 14; }
      if (surcharge > 0) { txt('Acréscimo', totalX, y, 8.5, normal, muted); txt(`+ ${money(surcharge)}`, A4[0] - margin - 90, y, 8.5, normal, ink); y -= 18; }
    }
    page.drawRectangle({ x: totalX - 10, y: y - 17, width: A4[0] - margin - totalX + 10, height: 38, color: navy });
    txt('TOTAL', totalX + 3, y - 2, 11, bold, white);
    txt(money(grand), A4[0] - margin - 118, y - 4, 15, bold, white);
    y -= 52;

    // Condições, observações e assinatura.
    const leftW = 300;
    let leftY = y;
    txt('CONDIÇÕES DE PAGAMENTO', margin, leftY, 9.5, bold, ink); leftY -= 15;
    const payment = quote.payment_terms || 'A combinar com o cliente.';
    for (const l of wrapText(payment, normal, 8.5, leftW)) { txt(l, margin, leftY, 8.5, normal, muted); leftY -= 12; }
    if (quote.notes) {
      leftY -= 8; txt('OBSERVAÇÕES', margin, leftY, 9.5, bold, ink); leftY -= 15;
      for (const l of wrapText(quote.notes, normal, 8.5, leftW)) { txt(l, margin, leftY, 8.5, normal, muted); leftY -= 12; }
    }
    y = Math.min(y, leftY) - 24;
    ensure(95);
    const sigW = 190;
    page.drawLine({ start: { x: margin + 8, y }, end: { x: margin + 8 + sigW, y }, thickness: 0.8, color: ink });
    page.drawLine({ start: { x: A4[0] - margin - sigW - 8, y }, end: { x: A4[0] - margin - 8, y }, thickness: 0.8, color: ink });
    txt(company.owner_name || 'Responsável', margin + 8, y - 14, 8.5, bold, muted);
    txt(nomeCliente, A4[0] - margin - sigW - 8, y - 14, 8.5, bold, muted);

    // Rodapé escuro semelhante à referência visual.
    for (const pgx of pdf.getPages()) {
      pgx.drawRectangle({ x: 0, y: 0, width: A4[0], height: 34, color: navy });
      const info = [company.tax_id, company.phone, company.whatsapp, company.email].filter(Boolean).join(' · ');
      pgx.drawText(clean(info).slice(0, 95), { x: margin, y: 13, size: 6.8, font: normal, color: rgb(0.78, 0.82, 0.86) });
      pgx.drawText(`ZiisTec · ${pageNo > 1 ? 'proposta comercial' : 'documento comercial'}`, { x: A4[0] - margin - 120, y: 13, size: 6.8, font: normal, color: rgb(0.50, 0.58, 0.64) });
    }

    const bytes = await pdf.save();
    const filename = `${safeFile(quote.number)} - ${safeFile(nomeCliente)}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(bytes.length));
    return res.status(200).send(Buffer.from(bytes));
  } catch (error) {
    console.error('quote-pdf', error instanceof Error ? error.message : 'unknown');
    const status = error?.status === 401 ? 401 : error?.status === 403 ? 403 : 500;
    return res.status(status).json({ error: status === 500 ? 'Não foi possível gerar o PDF.' : 'Sem permissão para gerar o PDF.' });
  }
}
