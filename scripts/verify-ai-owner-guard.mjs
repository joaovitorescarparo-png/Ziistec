import { randomUUID } from 'node:crypto';

const runtimeSecret = () => randomUUID();

process.env.VERCEL_ENV = 'preview';
process.env.SUPABASE_URL = 'https://staging-owner-guard-test.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY = runtimeSecret();
process.env.ANTHROPIC_API_KEY = runtimeSecret();

const calls = [];
const originalFetch = globalThis.fetch;

globalThis.fetch = async (input) => {
  const url = String(input);
  calls.push(url);

  if (url.endsWith('/auth/v1/user')) {
    return new Response(JSON.stringify({ id: '11111111-1111-4111-8111-111111111111' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (url.endsWith('/rest/v1/rpc/zt_is_owner')) {
    // Simula usuário autenticado/membro técnico: sessão válida, mas não proprietário.
    return new Response('false', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (url.includes('/rest/v1/rpc/zt_consume_ai_quota')) {
    throw new Error('REGRESSION: technician reached AI quota');
  }

  if (url.includes('api.anthropic.com')) {
    throw new Error('REGRESSION: technician reached Anthropic');
  }

  throw new Error(`Unexpected fetch in owner guard test: ${url}`);
};

function makeResponse() {
  return {
    headers: new Map(),
    statusCode: 200,
    payload: null,
    setHeader(name, value) { this.headers.set(String(name).toLowerCase(), String(value)); },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.payload = value; return this; },
    send(value) { this.payload = value; return this; },
  };
}

try {
  const { default: handler } = await import(`../api/ai.js?owner-guard=${Date.now()}`);
  const req = {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-length': '128',
      authorization: `Bearer ${runtimeSecret()}`,
    },
    body: {
      prompt: 'Monte um orçamento de teste.',
      companyId: '22222222-2222-4222-8222-222222222222',
    },
  };
  const res = makeResponse();

  await handler(req, res);

  const failures = [];
  if (res.statusCode !== 403) failures.push(`esperado status 403 para técnico; recebido ${res.statusCode}`);
  if (!String(res.payload?.error || '').includes('Somente o proprietário')) {
    failures.push('resposta não deixou claro que a IA comercial é owner-only');
  }
  if (!calls.some((url) => url.endsWith('/auth/v1/user'))) failures.push('sessão não foi validada');
  if (!calls.some((url) => url.endsWith('/rest/v1/rpc/zt_is_owner'))) failures.push('owner guard não foi chamado');
  if (calls.some((url) => url.includes('/rest/v1/rpc/zt_consume_ai_quota'))) failures.push('técnico consumiu quota de IA');
  if (calls.some((url) => url.includes('api.anthropic.com'))) failures.push('técnico alcançou o provedor de IA');

  if (failures.length) {
    console.error('\nAI OWNER GUARD CHECK: FAIL\n');
    failures.forEach((failure, index) => console.error(`${index + 1}. ${failure}`));
    process.exitCode = 1;
  } else {
    console.log('\nAI OWNER GUARD CHECK: OK');
    console.log('✓ Sessão válida de técnico é rejeitada com 403');
    console.log('✓ Owner guard roda antes da quota');
    console.log('✓ Técnico não consome quota e não chama Anthropic');
  }
} finally {
  globalThis.fetch = originalFetch;
}
