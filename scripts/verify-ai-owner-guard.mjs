import { randomUUID } from 'node:crypto';

const runtimeSecret = () => randomUUID();
// Hosts dos provedores atrás do gateway neutro (comparação exata de hostname).
const PROVIDER_HOSTS = new Set(['generativelanguage.googleapis.com', 'api.anthropic.com']);
const parseTarget = (input) => {
  const parsed = new URL(String(input));
  return {
    href: parsed.href,
    hostname: parsed.hostname,
    pathname: parsed.pathname,
  };
};

process.env.VERCEL_ENV = 'preview';
process.env.VERCEL_GIT_COMMIT_REF = 'hardening-v2-staging';
process.env.SUPABASE_URL = 'https://xadoktssibuuebzzjrhv.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_AIJvagsmB3vknIW9ykFERQ_T7aCkl5e';
// IA externa totalmente configurada: só o owner guard pode impedir o técnico.
process.env.ENABLE_EXTERNAL_AI = 'true';
process.env.AI_PROVIDER = 'gemini';
process.env.GEMINI_API_KEY = runtimeSecret();
process.env.ANTHROPIC_API_KEY = runtimeSecret();

const calls = [];
const originalFetch = globalThis.fetch;

globalThis.fetch = async (input) => {
  const target = parseTarget(input);
  calls.push(target);

  if (target.pathname === '/auth/v1/user') {
    return new Response(JSON.stringify({ id: '11111111-1111-4111-8111-111111111111' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (target.pathname === '/rest/v1/rpc/zt_is_owner') {
    return new Response('false', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (target.pathname === '/rest/v1/rpc/zt_consume_ai_quota') {
    throw new Error('REGRESSION: technician reached AI quota');
  }

  if (PROVIDER_HOSTS.has(target.hostname)) {
    throw new Error('REGRESSION: technician reached the AI provider');
  }

  throw new Error(`Unexpected fetch in owner guard test: ${target.href}`);
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
  if (!calls.some((call) => call.pathname === '/auth/v1/user')) failures.push('sessão não foi validada');
  if (!calls.some((call) => call.pathname === '/rest/v1/rpc/zt_is_owner')) failures.push('owner guard não foi chamado');
  if (calls.some((call) => call.pathname === '/rest/v1/rpc/zt_consume_ai_quota')) failures.push('técnico consumiu quota de IA');
  if (calls.some((call) => PROVIDER_HOSTS.has(call.hostname))) failures.push('técnico alcançou o provedor de IA');

  if (failures.length) {
    console.error('\nAI OWNER GUARD CHECK: FAIL\n');
    failures.forEach((failure, index) => console.error(`${index + 1}. ${failure}`));
    process.exitCode = 1;
  } else {
    console.log('\nAI OWNER GUARD CHECK: OK');
    console.log('✓ Sessão válida de técnico é rejeitada com 403');
    console.log('✓ Owner guard roda antes da quota');
    console.log('✓ Técnico não consome quota e não chama o provedor de IA, mesmo com a IA externa ligada');
  }
} finally {
  for (const key of ['ENABLE_EXTERNAL_AI', 'AI_PROVIDER', 'GEMINI_API_KEY', 'ANTHROPIC_API_KEY']) delete process.env[key];
  globalThis.fetch = originalFetch;
}
