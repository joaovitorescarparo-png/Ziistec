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
// Central Técnica V1: Preview da branch de integração, homologada somente contra o H0.
const CT_HOST = 'ziistec-git-claude-central-tecnica-v1-integration-js-connect.vercel.app';
const CT_BRANCH = 'claude/central-tecnica-v1-integration';
// Registrar serviço realizado (0117): Preview da branch do registro retroativo, só contra o H0.
const RS_HOST = 'ziistec-git-claude-retroactive-service-v1-js-connect.vercel.app';
const RS_BRANCH = 'claude/retroactive-service-v1';
const H0_PREVIEWS = [[H0_HOST, H0_BRANCH], [CT_HOST, CT_BRANCH], [RS_HOST, RS_BRANCH]];
// Convenção da Vercel para o host de Preview por branch (projeto ziistec, time js-connect).
const previewHostOf = (branch) => `ziistec-git-${branch.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-js-connect.vercel.app`;
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
  assert.deepEqual([...H0_SUPABASE_HOSTS], [H0_HOST, CT_HOST, RS_HOST], 'o H0 tem exatamente os hosts de Preview previstos');
  assert.deepEqual([...H0_BRANCHES], [H0_BRANCH, CT_BRANCH, RS_BRANCH], 'o H0 tem exatamente as branches previstas');
  assert.ok(Object.isFrozen(H0_SUPABASE_HOSTS) && Object.isFrozen(H0_BRANCHES), 'listas do H0 imutáveis em runtime');
  for (const [host, branch] of H0_PREVIEWS) {
    assert.equal(previewHostOf(branch), host, `host e branch do H0 formam um par exato (${branch})`);
    assert.ok(host.split('.')[0].length <= 63, 'rótulo DNS dentro do limite: a Vercel não trunca nem acrescenta hash ao host');
    assert.equal(STAGING_BRANCHES.includes(branch), false, `a branch ${branch} nunca resolve para o Beta`);
    assert.notEqual(branch, 'main');
  }
  for (const host of H0_SUPABASE_HOSTS) {
    assert.equal(PROD_SUPABASE_HOSTS.includes(host), false, 'host do H0 nunca na allowlist de produção');
    assert.equal(STAGING_SUPABASE_HOSTS.includes(host), false, 'host do H0 nunca na allowlist do Beta/Staging');
  }
  assert.equal(STAGING_BRANCHES.includes(H0_BRANCH), false, 'a branch do H0 nunca resolve para o Beta');
  assert.equal([...H0_SUPABASE_HOSTS, ...H0_BRANCHES].some((v) => v.includes('*')), false, 'sem curinga');
  assert.equal(H0_SUPABASE_HOSTS.some((host) => host === BETA_HOST), false, 'o domínio do Beta Live nunca aponta para o H0');
});

test('H0 cliente: o host de Preview do H0 só alcança o H0', () => {
  for (const [H0_HOST] of H0_PREVIEWS) for (const deploymentEnv of ['preview', '']) {
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
  for (const [H0_HOST] of H0_PREVIEWS) {
    mustFailClosed(client({ deploymentEnv: 'production', host: H0_HOST }), 'deploy de produção no host do H0');
    mustFailClosed(client({ deploymentEnv: 'production', host: H0_HOST, envUrl: H0_SUPABASE_URL, envKey: H0_PUBLISHABLE_KEY }), 'deploy de produção no host do H0 com par H0');
    mustFailClosed(client({ deploymentEnv: 'production', host: H0_HOST, envUrl: PROD_SUPABASE_URL, envKey: PROD_PUBLISHABLE_KEY }), 'deploy de produção no host do H0 com par de produção');
    mustFailClosed(client({ deploymentEnv: 'development', host: H0_HOST }), 'development não serve o host do H0');
  }
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
    ['preview', `${CT_HOST}.evil.com`],
    ['preview', `evil.${CT_HOST}`],
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
  for (const [, branch] of H0_PREVIEWS) {
    const fallback = server({ vercelEnv: 'preview', branch });
    mustConfigure(fallback, H0_SUPABASE_URL, `servidor da branch do H0 (${branch})`);
    assert.equal(fallback.publishableKey, H0_PUBLISHABLE_KEY);
    assert.equal(fallback.origem, 'h0-fallback');
    mustConfigure(server({ vercelEnv: 'preview', branch, url: H0_SUPABASE_URL, key: H0_PUBLISHABLE_KEY }), H0_SUPABASE_URL, 'servidor H0 explícito');
    for (const [name, [url, key]] of Object.entries(PAIRS)) {
      mustFailClosed(server({ vercelEnv: 'preview', branch, url, key }), `servidor da branch do H0 (${branch}) recusa par ${name}`);
    }
    assert.equal(server({ vercelEnv: 'preview', branch, url: H0_SUPABASE_URL }).origem, 'invalid-env', 'env parcial falha fechado');
    assert.equal(server({ vercelEnv: 'preview', branch, key: H0_PUBLISHABLE_KEY }).origem, 'invalid-env', 'env parcial (só chave) falha fechado');
    mustFailClosed(server({ vercelEnv: 'development', branch }), 'development não usa o fallback do H0');
  }
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
  mustFailClosed(server({ vercelEnv: 'production', branch: CT_BRANCH, url: H0_SUPABASE_URL, key: H0_PUBLISHABLE_KEY }), 'production na branch da Central Técnica com par do H0');
  mustConfigure(server({ vercelEnv: 'production', branch: 'main' }), PROD_SUPABASE_URL, 'production continua em produção');
  mustConfigure(server({ vercelEnv: 'preview', branch: STAGING_BRANCHES[0] }), STAGING_SUPABASE_URL, 'staging continua em staging');
});

test('H0 auth: confirmação e recuperação de senha voltam à raiz exata do Preview do H0, só em HTTPS', () => {
  for (const [H0_HOST] of H0_PREVIEWS) {
    assert.equal(resolverRedirectAuth({ origin: `https://${H0_HOST}`, hostname: H0_HOST }), `https://${H0_HOST}/`);
    assert.equal(resolverRedirectAuth({ origin: `https://${H0_HOST}/qualquer/caminho?x=1#y`, hostname: H0_HOST }), `https://${H0_HOST}/`);
    assert.equal(resolverRedirectAuth({ origin: `http://${H0_HOST}`, hostname: H0_HOST }), '');
    assert.equal(resolverRedirectAuth({ origin: `https://${H0_HOST}.evil.com`, hostname: `${H0_HOST}.evil.com` }), '');
    assert.equal(resolverRedirectAuth({ origin: `https://evil.${H0_HOST}`, hostname: `evil.${H0_HOST}` }), '');
    assert.equal(resolverRedirectAuth({ origin: 'https://evil.com', hostname: H0_HOST }), '', 'hostname declarado não substitui a origem real');
  }
  assert.equal(resolverRedirectAuth({ origin: 'https://outro-preview.vercel.app', hostname: 'outro-preview.vercel.app' }), '');
});

// ---------------------------------------------------------------------------------------------------------------------
// Central Técnica V1 — o Preview da branch de integração fala SOMENTE com o H0 (security fix antes da 1ª aplicação no H0).
// Antes deste par existir, cliente e servidor resolviam configurado=false nesse Preview e a homologação não tinha onde rodar.
// ---------------------------------------------------------------------------------------------------------------------
test('Central Técnica Preview + par do H0: configurado (cliente e servidor)', () => {
  for (const deploymentEnv of ['preview', '']) {
    const fallback = client({ deploymentEnv, host: CT_HOST });
    mustConfigure(fallback, H0_SUPABASE_URL, 'cliente Central Técnica (fallback)');
    assert.equal(fallback.anonKey, H0_PUBLISHABLE_KEY);
    assert.equal(fallback.origem, 'h0-fallback');
    assert.equal(fallback.hostH0, true);
    const explicit = client({ deploymentEnv, host: CT_HOST, envUrl: H0_SUPABASE_URL, envKey: H0_PUBLISHABLE_KEY });
    mustConfigure(explicit, H0_SUPABASE_URL, 'cliente Central Técnica (par explícito)');
    assert.equal(explicit.origem, 'env-h0');
  }
  mustConfigure(client({ deploymentEnv: 'preview', host: CT_HOST.toUpperCase() }), H0_SUPABASE_URL, 'host é comparado sem diferenciar caixa (DNS)');
  const srv = server({ vercelEnv: 'preview', branch: CT_BRANCH });
  mustConfigure(srv, H0_SUPABASE_URL, 'servidor Central Técnica (fallback)');
  assert.equal(srv.publishableKey, H0_PUBLISHABLE_KEY);
  mustConfigure(server({ vercelEnv: 'preview', branch: CT_BRANCH, url: H0_SUPABASE_URL, key: H0_PUBLISHABLE_KEY }), H0_SUPABASE_URL, 'servidor Central Técnica (par explícito)');
  // Cliente e servidor do mesmo Preview apontam para o MESMO projeto.
  assert.equal(client({ deploymentEnv: 'preview', host: CT_HOST }).url, srv.url);
});

test('Central Técnica Preview + par de Production: falha fechada', () => {
  mustFailClosed(client({ deploymentEnv: 'preview', host: CT_HOST, envUrl: PROD_SUPABASE_URL, envKey: PROD_PUBLISHABLE_KEY }), 'cliente CT com par de produção');
  mustFailClosed(client({ deploymentEnv: '', host: CT_HOST, envUrl: PROD_SUPABASE_URL, envKey: PROD_PUBLISHABLE_KEY }), 'cliente CT (env inferido) com par de produção');
  mustFailClosed(server({ vercelEnv: 'preview', branch: CT_BRANCH, url: PROD_SUPABASE_URL, key: PROD_PUBLISHABLE_KEY }), 'servidor CT com par de produção');
});

test('Central Técnica Preview + par de Staging/Beta: falha fechada', () => {
  mustFailClosed(client({ deploymentEnv: 'preview', host: CT_HOST, envUrl: STAGING_SUPABASE_URL, envKey: STAGING_PUBLISHABLE_KEY }), 'cliente CT com par do Beta');
  mustFailClosed(server({ vercelEnv: 'preview', branch: CT_BRANCH, url: STAGING_SUPABASE_URL, key: STAGING_PUBLISHABLE_KEY }), 'servidor CT com par do Beta');
  // pares cruzados (URL de um projeto, chave de outro) também
  for (const [name, [url, key]] of Object.entries(PAIRS)) {
    mustFailClosed(client({ deploymentEnv: 'preview', host: CT_HOST, envUrl: url, envKey: key }), `cliente CT recusa par ${name}`);
    mustFailClosed(server({ vercelEnv: 'preview', branch: CT_BRANCH, url, key }), `servidor CT recusa par ${name}`);
  }
  assert.equal(STAGING_SUPABASE_HOSTS.includes(CT_HOST) || PROD_SUPABASE_HOSTS.includes(CT_HOST), false);
});

test('Central Técnica: env incompleto é erro, nunca fallback', () => {
  for (const partial of [{ envUrl: H0_SUPABASE_URL }, { envKey: H0_PUBLISHABLE_KEY }, { envUrl: PROD_SUPABASE_URL }, { envKey: STAGING_PUBLISHABLE_KEY }]) {
    const result = client({ deploymentEnv: 'preview', host: CT_HOST, ...partial });
    mustFailClosed(result, 'cliente CT com env parcial');
    assert.equal(result.origem, 'invalid-env');
    assert.equal(result.envIncompleto, true);
  }
  assert.equal(server({ vercelEnv: 'preview', branch: CT_BRANCH, url: H0_SUPABASE_URL }).origem, 'invalid-env');
  assert.equal(server({ vercelEnv: 'preview', branch: CT_BRANCH, key: H0_PUBLISHABLE_KEY }).origem, 'invalid-env');
  // sem o par do H0 embutido no build, o host da Central Técnica não resolve para projeto nenhum
  mustFailClosed(resolverConfigSupabase({
    deploymentEnv: 'preview', host: CT_HOST,
    prodUrl: PROD_SUPABASE_URL, prodKey: PROD_PUBLISHABLE_KEY,
    stagingUrl: STAGING_SUPABASE_URL, stagingKey: STAGING_PUBLISHABLE_KEY,
  }), 'host CT sem par do H0 configurado');
  mustFailClosed(resolverConfigSupabase({
    deploymentEnv: 'preview', host: CT_HOST, h0Url: H0_SUPABASE_URL,
    prodUrl: PROD_SUPABASE_URL, prodKey: PROD_PUBLISHABLE_KEY,
    stagingUrl: STAGING_SUPABASE_URL, stagingKey: STAGING_PUBLISHABLE_KEY,
  }), 'host CT com par do H0 pela metade');
});

test('Host de Production + par do H0: falha fechada; main/production nunca resolvem para o H0', () => {
  for (const host of PROD_SUPABASE_HOSTS) {
    for (const deploymentEnv of ['production', 'preview', '']) {
      mustFailClosed(client({ deploymentEnv, host, envUrl: H0_SUPABASE_URL, envKey: H0_PUBLISHABLE_KEY }), `host de produção ${host} (${deploymentEnv || 'env inferido'}) com par do H0`);
    }
    const prod = client({ deploymentEnv: 'production', host });
    mustConfigure(prod, PROD_SUPABASE_URL, `host de produção ${host} segue em produção`);
    assert.notEqual(prod.url, H0_SUPABASE_URL);
  }
  for (const host of STAGING_SUPABASE_HOSTS) {
    mustFailClosed(client({ deploymentEnv: 'preview', host, envUrl: H0_SUPABASE_URL, envKey: H0_PUBLISHABLE_KEY }), `host do Beta ${host} com par do H0`);
    mustConfigure(client({ deploymentEnv: 'preview', host }), STAGING_SUPABASE_URL, `host do Beta ${host} segue no Beta`);
  }
  // build de Production no host da Central Técnica: nada de H0, com ou sem env
  mustFailClosed(client({ deploymentEnv: 'production', host: CT_HOST }), 'production no host CT');
  mustFailClosed(client({ deploymentEnv: 'production', host: CT_HOST, envUrl: H0_SUPABASE_URL, envKey: H0_PUBLISHABLE_KEY }), 'production no host CT com par do H0');
  mustFailClosed(client({ deploymentEnv: 'production', host: CT_HOST, envUrl: PROD_SUPABASE_URL, envKey: PROD_PUBLISHABLE_KEY }), 'production no host CT com par de produção');
  mustFailClosed(client({ deploymentEnv: 'development', host: CT_HOST }), 'development no host CT');

  // servidor: main e qualquer deploy de Production
  for (const branch of ['main', CT_BRANCH, H0_BRANCH, 'feature/qualquer', '']) {
    mustFailClosed(server({ vercelEnv: 'production', branch, url: H0_SUPABASE_URL, key: H0_PUBLISHABLE_KEY }), `production (${branch || 'sem branch'}) com par do H0`);
    const prod = server({ vercelEnv: 'production', branch });
    mustConfigure(prod, PROD_SUPABASE_URL, `production (${branch || 'sem branch'}) resolve só para produção`);
    assert.notEqual(prod.url, H0_SUPABASE_URL);
  }
  mustFailClosed(server({ vercelEnv: 'preview', branch: 'main' }), 'preview da main não resolve para projeto nenhum');
  mustFailClosed(server({ vercelEnv: 'preview', branch: 'main', url: H0_SUPABASE_URL, key: H0_PUBLISHABLE_KEY }), 'preview da main com par do H0');
  assert.equal(H0_BRANCHES.includes('main'), false);
  assert.equal(H0_SUPABASE_HOSTS.some((host) => PROD_SUPABASE_HOSTS.includes(host)), false);
});

test('Central Técnica: host ou branch parecido/malicioso falha fechado (igualdade exata, sem substring)', () => {
  const lookalikeHosts = [
    `${CT_HOST}.evil.com`,
    `evil.${CT_HOST}`,
    `${CT_HOST}.`,
    `${CT_HOST}:443`,
    `${CT_HOST}/`,
    `${CT_HOST}@evil.com`,
    `evil.com/${CT_HOST}`,
    `evil.com#${CT_HOST}`,
    CT_HOST.replace('.vercel.app', '.vercel.app.evil.com'),
    CT_HOST.replace('.vercel.app', '.vercel.com'),
    CT_HOST.replace('.vercel.app', '-vercel.app'),
    CT_HOST.replace('ziistec-git-', 'ziistec-git-x-'),
    CT_HOST.replace('ziistec-git-', 'xziistec-git-'),
    CT_HOST.replace('-integration-', '-integration2-'),
    CT_HOST.replace('-integration-', '-'),
    CT_HOST.replace('-js-connect', '-evil-team'),
    CT_HOST.replace('central-tecnica', 'central-tecnlca'),
    CT_HOST.replace('central-tecnica', 'central-técnica'),
    // Previews de outras branches da mesma frente NÃO são H0: só a branch de integração é homologada.
    'ziistec-git-claude-central-tech-security-fix-v1-js-connect.vercel.app',
    'ziistec-git-claude-operations-dispatch-v1-js-connect.vercel.app',
    'ziistec-git-claude-central-tecnica-v1-js-connect.vercel.app',
    'ziistec-abc123-js-connect.vercel.app',
    'localhost',
    '',
  ];
  for (const host of lookalikeHosts) {
    assert.equal(H0_SUPABASE_HOSTS.includes(host), false, `${host} não é host do H0`);
    for (const deploymentEnv of ['preview', '']) {
      const explicit = client({ deploymentEnv, host, envUrl: H0_SUPABASE_URL, envKey: H0_PUBLISHABLE_KEY });
      mustFailClosed(explicit, `host parecido ${host || '(vazio)'} com par do H0`);
      const fallback = client({ deploymentEnv, host });
      assert.notEqual(fallback.url, H0_SUPABASE_URL, `host parecido ${host || '(vazio)'} nunca cai no H0 por fallback`);
      assert.notEqual(fallback.origem, 'h0-fallback');
    }
    assert.equal(resolverRedirectAuth({ origin: `https://${host}`, hostname: host }), '', `auth não redireciona para ${host || '(vazio)'}`);
  }

  const lookalikeBranches = [
    `${CT_BRANCH}-outra`,
    `${CT_BRANCH}/x`,
    `x/${CT_BRANCH}`,
    ` ${CT_BRANCH}x`,
    CT_BRANCH.toUpperCase(),
    CT_BRANCH.replace('claude/', ''),
    CT_BRANCH.replace('claude/', 'claude-'),
    CT_BRANCH.replace('claude/', 'codex/'),
    CT_BRANCH.replace('-integration', ''),
    'refs/heads/' + CT_BRANCH,
    'claude/central-tech-security-fix-v1',
    'claude/operations-dispatch-v1',
    'main',
    '',
  ];
  for (const branch of lookalikeBranches) {
    assert.equal(H0_BRANCHES.includes(branch), false, `${branch} não é branch do H0`);
    mustFailClosed(server({ vercelEnv: 'preview', branch, url: H0_SUPABASE_URL, key: H0_PUBLISHABLE_KEY }), `branch parecida ${branch || '(vazia)'} com par do H0`);
    const fallback = server({ vercelEnv: 'preview', branch });
    assert.notEqual(fallback.url, H0_SUPABASE_URL, `branch parecida ${branch || '(vazia)'} nunca cai no H0 por fallback`);
  }
});

test('Guardas de ambiente comparam por igualdade em lista fechada (sem includes de substring, startsWith, endsWith ou regex)', () => {
  const clientSrc = fs.readFileSync(new URL('../../src/lib/supabaseConfig.js', import.meta.url), 'utf8');
  const serverSrc = fs.readFileSync(new URL('../../api/_supabaseServerConfig.js', import.meta.url), 'utf8');
  for (const [name, src] of [['cliente', clientSrc], ['servidor', serverSrc]]) {
    assert.equal(/\.(startsWith|endsWith|indexOf|match|search|test)\(/.test(src), false, `${name}: sem comparação parcial`);
    assert.equal(/new RegExp|\*\./.test(src), false, `${name}: sem curinga`);
  }
  assert.match(clientSrc, /const hostH0 = H0_SUPABASE_HOSTS\.includes\(cleanHost\);/);
  assert.match(serverSrc, /const isH0Preview = vercelEnv === 'preview' && H0_BRANCHES\.includes\(gitBranch\);/);
  assert.match(clientSrc, /const h0Context = effectiveEnv === "preview" && hostH0;/);
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
