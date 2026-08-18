const SUPABASE_URL = process.env.SUPABASE_URL || 'https://diztevlpbcfqleizswxr.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_SGA5FVYLYicO1piUDRb-Rw_wNSxgqyw';

const jsonHeaders = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Resource-Policy': 'same-origin',
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  Object.entries(jsonHeaders).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });
  if (!String(req.headers['content-type'] || '').toLowerCase().includes('application/json')) {
    return res.status(415).json({ error: 'Conteúdo inválido.' });
  }

  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Sessão necessária.' });

  const verify = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: auth, apikey: SUPABASE_PUBLISHABLE_KEY },
  });
  if (!verify.ok) return res.status(401).json({ error: 'Sessão inválida ou expirada.' });

  const prompt = String(req.body?.prompt || '').trim();
  const companyId = String(req.body?.companyId || '').trim();
  if (!prompt || prompt.length > 10000) return res.status(400).json({ error: 'Solicitação de IA inválida.' });
  if (!UUID_RE.test(companyId)) return res.status(400).json({ error: 'Empresa ativa inválida.' });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(503).json({ error: 'IA ainda não configurada no servidor.' });

  // O banco não confia no companyId do navegador: valida membership ativa, assinatura e limites.
  const quota = await fetch(`${SUPABASE_URL}/rest/v1/rpc/zt_consume_ai_quota`, {
    method: 'POST',
    headers: {
      Authorization: auth,
      apikey: SUPABASE_PUBLISHABLE_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ p_company: companyId }),
  });
  if (!quota.ok) {
    const detail = await quota.json().catch(() => ({}));
    const message = detail?.message || 'IA indisponível para esta conta.';
    const status = quota.status === 401 ? 401 : quota.status === 403 ? 403 : 429;
    return res.status(status).json({ error: message });
  }

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
        max_tokens: 1200,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!upstream.ok) {
      const body = await upstream.text();
      console.error('Anthropic error', upstream.status, body.slice(0, 300));
      return res.status(502).json({ error: 'Serviço de interpretação indisponível.' });
    }
    const data = await upstream.json();
    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    return res.status(200).json({ text });
  } catch (error) {
    console.error('AI proxy error', error instanceof Error ? error.message : 'unknown');
    return res.status(502).json({ error: 'Serviço de interpretação indisponível.' });
  }
}
