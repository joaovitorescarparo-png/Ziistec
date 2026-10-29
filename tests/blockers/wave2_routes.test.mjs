import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import {
  DEFAULT_ROUTE_APP, MENSAGEM_SEM_ENDERECO, ROUTE_APPS, alternativasDeRota, construirUrlRota, detectarPlataforma, isRouteApp,
  limparTextoRota, linkDeRota, mesmoEndereco, normalizarCoordenadas, resolverDestinoRota, urlDeRotaSegura,
} from '../../src/lib/routeApps.js';

// Onda 2 · rotas do atendimento (Google Maps, Waze, Apple Maps) e preferência de app POR USUÁRIO (0106).
// Nada aqui toca banco real: o Supabase é uma emulação em memória e a RLS de verdade é provada no SQL
// (supabase/tests/v2_wave2_route_preferences_rollback.sql, rodado no CI descartável).

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const ENDERECO = 'Rua José de Alencar, 10 — Apto & Bloco #3 (50%) + "loja" <A>';
const PLACE_ID = 'ChIJ0WGkg4FEzpQRrlsz_whLqZs';
const hostDe = (url) => new URL(url).hostname; // compara o host de verdade, nunca por trecho do texto da URL
const query = (url, nome) => new URL(url).searchParams.get(nome);
const COORD = { latitude: -23.55052, longitude: -46.633308, endereco: 'Av. Paulista, 1000', placeId: null };
const SO_ENDERECO = { latitude: null, longitude: null, endereco: ENDERECO, placeId: null };

// ------------------------------------------------------------------ Google Maps
test('Google Maps: coordenadas, endereço com acento/espaço/caracteres especiais e place id', () => {
  const porCoordenada = construirUrlRota('google', COORD);
  assert.match(porCoordenada, /^https:\/\/www\.google\.com\/maps\/dir\/\?/);
  assert.equal(query(porCoordenada, 'api'), '1');
  assert.equal(query(porCoordenada, 'destination'), '-23.55052,-46.633308');

  const porEndereco = construirUrlRota('google', SO_ENDERECO);
  assert.equal(query(porEndereco, 'destination'), ENDERECO, 'o endereço volta idêntico depois de decodificar');
  assert.ok(!/[ "<>#]/.test(porEndereco.slice(porEndereco.indexOf('?'))), 'nada cru na query: espaço, aspas, <, > e # saem codificados');
  assert.match(porEndereco, /Jos%C3%A9/, 'acento em UTF-8 percent-encoded');
  assert.match(porEndereco, /%26/, '& codificado, não separa parâmetros');
  assert.match(porEndereco, /%2B/, '+ literal vira %2B e não vira espaço');
  assert.match(porEndereco, /%20/, 'espaço como %20');
  assert.equal(new URL(porEndereco).searchParams.size, 2, 'o & do endereço não criou parâmetro extra');

  const comPlace = construirUrlRota('google', { ...COORD, placeId: PLACE_ID });
  assert.equal(query(comPlace, 'destination'), '-23.55052,-46.633308');
  assert.equal(query(comPlace, 'destination_place_id'), PLACE_ID);
  assert.equal(query(construirUrlRota('google', { ...SO_ENDERECO, placeId: PLACE_ID }), 'destination'), ENDERECO, 'place id acompanha o endereço');
  assert.equal(query(porCoordenada, 'destination_place_id'), null, 'sem place id, sem parâmetro');
});

// ------------------------------------------------------------------ Waze
test('Waze: coordenadas e fallback válido por endereço', () => {
  const porCoordenada = construirUrlRota('waze', COORD);
  assert.equal(porCoordenada, 'https://waze.com/ul?ll=-23.55052,-46.633308&navigate=yes');
  const porEndereco = construirUrlRota('waze', SO_ENDERECO);
  assert.match(porEndereco, /^https:\/\/waze\.com\/ul\?q=/);
  assert.equal(query(porEndereco, 'q'), ENDERECO);
  assert.equal(query(porEndereco, 'navigate'), 'yes');
  assert.equal(query(porEndereco, 'll'), null, 'sem coordenadas não inventa ll');
  assert.equal(new URL(porEndereco).searchParams.size, 2);
  assert.ok(urlDeRotaSegura(porCoordenada) && urlDeRotaSegura(porEndereco));
});

// ------------------------------------------------------------------ Apple Maps
test('Apple Maps: coordenadas e endereço, com link web que degrada fora do ecossistema Apple', () => {
  const porCoordenada = construirUrlRota('apple', COORD);
  assert.match(porCoordenada, /^https:\/\/maps\.apple\.com\/\?/);
  assert.equal(query(porCoordenada, 'daddr'), '-23.55052,-46.633308');
  assert.equal(query(porCoordenada, 'dirflg'), 'd');
  const porEndereco = construirUrlRota('apple', SO_ENDERECO);
  assert.equal(query(porEndereco, 'daddr'), ENDERECO);
  assert.equal(new URL(porEndereco).searchParams.size, 2);
  // fora da Apple o link continua https e abre no navegador; a interface avisa em vez de esconder
  assert.deepEqual(alternativasDeRota('google', 'android').at(-1), { app: 'apple', label: 'Apple Maps', dica: 'abre no navegador' });
  assert.equal(alternativasDeRota('google', 'ios').find((x) => x.app === 'apple').dica, null);
});

// ------------------------------------------------------------------ destino: ordem de dados e nada inventado
test('destino: coordenadas só do cadastro do cliente e só para o mesmo endereço; service_place é o último recurso', () => {
  const cliente = { endereco: 'rua jose de alencar,   10', latitude: '-23.5', longitude: -46.6, googlePlaceId: PLACE_ID };
  const igual = resolverDestinoRota({ endereco: 'Rua José de Alencar, 10', localServico: 'Apto 304', cliente });
  assert.deepEqual(igual, { latitude: -23.5, longitude: -46.6, endereco: 'Rua José de Alencar, 10', placeId: PLACE_ID });
  assert.equal(construirUrlRota('google', igual).includes('Apto'), false, 'o apto não entra na rota quando há endereço');

  const outroEndereco = resolverDestinoRota({ endereco: 'Rua das Flores, 99', cliente });
  assert.deepEqual(outroEndereco, { latitude: null, longitude: null, endereco: 'Rua das Flores, 99', placeId: null }, 'não empresta a coordenada de outro endereço');
  assert.equal(resolverDestinoRota({ endereco: 'Rua das Flores, 99' }).latitude, null);

  assert.deepEqual(resolverDestinoRota({ localServico: 'Portaria Norte' }), { latitude: null, longitude: null, endereco: 'Portaria Norte', placeId: null }, 'último recurso');
  assert.equal(resolverDestinoRota({ endereco: '   ', localServico: '' }), null);
  assert.equal(resolverDestinoRota({}), null);
  assert.equal(resolverDestinoRota(), null);

  assert.ok(mesmoEndereco('  Rua  São João, 5 ', 'rua sao joao, 5'));
  assert.ok(!mesmoEndereco('', ''));
});

test('coordenadas inválidas são ignoradas: nunca se inventa ponto no mapa', () => {
  for (const [lat, lng] of [[null, -46], [-23, null], ['', ''], ['abc', 1], [NaN, 1], [91, 10], [-91, 10], [10, 181], [10, -181], [0, 0], [Infinity, 1], [undefined, undefined]]) {
    assert.equal(normalizarCoordenadas(lat, lng), null, `${lat},${lng}`);
  }
  assert.deepEqual(normalizarCoordenadas('-23.5505199', '-46.6333094'), { latitude: -23.5505199, longitude: -46.6333094 });
  assert.deepEqual(normalizarCoordenadas(0, 10), { latitude: 0, longitude: 10 }, 'equador é válido; só o par 0,0 é tratado como ausência');
  const invalido = resolverDestinoRota({ endereco: 'Rua A, 1', cliente: { endereco: 'Rua A, 1', latitude: 95, longitude: 10 } });
  assert.equal(invalido.latitude, null);
  assert.ok(!/ll=/.test(construirUrlRota('waze', invalido)));
});

// ------------------------------------------------------------------ segurança dos links
test('segurança: nenhum link vira javascript:, data: ou host de terceiros; texto não confiável fica codificado', () => {
  const maliciosos = ['javascript:alert(1)', '"><script>alert(1)</script>', 'https://evil.test/?x=1', '//evil.test', 'data:text/html;base64,AAAA', 'Rua A\u0000\u001F‮ 1', `${'x'.repeat(2000)}`];
  for (const texto of maliciosos) {
    const destino = resolverDestinoRota({ endereco: texto });
    for (const app of ROUTE_APPS) {
      const url = construirUrlRota(app, destino);
      assert.ok(url, `${app}: ${texto.slice(0, 20)}`);
      assert.match(url, /^https:\/\/(www\.google\.com|waze\.com|maps\.apple\.com)[/?]/);
      assert.ok(urlDeRotaSegura(url));
      assert.ok(!/javascript:/i.test(new URL(url).protocol));
      assert.doesNotMatch(url.slice(url.indexOf('?')), /[<>"' \u0000-\u001F]/, 'sem caractere perigoso cru');
    }
  }
  assert.equal(limparTextoRota('x'.repeat(2000)).length, 500, 'texto limitado');
  assert.equal(limparTextoRota('A\u0000B\tC\nD'), 'A B C D');

  for (const ruim of ['javascript:alert(1)', 'http://www.google.com/maps/dir/?api=1', 'https://www.google.com.evil.test/maps', 'https://evil.test/?u=www.google.com',
    'https://user:senha@www.google.com/maps', 'ftp://waze.com/ul', 'data:text/html,x', '', null, undefined, 'não é url']) {
    assert.equal(urlDeRotaSegura(ruim), false, String(ruim));
  }
  assert.equal(construirUrlRota('bing', COORD), null);
  assert.equal(construirUrlRota('javascript:alert(1)', COORD), null);
  assert.equal(construirUrlRota('google', null), null);
  assert.equal(construirUrlRota('google', { endereco: '   ' }), null);
  assert.equal(linkDeRota('waze', SO_ENDERECO), construirUrlRota('waze', SO_ENDERECO));
  assert.equal(linkDeRota('nope', SO_ENDERECO), null);
});

test('plataforma: Android, iPhone, iPad que se apresenta como Mac, macOS e desktop sem depender só do userAgent', () => {
  assert.equal(detectarPlataforma({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8)', platform: 'Linux armv8l', maxTouchPoints: 5 }), 'android');
  assert.equal(detectarPlataforma({ userAgentData: { platform: 'Android' }, userAgent: 'x', platform: '' }), 'android');
  assert.equal(detectarPlataforma({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)', platform: 'iPhone', maxTouchPoints: 5 }), 'ios');
  assert.equal(detectarPlataforma({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 5 }), 'ios', 'iPadOS');
  assert.equal(detectarPlataforma({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 0 }), 'macos');
  assert.equal(detectarPlataforma({ userAgentData: { platform: 'macOS' }, userAgent: '', platform: '', maxTouchPoints: 0 }), 'macos');
  assert.equal(detectarPlataforma({ userAgentData: { platform: 'Windows' }, userAgent: 'Mozilla/5.0 (Windows NT 10.0)', platform: 'Win32', maxTouchPoints: 0 }), 'desktop');
  assert.equal(detectarPlataforma(null), 'desktop');
});

test('alternativas: nunca repetem o app já usado e o Apple Maps vai por último fora da Apple', () => {
  for (const app of ROUTE_APPS) {
    for (const plataforma of ['android', 'ios', 'macos', 'desktop']) {
      const itens = alternativasDeRota(app, plataforma).map((x) => x.app);
      assert.equal(itens.length, 2);
      assert.ok(!itens.includes(app), `${app}/${plataforma}`);
    }
  }
  assert.deepEqual(alternativasDeRota('google', 'android').map((x) => x.app), ['waze', 'apple']);
  assert.deepEqual(alternativasDeRota('waze', 'desktop').map((x) => x.app), ['google', 'apple']);
  assert.deepEqual(alternativasDeRota('apple', 'ios').map((x) => x.app), ['google', 'waze']);
  assert.equal(DEFAULT_ROUTE_APP, 'google');
  assert.ok(isRouteApp('waze') && !isRouteApp('bing') && !isRouteApp(undefined));
});

// ------------------------------------------------------------------ Supabase emulado (RLS "só a própria linha")
function createEmulatedSupabase() {
  const rows = new Map();
  const callbacks = [];
  const log = [];
  const sessionRef = { userId: null };
  const mode = { value: 'ok' };
  const missing = { code: 'PGRST205', message: "Could not find the table 'public.user_route_preferences' in the schema cache" };
  const table = {
    select() { return { maybeSingle: async () => {
      log.push({ op: 'select', user: sessionRef.userId });
      if (mode.value === 'missing') return { data: null, error: missing };
      if (mode.value === 'fail') return { data: null, error: { code: '08006', message: 'connection failure' } };
      return { data: rows.has(sessionRef.userId) ? { route_app: rows.get(sessionRef.userId) } : null, error: null };
    } }; },
    async upsert(payload) {
      log.push({ op: 'upsert', user: sessionRef.userId, payload });
      if (mode.value === 'missing') return { data: null, error: missing };
      if (mode.value === 'fail') return { data: null, error: { code: '08006', message: 'connection failure' } };
      // emulação da RLS: with check (user_id = auth.uid())
      if (payload.user_id !== sessionRef.userId) return { data: null, error: { code: '42501', message: 'new row violates row-level security policy' } };
      if (!['google', 'waze', 'apple'].includes(payload.route_app)) return { data: null, error: { code: '23514', message: 'check violation' } };
      rows.set(payload.user_id, payload.route_app);
      return { data: null, error: null };
    },
  };
  const client = {
    from: (name) => { assert.equal(name, 'user_route_preferences', 'só a tabela de preferência é tocada'); return table; },
    auth: {
      getSession: async () => ({ data: { session: sessionRef.userId ? { user: { id: sessionRef.userId } } : null } }),
      onAuthStateChange: (fn) => { callbacks.push(fn); return { data: { subscription: { unsubscribe() {} } } }; },
    },
  };
  return { client, rows, log, mode, sessionRef, signIn(userId) { sessionRef.userId = userId; callbacks.forEach((fn) => fn(userId ? 'SIGNED_IN' : 'SIGNED_OUT', userId ? { user: { id: userId } } : null)); } };
}
const emulated = createEmulatedSupabase();
globalThis.__ztFakeSupabase = emulated.client;

const fakeSupabasePlugin = {
  name: 'zt-fake-supabase', enforce: 'pre',
  resolveId(source, importer) { if (importer && /[\\/]src[\\/]lib[\\/]/.test(importer) && /^\.\/supabase(\.js)?$/.test(source)) return '\0zt-fake-supabase'; return null; },
  load(id) {
    if (id !== '\0zt-fake-supabase') return null;
    return 'export const supabase = globalThis.__ztFakeSupabase; export const configurado = true; export const ambienteSupabase = "test"; export function mensagemErro(e){ return e?.message || String(e || ""); } export function sessaoExpirou(){ return false; }';
  },
};

let vite; let store; let RouteButton; let legacy;
before(async () => {
  vite = await createServer({ plugins: [fakeSupabasePlugin], server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom', logLevel: 'error' });
  store = await vite.ssrLoadModule('/src/lib/routePreferences.js');
  RouteButton = (await vite.ssrLoadModule('/src/components/RouteButton.jsx')).default;
  legacy = await vite.ssrLoadModule('/src/legacy/ZiisTecApp.jsx');
});
after(async () => { await vite?.close(); });

const OWNER = '10000000-0000-4000-8000-0000000000a1';
const TECH = '10000000-0000-4000-8000-0000000000a2';
const OWNER_B = '10000000-0000-4000-8000-0000000000b1';
const settle = () => new Promise((resolve) => setImmediate(resolve));
function resetar(modo = 'ok', usuario = null) { emulated.mode.value = modo; emulated.sessionRef.userId = usuario; emulated.log.length = 0; store.reiniciarPreferenciaRota(usuario); }
const snap = () => store.lerPreferenciaRota();

// ------------------------------------------------------------------ preferência por usuário
test('preferência: proprietário e técnico guardam a própria, independentes; empresa não entra na conta', async () => {
  emulated.rows.clear();
  resetar('ok', OWNER);
  await store.carregarPreferenciaRota();
  assert.deepEqual({ app: snap().app, salvo: snap().salvo }, { app: 'google', salvo: false }, 'sem preferência salva, Google Maps');
  await store.escolherAppDeRota('google');
  await store.escolherAppDeRota('waze');
  assert.equal(snap().app, 'waze'); assert.equal(snap().persistente, true);
  assert.equal(emulated.rows.get(OWNER), 'waze');
  const gravacao = emulated.log.filter((x) => x.op === 'upsert').at(-1);
  assert.deepEqual(Object.keys(gravacao.payload).sort(), ['route_app', 'updated_at', 'user_id'], 'nada de company_id nem de outro dado');
  assert.equal(gravacao.payload.user_id, OWNER);

  emulated.signIn(TECH); // outro usuário na mesma aba: o estado do anterior nunca vaza
  assert.equal(snap().app, 'google', 'o técnico não herda o Waze do proprietário');
  await store.carregarPreferenciaRota();
  assert.equal(snap().salvo, false);
  await store.escolherAppDeRota('apple');
  assert.equal(emulated.rows.get(TECH), 'apple');
  assert.equal(emulated.rows.get(OWNER), 'waze', 'a do proprietário continua intacta');

  emulated.signIn(OWNER);
  await store.carregarPreferenciaRota();
  assert.equal(snap().app, 'waze', 'ao voltar, a preferência do proprietário é carregada do banco');
  emulated.signIn(OWNER_B);
  await store.carregarPreferenciaRota();
  assert.equal(snap().app, 'google', 'outra empresa, outro usuário, sem herança');
  await store.escolherAppDeRota('google');
  assert.deepEqual([...emulated.rows.entries()].sort(), [[OWNER, 'waze'], [OWNER_B, 'google'], [TECH, 'apple']].sort());
});

test('preferência: o cliente só grava com o id da própria sessão; gravar em nome de outro é recusado e não derruba a tela', async () => {
  emulated.rows.clear(); emulated.rows.set(TECH, 'apple');
  resetar('ok', OWNER);
  await assert.rejects(() => store.salvarPreferenciaRotaDB(TECH, 'google'), (error) => error.code === '42501', 'a RLS recusa gravar para outro usuário');
  assert.equal(emulated.rows.get(TECH), 'apple', 'a do técnico não foi alterada');
  await assert.rejects(() => store.salvarPreferenciaRotaDB(OWNER, 'bing'), /inválido/);
  await assert.rejects(() => store.salvarPreferenciaRotaDB('', 'waze'), /Sessão inválida/);
  await store.escolherAppDeRota('bing');
  assert.equal(snap().app, 'google', 'app desconhecido é ignorado');
  emulated.log.length = 0;
  await store.escolherAppDeRota('waze');
  const gravacoes = emulated.log.filter((x) => x.op === 'upsert');
  assert.equal(gravacoes.length, 1);
  assert.ok(gravacoes.every((x) => x.payload.user_id === OWNER), 'a escolha grava sempre com o id da sessão');
});

test('compatibilidade com o banco 0099: sem a tabela nova a rota funciona, a escolha vale na sessão e não há erro técnico', async () => {
  emulated.rows.clear();
  resetar('missing', OWNER);
  await store.carregarPreferenciaRota();
  assert.deepEqual({ app: snap().app, persistente: snap().persistente, erro: snap().erro }, { app: 'google', persistente: false, erro: '' });
  await store.escolherAppDeRota('waze');
  assert.equal(snap().app, 'waze', 'a escolha vale na sessão');
  assert.equal(snap().persistente, false);
  assert.equal(snap().erro, '', 'ausência da tabela não é erro para o usuário');
  assert.equal(emulated.rows.size, 0);

  resetar('missing', null); // sem sessão: também não quebra
  await store.escolherAppDeRota('apple');
  assert.equal(snap().app, 'apple'); assert.equal(snap().persistente, false);

  resetar('fail', OWNER); // falha de rede: mensagem amigável e escolha mantida
  await store.carregarPreferenciaRota();
  await store.escolherAppDeRota('waze');
  assert.equal(snap().app, 'waze');
  assert.equal(snap().erro, store.MENSAGEM_PREFERENCIA_FALHOU);
  assert.doesNotMatch(snap().erro, /connection|08006|RLS|PGRST|migration|tabela/i);
});

test('preferência: escolha feita enquanto o banco ainda responde não é sobrescrita pelo valor antigo', async () => {
  emulated.rows.clear(); emulated.rows.set(OWNER, 'apple');
  resetar('ok', OWNER);
  const carga = store.carregarPreferenciaRota();
  await store.escolherAppDeRota('waze');
  await carga; await settle();
  assert.equal(snap().app, 'waze');
  assert.equal(emulated.rows.get(OWNER), 'waze');
});

// ------------------------------------------------------------------ interface
const html = (destino, hooks = null) => renderToStaticMarkup(React.createElement(RouteButton, { destino }));
const hrefs = (markup) => [...markup.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
// o link do botão "Abrir rota" (o endereço exibido na tela também é um link, mas só por endereço)
const rotaPrincipal = (markup) => (markup.match(/<a href="([^"]+)"[^>]*aria-label="Abrir rota no/) || [])[1]?.replace(/&amp;/g, '&');

test('UI: "Abrir rota" usa a preferência e "Abrir com outro app" mostra as alternativas sem repetir o app', async () => {
  emulated.rows.clear();
  resetar('ok', OWNER);
  const destino = resolverDestinoRota({ endereco: 'Av. Paulista, 1000', cliente: { endereco: 'Av. Paulista, 1000', latitude: -23.56, longitude: -46.65 } });

  let markup = html(destino);
  let links = hrefs(markup);
  assert.match(links[0], /^https:\/\/www\.google\.com\/maps\/dir\//, 'padrão: Google Maps');
  assert.match(markup, /Abrir rota/); assert.match(markup, /Abrir com outro app/);
  assert.match(markup, /aria-label="Abrir rota no Google Maps"/);
  assert.ok(links.some((l) => l.startsWith('https://waze.com/ul?ll=-23.56,-46.65')), 'Waze por coordenadas');
  assert.ok(links.some((l) => l.startsWith('https://maps.apple.com/?daddr=-23.56%2C-46.65')), 'Apple Maps por coordenadas');
  assert.equal(links.filter((l) => hostDe(l) === 'www.google.com').length, 1, 'o app usado não reaparece nas alternativas');
  assert.match(markup, /<input type="radio"[^>]*checked=""[^>]*value="google"/, 'padrão marcado em "Usar sempre"');
  assert.match(markup, /target="_blank"/); assert.match(markup, /rel="noopener noreferrer"/);
  assert.ok(links.every((l) => urlDeRotaSegura(l)));

  await store.escolherAppDeRota('waze');
  markup = html(destino); links = hrefs(markup);
  assert.match(links[0], /^https:\/\/waze\.com\/ul\?ll=/, 'preferência Waze → Abrir rota abre o Waze');
  assert.match(markup, /aria-label="Abrir rota no Waze"/);
  assert.equal(links.filter((l) => hostDe(l) === 'waze.com').length, 1, 'Waze não é oferecido como "outro app"');
  assert.ok(links.some((l) => hostDe(l) === 'www.google.com') && links.some((l) => hostDe(l) === 'maps.apple.com'));
  assert.match(markup, /<input type="radio"[^>]*checked=""[^>]*value="waze"/);
  assert.doesNotMatch(markup, /<input type="radio"[^>]*checked=""[^>]*value="google"/);

  await store.escolherAppDeRota('apple');
  assert.match(hrefs(html(destino))[0], /^https:\/\/maps\.apple\.com\//);
});

test('UI: sem endereço mostra mensagem amigável e botão desligado, sem texto técnico', () => {
  resetar('ok', OWNER);
  for (const destino of [null, undefined, resolverDestinoRota({}), resolverDestinoRota({ endereco: '  ' })]) {
    const markup = html(destino);
    assert.ok(markup.includes(MENSAGEM_SEM_ENDERECO), 'mensagem exata');
    assert.match(markup, /<button[^>]*disabled=""/);
    assert.doesNotMatch(markup, /<a /, 'nenhum link');
    assert.doesNotMatch(markup, /undefined|null|NaN|\[object|migration|RPC|PGRST|erro técnico/i);
  }
  assert.equal(MENSAGEM_SEM_ENDERECO, 'Este atendimento ainda não possui um endereço disponível para abrir a rota.');
});

test('UI: aviso de preferência só aparece quando faz sentido e nunca expõe termo técnico', async () => {
  emulated.rows.clear();
  const destino = resolverDestinoRota({ endereco: 'Rua A, 1' });
  resetar('ok', OWNER);
  await store.escolherAppDeRota('waze');
  assert.doesNotMatch(html(destino), /Vale somente nesta sessão/, 'preferência guardada: sem aviso');

  resetar('missing', OWNER);
  await store.escolherAppDeRota('waze');
  const semTabela = html(destino);
  assert.match(semTabela, /Vale somente nesta sessão\./);
  assert.match(hrefs(semTabela)[0], /^https:\/\/waze\.com\//, 'a rota continua funcionando');

  resetar('fail', OWNER);
  await store.escolherAppDeRota('apple');
  const comFalha = html(destino);
  assert.ok(comFalha.includes(store.MENSAGEM_PREFERENCIA_FALHOU));
  for (const markup of [semTabela, comFalha]) assert.doesNotMatch(markup, /migration|RPC|PGRST|42P01|tabela|schema|supabase/i);
});

test('UI: a tela da OS usa o botão para proprietário e técnico; sem endereço, a mensagem amigável', () => {
  resetar('ok', OWNER);
  const { OSDetalhe } = legacy;
  const base = { id: 'wo1', numero: 'OS-0042', clienteId: 'cl1', status: 'agendada', data: '2026-10-28', hora: '09:00', local: 'Rua das Flores, 10',
    localServico: 'Bloco A · Apto 12', itens: [], adicionais: [], checklist: [], historico: [], fotos: [], custosExtras: 0 };
  const cliente = (extra = {}) => () => ({ nome: 'Condomínio Aurora', endereco: 'Rua das Flores, 10', latitude: -23.5, longitude: -46.6, ...extra });
  const tecnico = (k) => !['verValores', 'todasOS', 'catalogo', 'garantias', 'orcamentos', 'clientes'].includes(k);
  const render = (os, permitido, papel, cli = cliente()) => renderToStaticMarkup(React.createElement(OSDetalhe, {
    os, cliente: cli, nomeCliente: () => 'Condomínio Aurora', permitido, orcamentos: [], lancamentos: [], garantias: [], ordens: [os], empresa: {}, equipe: [],
    papel, real: false, aviso: () => {}, abrirOS: () => {},
  }));

  for (const [permitido, papel] of [[() => true, 'proprietario'], [tecnico, 'tecnico']]) {
    const markup = render(base, permitido, papel);
    assert.match(markup, /Abrir rota/, papel);
    const rota = rotaPrincipal(markup);
    assert.equal(query(rota, 'destination'), '-23.5,-46.6', `${papel}: coordenadas do cadastro, mesmo endereço`);
    assert.ok(hrefs(markup).some((l) => l.startsWith('https://waze.com/ul?ll=-23.5,-46.6')));
  }
  const outroEndereco = render({ ...base, local: 'Rua Nova, 5' }, () => true, 'proprietario');
  const rotaTexto = rotaPrincipal(outroEndereco);
  assert.equal(query(rotaTexto, 'destination'), 'Rua Nova, 5', 'endereço diferente do cadastro: sem coordenada emprestada, sem o apto');
  const semEndereco = render({ ...base, local: '', localServico: '' }, () => true, 'proprietario');
  assert.ok(semEndereco.includes(MENSAGEM_SEM_ENDERECO));
  assert.equal(rotaPrincipal(semEndereco), undefined, 'sem endereço não há link de rota');
});

// ------------------------------------------------------------------ fiação e migration
test('fiação: nenhum atalho antigo para o Google Maps e a tela de memória técnica segue a preferência', () => {
  const app = read('src/legacy/ZiisTecApp.jsx');
  assert.doesNotMatch(app, /const mapsUrl\b|mapsUrl\(/, 'mapsUrl antigo removido');
  assert.doesNotMatch(app, /google\.com\/maps/, 'o legado não monta link do Google por conta própria');
  assert.match(app, /<RouteButton destino=\{resolverDestinoRota\(\{ endereco: os\.local, localServico: os\.localServico, cliente: c \}\)\} \/>/);
  assert.match(app, /const \{ app \} = useRoutePreference\(\);\s*if \(!valor\) return null;/, 'hook antes do retorno antecipado');
  const memory = read('src/screens/v2/WorkOrderMemoryBaseV2.jsx');
  assert.doesNotMatch(memory, /google\.com\/maps/);
  assert.match(memory, /const \{app:routeApp\}=useRoutePreference\(\);/);
  assert.match(memory, /linkDeRota\(routeApp,resolverDestinoRota\(\{endereco:address\}\)\)/);
  assert.match(memory, /window\.open\(url,'_blank','noopener,noreferrer'\)/);
  // a V2 de clientes continua com o próprio "Abrir Maps" (Google), fora desta onda
  assert.match(read('src/lib/clientLocationsV2Api.js'), /export function buildGoogleMapsUrl/);
});

test('0106: preferência é do usuário, com RLS própria, sem company_id, sem DELETE e sem função definer', () => {
  const sql = read('supabase/0106_user_route_preferences.sql').replace(/^--.*$/gm, '');
  assert.match(sql, /create table if not exists public\.user_route_preferences \(\s*user_id uuid primary key references public\.profiles\(id\) on delete cascade,\s*route_app text not null,/);
  assert.match(sql, /check \(route_app in \('google','waze','apple'\)\)/);
  assert.doesNotMatch(sql, /company_id/i, 'a preferência não pertence à empresa');
  assert.match(sql, /alter table public\.user_route_preferences enable row level security;/);
  assert.match(sql, /revoke all on public\.user_route_preferences from public, anon, authenticated;/);
  assert.match(sql, /grant select, insert, update on public\.user_route_preferences to authenticated;/);
  assert.doesNotMatch(sql, /grant[^;]*delete/i);
  assert.doesNotMatch(sql, /security definer|create (or replace )?function/i, 'nenhum definer novo: a auditoria de funções não muda');
  const policies = [...sql.matchAll(/create policy (\S+) on public\.user_route_preferences\s+for (\w+) to authenticated\s+(using|with check) \(user_id = \(select auth\.uid\(\)\)\)/g)];
  assert.deepEqual(policies.map((m) => m[2]).sort(), ['insert', 'select', 'update']);
  assert.match(sql, /for update to authenticated\s+using \(user_id = \(select auth\.uid\(\)\)\)\s+with check \(user_id = \(select auth\.uid\(\)\)\)/, 'update não reatribui a linha');
  assert.doesNotMatch(sql, /zt_is_owner|zt_is_member|company_members/, 'sem atalho de proprietário sobre a linha de outro');
});

test('0106: o teste SQL/RLS existe, termina em ROLLBACK e está no runner de CI descartável', () => {
  const sqlTest = read('supabase/tests/v2_wave2_route_preferences_rollback.sql');
  assert.match(sqlTest, /^begin;/m); assert.match(sqlTest, /^rollback;\s*$/m);
  assert.match(sqlTest, /owner_nao_altera_a_do_tecnico/); assert.match(sqlTest, /tecnico_salva_propria/); assert.match(sqlTest, /tabela_sem_company_id/);
  assert.match(sqlTest, /anon_nao_grava/); assert.match(sqlTest, /owner_b_salva_propria/);
  assert.ok(read('scripts/run-sql-rls-ci.sh').includes('supabase/tests/v2_wave2_route_preferences_rollback.sql'));
  assert.deepEqual(fs.readdirSync(new URL('../../supabase/', import.meta.url)).filter((f) => /^01(0[6-9]|[1-9]\d)_/.test(f)), ['0106_user_route_preferences.sql', '0107_technician_contract_cycle_guard.sql', '0108_supplier_tenant_foreign_keys.sql', '0109_stock_adjustment_idempotency.sql', '0110_team_invite_email_throttle.sql', '0111_field_execution_intelligence.sql', '0112_company_member_identity_guard.sql'], 'a 0106 é a única migration da Onda 2; 0107–0112 são das auditorias de segurança V1, V1.1 e V1.2');
});
