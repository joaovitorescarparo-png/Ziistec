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
  if (PROVIDER_HOSTS.has(target.hostname)) {
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

// Cada cenário configura o servidor de um jeito incompleto; nenhum pode gerar custo.
const scenarios = [
  { name: 'flag de IA externa desligada (chaves presentes)', expected: 'IA paga temporariamente desativada',
    env: { AI_PROVIDER: 'gemini', GEMINI_API_KEY: runtimeSecret(), ANTHROPIC_API_KEY: runtimeSecret() } },
  { name: 'flag ligada sem chave do provedor', expected: 'IA ainda não configurada',
    env: { ENABLE_EXTERNAL_AI: 'true', AI_PROVIDER: 'gemini', ANTHROPIC_API_KEY: runtimeSecret() } },
  { name: 'flag ligada com provedor inválido', expected: 'IA ainda não configurada',
    env: { ENABLE_EXTERNAL_AI: 'true', AI_PROVIDER: 'openai', GEMINI_API_KEY: runtimeSecret() } },
  { name: 'flag antiga ENABLE_PAID_AI não liga a IA externa', expected: 'IA paga temporariamente desativada',
    env: { ENABLE_PAID_AI: 'true', AI_PROVIDER: 'gemini', GEMINI_API_KEY: runtimeSecret() } },
];
const managed = ['ENABLE_EXTERNAL_AI', 'ENABLE_PAID_AI', 'AI_PROVIDER', 'GEMINI_API_KEY', 'GEMINI_MODEL', 'ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL'];

try {
  const failures = [];
  for (const scenario of scenarios) {
    for (const key of managed) delete process.env[key];
    Object.assign(process.env, scenario.env);
    calls.length = 0;
    const res = await runGenericAi();
    if (res.statusCode !== 503) failures.push(`${scenario.name}: esperado 503; recebido ${res.statusCode}`);
    if (!String(res.payload?.error || '').includes(scenario.expected)) failures.push(`${scenario.name}: mensagem da trava não foi retornada`);
    if (!calls.some((call) => call.pathname === '/auth/v1/user')) failures.push(`${scenario.name}: sessão não foi validada`);
    if (!calls.some((call) => call.pathname === '/rest/v1/rpc/zt_is_owner')) failures.push(`${scenario.name}: owner guard não foi validado`);
    if (calls.some((call) => call.pathname === '/rest/v1/rpc/zt_consume_ai_quota')) failures.push(`${scenario.name}: quota foi consumida`);
    if (calls.some((call) => PROVIDER_HOSTS.has(call.hostname))) failures.push(`${scenario.name}: provedor de IA foi chamado`);
  }

  if (failures.length) {
    console.error('\nPAID AI GATE CHECK: FAIL\n');
    failures.forEach((failure, index) => console.error(`${index + 1}. ${failure}`));
    process.exitCode = 1;
  } else {
    console.log('\nPAID AI GATE CHECK: OK');
    console.log('✓ Owner autenticado recebe 503 com IA externa desligada, sem chave ou com provedor inválido');
    console.log('✓ Nenhuma quota é consumida');
    console.log('✓ Nenhuma chamada é feita ao Gemini ou à Anthropic');
  }
} finally {
  for (const key of managed) delete process.env[key];
  globalThis.fetch = originalFetch;
}
