import { supabase } from './supabase';

export async function requestAssistant(payload, { signal } = {}) {
  const { data, error } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (error || !token) throw Object.assign(new Error('Sua sessão expirou. Entre novamente.'), { kind: 'auth', status: 401 });
  const response = await fetch('/api/assistant', {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error(result?.error || 'Não foi possível concluir. Tente novamente com a mesma solicitação.'), { kind: response.status === 401 ? 'auth' : 'api', status: response.status });
  if (!result || typeof result !== 'object') throw new Error('Resposta inválida. Consulte a solicitação novamente.');
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
