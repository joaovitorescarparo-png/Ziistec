/*
  Isolamento de ambiente — o contrato final: dois projetos Supabase, nada mais.

  Production fala só com Production. Beta/Staging fala só com o Beta. Qualquer
  outro Preview não fala com projeto nenhum. Não existe mais um terceiro
  ambiente (o H0 de homologação descartável), e este arquivo é o que impede ele
  de voltar por acidente: prova que o project ref dele não aparece em nenhum
  arquivo de runtime, config ou build.

  Este arquivo substitui o h0_environment_isolation.test.mjs, que afirmava o
  contrário — que qualquer build de Production DEVIA falhar enquanto o H0
  existisse. Aquele contrato cumpriu o papel dele: barrou a promoção acidental
  do H0 para a main. Com o H0 removido, o contrato que vale é este.

  Duas travas independentes continuam valendo, e os testes abaixo exigem que as
  duas concordem:
    1. o resolvedor (cliente e servidor) decide COM QUEM falar;
    2. a CSP por ambiente decide com quem o navegador PERMITE falar.
*/

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PROD_SUPABASE_HOSTS, STAGING_SUPABASE_HOSTS, resolverConfigSupabase } from '../../src/lib/supabaseConfig.js';
import { resolverRedirectAuth } from '../../src/lib/authRedirect.js';
import {
  PROD_SUPABASE_URL, PROD_PUBLISHABLE_KEY,
  STAGING_SUPABASE_URL, STAGING_PUBLISHABLE_KEY,
  STAGING_BRANCH, STAGING_BRANCHES,
  resolverSupabaseServidor,
} from '../../api/_supabaseServerConfig.js';
import { ambienteDoDeploy, politicaCspDoAmbiente, metaCspDoAmbiente } from '../../scripts/csp-environment.mjs';

const H0_REF_REMOVIDO = 'auojcljfahhpkfqqbygd';
const PROD_REF = 'diztevlpbcfqleizswxr';
const BETA_REF = 'xadoktssibuuebzzjrhv';

/* Os hosts e branches que eram do H0. Agora são Preview comum: não resolvem
   para projeto nenhum. Ficam nomeados aqui de propósito, para o teste provar
   que perderam o privilégio em vez de só não mencionar o assunto. */
const EX_H0 = [
  ['ziistec-git-claude-blocks34-port-beta-v1-js-connect.vercel.app', 'claude/blocks34-port-beta-v1'],
  ['ziistec-git-claude-central-tecnica-v1-integration-js-connect.vercel.app', 'claude/central-tecnica-v1-integration'],
  ['ziistec-git-claude-retroactive-service-v1-js-connect.vercel.app', 'claude/retroactive-service-v1'],
  ['ziistec-git-claude-operations-simple-v2-js-connect.vercel.app', 'claude/operations-simple-v2'],
];

const RUNTIME_E_CONFIG = [
  'src/lib/supabaseConfig.js',
  'src/lib/supabase.js',
  'src/lib/authRedirect.js',
  'api/_supabaseServerConfig.js',
  'scripts/csp-environment.mjs',
  'vercel.json',
];

const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

const INVALID_URL = 'https://projeto-errado.supabase.co';
const INVALID_KEY = 'sb_publishable_invalid_test';

const client = ({ deploymentEnv, host, envUrl = '', envKey = '' }) => resolverConfigSupabase({
  deploymentEnv, host, envUrl, envKey,
  prodUrl: PROD_SUPABASE_URL, prodKey: PROD_PUBLISHABLE_KEY,
  stagingUrl: STAGING_SUPABASE_URL, stagingKey: STAGING_PUBLISHABLE_KEY,
});

const server = ({ vercelEnv, branch = '', url = '', key = '' }) => resolverSupabaseServidor({
  VERCEL_ENV: vercelEnv, VERCEL_GIT_COMMIT_REF: branch,
  SUPABASE_URL: url, SUPABASE_PUBLISHABLE_KEY: key,
});

const mustConfigure = (r, url, label) => {
  assert.equal(r.configurado, true, `${label}: deveria configurar`);
  assert.equal(r.url, url, `${label}: projeto errado`);
};
const mustFailClosed = (r, label) => {
  assert.equal(r.configurado, false, `${label}: deveria falhar fechado`);
  assert.equal(r.url, '', `${label}: não pode devolver URL`);
};

const diretivas = (politica) => Object.fromEntries(
  politica.split(';').map((s) => s.trim()).filter(Boolean)
    .map((s) => { const [nome, ...valores] = s.split(/\s+/); return [nome, valores]; }),
);
const conexoesDe = (vercelEnv, branch) => diretivas(politicaCspDoAmbiente({ vercelEnv, branch }).politica)['connect-src'];
const imagensDe = (vercelEnv, branch) => diretivas(politicaCspDoAmbiente({ vercelEnv, branch }).politica)['img-src'];
const wss = (url) => url.replace('https:', 'wss:');

/* Pares cruzados: URL de um projeto com a chave de outro, e pares inválidos.
   Nenhum deles pode ser aceito em ambiente nenhum. */
const PARES_INVALIDOS = {
  'prod-url + beta-key': [PROD_SUPABASE_URL, STAGING_PUBLISHABLE_KEY],
  'beta-url + prod-key': [STAGING_SUPABASE_URL, PROD_PUBLISHABLE_KEY],
  'url desconhecida': [INVALID_URL, INVALID_KEY],
  'prod-url + chave inválida': [PROD_SUPABASE_URL, INVALID_KEY],
  'beta-url + chave inválida': [STAGING_SUPABASE_URL, INVALID_KEY],
};

// ─────────────────────────── 1. o H0 não existe mais no código entregue

test('O projeto do H0 não aparece em runtime, config ou build', () => {
  for (const arquivo of RUNTIME_E_CONFIG) {
    const src = read(arquivo);
    assert.equal(src.includes(H0_REF_REMOVIDO), false, `${arquivo} não cita o projeto do H0`);
    for (const simbolo of ['H0_SUPABASE_HOSTS', 'H0_BRANCHES', 'H0_SUPABASE_URL', 'H0_PUBLISHABLE_KEY',
      'h0Url', 'h0Key', 'hostH0', 'h0Context', 'exactH0Pair', 'isH0Preview', 'isExactH0Pair',
      'env-h0', 'h0-fallback']) {
      assert.equal(src.includes(simbolo), false, `${arquivo} não tem ${simbolo}`);
    }
  }
  // e a CSP estática cita exatamente dois projetos
  const csp = diretivas(JSON.parse(read('vercel.json')).headers
    .flatMap((h) => h.headers).find((h) => h.key === 'Content-Security-Policy').value);
  const externos = (valores) => valores.filter((v) => !v.startsWith("'") && !['data:', 'blob:'].includes(v));
  const refs = new Set(externos(csp['connect-src']).concat(externos(csp['img-src']))
    .map((v) => v.replace(/^(https|wss):\/\//, '').replace('.supabase.co', '')));
  assert.deepEqual([...refs].sort(), [PROD_REF, BETA_REF].sort(), 'só Production e Beta na CSP estática');
});

test('Nenhum teste do gate exige mais que um build de Production falhe', () => {
  const dir = new URL('../blockers/', import.meta.url);
  const esteArquivo = 'environment_isolation.test.mjs';
  for (const nome of fs.readdirSync(dir)) {
    // este arquivo cita os padrões para proibi-los; os outros não podem citá-los
    if (!nome.endsWith('.test.mjs') || nome === esteArquivo) continue;
    const src = fs.readFileSync(new URL(nome, dir), 'utf8');
    for (const padrao of ["notEqual(env.VERCEL_ENV", "notEqual(process.env.VERCEL_ENV",
      "notEqual(env.GITHUB_REF_NAME", "notEqual(env.VERCEL_GIT_COMMIT_REF"]) {
      assert.equal(src.includes(padrao), false, `${nome}: bloqueador de promoção não pode voltar`);
    }
  }
  assert.equal(fs.existsSync(new URL('h0_environment_isolation.test.mjs', dir)), false,
    'o contrato antigo do H0 foi removido');
});

// ─────────────────────────── 2. Production

test('Production (VERCEL_ENV=production, branch main): só Production, nas duas travas', () => {
  // servidor
  for (const branch of ['main', '', 'qualquer-outra']) {
    const srv = server({ vercelEnv: 'production', branch });
    mustConfigure(srv, PROD_SUPABASE_URL, `servidor production (${branch || 'sem branch'})`);
    assert.equal(srv.origem, 'production-fallback');
    assert.equal(srv.publishableKey, PROD_PUBLISHABLE_KEY);
    mustConfigure(server({ vercelEnv: 'production', branch, url: PROD_SUPABASE_URL, key: PROD_PUBLISHABLE_KEY }),
      PROD_SUPABASE_URL, `servidor production com par exato (${branch || 'sem branch'})`);
  }
  // cliente, em cada host oficial de Production
  for (const host of PROD_SUPABASE_HOSTS) {
    const prod = client({ deploymentEnv: 'production', host });
    mustConfigure(prod, PROD_SUPABASE_URL, `cliente no host ${host}`);
    assert.equal(prod.origem, 'production-fallback');
    assert.equal(prod.hostProducao, true);
    // host de Production também é reconhecido sem VERCEL_ENV e sem diferenciar caixa (DNS)
    mustConfigure(client({ deploymentEnv: '', host }), PROD_SUPABASE_URL, `${host} sem env declarado`);
    mustConfigure(client({ deploymentEnv: 'production', host: host.toUpperCase() }), PROD_SUPABASE_URL, `${host} em maiúsculas`);
  }
  // CSP: Production e só Production
  const conexoes = conexoesDe('production', 'main');
  assert.deepEqual(conexoes, ["'self'", PROD_SUPABASE_URL, wss(PROD_SUPABASE_URL)]);
  assert.deepEqual(imagensDe('production', 'main'), ["'self'", 'data:', 'blob:', PROD_SUPABASE_URL]);
  assert.equal(conexoes.includes(STAGING_SUPABASE_URL), false, 'Production não alcança o Beta');
  assert.equal(ambienteDoDeploy({ vercelEnv: 'production', branch: 'main' }).ambiente, 'production');
  assert.equal(politicaCspDoAmbiente({ vercelEnv: 'production', branch: 'main' }).politica.includes(H0_REF_REMOVIDO), false);
});

test('Production recusa par de outro projeto e env pela metade', () => {
  for (const [nome, [url, key]] of Object.entries(PARES_INVALIDOS)) {
    mustFailClosed(server({ vercelEnv: 'production', branch: 'main', url, key }), `servidor production recusa ${nome}`);
    for (const host of PROD_SUPABASE_HOSTS) {
      mustFailClosed(client({ deploymentEnv: 'production', host, envUrl: url, envKey: key }), `cliente production recusa ${nome}`);
    }
  }
  // par do Beta em Production é recusado explicitamente
  mustFailClosed(client({ deploymentEnv: 'production', host: PROD_SUPABASE_HOSTS[0], envUrl: STAGING_SUPABASE_URL, envKey: STAGING_PUBLISHABLE_KEY }), 'cliente production com par do Beta');
  mustFailClosed(server({ vercelEnv: 'production', branch: 'main', url: STAGING_SUPABASE_URL, key: STAGING_PUBLISHABLE_KEY }), 'servidor production com par do Beta');
  // env parcial nunca cai em fallback: é erro
  for (const parcial of [{ envUrl: PROD_SUPABASE_URL }, { envKey: PROD_PUBLISHABLE_KEY }]) {
    const r = client({ deploymentEnv: 'production', host: PROD_SUPABASE_HOSTS[0], ...parcial });
    mustFailClosed(r, 'cliente production com env parcial');
    assert.equal(r.origem, 'invalid-env');
    assert.equal(r.envIncompleto, true);
  }
  assert.equal(server({ vercelEnv: 'production', branch: 'main', url: PROD_SUPABASE_URL }).origem, 'invalid-env');
  assert.equal(server({ vercelEnv: 'production', branch: 'main', key: PROD_PUBLISHABLE_KEY }).origem, 'invalid-env');
});

// ─────────────────────────── 3. Beta/Staging

test('Preview allowlisted: só o Beta, nas duas travas', () => {
  for (const branch of STAGING_BRANCHES) {
    const srv = server({ vercelEnv: 'preview', branch });
    mustConfigure(srv, STAGING_SUPABASE_URL, `servidor preview ${branch}`);
    assert.equal(srv.origem, 'staging-fallback');
    const conexoes = conexoesDe('preview', branch);
    assert.deepEqual(conexoes, ["'self'", STAGING_SUPABASE_URL, wss(STAGING_SUPABASE_URL)], `CSP de ${branch}`);
    assert.equal(conexoes.includes(PROD_SUPABASE_URL), false, `${branch} não alcança Production`);
    assert.equal(ambienteDoDeploy({ vercelEnv: 'preview', branch }).ambiente, 'staging');
  }
  for (const host of STAGING_SUPABASE_HOSTS) {
    mustConfigure(client({ deploymentEnv: 'preview', host }), STAGING_SUPABASE_URL, `cliente no host ${host}`);
    // e nunca aceita o par de Production
    mustFailClosed(client({ deploymentEnv: 'preview', host, envUrl: PROD_SUPABASE_URL, envKey: PROD_PUBLISHABLE_KEY }), `host do Beta ${host} com par de Production`);
  }
  assert.ok(STAGING_BRANCHES.includes(STAGING_BRANCH), 'a branch canônica de staging está na allowlist');
  // listas disjuntas: nenhum host serve dois ambientes
  assert.equal(PROD_SUPABASE_HOSTS.some((h) => STAGING_SUPABASE_HOSTS.includes(h)), false);
});

// ─────────────────────────── 4. Preview desconhecido e os ex-hosts do H0

test('Preview desconhecido: unconfigured e CSP sem Supabase externo', () => {
  const desconhecidos = ['main', 'feature/qualquer', 'claude/alguma-coisa', 'refs/heads/main', ''];
  for (const branch of desconhecidos) {
    mustFailClosed(server({ vercelEnv: 'preview', branch }), `servidor preview ${branch || '(vazio)'}`);
    assert.equal(server({ vercelEnv: 'preview', branch }).origem, 'unconfigured');
    assert.deepEqual(conexoesDe('preview', branch), ["'self'"], `CSP de ${branch || '(vazio)'} sem projeto`);
    assert.deepEqual(imagensDe('preview', branch), ["'self'", 'data:', 'blob:']);
    assert.equal(ambienteDoDeploy({ vercelEnv: 'preview', branch }).ambiente, 'preview-sem-projeto');
    // nem com par explícito de um projeto conhecido
    mustFailClosed(server({ vercelEnv: 'preview', branch, url: PROD_SUPABASE_URL, key: PROD_PUBLISHABLE_KEY }), `preview ${branch || '(vazio)'} com par de Production`);
    mustFailClosed(server({ vercelEnv: 'preview', branch, url: STAGING_SUPABASE_URL, key: STAGING_PUBLISHABLE_KEY }), `preview ${branch || '(vazio)'} com par do Beta`);
  }
  // host desconhecido no cliente: nunca cai em Production por fallback
  for (const host of ['ziistec-qualquer-outra.vercel.app', 'ziistec-abc123-js-connect.vercel.app', 'localhost', '']) {
    for (const deploymentEnv of ['preview', '']) {
      const r = client({ deploymentEnv, host });
      mustFailClosed(r, `host desconhecido ${host || '(vazio)'} (${deploymentEnv || 'env inferido'})`);
      assert.notEqual(r.url, PROD_SUPABASE_URL);
    }
  }
});

test('Os hosts e branches que eram do H0 perderam o privilégio', () => {
  for (const [host, branch] of EX_H0) {
    assert.equal(PROD_SUPABASE_HOSTS.includes(host), false, `${host} não é host de Production`);
    assert.equal(STAGING_SUPABASE_HOSTS.includes(host), false, `${host} não é host do Beta`);
    assert.equal(STAGING_BRANCHES.includes(branch), false, `${branch} não é branch do Beta`);
    for (const deploymentEnv of ['preview', '', 'production']) {
      mustFailClosed(client({ deploymentEnv, host }), `ex-host do H0 ${host} (${deploymentEnv || 'env inferido'})`);
    }
    mustFailClosed(server({ vercelEnv: 'preview', branch }), `ex-branch do H0 ${branch}`);
    assert.deepEqual(conexoesDe('preview', branch), ["'self'"], `CSP de ${branch} sem projeto`);
    assert.equal(ambienteDoDeploy({ vercelEnv: 'preview', branch }).ambiente, 'preview-sem-projeto');
    // auth: nem redireciona mais para lá
    assert.equal(resolverRedirectAuth({ origin: `https://${host}`, hostname: host }), '', `auth não volta para ${host}`);
  }
});

// ─────────────────────────── 5. development e build local

test('Development segue o contrato atual, e o build local não injeta política', () => {
  // O contrato existente não dá fallback a development: sem o par exato do Beta
  // declarado no ambiente, o servidor falha fechado. Isto não muda aqui.
  mustFailClosed(server({ vercelEnv: 'development' }), 'servidor development sem par');
  assert.equal(server({ vercelEnv: 'development' }).origem, 'unconfigured');
  const comPar = server({ vercelEnv: 'development', url: STAGING_SUPABASE_URL, key: STAGING_PUBLISHABLE_KEY });
  mustConfigure(comPar, STAGING_SUPABASE_URL, 'servidor development com par exato do Beta');
  assert.equal(comPar.origem, 'env-development-staging');
  mustFailClosed(server({ vercelEnv: 'development', url: PROD_SUPABASE_URL, key: PROD_PUBLISHABLE_KEY }), 'development com par de Production');
  assert.equal(ambienteDoDeploy({ vercelEnv: 'development', branch: '' }).ambiente, 'development');
  assert.deepEqual(conexoesDe('development', ''), ["'self'", STAGING_SUPABASE_URL, wss(STAGING_SUPABASE_URL)]);
  // servidor de desenvolvimento do Vite: sem VERCEL_ENV não há política a injetar
  assert.equal(politicaCspDoAmbiente({ servidorDev: true }), null);
  assert.equal(metaCspDoAmbiente({ servidorDev: true }), '');
  assert.equal(ambienteDoDeploy({ servidorDev: true }).ambiente, 'local');
  // build fora da Vercel (Hostinger) é o site publicado: fail-closed para Production e só Production
  assert.equal(ambienteDoDeploy({}).ambiente, 'production-static');
  assert.deepEqual(diretivas(politicaCspDoAmbiente({}).politica)['connect-src'], ["'self'", PROD_SUPABASE_URL, wss(PROD_SUPABASE_URL)]);
  assert.equal(politicaCspDoAmbiente({}).politica.includes(BETA_REF), false);
});

// ─────────────────────────── 6. comparação por igualdade, sem curinga

test('As guardas comparam por igualdade em lista fechada, sem curinga nem comparação parcial', () => {
  for (const arquivo of ['src/lib/supabaseConfig.js', 'api/_supabaseServerConfig.js']) {
    const src = read(arquivo);
    assert.equal(/\.(startsWith|endsWith|indexOf|match|search|test)\(/.test(src), false, `${arquivo}: sem comparação parcial`);
    assert.equal(/new RegExp/.test(src), false, `${arquivo}: sem expressão regular`);
    assert.equal(src.includes('*.'), false, `${arquivo}: sem curinga de domínio`);
  }
  assert.match(read('src/lib/supabaseConfig.js'), /const hostProducao = PROD_SUPABASE_HOSTS\.includes\(cleanHost\);/);
  assert.match(read('src/lib/supabaseConfig.js'), /const hostStaging = STAGING_SUPABASE_HOSTS\.includes\(cleanHost\);/);
  assert.match(read('api/_supabaseServerConfig.js'), /const isStagingPreview = vercelEnv === 'preview' && STAGING_BRANCHES\.includes\(gitBranch\);/);
});

test('Host ou branch parecido falha fechado (igualdade exata, sem substring)', () => {
  const oficial = PROD_SUPABASE_HOSTS[0];
  const parecidos = [
    `${oficial}.evil.com`, `evil.${oficial}`, `${oficial}.`, `${oficial}:443`, `${oficial}/`,
    `${oficial}@evil.com`, `evil.com/${oficial}`, `evil.com#${oficial}`,
    oficial.replace('.vercel.app', '.vercel.app.evil.com'),
    oficial.replace('.vercel.app', '.vercel.com'),
    oficial.replace('.vercel.app', '-vercel.app'),
    oficial.replace('ziistec', 'ziistecx'),
    oficial.replace('ziistec', 'xziistec'),
  ];
  for (const host of parecidos) {
    assert.equal(PROD_SUPABASE_HOSTS.includes(host), false, `${host} não é host de Production`);
    assert.equal(STAGING_SUPABASE_HOSTS.includes(host), false, `${host} não é host do Beta`);
    for (const deploymentEnv of ['production', 'preview', '']) {
      const r = client({ deploymentEnv, host });
      mustFailClosed(r, `host parecido ${host} (${deploymentEnv || 'env inferido'})`);
      assert.notEqual(r.url, PROD_SUPABASE_URL, `${host} nunca cai em Production por fallback`);
    }
    assert.equal(resolverRedirectAuth({ origin: `https://${host}`, hostname: host }), '', `auth não redireciona para ${host}`);
  }

  const branchOficial = STAGING_BRANCHES[0];
  // nota: espaço em volta não entra na lista — o resolvedor faz trim(), então
  // ` product-v2-review` é a mesma branch, e isso é o comportamento desejado.
  for (const branch of [`${branchOficial}-outra`, `${branchOficial}/x`, `x/${branchOficial}`,
    `${branchOficial}x`, branchOficial.toUpperCase(), `refs/heads/${branchOficial}`]) {
    assert.equal(STAGING_BRANCHES.includes(branch), false, `${branch} não é branch do Beta`);
    const r = server({ vercelEnv: 'preview', branch });
    mustFailClosed(r, `branch parecida ${branch}`);
    assert.notEqual(r.url, STAGING_SUPABASE_URL, `${branch} nunca cai no Beta por fallback`);
  }
});

// ─────────────────────────── 7. auth redirect

test('Auth volta à raiz exata do host oficial, só em HTTPS', () => {
  for (const host of [...PROD_SUPABASE_HOSTS, ...STAGING_SUPABASE_HOSTS]) {
    assert.equal(resolverRedirectAuth({ origin: `https://${host}`, hostname: host }), `https://${host}/`);
    assert.equal(resolverRedirectAuth({ origin: `https://${host}/qualquer/caminho?x=1#y`, hostname: host }), `https://${host}/`,
      'caminho, query e fragmento são descartados');
    assert.equal(resolverRedirectAuth({ origin: `http://${host}`, hostname: host }), '', 'HTTP não serve');
    assert.equal(resolverRedirectAuth({ origin: 'https://evil.com', hostname: host }), '',
      'hostname declarado não substitui a origem real');
  }
  // localhost só em desenvolvimento
  assert.equal(resolverRedirectAuth({ origin: 'http://localhost:5173', hostname: 'localhost', isDev: true }), 'http://localhost:5173/');
  assert.equal(resolverRedirectAuth({ origin: 'http://localhost:5173', hostname: 'localhost', isDev: false }), '');
});

// ─────────────────────────── 8. as duas travas concordam

test('Onde o resolvedor leva, a CSP permite — e só ali', () => {
  // development só resolve com o par explícito; os outros têm fallback público controlado
  for (const [env, branch, esperado, par] of [
    ['production', 'main', PROD_SUPABASE_URL, {}],
    ['preview', STAGING_BRANCH, STAGING_SUPABASE_URL, {}],
    ['development', '', STAGING_SUPABASE_URL, { url: STAGING_SUPABASE_URL, key: STAGING_PUBLISHABLE_KEY }],
  ]) {
    const srv = server({ vercelEnv: env, branch, ...par });
    assert.equal(srv.url, esperado, `${env}/${branch}: resolvedor`);
    const conexoes = conexoesDe(env, branch);
    assert.ok(conexoes.includes(esperado), `${env}/${branch}: a CSP permite o mesmo`);
    // e cita exatamente um projeto
    const citados = [PROD_SUPABASE_URL, STAGING_SUPABASE_URL].filter((u) => conexoes.includes(u));
    assert.equal(citados.length, 1, `${env}/${branch}: um projeto só`);
  }
  // cliente e servidor do mesmo ambiente apontam para o mesmo projeto
  assert.equal(client({ deploymentEnv: 'production', host: PROD_SUPABASE_HOSTS[0] }).url,
    server({ vercelEnv: 'production', branch: 'main' }).url);
  assert.equal(client({ deploymentEnv: 'preview', host: STAGING_SUPABASE_HOSTS[0] }).url,
    server({ vercelEnv: 'preview', branch: STAGING_BRANCH }).url);
});
