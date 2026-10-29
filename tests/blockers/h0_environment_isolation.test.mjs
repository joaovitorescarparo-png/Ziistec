import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { H0_SUPABASE_HOSTS, PROD_SUPABASE_HOSTS, STAGING_SUPABASE_HOSTS, resolverConfigSupabase } from '../../src/lib/supabaseConfig.js';
import { resolverRedirectAuth } from '../../src/lib/authRedirect.js';
import {
  H0_BRANCHES,
  H0_PUBLISHABLE_KEY,
  H0_SUPABASE_URL,
  PROD_PUBLISHABLE_KEY,
  PROD_SUPABASE_URL,
  STAGING_BRANCHES,
  STAGING_PUBLISHABLE_KEY,
  STAGING_SUPABASE_URL,
  resolverSupabaseServidor,
} from '../../api/_supabaseServerConfig.js';

const H0_REF = 'auojcljfahhpkfqqbygd';
const H0_HOST = 'ziistec-git-claude-blocks34-port-beta-v1-js-connect.vercel.app';
const H0_BRANCH = 'claude/blocks34-port-beta-v1';
const BETA_HOST = 'beta.ziistec.com';
const BETA_REF = 'xadoktssibuuebzzjrhv';
const PROD_REF = 'diztevlpbcfqleizswxr';
const INVALID_URL = 'https://projeto-errado.supabase.co';
const INVALID_KEY = 'sb_publishable_invalid_test';

const client = ({ deploymentEnv, host, envUrl = '', envKey = '' }) => resolverConfigSupabase({
  deploymentEnv,
  host,
  envUrl,
  envKey,
  prodUrl: PROD_SUPABASE_URL,
  prodKey: PROD_PUBLISHABLE_KEY,
  stagingUrl: STAGING_SUPABASE_URL,
  stagingKey: STAGING_PUBLISHABLE_KEY,
  h0Url: H0_SUPABASE_URL,
  h0Key: H0_PUBLISHABLE_KEY,
});

const server = ({ vercelEnv, branch = H0_BRANCH, url = '', key = '' }) => resolverSupabaseServidor({
  VERCEL_ENV: vercelEnv,
  VERCEL_GIT_COMMIT_REF: branch,
  SUPABASE_URL: url,
  SUPABASE_PUBLISHABLE_KEY: key,
});

const mustConfigure = (result, url, label) => {
  assert.equal(result.configurado, true, `${label}: deveria configurar`);
  assert.equal(result.url, url, `${label}: project URL incorreta`);
};
const mustFailClosed = (result, label) => {
  assert.equal(result.configurado, false, `${label}: deveria falhar fechado`);
  assert.equal(result.url, '', `${label}: não pode expor URL utilizável`);
};

const PAIRS = {
  prod: [PROD_SUPABASE_URL, PROD_PUBLISHABLE_KEY],
  staging: [STAGING_SUPABASE_URL, STAGING_PUBLISHABLE_KEY],
  invalid: [INVALID_URL, INVALID_KEY],
  h0KeyOnStaging: [STAGING_SUPABASE_URL, H0_PUBLISHABLE_KEY],
  stagingKeyOnH0: [H0_SUPABASE_URL, STAGING_PUBLISHABLE_KEY],
};

test('H0: três projetos distintos e listas de host/branch disjuntas, sem curinga', () => {
  assert.equal(H0_SUPABASE_URL, `https://${H0_REF}.supabase.co`);
  assert.equal(new Set([PROD_SUPABASE_URL, STAGING_SUPABASE_URL, H0_SUPABASE_URL]).size, 3, 'URLs dos três projetos distintas');
  assert.equal(new Set([PROD_PUBLISHABLE_KEY, STAGING_PUBLISHABLE_KEY, H0_PUBLISHABLE_KEY]).size, 3, 'chaves dos três projetos distintas');
  assert.ok(PROD_SUPABASE_URL.includes(PROD_REF) && STAGING_SUPABASE_URL.includes(BETA_REF), 'Production e Beta continuam nos refs conhecidos');
  assert.deepEqual([...H0_SUPABASE_HOSTS], [H0_HOST], 'o H0 tem exatamente um host de Preview');
  assert.deepEqual([...H0_BRANCHES], [H0_BRANCH], 'o H0 tem exatamente uma branch');
  for (const host of H0_SUPABASE_HOSTS) {
    assert.equal(PROD_SUPABASE_HOSTS.includes(host), false, 'host do H0 nunca na allowlist de produção');
    assert.equal(STAGING_SUPABASE_HOSTS.includes(host), false, 'host do H0 nunca na allowlist do Beta/Staging');
  }
  assert.equal(STAGING_BRANCHES.includes(H0_BRANCH), false, 'a branch do H0 nunca resolve para o Beta');
  assert.equal([...H0_SUPABASE_HOSTS, ...H0_BRANCHES].some((v) => v.includes('*')), false, 'sem curinga');
  assert.equal(H0_SUPABASE_HOSTS.includes(BETA_HOST), false, 'o domínio do Beta Live nunca aponta para o H0');
});

test('H0 cliente: o host de Preview do H0 só alcança o H0', () => {
  for (const deploymentEnv of ['preview', '']) {
    const fallback = client({ deploymentEnv, host: H0_HOST });
    mustConfigure(fallback, H0_SUPABASE_URL, `H0 fallback (${deploymentEnv || 'env inferido'})`);
    assert.equal(fallback.anonKey, H0_PUBLISHABLE_KEY);
    assert.equal(fallback.origem, 'h0-fallback');
    const explicit = client({ deploymentEnv, host: H0_HOST, envUrl: H0_SUPABASE_URL, envKey: H0_PUBLISHABLE_KEY });
    mustConfigure(explicit, H0_SUPABASE_URL, `H0 explícito (${deploymentEnv || 'env inferido'})`);
    assert.equal(explicit.origem, 'env-h0');
    for (const [name, [envUrl, envKey]] of Object.entries(PAIRS)) {
      mustFailClosed(client({ deploymentEnv, host: H0_HOST, envUrl, envKey }), `H0 recusa par ${name} (${deploymentEnv || 'env inferido'})`);
    }
    mustFailClosed(client({ deploymentEnv, host: H0_HOST, envUrl: H0_SUPABASE_URL }), 'H0 recusa env parcial (só URL)');
    mustFailClosed(client({ deploymentEnv, host: H0_HOST, envKey: H0_PUBLISHABLE_KEY }), 'H0 recusa env parcial (só chave)');
  }
  mustFailClosed(client({ deploymentEnv: 'production', host: H0_HOST }), 'deploy de produção no host do H0');
  mustFailClosed(client({ deploymentEnv: 'production', host: H0_HOST, envUrl: H0_SUPABASE_URL, envKey: H0_PUBLISHABLE_KEY }), 'deploy de produção no host do H0 com par H0');
  mustFailClosed(client({ deploymentEnv: 'production', host: H0_HOST, envUrl: PROD_SUPABASE_URL, envKey: PROD_PUBLISHABLE_KEY }), 'deploy de produção no host do H0 com par de produção');
  mustFailClosed(client({ deploymentEnv: 'development', host: H0_HOST }), 'development não serve o host do H0');
});

test('H0 cliente: o par do H0 nunca é aceito fora do host do H0', () => {
  const targets = [
    ['production', PROD_SUPABASE_HOSTS[0]],
    ['preview', STAGING_SUPABASE_HOSTS[0]],
    ['preview', BETA_HOST],
    ['preview', 'localhost'],
    ['development', 'localhost'],
    ['preview', 'outro-preview.vercel.app'],
    ['preview', `${H0_HOST}.evil.com`],
    ['preview', `evil.${H0_HOST}`],
    ['preview', ''],
  ];
  for (const [deploymentEnv, host] of targets) {
    mustFailClosed(client({ deploymentEnv, host, envUrl: H0_SUPABASE_URL, envKey: H0_PUBLISHABLE_KEY }), `par do H0 recusado em ${deploymentEnv}/${host || 'sem host'}`);
  }
  // O Beta e a produção continuam servidos pelos seus próprios pares, nunca pelo H0.
  mustConfigure(client({ deploymentEnv: 'production', host: PROD_SUPABASE_HOSTS[0] }), PROD_SUPABASE_URL, 'produção continua em produção');
  mustConfigure(client({ deploymentEnv: 'preview', host: BETA_HOST }), STAGING_SUPABASE_URL, 'beta continua em staging');
  mustConfigure(client({ deploymentEnv: 'preview', host: STAGING_SUPABASE_HOSTS[0] }), STAGING_SUPABASE_URL, 'preview de staging continua em staging');
  // Sem o par do H0 informado ao resolvedor, o host do H0 não resolve para projeto nenhum.
  mustFailClosed(resolverConfigSupabase({
    deploymentEnv: 'preview',
    host: H0_HOST,
    prodUrl: PROD_SUPABASE_URL,
    prodKey: PROD_PUBLISHABLE_KEY,
    stagingUrl: STAGING_SUPABASE_URL,
    stagingKey: STAGING_PUBLISHABLE_KEY,
  }), 'host do H0 sem par do H0 configurado');
});

test('H0 servidor: a branch do H0 só resolve para o H0', () => {
  const fallback = server({ vercelEnv: 'preview' });
  mustConfigure(fallback, H0_SUPABASE_URL, 'servidor da branch do H0');
  assert.equal(fallback.publishableKey, H0_PUBLISHABLE_KEY);
  assert.equal(fallback.origem, 'h0-fallback');
  mustConfigure(server({ vercelEnv: 'preview', url: H0_SUPABASE_URL, key: H0_PUBLISHABLE_KEY }), H0_SUPABASE_URL, 'servidor H0 explícito');
  for (const [name, [url, key]] of Object.entries(PAIRS)) {
    mustFailClosed(server({ vercelEnv: 'preview', url, key }), `servidor da branch do H0 recusa par ${name}`);
  }
  assert.equal(server({ vercelEnv: 'preview', url: H0_SUPABASE_URL }).origem, 'invalid-env', 'env parcial falha fechado');
  mustFailClosed(server({ vercelEnv: 'development' }), 'development não usa o fallback do H0');
});

test('H0 servidor: o par do H0 nunca é aceito em Production, Beta ou branch desconhecida', () => {
  mustFailClosed(server({ vercelEnv: 'production', branch: 'main', url: H0_SUPABASE_URL, key: H0_PUBLISHABLE_KEY }), 'production com par do H0');
  mustFailClosed(server({ vercelEnv: 'production', branch: H0_BRANCH, url: H0_SUPABASE_URL, key: H0_PUBLISHABLE_KEY }), 'production na branch do H0 com par do H0');
  for (const branch of STAGING_BRANCHES) {
    mustFailClosed(server({ vercelEnv: 'preview', branch, url: H0_SUPABASE_URL, key: H0_PUBLISHABLE_KEY }), `branch de staging ${branch} com par do H0`);
  }
  mustFailClosed(server({ vercelEnv: 'preview', branch: 'feature/qualquer', url: H0_SUPABASE_URL, key: H0_PUBLISHABLE_KEY }), 'branch desconhecida com par do H0');
  mustFailClosed(server({ vercelEnv: 'preview', branch: 'feature/qualquer' }), 'branch desconhecida sem env');
  mustFailClosed(server({ vercelEnv: 'development', url: H0_SUPABASE_URL, key: H0_PUBLISHABLE_KEY }), 'development com par do H0');
  mustFailClosed(server({ vercelEnv: 'preview', branch: `${H0_BRANCH}-outra` }), 'branch parecida com a do H0 sem env');
  mustFailClosed(server({ vercelEnv: 'preview', branch: H0_BRANCH.toUpperCase() }), 'branch do H0 em caixa diferente');
  mustConfigure(server({ vercelEnv: 'production', branch: 'main' }), PROD_SUPABASE_URL, 'production continua em produção');
  mustConfigure(server({ vercelEnv: 'preview', branch: STAGING_BRANCHES[0] }), STAGING_SUPABASE_URL, 'staging continua em staging');
});

test('H0 auth: confirmação e recuperação de senha voltam à raiz exata do Preview do H0, só em HTTPS', () => {
  assert.equal(resolverRedirectAuth({ origin: `https://${H0_HOST}`, hostname: H0_HOST }), `https://${H0_HOST}/`);
  assert.equal(resolverRedirectAuth({ origin: `http://${H0_HOST}`, hostname: H0_HOST }), '');
  assert.equal(resolverRedirectAuth({ origin: `https://${H0_HOST}.evil.com`, hostname: `${H0_HOST}.evil.com` }), '');
  assert.equal(resolverRedirectAuth({ origin: `https://evil.${H0_HOST}`, hostname: `evil.${H0_HOST}` }), '');
  assert.equal(resolverRedirectAuth({ origin: 'https://outro-preview.vercel.app', hostname: 'outro-preview.vercel.app' }), '');
});

test('H0 CSP: o projeto do H0 entra só em connect-src, wss e img-src, sem curinga', () => {
  const vercel = JSON.parse(fs.readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));
  const csp = vercel.headers.flatMap((h) => h.headers).find((h) => h.key === 'Content-Security-Policy').value;
  const dir = Object.fromEntries(csp.split(';').map((s) => s.trim()).filter(Boolean).map((s) => { const [name, ...values] = s.split(/\s+/); return [name, values]; }));
  assert.ok(dir['connect-src'].includes(`https://${H0_REF}.supabase.co`), 'connect-src https do H0');
  assert.ok(dir['connect-src'].includes(`wss://${H0_REF}.supabase.co`), 'connect-src wss do H0');
  assert.ok(dir['img-src'].includes(`https://${H0_REF}.supabase.co`), 'img-src do H0');
  for (const name of Object.keys(dir)) {
    if (!['connect-src', 'img-src'].includes(name)) assert.equal(dir[name].some((v) => v.includes(H0_REF)), false, `${name} não pode citar o H0`);
  }
  assert.equal(dir['script-src'].some((v) => /^https?:/.test(v)), false, 'nenhum script de terceiro');
});

test('H0 não pode ir para a main nem para Production (bloqueador de merge e de deploy)', () => {
  // Estas guardas, o host de Preview e a CSP existem só na branch de homologação.
  // O CI de um PR para a main e qualquer build de Production falham aqui até o H0 ser removido.
  const env = process.env;
  assert.notEqual(env.GITHUB_BASE_REF, 'main', 'PR com base main: remova as guardas e a CSP do H0 antes de promover');
  assert.notEqual(env.GITHUB_REF_NAME, 'main', 'push na main com as guardas do H0');
  assert.notEqual(env.VERCEL_ENV, 'production', 'build de Production com as guardas do H0');
  assert.notEqual(env.VERCEL_GIT_COMMIT_REF, 'main', 'build da main com as guardas do H0');
});
