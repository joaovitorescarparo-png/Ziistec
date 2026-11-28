/*
  PDF do orçamento fora da Vercel — o mesmo documento de `api/quote-pdf.js`.

  Por que existe. O site estático da Hostinger (`ziistec.com`) não tem as Vercel
  Functions. Esta é a mesma rota, portada para rodar como Supabase Edge Function
  (`quote-pdf`), no mesmo projeto de Production. O código é JavaScript puro, sem
  API do Deno nem do Node: o `pdf-lib`, o endereço do Supabase e o `fetch` chegam
  por injeção. Assim o mesmo arquivo roda no Deno (index.ts) e nos testes em Node,
  e o teste compara byte a byte o PDF daqui com o da Vercel.

  Regras (idênticas às da Vercel; nada novo foi inventado):
  - sessão obrigatória: Bearer do usuário, conferido no Auth (`/auth/v1/user`),
    além do `verify_jwt` do gateway; sessão inválida → 401 (a Vercel devolvia 403);
  - toda leitura usa o token do PRÓPRIO usuário: a RLS do banco decide o que ele
    vê. Nenhuma service role: a função não tem segredo nenhum;
  - só o proprietário gera: `zt_is_owner(empresa)` no banco; técnico recebe 403;
  - `companyId` do pedido nunca é confiado: o banco confirma que o usuário é
    proprietário dessa empresa, e o orçamento só é lido se for DESSA empresa
    (outra empresa → 404, sem revelar nada);
  - cota/rate limit no banco (`zt_consume_quote_pdf_quota`: assinatura ativa,
    30 por minuto e 300 por dia). É a única escrita: um evento de uso, como na Vercel;
  - itens sem custo (`unit_cost` nunca é lido): o documento do cliente não leva
    custo nem margem;
  - erro sempre em JSON com frase fixa; detalhe técnico só no log, cortado;
  - CORS só para as origens exatas de Production, nunca `*`.

  Os trechos de texto e desenho abaixo são cópia literal de `api/quote-pdf.js`
  (o teste confere). Alterou lá, altere aqui.
*/
import { quotaUserMessage } from './apiErrors.js';
import { shouldBreakPdfBlock, canKeepClosingTogether } from './quotePdfLayout.js';
import { encaixarNaCaixa } from './pdfLogoBox.js';

/* Production, por igualdade exata: os hosts da Vercel e os da Hostinger
   (PROD_SUPABASE_HOSTS em src/lib/supabaseConfig.js; o teste compara). */
export const ORIGENS_PERMITIDAS = Object.freeze([
  'https://ziistec.vercel.app',
  'https://ziistec-js-connect.vercel.app',
  'https://ziistec-git-main-js-connect.vercel.app',
  'https://ziistec.com',
  'https://www.ziistec.com',
]);
const ORIGENS = new Set(ORIGENS_PERMITIDAS);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 8 * 1024;

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

// Tipo real da imagem pelos primeiros bytes (o content-type do Storage pode mentir).
const assinaturaImagem = (bytes) => {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return 'png';
  if (bytes.length > 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return 'jpg';
  if (bytes.length > 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'webp';
  return '';
};
// Quantidade sem rótulo genérico ("1 un", "1 serviço"): só o número; unidade de medida aparece ("2,5 m").
const UNIDADES_SEM_ROTULO = new Set(['', 'un', 'un.', 'und', 'und.', 'unid', 'unid.', 'uni', 'unidade', 'unidades', 'serviço', 'servico', 'serviços', 'servicos', 'serv', 'serv.', 'sv']);
const quantidadeTexto = (qty, unidade) => {
  const numero = Number(qty || 0).toLocaleString('pt-BR');
  const rotulo = clean(unidade || '').trim();
  return UNIDADES_SEM_ROTULO.has(rotulo.toLowerCase()) ? numero : `${numero} ${rotulo}`;
};


const limparLog = (valor) => String(valor ?? '').replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [removido]').replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[jwt removido]').slice(0, 200);

/* Chave de baixa permissão para o cabeçalho `apikey`: a publishable key moderna que o Supabase injeta
   em SUPABASE_PUBLISHABLE_KEYS (JSON por nome; usamos "default"). Só aceita `sb_publishable_`:
   anon JWT legada, secret key ou valor estranho viram '' e a função responde 503 (falha fechada).
   O `Authorization` de cada chamada continua sendo o JWT do usuário, para a RLS valer no contexto dele. */
export function chavePublicavel(bruto) {
  try {
    const valor = JSON.parse(String(bruto ?? '') || '{}')?.default;
    return typeof valor === 'string' && /^sb_publishable_[A-Za-z0-9_-]+$/.test(valor) ? valor : '';
  } catch {
    return '';
  }
}

export function criarHandlerPdfOrcamento({
  pdfLib,
  supabaseUrl = '',
  apiKey = '',
  fetchImpl = (...args) => fetch(...args),
  registrarErro = (mensagem) => console.error('quote-pdf', mensagem),
} = {}) {
  const { PDFDocument, StandardFonts, rgb } = pdfLib || {};
  const SUPABASE_URL = String(supabaseUrl || '').trim().replace(/\/+$/, '');
  const SUPABASE_PUBLISHABLE_KEY = String(apiKey || '').trim();
  const configurado = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY && PDFDocument);

  const cabecalhos = (origin) => ({
    'Cache-Control': 'private, no-store, max-age=0',
    'X-Content-Type-Options': 'nosniff',
    'Vary': 'Origin',
    ...(ORIGENS.has(origin) ? { 'Access-Control-Allow-Origin': origin } : {}),
  });
  const json = (status, body, origin = '') => new Response(JSON.stringify(body), {
    status,
    headers: { ...cabecalhos(origin), 'Content-Type': 'application/json; charset=utf-8' },
  });

  async function sbFetch(path, auth, init = {}) {
    const headers = { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: auth, ...(init.headers || {}) };
    const r = await fetchImpl(`${SUPABASE_URL}${path}`, { ...init, headers, signal: init.signal || AbortSignal.timeout(8000) });
    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      const e = new Error(detail || `Supabase ${r.status}`);
      e.status = r.status;
      throw e;
    }
    return r;
  }
  const sbJson = async (path, auth) => (await sbFetch(path, auth)).json();

  async function carregarImagemProduto(path,auth,pdf){
    if(!path)return {image:null,note:''};
    const encoded=String(path).split('/').map(encodeURIComponent).join('/');
    for(const bucket of ['zt-product-images','zt-branding']){
      try{
        const r=await sbFetch(`/storage/v1/object/authenticated/${bucket}/${encoded}`,auth);
        const bytes=new Uint8Array(await r.arrayBuffer());
        if(bytes.byteLength>2*1024*1024)continue;
        const ct=String(r.headers.get('content-type')||'').toLowerCase();
        const tipo=assinaturaImagem(bytes);
        if(tipo==='png') return {image:await pdf.embedPng(bytes),note:''};
        if(tipo==='jpg') return {image:await pdf.embedJpg(bytes),note:''};
        if(tipo==='webp'||ct.includes('webp')) return {image:null,note:'Imagem do produto em WEBP não pode ser incorporada diretamente; use JPG ou PNG para exibi-la no PDF.'};
      }catch{}
    }
    return {image:null,note:''};
  }

  // Logo da empresa: só PNG/JPG de verdade e até 1,5 MB. Qualquer outra coisa (WEBP, arquivo
  // corrompido, dimensão inválida, foto enorme) vira "sem logo": o cabeçalho mostra só o nome.
  async function carregarLogo(company, auth, pdf) {
    if (!company?.logo_path) return null;
    try {
      const encoded = String(company.logo_path).split('/').map(encodeURIComponent).join('/');
      const r = await sbFetch(`/storage/v1/object/authenticated/zt-branding/${encoded}`, auth);
      const bytes = new Uint8Array(await r.arrayBuffer());
      if (bytes.byteLength > 1.5 * 1024 * 1024) return null;
      const tipo = assinaturaImagem(bytes);
      const imagem = tipo === 'png' ? await pdf.embedPng(bytes) : tipo === 'jpg' ? await pdf.embedJpg(bytes) : null;
      if (!imagem || !(imagem.width > 0) || !(imagem.height > 0)) return null;
      return imagem;
    } catch {}
    return null;
  }

  return async function handler(req) {
    const origin = req.headers.get('origin') || '';
    if (req.method === 'OPTIONS') {
      if (!ORIGENS.has(origin)) return json(403, { error: 'Origem não permitida.' });
      return new Response(null, {
        status: 204,
        headers: {
          ...cabecalhos(origin),
          'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Max-Age': '600',
        },
      });
    }
    // Navegador sempre manda Origin em POST entre origens: origem fora da lista é recusada.
    if (origin && !ORIGENS.has(origin)) return json(403, { error: 'Origem não permitida.' });
    if (req.method !== 'POST') return json(405, { error: 'Método não permitido.' }, origin);
    if (!String(req.headers.get('content-type') || '').toLowerCase().includes('application/json')) return json(415, { error: 'Conteúdo inválido.' }, origin);
    const declaredLength = Number(req.headers.get('content-length') || 0);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) return json(413, { error: 'Solicitação grande demais.' }, origin);
    let texto = '';
    try { texto = await req.text(); } catch { return json(400, { error: 'Solicitação inválida.' }, origin); }
    if (new TextEncoder().encode(texto).byteLength > MAX_BODY_BYTES) return json(413, { error: 'Solicitação grande demais.' }, origin);
    let body = null;
    try { body = JSON.parse(texto); } catch { body = null; }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json(400, { error: 'Solicitação inválida.' }, origin);
    const auth = req.headers.get('authorization') || '';
    if (!auth.startsWith('Bearer ')) return json(401, { error: 'Sessão necessária.' }, origin);
    if (!configurado) return json(503, { error: 'Serviço de PDF não configurado.' }, origin);
    if (typeof body.quoteId !== 'string' || typeof body.companyId !== 'string') return json(400, { error: 'Orçamento ou empresa inválidos.' }, origin);
    const quoteId = body.quoteId.trim();
    const companyId = body.companyId.trim();
    if (!UUID_RE.test(quoteId) || !UUID_RE.test(companyId)) return json(400, { error: 'Orçamento ou empresa inválidos.' }, origin);

    try {
      // Sessão conferida no Auth. Token inválido, expirado ou de sessão encerrada → 401 (o gateway com
      // verify_jwt também devolve 401). Única diferença deliberada da rota da Vercel, que aqui devolvia 403.
      const sessaoValida = await sbFetch('/auth/v1/user', auth).then(() => true, (e) => {
        if (e?.status === 401 || e?.status === 403) return false;
        throw e;
      });
      if (!sessaoValida) return json(401, { error: 'Sessão inválida ou expirada.' }, origin);
      const ownerResp = await sbFetch('/rest/v1/rpc/zt_is_owner', auth, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ target: companyId }),
      });
      if (await ownerResp.json() !== true) return json(403, { error: 'Somente o proprietário pode gerar este PDF.' }, origin);

      const quota = await fetchImpl(`${SUPABASE_URL}/rest/v1/rpc/zt_consume_quote_pdf_quota`, {
        method: 'POST',
        headers: { Authorization: auth, apikey: SUPABASE_PUBLISHABLE_KEY, 'content-type': 'application/json' },
        body: JSON.stringify({ p_company: companyId }),
        signal: AbortSignal.timeout(8000),
      }).catch(() => null);
      if (!quota?.ok) {
        const detail = quota ? await quota.json().catch(() => ({})) : {};
        const msg = quotaUserMessage(detail, 'Limite de geração de PDF atingido.');
        const status = quota?.status === 401 ? 401 : quota?.status === 403 ? 403 : quota ? 429 : 502;
        return json(status, { error: msg }, origin);
      }

      const [companies, quotes, items] = await Promise.all([
        sbJson(`/rest/v1/companies?id=eq.${companyId}&select=id,name,trade_name,tax_id,phone,whatsapp,email,address,logo_path,owner_name`, auth),
        sbJson(`/rest/v1/quotes?id=eq.${quoteId}&company_id=eq.${companyId}&deleted_at=is.null&select=*`, auth),
        // Sem unit_cost: o documento comercial do cliente nunca recebe custo ou margem.
        sbJson(`/rest/v1/quote_items?quote_id=eq.${quoteId}&company_id=eq.${companyId}&select=id,kind,service_id,product_id,name,unit,quantity,unit_price,notes,position&order=position.asc`, auth),
      ]);
      const company = companies?.[0];
      const quote = quotes?.[0];
      if (!company || !quote) return json(404, { error: 'Orçamento não encontrado.' }, origin);
      const clients = quote.client_id
        ? await sbJson(`/rest/v1/clients?id=eq.${quote.client_id}&company_id=eq.${companyId}&select=id,name,trade_name,tax_id,contact_name,phone,whatsapp,address`, auth)
        : [];
      const client = clients?.[0] || {};
      const productIds=[...new Set((items||[]).map(i=>i.product_id).filter(Boolean))];
      const serviceIds=[...new Set((items||[]).map(i=>i.service_id).filter(Boolean))];
      const productRows=productIds.length ? await sbJson(`/rest/v1/products?id=in.(${productIds.join(',')})&company_id=eq.${companyId}&select=id,image_path,warranty_months`,auth) : [];
      const serviceRows=serviceIds.length ? await sbJson(`/rest/v1/services?id=in.(${serviceIds.join(',')})&company_id=eq.${companyId}&select=id,warranty_days`,auth) : [];
      const productById=new Map((productRows||[]).map(p=>[p.id,p]));
      const serviceById=new Map((serviceRows||[]).map(s=>[s.id,s]));
      const warrantyLines=(items||[]).flatMap(item=>{
        const product=item.product_id?productById.get(item.product_id):null;
        const service=item.service_id?serviceById.get(item.service_id):null;
        const meses=Number(product?.warranty_months||0);
        const dias=Number(service?.warranty_days||0);
        if(product&&meses>0)return [{titulo:item.name||'Item',detalhe:`${meses} ${meses===1?'mês':'meses'} de garantia do produto`}];
        if(service&&dias>0)return [{titulo:item.name||'Item',detalhe:`${dias} ${dias===1?'dia':'dias'} de garantia de serviço`}];
        return [];
      });
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
      const margin = 40;
      const contentW = A4[0] - margin * 2;
      const right = A4[0] - margin;
      const SAFE_BOTTOM = 72;
      // Fundo branco, azul-marinho no texto e no destaque do total, turquesa só como detalhe.
      const navy = rgb(0.059, 0.102, 0.176);
      const ink = rgb(0.13, 0.16, 0.21);
      const muted = rgb(0.40, 0.44, 0.50);
      const teal = rgb(0.03, 0.51, 0.45);
      const line = rgb(0.86, 0.88, 0.91);
      const soft = rgb(0.962, 0.969, 0.976);
      const white = rgb(1, 1, 1);
      // A logo aparece SÓ no cabeçalho, contida nesta caixa: proporção preservada, nunca esticada,
      // nunca no tamanho natural e nunca como fundo/marca-d'água.
      const LOGO_CAIXA = { width: 112, height: 52 };
      const MINIATURA = { width: 34, height: 34 };

      let page;
      let y;
      const pg = () => page;
      const txt = (t, x, yy, size = 9, font = normal, color = ink) => pg().drawText(clean(t), { x, y: yy, size, font, color });
      const txtRight = (t, rightX, yy, size = 9, font = normal, color = ink) => {
        const value = clean(t);
        pg().drawText(value, { x: Math.max(margin, rightX - font.widthOfTextAtSize(value, size)), y: yy, size, font, color });
      };
      const txtCenter = (t, centerX, yy, size = 9, font = normal, color = ink) => {
        const value = clean(t);
        pg().drawText(value, { x: centerX - font.widthOfTextAtSize(value, size) / 2, y: yy, size, font, color });
      };
      const rotulo = (t, x, yy) => txt(t, x, yy, 7.5, bold, teal);
      // Desenha a imagem inteira dentro da caixa (contain). Devolve o retângulo realmente ocupado.
      const desenharContida = (img, x, yBase, caixa, centralizarX = true) => {
        const encaixe = encaixarNaCaixa(img?.width, img?.height, caixa);
        if (!encaixe) return null;
        const area = { x: x + (centralizarX ? encaixe.offsetX : 0), y: yBase + encaixe.offsetY, width: encaixe.width, height: encaixe.height };
        pg().drawImage(img, area);
        return area;
      };

      const newPage = (continuacao = false) => {
        page = pdf.addPage(A4);
        if (continuacao) {
          // Páginas seguintes: cabeçalho simplificado, sem logo.
          txt(fitText(companyName, bold, 9.5, contentW - 220), margin, A4[1] - 50, 9.5, bold, navy);
          txtRight(`ORÇAMENTO ${quote.number} · CONTINUAÇÃO`, right, A4[1] - 50, 8, bold, muted);
          page.drawLine({ start: { x: margin, y: A4[1] - 58 }, end: { x: right, y: A4[1] - 58 }, thickness: 0.6, color: line });
          y = A4[1] - 74;
        } else {
          y = A4[1] - margin;
        }
      };
      const ensure = (height) => {
        if (y - height < SAFE_BOTTOM) newPage(true);
      };

      newPage(false);

      // Cabeçalho: logo + empresa à esquerda; ORÇAMENTO, número e datas à direita. Compacto e branco.
      const topo = A4[1] - margin;
      const blocoDireita = [
        ['ORÇAMENTO', 17, bold, navy, 17],
        [`Nº ${quote.number}`, 10, bold, teal, 13],
        [`Emissão ${dateBR(quote.issue_date)}`, 8.5, normal, muted, 12],
        ...(quote.valid_until ? [[`Validade ${dateBR(quote.valid_until)}`, 8.5, normal, muted, 12]] : []),
      ];
      const larguraDireita = Math.max(...blocoDireita.map(([t, size, font]) => font.widthOfTextAtSize(clean(t), size)));
      let yDireita = topo - 14;
      for (const [t, size, font, color, passo] of blocoDireita) { txtRight(t, right, yDireita, size, font, color); yDireita -= passo; }
      let xEmpresa = margin;
      const areaLogo = logo ? desenharContida(logo, margin, topo - LOGO_CAIXA.height, LOGO_CAIXA, false) : null;
      if (areaLogo) xEmpresa = areaLogo.x + areaLogo.width + 14;
      const larguraEmpresa = Math.max(90, right - larguraDireita - 28 - xEmpresa);
      const nomeEmpresa = wrapText(companyName, bold, 13, larguraEmpresa);
      const linhasEmpresa = nomeEmpresa.length > 2 ? [nomeEmpresa[0], fitText(nomeEmpresa.slice(1).join(' '), bold, 13, larguraEmpresa)] : nomeEmpresa;
      // Contato quebra entre os itens (documento · telefone · WhatsApp · e-mail), nunca no meio de um.
      const linhasContato = [];
      for (const parte of [company.tax_id, company.phone, company.whatsapp, company.email].filter(Boolean).map(clean)) {
        const atual = linhasContato[linhasContato.length - 1];
        if (atual && normal.widthOfTextAtSize(`${atual} · ${parte}`, 8) <= larguraEmpresa) linhasContato[linhasContato.length - 1] = `${atual} · ${parte}`;
        else linhasContato.push(fitText(parte, normal, 8, larguraEmpresa));
      }
      linhasContato.splice(2);
      const alturaTextoEmpresa = linhasEmpresa.length * 15 + linhasContato.length * 10.5;
      let yEmpresa = topo - (areaLogo ? Math.max(0, (LOGO_CAIXA.height - alturaTextoEmpresa) / 2) : 0) - 12;
      for (const l of linhasEmpresa) { txt(l, xEmpresa, yEmpresa, 13, bold, navy); yEmpresa -= 15; }
      yEmpresa -= 1;
      for (const l of linhasContato) { txt(l, xEmpresa, yEmpresa, 8, normal, muted); yEmpresa -= 10.5; }
      const baseCabecalho = Math.min(topo - (areaLogo ? LOGO_CAIXA.height : 0), yEmpresa + 4, yDireita + 6) - 10;
      page.drawLine({ start: { x: margin, y: baseCabecalho }, end: { x: right, y: baseCabecalho }, thickness: 0.8, color: line });
      page.drawLine({ start: { x: margin, y: baseCabecalho }, end: { x: margin + 56, y: baseCabecalho }, thickness: 2, color: teal });
      y = baseCabecalho - 20;

      // Cliente e local: só o que foi preenchido, num bloco claro sem bordas pesadas.
      const colunaLocal = margin + Math.round(contentW * 0.56);
      const larguraCliente = colunaLocal - margin - 34;
      const larguraLocal = right - colunaLocal - 14;
      const clientLines = wrapText(nomeCliente, bold, 11, larguraCliente).slice(0, 2);
      const clientMeta = [
        client.tax_id && `Documento: ${client.tax_id}`,
        client.contact_name && `Contato: ${client.contact_name}`,
        client.phone && `Telefone: ${client.phone}`,
        client.whatsapp && `WhatsApp: ${client.whatsapp}`,
      ].filter(Boolean).flatMap((m) => wrapText(m, normal, 8.5, larguraCliente).slice(0, 2));
      const localLines = [quote.service_place, quote.address || client.address].filter(Boolean)
        .flatMap((parte) => wrapText(parte, normal, 9, larguraLocal)).slice(0, 6);
      const alturaCliente = 20 + clientLines.length * 14 + clientMeta.length * 11.5;
      const alturaLocal = localLines.length ? 20 + localLines.length * 12 : 0;
      const clientBlockH = Math.max(alturaCliente, alturaLocal) + 16;
      page.drawRectangle({ x: margin, y: y - clientBlockH, width: contentW, height: clientBlockH, color: soft });
      rotulo('CLIENTE', margin + 14, y - 18);
      let clientY = y - 34;
      for (const l of clientLines) { txt(l, margin + 14, clientY, 11, bold, navy); clientY -= 14; }
      for (const m of clientMeta) { txt(m, margin + 14, clientY, 8.5, normal, muted); clientY -= 11.5; }
      if (localLines.length) {
        rotulo('LOCAL / REFERÊNCIA', colunaLocal, y - 18);
        let localY = y - 34;
        for (const l of localLines) { txt(l, colunaLocal, localY, 9, normal, ink); localY -= 12; }
      }
      y -= clientBlockH + 22;

      if(quote.customer_message){
        const proposalLines=wrapText(quote.customer_message,normal,9.5,contentW);
        let remaining=[...proposalLines];
        let continuation=false;
        ensure(18 + 13 * Math.min(3, remaining.length));
        while(remaining.length){
          const availableLines=Math.floor((y-SAFE_BOTTOM-18)/13);
          if(availableLines<Math.min(2,remaining.length)){newPage(true);continue;}
          const chunk=remaining.splice(0,Math.max(1,availableLines));
          rotulo(continuation?'SOBRE ESTA PROPOSTA · CONTINUAÇÃO':'SOBRE ESTA PROPOSTA',margin,y-4);
          let proposalY=y-20;for(const l of chunk){txt(l,margin,proposalY,9.5,normal,ink);proposalY-=13;}
          y=proposalY-9;
          if(remaining.length){newPage(true);continuation=true;}
        }
      }
      if(quote.execution_forecast_date){
        ensure(38);
        rotulo('PREVISÃO DE EXECUÇÃO',margin,y-4);
        txt(dateBR(quote.execution_forecast_date),margin,y-19,10,bold,ink);
        y-=38;
      }

      // Tabela com grade visual consistente e números alinhados pela direita: a descrição quebra em
      // várias linhas sem empurrar as colunas; quantidade centralizada; linha nunca cortada entre páginas.
      const col = { desc: margin + 10, qtyCenter: margin + 330, unitRight: margin + 430, totalRight: right - 10 };
      const larguraDescricao = col.qtyCenter - 40 - col.desc;
      const drawTableHeader = () => {
        page.drawRectangle({ x: margin, y: y - 22, width: contentW, height: 22, color: soft });
        page.drawLine({ start: { x: margin, y: y - 22 }, end: { x: right, y: y - 22 }, thickness: 0.8, color: navy });
        txt('DESCRIÇÃO', col.desc, y - 14.5, 7.5, bold, navy);
        txtCenter('QTD', col.qtyCenter, y - 14.5, 7.5, bold, navy);
        txtRight('PREÇO UNIT.', col.unitRight, y - 14.5, 7.5, bold, navy);
        txtRight('TOTAL', col.totalRight, y - 14.5, 7.5, bold, navy);
        y -= 22;
      };

      let subtotal = 0;
      const tableRows = [];
      for (const item of items || []) {
        const qty = Number(item.quantity || 0);
        const unit = Number(item.unit_price || 0);
        const total = qty * unit;
        subtotal += total;
        const productMeta=item.product_id?productById.get(item.product_id):null;
        const productImageResult=quote.show_product_images&&productMeta?.image_path ? await carregarImagemProduto(productMeta.image_path,auth,pdf) : {image:null,note:''};
        const productImage=productImageResult.image;
        const textW=productImage?larguraDescricao-MINIATURA.width-10:larguraDescricao;
        const desc = wrapText(item.name || 'Item', normal, 9.5, textW);
        const notes = [
          ...(item.notes ? wrapText(item.notes, normal, 7.5, textW) : []),
          ...(productImageResult.note ? wrapText(productImageResult.note, normal, 7.5, textW) : []),
        ];
        const rowH = Math.max(productImage ? MINIATURA.height + 14 : 30, desc.length * 12 + notes.length * 10 + 16);
        tableRows.push({ qty, unit, total, unidade: item.unit, productImage, desc, notes, rowH });
      }

      // Título, cabeçalho da tabela e a primeira linha sempre juntos: nada de título sozinho no fim da página.
      ensure(14 + 22 + (tableRows[0]?.rowH || 30));
      txt('PRODUTOS E SERVIÇOS',margin,y-4,9,bold,navy);
      y-=14;
      drawTableHeader();
      for (const row of tableRows) {
        const rowH = row.rowH;
        if (shouldBreakPdfBlock(y,rowH,SAFE_BOTTOM,12)) {
          newPage(true);
          drawTableHeader();
        }
        const descX = row.productImage ? col.desc + MINIATURA.width + 10 : col.desc;
        if (row.productImage) desenharContida(row.productImage, col.desc, y - 7 - MINIATURA.height, MINIATURA);
        let rowY = y - 15;
        for (const l of row.desc) { txt(l, descX, rowY, 9.5, normal, ink); rowY -= 12; }
        for (const l of row.notes) { txt(l, descX, rowY + 1, 7.5, normal, muted); rowY -= 10; }
        txtCenter(quantidadeTexto(row.qty, row.unidade), col.qtyCenter, y - 15, 9, normal, ink);
        txtRight(money(row.unit), col.unitRight, y - 15, 9, normal, ink);
        txtRight(money(row.total), col.totalRight, y - 15, 9, bold, navy);
        y -= rowH;
        page.drawLine({ start: { x: margin, y }, end: { x: right, y }, thickness: 0.5, color: line });
      }

      // Bloco final medido antes de desenhar: resumo, garantia, condições e aceite ficam juntos quando cabem.
      const discount = Number(quote.discount || 0);
      const surcharge = Number(quote.surcharge || 0);
      const grand = Math.max(0, subtotal - discount + surcharge);
      const ajustes = [
        ...(discount > 0 || surcharge > 0 ? [['Subtotal', money(subtotal)]] : []),
        ...(discount > 0 ? [['Desconto', `- ${money(discount)}`]] : []),
        ...(surcharge > 0 ? [['Acréscimo', `+ ${money(surcharge)}`]] : []),
      ];
      const resumoW = 236;
      const resumoX = right - resumoW;
      const TOTAL_H = 36;
      const totalBlockH = 16 + ajustes.length * 17 + (ajustes.length ? 6 : 0) + TOTAL_H + 24;
      const garantias = warrantyLines.map((g) => ({ titulo: wrapText(g.titulo, bold, 9, contentW), detalhe: g.detalhe }));
      const warrantyH = garantias.length ? 20 + garantias.reduce((soma, g) => soma + g.titulo.length * 12 + 18, 0) + 8 : 0;
      const secoesTexto = [
        ...(quote.payment_terms ? [['CONDIÇÕES DE PAGAMENTO', wrapText(quote.payment_terms, normal, 9, contentW)]] : []),
        ...(quote.notes ? [['OBSERVAÇÕES', wrapText(quote.notes, normal, 9, contentW)]] : []),
      ];
      const textosH = secoesTexto.reduce((soma, [, linhas]) => soma + 18 + linhas.length * 12 + 14, 0);
      const responsavel = company.owner_name || companyName;
      const sigW = 210;
      const linhasResponsavel = wrapText(responsavel, bold, 8.5, sigW).slice(0, 2);
      const linhasAceite = wrapText(nomeCliente, bold, 8.5, sigW).slice(0, 2);
      const signatureH = 24 + (quote.valid_until ? 14 : 0) + 14 + 36 + 24 + Math.max(linhasResponsavel.length, linhasAceite.length) * 11;
      // Cabe tudo: fica junto. Não cabe: o TOTAL fica logo após o último item (quando há espaço) e
      // garantia, condições e aceite seguem juntos para a próxima página, sem meia página em branco.
      const restanteH = warrantyH + textosH + signatureH;

      // Resumo financeiro à direita; o TOTAL é o maior destaque. Mesmo cálculo de sempre.
      ensure(totalBlockH);
      y -= 16;
      for (const [rotuloAjuste, valor] of ajustes) {
        txt(rotuloAjuste, resumoX + 14, y - 11, 9, normal, muted);
        txtRight(valor, right - 14, y - 11, 9, normal, ink);
        y -= 17;
      }
      if (ajustes.length) y -= 6;
      page.drawRectangle({ x: resumoX, y: y - TOTAL_H, width: resumoW, height: TOTAL_H, color: navy });
      txt('TOTAL', resumoX + 14, y - TOTAL_H / 2 - 3.5, 10, bold, white);
      txtRight(money(grand), right - 14, y - TOTAL_H / 2 - 5, 15, bold, white);
      y -= TOTAL_H + 24;
      if (restanteH > 0 && shouldBreakPdfBlock(y,restanteH,SAFE_BOTTOM) && canKeepClosingTogether(restanteH,A4[1]-74,SAFE_BOTTOM)) newPage(true);

      if(garantias.length){
        ensure(20 + garantias[0].titulo.length * 12 + 18);
        rotulo('GARANTIA',margin,y-4);
        y-=20;
        for(const garantia of garantias){
          const entradaH = garantia.titulo.length * 12 + 18;
          if (y - entradaH < SAFE_BOTTOM) { newPage(true); rotulo('GARANTIA · CONTINUAÇÃO', margin, y - 4); y -= 20; }
          for (const l of garantia.titulo) { txt(l, margin, y - 9, 9, bold, ink); y -= 12; }
          txt(garantia.detalhe, margin, y - 9, 8.5, normal, muted);
          y -= 18;
        }
        y-=8;
      }

      for (const [titulo, linhas] of secoesTexto) {
        ensure(18 + 12 * Math.min(2, linhas.length));
        rotulo(titulo, margin, y - 4);
        y -= 18;
        for (const l of linhas) {
          if (y - 12 < SAFE_BOTTOM) { newPage(true); rotulo(`${titulo} · CONTINUAÇÃO`, margin, y - 4); y -= 18; }
          txt(l, margin, y - 9, 9, normal, ink);
          y -= 12;
        }
        y -= 14;
      }

      // Aceite: validade, responsável e duas linhas discretas, sempre na mesma página.
      ensure(signatureH);
      y -= 6;
      page.drawLine({ start: { x: margin, y }, end: { x: right, y }, thickness: 0.6, color: line });
      y -= 18;
      if (quote.valid_until) { txt(`Validade da proposta: ${dateBR(quote.valid_until)}`, margin, y, 8.5, normal, muted); y -= 14; }
      txt(fitText(`Responsável pela proposta: ${responsavel}`, normal, 8.5, contentW), margin, y, 8.5, normal, muted);
      y -= 36;
      const sigY = y;
      page.drawLine({ start: { x: margin, y: sigY }, end: { x: margin + sigW, y: sigY }, thickness: 0.7, color: muted });
      page.drawLine({ start: { x: right - sigW, y: sigY }, end: { x: right, y: sigY }, thickness: 0.7, color: muted });
      txt('Responsável / empresa', margin, sigY - 12, 7.5, normal, muted);
      txt('Cliente / aceite', right - sigW, sigY - 12, 7.5, normal, muted);
      let ownerSigY = sigY - 24;
      for (const l of linhasResponsavel) { txt(l, margin, ownerSigY, 8.5, bold, ink); ownerSigY -= 11; }
      let clientSigY = sigY - 24;
      for (const l of linhasAceite) { txt(l, right - sigW, clientSigY, 8.5, bold, ink); clientSigY -= 11; }

      // Rodapé de todas as páginas: empresa e número à esquerda, paginação à direita. Sem logo.
      const pages = pdf.getPages();
      pages.forEach((targetPage, index) => {
        targetPage.drawLine({ start: { x: margin, y: 46 }, end: { x: right, y: 46 }, thickness: 0.5, color: line });
        const footerRight = `Página ${index + 1} de ${pages.length}`;
        const footerWidth = normal.widthOfTextAtSize(footerRight, 7);
        const info = fitText(`${companyName} · Orçamento ${quote.number}`, normal, 7, contentW - footerWidth - 24);
        targetPage.drawText(info, { x: margin, y: 32, size: 7, font: normal, color: muted });
        targetPage.drawText(footerRight, { x: right - footerWidth, y: 32, size: 7, font: normal, color: muted });
      });

      const bytes = await pdf.save();
      const filename = `${safeFile(quote.number)} - ${safeFile(nomeCliente)}.pdf`;
      return new Response(bytes, {
        status: 200,
        headers: {
          ...cabecalhos(origin),
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Content-Length': String(bytes.length),
        },
      });
    } catch (error) {
      registrarErro(limparLog(error instanceof Error ? error.message : 'unknown'));
      const status = error?.status === 401 ? 401 : error?.status === 403 ? 403 : 500;
      return json(status, { error: status === 500 ? 'Não foi possível gerar o PDF.' : 'Sem permissão para gerar o PDF.' }, origin);
    }
  };
}
