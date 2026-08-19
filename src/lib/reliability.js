const NETWORK_RE = /failed to fetch|networkerror|network request|load failed|timeout|timed out/i;

export function ensureRequestId(record) {
  if (record?.id) return record.requestId || null;
  if (!record.requestId) {
    if (!globalThis.crypto?.randomUUID) {
      throw new Error('Seu navegador precisa ser atualizado para salvar este documento com segurança.');
    }
    record.requestId = globalThis.crypto.randomUUID();
  }
  return record.requestId;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function withTimeout(factory, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      factory(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Tempo limite de comunicação com o servidor.')), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function idempotentWrite(factory, { timeoutMs = 18000, retries = 1 } = {}) {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new Error('Sem internet. Aguarde a conexão voltar antes de salvar.');
  }

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await withTimeout(factory, timeoutMs);
    } catch (error) {
      lastError = error;
      const retryable = NETWORK_RE.test(String(error?.message || error));
      if (!retryable || attempt >= retries) throw error;
      await wait(450 * (attempt + 1));
    }
  }
  throw lastError;
}
