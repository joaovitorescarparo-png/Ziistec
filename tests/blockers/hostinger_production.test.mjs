import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
  Site estático de Production na Hostinger (`ziistec.com` e `www.ziistec.com`).

  O mesmo frontend roda na Vercel e na Hostinger. Na Hostinger não existe
  VITE_VERCEL_ENV, nem o cabeçalho do vercel.json, nem as Vercel Functions.
  Este arquivo prova que:
  - os dois hosts novos resolvem para o Supabase de Production, sem VERCEL_ENV;
  - qualquer outro host continua fail-closed, e Vercel/Staging/Beta não mudam;
  - o build fora da Vercel sai com a CSP de Production inteira na <meta> e um
    .htaccess com fallback da SPA, /api fora do fallback e os cabeçalhos;
  - a guarda de postbuild reprova artefato sem CSP, com projeto estranho ou sem .htaccess;
  - o frontend degrada sem quebrar quando /api não existe.
*/

import { PROD_SUPABASE_HOSTS, STAGING_SUPABASE_HOSTS, resolverConfigSupabase } from '../../src/lib/supabaseConfig.js';
import { resolverRedirectAuth } from '../../src/lib/authRedirect.js';
import {
  PROD_SUPABASE_URL, PROD_PUBLISHABLE_KEY, STAGING_SUPABASE_URL, STAGING_PUBLISHABLE_KEY, STAGING_BRANCHES,
} from '../../api/_supabaseServerConfig.js';
import { ambienteDoDeploy, politicaCspDoAmbiente, metaCspDoAmbiente } from '../../scripts/csp-environment.mjs';
import { htaccessDoAmbiente, cspCabecalhoEstatico, CABECALHOS_SEGURANCA } from '../../scripts/static-hosting.mjs';
import { verificarDistCsp } from '../../scripts/verify-dist-csp.mjs';

const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const HOSTINGER = ['ziistec.com', 'www.ziistec.com'];
const VERCEL_PROD = ['ziistec.vercel.app', 'ziistec-js-connect.vercel.app', 'ziistec-git-main-js-connect.vercel.app'];
const PROD_REF = 'diztevlpbcfqleizswxr';
const BETA_REF = 'xadoktssibuuebzzjrhv';
const BETA_HOST = 'beta.ziistec.com';
const wss = (url) => url.replace('https:', 'wss:');

const client = ({ deploymentEnv = '', host, envUrl = '', envKey = '' }) => resolverConfigSupabase({
  deploymentEnv, host, envUrl, envKey,
  prodUrl: PROD_SUPABASE_URL, prodKey: PROD_PUBLISHABLE_KEY,
  stagingUrl: STAGING_SUPABASE_URL, stagingKey: STAGING_PUBLISHABLE_KEY,
});
const mustProd = (r, label) => {
  assert.equal(r.configurado, true, `${label}: deveria configurar`);
  assert.equal(r.url, PROD_SUPABASE_URL, `${label}: precisa ser Production`);
  assert.equal(r.anonKey, PROD_PUBLISHABLE_KEY, `${label}: chave de Production`);
};
const mustFail = (r, label) => {
  assert.equal(r.configurado, false, `${label}: deveria falhar fechado`);
  assert.equal(r.url, '', `${label}: sem URL`);
  assert.equal(r.anonKey, '', `${label}: sem chave`);
};
const diretivas = (politica) => Object.fromEntries(
  politica.split(';').map((s) => s.trim()).filter(Boolean)
    .map((s) => { const [nome, ...valores] = s.split(/\s+/); return [nome, valores]; }),
);
const cabecalhosVercel = () => JSON.parse(read('vercel.json')).headers
  .find((h) => h.source === '/(.*)').headers;
const cspVercel = () => diretivas(cabecalhosVercel().find((h) => h.key === 'Content-Security-Policy').value);

// ─────────────────────────── 1. resolvedor

test('Hostinger: ziistec.com e www.ziistec.com resolvem para Production sem VERCEL_ENV', () => {
  for (const host of HOSTINGER) {
    assert.equal(PROD_SUPABASE_HOSTS.filter((h) => h === host).length, 1, `${host} uma vez na allowlist de Production`);
    assert.equal(STAGING_SUPABASE_HOSTS.includes(host), false, `${host} nunca em Staging`);
    const semEnv = client({ host });
    mustProd(semEnv, `${host} sem VITE_VERCEL_ENV (Hostinger)`);
    assert.equal(semEnv.origem, 'production-fallback');
    assert.equal(semEnv.hostProducao, true);
    mustProd(client({ deploymentEnv: 'production', host }), `${host} com production declarado`);
    mustProd(client({ host: host.toUpperCase() }), `${host} em maiúsculas`);
    // Par explícito: só o par exato de Production é aceito.
    const explicito = client({ host, envUrl: PROD_SUPABASE_URL, envKey: PROD_PUBLISHABLE_KEY });
    mustProd(explicito, `${host} com par exato de Production`);
    assert.equal(explicito.origem, 'env-production');
    mustFail(client({ host, envUrl: STAGING_SUPABASE_URL, envKey: STAGING_PUBLISHABLE_KEY }), `${host} recusa o par do Beta`);
    mustFail(client({ host, envUrl: PROD_SUPABASE_URL, envKey: STAGING_PUBLISHABLE_KEY }), `${host} recusa par cruzado`);
    mustFail(client({ host, envUrl: PROD_SUPABASE_URL }), `${host} recusa par pela metade`);
    mustFail(client({ host, envUrl: 'https://projeto-errado.supabase.co', envKey: 'sb_publishable_x' }), `${host} recusa projeto desconhecido`);
    // Domínio de Production ligado por engano a um Preview/development: falha fechado.
    mustFail(client({ deploymentEnv: 'preview', host }), `${host} em preview`);
    mustFail(client({ deploymentEnv: 'development', host }), `${host} em development`);
  }
});

test('Hostinger: hosts parecidos e o domínio temporário continuam fail-closed', () => {
  for (const host of ['ziistec.com.', 'ziistec.com.br', 'ziistec.co', 'app.ziistec.com', 'wwww.ziistec.com', 'www2.ziistec.com',
    'www.ziistec.com.evil.com', 'ziistec.com.evil.com', 'evilziistec.com', 'evil-ziistec.com', 'ziistec-com.hostingersite.com',
    'ziistec.hostingersite.com', 'localhost', '127.0.0.1', '']) {
    for (const deploymentEnv of ['', 'production', 'preview']) {
      mustFail(client({ deploymentEnv, host }), `host ${host || '(vazio)'} (${deploymentEnv || 'sem env'})`);
      mustFail(client({ deploymentEnv, host, envUrl: PROD_SUPABASE_URL, envKey: PROD_PUBLISHABLE_KEY }), `host ${host || '(vazio)'} com par de Production`);
    }
  }
  assert.equal([...PROD_SUPABASE_HOSTS, ...STAGING_SUPABASE_HOSTS].some((h) => /[*?]/.test(h)), false, 'sem curinga');
  assert.deepEqual([...PROD_SUPABASE_HOSTS], [...VERCEL_PROD, ...HOSTINGER], 'Production: exatamente os 3 hosts da Vercel e os 2 da Hostinger');
});

test('Vercel Production, Staging e Beta continuam como estavam', () => {
  for (const host of VERCEL_PROD) {
    mustProd(client({ deploymentEnv: 'production', host }), `Vercel ${host}`);
    mustProd(client({ host }), `Vercel ${host} sem env`);
  }
  for (const host of STAGING_SUPABASE_HOSTS) {
    for (const deploymentEnv of ['preview', '']) {
      const r = client({ deploymentEnv, host });
      assert.equal(r.configurado, true, `${host} configura`);
      assert.equal(r.url, STAGING_SUPABASE_URL, `${host} continua em Staging`);
    }
    mustFail(client({ deploymentEnv: 'production', host }), `${host} nunca em Production`);
  }
  // beta.ziistec.com é do mesmo domínio, mas continua só Staging: nunca Production.
  assert.equal(PROD_SUPABASE_HOSTS.includes(BETA_HOST), false);
  assert.equal(client({ host: BETA_HOST }).url, STAGING_SUPABASE_URL);
  mustFail(client({ host: BETA_HOST, envUrl: PROD_SUPABASE_URL, envKey: PROD_PUBLISHABLE_KEY }), 'beta recusa Production');
});

test('Auth: a raiz exata de ziistec.com e www.ziistec.com, só em HTTPS', () => {
  for (const host of HOSTINGER) {
    assert.equal(resolverRedirectAuth({ origin: `https://${host}`, hostname: host }), `https://${host}/`);
    assert.equal(resolverRedirectAuth({ origin: `http://${host}`, hostname: host }), '', `${host} sem HTTPS`);
    assert.equal(resolverRedirectAuth({ origin: `https://${host}.evil.com`, hostname: `${host}.evil.com` }), '');
    assert.equal(resolverRedirectAuth({ origin: `https://${host}`, hostname: 'evil.com' }), '', 'origin e hostname precisam bater');
  }
  for (const host of VERCEL_PROD) assert.equal(resolverRedirectAuth({ origin: `https://${host}`, hostname: host }), `https://${host}/`);
  assert.equal(resolverRedirectAuth({ origin: 'https://app.ziistec.com', hostname: 'app.ziistec.com' }), '');
});

// ─────────────────────────── 2. CSP do build

test('Build fora da Vercel recebe a CSP de Production inteira, só com o projeto de Production', () => {
  const r = politicaCspDoAmbiente({});
  assert.equal(r.ambiente, 'production-static');
  assert.equal(r.url, PROD_SUPABASE_URL);
  assert.equal(r.completa, true);
  assert.equal(ambienteDoDeploy({}).ambiente, 'production-static');
  // Igual ao cabeçalho do vercel.json, sem frame-ancestors (ignorada em <meta>) e sem o projeto do Beta.
  const esperado = Object.fromEntries(Object.entries(cspVercel())
    .filter(([nome]) => nome !== 'frame-ancestors')
    .map(([nome, valores]) => [nome, valores.filter((v) => !v.includes(BETA_REF))]));
  assert.deepEqual(diretivas(r.politica), esperado);
  const d = diretivas(r.politica);
  assert.deepEqual(d['connect-src'], ["'self'", PROD_SUPABASE_URL, wss(PROD_SUPABASE_URL)]);
  assert.deepEqual(d['img-src'], ["'self'", 'data:', 'blob:', PROD_SUPABASE_URL]);
  assert.deepEqual(d['script-src'], ["'self'"], 'nenhum script externo, sem inline e sem eval');
  assert.deepEqual(d['object-src'], ["'none'"]);
  assert.equal(/\*|unsafe-eval|http:|\bdata:\s*;?\s*script/.test(r.politica), false, 'sem curinga, eval ou http');
  for (const ref of [BETA_REF, 'auojcljfahhpkfqqbygd', 'uvjovxrpnvxsxrlvngpj']) {
    assert.equal(r.politica.includes(ref), false, `CSP de Production não cita ${ref}`);
    assert.equal(metaCspDoAmbiente({}).includes(ref), false);
    assert.equal(htaccessDoAmbiente({}).includes(ref), false);
  }
  // Mesmo que alguém defina VERCEL_ENV=production na Hostinger, a <meta> continua sendo a política inteira.
  assert.equal(politicaCspDoAmbiente({ vercelEnv: 'production', branch: 'main' }).politica, r.politica);
});

test('Na Vercel a política efetiva não muda: cada diretiva da <meta> cabe no cabeçalho', () => {
  const header = cspVercel();
  const meta = diretivas(politicaCspDoAmbiente({ vercelEnv: 'production', branch: 'main' }).politica);
  for (const [nome, valores] of Object.entries(meta)) {
    assert.ok(header[nome], `${nome} existe no cabeçalho`);
    for (const v of valores) assert.ok(header[nome].includes(v), `${nome}: ${v} já estava no cabeçalho`);
  }
  // Preview e development continuam declarando só connect-src e img-src, como antes.
  for (const branch of STAGING_BRANCHES) {
    assert.equal(politicaCspDoAmbiente({ vercelEnv: 'preview', branch }).politica,
      `connect-src 'self' ${STAGING_SUPABASE_URL} ${wss(STAGING_SUPABASE_URL)}; img-src 'self' data: blob: ${STAGING_SUPABASE_URL}`);
  }
  assert.equal(politicaCspDoAmbiente({ vercelEnv: 'preview', branch: 'qualquer' }).politica, "connect-src 'self'; img-src 'self' data: blob:");
  // Só o servidor de desenvolvimento do Vite fica sem política.
  assert.equal(politicaCspDoAmbiente({ servidorDev: true }), null);
  assert.equal(metaCspDoAmbiente({ servidorDev: true }), '');
});

// ─────────────────────────── 3. .htaccess

const regrasSpa = (htaccess) => {
  const linhas = htaccess.split('\n').map((l) => l.trim());
  const conds = linhas.filter((l) => l.startsWith('RewriteCond %{REQUEST_URI} !'))
    .map((l) => new RegExp(l.replace('RewriteCond %{REQUEST_URI} !', '')));
  assert.ok(linhas.includes('RewriteCond %{REQUEST_FILENAME} !-f'));
  assert.ok(linhas.includes('RewriteRule ^ index.html [L]'));
  // Simula a decisão do servidor com as MESMAS expressões do arquivo gerado.
  return (uri, existe = false) => (existe ? 'arquivo' : conds.every((re) => !re.test(uri)) ? 'index.html' : '404');
};

test('.htaccess: refresh e link salvo entregam o index.html; /api e asset ausente dão 404', () => {
  const htaccess = htaccessDoAmbiente({});
  assert.ok(htaccess, 'build fora da Vercel gera .htaccess');
  const decide = regrasSpa(htaccess);
  for (const rota of ['/', '/ordens', '/os/7f1c', '/orcamentos/123?aba=itens', '/agenda/2026-11-25', '/apiario', '/assets-guia']) {
    assert.equal(decide(rota), 'index.html', `${rota} é rota da SPA`);
  }
  for (const rota of ['/api', '/api/', '/api/quote-pdf', '/api/client-error', '/assets/index-ausente.js']) {
    assert.equal(decide(rota), '404', `${rota} nunca vira index.html`);
  }
  for (const arquivo of ['/assets/index-AbCd1234.js', '/brand/ziistec-icon.png', '/speech-patch.js']) {
    assert.equal(decide(arquivo, true), 'arquivo', `${arquivo} sai como está`);
  }
  // Nada que dependa de AllowOverride além de rewrite/cabeçalho: Options e DirectoryIndex dão 500 se proibidos.
  assert.equal(/^\s*(Options|DirectoryIndex|AddHandler|SetHandler|php_)/m.test(htaccess), false);
  for (const linha of htaccess.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'))) {
    assert.match(linha.trim(), /^(<\/?IfModule|<\/?FilesMatch|RewriteEngine|RewriteBase|RewriteCond|RewriteRule|Header set)/, `diretiva inesperada: ${linha}`);
  }
  assert.match(htaccess, /<IfModule mod_rewrite\.c>[\s\S]*<\/IfModule>/);
  assert.match(htaccess, /<IfModule mod_headers\.c>[\s\S]*<\/IfModule>/);
});

test('.htaccess: os mesmos cabeçalhos do vercel.json, CSP de Production e frame-ancestors none', () => {
  const htaccess = htaccessDoAmbiente({});
  const vercel = cabecalhosVercel().filter((h) => h.key !== 'Content-Security-Policy');
  assert.deepEqual(CABECALHOS_SEGURANCA.map(([k, v]) => ({ key: k, value: v })), vercel, 'mesmos cabeçalhos, mesmos valores');
  for (const [nome, valor] of CABECALHOS_SEGURANCA) assert.ok(htaccess.includes(`Header set ${nome} "${valor}"`), nome);
  const csp = cspCabecalhoEstatico({});
  assert.ok(htaccess.includes(`Header set Content-Security-Policy "${csp}"`));
  assert.equal(csp, `${politicaCspDoAmbiente({}).politica}; frame-ancestors 'none'`);
  assert.equal(/Access-Control-Allow-Origin|\*/.test(htaccess.replace(/\(\.\*\)/g, '')), false, 'sem CORS e sem curinga');
  assert.match(htaccess, /<FilesMatch "\\\.html\$">\n\s+Header set Cache-Control "no-cache"/);
  // Vercel e servidor de desenvolvimento não recebem .htaccess.
  for (const contexto of [{ vercelEnv: 'production', branch: 'main' }, { vercelEnv: 'preview', branch: STAGING_BRANCHES[0] },
    { vercelEnv: 'preview', branch: 'x' }, { vercelEnv: 'development' }, { servidorDev: true }]) {
    assert.equal(htaccessDoAmbiente(contexto), '', JSON.stringify(contexto));
  }
});

test('vite.config: a <meta> só fica de fora no servidor de desenvolvimento e o .htaccess sai só no build', () => {
  const cfg = read('vite.config.js');
  assert.match(cfg, /contextoDoAmbiente\(Boolean\(ctx\?\.server\)\)/);
  assert.match(cfg, /if \(comando !== "build"\) return;/);
  assert.match(cfg, /fileName: "\.htaccess"/);
  assert.equal(fs.existsSync(new URL('../../public/.htaccess', import.meta.url)), false, 'nada de .htaccess fixo em public/ (iria para a Vercel)');
  assert.equal(JSON.parse(read('package.json')).scripts.postbuild, 'node scripts/verify-dist-secrets.mjs && node scripts/verify-dist-csp.mjs');
});

// ─────────────────────────── 4. guarda do artefato

const pastasTemporarias = [];
test.after(() => { for (const dir of pastasTemporarias) fs.rmSync(dir, { recursive: true, force: true }); });
const distFalso = ({ meta, htaccess, js = 'const a="https://diztevlpbcfqleizswxr.supabase.co";' }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zt-dist-'));
  pastasTemporarias.push(dir);
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'index.html'), `<!doctype html><html><head>${meta ?? ''}</head><body></body></html>`);
  fs.writeFileSync(path.join(dir, 'assets', 'index-AbCd1234.js'), js);
  if (htaccess !== undefined) fs.writeFileSync(path.join(dir, '.htaccess'), htaccess);
  return dir;
};

test('Guarda do dist: build da Hostinger sem CSP, com projeto estranho ou sem .htaccess não passa', () => {
  const meta = metaCspDoAmbiente({});
  const htaccess = htaccessDoAmbiente({});
  const ok = verificarDistCsp(distFalso({ meta, htaccess }), {});
  assert.deepEqual(ok, { ambiente: 'production-static', erros: [] });

  const casos = [
    [{ htaccess }, /exatamente 1 <meta>/],
    [{ meta: meta + meta, htaccess }, /exatamente 1 <meta>/],
    [{ meta: metaCspDoAmbiente({ vercelEnv: 'preview', branch: STAGING_BRANCHES[0] }), htaccess }, /não é a do ambiente/],
    [{ meta }, /sem \.htaccess/],
    [{ meta, htaccess: htaccess.replace("frame-ancestors 'none'", '') }, /\.htaccess diferente/],
    [{ meta, htaccess, js: 'fetch("https://aaaaaaaaaaaaaaaaaaaa.supabase.co")' }, /projeto Supabase desconhecido/],
  ];
  for (const [dist, erro] of casos) {
    const r = verificarDistCsp(distFalso(dist), {});
    assert.ok(r.erros.some((e) => erro.test(e)), `${erro}: ${JSON.stringify(r.erros)}`);
  }
  // Build da Vercel: a <meta> de Production e nenhum .htaccess.
  const vercel = { vercelEnv: 'production', branch: 'main' };
  assert.deepEqual(verificarDistCsp(distFalso({ meta: metaCspDoAmbiente(vercel) }), vercel).erros, []);
  assert.ok(verificarDistCsp(distFalso({ meta: metaCspDoAmbiente(vercel), htaccess }), vercel).erros.some((e) => /não pertence/.test(e)));
});

// ─────────────────────────── 5. /api fora da Vercel

test('Função de convite aceita os dois domínios novos por igualdade, sem curinga (não publicada nesta etapa)', () => {
  const fonte = read('supabase/functions/team-invite-email/index.ts');
  const bloco = fonte.slice(fonte.indexOf('const PRODUCTION_APPS = ['), fonte.indexOf('];', fonte.indexOf('const PRODUCTION_APPS = [')));
  for (const host of PROD_SUPABASE_HOSTS) assert.ok(bloco.includes(`"https://${host}"`), `${host} na função de convite`);
  assert.equal(fonte.includes('"*"'), false);
  assert.equal(/Access-Control-Allow-Origin"\s*:\s*"\*/.test(fonte), false);
});

test('Observabilidade: sem /api/client-error o envio para na primeira resposta 404 e nunca quebra a tela', async () => {
  const chamadas = [];
  const antes = { window: globalThis.window, fetch: globalThis.fetch };
  try {
    globalThis.window = { location: { pathname: '/os/1' }, addEventListener() {} };
    let status = 404;
    globalThis.fetch = async (url) => { chamadas.push(url); return { status }; };
    const { reportarErro } = await import(`../../src/lib/observabilidade.js?hostinger=${Date.now()}`);
    assert.equal(reportarErro('rpc', { code: 'X1', message: 'falha 1' }), true);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(reportarErro('rpc', { code: 'X2', message: 'falha 2' }), false, 'endpoint ausente: não envia mais');
    assert.deepEqual(chamadas, ['/api/client-error']);

    chamadas.length = 0;
    status = 204;
    const outra = await import(`../../src/lib/observabilidade.js?vercel=${Date.now()}`);
    assert.equal(outra.reportarErro('rpc', { message: 'a' }), true);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(outra.reportarErro('rpc', { message: 'b' }), true, 'na Vercel continua enviando');
    assert.equal(chamadas.length, 2);

    globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
    const rede = await import(`../../src/lib/observabilidade.js?rede=${Date.now()}`);
    assert.equal(rede.reportarErro('rpc', { message: 'c' }), true, 'falha de rede não lança');
  } finally {
    globalThis.window = antes.window;
    globalThis.fetch = antes.fetch;
  }
});

test('PDF do orçamento: sem a API (404 ou index.html no lugar) a mensagem é clara e nunca baixa HTML como PDF', async () => {
  const fonte = read('src/lib/quotePdf.js').replace("import { supabase } from './supabase';", 'const supabase = { get auth() { return globalThis.__ztSupabaseStub.auth; } };');
  const mod = await import(`data:text/javascript;base64,${Buffer.from(fonte).toString('base64')}`);
  const antes = { fetch: globalThis.fetch, document: globalThis.document };
  const baixados = [];
  try {
    globalThis.__ztSupabaseStub = { auth: { getSession: async () => ({ data: { session: { access_token: 't' } }, error: null }) } };
    globalThis.document = { createElement: () => ({ click() { baixados.push(this.download); }, remove() {} }), body: { appendChild() {} } };
    const resposta = ({ ok, status, tipo = '', json }) => ({
      ok, status, headers: { get: (k) => (k.toLowerCase() === 'content-type' ? tipo : null) },
      json: async () => { if (json === undefined) throw new SyntaxError('not json'); return json; },
      blob: async () => new Blob(['%PDF-1.7'], { type: tipo }),
    });
    const indisponivel = /ainda não está disponível neste endereço/;
    for (const r of [resposta({ ok: false, status: 404 }), resposta({ ok: false, status: 405 }),
      resposta({ ok: true, status: 200, tipo: 'text/html; charset=utf-8' })]) {
      globalThis.fetch = async () => r;
      await assert.rejects(mod.baixarOrcamentoPDF('q', 'c', 'o.pdf'), indisponivel);
    }
    globalThis.fetch = async () => resposta({ ok: false, status: 404, json: { error: 'Orçamento não encontrado.' } });
    await assert.rejects(mod.baixarOrcamentoPDF('q', 'c', 'o.pdf'), /Orçamento não encontrado\./, 'erro do servidor continua aparecendo');
    globalThis.fetch = async () => resposta({ ok: false, status: 500 });
    await assert.rejects(mod.baixarOrcamentoPDF('q', 'c', 'o.pdf'), /Não foi possível gerar o PDF\./);
    assert.deepEqual(baixados, [], 'nada foi baixado nos casos de falha');
    globalThis.fetch = async () => resposta({ ok: true, status: 200, tipo: 'application/pdf' });
    assert.equal(await mod.baixarOrcamentoPDF('q', 'c', 'o.pdf'), true);
    assert.deepEqual(baixados, ['o.pdf']);
  } finally {
    globalThis.fetch = antes.fetch;
    globalThis.document = antes.document;
    delete globalThis.__ztSupabaseStub;
  }
});

test('App não monta dentro de iframe (o .htaccess da Hostinger pode não chegar)', () => {
  const main = read('src/main.jsx');
  assert.match(main, /window\.self !== window\.top/);
  const guarda = main.indexOf('if (emMoldura)');
  const app = main.indexOf('<App />');
  const senao = main.indexOf('} else {');
  assert.ok(guarda > 0 && senao > guarda && app > senao, 'o App só renderiza no ramo sem moldura');
  assert.match(main, /catch \{ return true; \}/, 'na dúvida, trata como moldura');
});
