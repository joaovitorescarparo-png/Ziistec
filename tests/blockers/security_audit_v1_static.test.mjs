import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanDist, scanText } from '../../scripts/verify-dist-secrets.mjs';

// Auditoria de segurança V1 — contratos estáticos: cabeçalhos/CSP, destinos externos, segredos no bundle,
// função de convite e a trava SQL do técnico. Nada aqui fala com rede nem com banco.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
// O módulo do mapa importa './supabase' (resolvido só pelo Vite); aqui ele é carregado de verdade, com o cliente do banco trocado por um nulo.
const { normalizeGoogleMapsUrl } = await import(`data:text/javascript;base64,${Buffer.from(read('src/lib/clientLocationsV2Api.js').split("import { supabase } from './supabase';").join('const supabase = null;')).toString('base64')}`);
const walk = (dir, accept) => readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
  const rel = path.posix.join(dir, entry.name);
  return entry.isDirectory() ? walk(rel, accept) : accept(rel) ? [rel] : [];
});

// ───────────────────────── Cabeçalhos e CSP (vercel.json) ─────────────────────────

const vercel = JSON.parse(read('vercel.json'));
const globalHeaders = Object.fromEntries(vercel.headers.find((h) => h.source === '/(.*)').headers.map((h) => [h.key, h.value]));
const csp = Object.fromEntries(globalHeaders['Content-Security-Policy'].split(';').map((part) => part.trim()).filter(Boolean)
  .map((part) => { const [name, ...values] = part.split(/\s+/); return [name, values]; }));

test('cabeçalhos globais: nosniff, sem iframe, sem referrer vazado, isolamento de origem e permissões mínimas', () => {
  assert.equal(globalHeaders['X-Content-Type-Options'], 'nosniff');
  assert.equal(globalHeaders['X-Frame-Options'], 'DENY');
  assert.equal(globalHeaders['Referrer-Policy'], 'strict-origin-when-cross-origin');
  assert.equal(globalHeaders['Cross-Origin-Opener-Policy'], 'same-origin');
  assert.equal(globalHeaders['Cross-Origin-Resource-Policy'], 'same-origin');
  assert.equal(globalHeaders['X-Permitted-Cross-Domain-Policies'], 'none');
  const permissions = globalHeaders['Permissions-Policy'];
  for (const off of ['payment=()', 'usb=()', 'browsing-topics=()']) assert.ok(permissions.includes(off), off);
  // Câmera, microfone e geolocalização só para a própria origem (campo, voz e rota); nunca para terceiros.
  for (const own of ['camera=(self)', 'microphone=(self)', 'geolocation=(self)']) assert.ok(permissions.includes(own), own);
});

test('CSP: sem script inline/eval, sem objeto, sem moldura de terceiros e base/form restritos', () => {
  assert.deepEqual(csp['default-src'], ["'self'"]);
  assert.deepEqual(csp['script-src'], ["'self'"], 'script-src sem unsafe-inline, unsafe-eval ou curinga');
  assert.deepEqual(csp['object-src'], ["'none'"]);
  assert.deepEqual(csp['frame-ancestors'], ["'none'"]);
  assert.deepEqual(csp['base-uri'], ["'self'"]);
  assert.deepEqual(csp['form-action'], ["'self'"]);
  assert.ok('upgrade-insecure-requests' in csp);
  for (const [directive, values] of Object.entries(csp)) {
    assert.equal(values.includes('*'), false, `${directive} sem curinga`);
    assert.equal(values.some((v) => v === 'http:' || v.startsWith('http://') || v.startsWith('ws://')), false, `${directive} sem esquema inseguro`);
    if (directive !== 'style-src') assert.equal(values.includes("'unsafe-inline'"), false, `${directive} sem unsafe-inline`);
    assert.equal(values.includes("'unsafe-eval'"), false, `${directive} sem unsafe-eval`);
  }
});

test('CSP: conexões e imagens externas só para os dois projetos Supabase conhecidos', () => {
  const projects = new Set(['https://diztevlpbcfqleizswxr.supabase.co', 'https://xadoktssibuuebzzjrhv.supabase.co']);
  const sockets = new Set([...projects].map((url) => url.replace('https:', 'wss:')));
  const external = (values) => values.filter((v) => !v.startsWith("'") && !['data:', 'blob:'].includes(v));
  for (const value of external(csp['connect-src'])) assert.ok(projects.has(value) || sockets.has(value), `connect-src: ${value}`);
  for (const value of external(csp['img-src'])) assert.ok(projects.has(value), `img-src: ${value}`);
  assert.deepEqual(csp['connect-src'].filter((v) => v.startsWith('data:') || v.startsWith('blob:')), []);
  assert.equal(csp['script-src'].some((v) => /^https?:/.test(v)), false, 'nenhum script de terceiro');
});

test('cache imutável só para /assets; o resto da aplicação não ganha cache público', () => {
  const cached = vercel.headers.filter((h) => h.headers.some((x) => /immutable/.test(x.value)));
  assert.deepEqual(cached.map((h) => h.source), ['/assets/(.*)']);
  assert.equal(JSON.stringify(vercel.headers).includes('Access-Control-Allow-Origin'), false, 'a aplicação não libera CORS aberto');
});

// ───────────────────────── Destinos externos e links ─────────────────────────

test('maps_url: só link HTTPS do Google chega ao navegador; javascript:, data:, http: e hosts parecidos são recusados', () => {
  for (const ok of ['https://www.google.com/maps/place/Rua+A', 'https://maps.google.com/?q=-23.5,-46.6', 'https://maps.app.goo.gl/abc123', 'https://goo.gl/maps/xyz', 'HTTPS://MAPS.GOOGLE.COM/?q=x']) {
    assert.ok(normalizeGoogleMapsUrl(ok), ok);
  }
  for (const bad of ['javascript:alert(document.domain)', ' javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:msgbox(1)', 'file:///c:/windows/win.ini',
    'http://www.google.com/maps', '//www.google.com/maps', 'https://google.com.evil.example/maps', 'https://evilgoogle.com/', 'https://www.google.com@evil.example/', 'https://maps.google.com.evil.example/', 'https://xn--ggle-0nda.com/',
    'ftp://google.com', 'google.com/maps', '', '   ', null, undefined, 42, {}]) {
    assert.equal(normalizeGoogleMapsUrl(bad), null, String(bad));
  }
  assert.ok(normalizeGoogleMapsUrl(`https://www.google.com/maps?q=${'a'.repeat(5000)}`).length <= 2000);
});

test('abrir o mapa do cliente passa pelo validador e usa noopener; nenhum botão abre maps_url cru', () => {
  const source = read('src/screens/v2/ClientLocationsV2.jsx');
  const openMap = source.slice(source.indexOf('const openMap='), source.indexOf('};', source.indexOf('const openMap=')) + 2);
  assert.match(openMap, /normalizeGoogleMapsUrl\(form\.mapsUrl\)/);
  assert.match(openMap, /window\.open\(url,'_blank','noopener,noreferrer'\)/);
  assert.equal(/window\.open\(\s*(form\.mapsUrl|client\.maps_url|currentMap)/.test(source), false);
  assert.equal(/href=\{[^}]*maps_url/.test(source), false, 'nenhum <a href> usa maps_url cru');
});

test('inventário de destinos externos: window.open só abre wa.me fixo, rota montada ou mapa validado', () => {
  const files = walk('src', (f) => /\.(jsx?|mjs)$/.test(f));
  const sinks = [];
  for (const file of files) {
    const text = read(file);
    for (const match of text.matchAll(/window\.open\(([^;\n]{0,200})/g)) sinks.push({ file, call: match[1] });
  }
  assert.ok(sinks.length >= 10, 'o inventário precisa enxergar os pontos de abertura conhecidos');
  for (const { file, call } of sinks) {
    // O número do WhatsApp sempre passa por soDigitos (só dígitos) e o texto por encodeURIComponent; o host é fixo.
    const legacyWhatsapp = file === 'src/legacy/ZiisTecApp.jsx' && (/^`https:\/\/wa\.me\/55\$\{soDigitos\(/.test(call)
      || (/^`https:\/\/wa\.me\/55\$\{numero\}\?text=\$\{encodeURIComponent\(/.test(call) && /const numero = soDigitos\(/.test(read(file))));
    const comprovante = file === 'src/components/ServiceReceiptPanel.jsx' && /^linkWhatsAppComprovante\(/.test(call) && /noopener,noreferrer/.test(call);
    const posVenda = file === 'src/screens/v2/PostSaleV2.jsx' && /^`https:\/\/wa\.me\/\$\{whats\}`,'_blank','noopener,noreferrer'\)/.test(call)
      && /const digits=v=>String\(v\|\|''\)\.replace\(\/\\D\/g,''\)/.test(read(file));
    const mapa = file ==='src/screens/v2/ClientLocationsV2.jsx' && /^url,'_blank','noopener,noreferrer'\)/.test(call);
    const rota = file === 'src/screens/v2/WorkOrderMemoryBaseV2.jsx' && /noopener,noreferrer/.test(call);
    assert.ok(legacyWhatsapp || comprovante || posVenda || mapa || rota, `destino de window.open não inventariado: ${file}: ${call}`);
  }
  // Navegação programática só para a própria origem: caminho + query + fragmento de uma URL derivada da página atual.
  let navigations = 0;
  for (const file of files) {
    const text = read(file);
    assert.equal(/location\.(?:href\s*=[^=]|replace\()/.test(text), false, `${file}: atribuição direta de location`);
    for (const match of text.matchAll(/location\.assign\(([^;\n]{0,120})/g)) {
      navigations += 1;
      assert.match(match[1], /^`\$\{(?:url|u)\.pathname\}\$\{(?:url|u)\.search\}\$\{(?:url|u)\.hash\}`\)/, `${file}: navegação fora do padrão same-origin`);
      assert.match(text, /new URL\(window\.location\.href\)/, `${file}: a URL precisa nascer da página atual`);
    }
  }
  assert.ok(navigations >= 4);
});

test('sem sinks clássicos de XSS na aplicação: innerHTML, document.write, eval, new Function, dangerouslySetInnerHTML', () => {
  const files = walk('src', (f) => /\.(jsx?|mjs)$/.test(f)).concat(walk('api', (f) => /\.(js|mjs)$/.test(f)));
  const hits = [];
  for (const file of files) {
    const text = read(file);
    for (const [label, pattern] of [['innerHTML', /\.innerHTML\s*=/], ['outerHTML', /\.outerHTML\s*=/], ['insertAdjacentHTML', /insertAdjacentHTML\(/], ['document.write', /document\.write\(/],
      ['eval', /\beval\(/], ['new Function', /new Function\(/], ['dangerouslySetInnerHTML', /dangerouslySetInnerHTML/]]) {
      if (pattern.test(text)) hits.push(`${file}: ${label}`);
    }
  }
  assert.deepEqual(hits, []);
});

// ───────────────────────── Segredos no cliente e no bundle ─────────────────────────

test('variáveis VITE_* são públicas: o cliente só lê o par URL/chave anon, o rótulo do ambiente e dois booleanos de interface', () => {
  const names = new Set();
  for (const file of walk('src', (f) => /\.(jsx?|mjs)$/.test(f))) for (const m of read(file).matchAll(/VITE_[A-Z0-9_]+/g)) names.add(m[0]);
  // Par URL/anon do banco, rótulo do ambiente e dois booleanos de interface. Nada com segredo.
  assert.deepEqual([...names].sort(), ['VITE_ENABLE_GOOGLE_AUTH', 'VITE_SUPABASE_ANON_KEY', 'VITE_SUPABASE_URL', 'VITE_VERCEL_ENV', 'VITE_ZIISTEC_BETA']);
  assert.equal(/VITE_[A-Z0-9_]*(SECRET|SERVICE|PRIVATE|PASSWORD|TOKEN)/.test(read('vite.config.js') + JSON.stringify(vercel)), false);
});

test('o código do navegador nunca referencia service_role nem segredos de servidor', () => {
  const offenders = [];
  for (const file of walk('src', (f) => /\.(jsx?|mjs)$/.test(f))) {
    const text = read(file);
    if (/SERVICE_ROLE|service_role|GEMINI_API_KEY|ANTHROPIC_API_KEY|sb_secret_/.test(text)) offenders.push(file);
  }
  assert.deepEqual(offenders, []);
});

// Segredos sintéticos montados em tempo de execução: nenhum literal que pareça credencial é versionado.
const b64url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const jwt = (role) => `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ iss: 'supabase', role, exp: 4102444800 })}.${'s'.repeat(43)}`;

test('varredura do bundle: segredos de servidor são achados; chave anon e chave publishable não', () => {
  const fixtures = {
    'chave secreta do Supabase': ['sb', 'secret', 'A'.repeat(24)].join('_'),
    'chave privada PEM': ['-----BEGIN', 'RSA PRIVATE KEY-----'].join(' '),
    'chave de API do Google': `AIza${'B'.repeat(35)}`,
    'chave da Anthropic': ['sk', 'ant', 'C'.repeat(30)].join('-'),
    'token do GitHub': `ghp_${'D'.repeat(36)}`,
    'chave de acesso da AWS': `AKIA${'E'.repeat(16)}`,
    'nome de variável privada': ['SUPABASE', 'SERVICE', 'ROLE', 'KEY'].join('_'),
    'JWT service_role': `const k="${jwt('service_role')}";`,
    'JWT authenticated': `const k="${jwt('authenticated')}";`,
  };
  for (const [label, text] of Object.entries(fixtures)) assert.ok(scanText(`var x=1;${text};`).length > 0, label);
  assert.deepEqual(scanText(`const k="${jwt('anon')}";`), [], 'a chave anon é pública por desenho');
  assert.deepEqual(scanText(['sb', 'publishable', 'F'.repeat(30)].join('_')), [], 'a chave publishable é pública por desenho');
  assert.deepEqual(scanText('const url="https://xadoktssibuuebzzjrhv.supabase.co";function a(){return 1}'), []);
});

test('scanDist percorre js/css/html/map do bundle, falha em pasta ausente e aponta o arquivo infectado', () => {
  const dist = mkdtempSync(path.join(tmpdir(), 'zt-dist-'));
  try {
    mkdirSync(path.join(dist, 'assets'));
    writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>x</title>');
    writeFileSync(path.join(dist, 'assets', 'app.js'), `console.log(1);`);
    assert.deepEqual(scanDist(dist), { files: 2, findings: [] });
    writeFileSync(path.join(dist, 'assets', 'app.js.map'), `{"sourcesContent":["${['sb', 'secret', 'G'.repeat(24)].join('_')}"]}`);
    const result = scanDist(dist);
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].file, path.join('assets', 'app.js.map'));
  } finally { rmSync(dist, { recursive: true, force: true }); }
  assert.throws(() => scanDist(path.join(tmpdir(), 'zt-dist-inexistente-' + Date.now())), /não encontrada/);
});

test('o build roda a varredura do bundle em postbuild e o verify:v2 inclui os testes de segurança', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts.postbuild, 'node scripts/verify-dist-secrets.mjs');
  for (const file of ['security_audit_v1_api.test.mjs', 'security_audit_v1_static.test.mjs']) assert.ok(pkg.scripts['verify:v2'].includes(`tests/blockers/${file}`), file);
  assert.ok(read('scripts/run-sql-rls-ci.sh').includes('supabase/tests/v2_security_audit_v1_rollback.sql'));
});

// ───────────────────────── Função de convite por e-mail ─────────────────────────

test('team-invite-email: JWT obrigatório, origem permitida, dono ativo antes da chave de serviço e redirecionamento fixo', () => {
  const source = read('supabase/functions/team-invite-email/index.ts');
  assert.match(read('supabase/config.toml'), /\[functions\.team-invite-email\]\s*\nverify_jwt = true/);
  assert.equal(/Access-Control-Allow-Origin["']?\s*:\s*["']\*["']/.test(source), false, 'sem CORS curinga');
  assert.match(source, /ALLOWED_ORIGINS\.has\(origin\)/);
  assert.match(source, /not_authenticated/);
  assert.match(source, /invalid_redirect/);
  assert.match(source, /url\.pathname !== "\/" \|\| url\.search \|\| url\.hash/, 'redirecionamento sem caminho, query ou fragmento');
  assert.match(source, /\^\[0-9a-f-\]\{36\}\$/i, 'invite_id validado como UUID antes de qualquer consulta');
  // A chave de serviço só é usada depois de provar que quem chama é dono ativo da empresa do convite.
  const owner = source.indexOf('owner_required');
  const admin = source.indexOf('createClient(supabaseUrl, serviceRoleKey');
  assert.ok(owner > 0 && admin > owner, 'cliente administrativo criado depois da checagem de dono');
  assert.ok(source.indexOf('.eq("role", "owner")') > 0 && source.indexOf('.eq("status", "active")') > 0);
  assert.ok(source.indexOf('invite_already_accepted') > 0 && source.indexOf('invite_expired') > 0);
  assert.equal(/console\.(log|error)\([^)]*(serviceRoleKey|authorization|invite\.email)/i.test(source), false, 'sem log de segredo, sessão ou e-mail');
});

// ───────────────────────── SEC-01 · trava SQL do técnico ─────────────────────────

test('SEC-01: a trava de UPDATE do técnico cobre contrato e ciclo e a migration não muda grants nem tabelas', () => {
  const migrations = readdirSync(path.join(root, 'supabase')).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
  const definers = migrations.filter((f) => /create or replace function public\.zt_guard_work_order_technician_update\(/i.test(read(`supabase/${f}`)));
  assert.equal(definers.at(-1), '0107_technician_contract_cycle_guard.sql', 'a definição vigente da trava é a 0107');
  const sql = read('supabase/0107_technician_contract_cycle_guard.sql');
  for (const field of ['maintenance_contract_id', 'contract_cycle', 'billing_entry_id', 'extra_cost', 'assigned_to', 'client_id', 'quote_id', 'warranty_id', 'company_id']) {
    assert.match(sql, new RegExp(`new\\.${field} is distinct from old\\.${field}`), field);
  }
  assert.match(sql, /revoke execute on function public\.zt_guard_work_order_technician_update\(\) from public, anon, authenticated;/);
  assert.equal(/\b(create|alter|drop)\s+table\b|create\s+policy|alter\s+policy|drop\s+policy|\bgrant\b/i.test(sql.replace(/--.*$/gm, '')), false, 'a 0107 não toca tabelas, policies nem concede privilégios');
  assert.equal(/security definer/i.test(sql.replace(/--.*$/gm, '')), false, 'a trava continua security invoker');
});
