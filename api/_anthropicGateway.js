import { paidAiEnabled } from './_paidFeatures.js';

// Único ponto do servidor que fala com o provedor de IA. Os endpoints validam sessão, papel,
// flag paga e quota antes de chegar aqui; o gateway repete a trava de custo (fail-closed).
export const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-5-5';
const MAX_OUTPUT_CHARS = 20000;

export class AnthropicGatewayError extends Error {
  constructor(message, code, upstreamStatus) { super(message); this.code = code; this.upstreamStatus = upstreamStatus; }
}

export async function requestAnthropicText({ env = process.env, fetchImpl = fetch, system, messages, maxTokens = 1200, timeoutMs = 30000, label = 'AI' }) {
  if (!paidAiEnabled(env) || !env.ANTHROPIC_API_KEY) throw new AnthropicGatewayError('IA paga desativada neste ambiente.', 'PAID_AI_DISABLED');
  const upstream = await fetchImpl(ANTHROPIC_MESSAGES_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL, max_tokens: maxTokens, ...(system ? { system } : {}), messages }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!upstream.ok) {
    // Só status e um trecho curto do erro do provedor; nunca o pedido, que contém dados do tenant.
    const detail = await upstream.text().catch(() => '');
    console.error(`${label} upstream error`, upstream.status, String(detail).slice(0, 300));
    throw new AnthropicGatewayError('Provedor de IA indisponível.', 'UPSTREAM_ERROR', upstream.status);
  }
  const data = await upstream.json();
  return (data?.content || []).filter((block) => block.type === 'text').map((block) => block.text).join('\n').slice(0, MAX_OUTPUT_CHARS);
}
