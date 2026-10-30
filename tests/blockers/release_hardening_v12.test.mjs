import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Hardening adversarial V1.2 — vazamento de erro do banco nas rotas api/* (SEC-V12-03) e guardas de registro da 0112.
// Nenhum teste fala com a rede: o fetch global começa bloqueado e cada teste instala um roteador simulado que só conhece
// o host do banco. O comportamento do banco (frases exatas, 0112, evidência) é provado em
// supabase/tests/v2_release_hardening_v12_rollback.sql; aqui se prova o que a rota devolve ao navegador.

process.env.VERCEL_ENV = 'preview';
process.env.VERCEL_GIT_COMMIT_REF = 'claude/assistant-universal-owner-v1';
for (const key of ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'ENABLE_EXTERNAL_AI', 'AI_PROVIDER', 'GEMINI_API_KEY', 'ANTHROPIC_API_KEY']) delete process.env[key];

const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => { throw new Error(`rede bloqueada no teste: ${new URL(url).hostname}`); };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { supabaseServidor } = await import('../../api/_supabaseServerConfig.js');
const { QUOTA_USER_MESSAGES, quotaUserMessage } = await import('../../api/_apiErrors.js');
const { default: aiHandler } = await import('../../api/ai.js');
const { default: financeHandler } = await import('../../api/finance-ai.js');
const { default: quotePdfHandler } = await import('../../api/quote-pdf.js');

assert.equal(supabaseServidor.configurado, true, 'o ambiente de teste precisa resolver o banco de homologação');
const DB_HOST = new URL(supabaseServidor.url).hostname;

const companyId = '10000000-0000-4000-8000-000000000001';
const quoteId = '50000000-0000-4000-8000-000000000005';
const userId = '20000000-0000-4000-8000-000000000002';
const SESSION = `session-${randomUUID()}`;
const PROVIDER_KEY = `provider-key-${randomUUID()}`;

const reply = (body, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Corpo de erro do PostgREST como ele chega de verdade, com nomes internos que o navegador nunca deve ler. */
const LEAKY = {
  code: 'PGRST202',
  details: 'Searched for the function public.zt_consume_ai_quota with parameter p_company in the schema cache; table company_members column user_id',
  hint: 'Perhaps you meant to call the function zt_private.zt_consume_ai_quota',
  message: 'Could not find the function public.zt_consume_ai_quota(p_company) in the schema cache',
};
const FORBIDDEN_FRAGMENTS = ['zt_consume', 'zt_private', 'PGRST', 'schema cache', 'company_members', 'user_id', 'Perhaps', 'permission denied', 'JWT', 'stack', 'node_modules'];

function installNetwork({ quotaBody, quotaStatus }) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ host: u.hostname, path: u.pathname });
    if (u.hostname !== DB_HOST) throw new Error(`host inesperado: ${u.hostname}`);
    if (u.pathname === '/auth/v1/user') return reply({ id: userId });
    if (u.pathname.endsWith('/rpc/zt_is_owner')) return reply('true');
    if (u.pathname.endsWith('/rpc/zt_consume_ai_quota') || u.pathname.endsWith('/rpc/zt_consume_quote_pdf_quota')) return reply(quotaBody, quotaStatus);
    return reply([]);
  };
  return calls;
}

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: undefined,
    setHeader(key, value) { res.headers[key.toLowerCase()] = value; },
    status(code) { res.statusCode = code; return res; },
    json(value) { res.body = value; return res; },
    send(value) { res.body = value; return res; } };
  return res;
}

async function call(handler, body) {
  const res = mockRes();
  const originalError = console.error; console.error = () => {};
  try {
    await handler({ method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${SESSION}` }, body }, res);
  } finally { console.error = originalError; }
  return res;
}

const paidAi = () => Object.assign(process.env, { ENABLE_EXTERNAL_AI: 'true', AI_PROVIDER: 'gemini', GEMINI_API_KEY: PROVIDER_KEY });
test.afterEach(() => {
  for (const key of ['ENABLE_EXTERNAL_AI', 'AI_PROVIDER', 'GEMINI_API_KEY']) delete process.env[key];
  globalThis.fetch = async (url) => { throw new Error(`rede bloqueada no teste: ${new URL(url).hostname}`); };
});
test.after(() => { globalThis.fetch = realFetch; });

const financeSnapshot = { month: '2026-10', custosProntos: false,
  metrics: { faturado: 1000, recebido: 400, receber: 600, despesas: 200, despesasPagas: 100, caixa: 300, vencidoReceber: 0, vencidoPagar: 0, proj7: 0, proj30: 0, proj60: 0, origemOS: 800, origemManual: 200 },
  os: [{ numero: 'OS-0001', receita: 800, custo: 100, resultado: 700, margem: 87.5 }] };

const ROUTES = [
  ['ai', aiHandler, { companyId, prompt: 'Orçamento para o Mauro com duas câmeras.' }, 'IA indisponível para esta conta.', true],
  ['finance-ai', financeHandler, { companyId, snapshot: financeSnapshot }, 'IA indisponível para esta conta.', true],
  ['quote-pdf', quotePdfHandler, { quoteId, companyId }, 'Limite de geração de PDF atingido.', false],
];

// ───────────────────────── SEC-V12-03: o corpo de erro do banco não chega ao navegador ─────────────────────────

for (const [name, handler, body, fallback, needsPaidAi] of ROUTES) {
  for (const status of [400, 401, 403, 404, 500, 503]) {
    test(`${name}: erro ${status} do banco na cota devolve só o texto fixo, sem função, esquema, tabela ou coluna`, async () => {
      if (needsPaidAi) paidAi();
      installNetwork({ quotaBody: LEAKY, quotaStatus: status });
      const r = await call(handler, body);
      assert.ok([401, 403, 429].includes(r.statusCode), `status mapeado, não ${r.statusCode}`);
      assert.equal(r.body.error, fallback);
      const text = JSON.stringify(r.body);
      for (const fragment of FORBIDDEN_FRAGMENTS) assert.ok(!text.includes(fragment), `a resposta não pode conter "${fragment}"`);
    });
  }

  test(`${name}: corpo de erro que não é JSON (HTML de proxy, texto com caminho interno) também vira o texto fixo`, async () => {
    if (needsPaidAi) paidAi();
    installNetwork({ quotaBody: '<html>502 Bad Gateway at /var/task/api/secret.js</html>', quotaStatus: 502 });
    const r = await call(handler, body);
    assert.equal(r.body.error, fallback);
    assert.ok(!JSON.stringify(r.body).includes('/var/task'));
  });

  test(`${name}: mensagem com formato de produto mas fora da lista fixa não é repassada`, async () => {
    if (needsPaidAi) paidAi();
    installNetwork({ quotaBody: { code: 'P0001', message: 'Limite diário de IA atingido; consulte public.ai_usage_events (user_id=abc)' }, quotaStatus: 400 });
    const r = await call(handler, body);
    assert.equal(r.body.error, fallback);
  });
}

test('ai e finance-ai: as frases de produto da cota continuam chegando ao usuário (o 429 explica o motivo)', async () => {
  for (const [handler, body] of [[aiHandler, ROUTES[0][2]], [financeHandler, ROUTES[1][2]]]) {
    for (const message of ['Limite diário de IA atingido', 'Limite temporário de IA atingido. Tente novamente em instantes', 'Assinatura sem acesso à IA']) {
      paidAi();
      installNetwork({ quotaBody: { code: 'P0001', message }, quotaStatus: 400 });
      const r = await call(handler, body);
      assert.equal(r.statusCode, 429);
      assert.equal(r.body.error, message);
    }
  }
});

test('quote-pdf: as frases de produto da cota continuam chegando ao usuário', async () => {
  for (const message of ['Muitos PDFs em pouco tempo. Aguarde um minuto', 'Limite diário de PDFs atingido', 'Assinatura inativa']) {
    installNetwork({ quotaBody: { code: 'P0001', message }, quotaStatus: 400 });
    const r = await call(quotePdfHandler, ROUTES[2][2]);
    assert.equal(r.statusCode, 429);
    assert.equal(r.body.error, message);
  }
});

test('quotaUserMessage: só texto exato da lista passa; tipo errado, vazio, objeto e nulo caem no texto fixo', () => {
  for (const message of QUOTA_USER_MESSAGES) assert.equal(quotaUserMessage({ message }, 'x'), message);
  for (const detail of [undefined, null, {}, { message: '' }, { message: 42 }, { message: { a: 1 } }, { message: ['Limite diário de IA atingido'] }, { message: ' Limite diário de IA atingido' }, { message: 'limite diário de ia atingido' }, 'Limite diário de IA atingido']) {
    assert.equal(quotaUserMessage(detail, 'fixo'), 'fixo');
  }
});

// ───────────────────────── a lista fixa é a que o banco realmente levanta ─────────────────────────

const sqlFiles = fs.readdirSync(path.join(root, 'supabase')).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
const allSql = sqlFiles.map((f) => fs.readFileSync(path.join(root, 'supabase', f), 'utf8')).join('\n');

test('cada frase da lista fixa existe como RAISE EXCEPTION em migration (a lista não aponta para texto que o banco não levanta)', () => {
  for (const message of QUOTA_USER_MESSAGES) {
    assert.ok(allSql.includes(`raise exception '${message}'`), `migration sem a frase: ${message}`);
  }
});

// ───────────────────────── 0112 está registrada e coberta pelo teste SQL ─────────────────────────

test('0112: migration existe, é a próxima do pacote e o teste SQL que a exercita está no runner de CI', () => {
  assert.ok(sqlFiles.includes('0112_company_member_identity_guard.sql'));
  assert.equal(sqlFiles.filter((f) => f.startsWith('0112')).length, 1, 'número 0112 único');
  const sql = fs.readFileSync(path.join(root, 'supabase/0112_company_member_identity_guard.sql'), 'utf8').replace(/--.*$/gm, '');
  assert.match(sql, /before update on public\.company_members/i);
  assert.match(sql, /new\.user_id is distinct from old\.user_id/i);
  assert.match(sql, /new\.company_id is distinct from old\.company_id/i);
  assert.match(sql, /revoke execute on function public\.zt_guard_company_member_identity\(\) from public, anon, authenticated/i);
  assert.doesNotMatch(sql, /security definer/i, 'trigger de guarda roda como invoker: não aumenta o número de definers');
  const runner = fs.readFileSync(path.join(root, 'scripts/run-sql-rls-ci.sh'), 'utf8');
  assert.ok(runner.includes('supabase/tests/v2_release_hardening_v12_rollback.sql'));
  const sqlTest = fs.readFileSync(path.join(root, 'supabase/tests/v2_release_hardening_v12_rollback.sql'), 'utf8');
  for (const name of ['sec_v12_02_dono_nao_troca_user_id_do_vinculo', 'ev_caminho_com_traversal_recusado', 'd_desativado_nao_usa_nenhuma_rpc_da_0111', 'q_decima_primeira_no_minuto_e_recusada_com_a_frase_exata']) {
    assert.ok(sqlTest.includes(name), `teste SQL sem o ataque ${name}`);
  }
});
