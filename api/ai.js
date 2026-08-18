const SUPABASE_URL = process.env.SUPABASE_URL || 'https://diztevlpbcfqleizswxr.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_SGA5FVYLYicO1piUDRb-Rw_wNSxgqyw';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Sessão necessária.' });

  const verify = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: auth, apikey: SUPABASE_PUBLISHABLE_KEY },
  });
  if (!verify.ok) return res.status(401).json({ error: 'Sessão inválida ou expirada.' });

  const prompt = String(req.body?.prompt || '').trim();
  if (!prompt || prompt.length > 40000) return res.status(400).json({ error: 'Solicitação de IA inválida.' });
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(503).json({ error: 'IA ainda não configurada no servidor.' });

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
      console.error('Anthropic error', upstream.status, body.slice(0, 500));
      return res.status(502).json({ error: 'Serviço de interpretação indisponível.' });
    }
    const data = await upstream.json();
    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    return res.status(200).json({ text });
  } catch (error) {
    console.error('AI proxy error', error);
    return res.status(502).json({ error: 'Serviço de interpretação indisponível.' });
  }
}
