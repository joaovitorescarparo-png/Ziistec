/* Relato mínimo de erro para os primeiros clientes (sem fornecedor novo).
 *
 * Envia tipo + código + mensagem curta para /api/client-error, que grava no log da
 * Vercel. Nunca lança erro, nunca bloqueia a tela e nunca envia dado do formulário:
 * a mensagem é cortada e o servidor ainda saneia token, e-mail e documento.
 * Limites no navegador: o mesmo erro sai uma vez por minuto e no máximo 20 por sessão.
 * Fora da Vercel (site estático da Hostinger) o endpoint não existe: na primeira resposta
 * 404/405/501 o envio para de vez nesta sessão, sem nenhum efeito na tela. */
const enviados = new Map();
let total = 0;
let endpointAusente = false;
const SEM_ENDPOINT = new Set([404, 405, 501]);
const MAX_SESSAO = 20;
const VERSAO = 'web';

export function reportarErro(tipo, erro = {}) {
  try {
    if (endpointAusente || typeof window === 'undefined' || typeof fetch !== 'function') return false;
    const codigo = String(erro?.code || erro?.codigo || erro?.name || '').slice(0, 40);
    const mensagem = String(erro?.message || erro?.mensagem || erro || '').slice(0, 300);
    const assinatura = `${tipo}|${codigo}|${mensagem.slice(0, 80)}`;
    const agora = Date.now();
    if (total >= MAX_SESSAO || agora - (enviados.get(assinatura) || 0) < 60_000) return false;
    enviados.set(assinatura, agora);
    total += 1;
    const corpo = JSON.stringify({ tipo, codigo, mensagem, rota: window.location?.pathname || '', versao: VERSAO });
    fetch('/api/client-error', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: corpo, keepalive: true })
      .then((r) => { if (SEM_ENDPOINT.has(r?.status)) endpointAusente = true; })
      .catch(() => {});
    return true;
  } catch { return false; }
}

let instalado = false;
export function instalarCapturaGlobal() {
  if (instalado || typeof window === 'undefined') return;
  instalado = true;
  window.addEventListener('error', (e) => reportarErro('frontend', e?.error || { message: e?.message }));
  window.addEventListener('unhandledrejection', (e) => reportarErro('promessa', e?.reason || {}));
}
