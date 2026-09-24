import { supabase } from './supabase';

// Receipt only, never arguments or credentials. Bound to user/tenant/request in
// memory; the existing explicit confirmation handler is the only execute caller.
const previewReceipts = new Map();

export async function requestAssistant(payload, { signal } = {}) {
  const { data, error } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (error || !token) throw Object.assign(new Error('Sua sessão expirou. Entre novamente.'), { kind: 'auth', status: 401 });
  const receiptKey = JSON.stringify([data.session.user?.id, payload.companyId, payload.requestId]);
  let body = payload;
  if (payload.operation === 'execute') {
    const previewHash = previewReceipts.get(receiptKey);
    if (!previewHash) throw Object.assign(new Error('Prepare e revise novamente a prévia antes de confirmar.'), { kind: 'api', status: 400 });
    body = { ...payload, previewHash };
  }
  const response = await fetch('/api/assistant', {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error(result?.error || 'Não foi possível concluir. Tente novamente com a mesma solicitação.'), { kind: response.status === 401 ? 'auth' : 'api', status: response.status });
  if (!result || typeof result !== 'object') throw new Error('Resposta inválida. Consulte a solicitação novamente.');
  if (payload.operation !== 'execute' && result.confirmationRequired === true) {
    if (result.requestId !== payload.requestId || result.previewVersion !== 1 || !/^[0-9a-f]{64}$/.test(result.previewHash || '')) {
      throw Object.assign(new Error('Prévia sem confirmação verificável. Prepare uma nova solicitação.'), { kind: 'api', status: 502 });
    }
    previewReceipts.set(receiptKey, result.previewHash);
    // Bounded memory; receipts remain available across uncertain network retries.
    if (previewReceipts.size > 100) previewReceipts.delete(previewReceipts.keys().next().value);
  }
  return result;
}

// A retry keeps its request ID; only an explicit edit starts another operation.
export function createAssistantRequestId() { return crypto.randomUUID(); }

export function assistantFormInput(tool, values) {
  return Object.fromEntries(Object.entries(tool.inputSchema.properties).flatMap(([key, field]) => {
    const value = values[key];
    if (value === '' || value == null) return [];
    return [[key, field.type === 'number' || field.type === 'integer' ? Number(value) : field.type === 'boolean' ? value === true || value === 'true' : value]];
  }));
}
