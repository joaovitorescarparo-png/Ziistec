import { randomUUID } from 'node:crypto';

const runtimeSecret = () => randomUUID();
const parseTarget = (input) => {
  const parsed = new URL(String(input));
  return {
    href: parsed.href,
    hostname: parsed.hostname,
    pathname: parsed.pathname,
  };
};

process.env.VERCEL_ENV = 'preview';
process.env.SUPABASE_URL = 'https://staging-paid-ai-test.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY = runtimeSecret();
process.env.ANTHROPIC_API_KEY = runtimeSecret();
delete process.env.ENABLE_PAID_AI;

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
    return new Response('true', { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (target.pathname === '/rest/v1/rpc/zt_consume_ai_quota') {
    throw new Error('REGRESSION: paid AI gate allowed quota consumption');
  }
  if (target.hostname === 'api.anthropic.com') {
    throw new Error('REGRESSION: paid AI gate allowed provider call');
  }
  throw new Error(`Unexpected fetch in paid AI gate test: ${target.href}`);
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

async function runGenericAi() {
  const { default: handler } = await import(`../api/ai.js?paid-gate=${Date.now()}`);
  const req = {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-length': '128',
      authorization: `Bearer ${runtimeSecret()}`,
    },
    body: {
      prompt: 'Teste sem custo.',
      companyId: '22222222-2222-4222-8222-222222222222',
    },
  };
  const res = makeResponse();
  await handler(req, res);
  return res;
}

try {
  const res = await runGenericAi();
  const failures = [];
  if (res.statusCode !== 503) failures.push(`esperado 503 com IA paga desativada; recebido ${res.statusCode}`);
  if (!String(res.payload?.error || '').includes('IA paga temporariamente desativada')) {
    failures.push('mensagem da trava de custo não foi retornada');
  }
  if (!calls.some((call) => call.pathname === '/auth/v1/user')) failures.push('sessão não foi validada');
  if (!calls.some((call) => call.pathname === '/rest/v1/rpc/zt_is_owner')) failures.push('owner guard não foi validado');
  if (calls.some((call) => call.pathname === '/rest/v1/rpc/zt_consume_ai_quota')) failures.push('quota foi consumida com IA paga desligada');
  if (calls.some((call) => call.hostname === 'api.anthropic.com')) failures.push('Anthropic foi chamada com IA paga desligada');

  if (failures.length) {
    console.error('\nPAID AI GATE CHECK: FAIL\n');
    failures.forEach((failure, index) => console.error(`${index + 1}. ${failure}`));
    process.exitCode = 1;
  } else {
    console.log('\nPAID AI GATE CHECK: OK');
    console.log('✓ Owner autenticado recebe 503 enquanto a flag paga está desligada');
    console.log('✓ Nenhuma quota é consumida');
    console.log('✓ Nenhuma chamada é feita à Anthropic');
  }
} finally {
  globalThis.fetch = originalFetch;
}
