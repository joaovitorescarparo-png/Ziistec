// Relato mínimo de erro do navegador para os primeiros clientes.
// Não usa banco nem fornecedor novo: grava uma linha JSON no log da Function da Vercel
// (Runtime Logs / Runtime Errors), filtrável por `zt_client_error`.
// Nunca devolve o que recebeu e nunca grava token, e-mail ou corpo de requisição:
// só tipo, código curto, mensagem curta saneada, rota sem query e versão do app.
const MAX_BODY_BYTES = 4096;
const TIPOS = new Set(['frontend', 'promessa', 'render', 'rpc', 'convite', 'upload', 'api']);
const JANELA_MS = 60_000;
const MAX_POR_JANELA = 30;
const porOrigem = new Map();

export function sanear(valor, max) {
  return String(valor ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g, '[token]')
    .replace(/\b(sb_(?:secret|publishable)_[\w-]+)/g, '[chave]')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]')
    .replace(/\b\d{11,14}\b/g, '[documento]')
    .slice(0, max);
}

export function montarEvento(body, env = process.env) {
  const tipo = TIPOS.has(body?.tipo) ? body.tipo : 'frontend';
  return {
    evento: 'zt_client_error',
    tipo,
    codigo: sanear(body?.codigo, 40),
    mensagem: sanear(body?.mensagem, 300),
    rota: sanear(String(body?.rota || '').split('?')[0].split('#')[0], 120),
    versao: sanear(body?.versao, 40),
    ambiente: sanear(env?.VERCEL_ENV, 20),
  };
}

function limitado(chave, agora = Date.now()) {
  const atual = porOrigem.get(chave);
  if (!atual || agora - atual.inicio > JANELA_MS) { porOrigem.set(chave, { inicio: agora, n: 1 }); return false; }
  atual.n += 1;
  return atual.n > MAX_POR_JANELA;
}

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'POST') return res.status(405).end();
  const declarado = Number(req.headers['content-length'] || 0);
  if (Number.isFinite(declarado) && declarado > MAX_BODY_BYTES) return res.status(413).end();
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return res.status(400).end();
  const origem = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'desconhecida';
  if (porOrigem.size > 5000) porOrigem.clear();
  if (limitado(origem)) return res.status(429).end();
  console.error(JSON.stringify(montarEvento(body)));
  return res.status(204).end();
}
