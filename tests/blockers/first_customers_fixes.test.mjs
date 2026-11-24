// First customers fixes: o que dá para provar sem banco. A prova contra a Data API real
// está em tests/integration/os_complementos_limite_1000.test.mjs (job SQL/RLS da CI).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { lerTodas, emBlocos, lerTodasPorIds, LeituraIncompletaError } from '../../src/lib/paginacao.js';
import { planoCompressao, nomeJpeg, tipoDaImagem, imagemComprimivel, comprimirImagemParaUpload, FOTO_LADO_MAXIMO } from '../../src/lib/imageCompression.js';
import { emProducao, assistenteDisponivel, iaExternaDisponivel } from '../../src/lib/recursosDisponiveis.js';
import clientError, { sanear, montarEvento } from '../../api/client-error.js';

const ler = (f) => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');

// Builder falso que imita o PostgREST: corta em `max` e respeita .range().
function tabela(linhas, { max = 1000 } = {}) {
  let chamadas = 0;
  const montar = () => {
    let ini = 0, fim = Infinity;
    const b = { range: (a, z) => { ini = a; fim = z; return b; }, then: (ok, erro) => {
      chamadas += 1;
      const pagina = linhas.slice(ini, Math.min(fim + 1, ini + max));
      return Promise.resolve({ data: pagina, error: null }).then(ok, erro);
    } };
    return b;
  };
  return { montar, chamadas: () => chamadas };
}

test('lerTodas lê todas as páginas: 2.500 linhas viram 2.500, não 1.000', async () => {
  const linhas = Array.from({ length: 2500 }, (_, i) => ({ id: `id-${i}`, v: 1 }));
  const t = tabela(linhas);
  const r = await lerTodas(t.montar);
  assert.equal(r.error, null);
  assert.equal(r.data.length, 2500);
  assert.equal(r.data.reduce((s, x) => s + x.v, 0), 2500);
  assert.equal(t.chamadas(), 3);
});

test('lerTodas descarta repetidas entre páginas e repassa erro sem lista parcial', async () => {
  let n = 0;
  const repetida = () => ({ range: () => ({ then: (ok) => Promise.resolve({ data: n++ === 0 ? Array.from({ length: 1000 }, (_, i) => ({ id: i })) : [{ id: 999 }, { id: 1000 }], error: null }).then(ok) }) });
  const r = await lerTodas(repetida);
  assert.equal(r.data.length, 1001);
  const falha = () => ({ range: () => ({ then: (ok) => Promise.resolve({ data: null, error: { code: '42501' } }).then(ok) }) });
  const e = await lerTodas(falha);
  assert.equal(e.data, null);
  assert.equal(e.error.code, '42501');
});

test('acima do limite de segurança lerTodas falha em vez de truncar', async () => {
  const t = tabela(Array.from({ length: 50 }, (_, i) => ({ id: i })), { max: 10 });
  const r = await lerTodas(t.montar, { tamanho: 10, maxLinhas: 20 });
  assert.equal(r.data, null);
  assert.ok(r.error instanceof LeituraIncompletaError);
});

test('emBlocos e lerTodasPorIds cobrem todos os ids sem repetir', async () => {
  const ids = Array.from({ length: 401 }, (_, i) => `os-${i}`);
  assert.deepEqual(emBlocos([...ids, 'os-1', null]).map((b) => b.length), [150, 150, 101]);
  const vistos = [];
  const r = await lerTodasPorIds(ids, (bloco) => { vistos.push(...bloco); return tabela(bloco.map((id) => ({ id }))).montar(); });
  assert.equal(r.data.length, 401);
  assert.equal(new Set(vistos).size, 401);
});

test('compressão: foto de celular é reduzida; foto pequena, vídeo e PDF seguem como estão', () => {
  const grande = planoCompressao({ largura: 4032, altura: 3024, bytes: 3_800_000, tipo: 'image/jpeg' });
  assert.deepEqual([grande.comprimir, grande.largura, grande.altura], [true, FOTO_LADO_MAXIMO, 1440]);
  const retrato = planoCompressao({ largura: 3024, altura: 4032, bytes: 3_000_000, tipo: 'image/jpeg' });
  assert.deepEqual([retrato.largura, retrato.altura], [1440, FOTO_LADO_MAXIMO]);
  assert.equal(planoCompressao({ largura: 1280, altura: 960, bytes: 250_000, tipo: 'image/jpeg' }).comprimir, false);
  assert.equal(planoCompressao({ largura: 1280, altura: 960, bytes: 2_000_000, tipo: 'image/png' }).comprimir, true, 'PNG pesado é recomprimido');
  assert.equal(planoCompressao({ largura: 800, altura: 600, bytes: 100_000, tipo: 'image/heic' }).comprimir, true, 'HEIC vira JPEG (PDF e navegadores)');
  assert.equal(planoCompressao({ largura: 1920, altura: 1080, bytes: 9_000_000, tipo: 'video/mp4' }).comprimir, false);
  assert.equal(imagemComprimivel({ type: 'application/pdf' }), false);
  assert.equal(tipoDaImagem({ name: 'IMG_0001.HEIC' }), 'image/heic');
  assert.equal(nomeJpeg('IMG_0001.HEIC'), 'IMG_0001.jpg');
});

test('sem decodificador (Node, HEIC fora do Safari) o arquivo original segue intacto', async () => {
  const arquivo = new File([new Uint8Array(10)], 'foto.jpg', { type: 'image/jpeg' });
  assert.equal(await comprimirImagemParaUpload(arquivo), arquivo);
  const video = new File([new Uint8Array(10)], 'v.mp4', { type: 'video/mp4' });
  assert.equal(await comprimirImagemParaUpload(video), video);
});

test('Production esconde Assistente e IA; Staging/Preview mantêm; IA em Production só com flag explícita', () => {
  for (const origem of ['env-production', 'production-fallback']) {
    assert.equal(emProducao(origem), true);
    assert.equal(assistenteDisponivel(origem), false);
    assert.equal(iaExternaDisponivel(origem, {}), false);
    assert.equal(iaExternaDisponivel(origem, { VITE_ENABLE_EXTERNAL_AI: 'true' }), true);
  }
  for (const origem of ['staging-fallback', 'env-staging', 'env-development-staging', 'unconfigured']) {
    assert.equal(assistenteDisponivel(origem), true);
    assert.equal(iaExternaDisponivel(origem, {}), true);
  }
});

test('telas usam a trava de ambiente antes de oferecer IA ou Assistente', () => {
  assert.match(ler('src/App.jsx'), /!\/production\/\.test\(String\(ambienteSupabase \|\| ''\)\)/);
  assert.match(ler('src/screens/v2/QuoteAIV2.jsx'), /useState\(iaLigada\?'ai':'quick'\)/);
  assert.match(ler('src/screens/v2/QuoteAIV2.jsx'), /mode==='ai'&&iaLigada/);
  assert.match(ler('src/screens/v2/WorkspaceV2Home.jsx'), /\(ia\|\|m\.id!=='orcamento-ia'\)/);
  assert.match(ler('src/screens/v2/FinanceV2.jsx'), /\{IA_FINANCEIRA&&<section/);
  const legado = ler('src/legacy/ZiisTecApp.jsx');
  assert.match(legado, /action=\{IA_EXTERNA_DISPONIVEL \? \(/);
  assert.match(legado, /\{IA_EXTERNA_DISPONIVEL && valor\.trim\(\) && \(/);
});

test('checklist e relato: a persistência não apaga por ausência nem casa por posição', () => {
  const runtime = ler('src/lib/runtimeApi.js');
  const ini = runtime.indexOf('async function persistirChecklist(');
  const bloco = runtime.slice(ini, runtime.indexOf('/* Relato', ini));
  assert.doesNotMatch(bloco, /\.delete\(/, 'checklist não apaga linhas que não vieram da tela');
  assert.doesNotMatch(bloco, /current\[i\]/, 'nenhum casamento por posição');
  assert.doesNotMatch(bloco, /row\.text===\(item\.texto/, 'nenhum casamento por texto');
  assert.match(bloco, /ignoreDuplicates:true/);
  assert.match(runtime, /relatoConhecido\.get\(os\.id\)===ultimo/);
  assert.doesNotMatch(runtime, /from\('attachments'\)\.select\('\*'\)\.eq\('company_id',companyId\)\.order\('created_at',\{ascending:true\}\),/, 'anexos não são mais lidos da empresa inteira sem filtro');
  assert.doesNotMatch(runtime, /attachments\.map\(async a=>\(\{\.\.\.a,url:await signed/, 'nada de uma URL assinada por anexo');
});

test('tela da OS acumula edições do intervalo e relê a OS ao abrir', () => {
  const legado = ler('src/legacy/ZiisTecApp.jsx');
  assert.match(legado, /patchPendente\.current = \{ \.\.\.patchPendente\.current, \.\.\.patchNovo \}/);
  assert.match(legado, /carregarComplementosOSDB\(os, empresaId\)/);
  assert.match(legado, /carregarComplementosOSDB\(origem, empresaId\)/);
});

test('/api/client-error saneia e nunca devolve o que recebeu', async () => {
  assert.equal(sanear('falha eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijk x', 200), 'falha [token] x');
  assert.equal(sanear('contato joao.silva@empresa.com.br', 200), 'contato [email]');
  assert.equal(sanear('cpf 12345678901', 200), 'cpf [documento]');
  const ev = montarEvento({ tipo: 'qualquer', mensagem: 'x'.repeat(999), rota: '/os?token=abc#x', codigo: '42501' }, { VERCEL_ENV: 'production' });
  assert.equal(ev.tipo, 'frontend');
  assert.equal(ev.mensagem.length, 300);
  assert.equal(ev.rota, '/os');
  assert.equal(ev.ambiente, 'production');
  const resp = () => { const r = { headers: {}, code: 0, body: undefined, setHeader(k, v) { r.headers[k] = v; }, status(c) { r.code = c; return r; }, end(b) { r.body = b; return r; } }; return r; };
  const erroOriginal = console.error; const linhas = []; console.error = (l) => linhas.push(l);
  try {
    const ok = resp(); clientError({ method: 'POST', headers: { 'content-length': '50', 'x-forwarded-for': '203.0.113.9' }, body: { tipo: 'upload', mensagem: 'falhou' } }, ok);
    assert.equal(ok.code, 204); assert.equal(ok.body, undefined);
    assert.equal(JSON.parse(linhas[0]).evento, 'zt_client_error');
    const grande = resp(); clientError({ method: 'POST', headers: { 'content-length': '999999' }, body: {} }, grande);
    assert.equal(grande.code, 413);
    const get = resp(); clientError({ method: 'GET', headers: {} }, get);
    assert.equal(get.code, 405);
  } finally { console.error = erroOriginal; }
});

test('login hidrata só OS em trabalho e concluídas há pouco; reaplicar complementos não duplica materiais', async () => {
  globalThis.__ZT_TEST_USER = '00000000-0000-4000-8000-000000000000';
  await import('../integration/support/hooks.mjs');
  const { ordensParaHidratarNoLogin, aplicarComplementosOS, mesclarComplementosOS } = await import('../../src/lib/runtimeApi.js');
  const ordens = [
    { id: 'a', status: 'aguardando' }, { id: 'b', status: 'agendada' }, { id: 'c', status: 'andamento' },
    { id: 'd', status: 'concluida', concluidaEm: '2026-11-20' }, { id: 'e', status: 'concluida', concluidaEm: '2026-08-01' },
    { id: 'f', status: 'cancelada', data: '2026-11-20' },
  ];
  assert.deepEqual(ordensParaHidratarNoLogin(ordens, '2026-11-24'), ['a', 'b', 'c', 'd']);
  const brutos = {
    reports: [{ id: 'r1', work_order_id: 'a', entry_type: 'report', body: 'feito', created_at: '2026-11-24T10:00:00Z' }],
    materials: [{ id: 'm1', work_order_id: 'a', name: 'Cabo', quantity: 2, unit_cost: 5 }],
    checklists: [{ id: 'k2', work_order_id: 'a', text: 'B', position: 1 }, { id: 'k1', work_order_id: 'a', text: 'A', position: 0 }],
    attachments: [], returns: [], iniciadas: [],
  };
  const base = { id: 'a', status: 'aguardando', itens: [{ id: 'i1', nome: 'Serviço' }], historico: [] };
  const uma = aplicarComplementosOS(base, brutos);
  const duas = aplicarComplementosOS(uma, brutos);
  assert.deepEqual(duas.itens.map((i) => i.id), ['i1', 'm1'], 'material não se acumula ao reler a OS');
  assert.deepEqual(duas.checklist.map((k) => k.texto), ['A', 'B'], 'checklist na ordem de posição');
  assert.equal(duas.relato, 'feito');
  const comItemNovo = { ...uma, itens: [...uma.itens, { id: 'i2', nome: 'Adicional' }], relato: 'digitando' };
  const mesclada = mesclarComplementosOS(comItemNovo, duas, { preservarRelato: true });
  assert.deepEqual(mesclada.itens.map((i) => i.id), ['i1', 'i2', 'm1'], 'item adicionado na tela sobrevive à releitura');
  assert.equal(mesclada.relato, 'digitando', 'texto em digitação não é atropelado pela releitura');
});
