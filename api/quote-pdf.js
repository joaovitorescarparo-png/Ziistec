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

function fitText(text, font, size, maxWidth) {
  const original = clean(text);
  if (font.widthOfTextAtSize(original, size) <= maxWidth) return original;
  let value = original;
  while (value.length > 3 && font.widthOfTextAtSize(`${value}...`, size) > maxWidth) value = value.slice(0, -1);
  return `${value.trim()}...`;
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
    const FOOTER_H = 34;
    const SAFE_BOTTOM = 72;
    const navy = rgb(0.035, 0.075, 0.13);
    const teal = rgb(0.04, 0.52, 0.46);
    const ink = rgb(0.10, 0.13, 0.17);
    const muted = rgb(0.38, 0.42, 0.47);
    const line = rgb(0.84, 0.86, 0.88);
    const soft = rgb(0.965, 0.972, 0.976);
    const white = rgb(1, 1, 1);

    let page;
    let y;
    const pg = () => page;
    const txt = (t, x, yy, size = 9, font = normal, color = ink) => pg().drawText(clean(t), { x, y: yy, size, font, color });
    const txtRight = (t, right, yy, size = 9, font = normal, color = ink) => {
      const value = clean(t);
      const width = font.widthOfTextAtSize(value, size);
      pg().drawText(value, { x: Math.max(margin, right - width), y: yy, size, font, color });
    };
    const drawLogoFit = (targetPage, img, x, yy, boxW, boxH, opacity = 1) => {
      if (!img) return;
      const scale = Math.min(boxW / img.width, boxH / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      targetPage.drawImage(img, { x: x + (boxW - w) / 2, y: yy + (boxH - h) / 2, width: w, height: h, opacity });
    };

    const newPage = (continuacao = false) => {
      page = pdf.addPage(A4);
      if (continuacao) {
        page.drawRectangle({ x: 0, y: A4[1] - 62, width: A4[0], height: 62, color: navy });
        txt(`${companyName} · ${quote.number}`, margin, A4[1] - 38, 10, bold, white);
        txtRight('ORÇAMENTO · CONTINUAÇÃO', A4[0] - margin, A4[1] - 38, 9, bold, rgb(0.70, 0.95, 0.90));
        y = A4[1] - 88;
      } else {
        y = A4[1] - 40;
      }
    };
    const ensure = (height) => {
      if (y - height < SAFE_BOTTOM) newPage(true);
    };

    newPage(false);

    // Cabeçalho premium com logo direta, sem caixa branca rígida.
    const headerH = 126;
    page.drawRectangle({ x: 0, y: A4[1] - headerH, width: A4[0], height: headerH, color: navy });
    page.drawRectangle({ x: 0, y: A4[1] - headerH, width: A4[0], height: 4, color: teal });
    const companyTextX = logo ? margin + 116 : margin;
    if (logo) drawLogoFit(page, logo, margin, A4[1] - 94, 102, 54, 0.98);
    const companyLines = wrapText(companyName, bold, logo ? 12.5 : 18, logo ? 195 : 290).slice(0, 2);
    let companyY = A4[1] - 54;
    for (const l of companyLines) { txt(l, companyTextX, companyY, logo ? 12.5 : 18, bold, white); companyY -= logo ? 15 : 20; }
    if (company.owner_name) txt(fitText(company.owner_name, normal, 8.2, 195), companyTextX, companyY - 1, 8.2, normal, rgb(0.72, 0.78, 0.84));
    txtRight('ORÇAMENTO', A4[0] - margin, A4[1] - 58, 24, bold, white);
    txtRight(quote.number, A4[0] - margin, A4[1] - 78, 10.5, bold, rgb(0.40, 0.95, 0.85));
    txtRight(`Emissão ${dateBR(quote.issue_date)}`, A4[0] - margin, A4[1] - 96, 8.5, normal, rgb(0.78, 0.82, 0.86));
    if (quote.valid_until) txtRight(`Validade ${dateBR(quote.valid_until)}`, A4[0] - margin, A4[1] - 110, 8.5, normal, rgb(0.78, 0.82, 0.86));
    y = A4[1] - headerH - 24;

    // Bloco do cliente e local com altura realmente calculada.
    const clientLines = wrapText(nomeCliente, bold, 13.5, 238).slice(0, 2);
    const clientMeta = [
      client.tax_id && `Documento: ${client.tax_id}`,
      client.contact_name && `Contato: ${client.contact_name}`,
      client.phone && `Tel.: ${client.phone}`,
      client.whatsapp && `WhatsApp: ${client.whatsapp}`,
    ].filter(Boolean);
    const local = [quote.service_place, quote.address || client.address].filter(Boolean).join(' · ') || 'Não informado';
    const localLines = wrapText(local, normal, 8.8, 235).slice(0, 5);
    const leftContentH = 34 + clientLines.length * 16 + clientMeta.length * 11 + 10;
    const rightContentH = 34 + Math.max(1, localLines.length) * 12 + 10;
    const clientBlockH = Math.max(78, leftContentH, rightContentH);
    page.drawRectangle({ x: margin, y: y - clientBlockH, width: contentW, height: clientBlockH, color: soft, borderColor: line, borderWidth: 0.6 });
    txt('CLIENTE', margin + 12, y - 18, 8, bold, teal);
    txt('LOCAL / REFERÊNCIA', margin + 292, y - 18, 8, bold, teal);
    let clientY = y - 38;
    for (const l of clientLines) { txt(l, margin + 12, clientY, 13.5, bold, ink); clientY -= 16; }
    for (const m of clientMeta) { txt(m, margin + 12, clientY, 8.2, normal, muted); clientY -= 11; }
    let localY = y - 38;
    for (const l of localLines) { txt(l, margin + 292, localY, 8.8, normal, ink); localY -= 12; }
    page.drawLine({ start: { x: margin + 278, y: y - 12 }, end: { x: margin + 278, y: y - clientBlockH + 12 }, thickness: 0.5, color: line });
    y -= clientBlockH + 18;

    // Tabela com grade visual consistente e números alinhados pela direita.
    const tableRight = A4[0] - margin;
    const col = { desc: margin + 8, qtyRight: margin + 350, unitRight: margin + 438, totalRight: tableRight - 8 };
    const drawTableHeader = () => {
      page.drawRectangle({ x: margin, y: y - 23, width: contentW, height: 28, color: navy });
      txt('DESCRIÇÃO', col.desc, y - 14, 8.5, bold, white);
      txtRight('QTD', col.qtyRight, y - 14, 8.5, bold, white);
      txtRight('PREÇO UNI.', col.unitRight, y - 14, 8.5, bold, white);
      txtRight('TOTAL', col.totalRight, y - 14, 8.5, bold, white);
      y -= 38;
    };
    drawTableHeader();

    let subtotal = 0;
    let rowIndex = 0;
    for (const item of items || []) {
      const qty = Number(item.quantity || 0);
      const unit = Number(item.unit_price || 0);
      const total = qty * unit;
      subtotal += total;
      const desc = wrapText(item.name || 'Item', normal, 9.2, 270);
      const notes = item.notes ? wrapText(item.notes, normal, 7.5, 270) : [];
      const rowH = Math.max(40, desc.length * 12 + notes.length * 9 + 15);
      if (y - rowH < SAFE_BOTTOM + 205) {
        newPage(true);
        drawTableHeader();
      }
      if (rowIndex % 2 === 1) page.drawRectangle({ x: margin, y: y - rowH + 8, width: contentW, height: rowH + 2, color: soft });
      let rowY = y;
      for (const l of desc) { txt(l, col.desc, rowY, 9.2, normal, ink); rowY -= 12; }
      for (const l of notes) { txt(l, col.desc, rowY, 7.5, normal, muted); rowY -= 9; }
      const qtdTxt = (qty.toLocaleString('pt-BR') + ' ' + clean(item.unit || '')).trim();
      txtRight(qtdTxt, col.qtyRight, y, 8.5, normal, muted);
      txtRight(money(unit), col.unitRight, y, 8.5, normal, ink);
      txtRight(money(total), col.totalRight, y, 8.5, bold, ink);
      y -= rowH;
      page.drawLine({ start: { x: margin, y: y + 7 }, end: { x: tableRight, y: y + 7 }, thickness: 0.45, color: line });
      rowIndex += 1;
    }

    // Grade vazia estruturada; a marca-d'água só ocupa essa área sem texto.
    const minVisibleRows = 6;
    const fillerTop = y;
    let fillerRows = Math.max(0, minVisibleRows - (items || []).length);
    while (fillerRows > 0 && y - 32 > 300) {
      if (rowIndex % 2 === 1) page.drawRectangle({ x: margin, y: y - 25, width: contentW, height: 32, color: soft });
      y -= 32;
      page.drawLine({ start: { x: margin, y: y + 7 }, end: { x: tableRight, y: y + 7 }, thickness: 0.45, color: line });
      rowIndex += 1;
      fillerRows -= 1;
    }
    const fillerBottom = y;
    const watermarkBandH = fillerTop - fillerBottom;
    if (logo && watermarkBandH >= 64) {
      const wmW = 130;
      const wmH = Math.min(78, watermarkBandH - 10);
      const wmY = fillerBottom + (watermarkBandH - wmH) / 2 + 3;
      drawLogoFit(page, logo, tableRight - wmW - 14, wmY, wmW, wmH, 0.055);
    }

    // Calcula o bloco inferior antes de desenhar: total, informações e assinaturas ficam juntos.
    const payment = quote.payment_terms || 'A combinar com o cliente.';
    const paymentLines = wrapText(payment, normal, 8.4, 285);
    const noteLines = quote.notes ? wrapText(quote.notes, normal, 8.3, contentW - 24) : [];
    const leftInfoH = 35 + Math.max(1, paymentLines.length) * 11;
    const rightInfoH = 72;
    const notesH = noteLines.length ? 26 + noteLines.length * 11 : 0;
    const infoCardH = Math.max(leftInfoH, rightInfoH) + notesH + 20;
    const lowerBlockH = 50 + infoCardH + 28 + 66;
    y -= 6;
    if (y - lowerBlockH < SAFE_BOTTOM) newPage(true);

    const discount = Number(quote.discount || 0);
    const surcharge = Number(quote.surcharge || 0);
    const grand = Math.max(0, subtotal - discount + surcharge);
    const totalX = A4[0] - margin - 230;
    if (discount > 0 || surcharge > 0) {
      txt('Subtotal', totalX, y, 8.5, normal, muted); txtRight(money(subtotal), A4[0] - margin, y, 8.5, normal, ink); y -= 14;
      if (discount > 0) { txt('Desconto', totalX, y, 8.5, normal, muted); txtRight(`- ${money(discount)}`, A4[0] - margin, y, 8.5, normal, ink); y -= 14; }
      if (surcharge > 0) { txt('Acréscimo', totalX, y, 8.5, normal, muted); txtRight(`+ ${money(surcharge)}`, A4[0] - margin, y, 8.5, normal, ink); y -= 18; }
    }
    page.drawRectangle({ x: totalX - 10, y: y - 17, width: A4[0] - margin - totalX + 10, height: 38, color: navy });
    txt('TOTAL', totalX + 3, y - 2, 11, bold, white);
    txtRight(money(grand), A4[0] - margin - 14, y - 4, 15, bold, white);
    y -= 50;

    // Card inferior com altura dinâmica e sem cruzar a área de assinatura.
    const cardTop = y;
    const cardBottom = cardTop - infoCardH;
    page.drawRectangle({ x: margin, y: cardBottom, width: contentW, height: infoCardH, color: soft, borderColor: line, borderWidth: 0.6 });
    txt('CONDIÇÕES DE PAGAMENTO', margin + 12, cardTop - 18, 9, bold, ink);
    let paymentY = cardTop - 36;
    for (const l of paymentLines) { txt(l, margin + 12, paymentY, 8.4, normal, muted); paymentY -= 11; }

    const infoX = margin + 330;
    txt('DADOS DO ORÇAMENTO', infoX, cardTop - 18, 9, bold, ink);
    txt('Número', infoX, cardTop - 38, 7.5, normal, muted);
    txtRight(quote.number, A4[0] - margin - 12, cardTop - 38, 8.2, bold, ink);
    txt('Emissão', infoX, cardTop - 52, 7.5, normal, muted);
    txtRight(dateBR(quote.issue_date), A4[0] - margin - 12, cardTop - 52, 8.2, normal, ink);
    txt('Validade', infoX, cardTop - 66, 7.5, normal, muted);
    txtRight(quote.valid_until ? dateBR(quote.valid_until) : 'A combinar', A4[0] - margin - 12, cardTop - 66, 8.2, normal, ink);
    page.drawLine({ start: { x: margin + 314, y: cardTop - 12 }, end: { x: margin + 314, y: cardTop - Math.max(leftInfoH, rightInfoH) - 4 }, thickness: 0.5, color: line });

    if (noteLines.length) {
      const dividerY = cardTop - Math.max(leftInfoH, rightInfoH) - 2;
      page.drawLine({ start: { x: margin + 12, y: dividerY }, end: { x: A4[0] - margin - 12, y: dividerY }, thickness: 0.5, color: line });
      txt('OBSERVAÇÕES', margin + 12, dividerY - 18, 8.5, bold, ink);
      let noteY = dividerY - 34;
      for (const l of noteLines) { txt(l, margin + 12, noteY, 8.3, normal, muted); noteY -= 11; }
    }
    y = cardBottom - 28;

    // Assinaturas com rótulo e nome em área própria; nunca invadem rodapé ou card.
    const signatureH = 66;
    if (y - signatureH < SAFE_BOTTOM) newPage(true);
    const sigW = 190;
    const sigY = y - 8;
    page.drawLine({ start: { x: margin + 8, y: sigY }, end: { x: margin + 8 + sigW, y: sigY }, thickness: 0.8, color: ink });
    page.drawLine({ start: { x: A4[0] - margin - sigW - 8, y: sigY }, end: { x: A4[0] - margin - 8, y: sigY }, thickness: 0.8, color: ink });
    txt('Responsável', margin + 8, sigY - 14, 7.2, normal, muted);
    txt('Cliente', A4[0] - margin - sigW - 8, sigY - 14, 7.2, normal, muted);
    const ownerSigLines = wrapText(company.owner_name || companyName, bold, 8.1, sigW).slice(0, 2);
    const clientSigLines = wrapText(nomeCliente, bold, 8.1, sigW).slice(0, 2);
    let ownerSigY = sigY - 28;
    for (const l of ownerSigLines) { txt(l, margin + 8, ownerSigY, 8.1, bold, ink); ownerSigY -= 10; }
    let clientSigY = sigY - 28;
    for (const l of clientSigLines) { txt(l, A4[0] - margin - sigW - 8, clientSigY, 8.1, bold, ink); clientSigY -= 10; }

    // Rodapé é desenhado por último e mantém largura reservada para paginação.
    const pages = pdf.getPages();
    pages.forEach((targetPage, index) => {
      targetPage.drawRectangle({ x: 0, y: 0, width: A4[0], height: FOOTER_H, color: navy });
      const footerRight = `ZiisTec · ${index + 1}/${pages.length}`;
      const footerWidth = normal.widthOfTextAtSize(footerRight, 6.8);
      const infoMaxW = contentW - footerWidth - 24;
      const info = fitText([company.tax_id, company.phone, company.whatsapp, company.email].filter(Boolean).join(' · '), normal, 6.8, infoMaxW);
      targetPage.drawText(info, { x: margin, y: 13, size: 6.8, font: normal, color: rgb(0.78, 0.82, 0.86) });
      targetPage.drawText(footerRight, { x: A4[0] - margin - footerWidth, y: 13, size: 6.8, font: normal, color: rgb(0.50, 0.58, 0.64) });
    });

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
