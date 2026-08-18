import { supabase } from './supabase';

export async function chamarIAReal(prompt) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Sua sessão expirou. Entre novamente.');

  const companyId = localStorage.getItem('ziistec_empresa_id');
  if (!companyId) throw new Error('Empresa ativa não encontrada. Recarregue o ZiisTec.');

  const resp = await fetch('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ prompt, companyId }),
  });
  const payload = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(payload.error || 'Serviço de interpretação indisponível.');
  const limpo = String(payload.text || '').replace(/```json/g, '').replace(/```/g, '').trim();
  try { return JSON.parse(limpo); }
  catch { throw new Error('A IA respondeu em um formato que não consegui interpretar. Tente novamente.'); }
}
