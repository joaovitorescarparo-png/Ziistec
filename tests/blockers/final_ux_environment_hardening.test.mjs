/* Acabamento final — linguagem do menu, ferramenta interna fora da interface e
 * CSP por ambiente.
 *
 * A CSP do `vercel.json` é estática e vale para todo deploy do projeto, então
 * cita os três projetos Supabase. A trava nova é uma segunda política, injetada
 * no HTML pelo build, com UM projeto só: o navegador aplica todas as políticas
 * que recebe e um pedido precisa passar em cada uma, então o resultado é a
 * interseção. O resolvedor continua sendo a primeira trava.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ambienteDoDeploy, metaCspDoAmbiente, politicaCspDoAmbiente,
} from '../../scripts/csp-environment.mjs';
import { resolverConfigSupabase } from '../../src/lib/supabaseConfig.js';
import { resolverSupabaseServidor } from '../../api/_supabaseServerConfig.js';

const read = (p) => readFileSync(p, 'utf8');
const legado = read('src/legacy/ZiisTecApp.jsx');
const tela = read('src/components/OperationsBoard.jsx');
const vercel = JSON.parse(read('vercel.json'));
const pkg = JSON.parse(read('package.json'));

const PROD = 'https://diztevlpbcfqleizswxr.supabase.co';
const BETA = 'https://xadoktssibuuebzzjrhv.supabase.co';

const diretivas = (politica) => Object.fromEntries(
  politica.split(';').map((s) => s.trim()).filter(Boolean)
    .map((s) => { const [nome, ...valores] = s.split(/\s+/); return [nome, valores]; }),
);
const politicaDe = (vercelEnv, branch) => politicaCspDoAmbiente({ vercelEnv, branch });
const conexoesDe = (vercelEnv, branch) => diretivas(politicaDe(vercelEnv, branch).politica)['connect-src'];

// ─────────────────────────── 1 e 2. linguagem do menu

test('1: o menu principal diz "Serviços"', () => {
  const nav = legado.slice(legado.indexOf('const NAV = ['), legado.indexOf('const NAV_MOBILE'));
  assert.match(nav, /\{ id: "operacoes", label: "Serviços", icon: \w+ \},/,
    'a entrada da tela operacional chama Serviços');
  assert.equal((nav.match(/id: "/g) || []).length, 14, 'o menu continua com as mesmas 14 entradas');
  // o título da tela e o menu passam a dizer a mesma coisa
  assert.match(tela, /<h1[^>]*>Serviços<\/h1>/);
});

test('2: "Central de Operações" não é mais nome de nada que o usuário lê', () => {
  // o termo sobrevive só em comentário de código, que ninguém lê no celular
  for (const arquivo of ['src/legacy/ZiisTecApp.jsx', 'src/components/OperationsBoard.jsx',
    'src/components/OperationsCommandSimulator.jsx', 'src/lib/operationsBoard.js',
    'src/lib/operationsApi.js', 'src/lib/operationsCommandEngine.js']) {
    const src = read(arquivo);
    const semComentarios = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/^\s*\*.*$/gm, '');
    assert.equal(semComentarios.includes('Central de Operações'), false,
      `${arquivo} não mostra "Central de Operações" ao usuário`);
  }
  // e o identificador interno segue o mesmo: não renomeamos contrato técnico
  assert.ok(legado.includes('id: "operacoes"'), 'a rota interna continua "operacoes"');
  assert.ok(legado.includes('{tela === "operacoes" && ('), 'o roteamento interno não mudou');
  assert.ok(read('src/lib/operationsApi.js').includes("rpc('zt_operations_board'"),
    'a RPC não foi renomeada');
});

// ─────────────────────────── 3 e 4. ferramenta interna

test('3: o simulador não aparece na interface normal', () => {
  assert.match(tela, /\{OperationsCommandSimulator \? \([\s\S]{0,200}<OperationsCommandSimulator/,
    'o simulador só renderiza atrás da trava interna');
  // com a trava desligada o componente nem entra no pacote: a referência é um
  // import dinâmico num ramo que o empacotador elimina
  assert.match(tela, /const OperationsCommandSimulator = SIMULADOR_INTERNO\s*\?\s*lazy\(\(\) => import\('\.\/OperationsCommandSimulator'\)\)\s*:\s*null;/,
    'import dinâmico em ramo morto quando desligado');
  assert.equal(/^import OperationsCommandSimulator from/m.test(tela), false,
    'nenhum import estático: estático entraria no pacote de todo mundo');
  // sem a trava não existe caminho: nenhum botão, menu ou rota o abre
  const semComentarios = tela.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.equal(/simulador/i.test(semComentarios.replace(/SIMULADOR_INTERNO/g, '')), false,
    'a palavra simulador não aparece em texto de tela');
  const nav = legado.slice(legado.indexOf('const NAV = ['), legado.indexOf('const NAV_MOBILE'));
  assert.equal(/simul/i.test(nav), false, 'o menu não ganhou entrada para a ferramenta');
});

test('4: a trava é de ambiente, e Production não tem como ligá-la pela interface', () => {
  assert.match(tela, /const SIMULADOR_INTERNO = import\.meta\.env\.DEV/);
  assert.match(tela, /import\.meta\.env\.DEV/, 'desenvolvimento local');
  assert.match(tela, /import\.meta\.env\.VITE_ZT_OPERATIONS_SIMULATOR === 'true'/,
    'homologação técnica explicitamente habilitada');
  // sem `?.`: é o que permite ao empacotador substituir por literal e dobrar a
  // condição antes de dividir os pacotes
  assert.equal(tela.includes('import.meta.env?.'), false,
    'leitura direta, para a condição ser dobrada no build');
  // não é estado da tela nem preferência do usuário: é constante de build
  assert.equal(/setSimulador|useState\([^)]*SIMULADOR/i.test(tela), false,
    'a trava não é alternável em tempo de execução');
  // e a variável não está configurada em lugar nenhum do repositório
  for (const arquivo of ['vercel.json', 'package.json']) {
    assert.equal(read(arquivo).includes('VITE_ZT_OPERATIONS_SIMULATOR'), false,
      `${arquivo} não liga a ferramenta`);
  }
});

// ─────────────────────────── 5, 6, 7, 8. CSP por ambiente

test('5 e 6: as branches que eram do ambiente de homologação não alcançam projeto nenhum', () => {
  // Aquele ambiente foi removido do código de entrega. As branches que tinham
  // projeto próprio voltaram a ser Preview comum: fail-closed, como as outras.
  for (const branch of ['claude/blocks34-port-beta-v1', 'claude/central-tecnica-v1-integration',
    'claude/retroactive-service-v1', 'claude/operations-simple-v2']) {
    assert.equal(ambienteDoDeploy({ vercelEnv: 'preview', branch }).ambiente, 'preview-sem-projeto');
    assert.deepEqual(conexoesDe('preview', branch), ["'self'"], `${branch} não alcança projeto nenhum`);
    assert.deepEqual(diretivas(politicaDe('preview', branch).politica)['img-src'], ["'self'", 'data:', 'blob:']);
  }
});

test('7 e 8: Production alcança Production e não alcança H0 nem Beta', () => {
  const conexoes = conexoesDe('production', 'main');
  assert.ok(conexoes.includes(PROD));
  assert.ok(conexoes.includes(PROD.replace('https:', 'wss:')));
  assert.equal(conexoes.includes(BETA), false, 'Production não alcança o Beta');
  assert.deepEqual(conexoes, ["'self'", PROD, PROD.replace('https:', 'wss:')],
    'só o projeto de Production e a própria origem');
});

test('Beta/Staging alcança só o Beta, e cada ambiente fica com um projeto', () => {
  const conexoes = conexoesDe('preview', 'rc1c-mobile-ux-stabilization');
  assert.ok(conexoes.includes(BETA));
  assert.equal(conexoes.includes(PROD), false);
  // nenhuma política cita dois projetos ao mesmo tempo
  for (const [env, branch] of [['production', 'main'],
    ['preview', 'rc1c-mobile-ux-stabilization'], ['development', '']]) {
    const citados = [PROD, BETA].filter((u) => politicaDe(env, branch).politica.includes(u));
    assert.equal(citados.length, 1, `${env}/${branch} cita um projeto só`);
  }
});

test('CSP por ambiente é fail-closed e sem curinga', () => {
  // branch fora das allowlists não recebe projeto nenhum — igual ao resolvedor
  for (const branch of ['main', 'feature/qualquer', 'claude/alguma-coisa', 'claude/operations-simple-v2', '']) {
    const conexoes = conexoesDe('preview', branch);
    assert.deepEqual(conexoes, ["'self'"], `preview de ${branch || '(vazio)'} não alcança projeto nenhum`);
  }
  assert.equal(ambienteDoDeploy({ vercelEnv: 'preview', branch: 'main' }).ambiente, 'preview-sem-projeto');
  // build local não injeta política: o cabeçalho da Vercel nem se aplica fora dela
  assert.equal(politicaCspDoAmbiente({}), null);
  assert.equal(metaCspDoAmbiente({}), '');
  // nada de curinga, em nenhum ambiente
  for (const [env, branch] of [['production', 'main'], ['preview', 'claude/operations-simple-v2'],
    ['preview', 'rc1c-mobile-ux-stabilization'], ['preview', 'outra'], ['development', '']]) {
    const p = politicaDe(env, branch).politica;
    assert.equal(/\*/.test(p), false, `${env}/${branch} sem curinga`);
    assert.equal(/unsafe-inline|unsafe-eval/.test(p), false, `${env}/${branch} sem unsafe`);
    assert.equal(/\bhttp:\/\//.test(p), false, `${env}/${branch} só https e wss`);
  }
});

test('a política injetada declara só as duas diretivas que nomeiam projeto', () => {
  // as outras ficam de fora de propósito: diretiva ausente numa política não
  // restringe por ela, então script-src, frame-ancestors e companhia continuam
  // governadas pelo cabeçalho do vercel.json, sem risco de afrouxar nada.
  const d = diretivas(politicaDe('production', 'main').politica);
  assert.deepEqual(Object.keys(d).sort(), ['connect-src', 'img-src']);
  for (const proibida of ['script-src', 'default-src', 'style-src', 'frame-ancestors', 'object-src']) {
    assert.equal(proibida in d, false, `${proibida} não é redefinida pela política do ambiente`);
  }
  // e o cabeçalho continua existindo, com as diretivas fortes
  const cabecalho = vercel.headers.flatMap((h) => h.headers).find((h) => h.key === 'Content-Security-Policy').value;
  const dc = diretivas(cabecalho);
  assert.deepEqual(dc['script-src'], ["'self'"]);
  assert.deepEqual(dc['object-src'], ["'none'"]);
  assert.deepEqual(dc['frame-ancestors'], ["'none'"]);
  assert.ok('upgrade-insecure-requests' in dc);
});

test('o build injeta a política, e o HTML não a traz fixa', () => {
  const vite = read('vite.config.js');
  assert.match(vite, /transformIndexHtml/);
  assert.match(vite, /process\.env\.VERCEL_ENV/);
  assert.match(vite, /process\.env\.VERCEL_GIT_COMMIT_REF/);
  assert.match(vite, /metaCspDoAmbiente/);
  // o index.html versionado não fixa projeto nenhum: quem decide é o build
  const html = read('index.html');
  assert.equal(/Content-Security-Policy/.test(html), false,
    'o HTML versionado não carrega política de ambiente');
  for (const u of [PROD, BETA]) assert.equal(html.includes(u), false, 'nem projeto Supabase');
  // a tag sai escapada
  const meta = metaCspDoAmbiente({ vercelEnv: 'preview', branch: 'rc1c-mobile-ux-stabilization' });
  assert.match(meta, /^<meta http-equiv="Content-Security-Policy" content="[^"]+" \/>$/);
  assert.equal(meta.includes("'"), false, 'aspas simples saem como entidade');
  assert.ok(meta.includes('&#39;self&#39;'));
});

// ─────────────────────────── 9. o resolvedor não mudou

test('9: o resolvedor continua a primeira trava, e continua fail-closed', () => {
  const cliente = (o) => resolverConfigSupabase({
    prodUrl: PROD, prodKey: 'sb_publishable_SGA5FVYLYicO1piUDRb-Rw_wNSxgqyw',
    stagingUrl: BETA, stagingKey: 'sb_publishable_AIJvagsmB3vknIW9ykFERQ_T7aCkl5e',
    ...o,
  });
  const HOST_SEM_PROJETO = 'ziistec-git-claude-operations-simple-v2-js-connect.vercel.app';

  // o host daquele Preview não resolve mais para projeto nenhum
  const semProjeto = cliente({ deploymentEnv: 'preview', host: HOST_SEM_PROJETO });
  assert.equal(semProjeto.configurado, false);
  assert.equal(semProjeto.url, '');
  // host desconhecido não cai para Production: falha fechada
  const desconhecido = cliente({ deploymentEnv: 'preview', host: 'ziistec-qualquer-outra.vercel.app' });
  assert.equal(desconhecido.configurado, false);
  assert.equal(desconhecido.url, '');
  // par de outro projeto em contexto de Production é recusado
  const cruzado = cliente({
    deploymentEnv: 'production', host: 'ziistec.vercel.app',
    envUrl: BETA, envKey: 'sb_publishable_AIJvagsmB3vknIW9ykFERQ_T7aCkl5e',
  });
  assert.equal(cruzado.configurado, false);
  // servidor: main em Production continua em Production; preview da main não resolve nada
  assert.equal(resolverSupabaseServidor({ VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'main' }).url, PROD);
  assert.equal(resolverSupabaseServidor({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'main' }).configurado, false);

  // as duas travas concordam: onde o resolvedor leva, a CSP permite
  for (const [env, branch, esperado] of [
    ['production', 'main', PROD],
    ['preview', 'rc1c-mobile-ux-stabilization', BETA],
  ]) {
    const servidor = resolverSupabaseServidor({ VERCEL_ENV: env, VERCEL_GIT_COMMIT_REF: branch });
    assert.equal(servidor.url, esperado, `${env}/${branch}: resolvedor`);
    assert.ok(conexoesDe(env, branch).includes(esperado), `${env}/${branch}: CSP permite o mesmo`);
  }
});

// ─────────────────────────── 10. nada regrediu

test('10: a Operations Simple V2 e as rodadas anteriores seguem no gate', () => {
  const v2 = pkg.scripts['verify:v2'];
  for (const t of ['operations_simple_v2', 'operations_board_contract', 'operations_command_engine',
    'retroactive_service_contract', 'central_tech_security_fix', 'environment_isolation',
    'security_audit_v1_static', 'final_ux_environment_hardening']) {
    assert.ok(v2.includes(`tests/blockers/${t}.test.mjs`), `${t} roda no gate`);
  }
  // a tela da V2 continua inteira
  for (const parte of ['ATALHOS.map', 'Precisa organizar', 'Quem vai fazer?', 'Escolher quem vai fazer',
    'Alterar serviço', 'Novo serviço', 'Criar serviço', 'Cadastrar cliente', 'ATRASADO',
    'estadoDoTecnico', 'resumoDoDia', 'textoDoAtraso', 'agendarOSOperacoesDB(']) {
    assert.ok(tela.includes(parte), `a V2 ainda tem ${parte}`);
  }
  // e o registro retroativo não foi tocado nesta rodada
  assert.ok(read('supabase/0117_retroactive_service_registration.sql')
    .includes('create or replace function public.zt_register_completed_work_order('));
  assert.ok(legado.includes('>Registrar serviço realizado</Btn>'));
});
