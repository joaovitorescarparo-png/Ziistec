// Gateway neutro de IA externa: único ponto do servidor que chama um provedor de IA.
// Quem chama valida sessão, papel, assinatura e quota antes; o gateway repete a trava de custo.
// Fail-closed: sem ENABLE_EXTERNAL_AI=true, AI_PROVIDER reconhecido e chave do provedor, nada sai do servidor.
// Ter uma chave configurada não basta. Chaves nunca aparecem em URL, log, erro ou resposta.
export const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';
export const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite';
export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-5-5';
const MAX_OUTPUT_CHARS = 20000;
const MODEL_NAME = /^[a-z0-9][a-z0-9.-]{0,79}$/i;
const role = (message) => (message?.role === 'assistant' ? 'assistant' : 'user');

// Adapters conhecem só o formato de cada API; ninguém fora deste arquivo conhece provedor, URL ou header.
const ADAPTERS = Object.freeze({
  gemini: Object.freeze({
    keyVar: 'GEMINI_API_KEY', modelVar: 'GEMINI_MODEL', defaultModel: DEFAULT_GEMINI_MODEL,
    request: ({ key, model, system, messages, maxTokens, json }) => ({
      url: `${GEMINI_API_BASE}${model}:generateContent`,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: {
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        contents: messages.map((message) => ({ role: role(message) === 'assistant' ? 'model' : 'user', parts: [{ text: String(message.content ?? '') }] })),
        generationConfig: { maxOutputTokens: maxTokens, ...(json ? { responseMimeType: 'application/json' } : {}) },
      },
    }),
    text: (data) => (data?.candidates?.[0]?.content?.parts || []).map((part) => (typeof part?.text === 'string' ? part.text : '')).join(''),
    errorCode: (data) => data?.error?.status,
  }),
  // Adapter opcional (fallback futuro): só é usado com AI_PROVIDER=anthropic configurado explicitamente.
  anthropic: Object.freeze({
    keyVar: 'ANTHROPIC_API_KEY', modelVar: 'ANTHROPIC_MODEL', defaultModel: DEFAULT_ANTHROPIC_MODEL,
    request: ({ key, model, system, messages, maxTokens }) => ({
      url: ANTHROPIC_MESSAGES_URL,
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: { model, max_tokens: maxTokens, ...(system ? { system } : {}), messages: messages.map((message) => ({ role: role(message), content: String(message.content ?? '') })) },
    }),
    text: (data) => (data?.content || []).filter((block) => block?.type === 'text').map((block) => block.text).join('\n'),
    errorCode: (data) => data?.error?.type,
  }),
});

export class AiGatewayError extends Error {
  constructor(message, code, upstreamStatus) { super(message); this.code = code; this.upstreamStatus = upstreamStatus; }
}

export function externalAiEnabled(env = process.env) {
  return String(env?.ENABLE_EXTERNAL_AI ?? '').trim().toLowerCase() === 'true';
}

export function resolveAiProvider(env = process.env) {
  if (!externalAiEnabled(env)) return { ok: false, code: 'EXTERNAL_AI_DISABLED' };
  const name = String(env?.AI_PROVIDER ?? '').trim().toLowerCase();
  const adapter = Object.hasOwn(ADAPTERS, name) ? ADAPTERS[name] : null;
  if (!adapter) return { ok: false, code: 'AI_PROVIDER_INVALID' };
  const key = String(env?.[adapter.keyVar] ?? '').trim();
  if (!key) return { ok: false, code: 'AI_KEY_MISSING' };
  const model = String(env?.[adapter.modelVar] ?? '').trim() || adapter.defaultModel;
  if (!MODEL_NAME.test(model)) return { ok: false, code: 'AI_MODEL_INVALID' };
  return { ok: true, name, adapter, key, model };
}

export const externalAiReady = (env = process.env) => resolveAiProvider(env).ok;

// Texto da resposta do provedor configurado. json=true pede saída JSON quando o provedor suporta.
export async function requestAiText({ env = process.env, fetchImpl = fetch, system, messages, maxTokens = 1200, timeoutMs = 30000, json = false, label = 'AI' }) {
  const provider = resolveAiProvider(env);
  if (!provider.ok) throw new AiGatewayError('IA externa desativada ou não configurada neste ambiente.', provider.code);
  const request = provider.adapter.request({ key: provider.key, model: provider.model, system, messages, maxTokens, json });
  let upstream;
  try {
    upstream = await fetchImpl(request.url, { method: 'POST', headers: request.headers, body: JSON.stringify(request.body), signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    console.error(`${label} provider unreachable`, provider.name, timeout ? 'timeout' : 'network');
    throw new AiGatewayError(timeout ? 'O provedor de IA demorou demais para responder.' : 'Provedor de IA indisponível.', timeout ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE');
  }
  const data = await upstream.json().catch(() => null);
  if (!upstream.ok) {
    // Só provedor, status e o código curto do erro: nunca chave, pedido (dados do tenant) ou corpo bruto.
    const reason = String(provider.adapter.errorCode(data) || '').replace(/[^A-Za-z_]/g, '').slice(0, 40);
    console.error(`${label} provider error`, provider.name, upstream.status, reason);
    throw new AiGatewayError('Provedor de IA indisponível.', 'UPSTREAM_ERROR', upstream.status);
  }
  const text = provider.adapter.text(data);
  if (!text.trim()) throw new AiGatewayError('O provedor de IA não devolveu conteúdo.', 'EMPTY_RESPONSE');
  return text.slice(0, MAX_OUTPUT_CHARS);
}
